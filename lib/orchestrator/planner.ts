/**
 * Transition Planner — Autonomous DJ brain.
 *
 * Scores all candidate transition strategies based on the musical
 * compatibility of two tracks and selects the best one. Computes
 * the optimal transition point and overlap duration.
 */

import { v4 as uuidv4 } from 'uuid';
import { TrackAnalysis } from '@/types/track';
import {
    TransitionPlan,
    TransitionContext,
    TransitionCandidate,
} from '@/types/transition';
import { strategies, crossfadeStrategy } from '@/lib/audio/transitions';
import { getKeyCompatibility } from '@/lib/utils/camelot';
import {
    DEFAULT_OVERLAP_DURATION,
    MIN_OVERLAP_DURATION,
    MAX_OVERLAP_DURATION,
    TEMPO_STRETCH_MAX_PERCENT,
} from '@/lib/utils/constants';

export interface PlanResult {
    plan: TransitionPlan;
    insights: string[];
}

/**
 * Plan a transition between two tracks.
 * Scores all strategies and selects the best one.
 */
export function planTransition(
    outgoingAnalysis: TrackAnalysis,
    incomingAnalysis: TrackAnalysis,
    outgoingTrackId: string,
    incomingTrackId: string
): PlanResult {
    const insights: string[] = [];

    // ─── Build context for strategy scoring ──────────────────
    const bpmDiff = Math.abs(outgoingAnalysis.bpm - incomingAnalysis.bpm);
    const bpmDifference = (bpmDiff / outgoingAnalysis.bpm) * 100;
    const keyCompatibility = getKeyCompatibility(
        outgoingAnalysis.key.root,
        outgoingAnalysis.key.mode,
        incomingAnalysis.key.root,
        incomingAnalysis.key.mode
    );
    const energyDifference = Math.abs(outgoingAnalysis.energy - incomingAnalysis.energy);

    // Check for vocal clash risk
    const hasVocalsInOutro = outgoingAnalysis.vocalRegions.some(
        v => v.endTime > outgoingAnalysis.outroStart
    );
    const hasVocalsInIntro = incomingAnalysis.vocalRegions.some(
        v => v.startTime < incomingAnalysis.introEnd
    );

    const context: TransitionContext = {
        outgoing: {
            bpm: outgoingAnalysis.bpm,
            key: outgoingAnalysis.key,
            energy: outgoingAnalysis.energy,
            loudnessDb: outgoingAnalysis.loudnessDb,
            outroStart: outgoingAnalysis.outroStart,
            duration: outgoingAnalysis.durationSeconds,
            hasVocalsInOutro,
            beatGrid: outgoingAnalysis.beatGrid,
        },
        incoming: {
            bpm: incomingAnalysis.bpm,
            key: incomingAnalysis.key,
            energy: incomingAnalysis.energy,
            loudnessDb: incomingAnalysis.loudnessDb,
            introEnd: incomingAnalysis.introEnd,
            duration: incomingAnalysis.durationSeconds,
            hasVocalsInIntro,
            beatGrid: incomingAnalysis.beatGrid,
        },
        bpmDifference,
        keyCompatibility,
        energyDifference,
    };

    // ─── Score all strategies ────────────────────────────────
    const candidates: TransitionCandidate[] = strategies.map(s => s.score(context));

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    insights.push(`Analyzed ${candidates.length} transition strategies`);
    insights.push(
        `BPM: ${outgoingAnalysis.bpm} → ${incomingAnalysis.bpm} (${bpmDifference.toFixed(1)}% diff)`
    );
    insights.push(
        `Key: ${outgoingAnalysis.key.camelotCode} → ${incomingAnalysis.key.camelotCode} ` +
        `(${(keyCompatibility * 100).toFixed(0)}% compatible)`
    );
    insights.push(
        `Energy: ${(outgoingAnalysis.energy * 100).toFixed(0)}% → ${(incomingAnalysis.energy * 100).toFixed(0)}%`
    );

    if (hasVocalsInOutro && hasVocalsInIntro) {
        insights.push('⚠️ Vocal clash risk detected in overlap zone');
    }

    // ─── Select best strategy ─────────────────────────────────
    const bestCandidate = candidates[0];
    const strategy = strategies.find(s => s.type === bestCandidate.strategy) ?? crossfadeStrategy;

    insights.push(
        `Selected: ${strategy.name} (score: ${bestCandidate.score}/100) — ${bestCandidate.reasoning}`
    );

    // ─── Compute transition point and overlap ─────────────────
    const overlapDuration = computeOverlapDuration(outgoingAnalysis, incomingAnalysis, context);
    const transitionStartTime = computeTransitionPoint(outgoingAnalysis, overlapDuration);

    insights.push(
        `Transition at ${transitionStartTime.toFixed(1)}s, overlap: ${overlapDuration.toFixed(1)}s`
    );

    // ─── Compute BPM adjustment ────────────────────────────────
    const bpmAdjustment = computeBPMAdjustment(outgoingAnalysis.bpm, incomingAnalysis.bpm);
    if (Math.abs(bpmAdjustment) > 0.5) {
        insights.push(
            `Tempo adjust: ${bpmAdjustment > 0 ? '+' : ''}${bpmAdjustment.toFixed(1)}% on incoming track`
        );
    }

    // ─── Generate automation envelopes ─────────────────────────
    const envelopes = strategy.generateEnvelopes(context, overlapDuration);

    const plan: TransitionPlan = {
        id: uuidv4(),
        strategy: bestCandidate.strategy,
        score: bestCandidate.score,
        reasoning: bestCandidate.reasoning,
        outgoingTrackId,
        incomingTrackId,
        transitionStartTime,
        overlapDuration,
        envelopes,
        bpmAdjustment,
        createdAt: Date.now(),
        candidates,
    };

    return { plan, insights };
}

/**
 * Compute the optimal overlap duration based on track characteristics.
 */
function computeOverlapDuration(
    outgoing: TrackAnalysis,
    incoming: TrackAnalysis,
    context: TransitionContext
): number {
    let duration = DEFAULT_OVERLAP_DURATION;

    // Shorter overlap for high BPM difference
    if (context.bpmDifference > 5) {
        duration = Math.max(MIN_OVERLAP_DURATION, duration * 0.5);
    }

    // Shorter overlap for key clash
    if (context.keyCompatibility < 0.3) {
        duration = Math.max(MIN_OVERLAP_DURATION, duration * 0.6);
    }

    // Longer overlap for matching tracks
    if (context.bpmDifference < 2 && context.keyCompatibility > 0.8) {
        duration = Math.min(MAX_OVERLAP_DURATION, duration * 1.3);
    }

    // Don't exceed the shorter track's available time
    const maxFromOutro = outgoing.durationSeconds - outgoing.outroStart;
    const maxFromIntro = incoming.introEnd || incoming.durationSeconds * 0.15;
    const maxPossible = Math.min(maxFromOutro, maxFromIntro, outgoing.durationSeconds * 0.3);

    duration = Math.min(duration, Math.max(MIN_OVERLAP_DURATION, maxPossible));

    // Quantize to nearest 4 bars if beatgrid available
    if (outgoing.beatGrid.length > 8) {
        const barDuration = (60 / outgoing.bpm) * 4; // 4 beats per bar
        const bars = Math.round(duration / barDuration);
        duration = Math.max(1, bars) * barDuration;
    }

    return Math.round(duration * 10) / 10;
}

/**
 * Compute the point in the outgoing track where transition should begin.
 * Prefers the outro start; falls back to a safe buffer before track end.
 */
function computeTransitionPoint(analysis: TrackAnalysis, overlapDuration: number): number {
    // Primary: start transition at the outro
    if (analysis.outroStart > 0 && analysis.outroStart < analysis.durationSeconds) {
        return analysis.outroStart;
    }

    // Fallback: start overlap duration before the end
    return Math.max(0, analysis.durationSeconds - overlapDuration - 2);
}

/**
 * Compute the BPM adjustment percentage for the incoming track.
 * Respects the ±6% safety bounds for time-stretching.
 */
function computeBPMAdjustment(outgoingBPM: number, incomingBPM: number): number {
    const diff = ((outgoingBPM - incomingBPM) / incomingBPM) * 100;

    // Within safety bounds?
    if (Math.abs(diff) <= TEMPO_STRETCH_MAX_PERCENT) {
        return Math.round(diff * 10) / 10;
    }

    // Too large a difference — don't adjust (let crossfade handle it)
    return 0;
}
