/**
 * Transition Strategy: Loop-Roll Build (High Energy)
 *
 * Common in EDM and House, this simulates a shortening loop/stutter
 * effect that creates "rising" tension before slamming into the
 * next track's drop.
 *
 * Since true loop manipulation requires buffer slicing, we approximate
 * the loop-roll with:
 *   - Delay feedback increasing to create repetitive echoes
 *   - Delay time shortening (full beat → half → quarter → eighth)
 *   - Filter sweep narrowing to simulate the "rising" effect
 *   - Optionally, a phaser-like filter Q sweep for tension
 *
 * Phase 1 — DELAY ROLL BUILD (0–75%):
 *   Delay time progressively shortens while feedback increases.
 *   This creates the characteristic "build" effect where a hit
 *   repeats faster and faster. Filter sweeps upward for tension.
 *
 * Phase 2 — HARD CUT + DROP (75%):
 *   Everything is killed on the outgoing. Incoming slams in at
 *   full volume on the drop.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const loopRollStrategy: TransitionStrategy = {
    type: 'loop-roll',
    name: 'Loop-Roll Build',
    description: 'Shortening delay roll builds tension, then hard-cut into the drop',

    score(context: TransitionContext): TransitionCandidate {
        let score = 35;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // Must be beat-matched
        if (context.bpmDifference < 2) {
            score += 15;
            reasons.push('BPM match for rhythmic delay sync');
        } else if (context.bpmDifference < 4) {
            score += 5;
        } else {
            score -= 15;
            penalties.push('BPM gap breaks rhythmic delay pattern');
        }

        // Best for high-energy incoming (the "drop" needs impact)
        if (context.incoming.energy > 0.7) {
            score += 25;
            reasons.push('High-energy incoming — maximum drop impact');
        } else if (context.incoming.energy > 0.5) {
            score += 10;
        }

        // Works well as an energy build-up
        if (context.incoming.energy > context.outgoing.energy) {
            score += 10;
            reasons.push('Energy increase suits the build-up');
        }

        // Good BPM range for EDM/House
        if (context.outgoing.bpm >= 120 && context.outgoing.bpm <= 135) {
            score += 10;
            reasons.push('Classic EDM/House tempo range');
        }

        // Incoming should have a clean drop (no vocals in intro)
        if (!context.incoming.hasVocalsInIntro) {
            score += 5;
            reasons.push('Clean instrumental drop');
        }

        reasons.push('Loop-roll tension build');

        return {
            strategy: 'loop-roll',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const envelopes: AutomationEnvelope[] = [];
        const steps = 48; // Higher resolution for the rapid stutter
        const dropPoint = 0.75;

        // Calculate beat-synced delay times
        const beatDuration = 60 / context.outgoing.bpm;

        // ─── delayTime (shortening: 1 beat → 1/8 beat) ──────────
        const delayTimePoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < dropPoint) {
                // Exponential shortening: 1 beat → 1/8 beat
                const rollProgress = progress / dropPoint;
                value = beatDuration * Math.pow(0.125, rollProgress);
            } else {
                // Reset to normal after drop
                value = beatDuration * 0.75; // Dotted 8th
            }
            delayTimePoints.push({
                time: (i / steps) * overlapDuration,
                value: Math.max(0.01, value), // Clamp minimum
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'delayTime', points: delayTimePoints });

        // ─── delayFeedback (increases for dense repetitions) ─────
        const feedbackPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < dropPoint) {
                // Build feedback: 0.3 → 0.85
                const buildProgress = progress / dropPoint;
                value = 0.3 + buildProgress * 0.55;
            } else {
                // Kill feedback at drop
                value = 0.1;
            }
            feedbackPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'delayFeedback', points: feedbackPoints });

        // ─── delaySendA (outgoing delay send ramps up) ───────────
        const delaySendAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < dropPoint * 0.3) {
                // Initial ramp
                value = (progress / (dropPoint * 0.3)) * 0.5;
            } else if (progress < dropPoint) {
                // Full delay send
                value = 0.5 + ((progress - dropPoint * 0.3) / (dropPoint * 0.7)) * 0.3;
            } else {
                value = 0; // Kill at drop
            }
            delaySendAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'delaySendA', points: delaySendAPoints });

        // ─── filterFreqA (outgoing HPF sweep for "rising" tension) ─
        // NOTE: filter stays in lowpass mode, so we sweep DOWN to thin
        const filterAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < dropPoint) {
                // LPF sweep down: 20kHz → 1000Hz (thinning effect)
                const sweepProgress = progress / dropPoint;
                value = 20000 * Math.pow(1000 / 20000, sweepProgress);
            } else {
                value = 20000; // Reset after drop
            }
            filterAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'filterFreqA', points: filterAPoints });

        // ─── filterQA (resonance bump for dramatic sweep sound) ──
        const filterQAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < dropPoint) {
                // Q builds for "laser" effect
                value = 1 + (progress / dropPoint) * 6;
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

        // ─── gainA (outgoing — full then HARD CUT at drop) ───────
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const value = progress < dropPoint ? 1.0 : 0;
            gainAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── reverbSendA (tension wash) ──────────────────────────
        const reverbAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < dropPoint * 0.5) {
                value = (progress / (dropPoint * 0.5)) * 0.3;
            } else if (progress < dropPoint) {
                value = 0.3;
            } else {
                value = 0;
            }
            reverbAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'reverbSendA', points: reverbAPoints });

        // ─── gainB (incoming — SLAM at the drop) ─────────────────
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Silent until drop, then instant full
            const value = progress < dropPoint ? 0 : 1.0;
            gainBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        return envelopes;
    },
};
