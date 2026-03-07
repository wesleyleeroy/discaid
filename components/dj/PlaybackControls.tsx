/**
 * Playback Controls — Minimal controls: Skip, Pause/Resume, Word Loop, AI Toggle.
 */

'use client';

import { useDJStore } from '@/stores/dj-store';

export default function PlaybackControls() {
    const isPlaying = useDJStore(s => s.isPlaying);
    const isPaused = useDJStore(s => s.isPaused);
    const aiActive = useDJStore(s => s.aiActive);
    const skipTrack = useDJStore(s => s.skipTrack);
    const togglePause = useDJStore(s => s.togglePause);
    const toggleAI = useDJStore(s => s.toggleAI);
    const triggerRewind = useDJStore(s => s.triggerRewind);

    return (
        <div className="flex items-center gap-3">
            {/* Pause / Resume */}
            <button
                onClick={togglePause}
                disabled={!isPlaying}
                className="btn-ghost flex items-center gap-2 text-sm"
                title={isPaused ? 'Resume' : 'Pause'}
            >
                {isPaused ? (
                    <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                        Resume
                    </>
                ) : (
                    <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                        Pause
                    </>
                )}
            </button>

            {/* Skip */}
            <button
                onClick={skipTrack}
                disabled={!isPlaying}
                className="btn-ghost flex items-center gap-2 text-sm"
                title="Skip to next track"
            >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
                Skip
            </button>

            {/* Rewind */}
            <button
                onClick={triggerRewind}
                disabled={!isPlaying}
                className="btn-ghost flex items-center gap-2 text-sm"
                title="Rewind ~0.75s (word effect)"
            >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
                </svg>
                Rewind
            </button>

            {/* AI Toggle */}
            <button
                onClick={toggleAI}
                className={`
          flex items-center gap-2 text-sm px-4 py-2 rounded-xl border transition-all duration-300
          ${aiActive
                        ? 'bg-[rgba(0,212,255,0.1)] border-[rgba(0,212,255,0.3)] text-[var(--accent-cyan)] glow-cyan'
                        : 'bg-transparent border-[var(--border)] text-[var(--text-muted)]'
                    }
        `}
                title={aiActive ? 'AI DJ Active' : 'AI DJ Paused'}
            >
                <span className={`w-2 h-2 rounded-full transition-all ${aiActive ? 'bg-[var(--accent-cyan)] animate-pulse-glow' : 'bg-[var(--text-muted)]'}`} />
                AI DJ {aiActive ? 'Active' : 'Paused'}
            </button>
        </div>
    );
}
