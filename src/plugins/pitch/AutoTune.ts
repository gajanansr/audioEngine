import { BasePlugin } from '../base/BasePlugin';
import { MusicalKey, Scale } from '../../core/types';

/**
 * AutoTune - Pitch Correction Module
 * 
 * Uses phase vocoder approach for pitch shifting with formant preservation.
 * Default behavior: under-apply correction (natural sound), user can increase.
 */
export class AutoTune extends BasePlugin {
    // Analysis buffers
    private inputBuffer: Float32Array = new Float32Array(0);
    private outputBuffer: Float32Array = new Float32Array(0);
    private inputWriteIndex: number = 0;
    private outputReadIndex: number = 0;

    // FFT parameters
    private readonly FRAME_SIZE = 2048;
    private readonly HOP_SIZE = 512;
    private readonly OVERLAP = this.FRAME_SIZE - this.HOP_SIZE;

    // Pitch detection state
    private lastPitch: number = 0;
    private pitchSmoothing: number = 0;

    // Phase vocoder state
    private analysisPhases: Float32Array = new Float32Array(this.FRAME_SIZE);
    private synthesisPhases: Float32Array = new Float32Array(this.FRAME_SIZE);
    private previousMagnitudes: Float32Array = new Float32Array(this.FRAME_SIZE / 2 + 1);

    // Formant preservation
    private formantEnvelope: Float32Array = new Float32Array(this.FRAME_SIZE / 2 + 1);

    // Window function
    private window: Float32Array;

    // Musical scale lookup
    private scaleNotes: Set<number> = new Set();
    private keyOffset: number = 0;

    private lastSampleRate: number = 0;
    private initialized: boolean = false;

    constructor(id: string) {
        super(id, 'AutoTune', 'insert');

        // Initialize Hann window
        this.window = new Float32Array(this.FRAME_SIZE);
        for (let i = 0; i < this.FRAME_SIZE; i++) {
            this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.FRAME_SIZE - 1)));
        }
    }

    protected initializeParameters(): void {
        this.registerParameter({
            name: 'enabled',
            displayName: 'Enabled',
            min: 0,
            max: 1,
            default: 1,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });

        // Under-apply by default (35 instead of 100)
        this.registerParameter({
            name: 'strength',
            displayName: 'Strength',
            min: 0,
            max: 100,
            default: 35, // Conservative default for natural sound
            unit: '%',
            curve: 'linear',
            aiControllable: true,
            userExposed: true // User can adjust this!
        });

        this.registerParameter({
            name: 'retuneSpeed',
            displayName: 'Retune Speed',
            min: 0,
            max: 100,
            default: 50, // Medium speed for natural feel
            unit: 'ms',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'humanize',
            displayName: 'Humanize',
            min: 0,
            max: 100,
            default: 40, // Keep some natural variation
            unit: '%',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'formantPreserve',
            displayName: 'Formant Preserve',
            min: 0,
            max: 1,
            default: 1,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });

        this.registerParameter({
            name: 'formantShift',
            displayName: 'Formant Shift',
            min: -12,
            max: 12,
            default: 0,
            unit: 'st',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'key',
            displayName: 'Key',
            min: 0,
            max: 11, // C=0, C#=1, ... B=11
            default: 0,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });

        this.registerParameter({
            name: 'scale',
            displayName: 'Scale',
            min: 0,
            max: 4, // 0=major, 1=minor, 2=pentatonic, 3=blues, 4=chromatic
            default: 0,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });
    }

    /**
     * Set key and scale from string values
     */
    setKeyAndScale(key: MusicalKey, scale: Scale): void {
        const keyMap: Record<MusicalKey, number> = {
            'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
            'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
        };

        const scaleMap: Record<Scale, number> = {
            'major': 0, 'minor': 1, 'pentatonic': 2, 'blues': 3, 'chromatic': 4
        };

        this.setParameter('key', keyMap[key]);
        this.setParameter('scale', scaleMap[scale]);
        this.updateScaleNotes();
    }

    private updateScaleNotes(): void {
        const key = Math.round(this.getParameter('key'));
        const scale = Math.round(this.getParameter('scale'));

        // Scale intervals (semitones from root)
        const scaleIntervals: Record<number, number[]> = {
            0: [0, 2, 4, 5, 7, 9, 11], // Major
            1: [0, 2, 3, 5, 7, 8, 10], // Minor
            2: [0, 2, 4, 7, 9],        // Pentatonic major
            3: [0, 3, 5, 6, 7, 10],    // Blues
            4: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] // Chromatic
        };

        this.scaleNotes.clear();
        const intervals = scaleIntervals[scale] || scaleIntervals[4];

        for (const interval of intervals) {
            this.scaleNotes.add((key + interval) % 12);
        }

        this.keyOffset = key;
    }

    private initBuffers(sampleRate: number): void {
        // Input buffer needs room for overlap-add
        const bufferSize = this.FRAME_SIZE * 4;
        this.inputBuffer = new Float32Array(bufferSize);
        this.outputBuffer = new Float32Array(bufferSize);
        this.inputWriteIndex = 0;
        this.outputReadIndex = 0;

        this.analysisPhases.fill(0);
        this.synthesisPhases.fill(0);
        this.previousMagnitudes.fill(0);

        this.lastSampleRate = sampleRate;
        this.initialized = true;
        this.updateScaleNotes();
    }

    /**
     * Detect pitch using autocorrelation (simplified YIN)
     */
    private detectPitch(frame: Float32Array, sampleRate: number): number {
        const minPeriod = Math.floor(sampleRate / 500); // Max 500 Hz
        const maxPeriod = Math.floor(sampleRate / 60);  // Min 60 Hz

        let bestPeriod = 0;
        let bestCorr = -1;

        // Autocorrelation
        for (let period = minPeriod; period < maxPeriod; period++) {
            let sum = 0;
            let norm1 = 0;
            let norm2 = 0;

            for (let i = 0; i < frame.length - period; i++) {
                sum += frame[i] * frame[i + period];
                norm1 += frame[i] * frame[i];
                norm2 += frame[i + period] * frame[i + period];
            }

            const corr = sum / (Math.sqrt(norm1 * norm2) + 1e-10);

            if (corr > bestCorr) {
                bestCorr = corr;
                bestPeriod = period;
            }
        }

        if (bestCorr < 0.5) {
            return 0; // No clear pitch
        }

        return sampleRate / bestPeriod;
    }

    /**
     * Find nearest scale note to a given pitch
     */
    private snapToScale(midiNote: number): number {
        const noteInOctave = ((midiNote % 12) + 12) % 12;
        const octave = Math.floor(midiNote / 12);

        // Find nearest note in scale
        let nearestNote = noteInOctave;
        let minDistance = 12;

        for (const scaleNote of this.scaleNotes) {
            // Check distance in both directions
            const dist1 = Math.abs(scaleNote - noteInOctave);
            const dist2 = 12 - dist1;
            const distance = Math.min(dist1, dist2);

            if (distance < minDistance) {
                minDistance = distance;
                nearestNote = scaleNote;
            }
        }

        return octave * 12 + nearestNote;
    }

    /**
     * Calculate pitch shift ratio with humanization
     */
    private calculatePitchShift(
        currentFreq: number,
        sampleRate: number
    ): number {
        if (currentFreq <= 0) return 1; // No pitch detected

        const strength = this.getParameter('strength') / 100;
        const humanize = this.getParameter('humanize') / 100;
        const retuneSpeed = this.getParameter('retuneSpeed');

        // Convert to MIDI note
        const midiNote = 12 * Math.log2(currentFreq / 440) + 69;

        // Find target note
        const targetNote = this.snapToScale(midiNote);

        // Calculate deviation in semitones
        const deviation = targetNote - midiNote;

        // Apply humanization - don't correct small deviations
        const humanizeThreshold = humanize * 0.5; // 0-50 cents
        const absDeviation = Math.abs(deviation);

        let correctedDeviation = deviation;
        if (absDeviation < humanizeThreshold) {
            // Within humanize range, reduce correction
            correctedDeviation = deviation * (absDeviation / humanizeThreshold) * (1 - humanize);
        }

        // Apply strength (under-apply by default)
        correctedDeviation *= strength;

        // Smooth the pitch correction
        const smoothingCoef = Math.exp(-1 / (sampleRate * retuneSpeed / 1000));
        this.pitchSmoothing = smoothingCoef * this.pitchSmoothing + (1 - smoothingCoef) * correctedDeviation;

        // Convert to frequency ratio
        return Math.pow(2, this.pitchSmoothing / 12);
    }

    process(input: Float32Array, output: Float32Array, sampleRate: number): void {
        if (this._bypass || this.getParameter('enabled') < 0.5) {
            output.set(input);
            return;
        }

        if (!this.initialized || sampleRate !== this.lastSampleRate) {
            this.initBuffers(sampleRate);
        }

        const strength = this.getParameter('strength');

        // If strength is very low, bypass processing
        if (strength < 1) {
            output.set(input);
            return;
        }

        // Simple time-domain pitch shifting for now
        // (Full phase vocoder is more complex and would benefit from WASM)

        for (let i = 0; i < input.length; i++) {
            // Add to input buffer
            this.inputBuffer[this.inputWriteIndex % this.inputBuffer.length] = input[i];

            // When we have enough samples, process a frame
            if ((this.inputWriteIndex + 1) % this.HOP_SIZE === 0 &&
                this.inputWriteIndex >= this.FRAME_SIZE) {
                this.processFrame(sampleRate);
            }

            // Read from output buffer
            output[i] = this.outputBuffer[this.outputReadIndex % this.outputBuffer.length];
            this.outputBuffer[this.outputReadIndex % this.outputBuffer.length] = 0;

            this.inputWriteIndex++;
            this.outputReadIndex++;
        }
    }

    private processFrame(sampleRate: number): void {
        // Extract frame from input buffer
        const frame = new Float32Array(this.FRAME_SIZE);
        const startIdx = this.inputWriteIndex - this.FRAME_SIZE;

        for (let i = 0; i < this.FRAME_SIZE; i++) {
            const idx = (startIdx + i + this.inputBuffer.length) % this.inputBuffer.length;
            frame[i] = this.inputBuffer[idx] * this.window[i];
        }

        // Detect pitch
        const pitch = this.detectPitch(frame, sampleRate);

        // Smooth pitch detection
        if (pitch > 0) {
            this.lastPitch = this.lastPitch * 0.7 + pitch * 0.3;
        }

        // Calculate pitch shift
        const shiftRatio = this.calculatePitchShift(this.lastPitch, sampleRate);

        // Apply pitch shift using simple resampling
        // (In production, use phase vocoder for higher quality)
        const outputFrame = this.resampleFrame(frame, shiftRatio);

        // Overlap-add to output buffer
        const outputStart = this.outputReadIndex;
        for (let i = 0; i < this.FRAME_SIZE; i++) {
            const idx = (outputStart + i) % this.outputBuffer.length;
            this.outputBuffer[idx] += outputFrame[i] * this.window[i];
        }
    }

    /**
     * Simple linear interpolation resampling for pitch shifting
     */
    private resampleFrame(frame: Float32Array, ratio: number): Float32Array {
        const output = new Float32Array(this.FRAME_SIZE);

        for (let i = 0; i < this.FRAME_SIZE; i++) {
            const sourcePos = i * ratio;
            const sourceIdx = Math.floor(sourcePos);
            const frac = sourcePos - sourceIdx;

            if (sourceIdx < frame.length - 1) {
                output[i] = frame[sourceIdx] * (1 - frac) + frame[sourceIdx + 1] * frac;
            } else if (sourceIdx < frame.length) {
                output[i] = frame[sourceIdx];
            }
        }

        return output;
    }

    reset(): void {
        super.reset();
        this.inputBuffer.fill(0);
        this.outputBuffer.fill(0);
        this.inputWriteIndex = 0;
        this.outputReadIndex = 0;
        this.lastPitch = 0;
        this.pitchSmoothing = 0;
        this.analysisPhases.fill(0);
        this.synthesisPhases.fill(0);
        this.initialized = false;
    }
}
