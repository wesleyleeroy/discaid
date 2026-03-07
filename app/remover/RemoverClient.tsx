/**
 * RemoverClient — AI-powered vocal remover using Meta's HTDemucs neural network.
 *
 * Two independent upload slots, each with:
 * 1. Upload area (drag & drop + browse)
 * 2. Model download progress (~172MB first time)
 * 3. Neural processing with segment progress
 * 4. Stacked waveforms: Music (green) / Vocal (purple) with volume sliders
 * 5. Independent per-stem play/pause and seeking
 * 6. Download stems as WAV (vocals, instrumental, drums, bass)
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import type { StemWaveform } from '@/lib/audio/stem-separator';
import type { NeuralStemData, NeuralProgress } from '@/lib/audio/neural-separator';
import { useRemoverStore } from '@/stores/remover-store';

// ─── Types ────────────────────────────────────────────────────────
type Stage = 'idle' | 'decoding' | 'queued' | 'downloading' | 'separating' | 'done';

// ─── WAV Encoder ─────────────────────────────────────────────────
function encodeStereoWAV(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
    const numChannels = 2;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataLength = left.length * numChannels * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    function writeString(offset: number, str: string) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < left.length; i++) {
        const l = Math.max(-1, Math.min(1, left[i]));
        const r = Math.max(-1, Math.min(1, right[i]));
        view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
        offset += 2;
        view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

// ─── Waveform Canvas ─────────────────────────────────────────────
function RemoverWaveform({
    waveform, progress, color, glowColor, height, onSeek, mirrored,
}: {
    waveform: StemWaveform; progress: number; color: string; glowColor: string;
    height: number; onSeek: (p: number) => void; mirrored?: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef(0);

    const draw = useCallback(() => {
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
        const numBins = waveform.peaks.length;
        const barW = Math.max(1.5, w / numBins - 0.5);
        const playedIdx = Math.floor(progress * numBins);

        ctx.clearRect(0, 0, w, h);

        for (let i = 0; i < numBins; i++) {
            const x = (i / numBins) * w;
            const peak = waveform.peaks[i];
            const rmsVal = waveform.rms[i];
            const isPlayed = i <= playedIdx;

            if (mirrored) {
                const peakH = peak * h * 0.92;
                const rmsH = rmsVal * h * 0.92;
                ctx.fillStyle = color;
                ctx.globalAlpha = isPlayed ? 0.85 : 0.15;
                ctx.fillRect(x, 0, barW, peakH);
                ctx.globalAlpha = isPlayed ? 1.0 : 0.3;
                ctx.fillRect(x, 0, barW, rmsH);
            } else {
                const peakH = peak * h * 0.92;
                const rmsH = rmsVal * h * 0.92;
                ctx.fillStyle = color;
                ctx.globalAlpha = isPlayed ? 0.85 : 0.15;
                ctx.fillRect(x, h - peakH, barW, peakH);
                ctx.globalAlpha = isPlayed ? 1.0 : 0.3;
                ctx.fillRect(x, h - rmsH, barW, rmsH);
            }
        }

        ctx.globalAlpha = 1.0;

        if (progress > 0 && progress < 1) {
            const px = progress * w;
            const grad = ctx.createLinearGradient(px - 6, 0, px + 6, 0);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(0.5, glowColor);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(px - 6, 0, 12, h);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, h);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        animRef.current = requestAnimationFrame(draw);
    }, [waveform, progress, color, glowColor, mirrored]);

    useEffect(() => {
        animRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animRef.current);
    }, [draw]);

    const handleClick = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            onSeek(Math.max(0, Math.min(1, x / rect.width)));
        },
        [onSeek]
    );

    return (
        <canvas
            ref={canvasRef}
            onClick={handleClick}
            style={{ width: '100%', height, display: 'block', cursor: 'pointer' }}
        />
    );
}

// ─── Volume Slider ───────────────────────────────────────────────
function VolumeSlider({ value, onChange, color }: { value: number; onChange: (v: number) => void; color: string }) {
    return (
        <div className="remover-volume-slider">
            <div
                className="remover-volume-track"
                style={{
                    background: `linear-gradient(to right, ${color} ${value * 100}%, rgba(100,100,180,0.2) ${value * 100}%)`,
                }}
            >
                <input
                    type="range" min={0} max={1} step={0.01} value={value}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="remover-volume-input"
                />
            </div>
        </div>
    );
}

// ─── Time Format ─────────────────────────────────────────────────
function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Download icon SVG ───────────────────────────────────────────
function DownloadIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}

// ═══════════════════════════════════════════════════════════════════
// ─── StemPlayer — Self-contained per-song processor ──────────────
// ═══════════════════════════════════════════════════════════════════
function StemPlayer({ label, audioCtx, slotIndex }: { label: string; audioCtx: React.RefObject<AudioContext | null>; slotIndex: 0 | 1 }) {
    // Read persisted state from the store
    const storedSlot = useRemoverStore((s) => s.slots[slotIndex]);
    const setSlot = useRemoverStore((s) => s.setSlot);

    const [stage, _setStage] = useState<Stage>(storedSlot.stage === 'done' ? 'done' : 'idle');
    const setStage = useCallback((s: Stage) => {
        _setStage(s);
        setSlot(slotIndex, { stage: s });
    }, [slotIndex, setSlot]);

    const [progressInfo, setProgressInfo] = useState<NeuralProgress | null>(null);
    const [song, _setSong] = useState<{ name: string; data: NeuralStemData } | null>(storedSlot.song);
    const setSong = useCallback((s: { name: string; data: NeuralStemData } | null) => {
        _setSong(s);
        setSlot(slotIndex, { song: s });
    }, [slotIndex, setSlot]);
    const [fileName, setFileName] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Per-stem playback state — volumes from store, playing state is local
    const vocalVolume = storedSlot.vocalVolume;
    const instrumentalVolume = storedSlot.instrumentalVolume;
    const setVocalVolume = useCallback((v: number) => setSlot(slotIndex, { vocalVolume: v }), [slotIndex, setSlot]);
    const setInstrumentalVolume = useCallback((v: number) => setSlot(slotIndex, { instrumentalVolume: v }), [slotIndex, setSlot]);
    const [vocalPlaying, setVocalPlaying] = useState(false);
    const [instrumentalPlaying, setInstrumentalPlaying] = useState(false);
    const [vocalPos, setVocalPos] = useState(storedSlot.vocalPos);
    const [instrumentalPos, setInstrumentalPos] = useState(storedSlot.instrumentalPos);

    // Audio refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const songDurationRef = useRef(storedSlot.song?.data.duration ?? 0);
    const vocalSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const instrumentalSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const vocalGainRef = useRef<GainNode | null>(null);
    const instrumentalGainRef = useRef<GainNode | null>(null);
    const vocalStartTimeRef = useRef(0);
    const instrumentalStartTimeRef = useRef(0);
    const vocalPauseOffsetRef = useRef(storedSlot.vocalPos);
    const instrumentalPauseOffsetRef = useRef(storedSlot.instrumentalPos);
    const vocalAnimRef = useRef(0);
    const instrumentalAnimRef = useRef(0);

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
            cancelAnimationFrame(vocalAnimRef.current);
            cancelAnimationFrame(instrumentalAnimRef.current);

            setSlot(slotIndex, {
                vocalPos: vocalPauseOffsetRef.current,
                instrumentalPos: instrumentalPauseOffsetRef.current,
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Create stereo AudioBuffer ──
    const createStereoBuffer = useCallback(
        (left: Float32Array, right: Float32Array, sampleRate: number): AudioBuffer => {
            const ctx = audioCtx.current!;
            const buf = ctx.createBuffer(2, left.length, sampleRate);
            buf.getChannelData(0).set(left);
            buf.getChannelData(1).set(right);
            return buf;
        },
        [audioCtx]
    );

    // ── Stop a single stem ──
    const stopStem = useCallback((stem: 'vocal' | 'instrumental') => {
        if (stem === 'vocal') {
            if (vocalSourceRef.current) {
                vocalSourceRef.current.onended = null;
                try { vocalSourceRef.current.stop(); } catch { /* empty */ }
                vocalSourceRef.current.disconnect();
            }
            vocalSourceRef.current = null;
            setVocalPlaying(false);
            cancelAnimationFrame(vocalAnimRef.current);
        } else {
            if (instrumentalSourceRef.current) {
                instrumentalSourceRef.current.onended = null;
                try { instrumentalSourceRef.current.stop(); } catch { /* empty */ }
                instrumentalSourceRef.current.disconnect();
            }
            instrumentalSourceRef.current = null;
            setInstrumentalPlaying(false);
            cancelAnimationFrame(instrumentalAnimRef.current);
        }
    }, []);

    // ── Start a single stem from offset ──
    const startStem = useCallback(
        (stem: 'vocal' | 'instrumental', offset: number) => {
            if (!song) return;
            const ctx = audioCtx.current;
            if (!ctx) return;
            if (ctx.state === 'suspended') ctx.resume();

            const sr = song.data.sampleRate;
            const dur = songDurationRef.current;

            if (stem === 'vocal') {
                const buf = createStereoBuffer(song.data.vocalBuffer.left, song.data.vocalBuffer.right, sr);
                const src = ctx.createBufferSource();
                src.buffer = buf;
                const gain = ctx.createGain();
                gain.gain.value = vocalVolume;
                vocalGainRef.current = gain;
                src.connect(gain).connect(ctx.destination);
                vocalSourceRef.current = src;

                src.onended = () => {
                    setVocalPlaying(false);
                    setVocalPos(0);
                    vocalPauseOffsetRef.current = 0;
                    cancelAnimationFrame(vocalAnimRef.current);
                };

                vocalStartTimeRef.current = ctx.currentTime;
                vocalPauseOffsetRef.current = offset;
                src.start(0, offset);
                setVocalPlaying(true);

                const update = () => {
                    if (!audioCtx.current) return;
                    const elapsed = audioCtx.current.currentTime - vocalStartTimeRef.current;
                    const pos = Math.min(vocalPauseOffsetRef.current + elapsed, dur);
                    setVocalPos(pos);
                    if (pos < dur) vocalAnimRef.current = requestAnimationFrame(update);
                };
                vocalAnimRef.current = requestAnimationFrame(update);
            } else {
                const buf = createStereoBuffer(song.data.instrumentalBuffer.left, song.data.instrumentalBuffer.right, sr);
                const src = ctx.createBufferSource();
                src.buffer = buf;
                const gain = ctx.createGain();
                gain.gain.value = instrumentalVolume;
                instrumentalGainRef.current = gain;
                src.connect(gain).connect(ctx.destination);
                instrumentalSourceRef.current = src;

                src.onended = () => {
                    setInstrumentalPlaying(false);
                    setInstrumentalPos(0);
                    instrumentalPauseOffsetRef.current = 0;
                    cancelAnimationFrame(instrumentalAnimRef.current);
                };

                instrumentalStartTimeRef.current = ctx.currentTime;
                instrumentalPauseOffsetRef.current = offset;
                src.start(0, offset);
                setInstrumentalPlaying(true);

                const update = () => {
                    if (!audioCtx.current) return;
                    const elapsed = audioCtx.current.currentTime - instrumentalStartTimeRef.current;
                    const pos = Math.min(instrumentalPauseOffsetRef.current + elapsed, dur);
                    setInstrumentalPos(pos);
                    if (pos < dur) instrumentalAnimRef.current = requestAnimationFrame(update);
                };
                instrumentalAnimRef.current = requestAnimationFrame(update);
            }
        },
        [song, vocalVolume, instrumentalVolume, createStereoBuffer, audioCtx]
    );

    // ── Toggle a single stem ──
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
                startStem(stem, pauseRef.current);
            }
        },
        [song, vocalPlaying, instrumentalPlaying, stopStem, startStem, audioCtx]
    );

    // ── Toggle both stems ──
    const togglePlayAll = useCallback(() => {
        if (!song) return;
        const anyPlaying = vocalPlaying || instrumentalPlaying;
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

    // ── Seek a single stem ──
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

    // ── Seek both stems ──
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

    // ── Sync vocal to music position ──
    const syncVocalToMusic = useCallback(() => {
        if (!song) return;
        // Get the current instrumental position (live if playing, or saved offset)
        let musicPos: number;
        if (instrumentalPlaying) {
            const ctx = audioCtx.current;
            if (ctx) {
                const elapsed = ctx.currentTime - instrumentalStartTimeRef.current;
                musicPos = instrumentalPauseOffsetRef.current + elapsed;
            } else {
                musicPos = instrumentalPos;
            }
        } else {
            musicPos = instrumentalPauseOffsetRef.current;
        }

        // Clamp
        musicPos = Math.max(0, Math.min(musicPos, song.data.duration));

        // If vocal is currently playing, stop it first so we can restart at the new position
        if (vocalPlaying) {
            stopStem('vocal');
        }

        // Seek vocal to the music position and start playing
        vocalPauseOffsetRef.current = musicPos;
        setVocalPos(musicPos);
        startStem('vocal', musicPos);
    }, [song, instrumentalPlaying, instrumentalPos, vocalPlaying, stopStem, startStem, audioCtx]);

    // ── Volume changes ──
    useEffect(() => {
        if (vocalGainRef.current) vocalGainRef.current.gain.value = vocalVolume;
    }, [vocalVolume]);
    useEffect(() => {
        if (instrumentalGainRef.current) instrumentalGainRef.current.gain.value = instrumentalVolume;
    }, [instrumentalVolume]);

    // ── Process file ──
    const processFile = useCallback(async (file: File) => {
        setError(null);
        setStage('decoding');
        setProgressInfo({ phase: 'loading', progress: 0.1, message: 'Decoding audio file...' });
        setFileName(file.name.replace(/\.[^.]+$/, ''));
        setSong(null);
        stopStem('vocal');
        stopStem('instrumental');
        vocalPauseOffsetRef.current = 0;
        instrumentalPauseOffsetRef.current = 0;
        setVocalPos(0);
        setInstrumentalPos(0);
        setSlot(slotIndex, { vocalPos: 0, instrumentalPos: 0 });

        try {
            if (!audioCtx.current) {
                audioCtx.current = new AudioContext({ sampleRate: 44100 });
            }
            const ctx = audioCtx.current;

            const arrayBuffer = await file.arrayBuffer();
            setProgressInfo({ phase: 'loading', progress: 0.3, message: 'Decoding audio...' });
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            setProgressInfo({ phase: 'loading', progress: 0.5, message: 'Audio decoded. Waiting for AI model...' });

            const { neuralSeparate, isProcessing } = await import('@/lib/audio/neural-separator');

            // Show queued state if another song is currently being processed
            if (isProcessing()) {
                setStage('queued');
                setProgressInfo({ phase: 'loading', progress: 0, message: 'Waiting for other song to finish processing...' });
            } else {
                setStage('downloading');
            }

            const result = await neuralSeparate(audioBuffer, (info) => {
                setProgressInfo(info);
                if (info.phase === 'downloading') setStage('downloading');
                else if (info.phase === 'processing') setStage('separating');
                // 'done' from progress means all segments finished — UI can relax
            });

            songDurationRef.current = result.duration;
            setSong({ name: file.name.replace(/\.[^.]+$/, ''), data: result });
            setStage('done');
        } catch (err) {
            console.error('Processing failed:', err);
            const msg = err instanceof Error ? err.message : 'Failed to process audio file';
            // If it was a timeout after all segments, give a more helpful message
            if (msg.includes('timed out')) {
                setError('Processing froze after completing all segments. This can happen with certain audio files. Please try again.');
            } else {
                setError(msg);
            }
            setStage('idle');
        }
    }, [stopStem, audioCtx]);

    // ── File handling ──
    const handleFiles = useCallback(
        (files: FileList | null) => {
            if (!files || files.length === 0) return;
            processFile(files[0]);
        },
        [processFile]
    );

    const onDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
        },
        [handleFiles]
    );

    // ── Download ──
    const downloadStem = useCallback(
        (type: 'vocal' | 'instrumental' | 'drums' | 'bass' | 'other') => {
            if (!song) return;
            let left: Float32Array, right: Float32Array;
            switch (type) {
                case 'vocal': left = song.data.vocalBuffer.left; right = song.data.vocalBuffer.right; break;
                case 'instrumental': left = song.data.instrumentalBuffer.left; right = song.data.instrumentalBuffer.right; break;
                case 'drums': left = song.data.drumsBuffer.left; right = song.data.drumsBuffer.right; break;
                case 'bass': left = song.data.bassBuffer.left; right = song.data.bassBuffer.right; break;
                case 'other': left = song.data.otherBuffer.left; right = song.data.otherBuffer.right; break;
            }
            const blob = encodeStereoWAV(left, right, song.data.sampleRate);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${song.name}_${type}.wav`;
            a.click();
            URL.revokeObjectURL(url);
        },
        [song]
    );

    // ── Download stems package as ZIP — shows Save As dialog ──
    const downloadPackage = useCallback(
        async () => {
            if (!song) return;

            // Encode vocal and instrumental stems as WAV
            const vocalBlob = encodeStereoWAV(song.data.vocalBuffer.left, song.data.vocalBuffer.right, song.data.sampleRate);
            const instrumentalBlob = encodeStereoWAV(song.data.instrumentalBuffer.left, song.data.instrumentalBuffer.right, song.data.sampleRate);
            const metadataBlob = new Blob([JSON.stringify({
                name: song.name,
                duration: song.data.duration,
                sampleRate: song.data.sampleRate,
            }, null, 2)], { type: 'application/json' });

            const folderName = `${song.name}_stems`;

            // Create ZIP
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            zip.file('vocals.wav', vocalBlob);
            zip.file('instrumental.wav', instrumentalBlob);
            zip.file('metadata.json', metadataBlob);
            const content = await zip.generateAsync({ type: 'blob' });

            // Try native Save As dialog (lets user pick location)
            if ('showSaveFilePicker' in window) {
                try {
                    const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
                        suggestedName: `${folderName}.zip`,
                        types: [{ description: 'Stems Package', accept: { 'application/zip': ['.zip'] } }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(content);
                    await writable.close();
                    return;
                } catch (err) {
                    if (err instanceof DOMException && err.name === 'AbortError') return;
                }
            }

            // Fallback: auto-download
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${folderName}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        },
        [song]
    );

    // ── Computed ──
    const vocalProgress = song && song.data.duration > 0 ? vocalPos / song.data.duration : 0;
    const instrumentalProgress = song && song.data.duration > 0 ? instrumentalPos / song.data.duration : 0;
    const anyPlaying = vocalPlaying || instrumentalPlaying;
    const displayPos = Math.max(vocalPos, instrumentalPos);
    const displayProgress = song && song.data.duration > 0 ? displayPos / song.data.duration : 0;

    // ────────────────────────── RENDER ──────────────────────────────
    return (
        <div className="stem-player-container">
            {/* Label */}
            <div className="stem-player-label">{label}</div>

            {stage === 'idle' && (
                <div className="stem-player-idle animate-fade-in">
                    {/* Upload zone */}
                    <div
                        className={`remover-upload-zone remover-upload-zone-compact ${isDragging ? 'remover-upload-zone-active' : ''}`}
                        onDrop={onDrop}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".mp3,.wav,.flac,.m4a,.ogg,.aac,.wma,.opus"
                            onChange={(e) => handleFiles(e.target.files)}
                            className="hidden"
                        />
                        <div className="remover-upload-icon">
                            {isDragging ? '🎯' : '🎵'}
                        </div>
                        <span className="remover-upload-text">
                            {isDragging ? 'Drop your file here' : 'Browse my files'}
                        </span>
                        <span className="remover-upload-hint">
                            or drag & drop • MP3, WAV, FLAC, M4A, OGG
                        </span>
                    </div>

                    {error && (
                        <div className="remover-error">
                            <span>❌</span> {error}
                        </div>
                    )}
                </div>
            )}

            {(stage === 'decoding' || stage === 'queued' || stage === 'downloading' || stage === 'separating') && (
                <div className="remover-processing animate-fade-in">
                    <div className="remover-processing-spinner" />
                    <h2 className="remover-processing-title">
                        {stage === 'decoding' && 'Decoding audio...'}
                        {stage === 'queued' && '⏳ Waiting in queue...'}
                        {stage === 'downloading' && '🧠 Downloading AI Model'}
                        {stage === 'separating' && '🎛️ Separating stems...'}
                    </h2>
                    <p className="remover-processing-file">{fileName}</p>

                    {progressInfo && (
                        <>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
                                {progressInfo.message}
                            </p>
                            <div className="remover-progress-bar">
                                <div className="remover-progress-fill" style={{ width: `${progressInfo.progress * 100}%` }} />
                            </div>
                            <p className="remover-processing-pct">{Math.round(progressInfo.progress * 100)}%</p>

                            {stage === 'downloading' && (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '8px' }}>
                                    First-time download (~172MB). Model is cached for future use.
                                </p>
                            )}

                            {progressInfo.totalSegments && progressInfo.totalSegments > 0 && (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '8px' }}>
                                    Segment {progressInfo.currentSegment} / {progressInfo.totalSegments}
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}

            {stage === 'done' && song && (
                <div className="remover-results animate-fade-in">
                    {/* Song title bar */}
                    <div className="remover-results-header">
                        <div className="remover-results-title">
                            <span className="remover-results-icon">🎵</span>
                            <span>{song.name}</span>
                            <span className="badge badge-cyan" style={{ marginLeft: '8px' }}>🧠 AI</span>
                        </div>
                        <button
                            className="remover-new-btn"
                            onClick={() => {
                                stopStem('vocal');
                                stopStem('instrumental');
                                // Reset store (stage, song, positions, volumes)
                                useRemoverStore.getState().clearSlot(slotIndex);
                                // Reset local state
                                _setStage('idle');
                                _setSong(null);
                                setVocalPos(0);
                                setInstrumentalPos(0);
                                vocalPauseOffsetRef.current = 0;
                                instrumentalPauseOffsetRef.current = 0;
                            }}
                        >
                            ← New File
                        </button>
                    </div>

                    {/* Waveform display */}
                    <div className="remover-waveforms">
                        {/* Music / Instrumental */}
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
                                <RemoverWaveform
                                    waveform={song.data.instrumental}
                                    progress={instrumentalProgress}
                                    color="#10b981"
                                    glowColor="rgba(16, 185, 129, 0.3)"
                                    height={70}
                                    onSeek={(p) => seekStem('instrumental', p)}
                                    mirrored={false}
                                />
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
                                    <button
                                        className="remover-sync-btn"
                                        onClick={syncVocalToMusic}
                                        title="Sync vocal to music position"
                                    >
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
                                <RemoverWaveform
                                    waveform={song.data.vocals}
                                    progress={vocalProgress}
                                    color="#8b5cf6"
                                    glowColor="rgba(139, 92, 246, 0.3)"
                                    height={70}
                                    onSeek={(p) => seekStem('vocal', p)}
                                    mirrored={true}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Playback controls */}
                    <div className="remover-playback-bar">
                        <button className="remover-play-btn" onClick={togglePlayAll} title={anyPlaying ? 'Pause All' : 'Play All'}>
                            {anyPlaying ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
                                </svg>
                            ) : (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="6,4 20,12 6,20" />
                                </svg>
                            )}
                        </button>
                        <span className="remover-time">{formatTime(displayPos)}</span>
                        <div
                            className="remover-seek-bar"
                            onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); seekAll((e.clientX - rect.left) / rect.width); }}
                        >
                            <div className="remover-seek-track" />
                            <div className="remover-seek-fill" style={{ width: `${displayProgress * 100}%` }} />
                            <div className="remover-seek-thumb" style={{ left: `${displayProgress * 100}%` }} />
                        </div>
                        <span className="remover-time">{formatTime(song.data.duration)}</span>
                    </div>

                    {/* Download buttons */}
                    <div className="remover-download-row">
                        <button className="remover-download-btn remover-download-vocal" onClick={() => downloadStem('vocal')}><DownloadIcon /> Vocals</button>
                        <button className="remover-download-btn remover-download-music" onClick={() => downloadStem('instrumental')}><DownloadIcon /> Music</button>
                        <button className="remover-download-btn remover-download-drums" onClick={() => downloadStem('drums')}><DownloadIcon /> Drums</button>
                        <button className="remover-download-btn remover-download-bass" onClick={() => downloadStem('bass')}><DownloadIcon /> Bass</button>
                    </div>
                    <div className="remover-download-row">
                        <button className="remover-download-btn remover-download-package" onClick={downloadPackage}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                <line x1="12" y1="22.08" x2="12" y2="12" />
                            </svg>
                            Download Package (.zip)
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Main Component — Two StemPlayers ────────────────────────────
// ═══════════════════════════════════════════════════════════════════
export default function RemoverClient() {
    const audioCtxRef = useRef<AudioContext | null>(null);

    // Ensure AudioContext created on first interaction
    useEffect(() => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new AudioContext({ sampleRate: 44100 });
        }
    }, []);

    // Preload ONNX Runtime + AI model in the background while the user
    // is looking at the upload UI. This eliminates the ~172MB download
    // wait when they actually drop a file.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { isModelLoaded } = await import('@/lib/audio/neural-separator');
                if (cancelled || isModelLoaded()) return;

                // Warm up: import the heavy modules so they're cached
                const ort = await import('onnxruntime-web');
                const { DemucsProcessor, CONSTANTS } = await import('demucs-web');

                if (cancelled) return;

                // Configure ONNX Runtime
                ort.env.wasm.wasmPaths = '/onnx/';
                ort.env.wasm.proxy = true;
                ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8);

                // Start downloading the model in the background
                // (neuralSeparate will reuse this cached instance)
                const processor = new DemucsProcessor({
                    ort,
                    sessionOptions: {
                        executionProviders: ['wasm'],
                        enableCpuMemArena: true,
                        enableMemPattern: true,
                        graphOptimizationLevel: 'all',
                    },
                    onDownloadProgress: () => { /* silent background download */ },
                    onLog: () => { },
                    onProgress: () => { },
                });
                await processor.loadModel(CONSTANTS.DEFAULT_MODEL_URL);

                if (!cancelled) {
                    // Hand the warmed-up processor to neuralSeparate via the proper API
                    const { setPreloadedProcessor } = await import('@/lib/audio/neural-separator');
                    setPreloadedProcessor(processor, true);
                    console.log('[Remover] AI model preloaded in background');
                }
            } catch {
                // Non-critical — preload failure just means normal download on first use
                console.log('[Remover] Background model preload skipped');
            }
        })();
        return () => { cancelled = true; };
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

                <Link href="/remover" className="remover-sidebar-item active" title="Vocal Remover">
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
                {/* Title */}
                <div className="remover-hero-header">
                    <h1 className="remover-title">
                        <span className="glow-text-cyan">Vocal</span>{' '}
                        <span className="glow-text-purple">Remover</span> &{' '}
                        <span style={{ color: 'var(--accent-green)' }}>Isolation</span>
                    </h1>
                    <p className="remover-subtitle">
                        Separate voice from music out of a song with powerful AI algorithms
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px' }}>
                        <span className="badge badge-cyan">🧠 Meta HTDemucs AI</span>
                        <span className="badge badge-green">🔒 100% Client-side</span>
                        <span className="badge badge-purple">🎵 4 Stem Separation</span>
                    </div>
                </div>

                {/* Two player slots side by side */}
                <div className="stem-players-grid">
                    <StemPlayer label="Song 1" audioCtx={audioCtxRef} slotIndex={0} />
                    <StemPlayer label="Song 2" audioCtx={audioCtxRef} slotIndex={1} />
                </div>
            </main>
        </div>
    );
}
