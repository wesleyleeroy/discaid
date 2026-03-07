/**
 * New DJ — Upload stems packages and build a playlist with
 * dual-slot timeline and automatic queue advancement.
 */

import NewDJClient from './NewDJClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'New DJ — DiscAId',
    description:
        'Upload pre-separated stems packages and DJ with vocals + instrumental. Dual-slot timeline with automatic song advancement.',
    keywords: [
        'new dj',
        'stems dj',
        'vocal instrumental dj',
        'offline stems',
    ],
};

export default function NewDJPage() {
    return <NewDJClient />;
}
