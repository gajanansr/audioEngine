import { BasePlugin } from '../base/BasePlugin';

/**
 * Brickwall Limiter
 * True-peak limiting with lookahead for professional mastering
 */
export class Limiter extends BasePlugin {
    // Lookahead buffer for true-peak detection
    private lookAheadBuffer: Float32Array = new Float32Array(0);
    private lookAheadIndex: number = 0;
    private lookAheadSamples: number = 0;

    // Gain smoothing
    private currentGain: number = 1;
    private targetGain: number = 1;

    // Attack/release envelope
    private envelope: number = 0;

    // Metering
    private gainReduction: number = 0;
    private truePeak: number = 0;

    constructor(id: string) {
        super(id, 'Limiter', 'insert');
    }

    protected initializeParameters(): void {
        this.registerParameter({
            name: 'threshold',
            displayName: 'Threshold',
            min: -20,
            max: 0,
            default: -1,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'ceiling',
            displayName: 'Ceiling',
            min: -6,
            max: 0,
            default: -1,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'release',
            displayName: 'Release',
            min: 10,
            max: 500,
            default: 100,
            unit: 'ms',
            curve: 'exponential',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'lookAhead',
            displayName: 'Look Ahead',
            min: 0,
            max: 10,
            default: 5,
            unit: 'ms',
            curve: 'linear',
            aiControllable: false,
            userExposed: false
        });

        this.registerParameter({
            name: 'autoGain',
            displayName: 'Auto Gain',
            min: 0,
            max: 1,
            default: 1,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });
    }

    private initLookAheadBuffer(sampleRate: number): void {
        const lookAheadMs = this.getParameter('lookAhead');
        this.lookAheadSamples = Math.floor(sampleRate * lookAheadMs / 1000);

        if (this.lookAheadBuffer.length !== this.lookAheadSamples) {
            this.lookAheadBuffer = new Float32Array(this.lookAheadSamples);
            this.lookAheadIndex = 0;
        }
    }

    process(input: Float32Array, output: Float32Array, sampleRate: number): void {
        if (this._bypass) {
            output.set(input);
            return;
        }

        this.initLookAheadBuffer(sampleRate);

        const threshold = this.getParameter('threshold');
        const ceiling = this.getParameter('ceiling');
        const release = this.getParameter('release');
        const autoGain = this.getParameter('autoGain') > 0.5;

        const thresholdLinear = this.dbToGain(threshold);
        const ceilingLinear = this.dbToGain(ceiling);

        // Auto-gain compensates for threshold
        const makeupGain = autoGain ? this.dbToGain(-threshold) : 1;

        // Release coefficient
        const releaseCoef = Math.exp(-1 / (sampleRate * release / 1000));
        // Fast attack (essentially instant for limiting)
        const attackCoef = Math.exp(-1 / (sampleRate * 0.001));

        for (let i = 0; i < input.length; i++) {
            // Apply makeup gain
            let sample = input[i] * makeupGain;

            // True peak detection with lookahead
            const absLevel = Math.abs(sample);

            // Update envelope (fast attack, slower release)
            if (absLevel > this.envelope) {
                this.envelope = attackCoef * this.envelope + (1 - attackCoef) * absLevel;
            } else {
                this.envelope = releaseCoef * this.envelope + (1 - releaseCoef) * absLevel;
            }

            // Calculate required gain reduction
            if (this.envelope > thresholdLinear) {
                this.targetGain = thresholdLinear / this.envelope;
            } else {
                this.targetGain = 1;
            }

            // Smooth gain changes
            this.currentGain = releaseCoef * this.currentGain + (1 - releaseCoef) * this.targetGain;

            // If using lookahead, delay the signal
            if (this.lookAheadSamples > 0) {
                const delayedSample = this.lookAheadBuffer[this.lookAheadIndex];
                this.lookAheadBuffer[this.lookAheadIndex] = sample;
                this.lookAheadIndex = (this.lookAheadIndex + 1) % this.lookAheadSamples;
                sample = delayedSample;
            }

            // Apply gain reduction
            sample *= this.currentGain;

            // Hard clip at ceiling (safety)
            if (Math.abs(sample) > ceilingLinear) {
                sample = Math.sign(sample) * ceilingLinear;
            }

            output[i] = sample;

            // Update metering
            this.gainReduction = Math.max(this.gainReduction * 0.999, 1 - this.currentGain);
            this.truePeak = Math.max(this.truePeak * 0.9999, Math.abs(sample));
        }
    }

    /**
     * Get current gain reduction in dB (for metering)
     */
    getGainReduction(): number {
        return this.gainToDb(1 - this.gainReduction);
    }

    /**
     * Get current true peak level in dB
     */
    getTruePeak(): number {
        return this.gainToDb(this.truePeak);
    }

    reset(): void {
        super.reset();
        this.lookAheadBuffer.fill(0);
        this.lookAheadIndex = 0;
        this.currentGain = 1;
        this.targetGain = 1;
        this.envelope = 0;
        this.gainReduction = 0;
        this.truePeak = 0;
    }
}
