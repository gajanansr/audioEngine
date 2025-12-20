import { MacroDefinition, MacroMapping, UserMacroState } from '../core/types';

/**
 * Macro Control System
 * Maps simple user-facing controls to multiple internal plugin parameters
 */

export const MACRO_DEFINITIONS: Record<keyof UserMacroState, MacroDefinition> = {
    autotuneStrength: {
        id: 'autotuneStrength',
        displayName: 'Autotune',
        range: [0, 100],
        default: 50,
        unit: '%',
        maps: [
            {
                plugin: 'autotune',
                param: 'retuneSpeed',
                curve: 'inverse',
                scale: [10, 100] // 100% macro = 10ms retune (robotic), 0% = 100ms (natural)
            },
            {
                plugin: 'autotune',
                param: 'humanize',
                curve: 'inverse',
                scale: [0, 50] // 100% macro = 0% humanize, 0% = 50% humanize
            }
        ]
    },

    reverbAmount: {
        id: 'reverbAmount',
        displayName: 'Reverb',
        range: [0, 100],
        default: 30,
        unit: '%',
        maps: [
            {
                plugin: 'reverb',
                param: 'wetLevel',
                curve: 'exponential',
                scale: [0, 40] // 0-40% wet
            },
            {
                plugin: 'reverb',
                param: 'decay',
                curve: 'linear',
                scale: [0.8, 3.0] // 0.8-3.0 seconds
            }
        ]
    },

    vocalLoudness: {
        id: 'vocalLoudness',
        displayName: 'Vocal Level',
        range: [-12, 6],
        default: 0,
        unit: 'dB',
        maps: [
            {
                plugin: 'vocalBus',
                param: 'outputGain',
                curve: 'linear',
                scale: [-12, 6]
            }
        ]
    },

    polishAmount: {
        id: 'polishAmount',
        displayName: 'Polish',
        range: [0, 100],
        default: 50,
        unit: '%',
        maps: [
            {
                plugin: 'additiveEQ',
                param: 'presenceGain',
                curve: 'linear',
                scale: [0, 4] // 0-4 dB presence boost
            },
            {
                plugin: 'additiveEQ',
                param: 'airShelfGain',
                curve: 'linear',
                scale: [0, 3] // 0-3 dB air
            },
            {
                plugin: 'saturation',
                param: 'mix',
                curve: 'linear',
                scale: [0, 15] // 0-15% saturation
            },
            {
                plugin: 'compressionB',
                param: 'ratio',
                curve: 'linear',
                scale: [2, 6] // 2:1 to 6:1 control compression
            }
        ]
    }
};

/**
 * MacroController
 * Handles mapping between user macro values and internal plugin parameters
 */
export class MacroController {
    private pluginSetters: Map<string, (param: string, value: number) => void> = new Map();

    /**
     * Register a plugin's parameter setter
     */
    registerPlugin(pluginId: string, setter: (param: string, value: number) => void): void {
        this.pluginSetters.set(pluginId, setter);
    }

    /**
     * Apply a macro value, updating all mapped plugin parameters
     */
    applyMacro(macroId: keyof UserMacroState, value: number): void {
        const definition = MACRO_DEFINITIONS[macroId];
        if (!definition) {
            console.warn(`Unknown macro: ${macroId}`);
            return;
        }

        // Normalize value to 0-1 range
        const [min, max] = definition.range;
        const normalized = (value - min) / (max - min);

        // Apply to all mapped parameters
        for (const mapping of definition.maps) {
            const pluginValue = this.mapValue(normalized, mapping);
            const setter = this.pluginSetters.get(mapping.plugin);

            if (setter) {
                setter(mapping.param, pluginValue);
            }
        }
    }

    /**
     * Apply all macros from a state object
     */
    applyAllMacros(state: UserMacroState): void {
        for (const [macroId, value] of Object.entries(state)) {
            this.applyMacro(macroId as keyof UserMacroState, value);
        }
    }

    /**
     * Map normalized value (0-1) to plugin parameter range using curve
     */
    private mapValue(normalized: number, mapping: MacroMapping): number {
        let curved = normalized;

        // Apply curve transformation
        switch (mapping.curve) {
            case 'linear':
                curved = normalized;
                break;
            case 'inverse':
                curved = 1 - normalized;
                break;
            case 'exponential':
                curved = Math.pow(normalized, 2);
                break;
        }

        // Scale to target range
        if (mapping.scale) {
            const [targetMin, targetMax] = mapping.scale;
            return targetMin + curved * (targetMax - targetMin);
        }

        return curved;
    }

    /**
     * Get default macro state
     */
    getDefaultState(): UserMacroState {
        return {
            autotuneStrength: MACRO_DEFINITIONS.autotuneStrength.default,
            reverbAmount: MACRO_DEFINITIONS.reverbAmount.default,
            vocalLoudness: MACRO_DEFINITIONS.vocalLoudness.default,
            polishAmount: MACRO_DEFINITIONS.polishAmount.default
        };
    }
}

export const macroController = new MacroController();
