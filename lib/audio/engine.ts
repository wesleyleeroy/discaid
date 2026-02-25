/**
 * Web Audio Engine — Core audio graph management.
 *
 * Creates and manages the Web Audio API graph with:
 * - Two decks (A and B) for seamless transitions
 * - Per-deck EQ (3-band), filter, and gain nodes
 * - Shared FX bus (reverb, delay)
 * - Master compressor and limiter for peak protection
 * - Parameter automation scheduling
 *
 * Audio Graph:
 * Deck A Source → GainA → EQ3A → FilterA → DeckGainA ─┐
 *                                                       ├→ FX Bus → Master
 * Deck B Source → GainB → EQ3B → FilterB → DeckGainB ─┘
 *
 * FX Bus: ReverbSend → Convolver → Wet Gain ─┐
 *         DelaySend → Delay → Feedback → ─────┤
 *                                              └→ FX Return → Master
 *
 * Master: Compressor → Limiter(DynamicsCompressor) → Destination
 */

import {
    EQ_LOW_FREQ,
    EQ_MID_FREQ,
    EQ_HIGH_FREQ,
    FILTER_MIN_FREQ,
    FILTER_MAX_FREQ,
    FILTER_DEFAULT_Q,
    MASTER_CEILING_DB,
    REVERB_DECAY,
    DELAY_TIME_DEFAULT,
    DELAY_FEEDBACK_DEFAULT,
} from '@/lib/utils/constants';

export interface DeckNodes {
    source: AudioBufferSourceNode | null;
    inputGain: GainNode;
    eqLow: BiquadFilterNode;
    eqMid: BiquadFilterNode;
    eqHigh: BiquadFilterNode;
    filter: BiquadFilterNode;
    outputGain: GainNode;
    reverbSend: GainNode;
    delaySend: GainNode;
    analyser: AnalyserNode;
}

export interface AudioEngineState {
    isInitialized: boolean;
    activeDeck: 'A' | 'B';
    deckAPlaying: boolean;
    deckBPlaying: boolean;
}

class AudioEngine {
    private ctx: AudioContext | null = null;
    private deckA: DeckNodes | null = null;
    private deckB: DeckNodes | null = null;

    // FX nodes
    private reverbConvolver: ConvolverNode | null = null;
    private reverbWet: GainNode | null = null;
    private delayNode: DelayNode | null = null;
    private delayFeedback: GainNode | null = null;
    private delayWet: GainNode | null = null;

    // Master chain
    private masterGain: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private limiter: DynamicsCompressorNode | null = null;
    private masterAnalyser: AnalyserNode | null = null;

    // State
    private _state: AudioEngineState = {
        isInitialized: false,
        activeDeck: 'A',
        deckAPlaying: false,
        deckBPlaying: false,
    };

    // Playback tracking
    private deckAStartTime = 0;
    private deckBStartTime = 0;
    private deckAOffset = 0;
    private deckBOffset = 0;
    private deckABuffer: AudioBuffer | null = null;
    private deckBBuffer: AudioBuffer | null = null;

    // Callbacks
    private onDeckEndCallbacks: Map<'A' | 'B', () => void> = new Map();

    get state(): AudioEngineState {
        return { ...this._state };
    }

    get context(): AudioContext | null {
        return this.ctx;
    }

    /**
     * Initialize the Web Audio context and build the audio graph.
     * Must be called from a user gesture (click/touch) in the browser.
     */
    async initialize(): Promise<void> {
        if (this._state.isInitialized && this.ctx) return;

        this.ctx = new AudioContext({ sampleRate: 44100 });

        // Resume context if suspended (autoplay policy)
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        // Build master chain (right to left)
        this.masterAnalyser = this.ctx.createAnalyser();
        this.masterAnalyser.fftSize = 2048;

        // Limiter — aggressive compressor set as a brickwall limiter
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = MASTER_CEILING_DB;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.001;
        this.limiter.release.value = 0.01;

        // Compressor — gentle bus compression for glue
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 10;
        this.compressor.ratio.value = 3;
        this.compressor.attack.value = 0.01;
        this.compressor.release.value = 0.1;

        // Master gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.85; // Leave headroom

        // Chain: masterGain → compressor → limiter → analyser → destination
        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.limiter);
        this.limiter.connect(this.masterAnalyser);
        this.masterAnalyser.connect(this.ctx.destination);

        // Build FX bus
        await this.buildFXBus();

        // Build decks
        this.deckA = this.createDeck('A');
        this.deckB = this.createDeck('B');

        this._state.isInitialized = true;
    }

    /**
     * Build the shared FX bus (reverb + delay).
     */
    private async buildFXBus(): Promise<void> {
        if (!this.ctx || !this.masterGain) return;

        // ─── Reverb (Convolver with generated impulse) ────────────
        this.reverbConvolver = this.ctx.createConvolver();
        this.reverbConvolver.buffer = this.generateReverbImpulse(REVERB_DECAY);
        this.reverbWet = this.ctx.createGain();
        this.reverbWet.gain.value = 0.3;
        this.reverbConvolver.connect(this.reverbWet);
        this.reverbWet.connect(this.masterGain);

        // ─── Delay ─────────────────────────────────────────────────
        this.delayNode = this.ctx.createDelay(5);
        this.delayNode.delayTime.value = DELAY_TIME_DEFAULT;
        this.delayFeedback = this.ctx.createGain();
        this.delayFeedback.gain.value = DELAY_FEEDBACK_DEFAULT;
        this.delayWet = this.ctx.createGain();
        this.delayWet.gain.value = 0.25;

        // Delay → feedback loop → wet output
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayNode.connect(this.delayWet);
        this.delayWet.connect(this.masterGain);
    }

    /**
     * Generate a synthetic reverb impulse response.
     * Creates an exponentially decaying noise burst.
     */
    private generateReverbImpulse(decay: number): AudioBuffer {
        const ctx = this.ctx!;
        const sampleRate = ctx.sampleRate;
        const length = Math.floor(sampleRate * decay);
        const buffer = ctx.createBuffer(2, length, sampleRate);

        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                // Exponentially decaying white noise
                data[i] = (Math.random() * 2 - 1) * Math.exp(-3 * i / length);
            }
        }

        return buffer;
    }

    /**
     * Create a deck's audio node chain.
     */
    private createDeck(id: 'A' | 'B'): DeckNodes {
        const ctx = this.ctx!;

        const inputGain = ctx.createGain();
        inputGain.gain.value = id === 'A' ? 1 : 0; // Deck A starts active

        // 3-band EQ using peaking filters
        const eqLow = ctx.createBiquadFilter();
        eqLow.type = 'lowshelf';
        eqLow.frequency.value = EQ_LOW_FREQ;
        eqLow.gain.value = 0;

        const eqMid = ctx.createBiquadFilter();
        eqMid.type = 'peaking';
        eqMid.frequency.value = EQ_MID_FREQ;
        eqMid.Q.value = 1;
        eqMid.gain.value = 0;

        const eqHigh = ctx.createBiquadFilter();
        eqHigh.type = 'highshelf';
        eqHigh.frequency.value = EQ_HIGH_FREQ;
        eqHigh.gain.value = 0;

        // Main filter (for sweeps)
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = FILTER_MAX_FREQ;
        filter.Q.value = FILTER_DEFAULT_Q;

        // Output gain
        const outputGain = ctx.createGain();
        outputGain.gain.value = 1;

        // FX sends
        const reverbSend = ctx.createGain();
        reverbSend.gain.value = 0;
        const delaySend = ctx.createGain();
        delaySend.gain.value = 0;

        // Per-deck analyser
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;

        // Wire the chain: input → EQ → filter → output → master
        inputGain.connect(eqLow);
        eqLow.connect(eqMid);
        eqMid.connect(eqHigh);
        eqHigh.connect(filter);
        filter.connect(outputGain);
        outputGain.connect(this.masterGain!);
        outputGain.connect(analyser);

        // FX sends (parallel from output)
        outputGain.connect(reverbSend);
        reverbSend.connect(this.reverbConvolver!);
        outputGain.connect(delaySend);
        delaySend.connect(this.delayNode!);

        return {
            source: null,
            inputGain,
            eqLow,
            eqMid,
            eqHigh,
            filter,
            outputGain,
            reverbSend,
            delaySend,
            analyser,
        };
    }

    /**
     * Load an AudioBuffer into a deck and optionally start playback.
     */
    loadTrack(deck: 'A' | 'B', buffer: AudioBuffer, startPlaying = false, offset = 0): void {
        if (!this.ctx) throw new Error('Audio engine not initialized');

        const deckNodes = deck === 'A' ? this.deckA! : this.deckB!;

        // Stop any current source on this deck
        this.stopDeck(deck);

        // Store buffer reference
        if (deck === 'A') {
            this.deckABuffer = buffer;
            this.deckAOffset = offset;
        } else {
            this.deckBBuffer = buffer;
            this.deckBOffset = offset;
        }

        if (startPlaying) {
            this.playDeck(deck, offset);
        }
    }

    /**
     * Start playback on a deck.
     */
    playDeck(deck: 'A' | 'B', offset = 0): void {
        if (!this.ctx) return;

        const deckNodes = deck === 'A' ? this.deckA! : this.deckB!;
        const buffer = deck === 'A' ? this.deckABuffer : this.deckBBuffer;
        if (!buffer) return;

        // Create new source (sources are single-use in Web Audio API)
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(deckNodes.inputGain);

        // Track playback timing
        const now = this.ctx.currentTime;
        if (deck === 'A') {
            this.deckAStartTime = now;
            this.deckAOffset = offset;
            this._state.deckAPlaying = true;
        } else {
            this.deckBStartTime = now;
            this.deckBOffset = offset;
            this._state.deckBPlaying = true;
        }

        // Handle track end
        source.onended = () => {
            if (deck === 'A') this._state.deckAPlaying = false;
            else this._state.deckBPlaying = false;
            this.onDeckEndCallbacks.get(deck)?.();
        };

        deckNodes.source = source;
        source.start(0, offset);
    }

    /**
     * Stop playback on a deck.
     */
    stopDeck(deck: 'A' | 'B'): void {
        const deckNodes = deck === 'A' ? this.deckA! : this.deckB!;
        if (deckNodes?.source) {
            try {
                deckNodes.source.stop();
            } catch {
                // Source may already be stopped
            }
            deckNodes.source.disconnect();
            deckNodes.source = null;
        }
        if (deck === 'A') this._state.deckAPlaying = false;
        else this._state.deckBPlaying = false;
    }

    /**
     * Get the current playback position for a deck in seconds.
     */
    getDeckPosition(deck: 'A' | 'B'): number {
        if (!this.ctx) return 0;
        const now = this.ctx.currentTime;
        if (deck === 'A') {
            return this._state.deckAPlaying ? (now - this.deckAStartTime) + this.deckAOffset : this.deckAOffset;
        } else {
            return this._state.deckBPlaying ? (now - this.deckBStartTime) + this.deckBOffset : this.deckBOffset;
        }
    }

    /**
     * Get the remaining time on a deck.
     */
    getDeckRemaining(deck: 'A' | 'B'): number {
        const buffer = deck === 'A' ? this.deckABuffer : this.deckBBuffer;
        if (!buffer) return 0;
        return Math.max(0, buffer.duration - this.getDeckPosition(deck));
    }

    /**
     * Register a callback for when a deck's playback ends.
     */
    onDeckEnd(deck: 'A' | 'B', callback: () => void): void {
        this.onDeckEndCallbacks.set(deck, callback);
    }

    /**
     * Schedule a parameter change with automation.
     */
    scheduleParam(
        param: AudioParam,
        value: number,
        time: number,
        curve: 'linear' | 'exponential' | 'cosine' = 'linear'
    ): void {
        if (!this.ctx) return;
        const absTime = this.ctx.currentTime + time;

        try {
            if (curve === 'exponential') {
                // exponentialRampToValueAtTime requires value > 0
                param.exponentialRampToValueAtTime(Math.max(0.0001, value), absTime);
            } else {
                param.linearRampToValueAtTime(value, absTime);
            }
        } catch {
            // Fallback to setValueAtTime
            param.setValueAtTime(value, absTime);
        }
    }

    /**
     * Set a parameter value immediately.
     */
    setParam(param: AudioParam, value: number): void {
        if (!this.ctx) return;
        param.cancelScheduledValues(this.ctx.currentTime);
        param.setValueAtTime(value, this.ctx.currentTime);
    }

    /**
     * Cancel all scheduled automation on a parameter.
     */
    cancelAutomation(param: AudioParam): void {
        if (!this.ctx) return;
        param.cancelScheduledValues(this.ctx.currentTime);
    }

    /**
     * Get deck nodes for direct parameter access.
     */
    getDeck(deck: 'A' | 'B'): DeckNodes | null {
        return deck === 'A' ? this.deckA : this.deckB;
    }

    /**
     * Get the master analyser for visualization.
     */
    getMasterAnalyser(): AnalyserNode | null {
        return this.masterAnalyser;
    }

    /**
     * Get delay node for tempo-synced delay time.
     */
    getDelayNode(): DelayNode | null {
        return this.delayNode;
    }

    /**
     * Get delay feedback gain for automation.
     */
    getDelayFeedback(): GainNode | null {
        return this.delayFeedback;
    }

    /**
     * Suspend the audio context (for pause).
     */
    async suspend(): Promise<void> {
        await this.ctx?.suspend();
    }

    /**
     * Resume the audio context.
     */
    async resume(): Promise<void> {
        await this.ctx?.resume();
    }

    /**
     * Decode an audio file to AudioBuffer.
     */
    async decodeAudioFile(file: File): Promise<AudioBuffer> {
        if (!this.ctx) {
            await this.initialize();
        }
        const arrayBuffer = await file.arrayBuffer();
        return await this.ctx!.decodeAudioData(arrayBuffer);
    }

    /**
     * Get the current audio context time.
     */
    getCurrentTime(): number {
        return this.ctx?.currentTime ?? 0;
    }

    /**
     * Destroy the engine and release resources.
     */
    async destroy(): Promise<void> {
        this.stopDeck('A');
        this.stopDeck('B');
        await this.ctx?.close();
        this.ctx = null;
        this._state.isInitialized = false;
    }
}

// Singleton instance
export const audioEngine = new AudioEngine();
