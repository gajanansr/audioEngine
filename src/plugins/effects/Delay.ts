import { BasePlugin } from '../base/BasePlugin';

/**
 * Stereo Delay
 * Slapback and rhythmic delay with high-cut filter
 */
export class Delay extends BasePlugin {
    // Delay buffers (max 2 seconds)
    private leftBuffer: Float32Array = new Float32Array(0);
    private rightBuffer: Float32Array = new Float32Array(0);
    private writeIndex: number = 0;

    // High-cut filter state
    private filterStateL: number = 0;
    private filterStateR: number = 0;

    private lastSampleRate: number = 0;

    constructor(id: string) {
        super(id, 'Delay', 'send');
    }

    protected initializeParameters(): void {
        this.registerParameter({
            name: 'time',
            displayName: 'Time',
            min: 10,
            max: 2000,
            default: 250,
            unit: 'ms',
            curve: 'exponential',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'feedback',
            displayName: 'Feedback',
            min: 0,
            max: 95,
            default: 30,
            unit: '%',
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
            userExposed: false
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
            userExposed: false
        });

        this.registerParameter({
            name: 'highCut',
            displayName: 'High Cut',
            min: 1000,
            max: 20000,
            default: 5000,
            unit: 'Hz',
            curve: 'logarithmic',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'stereoOffset',
            displayName: 'Stereo',
            min: 0,
            max: 50,
            default: 10,
            unit: 'ms',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'pingPong',
            displayName: 'Ping Pong',
            min: 0,
            max: 1,
            default: 0,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });
    }

    private initBuffers(sampleRate: number): void {
        // Max 2 seconds of delay
        const maxSamples = Math.floor(sampleRate * 2);

        if (this.leftBuffer.length !== maxSamples) {
            this.leftBuffer = new Float32Array(maxSamples);
            this.rightBuffer = new Float32Array(maxSamples);
            this.writeIndex = 0;
        }

        this.lastSampleRate = sampleRate;
    }

    process(input: Float32Array, output: Float32Array, sampleRate: number): void {
        if (this._bypass) {
            output.set(input);
            return;
        }

        // Initialize buffers if needed
        if (sampleRate !== this.lastSampleRate) {
            this.initBuffers(sampleRate);
        }

        const delayMs = this.getParameter('time');
        const feedback = this.getParameter('feedback') / 100;
        const wetLevel = this.getParameter('wetLevel') / 100;
        const dryLevel = this.getParameter('dryLevel') / 100;
        const highCut = this.getParameter('highCut');
        const stereoOffsetMs = this.getParameter('stereoOffset');

        // Calculate delay in samples
        const delaySamples = Math.floor(sampleRate * delayMs / 1000);
        const stereoOffsetSamples = Math.floor(sampleRate * stereoOffsetMs / 1000);

        // High-cut filter coefficient (simple one-pole)
        const filterCoef = Math.exp(-2 * Math.PI * highCut / sampleRate);
        const bufferLength = this.leftBuffer.length;

        for (let i = 0; i < input.length; i++) {
            const dry = input[i]; // Mono input

            // Read from delay buffers
            const leftReadIndex = (this.writeIndex - delaySamples + bufferLength) % bufferLength;
            const rightReadIndex = (this.writeIndex - delaySamples - stereoOffsetSamples + bufferLength) % bufferLength;

            let delayedL = this.leftBuffer[leftReadIndex];
            let delayedR = this.rightBuffer[rightReadIndex];

            // Apply high-cut filter
            this.filterStateL = delayedL * (1 - filterCoef) + this.filterStateL * filterCoef;
            this.filterStateR = delayedR * (1 - filterCoef) + this.filterStateR * filterCoef;

            const filteredL = this.filterStateL;
            const filteredR = this.filterStateR;

            // Write to delay buffers with feedback
            this.leftBuffer[this.writeIndex] = dry + filteredL * feedback;
            this.rightBuffer[this.writeIndex] = dry + filteredR * feedback;

            // Advance write index
            this.writeIndex = (this.writeIndex + 1) % bufferLength;

            // Mix output (mono for now - could be stereo)
            output[i] = dry * dryLevel + (filteredL + filteredR) * 0.5 * wetLevel;
        }
    }

    /**
     * Process stereo (separate method for stereo chains)
     */
    processStereo(
        inputL: Float32Array,
        inputR: Float32Array,
        outputL: Float32Array,
        outputR: Float32Array,
        sampleRate: number
    ): void {
        if (this._bypass) {
            outputL.set(inputL);
            outputR.set(inputR);
            return;
        }

        if (sampleRate !== this.lastSampleRate) {
            this.initBuffers(sampleRate);
        }

        const delayMs = this.getParameter('time');
        const feedback = this.getParameter('feedback') / 100;
        const wetLevel = this.getParameter('wetLevel') / 100;
        const dryLevel = this.getParameter('dryLevel') / 100;
        const highCut = this.getParameter('highCut');
        const stereoOffsetMs = this.getParameter('stereoOffset');
        const pingPong = this.getParameter('pingPong') > 0.5;

        const delaySamples = Math.floor(sampleRate * delayMs / 1000);
        const stereoOffsetSamples = Math.floor(sampleRate * stereoOffsetMs / 1000);
        const filterCoef = Math.exp(-2 * Math.PI * highCut / sampleRate);
        const bufferLength = this.leftBuffer.length;

        for (let i = 0; i < inputL.length; i++) {
            const dryL = inputL[i];
            const dryR = inputR[i];

            const leftReadIndex = (this.writeIndex - delaySamples + bufferLength) % bufferLength;
            const rightReadIndex = (this.writeIndex - delaySamples - stereoOffsetSamples + bufferLength) % bufferLength;

            let delayedL = this.leftBuffer[leftReadIndex];
            let delayedR = this.rightBuffer[rightReadIndex];

            // High-cut filter
            this.filterStateL = delayedL * (1 - filterCoef) + this.filterStateL * filterCoef;
            this.filterStateR = delayedR * (1 - filterCoef) + this.filterStateR * filterCoef;

            const filteredL = this.filterStateL;
            const filteredR = this.filterStateR;

            // Write with feedback
            if (pingPong) {
                // Ping-pong: left feeds into right, right feeds into left
                this.leftBuffer[this.writeIndex] = dryL + filteredR * feedback;
                this.rightBuffer[this.writeIndex] = dryR + filteredL * feedback;
            } else {
                this.leftBuffer[this.writeIndex] = dryL + filteredL * feedback;
                this.rightBuffer[this.writeIndex] = dryR + filteredR * feedback;
            }

            this.writeIndex = (this.writeIndex + 1) % bufferLength;

            outputL[i] = dryL * dryLevel + filteredL * wetLevel;
            outputR[i] = dryR * dryLevel + filteredR * wetLevel;
        }
    }

    reset(): void {
        super.reset();
        this.leftBuffer.fill(0);
        this.rightBuffer.fill(0);
        this.writeIndex = 0;
        this.filterStateL = 0;
        this.filterStateR = 0;
    }
}
