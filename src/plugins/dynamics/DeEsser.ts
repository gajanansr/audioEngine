import { BasePlugin } from '../base/BasePlugin';

/**
 * Frequency-Selective De-Esser
 * Reduces sibilance in the 5-8kHz range without affecting overall tonality
 */
export class DeEsser extends BasePlugin {
    // Biquad filter state for sidechain (bandpass)
    private scX1: number = 0;
    private scX2: number = 0;
    private scY1: number = 0;
    private scY2: number = 0;

    // Biquad filter state for processing (notch/bell)
    private procX1: number = 0;
    private procX2: number = 0;
    private procY1: number = 0;
    private procY2: number = 0;

    // Filter coefficients
    private scB0: number = 0;
    private scB1: number = 0;
    private scB2: number = 0;
    private scA1: number = 0;
    private scA2: number = 0;

    // Envelope
    private envelope: number = 0;
    private gainReduction: number = 0;

    private lastSampleRate: number = 0;

    constructor(id: string) {
        super(id, 'De-Esser', 'insert');
    }

    protected initializeParameters(): void {
        this.registerParameter({
            name: 'frequency',
            displayName: 'Frequency',
            min: 4000,
            max: 10000,
            default: 6500,
            unit: 'Hz',
            curve: 'logarithmic',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'threshold',
            displayName: 'Threshold',
            min: -40,
            max: 0,
            default: -20,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'ratio',
            displayName: 'Ratio',
            min: 1,
            max: 10,
            default: 4,
            unit: ':1',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'range',
            displayName: 'Range',
            min: 0,
            max: 20,
            default: 10,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'bandwidth',
            displayName: 'Bandwidth',
            min: 0.5,
            max: 4,
            default: 2,
            unit: 'oct',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'listenMode',
            displayName: 'Listen',
            min: 0,
            max: 1,
            default: 0,
            unit: '',
            curve: 'linear',
            aiControllable: false,
            userExposed: false,
            step: 1
        });
    }

    protected onParameterChange(name: string, value: number): void {
        // Recalculate coefficients when frequency or bandwidth changes
        if (name === 'frequency' || name === 'bandwidth') {
            if (this.lastSampleRate > 0) {
                this.calculateCoefficients(this.lastSampleRate);
            }
        }
    }

    private calculateCoefficients(sampleRate: number): void {
        const frequency = this.getParameter('frequency');
        const bandwidth = this.getParameter('bandwidth');

        // Calculate bandpass filter for sidechain
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega * Math.sinh(Math.LN2 / 2 * bandwidth * omega / sinOmega);

        // Bandpass filter coefficients (constant 0 dB peak gain)
        const b0 = alpha;
        const b1 = 0;
        const b2 = -alpha;
        const a0 = 1 + alpha;
        const a1 = -2 * cosOmega;
        const a2 = 1 - alpha;

        // Normalize
        this.scB0 = b0 / a0;
        this.scB1 = b1 / a0;
        this.scB2 = b2 / a0;
        this.scA1 = a1 / a0;
        this.scA2 = a2 / a0;

        this.lastSampleRate = sampleRate;
    }

    process(input: Float32Array, output: Float32Array, sampleRate: number): void {
        if (this._bypass) {
            output.set(input);
            return;
        }

        // Recalculate coefficients if sample rate changed
        if (sampleRate !== this.lastSampleRate) {
            this.calculateCoefficients(sampleRate);
        }

        const threshold = this.getParameter('threshold');
        const ratio = this.getParameter('ratio');
        const range = this.getParameter('range');
        const listenMode = this.getParameter('listenMode') > 0.5;

        // Fast attack, medium release for sibilance
        const attackCoef = Math.exp(-1 / (sampleRate * 0.001)); // 1ms
        const releaseCoef = Math.exp(-1 / (sampleRate * 0.05)); // 50ms

        for (let i = 0; i < input.length; i++) {
            const inputSample = input[i];

            // Sidechain: bandpass filter to isolate sibilance
            const scFiltered = this.scB0 * inputSample
                + this.scB1 * this.scX1
                + this.scB2 * this.scX2
                - this.scA1 * this.scY1
                - this.scA2 * this.scY2;

            this.scX2 = this.scX1;
            this.scX1 = inputSample;
            this.scY2 = this.scY1;
            this.scY1 = scFiltered;

            // Listen mode: output only the sidechain
            if (listenMode) {
                output[i] = scFiltered;
                continue;
            }

            // Envelope follower on sidechain
            const scLevel = Math.abs(scFiltered);
            const coef = scLevel > this.envelope ? attackCoef : releaseCoef;
            this.envelope = coef * this.envelope + (1 - coef) * scLevel;
            const envelopeDb = this.gainToDb(this.envelope);

            // Calculate gain reduction
            let gainDb = 0;
            if (envelopeDb > threshold) {
                const excess = envelopeDb - threshold;
                gainDb = -Math.min(excess * (1 - 1 / ratio), range);
            }

            // Apply gain reduction to full signal
            // NOTE: For a more transparent de-esser, you could apply
            // reduction only to the high-frequency band using a 
            // multiband approach. This is the simpler wideband version.
            const gain = this.dbToGain(gainDb);
            output[i] = inputSample * gain;

            this.gainReduction = -gainDb;
        }
    }

    getGainReduction(): number {
        return this.gainReduction;
    }

    reset(): void {
        super.reset();
        this.scX1 = this.scX2 = this.scY1 = this.scY2 = 0;
        this.procX1 = this.procX2 = this.procY1 = this.procY2 = 0;
        this.envelope = 0;
        this.gainReduction = 0;
    }
}
