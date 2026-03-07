/**
 * Transition Strategy: Drop-Sync
 *
 * High-energy "slam" transition inspired by mashup/drop techniques.
 * Models the pattern: layer incoming over a build-up, then hard-cut
 * at the drop for maximum impact.
 *
 * Audio logic:
 * 1. LAYER PHASE (0–85%): Incoming enters with HPF at 250Hz (keeps
 *    vocals/melody, removes low-end mud). Outgoing gets a subtle -3dB
 *    mid dip at 1.5kHz to carve a "pocket" for the incoming.
 *    Reverb + delay build tension.
 *
 * 2. THE DROP (85%): Incoming hard-mutes instantly. All filters/dips
 *    on outgoing are slammed back to flat. The full bass and kick of
 *    the outgoing take over the entire frequency spectrum.
 *
 * This is the reverse of a typical transition (outgoing stays, incoming
 * is the overlay that gets cut), matching the "acapella over instrumental"
 * mashup pattern: the instrumental keeps playing and the overlaid vocal
 * is killed at the drop moment.
 *
 * Reference: Levels (Avicii) instrumental + Die Young (Ke$ha) acapella
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const dropSyncStrategy: TransitionStrategy = {
    type: 'drop-sync',
    name: 'Drop Sync',
    description: 'Layer incoming over build-up, then slam into the drop with a hard cut',

    score(context: TransitionContext): TransitionCandidate {
        let score = 35;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // ─── Favors high energy on the outgoing (it's the "bed") ──
        if (context.outgoing.energy > 0.65) {
            score += 20;
            reasons.push('Outgoing track has high energy — great for a drop bed');
        } else if (context.outgoing.energy > 0.45) {
            score += 8;
        } else {
            score -= 10;
            penalties.push('Low outgoing energy reduces drop impact');
        }

        // ─── Large energy difference = more dramatic drop ─────────
        if (context.energyDifference > 0.2) {
            score += 15;
            reasons.push(`Strong energy contrast (${(context.energyDifference * 100).toFixed(0)}%)`);
        }

        // ─── BPM match is important for a locked build-up ─────────
        if (context.bpmDifference < 2) {
            score += 15;
            reasons.push('BPM near-match allows tight phrase lock');
        } else if (context.bpmDifference < 5) {
            score += 5;
        } else {
            score -= 15;
            penalties.push('Large BPM gap makes phrase lock difficult');
        }

        // ─── Key compatibility adds harmonic richness ─────────────
        if (context.keyCompatibility > 0.7) {
            score += 10;
            reasons.push('Harmonically compatible keys');
        } else if (context.keyCompatibility < 0.3) {
            score -= 10;
            penalties.push('Key clash may cause dissonance in the layer');
        }

        // ─── Vocal-in-intro on incoming is perfect (acapella layer) ─
        if (context.incoming.hasVocalsInIntro) {
            score += 10;
            reasons.push('Incoming has vocals — ideal for the overlay layer');
        }

        reasons.push('Drop-sync: layer → hard cut → slam');

        return {
            strategy: 'drop-sync',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const envelopes: AutomationEnvelope[] = [];
        const steps = 32;
        const dropPoint = 0.85; // 85% — the moment of the hard cut

        // ─── gainA (outgoing / the "bed" instrumental) ────────────
        // Stays at full volume the entire time — it IS the beat
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            gainAPoints.push({
                time: (i / steps) * overlapDuration,
                value: 1.0,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── midEqA (outgoing mid dip — "carve a pocket" for vocals) ─
        // During layer phase: -3dB dip. At drop: snap back to 0dB.
        const midEqAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const value = progress < dropPoint ? -3 : 0;
            midEqAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'midEqA', points: midEqAPoints });

        // ─── gainB (incoming / the overlay that gets cut) ─────────
        // Fade in over first 10%, hold, then HARD CUT at the drop
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < 0.10) {
                // Quick fade in
                value = progress / 0.10;
            } else if (progress < dropPoint) {
                // Hold at full
                value = 1.0;
            } else {
                // HARD CUT — instant mute
                value = 0;
            }
            gainBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        // ─── filterFreqB (incoming HPF at 250Hz — remove low mud) ──
        // Keep the HPF during the entire layer phase, doesn't matter after cut
        const filterBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // HPF at 250Hz during layer, open up after drop (cleanup)
            const value = progress < dropPoint ? 250 : 20000;
            filterBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'filterFreqB', points: filterBPoints });

        // ─── reverbSendA (outgoing reverb builds tension) ─────────
        // Rises through the build-up, slams to 0 at the drop
        const reverbAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < dropPoint) {
                // Build reverb wash: 0 → 0.5
                value = (progress / dropPoint) * 0.5;
            } else {
                // Slam dry at drop
                value = 0;
            }
            reverbAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'reverbSendA', points: reverbAPoints });

        // ─── delaySendA (outgoing delay adds rhythmic texture) ────
        // Subtle delay during build, killed at drop
        const delayAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < dropPoint * 0.5) {
                value = 0;
            } else if (progress < dropPoint) {
                // Builds from midway through the layer
                value = ((progress - dropPoint * 0.5) / (dropPoint * 0.5)) * 0.3;
            } else {
                value = 0;
            }
            delayAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'delaySendA', points: delayAPoints });

        // ─── reverbSendB (slight reverb on the incoming overlay) ──
        const reverbBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const value = progress < dropPoint ? 0.2 : 0;
            reverbBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'reverbSendB', points: reverbBPoints });

        return envelopes;
    },
};
