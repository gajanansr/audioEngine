import { FFT } from '../dsp/fft.js';
import type { Audio } from '../dsp/util.js';

export interface DenoiseParams {
  /** Max attenuation in dB applied to noise bins. */
  reductionDb?: number;
  /** 0..1 how aggressively noise is subtracted. */
  strength?: number;
}

/**
 * Spectral-gating noise reduction. The noise profile is learnt automatically from the quietest
 * frames (minimum statistics), so no separate noise sample is needed — ideal for phone recordings.
 */
export function denoise(a: Audio, p: DenoiseParams = {}): { estimatedNoiseDb: number } {
  const N = 2048, hop = 512, bins = N / 2 + 1;
  const strength = p.strength ?? 0.7;
  const floor = Math.pow(10, -(p.reductionDb ?? 12) / 20);
  const fft = new FFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); // sqrt-Hann (analysis+synthesis)
  let noiseDb = -120;

  for (const ch of a.channels) {
    const len = ch.length;
    if (len < N * 2) continue;
    const padded = new Float32Array(len + 2 * N);
    padded.set(ch, N);
    const total = Math.ceil((len + N) / hop);
    const mags: Float32Array[] = [];
    const re = new Float64Array(N), im = new Float64Array(N);
    const frameStart = (f: number) => f * hop;
    for (let f = 0; f < total; f++) {
      const s = frameStart(f);
      for (let i = 0; i < N; i++) { re[i] = (padded[s + i] ?? 0) * win[i]; im[i] = 0; }
      fft.transform(re, im);
      const m = new Float32Array(bins);
      for (let k = 0; k < bins; k++) m[k] = Math.hypot(re[k], im[k]);
      mags.push(m);
    }
    // noise profile = per-bin 15th percentile of magnitude over time, smoothed across frequency
    const profile = new Float32Array(bins);
    const col = new Float32Array(mags.length);
    for (let k = 0; k < bins; k++) {
      for (let f = 0; f < mags.length; f++) col[f] = mags[f][k];
      const sorted = Float32Array.from(col).sort();
      profile[k] = sorted[Math.floor(sorted.length * 0.15)];
    }
    const prof = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      let s = 0, c = 0;
      for (let d = -3; d <= 3; d++) { const j = k + d; if (j >= 0 && j < bins) { s += profile[j]; c++; } }
      prof[k] = (s / c) * 2.3; // 15th-percentile → mean noise magnitude (Rayleigh bins), slight over-subtraction
    }
    noiseDb = Math.max(noiseDb, 20 * Math.log10(Math.max(1e-9, Math.sqrt(prof.reduce((s, v) => s + v * v, 0) / bins) / N)));

    const out = new Float64Array(len + 2 * N);
    const prevGain = new Float32Array(bins).fill(1);
    const gain = new Float32Array(bins);
    // smoothed magnitude (3 frames × 5 bins): decisions on a low-variance estimate stop random noise peaks leaking through
    const smag = (f: number, k: number) => {
      let s = 0, c = 0;
      for (let df = -1; df <= 1; df++) {
        const m = mags[Math.min(total - 1, Math.max(0, f + df))];
        for (let dk = -2; dk <= 2; dk++) { const j = k + dk; if (j >= 0 && j < bins) { s += m[j]; c++; } }
      }
      return s / c;
    };
    for (let f = 0; f < total; f++) {
      // second pass: recompute this frame's spectrum instead of holding every complex frame in memory
      { const st = frameStart(f); for (let i = 0; i < N; i++) { re[i] = (padded[st + i] ?? 0) * win[i]; im[i] = 0; } fft.transform(re, im); }
      const spRe = Float64Array.from(re.subarray(0, bins)), spIm = Float64Array.from(im.subarray(0, bins));
      for (let k = 0; k < bins; k++) {
        const ms = smag(f, k);
        const snr = ms > 1e-12 ? prof[k] / ms : 1;
        let g = 1 - strength * snr * snr; // power-domain Wiener-ish gain
        g = Math.max(floor, Math.min(1, g));
        // temporal smoothing: fast attack (open), slow release (close) → avoids musical noise
        g = g > prevGain[k] ? 0.4 * prevGain[k] + 0.6 * g : 0.8 * prevGain[k] + 0.2 * g;
        gain[k] = g;
      }
      // frequency smoothing
      for (let k = 0; k < bins; k++) {
        const g = 0.25 * gain[Math.max(0, k - 1)] + 0.5 * gain[k] + 0.25 * gain[Math.min(bins - 1, k + 1)];
        prevGain[k] = gain[k];
        re[k] = spRe[k] * g; im[k] = spIm[k] * g;
        if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      }
      im[0] = 0; im[N / 2] = 0;
      fft.transform(re, im, true);
      const s = frameStart(f);
      for (let i = 0; i < N; i++) out[s + i] += re[i] * win[i];
    }
    // sqrt-Hann analysis × sqrt-Hann synthesis = Hann; Hann at 75% overlap sums to 2.0
    for (let i = 0; i < len; i++) ch[i] = out[i + N] / 2;
  }
  return { estimatedNoiseDb: noiseDb };
}
