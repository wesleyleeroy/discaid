/**
 * Transition Strategy: Energy Ramp
 *
 * Creates a build-up or wind-down transition based on the energy
 * difference between tracks. Uses filter sweeps, gain automation,
 * and FX to create a dramatic energy arc.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const energyRampStrategy: TransitionStrategy = {
    type: 'energy-ramp',
    name: 'Energy Ramp',
    description: 'Dramatic energy build/drop transition with FX automation',

    score(context: TransitionContext): TransitionCandidate {
        let score = 40;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // Best when there's a significant energy difference
        if (context.energyDifference > 0.3) {
            score += 25;
            reasons.push(`Large energy contrast (${(context.energyDifference * 100).toFixed(0)}% diff) — ideal for energy ramp`);
        } else if (context.energyDifference > 0.15) {
            score += 10;
            reasons.push('Moderate energy difference');
        } else {
            score -= 10;
            penalties.push('Similar energy levels reduce ramp impact');
        }

        // BPM match helpful but not critical
        if (context.bpmDifference < 4) {
            score += 10;
        }

        // Works well going from low to high energy (build-up)
        if (context.incoming.energy > context.outgoing.energy) {
            score += 10;
            reasons.push('Building energy trajectory');
        }

        // Key compatibility moderate importance
        if (context.keyCompatibility > 0.7) {
            score += 5;
        }

        reasons.push('Dramatic energy arc transition');

        return {
            strategy: 'energy-ramp',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const steps = 24;
        const envelopes: AutomationEnvelope[] = [];
        const isBuildup = context.incoming.energy > context.outgoing.energy;

        if (isBuildup) {
            // ─── BUILD-UP: Filter close → drop into next track ─────
            const filterAPoints = [];
            const gainAPoints = [];
            const reverbAPoints = [];
            const filterBPoints = [];
            const gainBPoints = [];

            for (let i = 0; i <= steps; i++) {
                const t = (i / steps) * overlapDuration;
                const progress = i / steps;

                // Outgoing: LPF sweep down, build tension
                const filterA = progress < 0.7
                    ? 20000 * Math.pow(0.02, progress / 0.7) // Sweep down to 400Hz
                    : 400;
                filterAPoints.push({ time: t, value: filterA, curve: 'linear' as const });

                // Outgoing gain: hold then sharp cut at 75%
                const gainA = progress < 0.75 ? 1.0 : Math.max(0, 1.0 - ((progress - 0.75) / 0.15));
                gainAPoints.push({ time: t, value: gainA, curve: 'linear' as const });

                // Reverb wash on outgoing builds
                const reverbA = Math.min(0.7, progress);
                reverbAPoints.push({ time: t, value: reverbA, curve: 'linear' as const });

                // Incoming: silent until drop point, then slam in
                const gainB = progress < 0.7 ? 0 : Math.min(1, (progress - 0.7) / 0.15);
                gainBPoints.push({ time: t, value: gainB, curve: 'linear' as const });

                // Incoming filter: wide open from the start
                filterBPoints.push({ time: t, value: 20000, curve: 'linear' as const });
            }

            envelopes.push({ parameter: 'filterFreqA', points: filterAPoints });
            envelopes.push({ parameter: 'gainA', points: gainAPoints });
            envelopes.push({ parameter: 'reverbSendA', points: reverbAPoints });
            envelopes.push({ parameter: 'filterFreqB', points: filterBPoints });
            envelopes.push({ parameter: 'gainB', points: gainBPoints });

        } else {
            // ─── WIND-DOWN: Gradual energy decrease ────────────────
            const gainAPoints = [];
            const filterAPoints = [];
            const gainBPoints = [];
            const filterBPoints = [];
            const reverbBPoints = [];

            for (let i = 0; i <= steps; i++) {
                const t = (i / steps) * overlapDuration;
                const progress = i / steps;

                // Outgoing: smooth fade
                const gainA = Math.cos(progress * Math.PI * 0.5);
                gainAPoints.push({ time: t, value: gainA, curve: 'linear' as const });

                // Outgoing filter: gentle LPF
                const filterA = 20000 * Math.pow(0.05, progress);
                filterAPoints.push({ time: t, value: filterA, curve: 'linear' as const });

                // Incoming: HPF opens gradually, fade in
                const gainB = Math.sin(progress * Math.PI * 0.5);
                gainBPoints.push({ time: t, value: gainB, curve: 'linear' as const });

                const filterB = progress < 0.3
                    ? 1000
                    : 1000 + ((progress - 0.3) / 0.7) * 19000;
                filterBPoints.push({ time: t, value: filterB, curve: 'linear' as const });

                // Light reverb on incoming for smoothness
                const reverbB = progress < 0.5 ? 0.3 : 0.3 - ((progress - 0.5) / 0.5) * 0.3;
                reverbBPoints.push({ time: t, value: reverbB, curve: 'linear' as const });
            }

            envelopes.push({ parameter: 'gainA', points: gainAPoints });
            envelopes.push({ parameter: 'filterFreqA', points: filterAPoints });
            envelopes.push({ parameter: 'gainB', points: gainBPoints });
            envelopes.push({ parameter: 'filterFreqB', points: filterBPoints });
            envelopes.push({ parameter: 'reverbSendB', points: reverbBPoints });
        }

        return envelopes;
    },
};
