import { BasePlugin } from '../base/BasePlugin';

/**
 * Tube-Style Saturation
 * Adds warmth, harmonics, and density to vocals
 */
export class Saturation extends BasePlugin {
    // DC offset filter state
    private dcX1: number = 0;
    private dcY1: number = 0;
    private dcCoef: number = 0.995;

    constructor(id: string) {
        super(id, 'Saturation', 'insert');
    }

    protected initializeParameters(): void {
        this.registerParameter({
            name: 'drive',
            displayName: 'Drive',
            min: 0,
            max: 100,
            default: 5,
            unit: '%',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'mix',
            displayName: 'Mix',
            min: 0,
            max: 100,
            default: 10,
            unit: '%',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });

        this.registerParameter({
            name: 'type',
            displayName: 'Type',
            min: 0,
            max: 2,
            default: 0, // 0=tube, 1=tape, 2=transistor
            unit: '',
            curve: 'linear',
            aiControllable: true,
            userExposed: false,
            step: 1
        });

        this.registerParameter({
            name: 'outputGain',
            displayName: 'Output',
            min: -12,
            max: 6,
            default: 0,
            unit: 'dB',
            curve: 'linear',
            aiControllable: true,
            userExposed: false
        });
    }

    /**
     * Tube saturation - soft, warm, even harmonics
     */
    private tubeDistortion(x: number, drive: number): number {
        // Asymmetric soft clipping for tube-like sound
        const gain = 1 + drive * 3;
        const input = x * gain;

        if (input > 0) {
            // Positive half - gentle saturation
            return Math.tanh(input * 1.2) / 1.2;
        } else {
            // Negative half - slightly harder
            return Math.tanh(input * 1.0);
        }
    }

    /**
     * Tape saturation - adds compression and warmth
     */
    private tapeDistortion(x: number, drive: number): number {
        const gain = 1 + drive * 2;
        const input = x * gain;

        // Tape-like hysteresis approximation
        const tanh1 = Math.tanh(input);
        const tanh2 = Math.tanh(input * 0.5);
        return (tanh1 + tanh2) * 0.5;
    }

    /**
     * Transistor saturation - harder, odd harmonics
     */
    private transistorDistortion(x: number, drive: number): number {
        const gain = 1 + drive * 4;
        const input = x * gain;

        // Hard asymmetric clipping
        if (input > 1) {
            return 1 - Math.exp(-(input - 1));
        } else if (input < -1) {
            return -1 + Math.exp(-(-input - 1));
        }
        return input;
    }

    /**
     * DC offset removal (high-pass at ~5Hz)
     */
    private removeDC(x: number): number {
        const y = x - this.dcX1 + this.dcCoef * this.dcY1;
        this.dcX1 = x;
        this.dcY1 = y;
        return y;
    }

    process(input: Float32Array, output: Float32Array, sampleRate: number): void {
        if (this._bypass) {
            output.set(input);
            return;
        }

        const drive = this.getParameter('drive') / 100;
        const mix = this.getParameter('mix') / 100;
        const type = Math.round(this.getParameter('type'));
        const outputGain = this.dbToGain(this.getParameter('outputGain'));

        // Update DC filter coefficient based on sample rate
        this.dcCoef = 1 - (2 * Math.PI * 5 / sampleRate);

        for (let i = 0; i < input.length; i++) {
            const dry = input[i];
            let wet: number;

            // Apply selected saturation type
            switch (type) {
                case 0:
                    wet = this.tubeDistortion(dry, drive);
                    break;
                case 1:
                    wet = this.tapeDistortion(dry, drive);
                    break;
                case 2:
                    wet = this.transistorDistortion(dry, drive);
                    break;
                default:
                    wet = this.tubeDistortion(dry, drive);
            }

            // Remove any DC offset introduced by asymmetric clipping
            wet = this.removeDC(wet);

            // Dry/wet mix
            const mixed = dry * (1 - mix) + wet * mix;

            // Output gain
            output[i] = mixed * outputGain;
        }
    }

    reset(): void {
        super.reset();
        this.dcX1 = 0;
        this.dcY1 = 0;
    }
}
