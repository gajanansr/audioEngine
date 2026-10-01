import { FFT, hann } from '../dsp/fft.js';
import { toMono, type Audio } from '../dsp/util.js';

/** ISO 1/3-octave centre frequencies from 25 Hz to 20 kHz. */
export const THIRD_OCT: number[] = (() => {
  const f: number[] = [];
  for (let i = -16; i <= 13; i++) f.push(1000 * Math.pow(2, i / 3));
  return f.filter((x) => x >= 24 && x <= 20500);
})();

export interface Spectrum {
  freqs: number[];     // third-octave centres
  levelsDb: number[];  // energy per band (dB, relative scale, comparable between files after normalising)
}

/** Welch average power spectrum → third-octave band energies. Ignores near-silent frames. */
export function thirdOctaveSpectrum(a: Audio, fftSize = 8192): Spectrum {
  const x = toMono(a);
  const sr = a.sampleRate;
  const fft = new FFT(fftSize);
  const win = hann(fftSize);
  const hop = fftSize / 2;
  const bins = fftSize / 2 + 1;
  const acc = new Float64Array(bins);
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  // gate: skip frames that are >40 dB below the loudest (silence / tails) so quiet passages don't skew tone
  const frameRms: number[] = [];
  for (let s = 0; s + fftSize <= x.length; s += hop) {
    let e = 0; for (let i = 0; i < fftSize; i++) e += x[s + i] * x[s + i];
    frameRms.push(e / fftSize);
  }
  if (!frameRms.length) return { freqs: THIRD_OCT, levelsDb: THIRD_OCT.map(() => -120) };
  const maxE = Math.max(...frameRms);
  const gate = maxE * 1e-4;
  let used = 0, fi = 0;
  for (let s = 0; s + fftSize <= x.length; s += hop, fi++) {
    if (frameRms[fi] < gate) continue;
    for (let i = 0; i < fftSize; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
    fft.transform(re, im);
    for (let k = 0; k < bins; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  const binHz = sr / fftSize;
  const levels = THIRD_OCT.map((fc) => {
    const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6);
    let e = 0, count = 0;
    for (let k = Math.max(1, Math.floor(lo / binHz)); k <= Math.min(bins - 1, Math.ceil(hi / binHz)); k++) {
      const f = k * binHz;
      if (f >= lo && f < hi) { e += acc[k]; count++; }
    }
    if (!count || !used) return -120;
    return 10 * Math.log10(Math.max(e / used, 1e-30)); // band energy (sum of bins)
  });
  return { freqs: THIRD_OCT, levelsDb: levels };
}

/** Energy (dB re arbitrary) integrated over a frequency range of a Spectrum. */
export function bandEnergyDb(sp: Spectrum, lo: number, hi: number): number {
  let e = 0;
  sp.freqs.forEach((f, i) => { if (f >= lo && f < hi) e += Math.pow(10, sp.levelsDb[i] / 10); });
  return 10 * Math.log10(Math.max(e, 1e-30));
}

export function spectralCentroid(sp: Spectrum): number {
  let num = 0, den = 0;
  sp.freqs.forEach((f, i) => { const e = Math.pow(10, sp.levelsDb[i] / 10); num += f * e; den += e; });
  return den ? num / den : 0;
}
