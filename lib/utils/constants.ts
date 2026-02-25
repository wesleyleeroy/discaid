/**
 * System-wide constants for the autonomous DJ engine.
 */

// ─── Audio Constraints ───────────────────────────────────────
export const MAX_FILE_SIZE_MB = 50;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
export const ALLOWED_AUDIO_TYPES = [
    'audio/mpeg',       // MP3
    'audio/mp4',        // M4A/AAC
    'audio/wav',        // WAV
    'audio/x-wav',
    'audio/ogg',        // OGG
    'audio/webm',       // WebM audio
    'audio/flac',       // FLAC
    'audio/aac',
] as const;
export const ALLOWED_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.webm', '.flac', '.aac'] as const;

// ─── BPM Detection ──────────────────────────────────────────
export const BPM_MIN = 60;
export const BPM_MAX = 200;
export const BPM_ANALYSIS_DURATION = 30; // seconds of audio to analyze

// ─── Tempo Adjustment ────────────────────────────────────────
export const TEMPO_STRETCH_MAX_PERCENT = 6; // ±6% max time-stretch

// ─── Transition Defaults ─────────────────────────────────────
export const DEFAULT_OVERLAP_DURATION = 16; // seconds
export const MIN_OVERLAP_DURATION = 4;
export const MAX_OVERLAP_DURATION = 32;
export const TRANSITION_LOOKAHEAD = 30;     // seconds before track end to start planning
export const SAFE_CROSSFADE_DURATION = 8;   // fallback crossfade duration

// ─── Audio Processing ────────────────────────────────────────
export const SAMPLE_RATE = 44100;
export const FFT_SIZE = 2048;
export const HOP_SIZE = 512;

// ─── Gain Staging ────────────────────────────────────────────
export const MASTER_CEILING_DB = -0.3;      // peak ceiling
export const HEADROOM_DB = -3;              // target headroom
export const MIN_GAIN_DB = -60;             // effectively silent

// ─── Filter Defaults ─────────────────────────────────────────
export const FILTER_MIN_FREQ = 20;          // Hz
export const FILTER_MAX_FREQ = 20000;       // Hz
export const FILTER_DEFAULT_Q = 0.707;      // Butterworth Q

// ─── EQ Frequencies ──────────────────────────────────────────
export const EQ_LOW_FREQ = 100;             // Hz
export const EQ_MID_FREQ = 1000;            // Hz
export const EQ_HIGH_FREQ = 8000;           // Hz

// ─── FX Defaults ─────────────────────────────────────────────
export const REVERB_DECAY = 2.5;            // seconds
export const DELAY_TIME_DEFAULT = 0.375;    // seconds (dotted 8th at 120 BPM)
export const DELAY_FEEDBACK_DEFAULT = 0.3;
export const DELAY_MAX_FEEDBACK = 0.85;

// ─── Rate Limiting ───────────────────────────────────────────
export const MAX_QUEUE_SIZE = 20;
export const MAX_UPLOADS_PER_MINUTE = 5;

// ─── Key Names ───────────────────────────────────────────────
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
