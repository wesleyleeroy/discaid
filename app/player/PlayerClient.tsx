/**
 * PlayerClient — Quick Play page for pre-separated stems packages.
 *
 * Dual-slot timeline with automatic queue advancement:
 *   - Slot 0: "Now Playing" — currently active song
 *   - Slot 1: "Up Next" — queued to play after current
 *   - Queue: additional songs waiting in line
 *
 * Upload .zip packages or stems folders (vocals.wav + instrumental.wav).
 * Files are decoded and waveforms generated instantly — no AI processing.
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import type { StemWaveform } from '@/lib/audio/stem-separator';
import { usePlayerStore } from '@/stores/player-store';

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
function SongSlot({
    slotIndex,
    audioCtx,
    onSongEnd,
    autoPlay,
    label,
}: {
    slotIndex: 0 | 1;
    audioCtx: React.RefObject<AudioContext | null>;
    onSongEnd?: () => void;
    autoPlay?: boolean;
    label: string;
}) {
    const storedSlot = usePlayerStore((s) => s.slots[slotIndex]);
    const setSlot = usePlayerStore((s) => s.setSlot);
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
                    const livePos = vocalPauseOffsetRef.current + ctx.currentTime - vocalStartTimeRef.current;
                    vocalPauseOffsetRef.current = Math.max(0, livePos);
                    vocalSourceRef.current.onended = null;
                    try { vocalSourceRef.current.stop(); } catch { /* already stopped */ }
                    vocalSourceRef.current.disconnect();
                    vocalSourceRef.current = null;
                }
                if (instrumentalSourceRef.current) {
                    const livePos = instrumentalPauseOffsetRef.current + ctx.currentTime - instrumentalStartTimeRef.current;
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
                const musicPos = instrumentalPauseOffsetRef.current + ctx.currentTime - instrumentalStartTimeRef.current;
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
                        const gainNode = actx.createGain();
                        gainNode.gain.value = vocalVolume;
                        source.connect(gainNode).connect(actx.destination);
                        source.start(0, clampedPos);
                        source.onended = () => {
                            setVocalPlaying(false);
                            vocalPauseOffsetRef.current = 0;
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
                    setVocalPos(vocalPauseOffsetRef.current + ctx.currentTime - vocalStartTimeRef.current);
                }
                if (instrumentalPlaying) {
                    setInstrumentalPos(instrumentalPauseOffsetRef.current + ctx.currentTime - instrumentalStartTimeRef.current);
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
        (stem: 'vocal' | 'instrumental', offset: number) => {
            if (!song) return;
            const ctx = audioCtx.current;
            if (!ctx) return;

            const bufData = stem === 'vocal' ? song.data.vocalBuffer : song.data.instrumentalBuffer;
            const buf = ctx.createBuffer(2, bufData.left.length, song.data.sampleRate);
            buf.copyToChannel(new Float32Array(bufData.left), 0);
            buf.copyToChannel(new Float32Array(bufData.right), 1);

            const source = ctx.createBufferSource();
            source.buffer = buf;
            const gainNode = ctx.createGain();
            gainNode.gain.value = stem === 'vocal' ? vocalVolume : instrumentalVolume;
            source.connect(gainNode).connect(ctx.destination);

            const clampedOffset = Math.max(0, Math.min(offset, song.data.duration));
            source.start(0, clampedOffset);

            source.onended = () => {
                if (stem === 'vocal') {
                    setVocalPlaying(false);
                    vocalPauseOffsetRef.current = 0;
                    setVocalPos(0);
                } else {
                    setInstrumentalPlaying(false);
                    instrumentalPauseOffsetRef.current = 0;
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
                setVocalPlaying(true);
            } else {
                instrumentalSourceRef.current = source;
                instrumentalGainRef.current = gainNode;
                instrumentalStartTimeRef.current = ctx.currentTime;
                setInstrumentalPlaying(true);
            }
        },
        [song, vocalVolume, instrumentalVolume, audioCtx]
    );

    // ── Toggle a stem ──
    const toggleStem = useCallback(
        (stem: 'vocal' | 'instrumental') => {
            if (!song) return;
            const isPlaying = stem === 'vocal' ? vocalPlaying : instrumentalPlaying;
            const pauseRef = stem === 'vocal' ? vocalPauseOffsetRef : instrumentalPauseOffsetRef;
            const startRef = stem === 'vocal' ? vocalStartTimeRef : instrumentalStartTimeRef;

            if (isPlaying) {
                const ctx = audioCtx.current;
                if (ctx) pauseRef.current += ctx.currentTime - startRef.current;
                stopStem(stem);
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
                if (ctx) vocalPauseOffsetRef.current += ctx.currentTime - vocalStartTimeRef.current;
                stopStem('vocal');
            }
            if (instrumentalPlaying) {
                const ctx = audioCtx.current;
                if (ctx) instrumentalPauseOffsetRef.current += ctx.currentTime - instrumentalStartTimeRef.current;
                stopStem('instrumental');
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
                musicPos = instrumentalPauseOffsetRef.current + ctx.currentTime - instrumentalStartTimeRef.current;
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
}

// ═══════════════════════════════════════════════════════════════════
// ─── Quick Play — Dual Slot Timeline + Queue ────────────────────
// ═══════════════════════════════════════════════════════════════════
function QuickStemPlayer({ audioCtx }: { audioCtx: React.RefObject<AudioContext | null> }) {
    const store = usePlayerStore();
    const { stage, slots, queue } = store;

    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const [autoPlaySlot0, setAutoPlaySlot0] = useState(false);

    // ── Song end handler — advance the queue ──
    const handleSongEnd = useCallback(() => {
        const hasNext = usePlayerStore.getState().slots[1].song !== null;
        store.advance();
        if (hasNext) {
            setAutoPlaySlot0(true);
            setTimeout(() => setAutoPlaySlot0(false), 500);
        }
    }, [store]);

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

        store.addSong({
            name: songName,
            data: {
                vocals: vocalsWf,
                instrumental: instrumentalWf,
                vocalBuffer: { left: vocalLeft, right: vocalRight },
                instrumentalBuffer: { left: instLeft, right: instRight },
                duration,
                sampleRate: vocalAudio.sampleRate,
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

            const vocalsFile = zip.file('vocals.wav');
            const instrumentalFile = zip.file('instrumental.wav');
            const metadataFile = zip.file('metadata.json');

            if (!vocalsFile || !instrumentalFile) {
                throw new Error('Invalid stems package. Expected vocals.wav and instrumental.wav inside the ZIP.');
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
    const processFiles = useCallback(async (files: File[]) => {
        setError(null);
        setIsLoading(true);

        try {
            const vocalFile = files.find(f => f.name === 'vocals.wav');
            const instFile = files.find(f => f.name === 'instrumental.wav');
            const metaFile = files.find(f => f.name === 'metadata.json');

            if (!vocalFile || !instFile) {
                throw new Error('Could not find vocals.wav and instrumental.wav.');
            }

            let songName = 'Untitled';
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
        (files: FileList | File[] | null) => {
            if (!files || files.length === 0) return;
            const fileArray = Array.from(files as Iterable<File>);

            const zipFile = fileArray.find(f => f.name.toLowerCase().endsWith('.zip'));
            if (zipFile) { processZip(zipFile); return; }

            const relevantFiles = fileArray.filter(f =>
                f.name.toLowerCase().endsWith('.wav') || f.name.toLowerCase() === 'metadata.json'
            );
            if (relevantFiles.length > 0) { processFiles(relevantFiles); return; }

            setError('Please upload a .zip stems package, select files, or drop a folder containing vocals.wav + instrumental.wav.');
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
                    for (const entry of entries) {
                        const files = await readEntriesRecursive(entry);
                        allFiles.push(...files);
                    }
                    if (allFiles.length > 0) { handleInput(allFiles); return; }
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
            className={`remover-upload-zone ${isDragging ? 'remover-upload-zone-active' : ''} ${hasSongs ? 'remover-upload-zone-compact' : ''}`}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            style={hasSongs ? { padding: '16px 20px' } : undefined}
        >
            {!hasSongs && <div className="remover-upload-icon">📦</div>}
            <div className="remover-upload-text" style={hasSongs ? { fontSize: '0.85rem' } : undefined}>
                {hasSongs ? '➕ Add More Songs' : 'Upload Stems Package'}
            </div>
            {!hasSongs && (
                <div className="remover-upload-hint">
                    Drop a .zip package or stems folder here, or choose below
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
                <button type="button" onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
                    style={{ padding: hasSongs ? '6px 14px' : '10px 20px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 8, color: '#6ee7b7', fontSize: hasSongs ? '0.75rem' : '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: 8 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16,185,129,0.25)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16,185,129,0.15)'; }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    Upload Folder
                </button>
            </div>
        </div>
    );

    // ────────────────────────── RENDER ──────────────────────────────
    return (
        <div className="stem-player-container" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
            <input ref={fileInputRef} type="file" multiple hidden accept=".zip,.wav,.json" onChange={(e) => { handleInput(e.target.files); e.target.value = ''; }} />
            <input
                ref={(el) => { (folderInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el; if (el) el.setAttribute('webkitdirectory', ''); }}
                type="file" hidden onChange={(e) => { handleInput(e.target.files); e.target.value = ''; }}
            />

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

                    {/* Slot 0 — Now Playing */}
                    {slots[0].song && (
                        <SongSlot
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
                        <SongSlot key={slots[1].song.id} slotIndex={1} audioCtx={audioCtx} label="UP NEXT" />
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
export default function PlayerClient() {
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

                <Link href="/player" className="remover-sidebar-item active" title="Quick Play">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5,3 19,12 5,21" />
                    </svg>
                    <span>Player</span>
                </Link>

                <Link href="/new-dj" className="remover-sidebar-item" title="New DJ">
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
                            <span className="glow-text-cyan">Quick</span>{' '}
                            <span className="glow-text-purple">Play</span>
                        </h1>
                        <p className="remover-subtitle">
                            Upload stems packages and build your playlist — songs auto-advance when finished.
                        </p>
                    </div>

                    <QuickStemPlayer audioCtx={audioCtxRef} />
                </div>
            </main>
        </div>
    );
}
