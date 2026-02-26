/**
 * Now Playing — Displays current and next track info with analysis badges.
 * Progress bar supports click-to-seek and drag-to-scrub.
 */

'use client';

import { useRef, useState, useCallback } from 'react';
import { useDJStore } from '@/stores/dj-store';

function formatTime(seconds: number): string {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function NowPlaying() {
    const currentTrackId = useDJStore(s => s.currentTrackId);
    const nextTrackId = useDJStore(s => s.nextTrackId);
    const tracks = useDJStore(s => s.tracks);
    const currentPosition = useDJStore(s => s.currentPosition);
    const currentDuration = useDJStore(s => s.currentDuration);
    const orchestratorState = useDJStore(s => s.orchestratorState);
    const activeDeck = useDJStore(s => s.activeDeck);
    const seekTo = useDJStore(s => s.seekTo);

    const currentTrack = currentTrackId ? tracks[currentTrackId] : null;
    const nextTrack = nextTrackId ? tracks[nextTrackId] : null;
    const progress = currentDuration > 0 ? (currentPosition / currentDuration) * 100 : 0;

    // ─── Seek Bar State ────────────────────────────────────────
    const barRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [hoverPosition, setHoverPosition] = useState<number | null>(null);
    const [dragProgress, setDragProgress] = useState<number | null>(null);

    const isTransitioning = orchestratorState === 'transitioning';

    const getPositionFromEvent = useCallback((e: React.PointerEvent | PointerEvent): number => {
        if (!barRef.current || currentDuration <= 0) return 0;
        const rect = barRef.current.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        return fraction * currentDuration;
    }, [currentDuration]);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        if (isTransitioning || !currentTrack) return;
        e.preventDefault();
        setIsDragging(true);
        barRef.current?.setPointerCapture(e.pointerId);

        const pos = getPositionFromEvent(e);
        setDragProgress((pos / currentDuration) * 100);
    }, [isTransitioning, currentTrack, getPositionFromEvent, currentDuration]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        const pos = getPositionFromEvent(e);

        if (isDragging) {
            setDragProgress((pos / currentDuration) * 100);
        } else {
            setHoverPosition(pos);
        }
    }, [isDragging, getPositionFromEvent, currentDuration]);

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return;
        setIsDragging(false);
        setDragProgress(null);
        barRef.current?.releasePointerCapture(e.pointerId);

        const pos = getPositionFromEvent(e);
        seekTo(pos);
    }, [isDragging, getPositionFromEvent, seekTo]);

    const handlePointerLeave = useCallback(() => {
        if (!isDragging) {
            setHoverPosition(null);
        }
    }, [isDragging]);

    const displayProgress = isDragging && dragProgress !== null ? dragProgress : progress;
    const displayTime = isDragging && dragProgress !== null
        ? (dragProgress / 100) * currentDuration
        : currentPosition;

    return (
        <div className="glass-card-static p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                    Now Playing
                </h2>
                <div className="flex items-center gap-2">
                    <span className={`deck-label ${activeDeck === 'A' ? 'deck-label-active' : ''}`}>
                        Deck {activeDeck}
                    </span>
                    {orchestratorState !== 'idle' && (
                        <span className={`badge ${orchestratorState === 'transitioning' ? 'badge-pink' :
                            orchestratorState === 'planning' ? 'badge-amber' :
                                orchestratorState === 'pre-transition' ? 'badge-purple' :
                                    'badge-green'
                            }`}>
                            {orchestratorState === 'transitioning' ? '⚡ Mixing' :
                                orchestratorState === 'planning' ? '🧠 Planning' :
                                    orchestratorState === 'pre-transition' ? '⏳ Queued' :
                                        '▶ Playing'}
                        </span>
                    )}
                </div>
            </div>

            {currentTrack ? (
                <>
                    {/* Track Info */}
                    <div className="space-y-1">
                        <h3 className="text-2xl font-bold tracking-tight glow-text-cyan">
                            {currentTrack.title}
                        </h3>
                        <p className="text-base" style={{ color: 'var(--text-secondary)' }}>
                            {currentTrack.artist}
                        </p>
                    </div>

                    {/* Analysis Badges */}
                    {currentTrack.analysis && (
                        <div className="flex flex-wrap gap-2">
                            <span className="badge badge-cyan">
                                ♩ {currentTrack.analysis.bpm} BPM
                            </span>
                            <span className="badge badge-purple">
                                🎵 {currentTrack.analysis.key.root} {currentTrack.analysis.key.mode}
                            </span>
                            <span className="badge badge-purple">
                                {currentTrack.analysis.key.camelotCode}
                            </span>
                            <span className="badge badge-green">
                                ⚡ {(currentTrack.analysis.energy * 100).toFixed(0)}%
                            </span>
                            <span className="badge badge-amber">
                                🔊 {currentTrack.analysis.loudnessDb} dB
                            </span>
                            {currentTrack.analysis.effectiveEnd < currentTrack.analysis.durationSeconds - 2 && (
                                <span className="badge badge-pink" title={`Skipping ${Math.round(currentTrack.analysis.durationSeconds - currentTrack.analysis.effectiveEnd)}s of quiet ending`}>
                                    ✂️ Early stop −{Math.round(currentTrack.analysis.durationSeconds - currentTrack.analysis.effectiveEnd)}s
                                </span>
                            )}
                        </div>
                    )}

                    {/* Interactive Progress / Seek Bar */}
                    <div className="space-y-1">
                        <div
                            ref={barRef}
                            className="seek-bar-container"
                            style={{
                                cursor: isTransitioning ? 'not-allowed' : 'pointer',
                            }}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerLeave={handlePointerLeave}
                        >
                            {/* Track background */}
                            <div className="seek-bar-track" />

                            {/* Hover preview (ghost bar) */}
                            {hoverPosition !== null && !isDragging && !isTransitioning && (
                                <div
                                    className="seek-bar-hover"
                                    style={{
                                        width: `${(hoverPosition / currentDuration) * 100}%`,
                                    }}
                                />
                            )}

                            {/* Progress fill */}
                            <div
                                className="seek-bar-fill"
                                style={{
                                    width: `${displayProgress}%`,
                                }}
                            />

                            {/* Playhead thumb (visible on hover & drag) */}
                            <div
                                className={`seek-bar-thumb ${isDragging ? 'seek-bar-thumb-active' : ''}`}
                                style={{
                                    left: `${displayProgress}%`,
                                }}
                            />
                        </div>

                        <div className="flex justify-between" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            <span>{formatTime(displayTime)}</span>
                            <span>-{formatTime(currentDuration - displayTime)}</span>
                        </div>
                    </div>
                </>
            ) : (
                <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                    <div className="text-4xl mb-3">🎧</div>
                    <p className="text-lg font-medium">No track playing</p>
                    <p className="text-sm mt-1">Upload an audio file to get started</p>
                </div>
            )}

            {/* Next Up */}
            {nextTrack && (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                            Next Up
                        </span>
                        <div className="flex-1">
                            <span className="text-sm font-medium" style={{ color: 'var(--accent-purple)' }}>
                                {nextTrack.title}
                            </span>
                            <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                                {nextTrack.artist}
                            </span>
                        </div>
                        {nextTrack.analysis && (
                            <span className="badge badge-purple text-xs">
                                {nextTrack.analysis.bpm} BPM
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
