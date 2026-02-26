/**
 * Live FX Engine — Autonomous DJ effects during playback.
 *
 * Fires beat-synced effects automatically based on track analysis:
 * - Beat-repeat / stutter (rhythmic 1/8, 1/16, 1/32 repeats)
 * - Filter sweeps (build-up sweeps before drops)
 * - Reverb washes (atmospheric swells on breakdowns)
 * - Delay throws (rhythmic delay echoes on phrase endings)
 * - Riser effects (build tension before chorus/drop)
 *
 * The engine schedules FX based on the track's section map, beat grid,
 * and energy profile — mimicking how a real DJ adds flair.
 */

import { audioEngine } from '@/lib/audio/engine';
import { TrackAnalysis, TrackSection } from '@/types/track';
import {
    FILTER_MAX_FREQ,
    FILTER_MIN_FREQ,
} from '@/lib/utils/constants';

// ─── Types ─────────────────────────────────────────────────────

export type LiveFXType =
    | 'stutter'        // Beat-repeat / rhythmic stutter
    | 'filter-sweep'   // LPF/HPF sweep (build-up riser)
    | 'reverb-wash'    // Atmospheric reverb swell
    | 'delay-throw'    // Single phrase echoed into delay
    | 'echo-brake'     // Slowdown echo (like a vinyl brake with echo)
    | 'hp-build';      // High-pass filter riser into drop

export interface ScheduledFX {
    id: string;
    type: LiveFXType;
    triggerTime: number;   // seconds into track
    duration: number;      // how long the effect lasts
    intensity: number;     // 0-1
    executed: boolean;
}

export interface LiveFXState {
    isActive: boolean;
    scheduledEffects: ScheduledFX[];
    activeEffect: ScheduledFX | null;
    nextEffectEta: number | null;
}

// ─── FX Scheduler ──────────────────────────────────────────────

let fxCheckInterval: ReturnType<typeof setInterval> | null = null;
let currentFXDeck: 'A' | 'B' = 'A';
let pendingFXTimeouts: ReturnType<typeof setTimeout>[] = [];
let currentFXState: LiveFXState = {
    isActive: false,
    scheduledEffects: [],
    activeEffect: null,
    nextEffectEta: null,
};
let fxListeners: Array<(state: LiveFXState) => void> = [];

function notifyListeners() {
    fxListeners.forEach(fn => fn({ ...currentFXState }));
}

export function onFXStateChange(listener: (state: LiveFXState) => void): () => void {
    fxListeners.push(listener);
    return () => {
        fxListeners = fxListeners.filter(l => l !== listener);
    };
}

export function getFXState(): LiveFXState {
    return { ...currentFXState };
}

/**
 * Plan and schedule live FX events for a track based on its analysis.
 * Called when a new track starts playing.
 */
export function scheduleLiveFX(
    analysis: TrackAnalysis,
    deck: 'A' | 'B'
): ScheduledFX[] {
    const effects: ScheduledFX[] = [];
    const bpm = analysis.bpm;
    const beatDuration = 60 / bpm;
    const barDuration = beatDuration * 4;

    let fxIdCounter = 0;
    const nextId = () => `fx-${Date.now()}-${fxIdCounter++}`;

    // ─── Strategy 1: Stutter before chorus/drop sections ──────────
    for (const section of analysis.sections) {
        if (section.type === 'chorus' || section.type === 'buildup') {
            // Place a stutter 2 bars before the chorus/drop hits
            const triggerTime = section.startTime - (barDuration * 2);
            if (triggerTime > analysis.introEnd && triggerTime > 4) {
                effects.push({
                    id: nextId(),
                    type: 'stutter',
                    triggerTime: Math.max(0, triggerTime),
                    duration: barDuration * 2,
                    intensity: 0.7 + (section.energy * 0.3),
                    executed: false,
                });
            }
        }
    }

    // ─── Strategy 2: Filter sweep / HP riser before high-energy sections ─
    const energyJumps = findEnergyJumps(analysis.sections);
    for (const jump of energyJumps) {
        // Place a high-pass riser 4 bars before the energy jump
        const riserDuration = Math.min(barDuration * 4, jump.startTime - 2);
        if (riserDuration > barDuration * 2 && jump.startTime > 10) {
            effects.push({
                id: nextId(),
                type: 'hp-build',
                triggerTime: Math.max(0, jump.startTime - riserDuration),
                duration: riserDuration,
                intensity: 0.6,
                executed: false,
            });
        }
    }

    // ─── Strategy 3: Delay throws on phrase boundaries ────────────
    // Every 16 or 32 bars, throw a delay on the last beat of the phrase
    if (analysis.downbeats.length > 16) {
        const phraseLength = 16; // beats per phrase
        for (let i = phraseLength; i < analysis.downbeats.length; i += phraseLength) {
            const phraseEnd = analysis.downbeats[i];
            // Only if we're not in the intro or outro
            if (phraseEnd > analysis.introEnd + 4 && phraseEnd < analysis.outroStart - 8) {
                // Don't overlap with stutter effects
                const overlaps = effects.some(e =>
                    Math.abs(e.triggerTime - phraseEnd) < barDuration * 3 && e.type === 'stutter'
                );
                if (!overlaps) {
                    effects.push({
                        id: nextId(),
                        type: 'delay-throw',
                        triggerTime: phraseEnd - beatDuration,
                        duration: barDuration * 2,
                        intensity: 0.5,
                        executed: false,
                    });
                }
            }
        }
    }

    // ─── Strategy 4: Reverb washes on breakdowns ─────────────────
    for (const section of analysis.sections) {
        if (section.type === 'breakdown' && section.endTime - section.startTime > 4) {
            effects.push({
                id: nextId(),
                type: 'reverb-wash',
                triggerTime: section.startTime,
                duration: Math.min(section.endTime - section.startTime, barDuration * 4),
                intensity: 0.6,
                executed: false,
            });
        }
    }

    // ─── Strategy 5: Echo brake at song climax ───────────────────
    // Find the highest-energy section and place an echo brake at its end
    const highestEnergy = analysis.sections.reduce((best, s) =>
        s.energy > best.energy ? s : best, analysis.sections[0]);
    if (highestEnergy && highestEnergy.type === 'chorus' && highestEnergy.endTime < analysis.outroStart) {
        const ebTime = highestEnergy.endTime - beatDuration * 2;
        const overlaps = effects.some(e =>
            Math.abs(e.triggerTime - ebTime) < barDuration * 2
        );
        if (!overlaps && ebTime > analysis.introEnd) {
            effects.push({
                id: nextId(),
                type: 'echo-brake',
                triggerTime: ebTime,
                duration: barDuration * 1.5,
                intensity: 0.5,
                executed: false,
            });
        }
    }

    // Sort by trigger time
    effects.sort((a, b) => a.triggerTime - b.triggerTime);

    // Remove effects that are too close together (min 4 bars apart)
    const minGap = barDuration * 4;
    const filtered: ScheduledFX[] = [];
    let lastTime = -Infinity;
    for (const fx of effects) {
        if (fx.triggerTime - lastTime >= minGap) {
            filtered.push(fx);
            lastTime = fx.triggerTime + fx.duration;
        }
    }

    currentFXState = {
        isActive: true,
        scheduledEffects: filtered,
        activeEffect: null,
        nextEffectEta: filtered.length > 0 ? filtered[0].triggerTime : null,
    };
    notifyListeners();

    return filtered;
}

/**
 * Start monitoring playback position and firing FX.
 */
export function startFXMonitor(deck: 'A' | 'B', bpm: number): void {
    stopFXMonitor();
    currentFXDeck = deck;
    fxCheckInterval = setInterval(() => {
        const position = audioEngine.getDeckPosition(deck);
        checkAndFireFX(position, deck, bpm);
    }, 50); // Check at ~20fps for tight timing
}

/**
 * Register a setTimeout that will be auto-canceled on FX cleanup.
 */
function fxTimeout(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
        // Remove from pending list once executed
        pendingFXTimeouts = pendingFXTimeouts.filter(t => t !== id);
        fn();
    }, ms);
    pendingFXTimeouts.push(id);
}

/**
 * Stop the FX monitor loop.
 */
export function stopFXMonitor(): void {
    if (fxCheckInterval) {
        clearInterval(fxCheckInterval);
        fxCheckInterval = null;
    }
    // Clean up any active FX
    cleanupActiveFX();
    currentFXState = {
        isActive: false,
        scheduledEffects: [],
        activeEffect: null,
        nextEffectEta: null,
    };
    notifyListeners();
}

// ─── FX Execution ──────────────────────────────────────────────

function checkAndFireFX(position: number, deck: 'A' | 'B', bpm: number): void {
    const pending = currentFXState.scheduledEffects.filter(e => !e.executed);

    // Update next ETA
    const next = pending[0];
    if (next) {
        currentFXState.nextEffectEta = Math.max(0, next.triggerTime - position);
    } else {
        currentFXState.nextEffectEta = null;
    }

    // Check if active effect has ended
    if (currentFXState.activeEffect) {
        const active = currentFXState.activeEffect;
        if (position >= active.triggerTime + active.duration) {
            cleanupActiveFX();
            currentFXState.activeEffect = null;
        }
    }

    // Fire pending effects
    for (const fx of pending) {
        if (position >= fx.triggerTime && position < fx.triggerTime + fx.duration && !fx.executed) {
            executeFX(fx, deck, bpm);
            fx.executed = true;
            currentFXState.activeEffect = fx;
            break; // Only one FX at a time
        }
    }

    notifyListeners();
}

function executeFX(fx: ScheduledFX, deck: 'A' | 'B', bpm: number): void {
    const deckNodes = audioEngine.getDeck(deck);
    if (!deckNodes) return;

    const beatDuration = 60 / bpm;
    const ctx = audioEngine.context;
    if (!ctx) return;

    switch (fx.type) {
        case 'stutter':
            executeStutter(deckNodes, fx, bpm, deck);
            break;
        case 'hp-build':
            executeHPBuild(deckNodes, fx, bpm);
            break;
        case 'delay-throw':
            executeDelayThrow(deckNodes, fx, bpm);
            break;
        case 'reverb-wash':
            executeReverbWash(deckNodes, fx);
            break;
        case 'echo-brake':
            executeEchoBrake(deckNodes, fx, bpm);
            break;
        case 'filter-sweep':
            executeFilterSweep(deckNodes, fx);
            break;
    }
}

/**
 * Stutter / Beat-Repeat effect.
 * Rapidly gates the audio on/off at increasing subdivisions:
 * 1/4 → 1/8 → 1/16 to create a rhythmic stutter build.
 */
function executeStutter(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
    bpm: number,
    deck: 'A' | 'B'
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;
    const beatDur = 60 / bpm;
    const totalBeats = Math.floor(fx.duration / beatDur);

    // Cancel existing automation on gain
    deckNodes.outputGain.gain.cancelScheduledValues(now);
    deckNodes.outputGain.gain.setValueAtTime(1, now);

    // Create a stutter pattern: start with 1/4 notes, accelerate to 1/8, then 1/16
    let t = 0;
    const phases = [
        { subdivision: 4, beats: Math.floor(totalBeats * 0.3) },   // 1/4 note gating
        { subdivision: 8, beats: Math.floor(totalBeats * 0.4) },   // 1/8 note gating
        { subdivision: 16, beats: Math.floor(totalBeats * 0.3) },  // 1/16 note gating
    ];

    for (const phase of phases) {
        const noteDur = beatDur / (phase.subdivision / 4);
        const gateOn = noteDur * 0.6;  // 60% on
        const gateOff = noteDur * 0.4; // 40% off

        for (let i = 0; i < phase.beats * (phase.subdivision / 4); i++) {
            const absT = now + t;
            if (t > fx.duration) break;

            // Gate ON
            deckNodes.outputGain.gain.setValueAtTime(1.0, absT);
            // Gate OFF
            deckNodes.outputGain.gain.setValueAtTime(
                0.05 * (1 - fx.intensity), absT + gateOn
            );

            t += noteDur;
        }
    }

    // Restore full volume at end
    deckNodes.outputGain.gain.setValueAtTime(1.0, now + fx.duration);

    // Also add increasing filter sweep during stutter for extra build
    deckNodes.filter.type = 'highpass';
    deckNodes.filter.frequency.cancelScheduledValues(now);
    deckNodes.filter.frequency.setValueAtTime(FILTER_MIN_FREQ, now);
    deckNodes.filter.frequency.linearRampToValueAtTime(
        800 * fx.intensity, now + fx.duration * 0.9
    );
    // Snap back to lowpass at end
    deckNodes.filter.frequency.setValueAtTime(FILTER_MIN_FREQ, now + fx.duration);

    // Schedule filter type restoration
    fxTimeout(() => {
        if (deckNodes) {
            deckNodes.filter.type = 'lowpass';
            deckNodes.filter.frequency.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(deckNodes.filter.frequency, FILTER_MAX_FREQ);
        }
    }, fx.duration * 1000 + 50);
}

/**
 * High-Pass Build / Riser effect.
 * Gradually raises the high-pass filter frequency to create a
 * build-up tension effect before a drop/chorus.
 */
function executeHPBuild(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
    bpm: number
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;

    // Switch to highpass and sweep up
    deckNodes.filter.type = 'highpass';
    deckNodes.filter.Q.cancelScheduledValues(now);
    deckNodes.filter.Q.setValueAtTime(2, now); // Resonant peak for dramatic effect
    deckNodes.filter.frequency.cancelScheduledValues(now);
    deckNodes.filter.frequency.setValueAtTime(FILTER_MIN_FREQ, now);

    // Exponential sweep up to cutoff — creates the classic riser effect
    deckNodes.filter.frequency.exponentialRampToValueAtTime(
        2000 * fx.intensity, now + fx.duration * 0.85
    );

    // Snap back (the "drop")
    deckNodes.filter.frequency.setValueAtTime(FILTER_MIN_FREQ, now + fx.duration);

    // Restore filter
    fxTimeout(() => {
        if (deckNodes) {
            deckNodes.filter.type = 'lowpass';
            deckNodes.filter.Q.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(deckNodes.filter.Q, 0.707);
            deckNodes.filter.frequency.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(deckNodes.filter.frequency, FILTER_MAX_FREQ);
        }
    }, fx.duration * 1000 + 50);
}

/**
 * Delay Throw effect.
 * Briefly opens the delay send on the last beat/phrase, creating
 * a rhythmic echo tail. Classic DJ technique.
 */
function executeDelayThrow(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
    bpm: number
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;
    const beatDur = 60 / bpm;

    // Set delay time to match tempo (dotted 8th for groove)
    const delayNode = audioEngine.getDelayNode();
    const delayFB = audioEngine.getDelayFeedback();
    if (delayNode && delayFB) {
        delayNode.delayTime.cancelScheduledValues(now);
        delayNode.delayTime.setValueAtTime(beatDur * 0.75, now); // dotted 8th

        delayFB.gain.cancelScheduledValues(now);
        delayFB.gain.setValueAtTime(0.55 * fx.intensity, now);
        delayFB.gain.linearRampToValueAtTime(0.15, now + fx.duration);
    }

    // Open delay send
    deckNodes.delaySend.gain.cancelScheduledValues(now);
    deckNodes.delaySend.gain.setValueAtTime(0, now);
    deckNodes.delaySend.gain.linearRampToValueAtTime(
        0.6 * fx.intensity, now + beatDur * 0.5
    );
    // Hold for one bar
    deckNodes.delaySend.gain.setValueAtTime(
        0.6 * fx.intensity, now + beatDur * 2
    );
    // Fade out
    deckNodes.delaySend.gain.linearRampToValueAtTime(0, now + fx.duration);

    // Restore delay feedback after effect
    fxTimeout(() => {
        if (delayFB) {
            delayFB.gain.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(delayFB.gain, 0.3);
        }
    }, fx.duration * 1000 + 100);
}

/**
 * Reverb Wash effect.
 * Opens the reverb send during breakdowns for an atmospheric,
 * spacious feel. Mimics a DJ opening the reverb on a breakdown.
 */
function executeReverbWash(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;

    // Ramp reverb send up
    deckNodes.reverbSend.gain.cancelScheduledValues(now);
    deckNodes.reverbSend.gain.setValueAtTime(0, now);
    deckNodes.reverbSend.gain.linearRampToValueAtTime(
        0.5 * fx.intensity, now + fx.duration * 0.3
    );
    // Hold
    deckNodes.reverbSend.gain.linearRampToValueAtTime(
        0.45 * fx.intensity, now + fx.duration * 0.7
    );
    // Fade out
    deckNodes.reverbSend.gain.linearRampToValueAtTime(0, now + fx.duration);
}

/**
 * Echo Brake effect.
 * Combines a gain stutter with delay feedback to create a
 * "winding down" effect at the end of a high-energy section.
 */
function executeEchoBrake(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
    bpm: number
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;
    const beatDur = 60 / bpm;

    // Open delay send
    const delayNode = audioEngine.getDelayNode();
    const delayFB = audioEngine.getDelayFeedback();

    if (delayNode && delayFB) {
        delayNode.delayTime.cancelScheduledValues(now);
        delayNode.delayTime.setValueAtTime(beatDur * 0.5, now);
        // Slow down the delay time (creates pitch-down echo)
        delayNode.delayTime.linearRampToValueAtTime(
            beatDur * 1.5, now + fx.duration
        );

        delayFB.gain.cancelScheduledValues(now);
        delayFB.gain.setValueAtTime(0.6, now);
        delayFB.gain.linearRampToValueAtTime(0.2, now + fx.duration);
    }

    // Send to delay
    deckNodes.delaySend.gain.cancelScheduledValues(now);
    deckNodes.delaySend.gain.setValueAtTime(0.5 * fx.intensity, now);
    deckNodes.delaySend.gain.linearRampToValueAtTime(0, now + fx.duration);

    // Brief gain dip for dramatic effect
    deckNodes.outputGain.gain.cancelScheduledValues(now);
    deckNodes.outputGain.gain.setValueAtTime(1, now);
    deckNodes.outputGain.gain.linearRampToValueAtTime(0.4, now + fx.duration * 0.5);
    deckNodes.outputGain.gain.linearRampToValueAtTime(1, now + fx.duration);

    fxTimeout(() => {
        if (delayNode && delayFB) {
            delayNode.delayTime.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(delayNode.delayTime, 0.375);
            delayFB.gain.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(delayFB.gain, 0.3);
        }
    }, fx.duration * 1000 + 100);
}

/**
 * Filter Sweep effect.
 * Classic LP filter sweep down and back up.
 */
function executeFilterSweep(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;

    deckNodes.filter.type = 'lowpass';
    deckNodes.filter.Q.cancelScheduledValues(now);
    deckNodes.filter.Q.setValueAtTime(3, now); // Resonant
    deckNodes.filter.frequency.cancelScheduledValues(now);
    deckNodes.filter.frequency.setValueAtTime(FILTER_MAX_FREQ, now);

    // Sweep down
    deckNodes.filter.frequency.exponentialRampToValueAtTime(
        200, now + fx.duration * 0.5
    );
    // Sweep back up
    deckNodes.filter.frequency.exponentialRampToValueAtTime(
        FILTER_MAX_FREQ, now + fx.duration
    );

    fxTimeout(() => {
        if (deckNodes) {
            deckNodes.filter.Q.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(deckNodes.filter.Q, 0.707);
        }
    }, fx.duration * 1000 + 50);
}

// ─── Cleanup ───────────────────────────────────────────────────

function cleanupActiveFX(): void {
    const ctx = audioEngine.context;
    if (!ctx) return;

    // Cancel all pending setTimeout callbacks from FX effects
    // This prevents them from firing during transitions
    for (const id of pendingFXTimeouts) {
        clearTimeout(id);
    }
    pendingFXTimeouts = [];

    // Only reset the deck that was running FX (not both!)
    const deckNodes = audioEngine.getDeck(currentFXDeck);
    if (deckNodes) {
        // Reset filter
        deckNodes.filter.type = 'lowpass';
        audioEngine.setParam(deckNodes.filter.frequency, FILTER_MAX_FREQ);
        audioEngine.setParam(deckNodes.filter.Q, 0.707);

        // Reset output gain
        audioEngine.setParam(deckNodes.outputGain.gain, 1);

        // Reset sends
        audioEngine.setParam(deckNodes.reverbSend.gain, 0);
        audioEngine.setParam(deckNodes.delaySend.gain, 0);
    }

    // Reset shared delay params
    const delayFB = audioEngine.getDelayFeedback();
    if (delayFB) {
        audioEngine.setParam(delayFB.gain, 0.3);
    }
    const delayNode = audioEngine.getDelayNode();
    if (delayNode) {
        audioEngine.setParam(delayNode.delayTime, 0.375);
    }
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Find points where energy jumps significantly (build → drop moments).
 */
function findEnergyJumps(sections: TrackSection[]): TrackSection[] {
    const jumps: TrackSection[] = [];
    for (let i = 1; i < sections.length; i++) {
        const prev = sections[i - 1];
        const curr = sections[i];
        // Significant energy increase (breakdown → chorus, verse → chorus)
        if (curr.energy - prev.energy > 0.25 && curr.energy > 0.6) {
            jumps.push(curr);
        }
    }
    return jumps;
}
