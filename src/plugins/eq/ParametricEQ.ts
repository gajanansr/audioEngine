import { BasePlugin } from '../base/BasePlugin';
import { EQBand } from '../../core/types';

/**
 * Biquad Filter implementation for each EQ band
 */
class BiquadFilter {
    private b0: number = 1;
    private b1: number = 0;
    private b2: number = 0;
    private a1: number = 0;
    private a2: number = 0;

    private x1: number = 0;
    private x2: number = 0;
    private y1: number = 0;
    private y2: number = 0;

    /**
     * Calculate high-pass filter coefficients
     */
    setHighPass(frequency: number, q: number, sampleRate: number): void {
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / (2 * q);

        const b0 = (1 + cosOmega) / 2;
        const b1 = -(1 + cosOmega);
        const b2 = (1 + cosOmega) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosOmega;
        const a2 = 1 - alpha;

        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }

    /**
     * Calculate low-pass filter coefficients
     */
    setLowPass(frequency: number, q: number, sampleRate: number): void {
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / (2 * q);

        const b0 = (1 - cosOmega) / 2;
        const b1 = 1 - cosOmega;
        const b2 = (1 - cosOmega) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosOmega;
        const a2 = 1 - alpha;

        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }

    /**
     * Calculate peaking EQ filter coefficients
     */
    setPeak(frequency: number, gain: number, q: number, sampleRate: number): void {
        const A = Math.pow(10, gain / 40);
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / (2 * q);

        const b0 = 1 + alpha * A;
        const b1 = -2 * cosOmega;
        const b2 = 1 - alpha * A;
        const a0 = 1 + alpha / A;
        const a1 = -2 * cosOmega;
        const a2 = 1 - alpha / A;

        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }

    /**
     * Calculate high shelf filter coefficients
     */
    setHighShelf(frequency: number, gain: number, sampleRate: number): void {
        const A = Math.pow(10, gain / 40);
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / 2 * Math.sqrt((A + 1 / A) * 2);
        const sqrtA2Alpha = 2 * Math.sqrt(A) * alpha;

        const b0 = A * ((A + 1) + (A - 1) * cosOmega + sqrtA2Alpha);
        const b1 = -2 * A * ((A - 1) + (A + 1) * cosOmega);
        const b2 = A * ((A + 1) + (A - 1) * cosOmega - sqrtA2Alpha);
        const a0 = (A + 1) - (A - 1) * cosOmega + sqrtA2Alpha;
        const a1 = 2 * ((A - 1) - (A + 1) * cosOmega);
        const a2 = (A + 1) - (A - 1) * cosOmega - sqrtA2Alpha;

        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }

    /**
     * Calculate low shelf filter coefficients
     */
    setLowShelf(frequency: number, gain: number, sampleRate: number): void {
        const A = Math.pow(10, gain / 40);
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / 2 * Math.sqrt((A + 1 / A) * 2);
        const sqrtA2Alpha = 2 * Math.sqrt(A) * alpha;

        const b0 = A * ((A + 1) - (A - 1) * cosOmega + sqrtA2Alpha);
        const b1 = 2 * A * ((A - 1) - (A + 1) * cosOmega);
        const b2 = A * ((A + 1) - (A - 1) * cosOmega - sqrtA2Alpha);
        const a0 = (A + 1) + (A - 1) * cosOmega + sqrtA2Alpha;
        const a1 = -2 * ((A - 1) + (A + 1) * cosOmega);
        const a2 = (A + 1) + (A - 1) * cosOmega - sqrtA2Alpha;

        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }

    /**
     * Calculate notch filter coefficients
     */
    setNotch(frequency: number, q: number, sampleRate: number): void {
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / (2 * q);

        const b0 = 1;
        const b1 = -2 * cosOmega;
        const b2 = 1;
        const a0 = 1 + alpha;
        const a1 = -2 * cosOmega;
        const a2 = 1 - alpha;

        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }

    /**
     * Process a single sample
     */
    processSample(input: number): number {
        const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;

        this.x2 = this.x1;
        this.x1 = input;
        this.y2 = this.y1;
        this.y1 = output;

        return output;
    }

    reset(): void {
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
}

/**
 * Multi-stage high-pass filter for steeper slopes
 */
class CascadedHighPass {
    private stages: BiquadFilter[] = [];

    /**
     * Configure for specific slope (6, 12, 18, 24 dB/octave)
     */
    configure(frequency: number, slope: number, sampleRate: number): void {
        const numStages = Math.floor(slope / 6);
        this.stages = [];

        // Butterworth Q values for cascaded filters
        const qValues: Record<number, number[]> = {
            1: [0.7071],
            2: [0.7071, 0.7071],
            3: [0.5, 1.0, 0.5],
            4: [0.5412, 1.3065, 0.5412, 1.3065]
        };

        const qs = qValues[numStages] || [0.7071];

        for (let i = 0; i < numStages; i++) {
            const filter = new BiquadFilter();
            filter.setHighPass(frequency, qs[i % qs.length], sampleRate);
            this.stages.push(filter);
        }
    }

    processSample(input: number): number {
        let output = input;
        for (const stage of this.stages) {
            output = stage.processSample(output);
        }
        return output;
    }

    reset(): void {
        for (const stage of this.stages) {
            stage.reset();
        }
    }
}

/**
 * 8-Band Parametric EQ
 * Supports high-pass, low-pass, peak, shelf, and notch filter types
 */
export class ParametricEQ extends BasePlugin {
    private highPass: CascadedHighPass = new CascadedHighPass();
    private lowPass: BiquadFilter = new BiquadFilter();
    private bands: BiquadFilter[] = [];
    private lastSampleRate: number = 0;

    constructor(id: string) {
        super(id, 'Parametric EQ', 'insert');

        // Initialize 6 parametric bands
        for (let i = 0; i < 6; i++) {
            this.bands.push(new BiquadFilter());
        }
    }

    protected initializeParameters(): void {
        // High-pass filter
        this.registerParameter({
            name: 'hpfFrequency',
            displayName: 'HPF Freq',
            min: 20,
            max: 500,
            default: 80,
            unit: 'Hz',
            curve: 'logarithmic',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'hpfSlope',
            displayName: 'HPF Slope',
            min: 6,
            max: 24,
            default: 18,
            unit: 'dB/oct',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 6
        });

        this.registerParameter({
            name: 'hpfEnabled',
            displayName: 'HPF On',
            min: 0,
            max: 1,
            default: 1,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });

        // Low-pass filter
        this.registerParameter({
            name: 'lpfFrequency',
            displayName: 'LPF Freq',
            min: 1000,
            max: 20000,
            default: 18000,
            unit: 'Hz',
            curve: 'logarithmic',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'lpfEnabled',
            displayName: 'LPF On',
            min: 0,
            max: 1,
            default: 0,
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });

        // 6 parametric bands
        for (let i = 0; i < 6; i++) {
            this.registerParameter({
                name: `band${i}Frequency`,
                displayName: `Band ${i + 1} Freq`,
                min: 20,
                max: 20000,
                default: [100, 300, 1000, 3000, 8000, 12000][i],
                unit: 'Hz',
                curve: 'logarithmic',
                aiControllable: true,
                userExposed: false
            });

            this.registerParameter({
                name: `band${i}Gain`,
                displayName: `Band ${i + 1} Gain`,
                min: -18,
                max: 18,
                default: 0,
                unit: 'dB',
                curve: 'linear',
                aiControllable: true,
                userExposed: false
            });

            this.registerParameter({
                name: `band${i}Q`,
                displayName: `Band ${i + 1} Q`,
                min: 0.1,
                max: 10,
                default: 1.0,
                unit: '',
                curve: 'logarithmic',
                aiControllable: true,
                userExposed: false
            });

            this.registerParameter({
                name: `band${i}Enabled`,
                displayName: `Band ${i + 1} On`,
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

        // Output gain
        this.registerParameter({
            name: 'outputGain',
            displayName: 'Output',
            min: -12,
            max: 12,
            default: 0,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });
    }

    protected onParameterChange(): void {
        // Recalculate all filter coefficients
        if (this.lastSampleRate > 0) {
            this.updateFilters(this.lastSampleRate);
        }
    }

    private updateFilters(sampleRate: number): void {
        // High-pass
        this.highPass.configure(
            this.getParameter('hpfFrequency'),
            this.getParameter('hpfSlope'),
            sampleRate
        );

        // Low-pass
        this.lowPass.setLowPass(
            this.getParameter('lpfFrequency'),
            0.7071,
            sampleRate
        );

        // Parametric bands
        for (let i = 0; i < 6; i++) {
            const freq = this.getParameter(`band${i}Frequency`);
            const gain = this.getParameter(`band${i}Gain`);
            const q = this.getParameter(`band${i}Q`);

            this.bands[i].setPeak(freq, gain, q, sampleRate);
        }
    }

    process(input: Float32Array, output: Float32Array, sampleRate: number): void {
        if (this._bypass) {
            output.set(input);
            return;
        }

        // Update filters if sample rate changed
        if (sampleRate !== this.lastSampleRate) {
            this.lastSampleRate = sampleRate;
            this.updateFilters(sampleRate);
        }

        const hpfEnabled = this.getParameter('hpfEnabled') > 0.5;
        const lpfEnabled = this.getParameter('lpfEnabled') > 0.5;
        const outputGain = this.dbToGain(this.getParameter('outputGain'));

        for (let i = 0; i < input.length; i++) {
            let sample = input[i];

            // High-pass filter
            if (hpfEnabled) {
                sample = this.highPass.processSample(sample);
            }

            // Parametric bands
            for (let b = 0; b < 6; b++) {
                if (this.getParameter(`band${b}Enabled`) > 0.5) {
                    sample = this.bands[b].processSample(sample);
                }
            }

            // Low-pass filter
            if (lpfEnabled) {
                sample = this.lowPass.processSample(sample);
            }

            // Output gain
            output[i] = sample * outputGain;
        }
    }

    /**
     * Configure EQ from EQBand array (from AI optimizer)
     */
    configureBands(bands: EQBand[]): void {
        for (let i = 0; i < Math.min(bands.length, 6); i++) {
            const band = bands[i];
            this.setParameter(`band${i}Frequency`, band.frequency);
            this.setParameter(`band${i}Gain`, band.gain);
            this.setParameter(`band${i}Q`, band.q);
            this.setParameter(`band${i}Enabled`, band.enabled ? 1 : 0);
        }
    }

    reset(): void {
        super.reset();
        this.highPass.reset();
        this.lowPass.reset();
        for (const band of this.bands) {
            band.reset();
        }
        this.lastSampleRate = 0;
    }
}
