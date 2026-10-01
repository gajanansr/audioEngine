import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analysis/analyze.js';
import { measureLoudness, measureTruePeak } from '../src/analysis/loudness.js';
import { sine, musicLoop } from './signals.js';
import { masterAudio } from '../src/chains/master.js';

describe('loudness meter (ITU-R BS.1770-4 / EBU R128)', () => {
  it.each([44100, 48000, 96000])('stereo 997 Hz sine at -23 dBFS reads -23.0 LUFS @ %i Hz', (sr) => {
    expect(measureLoudness(sine(sr, 12, 997, Math.pow(10, -23 / 20))).integrated).toBeCloseTo(-23.0, 1);
  });
  it('K-weighting follows the published curve (100 Hz −1.13 dB, 8 kHz +4.04 dB)', () => {
    const ref = Math.pow(10, -23 / 20);
    expect(measureLoudness(sine(48000, 12, 100, ref)).integrated).toBeCloseTo(-23.691 - 1.133, 1);
    expect(measureLoudness(sine(48000, 12, 8000, ref)).integrated).toBeCloseTo(-23.691 + 4.039, 1);
  });
  it('gating ignores silence & very quiet passages (relative gate -10 LU)', () => {
    const loud = sine(48000, 10, 997, Math.pow(10, -23 / 20));
    const quiet = sine(48000, 10, 997, Math.pow(10, -53 / 20));
    const both = { sampleRate: 48000, channels: loud.channels.map((c, i) => { const o = new Float32Array(c.length * 2); o.set(c); o.set(quiet.channels[i], c.length); return o; }) };
    expect(measureLoudness(both).integrated).toBeCloseTo(-23.0, 0);
  });
  it('loudness range is ~0 for a steady tone and large for a two-level signal', () => {
    const loud = sine(48000, 12, 997, Math.pow(10, -20 / 20)), quiet = sine(48000, 12, 997, Math.pow(10, -32 / 20));
    expect(measureLoudness(loud).range).toBeLessThan(0.3);
    const both = { sampleRate: 48000, channels: loud.channels.map((c, i) => { const o = new Float32Array(c.length * 2); o.set(c); o.set(quiet.channels[i], c.length); return o; }) };
    expect(measureLoudness(both).range).toBeGreaterThan(9);
  });
  it('true peak finds inter-sample peaks above the sample peak', () => {
    const n = 4800; const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 0.25 * i) + Math.PI / 4); // fs/4 tone: samples reach only 0.707, true peak is 1.0
    const a = { sampleRate: 48000, channels: [x] };
    expect(measureTruePeak(a)).toBeGreaterThan(-0.3);
    expect(measureTruePeak(a)).toBeLessThan(0.3);
  });
});

describe('mastering', () => {
  it('hits the -14 LUFS target within tolerance and respects the true-peak ceiling', () => {
    const a = musicLoop(48000, 12);
    const r = masterAudio(a, { preset: 'streaming' });
    console.log(r.report.steps.join('\n'), '\nwarnings:', r.warnings);
    console.log('before', r.before.loudness.integrated.toFixed(1), 'after', r.after.loudness.integrated.toFixed(2), 'tp', r.after.truePeakDb.toFixed(2));
    expect(Math.abs(r.after.loudness.integrated + 14)).toBeLessThan(0.5);
    expect(r.after.truePeakDb).toBeLessThanOrEqual(-0.9);
  }, 120000);
});
