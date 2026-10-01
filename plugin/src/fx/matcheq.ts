import { FFT } from '../dsp/fft.js';
import type { Audio } from '../dsp/util.js';

/**
 * Linear-phase EQ from an arbitrary gain curve (dB as a function of frequency).
 * FIR designed by frequency sampling, applied by FFT overlap-add, delay-compensated → no phase smear, ideal for mastering.
 */
export function applyLinearPhaseCurve(a: Audio, gainDbAt: (hz: number) => number, taps = 4096): void {
  const sr = a.sampleRate;
  const N = taps * 2; // FFT size for design
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k <= N / 2; k++) {
    const hz = (k * sr) / N;
    const g = Math.pow(10, gainDbAt(Math.max(hz, 1)) / 20);
    re[k] = g; if (k > 0 && k < N / 2) re[N - k] = g;
  }
  const fft = new FFT(N);
  fft.transform(re, im, true); // zero-phase impulse (symmetric, centred at 0)
  const h = new Float64Array(taps);
  const half = taps / 2;
  for (let i = 0; i < taps; i++) {
    const src = (i - half + N) % N;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)); // Hann window to tame truncation ripple
    h[i] = re[src] * w;
  }
  // FFT overlap-add
  const B = 8192, F = B + taps - 1;
  let fsz = 1; while (fsz < F) fsz <<= 1;
  const conv = new FFT(fsz);
  const hr = new Float64Array(fsz), hi = new Float64Array(fsz);
  hr.set(h); conv.transform(hr, hi);
  for (const ch of a.channels) {
    const len = ch.length;
    const out = new Float64Array(len + taps);
    const xr = new Float64Array(fsz), xi = new Float64Array(fsz);
    for (let s = 0; s < len; s += B) {
      xr.fill(0); xi.fill(0);
      const m = Math.min(B, len - s);
      for (let i = 0; i < m; i++) xr[i] = ch[s + i];
      conv.transform(xr, xi);
      for (let k = 0; k < fsz; k++) { const r = xr[k] * hr[k] - xi[k] * hi[k]; const i2 = xr[k] * hi[k] + xi[k] * hr[k]; xr[k] = r; xi[k] = i2; }
      conv.transform(xr, xi, true);
      for (let i = 0; i < m + taps - 1 && s + i < out.length; i++) out[s + i] += xr[i];
    }
    for (let i = 0; i < len; i++) ch[i] = out[i + half];
  }
}

/** Build a smooth gain function from (freq, dB) points — log-frequency linear interpolation. */
export function curveFromPoints(freqs: number[], gains: number[]): (hz: number) => number {
  return (hz) => {
    if (hz <= freqs[0]) return gains[0];
    if (hz >= freqs[freqs.length - 1]) return gains[gains.length - 1];
    let i = 1; while (freqs[i] < hz) i++;
    const t = (Math.log(hz) - Math.log(freqs[i - 1])) / (Math.log(freqs[i]) - Math.log(freqs[i - 1]));
    // smoothstep for a gentle curve
    const s = t * t * (3 - 2 * t);
    return gains[i - 1] + (gains[i] - gains[i - 1]) * s;
  };
}
