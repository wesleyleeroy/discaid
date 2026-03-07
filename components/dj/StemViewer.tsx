/**
 * Stem Viewer — Displays separated vocal and instrumental waveforms with
 * independent playback controls.
 *
 * Features:
 * - Two side-by-side panels: Vocals (cyan) / Instrumental (purple)
 * - Animated canvas waveform visualization with playhead
 * - Independent play/pause buttons (only enabled when main song is paused)
 * - Independent seek bars for each stem
 * - Time display (current / total)
 * - All controls are isolated from the main song playback
 */

'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useDJStore } from '@/stores/dj-store';
import type { StemWaveform } from '@/lib/audio/stem-separator';

// ─── Waveform Canvas ─────────────────────────────────────────────
interface WaveformCanvasProps {
    waveform: StemWaveform;
    progress: number; // 0-1
    accentColor: string;
    accentGlow: string;
    onSeek?: (progress: number) => void;
}

function WaveformCanvas({ waveform, progress, accentColor, accentGlow, onSeek }: WaveformCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);

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

        const width = rect.width;
        const height = rect.height;
        const centerY = height / 2;
        const numBins = waveform.peaks.length;
        const barWidth = Math.max(1, (width / numBins) - 1);

        ctx.clearRect(0, 0, width, height);

        // Center line
        ctx.strokeStyle = 'rgba(100, 100, 180, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        const playedIndex = Math.floor(progress * numBins);

        for (let i = 0; i < numBins; i++) {
            const x = (i / numBins) * width;
            const peakH = waveform.peaks[i] * (height * 0.42);
            const rmsH = waveform.rms[i] * (height * 0.42);
            const isPlayed = i <= playedIndex;

            ctx.fillStyle = accentColor;
            ctx.globalAlpha = isPlayed ? 0.9 : 0.2;
            ctx.fillRect(x, centerY - peakH, barWidth, peakH);
            ctx.fillRect(x, centerY, barWidth, peakH);

            ctx.globalAlpha = isPlayed ? 1.0 : 0.35;
            ctx.fillRect(x, centerY - rmsH, barWidth, rmsH);
            ctx.fillRect(x, centerY, barWidth, rmsH);
        }

        ctx.globalAlpha = 1.0;

        // Playhead
        if (progress > 0 && progress < 1) {
            const px = progress * width;
            const gradient = ctx.createLinearGradient(px - 8, 0, px + 8, 0);
            gradient.addColorStop(0, 'transparent');
            gradient.addColorStop(0.5, accentGlow);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.fillRect(px - 8, 0, 16, height);

            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2;
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, height);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        animFrameRef.current = requestAnimationFrame(draw);
    }, [waveform, progress, accentColor, accentGlow]);

    useEffect(() => {
        animFrameRef.current = requestAnimationFrame(draw);
        return () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [draw]);

    // Click-to-seek on the waveform
    const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!onSeek) return;
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const x = e.clientX - rect.left;
        const p = Math.max(0, Math.min(1, x / rect.width));
        onSeek(p);
    }, [onSeek]);

    return (
        <canvas
            ref={canvasRef}
            className="stem-waveform-canvas"
            style={{ width: '100%', height: '100%', cursor: onSeek ? 'pointer' : 'default' }}
            onClick={handleClick}
        />
    );
}

// ─── Time Formatter ──────────────────────────────────────────────
function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Stem Panel ──────────────────────────────────────────────────
interface StemPanelProps {
    type: 'vocals' | 'instrumental';
    waveform: StemWaveform;
    isPlaying: boolean;
    position: number;
    duration: number;
    accentColor: string;
    accentGlow: string;
    icon: string;
    label: string;
    badgeText: string;
    footerText: string;
    onToggle: () => void;
    onSeek: (position: number) => void;
}

function StemPanel({
    type, waveform, isPlaying, position, duration,
    accentColor, accentGlow, icon, label,
    badgeText, footerText, onToggle, onSeek,
}: StemPanelProps) {
    const progress = duration > 0 ? position / duration : 0;
    const badgeClass = type === 'vocals' ? 'badge-cyan' : 'badge-purple';
    const panelClass = type === 'vocals' ? 'stem-panel-vocals' : 'stem-panel-instrumental';
    const glowClass = type === 'vocals' ? 'glow-text-cyan' : 'glow-text-purple';

    const handleWaveformSeek = useCallback((p: number) => {
        onSeek(p * duration);
    }, [duration, onSeek]);

    const handleSeekBar = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        onSeek(parseFloat(e.target.value));
    }, [onSeek]);

    return (
        <div className={`stem-panel ${panelClass}`}>
            {/* Header */}
            <div className="stem-panel-header">
                <div className="stem-panel-label">
                    <span className="stem-icon">{icon}</span>
                    <span className={`stem-title ${glowClass}`}>{label}</span>
                </div>
                <div className="stem-panel-info">
                    <span className={`badge ${badgeClass} text-[10px]`}>{badgeText}</span>
                </div>
            </div>

            {/* Waveform */}
            <div className="stem-waveform-wrapper">
                <WaveformCanvas
                    waveform={waveform}
                    progress={progress}
                    accentColor={accentColor}
                    accentGlow={accentGlow}
                    onSeek={handleWaveformSeek}
                />
            </div>

            {/* Controls */}
            <div className="stem-controls">
                {/* Play/Pause Button */}
                <button
                    className={`stem-play-btn stem-play-btn-${type}`}
                    onClick={onToggle}
                    title={isPlaying ? `Pause ${label}` : `Play ${label}`}
                >
                    {isPlaying ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="6,4 20,12 6,20" />
                        </svg>
                    )}
                </button>

                {/* Seek Bar */}
                <div className="stem-seek-container">
                    <input
                        type="range"
                        className={`stem-seek-bar stem-seek-${type}`}
                        min={0}
                        max={duration || 1}
                        step={0.1}
                        value={position}
                        onChange={handleSeekBar}
                    />
                </div>

                {/* Time Display */}
                <span className="stem-time">
                    {formatTime(position)} / {formatTime(duration)}
                </span>
            </div>

            {/* Footer */}
            <div className="stem-panel-footer">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {footerText}
                </span>
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────
export default function StemViewer() {
    const currentTrackId = useDJStore(s => s.currentTrackId);
    const tracks = useDJStore(s => s.tracks);
    const stemData = useDJStore(s => s.stemData);

    // Stem playback state
    const stemVocalPlaying = useDJStore(s => s.stemVocalPlaying);
    const stemInstrumentalPlaying = useDJStore(s => s.stemInstrumentalPlaying);
    const stemVocalPosition = useDJStore(s => s.stemVocalPosition);
    const stemInstrumentalPosition = useDJStore(s => s.stemInstrumentalPosition);
    const stemVocalDuration = useDJStore(s => s.stemVocalDuration);
    const stemInstrumentalDuration = useDJStore(s => s.stemInstrumentalDuration);

    // Actions
    const toggleStemVocal = useDJStore(s => s.toggleStemVocal);
    const toggleStemInstrumental = useDJStore(s => s.toggleStemInstrumental);
    const seekStemVocal = useDJStore(s => s.seekStemVocal);
    const seekStemInstrumental = useDJStore(s => s.seekStemInstrumental);

    const currentTrack = currentTrackId ? tracks[currentTrackId] : null;
    const currentStemData = currentTrackId ? stemData[currentTrackId] : null;

    if (!currentTrack || !currentStemData) {
        return null;
    }

    const qualityPercent = Math.round(currentStemData.separationQuality * 100);
    const qualityLabel = qualityPercent >= 70 ? 'High' : qualityPercent >= 40 ? 'Medium' : 'Low';
    const qualityBadge = qualityPercent >= 70 ? 'badge-green' : qualityPercent >= 40 ? 'badge-amber' : 'badge-red';

    return (
        <div className="stem-viewer-container">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                        Stem Separation
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`badge ${qualityBadge} text-[10px]`}>
                        🎚️ {qualityLabel} separation
                    </span>
                    <span className="badge badge-cyan text-[10px]">
                        {currentTrack.title}
                    </span>
                </div>
            </div>

            {/* Two-panel stem display */}
            <div className="stem-panels">
                <StemPanel
                    type="vocals"
                    waveform={currentStemData.vocals}
                    isPlaying={stemVocalPlaying}
                    position={stemVocalPosition}
                    duration={stemVocalDuration}
                    accentColor="#00d4ff"
                    accentGlow="rgba(0, 212, 255, 0.3)"
                    icon="🎤"
                    label="Vocals"
                    badgeText="Center Channel"
                    footerText="Extracted from center pan"
                    onToggle={toggleStemVocal}
                    onSeek={seekStemVocal}
                />
                <StemPanel
                    type="instrumental"
                    waveform={currentStemData.instrumental}
                    isPlaying={stemInstrumentalPlaying}
                    position={stemInstrumentalPosition}
                    duration={stemInstrumentalDuration}
                    accentColor="#8b5cf6"
                    accentGlow="rgba(139, 92, 246, 0.3)"
                    icon="🎸"
                    label="Instrumental"
                    badgeText="Side Channels"
                    footerText="Stereo side signal"
                    onToggle={toggleStemInstrumental}
                    onSeek={seekStemInstrumental}
                />
            </div>
        </div>
    );
}
