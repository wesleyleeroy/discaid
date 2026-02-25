/**
 * AI Insight Panel — Scrolling log of AI decision explanations.
 */

'use client';

import { useDJStore } from '@/stores/dj-store';
import { AIInsight } from '@/types/orchestrator';

const INSIGHT_STYLES: Record<AIInsight['type'], { border: string; bg: string }> = {
    info: { border: 'rgba(100,100,180,0.2)', bg: 'rgba(100,100,180,0.05)' },
    decision: { border: 'rgba(0,212,255,0.2)', bg: 'rgba(0,212,255,0.05)' },
    warning: { border: 'rgba(245,158,11,0.2)', bg: 'rgba(245,158,11,0.05)' },
    error: { border: 'rgba(239,68,68,0.2)', bg: 'rgba(239,68,68,0.05)' },
};

function timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
}

export default function AIInsightPanel() {
    const insights = useDJStore(s => s.insights);

    return (
        <div className="glass-card-static p-6 space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                    AI Insights
                </h2>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full animate-pulse-glow" style={{ background: 'var(--accent-green)' }} />
                    <span className="text-xs" style={{ color: 'var(--accent-green)' }}>Live</span>
                </div>
            </div>

            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                {insights.length === 0 ? (
                    <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>
                        <p className="text-sm">No insights yet</p>
                        <p className="text-xs mt-1">AI decisions will appear here</p>
                    </div>
                ) : (
                    insights.map((insight) => {
                        const style = INSIGHT_STYLES[insight.type];
                        return (
                            <div
                                key={insight.id}
                                className="p-3 rounded-lg text-xs animate-slide-up"
                                style={{
                                    borderLeft: `3px solid ${style.border}`,
                                    background: style.bg,
                                }}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <p className="leading-relaxed flex-1" style={{ color: 'var(--text-secondary)' }}>
                                        {insight.message}
                                    </p>
                                    <span className="text-[10px] flex-shrink-0 font-mono" style={{ color: 'var(--text-muted)' }}>
                                        {timeAgo(insight.timestamp)}
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
