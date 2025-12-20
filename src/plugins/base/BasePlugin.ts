import {
    AudioPlugin,
    PluginType,
    ParameterDescriptor,
    PluginState
} from '../../core/types';

/**
 * Abstract base class for all audio plugins
 * Provides common functionality for parameter management and state
 */
export abstract class BasePlugin implements AudioPlugin {
    readonly id: string;
    readonly name: string;
    readonly type: PluginType;

    protected _bypass: boolean = false;
    protected parameters: Map<string, number> = new Map();
    protected parameterDescriptors: Map<string, ParameterDescriptor> = new Map();

    constructor(id: string, name: string, type: PluginType) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.initializeParameters();
    }

    get bypass(): boolean {
        return this._bypass;
    }

    set bypass(value: boolean) {
        this._bypass = value;
    }

    /**
     * Override to define plugin parameters
     */
    protected abstract initializeParameters(): void;

    /**
     * Main DSP processing - override in subclass
     */
    abstract process(
        input: Float32Array,
        output: Float32Array,
        sampleRate: number
    ): void;

    /**
     * Register a parameter with the plugin
     */
    protected registerParameter(descriptor: ParameterDescriptor): void {
        this.parameterDescriptors.set(descriptor.name, descriptor);
        this.parameters.set(descriptor.name, descriptor.default);
    }

    /**
     * Set a parameter value with range clamping
     */
    setParameter(name: string, value: number): void {
        const descriptor = this.parameterDescriptors.get(name);
        if (!descriptor) {
            console.warn(`Unknown parameter: ${name}`);
            return;
        }

        const clampedValue = Math.max(
            descriptor.min,
            Math.min(descriptor.max, value)
        );
        this.parameters.set(name, clampedValue);
        this.onParameterChange(name, clampedValue);
    }

    /**
     * Override to handle parameter changes (e.g., recalculate coefficients)
     */
    protected onParameterChange(name: string, value: number): void {
        // Override in subclass if needed
    }

    getParameter(name: string): number {
        return this.parameters.get(name) ?? 0;
    }

    getParameterDescriptors(): ParameterDescriptor[] {
        return Array.from(this.parameterDescriptors.values());
    }

    getState(): PluginState {
        return {
            id: this.id,
            pluginType: this.constructor.name,
            bypass: this._bypass,
            parameters: Object.fromEntries(this.parameters)
        };
    }

    setState(state: PluginState): void {
        this._bypass = state.bypass;
        for (const [name, value] of Object.entries(state.parameters)) {
            this.setParameter(name, value);
        }
    }

    reset(): void {
        for (const descriptor of this.parameterDescriptors.values()) {
            this.setParameter(descriptor.name, descriptor.default);
        }
        this._bypass = false;
    }

    /**
     * Utility: Convert dB to linear gain
     */
    protected dbToGain(db: number): number {
        return Math.pow(10, db / 20);
    }

    /**
     * Utility: Convert linear gain to dB
     */
    protected gainToDb(gain: number): number {
        return 20 * Math.log10(Math.max(gain, 1e-10));
    }

    /**
     * Utility: Soft clipping (tanh waveshaper)
     */
    protected softClip(x: number): number {
        return Math.tanh(x);
    }
}
