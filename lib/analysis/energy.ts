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
    effectiveEnd: number;     // seconds - where music actually ends (before fade/silence)
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
    const effectiveEnd = findEffectiveEnd(data, sampleRate, audioBuffer.duration, outroStart);

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
        effectiveEnd,
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
 * Find where the outro starts — the point where the song begins dying off.
 *
 * Uses multiple strategies to detect the "death point":
 * 1. Energy percentile drop: finds where energy falls below the track's
 *    own energy median and stays there — catches fade-outs.
 * 2. Gradient-based fade detection: finds sustained downward energy slope —
 *    catches gradual fade-outs and trail-offs.
 * 3. Silence/near-silence detection: finds where the track becomes very quiet.
 *
 * Returns the earliest credible point so the DJ can transition cleanly
 * before the song gets boring or quiet.
 */
function findOutroStart(
    energies: number[],
    windowDuration: number,
    _threshold: number,
    totalDuration: number
): number {
    if (energies.length < 6) return totalDuration * 0.8;

    // Only look in the back 40% of the track (outro won't be in the first half)
    const searchStart = Math.floor(energies.length * 0.6);
    const candidates: number[] = [];

    // ─── Strategy 1: Energy drops below track's own median ───────
    // Compute median energy of the "body" (middle 60%) of the track
    const bodyStart = Math.floor(energies.length * 0.15);
    const bodyEnd = Math.floor(energies.length * 0.75);
    const bodyEnergies = energies.slice(bodyStart, bodyEnd).sort((a, b) => a - b);
    const medianEnergy = bodyEnergies[Math.floor(bodyEnergies.length / 2)] || 0.5;
    const dropThreshold = medianEnergy * 0.4; // 40% of median = significant drop

    let consecutiveLow = 0;
    for (let i = searchStart; i < energies.length; i++) {
        if (energies[i] < dropThreshold) {
            consecutiveLow++;
            if (consecutiveLow >= 2) {
                // Mark the point where the drop started
                candidates.push((i - consecutiveLow + 1) * windowDuration);
                break;
            }
        } else {
            consecutiveLow = 0;
        }
    }

    // ─── Strategy 2: Gradient-based fade detection ───────────────
    // Look for sustained downward energy slope (3+ windows of declining energy)
    let fadeStart = -1;
    let fadeLength = 0;
    for (let i = searchStart + 1; i < energies.length; i++) {
        const gradient = energies[i] - energies[i - 1];
        if (gradient < -0.02) { // Declining
            if (fadeStart === -1) fadeStart = i - 1;
            fadeLength++;
            if (fadeLength >= 3) {
                candidates.push(fadeStart * windowDuration);
                break;
            }
        } else {
            fadeStart = -1;
            fadeLength = 0;
        }
    }

    // ─── Strategy 3: Near-silence detection ──────────────────────
    // Find the first point in the tail where energy drops below 10%
    for (let i = searchStart; i < energies.length; i++) {
        if (energies[i] < 0.1) {
            // Check if subsequent windows are also quiet (not just a brief dip)
            const nextFew = energies.slice(i, Math.min(i + 3, energies.length));
            const allQuiet = nextFew.every(e => e < 0.15);
            if (allQuiet) {
                candidates.push(i * windowDuration);
                break;
            }
        }
    }

    // ─── Strategy 4: Last high-energy point (original approach) ──
    let lastHigh = -1;
    for (let i = energies.length - 1; i >= searchStart; i--) {
        if (energies[i] >= 0.3) {
            lastHigh = i;
            break;
        }
    }
    if (lastHigh >= 0) {
        // Outro starts right after the last high-energy window
        candidates.push(Math.min(totalDuration, (lastHigh + 1) * windowDuration));
    }

    // ─── Pick the earliest credible candidate ────────────────────
    // Filter out anything too early (before 60% of the track)
    const minOutro = totalDuration * 0.6;
    const maxOutro = totalDuration * 0.95;
    const validCandidates = candidates.filter(t => t >= minOutro && t <= maxOutro);

    if (validCandidates.length > 0) {
        return Math.min(...validCandidates);
    }

    // Default fallback: last 20% of the track
    return totalDuration * 0.8;
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

/**
 * Find the effective end of the track — where the actual music content stops.
 *
 * Scans backward from the end of the track to skip trailing silence,
 * ambient decay, and very quiet fade-out tails. Returns the point where
 * real music content effectively ends.
 *
 * This allows the DJ to stop the track cleanly rather than playing
 * through several seconds of near-silence or fading out.
 */
function findEffectiveEnd(
    data: Float32Array,
    sampleRate: number,
    totalDuration: number,
    outroStart: number
): number {
    // Analyze from the end backward using 250ms windows
    const windowDuration = 0.25;
    const windowSamples = Math.floor(sampleRate * windowDuration);

    // Threshold in linear amplitude: about -40dB
    const silenceThreshold = 0.01;
    // Threshold for "very quiet": about -30dB
    const quietThreshold = 0.03;

    // Start from the very end and scan backward
    let effectiveEnd = totalDuration;
    let consecutiveQuiet = 0;

    const numWindows = Math.floor(data.length / windowSamples);
    for (let w = numWindows - 1; w >= 0; w--) {
        const start = w * windowSamples;
        let wSum = 0;
        for (let i = 0; i < windowSamples && (start + i) < data.length; i++) {
            const s = data[start + i];
            wSum += s * s;
        }
        const wRms = Math.sqrt(wSum / windowSamples);

        if (wRms < silenceThreshold) {
            // True silence — skip entirely
            effectiveEnd = w * windowDuration;
            continue;
        }

        if (wRms < quietThreshold) {
            consecutiveQuiet++;
            // If we've had 2+ seconds of very quiet, that's a fade-out
            if (consecutiveQuiet >= 8) { // 8 * 0.25s = 2 seconds
                effectiveEnd = (w + 8) * windowDuration;
            }
            continue;
        }

        // Found real music content — this is our effective end
        // Add a small buffer (0.5s) for natural decay
        effectiveEnd = Math.min(totalDuration, (w + 1) * windowDuration + 0.5);
        break;
    }

    // Effective end should be at least at the outro start
    // (we don't want to cut the track before the outro even begins)
    effectiveEnd = Math.max(outroStart, effectiveEnd);

    // But shouldn't be more than 2 seconds beyond the end
    effectiveEnd = Math.min(totalDuration, effectiveEnd);

    return Math.round(effectiveEnd * 10) / 10;
}
