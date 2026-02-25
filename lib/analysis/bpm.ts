/**
 * BPM Detection using Autocorrelation.
 *
 * Algorithm:
 * 1. Compute onset strength envelope from energy differences
 * 2. Apply autocorrelation to find periodic patterns
 * 3. Map peak lag positions to BPM values
 * 4. Score confidence based on peak prominence
 *
 * DSP Note: We use half-wave rectified spectral flux for onset detection,
 * which captures transient energy increases (attacks/onsets) while ignoring
 * energy decreases (decays). The autocorrelation of this signal reveals
 * the dominant periodicity, which corresponds to the tempo.
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

    // Step 1: Compute onset strength envelope
    // Use short energy windows and half-wave rectify the difference
    const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
    const hopSize = Math.floor(windowSize / 2);        // 50% overlap
    const numWindows = Math.floor((maxSamples - windowSize) / hopSize);

    const energy = new Float32Array(numWindows);
    for (let i = 0; i < numWindows; i++) {
        let sum = 0;
        const start = i * hopSize;
        for (let j = 0; j < windowSize; j++) {
            const s = channelData[start + j];
            sum += s * s;
        }
        energy[i] = Math.sqrt(sum / windowSize); // RMS per window
    }

    // Half-wave rectified first difference (onset strength)
    const onsetStrength = new Float32Array(numWindows - 1);
    for (let i = 1; i < numWindows; i++) {
        onsetStrength[i - 1] = Math.max(0, energy[i] - energy[i - 1]);
    }

    // Step 2: Autocorrelation in BPM range
    const onsetRate = sampleRate / hopSize; // onsets per second
    const minLag = Math.floor((onsetRate * 60) / BPM_MAX);
    const maxLag = Math.floor((onsetRate * 60) / BPM_MIN);
    const lagRange = maxLag - minLag + 1;

    const autocorrelation = new Float32Array(lagRange);
    const n = onsetStrength.length;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        const count = n - lag;
        for (let i = 0; i < count; i++) {
            sum += onsetStrength[i] * onsetStrength[i + lag];
        }
        autocorrelation[lag - minLag] = sum / count;
    }

    // Step 3: Find peaks in autocorrelation
    // Apply perceptual weighting to prefer common tempos (90-150 BPM range)
    const weighted = new Float32Array(lagRange);
    for (let i = 0; i < lagRange; i++) {
        const lag = i + minLag;
        const bpm = (onsetRate * 60) / lag;
        // Gaussian weighting centered at 120 BPM, sigma = 30
        const weight = Math.exp(-0.5 * Math.pow((bpm - 120) / 30, 2));
        weighted[i] = autocorrelation[i] * (0.5 + 0.5 * weight);
    }

    // Find the top peak
    let maxVal = -Infinity;
    let maxIdx = 0;
    for (let i = 0; i < lagRange; i++) {
        if (weighted[i] > maxVal) {
            maxVal = weighted[i];
            maxIdx = i;
        }
    }

    const bestLag = maxIdx + minLag;
    let bpm = (onsetRate * 60) / bestLag;

    // Step 4: Confidence from peak-to-mean ratio
    let mean = 0;
    for (let i = 0; i < lagRange; i++) {
        mean += autocorrelation[i];
    }
    mean /= lagRange;

    const rawConfidence = mean > 0 ? autocorrelation[maxIdx] / (mean * 2.5) : 0;
    const confidence = Math.min(1, Math.max(0, rawConfidence));

    // Round BPM to nearest 0.1
    bpm = Math.round(bpm * 10) / 10;

    // Ensure BPM is in a standard range (double/halve if needed)
    if (bpm < BPM_MIN) bpm *= 2;
    if (bpm > BPM_MAX) bpm /= 2;

    // Step 5: Generate beat grid from detected BPM
    const beatInterval = 60 / bpm; // seconds per beat
    const totalDuration = audioBuffer.duration;
    const { beatGrid, downbeats } = generateBeatGrid(
        onsetStrength,
        onsetRate,
        beatInterval,
        totalDuration
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
