/**
 * Stem Separator — Aggressive vocal isolation for acapella extraction.
 *
 * Uses OfflineAudioContext for high-quality filtering with cascaded
 * biquad filters (much steeper rolloff than manual IIR), combined with
 * iterative spectral subtraction to progressively remove instrument bleed.
 *
 * Pipeline:
 * 1. Mid/Side extraction (center channel holds the vocal)
 * 2. Offline rendering through cascaded bandpass filters (6×HPF + 6×LPF)
 *    giving ~72 dB/octave rolloff — extremely steep, kills almost all
 *    bass and high-frequency instrument content
 * 3. Vocal presence EQ shaping
 * 4. Iterative spectral subtraction (3 passes) — each pass estimates
 *    the remaining instrument bleed and subtracts it
 * 5. Aggressive transient suppression — kills drum hits
 * 6. Tight noise gate — silences non-vocal sections
 * 7. Final soft-clip to keep levels clean
 */

export interface StemBuffers {
    vocals: Float32Array;
    instrumental: Float32Array;
    duration: number;
    sampleRate: number;
}

export interface StemWaveform {
    peaks: Float32Array;
    rms: Float32Array;
}

export interface StemData {
    vocals: StemWaveform;
    instrumental: StemWaveform;
    vocalBuffer: Float32Array;
    instrumentalBuffer: Float32Array;
    duration: number;
    sampleRate: number;
    separationQuality: number;
}

// ─────────────────────────────────────────────────────────────────
// Offline Audio Rendering — Uses Web Audio API for precise filtering
// ─────────────────────────────────────────────────────────────────

/**
 * Render a mono Float32Array through a chain of Web Audio biquad filters
 * using OfflineAudioContext for sample-accurate processing.
 */
async function renderThroughFilters(
    data: Float32Array,
    sampleRate: number,
    filterConfigs: Array<{
        type: BiquadFilterType;
        frequency: number;
        Q?: number;
        gain?: number;
    }>
): Promise<Float32Array> {
    const length = data.length;
    const offline = new OfflineAudioContext(1, length, sampleRate);

    // Create source buffer
    const buffer = offline.createBuffer(1, length, sampleRate);
    const channelData = buffer.getChannelData(0);
    channelData.set(data);

    const source = offline.createBufferSource();
    source.buffer = buffer;

    // Chain filters
    let lastNode: AudioNode = source;
    for (const config of filterConfigs) {
        const filter = offline.createBiquadFilter();
        filter.type = config.type;
        filter.frequency.value = config.frequency;
        if (config.Q !== undefined) filter.Q.value = config.Q;
        if (config.gain !== undefined) filter.gain.value = config.gain;
        lastNode.connect(filter);
        lastNode = filter;
    }

    lastNode.connect(offline.destination);
    source.start(0);

    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
}

// ─────────────────────────────────────────────────────────────────
// Transient Suppression (aggressive)
// ─────────────────────────────────────────────────────────────────

/**
 * Aggressively suppress percussive transients.
 * Voices ramp up smoothly; drums spike instantly. We detect and crush spikes.
 */
function suppressTransients(data: Float32Array, sampleRate: number): void {
    const windowMs = 3;
    const windowSamples = Math.max(1, Math.floor(sampleRate * windowMs / 1000));
    const holdMs = 40;
    const holdSamples = Math.floor(sampleRate * holdMs / 1000);
    const attackRatioThreshold = 2.5;

    let holdCounter = 0;
    let suppressGain = 1.0;

    for (let i = windowSamples; i < data.length; i++) {
        const current = Math.abs(data[i]);
        const prev = Math.abs(data[i - windowSamples]);

        // Detect transient
        if (current > 0.005 && prev > 0.0001) {
            const ratio = current / (prev + 0.0001);
            if (ratio > attackRatioThreshold) {
                suppressGain = 0.05;
                holdCounter = holdSamples;
            }
        }

        if (holdCounter > 0) {
            data[i] *= suppressGain;
            holdCounter--;
            // Smooth recovery
            suppressGain += (1.0 - suppressGain) * (1.0 / Math.max(holdCounter, 1));
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Noise Gate (tight)
// ─────────────────────────────────────────────────────────────────

/**
 * Tight noise gate — silence anything that isn't clearly vocal.
 * Uses a higher threshold than before and adaptive hysteresis.
 */
function tightNoiseGate(data: Float32Array, sampleRate: number): void {
    const blockMs = 30;
    const blockSize = Math.floor(sampleRate * blockMs / 1000);
    const numBlocks = Math.ceil(data.length / blockSize);
    const openThreshold = 0.012;   // RMS to open gate
    const closeThreshold = 0.006;  // RMS to close gate (hysteresis)
    const fadeMs = 8;
    const fadeSamples = Math.floor(sampleRate * fadeMs / 1000);

    const blockGains = new Float32Array(numBlocks);
    let gateOpen = false;

    for (let b = 0; b < numBlocks; b++) {
        const start = b * blockSize;
        const end = Math.min(start + blockSize, data.length);
        let sumSq = 0;
        for (let i = start; i < end; i++) {
            sumSq += data[i] * data[i];
        }
        const rms = Math.sqrt(sumSq / (end - start));

        if (!gateOpen && rms > openThreshold) {
            gateOpen = true;
        } else if (gateOpen && rms < closeThreshold) {
            gateOpen = false;
        }

        blockGains[b] = gateOpen ? 1.0 : 0.0;
    }

    // Smooth transitions
    for (let pass = 0; pass < 4; pass++) {
        for (let b = 1; b < numBlocks - 1; b++) {
            blockGains[b] = blockGains[b] * 0.5 + (blockGains[b - 1] + blockGains[b + 1]) * 0.25;
        }
    }

    // Apply
    for (let b = 0; b < numBlocks; b++) {
        const start = b * blockSize;
        const end = Math.min(start + blockSize, data.length);
        for (let i = start; i < end; i++) {
            // Crossfade between blocks
            const posInBlock = (i - start) / blockSize;
            const prevGain = b > 0 ? blockGains[b - 1] : blockGains[b];
            const nextGain = b < numBlocks - 1 ? blockGains[b + 1] : blockGains[b];
            const smoothGain = blockGains[b] * 0.6 + prevGain * 0.2 * (1 - posInBlock) + nextGain * 0.2 * posInBlock;
            data[i] *= Math.max(0, Math.min(1, smoothGain));
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Iterative Spectral Subtraction
// ─────────────────────────────────────────────────────────────────

/**
 * Multi-pass spectral subtraction.
 * Each pass: estimate instrument leakage in the vocal, subtract it.
 * Uses block-wise energy comparison to adapt the subtraction amount.
 */
function iterativeSubtraction(
    vocals: Float32Array,
    reference: Float32Array,
    sampleRate: number,
    passes: number = 3,
    baseStrength: number = 0.5
): void {
    const blockMs = 15;
    const blockSize = Math.floor(sampleRate * blockMs / 1000);

    for (let pass = 0; pass < passes; pass++) {
        // Each pass is slightly less aggressive
        const strength = baseStrength * (1.0 - pass * 0.15);

        for (let start = 0; start < vocals.length; start += blockSize) {
            const end = Math.min(start + blockSize, vocals.length);

            // Compute energies
            let vocalEnergy = 0, refEnergy = 0;
            for (let i = start; i < end; i++) {
                vocalEnergy += vocals[i] * vocals[i];
                refEnergy += reference[i] * reference[i];
            }
            vocalEnergy = Math.sqrt(vocalEnergy / (end - start));
            refEnergy = Math.sqrt(refEnergy / (end - start));

            // When reference (instrument) is loud relative to vocal,
            // subtract more aggressively
            const energyRatio = refEnergy > 0.0001
                ? refEnergy / (vocalEnergy + refEnergy + 0.0001)
                : 0;

            // Scale subtraction by how much instrument energy is present
            const subtractGain = strength * energyRatio * 2.0;

            for (let i = start; i < end; i++) {
                vocals[i] -= reference[i] * subtractGain;
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Soft Clip — keeps output clean
// ─────────────────────────────────────────────────────────────────

function softClip(data: Float32Array): void {
    for (let i = 0; i < data.length; i++) {
        const x = data[i];
        if (x > 0.95) data[i] = 0.95 + (x - 0.95) * 0.1;
        else if (x < -0.95) data[i] = -0.95 + (x + 0.95) * 0.1;
    }
}

// ─────────────────────────────────────────────────────────────────
// Main Separation (async — uses OfflineAudioContext)
// ─────────────────────────────────────────────────────────────────

/**
 * Separate an AudioBuffer into vocal and instrumental stems.
 * The vocal stem is aggressively processed for acapella-quality isolation.
 */
export async function separateStems(audioBuffer: AudioBuffer): Promise<StemBuffers> {
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const duration = audioBuffer.duration;

    let vocals: Float32Array;
    let instrumental: Float32Array;

    if (audioBuffer.numberOfChannels >= 2) {
        // ─── Step 1: Mid/Side Extraction ──────────────────────────
        const left = new Float32Array(length);
        const right = new Float32Array(length);
        audioBuffer.copyFromChannel(left, 0, 0);
        audioBuffer.copyFromChannel(right, 1, 0);

        const mid = new Float32Array(length);
        const side = new Float32Array(length);

        for (let i = 0; i < length; i++) {
            mid[i] = (left[i] + right[i]) * 0.5;
            side[i] = (left[i] - right[i]) * 0.5;
        }

        // ─── Step 2: Cascaded bandpass via OfflineAudioContext ────
        // 6 × HPF at 250 Hz = ~72 dB/oct rolloff below vocal range
        // 6 × LPF at 5 kHz  = ~72 dB/oct rolloff above vocal range
        // This is MUCH steeper than the previous manual IIR approach
        vocals = await renderThroughFilters(mid, sampleRate, [
            // High-pass cascade (kills bass, kick, bass guitar)
            { type: 'highpass', frequency: 250, Q: 0.7071 },
            { type: 'highpass', frequency: 250, Q: 0.7071 },
            { type: 'highpass', frequency: 250, Q: 0.7071 },
            { type: 'highpass', frequency: 280, Q: 0.7071 },
            { type: 'highpass', frequency: 280, Q: 0.7071 },
            { type: 'highpass', frequency: 300, Q: 0.7071 },
            // Low-pass cascade (kills cymbals, hi-hat, high strings)
            { type: 'lowpass', frequency: 5000, Q: 0.7071 },
            { type: 'lowpass', frequency: 5000, Q: 0.7071 },
            { type: 'lowpass', frequency: 5000, Q: 0.7071 },
            { type: 'lowpass', frequency: 4500, Q: 0.7071 },
            { type: 'lowpass', frequency: 4500, Q: 0.7071 },
            { type: 'lowpass', frequency: 4000, Q: 0.7071 },
            // Vocal presence boost
            { type: 'peaking', frequency: 2800, Q: 1.5, gain: 4 },
            // Cut low-mid muddiness (guitar/piano body)
            { type: 'peaking', frequency: 400, Q: 1.0, gain: -6 },
            // Cut nasal/honk range that instruments occupy
            { type: 'peaking', frequency: 800, Q: 2.0, gain: -3 },
        ]);

        // ─── Step 3: Also bandpass-filter the side signal for
        //     better spectral subtraction reference ────────────────
        const filteredSide = await renderThroughFilters(side, sampleRate, [
            { type: 'highpass', frequency: 250, Q: 0.7071 },
            { type: 'highpass', frequency: 250, Q: 0.7071 },
            { type: 'lowpass', frequency: 5000, Q: 0.7071 },
            { type: 'lowpass', frequency: 5000, Q: 0.7071 },
        ]);

        // ─── Step 4: Iterative spectral subtraction ───────────────
        // 3 passes, each removing more instrument bleed
        iterativeSubtraction(vocals, filteredSide, sampleRate, 3, 0.55);

        // Also subtract from mid-only instrument estimate
        // (mid minus our vocal estimate = remaining instruments in center)
        const midInstrumentEstimate = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            midInstrumentEstimate[i] = mid[i] - vocals[i];
        }
        iterativeSubtraction(vocals, midInstrumentEstimate, sampleRate, 2, 0.4);

        // ─── Step 5: Aggressive transient suppression ─────────────
        suppressTransients(vocals, sampleRate);

        // ─── Step 6: Tight noise gate ─────────────────────────────
        tightNoiseGate(vocals, sampleRate);

        // ─── Step 7: Soft clip ────────────────────────────────────
        softClip(vocals);

        // ─── Instrumental: "karaoke" center-channel vocal removal ──
        // Instead of subtracting a vocal estimate (which never works
        // well), we directly NOTCH OUT the vocal frequency range
        // (300 Hz – 5 kHz) from the center/mid channel using steep
        // filters, then combine with the side signal which is
        // naturally free of center-panned vocals.
        const midVocalsCut = await renderThroughFilters(mid, sampleRate, [
            // Aggressively cut the vocal range from center channel
            // Deep notches across the vocal fundamental + harmonics
            { type: 'peaking', frequency: 400, Q: 1.0, gain: -18 },
            { type: 'peaking', frequency: 800, Q: 1.2, gain: -18 },
            { type: 'peaking', frequency: 1200, Q: 1.5, gain: -20 },
            { type: 'peaking', frequency: 1800, Q: 1.5, gain: -20 },
            { type: 'peaking', frequency: 2500, Q: 1.5, gain: -20 },
            { type: 'peaking', frequency: 3200, Q: 1.5, gain: -18 },
            { type: 'peaking', frequency: 4000, Q: 1.2, gain: -15 },
            // Presence/sibilance region
            { type: 'peaking', frequency: 5000, Q: 1.0, gain: -10 },
        ]);

        instrumental = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            // Side signal carries all the stereo width (vocal-free)
            // midVocalsCut has bass + highs from center, vocal range gutted
            instrumental[i] = side[i] * 1.2 + midVocalsCut[i] * 0.8;
        }

    } else {
        // ─── Mono: aggressive bandpass only ────────────────────────
        const mono = new Float32Array(length);
        audioBuffer.copyFromChannel(mono, 0, 0);

        vocals = await renderThroughFilters(mono, sampleRate, [
            { type: 'highpass', frequency: 250, Q: 0.7071 },
            { type: 'highpass', frequency: 250, Q: 0.7071 },
            { type: 'highpass', frequency: 280, Q: 0.7071 },
            { type: 'highpass', frequency: 280, Q: 0.7071 },
            { type: 'highpass', frequency: 300, Q: 0.7071 },
            { type: 'highpass', frequency: 300, Q: 0.7071 },
            { type: 'lowpass', frequency: 5000, Q: 0.7071 },
            { type: 'lowpass', frequency: 5000, Q: 0.7071 },
            { type: 'lowpass', frequency: 4500, Q: 0.7071 },
            { type: 'lowpass', frequency: 4500, Q: 0.7071 },
            { type: 'lowpass', frequency: 4000, Q: 0.7071 },
            { type: 'lowpass', frequency: 4000, Q: 0.7071 },
            { type: 'peaking', frequency: 2800, Q: 1.5, gain: 5 },
            { type: 'peaking', frequency: 400, Q: 1.0, gain: -8 },
        ]);


        suppressTransients(vocals, sampleRate);
        tightNoiseGate(vocals, sampleRate);
        softClip(vocals);

        // Mono instrumental: notch out vocal range directly
        instrumental = await renderThroughFilters(mono, sampleRate, [
            { type: 'peaking', frequency: 400, Q: 1.0, gain: -18 },
            { type: 'peaking', frequency: 800, Q: 1.2, gain: -18 },
            { type: 'peaking', frequency: 1200, Q: 1.5, gain: -20 },
            { type: 'peaking', frequency: 1800, Q: 1.5, gain: -20 },
            { type: 'peaking', frequency: 2500, Q: 1.5, gain: -20 },
            { type: 'peaking', frequency: 3200, Q: 1.5, gain: -18 },
            { type: 'peaking', frequency: 4000, Q: 1.2, gain: -15 },
            { type: 'peaking', frequency: 5000, Q: 1.0, gain: -10 },
        ]);
    }

    return { vocals, instrumental, duration, sampleRate };
}

// ─────────────────────────────────────────────────────────────────
// Waveform Generation & Quality Estimation
// ─────────────────────────────────────────────────────────────────

export function generateStemWaveform(
    data: Float32Array,
    numBins: number = 200
): StemWaveform {
    const peaks = new Float32Array(numBins);
    const rms = new Float32Array(numBins);
    const samplesPerBin = Math.floor(data.length / numBins);

    for (let bin = 0; bin < numBins; bin++) {
        const start = bin * samplesPerBin;
        const end = Math.min(start + samplesPerBin, data.length);
        let peak = 0;
        let sumSquares = 0;

        for (let i = start; i < end; i++) {
            const abs = Math.abs(data[i]);
            if (abs > peak) peak = abs;
            sumSquares += data[i] * data[i];
        }

        peaks[bin] = peak;
        rms[bin] = Math.sqrt(sumSquares / (end - start));
    }

    const maxPeak = Math.max(...peaks, 0.001);
    for (let i = 0; i < numBins; i++) {
        peaks[i] = peaks[i] / maxPeak;
        rms[i] = rms[i] / maxPeak;
    }

    return { peaks, rms };
}

/**
 * Perform full stem separation and generate visualization data.
 * Now async because it uses OfflineAudioContext for rendering.
 */
export async function processStemSeparation(
    audioBuffer: AudioBuffer,
    numBins: number = 200
): Promise<StemData> {
    const stems = await separateStems(audioBuffer);

    const vocalWaveform = generateStemWaveform(stems.vocals, numBins);
    const instrumentalWaveform = generateStemWaveform(stems.instrumental, numBins);

    let separationQuality = 0.5;
    if (audioBuffer.numberOfChannels >= 2) {
        const left = new Float32Array(audioBuffer.length);
        const right = new Float32Array(audioBuffer.length);
        audioBuffer.copyFromChannel(left, 0, 0);
        audioBuffer.copyFromChannel(right, 1, 0);

        let sumLR = 0, sumLL = 0, sumRR = 0;
        const sampleStep = Math.max(1, Math.floor(audioBuffer.length / 10000));
        for (let i = 0; i < audioBuffer.length; i += sampleStep) {
            sumLR += left[i] * right[i];
            sumLL += left[i] * left[i];
            sumRR += right[i] * right[i];
        }
        const correlation = sumLR / (Math.sqrt(sumLL * sumRR) + 0.0001);
        separationQuality = Math.max(0.2, Math.min(1.0, 1.0 - correlation * 0.6));
    }

    return {
        vocals: vocalWaveform,
        instrumental: instrumentalWaveform,
        vocalBuffer: stems.vocals,
        instrumentalBuffer: stems.instrumental,
        duration: stems.duration,
        sampleRate: stems.sampleRate,
        separationQuality,
    };
}
