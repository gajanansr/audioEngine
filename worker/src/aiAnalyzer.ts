/**
 * AI Analysis Module for Worker
 * 
 * Node.js-compatible versions of VocalAnalyzer and ReferenceAnalyzer
 * that work with Float32Array directly instead of Web Audio API
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface VocalAnalysis {
    // Pitch
    fundamentalFreq: number;
    detectedKey: string;
    detectedScale: 'major' | 'minor';
    avgPitchDeviation: number; // cents

    // Dynamics
    rmsLevel: number; // dBFS
    peakLevel: number; // dBFS
    dynamicRange: number; // dB

    // Spectral
    sibilanceLevel: number; // dB in 5-8kHz
    mudLevel: number; // dB in 200-350Hz
    brightnessLevel: number; // dB in 8-16kHz

    // Quality
    signalToNoiseRatio: number;
    needsNoiseReduction: boolean;
    phoneRecordingConfidence: number; // 0-1
}

export interface ReferenceAnalysis {
    // Tonal curve for EQ matching
    spectralCurve: Float32Array;

    // Reverb characteristics
    estimatedReverbDecay: number; // seconds
    estimatedReverbWet: number; // 0-1

    // Loudness
    overallLufs: number;
    vocalBandEnergy: number; // dB in 200-4000Hz
}

export interface OptimizedParameters {
    // Gain staging
    inputGainDb: number;

    // HPF
    highPassFreq: number;

    // De-esser
    deEsserThreshold: number;
    deEsserFrequency: number;

    // Compression
    compThreshold: number;
    compRatio: number;

    // EQ
    mudCut: number; // negative dB
    presenceBoost: number; // dB at 4kHz
    airBoost: number; // dB at 12kHz

    // Saturation
    saturationDrive: number;
    saturationMix: number;

    // Reverb
    reverbDecay: number;
    reverbWet: number;
    reverbType: 'plate' | 'room' | 'hall';
}

// ============================================
// VOCAL ANALYZER
// ============================================

export class WorkerVocalAnalyzer {
    private sampleRate: number;

    constructor(sampleRate: number = 44100) {
        this.sampleRate = sampleRate;
    }

    analyze(audio: Float32Array): VocalAnalysis {
        const dynamics = this.analyzeDynamics(audio);
        const spectral = this.analyzeSpectrum(audio);
        const pitch = this.analyzePitch(audio);
        const quality = this.analyzeQuality(audio, dynamics, spectral);

        return {
            ...pitch,
            ...dynamics,
            ...spectral,
            ...quality
        };
    }

    private analyzeDynamics(audio: Float32Array): Pick<VocalAnalysis, 'rmsLevel' | 'peakLevel' | 'dynamicRange'> {
        let sumSquares = 0;
        let peak = 0;

        for (let i = 0; i < audio.length; i++) {
            const sample = Math.abs(audio[i]);
            sumSquares += sample * sample;
            if (sample > peak) peak = sample;
        }

        const rms = Math.sqrt(sumSquares / audio.length);
        const rmsLevel = 20 * Math.log10(rms + 1e-10);
        const peakLevel = 20 * Math.log10(peak + 1e-10);

        // Calculate dynamic range from short-term RMS
        const frameSize = Math.floor(this.sampleRate * 0.05);
        const shortTermRms: number[] = [];

        for (let i = 0; i < audio.length - frameSize; i += frameSize) {
            let frameSum = 0;
            for (let j = 0; j < frameSize; j++) {
                frameSum += audio[i + j] * audio[i + j];
            }
            const frameRms = Math.sqrt(frameSum / frameSize);
            if (frameRms > 0.001) {
                shortTermRms.push(20 * Math.log10(frameRms));
            }
        }

        shortTermRms.sort((a, b) => a - b);
        const p10 = shortTermRms[Math.floor(shortTermRms.length * 0.1)] || rmsLevel;
        const p90 = shortTermRms[Math.floor(shortTermRms.length * 0.9)] || rmsLevel;
        const dynamicRange = p90 - p10;

        return { rmsLevel, peakLevel, dynamicRange };
    }

    private analyzeSpectrum(audio: Float32Array): Pick<VocalAnalysis, 'sibilanceLevel' | 'mudLevel' | 'brightnessLevel'> {
        // Compute average spectrum using simplified DFT on chunks
        const fftSize = 2048;
        const numBins = fftSize / 2;
        const avgSpectrum = new Float32Array(numBins);

        const hopSize = fftSize / 2;
        const numFrames = Math.floor((audio.length - fftSize) / hopSize);

        if (numFrames <= 0) {
            return { sibilanceLevel: -40, mudLevel: -30, brightnessLevel: -50 };
        }

        for (let frame = 0; frame < Math.min(numFrames, 20); frame++) { // Limit frames for speed
            const start = frame * hopSize;
            const spectrum = this.computeSpectrum(audio.slice(start, start + fftSize));
            for (let i = 0; i < numBins; i++) {
                avgSpectrum[i] += spectrum[i];
            }
        }

        // Normalize
        const framesProcessed = Math.min(numFrames, 20);
        for (let i = 0; i < numBins; i++) {
            avgSpectrum[i] = 20 * Math.log10(avgSpectrum[i] / framesProcessed + 1e-10);
        }

        // Analyze frequency bands
        const binSize = this.sampleRate / fftSize;
        const sibilanceLevel = this.getBandEnergy(avgSpectrum, 5000, 8000, binSize);
        const mudLevel = this.getBandEnergy(avgSpectrum, 200, 350, binSize);
        const brightnessLevel = this.getBandEnergy(avgSpectrum, 8000, 16000, binSize);

        return { sibilanceLevel, mudLevel, brightnessLevel };
    }

    private computeSpectrum(frame: Float32Array): Float32Array {
        const n = frame.length;
        const numBins = n / 2;
        const magnitude = new Float32Array(numBins);

        // Apply Hann window
        const windowed = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            windowed[i] = frame[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
        }

        // Sparse DFT for speed (sample every 4th bin, interpolate)
        for (let k = 0; k < numBins; k += 4) {
            let real = 0, imag = 0;
            for (let t = 0; t < n; t += 2) {
                const angle = -2 * Math.PI * k * t / n;
                real += windowed[t] * Math.cos(angle);
                imag += windowed[t] * Math.sin(angle);
            }
            magnitude[k] = Math.sqrt(real * real + imag * imag) / (n / 2);

            // Fill adjacent bins
            for (let j = 1; j < 4 && k + j < numBins; j++) {
                magnitude[k + j] = magnitude[k];
            }
        }

        return magnitude;
    }

    private getBandEnergy(spectrum: Float32Array, lowFreq: number, highFreq: number, binSize: number): number {
        const lowBin = Math.floor(lowFreq / binSize);
        const highBin = Math.ceil(highFreq / binSize);

        let sum = 0;
        let count = 0;
        for (let i = lowBin; i <= highBin && i < spectrum.length; i++) {
            sum += spectrum[i];
            count++;
        }

        return count > 0 ? sum / count : -60;
    }

    private analyzePitch(audio: Float32Array): Pick<VocalAnalysis, 'fundamentalFreq' | 'detectedKey' | 'detectedScale' | 'avgPitchDeviation'> {
        // Simplified pitch detection using autocorrelation
        const frameSize = 2048;
        const hopSize = 512;
        const pitches: number[] = [];

        for (let start = 0; start < audio.length - frameSize; start += hopSize) {
            const freq = this.detectPitchYIN(audio.slice(start, start + frameSize));
            if (freq > 60 && freq < 1000) {
                pitches.push(freq);
            }
        }

        if (pitches.length === 0) {
            return { fundamentalFreq: 200, detectedKey: 'C', detectedScale: 'major', avgPitchDeviation: 30 };
        }

        // Calculate median fundamental
        pitches.sort((a, b) => a - b);
        const fundamentalFreq = pitches[Math.floor(pitches.length / 2)];

        // Build pitch class histogram for key detection
        const pitchClasses = new Float32Array(12);
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        for (const freq of pitches) {
            const midiNote = 12 * Math.log2(freq / 440) + 69;
            const pitchClass = Math.round(midiNote) % 12;
            if (pitchClass >= 0 && pitchClass < 12) {
                pitchClasses[pitchClass]++;
            }
        }

        // Find most common pitch class
        let maxIdx = 0;
        for (let i = 1; i < 12; i++) {
            if (pitchClasses[i] > pitchClasses[maxIdx]) maxIdx = i;
        }

        // Calculate average deviation from quantized notes (in cents)
        let totalDeviation = 0;
        for (const freq of pitches) {
            const midiNote = 12 * Math.log2(freq / 440) + 69;
            const deviation = Math.abs((midiNote % 1) - 0.5) * 200;
            totalDeviation += deviation;
        }
        const avgPitchDeviation = totalDeviation / pitches.length;

        return {
            fundamentalFreq,
            detectedKey: noteNames[maxIdx],
            detectedScale: 'major', // Simplified
            avgPitchDeviation
        };
    }

    private detectPitchYIN(frame: Float32Array): number {
        const threshold = 0.15;
        const minPeriod = Math.floor(this.sampleRate / 500);
        const maxPeriod = Math.floor(this.sampleRate / 60);

        // CMNDF
        const cmndf = new Float32Array(maxPeriod);
        let runningSum = 0;

        for (let tau = 1; tau < maxPeriod; tau++) {
            let diff = 0;
            for (let i = 0; i < frame.length - tau; i++) {
                const delta = frame[i] - frame[i + tau];
                diff += delta * delta;
            }
            runningSum += diff;
            cmndf[tau] = diff / (runningSum / tau);
        }

        // Find first minimum below threshold
        for (let tau = minPeriod; tau < maxPeriod - 1; tau++) {
            if (cmndf[tau] < threshold && cmndf[tau] < cmndf[tau - 1] && cmndf[tau] <= cmndf[tau + 1]) {
                return this.sampleRate / tau;
            }
        }

        return 0;
    }

    private analyzeQuality(audio: Float32Array, dynamics: any, spectral: any): Pick<VocalAnalysis, 'signalToNoiseRatio' | 'needsNoiseReduction' | 'phoneRecordingConfidence'> {
        // Estimate noise floor from quietest frames
        const frameSize = Math.floor(this.sampleRate * 0.02);
        const frameRms: number[] = [];

        for (let i = 0; i < audio.length - frameSize; i += frameSize) {
            let sum = 0;
            for (let j = 0; j < frameSize; j++) {
                sum += audio[i + j] * audio[i + j];
            }
            frameRms.push(Math.sqrt(sum / frameSize));
        }

        frameRms.sort((a, b) => a - b);
        const noiseFloor = 20 * Math.log10(frameRms[Math.floor(frameRms.length * 0.1)] + 1e-10);
        const signalToNoiseRatio = dynamics.peakLevel - noiseFloor;

        const needsNoiseReduction = signalToNoiseRatio < 30;

        // Phone recording detection
        let phoneConfidence = 0;
        if (signalToNoiseRatio < 25) phoneConfidence += 0.4;
        if (spectral.brightnessLevel < -50) phoneConfidence += 0.3; // High freq roll-off
        if (spectral.mudLevel > -20) phoneConfidence += 0.3; // Too much mud

        return {
            signalToNoiseRatio,
            needsNoiseReduction,
            phoneRecordingConfidence: Math.min(1, phoneConfidence)
        };
    }
}

// ============================================
// REFERENCE ANALYZER
// ============================================

export class WorkerReferenceAnalyzer {
    private sampleRate: number;

    constructor(sampleRate: number = 44100) {
        this.sampleRate = sampleRate;
    }

    analyze(audio: Float32Array): ReferenceAnalysis {
        const spectralCurve = this.extractSpectralCurve(audio);
        const reverb = this.analyzeReverb(audio);
        const loudness = this.analyzeLoudness(audio);

        return {
            spectralCurve,
            ...reverb,
            ...loudness
        };
    }

    private extractSpectralCurve(audio: Float32Array): Float32Array {
        const fftSize = 4096;
        const numBins = fftSize / 2;
        const avgSpectrum = new Float32Array(numBins);

        const hopSize = fftSize / 2;
        const numFrames = Math.max(1, Math.floor((audio.length - fftSize) / hopSize));

        for (let frame = 0; frame < Math.min(numFrames, 30); frame++) {
            const start = frame * hopSize;
            const spectrum = this.computeSpectrum(audio.slice(start, start + fftSize));
            for (let i = 0; i < numBins; i++) {
                avgSpectrum[i] += spectrum[i];
            }
        }

        const framesProcessed = Math.min(numFrames, 30);
        for (let i = 0; i < numBins; i++) {
            avgSpectrum[i] = 20 * Math.log10(avgSpectrum[i] / framesProcessed + 1e-10);
        }

        return avgSpectrum;
    }

    private computeSpectrum(frame: Float32Array): Float32Array {
        const n = frame.length;
        const numBins = n / 2;
        const magnitude = new Float32Array(numBins);

        for (let k = 0; k < numBins; k += 8) {
            let real = 0, imag = 0;
            for (let t = 0; t < n; t += 4) {
                const angle = -2 * Math.PI * k * t / n;
                real += frame[t] * Math.cos(angle);
                imag += frame[t] * Math.sin(angle);
            }
            magnitude[k] = Math.sqrt(real * real + imag * imag) / (n / 4);
            for (let j = 1; j < 8 && k + j < numBins; j++) {
                magnitude[k + j] = magnitude[k];
            }
        }

        return magnitude;
    }

    private analyzeReverb(audio: Float32Array): Pick<ReferenceAnalysis, 'estimatedReverbDecay' | 'estimatedReverbWet'> {
        // Estimate reverb from transient decay
        const frameSize = Math.floor(this.sampleRate * 0.02);
        const frameEnergies: number[] = [];

        for (let i = 0; i < audio.length - frameSize; i += frameSize) {
            let energy = 0;
            for (let j = 0; j < frameSize; j++) {
                energy += audio[i + j] * audio[i + j];
            }
            frameEnergies.push(Math.sqrt(energy / frameSize));
        }

        const decayTimes: number[] = [];
        const threshold = Math.max(...frameEnergies) * 0.1;

        for (let i = 1; i < frameEnergies.length - 20; i++) {
            if (frameEnergies[i] > frameEnergies[i - 1] * 2 && frameEnergies[i] > threshold) {
                const startEnergy = frameEnergies[i];
                const targetEnergy = startEnergy * 0.1;

                for (let j = i + 1; j < Math.min(i + 50, frameEnergies.length); j++) {
                    if (frameEnergies[j] < targetEnergy) {
                        decayTimes.push((j - i) * frameSize / this.sampleRate * 3);
                        break;
                    }
                }
            }
        }

        let estimatedReverbDecay = 1.8;
        if (decayTimes.length > 0) {
            decayTimes.sort((a, b) => a - b);
            estimatedReverbDecay = decayTimes[Math.floor(decayTimes.length / 2)];
        }

        // Estimate wet level from sustained energy ratio
        let transientEnergy = 0;
        let sustainedEnergy = 0;
        for (let i = 0; i < frameEnergies.length - 1; i++) {
            if (frameEnergies[i] > frameEnergies[i + 1] * 1.5) {
                transientEnergy += frameEnergies[i];
            } else {
                sustainedEnergy += frameEnergies[i];
            }
        }
        const ratio = sustainedEnergy / (transientEnergy + sustainedEnergy + 1e-10);
        const estimatedReverbWet = Math.min(0.4, Math.max(0.05, ratio * 0.5));

        return { estimatedReverbDecay, estimatedReverbWet };
    }

    private analyzeLoudness(audio: Float32Array): Pick<ReferenceAnalysis, 'overallLufs' | 'vocalBandEnergy'> {
        let sumSquares = 0;
        for (let i = 0; i < audio.length; i++) {
            sumSquares += audio[i] * audio[i];
        }
        const rms = Math.sqrt(sumSquares / audio.length);
        const overallLufs = 20 * Math.log10(rms + 1e-10) - 0.691;

        // Calculate vocal band energy (200-4000Hz)
        const fftSize = 2048;
        const spectrum = this.computeSpectrum(audio.slice(0, Math.min(audio.length, fftSize)));
        const binSize = this.sampleRate / fftSize;

        const lowBin = Math.floor(200 / binSize);
        const highBin = Math.ceil(4000 / binSize);

        let sum = 0;
        let count = 0;
        for (let i = lowBin; i <= highBin && i < spectrum.length; i++) {
            sum += spectrum[i];
            count++;
        }
        const vocalBandEnergy = count > 0 ? 20 * Math.log10(sum / count + 1e-10) : -30;

        return { overallLufs, vocalBandEnergy };
    }
}

// ============================================
// PARAMETER OPTIMIZER
// ============================================

export class WorkerParameterOptimizer {
    /**
     * Generate optimized parameters based on vocal and reference analysis
     */
    optimize(
        vocalAnalysis: VocalAnalysis,
        referenceAnalysis: ReferenceAnalysis | null,
        userMacros: { autotuneStrength: number; reverbAmount: number; vocalLoudness: number; polishAmount: number }
    ): OptimizedParameters {
        const vocal = vocalAnalysis;
        const ref = referenceAnalysis;

        // Gain staging - target -18 dBFS RMS
        const targetRms = -18;
        let inputGainDb = targetRms - vocal.rmsLevel;
        if (vocal.peakLevel + inputGainDb > -6) {
            inputGainDb = -6 - vocal.peakLevel;
        }

        // HPF - adaptive based on fundamental
        const highPassFreq = Math.max(60, Math.min(150, vocal.fundamentalFreq * 0.7));

        // De-esser - based on sibilance level
        let deEsserThreshold = -20;
        let deEsserFrequency = 6000 + vocal.fundamentalFreq * 5;
        if (vocal.sibilanceLevel > -6) {
            deEsserThreshold = -25; // More aggressive
        } else if (vocal.sibilanceLevel < -15) {
            deEsserThreshold = -15; // Less aggressive
        }

        // Compression - based on dynamic range
        let compThreshold = -18;
        let compRatio = 2.5;
        if (vocal.dynamicRange > 20) {
            compThreshold = -20;
            compRatio = 3;
        } else if (vocal.dynamicRange < 10) {
            compThreshold = -15;
            compRatio = 2;
        }

        // EQ - subtractive and additive
        let mudCut = 0;
        if (vocal.mudLevel > -20) {
            mudCut = Math.min(-3, -(vocal.mudLevel + 20) * 0.3);
        }

        // Polish amount influences presence/air boost
        const polishFactor = userMacros.polishAmount / 100;
        let presenceBoost = 2 * polishFactor;
        let airBoost = 1.5 * polishFactor;

        // Match reference EQ if available
        if (ref) {
            const refBinSize = 44100 / (ref.spectralCurve.length * 2);
            const presenceBin = Math.floor(4000 / refBinSize);
            const airBin = Math.floor(12000 / refBinSize);

            const refPresence = ref.spectralCurve[presenceBin] || -30;
            const refAir = ref.spectralCurve[airBin] || -40;

            // Blend toward reference
            presenceBoost = Math.max(-2, Math.min(4, presenceBoost + (refPresence + 30) * 0.1));
            airBoost = Math.max(-1, Math.min(3, airBoost + (refAir + 40) * 0.05));
        }

        // Saturation - phone recordings need more warmth
        let saturationDrive = 5;
        let saturationMix = 8;
        if (vocal.phoneRecordingConfidence > 0.7) {
            saturationDrive = 10;
            saturationMix = 15;
        }
        saturationMix *= polishFactor;

        // Reverb - blend user macro with reference
        const userReverbWet = (userMacros.reverbAmount / 100) * 0.4;
        let reverbDecay = 1.8;
        let reverbWet = userReverbWet;

        if (ref) {
            reverbDecay = ref.estimatedReverbDecay * 0.5 + reverbDecay * 0.5;
            reverbWet = ref.estimatedReverbWet * 0.3 + userReverbWet * 0.7;
        }

        // Determine reverb type
        let reverbType: 'plate' | 'room' | 'hall' = 'plate';
        if (reverbDecay > 2.5) reverbType = 'hall';
        else if (reverbDecay > 1.5) reverbType = 'room';

        return {
            inputGainDb,
            highPassFreq,
            deEsserThreshold,
            deEsserFrequency,
            compThreshold,
            compRatio,
            mudCut,
            presenceBoost,
            airBoost,
            saturationDrive,
            saturationMix,
            reverbDecay,
            reverbWet,
            reverbType
        };
    }
}

// Export singleton instances
export const workerVocalAnalyzer = new WorkerVocalAnalyzer();
export const workerReferenceAnalyzer = new WorkerReferenceAnalyzer();
export const workerParameterOptimizer = new WorkerParameterOptimizer();
