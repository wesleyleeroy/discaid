/**
 * Transition Strategy: Vinyl Brake / Power-Off (Stylistic Stop)
 *
 * Mimics the mechanical sound of a turntable being turned off, causing
 * the music to slow down and drop in pitch until it stops completely.
 * The incoming track then launches from a fresh downbeat.
 *
 * Phase 1 — NORMAL PLAY (0–30%):
 *   Track A plays normally until the desired exit point.
 *
 * Phase 2 — VINYL BRAKE (30–70%):
 *   Playback rate drops from 1.0 → 0.0 (pitch sags, tempo slows).
 *   This creates the classic "turntable stopping" sound.
 *   LPF sweeps down as the brake engages.
 *
 * Phase 3 — SILENCE GAP (70–80%):
 *   1-2 beats of near-silence — creates dramatic anticipation.
 *
 * Phase 4 — FRESH START (80–100%):
 *   Incoming track launches on a fresh downbeat at full energy.
 *
 * Best for: changing genres, "resetting" the energy, stylistic stops.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const vinylBrakeStrategy: TransitionStrategy = {
    type: 'vinyl-brake',
    name: 'Vinyl Brake',
    description: 'Turntable power-off slowdown with stylistic silence before the next track',

    score(context: TransitionContext): TransitionCandidate {
        let score = 25; // Low base — this is a specialty effect
        const penalties: string[] = [];
        const reasons: string[] = [];

        // Works best for genre switches (large BPM or key difference)
        if (context.bpmDifference > 10) {
            score += 20;
            reasons.push('Large BPM gap — vinyl brake hides the switch');
        } else if (context.bpmDifference > 5) {
            score += 15;
            reasons.push('Moderate BPM gap suits vinyl brake');
        }

        // Good for energy resets
        if (context.energyDifference > 0.3) {
            score += 15;
            reasons.push('Large energy difference — vinyl brake resets the vibe');
        }

        // Bad key compatibility = good for vinyl brake (hides it)
        if (context.keyCompatibility < 0.4) {
            score += 10;
            reasons.push('Key incompatibility masked by the brake');
        }

        // Works best when outgoing is mid-high energy (dramatic stop)
        if (context.outgoing.energy > 0.5) {
            score += 10;
            reasons.push('High-energy track makes the stop dramatic');
        }

        // Penalty for same-genre smooth flow (vinyl brake disrupts it)
        if (context.bpmDifference < 2 && context.keyCompatibility > 0.8) {
            score -= 15;
            penalties.push('Tracks already blend well — vinyl brake is disruptive');
        }

        reasons.push('Stylistic turntable stop');

        return {
            strategy: 'vinyl-brake',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(_context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const envelopes: AutomationEnvelope[] = [];
        const steps = 48; // High resolution for smooth rate change

        const brakeStart = 0.30;  // Start slowing down
        const brakeEnd = 0.70;    // Fully stopped
        const silenceEnd = 0.80;  // End of silence gap
        // 0.80 → 1.0 = incoming track launch

        // ─── playbackRateA (1.0 → 0 — the vinyl brake) ──────────
        const rateAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < brakeStart) {
                value = 1.0; // Normal speed
            } else if (progress < brakeEnd) {
                // Exponential slowdown (sounds more natural than linear)
                const brakeProgress = (progress - brakeStart) / (brakeEnd - brakeStart);
                // Use a curve that slows quickly at first then creeps to 0
                value = Math.max(0.001, 1.0 - Math.pow(brakeProgress, 0.6));
            } else {
                value = 0.001; // Near-zero (can't set exactly 0 on AudioParam)
            }
            rateAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'playbackRateA', points: rateAPoints });

        // ─── gainA (full → fade during brake → silent) ───────────
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < brakeStart) {
                value = 1.0;
            } else if (progress < brakeEnd) {
                // Fade alongside the brake
                const brakeProgress = (progress - brakeStart) / (brakeEnd - brakeStart);
                value = 1.0 - brakeProgress * 0.85; // Don't go fully silent — let the "wobble" be heard
            } else {
                value = 0; // Full silence
            }
            gainAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── filterFreqA (LPF sweep down during brake) ───────────
        // Simulates the "muffling" as the motor slows
        const filterAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < brakeStart) {
                value = 20000;
            } else if (progress < brakeEnd) {
                const brakeProgress = (progress - brakeStart) / (brakeEnd - brakeStart);
                value = 20000 * Math.pow(200 / 20000, brakeProgress);
            } else {
                value = 200;
            }
            filterAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'filterFreqA', points: filterAPoints });

        // ─── gainB (incoming — launches after silence gap) ───────
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < silenceEnd) {
                value = 0; // Silent through brake + gap
            } else {
                // Quick but not instant ramp to full
                const launchProgress = (progress - silenceEnd) / (1 - silenceEnd);
                value = Math.min(1.0, launchProgress * 2); // Reaches full by halfway through launch
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
