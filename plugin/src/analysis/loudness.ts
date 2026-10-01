import { Biquad, type BiquadCoefs } from '../dsp/biquad.js';
import type { Audio } from '../dsp/util.js';
import { linToDb } from '../dsp/util.js';

/**
 * ITU-R BS.1770-4 K-weighting. The published 48 kHz coefficients come from an analog prototype
 * (high shelf + RLB high-pass); designing from the prototype keeps the filter exact at any sample rate.
 */
export function kWeightCoefs(sr: number): [BiquadCoefs, BiquadCoefs] {
  // stage 1: head-related high shelf
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: BiquadCoefs = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0,
  };
  // stage 2: RLB high-pass (unity gain at HF)
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const d = 1 + K1 / Q1 + K1 * K1;
  const hp: BiquadCoefs = { b0: 1, b1: -2, b2: 1, a1: (2 * (K1 * K1 - 1)) / d, a2: (1 - K1 / Q1 + K1 * K1) / d };
  return [shelf, hp];
}

export function kWeight(a: Audio): Float32Array[] {
  const [c1, c2] = kWeightCoefs(a.sampleRate);
  return a.channels.map((src) => {
    const out = new Float32Array(src);
    const shelf = new Biquad(c1), hp = new Biquad(c2);
    for (let i = 0; i < out.length; i++) out[i] = hp.process(shelf.process(out[i]));
    return out;
  });
}

export interface LoudnessResult {
  integrated: number;       // LUFS (gated)
  shortTermMax: number;     // LUFS
  momentaryMax: number;     // LUFS
  range: number;            // LU (LRA)
  shortTerm: number[];      // series, 1 value / second
}

/** Mean-square energy of every 100 ms sub-block (channels summed). All BS.1770 windows are multiples of this. */
function subBlocks(kw: Float32Array[], sub: number): Float64Array {
  const n = kw[0].length, count = Math.floor(n / sub);
  const out = new Float64Array(count);
  for (const c of kw) {
    for (let j = 0; j < count; j++) {
      let e = 0; const o = j * sub;
      for (let i = o; i < o + sub; i++) e += c[i] * c[i];
      out[j] += e / sub;
    }
  }
  return out;
}

/** Sliding mean over `win` sub-blocks with hop `hop` sub-blocks. */
function windowPowers(sb: Float64Array, win: number, hop: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let j = 0; j < Math.min(win, sb.length); j++) acc += sb[j];
  if (sb.length < win) return out;
  out.push(acc / win);
  for (let start = 1; start + win <= sb.length; start++) {
    acc += sb[start + win - 1] - sb[start - 1];
    if (start % hop === 0) out.push(Math.max(acc, 0) / win);
  }
  return out;
}

const lufs = (power: number) => -0.691 + 10 * Math.log10(Math.max(power, 1e-20));

export function measureLoudness(a: Audio): LoudnessResult {
  const kw = kWeight(a);
  const sr = a.sampleRate;
  const n = a.channels[0].length;
  if (n < sr * 0.4) {
    let p = 0;
    for (const c of kw) { let e = 0; for (let i = 0; i < n; i++) e += c[i] * c[i]; p += e / Math.max(n, 1); }
    const l = lufs(p);
    return { integrated: l, shortTermMax: l, momentaryMax: l, range: 0, shortTerm: [l] };
  }
  const sub = Math.round(sr / 10);
  const sb = subBlocks(kw, sub);
  const mom = windowPowers(sb, 4, 1);
  const absGated = mom.filter((p) => lufs(p) > -70);
  let integrated = -70;
  if (absGated.length) {
    const rel = lufs(absGated.reduce((s, p) => s + p, 0) / absGated.length) - 10;
    const g = absGated.filter((p) => lufs(p) > rel);
    if (g.length) integrated = lufs(g.reduce((s, p) => s + p, 0) / g.length);
  }
  const st = windowPowers(sb, 30, 10).map(lufs);
  const stGated = st.filter((l) => l > -70);
  let range = 0;
  if (stGated.length > 2) {
    const pw = stGated.map((l) => Math.pow(10, (l + 0.691) / 10));
    const rel = lufs(pw.reduce((s, p) => s + p, 0) / pw.length) - 20;
    const s2 = stGated.filter((l) => l > rel).sort((x, y) => x - y);
    if (s2.length > 1) range = s2[Math.floor(0.95 * (s2.length - 1))] - s2[Math.floor(0.1 * (s2.length - 1))];
  }
  return {
    integrated,
    shortTermMax: st.length ? Math.max(...st) : integrated,
    momentaryMax: mom.length ? lufs(Math.max(...mom)) : integrated,
    range,
    shortTerm: st,
  };
}

// ───────────── True peak (4x oversampled windowed-sinc interpolation) ─────────────

export const OS = 4;
export const TP_TAPS = 16; // taps per fractional phase (even)

/** coef[p-1][m]: weight of x[i - TP_TAPS/2 + 1 + m] for the point at i + p/OS. */
let coefTable: Float64Array[] | null = null;
function coefs(): Float64Array[] {
  if (coefTable) return coefTable;
  const T = TP_TAPS;
  coefTable = [];
  for (let p = 1; p < OS; p++) {
    const c = new Float64Array(T);
    let sum = 0;
    for (let m = 0; m < T; m++) {
      const u = p / OS - (m - T / 2 + 1);
      const sinc = Math.sin(Math.PI * u) / (Math.PI * u);
      const t = (u + T / 2) / T; // 0..1 across window
      const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * t) + 0.14128 * Math.cos(4 * Math.PI * t) - 0.01168 * Math.cos(6 * Math.PI * t);
      c[m] = sinc * w; sum += c[m];
    }
    for (let m = 0; m < T; m++) c[m] /= sum; // unity DC gain
    coefTable.push(c);
  }
  return coefTable;
}

/**
 * Per-sample inter-sample peak estimate: max |x| over the 4x oversampled points in [i, i+1].
 * `skipBelow`: where every sample in the 16-tap neighbourhood is below this, the interpolated value cannot
 * matter to the caller (Lebesgue constant of the interpolator < 2.5), so the expensive FIR is skipped.
 */
export function truePeakEnvelope(x: Float32Array, skipBelow = 0): Float32Array {
  const tab = coefs();
  const out = new Float32Array(x.length);
  const n = x.length, T = TP_TAPS, base = T / 2 - 1;
  const B = 16, nb = Math.ceil(n / B);
  const bmax = new Float32Array(nb);
  if (skipBelow > 0) for (let i = 0; i < n; i++) { const v = x[i] < 0 ? -x[i] : x[i]; if (v > bmax[(i / B) | 0]) bmax[(i / B) | 0] = v; }
  for (let i = 0; i < n; i++) {
    let m = x[i] < 0 ? -x[i] : x[i];
    if (skipBelow > 0) {
      const b = (i / B) | 0;
      const nm = Math.max(bmax[b], b > 0 ? bmax[b - 1] : 0, b + 1 < nb ? bmax[b + 1] : 0);
      if (nm < skipBelow) { out[i] = m; continue; }
    }
    for (let p = 0; p < OS - 1; p++) {
      const c = tab[p];
      let s = 0;
      const lo = Math.max(0, base - i), hi = Math.min(T, n - i + base);
      for (let k = lo; k < hi; k++) s += c[k] * x[i - base + k];
      const v = s < 0 ? -s : s;
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}

/** True peak in dBTP for the whole file. */
export function measureTruePeak(a: Audio): number {
  const tab = coefs();
  let peak = 0;
  const T = TP_TAPS, base = T / 2 - 1;
  for (const c of a.channels) {
    let sp = 0;
    for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > sp) sp = v; }
    if (sp > peak) peak = sp;
    const thr = sp * 0.6; // inter-sample overs can only occur next to large samples
    const n = c.length;
    for (let i = 0; i < n; i++) {
      if (Math.abs(c[i]) < thr && Math.abs(c[i + 1 < n ? i + 1 : i]) < thr) continue;
      for (let p = 0; p < OS - 1; p++) {
        let s = 0;
        const t = tab[p];
        for (let k = 0; k < T; k++) { const idx = i - base + k; if (idx >= 0 && idx < n) s += t[k] * c[idx]; }
        const v = Math.abs(s);
        if (v > peak) peak = v;
      }
    }
  }
  return linToDb(peak);
}
