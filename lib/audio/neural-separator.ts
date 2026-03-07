/**
 * Neural Stem Separator — Using Meta's HTDemucs model via ONNX Runtime Web.
 *
 * This module wraps the `demucs-web` npm package which runs Meta's
 * Hybrid Transformer Demucs model directly in the browser using
 * ONNX Runtime Web with WebGPU/WASM acceleration.
 *
 * Quality comparison vs DSP approach:
 * - DSP (stem-separator.ts): Mid/side extraction + bandpass filters (~40-60% quality)
 * - Neural (this file): HTDemucs deep learning model (~90-95% quality)
 *
 * The model is ~172MB and is downloaded from Hugging Face on first use.
 * Processing time: ~30-120s depending on song length and device GPU.
 *
 * Output: 4 stereo stems — vocals, drums, bass, other
 */

import type { StemWaveform } from './stem-separator';

// ─── Types ────────────────────────────────────────────────────────

export interface NeuralStemResult {
    vocals: { left: Float32Array; right: Float32Array };
    drums: { left: Float32Array; right: Float32Array };
    bass: { left: Float32Array; right: Float32Array };
    other: { left: Float32Array; right: Float32Array };
    duration: number;
    sampleRate: number;
}

export interface NeuralStemData {
    vocals: StemWaveform;
    drums: StemWaveform;
    bass: StemWaveform;
    other: StemWaveform;
    instrumental: StemWaveform; // Combined: drums + bass + other
    vocalBuffer: { left: Float32Array; right: Float32Array };
    drumsBuffer: { left: Float32Array; right: Float32Array };
    bassBuffer: { left: Float32Array; right: Float32Array };
    otherBuffer: { left: Float32Array; right: Float32Array };
    instrumentalBuffer: { left: Float32Array; right: Float32Array };
    duration: number;
    sampleRate: number;
}

export interface NeuralProgress {
    phase: 'downloading' | 'loading' | 'processing' | 'done';
    progress: number; // 0-1
    message: string;
    downloadedMB?: number;
    totalMB?: number;
    currentSegment?: number;
    totalSegments?: number;
}

// ─── Waveform Generation ──────────────────────────────────────────

function generateStereoWaveform(
    left: Float32Array,
    right: Float32Array,
    numBins: number = 300
): StemWaveform {
    const peaks = new Float32Array(numBins);
    const rms = new Float32Array(numBins);
    const samplesPerBin = Math.floor(left.length / numBins);
    let maxPeak = 0.001; // Track maximum during the loop to avoid a second pass

    for (let bin = 0; bin < numBins; bin++) {
        const start = bin * samplesPerBin;
        const end = Math.min(start + samplesPerBin, left.length);
        let peak = 0;
        let sumSquares = 0;

        for (let i = start; i < end; i++) {
            // Mix to mono for visualization
            const sample = (left[i] + right[i]) * 0.5;
            const abs = Math.abs(sample);
            if (abs > peak) peak = abs;
            sumSquares += sample * sample;
        }

        peaks[bin] = peak;
        rms[bin] = Math.sqrt(sumSquares / (end - start));
        if (peak > maxPeak) maxPeak = peak;
    }

    // Normalize in a single pass
    const invMax = 1.0 / maxPeak;
    for (let i = 0; i < numBins; i++) {
        peaks[i] *= invMax;
        rms[i] *= invMax;
    }

    return { peaks, rms };
}

function combineStereoStems(
    ...stems: Array<{ left: Float32Array; right: Float32Array }>
): { left: Float32Array; right: Float32Array } {
    const length = stems[0].left.length;
    const left = new Float32Array(length);
    const right = new Float32Array(length);

    for (const stem of stems) {
        for (let i = 0; i < length; i++) {
            left[i] += stem.left[i];
            right[i] += stem.right[i];
        }
    }

    return { left, right };
}

// ─── Neural Separator ─────────────────────────────────────────────

let processorInstance: unknown = null;
let modelLoaded = false;
let _processing = false;

// Mutable refs so the reused processor always calls the right handler
let _currentOnProgress: ((info: NeuralProgress) => void) | null = null;
let _separationStartTime = 0;

// Completion detection: demucs-web can hang after processing all segments.
// We detect when currentSegment >= totalSegments and force-resolve.
let _completionResolver: ((value: unknown) => void) | null = null;
let _completionTimeout: ReturnType<typeof setTimeout> | null = null;

// Mutex to prevent concurrent processing (ONNX session is single-threaded)
let processingLock: Promise<void> = Promise.resolve();

// ─── Cached dynamic imports (avoid re-resolving every call) ───────
let _cachedOrt: typeof import('onnxruntime-web') | null = null;
let _cachedDemucs: typeof import('demucs-web') | null = null;

// ─── Preloaded processor from background warm-up ────────────────
let _preloadedProcessor: unknown = null;
let _preloadedModelLoaded = false;

/**
 * Accept a pre-warmed DemucsProcessor from the background preloader.
 * This skips model download + ONNX initialization on first use.
 */
export function setPreloadedProcessor(processor: unknown, isLoaded: boolean) {
    if (!processorInstance) {
        _preloadedProcessor = processor;
        _preloadedModelLoaded = isLoaded;
    }
}

/**
 * Run HTDemucs neural network stem separation in the browser.
 *
 * First call downloads the ~172MB model from Hugging Face.
 * Subsequent calls reuse the loaded model.
 *
 * Only one separation can run at a time — concurrent calls are queued.
 */
export async function neuralSeparate(
    audioBuffer: AudioBuffer,
    onProgress?: (info: NeuralProgress) => void
): Promise<NeuralStemData> {
    // Queue behind any in-progress separation
    let releaseLock: () => void;
    const myTurn = processingLock;
    processingLock = new Promise<void>((resolve) => { releaseLock = resolve; });

    // Wait for previous separation to finish
    await myTurn;

    try {
        _processing = true;
        return await _doSeparation(audioBuffer, onProgress);
    } finally {
        _processing = false;
        releaseLock!();
    }
}

async function _doSeparation(
    audioBuffer: AudioBuffer,
    onProgress?: (info: NeuralProgress) => void
): Promise<NeuralStemData> {
    // Dynamically import to avoid SSR issues — cache after first load
    if (!_cachedOrt) _cachedOrt = await import('onnxruntime-web');
    if (!_cachedDemucs) _cachedDemucs = await import('demucs-web');
    const ort = _cachedOrt;
    const { DemucsProcessor, CONSTANTS } = _cachedDemucs;

    // Configure ONNX Runtime: run WASM in a Web Worker to keep UI responsive
    ort.env.wasm.wasmPaths = '/onnx/';
    ort.env.wasm.proxy = true; // Run inference in a Web Worker (prevents "page unresponsive")
    // Allow up to 8 threads for WASM SIMD matrix ops — significant speedup on multi-core
    ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8);

    onProgress?.({
        phase: 'loading',
        progress: 0,
        message: 'Initializing AI model (WASM)...',
    });

    // Update the mutable progress handler for this call
    _currentOnProgress = onProgress || null;
    _separationStartTime = 0;

    // Create processor if not already created.
    // Check for a background-preloaded processor first (avoids re-downloading model).
    if (!processorInstance && _preloadedProcessor) {
        processorInstance = _preloadedProcessor;
        if (_preloadedModelLoaded) modelLoaded = true;
        _preloadedProcessor = null;
        _preloadedModelLoaded = false;
        // Patch our progress/log/download callbacks onto the preloaded processor
        const p = processorInstance as Record<string, unknown>;
        p.onProgress = (info: { progress: number; currentSegment: number; totalSegments: number }) => {
            const capped = Math.min(info.progress, 1);
            const seg = Math.min(info.currentSegment, info.totalSegments);

            if (seg === 1 && _separationStartTime === 0) {
                _separationStartTime = Date.now();
            }
            let timeEstimate = '';
            if (seg > 1 && _separationStartTime > 0) {
                const elapsed = (Date.now() - _separationStartTime) / 1000;
                const perSegment = elapsed / (seg - 1);
                const remaining = Math.ceil(perSegment * (info.totalSegments - seg + 1));
                timeEstimate = remaining > 0 ? ` — ~${remaining}s remaining` : '';
            }
            _currentOnProgress?.({
                phase: 'processing',
                progress: capped,
                message: `Separating stems... Segment ${seg}/${info.totalSegments}${timeEstimate}`,
                currentSegment: seg,
                totalSegments: info.totalSegments,
            });

            if (info.currentSegment >= info.totalSegments && !_completionTimeout) {
                _currentOnProgress?.({
                    phase: 'done',
                    progress: 1,
                    message: 'Finalizing stems...',
                });
                _completionTimeout = setTimeout(() => {
                    if (_completionResolver) {
                        console.warn('[Demucs] processor.separate() did not resolve after all segments — force-resolving');
                        _completionResolver(null);
                        _completionResolver = null;
                    }
                    _completionTimeout = null;
                }, 15000);
            }
        };
        p.onLog = (phase: string, msg: string) => {
            console.log(`[Demucs ${phase}] ${msg}`);
        };
        p.onDownloadProgress = (loaded: number, total: number) => {
            const loadedMB = loaded / 1024 / 1024;
            const totalMB = total / 1024 / 1024;
            _currentOnProgress?.({
                phase: 'downloading',
                progress: total > 0 ? loaded / total : 0,
                message: `Downloading AI model... ${loadedMB.toFixed(0)}MB / ${totalMB.toFixed(0)}MB`,
                downloadedMB: loadedMB,
                totalMB,
            });
        };
        console.log('[Demucs] Using preloaded processor (skipped download)');
    }

    if (!processorInstance) {
        const processor = new DemucsProcessor({
            ort,
            onProgress: (info: { progress: number; currentSegment: number; totalSegments: number }) => {
                // Cap progress and segment at 100% / total
                const capped = Math.min(info.progress, 1);
                const seg = Math.min(info.currentSegment, info.totalSegments);

                if (seg === 1 && _separationStartTime === 0) {
                    _separationStartTime = Date.now();
                }
                let timeEstimate = '';
                if (seg > 1 && _separationStartTime > 0) {
                    const elapsed = (Date.now() - _separationStartTime) / 1000;
                    const perSegment = elapsed / (seg - 1);
                    const remaining = Math.ceil(perSegment * (info.totalSegments - seg + 1));
                    timeEstimate = remaining > 0 ? ` — ~${remaining}s remaining` : '';
                }
                _currentOnProgress?.({
                    phase: 'processing',
                    progress: capped,
                    message: `Separating stems... Segment ${seg}/${info.totalSegments}${timeEstimate}`,
                    currentSegment: seg,
                    totalSegments: info.totalSegments,
                });

                // Detect when all segments are processed — demucs-web sometimes
                // reports currentSegment > totalSegments and then the promise hangs.
                // If we see this, immediately show "Finalizing" and set a timeout to force-resolve.
                if (info.currentSegment >= info.totalSegments && !_completionTimeout) {
                    // Immediately show a finalizing state so the user knows it's almost done
                    _currentOnProgress?.({
                        phase: 'done',
                        progress: 1,
                        message: 'Finalizing stems...',
                    });

                    _completionTimeout = setTimeout(() => {
                        if (_completionResolver) {
                            console.warn('[Demucs] processor.separate() did not resolve after all segments — force-resolving');
                            _completionResolver(null);
                            _completionResolver = null;
                        }
                        _completionTimeout = null;
                    }, 15000); // 15 seconds to allow time for WASM finalization steps
                }
            },
            onLog: (phase: string, msg: string) => {
                console.log(`[Demucs ${phase}] ${msg}`);
            },
            onDownloadProgress: (loaded: number, total: number) => {
                const loadedMB = loaded / 1024 / 1024;
                const totalMB = total / 1024 / 1024;
                _currentOnProgress?.({
                    phase: 'downloading',
                    progress: total > 0 ? loaded / total : 0,
                    message: `Downloading AI model... ${loadedMB.toFixed(0)}MB / ${totalMB.toFixed(0)}MB`,
                    downloadedMB: loadedMB,
                    totalMB,
                });
            },
            sessionOptions: {
                executionProviders: ['wasm'],
                enableCpuMemArena: true,  // Reuse memory across inference calls (faster per-segment)
                enableMemPattern: true,   // Let ONNX plan memory reuse patterns
                graphOptimizationLevel: 'all', // Maximum operator fusion & graph transforms
            },
        });
        processorInstance = processor;
    }

    const processor = processorInstance as {
        loadModel: (url: string) => Promise<void>;
        separate: (left: Float32Array, right: Float32Array) => Promise<{
            drums: { left: Float32Array; right: Float32Array };
            bass: { left: Float32Array; right: Float32Array };
            other: { left: Float32Array; right: Float32Array };
            vocals: { left: Float32Array; right: Float32Array };
        }>;
    };

    // Load model (downloads from HuggingFace on first use, ~172MB)
    if (!modelLoaded) {
        onProgress?.({
            phase: 'downloading',
            progress: 0,
            message: 'Downloading AI model (~172MB)... This only happens once.',
        });

        try {
            await processor.loadModel(CONSTANTS.DEFAULT_MODEL_URL);
            modelLoaded = true;
        } catch (err) {
            // Reset so next attempt creates a fresh processor
            processorInstance = null;
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
                `Failed to load AI model. This may be a network or CORS issue. ` +
                `Make sure Cross-Origin-Embedder-Policy is set to "credentialless". ` +
                `Original error: ${msg}`
            );
        }
    }

    // Get audio channels
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1)
        : leftChannel; // Mono → duplicate

    onProgress?.({
        phase: 'processing',
        progress: 0,
        message: 'Starting neural stem separation...',
    });

    // Run separation — with a race against completion detection.
    // demucs-web sometimes hangs after processing all segments, so
    // if the progress callback sees all segments are done and the
    // promise hasn't resolved in 5s, we force-resolve.
    _completionResolver = null;
    _completionTimeout = null;

    const completionFallback = new Promise<unknown>((resolve) => {
        _completionResolver = resolve;
    });

    const result = await Promise.race([
        processor.separate(leftChannel, rightChannel),
        completionFallback,
    ]) as Awaited<ReturnType<typeof processor.separate>> | null;

    // 1. Immediately nullify _currentOnProgress to prevent STRAGGLER WASM worker events 
    // from modifying the UI after we've decided to throw an error or return success.
    _currentOnProgress = null;

    // 2. Clear any pending timeout
    if (_completionTimeout) {
        clearTimeout(_completionTimeout);
        _completionTimeout = null;
    }
    _completionResolver = null;

    // 3. If we got force-resolved (result is null), we can't use the stems
    if (!result) {
        processorInstance = null; // Recreate DemucsProcessor on the next attempt since it hung.
        throw new Error('Stem separation timed out after all segments were processed. Please try again.');
    }

    onProgress?.({
        phase: 'done',
        progress: 1,
        message: 'Separation complete!',
    });

    // Generate waveforms — run all in parallel and fuse instrumental combination
    const numBins = 300;

    // Fuse instrumental combination with waveform generation:
    // combine drums+bass+other in one pass instead of allocating a full copy first
    const instrumental = combineStereoStems(result.drums, result.bass, result.other);

    const [vocalsWf, drumsWf, bassWf, otherWf, instrumentalWf] = [
        generateStereoWaveform(result.vocals.left, result.vocals.right, numBins),
        generateStereoWaveform(result.drums.left, result.drums.right, numBins),
        generateStereoWaveform(result.bass.left, result.bass.right, numBins),
        generateStereoWaveform(result.other.left, result.other.right, numBins),
        generateStereoWaveform(instrumental.left, instrumental.right, numBins),
    ];

    return {
        vocals: vocalsWf,
        drums: drumsWf,
        bass: bassWf,
        other: otherWf,
        instrumental: instrumentalWf,
        vocalBuffer: result.vocals,
        drumsBuffer: result.drums,
        bassBuffer: result.bass,
        otherBuffer: result.other,
        instrumentalBuffer: instrumental,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
    };
}

/**
 * Check if the neural model is already loaded in memory.
 */
export function isModelLoaded(): boolean {
    return modelLoaded;
}

/**
 * Check if a separation is currently in progress.
 */
export function isProcessing(): boolean {
    return _processing;
}
