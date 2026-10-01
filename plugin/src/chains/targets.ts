import type { Spectrum } from '../analysis/spectrum.js';

/** Target tonal balance: third-octave band level in dB relative to the 1 kHz band. Anchors are interpolated in log-frequency. */
export type TargetCurve = { freqs: number[]; db: number[] };

const F = [25, 31.5, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000, 20000];

// Typical long-term average spectra of commercially mastered music (1/3-octave band energy, rel. 1 kHz).
const BALANCED = [-16, -13, -9, -3.5, 0, 1.5, 1.5, 1, 0.5, 0, -2, -4, -6.5, -9.5, -13, -19, -26];

export const GENRE_OFFSETS: Record<string, number[]> = {
  balanced: BALANCED.map(() => 0),
  pop:      [0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0.3, 0.5, 0.5, 0.5, 0.5, 0, 0],
  hiphop:   [3, 3.5, 3.5, 3, 2, 0.5, -0.5, -1, -0.5, 0, 0, 0, 0, 0, -0.5, -1, -1],
  trap:     [4, 4.5, 4.5, 4, 2.5, 0.5, -0.5, -1.5, -1, 0, 0, 0, 0.5, 0.5, 0, -1, -1],
  edm:      [2, 2.5, 3, 3, 1.5, 0, -0.5, -1, -1, 0, 0.5, 1, 1.5, 1.5, 1, 0, -1],
  rock:     [-1, -1, -1, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 1, 1.5, 1.5, 1, 0, -1, -1.5],
  acoustic: [-3, -3, -3, -2, -1.5, -0.5, 0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 0],
  rnb:      [2, 2.5, 2.5, 2, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.5, -0.5],
  jazz:     [-2, -2, -2, -1, -0.5, 0, 0.5, 0.5, 0.5, 0, 0, 0, -0.5, -0.5, -0.5, -1, -1],
  classical:[-3, -3, -3, -2, -1, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, -0.5, -1, -2],
  podcast:  [-30, -28, -24, -14, -6, 0, 3, 3, 1.5, 0, -1, -1.5, -3, -6, -10, -15, -20],
};

export function genreCurve(genre = 'balanced'): TargetCurve {
  const off = GENRE_OFFSETS[genre] ?? GENRE_OFFSETS.balanced;
  return { freqs: F, db: BALANCED.map((v, i) => v + off[i]) };
}

/** Lead-vocal tonal target (pop/hip-hop/R&B style). */
export const VOCAL_TARGET: TargetCurve = {
  freqs: [63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000],
  db:    [-22, -6, 0.5, 3.5, 4, 2, 0, -1.5, -3, -6, -9.5, -13.5, -20],
};

export function interpCurve(c: TargetCurve, hz: number): number {
  const { freqs, db } = c;
  if (hz <= freqs[0]) return db[0];
  if (hz >= freqs[freqs.length - 1]) return db[db.length - 1];
  let i = 1; while (freqs[i] < hz) i++;
  const t = (Math.log(hz) - Math.log(freqs[i - 1])) / (Math.log(freqs[i]) - Math.log(freqs[i - 1]));
  return db[i - 1] + (db[i] - db[i - 1]) * t;
}

export interface CorrectionOptions {
  /** 0..1 how far to move toward the target. */
  intensity: number;
  maxBoostDb: number;
  maxCutDb: number;
  /** Ignore frequencies outside this range when level-matching target to measurement. */
  matchRange?: [number, number];
  /** Frequencies with no real content (above the source's own lowpass) must not be boosted. */
  limitBoostAboveHz?: number;
  /** Frequencies below which no correction is applied (e.g. when a HPF already handles it). */
  minHz?: number;
}

/** Returns per-third-octave correction gains (dB) that nudge `measured` toward `target`. */
export function tonalCorrection(measured: Spectrum, target: TargetCurve, o: CorrectionOptions): { freqs: number[]; gains: number[] } {
  const [lo, hi] = o.matchRange ?? [100, 8000];
  const refIdx = measured.freqs.map((f, i) => (f >= lo && f <= hi ? i : -1)).filter((i) => i >= 0);
  // level-align target to measurement over the match range (so only *shape* differs)
  const offs = refIdx.map((i) => measured.levelsDb[i] - interpCurve(target, measured.freqs[i]));
  const align = offs.reduce((s, v) => s + v, 0) / Math.max(offs.length, 1);
  let diffs = measured.freqs.map((f, i) => interpCurve(target, f) + align - measured.levelsDb[i]);
  // smooth across neighbouring bands (±1) so corrections are broad, musical moves
  diffs = diffs.map((_, i) => {
    const a = diffs[Math.max(0, i - 1)], b = diffs[i], c = diffs[Math.min(diffs.length - 1, i + 1)];
    return 0.25 * a + 0.5 * b + 0.25 * c;
  });
  const gains = diffs.map((d, i) => {
    const f = measured.freqs[i];
    if (measured.levelsDb[i] < -100) return 0;
    let g = d * o.intensity;
    g = Math.max(-o.maxCutDb, Math.min(o.maxBoostDb, g));
    if (o.minHz && f < o.minHz) g = Math.min(g, 0) * 0.5;
    if (o.limitBoostAboveHz && f > o.limitBoostAboveHz) g = Math.min(g, 0);
    return g;
  });
  // Remove mean so the EQ is level-neutral (loudness handled elsewhere)
  const mean = gains.reduce((s, v) => s + v, 0) / gains.length;
  const centred = gains.map((g) => g - mean * 0.8);
  // re-clamp after centering so the limits are hard limits
  return { freqs: measured.freqs, gains: centred.map((g) => Math.max(-o.maxCutDb, Math.min(o.maxBoostDb, g))) };
}

/** Highest frequency with real content: detects MP3-style lowpass (e.g. 16 kHz) so we never boost into a void. */
export function contentCeilingHz(sp: Spectrum): number {
  const peak = Math.max(...sp.levelsDb);
  let top = sp.freqs[sp.freqs.length - 1];
  for (let i = sp.freqs.length - 1; i >= 0; i--) {
    if (sp.levelsDb[i] > peak - 75) { top = sp.freqs[i]; break; }
  }
  return top * 1.15;
}
