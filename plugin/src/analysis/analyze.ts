import { toMono, toStereo, linToDb, type Audio, duration } from '../dsp/util.js';
import { Biquad, designBiquad } from '../dsp/biquad.js';
import { measureLoudness, measureTruePeak, type LoudnessResult } from './loudness.js';
import { thirdOctaveSpectrum, bandEnergyDb, spectralCentroid, type Spectrum } from './spectrum.js';

export interface Analysis {
  durationSec: number;
  sampleRate: number;
  channels: number;
  loudness: LoudnessResult;
  truePeakDb: number;
  samplePeakDb: number;
  /** Peak-to-loudness ratio, a good proxy for how punchy / limited the track is. */
  plr: number;
  crestDb: number;
  rmsDb: number;
  clippedSamples: number;
  dcOffset: number;
  noiseFloorDb: number;
  stereo: { correlation: number; width: number; lowCorrelation: number; mono: boolean };
  spectrum: Spectrum;
  bands: { sub: number; bass: number; lowMid: number; mid: number; presence: number; air: number }; // dB relative to total
  centroidHz: number;
  sibilanceDb: number; // 5–9 kHz vs 1–5 kHz energy in dB
}

function stereoStats(a: Audio): Analysis['stereo'] {
  if (a.channels.length < 2) return { correlation: 1, width: 0, lowCorrelation: 1, mono: true };
  const [l, r] = a.channels;
  let ll = 0, rr = 0, lr = 0, mm = 0, ss = 0;
  for (let i = 0; i < l.length; i++) {
    ll += l[i] * l[i]; rr += r[i] * r[i]; lr += l[i] * r[i];
    const m = (l[i] + r[i]) * 0.5, s = (l[i] - r[i]) * 0.5;
    mm += m * m; ss += s * s;
  }
  const corr = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
  // low-end correlation (<150 Hz)
  const lp1 = new Biquad(designBiquad('lowpass', a.sampleRate, 150, 0.7071));
  const lp2 = new Biquad(designBiquad('lowpass', a.sampleRate, 150, 0.7071));
  let a2 = 0, b2 = 0, ab = 0;
  for (let i = 0; i < l.length; i++) { const x = lp1.process(l[i]), y = lp2.process(r[i]); a2 += x * x; b2 += y * y; ab += x * y; }
  const low = a2 > 0 && b2 > 0 ? ab / Math.sqrt(a2 * b2) : 1;
  const width = mm + ss > 0 ? ss / (mm + ss) : 0; // 0 = mono, 0.5 = fully decorrelated
  return { correlation: corr, width, lowCorrelation: low, mono: ss < 1e-9 * (mm + 1e-12) };
}

export function analyze(a: Audio): Analysis {
  const n = a.channels[0].length;
  // mono files play back centred on both speakers → measure as dual-mono so numbers match what the listener hears
  const loudness = measureLoudness(toStereo(a));
  let sp = 0, sq = 0, clipped = 0, dc = 0;
  for (const c of a.channels) {
    let run = 0;
    for (let i = 0; i < n; i++) {
      const v = c[i], av = Math.abs(v);
      if (av > sp) sp = av;
      sq += v * v; dc += v;
      if (av >= 0.9995) { run++; if (run === 3) clipped++; } else run = 0;
    }
  }
  const total = n * a.channels.length;
  const rms = Math.sqrt(sq / Math.max(total, 1));
  // noise floor = 10th percentile of 50 ms RMS windows (ignores silent digital zero)
  const mono = toMono(a);
  const w = Math.max(1, Math.round(a.sampleRate * 0.05));
  const levels: number[] = [];
  for (let s = 0; s + w <= n; s += w) {
    let e = 0; for (let i = 0; i < w; i++) e += mono[s + i] * mono[s + i];
    const db = linToDb(Math.sqrt(e / w));
    if (db > -110) levels.push(db);
  }
  levels.sort((x, y) => x - y);
  const noiseFloor = levels.length ? levels[Math.floor(levels.length * 0.1)] : -120;

  const spectrum = thirdOctaveSpectrum(a);
  const totalE = bandEnergyDb(spectrum, 20, 20500);
  const rel = (lo: number, hi: number) => bandEnergyDb(spectrum, lo, hi) - totalE;
  const samplePeakDb = linToDb(sp);
  return {
    durationSec: duration(a), sampleRate: a.sampleRate, channels: a.channels.length,
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
    bands: { sub: rel(20, 60), bass: rel(60, 250), lowMid: rel(250, 800), mid: rel(800, 3000), presence: rel(3000, 8000), air: rel(8000, 20500) },
    centroidHz: spectralCentroid(spectrum),
    sibilanceDb: bandEnergyDb(spectrum, 5000, 9000) - bandEnergyDb(spectrum, 1000, 5000),
  };
}

/** Compact, human/LLM friendly summary (no big arrays). */
export function summarize(an: Analysis) {
  const r = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
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
    sibilance_db: r(an.sibilanceDb),
  };
}
