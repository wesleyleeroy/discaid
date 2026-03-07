/**
 * Transition Strategy: Bed Swap
 *
 * Smoothly blends the incoming track's instrumental "bed" underneath
 * the outgoing track's vocals, then switches to the incoming track's
 * vocals at a natural break point.
 *
 * This is the classic radio/club DJ technique:
 *
 * Phase 1 — INSTRUMENTAL BLEND (0–65%):
 *   The incoming track fades in with a LOW-PASS filter (bass/kick/sub
 *   only at first, then gradually opening to include mids). Meanwhile
 *   the outgoing track's LOW EQ is progressively cut to avoid
 *   bass buildup. The outgoing vocals (mids/highs) remain intact.
 *
 * Phase 2 — FULL BED ESTABLISHED (65–80%):
 *   The incoming is now playing at nearly full volume but still
 *   low-passed to keep its vocals out. The outgoing is bass-cut
 *   but vocals are still full. Both tracks' instrumentals coexist.
 *
 * Phase 3 — VOCAL SWITCH (80–100%):
 *   The outgoing track fades out completely (vocals and all).
 *   The incoming's LPF opens to full range, revealing the incoming
 *   vocals. The incoming reaches full, clean volume.
 *
 * The net effect: the listener hears the current vocalist singing
 * over a gradually changing beat, then a smooth handoff to the
 * next vocalist over the new beat.
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const bedSwapStrategy: TransitionStrategy = {
    type: 'bed-swap',
    name: 'Bed Swap',
    description: 'Blend incoming instrumental under outgoing vocals, then switch at a natural break',

    score(context: TransitionContext): TransitionCandidate {
        let score = 40;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // ─── Best when outgoing has vocals in the outro ───────────
        // (the current singer keeps going while the bed changes)
        if (context.outgoing.hasVocalsInOutro) {
            score += 20;
            reasons.push('Outgoing has vocals in outro — keeps singing over the blend');
        } else {
            score -= 5;
            penalties.push('No outgoing vocals to sustain during the blend');
        }

        // ─── BPM match is critical (beats must groove together) ───
        if (context.bpmDifference < 2) {
            score += 20;
            reasons.push('Tight BPM match — beats will lock together');
        } else if (context.bpmDifference < 4) {
            score += 10;
            reasons.push('Reasonable BPM match for bed swap');
        } else {
            score -= 15;
            penalties.push('BPM gap too large — beats will drift');
        }

        // ─── Key compatibility important for harmonic blend ───────
        if (context.keyCompatibility > 0.7) {
            score += 15;
            reasons.push('Keys are compatible — blend will sound clean');
        } else if (context.keyCompatibility > 0.4) {
            score += 5;
        } else {
            score -= 10;
            penalties.push('Key clash may make the instrumental blend harsh');
        }

        // ─── Similar energy = smooth bed swap ─────────────────────
        if (context.energyDifference < 0.25) {
            score += 10;
            reasons.push('Similar energy levels for seamless bed swap');
        }

        // ─── Bonus if incoming has vocals after intro ─────────────
        // (there's something to "reveal" after the switch)
        if (!context.incoming.hasVocalsInIntro) {
            score += 5;
            reasons.push('Incoming intro is instrumental — clean bed for blending');
        }

        reasons.push('Instrumental bed swap with vocal handoff');

        return {
            strategy: 'bed-swap',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const envelopes: AutomationEnvelope[] = [];
        const steps = 32;

        // Phase boundaries
        const blendEnd = 0.65;   // End of instrumental blend-in
        const holdEnd = 0.80;    // End of bed-established phase
        // holdEnd → 1.0 = vocal switch phase

        // ─── gainA (outgoing — stays full, then fades at the switch) ─
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < holdEnd) {
                // Full volume through blend + hold phases
                value = 1.0;
            } else {
                // Smooth fade out during vocal switch
                const switchProgress = (progress - holdEnd) / (1 - holdEnd);
                value = Math.cos(switchProgress * Math.PI * 0.5);
            }
            gainAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── lowEqA (outgoing bass — progressively cut to avoid buildup) ─
        const lowEqAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < blendEnd) {
                // Gradual bass cut: 0 → -18dB over the blend phase
                value = -(progress / blendEnd) * 18;
            } else {
                value = -18; // Keep bass cut through hold and switch
            }
            lowEqAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'lowEqA', points: lowEqAPoints });

        // ─── gainB (incoming — gradually builds up) ──────────────
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < 0.05) {
                value = 0; // Brief silence
            } else if (progress < blendEnd) {
                // Gradual volume increase: 0 → 0.85
                const buildProgress = (progress - 0.05) / (blendEnd - 0.05);
                value = buildProgress * 0.85;
            } else if (progress < holdEnd) {
                // Hold at 0.85 during established phase
                value = 0.85;
            } else {
                // Ramp to full during vocal switch
                const switchProgress = (progress - holdEnd) / (1 - holdEnd);
                value = 0.85 + switchProgress * 0.15;
            }
            gainBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        // ─── filterFreqB (incoming LPF — key to the "bed" effect) ─
        // Starts very low (bass only), opens gradually, then goes full
        const filterBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < blendEnd) {
                // LPF opens from 120Hz → 2000Hz (bass → bass+mids, no vocals)
                const buildProgress = progress / blendEnd;
                // Logarithmic sweep for natural sounding filter open
                value = 120 * Math.pow(2000 / 120, buildProgress);
            } else if (progress < holdEnd) {
                // Hold at 2000Hz — incoming mids present but vocals still hidden
                value = 2000;
            } else {
                // Open to full range — reveal the incoming vocals
                const switchProgress = (progress - holdEnd) / (1 - holdEnd);
                value = 2000 * Math.pow(20000 / 2000, switchProgress);
            }
            filterBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'filterFreqB', points: filterBPoints });

        // ─── lowEqB (incoming bass — starts hot to fill the gap) ──
        const lowEqBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Slight bass boost at the start when LPF is very low,
            // normalize to 0 as the filter opens
            let value: number;
            if (progress < blendEnd) {
                const buildProgress = progress / blendEnd;
                value = 3 * (1 - buildProgress); // +3dB → 0dB
            } else {
                value = 0;
            }
            lowEqBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'lowEqB', points: lowEqBPoints });

        // ─── midEqA (outgoing — subtle mid dip to avoid mud) ──────
        const midEqAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < blendEnd) {
                // Small dip as incoming mids enter
                value = -(progress / blendEnd) * 2;
            } else {
                value = -2;
            }
            midEqAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'midEqA', points: midEqAPoints });

        // ─── reverbSendA (outgoing — slight wash during the switch) ─
        const reverbAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < holdEnd) {
                value = 0;
            } else {
                // Add reverb wash as outgoing fades — smooth the exit
                const switchProgress = (progress - holdEnd) / (1 - holdEnd);
                value = switchProgress * 0.35;
            }
            reverbAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'reverbSendA', points: reverbAPoints });

        return envelopes;
    },
};
