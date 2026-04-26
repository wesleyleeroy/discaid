/**
 * BPM Detection using comb-filtered autocorrelation of an onset envelope.
 *
 * Algorithm:
 * 1. Compute log-magnitude energy on overlapping ~23ms frames (compresses
 *    dynamic range so quieter beats don't get drowned by sustained vocals).
 * 2. Take half-wave rectified first differences for an onset envelope, then
 *    subtract a local moving mean to suppress non-percussive content.
 * 3. Compute autocorrelation across a wide lag range — far enough that we
 *    can sum harmonic peaks (lag, 2·lag, 3·lag, …) for any candidate tempo.
 * 4. For each candidate BPM at 0.1 BPM resolution, score it with a comb
 *    filter that adds the autocorrelation at its first K harmonic lags.
 *    This is what disambiguates octave errors: a true 120 BPM song scores
 *    higher than 60 BPM because peaks at 0.5s, 1.0s, 1.5s, 2.0s, ... all
 *    align, whereas testing 60 BPM only catches every other peak.
 * 5. Apply only a very mild prior toward the 70–180 BPM range — the comb
 *    filter does the heavy lifting, so we don't need an aggressive bias.
 */

import { BPM_MIN, BPM_MAX, BPM_ANALYSIS_DURATION } from '@/lib/utils/constants';

interface BPMResult {
    bpm: number;
    confidence: number;
    beatGrid: number[];
    downbeats: number[];
}

/**
 * Detect BPM from an AudioBuffer using autocorrelation of onset strength.
 */
export function detectBPM(audioBuffer: AudioBuffer): BPMResult {
    // Use first channel, limit analysis duration for performance
    const sampleRate = audioBuffer.sampleRate;
    const maxSamples = Math.min(
        audioBuffer.length,
        Math.floor(BPM_ANALYSIS_DURATION * sampleRate)
    );

    // Get mono audio data
    const channelData = new Float32Array(maxSamples);
    audioBuffer.copyFromChannel(channelData, 0, 0);
    if (audioBuffer.numberOfChannels > 1) {
        const right = new Float32Array(maxSamples);
        audioBuffer.copyFromChannel(right, 1, 0);
        for (let i = 0; i < maxSamples; i++) {
            channelData[i] = (channelData[i] + right[i]) * 0.5;
        }
    }

    // ── Step 1: log-magnitude energy envelope ─────────────────────
    // Larger frames (~23 ms) give smoother envelopes than the prior 10 ms
    // and don't fire on transient noise inside a single beat.
    const windowSize = 1024;
    const hopSize = 512;
    if (maxSamples < windowSize * 4) {
        // Too short to analyze reliably
        return { bpm: 120, confidence: 0, beatGrid: [], downbeats: [] };
    }
    const numWindows = Math.floor((maxSamples - windowSize) / hopSize) + 1;

    const energy = new Float32Array(numWindows);
    for (let i = 0; i < numWindows; i++) {
        let sum = 0;
        const start = i * hopSize;
        for (let j = 0; j < windowSize; j++) {
            const s = channelData[start + j];
            sum += s * s;
        }
        // log(1 + meanSquare) compresses dynamics so a soft kick contributes
        // similarly to a loud snare — important for accurate onset rate.
        energy[i] = Math.log1p(sum / windowSize);
    }

    // ── Step 2: half-wave rectified differential, then subtract local mean ─
    const rawOnsets = new Float32Array(numWindows - 1);
    for (let i = 1; i < numWindows; i++) {
        rawOnsets[i - 1] = Math.max(0, energy[i] - energy[i - 1]);
    }
    // Subtracting a moving average suppresses slow-varying baseline (sustained
    // pads/vocals) while preserving sharp transients (drums).
    const onsetStrength = new Float32Array(rawOnsets.length);
    const smoothRadius = 8; // ±~93 ms
    for (let i = 0; i < rawOnsets.length; i++) {
        let s = 0, c = 0;
        const lo = Math.max(0, i - smoothRadius);
        const hi = Math.min(rawOnsets.length - 1, i + smoothRadius);
        for (let j = lo; j <= hi; j++) { s += rawOnsets[j]; c++; }
        onsetStrength[i] = Math.max(0, rawOnsets[i] - s / c);
    }

    // ── Step 3: autocorrelation across a WIDE lag range ───────────
    // Wide enough to fit K harmonics at the slowest tempo we'd consider.
    const onsetRate = sampleRate / hopSize; // onsets per second
    const K = 5; // number of harmonic peaks to comb
    const maxLagSec = (60 / BPM_MIN) * K;   // e.g. 5 s for K=5, BPM_MIN=60
    const maxLagSamples = Math.min(
        onsetStrength.length - 1,
        Math.floor(maxLagSec * onsetRate),
    );

    const autocorr = new Float32Array(maxLagSamples + 1);
    for (let lag = 1; lag <= maxLagSamples; lag++) {
        const count = onsetStrength.length - lag;
        if (count <= 0) break;
        let sum = 0;
        for (let i = 0; i < count; i++) {
            sum += onsetStrength[i] * onsetStrength[i + lag];
        }
        autocorr[lag] = sum / count;
    }

    // ── Step 4: comb-filter score for every candidate BPM ─────────
    let bestBPM = 120;
    let bestScore = -Infinity;
    let scoreSum = 0;
    let scoreCount = 0;

    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.1) {
        const lagF = (60 / bpm) * onsetRate;
        let score = 0;
        let weightSum = 0;
        for (let k = 1; k <= K; k++) {
            const harmonicLag = k * lagF;
            const intLag = Math.floor(harmonicLag);
            if (intLag < 1 || intLag + 1 > maxLagSamples) break;
            const frac = harmonicLag - intLag;
            const ac = autocorr[intLag] * (1 - frac) + autocorr[intLag + 1] * frac;
            // 1/√k weighting: the fundamental matters most but harmonics
            // still contribute meaningfully.
            const w = 1 / Math.sqrt(k);
            score += ac * w;
            weightSum += w;
        }
        if (weightSum > 0) score /= weightSum;

        // Very mild perceptual nudge — broad, gentle. Avoids forcing 120 BPM
        // on songs that genuinely sit at 80 or 160.
        const bias = 1 + 0.04 * Math.exp(-Math.pow((bpm - 125) / 60, 2));
        score *= bias;

        scoreSum += score;
        scoreCount++;
        if (score > bestScore) {
            bestScore = score;
            bestBPM = bpm;
        }
    }

    // Round to nearest 0.1
    const bpm = Math.round(bestBPM * 10) / 10;

    // Confidence: how much the winning BPM exceeds the mean score across
    // all candidates. Comb-filter prominence is a good proxy for tempo
    // clarity.
    const meanScore = scoreSum / Math.max(1, scoreCount);
    const confidence = Math.min(
        1,
        Math.max(0, meanScore > 0 ? (bestScore / meanScore - 1) * 0.6 : 0),
    );

    // ── Step 5: beat grid using the (now-accurate) BPM ────────────
    const beatInterval = 60 / bpm;
    const totalDuration = audioBuffer.duration;
    const { beatGrid, downbeats } = generateBeatGrid(
        onsetStrength,
        onsetRate,
        beatInterval,
        totalDuration,
    );

    return { bpm, confidence, beatGrid, downbeats };
}

/**
 * Generate a beat grid aligned to detected onsets.
 * Finds the best phase offset for the beat grid by testing
 * multiple starting positions and selecting the one that
 * aligns best with onset peaks.
 */
function generateBeatGrid(
    onsetStrength: Float32Array,
    onsetRate: number,
    beatInterval: number,
    totalDuration: number
): { beatGrid: number[]; downbeats: number[] } {
    const beatIntervalSamples = beatInterval * onsetRate;

    // Try different phase offsets, pick best alignment
    let bestScore = -Infinity;
    let bestOffset = 0;
    const testOffsets = 16;

    for (let t = 0; t < testOffsets; t++) {
        const offset = (t / testOffsets) * beatIntervalSamples;
        let score = 0;
        let pos = offset;
        while (pos < onsetStrength.length) {
            const idx = Math.round(pos);
            if (idx >= 0 && idx < onsetStrength.length) {
                score += onsetStrength[idx];
            }
            pos += beatIntervalSamples;
        }
        if (score > bestScore) {
            bestScore = score;
            bestOffset = offset;
        }
    }

    // Generate beat grid with best offset
    const beatGrid: number[] = [];
    const downbeats: number[] = [];
    let pos = bestOffset / onsetRate; // Convert to seconds
    let beatCount = 0;

    while (pos < totalDuration) {
        beatGrid.push(Math.round(pos * 1000) / 1000);
        if (beatCount % 4 === 0) {
            downbeats.push(Math.round(pos * 1000) / 1000);
        }
        pos += beatInterval;
        beatCount++;
    }

    return { beatGrid, downbeats };
}
