import { describe, it, expect } from 'vitest';
import { compress } from '../src/fx/compressor.js';
import { limit } from '../src/fx/limiter.js';
import { deEss } from '../src/fx/deesser.js';
import { denoise } from '../src/fx/denoise.js';
import { splitBands } from '../src/fx/multiband.js';
import { reverbWet } from '../src/fx/reverb.js';
import { saturate } from '../src/fx/saturation.js';
import { stereoWidth } from '../src/fx/stereo.js';
import { applyLinearPhaseCurve } from '../src/fx/matcheq.js';
import { thirdOctaveSpectrum, bandEnergyDb } from '../src/analysis/spectrum.js';
import { measureTruePeak } from '../src/analysis/loudness.js';
import { encodeWav, readAudio, writeAudio } from '../src/io/audio.js';
import { cloneAudio, linToDb, peakOf, type Audio } from '../src/dsp/util.js';
import { sine, gauss } from './signals.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function whiteNoise(sr: number, sec: number, amp: number, seed = 1): Audio {
  const r = rng(seed); const n = sr * sec; const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = gauss(r) * amp;
  return { sampleRate: sr, channels: [x, new Float32Array(x)] };
}

describe('compressor', () => {
  it('static curve: 4:1 above threshold gives the right gain reduction', () => {
    // 1 kHz sine, peak 0.5 (-6 dBFS). Detector sees the peak level (-6 dB). Threshold -18 → over = 12 dB → GR = 12*(1-1/4) = 9 dB
    const a = sine(48000, 2, 1000, 0.5);
    compress(a, { thresholdDb: -18, ratio: 4, attackMs: 1, releaseMs: 50, kneeDb: 0 });
    const outDb = linToDb(rms(a.channels[0], 48000, 96000) * Math.SQRT2);
    expect(outDb).toBeCloseTo(-6 - 9, 0);
  });
  it('is transparent below threshold', () => {
    const a = sine(48000, 1, 440, 0.05); const ref = cloneAudio(a);
    compress(a, { thresholdDb: -10, ratio: 8, attackMs: 5, releaseMs: 50, kneeDb: 0 });
    for (let i = 0; i < 1000; i++) expect(a.channels[0][i]).toBeCloseTo(ref.channels[0][i], 5);
  });
  it('sidechain ducks the signal when the key is loud', () => {
    const a = sine(48000, 1, 440, 0.3); const key = new Float32Array(48000).fill(0.9);
    compress(a, { thresholdDb: -20, ratio: 6, attackMs: 1, releaseMs: 30, sidechain: key, kneeDb: 0 });
    expect(rms(a.channels[0], 40000, 48000)).toBeLessThan(0.3 / Math.SQRT2 * 0.4);
  });
});

describe('limiter', () => {
  it('never exceeds the true-peak ceiling and is level-transparent for quiet material', () => {
    const r = rng(5); const n = 48000 * 4;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (Math.sin(i * 0.05) * 0.8 + (r() - 0.5) * 0.6) * (1 + 1.5 * Math.sin(i / 20000) ** 2);
    const a: Audio = { sampleRate: 48000, channels: [x, new Float32Array(x).map((v) => v * 0.9)] };
    limit(a, { ceilingDb: -1, releaseMs: 80, gainDb: 6 });
    expect(measureTruePeak(a)).toBeLessThanOrEqual(-0.95);
    const q = sine(48000, 1, 300, 0.2); const ref = cloneAudio(q);
    limit(q, { ceilingDb: -1 });
    for (let i = 1000; i < 2000; i++) expect(q.channels[0][i]).toBeCloseTo(ref.channels[0][i], 5);
  });
  it('catches inter-sample peaks', () => {
    const n = 48000; const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.98 * Math.sin(2 * Math.PI * 0.25 * i + Math.PI / 4) * 1.4; // samples ≈ 0.98, true peak ≈ 1.39
    const a: Audio = { sampleRate: 48000, channels: [x] };
    limit(a, { ceilingDb: -1 });
    expect(measureTruePeak(a)).toBeLessThanOrEqual(-0.9);
  });
});

describe('denoise', () => {
  it('is (near) transparent with zero strength: STFT overlap-add reconstructs the input', () => {
    const a = sine(48000, 2, 997, 0.4); const ref = cloneAudio(a);
    denoise(a, { strength: 0, reductionDb: 0 });
    let err = 0; for (let i = 4096; i < a.channels[0].length - 4096; i++) err = Math.max(err, Math.abs(a.channels[0][i] - ref.channels[0][i]));
    expect(err).toBeLessThan(2e-3);
  });
  it('improves SNR on a tone buried in stationary noise', () => {
    const sr = 48000, n = sr * 6;
    const tone = new Float32Array(n), noise = whiteNoise(sr, 6, 0.01).channels[0];
    for (let i = 0; i < n; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.1 * (i % (sr * 2) < sr ? 1 : 0.0); // on/off phrases
    const mix = new Float32Array(n); for (let i = 0; i < n; i++) mix[i] = tone[i] + noise[i];
    const a: Audio = { sampleRate: sr, channels: [mix] };
    denoise(a, { strength: 0.8, reductionDb: 18 });
    const quietBefore = rms(noise, sr, 2 * sr), quietAfter = rms(a.channels[0], sr + 4096, 2 * sr - 4096);
    expect(linToDb(quietAfter) - linToDb(quietBefore)).toBeLessThan(-8);           // gaps get ≥8 dB quieter
    const toneBefore = rms(mix, 0, sr), toneAfter = rms(a.channels[0], 4096, sr - 4096);
    expect(Math.abs(linToDb(toneAfter) - linToDb(toneBefore))).toBeLessThan(1.5);   // the wanted signal is preserved
  });
});

describe('de-esser', () => {
  it('reduces sibilance but leaves low-frequency voice alone', () => {
    const sr = 48000, n = sr * 3; const x = new Float32Array(n); const r = rng(9);
    for (let i = 0; i < n; i++) {
      const voiced = Math.sin(2 * Math.PI * 200 * i / sr) * 0.3 + Math.sin(2 * Math.PI * 400 * i / sr) * 0.15;
      const burst = (i % sr) > sr * 0.5 && (i % sr) < sr * 0.6 ? Math.sin(2 * Math.PI * 7000 * i / sr) * 0.35 + (r() - 0.5) * 0.1 : 0;
      x[i] = voiced + burst;
    }
    const a: Audio = { sampleRate: sr, channels: [x] };
    const before = thirdOctaveSpectrum(a);
    deEss(a, { freqHz: 5500, thresholdDb: -28, ratio: 6 });
    const after = thirdOctaveSpectrum(a);
    const hiDrop = bandEnergyDb(before, 5500, 9000) - bandEnergyDb(after, 5500, 9000);
    const loDrop = bandEnergyDb(before, 100, 1000) - bandEnergyDb(after, 100, 1000);
    expect(hiDrop).toBeGreaterThan(3);
    expect(Math.abs(loDrop)).toBeLessThan(0.3);
  });
});

describe('crossover', () => {
  it('LR4 bands sum back to a flat magnitude response', () => {
    const a = whiteNoise(48000, 4, 0.2);
    const bands = splitBands(a.channels[0], 48000, [150, 4500]);
    const sum = new Float32Array(a.channels[0].length);
    for (const b of bands) for (let i = 0; i < sum.length; i++) sum[i] += b[i];
    const sp0 = thirdOctaveSpectrum({ sampleRate: 48000, channels: [a.channels[0]] });
    const sp1 = thirdOctaveSpectrum({ sampleRate: 48000, channels: [sum] });
    for (let i = 0; i < sp0.freqs.length; i++) if (sp0.freqs[i] > 40 && sp0.freqs[i] < 18000) expect(Math.abs(sp0.levelsDb[i] - sp1.levelsDb[i])).toBeLessThan(0.3);
  });
});

describe('reverb', () => {
  it('is stable, produces a decaying tail close to the requested RT60', () => {
    const sr = 48000; const imp = new Float32Array(sr * 6); imp[0] = 1;
    const wet = reverbWet({ sampleRate: sr, channels: [imp] }, { rt60: 1.5, preDelayMs: 0, wetHpHz: 20, wetLpHz: 20000 });
    const w = wet.channels[0];
    expect(Number.isFinite(peakOf(wet))).toBe(true);
    const e = (a: number, b: number) => linToDb(rms(w, Math.round(a * sr), Math.round(b * sr)));
    const d1 = e(0.2, 0.3), d2 = e(1.2, 1.3);
    const slopePer60 = ((d1 - d2) / 1.0) * 60 / 60; // dB per second *1 → RT60 ≈ 60 / slope
    const rt60 = 60 / ((d1 - d2) / 1.0);
    void slopePer60;
    expect(rt60).toBeGreaterThan(0.8); expect(rt60).toBeLessThan(2.8);
    expect(e(5, 5.5)).toBeLessThan(d1 - 40);
  });
});

describe('saturation', () => {
  it('adds harmonics without changing small-signal level (unity), and doesn\'t alias a near-Nyquist tone', () => {
    const a = sine(48000, 1, 220, 0.01); const ref = cloneAudio(a);
    saturate(a, { driveDb: 12, mode: 'tape', mix: 1 });
    expect(rms(a.channels[0], 12000, 36000) / rms(ref.channels[0], 12000, 36000)).toBeGreaterThan(0.9);
    const hf = sine(48000, 1, 15000, 0.7); saturate(hf, { driveDb: 12, mode: 'tape', mix: 1 });
    const sp = thirdOctaveSpectrum(hf); // 3rd harmonic 45k aliases to 3k at 48k if not oversampled
    const alias = bandEnergyDb(sp, 2500, 3500), fund = bandEnergyDb(sp, 13000, 17000);
    expect(fund - alias).toBeGreaterThan(35);
  });
});

describe('stereo', () => {
  it('width 0 collapses to mono; bass-mono removes side energy below the cutoff', () => {
    const a = whiteNoise(48000, 2, 0.2); a.channels[1] = whiteNoise(48000, 2, 0.2, 99).channels[0];
    const b = cloneAudio(a); stereoWidth(b, 0);
    for (let i = 0; i < 100; i++) expect(b.channels[0][i]).toBeCloseTo(b.channels[1][i], 6);
    const lowL = sine(48000, 1, 60, 0.4); lowL.channels[1] = new Float32Array(lowL.channels[0]).map((v) => -v); // pure side @ 60 Hz
    stereoWidth(lowL, 1, 150);
    expect(rms(lowL.channels[0], 24000, 48000)).toBeLessThan(0.05);
  });
});

describe('linear-phase EQ', () => {
  it('applies the requested gain curve without level or delay error', () => {
    const a = whiteNoise(48000, 8, 0.2); const ref = cloneAudio(a);
    applyLinearPhaseCurve(a, (hz) => (hz > 2000 && hz < 4000 ? 6 : 0), 4096);
    const s0 = thirdOctaveSpectrum(ref), s1 = thirdOctaveSpectrum(a);
    const i3k = s0.freqs.findIndex((f) => f >= 2900), i500 = s0.freqs.findIndex((f) => f >= 490);
    expect(s1.levelsDb[i3k] - s0.levelsDb[i3k]).toBeGreaterThan(5);
    expect(Math.abs(s1.levelsDb[i500] - s0.levelsDb[i500])).toBeLessThan(0.5);
    // zero latency: cross-correlation peak at lag 0
    const x = ref.channels[0], y = a.channels[0]; let best = 0, bestLag = 0;
    for (let lag = -8; lag <= 8; lag++) { let c = 0; for (let i = 20000; i < 30000; i++) c += x[i] * y[i + lag]; if (c > best) { best = c; bestLag = lag; } }
    expect(bestLag).toBe(0);
  });
});

describe('audio i/o', () => {
  it('WAV round trip (24-bit and float) preserves the signal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'automix-'));
    try {
      const a = sine(44100, 0.5, 440, 0.5); a.channels[1] = sine(44100, 0.5, 880, 0.25).channels[0];
      for (const [bits, tol] of [[24, 2e-6], [32, 1e-9], [16, 6e-5]] as const) {
        const p = join(dir, `t${bits}.wav`);
        writeAudio(p, a, { bitDepth: bits });
        const b = readAudio(p);
        expect(b.sampleRate).toBe(44100); expect(b.channels.length).toBe(2);
        let err = 0; for (let i = 0; i < a.channels[0].length; i++) err = Math.max(err, Math.abs(a.channels[0][i] - b.channels[0][i]), Math.abs(a.channels[1][i] - b.channels[1][i]));
        expect(err).toBeLessThan(tol * 4);
      }
      expect(encodeWav(a, 16).length).toBe(44 + a.channels[0].length * 4);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
