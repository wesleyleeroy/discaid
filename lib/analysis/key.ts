/**
 * Musical Key Detection using Chroma Feature Analysis.
 *
 * Algorithm:
 * 1. Compute FFT on overlapping windows
 * 2. Map FFT bins to 12 pitch classes (chroma features)
 * 3. Aggregate chroma across frames
 * 4. Correlate with Krumhansl-Kessler key profiles for all 24 keys
 * 5. Return the best-matching key with confidence score
 *
 * DSP Note: Chroma features represent the distribution of energy across
 * the 12 pitch classes (C, C#, D, ..., B), folding all octaves together.
 * The Krumhansl-Kessler profiles are empirically derived distributions
 * that characterize major and minor keys.
 */

import { MusicalKey } from '@/types/track';
import { NOTE_NAMES, FFT_SIZE } from '@/lib/utils/constants';
import { getCamelotCode } from '@/lib/utils/camelot';

// Krumhansl-Kessler key profiles (empirically derived)
// Represents expected pitch class distribution for each mode
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

interface KeyResult {
    key: MusicalKey;
    confidence: number;
}

/**
 * Detect the musical key of an AudioBuffer.
 */
export function detectKey(audioBuffer: AudioBuffer): KeyResult {
    const sampleRate = audioBuffer.sampleRate;
    const fftSize = FFT_SIZE;
    const hopSize = fftSize / 2;

    // Get mono audio data (analyze middle portion for more stable tonal content)
    const startSample = Math.floor(audioBuffer.length * 0.1);
    const endSample = Math.floor(audioBuffer.length * 0.9);
    const length = endSample - startSample;
    const channelData = new Float32Array(length);
    audioBuffer.copyFromChannel(channelData, 0, startSample);

    if (audioBuffer.numberOfChannels > 1) {
        const right = new Float32Array(length);
        audioBuffer.copyFromChannel(right, 1, startSample);
        for (let i = 0; i < length; i++) {
            channelData[i] = (channelData[i] + right[i]) * 0.5;
        }
    }

    // Compute chroma features via FFT
    const numFrames = Math.floor((length - fftSize) / hopSize);
    const chroma = new Float64Array(12); // Accumulated chroma

    // Pre-compute Hann window
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    for (let frame = 0; frame < numFrames; frame++) {
        const offset = frame * hopSize;

        // Apply window and prepare for FFT
        const windowed = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            windowed[i] = channelData[offset + i] * window[i];
        }

        // Compute magnitude spectrum using a simple DFT for the bins we need
        // (Full FFT would be faster but this is sufficient for key detection)
        const magnitudes = computeMagnitudeSpectrum(windowed, fftSize);

        // Map FFT bins to chroma
        mapToChroma(magnitudes, sampleRate, fftSize, chroma);
    }

    // Normalize chroma
    let chromaMax = 0;
    for (let i = 0; i < 12; i++) {
        if (chroma[i] > chromaMax) chromaMax = chroma[i];
    }
    if (chromaMax > 0) {
        for (let i = 0; i < 12; i++) {
            chroma[i] /= chromaMax;
        }
    }

    // Correlate with all 24 key profiles
    let bestCorrelation = -Infinity;
    let bestRoot = 0;
    let bestMode: 'major' | 'minor' = 'major';

    for (let root = 0; root < 12; root++) {
        // Rotate chroma to align with current root
        const rotated = new Float64Array(12);
        for (let i = 0; i < 12; i++) {
            rotated[i] = chroma[(i + root) % 12];
        }

        // Correlate with major profile
        const majorCorr = pearsonCorrelation(rotated, MAJOR_PROFILE);
        if (majorCorr > bestCorrelation) {
            bestCorrelation = majorCorr;
            bestRoot = root;
            bestMode = 'major';
        }

        // Correlate with minor profile
        const minorCorr = pearsonCorrelation(rotated, MINOR_PROFILE);
        if (minorCorr > bestCorrelation) {
            bestCorrelation = minorCorr;
            bestRoot = root;
            bestMode = 'minor';
        }
    }

    const rootName = NOTE_NAMES[bestRoot];
    const confidence = Math.max(0, Math.min(1, (bestCorrelation + 1) / 2));
    const camelotCode = getCamelotCode(rootName, bestMode);

    return {
        key: { root: rootName, mode: bestMode, camelotCode },
        confidence,
    };
}

/**
 * Compute magnitude spectrum using a simplified DFT.
 * For key detection, we only need the lower frequency bins (up to ~5kHz),
 * so we can skip higher bins for performance.
 */
function computeMagnitudeSpectrum(signal: Float32Array, fftSize: number): Float32Array {
    const halfSize = fftSize / 2;
    const magnitudes = new Float32Array(halfSize);

    // Use only bins up to ~5kHz for pitch content
    const maxBin = Math.min(halfSize, Math.floor(5000 * fftSize / 44100));

    for (let k = 1; k < maxBin; k++) {
        let real = 0;
        let imag = 0;
        const freqFactor = (2 * Math.PI * k) / fftSize;
        for (let n = 0; n < fftSize; n++) {
            const angle = freqFactor * n;
            real += signal[n] * Math.cos(angle);
            imag -= signal[n] * Math.sin(angle);
        }
        magnitudes[k] = Math.sqrt(real * real + imag * imag);
    }

    return magnitudes;
}

/**
 * Map FFT magnitude bins to 12-note chroma.
 * Each bin frequency is mapped to its nearest pitch class.
 */
function mapToChroma(
    magnitudes: Float32Array,
    sampleRate: number,
    fftSize: number,
    chroma: Float64Array
): void {
    const binFreq = sampleRate / fftSize;

    // Start from A1 (55 Hz) to avoid sub-bass noise
    const startBin = Math.max(1, Math.floor(55 / binFreq));
    // End around C7 (~2093 Hz) — main harmonic content for key detection
    const endBin = Math.min(magnitudes.length, Math.floor(4200 / binFreq));

    for (let bin = startBin; bin < endBin; bin++) {
        const freq = bin * binFreq;
        if (freq <= 0) continue;

        // Convert frequency to pitch class (0 = C, 1 = C#, etc.)
        // MIDI note number: 69 + 12 * log2(freq / 440)
        const midiNote = 69 + 12 * Math.log2(freq / 440);
        const pitchClass = ((Math.round(midiNote) % 12) + 12) % 12;

        // Weight by magnitude squared (power spectrum)
        chroma[pitchClass] += magnitudes[bin] * magnitudes[bin];
    }
}

/**
 * Pearson correlation coefficient between two arrays.
 * Returns value between -1 and 1.
 */
function pearsonCorrelation(a: Float64Array, b: readonly number[]): number {
    const n = a.length;
    let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;

    for (let i = 0; i < n; i++) {
        sumA += a[i];
        sumB += b[i];
        sumAB += a[i] * b[i];
        sumA2 += a[i] * a[i];
        sumB2 += b[i] * b[i];
    }

    const numerator = n * sumAB - sumA * sumB;
    const denominator = Math.sqrt(
        (n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB)
    );

    return denominator === 0 ? 0 : numerator / denominator;
}
