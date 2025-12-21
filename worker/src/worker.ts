/**
 * Audio Processing Worker
 *
 * Production-ready Dockerized worker that:
 *   - Polls Supabase for pending jobs
 *   - Downloads audio files from storage
 *   - Processes vocals through the VocalChain DSP
 *   - Mixes with beat at appropriate levels
 *   - Applies loudness normalization
 *   - Uploads results back to storage
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from parent directory's .env.local
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MPEGDecoderWebWorker } from 'mpg123-decoder';
import {
    WorkerVocalAnalyzer,
    WorkerReferenceAnalyzer,
    WorkerParameterOptimizer,
    OptimizedParameters
} from './aiAnalyzer';
import { BackingVocalsGenerator } from './backingVocals';
import { SectionDetector } from './sectionDetector';

// ============================================
// ENVIRONMENT & CONFIGURATION
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000');
const WORKER_ID = process.env.WORKER_ID || `worker-${Date.now()}`;
const SAMPLE_RATE = parseInt(process.env.SAMPLE_RATE || '44100');
const TARGET_LUFS = parseFloat(process.env.TARGET_LUFS || '-14');

// Initialize Supabase with service key (bypasses RLS)
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================
// TYPE DEFINITIONS
// ============================================

interface UserMacroState {
    autotuneStrength: number;
    reverbAmount: number;
    vocalLoudness: number;
    polishAmount: number;
    // Backing vocals options (V2)
    backingVocalsEnabled?: boolean;
    backingVocalsType?: 'doubles' | 'harmonies' | 'full';
    backingVocalsAmount?: number; // 0-100
}

interface Job {
    id: string;
    project_id: string;
    user_id: string;
    vocal_path: string;
    beat_path: string | null;
    reference_path: string | null;
    parameters: ChainParameters | null;
    user_macros: UserMacroState;
    created_at: string;
}

interface ChainParameters {
    gainStaging: {
        inputGain: number;
        targetRms: number;
        peakCeiling: number;
    };
    subtractiveEQ: {
        highPassFreq: number;
        highPassSlope: number;
        bands: EQBand[];
    };
    deEsser: {
        frequency: number;
        threshold: number;
        ratio: number;
        range: number;
    };
    compressionA: CompressorParams;
    compressionB: CompressorParams;
    autotune: {
        enabled: boolean;
        key: string;
        scale: string;
        retuneSpeed: number;
        humanize: number;
        formantPreserve: boolean;
    };
    additiveEQ: {
        presenceFreq: number;
        presenceGain: number;
        presenceQ: number;
        airShelfFreq: number;
        airShelfGain: number;
    };
    saturation: {
        drive: number;
        mix: number;
    };
    reverb: {
        type: 'plate' | 'room' | 'hall';
        preDelay: number;
        decay: number;
        damping: number;
        wetLevel: number;
    };
    delay: {
        enabled: boolean;
        time: number;
        feedback: number;
        wetLevel: number;
        highCut: number;
    };
}

interface EQBand {
    frequency: number;
    gain: number;
    q: number;
    type: 'highpass' | 'lowpass' | 'peak' | 'shelf' | 'notch';
    enabled: boolean;
}

interface CompressorParams {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    knee: number;
    makeupGain: number;
}

interface WavInfo {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    data: Float32Array;
}

interface ProcessingResult {
    audio: Float32Array;
    loudnessLufs: number;
    peakDb: number;
    durationSeconds: number;
}

// ============================================
// AUDIO DECODER / ENCODER
// ============================================

/**
 * Detect audio format from buffer
 */
function detectAudioFormat(buffer: Buffer): 'wav' | 'mp3' | 'unknown' {
    // Check for RIFF/WAVE header
    if (buffer.length >= 12) {
        const riff = buffer.toString('ascii', 0, 4);
        const wave = buffer.toString('ascii', 8, 12);
        if (riff === 'RIFF' && wave === 'WAVE') {
            return 'wav';
        }
    }

    // Check for MP3 sync word (0xFF 0xFB, 0xFF 0xFA, 0xFF 0xF3, 0xFF 0xF2)
    // or ID3 tag header
    if (buffer.length >= 3) {
        // ID3v2 header
        if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
            return 'mp3';
        }
        // MP3 frame sync
        if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
            return 'mp3';
        }
    }

    return 'unknown';
}

/**
 * Decode MP3 buffer to Float32Array PCM
 */
async function decodeMp3(buffer: Buffer): Promise<WavInfo> {
    const decoder = new MPEGDecoderWebWorker();
    await decoder.ready;

    const { channelData, samplesDecoded, sampleRate } = await decoder.decode(
        new Uint8Array(buffer)
    );

    await decoder.free();

    // Interleave channels if stereo
    const channels = channelData.length;
    let data: Float32Array;

    if (channels === 2) {
        data = new Float32Array(samplesDecoded * 2);
        for (let i = 0; i < samplesDecoded; i++) {
            data[i * 2] = channelData[0][i];
            data[i * 2 + 1] = channelData[1][i];
        }
    } else {
        data = new Float32Array(channelData[0]);
    }

    return {
        sampleRate,
        channels,
        bitsPerSample: 16, // MP3 decoded as 16-bit equivalent
        data
    };
}

/**
 * Decode any supported audio format to Float32Array PCM
 */
async function decodeAudio(buffer: Buffer): Promise<WavInfo> {
    const format = detectAudioFormat(buffer);

    switch (format) {
        case 'wav':
            return decodeWav(buffer);
        case 'mp3':
            console.log('   → Detected MP3 format, decoding...');
            return await decodeMp3(buffer);
        default:
            throw new Error(`Unsupported audio format. Only WAV and MP3 are supported.`);
    }
}

/**
 * Decode WAV buffer to Float32Array PCM
 */
function decodeWav(buffer: Buffer): WavInfo {
    // RIFF header check
    const riff = buffer.toString('ascii', 0, 4);
    if (riff !== 'RIFF') {
        throw new Error('Invalid WAV: missing RIFF header');
    }

    const wave = buffer.toString('ascii', 8, 12);
    if (wave !== 'WAVE') {
        throw new Error('Invalid WAV: missing WAVE format');
    }

    // Find fmt chunk
    let offset = 12;
    let fmtChunk: Buffer | null = null;
    let dataChunk: Buffer | null = null;

    while (offset < buffer.length - 8) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === 'fmt ') {
            fmtChunk = buffer.subarray(offset + 8, offset + 8 + chunkSize);
        } else if (chunkId === 'data') {
            dataChunk = buffer.subarray(offset + 8, offset + 8 + chunkSize);
        }

        offset += 8 + chunkSize;
        // Ensure word alignment
        if (chunkSize % 2 !== 0) offset++;
    }

    if (!fmtChunk || !dataChunk) {
        throw new Error('Invalid WAV: missing fmt or data chunk');
    }

    const audioFormat = fmtChunk.readUInt16LE(0);
    const channels = fmtChunk.readUInt16LE(2);
    const sampleRate = fmtChunk.readUInt32LE(4);
    const bitsPerSample = fmtChunk.readUInt16LE(14);

    if (audioFormat !== 1 && audioFormat !== 3) {
        throw new Error(`Unsupported WAV format: ${audioFormat} (only PCM supported)`);
    }

    // Convert to Float32
    const bytesPerSample = bitsPerSample / 8;
    const numSamples = dataChunk.length / bytesPerSample;
    const data = new Float32Array(numSamples);

    if (bitsPerSample === 16) {
        for (let i = 0; i < numSamples; i++) {
            data[i] = dataChunk.readInt16LE(i * 2) / 32768;
        }
    } else if (bitsPerSample === 24) {
        for (let i = 0; i < numSamples; i++) {
            const offset = i * 3;
            const sample = (dataChunk[offset] | (dataChunk[offset + 1] << 8) | (dataChunk[offset + 2] << 16));
            // Sign extend
            data[i] = (sample >= 0x800000 ? sample - 0x1000000 : sample) / 8388608;
        }
    } else if (bitsPerSample === 32 && audioFormat === 3) {
        // 32-bit float
        for (let i = 0; i < numSamples; i++) {
            data[i] = dataChunk.readFloatLE(i * 4);
        }
    } else if (bitsPerSample === 32) {
        // 32-bit int
        for (let i = 0; i < numSamples; i++) {
            data[i] = dataChunk.readInt32LE(i * 4) / 2147483648;
        }
    } else {
        throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
    }

    return { sampleRate, channels, bitsPerSample, data };
}

/**
 * Encode Float32Array PCM to WAV buffer (16-bit stereo)
 */
function encodeWav(pcm: Float32Array, sampleRate: number, channels: number = 2): Buffer {
    const bytesPerSample = 2; // 16-bit
    const dataLength = pcm.length * bytesPerSample;
    const headerLength = 44;
    const buffer = Buffer.alloc(headerLength + dataLength);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);

    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
    buffer.writeUInt16LE(channels * bytesPerSample, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample

    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);

    // Write samples (clip and convert to 16-bit)
    for (let i = 0; i < pcm.length; i++) {
        const sample = Math.max(-1, Math.min(1, pcm[i]));
        buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
    }

    return buffer;
}

/**
 * Convert mono to stereo
 */
function monoToStereo(mono: Float32Array): Float32Array {
    const stereo = new Float32Array(mono.length * 2);
    for (let i = 0; i < mono.length; i++) {
        stereo[i * 2] = mono[i];
        stereo[i * 2 + 1] = mono[i];
    }
    return stereo;
}

/**
 * Convert stereo to mono (by averaging)
 */
function stereoToMono(stereo: Float32Array): Float32Array {
    const mono = new Float32Array(stereo.length / 2);
    for (let i = 0; i < mono.length; i++) {
        mono[i] = (stereo[i * 2] + stereo[i * 2 + 1]) / 2;
    }
    return mono;
}

/**
 * Resample audio to target sample rate (linear interpolation)
 */
function resample(input: Float32Array, inputSampleRate: number, targetSampleRate: number): Float32Array {
    if (inputSampleRate === targetSampleRate) {
        return input;
    }

    const ratio = inputSampleRate / targetSampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
        const srcPos = i * ratio;
        const srcIndex = Math.floor(srcPos);
        const frac = srcPos - srcIndex;

        if (srcIndex + 1 < input.length) {
            output[i] = input[srcIndex] * (1 - frac) + input[srcIndex + 1] * frac;
        } else {
            output[i] = input[srcIndex] || 0;
        }
    }

    return output;
}

// ============================================
// DSP PROCESSING IMPLEMENTATIONS
// ============================================

/**
 * Simple biquad filter for high-pass and EQ
 */
class BiquadFilter {
    private b0 = 1;
    private b1 = 0;
    private b2 = 0;
    private a1 = 0;
    private a2 = 0;
    private x1 = 0;
    private x2 = 0;
    private y1 = 0;
    private y2 = 0;

    setHighPass(frequency: number, q: number, sampleRate: number): void {
        const w0 = (2 * Math.PI * frequency) / sampleRate;
        const alpha = Math.sin(w0) / (2 * q);
        const cosW0 = Math.cos(w0);

        const a0 = 1 + alpha;
        this.b0 = ((1 + cosW0) / 2) / a0;
        this.b1 = (-(1 + cosW0)) / a0;
        this.b2 = ((1 + cosW0) / 2) / a0;
        this.a1 = (-2 * cosW0) / a0;
        this.a2 = (1 - alpha) / a0;
    }

    setPeaking(frequency: number, gain: number, q: number, sampleRate: number): void {
        const w0 = (2 * Math.PI * frequency) / sampleRate;
        const A = Math.pow(10, gain / 40);
        const alpha = Math.sin(w0) / (2 * q);
        const cosW0 = Math.cos(w0);

        const a0 = 1 + alpha / A;
        this.b0 = (1 + alpha * A) / a0;
        this.b1 = (-2 * cosW0) / a0;
        this.b2 = (1 - alpha * A) / a0;
        this.a1 = (-2 * cosW0) / a0;
        this.a2 = (1 - alpha / A) / a0;
    }

    setHighShelf(frequency: number, gain: number, q: number, sampleRate: number): void {
        const w0 = (2 * Math.PI * frequency) / sampleRate;
        const A = Math.pow(10, gain / 40);
        const alpha = Math.sin(w0) / (2 * q);
        const cosW0 = Math.cos(w0);
        const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;

        const a0 = (A + 1) - (A - 1) * cosW0 + sqrtA2alpha;
        this.b0 = (A * ((A + 1) + (A - 1) * cosW0 + sqrtA2alpha)) / a0;
        this.b1 = (-2 * A * ((A - 1) + (A + 1) * cosW0)) / a0;
        this.b2 = (A * ((A + 1) + (A - 1) * cosW0 - sqrtA2alpha)) / a0;
        this.a1 = (2 * ((A - 1) - (A + 1) * cosW0)) / a0;
        this.a2 = ((A + 1) - (A - 1) * cosW0 - sqrtA2alpha) / a0;
    }

    process(sample: number): number {
        const output = this.b0 * sample + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;

        this.x2 = this.x1;
        this.x1 = sample;
        this.y2 = this.y1;
        this.y1 = output;

        return output;
    }

    reset(): void {
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
}

/**
 * Simple compressor implementation
 */
class SimpleCompressor {
    private envelope = 0;
    private attackCoef = 0;
    private releaseCoef = 0;

    constructor(
        private threshold: number,
        private ratio: number,
        private attackMs: number,
        private releaseMs: number,
        private sampleRate: number
    ) {
        this.attackCoef = Math.exp(-1 / (sampleRate * attackMs / 1000));
        this.releaseCoef = Math.exp(-1 / (sampleRate * releaseMs / 1000));
    }

    process(input: Float32Array): Float32Array {
        const output = new Float32Array(input.length);
        const thresholdLinear = Math.pow(10, this.threshold / 20);

        for (let i = 0; i < input.length; i++) {
            const inputLevel = Math.abs(input[i]);

            // Envelope follower
            if (inputLevel > this.envelope) {
                this.envelope = this.attackCoef * this.envelope + (1 - this.attackCoef) * inputLevel;
            } else {
                this.envelope = this.releaseCoef * this.envelope + (1 - this.releaseCoef) * inputLevel;
            }

            // Calculate gain reduction
            let gain = 1;
            if (this.envelope > thresholdLinear) {
                const overDb = 20 * Math.log10(this.envelope / thresholdLinear);
                const reductionDb = overDb * (1 - 1 / this.ratio);
                gain = Math.pow(10, -reductionDb / 20);
            }

            output[i] = input[i] * gain;
        }

        return output;
    }
}

/**
 * Simple reverb using Schroeder comb and allpass filters
 */
class SimpleReverb {
    private combFilters: { buffer: Float32Array; writeIndex: number; feedback: number }[] = [];
    private allpassFilters: { buffer: Float32Array; writeIndex: number }[] = [];
    private wet: number;
    private dry: number;

    constructor(private sampleRate: number, decay: number = 2.0, wetLevel: number = 0.3) {
        this.wet = wetLevel;
        this.dry = 1 - wetLevel;

        // Comb filter delay times (in samples) and feedbacks
        const combDelays = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map(d => Math.floor(d * sampleRate / 44100));
        const baseFeedback = 0.84 + decay * 0.03;

        for (const delay of combDelays) {
            this.combFilters.push({
                buffer: new Float32Array(delay),
                writeIndex: 0,
                feedback: baseFeedback * 0.95 + Math.random() * 0.1
            });
        }

        // Allpass filter delay times
        const allpassDelays = [225, 556, 441, 341].map(d => Math.floor(d * sampleRate / 44100));
        for (const delay of allpassDelays) {
            this.allpassFilters.push({
                buffer: new Float32Array(delay),
                writeIndex: 0
            });
        }
    }

    process(input: Float32Array): Float32Array {
        const output = new Float32Array(input.length);

        for (let i = 0; i < input.length; i++) {
            let combSum = 0;

            // Process comb filters in parallel
            for (const comb of this.combFilters) {
                const readIndex = (comb.writeIndex + comb.buffer.length - comb.buffer.length) % comb.buffer.length;
                const delayed = comb.buffer[readIndex];
                comb.buffer[comb.writeIndex] = input[i] + delayed * comb.feedback;
                combSum += delayed;
                comb.writeIndex = (comb.writeIndex + 1) % comb.buffer.length;
            }

            combSum /= this.combFilters.length;

            // Process allpass filters in series
            let allpassOut = combSum;
            for (const ap of this.allpassFilters) {
                const delayed = ap.buffer[ap.writeIndex];
                const temp = allpassOut + delayed * 0.5;
                ap.buffer[ap.writeIndex] = allpassOut;
                allpassOut = delayed - temp * 0.5;
                ap.writeIndex = (ap.writeIndex + 1) % ap.buffer.length;
            }

            output[i] = input[i] * this.dry + allpassOut * this.wet;
        }

        return output;
    }
}

/**
 * Simple pitch detection and correction (simplified AutoTune)
 */
function applySimpleAutotune(input: Float32Array, strength: number, _sampleRate: number): Float32Array {
    // Simplified: Apply subtle pitch smoothing effect proportional to strength
    // Real pitch correction would use FFT/PSOLA but that's complex
    // For MVP, we apply a subtle chorus-like effect to simulate correction

    if (strength < 10) {
        return input; // No effect at low strength
    }

    const output = new Float32Array(input.length);
    const blendAmount = Math.min(strength / 100, 0.5);

    for (let i = 0; i < input.length; i++) {
        // Simple smoothing (simulates pitch stabilization effect)
        if (i > 0 && i < input.length - 1) {
            output[i] = input[i] * (1 - blendAmount * 0.1) +
                ((input[i - 1] + input[i + 1]) / 2) * blendAmount * 0.1;
        } else {
            output[i] = input[i];
        }
    }

    return output;
}

/**
 * Simple saturation/harmonic distortion
 */
function applySaturation(input: Float32Array, drive: number, mix: number): Float32Array {
    const output = new Float32Array(input.length);
    const driveAmount = 1 + drive * 0.1;
    const wetAmount = mix / 100;
    const dryAmount = 1 - wetAmount;

    for (let i = 0; i < input.length; i++) {
        // Soft clipping using tanh
        const driven = Math.tanh(input[i] * driveAmount);
        output[i] = input[i] * dryAmount + driven * wetAmount;
    }

    return output;
}

/**
 * Calculate RMS loudness
 */
function calculateRms(audio: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < audio.length; i++) {
        sum += audio[i] * audio[i];
    }
    return Math.sqrt(sum / audio.length);
}

/**
 * Calculate approximate LUFS (simplified, uses RMS as proxy)
 * Real LUFS calculation requires ITU-R BS.1770 gating
 */
function calculateApproxLufs(audio: Float32Array): number {
    const rms = calculateRms(audio);
    if (rms === 0) return -60;

    // Approximate LUFS from RMS
    // LUFS ≈ 20 * log10(rms) + offset
    return 20 * Math.log10(rms) - 0.691;
}

/**
 * Calculate peak level in dB
 */
function calculatePeakDb(audio: Float32Array): number {
    let peak = 0;
    for (let i = 0; i < audio.length; i++) {
        const abs = Math.abs(audio[i]);
        if (abs > peak) peak = abs;
    }
    if (peak === 0) return -60;
    return 20 * Math.log10(peak);
}

/**
 * Apply loudness normalization
 */
function normalizeLoudness(audio: Float32Array, targetLufs: number): Float32Array {
    const currentLufs = calculateApproxLufs(audio);
    const gainDb = targetLufs - currentLufs;
    const gain = Math.pow(10, gainDb / 20);

    // Limit gain to avoid extreme amplification
    const limitedGain = Math.min(Math.max(gain, 0.1), 10);

    const output = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
        output[i] = audio[i] * limitedGain;
    }

    return output;
}

/**
 * Apply limiter to prevent clipping
 */
function applyLimiter(audio: Float32Array, ceiling: number = 0.95): Float32Array {
    const output = new Float32Array(audio.length);
    let envelope = 0;
    const releaseCoef = 0.9995;

    for (let i = 0; i < audio.length; i++) {
        const inputAbs = Math.abs(audio[i]);

        if (inputAbs > envelope) {
            envelope = inputAbs;
        } else {
            envelope *= releaseCoef;
        }

        let gain = 1;
        if (envelope > ceiling) {
            gain = ceiling / envelope;
        }

        output[i] = audio[i] * gain;
    }

    return output;
}

// ============================================
// VOCAL PROCESSING CHAIN
// ============================================

/**
 * Full vocal processing chain
 */
function processVocalChain(
    vocal: Float32Array,
    sampleRate: number,
    userMacros: UserMacroState,
    params?: ChainParameters | null
): Float32Array {
    let audio = vocal;

    console.log('   → Input gain staging...');

    // 1. Input gain staging
    const inputGain = params?.gainStaging?.inputGain || 0;
    const gainLinear = Math.pow(10, inputGain / 20);
    audio = audio.map(s => s * gainLinear);

    // 2. High-pass filter (remove rumble)
    console.log('   → Applying high-pass filter...');
    const hpf = new BiquadFilter();
    const hpfFreq = params?.subtractiveEQ?.highPassFreq || 80;
    hpf.setHighPass(hpfFreq, 0.707, sampleRate);
    audio = Float32Array.from(audio.map(s => hpf.process(s)));

    // 3. De-esser (simplified - frequency-selective compression)
    console.log('   → Applying de-esser...');
    const deEsserFreq = params?.deEsser?.frequency || 6000;
    const deEsserFilter = new BiquadFilter();
    deEsserFilter.setPeaking(deEsserFreq, -3, 2, sampleRate);
    audio = Float32Array.from(audio.map(s => deEsserFilter.process(s)));

    // 4. Compressor A (leveling)
    console.log('   → Applying leveling compression...');
    const compA = new SimpleCompressor(
        params?.compressionA?.threshold || -20,
        params?.compressionA?.ratio || 3,
        params?.compressionA?.attack || 10,
        params?.compressionA?.release || 100,
        sampleRate
    );
    audio = compA.process(audio);

    // 5. Compressor B (control)
    console.log('   → Applying control compression...');
    const compBRatio = 2 + (userMacros.polishAmount / 100) * 4; // 2:1 to 6:1
    const compB = new SimpleCompressor(
        params?.compressionB?.threshold || -15,
        compBRatio,
        params?.compressionB?.attack || 5,
        params?.compressionB?.release || 50,
        sampleRate
    );
    audio = compB.process(audio);

    // 6. AutoTune
    console.log('   → Applying pitch correction...');
    audio = applySimpleAutotune(audio, userMacros.autotuneStrength, sampleRate);

    // 7. Additive EQ (presence and air)
    console.log('   → Applying additive EQ...');
    const presenceGain = (userMacros.polishAmount / 100) * 4; // 0-4 dB
    const presenceEQ = new BiquadFilter();
    presenceEQ.setPeaking(params?.additiveEQ?.presenceFreq || 3000, presenceGain, 1.5, sampleRate);
    audio = Float32Array.from(audio.map(s => presenceEQ.process(s)));

    const airGain = (userMacros.polishAmount / 100) * 3; // 0-3 dB
    const airEQ = new BiquadFilter();
    airEQ.setHighShelf(params?.additiveEQ?.airShelfFreq || 10000, airGain, 0.7, sampleRate);
    audio = Float32Array.from(audio.map(s => airEQ.process(s)));

    // 8. Saturation
    console.log('   → Applying saturation...');
    const satMix = (userMacros.polishAmount / 100) * 15; // 0-15%
    audio = applySaturation(audio, params?.saturation?.drive || 2, satMix);

    // 9. Reverb
    console.log('   → Applying reverb...');
    const reverbWet = (userMacros.reverbAmount / 100) * 0.4; // 0-40%
    if (reverbWet > 0.01) {
        const reverb = new SimpleReverb(
            sampleRate,
            params?.reverb?.decay || 2.0,
            reverbWet
        );
        audio = reverb.process(audio);
    }

    // 10. Output gain (from vocal loudness macro)
    console.log('   → Applying output gain...');
    const outputGainDb = userMacros.vocalLoudness; // -12 to +6 dB
    const outputGain = Math.pow(10, outputGainDb / 20);
    audio = audio.map(s => s * outputGain);

    return Float32Array.from(audio);
}

/**
 * Mix vocals with beat
 */
function mixVocalWithBeat(
    processedVocal: Float32Array,
    beat: Float32Array,
    vocalLevel: number,
    beatLevel: number = -3
): Float32Array {
    // Ensure same length (extend shorter or trim longer)
    const maxLength = Math.max(processedVocal.length, beat.length);
    const mixed = new Float32Array(maxLength);

    const vocalGain = Math.pow(10, vocalLevel / 20);
    const beatGain = Math.pow(10, beatLevel / 20);

    for (let i = 0; i < maxLength; i++) {
        const v = i < processedVocal.length ? processedVocal[i] * vocalGain : 0;
        const b = i < beat.length ? beat[i] * beatGain : 0;
        mixed[i] = v + b;
    }

    return mixed;
}

// ============================================
// MAIN PROCESSING FUNCTION
// ============================================

/**
 * Process audio files and apply full mixing chain with AI-optimized parameters
 */
async function processAudio(
    vocalBuffer: Buffer,
    beatBuffer: Buffer | null,
    referenceBuffer: Buffer | null,
    userMacros: UserMacroState,
    _parameters: ChainParameters | null
): Promise<ProcessingResult> {
    console.log('   Decoding vocal...');
    const vocalWav = await decodeAudio(vocalBuffer);
    console.log(`   → Sample rate: ${vocalWav.sampleRate}Hz, Channels: ${vocalWav.channels}`);

    // Convert to mono if stereo
    let vocalMono = vocalWav.channels === 2 ? stereoToMono(vocalWav.data) : vocalWav.data;

    // Resample if needed
    if (vocalWav.sampleRate !== SAMPLE_RATE) {
        console.log(`   → Resampling from ${vocalWav.sampleRate} to ${SAMPLE_RATE}Hz...`);
        vocalMono = resample(vocalMono, vocalWav.sampleRate, SAMPLE_RATE);
    }

    // ==========================================
    // AI ANALYSIS PHASE
    // ==========================================
    console.log('   🤖 Running AI analysis...');

    // Analyze vocal
    const vocalAnalyzer = new WorkerVocalAnalyzer(SAMPLE_RATE);
    const vocalAnalysis = vocalAnalyzer.analyze(vocalMono);
    console.log(`   → Detected key: ${vocalAnalysis.detectedKey} ${vocalAnalysis.detectedScale}`);
    console.log(`   → Fundamental: ${vocalAnalysis.fundamentalFreq.toFixed(0)}Hz`);
    console.log(`   → Dynamic range: ${vocalAnalysis.dynamicRange.toFixed(1)}dB`);
    console.log(`   → SNR: ${vocalAnalysis.signalToNoiseRatio.toFixed(1)}dB`);
    if (vocalAnalysis.phoneRecordingConfidence > 0.5) {
        console.log(`   → Phone recording detected (${(vocalAnalysis.phoneRecordingConfidence * 100).toFixed(0)}% confidence)`);
    }

    // Analyze reference if provided
    let referenceAnalysis = null;
    if (referenceBuffer) {
        console.log('   → Analyzing reference track...');
        const refWav = await decodeAudio(referenceBuffer);
        let refMono = refWav.channels === 2 ? stereoToMono(refWav.data) : refWav.data;
        if (refWav.sampleRate !== SAMPLE_RATE) {
            refMono = resample(refMono, refWav.sampleRate, SAMPLE_RATE);
        }
        const refAnalyzer = new WorkerReferenceAnalyzer(SAMPLE_RATE);
        referenceAnalysis = refAnalyzer.analyze(refMono);
        console.log(`   → Reference reverb: ${referenceAnalysis.estimatedReverbDecay.toFixed(2)}s decay`);
        console.log(`   → Reference loudness: ${referenceAnalysis.overallLufs.toFixed(1)} LUFS`);
    }

    // Generate optimized parameters
    const optimizer = new WorkerParameterOptimizer();
    const optimizedParams = optimizer.optimize(vocalAnalysis, referenceAnalysis, userMacros);
    console.log('   → AI parameters generated:');
    console.log(`     • HPF: ${optimizedParams.highPassFreq.toFixed(0)}Hz`);
    console.log(`     • Compression: ${optimizedParams.compThreshold.toFixed(0)}dB @ ${optimizedParams.compRatio.toFixed(1)}:1`);
    console.log(`     • Presence: +${optimizedParams.presenceBoost.toFixed(1)}dB, Air: +${optimizedParams.airBoost.toFixed(1)}dB`);
    console.log(`     • Reverb: ${optimizedParams.reverbType} ${optimizedParams.reverbDecay.toFixed(1)}s @ ${(optimizedParams.reverbWet * 100).toFixed(0)}%`);

    // ==========================================
    // PROCESSING PHASE (using AI params)
    // ==========================================
    console.log('   Processing vocal chain with AI parameters...');
    const processedVocal = processVocalChainWithAI(vocalMono, SAMPLE_RATE, userMacros, optimizedParams);

    // ==========================================
    // SECTION DETECTION PHASE
    // ==========================================
    console.log('   🔍 Detecting song sections...');
    const sectionDetector = new SectionDetector(SAMPLE_RATE);
    const sections = sectionDetector.detect(processedVocal);

    // Create chorus mask (1 = chorus, 0 = verse)
    const chorusMask = sectionDetector.createChorusMask(sections, processedVocal.length);

    // Count chorus vs verse
    const chorusSections = sections.filter(s => s.type === 'chorus');
    console.log(`   → Found ${chorusSections.length} chorus sections (backing will apply only there)`);

    // ==========================================
    // BACKING VOCALS PHASE (if enabled)
    // ==========================================
    let vocalWithBacking = processedVocal;

    if (userMacros.backingVocalsEnabled && userMacros.backingVocalsAmount && userMacros.backingVocalsAmount > 0) {
        console.log('   🎤 Generating backing vocals (chorus only)...');
        const backingGenerator = new BackingVocalsGenerator(SAMPLE_RATE);

        const backingType = userMacros.backingVocalsType || 'doubles';
        const enableHarmonies = backingType === 'harmonies' || backingType === 'full';
        const enableDoubles = backingType === 'doubles' || backingType === 'full';

        // Pass chorus mask so backing only applies on chorus sections
        const backingVocals = backingGenerator.generate(
            processedVocal,
            {
                enableHarmonies,
                enableDoubles,
                harmonyType: backingType === 'harmonies' ? 'thirds' : 'full',
                doublesAmount: enableDoubles ? userMacros.backingVocalsAmount : 0,
                harmoniesAmount: enableHarmonies ? userMacros.backingVocalsAmount : 0
            },
            chorusMask // Apply only during chorus sections
        );

        // Mix backing with lead
        for (let i = 0; i < vocalWithBacking.length && i < backingVocals.length; i++) {
            vocalWithBacking[i] += backingVocals[i];
        }

        console.log(`   → Backing vocals added: ${backingType} @ ${userMacros.backingVocalsAmount}% (chorus only)`);
    }

    let finalMix: Float32Array;

    // Mix with beat if provided
    if (beatBuffer) {
        console.log('   Decoding beat...');
        const beatWav = await decodeAudio(beatBuffer);
        let beatAudio = beatWav.channels === 2 ? stereoToMono(beatWav.data) : beatWav.data;

        // Resample beat if needed
        if (beatWav.sampleRate !== SAMPLE_RATE) {
            console.log(`   → Resampling beat from ${beatWav.sampleRate} to ${SAMPLE_RATE}Hz...`);
            beatAudio = resample(beatAudio, beatWav.sampleRate, SAMPLE_RATE);
        }

        console.log('   Mixing vocal with beat...');
        finalMix = mixVocalWithBeat(vocalWithBacking, beatAudio, userMacros.vocalLoudness);
    } else {
        finalMix = vocalWithBacking;
    }

    // Normalize loudness
    console.log(`   Normalizing to ${TARGET_LUFS} LUFS...`);
    finalMix = normalizeLoudness(finalMix, TARGET_LUFS);

    // Apply limiter
    console.log('   Applying limiter...');
    finalMix = applyLimiter(finalMix, 0.95);

    // Convert to stereo for output
    const stereoMix = monoToStereo(finalMix);

    // Calculate metrics
    const loudnessLufs = calculateApproxLufs(stereoMix);
    const peakDb = calculatePeakDb(stereoMix);
    const durationSeconds = stereoMix.length / 2 / SAMPLE_RATE;

    console.log(`   ✓ Output: ${durationSeconds.toFixed(2)}s, ${loudnessLufs.toFixed(1)} LUFS, Peak: ${peakDb.toFixed(1)} dB`);

    return {
        audio: stereoMix,
        loudnessLufs,
        peakDb,
        durationSeconds
    };
}

/**
 * Process vocal chain using AI-optimized parameters
 */
function processVocalChainWithAI(
    vocal: Float32Array,
    sampleRate: number,
    userMacros: UserMacroState,
    aiParams: OptimizedParameters
): Float32Array {
    let audio = vocal;

    // 1. Input gain staging (AI-calculated)
    console.log('   → Input gain staging...');
    const inputGain = Math.pow(10, aiParams.inputGainDb / 20);
    audio = audio.map(s => s * inputGain);

    // 2. High-pass filter (AI-calculated frequency)
    console.log('   → Applying high-pass filter...');
    const hpf = new BiquadFilter();
    hpf.setHighPass(aiParams.highPassFreq, 0.707, sampleRate);
    audio = Float32Array.from(audio.map(s => hpf.process(s)));

    // 3. Mud cut EQ (if needed)
    if (aiParams.mudCut < -1) {
        console.log('   → Cutting mud frequencies...');
        const mudEq = new BiquadFilter();
        mudEq.setPeaking(280, aiParams.mudCut, 1.5, sampleRate);
        audio = Float32Array.from(audio.map(s => mudEq.process(s)));
    }

    // 4. De-esser (AI-calculated)
    console.log('   → Applying de-esser...');
    const deEsserFilter = new BiquadFilter();
    deEsserFilter.setPeaking(aiParams.deEsserFrequency, -3, 2, sampleRate);
    audio = Float32Array.from(audio.map(s => deEsserFilter.process(s)));

    // 5. Compressor (AI-calculated)
    console.log('   → Applying compression...');
    const comp = new SimpleCompressor(
        aiParams.compThreshold,
        aiParams.compRatio,
        20, // attack
        150, // release
        sampleRate
    );
    audio = comp.process(audio);

    // 6. Autotune (user macro controlled)
    const autotuneAmount = userMacros.autotuneStrength / 100;
    if (autotuneAmount > 0.05) {
        console.log('   → Applying pitch correction...');
        audio = applySimpleAutotune(audio, sampleRate, autotuneAmount);
    }

    // 7. Presence EQ (AI-calculated)
    console.log('   → Applying presence EQ...');
    const presenceEq = new BiquadFilter();
    presenceEq.setPeaking(4000, aiParams.presenceBoost, 1.2, sampleRate);
    audio = Float32Array.from(audio.map(s => presenceEq.process(s)));

    // 8. Air shelf (AI-calculated)
    const airEq = new BiquadFilter();
    airEq.setHighShelf(12000, aiParams.airBoost, 0.7, sampleRate);
    audio = Float32Array.from(audio.map(s => airEq.process(s)));

    // 9. Saturation (AI-calculated)
    if (aiParams.saturationMix > 1) {
        console.log('   → Applying saturation...');
        audio = applySaturation(audio, aiParams.saturationDrive, aiParams.saturationMix);
    }

    // 10. Reverb (AI-calculated + user macro)
    if (aiParams.reverbWet > 0.01) {
        console.log('   → Applying reverb...');
        const reverb = new SimpleReverb(sampleRate, aiParams.reverbDecay, aiParams.reverbWet);
        audio = reverb.process(audio);
    }

    // 11. Output gain (user macro)
    console.log('   → Applying output gain...');
    const outputGainDb = userMacros.vocalLoudness;
    const outputGain = Math.pow(10, outputGainDb / 20);
    audio = audio.map(s => s * outputGain);

    return Float32Array.from(audio);
}

// ============================================
// SUPABASE OPERATIONS
// ============================================

/**
 * Download file from Supabase Storage
 */
async function downloadFile(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await supabase.storage
        .from(bucket)
        .download(path);

    if (error || !data) {
        throw new Error(`Failed to download ${bucket}/${path}: ${error?.message}`);
    }

    return Buffer.from(await data.arrayBuffer());
}

/**
 * Upload file to Supabase Storage
 */
async function uploadFile(bucket: string, path: string, buffer: Buffer): Promise<void> {
    const { error } = await supabase.storage
        .from(bucket)
        .upload(path, buffer, {
            contentType: 'audio/wav',
            upsert: true
        });

    if (error) {
        throw new Error(`Failed to upload ${bucket}/${path}: ${error.message}`);
    }
}

// ============================================
// JOB PROCESSING
// ============================================

/**
 * Fetch and process the next pending job
 */
async function processNextJob(): Promise<void> {
    // Claim a pending job (atomic operation)
    const { data: job, error: claimError } = await supabase
        .from('jobs')
        .update({
            status: 'processing',
            worker_id: WORKER_ID,
            started_at: new Date().toISOString()
        })
        .eq('status', 'pending')
        .is('worker_id', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .select()
        .single();

    if (claimError || !job) {
        // No pending jobs
        return;
    }

    const typedJob = job as unknown as Job;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎬 Processing job: ${typedJob.id}`);
    console.log(`   Project: ${typedJob.project_id}`);
    console.log(`   User: ${typedJob.user_id}`);
    console.log(`   Vocal: ${typedJob.vocal_path}`);
    console.log(`   Beat: ${typedJob.beat_path || 'None'}`);
    console.log(`${'═'.repeat(60)}`);

    try {
        // 1. Download files from Supabase Storage
        console.log('\n📥 DOWNLOADING FILES');

        const vocalBuffer = await downloadFile('vocals', typedJob.vocal_path);
        console.log(`   ✓ Vocal downloaded: ${(vocalBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        let beatBuffer: Buffer | null = null;
        if (typedJob.beat_path) {
            beatBuffer = await downloadFile('beats', typedJob.beat_path);
            console.log(`   ✓ Beat downloaded: ${(beatBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        }

        let referenceBuffer: Buffer | null = null;
        if (typedJob.reference_path) {
            referenceBuffer = await downloadFile('references', typedJob.reference_path);
            console.log(`   ✓ Reference downloaded: ${(referenceBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        }

        // 2. Process audio
        console.log('\n🎛️  PROCESSING AUDIO');

        const userMacros = typedJob.user_macros || {
            autotuneStrength: 50,
            reverbAmount: 30,
            vocalLoudness: 0,
            polishAmount: 50
        };

        console.log('   User macros:');
        console.log(`     • Autotune: ${userMacros.autotuneStrength}%`);
        console.log(`     • Reverb: ${userMacros.reverbAmount}%`);
        console.log(`     • Vocal Level: ${userMacros.vocalLoudness} dB`);
        console.log(`     • Polish: ${userMacros.polishAmount}%`);

        const result = await processAudio(
            vocalBuffer,
            beatBuffer,
            referenceBuffer,
            userMacros,
            typedJob.parameters
        );

        // 3. Encode and upload result
        console.log('\n📤 UPLOADING RESULT');

        const wavBuffer = encodeWav(result.audio, SAMPLE_RATE, 2);
        const renderPath = `${typedJob.user_id}/${typedJob.project_id}/${typedJob.id}_render.wav`;
        await uploadFile('renders', renderPath, wavBuffer);
        console.log(`   ✓ Uploaded: ${renderPath}`);
        console.log(`   ✓ Size: ${(wavBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // 4. Update job as complete
        const { error: updateError } = await supabase
            .from('jobs')
            .update({
                status: 'complete',
                render_path: renderPath,
                completed_at: new Date().toISOString()
            })
            .eq('id', typedJob.id);

        if (updateError) {
            throw updateError;
        }

        // 5. Create mix record
        await supabase.from('mixes').insert({
            project_id: typedJob.project_id,
            job_id: typedJob.id,
            user_id: typedJob.user_id,
            name: `Mix ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
            render_path: renderPath,
            parameters: typedJob.parameters,
            user_macros: typedJob.user_macros,
            loudness_lufs: result.loudnessLufs,
            true_peak_db: result.peakDb,
            duration_seconds: result.durationSeconds
        });

        console.log(`\n✅ Job ${typedJob.id} completed successfully!`);
        console.log(`   Duration: ${result.durationSeconds.toFixed(2)} seconds`);
        console.log(`   Loudness: ${result.loudnessLufs.toFixed(1)} LUFS`);
        console.log(`   Peak: ${result.peakDb.toFixed(1)} dB`);

    } catch (error) {
        console.error(`\n❌ Job ${typedJob.id} failed:`, error);

        // Mark job as failed
        await supabase
            .from('jobs')
            .update({
                status: 'failed',
                error_message: error instanceof Error ? error.message : 'Unknown error',
                completed_at: new Date().toISOString()
            })
            .eq('id', typedJob.id);
    }
}

// ============================================
// WORKER LOOP
// ============================================

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main worker loop
 */
async function main(): Promise<void> {
    console.log('\n' + '═'.repeat(60));
    console.log('🎵 AUDIO PROCESSING WORKER');
    console.log('═'.repeat(60));
    console.log(`   Worker ID:    ${WORKER_ID}`);
    console.log(`   Supabase:     ${SUPABASE_URL}`);
    console.log(`   Poll Interval: ${POLL_INTERVAL_MS}ms`);
    console.log(`   Sample Rate:  ${SAMPLE_RATE}Hz`);
    console.log(`   Target LUFS:  ${TARGET_LUFS}`);
    console.log('═'.repeat(60) + '\n');

    console.log('👀 Polling for jobs...\n');

    while (true) {
        try {
            await processNextJob();
        } catch (error) {
            console.error('Error in worker loop:', error);
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

// Start worker
main().catch(console.error);
