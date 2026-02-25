/**
 * Main Audio Analyzer.
 * Orchestrates all analysis sub-modules and produces a complete TrackAnalysis.
 *
 * Runs BPM detection, key detection, and energy analysis in sequence,
 * then combines results into a unified analysis object.
 */

import { TrackAnalysis } from '@/types/track';
import { detectBPM } from './bpm';
import { detectKey } from './key';
import { analyzeEnergy } from './energy';

export interface AnalysisProgress {
    stage: 'decoding' | 'bpm' | 'key' | 'energy' | 'complete' | 'error';
    progress: number; // 0-1
    message: string;
}

type ProgressCallback = (progress: AnalysisProgress) => void;

/**
 * Perform complete audio analysis on an AudioBuffer.
 * Returns a full TrackAnalysis object.
 */
export async function analyzeTrack(
    audioBuffer: AudioBuffer,
    onProgress?: ProgressCallback
): Promise<TrackAnalysis> {
    const report = (stage: AnalysisProgress['stage'], progress: number, message: string) => {
        onProgress?.({ stage, progress, message });
    };

    try {
        // ─── BPM Detection ───────────────────────────────────────
        report('bpm', 0.1, 'Detecting tempo and beat grid...');
        const bpmResult = detectBPM(audioBuffer);
        report('bpm', 0.4, `Tempo detected: ${bpmResult.bpm} BPM (${Math.round(bpmResult.confidence * 100)}% confidence)`);

        // ─── Key Detection ───────────────────────────────────────
        report('key', 0.5, 'Analyzing musical key...');
        const keyResult = detectKey(audioBuffer);
        report('key', 0.7, `Key detected: ${keyResult.key.root} ${keyResult.key.mode} (${keyResult.key.camelotCode})`);

        // ─── Energy Analysis ─────────────────────────────────────
        report('energy', 0.75, 'Analyzing energy and structure...');
        const energyResult = analyzeEnergy(audioBuffer);
        report('energy', 0.95, `Energy: ${Math.round(energyResult.energy * 100)}%, Loudness: ${energyResult.loudnessDb} dB`);

        // ─── Combine Results ─────────────────────────────────────
        const analysis: TrackAnalysis = {
            bpm: bpmResult.bpm,
            bpmConfidence: bpmResult.confidence,
            key: keyResult.key,
            keyConfidence: keyResult.confidence,
            energy: energyResult.energy,
            loudnessDb: energyResult.loudnessDb,
            peakDb: energyResult.peakDb,
            durationSeconds: audioBuffer.duration,
            beatGrid: bpmResult.beatGrid,
            downbeats: bpmResult.downbeats,
            sections: energyResult.sections,
            introEnd: energyResult.introEnd,
            outroStart: energyResult.outroStart,
            vocalRegions: energyResult.vocalRegions,
            analyzedAt: Date.now(),
        };

        report('complete', 1.0, 'Analysis complete');
        return analysis;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown analysis error';
        report('error', 0, `Analysis failed: ${message}`);
        throw new Error(`Track analysis failed: ${message}`);
    }
}

/**
 * Create a safe fallback analysis when full analysis fails.
 * Uses defaults that will produce a safe (if non-optimal) crossfade.
 */
export function createFallbackAnalysis(audioBuffer: AudioBuffer): TrackAnalysis {
    const duration = audioBuffer.duration;
    return {
        bpm: 120,
        bpmConfidence: 0,
        key: { root: 'C', mode: 'major', camelotCode: '8B' },
        keyConfidence: 0,
        energy: 0.5,
        loudnessDb: -14,
        peakDb: -1,
        durationSeconds: duration,
        beatGrid: [],
        downbeats: [],
        sections: [{
            type: 'unknown',
            startTime: 0,
            endTime: duration,
            energy: 0.5,
        }],
        introEnd: Math.min(8, duration * 0.1),
        outroStart: Math.max(duration - 16, duration * 0.85),
        vocalRegions: [],
        analyzedAt: Date.now(),
    };
}
