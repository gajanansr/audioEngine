import { analyze, type Analysis } from '../analysis/analyze.js';
import { measureLoudness, measureTruePeak } from '../analysis/loudness.js';
import { levelPercentileDb, rmsPercentileDb } from '../analysis/levels.js';
import { thirdOctaveSpectrum, type Spectrum } from '../analysis/spectrum.js';
import { compress } from '../fx/compressor.js';
import { highpass, removeDc } from '../fx/eq.js';
import { limit } from '../fx/limiter.js';
import { applyLinearPhaseCurve, curveFromPoints } from '../fx/matcheq.js';
import { multibandCompress, splitBands } from '../fx/multiband.js';
import { peakShave, saturate } from '../fx/saturation.js';
import { stereoWidth } from '../fx/stereo.js';
import { applyGain, cloneAudio, dbToLin, toStereo, type Audio } from '../dsp/util.js';
import { contentCeilingHz, genreCurve, tonalCorrection, type TargetCurve } from './targets.js';
import { getPreset } from './presets.js';
import type { ChainReport } from './vocal.js';

export interface MasterOptions {
  preset?: string;               // delivery preset (loudness + ceiling)
  targetLufs?: number;           // overrides preset
  ceilingDbTp?: number;          // overrides preset
  genre?: string;                // tonal target
  /** Reference track whose spectrum should be matched. */
  reference?: Audio;
  /** 0..1 how strongly tone is corrected (default 0.6, reference matching default 0.8). */
  tone?: number;
  /** 0..1 glue / multiband compression amount. */
  dynamics?: number;
  /** 0..1 harmonic warmth. */
  warmth?: number;
  /** stereo width multiplier (1 = unchanged). 'auto' widens narrow mixes slightly. */
  width?: number | 'auto';
  /** Keep everything below this frequency mono. 0 disables. */
  monoBassHz?: number;
}

export interface MasterResult {
  audio: Audio;
  report: ChainReport;
  before: Analysis;
  after: Analysis;
  warnings: string[];
}

function matchTarget(sp: Spectrum, reference: Audio | undefined, genre: string): TargetCurve {
  if (!reference) return genreCurve(genre);
  const ref = thirdOctaveSpectrum(reference);
  // use the reference's own measured third-octave shape, expressed relative to its 1 kHz band
  const i1k = ref.freqs.findIndex((f) => f >= 990);
  return { freqs: ref.freqs, db: ref.levelsDb.map((v) => v - ref.levelsDb[i1k]) };
}

/** Mastering: tone → dynamics → colour → stereo → loudness (iterative, true-peak safe). */
export function masterAudio(input: Audio, o: MasterOptions = {}): MasterResult {
  const preset = getPreset(o.preset ?? 'streaming');
  const targetLufs = o.targetLufs ?? preset.targetLufs;
  const ceiling = o.ceilingDbTp ?? preset.ceilingDbTp;
  const steps: string[] = [];
  const warnings: string[] = [];
  const before = analyze(input);
  let a = cloneAudio(input);
  const sr = a.sampleRate;

  // 0. normalise input level (so thresholds & drive behave consistently) — peaks at -3 dBFS
  const inPeak = Math.max(...a.channels.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  if (inPeak > 0) applyGain(a, dbToLin(-3) / inPeak);

  // 1. hygiene
  removeDc(a);
  highpass(a, 22, 4);
  steps.push('DC removal + 22 Hz subsonic high-pass (frees headroom the limiter would otherwise waste)');
  if (before.clippedSamples > 20) warnings.push(`Input has ${before.clippedSamples} clipped regions — clipping distortion cannot be fully repaired; ask for a lower-level bounce if possible.`);
  if (before.stereo.correlation < 0) warnings.push(`Stereo correlation is ${before.stereo.correlation.toFixed(2)} (out-of-phase) — the mix will partly cancel in mono. Check phase/polarity of stereo sources.`);

  // 2. tonal balance → linear-phase correction
  const hasRef = !!o.reference;
  const toneAmt = o.tone ?? (hasRef ? 0.8 : 0.55);
  const target = matchTarget(before.spectrum, o.reference, o.genre ?? 'balanced');
  const spA = thirdOctaveSpectrum(a);
  const corr = tonalCorrection(spA, target, {
    intensity: toneAmt, maxBoostDb: hasRef ? 5 : 3, maxCutDb: hasRef ? 6 : 4, matchRange: [120, 8000],
    limitBoostAboveHz: contentCeilingHz(spA), minHz: 35,
  });
  if (toneAmt > 0.01) {
    applyLinearPhaseCurve(a, curveFromPoints(corr.freqs, corr.gains), 8192);
    const big = corr.gains.map((g, i) => ({ g, f: corr.freqs[i] })).filter((x) => Math.abs(x.g) >= 0.6).sort((x, y) => Math.abs(y.g) - Math.abs(x.g)).slice(0, 4);
    steps.push(`${hasRef ? 'Reference-matched' : `Genre ('${o.genre ?? 'balanced'}') tonal`} correction, linear-phase: ${big.length ? big.map((x) => `${x.g > 0 ? '+' : ''}${x.g.toFixed(1)} dB @ ${Math.round(x.f)} Hz`).join(', ') : 'balance already close — no change needed'}`);
  }

  // 3. dynamics
  const dyn = o.dynamics ?? 0.5;
  const p95 = levelPercentileDb(a.channels, sr, 95, 100), p50 = levelPercentileDb(a.channels, sr, 50, 100);
  if (dyn > 0.01) {
    const g = compress(a, { thresholdDb: p95 - 3 * (0.5 + dyn), ratio: 1.4 + 0.8 * dyn, attackMs: 30, releaseMs: 200, kneeDb: 12, sidechainHpHz: 90, adaptiveRelease: true, link: 1 });
    steps.push(`Glue compressor ${(1.4 + 0.8 * dyn).toFixed(1)}:1, soft knee, 30 ms attack, program-dependent release — avg ${g.avgGainReductionDb.toFixed(1)} dB (max ${g.maxGainReductionDb.toFixed(1)} dB)`);
    // multiband control only where a band is uncontrolled
    const xo = [150, 4500];
    const bandLv = (a.channels.map((c) => splitBands(c, sr, xo)));
    const bandThr = [0, 1, 2].map((b) => rmsPercentileDb(bandLv[0][b], sr, 92, 100));
    const bandSpread = [0, 1, 2].map((b) => bandThr[b] - rmsPercentileDb(bandLv[0][b], sr, 50, 100));
    const specs = bandSpread.map((sp, b) => sp > 6 ? { thresholdDb: bandThr[b] - 2, ratio: 1.8 + 0.4 * dyn, attackMs: b === 0 ? 40 : 15, releaseMs: b === 0 ? 150 : 90, kneeDb: 8 } : {});
    if (specs.some((s) => 'thresholdDb' in s)) {
      const r = multibandCompress(a, { crossovers: xo, bands: specs });
      steps.push(`Multiband control (<150 Hz / 150–4.5k / >4.5k), only on uneven bands: GR ${r.gainReductionDb.map((x) => x.toFixed(1)).join(' / ')} dB`);
    }
  }
  void p50;

  // 4. warmth
  const warmth = o.warmth ?? 0.3;
  if (warmth > 0.05) {
    saturate(a, { mode: 'tape', driveDb: 3 + 5 * warmth, mix: 0.1 + 0.2 * warmth });
    steps.push('Parallel tape saturation for cohesion (oversampled — no aliasing)');
  }

  // 5. stereo
  if (a.channels.length === 2) {
    const side = analyze(a).stereo;
    let w = o.width === 'auto' || o.width === undefined ? (side.width < 0.1 && !side.mono ? 1.15 : 1) : o.width;
    const monoHz = o.monoBassHz ?? 120;
    if (side.mono) { w = 1; warnings.push('Source is dual-mono (no stereo information).'); }
    if (w !== 1 || monoHz > 0) {
      stereoWidth(a, w, monoHz);
      steps.push(`Stereo: width ×${w.toFixed(2)}${monoHz > 0 ? `, bass mono below ${monoHz} Hz (translation to club/phone speakers)` : ''}`);
    }
  }

  // 6. loudness: pre-limit soft clip for transparency, then iterate limiter drive to land on target LUFS
  const pre = cloneAudio(a);
  let driveDb = targetLufs - measureLoudness(pre).integrated;
  let out = pre, lim = { maxGainReductionDb: 0, avgGainReductionDb: 0 };
  let bestErr = Infinity;
  let best: { audio: Audio; lim: typeof lim } | null = null;
  for (let iter = 0; iter < 5; iter++) {
    const trial = cloneAudio(pre);
    const g = dbToLin(driveDb);
    for (const ch of trial.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
    // peaks that would need >3 dB of limiting are rounded off first (transparent below the knee) so the limiter doesn't pump
    if (driveDb > 3) peakShave(trial, ceiling - 3, ceiling - 0.3);
    lim = limit(trial, { ceilingDb: ceiling, releaseMs: preset.limiterReleaseMs, lookaheadMs: 2.5 });
    const got = measureLoudness(trial).integrated;
    const err = targetLufs - got;
    if (Math.abs(err) < Math.abs(bestErr)) { bestErr = err; best = { audio: trial, lim: { ...lim } }; }
    if (Math.abs(err) <= 0.1) break;
    driveDb += err * (err > 0 ? 1.15 : 1);
  }
  out = best!.audio; lim = best!.lim;
  const finalTp = measureTruePeak(out);
  if (finalTp > ceiling + 0.05) { applyGain(out, dbToLin(ceiling - finalTp)); }
  steps.push(`Look-ahead true-peak limiter (4× oversampled detection, ceiling ${ceiling.toFixed(1)} dBTP, ${preset.limiterReleaseMs} ms release): max GR ${lim.maxGainReductionDb.toFixed(1)} dB, avg ${lim.avgGainReductionDb.toFixed(1)} dB; iterated to ${targetLufs} LUFS`);

  const after = analyze(out);
  if (Math.abs(after.loudness.integrated - targetLufs) > 0.5) {
    warnings.push(`Could only reach ${after.loudness.integrated.toFixed(1)} LUFS (target ${targetLufs}). The track is too dynamic to hit the target without distortion; consider a lower target or compressing the mix.`);
  }
  if (lim.maxGainReductionDb < -9) warnings.push(`Limiter works hard (max ${lim.maxGainReductionDb.toFixed(1)} dB reduction) — expect reduced punch. A lower-loudness preset such as 'streaming' will sound better.`);
  if (before.loudness.integrated > targetLufs + 3) steps.push(`Source was louder (${before.loudness.integrated.toFixed(1)} LUFS) than the target, so the master is turned down — this preserves dynamics.`);
  return { audio: out, report: { steps }, before, after, warnings };
}

export { toStereo };
