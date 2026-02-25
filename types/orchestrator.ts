/**
 * Orchestrator state machine types.
 * Defines the autonomous DJ lifecycle states and events.
 */

/** States of the autonomous DJ orchestrator */
export type OrchestratorState =
    | 'idle'            // No tracks, waiting for input
    | 'loading'         // Loading first track
    | 'playing'         // Track playing, monitoring for transition
    | 'analyzing'       // Analyzing next track in queue
    | 'planning'        // Planning transition strategy
    | 'pre-transition'  // Transition planned, waiting for trigger point
    | 'transitioning'   // Executing transition
    | 'error';          // Error state (will attempt recovery)

/** Events that drive state transitions */
export type OrchestratorEvent =
    | { type: 'TRACK_ADDED'; trackId: string }
    | { type: 'TRACK_LOADED'; trackId: string }
    | { type: 'ANALYSIS_COMPLETE'; trackId: string }
    | { type: 'ANALYSIS_FAILED'; trackId: string; error: string }
    | { type: 'PLAN_READY'; planId: string }
    | { type: 'TRANSITION_TRIGGER' }
    | { type: 'TRANSITION_COMPLETE' }
    | { type: 'PLAYBACK_ENDED' }
    | { type: 'SKIP_TRACK' }
    | { type: 'PAUSE' }
    | { type: 'RESUME' }
    | { type: 'ERROR'; error: string }
    | { type: 'RECOVER' };

/** AI insight log entry */
export interface AIInsight {
    id: string;
    timestamp: number;
    type: 'info' | 'decision' | 'warning' | 'error';
    message: string;
    details?: Record<string, unknown>;
}

/** Orchestrator snapshot for UI display */
export interface OrchestratorSnapshot {
    state: OrchestratorState;
    currentTrackId: string | null;
    nextTrackId: string | null;
    transitionEta: number | null;     // seconds until transition
    transitionProgress: number | null; // 0-1 during transition
    isPlaying: boolean;
    isPaused: boolean;
    aiActive: boolean;
}
