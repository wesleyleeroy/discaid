// Type declarations for demucs-web (not published to @types)
declare module 'demucs-web' {
    import type * as ort from 'onnxruntime-web';

    export interface ProgressInfo {
        progress: number;
        currentSegment: number;
        totalSegments: number;
    }

    export interface DemucsProcessorOptions {
        ort: typeof ort;
        modelPath?: string;
        sessionOptions?: ort.InferenceSession.SessionOptions;
        onProgress?: (info: ProgressInfo) => void;
        onLog?: (phase: string, message: string) => void;
        onDownloadProgress?: (loaded: number, total: number) => void;
    }

    export interface SeparationResult {
        drums: { left: Float32Array; right: Float32Array };
        bass: { left: Float32Array; right: Float32Array };
        other: { left: Float32Array; right: Float32Array };
        vocals: { left: Float32Array; right: Float32Array };
    }

    export class DemucsProcessor {
        constructor(options: DemucsProcessorOptions);
        loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<void>;
        separate(left: Float32Array, right: Float32Array): Promise<SeparationResult>;
    }

    export const CONSTANTS: {
        SAMPLE_RATE: 44100;
        FFT_SIZE: 4096;
        HOP_SIZE: 1024;
        TRAINING_SAMPLES: 343980;
        TRACKS: ['drums', 'bass', 'other', 'vocals'];
        DEFAULT_MODEL_URL: string;
    };

    export function fft(realOut: Float32Array, imagOut: Float32Array, realIn: Float32Array, n: number): void;
    export function ifft(realOut: Float32Array, imagOut: Float32Array, realIn: Float32Array, imagIn: Float32Array, n: number): void;
    export function stft(signal: Float32Array, fftSize: number, hopSize: number): { real: Float32Array[]; imag: Float32Array[] };
    export function istft(real: Float32Array[], imag: Float32Array[], numFrames: number, numBins: number, fftSize: number, hopSize: number): Float32Array;
    export function reflectPad(signal: Float32Array, padSize: number): Float32Array;
}
