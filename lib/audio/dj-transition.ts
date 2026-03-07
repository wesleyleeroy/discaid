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
 * Returns sorted array of times (seconds) where energy rises
 * from below the silence threshold to above it.
 */
export function findAllPhraseStarts(
    energy: Float32Array,
    frameRate: number,
): number[] {
    let sum = 0;
    for (let i = 0; i < energy.length; i++) sum += energy[i];
    const mean = sum / Math.max(1, energy.length);
    const threshold = mean * 0.1;

    const starts: number[] = [];
    for (let i = 1; i < energy.length; i++) {
        if (energy[i - 1] < threshold && energy[i] >= threshold) {
            starts.push(i / frameRate);
        }
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
): TransitionPlan {
    // Smooth instrumental crossfade duration — long enough to blend naturally
    const swapDuration = 8;

    // Analyze both vocal tracks
    const s1Energy = calculateVocalEnergy(song1VocalLeft, song1VocalRight, song1SampleRate);
    const s1Pauses = findVocalPauses(s1Energy.energy, s1Energy.frameRate, 0.25);
    const s2Energy = calculateVocalEnergy(song2VocalLeft, song2VocalRight, song2SampleRate);

    // Instrumental crossfade starts ~75% of the song (at least swapDuration + 4s before end)
    const idealStart = song1Duration * 0.75;
    const latestStart = song1Duration - swapDuration - 4;
    const swapTime = Math.min(idealStart, Math.max(latestStart, song1Duration * 0.55));

    // --- Find the best vocal switch point ---
    // The user wants a VERY long period where song 2's instrumental is playing
    // underneath song 1's vocals.
    //
    // With the 3-phase blend:
    //   Phase 1 (song 2 fade-in) ends at swapTime + swapDuration * 0.35
    //   Phase 2 (blend holding) ends at swapTime + swapDuration * 0.60
    //   Phase 3 (song 1 fade-out) ends at swapTime + swapDuration
    //
    // We search for vocal pauses starting SEVERAL SECONDS AFTER the
    // entire instrumental blend phase has finished. This ensures song 1's vocals play
    // over song 2's new beat completely natively for a long, extended period.
    const searchStart = swapTime + swapDuration + 4.0; // Starts 4s *after* the 8s swap finishes
    const searchEnd = Math.min(swapTime + swapDuration + 14.0, song1Duration - 0.5); // Search up to 14s after swap

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
            // Absolute fallback — end vocals exactly when the instrumental fade completes
            vocalSwitchTime = swapTime + swapDuration;
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

    return {
        crossfadeStart: swapTime,
        crossfadeDuration: swapDuration,
        vocalSwitchTime,
        song2VocalEntry,
        song2PhraseStarts,
    };
}
