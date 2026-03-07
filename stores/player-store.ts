/**
 * Player Store — Persists Quick Play state across page navigations.
 *
 * Supports two visible slots (Now Playing + Up Next) and a queue.
 * When the "Now Playing" song finishes, the "Up Next" song advances
 * into position and the next queued song fills the Up Next slot.
 */

import { create } from 'zustand';
import type { StemWaveform } from '@/lib/audio/stem-separator';

// ─── Types ────────────────────────────────────────────────────────
export type PlayerStage = 'idle' | 'loading' | 'ready';

export interface PlayerStemData {
    vocals: StemWaveform;
    instrumental: StemWaveform;
    vocalBuffer: { left: Float32Array; right: Float32Array };
    instrumentalBuffer: { left: Float32Array; right: Float32Array };
    duration: number;
    sampleRate: number;
}

export interface PlayerSong {
    name: string;
    id: number; // unique incrementing ID for React keys
    data: PlayerStemData;
}

export interface PlayerSlotState {
    song: PlayerSong | null;
    vocalPos: number;
    instrumentalPos: number;
    vocalVolume: number;
    instrumentalVolume: number;
}

const defaultSlot: PlayerSlotState = {
    song: null,
    vocalPos: 0,
    instrumentalPos: 0,
    vocalVolume: 1,
    instrumentalVolume: 1,
};

interface PlayerStore {
    stage: PlayerStage;
    slots: [PlayerSlotState, PlayerSlotState];
    queue: PlayerSong[];
    nextId: number;

    // Actions
    setStage: (stage: PlayerStage) => void;
    addSong: (song: Omit<PlayerSong, 'id'>) => void;
    advance: () => void;
    setSlot: (index: 0 | 1, state: Partial<PlayerSlotState>) => void;
    removeFromQueue: (index: number) => void;
    clearAll: () => void;
    clearSlot: (index: 0 | 1) => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
    stage: 'idle',
    slots: [{ ...defaultSlot }, { ...defaultSlot }],
    queue: [],
    nextId: 1,

    setStage: (stage) => set({ stage }),

    addSong: (songWithoutId) =>
        set((prev) => {
            const song: PlayerSong = { ...songWithoutId, id: prev.nextId };
            const slots = [...prev.slots] as [PlayerSlotState, PlayerSlotState];

            if (!slots[0].song) {
                slots[0] = { ...defaultSlot, song };
                return { slots, stage: 'ready' as PlayerStage, nextId: prev.nextId + 1 };
            }
            if (!slots[1].song) {
                slots[1] = { ...defaultSlot, song };
                return { slots, stage: 'ready' as PlayerStage, nextId: prev.nextId + 1 };
            }
            return {
                queue: [...prev.queue, song],
                stage: 'ready' as PlayerStage,
                nextId: prev.nextId + 1,
            };
        }),

    advance: () =>
        set((prev) => {
            const slots = [...prev.slots] as [PlayerSlotState, PlayerSlotState];
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

            const newStage: PlayerStage = slots[0].song ? 'ready' : 'idle';
            return { slots, queue, stage: newStage };
        }),

    setSlot: (index, state) =>
        set((prev) => {
            const slots = [...prev.slots] as [PlayerSlotState, PlayerSlotState];
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
            const slots = [...prev.slots] as [PlayerSlotState, PlayerSlotState];
            slots[index] = { ...defaultSlot };
            const newStage: PlayerStage =
                slots[0].song || slots[1].song ? 'ready' : 'idle';
            return { slots, stage: newStage };
        }),
}));
