/**
 * Energy & Loudness Analysis.
 *
 * Computes:
 * - Overall RMS energy (0-1 normalized)
 * - Estimated loudness in dB (pseudo-LUFS)
 * - Peak level in dB
 * - Section-level energy mapping for intro/outro detection
 * - Basic vocal activity estimation using spectral centroid variance
 */

import { TrackSection, VocalActivity } from '@/types/track';

interface EnergyResult {
    energy: number;           // 0-1 overall energy
    loudnessDb: number;       // estimated loudness in dB
    peakDb: number;           // peak level in dB
    sections: TrackSection[];
    introEnd: number;         // seconds
    outroStart: number;       // seconds
    vocalRegions: VocalActivity[];
}

/**
 * Analyze energy characteristics of an AudioBuffer.
 */
export function analyzeEnergy(audioBuffer: AudioBuffer): EnergyResult {
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;

    // Get mono data
    const data = new Float32Array(length);
    audioBuffer.copyFromChannel(data, 0, 0);
    if (audioBuffer.numberOfChannels > 1) {
        const right = new Float32Array(length);
        audioBuffer.copyFromChannel(right, 1, 0);
        for (let i = 0; i < length; i++) {
            data[i] = (data[i] + right[i]) * 0.5;
        }
    }

    // ─── Peak Level ──────────────────────────────────────────
    let peak = 0;
    for (let i = 0; i < length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
    }
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -100;

    // ─── Overall RMS / Energy ────────────────────────────────
    let sumSquares = 0;
    for (let i = 0; i < length; i++) {
        sumSquares += data[i] * data[i];
    }
    const rms = Math.sqrt(sumSquares / length);
    const loudnessDb = rms > 0 ? 20 * Math.log10(rms) : -100;

    // Normalize energy to 0-1 range (assuming -40dB to 0dB range)
    const energy = Math.max(0, Math.min(1, (loudnessDb + 40) / 40));

    // ─── Section Energy Analysis ─────────────────────────────
    // Divide track into ~2-second windows for energy profiling
    const windowDuration = 2; // seconds
    const windowSamples = Math.floor(sampleRate * windowDuration);
    const numWindows = Math.floor(length / windowSamples);
    const windowEnergies: number[] = [];

    for (let w = 0; w < numWindows; w++) {
        let wSum = 0;
        const start = w * windowSamples;
        for (let i = 0; i < windowSamples; i++) {
            const s = data[start + i];
            wSum += s * s;
        }
        const wRms = Math.sqrt(wSum / windowSamples);
        windowEnergies.push(wRms);
    }

    // Normalize window energies
    const maxWindowEnergy = Math.max(...windowEnergies, 0.0001);
    const normalizedEnergies = windowEnergies.map(e => e / maxWindowEnergy);

    // ─── Detect Intro and Outro ──────────────────────────────
    const energyThreshold = 0.3;
    const introEnd = findIntroEnd(normalizedEnergies, windowDuration, energyThreshold);
    const outroStart = findOutroStart(normalizedEnergies, windowDuration, energyThreshold, audioBuffer.duration);

    // ─── Section Segmentation ────────────────────────────────
    const sections = segmentSections(normalizedEnergies, windowDuration, audioBuffer.duration);

    // ─── Basic Vocal Activity Estimation ─────────────────────
    const vocalRegions = estimateVocalActivity(data, sampleRate, audioBuffer.duration);

    return {
        energy,
        loudnessDb: Math.round(loudnessDb * 10) / 10,
        peakDb: Math.round(peakDb * 10) / 10,
        sections,
        introEnd,
        outroStart,
        vocalRegions,
    };
}

/**
 * Find where the intro ends (first sustained high-energy region).
 */
function findIntroEnd(
    energies: number[],
    windowDuration: number,
    threshold: number
): number {
    let consecutiveHigh = 0;
    for (let i = 0; i < energies.length; i++) {
        if (energies[i] >= threshold) {
            consecutiveHigh++;
            if (consecutiveHigh >= 3) { // 3 consecutive windows above threshold
                return Math.max(0, (i - 2)) * windowDuration;
            }
        } else {
            consecutiveHigh = 0;
        }
    }
    return 0; // No clear intro
}

/**
 * Find where the outro starts (last sustained high-energy region).
 */
function findOutroStart(
    energies: number[],
    windowDuration: number,
    threshold: number,
    totalDuration: number
): number {
    let consecutiveHigh = 0;
    for (let i = energies.length - 1; i >= 0; i--) {
        if (energies[i] >= threshold) {
            consecutiveHigh++;
            if (consecutiveHigh >= 3) {
                return Math.min(totalDuration, (i + 3) * windowDuration);
            }
        } else {
            consecutiveHigh = 0;
        }
    }
    return totalDuration * 0.85; // Default: last 15%
}

/**
 * Segment tracks into sections based on energy level changes.
 */
function segmentSections(
    energies: number[],
    windowDuration: number,
    totalDuration: number
): TrackSection[] {
    if (energies.length === 0) {
        return [{
            type: 'unknown',
            startTime: 0,
            endTime: totalDuration,
            energy: 0.5,
        }];
    }

    const sections: TrackSection[] = [];
    let currentLevel: 'low' | 'mid' | 'high' = categorizeEnergy(energies[0]);
    let sectionStart = 0;
    let sectionEnergySum = energies[0];
    let sectionCount = 1;

    for (let i = 1; i < energies.length; i++) {
        const level = categorizeEnergy(energies[i]);

        if (level !== currentLevel) {
            // End current section, start new one
            const avgEnergy = sectionEnergySum / sectionCount;
            sections.push({
                type: inferSectionType(currentLevel, sectionStart, i * windowDuration, totalDuration),
                startTime: sectionStart,
                endTime: i * windowDuration,
                energy: avgEnergy,
            });

            currentLevel = level;
            sectionStart = i * windowDuration;
            sectionEnergySum = energies[i];
            sectionCount = 1;
        } else {
            sectionEnergySum += energies[i];
            sectionCount++;
        }
    }

    // Final section
    const avgEnergy = sectionEnergySum / sectionCount;
    sections.push({
        type: inferSectionType(currentLevel, sectionStart, totalDuration, totalDuration),
        startTime: sectionStart,
        endTime: totalDuration,
        energy: avgEnergy,
    });

    return sections;
}

function categorizeEnergy(energy: number): 'low' | 'mid' | 'high' {
    if (energy < 0.3) return 'low';
    if (energy < 0.7) return 'mid';
    return 'high';
}

function inferSectionType(
    level: 'low' | 'mid' | 'high',
    start: number,
    end: number,
    totalDuration: number
): TrackSection['type'] {
    const relativeStart = start / totalDuration;
    const relativeEnd = end / totalDuration;

    if (relativeStart < 0.05 && level === 'low') return 'intro';
    if (relativeEnd > 0.9 && level === 'low') return 'outro';
    if (level === 'high') return 'chorus';
    if (level === 'low') return 'breakdown';
    if (level === 'mid') return 'verse';
    return 'unknown';
}

/**
 * Estimate vocal activity using spectral centroid analysis.
 * Vocal frequencies typically center around 300-3400 Hz.
 * High spectral centroid variance in this range suggests vocal presence.
 *
 * This is a rough heuristic — proper vocal detection would use ML models.
 */
function estimateVocalActivity(
    data: Float32Array,
    sampleRate: number,
    totalDuration: number
): VocalActivity[] {
    const windowSize = Math.floor(sampleRate * 0.5); // 500ms windows
    const hopSize = Math.floor(windowSize / 2);
    const numWindows = Math.floor((data.length - windowSize) / hopSize);
    const regions: VocalActivity[] = [];

    // Compute spectral energy ratio in vocal range for each window
    const vocalScores: number[] = [];
    const fftSize = 1024;

    for (let w = 0; w < numWindows; w++) {
        const start = w * hopSize;
        let totalEnergy = 0;
        let vocalEnergy = 0;

        // Simple power computation in frequency bands
        // Vocal band: 300-3400 Hz
        const vocalLowBin = Math.floor(300 * fftSize / sampleRate);
        const vocalHighBin = Math.floor(3400 * fftSize / sampleRate);

        // Quick energy estimate using zero-crossing rate as proxy
        // High ZCR in vocal range suggests speech/singing
        let zcr = 0;
        for (let i = 1; i < Math.min(windowSize, fftSize); i++) {
            if ((data[start + i] >= 0) !== (data[start + i - 1] >= 0)) {
                zcr++;
            }
            totalEnergy += data[start + i] * data[start + i];
        }

        // Normalize ZCR
        const normalizedZcr = zcr / fftSize;

        // Vocal heuristic: moderate ZCR (not too high = noise, not too low = bass)
        const isVocalLike = normalizedZcr > 0.05 && normalizedZcr < 0.3 && totalEnergy > 0.001;
        vocalScores.push(isVocalLike ? 0.7 : 0.2);
    }

    // Group consecutive vocal-like windows into regions
    let inVocal = false;
    let regionStart = 0;

    for (let i = 0; i < vocalScores.length; i++) {
        const time = (i * hopSize) / sampleRate;
        if (vocalScores[i] > 0.5 && !inVocal) {
            inVocal = true;
            regionStart = time;
        } else if (vocalScores[i] <= 0.5 && inVocal) {
            inVocal = false;
            if (time - regionStart > 1.0) { // Only keep regions > 1 second
                regions.push({
                    startTime: regionStart,
                    endTime: time,
                    confidence: 0.6, // Moderate confidence for heuristic method
                });
            }
        }
    }

    // Close any open region
    if (inVocal) {
        regions.push({
            startTime: regionStart,
            endTime: totalDuration,
            confidence: 0.5,
        });
    }

    return regions;
}
