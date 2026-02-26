/**
 * DJ Dashboard — Main layout component assembling all panels.
 */

'use client';

import { useEffect } from 'react';
import { useDJStore } from '@/stores/dj-store';
import NowPlaying from '@/components/dj/NowPlaying';
import Visualizer from '@/components/dj/Visualizer';
import IngestionGate from '@/components/dj/IngestionGate';
import QueuePanel from '@/components/dj/QueuePanel';
import TransitionStatus from '@/components/dj/TransitionStatus';
import AIInsightPanel from '@/components/dj/AIInsightPanel';
import PlaybackControls from '@/components/dj/PlaybackControls';
import LiveFXStatus from '@/components/dj/LiveFXStatus';

export default function DJDashboard() {
    const initialize = useDJStore(s => s.initialize);
    const orchestratorState = useDJStore(s => s.orchestratorState);
    const isPlaying = useDJStore(s => s.isPlaying);

    // Initialize audio engine on first user interaction
    useEffect(() => {
        const handleInteraction = () => {
            initialize();
            window.removeEventListener('click', handleInteraction);
            window.removeEventListener('touchstart', handleInteraction);
        };
        window.addEventListener('click', handleInteraction);
        window.addEventListener('touchstart', handleInteraction);
        return () => {
            window.removeEventListener('click', handleInteraction);
            window.removeEventListener('touchstart', handleInteraction);
        };
    }, [initialize]);

    return (
        <div className="min-h-screen gradient-mesh">
            {/* ─── Header ─────────────────────────────────────────────── */}
            <header className="sticky top-0 z-50" style={{
                background: 'rgba(6, 6, 15, 0.85)',
                backdropFilter: 'blur(20px)',
                borderBottom: '1px solid var(--border)',
            }}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {/* Logo */}
                        <div className="relative">
                            <div className={`
                w-10 h-10 rounded-xl flex items-center justify-center
                bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-purple)]
                ${isPlaying ? 'animate-pulse-glow' : ''}
              `}>
                                <span className="text-white text-lg font-black">D</span>
                            </div>
                            {isPlaying && (
                                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--accent-green)] border-2 border-[var(--bg-primary)]" />
                            )}
                        </div>
                        <div>
                            <h1 className="text-xl font-extrabold tracking-tight">
                                <span className="glow-text-cyan">Disc</span>
                                <span className="glow-text-purple">AId</span>
                            </h1>
                            <p className="text-[10px] font-medium tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                                Autonomous AI DJ
                            </p>
                        </div>
                    </div>

                    <PlaybackControls />
                </div>
            </header>

            {/* ─── Main Content ───────────────────────────────────────── */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                {/* Visualizer (full width) */}
                <Visualizer />

                {/* Two column layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left column — Main playback area */}
                    <div className="lg:col-span-2 space-y-6">
                        <NowPlaying />
                        <TransitionStatus />
                        <IngestionGate />
                    </div>

                    {/* Right column — Queue, FX & AI */}
                    <div className="space-y-6">
                        <LiveFXStatus />
                        <QueuePanel />
                        <AIInsightPanel />
                    </div>
                </div>

                {/* Status bar */}
                <footer className="flex items-center justify-between text-[10px] py-4 px-2" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${orchestratorState === 'idle' ? 'bg-[var(--text-muted)]' :
                                orchestratorState === 'error' ? 'bg-[var(--accent-red)]' :
                                    'bg-[var(--accent-green)] animate-pulse-glow'
                                }`} />
                            Engine: {orchestratorState}
                        </span>
                        <span>Web Audio API</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span>Client-side analysis</span>
                        <span>No server required</span>
                        <span className="font-medium" style={{ color: 'var(--accent-green)' }}>Compliant mode</span>
                    </div>
                </footer>
            </main>
        </div>
    );
}
