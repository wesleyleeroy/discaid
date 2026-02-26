/**
 * Live FX Status — Shows active and upcoming FX effects.
 */

'use client';

import { useDJStore } from '@/stores/dj-store';

const FX_ICONS: Record<string, string> = {
    'stutter': '🔁',
    'filter-sweep': '🌊',
    'hp-build': '📈',
    'delay-throw': '🔊',
    'reverb-wash': '🌀',
    'echo-brake': '⏪',
};

const FX_LABELS: Record<string, string> = {
    'stutter': 'Beat Stutter',
    'filter-sweep': 'Filter Sweep',
    'hp-build': 'HP Riser',
    'delay-throw': 'Delay Throw',
    'reverb-wash': 'Reverb Wash',
    'echo-brake': 'Echo Brake',
};

const FX_COLORS: Record<string, string> = {
    'stutter': 'var(--accent-pink)',
    'filter-sweep': 'var(--accent-purple)',
    'hp-build': 'var(--accent-amber)',
    'delay-throw': 'var(--accent-cyan)',
    'reverb-wash': 'var(--accent-green)',
    'echo-brake': 'var(--accent-pink)',
};

export default function LiveFXStatus() {
    const activeFX = useDJStore(s => s.activeFX);
    const nextFXEta = useDJStore(s => s.nextFXEta);
    const fxEnabled = useDJStore(s => s.fxEnabled);
    const isPlaying = useDJStore(s => s.isPlaying);

    if (!isPlaying) return null;

    const icon = activeFX ? (FX_ICONS[activeFX.type] || '🎛️') : null;
    const label = activeFX ? (FX_LABELS[activeFX.type] || activeFX.type) : null;
    const color = activeFX ? (FX_COLORS[activeFX.type] || 'var(--accent-cyan)') : null;

    return (
        <div className="glass-card-static p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                    Live FX
                </h2>
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${fxEnabled ? 'bg-[var(--accent-green)] animate-pulse-glow' : 'bg-[var(--text-muted)]'}`} />
                    <span className="text-xs" style={{ color: fxEnabled ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                        {fxEnabled ? 'Active' : 'Off'}
                    </span>
                </div>
            </div>

            {activeFX ? (
                <div className="flex items-center gap-3 py-2 px-3 rounded-xl" style={{
                    background: `${color}10`,
                    border: `1px solid ${color}30`,
                }}>
                    <span className="text-2xl animate-pulse-glow">{icon}</span>
                    <div className="flex-1">
                        <p className="text-sm font-semibold" style={{ color: color ?? undefined }}>
                            {label}
                        </p>
                        <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(100,100,180,0.2)' }}>
                            <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                    width: '100%',
                                    background: `linear-gradient(90deg, ${color}, transparent)`,
                                    animation: 'shimmer 1s ease-in-out infinite',
                                }}
                            />
                        </div>
                    </div>
                </div>
            ) : nextFXEta !== null && nextFXEta > 0 ? (
                <div className="text-center py-2" style={{ color: 'var(--text-muted)' }}>
                    <p className="text-xs">Next effect in</p>
                    <p className="font-mono text-lg font-bold" style={{ color: 'var(--accent-cyan)' }}>
                        {nextFXEta < 60
                            ? `${Math.ceil(nextFXEta)}s`
                            : `${Math.floor(nextFXEta / 60)}:${Math.floor(nextFXEta % 60).toString().padStart(2, '0')}`
                        }
                    </p>
                </div>
            ) : (
                <div className="text-center py-2" style={{ color: 'var(--text-muted)' }}>
                    <p className="text-xs">No upcoming effects</p>
                </div>
            )}
        </div>
    );
}
