#!/usr/bin/env node
import{createRequire}from'module';const require=createRequire(import.meta.url);

// src/cli.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/api.ts
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname as extname2, join, resolve } from "node:path";

// src/dsp/util.ts
var dbToLin = (db) => Math.pow(10, db / 20);
var linToDb = (lin) => 20 * Math.log10(Math.max(lin, 1e-12));
function timeCoef(ms, sr) {
  if (ms <= 0) return 0;
  return Math.exp(-1 / (ms / 1e3 * sr));
}
var frames = (a) => a.channels[0]?.length ?? 0;
var duration = (a) => frames(a) / a.sampleRate;
function cloneAudio(a) {
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => new Float32Array(c)) };
}
function toStereo(a) {
  if (a.channels.length === 2) return a;
  if (a.channels.length === 1) return { sampleRate: a.sampleRate, channels: [a.channels[0], new Float32Array(a.channels[0])] };
  return { sampleRate: a.sampleRate, channels: [a.channels[0], a.channels[1]] };
}
function toMono(a) {
  if (a.channels.length === 1) return a.channels[0];
  const n = frames(a);
  const out = new Float32Array(n);
  const k = 1 / a.channels.length;
  for (const c of a.channels) for (let i = 0; i < n; i++) out[i] += c[i] * k;
  return out;
}
function applyGain(a, lin) {
  for (const c of a.channels) for (let i = 0; i < c.length; i++) c[i] *= lin;
}

// src/dsp/biquad.ts
function designBiquad(type, sr, freq, q = 0.7071, gainDb = 0) {
  const f = Math.min(Math.max(freq, 10), sr * 0.49);
  const w0 = 2 * Math.PI * f / sr;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sinw / (2 * Math.max(q, 0.05));
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case "lowpass":
      b0 = (1 - cosw) / 2;
      b1 = 1 - cosw;
      b2 = (1 - cosw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cosw) / 2;
      b1 = -(1 + cosw);
      b2 = (1 + cosw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1;
      b1 = -2 * cosw;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case "allpass":
      b0 = 1 - alpha;
      b1 = -2 * cosw;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A;
      b1 = -2 * cosw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw;
      a2 = 1 - alpha / A;
      break;
    case "lowshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cosw + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cosw);
      b2 = A * (A + 1 - (A - 1) * cosw - s);
      a0 = A + 1 + (A - 1) * cosw + s;
      a1 = -2 * (A - 1 + (A + 1) * cosw);
      a2 = A + 1 + (A - 1) * cosw - s;
      break;
    }
    case "highshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cosw + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cosw);
      b2 = A * (A + 1 + (A - 1) * cosw - s);
      a0 = A + 1 - (A - 1) * cosw + s;
      a1 = 2 * (A - 1 - (A + 1) * cosw);
      a2 = A + 1 - (A - 1) * cosw - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
var Biquad = class {
  constructor(c) {
    this.c = c;
  }
  z1 = 0;
  z2 = 0;
  process(x) {
    const c = this.c;
    const y = c.b0 * x + this.z1;
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
  run(buf) {
    for (let i = 0; i < buf.length; i++) buf[i] = this.process(buf[i]);
  }
  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }
};
var BiquadChain = class {
  filters;
  constructor(coefs2) {
    this.filters = coefs2.map((c) => new Biquad(c));
  }
  process(x) {
    for (const f of this.filters) x = f.process(x);
    return x;
  }
  run(buf) {
    for (const f of this.filters) f.run(buf);
  }
};
function lr4(type, sr, freq) {
  const c = designBiquad(type, sr, freq, Math.SQRT1_2);
  return new BiquadChain([c, { ...c }]);
}

// src/analysis/loudness.ts
function kWeightCoefs(sr) {
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + Vb * K / Q + K * K) / a0,
    b1: 2 * (K * K - Vh) / a0,
    b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0,
    a2: (1 - K / Q + K * K) / a0
  };
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan(Math.PI * f1 / sr);
  const d = 1 + K1 / Q1 + K1 * K1;
  const hp = { b0: 1, b1: -2, b2: 1, a1: 2 * (K1 * K1 - 1) / d, a2: (1 - K1 / Q1 + K1 * K1) / d };
  return [shelf, hp];
}
function kWeight(a) {
  const [c1, c2] = kWeightCoefs(a.sampleRate);
  return a.channels.map((src) => {
    const out = new Float32Array(src);
    const shelf = new Biquad(c1), hp = new Biquad(c2);
    for (let i = 0; i < out.length; i++) out[i] = hp.process(shelf.process(out[i]));
    return out;
  });
}
function subBlocks(kw, sub) {
  const n = kw[0].length, count = Math.floor(n / sub);
  const out = new Float64Array(count);
  for (const c of kw) {
    for (let j = 0; j < count; j++) {
      let e = 0;
      const o = j * sub;
      for (let i = o; i < o + sub; i++) e += c[i] * c[i];
      out[j] += e / sub;
    }
  }
  return out;
}
function windowPowers(sb, win, hop) {
  const out = [];
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
var lufs = (power) => -0.691 + 10 * Math.log10(Math.max(power, 1e-20));
function measureLoudness(a) {
  const kw = kWeight(a);
  const sr = a.sampleRate;
  const n = a.channels[0].length;
  if (n < sr * 0.4) {
    let p = 0;
    for (const c of kw) {
      let e = 0;
      for (let i = 0; i < n; i++) e += c[i] * c[i];
      p += e / Math.max(n, 1);
    }
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
    shortTerm: st
  };
}
var OS = 4;
var TP_TAPS = 16;
var coefTable = null;
function coefs() {
  if (coefTable) return coefTable;
  const T = TP_TAPS;
  coefTable = [];
  for (let p = 1; p < OS; p++) {
    const c = new Float64Array(T);
    let sum = 0;
    for (let m = 0; m < T; m++) {
      const u = p / OS - (m - T / 2 + 1);
      const sinc = Math.sin(Math.PI * u) / (Math.PI * u);
      const t = (u + T / 2) / T;
      const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * t) + 0.14128 * Math.cos(4 * Math.PI * t) - 0.01168 * Math.cos(6 * Math.PI * t);
      c[m] = sinc * w;
      sum += c[m];
    }
    for (let m = 0; m < T; m++) c[m] /= sum;
    coefTable.push(c);
  }
  return coefTable;
}
function truePeakEnvelope(x, skipBelow = 0) {
  const tab = coefs();
  const out = new Float32Array(x.length);
  const n = x.length, T = TP_TAPS, base = T / 2 - 1;
  const B = 16, nb = Math.ceil(n / B);
  const bmax = new Float32Array(nb);
  if (skipBelow > 0) for (let i = 0; i < n; i++) {
    const v = x[i] < 0 ? -x[i] : x[i];
    if (v > bmax[i / B | 0]) bmax[i / B | 0] = v;
  }
  for (let i = 0; i < n; i++) {
    let m = x[i] < 0 ? -x[i] : x[i];
    if (skipBelow > 0) {
      const b = i / B | 0;
      const nm = Math.max(bmax[b], b > 0 ? bmax[b - 1] : 0, b + 1 < nb ? bmax[b + 1] : 0);
      if (nm < skipBelow) {
        out[i] = m;
        continue;
      }
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
function measureTruePeak(a) {
  const tab = coefs();
  let peak = 0;
  const T = TP_TAPS, base = T / 2 - 1;
  for (const c of a.channels) {
    let sp = 0;
    for (let i = 0; i < c.length; i++) {
      const v = Math.abs(c[i]);
      if (v > sp) sp = v;
    }
    if (sp > peak) peak = sp;
    const thr = sp * 0.6;
    const n = c.length;
    for (let i = 0; i < n; i++) {
      if (Math.abs(c[i]) < thr && Math.abs(c[i + 1 < n ? i + 1 : i]) < thr) continue;
      for (let p = 0; p < OS - 1; p++) {
        let s = 0;
        const t = tab[p];
        for (let k = 0; k < T; k++) {
          const idx = i - base + k;
          if (idx >= 0 && idx < n) s += t[k] * c[idx];
        }
        const v = Math.abs(s);
        if (v > peak) peak = v;
      }
    }
  }
  return linToDb(peak);
}

// src/dsp/fft.ts
var FFT = class {
  size;
  cos;
  sin;
  rev;
  constructor(size) {
    if (size & size - 1) throw new Error("FFT size must be a power of two");
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos(2 * Math.PI * i / size);
      this.sin[i] = Math.sin(2 * Math.PI * i / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & 1 << b) r |= 1 << bits - 1 - b;
      this.rev[i] = r;
    }
  }
  /** inverse=false: forward. inverse=true: inverse incl. 1/N scaling. */
  transform(re, im, inverse = false) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = this.cos[t];
          const wi = sgn * this.sin[t];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
};
function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return w;
}

// src/analysis/spectrum.ts
var THIRD_OCT = (() => {
  const f = [];
  for (let i = -16; i <= 13; i++) f.push(1e3 * Math.pow(2, i / 3));
  return f.filter((x) => x >= 24 && x <= 20500);
})();
function thirdOctaveSpectrum(a, fftSize = 8192) {
  const x = toMono(a);
  const sr = a.sampleRate;
  const fft = new FFT(fftSize);
  const win = hann(fftSize);
  const hop = fftSize / 2;
  const bins = fftSize / 2 + 1;
  const acc = new Float64Array(bins);
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  const frameRms = [];
  for (let s = 0; s + fftSize <= x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < fftSize; i++) e += x[s + i] * x[s + i];
    frameRms.push(e / fftSize);
  }
  if (!frameRms.length) return { freqs: THIRD_OCT, levelsDb: THIRD_OCT.map(() => -120) };
  const maxE = Math.max(...frameRms);
  const gate = maxE * 1e-4;
  let used = 0, fi = 0;
  for (let s = 0; s + fftSize <= x.length; s += hop, fi++) {
    if (frameRms[fi] < gate) continue;
    for (let i = 0; i < fftSize; i++) {
      re[i] = x[s + i] * win[i];
      im[i] = 0;
    }
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
      if (f >= lo && f < hi) {
        e += acc[k];
        count++;
      }
    }
    if (!count || !used) return -120;
    return 10 * Math.log10(Math.max(e / used, 1e-30));
  });
  return { freqs: THIRD_OCT, levelsDb: levels };
}
function bandEnergyDb(sp, lo, hi) {
  let e = 0;
  sp.freqs.forEach((f, i) => {
    if (f >= lo && f < hi) e += Math.pow(10, sp.levelsDb[i] / 10);
  });
  return 10 * Math.log10(Math.max(e, 1e-30));
}
function spectralCentroid(sp) {
  let num2 = 0, den = 0;
  sp.freqs.forEach((f, i) => {
    const e = Math.pow(10, sp.levelsDb[i] / 10);
    num2 += f * e;
    den += e;
  });
  return den ? num2 / den : 0;
}

// src/analysis/analyze.ts
function stereoStats(a) {
  if (a.channels.length < 2) return { correlation: 1, width: 0, lowCorrelation: 1, mono: true };
  const [l, r] = a.channels;
  let ll = 0, rr = 0, lr = 0, mm = 0, ss = 0;
  for (let i = 0; i < l.length; i++) {
    ll += l[i] * l[i];
    rr += r[i] * r[i];
    lr += l[i] * r[i];
    const m = (l[i] + r[i]) * 0.5, s = (l[i] - r[i]) * 0.5;
    mm += m * m;
    ss += s * s;
  }
  const corr = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
  const lp1 = new Biquad(designBiquad("lowpass", a.sampleRate, 150, 0.7071));
  const lp2 = new Biquad(designBiquad("lowpass", a.sampleRate, 150, 0.7071));
  let a2 = 0, b2 = 0, ab = 0;
  for (let i = 0; i < l.length; i++) {
    const x = lp1.process(l[i]), y = lp2.process(r[i]);
    a2 += x * x;
    b2 += y * y;
    ab += x * y;
  }
  const low = a2 > 0 && b2 > 0 ? ab / Math.sqrt(a2 * b2) : 1;
  const width = mm + ss > 0 ? ss / (mm + ss) : 0;
  return { correlation: corr, width, lowCorrelation: low, mono: ss < 1e-9 * (mm + 1e-12) };
}
function analyze(a) {
  const n = a.channels[0].length;
  const loudness = measureLoudness(toStereo(a));
  let sp = 0, sq = 0, clipped = 0, dc = 0;
  for (const c of a.channels) {
    let run = 0;
    for (let i = 0; i < n; i++) {
      const v = c[i], av = Math.abs(v);
      if (av > sp) sp = av;
      sq += v * v;
      dc += v;
      if (av >= 0.9995) {
        run++;
        if (run === 3) clipped++;
      } else run = 0;
    }
  }
  const total = n * a.channels.length;
  const rms = Math.sqrt(sq / Math.max(total, 1));
  const mono = toMono(a);
  const w = Math.max(1, Math.round(a.sampleRate * 0.05));
  const levels = [];
  for (let s = 0; s + w <= n; s += w) {
    let e = 0;
    for (let i = 0; i < w; i++) e += mono[s + i] * mono[s + i];
    const db = linToDb(Math.sqrt(e / w));
    if (db > -110) levels.push(db);
  }
  levels.sort((x, y) => x - y);
  const noiseFloor = levels.length ? levels[Math.floor(levels.length * 0.1)] : -120;
  const spectrum = thirdOctaveSpectrum(a);
  const totalE = bandEnergyDb(spectrum, 20, 20500);
  const rel = (lo, hi) => bandEnergyDb(spectrum, lo, hi) - totalE;
  const samplePeakDb = linToDb(sp);
  return {
    durationSec: duration(a),
    sampleRate: a.sampleRate,
    channels: a.channels.length,
    loudness,
    truePeakDb: measureTruePeak(a),
    samplePeakDb,
    plr: samplePeakDb - loudness.integrated,
    crestDb: samplePeakDb - linToDb(rms),
    rmsDb: linToDb(rms),
    clippedSamples: clipped,
    dcOffset: dc / Math.max(total, 1),
    noiseFloorDb: noiseFloor,
    stereo: stereoStats(a),
    spectrum,
    bands: { sub: rel(20, 60), bass: rel(60, 250), lowMid: rel(250, 800), mid: rel(800, 3e3), presence: rel(3e3, 8e3), air: rel(8e3, 20500) },
    centroidHz: spectralCentroid(spectrum),
    sibilanceDb: bandEnergyDb(spectrum, 5e3, 9e3) - bandEnergyDb(spectrum, 1e3, 5e3)
  };
}
function summarize(an) {
  const r = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    duration_sec: r(an.durationSec, 1),
    sample_rate: an.sampleRate,
    channels: an.channels,
    integrated_lufs: r(an.loudness.integrated),
    short_term_max_lufs: r(an.loudness.shortTermMax),
    loudness_range_lu: r(an.loudness.range),
    true_peak_dbtp: r(an.truePeakDb),
    sample_peak_db: r(an.samplePeakDb),
    plr_db: r(an.plr),
    crest_db: r(an.crestDb),
    noise_floor_db: r(an.noiseFloorDb),
    clipped_samples: an.clippedSamples,
    dc_offset: Number(an.dcOffset.toExponential(2)),
    stereo: { correlation: r(an.stereo.correlation, 2), side_energy_ratio: r(an.stereo.width, 2), low_end_correlation: r(an.stereo.lowCorrelation, 2), is_mono: an.stereo.mono },
    tonal_balance_db_rel_total: Object.fromEntries(Object.entries(an.bands).map(([k, v]) => [k, r(v)])),
    spectral_centroid_hz: Math.round(an.centroidHz),
    sibilance_db: r(an.sibilanceDb)
  };
}

// src/analysis/diagnose.ts
function diagnose(an, kind = "mix") {
  const out = [];
  const sp = an.spectrum;
  const rel = (lo, hi2) => bandEnergyDb(sp, lo, hi2);
  if (an.clippedSamples > 5) out.push({ id: "clipping", severity: "problem", issue: `${an.clippedSamples} clipped regions detected (samples at full scale for 3+ frames).`, fix: "Re-export/re-record at a lower level. Mastering cannot fully repair hard clipping." });
  if (an.truePeakDb > -0.5) out.push({ id: "true_peak", severity: an.truePeakDb > 0 ? "problem" : "warning", issue: `True peak is ${an.truePeakDb.toFixed(1)} dBTP \u2014 will distort after MP3/AAC encoding.`, fix: "Mastering ceiling of -1 dBTP gives lossy codecs headroom." });
  if (Math.abs(an.dcOffset) > 2e-3) out.push({ id: "dc_offset", severity: "warning", issue: `DC offset of ${an.dcOffset.toFixed(4)} wastes headroom and can cause clicks.`, fix: "Automatically removed in the chain." });
  if (kind === "mix") {
    if (an.loudness.integrated > -9) out.push({ id: "too_loud", severity: "warning", issue: `Very loud (${an.loudness.integrated.toFixed(1)} LUFS): streaming platforms will turn it down, and heavy limiting costs punch.`, fix: "Target about -14 LUFS for streaming; keep louder versions only for club/DJ use." });
    if (an.loudness.integrated < -20) out.push({ id: "too_quiet", severity: "info", issue: `Quiet (${an.loudness.integrated.toFixed(1)} LUFS) compared with commercial releases.`, fix: "Mastering will raise it to the target loudness." });
    if (an.plr < 7 && an.loudness.integrated > -12) out.push({ id: "over_compressed", severity: "warning", issue: `Peak-to-loudness ratio is only ${an.plr.toFixed(1)} dB \u2014 the track is already heavily compressed/limited.`, fix: "Request the pre-limiter mix; avoid additional loudness gain." });
    if (an.plr > 18 && an.loudness.integrated < -16) out.push({ id: "very_dynamic", severity: "info", issue: `Large dynamic range (PLR ${an.plr.toFixed(1)} dB): transients are far above the average level.`, fix: "Bus compression before limiting will let it get louder with less distortion." });
    if (an.stereo.correlation < 0) out.push({ id: "phase", severity: "problem", issue: `Left/right are out of phase (correlation ${an.stereo.correlation.toFixed(2)}): it will lose bass and body in mono.`, fix: "Check polarity of stereo sources; avoid wide-stereo effects on bass." });
    else if (an.stereo.lowCorrelation < 0.8 && !an.stereo.mono) out.push({ id: "wide_bass", severity: "warning", issue: "Stereo information in the bass region will weaken on phones and club systems.", fix: "Keep sub/bass mono (done automatically in the master)." });
    if (!an.stereo.mono && an.stereo.width < 0.03) out.push({ id: "narrow", severity: "info", issue: "The mix is nearly mono.", fix: "Pan supporting instruments and add stereo reverb/width for a bigger image." });
  }
  const total = rel(20, 20500);
  const lowMid = rel(180, 450) - total, mid = rel(800, 2500) - total, hi = rel(5e3, 9e3) - total, air = rel(1e4, 2e4) - total, sub = rel(20, 60) - total, bass = rel(60, 160) - total;
  const pres = rel(2500, 5e3) - total;
  if (lowMid - mid > (kind === "vocal" ? 6 : 5)) out.push({ id: "muddy", severity: "warning", issue: "Too much energy around 200\u2013450 Hz (muddy/boxy).", fix: "Cut 2\u20134 dB around 250\u2013350 Hz with a wide EQ band." });
  if (pres - mid > 1.5) out.push({ id: "harsh", severity: "warning", issue: "Strong 2.5\u20135 kHz region: likely harsh or fatiguing.", fix: "Gentle 1\u20132 dB dip around 3\u20134 kHz; check for over-bright saturation." });
  if (hi - mid < -22 && an.centroidHz < 1500) out.push({ id: "dull", severity: "info", issue: "Little energy above 5 kHz (dull).", fix: "High shelf +2 dB at 10 kHz (only if the source contains high-frequency content)." });
  if (kind === "mix") {
    if (sub > -17 && bass < sub + 6) out.push({ id: "sub_heavy", severity: "warning", issue: "Sub-bass dominates (<60 Hz): wastes headroom and disappears on small speakers.", fix: "High-pass at 25\u201330 Hz; reduce 40\u201360 Hz or add harmonics at 100\u2013200 Hz." });
    if (bass < -14 && an.bands.sub < -22) out.push({ id: "thin", severity: "info", issue: "Light low end (thin).", fix: "Shelf +2 dB at 100 Hz or add bass saturation." });
    if (air < -42 && an.centroidHz < 2500) out.push({ id: "no_air", severity: "info", issue: "Almost no content above 10 kHz \u2014 dull or low-passed source (e.g. MP3).", fix: "Gentle air shelf only if the content exists; do not boost noise." });
  }
  if (kind === "vocal" || an.sibilanceDb > -10) {
    if (an.sibilanceDb > -6.5) out.push({ id: "sibilant", severity: "warning", issue: 'Strong 5\u20139 kHz energy relative to the mids (sibilance / "s" sounds).', fix: "De-ess around 5\u20138 kHz before compression." });
  }
  if (an.noiseFloorDb > -50) out.push({ id: "noisy", severity: an.noiseFloorDb > -40 ? "problem" : "warning", issue: `Noise floor is high (${an.noiseFloorDb.toFixed(0)} dBFS) \u2014 background hiss/room noise is audible between phrases.`, fix: "Noise reduction + downward expander (included in the vocal chain)." });
  return out;
}

// src/analysis/levels.ts
function rmsPercentileDb(x, sr, pct, windowMs = 50) {
  const w = Math.max(1, Math.round(windowMs / 1e3 * sr));
  const lv = [];
  for (let s = 0; s + w <= x.length; s += w) {
    let e = 0;
    for (let i = 0; i < w; i++) e += x[s + i] * x[s + i];
    const db = linToDb(Math.sqrt(e / w));
    if (db > -90) lv.push(db);
  }
  if (!lv.length) return -90;
  lv.sort((a, b) => a - b);
  return lv[Math.min(lv.length - 1, Math.floor(pct / 100 * lv.length))];
}
function levelPercentileDb(chs, sr, pct, windowMs = 50) {
  return Math.max(...chs.map((c) => rmsPercentileDb(c, sr, pct, windowMs)));
}

// src/fx/compressor.ts
function compress(a, p) {
  const sr = a.sampleRate, nCh = a.channels.length, n = a.channels[0].length;
  const knee = p.kneeDb ?? 6;
  const slope = 1 / Math.max(p.ratio, 1) - 1;
  const aA = timeCoef(p.attackMs, sr);
  const aR = timeCoef(p.releaseMs, sr);
  const aRfast = timeCoef(Math.max(p.releaseMs * 0.2, 5), sr);
  const link = p.link ?? 1;
  const mix = p.mix ?? 1;
  const makeup = p.makeupDb === "auto" ? -(p.thresholdDb * (1 - 1 / Math.max(p.ratio, 1))) * 0.5 : p.makeupDb ?? 0;
  const makeLin = dbToLin(makeup);
  const hp = p.sidechainHpHz ? a.channels.map(() => new Biquad(designBiquad("highpass", sr, p.sidechainHpHz, 0.7071))) : null;
  let grDb = 0, sum = 0, maxGr = 0;
  let slowEnv = 0;
  const dry = mix < 1 ? a.channels.map((c) => new Float32Array(c)) : null;
  const key = p.sidechain;
  for (let i = 0; i < n; i++) {
    let mx = 0, mean = 0;
    if (key) {
      mx = mean = Math.abs(key[i]);
    } else {
      for (let c = 0; c < nCh; c++) {
        let v = a.channels[c][i];
        if (hp) v = hp[c].process(v);
        const av = Math.abs(v);
        if (av > mx) mx = av;
        mean += av;
      }
      mean /= nCh;
    }
    const lvlDb = linToDb(link * mx + (1 - link) * mean);
    const over = lvlDb - p.thresholdDb;
    let target;
    if (2 * over < -knee) target = 0;
    else if (2 * Math.abs(over) <= knee) target = slope * (over + knee / 2) ** 2 / (2 * knee);
    else target = slope * over;
    if (target < grDb) grDb = aA * grDb + (1 - aA) * target;
    else {
      let rc = aR;
      if (p.adaptiveRelease) {
        slowEnv = 0.9995 * slowEnv + 5e-4 * -grDb;
        const w = Math.min(1, slowEnv / 6);
        rc = aRfast * (1 - w) + aR * w;
      }
      grDb = rc * grDb + (1 - rc) * target;
    }
    sum += grDb;
    if (grDb < maxGr) maxGr = grDb;
    const g = dbToLin(grDb) * makeLin;
    for (let c = 0; c < nCh; c++) {
      const x = a.channels[c][i];
      a.channels[c][i] = dry ? x * g * mix + dry[c][i] * (1 - mix) : x * g;
    }
  }
  return { avgGainReductionDb: sum / Math.max(n, 1), maxGainReductionDb: maxGr };
}

// src/fx/eq.ts
function eq(a, bands) {
  const active = bands.filter((b) => b.type !== "peaking" && b.type !== "lowshelf" && b.type !== "highshelf" ? true : Math.abs(b.gainDb ?? 0) > 0.01);
  if (!active.length) return;
  for (const ch of a.channels) {
    new BiquadChain(active.map((b) => designBiquad(b.type, a.sampleRate, b.freq, b.q ?? 0.7071, b.gainDb ?? 0))).run(ch);
  }
}
function highpass(a, freq, order = 4) {
  const qs = order === 2 ? [0.7071] : order === 4 ? [0.5412, 1.3066] : [0.5176, 0.7071, 1.9319];
  for (const ch of a.channels) new BiquadChain(qs.map((q) => designBiquad("highpass", a.sampleRate, freq, q))).run(ch);
}
function lowpass(a, freq, order = 4) {
  const qs = order === 2 ? [0.7071] : [0.5412, 1.3066];
  for (const ch of a.channels) new BiquadChain(qs.map((q) => designBiquad("lowpass", a.sampleRate, freq, q))).run(ch);
}
function removeDc(a) {
  for (const ch of a.channels) {
    let s = 0;
    for (let i = 0; i < ch.length; i++) s += ch[i];
    const m = s / Math.max(ch.length, 1);
    if (Math.abs(m) > 1e-6) for (let i = 0; i < ch.length; i++) ch[i] -= m;
  }
}

// src/fx/limiter.ts
function limit(a, p) {
  const sr = a.sampleRate, n = a.channels[0].length;
  const ceiling = dbToLin(p.ceilingDb);
  const L = Math.max(2, Math.round((p.lookaheadMs ?? 2) / 1e3 * sr));
  const pre = dbToLin(p.gainDb ?? 0);
  for (const c of a.channels) for (let i = 0; i < n; i++) c[i] *= pre;
  const env = a.channels.map((c) => truePeakEnvelope(c, ceiling / 2.5));
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const e of env) if (e[i] > m) m = e[i];
    g[i] = m > ceiling ? ceiling / m : 1;
  }
  const gmin = new Float32Array(n);
  const dq = new Int32Array(n + 1);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && g[dq[tail - 1]] >= g[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + L - 1) head++;
    gmin[i] = g[dq[head]];
  }
  const gatt = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += gmin[i];
    if (i >= L) acc -= gmin[i - L];
    gatt[i] = acc / Math.min(i + 1, L) * 1;
  }
  const rel = timeCoef(p.releaseMs ?? 80, sr);
  let y = 1, maxGr = 1, sum = 0;
  for (let i = 0; i < n; i++) {
    const t = gatt[i];
    y = t < y ? t : rel * y + (1 - rel) * t;
    if (y > t) y = t;
    gatt[i] = y;
    if (y < maxGr) maxGr = y;
    sum += y;
  }
  for (const c of a.channels) for (let i = 0; i < n; i++) c[i] *= gatt[i];
  for (const c of a.channels) for (let i = 0; i < n; i++) {
    if (c[i] > ceiling) c[i] = ceiling;
    else if (c[i] < -ceiling) c[i] = -ceiling;
  }
  return { maxGainReductionDb: 20 * Math.log10(maxGr), avgGainReductionDb: 20 * Math.log10(sum / Math.max(n, 1)) };
}

// src/fx/matcheq.ts
function applyLinearPhaseCurve(a, gainDbAt, taps = 4096) {
  const sr = a.sampleRate;
  const N = taps * 2;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k <= N / 2; k++) {
    const hz = k * sr / N;
    const g = Math.pow(10, gainDbAt(Math.max(hz, 1)) / 20);
    re[k] = g;
    if (k > 0 && k < N / 2) re[N - k] = g;
  }
  const fft = new FFT(N);
  fft.transform(re, im, true);
  const h = new Float64Array(taps);
  const half = taps / 2;
  for (let i = 0; i < taps; i++) {
    const src = (i - half + N) % N;
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1));
    h[i] = re[src] * w;
  }
  const B = 8192, F2 = B + taps - 1;
  let fsz = 1;
  while (fsz < F2) fsz <<= 1;
  const conv = new FFT(fsz);
  const hr = new Float64Array(fsz), hi = new Float64Array(fsz);
  hr.set(h);
  conv.transform(hr, hi);
  for (const ch of a.channels) {
    const len = ch.length;
    const out = new Float64Array(len + taps);
    const xr = new Float64Array(fsz), xi = new Float64Array(fsz);
    for (let s = 0; s < len; s += B) {
      xr.fill(0);
      xi.fill(0);
      const m = Math.min(B, len - s);
      for (let i = 0; i < m; i++) xr[i] = ch[s + i];
      conv.transform(xr, xi);
      for (let k = 0; k < fsz; k++) {
        const r = xr[k] * hr[k] - xi[k] * hi[k];
        const i2 = xr[k] * hi[k] + xi[k] * hr[k];
        xr[k] = r;
        xi[k] = i2;
      }
      conv.transform(xr, xi, true);
      for (let i = 0; i < m + taps - 1 && s + i < out.length; i++) out[s + i] += xr[i];
    }
    for (let i = 0; i < len; i++) ch[i] = out[i + half];
  }
}
function curveFromPoints(freqs, gains) {
  return (hz) => {
    if (hz <= freqs[0]) return gains[0];
    if (hz >= freqs[freqs.length - 1]) return gains[gains.length - 1];
    let i = 1;
    while (freqs[i] < hz) i++;
    const t = (Math.log(hz) - Math.log(freqs[i - 1])) / (Math.log(freqs[i]) - Math.log(freqs[i - 1]));
    const s = t * t * (3 - 2 * t);
    return gains[i - 1] + (gains[i] - gains[i - 1]) * s;
  };
}

// src/fx/multiband.ts
function splitBands(x, sr, xovers) {
  if (!xovers.length) return [x];
  const [f, ...rest] = xovers;
  let low = new Float32Array(x), high = new Float32Array(x);
  lr4("lowpass", sr, f).run(low);
  lr4("highpass", sr, f).run(high);
  for (const fr of rest) {
    const lp = new Float32Array(low), hp = new Float32Array(low);
    lr4("lowpass", sr, fr).run(lp);
    lr4("highpass", sr, fr).run(hp);
    for (let i = 0; i < low.length; i++) low[i] = lp[i] + hp[i];
  }
  return [low, ...splitBands(high, sr, rest)];
}
function multibandCompress(a, p) {
  const sr = a.sampleRate, n = a.channels[0].length;
  const nb = p.crossovers.length + 1;
  const perCh = a.channels.map((c) => splitBands(c, sr, p.crossovers));
  const grs = [];
  for (let b = 0; b < nb; b++) {
    const spec = p.bands[b] ?? {};
    const bandAudio = { sampleRate: sr, channels: perCh.map((chBands) => chBands[b]) };
    if (spec.thresholdDb !== void 0) {
      const r = compress(bandAudio, { ratio: 2, attackMs: 20, releaseMs: 150, kneeDb: 8, ...spec, thresholdDb: spec.thresholdDb });
      grs.push(r.avgGainReductionDb);
    } else grs.push(0);
    if (spec.gainDb) {
      const g = Math.pow(10, spec.gainDb / 20);
      for (const c of bandAudio.channels) for (let i = 0; i < n; i++) c[i] *= g;
    }
  }
  for (let c = 0; c < a.channels.length; c++) {
    const out = a.channels[c];
    out.fill(0);
    for (let b = 0; b < nb; b++) {
      const src = perCh[c][b];
      for (let i = 0; i < n; i++) out[i] += src[i];
    }
  }
  return { gainReductionDb: grs };
}

// src/fx/saturation.ts
var BUTTER8 = [0.5098, 0.6013, 0.9, 2.5629];
function shaper(mode) {
  switch (mode) {
    case "tape":
      return (x) => Math.tanh(x);
    case "tube":
      return (x) => x >= 0 ? Math.tanh(x * 1.2) : Math.tanh(x * 0.8) * 1.05;
    // asymmetry → even harmonics
    case "soft":
      return (x) => x / (1 + Math.abs(x));
    case "clip":
      return (x) => x > 1 ? 1 : x < -1 ? -1 : 1.5 * x - 0.5 * x * x * x;
  }
}
function saturate(a, p = {}) {
  const drive = dbToLin(p.driveDb ?? 6);
  const mix = p.mix ?? 1;
  const fn = shaper(p.mode ?? "tape");
  const OS2 = 4, sr = a.sampleRate * OS2, n = a.channels[0].length;
  const slope0 = (fn(1e-3) - fn(-1e-3)) / 2e-3;
  const norm = p.autoGain === false ? 1 : 1 / (drive * slope0);
  for (const ch of a.channels) {
    const up = new Float32Array(n * OS2);
    for (let i = 0; i < n; i++) up[i * OS2] = ch[i] * OS2;
    const cuts = a.sampleRate * 0.45;
    new BiquadChain(BUTTER8.map((q) => designBiquad("lowpass", sr, cuts, q))).run(up);
    for (let i = 0; i < up.length; i++) up[i] = fn(up[i] * drive) * norm;
    new BiquadChain(BUTTER8.map((q) => designBiquad("lowpass", sr, cuts, q))).run(up);
    for (let i = 0; i < n; i++) ch[i] = mix * up[i * OS2] + (1 - mix) * ch[i];
  }
}
function peakShave(a, thresholdDb, ceilingDb) {
  const t = dbToLin(thresholdDb), c = dbToLin(ceilingDb);
  const span = Math.max(c - t, 1e-6);
  for (const ch of a.channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i], av = v < 0 ? -v : v;
      if (av > t) {
        const y = t + span * Math.tanh((av - t) / span);
        ch[i] = v < 0 ? -y : y;
      }
    }
  }
}

// src/fx/stereo.ts
function stereoWidth(a, width, monoBelowHz = 0) {
  if (a.channels.length < 2) return;
  const [l, r] = a.channels;
  const n = l.length;
  const m = new Float32Array(n), s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    m[i] = (l[i] + r[i]) * 0.5;
    s[i] = (l[i] - r[i]) * 0.5;
  }
  if (monoBelowHz > 0) {
    lr4("highpass", a.sampleRate, monoBelowHz).run(s);
  }
  for (let i = 0; i < n; i++) {
    const sw = s[i] * width;
    l[i] = m[i] + sw;
    r[i] = m[i] - sw;
  }
}
function panMono(x, pan) {
  const ang = (pan + 1) * Math.PI / 4;
  const gl = Math.cos(ang) * Math.SQRT2, gr = Math.sin(ang) * Math.SQRT2;
  const L = new Float32Array(x.length), R = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    L[i] = x[i] * gl;
    R[i] = x[i] * gr;
  }
  return [L, R];
}
function balance(a, pan) {
  if (a.channels.length < 2 || Math.abs(pan) < 1e-4) return;
  const ang = (pan + 1) * Math.PI / 4;
  const gl = Math.cos(ang) * Math.SQRT2, gr = Math.sin(ang) * Math.SQRT2;
  for (let i = 0; i < a.channels[0].length; i++) {
    a.channels[0][i] *= gl;
    a.channels[1][i] *= gr;
  }
}

// src/chains/targets.ts
var F = [25, 31.5, 40, 63, 100, 160, 250, 400, 630, 1e3, 1600, 2500, 4e3, 6300, 1e4, 16e3, 2e4];
var BALANCED = [-16, -13, -9, -3.5, 0, 1.5, 1.5, 1, 0.5, 0, -2, -4, -6.5, -9.5, -13, -19, -26];
var GENRE_OFFSETS = {
  balanced: BALANCED.map(() => 0),
  pop: [0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0.3, 0.5, 0.5, 0.5, 0.5, 0, 0],
  hiphop: [3, 3.5, 3.5, 3, 2, 0.5, -0.5, -1, -0.5, 0, 0, 0, 0, 0, -0.5, -1, -1],
  trap: [4, 4.5, 4.5, 4, 2.5, 0.5, -0.5, -1.5, -1, 0, 0, 0, 0.5, 0.5, 0, -1, -1],
  edm: [2, 2.5, 3, 3, 1.5, 0, -0.5, -1, -1, 0, 0.5, 1, 1.5, 1.5, 1, 0, -1],
  rock: [-1, -1, -1, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 1, 1.5, 1.5, 1, 0, -1, -1.5],
  acoustic: [-3, -3, -3, -2, -1.5, -0.5, 0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 0],
  rnb: [2, 2.5, 2.5, 2, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.5, -0.5],
  jazz: [-2, -2, -2, -1, -0.5, 0, 0.5, 0.5, 0.5, 0, 0, 0, -0.5, -0.5, -0.5, -1, -1],
  classical: [-3, -3, -3, -2, -1, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, -0.5, -1, -2],
  podcast: [-30, -28, -24, -14, -6, 0, 3, 3, 1.5, 0, -1, -1.5, -3, -6, -10, -15, -20]
};
function genreCurve(genre = "balanced") {
  const off = GENRE_OFFSETS[genre] ?? GENRE_OFFSETS.balanced;
  return { freqs: F, db: BALANCED.map((v, i) => v + off[i]) };
}
var VOCAL_TARGET = {
  freqs: [63, 100, 160, 250, 400, 630, 1e3, 1600, 2500, 4e3, 6300, 1e4, 16e3],
  db: [-22, -6, 0.5, 3.5, 4, 2, 0, -1.5, -3, -6, -9.5, -13.5, -20]
};
function interpCurve(c, hz) {
  const { freqs, db } = c;
  if (hz <= freqs[0]) return db[0];
  if (hz >= freqs[freqs.length - 1]) return db[db.length - 1];
  let i = 1;
  while (freqs[i] < hz) i++;
  const t = (Math.log(hz) - Math.log(freqs[i - 1])) / (Math.log(freqs[i]) - Math.log(freqs[i - 1]));
  return db[i - 1] + (db[i] - db[i - 1]) * t;
}
function tonalCorrection(measured, target, o) {
  const [lo, hi] = o.matchRange ?? [100, 8e3];
  const refIdx = measured.freqs.map((f, i) => f >= lo && f <= hi ? i : -1).filter((i) => i >= 0);
  const offs = refIdx.map((i) => measured.levelsDb[i] - interpCurve(target, measured.freqs[i]));
  const align = offs.reduce((s, v) => s + v, 0) / Math.max(offs.length, 1);
  let diffs = measured.freqs.map((f, i) => interpCurve(target, f) + align - measured.levelsDb[i]);
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
  const mean = gains.reduce((s, v) => s + v, 0) / gains.length;
  const centred = gains.map((g) => g - mean * 0.8);
  return { freqs: measured.freqs, gains: centred.map((g) => Math.max(-o.maxCutDb, Math.min(o.maxBoostDb, g))) };
}
function contentCeilingHz(sp) {
  const peak = Math.max(...sp.levelsDb);
  let top = sp.freqs[sp.freqs.length - 1];
  for (let i = sp.freqs.length - 1; i >= 0; i--) {
    if (sp.levelsDb[i] > peak - 75) {
      top = sp.freqs[i];
      break;
    }
  }
  return top * 1.15;
}

// src/chains/presets.ts
var PRESETS = {
  streaming: { label: "Streaming (Spotify/YouTube/Tidal)", targetLufs: -14, ceilingDbTp: -1, limiterReleaseMs: 90, notes: "Matches the loudness normalisation of the major streaming platforms; no further turn-down so full dynamics are preserved." },
  spotify: { label: "Spotify", targetLufs: -14, ceilingDbTp: -1, limiterReleaseMs: 90, notes: "Spotify normalises to -14 LUFS; -1 dBTP leaves headroom for lossy encoding." },
  apple_music: { label: "Apple Music", targetLufs: -16, ceilingDbTp: -1, limiterReleaseMs: 100, notes: "Sound Check targets -16 LUFS." },
  youtube: { label: "YouTube", targetLufs: -14, ceilingDbTp: -1, limiterReleaseMs: 90, notes: "YouTube turns louder content down to about -14 LUFS." },
  soundcloud: { label: "SoundCloud", targetLufs: -14, ceilingDbTp: -1, limiterReleaseMs: 90, notes: "Conservative level that survives SoundCloud transcoding." },
  loud: { label: "Loud / club / hip-hop & EDM", targetLufs: -9, ceilingDbTp: -0.8, limiterReleaseMs: 60, notes: "Competitive loudness. Streaming platforms will turn this down, so the extra limiting costs punch for no gain online \u2014 use for DJ/club/download use." },
  club: { label: "Club / DJ", targetLufs: -8, ceilingDbTp: -0.5, limiterReleaseMs: 50, notes: "Maximum-density master for DJ sets." },
  cd: { label: "CD / download", targetLufs: -11, ceilingDbTp: -0.3, limiterReleaseMs: 70, notes: "Classic CD-era level." },
  broadcast: { label: "Broadcast (EBU R128)", targetLufs: -23, ceilingDbTp: -1, limiterReleaseMs: 150, notes: "EBU R128 television/radio standard." },
  podcast: { label: "Podcast / spoken word", targetLufs: -16, ceilingDbTp: -1, limiterReleaseMs: 120, notes: "Spoken word is normalised around -16 LUFS (mono: -19)." },
  dynamic: { label: "Audiophile / dynamic", targetLufs: -18, ceilingDbTp: -1, limiterReleaseMs: 150, notes: "Preserves transients and dynamic range." }
};
function getPreset(name) {
  const p = PRESETS[name.toLowerCase()];
  if (!p) throw new Error(`Unknown preset '${name}'. Available: ${Object.keys(PRESETS).join(", ")}`);
  return p;
}

// src/chains/master.ts
function matchTarget(sp, reference, genre) {
  if (!reference) return genreCurve(genre);
  const ref = thirdOctaveSpectrum(reference);
  const i1k = ref.freqs.findIndex((f) => f >= 990);
  return { freqs: ref.freqs, db: ref.levelsDb.map((v) => v - ref.levelsDb[i1k]) };
}
function masterAudio(input, o = {}) {
  const preset = getPreset(o.preset ?? "streaming");
  const targetLufs = o.targetLufs ?? preset.targetLufs;
  const ceiling = o.ceilingDbTp ?? preset.ceilingDbTp;
  const steps = [];
  const warnings = [];
  const before = analyze(input);
  let a = cloneAudio(input);
  const sr = a.sampleRate;
  const inPeak = Math.max(...a.channels.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  if (inPeak > 0) applyGain(a, dbToLin(-3) / inPeak);
  removeDc(a);
  highpass(a, 22, 4);
  steps.push("DC removal + 22 Hz subsonic high-pass (frees headroom the limiter would otherwise waste)");
  if (before.clippedSamples > 20) warnings.push(`Input has ${before.clippedSamples} clipped regions \u2014 clipping distortion cannot be fully repaired; ask for a lower-level bounce if possible.`);
  if (before.stereo.correlation < 0) warnings.push(`Stereo correlation is ${before.stereo.correlation.toFixed(2)} (out-of-phase) \u2014 the mix will partly cancel in mono. Check phase/polarity of stereo sources.`);
  const hasRef = !!o.reference;
  const toneAmt = o.tone ?? (hasRef ? 0.8 : 0.55);
  const target = matchTarget(before.spectrum, o.reference, o.genre ?? "balanced");
  const spA = thirdOctaveSpectrum(a);
  const corr = tonalCorrection(spA, target, {
    intensity: toneAmt,
    maxBoostDb: hasRef ? 5 : 3,
    maxCutDb: hasRef ? 6 : 4,
    matchRange: [120, 8e3],
    limitBoostAboveHz: contentCeilingHz(spA),
    minHz: 35
  });
  if (toneAmt > 0.01) {
    applyLinearPhaseCurve(a, curveFromPoints(corr.freqs, corr.gains), 8192);
    const big = corr.gains.map((g, i) => ({ g, f: corr.freqs[i] })).filter((x) => Math.abs(x.g) >= 0.6).sort((x, y) => Math.abs(y.g) - Math.abs(x.g)).slice(0, 4);
    steps.push(`${hasRef ? "Reference-matched" : `Genre ('${o.genre ?? "balanced"}') tonal`} correction, linear-phase: ${big.length ? big.map((x) => `${x.g > 0 ? "+" : ""}${x.g.toFixed(1)} dB @ ${Math.round(x.f)} Hz`).join(", ") : "balance already close \u2014 no change needed"}`);
  }
  const dyn = o.dynamics ?? 0.5;
  const p95 = levelPercentileDb(a.channels, sr, 95, 100), p50 = levelPercentileDb(a.channels, sr, 50, 100);
  if (dyn > 0.01) {
    const g = compress(a, { thresholdDb: p95 - 3 * (0.5 + dyn), ratio: 1.4 + 0.8 * dyn, attackMs: 30, releaseMs: 200, kneeDb: 12, sidechainHpHz: 90, adaptiveRelease: true, link: 1 });
    steps.push(`Glue compressor ${(1.4 + 0.8 * dyn).toFixed(1)}:1, soft knee, 30 ms attack, program-dependent release \u2014 avg ${g.avgGainReductionDb.toFixed(1)} dB (max ${g.maxGainReductionDb.toFixed(1)} dB)`);
    const xo = [150, 4500];
    const bandLv = a.channels.map((c) => splitBands(c, sr, xo));
    const bandThr = [0, 1, 2].map((b) => rmsPercentileDb(bandLv[0][b], sr, 92, 100));
    const bandSpread = [0, 1, 2].map((b) => bandThr[b] - rmsPercentileDb(bandLv[0][b], sr, 50, 100));
    const specs = bandSpread.map((sp, b) => sp > 6 ? { thresholdDb: bandThr[b] - 2, ratio: 1.8 + 0.4 * dyn, attackMs: b === 0 ? 40 : 15, releaseMs: b === 0 ? 150 : 90, kneeDb: 8 } : {});
    if (specs.some((s) => "thresholdDb" in s)) {
      const r = multibandCompress(a, { crossovers: xo, bands: specs });
      steps.push(`Multiband control (<150 Hz / 150\u20134.5k / >4.5k), only on uneven bands: GR ${r.gainReductionDb.map((x) => x.toFixed(1)).join(" / ")} dB`);
    }
  }
  const warmth = o.warmth ?? 0.3;
  if (warmth > 0.05) {
    saturate(a, { mode: "tape", driveDb: 3 + 5 * warmth, mix: 0.1 + 0.2 * warmth });
    steps.push("Parallel tape saturation for cohesion (oversampled \u2014 no aliasing)");
  }
  if (a.channels.length === 2) {
    const side = analyze(a).stereo;
    let w = o.width === "auto" || o.width === void 0 ? side.width < 0.1 && !side.mono ? 1.15 : 1 : o.width;
    const monoHz = o.monoBassHz ?? 120;
    if (side.mono) {
      w = 1;
      warnings.push("Source is dual-mono (no stereo information).");
    }
    if (w !== 1 || monoHz > 0) {
      stereoWidth(a, w, monoHz);
      steps.push(`Stereo: width \xD7${w.toFixed(2)}${monoHz > 0 ? `, bass mono below ${monoHz} Hz (translation to club/phone speakers)` : ""}`);
    }
  }
  const pre = cloneAudio(a);
  let driveDb = targetLufs - measureLoudness(pre).integrated;
  let out = pre, lim = { maxGainReductionDb: 0, avgGainReductionDb: 0 };
  let bestErr = Infinity;
  let best = null;
  for (let iter = 0; iter < 5; iter++) {
    const trial = cloneAudio(pre);
    const g = dbToLin(driveDb);
    for (const ch of trial.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
    if (driveDb > 3) peakShave(trial, ceiling - 3, ceiling - 0.3);
    lim = limit(trial, { ceilingDb: ceiling, releaseMs: preset.limiterReleaseMs, lookaheadMs: 2.5 });
    const got = measureLoudness(trial).integrated;
    const err = targetLufs - got;
    if (Math.abs(err) < Math.abs(bestErr)) {
      bestErr = err;
      best = { audio: trial, lim: { ...lim } };
    }
    if (Math.abs(err) <= 0.1) break;
    driveDb += err * (err > 0 ? 1.15 : 1);
  }
  out = best.audio;
  lim = best.lim;
  const finalTp = measureTruePeak(out);
  if (finalTp > ceiling + 0.05) {
    applyGain(out, dbToLin(ceiling - finalTp));
  }
  steps.push(`Look-ahead true-peak limiter (4\xD7 oversampled detection, ceiling ${ceiling.toFixed(1)} dBTP, ${preset.limiterReleaseMs} ms release): max GR ${lim.maxGainReductionDb.toFixed(1)} dB, avg ${lim.avgGainReductionDb.toFixed(1)} dB; iterated to ${targetLufs} LUFS`);
  const after = analyze(out);
  if (Math.abs(after.loudness.integrated - targetLufs) > 0.5) {
    warnings.push(`Could only reach ${after.loudness.integrated.toFixed(1)} LUFS (target ${targetLufs}). The track is too dynamic to hit the target without distortion; consider a lower target or compressing the mix.`);
  }
  if (lim.maxGainReductionDb < -9) warnings.push(`Limiter works hard (max ${lim.maxGainReductionDb.toFixed(1)} dB reduction) \u2014 expect reduced punch. A lower-loudness preset such as 'streaming' will sound better.`);
  if (before.loudness.integrated > targetLufs + 3) steps.push(`Source was louder (${before.loudness.integrated.toFixed(1)} LUFS) than the target, so the master is turned down \u2014 this preserves dynamics.`);
  return { audio: out, report: { steps }, before, after, warnings };
}

// src/fx/deesser.ts
function deEss(a, p = {}) {
  const sr = a.sampleRate, n = a.channels[0].length;
  const f = p.freqHz ?? 5500;
  const ratio = p.ratio ?? 4;
  const maxRed = p.maxReductionDb ?? 9;
  const bands = a.channels.map((c) => {
    const lo = new Float32Array(c), hi = new Float32Array(c);
    lr4("lowpass", sr, f).run(lo);
    lr4("highpass", sr, f).run(hi);
    return { lo, hi };
  });
  const env = new Float32Array(n);
  const a1 = timeCoef(0.5, sr), r12 = timeCoef(25, sr);
  let e = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const b of bands) m = Math.max(m, Math.abs(b.hi[i]));
    e = m > e ? a1 * e + (1 - a1) * m : r12 * e + (1 - r12) * m;
    env[i] = e;
  }
  let thr;
  if (p.thresholdDb === void 0 || p.thresholdDb === "auto") {
    const lv = [];
    const step = Math.max(1, Math.round(sr * 0.01));
    for (let i = 0; i < n; i += step) {
      const d = linToDb(env[i]);
      if (d > -60) lv.push(d);
    }
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

// src/fx/denoise.ts
function denoise(a, p = {}) {
  const N = 2048, hop = 512, bins = N / 2 + 1;
  const strength = p.strength ?? 0.7;
  const floor = Math.pow(10, -(p.reductionDb ?? 12) / 20);
  const fft = new FFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  let noiseDb = -120;
  for (const ch of a.channels) {
    const len = ch.length;
    if (len < N * 2) continue;
    const padded = new Float32Array(len + 2 * N);
    padded.set(ch, N);
    const total = Math.ceil((len + N) / hop);
    const mags = [];
    const re = new Float64Array(N), im = new Float64Array(N);
    const frameStart = (f) => f * hop;
    for (let f = 0; f < total; f++) {
      const s = frameStart(f);
      for (let i = 0; i < N; i++) {
        re[i] = (padded[s + i] ?? 0) * win[i];
        im[i] = 0;
      }
      fft.transform(re, im);
      const m = new Float32Array(bins);
      for (let k = 0; k < bins; k++) m[k] = Math.hypot(re[k], im[k]);
      mags.push(m);
    }
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
      for (let d = -3; d <= 3; d++) {
        const j = k + d;
        if (j >= 0 && j < bins) {
          s += profile[j];
          c++;
        }
      }
      prof[k] = s / c * 2.3;
    }
    noiseDb = Math.max(noiseDb, 20 * Math.log10(Math.max(1e-9, Math.sqrt(prof.reduce((s, v) => s + v * v, 0) / bins) / N)));
    const out = new Float64Array(len + 2 * N);
    const prevGain = new Float32Array(bins).fill(1);
    const gain = new Float32Array(bins);
    const smag = (f, k) => {
      let s = 0, c = 0;
      for (let df = -1; df <= 1; df++) {
        const m = mags[Math.min(total - 1, Math.max(0, f + df))];
        for (let dk = -2; dk <= 2; dk++) {
          const j = k + dk;
          if (j >= 0 && j < bins) {
            s += m[j];
            c++;
          }
        }
      }
      return s / c;
    };
    for (let f = 0; f < total; f++) {
      {
        const st = frameStart(f);
        for (let i = 0; i < N; i++) {
          re[i] = (padded[st + i] ?? 0) * win[i];
          im[i] = 0;
        }
        fft.transform(re, im);
      }
      const spRe = Float64Array.from(re.subarray(0, bins)), spIm = Float64Array.from(im.subarray(0, bins));
      for (let k = 0; k < bins; k++) {
        const ms = smag(f, k);
        const snr = ms > 1e-12 ? prof[k] / ms : 1;
        let g = 1 - strength * snr * snr;
        g = Math.max(floor, Math.min(1, g));
        g = g > prevGain[k] ? 0.4 * prevGain[k] + 0.6 * g : 0.8 * prevGain[k] + 0.2 * g;
        gain[k] = g;
      }
      for (let k = 0; k < bins; k++) {
        const g = 0.25 * gain[Math.max(0, k - 1)] + 0.5 * gain[k] + 0.25 * gain[Math.min(bins - 1, k + 1)];
        prevGain[k] = gain[k];
        re[k] = spRe[k] * g;
        im[k] = spIm[k] * g;
        if (k > 0 && k < N / 2) {
          re[N - k] = re[k];
          im[N - k] = -im[k];
        }
      }
      im[0] = 0;
      im[N / 2] = 0;
      fft.transform(re, im, true);
      const s = frameStart(f);
      for (let i = 0; i < N; i++) out[s + i] += re[i] * win[i];
    }
    for (let i = 0; i < len; i++) ch[i] = out[i + N] / 2;
  }
  return { estimatedNoiseDb: noiseDb };
}

// src/fx/expander.ts
function expand(a, p) {
  const sr = a.sampleRate, n = a.channels[0].length;
  const ratio = p.ratio ?? 3, range = p.rangeDb ?? 18;
  const aA = timeCoef(p.attackMs ?? 3, sr), aR = timeCoef(p.releaseMs ?? 120, sr);
  const hold = Math.round((p.holdMs ?? 60) / 1e3 * sr);
  const look = Math.round(sr * 3e-3);
  const envC = timeCoef(8, sr);
  let env = 0, g = -range, holdCnt = 0;
  const det = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of a.channels) m = Math.max(m, Math.abs(c[i]));
    env = m > env ? m : envC * env + (1 - envC) * m;
    det[i] = env;
  }
  for (let i = 0; i < n; i++) {
    const d = det[Math.min(i + look, n - 1)];
    const under = p.thresholdDb - linToDb(d);
    const target = under > 0 ? -Math.min(range, under * (ratio - 1)) : 0;
    if (target >= g) {
      g = aA * g + (1 - aA) * target;
      holdCnt = hold;
    } else if (holdCnt > 0) holdCnt--;
    else g = aR * g + (1 - aR) * target;
    const lin = dbToLin(g);
    for (const c of a.channels) c[i] *= lin;
  }
}

// src/chains/vocal.ts
function processVocal(input, o = {}) {
  const a = cloneAudio(input);
  const steps = [];
  const control = o.control ?? 0.6;
  const polish = o.polish ?? 0.5;
  const toneAmt = o.tone ?? 0.6;
  const backing = o.role === "backing";
  const before = analyze(a);
  removeDc(a);
  let voice = o.voice ?? "auto";
  if (voice === "auto") {
    const sp2 = before.spectrum;
    let e1 = 0, e2 = 0;
    sp2.freqs.forEach((f, i) => {
      const e = Math.pow(10, sp2.levelsDb[i] / 10);
      if (f >= 100 && f < 200) e1 += e;
      else if (f >= 200 && f < 400) e2 += e;
    });
    voice = e1 > e2 * 0.9 ? "male" : "female";
  }
  const hpHz = voice === "male" ? 80 : 110;
  highpass(a, hpHz, 4);
  steps.push(`High-pass at ${hpHz} Hz (24 dB/oct) to remove rumble & plosive energy (${voice} voice detected)`);
  const p10 = rmsPercentileDb(a.channels[0], a.sampleRate, 10), p90v = rmsPercentileDb(a.channels[0], a.sampleRate, 90);
  const confidence = Math.min(1, Math.max(0.25, (p90v - p10 - 10) / 20));
  const cleanup = o.cleanup === void 0 || o.cleanup === "auto" ? Math.min(1, Math.max(0, (before.noiseFloorDb + 70) / 25)) * confidence : o.cleanup;
  if (cleanup > 0.08) {
    const r = denoise(a, { strength: 0.35 + 0.5 * cleanup, reductionDb: 6 + 12 * cleanup });
    steps.push(`Spectral noise reduction (strength ${(0.35 + 0.5 * cleanup).toFixed(2)}, up to ${(6 + 12 * cleanup).toFixed(0)} dB) \u2014 learned noise profile automatically (floor ${before.noiseFloorDb.toFixed(0)} dBFS)`);
    if (cleanup > 0.3) {
      const p502 = levelPercentileDb(a.channels, a.sampleRate, 50);
      expand(a, { thresholdDb: Math.max(before.noiseFloorDb + 8, p502 - 22), ratio: 2.5, rangeDb: 6 + 8 * cleanup, releaseMs: 150 });
      steps.push("Downward expander to soften room noise between phrases");
    }
  }
  const sp = thirdOctaveSpectrum(a);
  const corr = tonalCorrection(sp, VOCAL_TARGET, {
    intensity: toneAmt * (backing ? 0.5 : 0.8),
    maxBoostDb: 2.5,
    maxCutDb: 5,
    matchRange: [200, 5e3],
    limitBoostAboveHz: contentCeilingHz(sp),
    minHz: hpHz * 1.5
  });
  applyLinearPhaseCurve(a, curveFromPoints(corr.freqs, corr.gains), 4096);
  const biggest = corr.gains.map((g, i) => ({ g, f: corr.freqs[i] })).sort((x, y) => Math.abs(y.g) - Math.abs(x.g)).slice(0, 3).filter((x) => Math.abs(x.g) >= 0.7);
  steps.push(biggest.length ? `Adaptive tonal balance (linear-phase): ${biggest.map((x) => `${x.g > 0 ? "+" : ""}${x.g.toFixed(1)} dB @ ${Math.round(x.f)} Hz`).join(", ")}` : "Tonal balance already close to the vocal target \u2014 left untouched");
  const sibFreq = voice === "male" ? 5e3 : 6e3;
  const de = deEss(a, { freqHz: sibFreq, thresholdDb: "auto", ratio: 4, maxReductionDb: 8 });
  steps.push(`De-esser above ${sibFreq} Hz (auto threshold), avg reduction ${de.avgReductionDb.toFixed(1)} dB`);
  const p90 = levelPercentileDb(a.channels, a.sampleRate, 90);
  const p50 = levelPercentileDb(a.channels, a.sampleRate, 50);
  const spread = Math.max(2, p90 - p50);
  const c1 = compress(a, { thresholdDb: p50 - 1, ratio: 1.8 + 1.4 * control, attackMs: 25, releaseMs: 250, kneeDb: 10, makeupDb: 0, adaptiveRelease: true, sidechainHpHz: 150 });
  const c2 = compress(a, { thresholdDb: p90 - 2 - 2 * (1 - control), ratio: 3 + 3 * control, attackMs: 4, releaseMs: 70, kneeDb: 6, makeupDb: 0, sidechainHpHz: 200 });
  steps.push(`Leveling compressor ${(1.8 + 1.4 * control).toFixed(1)}:1 (avg ${c1.avgGainReductionDb.toFixed(1)} dB) + peak control ${(3 + 3 * control).toFixed(1)}:1 (avg ${c2.avgGainReductionDb.toFixed(1)} dB) \u2014 performance spread was ${spread.toFixed(1)} dB`);
  const ceiling = contentCeilingHz(sp);
  const musical = [
    { type: "peaking", freq: voice === "male" ? 3200 : 4e3, gainDb: (backing ? 0.5 : 2) * polish, q: 0.9 },
    ...ceiling > 14e3 ? [{ type: "highshelf", freq: 11e3, gainDb: (backing ? 0.5 : 2.5) * polish, q: 0.6 }] : []
  ];
  if (backing) musical.push({ type: "highshelf", freq: 7e3, gainDb: -2.5, q: 0.6 });
  eq(a, musical);
  steps.push(`Presence/air EQ (+${(2 * polish).toFixed(1)} dB presence${ceiling > 14e3 ? `, +${(2.5 * polish).toFixed(1)} dB air shelf` : ", air shelf skipped: source has no content above ~" + Math.round(ceiling / 1e3) + " kHz"})`);
  if (polish > 0.1) {
    saturate(a, { mode: "tube", driveDb: 3 + 4 * polish, mix: 0.12 + 0.18 * polish });
    steps.push("Parallel tube saturation for density and harmonic warmth");
  }
  return { audio: a, report: { steps } };
}

// src/fx/delay.ts
function delayWet(a, p) {
  const sr = a.sampleRate, n = a.channels[0].length;
  const d = Math.max(1, Math.round(p.timeMs / 1e3 * sr));
  const fb = Math.min(p.feedback ?? 0.3, 0.92);
  const mono = toMono(a);
  const L = new Float32Array(n), R = new Float32Array(n);
  const lp = new Biquad(designBiquad("lowpass", sr, p.lpHz ?? 5e3, 0.7071));
  const hp = new Biquad(designBiquad("highpass", sr, p.hpHz ?? 300, 0.7071));
  const ping = p.pingPong ?? true;
  for (let i = 0; i < n; i++) {
    const inp = mono[i];
    const fl = i >= d ? L[i - d] : 0, fr = i >= d ? R[i - d] : 0;
    if (ping) {
      L[i] = lp.process(hp.process(inp + fr * fb));
      R[i] = fl * 1;
    } else {
      L[i] = lp.process(hp.process(inp + fl * fb));
      R[i] = L[i];
    }
  }
  return { sampleRate: sr, channels: [L, R] };
}

// src/fx/reverb.ts
var DELAYS_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.3, 73.1];
var AP_MS = [5.1, 7.7, 11.3, 13.9];
function reverbWet(a, p = {}) {
  const sr = a.sampleRate, n = a.channels[0].length;
  const rt60 = p.rt60 ?? 1.6;
  const width = p.width ?? 1;
  const N = 8;
  const lens = DELAYS_MS.map((ms) => Math.round(ms / 1e3 * sr * (sr / 48e3 > 1 ? 1 : 1)));
  const bufs = lens.map((l) => new Float32Array(l));
  const idx = new Int32Array(N);
  const damp = p.damping ?? 0.45;
  const lps = lens.map(() => new Biquad(designBiquad("lowpass", sr, 12e3 * (1 - damp * 0.85) + 1500, 0.5)));
  const gains = lens.map((l) => Math.pow(10, -3 * l / (sr * rt60)));
  const mono = toMono(a);
  const pd = Math.round((p.preDelayMs ?? 20) / 1e3 * sr);
  const apLens = AP_MS.map((ms) => Math.round(ms / 1e3 * sr));
  const apBufs = apLens.map((l) => new Float32Array(l));
  const apIdx = new Int32Array(AP_MS.length);
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const norm = 1 / Math.sqrt(N);
  const v = new Float64Array(N);
  const tail = Math.round(rt60 * sr * 1.2);
  const total = n;
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
    for (let k = 0; k < N; k++) v[k] = bufs[k][idx[k]];
    for (let h = 1; h < N; h <<= 1) {
      for (let s = 0; s < N; s += h << 1) {
        for (let j = s; j < s + h; j++) {
          const u = v[j], w = v[j + h];
          v[j] = u + w;
          v[j + h] = u - w;
        }
      }
    }
    let l = 0, r = 0;
    for (let k = 0; k < N; k++) {
      const fb = lps[k].process(v[k] * norm * gains[k]);
      bufs[k][idx[k]] = fb + x * 0.35;
      idx[k] = (idx[k] + 1) % lens[k];
      if (k & 1) r += fb;
      else l += fb;
    }
    outL[i] = l * 0.5;
    outR[i] = r * 0.5;
  }
  const wet = { sampleRate: sr, channels: [outL, outR] };
  if (width !== 1) {
    for (let i = 0; i < n; i++) {
      const m = (outL[i] + outR[i]) * 0.5, s = (outL[i] - outR[i]) * 0.5 * width;
      outL[i] = m + s;
      outR[i] = m - s;
    }
  }
  const hp = p.wetHpHz ?? 250, lp = p.wetLpHz ?? 9e3;
  for (const ch of wet.channels) {
    const f = [new Biquad(designBiquad("highpass", sr, hp, 0.7071)), new Biquad(designBiquad("lowpass", sr, lp, 0.7071))];
    for (let i = 0; i < n; i++) ch[i] = f[1].process(f[0].process(ch[i]));
  }
  return wet;
}

// src/io/audio.ts
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
function hasFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return r.status === 0;
}
function parseWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let pos = 12;
  let fmt = null;
  let dataStart = -1, dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      let tag2 = buf.readUInt16LE(body);
      const ch2 = buf.readUInt16LE(body + 2);
      const sr2 = buf.readUInt32LE(body + 4);
      const bits2 = buf.readUInt16LE(body + 14);
      if (tag2 === 65534 && size >= 26) tag2 = buf.readUInt16LE(body + 24);
      fmt = { tag: tag2, ch: ch2, sr: sr2, bits: bits2 };
    } else if (id === "data") {
      dataStart = body;
      if (size === 4294967295 || body + size > buf.length) size = buf.length - body;
      dataLen = size;
      break;
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || dataStart < 0) throw new Error("malformed WAV");
  const { tag, ch, sr, bits } = fmt;
  const bytes = bits / 8;
  const n = Math.floor(dataLen / (bytes * ch));
  const channels = Array.from({ length: ch }, () => new Float32Array(n));
  let p = dataStart;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let v;
      if (tag === 3 && bits === 32) v = buf.readFloatLE(p);
      else if (tag === 3 && bits === 64) v = buf.readDoubleLE(p);
      else if (tag === 1 && bits === 16) v = buf.readInt16LE(p) / 32768;
      else if (tag === 1 && bits === 24) v = buf.readIntLE(p, 3) / 8388608;
      else if (tag === 1 && bits === 32) v = buf.readInt32LE(p) / 2147483648;
      else if (tag === 1 && bits === 8) v = (buf[p] - 128) / 128;
      else throw new Error(`unsupported WAV encoding (tag ${tag}, ${bits}-bit)`);
      channels[c][i] = v;
      p += bytes;
    }
  }
  return { sampleRate: sr, channels };
}
function rng(seed = 2654435769) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
function encodeWav(a, bits = 24) {
  const ch = a.channels.length;
  const n = a.channels[0].length;
  const bytes = bits / 8;
  const dataLen = n * ch * bytes;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(bits === 32 ? 3 : 1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(a.sampleRate, 24);
  buf.writeUInt32LE(a.sampleRate * ch * bytes, 28);
  buf.writeUInt16LE(ch * bytes, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  const r = rng();
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = a.channels[c][i];
      if (bits === 32) {
        buf.writeFloatLE(x, p);
      } else {
        const scale = bits === 16 ? 32767 : 8388607;
        const d = r() - r();
        let v = Math.round(x * scale + d);
        v = Math.max(-scale - 1, Math.min(scale, v));
        if (bits === 16) buf.writeInt16LE(v, p);
        else buf.writeIntLE(v, p, 3);
      }
      p += bytes;
    }
  }
  return buf;
}
function probe(path) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "csv=p=0", path], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr || "unknown error"}`);
  const [sr, ch] = r.stdout.trim().split(",").map(Number);
  if (!sr || !ch) throw new Error("could not determine audio format");
  return { sampleRate: sr, channels: ch };
}
function decodeFfmpeg(path) {
  const { sampleRate, channels } = probe(path);
  const outCh = Math.min(channels, 2);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-vn", "-ac", String(outCh), "-f", "f32le", "-acodec", "pcm_f32le", "-"], { maxBuffer: Infinity });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${r.stderr?.toString()}`);
  const raw = r.stdout;
  const n = Math.floor(raw.length / 4 / outCh);
  const f = new Float32Array(raw.buffer, raw.byteOffset, n * outCh);
  const chans = Array.from({ length: outCh }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < outCh; c++) chans[c][i] = f[i * outCh + c];
  return { sampleRate, channels: chans };
}
function readAudio(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".wav" || ext === ".wave") {
    try {
      return parseWav(readFileSync(path));
    } catch (e) {
      if (!hasFfmpeg()) throw e;
    }
  }
  if (!hasFfmpeg()) throw new Error(`Cannot read ${ext || "this"} file: ffmpeg is not installed (WAV works without it).`);
  return decodeFfmpeg(path);
}
function writeAudio(path, a, opts = {}) {
  const ext = extname(path).toLowerCase();
  if (ext === ".wav" || ext === "") {
    writeFileSync(path, encodeWav(a, opts.bitDepth ?? 24));
    return;
  }
  if (!hasFfmpeg()) throw new Error(`Cannot write ${ext}: ffmpeg is not installed. Use .wav instead.`);
  const ch = a.channels.length, n = a.channels[0].length;
  const inter = Buffer.alloc(n * ch * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) inter.writeFloatLE(a.channels[c][i], (i * ch + c) * 4);
  const codecArgs = ext === ".mp3" ? ["-codec:a", "libmp3lame", "-b:a", opts.mp3Bitrate ?? "320k"] : ext === ".flac" ? ["-codec:a", "flac", "-sample_fmt", opts.bitDepth === 16 ? "s16" : "s32"] : ext === ".m4a" || ext === ".aac" ? ["-codec:a", "aac", "-b:a", "256k"] : ext === ".ogg" ? ["-codec:a", "libvorbis", "-q:a", "8"] : [];
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(a.sampleRate), "-ac", String(ch), "-i", "-", ...codecArgs, path], { input: inter, maxBuffer: Infinity });
  if (r.status !== 0) throw new Error(`ffmpeg encode failed: ${r.stderr?.toString()}`);
}
function resample(a, targetRate) {
  if (a.sampleRate === targetRate) return a;
  const ch = a.channels.length, n = a.channels[0].length;
  if (hasFfmpeg()) {
    const inter = Buffer.alloc(n * ch * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) inter.writeFloatLE(a.channels[c][i], (i * ch + c) * 4);
    const r = spawnSync("ffmpeg", ["-v", "error", "-f", "f32le", "-ar", String(a.sampleRate), "-ac", String(ch), "-i", "-", "-af", "aresample=resampler=soxr", "-ar", String(targetRate), "-f", "f32le", "-"], { input: inter, maxBuffer: Infinity });
    if (r.status === 0) {
      const raw = r.stdout;
      const m2 = Math.floor(raw.length / 4 / ch);
      const f = new Float32Array(raw.buffer, raw.byteOffset, m2 * ch);
      const chans = Array.from({ length: ch }, () => new Float32Array(m2));
      for (let i = 0; i < m2; i++) for (let c = 0; c < ch; c++) chans[c][i] = f[i * ch + c];
      return { sampleRate: targetRate, channels: chans };
    }
  }
  const ratio = targetRate / a.sampleRate;
  const m = Math.round(n * ratio);
  return { sampleRate: targetRate, channels: a.channels.map((src) => {
    const out = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const x = i / ratio, i0 = Math.floor(x), t = x - i0;
      out[i] = src[i0] * (1 - t) + (src[Math.min(i0 + 1, n - 1)] ?? 0) * t;
    }
    return out;
  }) };
}

// src/chains/instrument.ts
function processInstrument(input, role, genre = "balanced") {
  const a = cloneAudio(input);
  const steps = [];
  removeDc(a);
  const an = analyze(a);
  const sp = thirdOctaveSpectrum(a);
  const full = role === "beat" || role === "instrumental";
  const hp = role === "bass" || role === "drums" ? 28 : full ? 25 : 90;
  highpass(a, hp, 4);
  steps.push(`High-pass ${hp} Hz`);
  const strength = full ? 0.5 : role === "bass" || role === "drums" ? 0.3 : 0.35;
  if (full || role === "bass" || role === "drums") {
    const corr = tonalCorrection(sp, genreCurve(genre), { intensity: strength, maxBoostDb: 2.5, maxCutDb: 3.5, matchRange: [100, 8e3], limitBoostAboveHz: contentCeilingHz(sp), minHz: 40 });
    applyLinearPhaseCurve(a, curveFromPoints(corr.freqs, corr.gains), 4096);
    const big = corr.gains.map((g, i) => ({ g, f: corr.freqs[i] })).sort((x, y) => Math.abs(y.g) - Math.abs(x.g)).slice(0, 2).filter((x) => Math.abs(x.g) >= 0.7);
    if (big.length) steps.push(`Tonal balance toward '${genre}': ${big.map((x) => `${x.g > 0 ? "+" : ""}${x.g.toFixed(1)} dB @ ${Math.round(x.f)} Hz`).join(", ")}`);
  } else {
    const mud = an.bands.lowMid - an.bands.bass;
    if (mud > -3) {
      eq(a, [{ type: "peaking", freq: 300, gainDb: -2, q: 0.9 }]);
      steps.push("Low-mid mud cut -2 dB @ 300 Hz");
    }
  }
  const p90 = levelPercentileDb(a.channels, a.sampleRate, 90);
  switch (role) {
    case "bass": {
      const r = compress(a, { thresholdDb: p90 - 4, ratio: 3, attackMs: 15, releaseMs: 120, kneeDb: 8, sidechainHpHz: 40 });
      if (a.channels.length === 2) stereoWidth(a, 0, 0);
      steps.push(`Bass compression 3:1 (avg ${r.avgGainReductionDb.toFixed(1)} dB), collapsed to mono for a solid low end`);
      saturate(a, { mode: "tube", driveDb: 5, mix: 0.2 });
      steps.push("Harmonic saturation so the bass translates on small speakers");
      break;
    }
    case "drums": {
      const r = compress(a, { thresholdDb: p90 - 5, ratio: 2.5, attackMs: 28, releaseMs: 90, kneeDb: 6, sidechainHpHz: 80 });
      steps.push(`Drum-bus glue 2.5:1 with slow attack to preserve punch (avg ${r.avgGainReductionDb.toFixed(1)} dB)`);
      saturate(a, { mode: "tape", driveDb: 4, mix: 0.25 });
      break;
    }
    case "beat":
    case "instrumental": {
      const r = compress(a, { thresholdDb: p90 - 3, ratio: 1.6, attackMs: 35, releaseMs: 200, kneeDb: 10, sidechainHpHz: 100 });
      steps.push(`Gentle glue compression 1.6:1 (avg ${r.avgGainReductionDb.toFixed(1)} dB)`);
      break;
    }
    default: {
      const r = compress(a, { thresholdDb: p90 - 4, ratio: 2, attackMs: 20, releaseMs: 150, kneeDb: 8, sidechainHpHz: 100 });
      steps.push(`Leveling 2:1 (avg ${r.avgGainReductionDb.toFixed(1)} dB)`);
    }
  }
  return { audio: a, report: { steps } };
}

// src/mix/session.ts
var ROLE_OFFSET = {
  lead_vocal: 0,
  beat: 1,
  instrumental: 1,
  drums: 0,
  bass: -1,
  guitar: -3,
  keys: -4,
  synth: -4,
  pad: -5,
  fx: -5,
  backing_vocal: -5,
  other: -4
};
var DEFAULT_PAN = { lead_vocal: 0, bass: 0, drums: 0 };
var DEFAULT_REVERB = { lead_vocal: 0.5, backing_vocal: 0.65, guitar: 0.15, keys: 0.2, synth: 0.15, pad: 0.1 };
var DEFAULT_DELAY = { lead_vocal: 0.25, backing_vocal: 0.15 };
var isVocal = (r) => r === "lead_vocal" || r === "backing_vocal";
var isMusicBed = (r) => !isVocal(r) && r !== "fx";
function loudnessOf(a) {
  return measureLoudness(toStereo(a)).integrated;
}
function padTo(a, n, offset = 0) {
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => {
    const o = new Float32Array(n);
    o.set(c.subarray(0, Math.max(0, n - offset)), offset);
    return o;
  }) };
}
function addInto(dst, src, gain) {
  const n = dst.channels[0].length;
  for (let c = 0; c < 2; c++) {
    const s = src.channels[Math.min(c, src.channels.length - 1)], d = dst.channels[c];
    for (let i = 0; i < n; i++) d[i] += s[i] * gain;
  }
}
function duckMid(a, key, depthDb) {
  const sr = a.sampleRate;
  const xo = [250, 5e3];
  const bands = a.channels.map((c) => splitBands(c, sr, xo));
  const mid = { sampleRate: sr, channels: bands.map((b) => b[1]) };
  const keyP90 = levelPercentileDb([key], sr, 90);
  const ratio = 3;
  const res = compress(mid, { thresholdDb: keyP90 + 2.5 - depthDb / (1 - 1 / ratio), ratio, attackMs: 8, releaseMs: 180, kneeDb: 8, sidechain: key });
  for (let c = 0; c < a.channels.length; c++) {
    const o = a.channels[c];
    for (let i = 0; i < o.length; i++) o[i] = bands[c][0][i] + bands[c][1][i] + bands[c][2][i];
  }
  return res.avgGainReductionDb;
}
function mixSession(spec) {
  const notes = [];
  const active = spec.tracks.filter((t) => !t.mute);
  if (!active.length) throw new Error("No audible tracks in the session");
  const loaded = active.map((t) => {
    const a = t.audio ?? (t.path ? readAudio(t.path) : (() => {
      throw new Error(`Track '${t.name ?? t.role}' has neither path nor audio`);
    })());
    return { spec: t, audio: a };
  });
  const sr = loaded.some((l) => l.audio.sampleRate >= 48e3) ? 48e3 : 44100;
  for (const l of loaded) {
    if (l.audio.sampleRate !== sr) {
      notes.push(`Resampled '${l.spec.name ?? l.spec.role}' ${l.audio.sampleRate}\u2192${sr} Hz`);
      l.audio = resample(l.audio, sr);
    }
  }
  const vocalOpts = spec.vocal ?? {};
  const processed = loaded.map(({ spec: t, audio }, idx) => {
    let steps = [];
    let a = audio;
    if (!t.raw) {
      if (isVocal(t.role)) {
        const r = processVocal(a, { ...vocalOpts, role: t.role === "backing_vocal" ? "backing" : "lead" });
        a = r.audio;
        steps = r.report.steps;
      } else {
        const r = processInstrument(a, t.role, spec.genre ?? "balanced");
        a = r.audio;
        steps = r.report.steps;
      }
    } else steps = ["Raw: no automatic processing"];
    if (t.eq?.length) {
      a = cloneAudio(a);
      eq(a, t.eq);
      steps.push(`Custom EQ: ${t.eq.map((b) => `${b.type} ${b.freq} Hz ${b.gainDb ?? 0} dB`).join(", ")}`);
    }
    return { t, a, steps, idx, name: t.name ?? `${t.role}_${idx + 1}` };
  });
  const leadRef = processed.find((p) => p.t.role === "lead_vocal") ?? processed.find((p) => p.t.role === "beat" || p.t.role === "instrumental") ?? processed[0];
  const refLufs = loudnessOf(leadRef.a);
  const refOffset = ROLE_OFFSET[leadRef.t.role];
  const vocalExtra = spec.vocal_level_db ?? 0;
  const maxLen = Math.max(...processed.map((p) => frames(p.a) + Math.round((p.t.start_sec ?? 0) * sr)));
  const revStyle = { room: { rt60: 0.7, pre: 8 }, plate: { rt60: 1.5, pre: 18 }, hall: { rt60: 2.6, pre: 30 } }[spec.reverb_style ?? "plate"];
  const tail = Math.round(sr * (revStyle.rt60 * 1.3 + 0.5));
  const total = maxLen + tail;
  const mixBus = { sampleRate: sr, channels: [new Float32Array(total), new Float32Array(total)] };
  const verbSend = { sampleRate: sr, channels: [new Float32Array(total), new Float32Array(total)] };
  const delaySend = { sampleRate: sr, channels: [new Float32Array(total), new Float32Array(total)] };
  const reverbMul = spec.reverb_amount ?? 1;
  const reports = [];
  const placed = [];
  const bedIdxCounter = {};
  for (const p of processed) {
    const own = loudnessOf(p.a);
    const raw = !!p.t.raw && !p.t.gain_db;
    const auto = raw ? 0 : refLufs + (ROLE_OFFSET[p.t.role] - refOffset) - own + (isVocal(p.t.role) ? vocalExtra : 0);
    const fader = (Number.isFinite(auto) ? Math.max(-40, Math.min(40, auto)) : 0) + (p.t.gain_db ?? 0);
    let pan = p.t.pan ?? DEFAULT_PAN[p.t.role] ?? 0;
    if (p.t.pan === void 0 && (p.t.role === "backing_vocal" || p.t.role === "guitar" || p.t.role === "keys" || p.t.role === "synth")) {
      const k = bedIdxCounter[p.t.role] = (bedIdxCounter[p.t.role] ?? 0) + 1;
      const side = k % 2 === 1 ? -1 : 1;
      pan = side * (p.t.role === "backing_vocal" ? 0.55 : p.t.role === "guitar" ? 0.65 : 0.35) * (1 - 0.15 * Math.floor((k - 1) / 2));
    }
    let st;
    if (p.a.channels.length === 1) {
      const [l, r] = panMono(p.a.channels[0], pan);
      st = { sampleRate: sr, channels: [l, r] };
    } else {
      st = cloneAudio(p.a);
      if (pan) balance(st, pan);
    }
    for (const c of st.channels) {
      const g = dbToLin(fader);
      for (let i = 0; i < c.length; i++) c[i] *= g;
    }
    const off = Math.round((p.t.start_sec ?? 0) * sr);
    const placedAudio = padTo(st, total, off);
    placed.push({ p, audio: placedAudio, fader });
    const rv = (p.t.reverb ?? DEFAULT_REVERB[p.t.role] ?? 0) * reverbMul;
    const dl = p.t.delay ?? DEFAULT_DELAY[p.t.role] ?? 0;
    if (rv > 0) addInto(verbSend, placedAudio, dbToLin(-26 + 14 * Math.min(rv, 1.5)));
    if (dl > 0) addInto(delaySend, placedAudio, dbToLin(-30 + 16 * Math.min(dl, 1)));
    reports.push({ name: p.name, role: p.t.role, steps: p.steps, loudnessBefore: own, faderDb: fader, pan, reverbSend: rv, delaySend: dl });
  }
  const lead = placed.filter((x) => x.p.t.role === "lead_vocal");
  const doDuck = spec.duck !== false && lead.length > 0 && placed.some((x) => isMusicBed(x.p.t.role));
  if (doDuck) {
    const key = new Float32Array(total);
    for (const l of lead) for (let c = 0; c < 2; c++) for (let i = 0; i < total; i++) key[i] += l.audio.channels[c][i] * 0.5;
    const kA = { sampleRate: sr, channels: [key] };
    highpass(kA, 250, 2);
    lowpass(kA, 4500, 2);
    let gr = 0, cnt = 0;
    for (const x of placed) if (isMusicBed(x.p.t.role) && x.p.t.role !== "bass" && x.p.t.role !== "drums") {
      gr += duckMid(x.audio, key, 2.5);
      cnt++;
    }
    if (cnt) notes.push(`Vocal-keyed mid-band ducking (250 Hz\u20135 kHz, ~2.5 dB at vocal peaks) on ${cnt} music track(s) so the voice sits in a pocket without dulling bass or air`);
  }
  for (const x of placed) addInto(mixBus, x.audio, 1);
  if ([...verbSend.channels[0]].some((v) => v !== 0)) {
    const wet = reverbWet(verbSend, { rt60: revStyle.rt60, preDelayMs: revStyle.pre, damping: 0.5, wetHpHz: 300, wetLpHz: 8500, width: 1 });
    addInto(mixBus, wet, 1);
    notes.push(`Reverb return: ${spec.reverb_style ?? "plate"} (${revStyle.rt60}s) with high-passed/low-passed wet so it never muddies the mix`);
  }
  if ([...delaySend.channels[0]].some((v) => v !== 0)) {
    const beatMs = spec.bpm ? 6e4 / spec.bpm * 0.75 : 300;
    const wet = delayWet(delaySend, { timeMs: beatMs, feedback: 0.3, pingPong: true, lpHz: 4500, hpHz: 350 });
    addInto(mixBus, wet, 1);
    notes.push(`Ping-pong delay (${Math.round(beatMs)} ms${spec.bpm ? `, dotted-1/8 @ ${spec.bpm} BPM` : ""}), filtered to sit behind the vocal`);
  }
  let masterRes;
  let finalAudio = mixBus;
  if (spec.master !== false && spec.master?.enabled !== false) {
    const f = Math.round(sr * 0.015);
    for (const c of mixBus.channels) for (let i = 0; i < f; i++) c[total - 1 - i] *= i / f;
    masterRes = masterAudio(mixBus, { genre: spec.genre, ...spec.master ?? {} });
    finalAudio = masterRes.audio;
  }
  return { audio: finalAudio, tracks: reports, master: masterRes, analysis: analyze(finalAudio), notes };
}

// src/api.ts
var r1 = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
var abs = (p) => resolve(process.cwd(), p);
function outPath(input, suffix, output, ext = ".wav", otherInputs = []) {
  const p = output ? abs(output) : join(dirname(abs(input)), `${basename(input, extname2(input))}_${suffix}${ext}`);
  for (const i of [input, ...otherInputs]) {
    if (abs(i) === p) throw new Error(`Refusing to overwrite the input file ${p}. Choose a different output path.`);
  }
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return p;
}
function mustExist(p) {
  const full = abs(p);
  if (!existsSync(full)) throw new Error(`File not found: ${full}`);
  return full;
}
var save = (path, a, bitDepth) => writeAudio(path, a, { bitDepth: bitDepth ?? 24 });
function analyzeFile(path, kind = "mix") {
  const a = readAudio(mustExist(path));
  const an = analyze(a);
  return { file: abs(path), ...summarize(an), diagnosis: diagnose(an, kind), third_octave_db: Object.fromEntries(an.spectrum.freqs.map((f, i) => [Math.round(f), r1(an.spectrum.levelsDb[i])])) };
}
function masterFile(args) {
  const t0 = Date.now();
  const a = readAudio(mustExist(args.input));
  const ref = args.reference ? readAudio(mustExist(args.reference)) : void 0;
  const { input, output, reference, bit_depth, ...opts } = args;
  const res = masterAudio(a, { ...opts, reference: ref });
  const out = outPath(args.input, "mastered", output, ".wav", args.reference ? [args.reference] : []);
  save(out, res.audio, bit_depth);
  return {
    output: out,
    seconds: r1((Date.now() - t0) / 1e3),
    before: summarize(res.before),
    after: summarize(res.after),
    changes: res.report.steps,
    warnings: res.warnings,
    diagnosis_before: diagnose(res.before)
  };
}
function vocalFile(args) {
  const a = readAudio(mustExist(args.input));
  const before = analyze(a);
  const { audio, report } = processVocal(a, args);
  if (args.target_lufs !== void 0) {
    const l = measureLoudness(toStereo(audio)).integrated;
    applyGain(audio, dbToLin(args.target_lufs - l));
    report.steps.push(`Level set to ${args.target_lufs} LUFS`);
  }
  const out = outPath(args.input, "vocal", args.output);
  save(out, audio, args.bit_depth);
  const after = analyze(audio);
  return { output: out, before: summarize(before), after: summarize(after), changes: report.steps, diagnosis_before: diagnose(before, "vocal"), diagnosis_after: diagnose(after, "vocal") };
}
function mixFiles(args) {
  const t0 = Date.now();
  const spec = { ...args, tracks: args.tracks.map((t) => ({ ...t, path: mustExist(t.path) })) };
  const res = mixSession(spec);
  const out = outPath(args.tracks[0].path, "mix", args.output, ".wav", args.tracks.map((t) => t.path));
  save(out, res.audio, args.bit_depth);
  return {
    output: out,
    seconds: r1((Date.now() - t0) / 1e3),
    tracks: res.tracks.map((t) => ({ name: t.name, role: t.role, fader_db: r1(t.faderDb), pan: r1(t.pan, 2), reverb_send: t.reverbSend, delay_send: t.delaySend, processed_lufs_before_fader: r1(t.loudnessBefore), processing: t.steps })),
    mix_notes: res.notes,
    master: res.master ? { changes: res.master.report.steps, warnings: res.master.warnings } : "disabled",
    final: summarize(res.analysis),
    diagnosis: diagnose(res.analysis)
  };
}
function easyMix(a) {
  return mixFiles({
    tracks: [
      { path: a.vocal, role: "lead_vocal", name: "Lead vocal" },
      { path: a.beat, role: "beat", name: "Beat" },
      ...(a.backing_vocals ?? []).map((p, i) => ({ path: p, role: "backing_vocal", name: `Backing ${i + 1}` }))
    ],
    output: a.output,
    bpm: a.bpm,
    genre: a.genre,
    vocal_level_db: a.vocal_level_db,
    reverb_style: a.reverb_style,
    reverb_amount: a.reverb_amount,
    vocal: { voice: a.voice },
    master: { preset: a.preset ?? "streaming" },
    bit_depth: a.bit_depth
  });
}
function compareFiles(aPath, bPath) {
  const A = analyze(readAudio(mustExist(aPath))), B = analyze(readAudio(mustExist(bPath)));
  const sa = thirdOctaveSpectrum({ sampleRate: A.sampleRate, channels: [new Float32Array(1)] });
  const i1k = A.spectrum.freqs.findIndex((f) => f >= 990);
  const diffs = A.spectrum.freqs.map((f, i) => ({ hz: Math.round(f), a_minus_b_db: r1(A.spectrum.levelsDb[i] - A.spectrum.levelsDb[i1k] - (B.spectrum.levelsDb[i] - B.spectrum.levelsDb[i1k])) }));
  const biggest = [...diffs].sort((x, y) => Math.abs(y.a_minus_b_db) - Math.abs(x.a_minus_b_db)).slice(0, 5);
  return {
    a: summarize(A),
    b: summarize(B),
    delta: { lufs: r1(A.loudness.integrated - B.loudness.integrated), true_peak_db: r1(A.truePeakDb - B.truePeakDb), plr_db: r1(A.plr - B.plr), loudness_range_lu: r1(A.loudness.range - B.loudness.range), stereo_width: r1(A.stereo.width - B.stereo.width, 2) },
    biggest_tonal_differences_a_vs_b: biggest,
    tonal_curve_difference: diffs
  };
}
function runChain(input, chain, output, bitDepth) {
  const a = readAudio(mustExist(input));
  const log = [];
  let cur = cloneAudio(a);
  for (const s of chain) {
    switch (s.type) {
      case "gain":
        applyGain(cur, dbToLin(s.db));
        log.push(`gain ${s.db} dB`);
        break;
      case "highpass":
        highpass(cur, s.freq, s.order ?? 4);
        log.push(`highpass ${s.freq} Hz`);
        break;
      case "lowpass":
        lowpass(cur, s.freq, s.order ?? 4);
        log.push(`lowpass ${s.freq} Hz`);
        break;
      case "eq":
        eq(cur, s.bands);
        log.push(`eq ${s.bands.length} band(s)`);
        break;
      case "compressor": {
        const r = compress(cur, { thresholdDb: s.threshold_db, ratio: s.ratio, attackMs: s.attack_ms ?? 10, releaseMs: s.release_ms ?? 120, kneeDb: s.knee_db, makeupDb: s.makeup_db ?? 0, mix: s.mix });
        log.push(`compressor ${s.ratio}:1 @ ${s.threshold_db} dB \u2192 avg GR ${r1(r.avgGainReductionDb)} dB, max ${r1(r.maxGainReductionDb)} dB`);
        break;
      }
      case "multiband": {
        const r = multibandCompress(cur, { crossovers: s.crossovers, bands: s.bands.map((b) => ({ thresholdDb: b.threshold_db, ratio: b.ratio, gainDb: b.gain_db })) });
        log.push(`multiband GR ${r.gainReductionDb.map((x) => r1(x)).join("/")} dB`);
        break;
      }
      case "limiter": {
        const r = limit(cur, { ceilingDb: s.ceiling_db ?? -1, gainDb: s.gain_db, releaseMs: s.release_ms });
        log.push(`limiter ceiling ${s.ceiling_db ?? -1} dBTP, max GR ${r1(r.maxGainReductionDb)} dB`);
        break;
      }
      case "deesser": {
        const r = deEss(cur, { freqHz: s.freq, thresholdDb: s.threshold_db ?? "auto", ratio: s.ratio });
        log.push(`de-esser avg ${r1(r.avgReductionDb)} dB`);
        break;
      }
      case "denoise": {
        denoise(cur, { strength: s.strength, reductionDb: s.reduction_db });
        log.push("denoise");
        break;
      }
      case "expander":
        expand(cur, { thresholdDb: s.threshold_db, ratio: s.ratio, rangeDb: s.range_db });
        log.push(`expander @ ${s.threshold_db} dB`);
        break;
      case "saturation":
        saturate(cur, { driveDb: s.drive_db, mode: s.mode, mix: s.mix });
        log.push(`saturation ${s.mode ?? "tape"}`);
        break;
      case "width":
        cur = toStereo(cur);
        stereoWidth(cur, s.width, s.mono_below_hz ?? 0);
        log.push(`width x${s.width}`);
        break;
      case "reverb":
      case "delay": {
        const st = toStereo(cur);
        const wet = s.type === "reverb" ? reverbWet(st, { rt60: s.rt60, preDelayMs: s.pre_delay_ms, damping: s.damping }) : delayWet(st, { timeMs: s.time_ms, feedback: s.feedback, pingPong: s.ping_pong });
        const g = dbToLin(s.mix_db ?? -16);
        const out = cloneAudio(st);
        for (let c = 0; c < 2; c++) for (let i = 0; i < frames(out); i++) out.channels[c][i] += wet.channels[c][i] * g;
        cur = out;
        log.push(`${s.type} return at ${s.mix_db ?? -16} dB`);
        break;
      }
    }
  }
  const o = outPath(input, "fx", output);
  save(o, cur, bitDepth);
  return { output: o, applied: log, before: summarize(analyze(a)), after: summarize(analyze(cur)) };
}
function listPresets() {
  return {
    delivery_presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { target_lufs: v.targetLufs, ceiling_dbtp: v.ceilingDbTp, label: v.label, notes: v.notes }])),
    genres: Object.keys(GENRE_OFFSETS),
    track_roles: ["lead_vocal", "backing_vocal", "beat", "instrumental", "drums", "bass", "guitar", "keys", "synth", "pad", "fx", "other"]
  };
}

// src/cli.ts
var HELP = `AutoMix \u2014 professional mixing & mastering engine

  automix analyze <file> [--vocal]
  automix master <in> [-o out.wav] [--preset streaming|loud|...] [--genre pop] [--reference ref.wav] [--lufs -14] [--tone 0.6] [--dynamics 0.5] [--warmth 0.3]
  automix vocal <in> [-o out.wav] [--cleanup auto|0..1] [--polish 0.5] [--control 0.6] [--voice male|female]
  automix song <vocal> <beat> [-o out.wav] [--bpm 120] [--genre hiphop] [--preset streaming] [--backing a.wav,b.wav]
  automix mix <session.json> [-o out.wav]
  automix chain <in> <chain.json> [-o out.wav]
  automix compare <a> <b>
  automix presets
`;
function parse(argv) {
  const pos = [];
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o") f.output = argv[++i];
    else if (a.startsWith("--")) {
      const k = a.slice(2);
      const nx = argv[i + 1];
      if (nx === void 0 || nx.startsWith("--")) f[k] = true;
      else {
        f[k] = nx;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, f };
}
var num = (v) => typeof v === "string" ? Number(v) : void 0;
var str = (v) => typeof v === "string" ? v : void 0;
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, f } = parse(rest);
  let res;
  switch (cmd) {
    case "analyze":
      res = analyzeFile(pos[0], f.vocal ? "vocal" : "mix");
      break;
    case "master":
      res = masterFile({ input: pos[0], output: str(f.output), preset: str(f.preset), genre: str(f.genre), reference: str(f.reference), targetLufs: num(f.lufs), tone: num(f.tone), dynamics: num(f.dynamics), warmth: num(f.warmth), ceilingDbTp: num(f.ceiling), bit_depth: num(f.bits) });
      break;
    case "vocal":
      res = vocalFile({ input: pos[0], output: str(f.output), cleanup: f.cleanup === "auto" ? "auto" : num(f.cleanup), polish: num(f.polish), control: num(f.control), tone: num(f.tone), voice: str(f.voice), target_lufs: num(f.lufs) });
      break;
    case "song":
      res = easyMix({ vocal: pos[0], beat: pos[1], output: str(f.output), bpm: num(f.bpm), genre: str(f.genre), preset: str(f.preset), backing_vocals: str(f.backing)?.split(","), vocal_level_db: num(f.vocal_db) });
      break;
    case "mix": {
      const s = JSON.parse(readFileSync2(pos[0], "utf8"));
      if (f.output) s.output = f.output;
      res = mixFiles(s);
      break;
    }
    case "chain":
      res = runChain(pos[0], JSON.parse(readFileSync2(pos[1], "utf8")), str(f.output));
      break;
    case "compare":
      res = compareFiles(pos[0], pos[1]);
      break;
    case "presets":
      res = listPresets();
      break;
    default:
      console.log(HELP);
      return;
  }
  console.log(JSON.stringify(res, null, 2));
}
try {
  main();
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
