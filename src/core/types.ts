/**
 * Core type definitions for the Audio Engine
 */

// ============================================
// PLUGIN SYSTEM TYPES
// ============================================

export type PluginType = 'insert' | 'send';
export type ParameterCurve = 'linear' | 'exponential' | 'logarithmic';

export interface ParameterDescriptor {
  name: string;
  displayName: string;
  min: number;
  max: number;
  default: number;
  unit: string;
  curve: ParameterCurve;
  aiControllable: boolean;
  userExposed: boolean;
  step?: number;
}

export interface PluginState {
  id: string;
  pluginType: string;
  bypass: boolean;
  parameters: Record<string, number>;
}

export interface AudioPlugin {
  readonly id: string;
  readonly name: string;
  readonly type: PluginType;
  bypass: boolean;

  process(input: Float32Array, output: Float32Array, sampleRate: number): void;
  setParameter(name: string, value: number): void;
  getParameter(name: string): number;
  getParameterDescriptors(): ParameterDescriptor[];
  getState(): PluginState;
  setState(state: PluginState): void;
  reset(): void;
}

// ============================================
// AUDIO ANALYSIS TYPES
// ============================================

export interface PitchContour {
  times: Float32Array;
  frequencies: Float32Array;
  confidences: Float32Array;
}

export type MusicalKey =
  | 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F'
  | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type Scale = 'major' | 'minor' | 'pentatonic' | 'blues' | 'chromatic';

export interface TimingData {
  position: number;      // seconds
  deviation: number;     // milliseconds
  severity: 'minor' | 'moderate' | 'severe';
}

export interface VocalAnalysis {
  // Pitch & Timing
  pitchData: PitchContour;
  detectedKey: MusicalKey;
  detectedScale: Scale;
  timingDeviations: TimingData[];

  // Spectral
  spectralProfile: Float32Array;
  fundamentalFreq: number;
  noiseFloor: number;
  roomReverbTime: number;

  // Dynamic
  rmsLevel: number;
  peakLevel: number;
  dynamicRange: number;
  sibilanceLevel: number;

  // Quality Metrics
  signalToNoiseRatio: number;
  phoneRecordingConfidence: number;
}

export interface ReverbParams {
  type: 'plate' | 'room' | 'hall';
  preDelay: number;
  decay: number;
  damping: number;
  wetLevel: number;
}

export interface ReferenceAnalysis {
  vocalTonalCurve: Float32Array;
  perceivedReverbSpace: ReverbParams;
  vocalLoudnessBalance: number;
  overallLoudness: number;
}

// ============================================
// CHAIN PARAMETER TYPES
// ============================================

export interface GainStagingParams {
  inputGain: number;
  targetRms: number;
  peakCeiling: number;
}

export interface NoiseReductionParams {
  enabled: boolean;
  threshold: number;
  reduction: number;
  deReverbEnabled: boolean;
  deReverbAmount: number;
}

export interface EQBand {
  frequency: number;
  gain: number;
  q: number;
  type: 'highpass' | 'lowpass' | 'peak' | 'shelf' | 'notch';
  enabled: boolean;
}

export interface SubtractiveEQParams {
  highPassFreq: number;
  highPassSlope: number;
  bands: EQBand[];
}

export interface AdditiveEQParams {
  presenceFreq: number;
  presenceGain: number;
  presenceQ: number;
  airShelfFreq: number;
  airShelfGain: number;
  bands: EQBand[];
}

export interface DeEsserParams {
  frequency: number;
  threshold: number;
  ratio: number;
  range: number;
  listenMode: boolean;
}

export interface CompressorParams {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  makeupGain: number;
}

export interface AutotuneParams {
  enabled: boolean;
  key: MusicalKey;
  scale: Scale;
  retuneSpeed: number;
  humanize: number;
  formantPreserve: boolean;
  formantShift: number;
}

export interface SaturationParams {
  drive: number;
  mix: number;
  type: 'tube' | 'tape' | 'transistor';
  outputGain: number;
}

export interface DelayParams {
  enabled: boolean;
  time: number;
  feedback: number;
  wetLevel: number;
  highCut: number;
  sync: boolean;
}

export interface MasteringParams {
  eqTilt: number;
  multibandEnabled: boolean;
  lowBandThreshold: number;
  midBandThreshold: number;
  highBandThreshold: number;
  limiterThreshold: number;
  limiterCeiling: number;
  targetLUFS: number;
}

export interface ChainParameters {
  gainStaging: GainStagingParams;
  noiseReduction: NoiseReductionParams;
  subtractiveEQ: SubtractiveEQParams;
  deEsser: DeEsserParams;
  compressionA: CompressorParams;
  compressionB: CompressorParams;
  autotune: AutotuneParams;
  additiveEQ: AdditiveEQParams;
  saturation: SaturationParams;
  reverb: ReverbParams;
  delay: DelayParams;
  mastering: MasteringParams;
}

// ============================================
// MACRO CONTROL TYPES
// ============================================

export interface MacroMapping {
  plugin: string;
  param: string;
  curve: 'linear' | 'inverse' | 'exponential';
  scale?: [number, number];
}

export interface MacroDefinition {
  id: string;
  displayName: string;
  range: [number, number];
  default: number;
  unit: string;
  maps: MacroMapping[];
}

export interface UserMacroState {
  autotuneStrength: number;
  reverbAmount: number;
  vocalLoudness: number;
  polishAmount: number;
}

// ============================================
// AUDIO GRAPH TYPES
// ============================================

export type Genre =
  | 'pop' | 'hiphop' | 'rnb' | 'rock'
  | 'electronic' | 'acoustic' | 'default';

export interface TrackConfig {
  id: string;
  name: string;
  type: 'vocal' | 'beat' | 'reference';
  audioBuffer: AudioBuffer | null;
  chain: ChainParameters | null;
}

export interface ProjectState {
  id: string;
  name: string;
  sampleRate: number;
  tracks: TrackConfig[];
  userMacros: UserMacroState;
  genre: Genre;
  bpm: number;
}
