/**
 * Transition types and strategy definitions.
 * Each strategy produces automation envelopes that the mixer executes.
 */

/** Available transition strategy identifiers */
export type TransitionStrategyType =
    | 'crossfade'         // Basic gain crossfade with overlap
    | 'filter-sweep'      // LPF/HPF sweep during transition
    | 'echo-out'          // Echo/delay tail on outgoing track
    | 'bass-swap'         // EQ bass attenuation swap
    | 'energy-ramp';      // Energy build/drop transition

/** A scored candidate strategy from the planner */
export interface TransitionCandidate {
    strategy: TransitionStrategyType;
    score: number;            // 0-100, higher = better fit
    reasoning: string;        // Human-readable explanation
    penalties: string[];      // Reasons score was reduced
}

/** Automation point for a parameter over time */
export interface AutomationPoint {
    time: number;             // seconds relative to transition start
    value: number;            // parameter value (normalized 0-1 or dB)
    curve?: 'linear' | 'exponential' | 'cosine';
}

/** Automation envelope for a single parameter */
export interface AutomationEnvelope {
    parameter: AutomationParameter;
    points: AutomationPoint[];
}

/** Parameters that can be automated during transitions */
export type AutomationParameter =
    | 'gainA'               // Outgoing track gain
    | 'gainB'               // Incoming track gain
    | 'lowEqA'              // Outgoing low EQ
    | 'midEqA'              // Outgoing mid EQ
    | 'highEqA'             // Outgoing high EQ
    | 'lowEqB'              // Incoming low EQ
    | 'midEqB'              // Incoming mid EQ
    | 'highEqB'             // Incoming high EQ
    | 'filterFreqA'         // Outgoing filter cutoff freq (Hz)
    | 'filterFreqB'         // Incoming filter cutoff freq (Hz)
    | 'filterQA'            // Outgoing filter resonance
    | 'filterQB'            // Incoming filter resonance
    | 'reverbSendA'         // Outgoing reverb send level
    | 'reverbSendB'         // Incoming reverb send level
    | 'delaySendA'          // Outgoing delay send level
    | 'delaySendB'          // Incoming delay send level
    | 'delayTime'           // Delay time
    | 'delayFeedback';      // Delay feedback amount

/** Complete transition plan ready for execution */
export interface TransitionPlan {
    id: string;
    strategy: TransitionStrategyType;
    score: number;
    reasoning: string;
    outgoingTrackId: string;
    incomingTrackId: string;
    transitionStartTime: number;  // seconds into outgoing track
    overlapDuration: number;      // seconds of overlap
    envelopes: AutomationEnvelope[];
    bpmAdjustment: number;        // percentage tempo change for incoming (-6 to +6)
    createdAt: number;
    candidates: TransitionCandidate[]; // all scored strategies
}

/** Interface that all transition strategies must implement */
export interface TransitionStrategy {
    type: TransitionStrategyType;
    name: string;
    description: string;

    /** Score how well this strategy fits the given track pair */
    score(context: TransitionContext): TransitionCandidate;

    /** Generate automation envelopes for this transition */
    generateEnvelopes(context: TransitionContext, overlapDuration: number): AutomationEnvelope[];
}

/** Context passed to transition strategies for scoring and envelope generation */
export interface TransitionContext {
    outgoing: {
        bpm: number;
        key: { root: string; mode: 'major' | 'minor'; camelotCode: string };
        energy: number;
        loudnessDb: number;
        outroStart: number;
        duration: number;
        hasVocalsInOutro: boolean;
        beatGrid: number[];
    };
    incoming: {
        bpm: number;
        key: { root: string; mode: 'major' | 'minor'; camelotCode: string };
        energy: number;
        loudnessDb: number;
        introEnd: number;
        duration: number;
        hasVocalsInIntro: boolean;
        beatGrid: number[];
    };
    bpmDifference: number;       // absolute percentage
    keyCompatibility: number;    // 0-1 from Camelot wheel
    energyDifference: number;    // absolute 0-1
}
