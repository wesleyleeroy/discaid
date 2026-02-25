/**
 * Now Playing — Displays current and next track info with analysis badges.
 */

'use client';

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

    const currentTrack = currentTrackId ? tracks[currentTrackId] : null;
    const nextTrack = nextTrackId ? tracks[nextTrackId] : null;
    const progress = currentDuration > 0 ? (currentPosition / currentDuration) * 100 : 0;

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
                        </div>
                    )}

                    {/* Progress Bar */}
                    <div className="space-y-1">
                        <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(100,100,180,0.15)' }}>
                            <div
                                className="absolute top-0 left-0 h-full rounded-full transition-all duration-200"
                                style={{
                                    width: `${progress}%`,
                                    background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-purple))',
                                    boxShadow: '0 0 8px rgba(0, 212, 255, 0.5)',
                                }}
                            />
                        </div>
                        <div className="flex justify-between" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            <span>{formatTime(currentPosition)}</span>
                            <span>-{formatTime(currentDuration - currentPosition)}</span>
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
