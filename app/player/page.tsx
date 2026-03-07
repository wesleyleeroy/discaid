/**
 * Quick Play — Upload a stems package (.zip) from the Remover
 * and play vocal + instrumental instantly with no AI processing.
 */

import PlayerClient from './PlayerClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Quick Play — DiscAId',
    description:
        'Upload a pre-separated stems package and play vocals + instrumental instantly. No AI processing needed.',
    keywords: [
        'quick play',
        'stems player',
        'vocal instrumental player',
        'offline stems',
    ],
};

export default function PlayerPage() {
    return <PlayerClient />;
}
