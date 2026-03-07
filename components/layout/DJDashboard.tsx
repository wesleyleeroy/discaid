/**
 * DJ Dashboard — Main layout component assembling all panels.
 */

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useDJStore } from '@/stores/dj-store';
import NowPlaying from '@/components/dj/NowPlaying';
import Visualizer from '@/components/dj/Visualizer';
import IngestionGate from '@/components/dj/IngestionGate';
import QueuePanel from '@/components/dj/QueuePanel';
import TransitionStatus from '@/components/dj/TransitionStatus';
import AIInsightPanel from '@/components/dj/AIInsightPanel';
import PlaybackControls from '@/components/dj/PlaybackControls';
import LiveFXStatus from '@/components/dj/LiveFXStatus';
import StemViewer from '@/components/dj/StemViewer';

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
        <div className="min-h-screen gradient-mesh" style={{ display: 'flex' }}>
            {/* ─── Sidebar ────────────────────────────────────────────── */}
            <nav className="remover-sidebar">
                <div className="remover-sidebar-logo">
                    <div className="remover-logo-icon">
                        <span className="text-white text-sm font-black">D</span>
                    </div>
                </div>

                <Link href="/" className="remover-sidebar-item active" title="DJ Dashboard">
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

                <Link href="/new-dj" className="remover-sidebar-item" title="New DJ">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <circle cx="12" cy="12" r="3" />
                        <line x1="12" y1="2" x2="12" y2="5" />
                    </svg>
                    <span>New DJ</span>
                </Link>
            </nav>

            {/* ─── Main Content Area ─────────────────────────────────── */}
            <div style={{ marginLeft: 72, flex: 1, minHeight: '100vh' }}>
                {/* ─── Header ────────────────────────────────────────── */}
                <header className="sticky top-0 z-50" style={{
                    background: 'rgba(6, 6, 15, 0.85)',
                    backdropFilter: 'blur(20px)',
                    borderBottom: '1px solid var(--border)',
                }}>
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div>
                                <h1 className="text-xl font-extrabold tracking-tight">
                                    <span className="glow-text-cyan">Disc</span>
                                    <span className="glow-text-purple">AId</span>
                                </h1>
                                <p className="text-[10px] font-medium tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                                    Autonomous AI DJ
                                </p>
                            </div>
                            {isPlaying && (
                                <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent-green)] animate-pulse-glow" />
                            )}
                        </div>

                        <PlaybackControls />
                    </div>
                </header>

                {/* ─── Main Content ──────────────────────────────────── */}
                <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                    {/* Visualizer (full width) */}
                    <Visualizer />

                    {/* Stem Separation (full width, below visualizer) */}
                    <StemViewer />

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
        </div>
    );
}
