/**
 * Transition Strategy: Bass Swap
 *
 * Classic DJ technique: fade out the bass EQ on the outgoing track
 * while bringing in the bass on the incoming track. Creates a clean
 * low-end handoff without bass frequency buildup (which causes muddiness).
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const bassSwapStrategy: TransitionStrategy = {
    type: 'bass-swap',
    name: 'Bass Swap',
    description: 'EQ bass attenuation swap for clean low-end transition',

    score(context: TransitionContext): TransitionCandidate {
        let score = 50;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // Works best with matching BPM (bass needs to groove together)
        if (context.bpmDifference < 2) {
            score += 25;
            reasons.push(`Excellent BPM match (${context.bpmDifference.toFixed(1)}% diff)`);
        } else if (context.bpmDifference < 4) {
            score += 15;
            reasons.push('Good BPM match for bass swap');
        } else {
            score -= 15;
            penalties.push('BPM mismatch makes bass swap sound off');
        }

        // Key compatibility is important for bass harmony
        if (context.keyCompatibility > 0.8) {
            score += 15;
            reasons.push('Harmonically compatible keys for clean bass blend');
        } else if (context.keyCompatibility < 0.5) {
            score -= 10;
            penalties.push('Incompatible keys may cause bass clash');
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

        reasons.push('Clean low-end handoff technique');

        return {
            strategy: 'bass-swap',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(_context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const steps = 24;
        const envelopes: AutomationEnvelope[] = [];

        // ─── Outgoing: Kill bass, gentle overall fade ────────────
        const lowEqAPoints = [];
        const gainAPoints = [];
        const midEqAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * overlapDuration;
            const progress = i / steps;

            // Bass: cut in first half of transition (0 → -24dB)
            const lowEqValue = progress < 0.5
                ? -(progress / 0.5) * 24
                : -24;
            lowEqAPoints.push({ time: t, value: lowEqValue, curve: 'linear' as const });

            // Slight mid reduction to avoid buildup
            const midEqValue = progress < 0.6 ? 0 : -(((progress - 0.6) / 0.4) * 6);
            midEqAPoints.push({ time: t, value: midEqValue, curve: 'linear' as const });

            // Gain: hold then fade in second half
            const gainValue = progress < 0.5
                ? 1.0
                : 1.0 - ((progress - 0.5) / 0.5);
            gainAPoints.push({ time: t, value: gainValue, curve: 'linear' as const });
        }
        envelopes.push({ parameter: 'lowEqA', points: lowEqAPoints });
        envelopes.push({ parameter: 'midEqA', points: midEqAPoints });
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── Incoming: Bring in bass, fade in overall ────────────
        const lowEqBPoints = [];
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * overlapDuration;
            const progress = i / steps;

            // Bass: start cut, bring in during second half (-24dB → 0)
            const lowEqValue = progress < 0.4
                ? -24
                : -24 + ((progress - 0.4) / 0.6) * 24;
            lowEqBPoints.push({ time: t, value: lowEqValue, curve: 'linear' as const });

            // Gain: fade in over first half
            const gainValue = progress < 0.5
                ? progress / 0.5
                : 1.0;
            gainBPoints.push({ time: t, value: gainValue, curve: 'linear' as const });
        }
        envelopes.push({ parameter: 'lowEqB', points: lowEqBPoints });
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        return envelopes;
    },
};
