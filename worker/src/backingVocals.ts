/**
 * Pitch Shifter Module
 * 
 * Local pitch shifting for backing vocals and harmonies
 * Uses granular synthesis for quality pitch shifting without time stretching
 */

/**
 * Simple pitch shifter using granular synthesis
 */
export class PitchShifter {
    private sampleRate: number;
    private grainSize: number;
    private overlap: number;

    constructor(sampleRate: number = 44100) {
        this.sampleRate = sampleRate;
        this.grainSize = 2048;
        this.overlap = 4;
    }

    /**
     * Shift pitch by semitones
     */
    shift(audio: Float32Array, semitones: number): Float32Array {
        if (Math.abs(semitones) < 0.01) {
            return new Float32Array(audio);
        }

        const ratio = Math.pow(2, semitones / 12);
        return this.resampleWithGranular(audio, ratio);
    }

    /**
     * Apply formant shift (makes voice sound different character)
     * Positive = chipmunk-like, Negative = deeper character
     */
    shiftFormant(audio: Float32Array, formantShift: number): Float32Array {
        // Formant shift works by pitch shifting then time stretching back
        // For simplicity, we'll use frequency-domain filtering to approximate
        const output = new Float32Array(audio.length);

        // Apply resonance filter to simulate formant shift
        const filterFreq = 1000 * Math.pow(2, formantShift / 6); // Shift center freq
        const coeffA = Math.exp(-2 * Math.PI * filterFreq / this.sampleRate);

        let y1 = 0, y2 = 0;
        for (let i = 0; i < audio.length; i++) {
            const x = audio[i];
            const y = x + 1.5 * coeffA * y1 - 0.7 * coeffA * coeffA * y2;
            output[i] = y * 0.5 + x * 0.5; // Blend with original
            y2 = y1;
            y1 = y;
        }

        return output;
    }

    private resampleWithGranular(audio: Float32Array, ratio: number): Float32Array {
        const hopSize = Math.floor(this.grainSize / this.overlap);
        const numGrains = Math.floor((audio.length - this.grainSize) / hopSize) + 1;
        const output = new Float32Array(audio.length);
        const windowSum = new Float32Array(audio.length);

        const window = new Float32Array(this.grainSize);
        for (let i = 0; i < this.grainSize; i++) {
            window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.grainSize - 1)));
        }

        for (let g = 0; g < numGrains; g++) {
            const inputStart = g * hopSize;
            const grain = audio.slice(inputStart, inputStart + this.grainSize);
            const resampledGrain = this.resampleGrain(grain, ratio);

            for (let i = 0; i < this.grainSize && inputStart + i < output.length; i++) {
                const idx = inputStart + i;
                if (i < resampledGrain.length) {
                    output[idx] += resampledGrain[i] * window[i];
                    windowSum[idx] += window[i];
                }
            }
        }

        for (let i = 0; i < output.length; i++) {
            if (windowSum[i] > 0.001) {
                output[i] /= windowSum[i];
            }
        }

        return output;
    }

    private resampleGrain(grain: Float32Array, ratio: number): Float32Array {
        const outputLength = this.grainSize;
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
 * Audio processing effects for character differentiation
 */
class VocalCharacter {
    private sampleRate: number;

    constructor(sampleRate: number) {
        this.sampleRate = sampleRate;
    }

    /**
     * Apply subtle saturation for warmth
     */
    applySaturation(audio: Float32Array, amount: number): Float32Array {
        const output = new Float32Array(audio.length);
        const drive = 1 + amount * 3;

        for (let i = 0; i < audio.length; i++) {
            const x = audio[i] * drive;
            output[i] = Math.tanh(x) / Math.tanh(drive);
        }

        return output;
    }

    /**
     * Apply brightness boost (high shelf)
     */
    applyBrightness(audio: Float32Array, gainDb: number): Float32Array {
        const output = new Float32Array(audio.length);
        const freq = 6000;
        const w0 = (2 * Math.PI * freq) / this.sampleRate;
        const A = Math.pow(10, gainDb / 40);
        const alpha = Math.sin(w0) / 2;

        const a0 = (A + 1) - (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha;
        const b0 = A * ((A + 1) + (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha) / a0;
        const b1 = -2 * A * ((A - 1) + (A + 1) * Math.cos(w0)) / a0;
        const b2 = A * ((A + 1) + (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha) / a0;
        const a1 = 2 * ((A - 1) - (A + 1) * Math.cos(w0)) / a0;
        const a2 = ((A + 1) - (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha) / a0;

        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < audio.length; i++) {
            const x = audio[i];
            const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            output[i] = y;
            x2 = x1; x1 = x;
            y2 = y1; y1 = y;
        }

        return output;
    }

    /**
     * Apply darkness (low pass filter)
     */
    applyDarkness(audio: Float32Array, cutoff: number): Float32Array {
        const output = new Float32Array(audio.length);
        const rc = 1 / (2 * Math.PI * cutoff);
        const dt = 1 / this.sampleRate;
        const alpha = dt / (rc + dt);

        let prev = 0;
        for (let i = 0; i < audio.length; i++) {
            output[i] = prev + alpha * (audio[i] - prev);
            prev = output[i];
        }

        return output;
    }

    /**
     * Apply time delay
     */
    applyDelay(audio: Float32Array, delayMs: number): Float32Array {
        const delaySamples = Math.floor((delayMs / 1000) * this.sampleRate);
        const output = new Float32Array(audio.length);

        for (let i = delaySamples; i < audio.length; i++) {
            output[i] = audio[i - delaySamples];
        }

        return output;
    }
}

/**
 * Layer definition for backing vocals
 */
interface BackingLayer {
    name: string;
    pitchShift: number;      // Semitones
    formantShift: number;    // Semitones (character change)
    delayMs: number;         // Time offset
    gain: number;            // Volume 0-1
    saturation: number;      // 0-1
    brightness: number;      // dB
    pan: number;             // -1 to 1
}

/**
 * Backing Vocals Generator with character differentiation
 */
export class BackingVocalsGenerator {
    private pitchShifter: PitchShifter;
    private character: VocalCharacter;
    private sampleRate: number;

    constructor(sampleRate: number = 44100) {
        this.sampleRate = sampleRate;
        this.pitchShifter = new PitchShifter(sampleRate);
        this.character = new VocalCharacter(sampleRate);
    }

    /**
     * Define layers with different characters
     */
    private getLayerPresets(): { doubles: BackingLayer[]; harmonies: BackingLayer[]; full: BackingLayer[] } {
        return {
            doubles: [
                // Slightly detuned, warm, left-panned
                { name: 'Double L', pitchShift: 0.15, formantShift: -0.5, delayMs: 20, gain: 0.35, saturation: 0.3, brightness: -2, pan: -0.6 },
                // Opposite detune, bright, right-panned
                { name: 'Double R', pitchShift: -0.12, formantShift: 0.3, delayMs: 28, gain: 0.35, saturation: 0.1, brightness: 3, pan: 0.6 },
            ],
            harmonies: [
                // Third up - airy, bright
                { name: 'High Third', pitchShift: 4, formantShift: 1, delayMs: 15, gain: 0.4, saturation: 0, brightness: 4, pan: 0.4 },
                // Third down - warm, dark
                { name: 'Low Third', pitchShift: -3, formantShift: -1, delayMs: 22, gain: 0.35, saturation: 0.4, brightness: -3, pan: -0.4 },
                // Fifth up - ethereal
                { name: 'Fifth', pitchShift: 7, formantShift: 0.5, delayMs: 10, gain: 0.25, saturation: 0, brightness: 2, pan: 0 },
            ],
            full: [
                // Doubles
                { name: 'Double L', pitchShift: 0.18, formantShift: -0.3, delayMs: 25, gain: 0.3, saturation: 0.2, brightness: -1, pan: -0.7 },
                { name: 'Double R', pitchShift: -0.15, formantShift: 0.2, delayMs: 32, gain: 0.3, saturation: 0.15, brightness: 2, pan: 0.7 },
                // Harmonies
                { name: 'High Third', pitchShift: 4, formantShift: 1.5, delayMs: 18, gain: 0.35, saturation: 0, brightness: 5, pan: 0.3 },
                { name: 'Low Third', pitchShift: -3, formantShift: -1.5, delayMs: 25, gain: 0.3, saturation: 0.5, brightness: -4, pan: -0.3 },
                // Octave whisper
                { name: 'Octave Air', pitchShift: 12, formantShift: 2, delayMs: 5, gain: 0.15, saturation: 0, brightness: 6, pan: 0 },
            ]
        };
    }

    /**
     * Generate backing vocals with character differentiation
     * Can optionally apply only to chorus sections using a mask
     */
    generate(
        leadVocal: Float32Array,
        options: {
            enableHarmonies: boolean;
            enableDoubles: boolean;
            harmonyType: 'thirds' | 'fifths' | 'octave' | 'full';
            doublesAmount: number;
            harmoniesAmount: number;
        },
        chorusMask?: Float32Array
    ): Float32Array {
        const output = new Float32Array(leadVocal.length);
        const presets = this.getLayerPresets();

        let layers: BackingLayer[] = [];

        if (options.enableDoubles && options.doublesAmount > 0) {
            console.log('   → Generating vocal doubles with different characters...');
            layers = layers.concat(presets.doubles.map(l => ({
                ...l,
                gain: l.gain * (options.doublesAmount / 100)
            })));
        }

        if (options.enableHarmonies && options.harmoniesAmount > 0) {
            console.log(`   → Generating ${options.harmonyType} harmonies with unique characters...`);

            let harmonyLayers: BackingLayer[];
            if (options.harmonyType === 'full') {
                harmonyLayers = presets.full;
            } else {
                harmonyLayers = presets.harmonies;
            }

            layers = layers.concat(harmonyLayers.map(l => ({
                ...l,
                gain: l.gain * (options.harmoniesAmount / 100)
            })));
        }

        // Process each layer
        for (const layer of layers) {
            console.log(`     • ${layer.name}: pitch ${layer.pitchShift > 0 ? '+' : ''}${layer.pitchShift.toFixed(1)}, formant ${layer.formantShift > 0 ? '+' : ''}${layer.formantShift.toFixed(1)}, brightness ${layer.brightness > 0 ? '+' : ''}${layer.brightness}dB`);

            let processed: Float32Array = Float32Array.from(leadVocal);

            // 1. Pitch shift
            if (Math.abs(layer.pitchShift) > 0.01) {
                processed = Float32Array.from(this.pitchShifter.shift(processed, layer.pitchShift));
            }

            // 2. Formant shift (character change)
            if (Math.abs(layer.formantShift) > 0.1) {
                processed = Float32Array.from(this.pitchShifter.shiftFormant(processed, layer.formantShift));
            }

            // 3. Saturation
            if (layer.saturation > 0.01) {
                processed = Float32Array.from(this.character.applySaturation(processed, layer.saturation));
            }

            // 4. Brightness/darkness
            if (layer.brightness > 1) {
                processed = Float32Array.from(this.character.applyBrightness(processed, layer.brightness));
            } else if (layer.brightness < -1) {
                const cutoff = 8000 * Math.pow(10, layer.brightness / 20);
                processed = Float32Array.from(this.character.applyDarkness(processed, Math.max(2000, cutoff)));
            }

            // 5. Time delay
            if (layer.delayMs > 0) {
                processed = Float32Array.from(this.character.applyDelay(processed, layer.delayMs));
            }

            // 6. Apply gain and add to output
            for (let i = 0; i < output.length && i < processed.length; i++) {
                let gain = layer.gain;

                // Apply chorus mask if provided (backing only on chorus)
                if (chorusMask && i < chorusMask.length) {
                    gain *= chorusMask[i];
                }

                output[i] += processed[i] * gain;
            }
        }

        return output;
    }
}

export const pitchShifter = new PitchShifter();
export const backingVocalsGenerator = new BackingVocalsGenerator();

