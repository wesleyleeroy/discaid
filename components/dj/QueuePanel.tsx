/**
 * Queue Panel — Displays upcoming tracks with status indicators.
 */

'use client';

import { useDJStore } from '@/stores/dj-store';

function formatDuration(seconds: number): string {
    if (!seconds || !isFinite(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

const STATUS_LABELS: Record<string, { label: string; badge: string }> = {
    pending: { label: 'Pending', badge: 'badge-amber' },
    analyzing: { label: 'Analyzing', badge: 'badge-cyan' },
    ready: { label: 'Ready', badge: 'badge-green' },
    loading: { label: 'Loading', badge: 'badge-amber' },
    playing: { label: 'Playing', badge: 'badge-green' },
    transitioning: { label: 'Mixing', badge: 'badge-pink' },
    completed: { label: 'Done', badge: 'badge-purple' },
    error: { label: 'Error', badge: 'badge-red' },
};

export default function QueuePanel() {
    const queue = useDJStore(s => s.queue);
    const tracks = useDJStore(s => s.tracks);
    const currentTrackId = useDJStore(s => s.currentTrackId);
    const removeFromQueue = useDJStore(s => s.removeFromQueue);

    // Include current track + queued tracks for display
    const allTrackIds = [
        ...(currentTrackId ? [currentTrackId] : []),
        ...queue,
    ];

    return (
        <div className="glass-card-static p-6 space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                    Queue
                </h2>
                <span className="badge badge-cyan">{queue.length} upcoming</span>
            </div>

            {allTrackIds.length === 0 ? (
                <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>
                    <p className="text-sm">Queue is empty</p>
                    <p className="text-xs mt-1">Upload tracks to start the AI DJ</p>
                </div>
            ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                    {allTrackIds.map((trackId, index) => {
                        const track = tracks[trackId];
                        if (!track) return null;

                        const isCurrent = trackId === currentTrackId;
                        const statusInfo = STATUS_LABELS[track.status] || STATUS_LABELS.pending;

                        return (
                            <div
                                key={trackId}
                                className={`
                  flex items-center gap-3 p-3 rounded-xl transition-all duration-200
                  ${isCurrent
                                        ? 'bg-[rgba(0,212,255,0.08)] border border-[rgba(0,212,255,0.2)]'
                                        : 'bg-[rgba(14,14,30,0.5)] border border-transparent hover:border-[var(--border)]'
                                    }
                `}
                            >
                                {/* Position / Now Playing indicator */}
                                <div className="w-6 text-center flex-shrink-0">
                                    {isCurrent ? (
                                        <div className="flex items-end justify-center gap-[2px] h-4">
                                            <div className="eq-bar h-2" />
                                            <div className="eq-bar h-3" />
                                            <div className="eq-bar h-4" />
                                            <div className="eq-bar h-2" />
                                        </div>
                                    ) : (
                                        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                                            {index}
                                        </span>
                                    )}
                                </div>

                                {/* Track info */}
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-medium truncate ${isCurrent ? 'text-[var(--accent-cyan)]' : ''}`}>
                                        {track.title}
                                    </p>
                                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                                        {track.artist} • {formatDuration(track.duration)}
                                    </p>
                                </div>

                                {/* Analysis badges (compact) */}
                                {track.analysis && (
                                    <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                                        <span className="text-[10px] font-mono" style={{ color: 'var(--accent-cyan)' }}>
                                            {track.analysis.bpm}
                                        </span>
                                        <span className="text-[10px] font-mono" style={{ color: 'var(--accent-purple)' }}>
                                            {track.analysis.key.camelotCode}
                                        </span>
                                    </div>
                                )}

                                {/* Status badge */}
                                <span className={`badge ${statusInfo.badge} text-[10px] flex-shrink-0`}>
                                    {statusInfo.label}
                                </span>

                                {/* Remove button (not for current track) */}
                                {!isCurrent && track.status !== 'analyzing' && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeFromQueue(trackId);
                                        }}
                                        className="w-6 h-6 flex items-center justify-center rounded-md transition-all hover:bg-[rgba(239,68,68,0.15)]"
                                        style={{ color: 'var(--text-muted)' }}
                                        title="Remove from queue"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
