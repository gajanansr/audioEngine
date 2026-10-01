import { lr4 } from '../dsp/biquad.js';
import type { Audio } from '../dsp/util.js';

/** Mid/side width: 1 = unchanged, 0 = mono, >1 = wider. Optionally keeps bass mono below monoBelowHz. */
export function stereoWidth(a: Audio, width: number, monoBelowHz = 0): void {
  if (a.channels.length < 2) return;
  const [l, r] = a.channels;
  const n = l.length;
  const m = new Float32Array(n), s = new Float32Array(n);
  for (let i = 0; i < n; i++) { m[i] = (l[i] + r[i]) * 0.5; s[i] = (l[i] - r[i]) * 0.5; }
  if (monoBelowHz > 0) {
    // remove the low band from the side channel (phase-coherent: s = s - LP(s) = HP(s) for LR4 splits)
    lr4('highpass', a.sampleRate, monoBelowHz).run(s);
  }
  for (let i = 0; i < n; i++) { const sw = s[i] * width; l[i] = m[i] + sw; r[i] = m[i] - sw; }
}

/** Constant-power pan law for a mono source → stereo. pan ∈ [-1, 1]. */
export function panMono(x: Float32Array, pan: number): [Float32Array, Float32Array] {
  const ang = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(ang) * Math.SQRT2, gr = Math.sin(ang) * Math.SQRT2;
  const L = new Float32Array(x.length), R = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { L[i] = x[i] * gl; R[i] = x[i] * gr; }
  return [L, R];
}

/** Balance an already-stereo signal, constant power. */
export function balance(a: Audio, pan: number): void {
  if (a.channels.length < 2 || Math.abs(pan) < 1e-4) return;
  const ang = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(ang) * Math.SQRT2, gr = Math.sin(ang) * Math.SQRT2;
  for (let i = 0; i < a.channels[0].length; i++) { a.channels[0][i] *= gl; a.channels[1][i] *= gr; }
}
