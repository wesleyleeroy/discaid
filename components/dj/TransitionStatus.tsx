/**
 * Transition Status — Shows current transition plan, strategy, and progress.
 */

'use client';

import { useDJStore } from '@/stores/dj-store';

const STRATEGY_ICONS: Record<string, string> = {
    'crossfade': '🔀',
    'filter-sweep': '🌊',
    'echo-out': '🔊',
    'bass-swap': '🎚️',
    'energy-ramp': '⚡',
};

const STRATEGY_COLORS: Record<string, string> = {
    'crossfade': 'var(--accent-cyan)',
    'filter-sweep': 'var(--accent-purple)',
    'echo-out': 'var(--accent-amber)',
    'bass-swap': 'var(--accent-green)',
    'energy-ramp': 'var(--accent-pink)',
};

function formatEta(seconds: number | null): string {
    if (seconds === null || !isFinite(seconds)) return '--';
    if (seconds < 1) return 'Now';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export default function TransitionStatus() {
    const currentPlan = useDJStore(s => s.currentPlan);
    const transitionProgress = useDJStore(s => s.transitionProgress);
    const transitionEta = useDJStore(s => s.transitionEta);
    const orchestratorState = useDJStore(s => s.orchestratorState);
    const tracks = useDJStore(s => s.tracks);

    if (!currentPlan && orchestratorState !== 'transitioning') {
        return (
            <div className="glass-card-static p-6">
                <h2 className="text-sm font-semibold tracking-widest uppercase mb-3" style={{ color: 'var(--text-muted)' }}>
                    Transition
                </h2>
                <div className="text-center py-4" style={{ color: 'var(--text-muted)' }}>
                    <p className="text-sm">No transition planned</p>
                    <p className="text-xs mt-1">AI will plan when the next track is ready</p>
                </div>
            </div>
        );
    }

    if (!currentPlan) return null;

    const icon = STRATEGY_ICONS[currentPlan.strategy] || '🎛️';
    const color = STRATEGY_COLORS[currentPlan.strategy] || 'var(--accent-cyan)';
    const incomingTrack = tracks[currentPlan.incomingTrackId];

    return (
        <div className="glass-card-static p-6 space-y-4" style={{ borderColor: `${color}33` }}>
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                    Transition
                </h2>
                {transitionEta !== null && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>ETA</span>
                        <span className="font-mono text-sm font-bold" style={{ color }}>
                            {formatEta(transitionEta)}
                        </span>
                    </div>
                )}
            </div>

            {/* Strategy info */}
            <div className="flex items-center gap-3">
                <span className="text-2xl">{icon}</span>
                <div>
                    <p className="text-sm font-semibold" style={{ color }}>
                        {currentPlan.strategy.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Score: {currentPlan.score}/100
                    </p>
                </div>
            </div>

            {/* Reasoning */}
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {currentPlan.reasoning}
            </p>

            {/* Transition target */}
            {incomingTrack && (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>→</span>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {incomingTrack.title}
                    </span>
                </div>
            )}

            {/* Progress bar (during transition) */}
            {transitionProgress !== null && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span>Transition Progress</span>
                        <span className="font-mono">{Math.round(transitionProgress * 100)}%</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(100,100,180,0.15)' }}>
                        <div
                            className="h-full rounded-full transition-all duration-150"
                            style={{
                                width: `${transitionProgress * 100}%`,
                                background: `linear-gradient(90deg, ${color}, var(--accent-purple))`,
                                boxShadow: `0 0 10px ${color}80`,
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Scored candidates (collapsed) */}
            {currentPlan.candidates.length > 1 && (
                <details className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    <summary className="cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
                        All strategies scored ({currentPlan.candidates.length})
                    </summary>
                    <div className="mt-2 space-y-1 pl-2" style={{ borderLeft: '2px solid var(--border)' }}>
                        {currentPlan.candidates.map((c, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <span className="flex items-center gap-1">
                                    {STRATEGY_ICONS[c.strategy] || '•'}
                                    <span>{c.strategy}</span>
                                </span>
                                <span className="font-mono" style={{ color: c.strategy === currentPlan.strategy ? color : 'inherit' }}>
                                    {c.score}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
