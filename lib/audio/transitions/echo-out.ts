/**
 * Transition Strategy: Echo-Out Wash (Genre/Tempo Switch)
 *
 * Uses a post-fader echo effect to "wash out" the outgoing track,
 * creating a tail that masks the entry of the incoming track.
 * Perfect for genre or tempo changes where beat-matching isn't possible.
 *
 * Phase 1 — ECHO BUILD (0–60%):
 *   Apply a 1/2-beat or 3/4-beat echo to the outgoing track.
 *   Gradually increase delay feedback/wetness over the final bars.
 *   Add reverb for additional wash.
 *
 * Phase 2 — HARD MUTE (60%):
 *   On the last beat of the phrase, HARD MUTE the outgoing track's
 *   dry signal (gain → 0). The echo tail continues ringing out
 *   because the delay/reverb sends are post-input-gain.
 *
 * Phase 3 — ECHO DECAY + INCOMING (60–100%):
 *   The echo tail naturally decays. The incoming track fades in
 *   on the "1" immediately after the mute. The echo masks the
 *   seam between the two tracks.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const echoOutStrategy: TransitionStrategy = {
    type: 'echo-out',
    name: 'Echo-Out Wash',
    description: 'Echo wash dissolve with hard mute — great for genre/tempo switches',

    score(context: TransitionContext): TransitionCandidate {
        let score = 50;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // Works with ANY BPM difference (great for tempo switches)
        if (context.bpmDifference > 4) {
            score += 15;
            reasons.push('Echo out masks BPM mismatch');
        } else if (context.bpmDifference > 2) {
            score += 8;
        }

        // Works best with moderate BPM (delay syncs to tempo)
        if (context.outgoing.bpm >= 90 && context.outgoing.bpm <= 140) {
            score += 10;
            reasons.push(`Good tempo for rhythmic delay (${context.outgoing.bpm} BPM)`);
        }

        // Good for energy drops
        if (context.outgoing.energy > context.incoming.energy) {
            score += 10;
            reasons.push('Energy decrease suits echo dissolve');
        }

        // Bad if incoming has vocals immediately (echo clash)
        if (context.incoming.hasVocalsInIntro) {
            score -= 8;
            penalties.push('Echo tail may clash with incoming vocals');
        }

        // Key compatibility less critical (echo becomes textural)
        if (context.keyCompatibility < 0.5) {
            score += 5;
            reasons.push('Echo tail becomes textural, masking key clash');
        }

        reasons.push('Echo wash with hard mute');

        return {
            strategy: 'echo-out',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const steps = 32;
        const envelopes: AutomationEnvelope[] = [];
        const mutePoint = 0.60; // Hard mute moment

        // Calculate tempo-synced delay time (dotted 8th note)
        const delayTime = (60 / context.outgoing.bpm) * 0.75;

        // ─── gainA (outgoing — holds then HARD MUTE) ─────────────
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Full volume until mute point, then instant kill
            const value = progress < mutePoint ? 1.0 : 0;
            gainAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── delaySendA (outgoing delay — builds up to the mute) ──
        const delaySendAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < mutePoint) {
                // Build delay send: 0 → 0.8
                value = (progress / mutePoint) * 0.8;
            } else {
                // Cut delay send after mute (tail still rings)
                const decay = (progress - mutePoint) / (1 - mutePoint);
                value = 0.8 * (1 - decay);
            }
            delaySendAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'delaySendA', points: delaySendAPoints });

        // ─── reverbSendA (outgoing reverb wash) ──────────────────
        const reverbSendAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < mutePoint * 0.5) {
                // Build up reverb
                value = (progress / (mutePoint * 0.5)) * 0.5;
            } else if (progress < mutePoint) {
                // Hold reverb
                value = 0.5;
            } else {
                // Decay reverb tail
                const decay = (progress - mutePoint) / (1 - mutePoint);
                value = 0.5 * (1 - decay * decay); // Quadratic decay
            }
            reverbSendAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'reverbSendA', points: reverbSendAPoints });

        // ─── Delay time (tempo-synced, held constant) ────────────
        envelopes.push({
            parameter: 'delayTime',
            points: [
                { time: 0, value: delayTime, curve: 'linear' },
                { time: overlapDuration, value: delayTime, curve: 'linear' },
            ],
        });

        // ─── Delay feedback (builds up for longer tail) ──────────
        envelopes.push({
            parameter: 'delayFeedback',
            points: [
                { time: 0, value: 0.3, curve: 'linear' },
                { time: overlapDuration * mutePoint * 0.5, value: 0.5, curve: 'linear' },
                { time: overlapDuration * mutePoint, value: 0.65, curve: 'linear' },
                { time: overlapDuration * 0.85, value: 0.3, curve: 'linear' },
                { time: overlapDuration, value: 0.1, curve: 'linear' },
            ],
        });

        // ─── gainB (incoming — fades in right after the mute) ────
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < mutePoint - 0.05) {
                // Silent during echo build
                value = 0;
            } else if (progress < mutePoint + 0.15) {
                // Quick fade in around the mute point
                const fadeProgress = (progress - (mutePoint - 0.05)) / 0.20;
                value = Math.sin(fadeProgress * Math.PI * 0.5);
            } else {
                value = 1.0;
            }
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
