/**
 * Camelot Wheel utility for harmonic mixing compatibility.
 *
 * The Camelot Wheel maps musical keys to a numbered wheel (1-12)
 * with A (minor) and B (major) variants. Adjacent keys on the wheel
 * are harmonically compatible.
 *
 * Compatibility rules:
 * - Same position = perfect match (1.0)
 * - ±1 on wheel = compatible (0.9)
 * - Same number, different letter (relative major/minor) = compatible (0.85)
 * - ±2 on wheel = okay (0.6)
 * - Everything else = poor (0.2)
 */

interface CamelotEntry {
    number: number;
    letter: 'A' | 'B';
}

/** Map from key name + mode to Camelot code */
const CAMELOT_MAP: Record<string, CamelotEntry> = {
    // Minor keys (A)
    'Ab_minor': { number: 1, letter: 'A' },
    'G#_minor': { number: 1, letter: 'A' },
    'Eb_minor': { number: 2, letter: 'A' },
    'D#_minor': { number: 2, letter: 'A' },
    'Bb_minor': { number: 3, letter: 'A' },
    'A#_minor': { number: 3, letter: 'A' },
    'F_minor': { number: 4, letter: 'A' },
    'C_minor': { number: 5, letter: 'A' },
    'G_minor': { number: 6, letter: 'A' },
    'D_minor': { number: 7, letter: 'A' },
    'A_minor': { number: 8, letter: 'A' },
    'E_minor': { number: 9, letter: 'A' },
    'B_minor': { number: 10, letter: 'A' },
    'F#_minor': { number: 11, letter: 'A' },
    'Gb_minor': { number: 11, letter: 'A' },
    'C#_minor': { number: 12, letter: 'A' },
    'Db_minor': { number: 12, letter: 'A' },

    // Major keys (B)
    'B_major': { number: 1, letter: 'B' },
    'Cb_major': { number: 1, letter: 'B' },
    'F#_major': { number: 2, letter: 'B' },
    'Gb_major': { number: 2, letter: 'B' },
    'C#_major': { number: 3, letter: 'B' },
    'Db_major': { number: 3, letter: 'B' },
    'Ab_major': { number: 4, letter: 'B' },
    'G#_major': { number: 4, letter: 'B' },
    'Eb_major': { number: 5, letter: 'B' },
    'D#_major': { number: 5, letter: 'B' },
    'Bb_major': { number: 6, letter: 'B' },
    'A#_major': { number: 6, letter: 'B' },
    'F_major': { number: 7, letter: 'B' },
    'C_major': { number: 8, letter: 'B' },
    'G_major': { number: 9, letter: 'B' },
    'D_major': { number: 10, letter: 'B' },
    'A_major': { number: 11, letter: 'B' },
    'E_major': { number: 12, letter: 'B' },
};

/**
 * Get the Camelot code for a given key.
 * @param root - Note name (e.g., "C", "F#")
 * @param mode - "major" or "minor"
 * @returns Camelot code string (e.g., "8B") or "??" if unknown
 */
export function getCamelotCode(root: string, mode: 'major' | 'minor'): string {
    const key = `${root}_${mode}`;
    const entry = CAMELOT_MAP[key];
    if (!entry) return '??';
    return `${entry.number}${entry.letter}`;
}

/**
 * Score the harmonic compatibility between two keys (0 to 1).
 * Uses Camelot wheel distance for scoring.
 */
export function getKeyCompatibility(
    rootA: string,
    modeA: 'major' | 'minor',
    rootB: string,
    modeB: 'major' | 'minor'
): number {
    const keyA = `${rootA}_${modeA}`;
    const keyB = `${rootB}_${modeB}`;
    const entryA = CAMELOT_MAP[keyA];
    const entryB = CAMELOT_MAP[keyB];

    if (!entryA || !entryB) return 0.5; // Unknown keys, assume moderate

    // Same key = perfect
    if (entryA.number === entryB.number && entryA.letter === entryB.letter) {
        return 1.0;
    }

    // Calculate circular distance on the 12-position wheel
    const distance = Math.min(
        Math.abs(entryA.number - entryB.number),
        12 - Math.abs(entryA.number - entryB.number)
    );

    // Same number, different letter (relative major/minor)
    if (distance === 0 && entryA.letter !== entryB.letter) {
        return 0.85;
    }

    // Adjacent on wheel (same letter)
    if (distance === 1 && entryA.letter === entryB.letter) {
        return 0.9;
    }

    // Adjacent on wheel (different letter)
    if (distance === 1 && entryA.letter !== entryB.letter) {
        return 0.7;
    }

    // Two steps away
    if (distance === 2) {
        return 0.5;
    }

    // Three steps
    if (distance === 3) {
        return 0.3;
    }

    // Far apart
    return 0.15;
}

/**
 * Get a human-readable description of key compatibility.
 */
export function describeKeyCompatibility(score: number): string {
    if (score >= 0.95) return 'Perfect match';
    if (score >= 0.85) return 'Harmonically compatible';
    if (score >= 0.7) return 'Good compatibility';
    if (score >= 0.5) return 'Moderate compatibility';
    if (score >= 0.3) return 'Low compatibility';
    return 'Clashing keys';
}
