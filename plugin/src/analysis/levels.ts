import { linToDb } from '../dsp/util.js';

/** Percentile (0..100) of short-window RMS levels in dBFS, ignoring digital silence. Used to set thresholds relative to material. */
export function rmsPercentileDb(x: Float32Array, sr: number, pct: number, windowMs = 50): number {
  const w = Math.max(1, Math.round((windowMs / 1000) * sr));
  const lv: number[] = [];
  for (let s = 0; s + w <= x.length; s += w) {
    let e = 0; for (let i = 0; i < w; i++) e += x[s + i] * x[s + i];
    const db = linToDb(Math.sqrt(e / w));
    if (db > -90) lv.push(db);
  }
  if (!lv.length) return -90;
  lv.sort((a, b) => a - b);
  return lv[Math.min(lv.length - 1, Math.floor((pct / 100) * lv.length))];
}

/** Same but across channels (loudest channel per window). */
export function levelPercentileDb(chs: Float32Array[], sr: number, pct: number, windowMs = 50): number {
  return Math.max(...chs.map((c) => rmsPercentileDb(c, sr, pct, windowMs)));
}
