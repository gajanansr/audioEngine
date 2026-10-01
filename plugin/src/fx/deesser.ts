import { lr4 } from '../dsp/biquad.js';
import { dbToLin, linToDb, timeCoef, type Audio } from '../dsp/util.js';

export interface DeEsserParams {
  /** Crossover (Hz) above which sibilance is detected & reduced. */
  freqHz?: number;
  /** Detector threshold in dB (band level). 'auto' derives it from the material. */
  thresholdDb?: number | 'auto';
  ratio?: number;
  maxReductionDb?: number;
}

/** Split-band de-esser: only the band above `freqHz` is attenuated, so the rest of the voice is untouched. */
export function deEss(a: Audio, p: DeEsserParams = {}): { avgReductionDb: number } {
  const sr = a.sampleRate, n = a.channels[0].length;
  const f = p.freqHz ?? 5500;
  const ratio = p.ratio ?? 4;
  const maxRed = p.maxReductionDb ?? 9;
  const bands = a.channels.map((c) => {
    const lo = new Float32Array(c), hi = new Float32Array(c);
    lr4('lowpass', sr, f).run(lo); lr4('highpass', sr, f).run(hi);
    return { lo, hi };
  });
  // detector: linked peak envelope of the high band
  const env = new Float32Array(n);
  const a1 = timeCoef(0.5, sr), r1 = timeCoef(25, sr);
  let e = 0;
  for (let i = 0; i < n; i++) {
    let m = 0; for (const b of bands) m = Math.max(m, Math.abs(b.hi[i]));
    e = m > e ? a1 * e + (1 - a1) * m : r1 * e + (1 - r1) * m;
    env[i] = e;
  }
  let thr: number;
  if (p.thresholdDb === undefined || p.thresholdDb === 'auto') {
    // threshold = 75th percentile of active band levels + 1.5 dB → only the worst esses are touched
    const lv: number[] = [];
    const step = Math.max(1, Math.round(sr * 0.01));
    for (let i = 0; i < n; i += step) { const d = linToDb(env[i]); if (d > -60) lv.push(d); }
    lv.sort((x, y) => x - y);
    thr = lv.length ? lv[Math.floor(lv.length * 0.75)] + 1.5 : 0;
  } else thr = p.thresholdDb;

  const aA = timeCoef(0.3, sr), aR = timeCoef(30, sr);
  let gr = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const over = linToDb(env[i]) - thr;
    const target = over > 0 ? Math.max(-maxRed, -over * (1 - 1 / ratio)) : 0;
    gr = target < gr ? aA * gr + (1 - aA) * target : aR * gr + (1 - aR) * target;
    sum += gr;
    const g = dbToLin(gr);
    for (let c = 0; c < a.channels.length; c++) a.channels[c][i] = bands[c].lo[i] + bands[c].hi[i] * g;
  }
  return { avgReductionDb: sum / Math.max(n, 1) };
}
