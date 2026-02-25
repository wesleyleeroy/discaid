/**
 * Transition Strategy: Echo Out
 *
 * Fades the outgoing track into an echo/delay tail while bringing
 * in the new track. Creates a rhythmic dissolution effect.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const echoOutStrategy: TransitionStrategy = {
    type: 'echo-out',
    name: 'Echo Out',
    description: 'Dissolve outgoing track into rhythmic echo/delay tail',

    score(context: TransitionContext): TransitionCandidate {
        let score = 50;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // Works best with moderate BPM tracks (delay syncs to tempo)
        if (context.outgoing.bpm >= 90 && context.outgoing.bpm <= 140) {
            score += 15;
            reasons.push(`Good tempo for rhythmic delay (${context.outgoing.bpm} BPM)`);
        }

        // Works well for energy drops
        if (context.outgoing.energy > context.incoming.energy) {
            score += 10;
            reasons.push('Energy decrease suits echo dissolve');
        }

        // Bad if incoming has vocals immediately (echo clash)
        if (context.incoming.hasVocalsInIntro) {
            score -= 10;
            penalties.push('Echo may clash with incoming vocals');
        }

        // Good for larger BPM differences (hides tempo mismatch)
        if (context.bpmDifference > 4) {
            score += 10;
            reasons.push('Echo out masks BPM mismatch');
        }

        // Key compatibility less critical (echo becomes textural)
        if (context.keyCompatibility < 0.5) {
            score += 5;
            reasons.push('Echo tail becomes textural, masking key clash');
        }

        reasons.push('Rhythmic echo dissolution');

        return {
            strategy: 'echo-out',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const steps = 24;
        const envelopes: AutomationEnvelope[] = [];

        // Calculate tempo-synced delay time (dotted 8th note)
        const delayTime = (60 / context.outgoing.bpm) * 0.75; // dotted 8th

        // ─── Outgoing: Increase delay send, fade out dry signal ──
        const gainAPoints = [];
        const delaySendAPoints = [];
        const reverbSendAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * overlapDuration;
            const progress = i / steps;

            // Gain: fade out in middle section
            const gainValue = progress < 0.3
                ? 1.0
                : Math.max(0, 1.0 - ((progress - 0.3) / 0.5));
            gainAPoints.push({ time: t, value: gainValue, curve: 'linear' as const });

            // Delay send: ramp up then hold
            const delayValue = Math.min(0.7, progress * 1.2);
            delaySendAPoints.push({ time: t, value: delayValue, curve: 'linear' as const });

            // Reverb: slight increase for wash
            const reverbValue = Math.min(0.4, progress * 0.5);
            reverbSendAPoints.push({ time: t, value: reverbValue, curve: 'linear' as const });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });
        envelopes.push({ parameter: 'delaySendA', points: delaySendAPoints });
        envelopes.push({ parameter: 'reverbSendA', points: reverbSendAPoints });

        // Delay time automation (tempo-synced)
        envelopes.push({
            parameter: 'delayTime',
            points: [
                { time: 0, value: delayTime, curve: 'linear' },
                { time: overlapDuration, value: delayTime, curve: 'linear' },
            ],
        });

        // Delay feedback: increase for longer tail, then reduce
        envelopes.push({
            parameter: 'delayFeedback',
            points: [
                { time: 0, value: 0.3, curve: 'linear' },
                { time: overlapDuration * 0.5, value: 0.65, curve: 'linear' },
                { time: overlapDuration * 0.8, value: 0.4, curve: 'linear' },
                { time: overlapDuration, value: 0.1, curve: 'linear' },
            ],
        });

        // ─── Incoming: Gentle fade in ────────────────────────────
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * overlapDuration;
            const progress = i / steps;
            // Delayed fade in (let echo establish first)
            const gainValue = progress < 0.2
                ? 0
                : Math.min(1, (progress - 0.2) / 0.6);
            gainBPoints.push({ time: t, value: gainValue, curve: 'linear' as const });
        }
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        return envelopes;
    },
};
