import { BasePlugin } from '../base/BasePlugin';

/**
 * Algorithmic Reverb
 * Plate/Room/Hall simulation with pre-delay and damping
 */
export class Reverb extends BasePlugin {
    // Comb filter delays (in samples at 44100 Hz)
    private static readonly COMB_DELAYS = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116];
    private static readonly AP_DELAYS = [225, 556, 441, 341];

    // Comb filters
    private combBuffers: Float32Array[] = [];
    private combIndices: number[] = [];
    private combFeedback: number[] = [];

    // All-pass filters
    private apBuffers: Float32Array[] = [];
    private apIndices: number[] = [];

    // Pre-delay buffer
    private preDelayBuffer: Float32Array = new Float32Array(0);
    private preDelayIndex: number = 0;
    private preDelaySamples: number = 0;

    // Damping filter state
    private dampState: number[] = [];

    // Current sample rate
    private lastSampleRate: number = 0;

    constructor(id: string) {
        super(id, 'Reverb', 'send');
    }

    protected initializeParameters(): void {
        this.registerParameter({
            name: 'type',
            displayName: 'Type',
            min: 0,
            max: 2,
            default: 0, // 0=plate, 1=room, 2=hall
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });

        this.registerParameter({
            name: 'preDelay',
            displayName: 'Pre-Delay',
            min: 0,
            max: 200,
            default: 50,
            unit: 'ms',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'decay',
            displayName: 'Decay',
            min: 0.1,
            max: 10,
            default: 2.0,
            unit: 's',
            curve: 'exponential',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'damping',
            displayName: 'Damping',
            min: 0,
            max: 1,
            default: 0.5,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'wetLevel',
            displayName: 'Wet',
            min: 0,
            max: 100,
            default: 20,
            unit: '%',
            curve: 'linear',
            aiControllable: true,
            userExposed: true
        });

        this.registerParameter({
            name: 'dryLevel',
            displayName: 'Dry',
            min: 0,
            max: 100,
            default: 100,
            unit: '%',
            curve: 'linear',
            aiControllable: true,
            userExposed: true
        });

        this.registerParameter({
            name: 'width',
            displayName: 'Width',
            min: 0,
            max: 100,
            default: 100,
            unit: '%',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });
    }

    private initBuffers(sampleRate: number): void {
        const srRatio = sampleRate / 44100;

        // Initialize comb filters
        this.combBuffers = [];
        this.combIndices = [];
        this.combFeedback = [];
        this.dampState = [];

        for (let i = 0; i < Reverb.COMB_DELAYS.length; i++) {
            const size = Math.floor(Reverb.COMB_DELAYS[i] * srRatio);
            this.combBuffers.push(new Float32Array(size));
            this.combIndices.push(0);
            this.combFeedback.push(0);
            this.dampState.push(0);
        }

        // Initialize all-pass filters
        this.apBuffers = [];
        this.apIndices = [];

        for (let i = 0; i < Reverb.AP_DELAYS.length; i++) {
            const size = Math.floor(Reverb.AP_DELAYS[i] * srRatio);
            this.apBuffers.push(new Float32Array(size));
            this.apIndices.push(0);
        }

        // Pre-delay buffer (max 200ms)
        const maxPreDelay = Math.floor(sampleRate * 0.2);
        this.preDelayBuffer = new Float32Array(maxPreDelay);
        this.preDelayIndex = 0;

        this.lastSampleRate = sampleRate;
    }

    private updateParameters(sampleRate: number): void {
        const type = Math.round(this.getParameter('type'));
        const decay = this.getParameter('decay');

        // Type-specific decay scaling
        let decayScale = 1;
        switch (type) {
            case 0: // Plate - shorter, brighter
                decayScale = 0.8;
                break;
            case 1: // Room - medium
                decayScale = 1.0;
                break;
            case 2: // Hall - longer, darker
                decayScale = 1.3;
                break;
        }

        // Calculate feedback for each comb filter based on decay time
        for (let i = 0; i < this.combBuffers.length; i++) {
            const delaySamples = this.combBuffers[i].length;
            const rt60 = decay * decayScale;
            // Feedback = 10^(-3 * delay / RT60)
            this.combFeedback[i] = Math.pow(10, -3 * delaySamples / (rt60 * sampleRate));
        }

        // Update pre-delay
        const preDelayMs = this.getParameter('preDelay');
        this.preDelaySamples = Math.floor(sampleRate * preDelayMs / 1000);
    }

    process(input: Float32Array, output: Float32Array, sampleRate: number): void {
        if (this._bypass) {
            output.set(input);
            return;
        }

        // Initialize if needed
        if (sampleRate !== this.lastSampleRate) {
            this.initBuffers(sampleRate);
        }

        this.updateParameters(sampleRate);

        const damping = this.getParameter('damping');
        const wetLevel = this.getParameter('wetLevel') / 100;
        const dryLevel = this.getParameter('dryLevel') / 100;

        const dampCoef = damping * 0.4;
        const apFeedback = 0.5;

        for (let i = 0; i < input.length; i++) {
            const dry = input[i];

            // Pre-delay
            let delayed: number;
            if (this.preDelaySamples > 0) {
                const readIndex = (this.preDelayIndex - this.preDelaySamples + this.preDelayBuffer.length) % this.preDelayBuffer.length;
                delayed = this.preDelayBuffer[readIndex];
                this.preDelayBuffer[this.preDelayIndex] = dry;
                this.preDelayIndex = (this.preDelayIndex + 1) % this.preDelayBuffer.length;
            } else {
                delayed = dry;
            }

            // Parallel comb filters
            let combSum = 0;
            for (let c = 0; c < this.combBuffers.length; c++) {
                const buffer = this.combBuffers[c];
                const idx = this.combIndices[c];

                // Read from delay
                let out = buffer[idx];

                // Apply damping (low-pass)
                this.dampState[c] = out * (1 - dampCoef) + this.dampState[c] * dampCoef;

                // Write to delay with feedback
                buffer[idx] = delayed + this.dampState[c] * this.combFeedback[c];

                // Advance index
                this.combIndices[c] = (idx + 1) % buffer.length;

                combSum += out;
            }

            // Scale comb output
            let reverbOut = combSum / this.combBuffers.length;

            // Series all-pass filters for diffusion
            for (let a = 0; a < this.apBuffers.length; a++) {
                const buffer = this.apBuffers[a];
                const idx = this.apIndices[a];

                const bufOut = buffer[idx];
                buffer[idx] = reverbOut + bufOut * apFeedback;
                reverbOut = bufOut - reverbOut * apFeedback;

                this.apIndices[a] = (idx + 1) % buffer.length;
            }

            // Mix dry and wet
            output[i] = dry * dryLevel + reverbOut * wetLevel;
        }
    }

    reset(): void {
        super.reset();
        for (const buffer of this.combBuffers) {
            buffer.fill(0);
        }
        for (const buffer of this.apBuffers) {
            buffer.fill(0);
        }
        this.preDelayBuffer.fill(0);
        this.combIndices.fill(0);
        this.apIndices.fill(0);
        this.dampState.fill(0);
        this.preDelayIndex = 0;
    }
}
