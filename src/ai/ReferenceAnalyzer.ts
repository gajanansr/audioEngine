import { ReferenceAnalysis, ReverbParams } from '../core/types';

/**
 * Reference Track Analyzer
 * Analyzes reference songs to extract target characteristics for mix matching
 */
export class ReferenceAnalyzer {
    private sampleRate: number = 44100;

    /**
     * Perform complete analysis of a reference track
     */
    async analyze(audioBuffer: Float32Array, sampleRate: number): Promise<ReferenceAnalysis> {
        this.sampleRate = sampleRate;

        const [
            tonalCurve,
            reverbParams,
            loudnessAnalysis
        ] = await Promise.all([
            this.extractTonalCurve(audioBuffer),
            this.analyzeReverbCharacteristics(audioBuffer),
            this.analyzeLoudness(audioBuffer)
        ]);

        return {
            vocalTonalCurve: tonalCurve,
            perceivedReverbSpace: reverbParams,
            vocalLoudnessBalance: loudnessAnalysis.vocalBalance,
            overallLoudness: loudnessAnalysis.lufs
        };
    }

    // =========================================
    // TONAL CURVE EXTRACTION
    // =========================================

    private async extractTonalCurve(data: Float32Array): Promise<Float32Array> {
        const fftSize = 4096;
        const numBins = fftSize / 2;
        const avgSpectrum = new Float32Array(numBins);

        const hopSize = fftSize / 4;
        const numFrames = Math.floor((data.length - fftSize) / hopSize);

        if (numFrames <= 0) {
            return avgSpectrum;
        }

        for (let frame = 0; frame < numFrames; frame++) {
            const start = frame * hopSize;
            const frameData = data.slice(start, start + fftSize);
            const windowed = this.applyHannWindow(frameData);
            const spectrum = this.computeMagnitudeSpectrum(windowed);

            for (let i = 0; i < numBins; i++) {
                avgSpectrum[i] += spectrum[i];
            }
        }

        // Normalize and convert to dB
        for (let i = 0; i < numBins; i++) {
            avgSpectrum[i] = 20 * Math.log10(avgSpectrum[i] / numFrames + 1e-10);
        }

        // Apply smoothing (1/3 octave bands)
        return this.smoothSpectrum(avgSpectrum);
    }

    private smoothSpectrum(spectrum: Float32Array): Float32Array {
        const smoothed = new Float32Array(spectrum.length);
        const smoothingWidth = 5;

        for (let i = 0; i < spectrum.length; i++) {
            let sum = 0;
            let count = 0;
            for (let j = Math.max(0, i - smoothingWidth); j <= Math.min(spectrum.length - 1, i + smoothingWidth); j++) {
                sum += spectrum[j];
                count++;
            }
            smoothed[i] = sum / count;
        }

        return smoothed;
    }

    // =========================================
    // REVERB CHARACTERISTICS
    // =========================================

    private async analyzeReverbCharacteristics(data: Float32Array): Promise<ReverbParams> {
        // Estimate reverb from transient decay analysis
        const frameSize = Math.floor(this.sampleRate * 0.02); // 20ms frames
        const frameEnergies: number[] = [];

        for (let i = 0; i < data.length - frameSize; i += frameSize) {
            let energy = 0;
            for (let j = 0; j < frameSize; j++) {
                energy += data[i + j] * data[i + j];
            }
            frameEnergies.push(Math.sqrt(energy / frameSize));
        }

        // Find transients and measure decay
        const decayTimes: number[] = [];
        const threshold = Math.max(...frameEnergies) * 0.1;

        for (let i = 1; i < frameEnergies.length - 20; i++) {
            // Detect transient (sudden increase)
            if (frameEnergies[i] > frameEnergies[i - 1] * 2 && frameEnergies[i] > threshold) {
                // Measure decay time
                const startEnergy = frameEnergies[i];
                const targetEnergy = startEnergy * 0.1; // -20dB

                for (let j = i + 1; j < Math.min(i + 50, frameEnergies.length); j++) {
                    if (frameEnergies[j] < targetEnergy) {
                        const decayTime = (j - i) * frameSize / this.sampleRate;
                        decayTimes.push(decayTime * 3); // RT20 to RT60
                        break;
                    }
                }
            }
        }

        // Calculate median decay time
        let estimatedDecay = 1.8;
        if (decayTimes.length > 0) {
            decayTimes.sort((a, b) => a - b);
            estimatedDecay = decayTimes[Math.floor(decayTimes.length / 2)];
        }

        // Classify reverb type based on decay
        let type: 'plate' | 'room' | 'hall' = 'plate';
        if (estimatedDecay > 2.5) {
            type = 'hall';
        } else if (estimatedDecay > 1.5) {
            type = 'room';
        }

        return {
            type,
            preDelay: 40,
            decay: Math.max(0.5, Math.min(4.0, estimatedDecay)),
            damping: 0.5,
            wetLevel: this.estimateWetLevel(data)
        };
    }

    private estimateWetLevel(data: Float32Array): number {
        // Estimate wet level from diffuse-to-direct ratio
        // Simplified: analyze sustained vs transient energy
        const frameSize = Math.floor(this.sampleRate * 0.05);
        let transientEnergy = 0;
        let sustainedEnergy = 0;

        for (let i = 0; i < data.length - frameSize * 2; i += frameSize) {
            const energy1 = this.calculateFrameEnergy(data, i, frameSize);
            const energy2 = this.calculateFrameEnergy(data, i + frameSize, frameSize);

            if (energy1 > energy2 * 1.5) {
                // Transient
                transientEnergy += energy1;
            } else {
                sustainedEnergy += (energy1 + energy2) / 2;
            }
        }

        const ratio = sustainedEnergy / (transientEnergy + sustainedEnergy + 1e-10);
        // Map ratio to wet level (0-40%)
        return Math.min(40, Math.max(5, ratio * 50));
    }

    // =========================================
    // LOUDNESS ANALYSIS
    // =========================================

    private async analyzeLoudness(data: Float32Array): Promise<{
        lufs: number;
        vocalBalance: number;
    }> {
        // Simplified LUFS calculation
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
            sumSquares += data[i] * data[i];
        }
        const rms = Math.sqrt(sumSquares / data.length);
        const lufs = 20 * Math.log10(rms + 1e-10) - 0.691;

        // Estimate vocal loudness balance by analyzing 200Hz-4kHz band
        // (assumes reference has vocals in this range)
        const vocalBandEnergy = this.analyzeFrequencyBand(data, 200, 4000);
        const fullBandEnergy = this.analyzeFrequencyBand(data, 20, 20000);
        const vocalBalance = vocalBandEnergy - fullBandEnergy + 3; // dB difference from avg

        return { lufs, vocalBalance };
    }

    // =========================================
    // SONG STRUCTURE DETECTION
    // =========================================

    /**
     * Detect song sections (verse, chorus, bridge)
     * Returns timestamps and section types
     */
    async detectSongStructure(data: Float32Array): Promise<{
        sections: { start: number; end: number; type: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro'; energy: number }[];
    }> {
        const frameSize = Math.floor(this.sampleRate * 2); // 2-second frames
        const energies: number[] = [];
        const timestamps: number[] = [];

        for (let i = 0; i < data.length - frameSize; i += frameSize) {
            const energy = this.calculateFrameEnergy(data, i, frameSize);
            energies.push(20 * Math.log10(energy + 1e-10));
            timestamps.push(i / this.sampleRate);
        }

        // Find energy thresholds
        const sortedEnergies = [...energies].sort((a, b) => a - b);
        const lowThreshold = sortedEnergies[Math.floor(sortedEnergies.length * 0.25)];
        const highThreshold = sortedEnergies[Math.floor(sortedEnergies.length * 0.75)];

        // Classify sections
        const sections: { start: number; end: number; type: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro'; energy: number }[] = [];

        let currentType: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' = 'intro';
        let sectionStart = 0;

        for (let i = 0; i < energies.length; i++) {
            const e = energies[i];
            let newType: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' = currentType;

            if (i < 2) {
                newType = 'intro';
            } else if (i >= energies.length - 2) {
                newType = 'outro';
            } else if (e > highThreshold) {
                newType = 'chorus';
            } else if (e < lowThreshold) {
                newType = 'bridge';
            } else {
                newType = 'verse';
            }

            if (newType !== currentType || i === energies.length - 1) {
                sections.push({
                    start: sectionStart,
                    end: timestamps[i] || data.length / this.sampleRate,
                    type: currentType,
                    energy: energies[i]
                });
                currentType = newType;
                sectionStart = timestamps[i];
            }
        }

        return { sections };
    }

    // =========================================
    // UTILITY METHODS
    // =========================================

    private applyHannWindow(data: Float32Array): Float32Array {
        const windowed = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
            windowed[i] = data[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (data.length - 1)));
        }
        return windowed;
    }

    private computeMagnitudeSpectrum(data: Float32Array): Float32Array {
        const n = data.length;
        const numBins = n / 2;
        const magnitude = new Float32Array(numBins);

        // Fast approximation using sparse DFT (for performance)
        const step = 4; // Sample every 4th frequency for speed
        for (let k = 0; k < numBins; k++) {
            if (k % step !== 0 && k > 0 && k < numBins - 1) {
                // Interpolate
                magnitude[k] = (magnitude[k - 1] + magnitude[Math.min(k + step, numBins - 1)]) / 2;
                continue;
            }

            let real = 0, imag = 0;
            for (let t = 0; t < n; t += 4) { // Skip samples for speed
                const angle = -2 * Math.PI * k * t / n;
                real += data[t] * Math.cos(angle);
                imag += data[t] * Math.sin(angle);
            }
            magnitude[k] = Math.sqrt(real * real + imag * imag) / (n / 4);
        }

        return magnitude;
    }

    private calculateFrameEnergy(data: Float32Array, start: number, length: number): number {
        let sum = 0;
        const end = Math.min(start + length, data.length);
        for (let i = start; i < end; i++) {
            sum += data[i] * data[i];
        }
        return Math.sqrt(sum / (end - start));
    }

    private analyzeFrequencyBand(data: Float32Array, lowFreq: number, highFreq: number): number {
        // Bandpass filter approximation using FFT
        const fftSize = 2048;
        const spectrum = this.computeMagnitudeSpectrum(data.slice(0, fftSize));
        const binSize = this.sampleRate / fftSize;

        const lowBin = Math.floor(lowFreq / binSize);
        const highBin = Math.ceil(highFreq / binSize);

        let sum = 0;
        let count = 0;
        for (let i = lowBin; i <= highBin && i < spectrum.length; i++) {
            sum += spectrum[i];
            count++;
        }

        return count > 0 ? 20 * Math.log10(sum / count + 1e-10) : -60;
    }
}

export const referenceAnalyzer = new ReferenceAnalyzer();
