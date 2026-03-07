/**
 * Transition Strategy: Filter Sweep Build (Atmospheric)
 *
 * Uses frequency removal to create a "thinning" effect on the outgoing
 * track, making the incoming track feel more "full" and powerful when
 * it enters. The outgoing sounds like it's "receding into the distance."
 *
 * Phase 1 — HPF SWEEP (0–80%):
 *   Slowly engage a High-Pass Filter on the outgoing track.
 *   As the HPF frequency rises, the track loses its bass and
 *   mid-range, sounding increasingly thin and distant.
 *   Reverb wash builds to accentuate the "receding" effect.
 *
 * Phase 2 — HARD CUT + SLAM (80%):
 *   At the peak of the filter sweep, HARD CUT the outgoing track.
 *   Launch the incoming track with NO filters, 100% volume for
 *   an instant "full-frequency" impact. The contrast between the
 *   thin HPF'd outgoing and the full-range incoming creates an
 *   enormous perceived impact.
 *
 * Note: The outgoing deck's filter is set to 'highpass' mode by
 * the mixer before scheduling begins.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const filterSweepStrategy: TransitionStrategy = {
    type: 'filter-sweep',
    name: 'Filter Sweep Build',
    description: 'HPF sweep thins the outgoing track, then hard cut to full-frequency incoming',

    score(context: TransitionContext): TransitionCandidate {
        let score = 45;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // Works best with similar BPM
        if (context.bpmDifference < 3) {
            score += 20;
            reasons.push(`Close BPM match (${context.bpmDifference.toFixed(1)}% diff)`);
        } else if (context.bpmDifference < 6) {
            score += 10;
        } else {
            score -= 10;
            penalties.push('Large BPM difference reduces filter sweep effectiveness');
        }

        // Works well when incoming is high energy (maximizes the "slam" impact)
        if (context.incoming.energy > 0.6) {
            score += 15;
            reasons.push('High-energy incoming maximizes the full-frequency impact');
        }

        // Good for avoiding vocal clash
        if (context.outgoing.hasVocalsInOutro && context.incoming.hasVocalsInIntro) {
            score += 10;
            reasons.push('HPF separates overlapping vocals');
        }

        // Key compatibility bonus
        if (context.keyCompatibility > 0.7) {
            score += 5;
        }

        reasons.push('Atmospheric HPF sweep → hard cut to full frequency');

        return {
            strategy: 'filter-sweep',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(_context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const steps = 32;
        const envelopes: AutomationEnvelope[] = [];
        const cutPoint = 0.80; // Hard cut moment

        // ─── filterFreqA (outgoing HPF sweep: 20Hz → 4000Hz) ─────
        // Filter type is set to 'highpass' by the mixer
        const filterAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < cutPoint) {
                // HPF sweep up: 20Hz → 4000Hz (logarithmic)
                const sweepProgress = progress / cutPoint;
                value = 20 * Math.pow(4000 / 20, sweepProgress);
            } else {
                // After cut — doesn't matter, track is muted
                value = 20;
            }
            filterAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'filterFreqA', points: filterAPoints });

        // ─── gainA (outgoing — holds then HARD CUT) ──────────────
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Full until cut point, then instant kill
            const value = progress < cutPoint ? 1.0 : 0;
            gainAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── reverbSendA (outgoing reverb wash builds up) ────────
        const reverbAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < cutPoint) {
                // Build reverb as filter thins the track
                value = (progress / cutPoint) * 0.6;
            } else {
                value = 0; // Kill reverb at cut
            }
            reverbAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'reverbSendA', points: reverbAPoints });

        // ─── filterQA (resonance bump for dramatic sweep) ────────
        const filterQAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < cutPoint) {
                // Gentle resonance increase for "laser" character
                value = 1 + (progress / cutPoint) * 4;
            } else {
                value = 1;
            }
            filterQAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'filterQA', points: filterQAPoints });

        // ─── gainB (incoming — SLAM in at cut point) ─────────────
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < cutPoint - 0.05) {
                // Silent while outgoing is sweeping
                // (small pre-fade for smoothness)
                value = 0;
            } else if (progress < cutPoint) {
                // Tiny pre-fade so it's not completely abrupt
                value = ((progress - (cutPoint - 0.05)) / 0.05) * 0.15;
            } else {
                // FULL volume at cut — maximum impact
                value = 1.0;
            }
            gainBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        // ─── filterFreqB (incoming — wide open, clean) ───────────
        // No filter on incoming — full frequency spectrum for impact
        envelopes.push({
            parameter: 'filterFreqB',
            points: [
                { time: 0, value: 20000, curve: 'linear' },
                { time: overlapDuration, value: 20000, curve: 'linear' },
            ],
        });

        return envelopes;
    },
};
