import { describe, it, expect } from 'vitest';
import { masterAudio } from '../src/chains/master.js';
import { genreCurve, interpCurve } from '../src/chains/targets.js';
import { thirdOctaveSpectrum, type Spectrum } from '../src/analysis/spectrum.js';
import { applyLinearPhaseCurve } from '../src/fx/matcheq.js';
import { diagnose } from '../src/analysis/diagnose.js';
import { analyze } from '../src/analysis/analyze.js';
import { gauss } from './signals.js';
import type { Audio } from '../src/dsp/util.js';

function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
/** Pink-ish noise (≈ -3 dB/oct) with slow amplitude modulation: a stand-in for dense music. */
function pinkMusic(sr: number, sec: number, seed: number, shape: (hz: number) => number = () => 0): Audio {
  const n = sr * sec; const r = rng(seed);
  const mk = () => { const x = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < n; i++) { const w = gauss(r); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.08 * (0.55 + 0.45 * Math.sin((2 * Math.PI * i) / (sr * 2)) ** 2); } return x; };
  const a: Audio = { sampleRate: sr, channels: [mk(), mk()] };
  applyLinearPhaseCurve(a, shape, 4096);
  return a;
}
function deviation(sp: Spectrum, genre: string): number {
  const t = genreCurve(genre);
  const idx = sp.freqs.map((f, i) => (f >= 60 && f <= 12000 ? i : -1)).filter((i) => i >= 0);
  const diffs = idx.map((i) => sp.levelsDb[i] - interpCurve(t, sp.freqs[i]));
  const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  return Math.sqrt(diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / diffs.length);
}

describe('tonal correction', () => {
  it('moves a dark, boomy mix measurably toward the target curve without changing the loudness goal', () => {
    // boomy low end (+7 dB < 150 Hz) and dull highs (-8 dB > 6 kHz)
    const bad = pinkMusic(48000, 14, 11, (hz) => (hz < 150 ? 7 : 0) + (hz > 6000 ? -8 : 0));
    const dBefore = deviation(thirdOctaveSpectrum(bad), 'balanced');
    const r = masterAudio(bad, { preset: 'streaming', genre: 'balanced', tone: 0.8 });
    const dAfter = deviation(thirdOctaveSpectrum(r.audio), 'balanced');
    console.log('tonal deviation before', dBefore.toFixed(2), 'after', dAfter.toFixed(2));
    console.log(r.report.steps.join('\n'));
    expect(dAfter).toBeLessThan(dBefore * 0.8);
    expect(Math.abs(r.after.loudness.integrated + 14)).toBeLessThan(0.5);
    expect(r.after.truePeakDb).toBeLessThanOrEqual(-0.95);
  }, 120000);

  it('does not mess with an already balanced mix (changes < 1.5 dB RMS)', () => {
    const good = pinkMusic(48000, 14, 12, (hz) => -(Math.log2(Math.max(hz, 20) / 1000)) * 1.5); // pink + extra −1.5 dB/oct ≈ mix-like
    const before = thirdOctaveSpectrum(good);
    const r = masterAudio(good, { preset: 'streaming', tone: 0.3 });
    const after = thirdOctaveSpectrum(r.audio);
    let s = 0, c = 0; for (let i = 0; i < before.freqs.length; i++) if (before.freqs[i] > 60 && before.freqs[i] < 12000) { s += (after.levelsDb[i] - before.levelsDb[i] - (after.levelsDb[10] - before.levelsDb[10])) ** 2; c++; }
    expect(Math.sqrt(s / c)).toBeLessThan(3);
  }, 120000);

  it('reference matching pulls a source toward a differently-shaped reference', () => {
    const src = pinkMusic(48000, 14, 21, (hz) => (hz < 150 ? 6 : 0));
    const ref = pinkMusic(48000, 14, 22, (hz) => (hz > 5000 ? 4 : 0) - (hz < 120 ? 3 : 0));
    const dist = (a: Audio) => { const x = thirdOctaveSpectrum(a), y = thirdOctaveSpectrum(ref); const ix = x.freqs.map((f, i) => (f > 80 && f < 12000 ? i : -1)).filter((i) => i >= 0); const d = ix.map((i) => x.levelsDb[i] - y.levelsDb[i]); const m = d.reduce((s, v) => s + v, 0) / d.length; return Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / d.length); };
    const before = dist(src);
    const r = masterAudio(src, { preset: 'streaming', reference: ref, tone: 1 });
    const after = dist(r.audio);
    console.log('ref distance', before.toFixed(2), '→', after.toFixed(2));
    expect(after).toBeLessThan(before * 0.6);
  }, 120000);
});

describe('diagnosis', () => {
  it('flags real problems in plain English', () => {
    const muddy = pinkMusic(48000, 8, 31, (hz) => (hz > 180 && hz < 450 ? 9 : 0));
    for (const c of muddy.channels) for (let i = 0; i < c.length; i++) c[i] = Math.max(-1, Math.min(1, c[i] * 9)); // heavy clip
    const d = diagnose(analyze(muddy));
    console.log(d.map((x) => `[${x.severity}] ${x.issue} → ${x.fix}`).join('\n'));
    const ids = d.map((x) => x.id);
    expect(ids).toContain('clipping');
    expect(ids).toContain('muddy');
  });
});
