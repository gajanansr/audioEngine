import { BiquadChain, designBiquad } from '../dsp/biquad.js';
import { dbToLin, type Audio } from '../dsp/util.js';

export type SatMode = 'tape' | 'tube' | 'soft' | 'clip';

export interface SaturationParams {
  driveDb?: number;
  mode?: SatMode;
  /** 0..1 wet amount (parallel saturation). */
  mix?: number;
  /** Compensate output level so only the harmonic colour changes. */
  autoGain?: boolean;
}

const BUTTER8 = [0.5098, 0.6013, 0.9, 2.5629];

function shaper(mode: SatMode): (x: number) => number {
  switch (mode) {
    case 'tape': return (x) => Math.tanh(x);
    case 'tube': return (x) => (x >= 0 ? Math.tanh(x * 1.2) : Math.tanh(x * 0.8) * 1.05); // asymmetry → even harmonics
    case 'soft': return (x) => x / (1 + Math.abs(x));
    case 'clip': return (x) => (x > 1 ? 1 : x < -1 ? -1 : 1.5 * x - 0.5 * x * x * x);
  }
}

/** 4x-oversampled waveshaper so the added harmonics don't alias. */
export function saturate(a: Audio, p: SaturationParams = {}): void {
  const drive = dbToLin(p.driveDb ?? 6);
  const mix = p.mix ?? 1;
  const fn = shaper(p.mode ?? 'tape');
  const OS = 4, sr = a.sampleRate * OS, n = a.channels[0].length;
  // unity small-signal gain so only the harmonic colour changes, not the level
  const slope0 = (fn(1e-3) - fn(-1e-3)) / 2e-3;
  const norm = p.autoGain === false ? 1 : 1 / (drive * slope0);
  for (const ch of a.channels) {
    const up = new Float32Array(n * OS);
    for (let i = 0; i < n; i++) up[i * OS] = ch[i] * OS; // zero-stuff (×OS keeps gain)
    const cuts = a.sampleRate * 0.45;
    new BiquadChain(BUTTER8.map((q) => designBiquad('lowpass', sr, cuts, q))).run(up);
    for (let i = 0; i < up.length; i++) up[i] = fn(up[i] * drive) * norm;
    new BiquadChain(BUTTER8.map((q) => designBiquad('lowpass', sr, cuts, q))).run(up);
    for (let i = 0; i < n; i++) ch[i] = mix * up[i * OS] + (1 - mix) * ch[i];
  }
}

/**
 * Transparent peak shaver: identical to the input below `thresholdDb`, smoothly rounds peaks above it (tanh knee).
 * Used before the limiter so isolated transients don't make it pump. Max reduction is bounded by `ceilingDb`.
 */
export function peakShave(a: Audio, thresholdDb: number, ceilingDb: number): void {
  const t = dbToLin(thresholdDb), c = dbToLin(ceilingDb);
  const span = Math.max(c - t, 1e-6);
  for (const ch of a.channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i], av = v < 0 ? -v : v;
      if (av > t) { const y = t + span * Math.tanh((av - t) / span); ch[i] = v < 0 ? -y : y; }
    }
  }
}
