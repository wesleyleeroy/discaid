/**
 * Transition Strategy: Vocal Sustain
 *
 * The outgoing track's vocal sustain bridges into the incoming track's
 * intro/drop. Inspired by the We Found Love × I Gotta Feeling mashup:
 *
 * Audio logic:
 * 1. BUILD-UNDER PHASE (0–80%): The incoming track's instrumental
 *    fades in underneath the outgoing vocal. The outgoing gets an HPF
 *    at 300Hz to clear the low end for the incoming kick/bass, and a
 *    progressive LPF on its instrumental to make it "recede" behind
 *    the vocal sustain. Reverb wash on the outgoing stretches the vocal.
 *
 * 2. THE HARD CUT (80%): The outgoing track is killed instantly —
 *    gain, reverb, delay all slammed to 0. The incoming snaps to full
 *    volume with no filters, clean and punchy.
 *
 * This is the inverse of drop-sync: outgoing has the vocal bridge,
 * incoming takes over at the drop.
 *
 * Reference: We Found Love (Rihanna) → I Gotta Feeling (BEP)
 */

import {
    TransitionStrategy,
    TransitionCandidate,
    TransitionContext,
    AutomationEnvelope,
} from '@/types/transition';

export const vocalSustainStrategy: TransitionStrategy = {
    type: 'vocal-sustain',
    name: 'Vocal Sustain',
    description: 'Use outgoing vocal sustain as a bridge, then hard-cut into the incoming drop',

    score(context: TransitionContext): TransitionCandidate {
        let score = 30;
        const penalties: string[] = [];
        const reasons: string[] = [];

        // ─── Best when outgoing has vocals in the outro ───────────
        if (context.outgoing.hasVocalsInOutro) {
            score += 25;
            reasons.push('Outgoing has vocals in outro — perfect for sustain bridge');
        } else {
            score -= 15;
            penalties.push('No vocals detected in outgoing outro');
        }

        // ─── Incoming should NOT have vocals in intro (clean drop) ─
        if (!context.incoming.hasVocalsInIntro) {
            score += 10;
            reasons.push('Incoming intro is instrumental — clean takeover');
        } else {
            score -= 5;
            penalties.push('Incoming has vocals in intro — may clash');
        }

        // ─── High energy incoming = punchy drop ───────────────────
        if (context.incoming.energy > 0.6) {
            score += 15;
            reasons.push('High-energy incoming track for impactful drop');
        } else if (context.incoming.energy > 0.4) {
            score += 5;
        }

        // ─── BPM match important for phrase lock ──────────────────
        if (context.bpmDifference < 2) {
            score += 10;
            reasons.push('BPM near-match for tight phrasing');
        } else if (context.bpmDifference < 5) {
            score += 3;
        } else {
            score -= 10;
            penalties.push('Large BPM gap complicates phrase alignment');
        }

        // ─── Key compatibility ────────────────────────────────────
        if (context.keyCompatibility > 0.6) {
            score += 5;
            reasons.push('Keys are harmonically close');
        }

        reasons.push('Vocal sustain bridge → hard cut');

        return {
            strategy: 'vocal-sustain',
            score: Math.max(0, Math.min(100, score)),
            reasoning: reasons.join('. '),
            penalties,
        };
    },

    generateEnvelopes(context: TransitionContext, overlapDuration: number): AutomationEnvelope[] {
        const envelopes: AutomationEnvelope[] = [];
        const steps = 32;
        const cutPoint = 0.80; // 80% — hard cut moment

        // ─── gainA (outgoing — holds, then hard cut) ──────────────
        const gainAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Hold at full, then instant kill at cut point
            const value = progress < cutPoint ? 1.0 : 0;
            gainAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainA', points: gainAPoints });

        // ─── filterFreqA (outgoing HPF: clear bass for incoming) ──
        // Start at 20kHz (open), ramp to HPF behavior via freq decrease
        // Since we can't change filter type mid-automation, we use the
        // existing lowpass and sweep it DOWN to create a "receding" effect
        const filterAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < cutPoint) {
                // LPF sweep down: 20kHz → 800Hz making the track recede
                value = 20000 * Math.pow(0.04, progress / cutPoint);
            } else {
                // After cut — doesn't matter, track is muted
                value = 20000;
            }
            filterAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'filterFreqA', points: filterAPoints });

        // ─── lowEqA (outgoing bass cut — clear room for incoming) ─
        // Progressive bass cut to -12dB
        const lowEqAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < cutPoint) {
                value = -(progress / cutPoint) * 12;
            } else {
                value = 0;
            }
            lowEqAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'lowEqA', points: lowEqAPoints });

        // ─── reverbSendA (outgoing reverb — stretches the vocal) ──
        // Builds up to wash the vocal sustain, killed at cut
        const reverbAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < cutPoint * 0.5) {
                // Build reverb
                value = (progress / (cutPoint * 0.5)) * 0.6;
            } else if (progress < cutPoint) {
                // Hold reverb
                value = 0.6;
            } else {
                // Kill at cut — clean start for incoming
                value = 0;
            }
            reverbAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'reverbSendA', points: reverbAPoints });

        // ─── delaySendA (outgoing delay — rhythmic texture during sustain) ─
        const delayAPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < cutPoint * 0.3) {
                value = 0;
            } else if (progress < cutPoint) {
                value = ((progress - cutPoint * 0.3) / (cutPoint * 0.7)) * 0.25;
            } else {
                // Kill — no delay tail bleeding into the incoming drop
                value = 0;
            }
            delayAPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'delaySendA', points: delayAPoints });

        // ─── gainB (incoming — builds underneath, slams at cut) ───
        const gainBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let value: number;
            if (progress < 0.05) {
                // Silent at very start
                value = 0;
            } else if (progress < cutPoint) {
                // Build gradually: 0 → 0.6
                const buildProgress = (progress - 0.05) / (cutPoint - 0.05);
                value = buildProgress * 0.6;
            } else {
                // SLAM to full at the cut point
                value = 1.0;
            }
            gainBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'gainB', points: gainBPoints });

        // ─── filterFreqB (incoming — open for clean hit at drop) ──
        // Keep wide open — the incoming should be clean and full
        const filterBPoints = [];
        for (let i = 0; i <= steps; i++) {
            filterBPoints.push({
                time: (i / steps) * overlapDuration,
                value: 20000,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'filterFreqB', points: filterBPoints });

        // ─── lowEqB (incoming bass — held back during build, full at drop) ─
        const lowEqBPoints = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            // Cut bass during build so it doesn't clash with outgoing, slam at drop
            const value = progress < cutPoint ? -8 : 0;
            lowEqBPoints.push({
                time: (i / steps) * overlapDuration,
                value,
                curve: 'linear' as const,
            });
        }
        envelopes.push({ parameter: 'lowEqB', points: lowEqBPoints });

        return envelopes;
    },
};
