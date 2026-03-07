/**
 * Remover Store — Persists stem separation results across page navigations.
 *
 * Stores the processed song data (waveforms + audio buffers) for both
 * StemPlayer slots so switching tabs doesn't lose your work.
 * Also persists playback positions and volume levels.
 */

import { create } from 'zustand';
import type { NeuralStemData } from '@/lib/audio/neural-separator';

type Stage = 'idle' | 'decoding' | 'queued' | 'downloading' | 'separating' | 'done';

interface SlotState {
    stage: Stage;
    song: { name: string; data: NeuralStemData } | null;
    vocalPos: number;
    instrumentalPos: number;
    vocalVolume: number;
    instrumentalVolume: number;
}

interface RemoverStore {
    slots: [SlotState, SlotState];
    setSlot: (index: 0 | 1, state: Partial<SlotState>) => void;
    clearSlot: (index: 0 | 1) => void;
}

const defaultSlot: SlotState = {
    stage: 'idle',
    song: null,
    vocalPos: 0,
    instrumentalPos: 0,
    vocalVolume: 1,
    instrumentalVolume: 1,
};

export const useRemoverStore = create<RemoverStore>((set) => ({
    slots: [{ ...defaultSlot }, { ...defaultSlot }],

    setSlot: (index, state) =>
        set((prev) => {
            const slots = [...prev.slots] as [SlotState, SlotState];
            slots[index] = { ...slots[index], ...state };
            return { slots };
        }),

    clearSlot: (index) =>
        set((prev) => {
            const slots = [...prev.slots] as [SlotState, SlotState];
            slots[index] = { ...defaultSlot };
            return { slots };
        }),
}));
