import { VocalAnalysis, PitchContour, MusicalKey, Scale } from '../core/types';

/**
 * Vocal Analyzer
 * Analyzes uploaded vocal files to extract characteristics for AI processing
 */
export class VocalAnalyzer {
    private sampleRate: number = 44100;

    /**
     * Perform complete analysis of a vocal audio buffer
     */
    async analyze(audioBuffer: AudioBuffer): Promise<VocalAnalysis> {
        this.sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0); // Mono or left channel

        // Run all analyses
        const [
            pitchAnalysis,
            spectralProfile,
            dynamicAnalysis,
            noiseAnalysis
        ] = await Promise.all([
            this.analyzePitch(channelData),
            this.analyzeSpectrum(channelData),
            this.analyzeDynamics(channelData),
            this.analyzeNoise(channelData)
        ]);

        return {
            // Pitch & Timing
            pitchData: pitchAnalysis.contour,
            detectedKey: pitchAnalysis.key,
            detectedScale: pitchAnalysis.scale,
            timingDeviations: [], // Requires beat analysis from instrumental

            // Spectral
            spectralProfile,
            fundamentalFreq: pitchAnalysis.fundamentalFreq,
            noiseFloor: noiseAnalysis.noiseFloor,
            roomReverbTime: noiseAnalysis.reverbTime,

            // Dynamic
            rmsLevel: dynamicAnalysis.rms,
            peakLevel: dynamicAnalysis.peak,
            dynamicRange: dynamicAnalysis.dynamicRange,
            sibilanceLevel: this.analyzeSibilance(spectralProfile),

            // Quality Metrics
            signalToNoiseRatio: noiseAnalysis.snr,
            phoneRecordingConfidence: this.detectPhoneRecording(spectralProfile, noiseAnalysis)
        };
    }

    // =========================================
    // PITCH ANALYSIS
    // =========================================

    private async analyzePitch(data: Float32Array): Promise<{
        contour: PitchContour;
        key: MusicalKey;
        scale: Scale;
        fundamentalFreq: number;
    }> {
        const frameSize = 2048;
        const hopSize = 512;
        const numFrames = Math.floor((data.length - frameSize) / hopSize);

        const times = new Float32Array(numFrames);
        const frequencies = new Float32Array(numFrames);
        const confidences = new Float32Array(numFrames);

        // Pitch detection using autocorrelation (YIN-style simplified)
        for (let frame = 0; frame < numFrames; frame++) {
            const start = frame * hopSize;
            const frameData = data.slice(start, start + frameSize);

            times[frame] = start / this.sampleRate;
            const result = this.detectPitchYIN(frameData);
            frequencies[frame] = result.frequency;
            confidences[frame] = result.confidence;
        }

        // Analyze pitch histogram to detect key
        const { key, scale } = this.detectKeyAndScale(frequencies, confidences);

        // Calculate fundamental frequency (median of voiced frames)
        const voicedFreqs = frequencies.filter((f, i) => f > 0 && confidences[i] > 0.5);
        voicedFreqs.sort((a, b) => a - b);
        const fundamentalFreq = voicedFreqs.length > 0
            ? voicedFreqs[Math.floor(voicedFreqs.length / 2)]
            : 150;

        return {
            contour: { times, frequencies, confidences },
            key,
            scale,
            fundamentalFreq
        };
    }

    private detectPitchYIN(frame: Float32Array): { frequency: number; confidence: number } {
        // Simplified YIN algorithm
        const threshold = 0.1;
        const minPeriod = Math.floor(this.sampleRate / 500); // 500 Hz max
        const maxPeriod = Math.floor(this.sampleRate / 60);  // 60 Hz min

        // Calculate cumulative mean normalized difference
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
        let bestTau = -1;
        for (let tau = minPeriod; tau < maxPeriod - 1; tau++) {
            if (cmndf[tau] < threshold) {
                // Check for local minimum
                if (cmndf[tau] < cmndf[tau - 1] && cmndf[tau] <= cmndf[tau + 1]) {
                    bestTau = tau;
                    break;
                }
            }
        }

        if (bestTau === -1) {
            return { frequency: 0, confidence: 0 };
        }

        // Parabolic interpolation for sub-sample accuracy
        const alpha = cmndf[bestTau - 1];
        const beta = cmndf[bestTau];
        const gamma = cmndf[bestTau + 1];
        const peak = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);

        const refinedTau = bestTau + peak;
        const frequency = this.sampleRate / refinedTau;
        const confidence = 1 - cmndf[bestTau];

        return { frequency, confidence: Math.max(0, Math.min(1, confidence)) };
    }

    private detectKeyAndScale(
        frequencies: Float32Array,
        confidences: Float32Array
    ): { key: MusicalKey; scale: Scale } {
        // Build pitch class histogram
        const pitchClasses = new Float32Array(12);
        const noteNames: MusicalKey[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        for (let i = 0; i < frequencies.length; i++) {
            if (frequencies[i] > 0 && confidences[i] > 0.5) {
                const midiNote = 12 * Math.log2(frequencies[i] / 440) + 69;
                const pitchClass = Math.round(midiNote) % 12;
                if (pitchClass >= 0 && pitchClass < 12) {
                    pitchClasses[pitchClass] += confidences[i];
                }
            }
        }

        // Normalize
        const sum = pitchClasses.reduce((a, b) => a + b, 0);
        if (sum > 0) {
            for (let i = 0; i < 12; i++) {
                pitchClasses[i] /= sum;
            }
        }

        // Match against key profiles (Krumhansl-Schmuckler)
        const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
        const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

        let bestKey = 0;
        let bestScale: Scale = 'major';
        let bestCorrelation = -1;

        for (let key = 0; key < 12; key++) {
            // Rotate profiles
            const rotatedMajor = majorProfile.map((_, i) => majorProfile[(i + 12 - key) % 12]);
            const rotatedMinor = minorProfile.map((_, i) => minorProfile[(i + 12 - key) % 12]);

            const majorCorr = this.correlation(Array.from(pitchClasses), rotatedMajor);
            const minorCorr = this.correlation(Array.from(pitchClasses), rotatedMinor);

            if (majorCorr > bestCorrelation) {
                bestCorrelation = majorCorr;
                bestKey = key;
                bestScale = 'major';
            }
            if (minorCorr > bestCorrelation) {
                bestCorrelation = minorCorr;
                bestKey = key;
                bestScale = 'minor';
            }
        }

        return {
            key: noteNames[bestKey],
            scale: bestScale
        };
    }

    private correlation(a: number[], b: number[]): number {
        const n = a.length;
        const meanA = a.reduce((s, v) => s + v, 0) / n;
        const meanB = b.reduce((s, v) => s + v, 0) / n;

        let num = 0, denA = 0, denB = 0;
        for (let i = 0; i < n; i++) {
            const dA = a[i] - meanA;
            const dB = b[i] - meanB;
            num += dA * dB;
            denA += dA * dA;
            denB += dB * dB;
        }

        return num / Math.sqrt(denA * denB);
    }

    // =========================================
    // SPECTRAL ANALYSIS
    // =========================================

    private async analyzeSpectrum(data: Float32Array): Promise<Float32Array> {
        const fftSize = 4096;
        const numBins = fftSize / 2;
        const avgSpectrum = new Float32Array(numBins);

        // Average spectrum over multiple frames
        const hopSize = fftSize / 2;
        const numFrames = Math.floor((data.length - fftSize) / hopSize);

        for (let frame = 0; frame < numFrames; frame++) {
            const start = frame * hopSize;
            const frameData = data.slice(start, start + fftSize);

            // Apply Hann window
            const windowed = this.applyWindow(frameData, 'hann');

            // Simple DFT magnitude (in production, use FFT library)
            const spectrum = this.computeMagnitudeSpectrum(windowed);

            for (let i = 0; i < numBins; i++) {
                avgSpectrum[i] += spectrum[i];
            }
        }

        // Normalize and convert to dB
        for (let i = 0; i < numBins; i++) {
            avgSpectrum[i] = 20 * Math.log10(avgSpectrum[i] / numFrames + 1e-10);
        }

        return avgSpectrum;
    }

    private applyWindow(data: Float32Array, type: 'hann' | 'hamming'): Float32Array {
        const windowed = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
            const multiplier = type === 'hann'
                ? 0.5 * (1 - Math.cos(2 * Math.PI * i / (data.length - 1)))
                : 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (data.length - 1));
            windowed[i] = data[i] * multiplier;
        }
        return windowed;
    }

    private computeMagnitudeSpectrum(data: Float32Array): Float32Array {
        // Simplified DFT - in production use Web Audio AnalyserNode or FFT library
        const n = data.length;
        const numBins = n / 2;
        const magnitude = new Float32Array(numBins);

        for (let k = 0; k < numBins; k++) {
            let real = 0, imag = 0;
            for (let t = 0; t < n; t++) {
                const angle = -2 * Math.PI * k * t / n;
                real += data[t] * Math.cos(angle);
                imag += data[t] * Math.sin(angle);
            }
            magnitude[k] = Math.sqrt(real * real + imag * imag) / n;
        }

        return magnitude;
    }

    // =========================================
    // DYNAMIC ANALYSIS
    // =========================================

    private async analyzeDynamics(data: Float32Array): Promise<{
        rms: number;
        peak: number;
        dynamicRange: number;
    }> {
        // Calculate RMS
        let sumSquares = 0;
        let peak = 0;

        for (let i = 0; i < data.length; i++) {
            const sample = Math.abs(data[i]);
            sumSquares += sample * sample;
            if (sample > peak) peak = sample;
        }

        const rms = Math.sqrt(sumSquares / data.length);
        const rmsDb = 20 * Math.log10(rms + 1e-10);
        const peakDb = 20 * Math.log10(peak + 1e-10);

        // Calculate short-term RMS for dynamic range estimation
        const frameSize = Math.floor(this.sampleRate * 0.05); // 50ms frames
        const shortTermRms: number[] = [];

        for (let i = 0; i < data.length - frameSize; i += frameSize) {
            let frameSum = 0;
            for (let j = 0; j < frameSize; j++) {
                frameSum += data[i + j] * data[i + j];
            }
            const frameRms = Math.sqrt(frameSum / frameSize);
            if (frameRms > 0.001) { // Ignore silence
                shortTermRms.push(20 * Math.log10(frameRms));
            }
        }

        shortTermRms.sort((a, b) => a - b);
        const p10 = shortTermRms[Math.floor(shortTermRms.length * 0.1)] || rmsDb;
        const p90 = shortTermRms[Math.floor(shortTermRms.length * 0.9)] || rmsDb;
        const dynamicRange = p90 - p10;

        return { rms: rmsDb, peak: peakDb, dynamicRange };
    }

    // =========================================
    // NOISE ANALYSIS
    // =========================================

    private async analyzeNoise(data: Float32Array): Promise<{
        noiseFloor: number;
        snr: number;
        reverbTime: number;
    }> {
        // Find silent sections to estimate noise floor
        const frameSize = Math.floor(this.sampleRate * 0.02); // 20ms
        const frameRms: { rms: number; start: number }[] = [];

        for (let i = 0; i < data.length - frameSize; i += frameSize) {
            let sum = 0;
            for (let j = 0; j < frameSize; j++) {
                sum += data[i + j] * data[i + j];
            }
            frameRms.push({ rms: Math.sqrt(sum / frameSize), start: i });
        }

        // Sort by RMS and take bottom 10% as noise floor estimate
        frameRms.sort((a, b) => a.rms - b.rms);
        const noiseFrames = frameRms.slice(0, Math.max(1, Math.floor(frameRms.length * 0.1)));
        const avgNoiseRms = noiseFrames.reduce((s, f) => s + f.rms, 0) / noiseFrames.length;
        const noiseFloor = 20 * Math.log10(avgNoiseRms + 1e-10);

        // Estimate signal level from loudest sections
        const signalFrames = frameRms.slice(-Math.floor(frameRms.length * 0.1));
        const avgSignalRms = signalFrames.reduce((s, f) => s + f.rms, 0) / signalFrames.length;
        const signalLevel = 20 * Math.log10(avgSignalRms + 1e-10);

        const snr = signalLevel - noiseFloor;

        // Rough RT60 estimation from decay after loud sections
        // This is simplified - real RT60 estimation is more complex
        const reverbTime = this.estimateRT60(data, frameRms);

        return { noiseFloor, snr, reverbTime };
    }

    private estimateRT60(_data: Float32Array, frameRms: { rms: number; start: number }[]): number {
        // Find loud sections and measure decay
        // Very simplified - look for 20dB decay time, multiply by 3

        const threshold = 0.1;
        let decayTimes: number[] = [];

        for (let i = 0; i < frameRms.length - 10; i++) {
            if (frameRms[i].rms > threshold && frameRms[i + 1].rms < frameRms[i].rms * 0.5) {
                // Found a decay point
                const targetRms = frameRms[i].rms * 0.1; // -20dB
                for (let j = i + 1; j < Math.min(i + 50, frameRms.length); j++) {
                    if (frameRms[j].rms < targetRms) {
                        const decayTime = (frameRms[j].start - frameRms[i].start) / this.sampleRate;
                        decayTimes.push(decayTime * 3); // RT20 to RT60 approximation
                        break;
                    }
                }
            }
        }

        if (decayTimes.length === 0) return 0.2; // Default short reverb

        decayTimes.sort((a, b) => a - b);
        return decayTimes[Math.floor(decayTimes.length / 2)]; // Median
    }



    // =========================================
    // SIBILANCE ANALYSIS
    // =========================================

    private analyzeSibilance(spectrum: Float32Array): number {
        // Calculate average energy in sibilance band (5-8 kHz)
        const binSize = this.sampleRate / (spectrum.length * 2);
        const lowBin = Math.floor(5000 / binSize);
        const highBin = Math.ceil(8000 / binSize);

        let sum = 0;
        let count = 0;
        for (let i = lowBin; i <= highBin && i < spectrum.length; i++) {
            sum += spectrum[i];
            count++;
        }

        return count > 0 ? sum / count : -60;
    }

    // =========================================
    // PHONE RECORDING DETECTION
    // =========================================

    private detectPhoneRecording(spectrum: Float32Array, noise: { snr: number; reverbTime: number }): number {
        let confidence = 0;

        // Low SNR suggests phone recording
        if (noise.snr < 30) confidence += 0.3;
        if (noise.snr < 20) confidence += 0.2;

        // Room reverb suggests non-studio
        if (noise.reverbTime > 0.5) confidence += 0.2;

        // Check for typical phone frequency response artifacts
        // (high-pass around 100Hz, roll-off above 14kHz)
        const binSize = this.sampleRate / (spectrum.length * 2);

        // Low frequency roll-off
        const lowEnergy = spectrum[Math.floor(60 / binSize)] || -60;
        if (lowEnergy < -45) confidence += 0.15;

        // High frequency roll-off
        const highEnergy = spectrum[Math.floor(14000 / binSize)] || -60;
        if (highEnergy < -50) confidence += 0.15;

        return Math.min(1, confidence);
    }
}

export const vocalAnalyzer = new VocalAnalyzer();
