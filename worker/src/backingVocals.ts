/**
 * Pitch Shifter Module
 * 
 * Local pitch shifting for backing vocals and harmonies
 * Uses phase vocoder technique for quality pitch shifting without time stretching
 */

/**
 * Simple pitch shifter using granular synthesis
 * This is a lightweight approach suitable for real-time-ish processing
 */
export class PitchShifter {
    private sampleRate: number;
    private grainSize: number;
    private overlap: number;

    constructor(sampleRate: number = 44100) {
        this.sampleRate = sampleRate;
        this.grainSize = 2048; // ~46ms at 44.1kHz
        this.overlap = 4; // 75% overlap
    }

    /**
     * Shift pitch by semitones
     * @param audio Input audio
     * @param semitones Number of semitones to shift (positive = up, negative = down)
     * @returns Pitch-shifted audio
     */
    shift(audio: Float32Array, semitones: number): Float32Array {
        if (Math.abs(semitones) < 0.01) {
            return audio; // No shift needed
        }

        const ratio = Math.pow(2, semitones / 12);
        return this.resampleWithGranular(audio, ratio);
    }

    /**
     * Create harmony by shifting pitch
     * Returns the harmony track (not mixed with original)
     */
    createHarmony(audio: Float32Array, semitones: number, gain: number = 0.5): Float32Array {
        const shifted = this.shift(audio, semitones);
        // Apply gain
        for (let i = 0; i < shifted.length; i++) {
            shifted[i] *= gain;
        }
        return shifted;
    }

    /**
     * Create vocal double (subtle pitch + time variation)
     */
    createDouble(audio: Float32Array, detuneCenter: number = 8, delayMs: number = 20): Float32Array {
        // Random detune between -detuneCenter and +detuneCenter cents
        const detuneSemitones = (Math.random() * 2 - 1) * detuneCenter / 100;
        const shifted = this.shift(audio, detuneSemitones);

        // Add delay
        const delaySamples = Math.floor((delayMs / 1000) * this.sampleRate);
        const delayed = new Float32Array(shifted.length);

        for (let i = delaySamples; i < shifted.length; i++) {
            delayed[i] = shifted[i - delaySamples];
        }

        return delayed;
    }

    /**
     * Granular pitch shifting (PSOLA-lite)
     * Resamples within overlapping grains to shift pitch without changing duration
     */
    private resampleWithGranular(audio: Float32Array, ratio: number): Float32Array {
        const hopSize = Math.floor(this.grainSize / this.overlap);
        const numGrains = Math.floor((audio.length - this.grainSize) / hopSize) + 1;
        const output = new Float32Array(audio.length);
        const windowSum = new Float32Array(audio.length);

        // Hann window
        const window = new Float32Array(this.grainSize);
        for (let i = 0; i < this.grainSize; i++) {
            window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.grainSize - 1)));
        }

        for (let g = 0; g < numGrains; g++) {
            const inputStart = g * hopSize;
            const grain = audio.slice(inputStart, inputStart + this.grainSize);

            // Resample grain to change pitch
            const resampledGrain = this.resampleGrain(grain, ratio);

            // Apply window and overlap-add
            for (let i = 0; i < this.grainSize && inputStart + i < output.length; i++) {
                const idx = inputStart + i;
                if (i < resampledGrain.length) {
                    output[idx] += resampledGrain[i] * window[i];
                    windowSum[idx] += window[i];
                }
            }
        }

        // Normalize by window sum
        for (let i = 0; i < output.length; i++) {
            if (windowSum[i] > 0.001) {
                output[i] /= windowSum[i];
            }
        }

        return output;
    }

    /**
     * Resample a single grain using linear interpolation
     */
    private resampleGrain(grain: Float32Array, ratio: number): Float32Array {
        const outputLength = this.grainSize; // Keep original length
        const output = new Float32Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            const srcPos = i * ratio;
            const srcIndex = Math.floor(srcPos);
            const frac = srcPos - srcIndex;

            if (srcIndex + 1 < grain.length) {
                output[i] = grain[srcIndex] * (1 - frac) + grain[srcIndex + 1] * frac;
            } else if (srcIndex < grain.length) {
                output[i] = grain[srcIndex];
            }
        }

        return output;
    }
}

/**
 * Backing Vocals Generator
 * Creates layered backing vocals from lead vocal
 */
export class BackingVocalsGenerator {
    private pitchShifter: PitchShifter;
    private sampleRate: number;

    constructor(sampleRate: number = 44100) {
        this.sampleRate = sampleRate;
        this.pitchShifter = new PitchShifter(sampleRate);
    }

    /**
     * Generate backing vocals with harmonies and doubles
     * @param leadVocal The processed lead vocal
     * @param options Configuration options
     * @returns Mixed backing vocals track
     */
    generate(
        leadVocal: Float32Array,
        options: {
            enableHarmonies: boolean;
            enableDoubles: boolean;
            harmonyType: 'thirds' | 'fifths' | 'octave' | 'full';
            doublesAmount: number; // 0-100
            harmoniesAmount: number; // 0-100
        }
    ): Float32Array {
        const output = new Float32Array(leadVocal.length);

        if (options.enableDoubles && options.doublesAmount > 0) {
            console.log('   → Generating vocal doubles...');
            // INCREASED: Max 60% volume (was 30%)
            const doublesGain = (options.doublesAmount / 100) * 0.6;

            // INCREASED: More detune (20 cents vs 8) and longer delays
            const doubleL = this.pitchShifter.createDouble(leadVocal, 20, 25);
            const doubleR = this.pitchShifter.createDouble(leadVocal, -15, 35);

            for (let i = 0; i < output.length; i++) {
                output[i] += (doubleL[i] + doubleR[i]) * doublesGain;
            }
        }

        if (options.enableHarmonies && options.harmoniesAmount > 0) {
            console.log(`   → Generating ${options.harmonyType} harmonies...`);
            // INCREASED: Max 50% volume (was 25%)
            const harmoniesGain = (options.harmoniesAmount / 100) * 0.5;

            switch (options.harmonyType) {
                case 'thirds':
                    // Major third up (+4 semitones) + minor third down (-3)
                    const thirdUp = this.pitchShifter.createHarmony(leadVocal, 4, harmoniesGain * 0.7);
                    const thirdDown = this.pitchShifter.createHarmony(leadVocal, -3, harmoniesGain * 0.5);
                    this.addToOutput(output, thirdUp);
                    this.addToOutput(output, thirdDown);
                    break;

                case 'fifths':
                    // Perfect fifth up (+7) and fourth down (-5)
                    const fifthUp = this.pitchShifter.createHarmony(leadVocal, 7, harmoniesGain * 0.7);
                    const fourthDown = this.pitchShifter.createHarmony(leadVocal, -5, harmoniesGain * 0.5);
                    this.addToOutput(output, fifthUp);
                    this.addToOutput(output, fourthDown);
                    break;

                case 'octave':
                    // Octave up (+12) and octave down (-12)
                    const octaveUp = this.pitchShifter.createHarmony(leadVocal, 12, harmoniesGain * 0.6);
                    const octaveDown = this.pitchShifter.createHarmony(leadVocal, -12, harmoniesGain * 0.4);
                    this.addToOutput(output, octaveUp);
                    this.addToOutput(output, octaveDown);
                    break;

                case 'full':
                    // Full harmony stack with more layers
                    const fullThirdUp = this.pitchShifter.createHarmony(leadVocal, 4, harmoniesGain * 0.5);
                    const fullThirdDown = this.pitchShifter.createHarmony(leadVocal, -3, harmoniesGain * 0.4);
                    const fullFifth = this.pitchShifter.createHarmony(leadVocal, 7, harmoniesGain * 0.4);
                    const fullOctaveUp = this.pitchShifter.createHarmony(leadVocal, 12, harmoniesGain * 0.3);
                    this.addToOutput(output, fullThirdUp);
                    this.addToOutput(output, fullThirdDown);
                    this.addToOutput(output, fullFifth);
                    this.addToOutput(output, fullOctaveUp);
                    break;
            }
        }

        return output;
    }

    private addToOutput(output: Float32Array, source: Float32Array): void {
        const len = Math.min(output.length, source.length);
        for (let i = 0; i < len; i++) {
            output[i] += source[i];
        }
    }

    /**
     * Apply stereo widening to backing vocals
     * Spreads harmonies in stereo field
     */
    applyStereoWidth(mono: Float32Array, width: number = 0.7): Float32Array {
        const stereo = new Float32Array(mono.length * 2);

        // Haas effect - slight delay on one side
        const delaySamples = Math.floor(0.015 * this.sampleRate); // 15ms

        for (let i = 0; i < mono.length; i++) {
            // Left channel - original
            stereo[i * 2] = mono[i] * (0.5 + width * 0.5);

            // Right channel - delayed and slightly different level
            const delayedIdx = i - delaySamples;
            if (delayedIdx >= 0) {
                stereo[i * 2 + 1] = mono[delayedIdx] * (0.5 + width * 0.3);
            }
        }

        return stereo;
    }
}

// Export instances
export const pitchShifter = new PitchShifter();
export const backingVocalsGenerator = new BackingVocalsGenerator();
