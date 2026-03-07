/**
 * Audio Mixer — Executes transition plans on the Web Audio engine.
 *
 * Translates TransitionPlan automation envelopes into Web Audio API
 * parameter scheduling calls. Manages the timeline of deck handoffs.
 */

import { audioEngine } from '@/lib/audio/engine';
import { TransitionPlan, AutomationEnvelope, AutomationParameter } from '@/types/transition';
import { FILTER_MAX_FREQ, FILTER_DEFAULT_Q } from '@/lib/utils/constants';

/**
 * Execute a transition plan by scheduling automation on the audio engine.
 * Returns a Promise that resolves when the transition overlap period ends.
 *
 * @param outgoingDeck - The deck currently playing (being transitioned FROM)
 * @param incomingDeck - The deck being transitioned TO
 *
 * Transition strategies always generate envelopes assuming "A = outgoing, B = incoming".
 * When the actual decks are reversed (B is outgoing), we remap parameter names
 * so the automation targets the correct physical deck.
 */
export function executeTransition(
    plan: TransitionPlan,
    outgoingDeck: 'A' | 'B' = 'A',
    incomingDeck: 'A' | 'B' = 'B',
    onProgress?: (progress: number) => void
): Promise<void> {
    return new Promise((resolve) => {
        const ctx = audioEngine.context;
        if (!ctx) {
            resolve();
            return;
        }

        // Reset all deck parameters to clean state before scheduling
        resetDeckParams('A');
        resetDeckParams('B');

        // Ensure outgoing deck is at full volume and incoming starts silent
        // (envelopes will control the actual crossfade)
        const outNodes = audioEngine.getDeck(outgoingDeck);
        const inNodes = audioEngine.getDeck(incomingDeck);
        if (outNodes) audioEngine.setParam(outNodes.inputGain.gain, 1);
        if (inNodes) audioEngine.setParam(inNodes.inputGain.gain, 0);

        // For drop-sync: incoming deck needs HPF mode (250Hz removes low mud)
        if (plan.strategy === 'drop-sync') {
            if (inNodes) {
                inNodes.filter.type = 'highpass';
            }
        }

        // For filter-sweep: outgoing deck needs HPF mode
        if (plan.strategy === 'filter-sweep') {
            if (outNodes) {
                outNodes.filter.type = 'highpass';
            }
        }

        // If decks are swapped (B is outgoing), remap parameter names
        // so the envelopes target the correct physical deck
        const needsRemap = outgoingDeck === 'B';

        // Schedule all envelopes
        for (const envelope of plan.envelopes) {
            const remappedEnvelope = needsRemap
                ? { ...envelope, parameter: remapParam(envelope.parameter) }
                : envelope;
            scheduleEnvelope(remappedEnvelope);
        }

        // Track progress during transition
        const startTime = ctx.currentTime;
        const duration = plan.overlapDuration;

        const progressInterval = setInterval(() => {
            if (!audioEngine.context) {
                clearInterval(progressInterval);
                resolve();
                return;
            }

            const elapsed = audioEngine.getCurrentTime() - startTime;
            const progress = Math.min(1, elapsed / duration);
            onProgress?.(progress);

            if (progress >= 1) {
                clearInterval(progressInterval);

                // Clean up: ensure outgoing deck is stopped
                // and incoming deck is at full volume with clean params
                finalizeTransition(outgoingDeck, incomingDeck);
                resolve();
            }
        }, 50); // Update at ~20fps
    });
}

/**
 * Reset a deck's parameters to default values.
 */
function resetDeckParams(deck: 'A' | 'B'): void {
    const deckNodes = audioEngine.getDeck(deck);
    if (!deckNodes) return;

    deckNodes.filter.type = 'lowpass'; // Reset filter mode (drop-sync uses highpass)
    audioEngine.setParam(deckNodes.eqLow.gain, 0);
    audioEngine.setParam(deckNodes.eqMid.gain, 0);
    audioEngine.setParam(deckNodes.eqHigh.gain, 0);
    audioEngine.setParam(deckNodes.filter.frequency, FILTER_MAX_FREQ);
    audioEngine.setParam(deckNodes.filter.Q, FILTER_DEFAULT_Q);
    audioEngine.setParam(deckNodes.outputGain.gain, 1); // Ensure output path is always open
    audioEngine.setParam(deckNodes.reverbSend.gain, 0);
    audioEngine.setParam(deckNodes.delaySend.gain, 0);
}

/**
 * Schedule an automation envelope on the appropriate audio parameter.
 *
 * Uses explicit setValueAtTime anchors between ramps to prevent
 * the browser's automation timeline from getting confused by
 * long chains of linearRampToValueAtTime calls.
 */
function scheduleEnvelope(envelope: AutomationEnvelope): void {
    const param = resolveParam(envelope.parameter);
    if (!param) return;
    const ctx = audioEngine.context;
    if (!ctx) return;

    // Cancel any existing automation
    param.cancelScheduledValues(0);

    if (envelope.points.length === 0) return;

    const now = ctx.currentTime;

    // Set the initial anchor
    param.setValueAtTime(envelope.points[0].value, now);

    // Schedule each subsequent point with an explicit anchor + ramp pair.
    // This is more reliable than chaining many linearRamps, which can
    // silently fail or produce unexpected results in some browsers.
    for (let i = 1; i < envelope.points.length; i++) {
        const prev = envelope.points[i - 1];
        const point = envelope.points[i];
        const absTime = now + point.time;

        // Place an anchor at the previous point's time to guarantee
        // the ramp starts from a known value
        if (i > 1) {
            param.setValueAtTime(prev.value, now + prev.time);
        }

        // Ramp to the new value
        if (point.curve === 'exponential') {
            param.exponentialRampToValueAtTime(Math.max(0.0001, point.value), absTime);
        } else {
            param.linearRampToValueAtTime(point.value, absTime);
        }
    }
}

/**
 * Resolve a parameter name to its Web Audio AudioParam.
 */
function resolveParam(paramName: AutomationParameter): AudioParam | null {
    const deckA = audioEngine.getDeck('A');
    const deckB = audioEngine.getDeck('B');
    if (!deckA || !deckB) return null;

    switch (paramName) {
        case 'gainA': return deckA.inputGain.gain;
        case 'gainB': return deckB.inputGain.gain;
        case 'lowEqA': return deckA.eqLow.gain;
        case 'midEqA': return deckA.eqMid.gain;
        case 'highEqA': return deckA.eqHigh.gain;
        case 'lowEqB': return deckB.eqLow.gain;
        case 'midEqB': return deckB.eqMid.gain;
        case 'highEqB': return deckB.eqHigh.gain;
        case 'filterFreqA': return deckA.filter.frequency;
        case 'filterFreqB': return deckB.filter.frequency;
        case 'filterQA': return deckA.filter.Q;
        case 'filterQB': return deckB.filter.Q;
        case 'reverbSendA': return deckA.reverbSend.gain;
        case 'reverbSendB': return deckB.reverbSend.gain;
        case 'delaySendA': return deckA.delaySend.gain;
        case 'delaySendB': return deckB.delaySend.gain;
        case 'delayTime': return audioEngine.getDelayNode()?.delayTime ?? null;
        case 'delayFeedback': return audioEngine.getDelayFeedback()?.gain ?? null;
        case 'playbackRateA': return deckA.source?.playbackRate ?? null;
        case 'playbackRateB': return deckB.source?.playbackRate ?? null;
        default: return null;
    }
}

/**
 * Remap an automation parameter name: swap A ↔ B.
 * Used when the outgoing deck is B rather than A, so that
 * envelopes generated with the A=outgoing convention
 * target the correct physical deck.
 */
function remapParam(param: AutomationParameter): AutomationParameter {
    const swaps: Partial<Record<AutomationParameter, AutomationParameter>> = {
        'gainA': 'gainB',
        'gainB': 'gainA',
        'lowEqA': 'lowEqB',
        'lowEqB': 'lowEqA',
        'midEqA': 'midEqB',
        'midEqB': 'midEqA',
        'highEqA': 'highEqB',
        'highEqB': 'highEqA',
        'filterFreqA': 'filterFreqB',
        'filterFreqB': 'filterFreqA',
        'filterQA': 'filterQB',
        'filterQB': 'filterQA',
        'reverbSendA': 'reverbSendB',
        'reverbSendB': 'reverbSendA',
        'delaySendA': 'delaySendB',
        'delaySendB': 'delaySendA',
        'playbackRateA': 'playbackRateB',
        'playbackRateB': 'playbackRateA',
    };
    return swaps[param] ?? param;
}

/**
 * Finalize a transition: clean up incoming deck params, silence outgoing.
 */
function finalizeTransition(outgoingDeck: 'A' | 'B', incomingDeck: 'A' | 'B'): void {
    const incoming = audioEngine.getDeck(incomingDeck);
    const outgoing = audioEngine.getDeck(outgoingDeck);
    if (!incoming || !outgoing) return;

    // Incoming deck to full volume with clean params
    audioEngine.setParam(incoming.inputGain.gain, 1);
    resetDeckParams(incomingDeck);

    // Silence outgoing deck
    audioEngine.setParam(outgoing.inputGain.gain, 0);
    resetDeckParams(outgoingDeck);

    // Reset FX
    const delayFeedback = audioEngine.getDelayFeedback();
    if (delayFeedback) {
        audioEngine.setParam(delayFeedback.gain, 0.3);
    }
}

/**
 * Perform an emergency safe crossfade.
 * Used when the planner fails or analysis is unavailable.
 */
export function emergencyCrossfade(duration: number = 8): Promise<void> {
    const deckA = audioEngine.getDeck('A');
    const deckB = audioEngine.getDeck('B');
    if (!deckA || !deckB) return Promise.resolve();

    // Simple linear crossfade
    audioEngine.setParam(deckA.inputGain.gain, 1);
    audioEngine.setParam(deckB.inputGain.gain, 0);
    audioEngine.scheduleParam(deckA.inputGain.gain, 0, duration, 'linear');
    audioEngine.scheduleParam(deckB.inputGain.gain, 1, duration, 'linear');

    return new Promise((resolve) => {
        setTimeout(() => {
            resetDeckParams('A');
            resetDeckParams('B');
            audioEngine.setParam(deckB.inputGain.gain, 1);
            resolve();
        }, duration * 1000);
    });
}
