import {
    VocalAnalysis,
    ReferenceAnalysis,
    ChainParameters,
    Genre,
    GainStagingParams,
    NoiseReductionParams,
    SubtractiveEQParams,
    AdditiveEQParams,
    DeEsserParams,
    CompressorParams,
    AutotuneParams,
    SaturationParams,
    ReverbParams,
    DelayParams,
    MasteringParams
} from '../core/types';

/**
 * AI Parameter Optimizer
 * Analyzes vocal characteristics and generates optimal processing parameters
 */
export class ParameterOptimizer {
    /**
     * Main entry point - generates all chain parameters
     */
    optimizeChain(
        vocal: VocalAnalysis,
        reference: ReferenceAnalysis | null,
        genre: Genre
    ): ChainParameters {
        return {
            gainStaging: this.calculateGainStaging(vocal),
            noiseReduction: this.calculateNoiseReduction(vocal),
            subtractiveEQ: this.calculateSubtractiveEQ(vocal),
            deEsser: this.calculateDeEsser(vocal),
            compressionA: this.calculateLevelingCompression(vocal),
            compressionB: this.calculateControlCompression(vocal),
            autotune: this.calculateAutotune(vocal, genre),
            additiveEQ: this.calculateAdditiveEQ(vocal, reference),
            saturation: this.calculateSaturation(vocal),
            reverb: this.calculateReverb(vocal, reference, genre),
            delay: this.calculateDelay(genre),
            mastering: this.calculateMastering(reference)
        };
    }

    // =========================================
    // GAIN STAGING
    // =========================================

    private calculateGainStaging(vocal: VocalAnalysis): GainStagingParams {
        const targetRms = -18; // dBFS - standard for mixing
        const peakCeiling = -6; // dBFS - headroom for processing

        // Calculate required gain adjustment
        const currentRms = vocal.rmsLevel;
        const currentPeak = vocal.peakLevel;

        // Calculate gain to reach target RMS
        let inputGain = targetRms - currentRms;

        // Ensure peaks don't exceed ceiling after gain
        const expectedPeak = currentPeak + inputGain;
        if (expectedPeak > peakCeiling) {
            inputGain = peakCeiling - currentPeak;
        }

        return {
            inputGain,
            targetRms,
            peakCeiling
        };
    }

    // =========================================
    // NOISE REDUCTION
    // =========================================

    private calculateNoiseReduction(vocal: VocalAnalysis): NoiseReductionParams {
        const snr = vocal.signalToNoiseRatio;
        const phoneConfidence = vocal.phoneRecordingConfidence;
        const roomReverb = vocal.roomReverbTime;

        // Determine if noise reduction is needed
        const needsNR = snr < 40 || phoneConfidence > 0.6;

        // Conservative settings - preserve emotion
        let threshold = -40;
        let reduction = 6;

        if (snr < 20) {
            // Severely noisy - more aggressive but still careful
            threshold = -35;
            reduction = 12;
        } else if (snr < 30) {
            // Moderately noisy
            threshold = -38;
            reduction = 9;
        }

        // De-reverb only if significant room echo detected
        const needsDeReverb = roomReverb > 0.4; // RT60 > 400ms
        const deReverbAmount = needsDeReverb
            ? Math.min((roomReverb - 0.4) * 50, 30) // Max 30%
            : 0;

        return {
            enabled: needsNR,
            threshold,
            reduction,
            deReverbEnabled: needsDeReverb,
            deReverbAmount
        };
    }

    // =========================================
    // SUBTRACTIVE EQ (Pre-Compression)
    // =========================================

    private calculateSubtractiveEQ(vocal: VocalAnalysis): SubtractiveEQParams {
        const fundamental = vocal.fundamentalFreq;

        // Adaptive HPF based on fundamental frequency
        // Calculate cutoff as ~0.7× fundamental, clamped between 50-150 Hz
        const highPassFreq = Math.max(50, Math.min(150, fundamental * 0.7));

        // Adaptive slope: steeper for lower fundamentals (bass voices)
        const highPassSlope = fundamental < 120 ? 24 : 18;

        // Analyze spectral profile for problematic frequencies
        const bands = [];

        // Mud reduction (200-350 Hz) - almost always needed for phone recordings
        const mudEnergy = this.analyzeFrequencyBand(vocal.spectralProfile, 200, 350, 44100);
        if (mudEnergy > -12) {
            bands.push({
                frequency: 280,
                gain: Math.max(-4, -mudEnergy * 0.5), // Gentle cut
                q: 1.5,
                type: 'peak' as const,
                enabled: true
            });
        }

        // Harshness control (2.5-4.5 kHz) - dynamic notch
        // This should ideally be a dynamic EQ, but we'll set a gentle static cut
        const harshEnergy = this.analyzeFrequencyBand(vocal.spectralProfile, 2500, 4500, 44100);
        if (harshEnergy > -6) {
            bands.push({
                frequency: 3200,
                gain: -2, // Very gentle - the de-esser handles more
                q: 2,
                type: 'peak' as const,
                enabled: true
            });
        }

        return {
            highPassFreq,
            highPassSlope,
            bands
        };
    }

    // =========================================
    // DE-ESSER
    // =========================================

    private calculateDeEsser(vocal: VocalAnalysis): DeEsserParams {
        const sibilance = vocal.sibilanceLevel;
        const fundamental = vocal.fundamentalFreq;

        // De-esser frequency adapts to voice pitch
        // Higher fundamentals typically have higher sibilance frequencies
        // Range: 5000-8000 Hz based on fundamental
        const frequency = Math.max(5000, Math.min(8000, 4000 + fundamental * 10));

        // Threshold based on sibilance level
        // Higher sibilance = lower threshold (more processing)
        let threshold = -20;
        let ratio = 4;

        if (sibilance > -6) {
            // Very sibilant
            threshold = -25;
            ratio = 6;
        } else if (sibilance < -15) {
            // Minimal sibilance
            threshold = -15;
            ratio = 2;
        }

        return {
            frequency,
            threshold,
            ratio,
            range: 10, // Max 10dB reduction
            listenMode: false
        };
    }

    // =========================================
    // COMPRESSION
    // =========================================

    private calculateLevelingCompression(vocal: VocalAnalysis): CompressorParams {
        const dynamicRange = vocal.dynamicRange;

        // Leveling compressor: slow, gentle, for overall dynamics
        let ratio = 2;
        let threshold = -18;

        // Adjust based on dynamic range
        if (dynamicRange > 20) {
            // Very dynamic - more compression
            ratio = 2.5;
            threshold = -20;
        } else if (dynamicRange < 10) {
            // Already compressed
            ratio = 1.5;
            threshold = -15;
        }

        return {
            threshold,
            ratio,
            attack: 30, // Slow attack - let transients through
            release: 200, // Medium release
            knee: 6,
            makeupGain: 0 // Auto-makeup handled separately
        };
    }

    private calculateControlCompression(_vocal: VocalAnalysis): CompressorParams {
        // Control compressor: fast, for taming peaks
        return {
            threshold: -12,
            ratio: 4,
            attack: 5, // Fast attack - catch peaks
            release: 50, // Fast release
            knee: 3,
            makeupGain: 0
        };
    }

    // =========================================
    // AUTOTUNE
    // =========================================

    private calculateAutotune(vocal: VocalAnalysis, genre: Genre): AutotuneParams {
        const { detectedKey, detectedScale, pitchData } = vocal;

        // Calculate average pitch deviation
        const avgDeviation = this.calculatePitchDeviation(pitchData);

        // Genre-based retune speed
        // Lower = faster correction (more robotic)
        // Higher = slower correction (more natural)
        let retuneSpeed = 50; // Default: natural
        let humanize = 30;

        switch (genre) {
            case 'pop':
                retuneSpeed = 40;
                humanize = 20;
                break;
            case 'hiphop':
                retuneSpeed = 30; // Tighter tuning common in hip-hop
                humanize = 15;
                break;
            case 'rnb':
                retuneSpeed = 45;
                humanize = 25;
                break;
            case 'rock':
                retuneSpeed = 60; // More natural
                humanize = 40;
                break;
            case 'acoustic':
                retuneSpeed = 80; // Very natural
                humanize = 50;
                break;
            case 'electronic':
                retuneSpeed = 20; // Can be tighter
                humanize = 10;
                break;
        }

        // Adjust based on pitch deviation
        if (avgDeviation > 50) {
            // Vocalist needs more correction
            retuneSpeed = Math.max(retuneSpeed - 15, 10);
        } else if (avgDeviation < 20) {
            // Good pitch - less correction needed
            retuneSpeed = Math.min(retuneSpeed + 15, 100);
        }

        return {
            enabled: true,
            key: detectedKey,
            scale: detectedScale,
            retuneSpeed,
            humanize,
            formantPreserve: true, // Always preserve formants
            formantShift: 0
        };
    }

    // =========================================
    // ADDITIVE EQ (Post-Compression)
    // =========================================

    private calculateAdditiveEQ(
        vocal: VocalAnalysis,
        reference: ReferenceAnalysis | null
    ): AdditiveEQParams {
        let presenceGain = 2; // Default gentle boost
        let airGain = 1.5;

        // If reference provided, match tonal characteristics
        if (reference && reference.vocalTonalCurve) {
            const presenceDiff = this.compareFrequencyBand(
                vocal.spectralProfile,
                reference.vocalTonalCurve,
                3000, 5000,
                44100
            );

            const airDiff = this.compareFrequencyBand(
                vocal.spectralProfile,
                reference.vocalTonalCurve,
                10000, 15000,
                44100
            );

            // Apply subtle matching (max ±4dB influence)
            presenceGain = Math.max(-2, Math.min(4, presenceGain + presenceDiff * 0.5));
            airGain = Math.max(-1, Math.min(3, airGain + airDiff * 0.3));
        }

        // Phone recordings often lack air - boost if SNR allows
        if (vocal.phoneRecordingConfidence > 0.7 && vocal.signalToNoiseRatio > 30) {
            airGain = Math.min(airGain + 1, 4);
        }

        return {
            presenceFreq: 4000,
            presenceGain,
            presenceQ: 1.2,
            airShelfFreq: 12000,
            airShelfGain: airGain,
            bands: []
        };
    }

    // =========================================
    // SATURATION
    // =========================================

    private calculateSaturation(vocal: VocalAnalysis): SaturationParams {
        // Very subtle saturation for warmth and density
        // Phone recordings often sound thin - saturation helps

        let drive = 5; // Very low
        let mix = 8; // 8% wet

        if (vocal.phoneRecordingConfidence > 0.8) {
            // Definitely a phone recording - add a bit more warmth
            drive = 8;
            mix = 12;
        }

        return {
            drive,
            mix,
            type: 'tube',
            outputGain: 0
        };
    }

    // =========================================
    // REVERB
    // =========================================

    private calculateReverb(
        vocal: VocalAnalysis,
        reference: ReferenceAnalysis | null,
        genre: Genre
    ): ReverbParams {
        // Base settings
        let type: 'plate' | 'room' | 'hall' = 'plate';
        let preDelay = 50;
        let decay = 1.8;
        let damping = 0.5;
        let wetLevel = 15;

        // Genre adjustments
        switch (genre) {
            case 'pop':
                type = 'plate';
                decay = 1.5;
                wetLevel = 18;
                break;
            case 'hiphop':
                type = 'room';
                decay = 1.2;
                wetLevel = 12;
                break;
            case 'rnb':
                type = 'plate';
                decay = 2.0;
                wetLevel = 20;
                break;
            case 'rock':
                type = 'room';
                decay = 1.4;
                wetLevel = 15;
                break;
            case 'acoustic':
                type = 'hall';
                decay = 2.2;
                wetLevel = 22;
                break;
            case 'electronic':
                type = 'plate';
                decay = 2.5;
                wetLevel = 25;
                break;
        }

        // Match reference if provided
        if (reference?.perceivedReverbSpace) {
            const ref = reference.perceivedReverbSpace;
            // Blend toward reference (50% influence)
            decay = decay * 0.5 + ref.decay * 0.5;
            wetLevel = wetLevel * 0.5 + ref.wetLevel * 0.5;
            type = ref.type;
        }

        // If recording already has room reverb, reduce added reverb
        if (vocal.roomReverbTime > 0.3) {
            wetLevel *= 0.7;
        }

        return {
            type,
            preDelay,
            decay,
            damping,
            wetLevel
        };
    }

    // =========================================
    // DELAY
    // =========================================

    private calculateDelay(genre: Genre): DelayParams {
        // Delay is optional and genre-dependent
        let enabled = false;
        let time = 250;
        let feedback = 20;
        let wetLevel = 10;

        switch (genre) {
            case 'pop':
                enabled = true;
                time = 280; // Slapback
                feedback = 15;
                wetLevel = 8;
                break;
            case 'hiphop':
                enabled = true;
                time = 200;
                feedback = 25;
                wetLevel = 12;
                break;
            case 'electronic':
                enabled = true;
                time = 375; // Likely synced to tempo
                feedback = 35;
                wetLevel = 15;
                break;
            default:
                enabled = false;
        }

        return {
            enabled,
            time,
            feedback,
            wetLevel,
            highCut: 5000, // Filter to prevent harshness
            sync: false
        };
    }

    // =========================================
    // MASTERING
    // =========================================

    private calculateMastering(reference: ReferenceAnalysis | null): MasteringParams {
        // Conservative mastering for beginners
        // Target -14 LUFS (streaming standard)

        let targetLUFS = -14;
        let eqTilt = 0;

        if (reference) {
            // Match reference loudness (within reason)
            targetLUFS = Math.max(-16, Math.min(-10, reference.overallLoudness));
        }

        return {
            eqTilt,
            multibandEnabled: true,
            lowBandThreshold: -18,
            midBandThreshold: -15,
            highBandThreshold: -18,
            limiterThreshold: -1,
            limiterCeiling: -1, // -1 dBTP
            targetLUFS
        };
    }

    // =========================================
    // UTILITY METHODS
    // =========================================

    private analyzeFrequencyBand(
        spectrum: Float32Array,
        lowFreq: number,
        highFreq: number,
        sampleRate: number
    ): number {
        // Calculate average energy in frequency band
        const binSize = sampleRate / (spectrum.length * 2);
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

    private compareFrequencyBand(
        source: Float32Array,
        target: Float32Array,
        lowFreq: number,
        highFreq: number,
        sampleRate: number
    ): number {
        const sourceLevel = this.analyzeFrequencyBand(source, lowFreq, highFreq, sampleRate);
        const targetLevel = this.analyzeFrequencyBand(target, lowFreq, highFreq, sampleRate);
        return targetLevel - sourceLevel;
    }

    private calculatePitchDeviation(pitchData: any): number {
        // Calculate average deviation from target pitches in cents
        // This would analyze the pitch contour and determine how far
        // the vocalist deviates from in-tune notes

        if (!pitchData?.frequencies || pitchData.frequencies.length === 0) {
            return 30; // Default moderate deviation
        }

        // Simplified: return average confidence-weighted deviation
        // In production, this would do proper pitch quantization
        let totalDeviation = 0;
        let totalWeight = 0;

        for (let i = 0; i < pitchData.frequencies.length; i++) {
            const freq = pitchData.frequencies[i];
            const conf = pitchData.confidences[i];

            if (freq > 0 && conf > 0.5) {
                // Calculate cents from nearest semitone
                const midiNote = 12 * Math.log2(freq / 440) + 69;
                const deviation = Math.abs((midiNote % 1) - 0.5) * 200; // cents
                totalDeviation += deviation * conf;
                totalWeight += conf;
            }
        }

        return totalWeight > 0 ? totalDeviation / totalWeight : 30;
    }
}

// Export singleton instance
export const parameterOptimizer = new ParameterOptimizer();
