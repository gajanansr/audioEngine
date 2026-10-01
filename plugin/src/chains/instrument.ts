import { analyze } from '../analysis/analyze.js';
import { levelPercentileDb } from '../analysis/levels.js';
import { thirdOctaveSpectrum } from '../analysis/spectrum.js';
import { compress } from '../fx/compressor.js';
import { eq, highpass, removeDc } from '../fx/eq.js';
import { applyLinearPhaseCurve, curveFromPoints } from '../fx/matcheq.js';
import { saturate } from '../fx/saturation.js';
import { stereoWidth } from '../fx/stereo.js';
import { cloneAudio, type Audio } from '../dsp/util.js';
import { genreCurve, tonalCorrection, contentCeilingHz } from './targets.js';
import type { ChainReport } from './vocal.js';

export type InstrumentRole = 'drums' | 'bass' | 'guitar' | 'keys' | 'synth' | 'pad' | 'beat' | 'instrumental' | 'fx' | 'other';

/** Per-role, measurement-driven track processing (gentle: assumes stems may already be partly processed). */
export function processInstrument(input: Audio, role: InstrumentRole, genre = 'balanced'): { audio: Audio; report: ChainReport } {
  const a = cloneAudio(input);
  const steps: string[] = [];
  removeDc(a);
  const an = analyze(a);
  const sp = thirdOctaveSpectrum(a);

  const full = role === 'beat' || role === 'instrumental';
  // subsonic cleanup
  const hp = role === 'bass' || role === 'drums' ? 28 : full ? 25 : 90;
  highpass(a, hp, 4);
  steps.push(`High-pass ${hp} Hz`);

  // tonal correction toward genre balance — stronger for full-range sources, light for individual stems
  const strength = full ? 0.5 : role === 'bass' || role === 'drums' ? 0.3 : 0.35;
  if (full || role === 'bass' || role === 'drums') {
    const corr = tonalCorrection(sp, genreCurve(genre), { intensity: strength, maxBoostDb: 2.5, maxCutDb: 3.5, matchRange: [100, 8000], limitBoostAboveHz: contentCeilingHz(sp), minHz: 40 });
    applyLinearPhaseCurve(a, curveFromPoints(corr.freqs, corr.gains), 4096);
    const big = corr.gains.map((g, i) => ({ g, f: corr.freqs[i] })).sort((x, y) => Math.abs(y.g) - Math.abs(x.g)).slice(0, 2).filter((x) => Math.abs(x.g) >= 0.7);
    if (big.length) steps.push(`Tonal balance toward '${genre}': ${big.map((x) => `${x.g > 0 ? '+' : ''}${x.g.toFixed(1)} dB @ ${Math.round(x.f)} Hz`).join(', ')}`);
  } else {
    // melodic stems: carve a little low-mid mud if it's excessive
    const mud = an.bands.lowMid - an.bands.bass;
    if (mud > -3) { eq(a, [{ type: 'peaking', freq: 300, gainDb: -2, q: 0.9 }]); steps.push('Low-mid mud cut -2 dB @ 300 Hz'); }
  }

  // dynamics
  const p90 = levelPercentileDb(a.channels, a.sampleRate, 90);
  switch (role) {
    case 'bass': {
      const r = compress(a, { thresholdDb: p90 - 4, ratio: 3, attackMs: 15, releaseMs: 120, kneeDb: 8, sidechainHpHz: 40 });
      if (a.channels.length === 2) stereoWidth(a, 0.0, 0); // bass is mono
      steps.push(`Bass compression 3:1 (avg ${r.avgGainReductionDb.toFixed(1)} dB), collapsed to mono for a solid low end`);
      saturate(a, { mode: 'tube', driveDb: 5, mix: 0.2 });
      steps.push('Harmonic saturation so the bass translates on small speakers');
      break;
    }
    case 'drums': {
      const r = compress(a, { thresholdDb: p90 - 5, ratio: 2.5, attackMs: 28, releaseMs: 90, kneeDb: 6, sidechainHpHz: 80 });
      steps.push(`Drum-bus glue 2.5:1 with slow attack to preserve punch (avg ${r.avgGainReductionDb.toFixed(1)} dB)`);
      saturate(a, { mode: 'tape', driveDb: 4, mix: 0.25 });
      break;
    }
    case 'beat': case 'instrumental': {
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
