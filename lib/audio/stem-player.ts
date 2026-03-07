/**
 * Stem Player — Independent audio playback for separated stems.
 *
 * Each StemPlayer instance manages its own AudioBufferSourceNode,
 * gain, and playback state completely independently of the main
 * DJ engine decks. This allows vocals and instrumentals to be
 * played/paused/seeked without affecting the main mix.
 *
 * Key design decisions:
 * - Uses its own gain chain → destination (bypasses main mixer)
 * - AudioBufferSourceNodes are single-use; we recreate on seek
 * - Position tracking mirrors the pattern in engine.ts
 */

import { audioEngine } from './engine';

export class StemPlayer {
    private ctx: AudioContext | null = null;
    private source: AudioBufferSourceNode | null = null;
    private gainNode: GainNode | null = null;
    private buffer: AudioBuffer | null = null;
    private startTime: number = 0;
    private pauseOffset: number = 0;
    private _isPlaying: boolean = false;
    private _duration: number = 0;

    get isPlaying(): boolean {
        return this._isPlaying;
    }

    get duration(): number {
        return this._duration;
    }

    /**
     * Load a mono Float32Array stem into the player.
     * Converts it to an AudioBuffer for Web Audio playback.
     */
    loadStem(data: Float32Array, sampleRate: number): void {
        // Reuse the audio engine's context if available
        const engineCtx = audioEngine.context;
        if (!engineCtx) {
            throw new Error('Audio engine not initialized — cannot create stem player');
        }
        this.ctx = engineCtx;

        // Create an AudioBuffer from the raw Float32Array
        this.buffer = this.ctx.createBuffer(1, data.length, sampleRate);
        const channelData = this.buffer.getChannelData(0);
        channelData.set(data);
        this._duration = this.buffer.duration;

        // Create gain node for this stem (connected directly to destination,
        // bypassing the main mixer so it doesn't interfere)
        if (!this.gainNode) {
            this.gainNode = this.ctx.createGain();
            this.gainNode.gain.value = 0.8;
            this.gainNode.connect(this.ctx.destination);
        }

        this.pauseOffset = 0;
        this._isPlaying = false;
    }

    /**
     * Start or resume playback from the current position.
     */
    play(): void {
        if (!this.ctx || !this.buffer || !this.gainNode) return;
        if (this._isPlaying) return;

        // Ensure context is running
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.source = this.ctx.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.connect(this.gainNode);

        this.source.onended = () => {
            // Only mark as not playing if we didn't manually stop (e.g. for seek)
            if (this._isPlaying) {
                this._isPlaying = false;
                this.pauseOffset = 0; // Reset to beginning
            }
        };

        this.startTime = this.ctx.currentTime;
        this.source.start(0, this.pauseOffset);
        this._isPlaying = true;
    }

    /**
     * Pause playback, preserving the current position.
     */
    pause(): void {
        if (!this._isPlaying || !this.ctx) return;

        // Calculate where we are
        this.pauseOffset = this.getPosition();
        this._isPlaying = false;

        // Stop the source
        if (this.source) {
            try {
                this.source.onended = null;
                this.source.stop();
            } catch {
                // Already stopped
            }
            this.source.disconnect();
            this.source = null;
        }
    }

    /**
     * Toggle play/pause.
     */
    toggle(): void {
        if (this._isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * Seek to a specific position in seconds.
     */
    seekTo(position: number): void {
        if (!this.buffer) return;
        const clamped = Math.max(0, Math.min(position, this._duration - 0.1));
        const wasPlaying = this._isPlaying;

        // Stop current source
        if (this.source) {
            this._isPlaying = false; // Prevent onended from resetting position
            try {
                this.source.onended = null;
                this.source.stop();
            } catch {
                // Already stopped
            }
            this.source.disconnect();
            this.source = null;
        }

        this.pauseOffset = clamped;
        this._isPlaying = false;

        // Resume if was playing
        if (wasPlaying) {
            this.play();
        }
    }

    /**
     * Get the current playback position in seconds.
     */
    getPosition(): number {
        if (!this.ctx) return this.pauseOffset;
        if (this._isPlaying) {
            const elapsed = this.ctx.currentTime - this.startTime;
            const pos = this.pauseOffset + elapsed;
            return Math.min(pos, this._duration);
        }
        return this.pauseOffset;
    }

    /**
     * Get remaining time.
     */
    getRemaining(): number {
        return Math.max(0, this._duration - this.getPosition());
    }

    /**
     * Destroy the player and release resources.
     */
    destroy(): void {
        this.pause();
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        this.buffer = null;
        this.ctx = null;
        this._duration = 0;
        this.pauseOffset = 0;
    }
}

// ─── Singleton instances for Vocals and Instrumental ──────────────
export const vocalPlayer = new StemPlayer();
export const instrumentalPlayer = new StemPlayer();
