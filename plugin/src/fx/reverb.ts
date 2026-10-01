import { Biquad, designBiquad } from '../dsp/biquad.js';
import { toMono, type Audio } from '../dsp/util.js';

export interface ReverbParams {
  /** Decay time in seconds (RT60). */
  rt60?: number;
  preDelayMs?: number;
  /** 0..1 — high-frequency damping inside the tank. */
  damping?: number;
  /** Wet filtering keeps the verb out of the mud and out of the harshness. */
  wetHpHz?: number;
  wetLpHz?: number;
  /** Stereo spread of the wet signal 0..1 */
  width?: number;
}

const DELAYS_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.3, 73.1];
const AP_MS = [5.1, 7.7, 11.3, 13.9];

/** Returns the WET signal only (use as an aux send). 8-line Feedback Delay Network with Hadamard mixing. */
export function reverbWet(a: Audio, p: ReverbParams = {}): Audio {
  const sr = a.sampleRate, n = a.channels[0].length;
  const rt60 = p.rt60 ?? 1.6;
  const width = p.width ?? 1;
  const N = 8;
  const lens = DELAYS_MS.map((ms) => Math.round((ms / 1000) * sr * (sr / 48000 > 1 ? 1 : 1)));
  const bufs = lens.map((l) => new Float32Array(l));
  const idx = new Int32Array(N);
  const damp = (p.damping ?? 0.45);
  const lps = lens.map(() => new Biquad(designBiquad('lowpass', sr, 12000 * (1 - damp * 0.85) + 1500, 0.5)));
  // per-line feedback gain for RT60: g = 10^(-3 * len / (sr * rt60))
  const gains = lens.map((l) => Math.pow(10, (-3 * l) / (sr * rt60)));
  const mono = toMono(a);
  const pd = Math.round(((p.preDelayMs ?? 20) / 1000) * sr);
  // input diffusion (series allpass)
  const apLens = AP_MS.map((ms) => Math.round((ms / 1000) * sr));
  const apBufs = apLens.map((l) => new Float32Array(l));
  const apIdx = new Int32Array(AP_MS.length);
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const norm = 1 / Math.sqrt(N);
  const v = new Float64Array(N);
  const tail = Math.round(rt60 * sr * 1.2);
  const total = n; // keep length identical to the input; the tail is rendered by padding the input beforehand
  void tail;
  for (let i = 0; i < total; i++) {
    let x = i >= pd ? mono[i - pd] : 0;
    for (let k = 0; k < apBufs.length; k++) {
      const b = apBufs[k], j = apIdx[k];
      const d = b[j];
      const w = x + 0.6 * d;
      b[j] = w;
      x = d - 0.6 * w;
      apIdx[k] = (j + 1) % apLens[k];
    }
    // read delay lines
    for (let k = 0; k < N; k++) v[k] = bufs[k][idx[k]];
    // fast Walsh–Hadamard (orthogonal mixing)
    for (let h = 1; h < N; h <<= 1) {
      for (let s = 0; s < N; s += h << 1) {
        for (let j = s; j < s + h; j++) { const u = v[j], w = v[j + h]; v[j] = u + w; v[j + h] = u - w; }
      }
    }
    let l = 0, r = 0;
    for (let k = 0; k < N; k++) {
      const fb = lps[k].process(v[k] * norm * gains[k]);
      bufs[k][idx[k]] = fb + x * 0.35;
      idx[k] = (idx[k] + 1) % lens[k];
      if (k & 1) r += fb; else l += fb;
    }
    outL[i] = l * 0.5; outR[i] = r * 0.5;
  }
  const wet: Audio = { sampleRate: sr, channels: [outL, outR] };
  // width via M/S
  if (width !== 1) {
    for (let i = 0; i < n; i++) { const m = (outL[i] + outR[i]) * 0.5, s = (outL[i] - outR[i]) * 0.5 * width; outL[i] = m + s; outR[i] = m - s; }
  }
  const hp = p.wetHpHz ?? 250, lp = p.wetLpHz ?? 9000;
  for (const ch of wet.channels) {
    const f = [new Biquad(designBiquad('highpass', sr, hp, 0.7071)), new Biquad(designBiquad('lowpass', sr, lp, 0.7071))];
    for (let i = 0; i < n; i++) ch[i] = f[1].process(f[0].process(ch[i]));
  }
  return wet;
}
