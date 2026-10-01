import { analyze } from '../analysis/analyze.js';
import { levelPercentileDb, rmsPercentileDb } from '../analysis/levels.js';
import { thirdOctaveSpectrum } from '../analysis/spectrum.js';
import { compress } from '../fx/compressor.js';
import { deEss } from '../fx/deesser.js';
import { denoise } from '../fx/denoise.js';
import { eq, highpass, removeDc } from '../fx/eq.js';
import { expand } from '../fx/expander.js';
import { applyLinearPhaseCurve, curveFromPoints } from '../fx/matcheq.js';
import { saturate } from '../fx/saturation.js';
import { cloneAudio, type Audio } from '../dsp/util.js';
import { contentCeilingHz, tonalCorrection, VOCAL_TARGET } from './targets.js';

export interface VocalOptions {
  /** 0..1 — how much clean-up (noise reduction, gating). 'auto' decides from measured noise floor. */
  cleanup?: number | 'auto';
  /** 0..1 — compression/leveling amount. */
  control?: number;
  /** 0..1 — presence, air and harmonic sheen. */
  polish?: number;
  /** 0..1 — how far to move toward the ideal vocal tonal balance. */
  tone?: number;
  /** 'male' | 'female' | 'auto' influences high-pass & de-ess frequency. */
  voice?: 'male' | 'female' | 'auto';
  /** Backing/double vocals: darker, flatter, less presence so they sit behind the lead. */
  role?: 'lead' | 'backing';
}

export interface ChainReport { steps: string[] }

/** Professional vocal chain. Every stage is driven by measurements of the actual recording. */
export function processVocal(input: Audio, o: VocalOptions = {}): { audio: Audio; report: ChainReport } {
  const a = cloneAudio(input);
  const steps: string[] = [];
  const control = o.control ?? 0.6;
  const polish = o.polish ?? 0.5;
  const toneAmt = o.tone ?? 0.6;
  const backing = o.role === 'backing';
  const before = analyze(a);

  removeDc(a);

  // ── voice type guess from spectral centroid of the low-mid region
  let voice = o.voice ?? 'auto';
  if (voice === 'auto') {
    const sp = before.spectrum;
    let e1 = 0, e2 = 0;
    sp.freqs.forEach((f, i) => { const e = Math.pow(10, sp.levelsDb[i] / 10); if (f >= 100 && f < 200) e1 += e; else if (f >= 200 && f < 400) e2 += e; });
    voice = e1 > e2 * 0.9 ? 'male' : 'female';
  }
  const hpHz = voice === 'male' ? 80 : 110;
  highpass(a, hpHz, 4);
  steps.push(`High-pass at ${hpHz} Hz (24 dB/oct) to remove rumble & plosive energy (${voice} voice detected)`);

  // ── clean-up
  // Auto: noise floor is only trustworthy if the take actually has pauses. A continuous performance has no
  // noise-only passages, so its "floor" is just quiet singing — be conservative there.
  const p10 = rmsPercentileDb(a.channels[0], a.sampleRate, 10), p90v = rmsPercentileDb(a.channels[0], a.sampleRate, 90);
  const confidence = Math.min(1, Math.max(0.25, (p90v - p10 - 10) / 20));
  const cleanup = o.cleanup === undefined || o.cleanup === 'auto'
    ? Math.min(1, Math.max(0, (before.noiseFloorDb + 70) / 25)) * confidence // −70 dBFS floor → 0, −45 dBFS → 1
    : o.cleanup;
  if (cleanup > 0.08) {
    const r = denoise(a, { strength: 0.35 + 0.5 * cleanup, reductionDb: 6 + 12 * cleanup });
    steps.push(`Spectral noise reduction (strength ${(0.35 + 0.5 * cleanup).toFixed(2)}, up to ${(6 + 12 * cleanup).toFixed(0)} dB) — learned noise profile automatically (floor ${before.noiseFloorDb.toFixed(0)} dBFS)`);
    void r;
    if (cleanup > 0.3) {
      const p50 = levelPercentileDb(a.channels, a.sampleRate, 50);
      expand(a, { thresholdDb: Math.max(before.noiseFloorDb + 8, p50 - 22), ratio: 2.5, rangeDb: 6 + 8 * cleanup, releaseMs: 150 });
      steps.push('Downward expander to soften room noise between phrases');
    }
  }

  // ── tonal shaping toward vocal target (linear-phase so it never smears the phase of the voice)
  const sp = thirdOctaveSpectrum(a);
  const corr = tonalCorrection(sp, VOCAL_TARGET, {
    intensity: toneAmt * (backing ? 0.5 : 0.8), maxBoostDb: 2.5, maxCutDb: 5, matchRange: [200, 5000],
    limitBoostAboveHz: contentCeilingHz(sp), minHz: hpHz * 1.5,
  });
  applyLinearPhaseCurve(a, curveFromPoints(corr.freqs, corr.gains), 4096);
  const biggest = corr.gains.map((g, i) => ({ g, f: corr.freqs[i] })).sort((x, y) => Math.abs(y.g) - Math.abs(x.g)).slice(0, 3).filter((x) => Math.abs(x.g) >= 0.7);
  steps.push(biggest.length
    ? `Adaptive tonal balance (linear-phase): ${biggest.map((x) => `${x.g > 0 ? '+' : ''}${x.g.toFixed(1)} dB @ ${Math.round(x.f)} Hz`).join(', ')}`
    : 'Tonal balance already close to the vocal target — left untouched');

  // ── de-ess before compression so the compressor doesn't re-emphasise sibilance
  const sibFreq = voice === 'male' ? 5000 : 6000;
  const de = deEss(a, { freqHz: sibFreq, thresholdDb: 'auto', ratio: 4, maxReductionDb: 8 });
  steps.push(`De-esser above ${sibFreq} Hz (auto threshold), avg reduction ${de.avgReductionDb.toFixed(1)} dB`);

  // ── two-stage compression, thresholds relative to the performance's own level
  const p90 = levelPercentileDb(a.channels, a.sampleRate, 90);
  const p50 = levelPercentileDb(a.channels, a.sampleRate, 50);
  const spread = Math.max(2, p90 - p50);
  const c1 = compress(a, { thresholdDb: p50 - 1, ratio: 1.8 + 1.4 * control, attackMs: 25, releaseMs: 250, kneeDb: 10, makeupDb: 0, adaptiveRelease: true, sidechainHpHz: 150 });
  const c2 = compress(a, { thresholdDb: p90 - 2 - 2 * (1 - control), ratio: 3 + 3 * control, attackMs: 4, releaseMs: 70, kneeDb: 6, makeupDb: 0, sidechainHpHz: 200 });
  steps.push(`Leveling compressor ${(1.8 + 1.4 * control).toFixed(1)}:1 (avg ${c1.avgGainReductionDb.toFixed(1)} dB) + peak control ${(3 + 3 * control).toFixed(1)}:1 (avg ${c2.avgGainReductionDb.toFixed(1)} dB) — performance spread was ${spread.toFixed(1)} dB`);

  // ── musical EQ: presence & air (scaled by polish), mud cut tied to measured low-mids
  const ceiling = contentCeilingHz(sp);
  const musical = [
    { type: 'peaking' as const, freq: voice === 'male' ? 3200 : 4000, gainDb: (backing ? 0.5 : 2.0) * polish, q: 0.9 },
    ...(ceiling > 14000 ? [{ type: 'highshelf' as const, freq: 11000, gainDb: (backing ? 0.5 : 2.5) * polish, q: 0.6 }] : []),
  ];
  if (backing) musical.push({ type: 'highshelf' as const, freq: 7000, gainDb: -2.5, q: 0.6 });
  eq(a, musical);
  steps.push(`Presence/air EQ (+${(2 * polish).toFixed(1)} dB presence${ceiling > 14000 ? `, +${(2.5 * polish).toFixed(1)} dB air shelf` : ', air shelf skipped: source has no content above ~' + Math.round(ceiling / 1000) + ' kHz'})`);

  // ── subtle tape saturation for density
  if (polish > 0.1) {
    saturate(a, { mode: 'tube', driveDb: 3 + 4 * polish, mix: 0.12 + 0.18 * polish });
    steps.push('Parallel tube saturation for density and harmonic warmth');
  }
  return { audio: a, report: { steps } };
}
