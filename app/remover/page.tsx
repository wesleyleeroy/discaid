/**
 * Vocal Remover — Standalone page inspired by vocalremover.org.
 *
 * Features:
 * - Drag & drop or file browse upload
 * - Client-side stem separation (vocals + instrumental)
 * - Dual waveform display (green for Music, purple for Vocal)
 * - Independent volume sliders for each stem
 * - Unified playback with combined audio preview
 * - Download separated stems as WAV files
 * - Processing progress animation
 * - No server required — 100% browser-based
 */

import RemoverClient from './RemoverClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Vocal Remover — DiscAId',
    description:
        'Separate vocals from music directly in your browser. AI-powered stem separation — no server, no upload, 100% private.',
    keywords: [
        'vocal remover',
        'stem separation',
        'karaoke',
        'instrumental',
        'acapella',
        'remove vocals',
    ],
};

export default function RemoverPage() {
    return <RemoverClient />;
}
