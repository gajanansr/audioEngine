# Audio Engine & AI Mixing System Architecture

## Overview

A professional-grade audio processing engine for web-based DAW that transforms phone-recorded vocals into studio-quality mixes using AI-driven parameter optimization.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (PWA)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │   Timeline  │  │ Macro Controls│  │  Waveform   │  │   Transport     │   │
│  │   Editor    │  │    Panel      │  │   Display   │  │   Controls      │   │
│  └─────────────┘  └──────────────┘  └─────────────┘  └─────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│                         WEB AUDIO API LAYER                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      AudioWorklet Processors                          │   │
│  │   [GainStaging] → [NoiseClean] → [EQ] → [Comp] → [Effects] → [Bus]   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND API                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────────┐    │
│  │  Audio Analysis │  │   AI Parameter   │  │   Cloud Render          │    │
│  │     Service     │  │   Optimizer      │  │   Engine (Offline)      │    │
│  └─────────────────┘  └──────────────────┘  └─────────────────────────┘    │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────────┐    │
│  │ Reference Track │  │   Pitch/Key      │  │   Export/Render         │    │
│  │    Analyzer     │  │   Detection      │  │   Queue                 │    │
│  └─────────────────┘  └──────────────────┘  └─────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Engine Components

### 2.1 Audio Graph Manager

```typescript
// Manages the entire audio routing topology
interface AudioGraphManager {
  context: AudioContext;
  masterBus: MasterBusNode;
  vocalBus: VocalBusNode;
  tracks: Map<string, TrackNode>;
  sendEffects: Map<string, SendEffectNode>;
  
  // Routing methods
  connectTrackToBus(trackId: string, busId: string): void;
  createSendRoute(trackId: string, sendId: string, wetLevel: number): void;
  renderOffline(duration: number): Promise<AudioBuffer>;
}
```

### 2.2 Signal Flow Architecture

```
VOCAL TRACK INPUT
       │
       ▼
┌──────────────────┐
│  INPUT GAIN      │  ← Normalize to -18 dBFS RMS
│  STAGING         │  ← Peak limit -6 dBFS
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  NOISE CLEANUP   │  ← Dynamic noise reduction
│  MODULE          │  ← De-reverb (conditional)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  SUBTRACTIVE EQ  │  ← HPF (70-120Hz based on gender)
│  (Pre-Comp)      │  ← Mud removal, harshness notch
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    DE-ESSER      │  ← 5-8kHz dynamic reduction
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  COMPRESSOR A    │  ← Leveling (2:1, slow attack)
│  (Leveling)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  COMPRESSOR B    │  ← Control (3-4:1, fast attack)
│  (Control)       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    AUTOTUNE      │  ← Key detection, formant preserve
│    MODULE        │  ← Humanized correction
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  ADDITIVE EQ     │  ← Presence (3-5kHz)
│  (Post-Comp)     │  ← Air shelf (10-15kHz)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   SATURATION     │  ← Tube harmonics (5-10% wet)
└────────┬─────────┘
         │
    ┌────┴────┬─────────────────┐
    │         │                 │
    ▼         ▼                 ▼
  [DRY]   [REVERB SEND]   [DELAY SEND]
    │         │                 │
    └────┬────┴─────────────────┘
         │
         ▼
┌──────────────────┐
│   VOCAL BUS      │  ← Glue compression (1-2dB)
│   PROCESSING     │  ← Polish EQ
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   MASTER BUS     │  ← EQ tilt, multiband comp
│                  │  ← Limiter (-14 LUFS, -1dB TP)
└────────┬─────────┘
         │
         ▼
      OUTPUT
```

---

## 3. Plugin Module System

### 3.1 Base Plugin Interface

```typescript
interface AudioPlugin {
  id: string;
  name: string;
  type: 'insert' | 'send';
  bypass: boolean;
  
  // Core methods
  process(input: Float32Array, output: Float32Array): void;
  setParameter(name: string, value: number): void;
  getParameter(name: string): number;
  getParameterDescriptors(): ParameterDescriptor[];
  
  // Serialization
  getState(): PluginState;
  setState(state: PluginState): void;
}

interface ParameterDescriptor {
  name: string;
  min: number;
  max: number;
  default: number;
  unit: string;
  curve: 'linear' | 'exponential' | 'logarithmic';
  aiControllable: boolean;  // Can AI modify this?
  userExposed: boolean;     // Show to user as macro?
}
```

### 3.2 Plugin Implementations

Each plugin is implemented as an AudioWorkletProcessor for real-time preview and as a pure DSP function for offline rendering.

---

## 4. AI Decision Engine

### 4.1 Analysis Pipeline

```typescript
interface VocalAnalysis {
  // Pitch & Timing
  pitchData: PitchContour;
  detectedKey: MusicalKey;
  detectedScale: Scale;
  timingDeviations: TimingData[];
  
  // Spectral
  spectralProfile: Float32Array;
  fundamentalFreq: number;      // For gender detection
  noiseFloor: number;           // dB
  roomReverbTime: number;       // RT60 estimate
  
  // Dynamic
  rmsLevel: number;
  peakLevel: number;
  dynamicRange: number;
  sibilanceLevel: number;       // 5-8kHz energy
  
  // Quality Metrics
  signalToNoiseRatio: number;
  phoneRecordingConfidence: number;  // 0-1
}

interface ReferenceAnalysis {
  vocalTonalCurve: Float32Array;    // EQ target
  perceivedReverbSpace: ReverbParams;
  vocalLoudnessBalance: number;      // dB relative to mix
  overallLoudness: number;           // LUFS
}
```

### 4.2 Parameter Optimization Logic

```typescript
class AIParameterOptimizer {
  optimizeChain(
    vocalAnalysis: VocalAnalysis,
    referenceAnalysis: ReferenceAnalysis | null,
    genre: Genre
  ): ChainParameters {
    
    return {
      gainStaging: this.calculateGainStaging(vocalAnalysis),
      noiseReduction: this.calculateNoiseReduction(vocalAnalysis),
      subtractiveEQ: this.calculateSubtractiveEQ(vocalAnalysis),
      deEsser: this.calculateDeEsser(vocalAnalysis),
      compression: this.calculateCompression(vocalAnalysis),
      autotune: this.calculateAutotune(vocalAnalysis, genre),
      additiveEQ: this.calculateAdditiveEQ(vocalAnalysis, referenceAnalysis),
      saturation: this.calculateSaturation(vocalAnalysis),
      reverb: this.calculateReverb(vocalAnalysis, referenceAnalysis),
      delay: this.calculateDelay(genre),
      mastering: this.calculateMastering(referenceAnalysis)
    };
  }
}
```

---

## 5. User Macro Control System

### 5.1 Macro Definitions

```typescript
const USER_MACROS = {
  autotuneStrength: {
    range: [0, 100],
    default: 50,
    maps: [
      { plugin: 'autotune', param: 'retuneSpeed', curve: 'inverse' },
      { plugin: 'autotune', param: 'humanize', curve: 'inverse' }
    ]
  },
  
  reverbAmount: {
    range: [0, 100],
    default: 30,
    maps: [
      { plugin: 'reverb', param: 'wetLevel', curve: 'exponential' },
      { plugin: 'reverb', param: 'decay', curve: 'linear', scale: [1.0, 3.0] }
    ]
  },
  
  vocalLoudness: {
    range: [-12, 6],  // dB
    default: 0,
    maps: [
      { plugin: 'vocalBus', param: 'outputGain', curve: 'linear' }
    ]
  },
  
  polishAmount: {
    range: [0, 100],  // Natural ↔ Studio
    default: 50,
    maps: [
      { plugin: 'additiveEQ', param: 'presenceBoost', curve: 'linear' },
      { plugin: 'additiveEQ', param: 'airShelf', curve: 'linear' },
      { plugin: 'saturation', param: 'drive', curve: 'linear' },
      { plugin: 'compression', param: 'ratio', curve: 'linear' }
    ]
  }
};
```

---

## 6. Web Implementation Strategy

### 6.1 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Audio Engine | Web Audio API + AudioWorklet | Real-time processing |
| Pitch Detection | Essentia.js / Meyda | Analysis in browser |
| Autotune | Custom WASM module | Low-latency pitch correction |
| Noise Reduction | RNNoise (WASM) | Neural noise suppression |
| UI Framework | React/Solid | Component-based UI |
| State Management | Zustand/Jotai | Audio state sync |
| Backend | Node.js + Python | Analysis & render |
| Cloud Render | FFmpeg + sox | Offline high-quality |

### 6.2 Real-time vs Offline Processing

```
┌─────────────────────────────────────────────────────────────┐
│                    REAL-TIME (Preview)                       │
│  ─────────────────────────────────────────────────────────  │
│  • Lower-quality algorithms (faster)                         │
│  • 128-512 sample buffer size                               │
│  • Simplified noise reduction                               │
│  • Basic pitch correction                                    │
│  • Latency: ~10-50ms                                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 OFFLINE (Final Render)                       │
│  ─────────────────────────────────────────────────────────  │
│  • Full-quality algorithms                                   │
│  • Large buffer processing                                   │
│  • RNNoise deep model                                       │
│  • Phase-accurate pitch correction                          │
│  • True peak limiting                                        │
│  • Rendered on cloud or via OfflineAudioContext             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Directory Structure

```
audioEngine/
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── core/
│   │   ├── AudioGraphManager.ts
│   │   ├── PluginHost.ts
│   │   └── TransportController.ts
│   ├── plugins/
│   │   ├── base/
│   │   │   └── BasePlugin.ts
│   │   ├── dynamics/
│   │   │   ├── Compressor.ts
│   │   │   ├── DeEsser.ts
│   │   │   └── Limiter.ts
│   │   ├── eq/
│   │   │   ├── ParametricEQ.ts
│   │   │   └── FilterBank.ts
│   │   ├── pitch/
│   │   │   ├── PitchDetector.ts
│   │   │   └── AutoTune.ts
│   │   ├── effects/
│   │   │   ├── Reverb.ts
│   │   │   ├── Delay.ts
│   │   │   └── Saturation.ts
│   │   └── noise/
│   │       └── NoiseReduction.ts
│   ├── ai/
│   │   ├── VocalAnalyzer.ts
│   │   ├── ReferenceAnalyzer.ts
│   │   ├── ParameterOptimizer.ts
│   │   └── GenreClassifier.ts
│   ├── chains/
│   │   ├── VocalChain.ts
│   │   ├── VocalBus.ts
│   │   └── MasterBus.ts
│   ├── macros/
│   │   ├── MacroController.ts
│   │   └── MacroDefinitions.ts
│   ├── worklets/
│   │   ├── compressor.worklet.ts
│   │   ├── eq.worklet.ts
│   │   └── ...
│   └── utils/
│       ├── dsp.ts
│       ├── fft.ts
│       └── metering.ts
├── wasm/
│   ├── rnnoise/
│   └── pitch-correction/
└── tests/
```

---

## 8. Next Steps

1. **Phase 1**: Core audio graph and plugin system
2. **Phase 2**: Implement critical plugins (EQ, Compressor, De-esser)
3. **Phase 3**: AI analysis pipeline
4. **Phase 4**: Autotune module (WASM)
5. **Phase 5**: Macro control system
6. **Phase 6**: Cloud rendering pipeline

Would you like me to proceed with implementing any specific component?
