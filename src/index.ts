// Core exports
export * from './core/types';
export { AudioGraphManager, audioGraphManager } from './core/AudioGraphManager';

// Plugin exports
export { BasePlugin } from './plugins/base/BasePlugin';
export { Compressor } from './plugins/dynamics/Compressor';
export { DeEsser } from './plugins/dynamics/DeEsser';
export { Limiter } from './plugins/dynamics/Limiter';
export { ParametricEQ } from './plugins/eq/ParametricEQ';
export { Saturation } from './plugins/effects/Saturation';
export { Reverb } from './plugins/effects/Reverb';
export { Delay } from './plugins/effects/Delay';
export { AutoTune } from './plugins/pitch/AutoTune';

// AI exports
export { VocalAnalyzer, vocalAnalyzer } from './ai/VocalAnalyzer';
export { ParameterOptimizer, parameterOptimizer } from './ai/ParameterOptimizer';

// Macro exports
export { MacroController, macroController, MACRO_DEFINITIONS } from './macros/MacroController';

