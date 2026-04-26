/**
 * New DJ Store — Persists New DJ state across page navigations.
 *
 * Supports two visible slots (Now Playing + Up Next) and a queue.
 * When the "Now Playing" song finishes, the "Up Next" song advances
 * into position and the next queued song fills the Up Next slot.
 */

import { create } from 'zustand';
import type { StemWaveform } from '@/lib/audio/stem-separator';

// ─── Types ────────────────────────────────────────────────────────
export type NewDJStage = 'idle' | 'loading' | 'ready';

export interface NewDJStemData {
    vocals: StemWaveform;
    instrumental: StemWaveform;
    vocalBuffer: { left: Float32Array; right: Float32Array };
    instrumentalBuffer: { left: Float32Array; right: Float32Array };
    duration: number;
    sampleRate: number;
    bpm?: number; // detected from the instrumental at decode time; undefined if low confidence
}

export interface NewDJSong {
    name: string;
    id: number; // unique incrementing ID for React keys
    data: NewDJStemData;
}

export interface NewDJSlotState {
    song: NewDJSong | null;
    vocalPos: number;
    instrumentalPos: number;
    vocalVolume: number;
    instrumentalVolume: number;
}

const defaultSlot: NewDJSlotState = {
    song: null,
    vocalPos: 0,
    instrumentalPos: 0,
    vocalVolume: 1,
    instrumentalVolume: 1,
};

interface NewDJStore {
    stage: NewDJStage;
    slots: [NewDJSlotState, NewDJSlotState];
    queue: NewDJSong[];
    nextId: number;

    // Actions
    setStage: (stage: NewDJStage) => void;
    addSong: (song: Omit<NewDJSong, 'id'>) => void;
    advance: () => void;
    setSlot: (index: 0 | 1, state: Partial<NewDJSlotState>) => void;
    removeFromQueue: (index: number) => void;
    clearAll: () => void;
    clearSlot: (index: 0 | 1) => void;
}

export const useNewDJStore = create<NewDJStore>((set) => ({
    stage: 'idle',
    slots: [{ ...defaultSlot }, { ...defaultSlot }],
    queue: [],
    nextId: 1,

    setStage: (stage) => set({ stage }),

    addSong: (songWithoutId) =>
        set((prev) => {
            const song: NewDJSong = { ...songWithoutId, id: prev.nextId };
            const slots = [...prev.slots] as [NewDJSlotState, NewDJSlotState];

            if (!slots[0].song) {
                slots[0] = { ...defaultSlot, song };
                return { slots, stage: 'ready' as NewDJStage, nextId: prev.nextId + 1 };
            }
            if (!slots[1].song) {
                slots[1] = { ...defaultSlot, song };
                return { slots, stage: 'ready' as NewDJStage, nextId: prev.nextId + 1 };
            }
            return {
                queue: [...prev.queue, song],
                stage: 'ready' as NewDJStage,
                nextId: prev.nextId + 1,
            };
        }),

    advance: () =>
        set((prev) => {
            const slots = [...prev.slots] as [NewDJSlotState, NewDJSlotState];
            const queue = [...prev.queue];

            // Move slot 1 to slot 0 (preserve positions and volumes)
            if (slots[1].song) {
                slots[0] = { ...slots[1] };
            } else {
                slots[0] = { ...defaultSlot };
            }

            // Dequeue next song to slot 1
            if (queue.length > 0) {
                const next = queue.shift()!;
                slots[1] = { ...defaultSlot, song: next };
            } else {
                slots[1] = { ...defaultSlot };
            }

            const newStage: NewDJStage = slots[0].song ? 'ready' : 'idle';
            return { slots, queue, stage: newStage };
        }),

    setSlot: (index, state) =>
        set((prev) => {
            const slots = [...prev.slots] as [NewDJSlotState, NewDJSlotState];
            slots[index] = { ...slots[index], ...state };
            return { slots };
        }),

    removeFromQueue: (index) =>
        set((prev) => ({
            queue: prev.queue.filter((_, i) => i !== index),
        })),

    clearAll: () =>
        set({
            stage: 'idle',
            slots: [{ ...defaultSlot }, { ...defaultSlot }],
            queue: [],
        }),

    clearSlot: (index) =>
        set((prev) => {
            const slots = [...prev.slots] as [NewDJSlotState, NewDJSlotState];
            slots[index] = { ...defaultSlot };
            const newStage: NewDJStage =
                slots[0].song || slots[1].song ? 'ready' : 'idle';
            return { slots, stage: newStage };
        }),
}));
