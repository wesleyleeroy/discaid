/**
 * Transition Strategy: EQ Bass Swap (Pro Blend)
 *
 * The standard professional club transition for blending two tracks
 * in the same genre and tempo. The key principle: low-end frequencies
 * (kicks and basslines) must NEVER play simultaneously or they'll
 * clash and "muddy" the mix.
 *
 * Phase 1 — BLEND IN (0–60%):
 *   Track B comes in at full volume but with bass at 0% and
 *   mids/highs at 70%. Over 8-16 bars, B's mids/highs rise to 100%
 *   while A's mids/highs start dipping subtly.
 *
 * Phase 2 — HARD BASS SWAP (60%):
 *   On the "1" of the next major phrase: INSTANTLY swap bass.
 *   Track A's low EQ → 0% (muted bass). Track B's low EQ → 100%.
 *   This is the critical moment — must be instantaneous, not gradual.
 *
 * Phase 3 — FADE OUT (60–100%):
 *   Track A fades out smoothly now that its bass is gone.
 *   Track B is already at full.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const bassSwapStrategy: TransitionStrategy = {
    type: 'bass-swap',
    name: 'EQ Bass Swap',
    description: 'Professional hard bass swap — no low-end clash, instant kick handoff',

    score(context: TransitionContext): TransitionCandidate {
        let score = 50;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // Tight BPM match is CRITICAL (beats must be phase-locked)
        if (context.bpmDifference < 2) {
            score += 25;
            reasons.push(`Excellent BPM match (${context.bpmDifference.toFixed(1)}% diff)`);
        } else if (context.bpmDifference < 4) {
            score += 15;
            reasons.push('Good BPM match for bass swap');
        } else {
            score -= 20;
            penalties.push('BPM mismatch makes bass swap impossible');
        }

        // Key compatibility is important for bass harmony
        if (context.keyCompatibility > 0.8) {
            score += 15;
            reasons.push('Harmonically compatible keys — clean bass blend');
        } else if (context.keyCompatibility < 0.5) {
            score -= 10;
            penalties.push('Key clash may cause bass dissonance');
        }

        // Best for high-energy tracks with strong bass
        if (context.outgoing.energy > 0.6 && context.incoming.energy > 0.6) {
            score += 10;
            reasons.push('High energy tracks benefit from controlled bass swap');
        }

        // Good when vocals overlap (bass swap doesn't affect vocal range)
        if (context.outgoing.hasVocalsInOutro && context.incoming.hasVocalsInIntro) {
            score += 5;
            reasons.push('Bass swap preserves vocal clarity during overlap');
        }

        reasons.push('Professional hard bass swap technique');

        return {
            strategy: 'bass-swap',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(_context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const steps = 32;
        const envelopes: AutomationEnvelope[] = [];
        const swapPoint = 0.60; // The "1" — instant bass swap

        // ─── gainA (outgoing — full, then fades after bass swap) ──
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < swapPoint) {
                value = 1.0;
            } else {
                // Smooth fade out after bass is gone
                const fadeProgress = (progress - swapPoint) / (1 - swapPoint);
                value = Math.cos(fadeProgress * Math.PI * 0.5);
            }
            gainAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── lowEqA (outgoing bass — full until swap, then INSTANT cut) ─
        const lowEqAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Hard cut at the swap point — no gradual!
            const value = progress < swapPoint ? 0 : -24;
            lowEqAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'lowEqA', points: lowEqAPoints });

        // ─── midEqA / highEqA (outgoing mids/highs — subtle dip) ─
        const midEqAPoints = [];
        const highEqAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < swapPoint) {
                // Subtle dip during blend: 0 → -3dB
                value = -(progress / swapPoint) * 3;
            } else {
                // Continue dipping after swap
                value = -3 - ((progress - swapPoint) / (1 - swapPoint)) * 6;
            }
            midEqAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
            highEqAPoints.push({
                time: (i / steps) * overlapDuration,
                value: value * 0.7, // highs dip less
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'midEqA', points: midEqAPoints });
        envelopes.push({ parameter: 'highEqA', points: highEqAPoints });

        // ─── gainB (incoming — full volume from the start) ───────
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Quick ramp to full — should be audible quickly
            const value = progress < 0.08 ? progress / 0.08 : 1.0;
            gainBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        // ─── lowEqB (incoming bass — SILENT until swap, then INSTANT) ─
        const lowEqBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Hard cut until swap, then instant full bass
            const value = progress < swapPoint ? -24 : 0;
            lowEqBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'lowEqB', points: lowEqBPoints });

        // ─── midEqB / highEqB (incoming mids/highs — 70% → 100%) ─
        const midEqBPoints = [];
        const highEqBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < swapPoint) {
                // Start at 70% (-3.1dB), rise to 100% (0dB)
                value = -3.1 + (progress / swapPoint) * 3.1;
            } else {
                value = 0; // Full mids/highs
            }
            midEqBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
            highEqBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'midEqB', points: midEqBPoints });
        envelopes.push({ parameter: 'highEqB', points: highEqBPoints });

        return envelopes;
    },
};
