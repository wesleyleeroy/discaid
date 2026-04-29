/**
 * NewDJClient — New DJ page for pre-separated stems packages.
 *
 * Dual-slot timeline with automatic queue advancement:
 *   - Slot 0: "Now Playing" — currently active song
 *   - Slot 1: "Up Next" — queued to play after current
 *   - Queue: additional songs waiting in line
 *
 * Upload .zip packages or stems folders/loose files containing a vocal stem
 * and an instrumental ("music") stem. .wav and .mp3 are both supported.
 * Files are decoded and waveforms generated instantly — no AI processing.
 */

'use client';

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import Link from 'next/link';
import type { StemWaveform } from '@/lib/audio/stem-separator';
import { useNewDJStore } from '@/stores/new-dj-store';
import { createTransitionPlan, type TransitionPlan } from '@/lib/audio/dj-transition';
import { detectBPM } from '@/lib/analysis/bpm';

// ─── Waveform Generation ─────────────────────────────────────────
function generateStereoWaveform(
    left: Float32Array,
    right: Float32Array,
    numBins: number = 300
): StemWaveform {
    const peaks = new Float32Array(numBins);
    const rms = new Float32Array(numBins);
    const samplesPerBin = Math.floor(left.length / numBins);
    let maxPeak = 0.001;

    for (let bin = 0; bin < numBins; bin++) {
        const start = bin * samplesPerBin;
        const end = Math.min(start + samplesPerBin, left.length);
        let peak = 0;
        let sumSquares = 0;

        for (let i = start; i < end; i++) {
            const sample = (left[i] + right[i]) * 0.5;
            const abs = Math.abs(sample);
            if (abs > peak) peak = abs;
            sumSquares += sample * sample;
        }

        peaks[bin] = peak;
        rms[bin] = Math.sqrt(sumSquares / (end - start));
        if (peak > maxPeak) maxPeak = peak;
    }

    const invMax = 1.0 / maxPeak;
    for (let i = 0; i < numBins; i++) {
        peaks[i] *= invMax;
        rms[i] *= invMax;
    }

    return { peaks, rms };
}

// ─── Waveform Canvas ─────────────────────────────────────────────
function RemoverWaveform({
    waveform,
    progress,
    color,
    glowColor,
    height = 70,
    onSeek,
    mirrored = false,
}: {
    waveform: StemWaveform;
    progress: number;
    color: string;
    glowColor: string;
    height?: number;
    onSeek: (p: number) => void;
    mirrored?: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        ctx.clearRect(0, 0, w, h);

        const bins = waveform.peaks.length;
        const barW = Math.max(1, w / bins - 0.5);
        const midY = mirrored ? 0 : h;

        for (let i = 0; i < bins; i++) {
            const x = (i / bins) * w;
            const peakH = waveform.peaks[i] * h * 0.9;
            const rmsH = waveform.rms[i] * h * 0.9;
            const pct = i / bins;
            const isPast = pct < progress;

            const alpha = isPast ? 0.85 : 0.25;
            const rmsAlpha = isPast ? 0.5 : 0.12;

            ctx.fillStyle = color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
            if (mirrored) {
                ctx.fillRect(x, midY, barW, peakH);
            } else {
                ctx.fillRect(x, midY - peakH, barW, peakH);
            }

            ctx.fillStyle = color.replace(')', `, ${rmsAlpha})`).replace('rgb', 'rgba');
            if (mirrored) {
                ctx.fillRect(x, midY, barW, rmsH);
            } else {
                ctx.fillRect(x, midY - rmsH, barW, rmsH);
            }
        }

        if (progress > 0 && progress < 1) {
            const px = progress * w;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 8;
            ctx.fillStyle = '#fff';
            ctx.fillRect(px - 1, 0, 2, h);
            ctx.shadowBlur = 0;
        }
    }, [waveform, progress, color, glowColor, height, mirrored]);

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onSeek(p);
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width: '100%', height, cursor: 'pointer', display: 'block' }}
            onClick={handleClick}
        />
    );
}

// ─── Volume Slider ───────────────────────────────────────────────
function VolumeSlider({
    value,
    onChange,
    color,
}: {
    value: number;
    onChange: (v: number) => void;
    color: string;
}) {
    return (
        <div className="remover-volume-slider">
            <div className="remover-volume-track" style={{ background: `${color}22` }}>
                <div
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${value * 100}%`,
                        background: color,
                        borderRadius: 3,
                        opacity: 0.5,
                    }}
                />
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={value}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="remover-volume-input"
                />
            </div>
        </div>
    );
}

// ─── Utility ─────────────────────────────────────────────────────
function formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════
// ─── SongSlot — Self-contained player for one song ──────────────
// ═══════════════════════════════════════════════════════════════════
interface SongSlotHandle {
    getPos: (stem: 'vocal' | 'instrumental') => number;
    isPlaying: (stem: 'vocal' | 'instrumental') => boolean;
    startStemAt: (stem: 'vocal' | 'instrumental', offset: number, rate?: number) => void;
    startStemFade: (stem: 'vocal' | 'instrumental', offset: number, startGain: number, endGain: number, duration: number, rate?: number) => void;
    stopStemNow: (stem: 'vocal' | 'instrumental') => void;
    fadeGain: (stem: 'vocal' | 'instrumental', targetGain: number, duration: number) => void;
    rampPlaybackRate: (stem: 'vocal' | 'instrumental', targetRate: number, duration: number) => void;
}

interface SongSlotProps {
    slotIndex: 0 | 1;
    audioCtx: React.RefObject<AudioContext | null>;
    onSongEnd?: () => void;
    autoPlay?: boolean;
    label: string;
}

const SongSlot = forwardRef<SongSlotHandle, SongSlotProps>(function SongSlot({
    slotIndex,
    audioCtx,
    onSongEnd,
    autoPlay,
    label,
}, ref) {
    const storedSlot = useNewDJStore((s) => s.slots[slotIndex]);
    const setSlot = useNewDJStore((s) => s.setSlot);
    const song = storedSlot.song;

    // Refs for values that closures need to always read the latest of
    const onSongEndRef = useRef(onSongEnd);
    onSongEndRef.current = onSongEnd;
    const slotIndexRef = useRef(slotIndex);
    const prevSlotIndexRef = useRef(slotIndex);

    // Volumes from store
    const vocalVolume = storedSlot.vocalVolume;
    const instrumentalVolume = storedSlot.instrumentalVolume;
    const setVocalVolume = useCallback((v: number) => setSlot(slotIndex, { vocalVolume: v }), [slotIndex, setSlot]);
    const setInstrumentalVolume = useCallback((v: number) => setSlot(slotIndex, { instrumentalVolume: v }), [slotIndex, setSlot]);

    // Playback state (local — audio nodes can't survive unmount)
    const [vocalPlaying, setVocalPlaying] = useState(false);
    const [instrumentalPlaying, setInstrumentalPlaying] = useState(false);
    const [vocalPos, setVocalPos] = useState(storedSlot.vocalPos);
    const [instrumentalPos, setInstrumentalPos] = useState(storedSlot.instrumentalPos);

    // Audio refs
    const vocalSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const instrumentalSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const vocalGainRef = useRef<GainNode | null>(null);
    const instrumentalGainRef = useRef<GainNode | null>(null);
    const vocalStartTimeRef = useRef(0);
    const instrumentalStartTimeRef = useRef(0);
    const vocalPauseOffsetRef = useRef(storedSlot.vocalPos);
    const instrumentalPauseOffsetRef = useRef(storedSlot.instrumentalPos);
    // Effective playback rate per stem. Used to convert real-time elapsed since
    // start into buffer-position elapsed (which is what getPos must report so
    // vocals can be started at the matching instrumental offset). Approximate
    // during a rate ramp; updated to the target rate when the ramp completes.
    const vocalRateRef = useRef(1);
    const instrumentalRateRef = useRef(1);
    const animFrameRef = useRef(0);
    const songEndFiredRef = useRef(false);
    const autoPlayFiredRef = useRef(false);

    // Keep slotIndexRef in sync
    useEffect(() => {
        slotIndexRef.current = slotIndex;
    }, [slotIndex]);

    // ── Stop playback and save positions to store on unmount ──
    useEffect(() => {
        return () => {
            const ctx = audioCtx.current;
            if (ctx) {
                if (vocalSourceRef.current) {
                    const livePos = vocalPauseOffsetRef.current + (ctx.currentTime - vocalStartTimeRef.current) * vocalRateRef.current;
                    vocalPauseOffsetRef.current = Math.max(0, livePos);
                    vocalSourceRef.current.onended = null;
                    try { vocalSourceRef.current.stop(); } catch { /* already stopped */ }
                    vocalSourceRef.current.disconnect();
                    vocalSourceRef.current = null;
                }
                if (instrumentalSourceRef.current) {
                    const livePos = instrumentalPauseOffsetRef.current + (ctx.currentTime - instrumentalStartTimeRef.current) * instrumentalRateRef.current;
                    instrumentalPauseOffsetRef.current = Math.max(0, livePos);
                    instrumentalSourceRef.current.onended = null;
                    try { instrumentalSourceRef.current.stop(); } catch { /* already stopped */ }
                    instrumentalSourceRef.current.disconnect();
                    instrumentalSourceRef.current = null;
                }
            }
            cancelAnimationFrame(animFrameRef.current);
            // Use ref so we save to the correct slot even if slotIndex changed
            setSlot(slotIndexRef.current as 0 | 1, {
                vocalPos: vocalPauseOffsetRef.current,
                instrumentalPos: instrumentalPauseOffsetRef.current,
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Promotion detection: when this slot moves from Up Next (1) → Now Playing (0) ──
    useEffect(() => {
        if (prevSlotIndexRef.current === 1 && slotIndex === 0 && song) {
            // Promoted! If instrumental is playing, start vocal at the same position
            const ctx = audioCtx.current;
            if (ctx && instrumentalSourceRef.current) {
                const musicPos = instrumentalPauseOffsetRef.current + (ctx.currentTime - instrumentalStartTimeRef.current) * instrumentalRateRef.current;
                const clampedPos = Math.max(0, Math.min(musicPos, song.data.duration));

                // Only start vocal if it's not already playing
                if (!vocalSourceRef.current) {
                    songEndFiredRef.current = false;
                    // We need to start the vocal stem — use a small delay to ensure state is settled
                    setTimeout(() => {
                        vocalPauseOffsetRef.current = clampedPos;
                        setVocalPos(clampedPos);
                        // Inline stem start to avoid stale closure issues
                        if (!song || !audioCtx.current) return;
                        const actx = audioCtx.current;
                        const bufData = song.data.vocalBuffer;
                        const buf = actx.createBuffer(2, bufData.left.length, song.data.sampleRate);
                        buf.copyToChannel(new Float32Array(bufData.left), 0);
                        buf.copyToChannel(new Float32Array(bufData.right), 1);
                        const source = actx.createBufferSource();
                        source.buffer = buf;
                        source.playbackRate.value = 1;
                        const gainNode = actx.createGain();
                        gainNode.gain.value = vocalVolume;
                        source.connect(gainNode).connect(actx.destination);
                        source.start(0, clampedPos);
                        source.onended = () => {
                            setVocalPlaying(false);
                            vocalPauseOffsetRef.current = 0;
                            vocalRateRef.current = 1;
                            setVocalPos(0);
                            if (!instrumentalSourceRef.current && onSongEndRef.current && !songEndFiredRef.current) {
                                songEndFiredRef.current = true;
                                onSongEndRef.current();
                            }
                        };
                        vocalSourceRef.current = source;
                        vocalGainRef.current = gainNode;
                        vocalStartTimeRef.current = actx.currentTime;
                        vocalPauseOffsetRef.current = clampedPos;
                        vocalRateRef.current = 1;
                        setVocalPlaying(true);
                    }, 50);
                }
            }
        }
        prevSlotIndexRef.current = slotIndex;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slotIndex]);

    // ── Animation loop ──
    useEffect(() => {
        const tick = () => {
            const ctx = audioCtx.current;
            if (ctx && song) {
                if (vocalPlaying) {
                    setVocalPos(vocalPauseOffsetRef.current + (ctx.currentTime - vocalStartTimeRef.current) * vocalRateRef.current);
                }
                if (instrumentalPlaying) {
                    setInstrumentalPos(instrumentalPauseOffsetRef.current + (ctx.currentTime - instrumentalStartTimeRef.current) * instrumentalRateRef.current);
                }
            }
            animFrameRef.current = requestAnimationFrame(tick);
        };
        animFrameRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animFrameRef.current);
    }, [vocalPlaying, instrumentalPlaying, audioCtx, song]);

    // ── Stop a stem ──
    const stopStem = useCallback((stem: 'vocal' | 'instrumental') => {
        if (stem === 'vocal') {
            if (vocalSourceRef.current) {
                vocalSourceRef.current.onended = null;
                try { vocalSourceRef.current.stop(); } catch { /* already stopped */ }
                vocalSourceRef.current.disconnect();
            }
            vocalSourceRef.current = null;
            setVocalPlaying(false);
        } else {
            if (instrumentalSourceRef.current) {
                instrumentalSourceRef.current.onended = null;
                try { instrumentalSourceRef.current.stop(); } catch { /* already stopped */ }
                instrumentalSourceRef.current.disconnect();
            }
            instrumentalSourceRef.current = null;
            setInstrumentalPlaying(false);
        }
    }, []);

    // ── Start a stem ──
    const startStem = useCallback(
        (stem: 'vocal' | 'instrumental', offset: number, rate: number = 1) => {
            if (!song) return;
            const ctx = audioCtx.current;
            if (!ctx) return;

            const bufData = stem === 'vocal' ? song.data.vocalBuffer : song.data.instrumentalBuffer;
            const buf = ctx.createBuffer(2, bufData.left.length, song.data.sampleRate);
            buf.copyToChannel(new Float32Array(bufData.left), 0);
            buf.copyToChannel(new Float32Array(bufData.right), 1);

            const source = ctx.createBufferSource();
            source.buffer = buf;
            source.playbackRate.value = rate;
            const gainNode = ctx.createGain();
            gainNode.gain.value = stem === 'vocal' ? vocalVolume : instrumentalVolume;
            source.connect(gainNode).connect(ctx.destination);

            const clampedOffset = Math.max(0, Math.min(offset, song.data.duration));
            source.start(0, clampedOffset);

            source.onended = () => {
                if (stem === 'vocal') {
                    setVocalPlaying(false);
                    vocalPauseOffsetRef.current = 0;
                    vocalRateRef.current = 1;
                    setVocalPos(0);
                } else {
                    setInstrumentalPlaying(false);
                    instrumentalPauseOffsetRef.current = 0;
                    instrumentalRateRef.current = 1;
                    setInstrumentalPos(0);
                }
                // Check if both stems have ended (song is done)
                const otherDone = stem === 'vocal'
                    ? !instrumentalSourceRef.current
                    : !vocalSourceRef.current;
                if (otherDone && onSongEndRef.current && !songEndFiredRef.current) {
                    songEndFiredRef.current = true;
                    onSongEndRef.current();
                }
            };

            if (stem === 'vocal') {
                vocalSourceRef.current = source;
                vocalGainRef.current = gainNode;
                vocalStartTimeRef.current = ctx.currentTime;
                vocalRateRef.current = rate;
                setVocalPlaying(true);
            } else {
                instrumentalSourceRef.current = source;
                instrumentalGainRef.current = gainNode;
                instrumentalStartTimeRef.current = ctx.currentTime;
                instrumentalRateRef.current = rate;
                setInstrumentalPlaying(true);
            }
        },
        [song, vocalVolume, instrumentalVolume, audioCtx]
    );

    // ── Imperative handle for transition control ──
    useImperativeHandle(ref, () => ({
        getPos: (stem) => {
            const ctx = audioCtx.current;
            if (stem === 'vocal') {
                if (vocalPlaying && ctx) return vocalPauseOffsetRef.current + (ctx.currentTime - vocalStartTimeRef.current) * vocalRateRef.current;
                return vocalPauseOffsetRef.current;
            } else {
                if (instrumentalPlaying && ctx) return instrumentalPauseOffsetRef.current + (ctx.currentTime - instrumentalStartTimeRef.current) * instrumentalRateRef.current;
                return instrumentalPauseOffsetRef.current;
            }
        },
        isPlaying: (stem) => stem === 'vocal' ? vocalPlaying : instrumentalPlaying,
        startStemAt: (stem, offset, rate = 1) => {
            if (stem === 'vocal' && vocalSourceRef.current) stopStem('vocal');
            if (stem === 'instrumental' && instrumentalSourceRef.current) stopStem('instrumental');
            // Set offset so the progress bar reflects the correct position
            if (stem === 'vocal') {
                vocalPauseOffsetRef.current = offset;
                setVocalPos(offset);
            } else {
                instrumentalPauseOffsetRef.current = offset;
                setInstrumentalPos(offset);
            }
            songEndFiredRef.current = false;
            startStem(stem, offset, rate);
        },
        startStemFade: (stem, offset, startGain, endGain, duration, rate = 1) => {
            if (stem === 'vocal' && vocalSourceRef.current) stopStem('vocal');
            if (stem === 'instrumental' && instrumentalSourceRef.current) stopStem('instrumental');
            // Set offset so the progress bar reflects the correct position
            if (stem === 'vocal') {
                vocalPauseOffsetRef.current = offset;
                setVocalPos(offset);
            } else {
                instrumentalPauseOffsetRef.current = offset;
                setInstrumentalPos(offset);
            }
            songEndFiredRef.current = false;
            startStem(stem, offset, rate);
            const gainNode = stem === 'vocal' ? vocalGainRef.current : instrumentalGainRef.current;
            if (gainNode && audioCtx.current) {
                const now = audioCtx.current.currentTime;
                gainNode.gain.cancelScheduledValues(now);
                // Quadratic ease-in (t²): the stem stays quiet through the
                // first half of the fade and rises into full volume near
                // the end, giving a "soft entrance" feel rather than the
                // equal-power sin which gets to ~70% loud at the midpoint.
                const steps = 128;
                const curve = new Float32Array(steps);
                for (let i = 0; i < steps; i++) {
                    const t = i / (steps - 1);
                    curve[i] = startGain + (endGain - startGain) * t * t;
                }
                gainNode.gain.setValueCurveAtTime(curve, now, duration);
            }
        },
        stopStemNow: (stem) => {
            const ctx = audioCtx.current;
            if (stem === 'vocal') {
                if (ctx && vocalSourceRef.current) vocalPauseOffsetRef.current += (ctx.currentTime - vocalStartTimeRef.current) * vocalRateRef.current;
            } else {
                if (ctx && instrumentalSourceRef.current) instrumentalPauseOffsetRef.current += (ctx.currentTime - instrumentalStartTimeRef.current) * instrumentalRateRef.current;
            }
            stopStem(stem);
        },
        fadeGain: (stem, targetGain, duration) => {
            const gainNode = stem === 'vocal' ? vocalGainRef.current : instrumentalGainRef.current;
            if (gainNode && audioCtx.current) {
                const now = audioCtx.current.currentTime;
                const currentGain = gainNode.gain.value;
                gainNode.gain.cancelScheduledValues(now);
                // Equal-power fade-out curve (cos)
                const steps = 128;
                const curve = new Float32Array(steps);
                for (let i = 0; i < steps; i++) {
                    const t = i / (steps - 1);
                    curve[i] = currentGain * Math.cos(t * Math.PI / 2) + targetGain * (1 - Math.cos(t * Math.PI / 2));
                }
                gainNode.gain.setValueCurveAtTime(curve, now, duration);
            }
        },
        rampPlaybackRate: (stem, targetRate, duration) => {
            const ctx = audioCtx.current;
            if (!ctx) return;
            const source = stem === 'vocal' ? vocalSourceRef.current : instrumentalSourceRef.current;
            if (!source) return;

            const startTimeRef = stem === 'vocal' ? vocalStartTimeRef : instrumentalStartTimeRef;
            const pauseOffsetRef = stem === 'vocal' ? vocalPauseOffsetRef : instrumentalPauseOffsetRef;
            const rateRef = stem === 'vocal' ? vocalRateRef : instrumentalRateRef;

            const now = ctx.currentTime;
            const oldRate = rateRef.current;

            // Snapshot current buffer position so getPos stays consistent across
            // the rate change. (During the ramp itself, getPos is approximate
            // since we hold rate constant in JS; the AudioParam ramps smoothly.)
            const currentBufferPos = pauseOffsetRef.current + (now - startTimeRef.current) * oldRate;
            pauseOffsetRef.current = currentBufferPos;
            startTimeRef.current = now;

            source.playbackRate.cancelScheduledValues(now);
            source.playbackRate.setValueAtTime(oldRate, now);
            source.playbackRate.linearRampToValueAtTime(targetRate, now + duration);

            // When the ramp completes, snapshot the integrated buffer position
            // (avg-rate × duration) and switch JS state to the new constant rate.
            const stem2 = stem; // capture for closure
            setTimeout(() => {
                const ctxNow = audioCtx.current;
                if (!ctxNow) return;
                const avgRate = (oldRate + targetRate) / 2;
                pauseOffsetRef.current += duration * avgRate;
                startTimeRef.current = ctxNow.currentTime;
                rateRef.current = targetRate;
                if (stem2 === 'vocal') {
                    setVocalPos(pauseOffsetRef.current);
                } else {
                    setInstrumentalPos(pauseOffsetRef.current);
                }
            }, duration * 1000);
        },
    }), [startStem, stopStem, vocalPlaying, instrumentalPlaying, audioCtx]);

    // ── Toggle a stem ──
    const toggleStem = useCallback(
        (stem: 'vocal' | 'instrumental') => {
            if (!song) return;
            const isPlaying = stem === 'vocal' ? vocalPlaying : instrumentalPlaying;
            const pauseRef = stem === 'vocal' ? vocalPauseOffsetRef : instrumentalPauseOffsetRef;
            const startRef = stem === 'vocal' ? vocalStartTimeRef : instrumentalStartTimeRef;
            const rateRef = stem === 'vocal' ? vocalRateRef : instrumentalRateRef;

            if (isPlaying) {
                const ctx = audioCtx.current;
                if (ctx) pauseRef.current += (ctx.currentTime - startRef.current) * rateRef.current;
                stopStem(stem);
                rateRef.current = 1;
            } else {
                songEndFiredRef.current = false;
                startStem(stem, pauseRef.current);
            }
        },
        [song, vocalPlaying, instrumentalPlaying, stopStem, startStem, audioCtx]
    );

    // ── Toggle both ──
    const togglePlayAll = useCallback(() => {
        if (!song) return;
        const anyPlaying = vocalPlaying || instrumentalPlaying;
        songEndFiredRef.current = false;
        if (anyPlaying) {
            if (vocalPlaying) {
                const ctx = audioCtx.current;
                if (ctx) vocalPauseOffsetRef.current += (ctx.currentTime - vocalStartTimeRef.current) * vocalRateRef.current;
                stopStem('vocal');
                vocalRateRef.current = 1;
            }
            if (instrumentalPlaying) {
                const ctx = audioCtx.current;
                if (ctx) instrumentalPauseOffsetRef.current += (ctx.currentTime - instrumentalStartTimeRef.current) * instrumentalRateRef.current;
                stopStem('instrumental');
                instrumentalRateRef.current = 1;
            }
        } else {
            startStem('vocal', vocalPauseOffsetRef.current);
            startStem('instrumental', instrumentalPauseOffsetRef.current);
        }
    }, [song, vocalPlaying, instrumentalPlaying, stopStem, startStem, audioCtx]);

    // ── Seek ──
    const seekStem = useCallback(
        (stem: 'vocal' | 'instrumental', p: number) => {
            if (!song) return;
            const newPos = p * song.data.duration;
            const isPlaying = stem === 'vocal' ? vocalPlaying : instrumentalPlaying;
            const pauseRef = stem === 'vocal' ? vocalPauseOffsetRef : instrumentalPauseOffsetRef;
            const setPos = stem === 'vocal' ? setVocalPos : setInstrumentalPos;

            pauseRef.current = newPos;
            setPos(newPos);
            if (isPlaying) { stopStem(stem); startStem(stem, newPos); }
        },
        [song, vocalPlaying, instrumentalPlaying, stopStem, startStem]
    );

    const seekAll = useCallback(
        (p: number) => {
            if (!song) return;
            const newPos = p * song.data.duration;
            vocalPauseOffsetRef.current = newPos;
            instrumentalPauseOffsetRef.current = newPos;
            setVocalPos(newPos);
            setInstrumentalPos(newPos);
            if (vocalPlaying) { stopStem('vocal'); startStem('vocal', newPos); }
            if (instrumentalPlaying) { stopStem('instrumental'); startStem('instrumental', newPos); }
        },
        [song, vocalPlaying, instrumentalPlaying, stopStem, startStem]
    );

    // ── Sync vocal to music ──
    const syncVocalToMusic = useCallback(() => {
        if (!song) return;
        let musicPos: number;
        if (instrumentalPlaying) {
            const ctx = audioCtx.current;
            if (ctx) {
                musicPos = instrumentalPauseOffsetRef.current + (ctx.currentTime - instrumentalStartTimeRef.current) * instrumentalRateRef.current;
            } else {
                musicPos = instrumentalPos;
            }
        } else {
            musicPos = instrumentalPauseOffsetRef.current;
        }
        musicPos = Math.max(0, Math.min(musicPos, song.data.duration));
        if (vocalPlaying) stopStem('vocal');
        vocalPauseOffsetRef.current = musicPos;
        setVocalPos(musicPos);
        startStem('vocal', musicPos);
    }, [song, instrumentalPlaying, instrumentalPos, vocalPlaying, stopStem, startStem, audioCtx]);

    // ── Volume ──
    useEffect(() => {
        if (vocalGainRef.current) vocalGainRef.current.gain.value = vocalVolume;
    }, [vocalVolume]);
    useEffect(() => {
        if (instrumentalGainRef.current) instrumentalGainRef.current.gain.value = instrumentalVolume;
    }, [instrumentalVolume]);

    // ── Auto-play on mount or promotion (for advancing songs) ──
    useEffect(() => {
        if (autoPlay && song && !autoPlayFiredRef.current) {
            autoPlayFiredRef.current = true;
            const t = setTimeout(() => {
                songEndFiredRef.current = false;
                // Only start stems that aren't already playing (promotion keeps instrumental alive)
                if (!vocalSourceRef.current) {
                    startStem('vocal', vocalPauseOffsetRef.current);
                }
                if (!instrumentalSourceRef.current) {
                    startStem('instrumental', instrumentalPauseOffsetRef.current);
                }
            }, 100);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoPlay, song]);

    if (!song) return null;

    // ── Computed ──
    const vocalProgress = song.data.duration > 0 ? vocalPos / song.data.duration : 0;
    const instrumentalProgress = song.data.duration > 0 ? instrumentalPos / song.data.duration : 0;
    const anyPlaying = vocalPlaying || instrumentalPlaying;
    const displayPos = Math.max(vocalPos, instrumentalPos);
    const displayProgress = song.data.duration > 0 ? displayPos / song.data.duration : 0;

    return (
        <div className="animate-fade-in" style={{ marginBottom: 24 }}>
            {/* Header */}
            <div className="remover-results-header">
                <div className="remover-results-title">
                    <span className="remover-results-icon">{slotIndex === 0 ? '▶' : '⏭'}</span>
                    <span style={{ opacity: 0.5, fontSize: '0.75rem', marginRight: 8 }}>{label}</span>
                    {song.name}
                    {song.data.bpm !== undefined && (
                        <span
                            style={{
                                marginLeft: 10,
                                padding: '2px 9px',
                                borderRadius: 999,
                                background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(16,185,129,0.25))',
                                border: '1px solid rgba(139,92,246,0.45)',
                                color: '#e9d5ff',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                letterSpacing: 0.5,
                                fontVariantNumeric: 'tabular-nums',
                                verticalAlign: 'middle',
                            }}
                            title="Detected BPM"
                        >
                            {Math.round(song.data.bpm)} BPM
                        </span>
                    )}
                </div>
            </div>

            {/* Waveforms */}
            <div className="remover-waveforms">
                {/* Music */}
                <div className={`remover-wave-row ${!instrumentalPlaying ? 'remover-wave-row-idle' : ''}`}>
                    <div className="remover-wave-label-area">
                        <button
                            className={`remover-stem-toggle ${instrumentalPlaying ? 'remover-stem-toggle-active-green' : 'remover-stem-toggle-muted'}`}
                            onClick={() => toggleStem('instrumental')}
                            title={instrumentalPlaying ? 'Pause Music' : 'Play Music'}
                        >
                            {instrumentalPlaying ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
                            )}
                        </button>
                        <span className="remover-wave-label remover-wave-label-green">Music</span>
                        <VolumeSlider value={instrumentalVolume} onChange={setInstrumentalVolume} color="#10b981" />
                    </div>
                    <div className="remover-wave-canvas-area">
                        <RemoverWaveform waveform={song.data.instrumental} progress={instrumentalProgress} color="#10b981" glowColor="rgba(16, 185, 129, 0.3)" height={70} onSeek={(p) => seekStem('instrumental', p)} mirrored={false} />
                    </div>
                </div>

                {/* Vocal */}
                <div className={`remover-wave-row ${!vocalPlaying ? 'remover-wave-row-idle' : ''}`}>
                    <div className="remover-wave-label-area">
                        <div className="remover-vocal-controls">
                            <button
                                className={`remover-stem-toggle ${vocalPlaying ? 'remover-stem-toggle-active-purple' : 'remover-stem-toggle-muted'}`}
                                onClick={() => toggleStem('vocal')}
                                title={vocalPlaying ? 'Pause Vocal' : 'Play Vocal'}
                            >
                                {vocalPlaying ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
                                )}
                            </button>
                            <button className="remover-sync-btn" onClick={syncVocalToMusic} title="Sync vocal to music position">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1 4 1 10 7 10" />
                                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                                </svg>
                            </button>
                        </div>
                        <span className="remover-wave-label remover-wave-label-purple">Vocal</span>
                        <VolumeSlider value={vocalVolume} onChange={setVocalVolume} color="#8b5cf6" />
                    </div>
                    <div className="remover-wave-canvas-area">
                        <RemoverWaveform waveform={song.data.vocals} progress={vocalProgress} color="#8b5cf6" glowColor="rgba(139, 92, 246, 0.3)" height={70} onSeek={(p) => seekStem('vocal', p)} mirrored={true} />
                    </div>
                </div>
            </div>

            {/* Playback bar */}
            <div className="remover-playback-bar">
                <button className="remover-play-btn" onClick={togglePlayAll} title={anyPlaying ? 'Pause All' : 'Play All'}>
                    {anyPlaying ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
                    )}
                </button>
                <span className="remover-time">{formatTime(displayPos)}</span>
                <div className="remover-seek-bar" onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); seekAll(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))); }}>
                    <div className="remover-seek-track" />
                    <div className="remover-seek-fill" style={{ width: `${displayProgress * 100}%` }} />
                    <div className="remover-seek-thumb" style={{ left: `${displayProgress * 100}%` }} />
                </div>
                <span className="remover-time">{formatTime(song.data.duration)}</span>
            </div>

            {/* Footer */}
            <div className="remover-info-footer">
                <span>⚡ Instant playback</span>
                <span>{song.data.sampleRate} Hz</span>
                <span>{formatTime(song.data.duration)}</span>
            </div>
        </div>
    );
});

// ═══════════════════════════════════════════════════════════════════
// ─── Quick Play — Dual Slot Timeline + Queue ────────────────────
// ═══════════════════════════════════════════════════════════════════
function QuickStemPlayer({ audioCtx }: { audioCtx: React.RefObject<AudioContext | null> }) {
    const store = useNewDJStore();
    const { stage, slots, queue } = store;

    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [folderDropHighlight, setFolderDropHighlight] = useState(false);
    const [autoPlaySlot0, setAutoPlaySlot0] = useState(false);

    // ── Transition state ──
    const slot0Ref = useRef<SongSlotHandle>(null);
    const slot1Ref = useRef<SongSlotHandle>(null);
    const [transitionState, setTransitionState] = useState<'idle' | 'planning' | 'ready' | 'active' | 'done'>('idle');
    const transitionPlanRef = useRef<TransitionPlan | null>(null);
    const transitionTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const song0IdRef = useRef<number | null>(null);
    const song1IdRef = useRef<number | null>(null);

    // ── Compute transition plan when both songs are loaded ──
    useEffect(() => {
        const s0 = slots[0].song;
        const s1 = slots[1].song;
        if (s0 && s1 && (s0.id !== song0IdRef.current || s1.id !== song1IdRef.current)) {
            song0IdRef.current = s0.id;
            song1IdRef.current = s1.id;
            setTransitionState('planning');
            // Compute plan in next tick to not block render
            setTimeout(() => {
                try {
                    const plan = createTransitionPlan(
                        s0.data.vocalBuffer.left,
                        s0.data.vocalBuffer.right,
                        s0.data.duration,
                        s0.data.sampleRate,
                        s1.data.vocalBuffer.left,
                        s1.data.vocalBuffer.right,
                        s1.data.sampleRate,
                        s0.data.bpm,
                        s1.data.bpm,
                    );
                    transitionPlanRef.current = plan;
                    setTransitionState('ready');
                    console.log('[DJ] Transition plan:', {
                        crossfadeAt: `${plan.crossfadeStart.toFixed(1)}s`,
                        fadeDuration: `${plan.crossfadeDuration.toFixed(1)}s`,
                        vocalSwitch: `${plan.vocalSwitchTime.toFixed(1)}s`,
                        song2Entry: `${plan.song2VocalEntry.toFixed(1)}s`,
                        rateRatio: plan.song2RateRatio.toFixed(3),
                        rampDuration: `${plan.song2RateRampDuration.toFixed(1)}s`,
                    });
                } catch (err) {
                    console.error('[DJ] Failed to compute transition plan:', err);
                    transitionPlanRef.current = null;
                    setTransitionState('idle');
                }
            }, 0);
        } else if (!s0 || !s1) {
            transitionPlanRef.current = null;
            if (transitionState !== 'active') setTransitionState('idle');
            song0IdRef.current = s0?.id ?? null;
            song1IdRef.current = s1?.id ?? null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slots[0].song?.id, slots[1].song?.id]);

    // ── Monitor slot 0 position to trigger transition ──
    useEffect(() => {
        if (transitionState !== 'ready') return;
        const check = () => {
            const plan = transitionPlanRef.current;
            if (!plan || !slot0Ref.current) return;
            const pos = slot0Ref.current.getPos('instrumental');
            if (slot0Ref.current.isPlaying('instrumental') && pos >= plan.crossfadeStart) {
                executeTransition();
            }
        };
        const interval = setInterval(check, 80);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transitionState]);

    // ── Execute the transition ──
    const executeTransition = useCallback(() => {
        const plan = transitionPlanRef.current;
        if (!plan || !slot0Ref.current || !slot1Ref.current) return;

        const s1Data = useNewDJStore.getState().slots[1];
        if (!s1Data.song) return;

        setTransitionState('active');
        console.log('[DJ] Transition started — instrumental blend');

        const totalDuration = plan.crossfadeDuration; // e.g. 10s
        const s0Data = useNewDJStore.getState().slots[0];

        // ── Re-anchor timing to the ACTUAL current song-1 position ──
        // The plan was computed assuming the transition would start exactly
        // when song 1 reached plan.crossfadeStart. If song 1 was already past
        // that point at planning time (e.g., user added song 2 to the queue
        // mid-playback past the planned crossfade), the monitor fires the
        // trigger immediately and the plan's relative timings are stale.
        // Use song 1's current position as the effective start instead, and
        // re-pick song2VocalEntry so it actually lines up with where song 2
        // will be when vocals switch.
        const currentSong1Pos = slot0Ref.current.getPos('instrumental');
        const effectiveStart = Math.max(plan.crossfadeStart, currentSong1Pos);
        const expectedInstAtSwitch = Math.max(
            0,
            (plan.vocalSwitchTime - effectiveStart) * plan.song2RateRatio,
        );
        const TARGET_DELAY = 1.5;
        const MAX_DELAY = 5;
        const idealEntry = expectedInstAtSwitch + TARGET_DELAY * plan.song2RateRatio;
        const song2DurationS = s1Data.song.data.duration;

        // Pick a phrase boundary that's actually reachable from where song 2
        // will be at vocal-switch time. Prefer phrases inside the [0, MAX]
        // delay window; otherwise the closest available phrase. Never plan
        // an entry past the song's end.
        let effectiveVocalEntry: number;
        const inWindow = plan.song2PhraseStarts.filter(
            (p) =>
                p >= expectedInstAtSwitch - 0.1 &&
                p <= expectedInstAtSwitch + MAX_DELAY * plan.song2RateRatio,
        );
        if (inWindow.length > 0) {
            effectiveVocalEntry = inWindow.reduce(
                (best, p) => Math.abs(p - idealEntry) < Math.abs(best - idealEntry) ? p : best,
                inWindow[0],
            );
        } else {
            const next = plan.song2PhraseStarts.find((p) => p >= expectedInstAtSwitch);
            effectiveVocalEntry = next ?? idealEntry;
        }
        effectiveVocalEntry = Math.max(0, Math.min(effectiveVocalEntry, song2DurationS - 0.5));

        if (effectiveStart !== plan.crossfadeStart || effectiveVocalEntry !== plan.song2VocalEntry) {
            console.log(
                `[DJ] Re-anchored timing: crossfadeStart ${plan.crossfadeStart.toFixed(1)}→${effectiveStart.toFixed(1)}, ` +
                `song2VocalEntry ${plan.song2VocalEntry.toFixed(2)}→${effectiveVocalEntry.toFixed(2)}`,
            );
        }

        // Both instrumentals sit at this fraction of their native volume during
        // the held-blend window. 0.75² + 0.75² ≈ 1.13, so combined loudness is
        // close to a single track at full — "decent volume, both playing"
        // without sounding stacked or muddy.
        const BLEND_FRACTION = 0.75;
        const song2BlendVolume = s1Data.instrumentalVolume * BLEND_FRACTION;
        const song1BlendVolume = s0Data.instrumentalVolume * BLEND_FRACTION;

        // Phase budget for a 14-second crossfade:
        //   t=0.0   ─────────────► song 2 fades in 0 → blend (3.0s, quadratic)
        //   t=3.0   ─────────────► song 1 ducks full → blend (1.0s)
        //   t=4.0   ─── HELD ────► both at blend volume (3.0s)
        //   t=7.0   ─── CROSS ───► song 1: blend → 0      (6.5s)  ◀─ extended
        //                          song 2: blend → full   (6.5s)  ◀─ extended
        //   t=13.5  ─────────────► song 2 alone at full
        //   t=14.0  ─────────────► song 1 source stopped
        //
        // The cross-trade (Phase 4) is now 6.5s — both instrumentals stay
        // audible while their volumes invert, which is the long blended
        // hand-off the user wanted.
        const fadeInDuration       = (totalDuration * 3) / 14;   // 3.0s
        const enterBlendDelay      = (totalDuration * 3) / 14;   // 3.0s — when song 1 starts ducking
        const enterBlendDuration   = (totalDuration * 1) / 14;   // 1.0s — song 1's duck time
        const exitBlendDelay       = (totalDuration * 7) / 14;   // 7.0s — when both start their final ramps
        const exitBlendDuration    = (totalDuration * 6.5) / 14; // 6.5s — song 1 fade-out / song 2 rise-to-full

        // We wrap the two independent timelines (instrumental blend & vocal switch)
        // in Promises so we can wait for BOTH to finish before advancing the queue.
        // Advancing early (which happened previously if vocals switched quickly)
        // caused react keys to shift, making slot0Ref point to the new song,
        // which then got its instrumental stopped by lingering fade-out timers!

        // Timeline 1: Instrumental Blend
        const instrumentalPromise = new Promise<void>((resolve) => {
            // ── Phase 1: song 2 enters quietly and rises to blend volume ──
            // Quadratic ease-in (handled inside startStemFade) keeps the
            // entrance soft. We deliberately stop at BLEND volume, not full,
            // so that during the held-blend window the two tracks balance.
            slot1Ref.current?.startStemFade(
                'instrumental',
                0,
                0,
                song2BlendVolume,
                fadeInDuration,
                plan.song2RateRatio,
            );

            console.log(
                `[DJ] Phase 1 (0–${fadeInDuration.toFixed(1)}s): song 2 fading in 0 → ${song2BlendVolume.toFixed(2)}`,
            );

            // ── Phase 2: song 1 ducks from full → blend volume ──
            // By the time this completes, both instrumentals are sitting at
            // the same blend level, which is the held-blend the user wanted.
            const enterBlendTimer = setTimeout(() => {
                console.log(`[DJ] Phase 2: song 1 ducking → ${song1BlendVolume.toFixed(2)} over ${enterBlendDuration.toFixed(1)}s`);
                slot0Ref.current?.fadeGain('instrumental', song1BlendVolume, enterBlendDuration);
            }, enterBlendDelay * 1000);
            transitionTimersRef.current.push(enterBlendTimer);

            // ── Phase 3: HELD BLEND ── both stems sit at blend volume.
            // No automation scheduled; the gain nodes just hold their levels
            // until Phase 4 fires. This is the audible "playing together"
            // window (~3s by default).
            const heldBlendStart = enterBlendDelay + enterBlendDuration;
            const heldBlendDuration = exitBlendDelay - heldBlendStart;
            console.log(
                `[DJ] Phase 3 (${heldBlendStart.toFixed(1)}–${exitBlendDelay.toFixed(1)}s): held blend, both at ~${BLEND_FRACTION.toFixed(2)} for ${heldBlendDuration.toFixed(1)}s`,
            );

            // ── Phase 4: song 1 fades out, song 2 rises to full ──
            const exitBlendTimer = setTimeout(() => {
                console.log(
                    `[DJ] Phase 4: song 1 → 0 / song 2 → ${s1Data.instrumentalVolume.toFixed(2)} over ${exitBlendDuration.toFixed(1)}s`,
                );
                slot0Ref.current?.fadeGain('instrumental', 0, exitBlendDuration);
                slot1Ref.current?.fadeGain('instrumental', s1Data.instrumentalVolume, exitBlendDuration);
            }, exitBlendDelay * 1000);
            transitionTimersRef.current.push(exitBlendTimer);

            // ── Phase 5: stop song 1's instrumental source ──
            const stopOldTimer = setTimeout(() => {
                slot0Ref.current?.stopStemNow('instrumental');
                resolve(); // Instrumental transition is done
            }, totalDuration * 1000 + 100);
            transitionTimersRef.current.push(stopOldTimer);
        });

        // Timeline 2: Vocal Switch
        const vocalPromise = new Promise<void>((resolve) => {
            // Use the re-anchored effectiveStart, NOT plan.crossfadeStart.
            // This keeps the vocal-switch timer in sync with the actual song-1
            // playback position even if the plan was stale.
            const vocalDelay = Math.max(0, (plan.vocalSwitchTime - effectiveStart)) * 1000;
            const vocalTimer = setTimeout(() => {
                console.log('[DJ] Song 1 vocals ended — waiting for song 2 vocal entry...');
                slot0Ref.current?.stopStemNow('vocal');

                // Wait for song 2's instrumental to reach the chosen phrase
                // boundary, then start vocals at the live (rate-aware) buffer
                // position so they stay locked to the instrumental.
                //
                // instPos and target are BUFFER offsets; waitSec is real time
                // (buffer advances `rateRatio` per real second).
                const instPos = slot1Ref.current?.getPos('instrumental') ?? 0;
                const target = effectiveVocalEntry;
                const rate = Math.max(plan.song2RateRatio, 1e-3);
                const waitSec = Math.max(0, (target - instPos) / rate);
                // Cap is generous (15 s) so unusual plans still ultimately
                // start vocals — if we hit the cap, vocals will start at the
                // live position rather than the targeted phrase, which is
                // still better than no vocals at all.
                const MAX_WAIT_SEC = 15;
                const cappedWait = Math.min(waitSec, MAX_WAIT_SEC);

                console.log(
                    `[DJ] Vocal entry at song-2 offset ${target.toFixed(2)}s ` +
                    `(waiting ${cappedWait.toFixed(2)}s from current ${instPos.toFixed(2)}s, rate ${rate.toFixed(3)})`,
                );

                const phraseTimer = setTimeout(() => {
                    // Read the instrumental's true buffer position (rate-aware)
                    // so the vocal source starts at the matching offset and
                    // stays in sync with the instrumental.
                    const livePos = slot1Ref.current?.getPos('instrumental') ?? target;
                    const safeLivePos = Math.max(0, Math.min(livePos, song2DurationS - 0.5));
                    // Vocals must enter at the SAME rate as the instrumental
                    // (currently plan.song2RateRatio); otherwise they desync.
                    slot1Ref.current?.startStemAt('vocal', safeLivePos, plan.song2RateRatio);
                    console.log(`[DJ] Song 2 vocals started at offset ${safeLivePos.toFixed(2)}s`);
                    // Now ramp BOTH stems back to 1.0 over the planned ramp
                    // window. They share the same rate envelope so they stay
                    // locked together while the tempo settles to native.
                    if (plan.song2RateRatio !== 1) {
                        slot1Ref.current?.rampPlaybackRate('instrumental', 1, plan.song2RateRampDuration);
                        slot1Ref.current?.rampPlaybackRate('vocal', 1, plan.song2RateRampDuration);
                    }
                    resolve();
                }, cappedWait * 1000);
                transitionTimersRef.current.push(phraseTimer);
            }, vocalDelay);
            transitionTimersRef.current.push(vocalTimer);
        });

        // Wait for both instrumental and vocal sequences to fully finish
        Promise.all([instrumentalPromise, vocalPromise]).then(() => {
            // A short grace period to let the final automation values settle
            const advanceTimer = setTimeout(() => {
                console.log('[DJ] Entire transition complete, advancing queue');
                store.advance();
                setTransitionState('idle');
                transitionPlanRef.current = null;
                transitionTimersRef.current = [];
            }, 300);
            transitionTimersRef.current.push(advanceTimer);
        });
    }, [store]);

    // ── Clean up transition timers on unmount ──
    useEffect(() => {
        return () => {
            transitionTimersRef.current.forEach((t) => clearTimeout(t));
        };
    }, []);

    // ── Song end handler — fallback if transition doesn't fire ──
    const handleSongEnd = useCallback(() => {
        if (transitionState === 'active') return; // Transition handles advancement
        const hasNext = useNewDJStore.getState().slots[1].song !== null;
        store.advance();
        if (hasNext) {
            setAutoPlaySlot0(true);
            setTimeout(() => setAutoPlaySlot0(false), 500);
        }
    }, [store, transitionState]);

    // ── Decode audio and add song to store ──
    const decodeAndAddSong = useCallback(async (
        vocalArrayBuffer: ArrayBuffer,
        instrumentalArrayBuffer: ArrayBuffer,
        songName: string,
    ) => {
        if (!audioCtx.current) {
            audioCtx.current = new AudioContext({ sampleRate: 44100 });
        }
        const ctx = audioCtx.current;

        const [vocalAudio, instrumentalAudio] = await Promise.all([
            ctx.decodeAudioData(vocalArrayBuffer),
            ctx.decodeAudioData(instrumentalArrayBuffer),
        ]);

        const vocalLeft = vocalAudio.getChannelData(0);
        const vocalRight = vocalAudio.numberOfChannels > 1 ? vocalAudio.getChannelData(1) : vocalLeft;
        const instLeft = instrumentalAudio.getChannelData(0);
        const instRight = instrumentalAudio.numberOfChannels > 1 ? instrumentalAudio.getChannelData(1) : instLeft;

        const numBins = 300;
        const vocalsWf = generateStereoWaveform(vocalLeft, vocalRight, numBins);
        const instrumentalWf = generateStereoWaveform(instLeft, instRight, numBins);
        const duration = Math.max(vocalAudio.duration, instrumentalAudio.duration);

        // BPM is detected from the instrumental (cleaner beats than vocals).
        // Confidence below ~0.25 is unreliable enough that we'd rather skip
        // tempo-matching than match to the wrong tempo.
        let detectedBPM: number | undefined;
        try {
            const bpmResult = detectBPM(instrumentalAudio);
            if (bpmResult.confidence >= 0.25) {
                detectedBPM = bpmResult.bpm;
                console.log(`[DJ] "${songName}" BPM ${bpmResult.bpm} (conf ${bpmResult.confidence.toFixed(2)})`);
            } else {
                console.log(`[DJ] "${songName}" BPM detection low-confidence; will play at native rate`);
            }
        } catch (err) {
            console.warn('[DJ] BPM detection failed:', err);
        }

        store.addSong({
            name: songName,
            data: {
                vocals: vocalsWf,
                instrumental: instrumentalWf,
                vocalBuffer: { left: vocalLeft, right: vocalRight },
                instrumentalBuffer: { left: instLeft, right: instRight },
                duration,
                sampleRate: vocalAudio.sampleRate,
                bpm: detectedBPM,
            },
        });
    }, [audioCtx, store]);

    // ── Process ZIP file ──
    const processZip = useCallback(async (file: File) => {
        setError(null);
        setIsLoading(true);

        try {
            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(file);

            const audioEntries = Object.values(zip.files).filter(
                (f) => !f.dir && /\.(wav|mp3)$/i.test(f.name)
            );
            const vocalsFile = audioEntries.find((f) => /vocal/i.test(f.name));
            const instrumentalFile = audioEntries.find(
                (f) => /(instrumental|music|accompaniment|backing|karaoke|no[_ -]?vocal)/i.test(f.name)
            );
            const metadataFile = zip.file('metadata.json');

            if (!vocalsFile || !instrumentalFile) {
                throw new Error('Invalid stems package. Expected a vocal and an instrumental/music file (.wav or .mp3) inside the ZIP.');
            }

            let songName = file.name.replace(/\.zip$/, '').replace(/_stems$/, '');
            if (metadataFile) {
                try {
                    const metaText = await metadataFile.async('string');
                    const meta = JSON.parse(metaText);
                    if (meta.name) songName = meta.name;
                } catch { /* metadata is optional */ }
            }

            const [vocalBuf, instBuf] = await Promise.all([
                vocalsFile.async('arraybuffer'),
                instrumentalFile.async('arraybuffer'),
            ]);

            await decodeAndAddSong(vocalBuf, instBuf, songName);
        } catch (err) {
            console.error('Package load failed:', err);
            setError(err instanceof Error ? err.message : 'Failed to load stems package');
        } finally {
            setIsLoading(false);
        }
    }, [decodeAndAddSong]);

    // ── Process loose files ──
    const processFiles = useCallback(async (files: File[], folderName?: string) => {
        setError(null);
        setIsLoading(true);

        try {
            const audioFiles = files.filter((f) => /\.(wav|mp3)$/i.test(f.name));
            let vocalFile = audioFiles.find((f) => /vocal/i.test(f.name));
            let instFile = audioFiles.find(
                (f) => /(instrumental|music|accompaniment|backing|karaoke|no[_ -]?vocal)/i.test(f.name)
            );

            // Fallback: if exactly two audio files were dropped and only one matched,
            // assume the unmatched one is the other stem.
            if (audioFiles.length === 2 && (!vocalFile || !instFile)) {
                if (vocalFile && !instFile) instFile = audioFiles.find((f) => f !== vocalFile);
                else if (instFile && !vocalFile) vocalFile = audioFiles.find((f) => f !== instFile);
            }

            const metaFile = files.find((f) => f.name === 'metadata.json');

            if (!vocalFile || !instFile) {
                throw new Error('Could not identify vocal + instrumental files. Name them so one contains "vocal" and the other contains "music" or "instrumental" (.wav or .mp3).');
            }

            const derived = (vocalFile.name || instFile.name)
                .replace(/\.(wav|mp3)$/i, '')
                .split('(')[0]
                .trim();
            let songName = folderName || derived || 'Untitled';
            if (metaFile) {
                try {
                    const metaText = await metaFile.text();
                    const meta = JSON.parse(metaText);
                    if (meta.name) songName = meta.name;
                } catch { /* metadata is optional */ }
            }

            const [vocalBuf, instBuf] = await Promise.all([
                vocalFile.arrayBuffer(),
                instFile.arrayBuffer(),
            ]);

            await decodeAndAddSong(vocalBuf, instBuf, songName);
        } catch (err) {
            console.error('File load failed:', err);
            setError(err instanceof Error ? err.message : 'Failed to load stems');
        } finally {
            setIsLoading(false);
        }
    }, [decodeAndAddSong]);

    // ── File handling ──
    const handleInput = useCallback(
        (files: FileList | File[] | null, folderName?: string) => {
            if (!files || files.length === 0) return;
            const fileArray = Array.from(files as Iterable<File>);

            const zipFile = fileArray.find(f => f.name.toLowerCase().endsWith('.zip'));
            if (zipFile) { processZip(zipFile); return; }

            const relevantFiles = fileArray.filter(f => {
                const n = f.name.toLowerCase();
                return n.endsWith('.wav') || n.endsWith('.mp3') || n === 'metadata.json';
            });
            if (relevantFiles.length > 0) { processFiles(relevantFiles, folderName); return; }

            setError('Please upload a .zip stems package or two audio files (.wav or .mp3) — one named with "vocal", the other with "music"/"instrumental".');
        },
        [processZip, processFiles]
    );

    // ── Recursively read dropped folders ──
    const readEntriesRecursive = useCallback((entry: FileSystemEntry): Promise<File[]> => {
        return new Promise((resolve) => {
            if (entry.isFile) {
                (entry as FileSystemFileEntry).file((file) => resolve([file]), () => resolve([]));
            } else if (entry.isDirectory) {
                const reader = (entry as FileSystemDirectoryEntry).createReader();
                const allFiles: File[] = [];
                const readBatch = () => {
                    reader.readEntries(async (entries) => {
                        if (entries.length === 0) { resolve(allFiles); return; }
                        for (const child of entries) {
                            const childFiles = await readEntriesRecursive(child);
                            allFiles.push(...childFiles);
                        }
                        readBatch();
                    }, () => resolve(allFiles));
                };
                readBatch();
            } else {
                resolve([]);
            }
        });
    }, []);

    const onDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragging(false);
            const items = e.dataTransfer.items;
            if (items && items.length > 0) {
                const entries: FileSystemEntry[] = [];
                for (let i = 0; i < items.length; i++) {
                    const entry = items[i].webkitGetAsEntry?.();
                    if (entry) entries.push(entry);
                }
                if (entries.some(e => e.isDirectory)) {
                    const allFiles: File[] = [];
                    let folderName = '';
                    for (const entry of entries) {
                        if (entry.isDirectory && !folderName) folderName = entry.name;
                        const files = await readEntriesRecursive(entry);
                        allFiles.push(...files);
                    }
                    if (allFiles.length > 0) { handleInput(allFiles, folderName); return; }
                }
            }
            handleInput(e.dataTransfer.files);
        },
        [handleInput, readEntriesRecursive]
    );

    const hasSongs = slots[0].song !== null;

    // ── Upload zone (shared between idle and ready states) ──
    const uploadZone = (
        <div
            className={`remover-upload-zone ${isDragging || folderDropHighlight ? 'remover-upload-zone-active' : ''} ${hasSongs ? 'remover-upload-zone-compact' : ''}`}
            onDrop={(e) => { setFolderDropHighlight(false); onDrop(e); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            style={{
                ...(hasSongs ? { padding: '16px 20px' } : {}),
                ...(folderDropHighlight ? { borderColor: '#6ee7b7', boxShadow: '0 0 20px rgba(16,185,129,0.3)', animation: 'pulse 1.5s ease-in-out infinite' } : {}),
            }}
        >
            {!hasSongs && <div className="remover-upload-icon">{folderDropHighlight ? '📂' : '📦'}</div>}
            <div className="remover-upload-text" style={hasSongs ? { fontSize: '0.85rem' } : undefined}>
                {folderDropHighlight ? '⬇️ Drop your stems folder here!' : hasSongs ? '➕ Add More Songs' : 'Upload Stems Package'}
            </div>
            {!hasSongs && !folderDropHighlight && (
                <div className="remover-upload-hint">
                    Drag & drop a stems folder, .zip, or a vocal + music pair (.wav / .mp3) — or select files below
                </div>
            )}
            {folderDropHighlight && (
                <div className="remover-upload-hint" style={{ color: '#6ee7b7' }}>
                    Drag a folder from Finder onto this zone
                </div>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: hasSongs ? 8 : 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    style={{ padding: hasSongs ? '6px 14px' : '10px 20px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 8, color: '#c4b5fd', fontSize: hasSongs ? '0.75rem' : '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: 8 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.25)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.15)'; }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                    Select Files / ZIP
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); setFolderDropHighlight(v => !v); }}
                    style={{ padding: hasSongs ? '6px 14px' : '10px 20px', background: folderDropHighlight ? 'rgba(16,185,129,0.35)' : 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 8, color: '#6ee7b7', fontSize: hasSongs ? '0.75rem' : '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: 8 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16,185,129,0.25)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = folderDropHighlight ? 'rgba(16,185,129,0.35)' : 'rgba(16,185,129,0.15)'; }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    {folderDropHighlight ? 'Cancel' : 'Drop Folder'}
                </button>
            </div>
        </div>
    );

    // ────────────────────────── RENDER ──────────────────────────────
    return (
        <div className="stem-player-container" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
            <input ref={fileInputRef} type="file" multiple hidden accept=".zip,.wav,.mp3,audio/wav,audio/mpeg,.json" onChange={(e) => { handleInput(e.target.files); e.target.value = ''; }} />

            {/* Upload zone when no songs */}
            {stage === 'idle' && !isLoading && (
                <div className="stem-player-idle animate-fade-in">
                    {uploadZone}
                    {error && <div className="remover-error">{error}</div>}
                </div>
            )}

            {/* Loading indicator */}
            {isLoading && (
                <div className="remover-processing animate-fade-in" style={{ marginBottom: 24 }}>
                    <div className="remover-processing-spinner" />
                    <div className="remover-processing-title">📦 Loading Stems Package...</div>
                    <div className="remover-processing-file" style={{ marginBottom: 0 }}>Extracting and decoding audio files</div>
                </div>
            )}

            {/* Song slots */}
            {stage === 'ready' && (
                <div className="animate-fade-in">
                    {/* Clear all */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                        <button className="remover-new-btn" onClick={() => store.clearAll()}>← Clear All</button>
                    </div>

                    {/* Transition status */}
                    {transitionState !== 'idle' && slots[0].song && slots[1].song && (
                        <div style={{
                            margin: '0 0 16px',
                            padding: '10px 16px',
                            borderRadius: 10,
                            background: transitionState === 'active'
                                ? 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(16,185,129,0.15))'
                                : 'rgba(139,92,246,0.08)',
                            border: `1px solid ${transitionState === 'active' ? 'rgba(139,92,246,0.4)' : 'rgba(139,92,246,0.15)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            fontSize: '0.78rem',
                            color: transitionState === 'active' ? '#c4b5fd' : 'var(--text-muted)',
                            transition: 'all 0.5s ease',
                        }}>
                            {transitionState === 'planning' && <><span className="remover-processing-spinner" style={{ width: 14, height: 14 }} /> Analyzing vocals for transition...</>}
                            {transitionState === 'ready' && <><span style={{ fontSize: '1rem' }}>🎛️</span> Auto-transition planned — instrumental swap at {transitionPlanRef.current ? `${Math.floor(transitionPlanRef.current.crossfadeStart / 60)}:${Math.floor(transitionPlanRef.current.crossfadeStart % 60).toString().padStart(2, '0')}` : '—'}, vocal switch at {transitionPlanRef.current ? `${Math.floor(transitionPlanRef.current.vocalSwitchTime / 60)}:${Math.floor(transitionPlanRef.current.vocalSwitchTime % 60).toString().padStart(2, '0')}` : '—'}</>}
                            {transitionState === 'active' && <><span className="remover-processing-spinner" style={{ width: 14, height: 14 }} /> 🔀 Transitioning...</>}
                        </div>
                    )}

                    {/* Slot 0 — Now Playing */}
                    {slots[0].song && (
                        <SongSlot
                            ref={slot0Ref}
                            key={slots[0].song.id}
                            slotIndex={0}
                            audioCtx={audioCtx}
                            onSongEnd={handleSongEnd}
                            autoPlay={autoPlaySlot0}
                            label="NOW PLAYING"
                        />
                    )}

                    {/* Divider */}
                    {slots[0].song && slots[1].song && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0', opacity: 0.4 }}>
                            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(139,92,246,0.5), transparent)' }} />
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 2 }}>up next</span>
                            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(139,92,246,0.5), transparent)' }} />
                        </div>
                    )}

                    {/* Slot 1 — Up Next */}
                    {slots[1].song && (
                        <SongSlot ref={slot1Ref} key={slots[1].song.id} slotIndex={1} audioCtx={audioCtx} label="UP NEXT" />
                    )}

                    {/* Queue panel */}
                    {queue.length > 0 && (
                        <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>
                                Queue ({queue.length})
                            </div>
                            {queue.map((qSong, i) => (
                                <div key={qSong.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < queue.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                        <span style={{ opacity: 0.4, fontSize: '0.7rem', width: 20, textAlign: 'center' }}>{i + 1}</span>
                                        <span>🎵</span>
                                        {qSong.name}
                                        {qSong.data.bpm !== undefined && (
                                            <span
                                                style={{
                                                    padding: '1px 7px',
                                                    borderRadius: 999,
                                                    background: 'rgba(139,92,246,0.18)',
                                                    border: '1px solid rgba(139,92,246,0.35)',
                                                    color: '#c4b5fd',
                                                    fontSize: '0.68rem',
                                                    fontWeight: 700,
                                                    fontVariantNumeric: 'tabular-nums',
                                                }}
                                                title="Detected BPM"
                                            >
                                                {Math.round(qSong.data.bpm)} BPM
                                            </span>
                                        )}
                                        <span style={{ opacity: 0.4, fontSize: '0.75rem' }}>{formatTime(qSong.data.duration)}</span>
                                    </div>
                                    <button onClick={() => store.removeFromQueue(i)} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#fca5a5', fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer' }}>✕</button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Add more songs */}
                    <div style={{ marginTop: 16 }}>
                        {uploadZone}
                    </div>

                    {error && <div className="remover-error" style={{ marginTop: 12 }}>{error}</div>}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Main Component ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
export default function NewDJClient() {
    const audioCtxRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new AudioContext({ sampleRate: 44100 });
        }
    }, []);

    return (
        <div className="min-h-screen remover-page">
            {/* ─── Sidebar ──────────────────────────────────── */}
            <nav className="remover-sidebar">
                <div className="remover-sidebar-logo">
                    <div className="remover-logo-icon">
                        <span className="text-white text-sm font-black">D</span>
                    </div>
                </div>

                <Link href="/" className="remover-sidebar-item" title="DJ Dashboard">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="18" rx="2" />
                        <line x1="8" y1="21" x2="8" y2="3" /><line x1="16" y1="21" x2="16" y2="3" />
                    </svg>
                    <span>DJ</span>
                </Link>

                <Link href="/remover" className="remover-sidebar-item" title="Vocal Remover">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                        <line x1="12" y1="6" x2="12" y2="11" /><line x1="12" y1="13" x2="12" y2="18" />
                        <line x1="5" y1="8" x2="10" y2="11" /><line x1="14" y1="13" x2="19" y2="16" />
                    </svg>
                    <span>Remover</span>
                </Link>

                <Link href="/player" className="remover-sidebar-item" title="Quick Play">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5,3 19,12 5,21" />
                    </svg>
                    <span>Player</span>
                </Link>

                <Link href="/new-dj" className="remover-sidebar-item active" title="New DJ">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <circle cx="12" cy="12" r="3" />
                        <line x1="12" y1="2" x2="12" y2="5" />
                    </svg>
                    <span>New DJ</span>
                </Link>
            </nav>

            {/* ─── Main Content ─────────────────────────────── */}
            <main className="remover-main">
                <div style={{ maxWidth: 900, width: '100%' }}>
                    <div style={{ textAlign: 'center', marginBottom: 32 }}>
                        <h1 className="remover-title">
                            <span className="glow-text-cyan">New</span>{' '}
                            <span className="glow-text-purple">DJ</span>
                        </h1>
                        <p className="remover-subtitle">
                            Upload stems packages and mix — songs auto-advance when finished.
                        </p>
                    </div>

                    <QuickStemPlayer audioCtx={audioCtxRef} />
                </div>
            </main>
        </div>
    );
}
