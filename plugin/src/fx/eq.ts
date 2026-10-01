import { BiquadChain, designBiquad, type FilterType } from '../dsp/biquad.js';
import type { Audio } from '../dsp/util.js';

export interface EqBand { type: FilterType; freq: number; gainDb?: number; q?: number }

/** Parametric EQ (RBJ biquads, minimum phase). */
export function eq(a: Audio, bands: EqBand[]): void {
  const active = bands.filter((b) => b.type !== 'peaking' && b.type !== 'lowshelf' && b.type !== 'highshelf' ? true : Math.abs(b.gainDb ?? 0) > 0.01);
  if (!active.length) return;
  for (const ch of a.channels) {
    new BiquadChain(active.map((b) => designBiquad(b.type, a.sampleRate, b.freq, b.q ?? 0.7071, b.gainDb ?? 0))).run(ch);
  }
}

/** Steep high-pass (e.g. 18 dB/oct removal of rumble). */
export function highpass(a: Audio, freq: number, order: 2 | 4 | 6 = 4): void {
  const qs = order === 2 ? [0.7071] : order === 4 ? [0.5412, 1.3066] : [0.5176, 0.7071, 1.9319];
  for (const ch of a.channels) new BiquadChain(qs.map((q) => designBiquad('highpass', a.sampleRate, freq, q))).run(ch);
}

export function lowpass(a: Audio, freq: number, order: 2 | 4 = 4): void {
  const qs = order === 2 ? [0.7071] : [0.5412, 1.3066];
  for (const ch of a.channels) new BiquadChain(qs.map((q) => designBiquad('lowpass', a.sampleRate, freq, q))).run(ch);
}

export function removeDc(a: Audio): void {
  for (const ch of a.channels) {
    let s = 0; for (let i = 0; i < ch.length; i++) s += ch[i];
    const m = s / Math.max(ch.length, 1);
    if (Math.abs(m) > 1e-6) for (let i = 0; i < ch.length; i++) ch[i] -= m;
  }
}
