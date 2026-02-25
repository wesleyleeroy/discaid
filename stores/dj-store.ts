/**
 * DiscAId Main Store — Zustand state management.
 *
 * This is the central nervous system of the autonomous DJ.
 * Manages tracks, queue, orchestrator state, analysis results,
 * transition plans, and AI insights.
 *
 * The store drives the orchestrator state machine:
 * IDLE → LOADING → PLAYING → PLANNING → PRE-TRANSITION → TRANSITIONING → PLAYING → ...
 */

'use client';

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { Track, TrackAnalysis } from '@/types/track';
import { TransitionPlan } from '@/types/transition';
import { OrchestratorState, AIInsight } from '@/types/orchestrator';
import { analyzeTrack, createFallbackAnalysis } from '@/lib/analysis/analyzer';
import { audioEngine } from '@/lib/audio/engine';
import { planTransition } from '@/lib/orchestrator/planner';
import { executeTransition, emergencyCrossfade } from '@/lib/audio/mixer';
import { validateAudioFile, sanitizeFilename } from '@/lib/ingestion/validator';
import { TRANSITION_LOOKAHEAD } from '@/lib/utils/constants';

interface DJState {
    // ─── Track Management ─────────────────────────────────────
    tracks: Record<string, Track>;
    queue: string[]; // Track IDs in queue order
    currentTrackId: string | null;
    nextTrackId: string | null;

    // ─── Orchestrator ─────────────────────────────────────────
    orchestratorState: OrchestratorState;
    isPlaying: boolean;
    isPaused: boolean;
    aiActive: boolean;

    // ─── Transition ───────────────────────────────────────────
    currentPlan: TransitionPlan | null;
    transitionProgress: number | null;
    transitionEta: number | null;

    // ─── Playback ─────────────────────────────────────────────
    currentPosition: number;
    currentDuration: number;
    activeDeck: 'A' | 'B';

    // ─── AI Insights ──────────────────────────────────────────
    insights: AIInsight[];

    // ─── Analysis Progress ────────────────────────────────────
    analysisProgress: { stage: string; progress: number; message: string } | null;

    // ─── Rights Confirmation ──────────────────────────────────
    rightsConfirmed: boolean;

    // ─── Actions ──────────────────────────────────────────────
    setRightsConfirmed: (confirmed: boolean) => void;
    addTrack: (file: File) => Promise<void>;
    skipTrack: () => void;
    togglePause: () => void;
    toggleAI: () => void;
    removeFromQueue: (trackId: string) => void;
    addInsight: (type: AIInsight['type'], message: string, details?: Record<string, unknown>) => void;
    updatePosition: () => void;
    initialize: () => Promise<void>;
}

export const useDJStore = create<DJState>((set, get) => ({
    // ─── Initial State ──────────────────────────────────────────
    tracks: {},
    queue: [],
    currentTrackId: null,
    nextTrackId: null,
    orchestratorState: 'idle',
    isPlaying: false,
    isPaused: false,
    aiActive: true,
    currentPlan: null,
    transitionProgress: null,
    transitionEta: null,
    currentPosition: 0,
    currentDuration: 0,
    activeDeck: 'A',
    insights: [],
    analysisProgress: null,
    rightsConfirmed: false,

    // ─── Rights Confirmation ────────────────────────────────────
    setRightsConfirmed: (confirmed) => set({ rightsConfirmed: confirmed }),

    // ─── Add Insight ────────────────────────────────────────────
    addInsight: (type, message, details) => {
        const insight: AIInsight = {
            id: uuidv4(),
            timestamp: Date.now(),
            type,
            message,
            details,
        };
        set((state) => ({
            insights: [insight, ...state.insights].slice(0, 50), // Keep last 50
        }));
    },

    // ─── Initialize Audio Engine ────────────────────────────────
    initialize: async () => {
        try {
            await audioEngine.initialize();
            get().addInsight('info', '🎛️ Audio engine initialized. Ready to DJ.');
        } catch (error) {
            get().addInsight('error', `Failed to initialize audio: ${error}`);
        }
    },

    // ─── Add Track ──────────────────────────────────────────────
    addTrack: async (file: File) => {
        const state = get();

        // Validate
        const validation = validateAudioFile(file);
        if (!validation.valid) {
            state.addInsight('error', `❌ ${validation.error}`);
            return;
        }
        validation.warnings.forEach(w => state.addInsight('warning', `⚠️ ${w}`));

        // Create track
        const { title, artist } = sanitizeFilename(file.name);
        const track: Track = {
            id: uuidv4(),
            title,
            artist,
            duration: 0,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            objectUrl: URL.createObjectURL(file),
            audioBuffer: null,
            analysis: null,
            status: 'pending',
            addedAt: Date.now(),
        };

        // Add to tracks and queue
        set((s) => ({
            tracks: { ...s.tracks, [track.id]: track },
            queue: [...s.queue, track.id],
        }));

        state.addInsight('info', `📀 Added: "${title}" by ${artist}`);

        // Ensure audio engine is initialized
        if (!audioEngine.state.isInitialized) {
            await state.initialize();
        }

        // Decode audio
        try {
            set((s) => ({
                tracks: {
                    ...s.tracks,
                    [track.id]: { ...s.tracks[track.id], status: 'analyzing' },
                },
                analysisProgress: { stage: 'decoding', progress: 0, message: 'Decoding audio...' },
            }));

            const audioBuffer = await audioEngine.decodeAudioFile(file);

            set((s) => ({
                tracks: {
                    ...s.tracks,
                    [track.id]: {
                        ...s.tracks[track.id],
                        audioBuffer,
                        duration: audioBuffer.duration,
                    },
                },
            }));

            // Analyze track
            state.addInsight('info', `🔬 Analyzing "${title}"...`);

            let analysis: TrackAnalysis;
            try {
                analysis = await analyzeTrack(audioBuffer, (progress) => {
                    set({ analysisProgress: progress });
                });
            } catch {
                state.addInsight('warning', `⚠️ Full analysis failed for "${title}", using fallback`);
                analysis = createFallbackAnalysis(audioBuffer);
            }

            set((s) => ({
                tracks: {
                    ...s.tracks,
                    [track.id]: {
                        ...s.tracks[track.id],
                        analysis,
                        status: 'ready',
                    },
                },
                analysisProgress: null,
            }));

            state.addInsight('decision',
                `✅ "${title}" analyzed: ${analysis.bpm} BPM, ${analysis.key.root} ${analysis.key.mode} ` +
                `(${analysis.key.camelotCode}), Energy ${(analysis.energy * 100).toFixed(0)}%`
            );

            // Trigger orchestrator
            orchestrate();

        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            set((s) => ({
                tracks: {
                    ...s.tracks,
                    [track.id]: { ...s.tracks[track.id], status: 'error', errorMessage: msg },
                },
                analysisProgress: null,
            }));
            state.addInsight('error', `❌ Failed to process "${title}": ${msg}`);
        }
    },

    // ─── Skip Track ─────────────────────────────────────────────
    skipTrack: () => {
        const state = get();
        if (!state.currentTrackId) return;

        state.addInsight('info', '⏭️ Skip requested');

        // Force transition to next track
        const readyTracks = state.queue.filter(id => {
            const t = state.tracks[id];
            return t && t.status === 'ready' && id !== state.currentTrackId;
        });

        if (readyTracks.length > 0) {
            const nextId = readyTracks[0];
            const nextTrack = state.tracks[nextId];
            if (nextTrack?.audioBuffer) {
                const opposingDeck = state.activeDeck === 'A' ? 'B' : 'A';
                audioEngine.loadTrack(opposingDeck, nextTrack.audioBuffer, true);

                // Emergency crossfade
                emergencyCrossfade(4).then(() => {
                    audioEngine.stopDeck(state.activeDeck);
                    set((s) => ({
                        currentTrackId: nextId,
                        activeDeck: opposingDeck as 'A' | 'B',
                        queue: s.queue.filter(id => id !== nextId),
                        tracks: {
                            ...s.tracks,
                            [nextId]: { ...s.tracks[nextId], status: 'playing' },
                            ...(s.currentTrackId ? {
                                [s.currentTrackId]: { ...s.tracks[s.currentTrackId!], status: 'completed' },
                            } : {}),
                        },
                        currentPlan: null,
                        transitionProgress: null,
                        orchestratorState: 'playing',
                    }));

                    state.addInsight('info', `⏭️ Skipped to "${nextTrack.title}"`);
                    // Continue orchestrating
                    setTimeout(orchestrate, 1000);
                });
            }
        } else {
            state.addInsight('warning', '⚠️ No tracks in queue to skip to');
        }
    },

    // ─── Toggle Pause ───────────────────────────────────────────
    togglePause: () => {
        const state = get();
        if (state.isPaused) {
            audioEngine.resume();
            set({ isPaused: false });
            state.addInsight('info', '▶️ Playback resumed');
        } else {
            audioEngine.suspend();
            set({ isPaused: true });
            state.addInsight('info', '⏸️ Playback paused');
        }
    },

    // ─── Toggle AI ──────────────────────────────────────────────
    toggleAI: () => {
        set((s) => {
            const newState = !s.aiActive;
            get().addInsight('info', newState ? '🤖 AI DJ activated' : '🤖 AI DJ paused');
            return { aiActive: newState };
        });
    },

    // ─── Remove from Queue ─────────────────────────────────────
    removeFromQueue: (trackId) => {
        set((s) => ({
            queue: s.queue.filter(id => id !== trackId),
        }));
        get().addInsight('info', `🗑️ Removed track from queue`);
    },

    // ─── Update Position ───────────────────────────────────────
    updatePosition: () => {
        const state = get();
        if (!state.isPlaying || state.isPaused) return;

        const position = audioEngine.getDeckPosition(state.activeDeck);
        const remaining = audioEngine.getDeckRemaining(state.activeDeck);
        const currentTrack = state.currentTrackId ? state.tracks[state.currentTrackId] : null;

        set({
            currentPosition: position,
            currentDuration: currentTrack?.duration ?? 0,
            transitionEta: state.currentPlan
                ? Math.max(0, (state.currentPlan.transitionStartTime - position))
                : remaining < TRANSITION_LOOKAHEAD ? remaining : null,
        });

        // Check if we should start planning a transition
        if (
            state.aiActive &&
            state.orchestratorState === 'playing' &&
            remaining < TRANSITION_LOOKAHEAD &&
            !state.currentPlan
        ) {
            orchestrate();
        }
    },
}));

// ─── Orchestrator Logic (runs outside store for cleanliness) ────

let orchestrateTimeout: ReturnType<typeof setTimeout> | null = null;

function orchestrate() {
    if (orchestrateTimeout) clearTimeout(orchestrateTimeout);

    orchestrateTimeout = setTimeout(() => {
        const state = useDJStore.getState();
        if (!state.aiActive) return;

        const { orchestratorState, currentTrackId, queue, tracks, activeDeck } = state;

        // ─── IDLE: Start playing first ready track ────────────────
        if (orchestratorState === 'idle' || (!currentTrackId && queue.length > 0)) {
            const firstReady = queue.find(id => tracks[id]?.status === 'ready');
            if (firstReady) {
                const track = tracks[firstReady];
                if (track.audioBuffer) {
                    audioEngine.loadTrack('A', track.audioBuffer, true);

                    // Listen for deck end
                    audioEngine.onDeckEnd('A', () => handleDeckEnd('A'));
                    audioEngine.onDeckEnd('B', () => handleDeckEnd('B'));

                    useDJStore.setState({
                        currentTrackId: firstReady,
                        activeDeck: 'A',
                        queue: queue.filter(id => id !== firstReady),
                        tracks: {
                            ...tracks,
                            [firstReady]: { ...track, status: 'playing' },
                        },
                        orchestratorState: 'playing',
                        isPlaying: true,
                    });

                    state.addInsight('decision', `🎵 Now playing: "${track.title}" by ${track.artist}`);

                    // Start position update loop
                    startPositionLoop();
                }
            }
            return;
        }

        // ─── PLAYING: Plan transition when next track is ready ────
        if (orchestratorState === 'playing' && currentTrackId && !state.currentPlan) {
            const readyNext = queue.find(id => {
                const t = tracks[id];
                return t && t.status === 'ready' && id !== currentTrackId;
            });

            if (readyNext) {
                const currentTrack = tracks[currentTrackId];
                const nextTrack = tracks[readyNext];

                if (currentTrack?.analysis && nextTrack?.analysis) {
                    state.addInsight('info', `🧠 Planning transition to "${nextTrack.title}"...`);

                    useDJStore.setState({
                        orchestratorState: 'planning',
                        nextTrackId: readyNext,
                    });

                    try {
                        const { plan, insights } = planTransition(
                            currentTrack.analysis,
                            nextTrack.analysis,
                            currentTrackId,
                            readyNext
                        );

                        insights.forEach(msg => state.addInsight('decision', `🎯 ${msg}`));

                        useDJStore.setState({
                            currentPlan: plan,
                            orchestratorState: 'pre-transition',
                        });

                        // Schedule transition execution
                        scheduleTransition(plan, readyNext);
                    } catch (error) {
                        state.addInsight('warning', `⚠️ Planning failed, will use safe crossfade`);
                        useDJStore.setState({ orchestratorState: 'playing' });
                    }
                }
            }
        }
    }, 100);
}

function scheduleTransition(plan: TransitionPlan, nextTrackId: string) {
    const checkInterval = setInterval(() => {
        const state = useDJStore.getState();
        if (!state.isPlaying || state.isPaused || state.orchestratorState !== 'pre-transition') {
            clearInterval(checkInterval);
            return;
        }

        const position = audioEngine.getDeckPosition(state.activeDeck);
        const timeUntilTransition = plan.transitionStartTime - position;

        // Update ETA
        useDJStore.setState({ transitionEta: Math.max(0, timeUntilTransition) });

        // Trigger transition when we reach the transition point
        if (timeUntilTransition <= 0.5) {
            clearInterval(checkInterval);
            executeTransitionSequence(plan, nextTrackId);
        }
    }, 100);
}

async function executeTransitionSequence(plan: TransitionPlan, nextTrackId: string) {
    const state = useDJStore.getState();
    const nextTrack = state.tracks[nextTrackId];
    if (!nextTrack?.audioBuffer) return;

    const currentDeck = state.activeDeck;
    const nextDeck = currentDeck === 'A' ? 'B' : 'A';

    state.addInsight('decision',
        `🎛️ Executing ${plan.strategy} transition → "${nextTrack.title}"`
    );

    useDJStore.setState({ orchestratorState: 'transitioning' });

    // Load next track on opposing deck and start it
    audioEngine.loadTrack(nextDeck as 'A' | 'B', nextTrack.audioBuffer, true);

    // Execute the transition
    try {
        await executeTransition(plan, (progress) => {
            useDJStore.setState({ transitionProgress: progress });
        });
    } catch {
        // Emergency fallback
        state.addInsight('warning', '⚠️ Transition execution failed, emergency crossfade');
        await emergencyCrossfade(4);
    }

    // Stop outgoing deck
    audioEngine.stopDeck(currentDeck);

    // Update state
    const currentState = useDJStore.getState();
    useDJStore.setState({
        currentTrackId: nextTrackId,
        activeDeck: nextDeck as 'A' | 'B',
        queue: currentState.queue.filter(id => id !== nextTrackId),
        nextTrackId: null,
        currentPlan: null,
        transitionProgress: null,
        transitionEta: null,
        orchestratorState: 'playing',
        tracks: {
            ...currentState.tracks,
            [nextTrackId]: { ...currentState.tracks[nextTrackId], status: 'playing' },
            ...(currentState.currentTrackId ? {
                [currentState.currentTrackId]: {
                    ...currentState.tracks[currentState.currentTrackId!],
                    status: 'completed',
                },
            } : {}),
        },
    });

    state.addInsight('decision', `✅ Transition complete. Now playing: "${nextTrack.title}"`);

    // Continue orchestrating (plan next transition if queue has tracks)
    setTimeout(orchestrate, 2000);
}

function handleDeckEnd(deck: 'A' | 'B') {
    const state = useDJStore.getState();

    if (deck === state.activeDeck && state.orchestratorState !== 'transitioning') {
        state.addInsight('info', '🔚 Track ended');

        // Try to play next track
        const readyNext = state.queue.find(id => {
            const t = state.tracks[id];
            return t && t.status === 'ready';
        });

        if (readyNext) {
            const nextTrack = state.tracks[readyNext];
            if (nextTrack?.audioBuffer) {
                const newDeck = deck === 'A' ? 'B' : 'A';
                audioEngine.loadTrack(newDeck as 'A' | 'B', nextTrack.audioBuffer, true);

                useDJStore.setState({
                    currentTrackId: readyNext,
                    activeDeck: newDeck as 'A' | 'B',
                    queue: state.queue.filter(id => id !== readyNext),
                    tracks: {
                        ...state.tracks,
                        [readyNext]: { ...nextTrack, status: 'playing' },
                    },
                    orchestratorState: 'playing',
                });

                state.addInsight('info', `🎵 Auto-playing: "${nextTrack.title}"`);
                setTimeout(orchestrate, 2000);
            }
        } else {
            useDJStore.setState({
                orchestratorState: 'idle',
                isPlaying: false,
                currentTrackId: null,
            });
            state.addInsight('info', '⏹️ Queue empty. Add more tracks to continue.');
        }
    }
}

let positionLoopId: ReturnType<typeof setInterval> | null = null;

function startPositionLoop() {
    if (positionLoopId) clearInterval(positionLoopId);
    positionLoopId = setInterval(() => {
        useDJStore.getState().updatePosition();
    }, 100);
}
