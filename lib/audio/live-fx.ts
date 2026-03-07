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
    | 'stutter'           // Beat-repeat / rhythmic stutter
    | 'filter-sweep'      // LPF/HPF sweep (build-up riser)
    | 'reverb-wash'       // Atmospheric reverb swell
    | 'delay-throw'       // Single phrase echoed into delay
    | 'echo-brake'        // Slowdown echo (like a vinyl brake with echo)
    | 'hp-build'          // High-pass filter riser into drop
    | 'vinyl-brake'       // Turntable slowdown / pitch-drop effect
    | 'white-noise-riser' // White noise sweep build-up
    | 'filter-pulse'      // Rhythmic LPF wobble / gate
    | 'reverb-splash'     // Quick reverb accent on a phrase boundary
    | 'sub-drop'          // Sub-bass impact / boom
    | 'ambient-wash'      // Gentle delay+reverb texture in quiet sections
    | 'micro-stutter'     // Very short stutter accent (2-4 beats)
    | 'sweep-accent';     // Quick HPF sweep accent at section transitions

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
    activeEffects: ScheduledFX[];
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
    activeEffects: [],
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

    // ─── Strategy 6: Filter sweep on verse → chorus transitions ──
    for (let i = 1; i < analysis.sections.length; i++) {
        const prev = analysis.sections[i - 1];
        const curr = analysis.sections[i];
        if ((prev.type === 'verse' || prev.type === 'bridge') &&
            (curr.type === 'chorus' || curr.type === 'buildup')) {
            const sweepDur = Math.min(barDuration * 2, prev.endTime - prev.startTime);
            const triggerTime = curr.startTime - sweepDur;
            if (triggerTime > analysis.introEnd && sweepDur > barDuration) {
                effects.push({
                    id: nextId(),
                    type: 'filter-sweep',
                    triggerTime,
                    duration: sweepDur,
                    intensity: 0.65,
                    executed: false,
                });
            }
        }
    }

    // ─── Strategy 7: Extra delay throws in high-energy choruses ──
    for (const section of analysis.sections) {
        if (section.type === 'chorus' && section.energy > 0.65) {
            const secLen = section.endTime - section.startTime;
            if (secLen > barDuration * 8) {
                // Place a delay throw midway through the chorus
                const midPoint = section.startTime + secLen * 0.5;
                effects.push({
                    id: nextId(),
                    type: 'delay-throw',
                    triggerTime: midPoint,
                    duration: barDuration * 1.5,
                    intensity: 0.45,
                    executed: false,
                });
            }
        }
    }

    // ─── Strategy 8: Reverb accents on verses ────────────────────
    for (const section of analysis.sections) {
        if (section.type === 'verse' && section.endTime - section.startTime > barDuration * 4) {
            // Light reverb wash in the second half of the verse
            const halfPoint = section.startTime + (section.endTime - section.startTime) * 0.5;
            effects.push({
                id: nextId(),
                type: 'reverb-wash',
                triggerTime: halfPoint,
                duration: barDuration * 2,
                intensity: 0.35,
                executed: false,
            });
        }
    }

    // ─── Strategy 9: Stutter fills in high-energy sections ───────
    // Every 8 bars in a high-energy section, add a short stutter fill
    for (const section of analysis.sections) {
        if (section.energy > 0.7 && (section.type === 'chorus' || section.type === 'buildup')) {
            const secLen = section.endTime - section.startTime;
            const fillInterval = barDuration * 8;
            for (let t = section.startTime + fillInterval; t < section.endTime - barDuration * 2; t += fillInterval) {
                effects.push({
                    id: nextId(),
                    type: 'stutter',
                    triggerTime: t - barDuration,
                    duration: barDuration,
                    intensity: 0.5,
                    executed: false,
                });
            }
        }
    }

    // ─── Strategy 10: Vinyl brake at breakdown endings ──────────
    for (let i = 1; i < analysis.sections.length; i++) {
        const prev = analysis.sections[i - 1];
        const curr = analysis.sections[i];
        if (prev.type === 'breakdown' && (curr.type === 'chorus' || curr.type === 'buildup')) {
            const brakeTime = prev.endTime - beatDuration * 4;
            if (brakeTime > analysis.introEnd) {
                effects.push({
                    id: nextId(),
                    type: 'vinyl-brake',
                    triggerTime: brakeTime,
                    duration: beatDuration * 3,
                    intensity: 0.6,
                    executed: false,
                });
            }
        }
    }

    // ─── Strategy 11: White noise riser on buildups ─────────────
    for (const section of analysis.sections) {
        if (section.type === 'buildup' && section.endTime - section.startTime > barDuration * 2) {
            effects.push({
                id: nextId(),
                type: 'white-noise-riser',
                triggerTime: section.startTime,
                duration: Math.min(section.endTime - section.startTime, barDuration * 4),
                intensity: 0.55,
                executed: false,
            });
        }
    }

    // ─── Strategy 12: Filter pulse on chorus bars ────────────────
    // Rhythmic LPF wobble every 4 bars in choruses for groove
    for (const section of analysis.sections) {
        if ((section.type === 'chorus' || section.type === 'buildup') && section.energy > 0.55) {
            const secLen = section.endTime - section.startTime;
            // Every 4 bars, add a short filter pulse
            for (let t = section.startTime + barDuration * 4; t < section.endTime - barDuration * 2; t += barDuration * 4) {
                const overlaps = effects.some(e =>
                    Math.abs(e.triggerTime - t) < barDuration * 1.5
                );
                if (!overlaps) {
                    effects.push({
                        id: nextId(),
                        type: 'filter-pulse',
                        triggerTime: t,
                        duration: barDuration * 2,
                        intensity: 0.4 + section.energy * 0.2,
                        executed: false,
                    });
                }
            }
        }
    }

    // ─── Strategy 13: Reverb splash at phrase boundaries ────────
    // Quick reverb accent at every 8-bar boundary
    if (analysis.downbeats.length > 32) {
        for (let i = 32; i < analysis.downbeats.length; i += 32) {
            const phraseEnd = analysis.downbeats[i];
            if (phraseEnd > analysis.introEnd + 8 && phraseEnd < analysis.outroStart - 4) {
                const overlaps = effects.some(e =>
                    Math.abs(e.triggerTime - phraseEnd) < barDuration * 1.2
                );
                if (!overlaps) {
                    effects.push({
                        id: nextId(),
                        type: 'reverb-splash',
                        triggerTime: phraseEnd - beatDuration,
                        duration: barDuration * 1.5,
                        intensity: 0.5,
                        executed: false,
                    });
                }
            }
        }
    }

    // ─── Strategy 14: Sub drop on major section transitions ─────
    // Low-end boom when transitioning from low to high energy sections
    for (let i = 1; i < analysis.sections.length; i++) {
        const prev = analysis.sections[i - 1];
        const curr = analysis.sections[i];
        if (curr.energy - prev.energy > 0.15 && curr.energy > 0.5) {
            effects.push({
                id: nextId(),
                type: 'sub-drop',
                triggerTime: curr.startTime,
                duration: beatDuration * 2,
                intensity: Math.min(1, curr.energy),
                executed: false,
            });
        }
    }

    // ─── Strategy 15: Ambient wash during low-energy sections ───
    // Gentle delay+reverb texture during verses and quieter parts
    for (const section of analysis.sections) {
        if ((section.type === 'verse' || section.type === 'bridge' || section.type === 'intro') &&
            section.energy < 0.6) {
            const secLen = section.endTime - section.startTime;
            if (secLen > barDuration * 8) {
                // Place ambient wash in the middle of the section
                const triggerTime = section.startTime + secLen * 0.3;
                effects.push({
                    id: nextId(),
                    type: 'ambient-wash',
                    triggerTime,
                    duration: Math.min(barDuration * 6, secLen * 0.4),
                    intensity: 0.3,
                    executed: false,
                });
            }
        }
    }

    // ─── Strategy 16: Micro-stutter fills every 16 bars ─────────
    // Short rhythmic fills in mid-energy sections to keep things interesting
    for (const section of analysis.sections) {
        if (section.energy > 0.4 && section.energy < 0.8 &&
            section.type !== 'intro' && section.type !== 'outro') {
            const secLen = section.endTime - section.startTime;
            for (let t = section.startTime + barDuration * 12;
                t < section.endTime - barDuration * 4;
                t += barDuration * 16) {
                const overlaps = effects.some(e =>
                    Math.abs(e.triggerTime - t) < barDuration * 1.5
                );
                if (!overlaps) {
                    effects.push({
                        id: nextId(),
                        type: 'micro-stutter',
                        triggerTime: t,
                        duration: beatDuration * 3,
                        intensity: 0.4,
                        executed: false,
                    });
                }
            }
        }
    }

    // ─── Strategy 17: Sweep accent at section transitions ───────
    // Quick HPF sweep accent to "breathe" between sections
    for (let i = 1; i < analysis.sections.length; i++) {
        const curr = analysis.sections[i];
        if (curr.startTime > analysis.introEnd + 4 && curr.startTime < analysis.outroStart - 4) {
            const overlaps = effects.some(e =>
                Math.abs(e.triggerTime - curr.startTime) < barDuration * 1.5
            );
            if (!overlaps) {
                effects.push({
                    id: nextId(),
                    type: 'sweep-accent',
                    triggerTime: curr.startTime - beatDuration * 2,
                    duration: beatDuration * 3,
                    intensity: 0.35,
                    executed: false,
                });
            }
        }
    }

    // Sort by trigger time
    effects.sort((a, b) => a.triggerTime - b.triggerTime);

    // Remove effects that are too close together (min 1 bar apart)
    // Reduced from 2 bars to allow denser FX scheduling
    const minGap = barDuration * 1;
    const filtered: ScheduledFX[] = [];
    let lastTime = -Infinity;
    for (const fx of effects) {
        if (fx.triggerTime - lastTime >= minGap) {
            filtered.push(fx);
            lastTime = fx.triggerTime + fx.duration;
        }
    }

    // ─── Fallback: If analysis is sparse, add periodic FX ───────
    // Ensures something is always happening even with poor section detection
    if (filtered.length < 6 && analysis.durationSeconds > 60) {
        const trackMiddle = analysis.introEnd + 10;
        const trackEnd = analysis.outroStart - 10;
        const interval = barDuration * 12; // Every ~12 bars
        for (let t = trackMiddle; t < trackEnd; t += interval) {
            const overlaps = filtered.some(e =>
                Math.abs(e.triggerTime - t) < barDuration * 2
            );
            if (!overlaps) {
                // Alternate between delay throws and reverb washes
                const fxType: LiveFXType = Math.random() > 0.5 ? 'delay-throw' : 'reverb-wash';
                filtered.push({
                    id: nextId(),
                    type: fxType,
                    triggerTime: t,
                    duration: barDuration * 2,
                    intensity: 0.4,
                    executed: false,
                });
            }
        }
        filtered.sort((a, b) => a.triggerTime - b.triggerTime);
    }

    currentFXState = {
        isActive: true,
        scheduledEffects: filtered,
        activeEffect: null,
        activeEffects: [],
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
        activeEffects: [],
        nextEffectEta: null,
    };
    notifyListeners();
}

// ─── FX Execution ──────────────────────────────────────────────

// FX compatibility groups — effects in different groups can run concurrently
// Effects in the same group conflict and should not overlap
const FX_GROUPS: Record<LiveFXType, string> = {
    'stutter': 'gain',
    'micro-stutter': 'gain',
    'filter-sweep': 'filter',
    'filter-pulse': 'filter',
    'hp-build': 'filter',
    'sweep-accent': 'filter',
    'reverb-wash': 'reverb',
    'reverb-splash': 'reverb',
    'ambient-wash': 'delay-reverb',
    'delay-throw': 'delay',
    'echo-brake': 'delay',
    'vinyl-brake': 'playback',
    'white-noise-riser': 'noise',
    'sub-drop': 'sub',
};

function checkAndFireFX(position: number, deck: 'A' | 'B', bpm: number): void {
    const pending = currentFXState.scheduledEffects.filter(e => !e.executed);

    // Update next ETA
    const next = pending[0];
    if (next) {
        currentFXState.nextEffectEta = Math.max(0, next.triggerTime - position);
    } else {
        currentFXState.nextEffectEta = null;
    }

    // Clean up individual active effects that have ended
    if (currentFXState.activeEffects.length > 0) {
        const stillActive: ScheduledFX[] = [];
        for (const active of currentFXState.activeEffects) {
            if (position >= active.triggerTime + active.duration) {
                // This effect has ended — clean up its resources
                cleanupSingleFX(active, deck);
            } else {
                stillActive.push(active);
            }
        }
        currentFXState.activeEffects = stillActive;
    }

    // Also update legacy activeEffect for UI display (show the most recent)
    currentFXState.activeEffect = currentFXState.activeEffects.length > 0
        ? currentFXState.activeEffects[currentFXState.activeEffects.length - 1]
        : null;

    // Get currently active FX groups
    const activeGroups = new Set(
        currentFXState.activeEffects.map((e: ScheduledFX) => FX_GROUPS[e.type])
    );

    // Fire pending effects — allow multiple if they're in different groups
    const LATE_FIRE_TOLERANCE = 1.0; // seconds — fire missed FX up to 1s late
    for (const fx of pending) {
        if (fx.executed) continue;

        const inWindow = position >= fx.triggerTime && position < fx.triggerTime + fx.duration;
        const justMissed = position >= fx.triggerTime + fx.duration &&
            position < fx.triggerTime + fx.duration + LATE_FIRE_TOLERANCE;

        if (inWindow || justMissed) {
            const fxGroup = FX_GROUPS[fx.type];
            // Allow if no conflicting FX group is active
            if (!activeGroups.has(fxGroup)) {
                executeFX(fx, deck, bpm);
                fx.executed = true;
                currentFXState.activeEffects.push(fx);
                activeGroups.add(fxGroup);
            }
        }

        // Mark as executed if we've completely passed its window + tolerance
        if (position > fx.triggerTime + fx.duration + LATE_FIRE_TOLERANCE) {
            fx.executed = true;
        }
    }

    notifyListeners();
}

/**
 * Clean up resources for a single effect that has ended,
 * without disturbing other active effects.
 */
function cleanupSingleFX(fx: ScheduledFX, deck: 'A' | 'B'): void {
    const ctx = audioEngine.context;
    if (!ctx) return;
    const deckNodes = audioEngine.getDeck(deck);
    if (!deckNodes) return;

    const group = FX_GROUPS[fx.type];
    switch (group) {
        case 'filter':
            // Reset filter
            deckNodes.filter.type = 'lowpass';
            audioEngine.setParam(deckNodes.filter.frequency, FILTER_MAX_FREQ);
            audioEngine.setParam(deckNodes.filter.Q, 0.707);
            break;
        case 'gain':
            // Reset output gain
            audioEngine.setParam(deckNodes.outputGain.gain, 1);
            break;
        case 'reverb':
            // Reset reverb send
            audioEngine.setParam(deckNodes.reverbSend.gain, 0);
            break;
        case 'delay':
        case 'delay-reverb': {
            // Reset delay and reverb sends
            audioEngine.setParam(deckNodes.delaySend.gain, 0);
            audioEngine.setParam(deckNodes.reverbSend.gain, 0);
            const delayFB = audioEngine.getDelayFeedback();
            if (delayFB) audioEngine.setParam(delayFB.gain, 0.3);
            const delayNode = audioEngine.getDelayNode();
            if (delayNode) audioEngine.setParam(delayNode.delayTime, 0.375);
            break;
        }
        case 'playback':
            // Reset playback rate
            if (deckNodes.source) {
                deckNodes.source.playbackRate.cancelScheduledValues(ctx.currentTime);
                deckNodes.source.playbackRate.setValueAtTime(1, ctx.currentTime);
            }
            audioEngine.setParam(deckNodes.outputGain.gain, 1);
            audioEngine.setParam(deckNodes.reverbSend.gain, 0);
            break;
        // 'noise' and 'sub' clean themselves up via onended callbacks
    }
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
        case 'vinyl-brake':
            executeVinylBrake(deckNodes, fx, bpm);
            break;
        case 'white-noise-riser':
            executeWhiteNoiseRiser(fx);
            break;
        case 'filter-pulse':
            executeFilterPulse(deckNodes, fx, bpm);
            break;
        case 'reverb-splash':
            executeReverbSplash(deckNodes, fx);
            break;
        case 'sub-drop':
            executeSubDrop(fx);
            break;
        case 'ambient-wash':
            executeAmbientWash(deckNodes, fx, bpm);
            break;
        case 'micro-stutter':
            executeMicroStutter(deckNodes, fx, bpm, deck);
            break;
        case 'sweep-accent':
            executeSweepAccent(deckNodes, fx);
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

/**
 * Vinyl Brake effect.
 * Simulates a turntable power-down by ramping the playback rate
 * down and ducking the gain, creating that classic DJ "stop" sound.
 */
function executeVinylBrake(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
    bpm: number
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;
    if (!deckNodes.source) return;

    const now = ctx.currentTime;

    // Ramp playback rate down to simulate vinyl brake
    deckNodes.source.playbackRate.cancelScheduledValues(now);
    deckNodes.source.playbackRate.setValueAtTime(1, now);
    deckNodes.source.playbackRate.exponentialRampToValueAtTime(
        0.3, now + fx.duration * 0.8
    );
    // Snap back to normal
    deckNodes.source.playbackRate.setValueAtTime(1, now + fx.duration);

    // Duck the gain slightly during the brake
    deckNodes.outputGain.gain.cancelScheduledValues(now);
    deckNodes.outputGain.gain.setValueAtTime(1, now);
    deckNodes.outputGain.gain.linearRampToValueAtTime(0.3, now + fx.duration * 0.85);
    deckNodes.outputGain.gain.setValueAtTime(1, now + fx.duration);

    // Add reverb tail during the brake for atmosphere
    deckNodes.reverbSend.gain.cancelScheduledValues(now);
    deckNodes.reverbSend.gain.setValueAtTime(0, now);
    deckNodes.reverbSend.gain.linearRampToValueAtTime(
        0.4 * fx.intensity, now + fx.duration * 0.5
    );
    deckNodes.reverbSend.gain.linearRampToValueAtTime(0, now + fx.duration);

    fxTimeout(() => {
        if (deckNodes?.source) {
            deckNodes.source.playbackRate.cancelScheduledValues(ctx.currentTime);
            deckNodes.source.playbackRate.setValueAtTime(1, ctx.currentTime);
        }
        if (deckNodes) {
            audioEngine.setParam(deckNodes.outputGain.gain, 1);
            audioEngine.setParam(deckNodes.reverbSend.gain, 0);
        }
    }, fx.duration * 1000 + 50);
}

/**
 * White Noise Riser effect.
 * Creates a rising white noise sweep that builds tension before a drop.
 * Uses a dynamically created noise buffer with a sweeping bandpass filter.
 */
let activeNoiseSource: AudioBufferSourceNode | null = null;
let activeNoiseGain: GainNode | null = null;
let activeNoiseFilter: BiquadFilterNode | null = null;

function executeWhiteNoiseRiser(
    fx: ScheduledFX,
): void {
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;

    // Generate white noise buffer
    const bufferSize = Math.floor(ctx.sampleRate * fx.duration);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    // Create noise source
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Bandpass filter that sweeps up
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.Q.value = 2;
    noiseFilter.frequency.setValueAtTime(200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(
        8000, now + fx.duration * 0.9
    );

    // Gain envelope: fade in, then cut at the drop
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(
        0.18 * fx.intensity, now + fx.duration * 0.85
    );
    noiseGain.gain.linearRampToValueAtTime(0, now + fx.duration);

    // Connect: noise → filter → gain → master analyser
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    const masterAnalyser = audioEngine.getMasterAnalyser();
    if (masterAnalyser) {
        noiseGain.connect(masterAnalyser);
    } else {
        noiseGain.connect(ctx.destination);
    }

    activeNoiseSource = noiseSource;
    activeNoiseGain = noiseGain;
    activeNoiseFilter = noiseFilter;

    noiseSource.start(now);
    noiseSource.stop(now + fx.duration);

    noiseSource.onended = () => {
        noiseSource.disconnect();
        noiseFilter.disconnect();
        noiseGain.disconnect();
        activeNoiseSource = null;
        activeNoiseGain = null;
        activeNoiseFilter = null;
    };
}

/**
 * Filter Pulse effect.
 * Rhythmic LPF wobble that pulses in time with the beat,
 * creating a subtle "pumping" groove effect.
 */
function executeFilterPulse(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
    bpm: number
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;
    const beatDur = 60 / bpm;

    deckNodes.filter.type = 'lowpass';
    deckNodes.filter.Q.cancelScheduledValues(now);
    deckNodes.filter.Q.setValueAtTime(3, now); // Resonant for audible wobble
    deckNodes.filter.frequency.cancelScheduledValues(now);

    // Create a rhythmic LPF pulse: high → low → high on each beat
    const numPulses = Math.floor(fx.duration / beatDur);
    for (let i = 0; i < numPulses; i++) {
        const t = now + i * beatDur;
        // Open (high freq)
        deckNodes.filter.frequency.setValueAtTime(FILTER_MAX_FREQ, t);
        // Close (dip to cutoff)
        const intensity = 1200 + (1 - fx.intensity) * 4000; // lower = more dramatic
        deckNodes.filter.frequency.linearRampToValueAtTime(
            intensity, t + beatDur * 0.3
        );
        // Open back up
        deckNodes.filter.frequency.linearRampToValueAtTime(
            FILTER_MAX_FREQ, t + beatDur * 0.8
        );
    }

    // Restore at end
    deckNodes.filter.frequency.setValueAtTime(FILTER_MAX_FREQ, now + fx.duration);

    fxTimeout(() => {
        if (deckNodes) {
            deckNodes.filter.Q.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(deckNodes.filter.Q, 0.707);
            deckNodes.filter.frequency.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(deckNodes.filter.frequency, FILTER_MAX_FREQ);
        }
    }, fx.duration * 1000 + 50);
}

/**
 * Reverb Splash effect.
 * Quick burst of reverb on a phrase boundary — like a DJ
 * flicking the reverb on for one beat then off.
 */
function executeReverbSplash(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;

    // Quick burst: ramp up fast, hold briefly, fade out
    deckNodes.reverbSend.gain.cancelScheduledValues(now);
    deckNodes.reverbSend.gain.setValueAtTime(0, now);
    // Quick ramp to peak
    deckNodes.reverbSend.gain.linearRampToValueAtTime(
        0.65 * fx.intensity, now + fx.duration * 0.15
    );
    // Hold
    deckNodes.reverbSend.gain.setValueAtTime(
        0.65 * fx.intensity, now + fx.duration * 0.4
    );
    // Gradual fade
    deckNodes.reverbSend.gain.linearRampToValueAtTime(0, now + fx.duration);
}

/**
 * Sub Drop effect.
 * Creates a low-frequency impact "boom" using a synthesized sine wave
 * that sweeps down in pitch. Classic EDM/trap impact sound.
 */
let activeSubSource: OscillatorNode | null = null;
let activeSubGain: GainNode | null = null;

function executeSubDrop(
    fx: ScheduledFX,
): void {
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;

    // Clean up any previous sub
    if (activeSubSource) {
        try { activeSubSource.stop(); } catch { /* already stopped */ }
        activeSubSource.disconnect();
        activeSubSource = null;
    }
    if (activeSubGain) {
        activeSubGain.disconnect();
        activeSubGain = null;
    }

    // Create a sine oscillator for the sub boom
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Start at ~80Hz, sweep down to ~30Hz (deep sub thump)
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + fx.duration);

    // Gain envelope: quick attack, gradual decay
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
        0.25 * fx.intensity, now + 0.02 // Very fast attack
    );
    gain.gain.exponentialRampToValueAtTime(0.001, now + fx.duration);

    // Connect to output
    osc.connect(gain);
    const masterAnalyser = audioEngine.getMasterAnalyser();
    if (masterAnalyser) {
        gain.connect(masterAnalyser);
    } else {
        gain.connect(ctx.destination);
    }

    activeSubSource = osc;
    activeSubGain = gain;

    osc.start(now);
    osc.stop(now + fx.duration);

    osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        activeSubSource = null;
        activeSubGain = null;
    };
}

/**
 * Ambient Wash effect.
 * Gentle delay + reverb texture for quieter sections.
 * Creates a subtle spacious atmosphere without being intrusive.
 */
function executeAmbientWash(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
    bpm: number
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;
    const beatDur = 60 / bpm;

    // Gentle reverb swell
    deckNodes.reverbSend.gain.cancelScheduledValues(now);
    deckNodes.reverbSend.gain.setValueAtTime(0, now);
    // Slow fade in
    deckNodes.reverbSend.gain.linearRampToValueAtTime(
        0.3 * fx.intensity, now + fx.duration * 0.3
    );
    // Hold
    deckNodes.reverbSend.gain.linearRampToValueAtTime(
        0.25 * fx.intensity, now + fx.duration * 0.7
    );
    // Slow fade out
    deckNodes.reverbSend.gain.linearRampToValueAtTime(0, now + fx.duration);

    // Gentle delay wash alongside
    const delayNode = audioEngine.getDelayNode();
    const delayFB = audioEngine.getDelayFeedback();
    if (delayNode && delayFB) {
        delayNode.delayTime.cancelScheduledValues(now);
        delayNode.delayTime.setValueAtTime(beatDur * 1.5, now); // Long delay for ambience

        delayFB.gain.cancelScheduledValues(now);
        delayFB.gain.setValueAtTime(0.3, now);
        delayFB.gain.linearRampToValueAtTime(0.45, now + fx.duration * 0.5);
        delayFB.gain.linearRampToValueAtTime(0.3, now + fx.duration);
    }

    deckNodes.delaySend.gain.cancelScheduledValues(now);
    deckNodes.delaySend.gain.setValueAtTime(0, now);
    deckNodes.delaySend.gain.linearRampToValueAtTime(
        0.2 * fx.intensity, now + fx.duration * 0.3
    );
    deckNodes.delaySend.gain.linearRampToValueAtTime(0, now + fx.duration);

    fxTimeout(() => {
        if (delayFB) {
            delayFB.gain.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(delayFB.gain, 0.3);
        }
        if (delayNode) {
            delayNode.delayTime.cancelScheduledValues(ctx.currentTime);
            audioEngine.setParam(delayNode.delayTime, 0.375);
        }
    }, fx.duration * 1000 + 100);
}

/**
 * Micro-Stutter effect.
 * Very short rhythmic chop (2-3 beats) — a quick accent fill,
 * like a DJ briefly triggering a beat repeat pad.
 */
function executeMicroStutter(
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

    // Quick 1/16th note stutter — very short
    const noteDur = beatDur / 4;
    const numNotes = Math.floor(fx.duration / noteDur);

    deckNodes.outputGain.gain.cancelScheduledValues(now);
    deckNodes.outputGain.gain.setValueAtTime(1, now);

    for (let i = 0; i < numNotes; i++) {
        const t = now + i * noteDur;
        // Gate ON
        deckNodes.outputGain.gain.setValueAtTime(1.0, t);
        // Gate OFF (brief)
        deckNodes.outputGain.gain.setValueAtTime(0.1, t + noteDur * 0.55);
    }

    // Restore at end
    deckNodes.outputGain.gain.setValueAtTime(1.0, now + fx.duration);
}

/**
 * Sweep Accent effect.
 * Quick HPF sweep accent to "breathe" at section transitions.
 * Creates a brief thinning effect that immediately snaps back.
 */
function executeSweepAccent(
    deckNodes: ReturnType<typeof audioEngine.getDeck>,
    fx: ScheduledFX,
): void {
    if (!deckNodes) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    const now = ctx.currentTime;

    deckNodes.filter.type = 'highpass';
    deckNodes.filter.Q.cancelScheduledValues(now);
    deckNodes.filter.Q.setValueAtTime(1.5, now);
    deckNodes.filter.frequency.cancelScheduledValues(now);
    deckNodes.filter.frequency.setValueAtTime(FILTER_MIN_FREQ, now);

    // Quick sweep up to 600Hz and back — subtle but audible
    deckNodes.filter.frequency.exponentialRampToValueAtTime(
        600 * fx.intensity, now + fx.duration * 0.4
    );
    // Snap back
    deckNodes.filter.frequency.exponentialRampToValueAtTime(
        FILTER_MIN_FREQ + 1, now + fx.duration * 0.85
    );
    deckNodes.filter.frequency.setValueAtTime(FILTER_MIN_FREQ, now + fx.duration);

    // Brief reverb accent alongside for atmosphere
    deckNodes.reverbSend.gain.cancelScheduledValues(now);
    deckNodes.reverbSend.gain.setValueAtTime(0, now);
    deckNodes.reverbSend.gain.linearRampToValueAtTime(
        0.3 * fx.intensity, now + fx.duration * 0.3
    );
    deckNodes.reverbSend.gain.linearRampToValueAtTime(0, now + fx.duration);

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

        // Reset playback rate (vinyl brake cleanup)
        if (deckNodes.source) {
            deckNodes.source.playbackRate.cancelScheduledValues(ctx.currentTime);
            deckNodes.source.playbackRate.setValueAtTime(1, ctx.currentTime);
        }
    }

    // Clean up active white noise riser
    if (activeNoiseSource) {
        try { activeNoiseSource.stop(); } catch { /* already stopped */ }
        activeNoiseSource.disconnect();
        activeNoiseSource = null;
    }
    if (activeNoiseGain) {
        activeNoiseGain.disconnect();
        activeNoiseGain = null;
    }
    if (activeNoiseFilter) {
        activeNoiseFilter.disconnect();
        activeNoiseFilter = null;
    }

    // Clean up active sub drop
    if (activeSubSource) {
        try { activeSubSource.stop(); } catch { /* already stopped */ }
        activeSubSource.disconnect();
        activeSubSource = null;
    }
    if (activeSubGain) {
        activeSubGain.disconnect();
        activeSubGain = null;
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
