import { BasePlugin } from '../base/BasePlugin';

/**
 * Dynamic Range Compressor
 * Implements both leveling (slow) and control (fast) compression modes
 */
export class Compressor extends BasePlugin {
    private envelope: number = 0;
    private gainReduction: number = 0;

    constructor(id: string, mode: 'leveling' | 'control' = 'leveling') {
        super(id, `Compressor (${mode})`, 'insert');

        // Set mode-specific defaults after initialization
        if (mode === 'leveling') {
            this.setParameter('threshold', -18);
            this.setParameter('ratio', 2);
            this.setParameter('attack', 30);
            this.setParameter('release', 200);
        } else {
            this.setParameter('threshold', -12);
            this.setParameter('ratio', 4);
            this.setParameter('attack', 5);
            this.setParameter('release', 50);
        }
    }

    protected initializeParameters(): void {
        this.registerParameter({
            name: 'threshold',
            displayName: 'Threshold',
            min: -60,
            max: 0,
            default: -18,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'ratio',
            displayName: 'Ratio',
            min: 1,
            max: 20,
            default: 4,
            unit: ':1',
            curve: 'logarithmic',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'attack',
            displayName: 'Attack',
            min: 0.1,
            max: 100,
            default: 10,
            unit: 'ms',
            curve: 'exponential',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'release',
            displayName: 'Release',
            min: 10,
            max: 1000,
            default: 100,
            unit: 'ms',
            curve: 'exponential',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'knee',
            displayName: 'Knee',
            min: 0,
            max: 20,
            default: 6,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'makeupGain',
            displayName: 'Makeup Gain',
            min: 0,
            max: 24,
            default: 0,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });
    }

    process(input: Float32Array, output: Float32Array, sampleRate: number): void {
        if (this._bypass) {
            output.set(input);
            return;
        }

        const threshold = this.getParameter('threshold');
        const ratio = this.getParameter('ratio');
        const attack = this.getParameter('attack');
        const release = this.getParameter('release');
        const knee = this.getParameter('knee');
        const makeupGain = this.dbToGain(this.getParameter('makeupGain'));

        // Calculate coefficients
        const attackCoef = Math.exp(-1 / (sampleRate * attack / 1000));
        const releaseCoef = Math.exp(-1 / (sampleRate * release / 1000));

        for (let i = 0; i < input.length; i++) {
            const inputSample = input[i];
            const inputLevel = Math.abs(inputSample);
            const inputDb = this.gainToDb(inputLevel);

            // Envelope follower
            const coef = inputLevel > this.envelope ? attackCoef : releaseCoef;
            this.envelope = coef * this.envelope + (1 - coef) * inputLevel;
            const envelopeDb = this.gainToDb(this.envelope);

            // Gain computation with soft knee
            let gainDb = 0;
            if (envelopeDb < threshold - knee / 2) {
                // Below knee: no compression
                gainDb = 0;
            } else if (envelopeDb > threshold + knee / 2) {
                // Above knee: full compression
                gainDb = (threshold - envelopeDb) * (1 - 1 / ratio);
            } else {
                // In knee: quadratic interpolation
                const kneeRange = envelopeDb - threshold + knee / 2;
                gainDb = (1 / ratio - 1) * Math.pow(kneeRange, 2) / (2 * knee);
            }

            // Apply gain
            const gain = this.dbToGain(gainDb) * makeupGain;
            output[i] = inputSample * gain;

            // Track gain reduction for metering
            this.gainReduction = -gainDb;
        }
    }

    /**
     * Get current gain reduction in dB (for metering)
     */
    getGainReduction(): number {
        return this.gainReduction;
    }

    reset(): void {
        super.reset();
        this.envelope = 0;
        this.gainReduction = 0;
    }
}
