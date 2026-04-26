/**
 * DJ Transition Engine — Analyzes vocal tracks to create intelligent
 * transition plans between songs.
 *
 * Uses RMS energy analysis to detect:
 * - Vocal pauses (good moments to switch vocals)
 * - Phrase boundaries (good entry points for new vocals)
 */

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

export interface VocalPause {
    start: number;    // seconds
    end: number;      // seconds
    duration: number; // seconds
}

export interface TransitionPlan {
    crossfadeStart: number;     // when to start fading instrumentals (seconds into song 1)
    crossfadeDuration: number;  // how long the instrumental fade takes (seconds)
    vocalSwitchTime: number;    // when to stop song 1's vocals (seconds into song 1)
    song2VocalEntry: number;    // fallback entry point for song 2's vocal
    song2PhraseStarts: number[]; // all phrase start timestamps in song 2's vocals (seconds)
    song2RateRatio: number;       // playback-rate multiplier for song 2 during the crossfade (1 = no change)
    song2RateRampDuration: number; // seconds over which song 2 ramps back to 1.0 once its vocals enter
}

/**
 * Compute the playback-rate ratio to apply to song 2 so its tempo matches
 * song 1 during the crossfade. Falls back to 1.0 (no change) if either BPM
 * is unknown. Tries half/double tempo (a common DJ trick) before clamping.
 */
function computeRateRatio(bpm1?: number, bpm2?: number): number {
    if (!bpm1 || !bpm2 || !isFinite(bpm1) || !isFinite(bpm2)) return 1;
    let r = bpm1 / bpm2;
    if (r > 1.4) r /= 2;
    else if (r < 0.7) r *= 2;
    const MAX_STRETCH = 0.18; // ±18%, beyond this pitch shift is too obvious
    return Math.max(1 - MAX_STRETCH, Math.min(1 + MAX_STRETCH, r));
}

/**
 * Calculate RMS energy per frame for a stereo vocal buffer.
 */
export function calculateVocalEnergy(
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
): { energy: Float32Array; frameRate: number } {
    const len = Math.max(left.length, right.length);
    const numFrames = Math.max(0, Math.floor((len - FRAME_SIZE) / HOP_SIZE) + 1);
    const energy = new Float32Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
        const start = f * HOP_SIZE;
        const end = Math.min(start + FRAME_SIZE, len);
        let sumSq = 0;
        for (let i = start; i < end; i++) {
            const l = i < left.length ? left[i] : 0;
            const r = i < right.length ? right[i] : 0;
            const s = (l + r) * 0.5;
            sumSq += s * s;
        }
        energy[f] = Math.sqrt(sumSq / FRAME_SIZE);
    }

    return { energy, frameRate: sampleRate / HOP_SIZE };
}

/**
 * Find pauses (low energy regions) in a vocal track.
 */
export function findVocalPauses(
    energy: Float32Array,
    frameRate: number,
    minPauseDuration: number = 0.25,
    silenceThreshold?: number,
): VocalPause[] {
    // Auto-determine threshold: 8% of mean energy
    if (silenceThreshold === undefined) {
        let sum = 0;
        for (let i = 0; i < energy.length; i++) sum += energy[i];
        const mean = sum / Math.max(1, energy.length);
        silenceThreshold = mean * 0.08;
    }

    const minFrames = Math.ceil(minPauseDuration * frameRate);
    const pauses: VocalPause[] = [];
    let silenceStart = -1;

    for (let i = 0; i < energy.length; i++) {
        if (energy[i] < silenceThreshold) {
            if (silenceStart === -1) silenceStart = i;
        } else {
            if (silenceStart !== -1) {
                const length = i - silenceStart;
                if (length >= minFrames) {
                    const start = silenceStart / frameRate;
                    const end = i / frameRate;
                    pauses.push({ start, end, duration: end - start });
                }
                silenceStart = -1;
            }
        }
    }

    // Handle trailing silence
    if (silenceStart !== -1) {
        const length = energy.length - silenceStart;
        if (length >= minFrames) {
            const start = silenceStart / frameRate;
            const end = energy.length / frameRate;
            pauses.push({ start, end, duration: end - start });
        }
    }

    return pauses;
}

/**
 * Find the nearest phrase start (rising energy after silence)
 * near a target time in a vocal track.
 */
export function findNearestPhraseStart(
    energy: Float32Array,
    frameRate: number,
    targetTime: number,
    searchWindowSeconds: number = 4,
): number {
    const targetFrame = Math.round(targetTime * frameRate);
    const windowFrames = Math.round(searchWindowSeconds * frameRate);
    const startFrame = Math.max(1, targetFrame - windowFrames);
    const endFrame = Math.min(energy.length - 1, targetFrame + windowFrames);

    // Threshold for "silence"
    let sum = 0;
    for (let i = 0; i < energy.length; i++) sum += energy[i];
    const mean = sum / Math.max(1, energy.length);
    const threshold = mean * 0.1;

    // Find "rise" events: energy goes from below threshold to above
    let bestFrame = targetFrame;
    let bestDist = Infinity;

    for (let i = startFrame; i <= endFrame; i++) {
        if (energy[i - 1] < threshold && energy[i] >= threshold) {
            const dist = Math.abs(i - targetFrame);
            if (dist < bestDist) {
                bestDist = dist;
                bestFrame = i;
            }
        }
    }

    return Math.max(0, bestFrame / frameRate);
}

/**
 * Find ALL phrase start timestamps in a vocal track.
 *
 * Returns the END of each significant silence — i.e., the moment vocals
 * re-enter after a real pause. By requiring a minimum preceding silence,
 * we filter out mid-sentence dips and only return points that sound like
 * the start of a new line/sentence/section.
 */
export function findAllPhraseStarts(
    energy: Float32Array,
    frameRate: number,
    minPrecedingSilenceSeconds: number = 0.4,
): number[] {
    const pauses = findVocalPauses(energy, frameRate, minPrecedingSilenceSeconds);
    const starts = pauses.map((p) => p.end);

    // If the song begins with vocals (no detected leading silence), treat
    // time 0 as a valid phrase start so callers can enter at the song's
    // very beginning. Without this, songs with no intro silence would have
    // no early phrase candidates and vocal entry would be skipped entirely.
    if (energy.length > 0 && (starts.length === 0 || starts[0] > 0.5)) {
        let sum = 0;
        for (let i = 0; i < energy.length; i++) sum += energy[i];
        const mean = sum / energy.length;
        if (energy[0] >= mean * 0.08) starts.unshift(0);
    }

    return starts;
}

/**
 * Create a transition plan between two songs.
 *
 * The transition works in three phases:
 * 1. **Instrumental blend** — Near the end of song 1, song 2's
 *    instrumental fades in while song 1's instrumental holds.
 *    Both play together briefly (the "blend" window), then
 *    song 1's instrumental fades out.
 * 2. **Vocal switch** — Shortly after song 1's instrumental fades,
 *    at the next natural pause/end of a bar in song 1's vocals,
 *    stop song 1's vocals and start song 2's vocals synced to
 *    where song 2's instrumental already is.
 */
export function createTransitionPlan(
    song1VocalLeft: Float32Array,
    song1VocalRight: Float32Array,
    song1Duration: number,
    song1SampleRate: number,
    song2VocalLeft: Float32Array,
    song2VocalRight: Float32Array,
    song2SampleRate: number,
    song1BPM?: number,
    song2BPM?: number,
): TransitionPlan {
    const rateRatio = computeRateRatio(song1BPM, song2BPM);
    const rateRampDuration = 1.5;
    // Smooth instrumental crossfade duration. The execution side splits this
    // into: song-2 fade-in → song-1 duck-down → HELD blend (both audible) →
    // long cross-trade (song 1 fades out, song 2 rises to full).
    // 14s gives a generous ~3s held blend AND a ~6.5s cross-trade where both
    // tracks are clearly audible while volumes shift.
    const swapDuration = 14;
    // After the instrumental crossfade finishes, song 1's vocals keep
    // playing over song 2's full instrumental for at least this many
    // seconds. This is the "song 1 vocals riding over the new beat"
    // window — both timing windows below (search range and alignment
    // clamp) honor this minimum so the alignment pass cannot eat it.
    const MIN_VOCAL_OVERLAP = 6;

    // Analyze both vocal tracks
    const s1Energy = calculateVocalEnergy(song1VocalLeft, song1VocalRight, song1SampleRate);
    const s1Pauses = findVocalPauses(s1Energy.energy, s1Energy.frameRate, 0.25);
    const s2Energy = calculateVocalEnergy(song2VocalLeft, song2VocalRight, song2SampleRate);

    // Instrumental crossfade starts ~75% of the song; latestStart leaves
    // room for the swap PLUS the vocal-overlap window PLUS a little tail.
    const idealStart = song1Duration * 0.75;
    const latestStart = song1Duration - swapDuration - MIN_VOCAL_OVERLAP - 4;
    const swapTime = Math.min(idealStart, Math.max(latestStart, song1Duration * 0.55));

    // --- Find the best vocal switch point ---
    // We deliberately look for a song-1 vocal pause that sits AT LEAST
    // MIN_VOCAL_OVERLAP seconds after the instrumental swap ends, so
    // there's a clear window of "song 1 still singing over song 2's new
    // bed at full volume."
    const searchStart = swapTime + swapDuration + MIN_VOCAL_OVERLAP;       // earliest acceptable
    const searchEnd = Math.min(swapTime + swapDuration + MIN_VOCAL_OVERLAP + 10, song1Duration - 0.5); // up to ~10s past that

    const candidates = s1Pauses.filter(
        (p) => p.start >= searchStart && p.start <= searchEnd,
    );

    let vocalSwitchTime: number;
    let song2VocalEntry: number;

    if (candidates.length > 0) {
        // Score each candidate: prefer longer pauses with better
        // song 2 vocal alignment. Also prefer pauses that are closer
        // to the end of the instrumental fade (more natural timing).
        let bestScore = Infinity;
        let bestPause = candidates[0];
        let bestEntry = 0;

        for (const pause of candidates) {
            // Where song 2's instrumental is when this pause happens
            const s2InstPos = pause.start - swapTime;
            // Find the nearest phrase start in song 2 near that position
            const phraseStart = findNearestPhraseStart(
                s2Energy.energy,
                s2Energy.frameRate,
                s2InstPos,
                3,
            );
            // Mismatch: how far the phrase start is from the instrumental pos
            const mismatch = Math.abs(phraseStart - s2InstPos);
            // Score component 1: penalize mismatch.
            // Score component 2: reward longer pauses.
            // Score component 3 (CRITICAL): heavily penalize pauses that happen later in the window.
            // We want the EARLYest possible valid pause after the music starts changing.
            const timeDiff = pause.start - searchStart;

            const score = mismatch - (pause.duration * 0.5) + (timeDiff * 2.0);

            if (score < bestScore) {
                bestScore = score;
                bestPause = pause;
                bestEntry = phraseStart;
            }
        }

        vocalSwitchTime = bestPause.start;
        song2VocalEntry = bestEntry;
    } else {
        // No suitable pause found in the tight window — find the nearest
        // pause after the specific search window starts
        const laterCandidates = s1Pauses.filter(
            (p) => p.start >= searchStart && p.start <= song1Duration - 0.5,
        );
        if (laterCandidates.length > 0) {
            // Pick the earliest one (closest to the music change)
            const firstPause = laterCandidates[0];
            vocalSwitchTime = firstPause.start;
            const s2InstPos = vocalSwitchTime - swapTime;
            song2VocalEntry = findNearestPhraseStart(
                s2Energy.energy,
                s2Energy.frameRate,
                s2InstPos,
                3,
            );
        } else {
            // Absolute fallback — keep the overlap window even when no
            // pause was found (better to cut vocals on a beat than to
            // collapse the overlap entirely).
            vocalSwitchTime = Math.min(
                swapTime + swapDuration + MIN_VOCAL_OVERLAP,
                song1Duration - 0.2,
            );
            const s2InstPos = vocalSwitchTime - swapTime;
            song2VocalEntry = findNearestPhraseStart(
                s2Energy.energy,
                s2Energy.frameRate,
                s2InstPos,
                3,
            );
        }
    }

    // Pre-compute all phrase starts in song 2's vocals
    const song2PhraseStarts = findAllPhraseStarts(s2Energy.energy, s2Energy.frameRate);

    // ── Vocal-entry alignment pass ────────────────────────────────
    // Goal: song 2's vocals must enter within MAX_VOCAL_DELAY seconds
    // after song 1's vocals end, AND at a natural phrase boundary.
    //
    // Strategy:
    //   1. Compute song 2 instrumental's offset at vocalSwitchTime under the
    //      current swapTime. If a phrase boundary falls inside the [0, MAX]
    //      window past that offset, use it directly.
    //   2. Otherwise, pick a desired phrase (the first reasonable one) and
    //      shift crossfadeStart earlier so that the phrase lands inside the
    //      window — i.e., song 2's instrumental starts playing earlier under
    //      song 1's vocals so by the switch time it's at the right offset.
    const TARGET_VOCAL_DELAY = 1.5;
    const MAX_VOCAL_DELAY = 5;
    let crossfadeStart = swapTime;

    // Song 2 plays at `rateRatio` during the crossfade, so its buffer advances
    // `rate × realSeconds`. All comparisons against song2PhraseStarts (buffer
    // offsets) must therefore be scaled by rateRatio.
    const s2BufferAtSwitch = (vocalSwitchTime - crossfadeStart) * rateRatio;
    const phraseInWindow = song2PhraseStarts.find(
        (p) => p >= s2BufferAtSwitch - 0.1 && p <= s2BufferAtSwitch + MAX_VOCAL_DELAY * rateRatio,
    );

    if (phraseInWindow !== undefined) {
        // Existing timing already aligns naturally — nothing to do.
        song2VocalEntry = phraseInWindow;
    } else if (song2PhraseStarts.length > 0) {
        const minStart = Math.max(swapDuration + 2, song1Duration * 0.2);
        // Reserve MIN_VOCAL_OVERLAP seconds between swap end and vocal
        // switch so song 1 keeps singing over song 2's instrumental for
        // a noticeable window. Without this, the alignment can clamp
        // crossfadeStart up to (vocalSwitchTime - swapDuration), making
        // the swap finish exactly when vocals switch — zero overlap.
        const maxStart = vocalSwitchTime - swapDuration - MIN_VOCAL_OVERLAP;

        // ── Reachable phrase range ──
        // crossfadeStart is bounded by [minStart, maxStart], so the song-2
        // instrumental offset at vocal-entry time is bounded too:
        //   (vocalSwitchTime + delay - crossfadeStart) * r,  delay ∈ [0, MAX]
        // The earliest reachable phrase offset corresponds to crossfadeStart =
        // maxStart (and delay = 0); the latest to crossfadeStart = minStart
        // (and delay = MAX_VOCAL_DELAY). We must pick a target phrase inside
        // this window — otherwise the clamp will silently shift crossfadeStart
        // off the targeted phrase and vocals land mid-bar.
        const minReachable = (swapDuration + MIN_VOCAL_OVERLAP) * rateRatio;
        const maxReachable = (vocalSwitchTime + MAX_VOCAL_DELAY - minStart) * rateRatio;

        // Prefer the EARLIEST reachable phrase — gives the tightest transition
        // (vocal entry happens close to vocalSwitchTime, song 2 instrumental
        // doesn't sit alone for too long after).
        let targetPhrase = song2PhraseStarts.find(
            (p) => p >= minReachable && p <= maxReachable,
        );
        if (targetPhrase === undefined) {
            // No phrase in the reachable range — pick the phrase closest to
            // the range. The clamp will absorb the residual mismatch and
            // we'll still land on a real phrase boundary.
            targetPhrase = song2PhraseStarts.reduce((best, p) => {
                const dP = p < minReachable ? minReachable - p
                        :  p > maxReachable ? p - maxReachable : 0;
                const dB = best < minReachable ? minReachable - best
                        :  best > maxReachable ? best - maxReachable : 0;
                return dP < dB ? p : best;
            }, song2PhraseStarts[0]);
        }

        // (vocalSwitchTime + TARGET - crossfadeStart) * r = targetPhrase
        //   => crossfadeStart = vocalSwitchTime + TARGET - targetPhrase / r
        const desired = vocalSwitchTime + TARGET_VOCAL_DELAY - targetPhrase / rateRatio;
        crossfadeStart = Math.max(minStart, Math.min(maxStart, desired));

        const newS2BufferAtSwitch = (vocalSwitchTime - crossfadeStart) * rateRatio;
        const idealBuffer = newS2BufferAtSwitch + TARGET_VOCAL_DELAY * rateRatio;
        const candidates = song2PhraseStarts.filter(
            (p) =>
                p >= newS2BufferAtSwitch - 0.1 &&
                p <= newS2BufferAtSwitch + MAX_VOCAL_DELAY * rateRatio,
        );
        if (candidates.length > 0) {
            song2VocalEntry = candidates.reduce(
                (best, p) =>
                    Math.abs(p - idealBuffer) < Math.abs(best - idealBuffer) ? p : best,
                candidates[0],
            );
        } else {
            const next = song2PhraseStarts.find((p) => p >= newS2BufferAtSwitch);
            if (
                next !== undefined &&
                next - newS2BufferAtSwitch <= MAX_VOCAL_DELAY * rateRatio * 1.5
            ) {
                song2VocalEntry = next;
            } else {
                song2VocalEntry = idealBuffer;
            }
        }
    } else {
        // No detectable phrase boundaries at all — enter at the target delay
        // past whatever offset song 2 instrumental is at when vocals switch.
        song2VocalEntry = s2BufferAtSwitch + TARGET_VOCAL_DELAY * rateRatio;
    }

    // Defensive clamp — never plan a vocal entry past the song's end, otherwise
    // the AudioBufferSource starts at the buffer's last sample and onended
    // fires immediately, meaning no audible vocals.
    const song2Duration = song2VocalLeft.length / song2SampleRate;
    song2VocalEntry = Math.max(0, Math.min(song2VocalEntry, song2Duration - 0.5));

    return {
        crossfadeStart,
        crossfadeDuration: swapDuration,
        vocalSwitchTime,
        song2VocalEntry,
        song2PhraseStarts,
        song2RateRatio: rateRatio,
        song2RateRampDuration: rateRampDuration,
    };
}
