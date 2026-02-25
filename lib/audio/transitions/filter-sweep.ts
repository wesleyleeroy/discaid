/**
 * Transition Strategy: Filter Sweep
 *
 * Applies a low-pass filter sweep on the outgoing track (closing down)
 * and a high-pass filter sweep on the incoming track (opening up).
 * Creates a dramatic "washing" effect common in electronic music.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';
import { FILTER_MIN_FREQ, FILTER_MAX_FREQ } from '@/lib/utils/constants';

export const filterSweepStrategy: TransitionStrategy = {
    type: 'filter-sweep',
    name: 'Filter Sweep',
    description: 'LPF/HPF sweep transition with dramatic frequency narrowing',

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

        // Works well with higher energy tracks
        if (context.outgoing.energy > 0.5 && context.incoming.energy > 0.5) {
            score += 15;
            reasons.push('High energy tracks suit filter sweeps');
        }

        // Good for avoiding vocal clash
        if (context.outgoing.hasVocalsInOutro && context.incoming.hasVocalsInIntro) {
            score += 10;
            reasons.push('Filter helps separate overlapping vocals');
        }

        // Key compatibility bonus
        if (context.keyCompatibility > 0.7) {
            score += 5;
        }

        reasons.push('Dramatic frequency sweep transition');

        return {
            strategy: 'filter-sweep',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(_context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const steps = 24;
        const envelopes: AutomationEnvelope[] = [];

        // ─── Outgoing: LPF sweep down + fade out ─────────────────
        const filterAPoints = [];
        const gainAPoints = [];
        const reverbAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * overlapDuration;
            const progress = i / steps;

            // LPF: 20kHz → 200Hz (logarithmic sweep)
            const logMin = Math.log(200);
            const logMax = Math.log(FILTER_MAX_FREQ);
            const filterFreq = Math.exp(logMax - progress * (logMax - logMin));
            filterAPoints.push({ time: t, value: filterFreq, curve: 'linear' as const });

            // Gain: hold steady then fade in last 30%
            const gainValue = progress < 0.7 ? 1.0 : 1.0 - ((progress - 0.7) / 0.3);
            gainAPoints.push({ time: t, value: gainValue, curve: 'linear' as const });

            // Reverb: increase during sweep for wash effect
            const reverbValue = Math.min(0.6, progress * 0.7);
            reverbAPoints.push({ time: t, value: reverbValue, curve: 'linear' as const });
        }
        envelopes.push({ parameter: 'filterFreqA', points: filterAPoints });
        envelopes.push({ parameter: 'gainA', points: gainAPoints });
        envelopes.push({ parameter: 'reverbSendA', points: reverbAPoints });

        // ─── Incoming: HPF sweep up + fade in ────────────────────
        const filterBPoints = [];
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * overlapDuration;
            const progress = i / steps;

            // HPF: start filtered at 2kHz → open to 20Hz
            const logMin = Math.log(FILTER_MIN_FREQ);
            const logMax = Math.log(2000);
            const filterFreq = Math.exp(logMax - progress * (logMax - logMin));
            filterBPoints.push({ time: t, value: filterFreq, curve: 'linear' as const });

            // Gain: fade in over first 60%
            const gainValue = progress < 0.6 ? progress / 0.6 : 1.0;
            gainBPoints.push({ time: t, value: gainValue, curve: 'linear' as const });
        }
        envelopes.push({ parameter: 'filterFreqB', points: filterBPoints });
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        return envelopes;
    },
};
