import { ChainParameters, UserMacroState } from '../core/types';
import { Compressor } from '../plugins/dynamics/Compressor';
import { DeEsser } from '../plugins/dynamics/DeEsser';
import { ParametricEQ } from '../plugins/eq/ParametricEQ';
import { Saturation } from '../plugins/effects/Saturation';
import { Reverb } from '../plugins/effects/Reverb';
import { Delay } from '../plugins/effects/Delay';
import { AutoTune } from '../plugins/pitch/AutoTune';
import { MacroController } from '../macros/MacroController';

/**
 * VocalChain
 * 
 * Complete vocal processing chain wired in professional order:
 * 
 * Input → GainStaging → SubtractiveEQ → DeEsser → CompressorA → CompressorB
 *       → AutoTune → AdditiveEQ → Saturation → [Send to Reverb/Delay]
 *       → Output (to Vocal Bus)
 */
export class VocalChain {
    // Insert plugins (in processing order)
    private subtractiveEQ: ParametricEQ;
    private deEsser: DeEsser;
    private compressorA: Compressor;
    private compressorB: Compressor;
    private autoTune: AutoTune;
    private additiveEQ: ParametricEQ;
    private saturation: Saturation;

    // Send effects
    private reverb: Reverb;
    private delay: Delay;

    // Routing
    private reverbSendLevel: number = 0.2;
    private delaySendLevel: number = 0.1;

    // Gain staging
    private inputGain: number = 1;
    private outputGain: number = 1;

    // State
    private sampleRate: number = 44100;
    private macroController: MacroController;

    constructor(id: string = 'vocal') {
        // Initialize all plugins
        this.subtractiveEQ = new ParametricEQ(`${id}_subEQ`);
        this.deEsser = new DeEsser(`${id}_deEsser`);
        this.compressorA = new Compressor(`${id}_compA`, 'leveling');
        this.compressorB = new Compressor(`${id}_compB`, 'control');
        this.autoTune = new AutoTune(`${id}_autotune`);
        this.additiveEQ = new ParametricEQ(`${id}_addEQ`);
        this.saturation = new Saturation(`${id}_sat`);
        this.reverb = new Reverb(`${id}_reverb`);
        this.delay = new Delay(`${id}_delay`);

        // Setup macro controller
        this.macroController = new MacroController();
        this.registerMacros();
    }

    /**
     * Register macro control mappings
     */
    private registerMacros(): void {
        // Autotune strength
        this.macroController.registerPlugin('autotune', (param, value) => {
            if (param === 'retuneSpeed') {
                this.autoTune.setParameter('retuneSpeed', value);
            } else if (param === 'humanize') {
                this.autoTune.setParameter('humanize', value);
            } else if (param === 'strength') {
                this.autoTune.setParameter('strength', value);
            }
        });

        // Reverb
        this.macroController.registerPlugin('reverb', (param, value) => {
            if (param === 'wetLevel') {
                this.reverb.setParameter('wetLevel', value);
                this.reverbSendLevel = value / 100;
            } else if (param === 'decay') {
                this.reverb.setParameter('decay', value);
            }
        });

        // Vocal bus (output level)
        this.macroController.registerPlugin('vocalBus', (param, value) => {
            if (param === 'outputGain') {
                this.outputGain = Math.pow(10, value / 20);
            }
        });

        // Additive EQ (for polish slider)
        this.macroController.registerPlugin('additiveEQ', (param, value) => {
            if (param === 'presenceGain') {
                this.additiveEQ.setParameter('band2Gain', value);
                this.additiveEQ.setParameter('band2Enabled', value > 0.1 ? 1 : 0);
            } else if (param === 'airShelfGain') {
                this.additiveEQ.setParameter('band5Gain', value);
                this.additiveEQ.setParameter('band5Enabled', value > 0.1 ? 1 : 0);
            }
        });

        // Saturation (for polish slider)
        this.macroController.registerPlugin('saturation', (param, value) => {
            if (param === 'mix') {
                this.saturation.setParameter('mix', value);
            }
        });

        // Compression (for polish slider)
        this.macroController.registerPlugin('compressionB', (param, value) => {
            if (param === 'ratio') {
                this.compressorB.setParameter('ratio', value);
            }
        });
    }

    /**
     * Configure chain from AI-generated parameters
     */
    configureFromParameters(params: ChainParameters): void {
        // Gain staging
        this.inputGain = Math.pow(10, params.gainStaging.inputGain / 20);

        // Subtractive EQ
        this.subtractiveEQ.setParameter('hpfFrequency', params.subtractiveEQ.highPassFreq);
        this.subtractiveEQ.setParameter('hpfSlope', params.subtractiveEQ.highPassSlope);
        this.subtractiveEQ.setParameter('hpfEnabled', 1);
        this.subtractiveEQ.configureBands(params.subtractiveEQ.bands);

        // De-esser
        this.deEsser.setParameter('frequency', params.deEsser.frequency);
        this.deEsser.setParameter('threshold', params.deEsser.threshold);
        this.deEsser.setParameter('ratio', params.deEsser.ratio);
        this.deEsser.setParameter('range', params.deEsser.range);

        // Compressor A (leveling)
        this.compressorA.setParameter('threshold', params.compressionA.threshold);
        this.compressorA.setParameter('ratio', params.compressionA.ratio);
        this.compressorA.setParameter('attack', params.compressionA.attack);
        this.compressorA.setParameter('release', params.compressionA.release);

        // Compressor B (control)
        this.compressorB.setParameter('threshold', params.compressionB.threshold);
        this.compressorB.setParameter('ratio', params.compressionB.ratio);
        this.compressorB.setParameter('attack', params.compressionB.attack);
        this.compressorB.setParameter('release', params.compressionB.release);

        // AutoTune
        this.autoTune.setKeyAndScale(params.autotune.key, params.autotune.scale);
        this.autoTune.setParameter('retuneSpeed', params.autotune.retuneSpeed);
        this.autoTune.setParameter('humanize', params.autotune.humanize);
        this.autoTune.setParameter('formantPreserve', params.autotune.formantPreserve ? 1 : 0);
        this.autoTune.setParameter('enabled', params.autotune.enabled ? 1 : 0);

        // Additive EQ
        this.additiveEQ.setParameter('band2Frequency', params.additiveEQ.presenceFreq);
        this.additiveEQ.setParameter('band2Gain', params.additiveEQ.presenceGain);
        this.additiveEQ.setParameter('band2Q', params.additiveEQ.presenceQ);
        this.additiveEQ.setParameter('band2Enabled', 1);

        this.additiveEQ.setParameter('band5Frequency', params.additiveEQ.airShelfFreq);
        this.additiveEQ.setParameter('band5Gain', params.additiveEQ.airShelfGain);
        this.additiveEQ.setParameter('band5Enabled', 1);

        // Saturation
        this.saturation.setParameter('drive', params.saturation.drive);
        this.saturation.setParameter('mix', params.saturation.mix);

        // Reverb
        this.reverb.setParameter('type',
            params.reverb.type === 'plate' ? 0 :
                params.reverb.type === 'room' ? 1 : 2);
        this.reverb.setParameter('preDelay', params.reverb.preDelay);
        this.reverb.setParameter('decay', params.reverb.decay);
        this.reverb.setParameter('damping', params.reverb.damping);
        this.reverb.setParameter('wetLevel', params.reverb.wetLevel);
        this.reverbSendLevel = params.reverb.wetLevel / 100;

        // Delay
        if (params.delay.enabled) {
            this.delay.setParameter('time', params.delay.time);
            this.delay.setParameter('feedback', params.delay.feedback);
            this.delay.setParameter('wetLevel', params.delay.wetLevel);
            this.delay.setParameter('highCut', params.delay.highCut);
            this.delaySendLevel = params.delay.wetLevel / 100;
        } else {
            this.delaySendLevel = 0;
        }
    }

    /**
     * Apply user macro adjustments
     */
    applyMacros(macros: UserMacroState): void {
        this.macroController.applyAllMacros(macros);
    }

    /**
     * Process audio through the complete chain
     */
    process(input: Float32Array, sampleRate: number): Float32Array {
        this.sampleRate = sampleRate;
        const length = input.length;

        // Working buffers
        let buffer = new Float32Array(length);
        const reverbBuffer = new Float32Array(length);
        const delayBuffer = new Float32Array(length);

        // 1. Input gain staging
        for (let i = 0; i < length; i++) {
            buffer[i] = input[i] * this.inputGain;
        }

        // 2. Subtractive EQ (HPF, mud removal)
        const afterSubEQ = new Float32Array(length);
        this.subtractiveEQ.process(buffer, afterSubEQ, sampleRate);
        buffer = afterSubEQ;

        // 3. De-esser
        const afterDeEsser = new Float32Array(length);
        this.deEsser.process(buffer, afterDeEsser, sampleRate);
        buffer = afterDeEsser;

        // 4. Compressor A (leveling)
        const afterCompA = new Float32Array(length);
        this.compressorA.process(buffer, afterCompA, sampleRate);
        buffer = afterCompA;

        // 5. Compressor B (control)
        const afterCompB = new Float32Array(length);
        this.compressorB.process(buffer, afterCompB, sampleRate);
        buffer = afterCompB;

        // 6. AutoTune
        const afterAutotune = new Float32Array(length);
        this.autoTune.process(buffer, afterAutotune, sampleRate);
        buffer = afterAutotune;

        // 7. Additive EQ (presence, air)
        const afterAddEQ = new Float32Array(length);
        this.additiveEQ.process(buffer, afterAddEQ, sampleRate);
        buffer = afterAddEQ;

        // 8. Saturation
        const afterSat = new Float32Array(length);
        this.saturation.process(buffer, afterSat, sampleRate);
        buffer = afterSat;

        // 9. Send effects (parallel processing)
        // Reverb send
        if (this.reverbSendLevel > 0.01) {
            this.reverb.process(buffer, reverbBuffer, sampleRate);
        }

        // Delay send
        if (this.delaySendLevel > 0.01) {
            this.delay.process(buffer, delayBuffer, sampleRate);
        }

        // 10. Mix dry + wet sends + output gain
        const output = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            output[i] = (buffer[i] +
                reverbBuffer[i] * this.reverbSendLevel +
                delayBuffer[i] * this.delaySendLevel) * this.outputGain;
        }

        return output;
    }

    /**
     * Get current gain reduction from compressors (for metering)
     */
    getGainReduction(): { compA: number; compB: number; deEsser: number } {
        return {
            compA: this.compressorA.getGainReduction(),
            compB: this.compressorB.getGainReduction(),
            deEsser: this.deEsser.getGainReduction()
        };
    }

    /**
     * Reset all plugins
     */
    reset(): void {
        this.subtractiveEQ.reset();
        this.deEsser.reset();
        this.compressorA.reset();
        this.compressorB.reset();
        this.autoTune.reset();
        this.additiveEQ.reset();
        this.saturation.reset();
        this.reverb.reset();
        this.delay.reset();
    }
}
