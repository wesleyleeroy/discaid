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
 */
function scheduleEnvelope(envelope: AutomationEnvelope): void {
    const param = resolveParam(envelope.parameter);
    if (!param) return;

    // Cancel any existing automation
    audioEngine.cancelAutomation(param);

    // Set initial value
    if (envelope.points.length > 0) {
        audioEngine.setParam(param, envelope.points[0].value);
    }

    // Schedule subsequent points
    for (let i = 1; i < envelope.points.length; i++) {
        const point = envelope.points[i];
        audioEngine.scheduleParam(param, point.value, point.time, point.curve || 'linear');
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
