/**
 * Transition Strategy: Beatmatched Crossfade
 *
 * The simplest and most reliable transition. Gradually fades gain
 * from deck A to deck B with an equal-power crossfade curve.
 *
 * Also serves as the universal fallback when other strategies
 * can't be safely applied.
 *
 * DSP Note: Equal-power crossfade uses cos/sin curves to maintain
 * perceived loudness during the blend, avoiding the "volume dip"
 * of linear crossfades.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const crossfadeStrategy: TransitionStrategy = {
    type: 'crossfade',
    name: 'Beatmatched Crossfade',
    description: 'Smooth equal-power crossfade between tracks',

    score(context: TransitionContext): TransitionCandidate {
        // Crossfade always works — it's the fallback
        let score = 60; // Base score
        const penalties: string[] = [];
        const reasons: string[] = ['Universal fallback strategy'];

        // Bonus for matching BPM
        if (context.bpmDifference < 2) {
            score += 15;
            reasons.push(`BPM within ${context.bpmDifference.toFixed(1)}%`);
        } else if (context.bpmDifference < 4) {
            score += 8;
        }

        // Bonus for key compatibility
        if (context.keyCompatibility > 0.8) {
            score += 10;
            reasons.push('Good harmonic compatibility');
        }

        // Penalty for vocal clash risk
        if (context.outgoing.hasVocalsInOutro && context.incoming.hasVocalsInIntro) {
            score -= 15;
            penalties.push('Risk of vocal clash during overlap');
        }

        // Bonus for similar energy
        if (context.energyDifference < 0.2) {
            score += 5;
            reasons.push('Similar energy levels');
        }

        return {
            strategy: 'crossfade',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(_context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const steps = 20; // automation resolution
        const envelopes: AutomationEnvelope[] = [];

        // ─── Gain A: Equal-power fade out ────────────────────────
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * overlapDuration;
            const progress = i / steps;
            // Cosine curve for equal-power fade out
            const value = Math.cos(progress * Math.PI * 0.5);
            gainAPoints.push({ time: t, value, curve: 'linear' as const });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── Gain B: Equal-power fade in ─────────────────────────
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * overlapDuration;
            const progress = i / steps;
            // Sine curve for equal-power fade in
            const value = Math.sin(progress * Math.PI * 0.5);
            gainBPoints.push({ time: t, value, curve: 'linear' as const });
        }
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        return envelopes;
    },
};
