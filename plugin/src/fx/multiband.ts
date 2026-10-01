import { lr4 } from '../dsp/biquad.js';
import { compress, type CompressorParams } from './compressor.js';
import type { Audio } from '../dsp/util.js';

export interface BandSpec extends Partial<CompressorParams> { gainDb?: number }
export interface MultibandParams {
  /** Crossover frequencies (ascending). N crossovers → N+1 bands. */
  crossovers: number[];
  bands: BandSpec[];
}

/** Split a signal into phase-coherent LR4 bands that sum back flat. */
export function splitBands(x: Float32Array, sr: number, xovers: number[]): Float32Array[] {
  if (!xovers.length) return [x];
  const [f, ...rest] = xovers;
  let low = new Float32Array(x), high = new Float32Array(x);
  lr4('lowpass', sr, f).run(low);
  lr4('highpass', sr, f).run(high);
  // phase-compensate the low band for every later crossover
  for (const fr of rest) {
    const lp = new Float32Array(low), hp = new Float32Array(low);
    lr4('lowpass', sr, fr).run(lp); lr4('highpass', sr, fr).run(hp);
    for (let i = 0; i < low.length; i++) low[i] = lp[i] + hp[i];
  }
  return [low, ...splitBands(high, sr, rest)];
}

export function multibandCompress(a: Audio, p: MultibandParams): { gainReductionDb: number[] } {
  const sr = a.sampleRate, n = a.channels[0].length;
  const nb = p.crossovers.length + 1;
  const perCh = a.channels.map((c) => splitBands(c, sr, p.crossovers));
  const grs: number[] = [];
  for (let b = 0; b < nb; b++) {
    const spec = p.bands[b] ?? {};
    const bandAudio: Audio = { sampleRate: sr, channels: perCh.map((chBands) => chBands[b]) };
    if (spec.thresholdDb !== undefined) {
      const r = compress(bandAudio, { ratio: 2, attackMs: 20, releaseMs: 150, kneeDb: 8, ...spec, thresholdDb: spec.thresholdDb });
      grs.push(r.avgGainReductionDb);
    } else grs.push(0);
    if (spec.gainDb) { const g = Math.pow(10, spec.gainDb / 20); for (const c of bandAudio.channels) for (let i = 0; i < n; i++) c[i] *= g; }
  }
  for (let c = 0; c < a.channels.length; c++) {
    const out = a.channels[c];
    out.fill(0);
    for (let b = 0; b < nb; b++) { const src = perCh[c][b]; for (let i = 0; i < n; i++) out[i] += src[i]; }
  }
  return { gainReductionDb: grs };
}
