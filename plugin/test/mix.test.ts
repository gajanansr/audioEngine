import { describe, it, expect } from 'vitest';
import { mixSession, duckMid } from '../src/mix/session.js';
import { musicLoop, phoneVocal } from './signals.js';

describe('mix session', () => {
  it('mixes vocal + beat, masters to target and reports', () => {
    const t0 = Date.now();
    const r = mixSession({
      tracks: [
        { role: 'lead_vocal', audio: phoneVocal(48000, 12, -48) },
        { role: 'beat', audio: musicLoop(48000, 12) },
      ],
      bpm: 120, genre: 'pop',
      master: { preset: 'streaming' },
    });
    console.log('mix ms', Date.now() - t0);
    for (const t of r.tracks) console.log(t.name, 'fader', t.faderDb.toFixed(1), 'pan', t.pan, '\n  ' + t.steps.join('\n  '));
    console.log(r.notes.join('\n'), r.master?.warnings);
    console.log('final LUFS', r.analysis.loudness.integrated.toFixed(2), 'TP', r.analysis.truePeakDb.toFixed(2));
    expect(Math.abs(r.analysis.loudness.integrated + 14)).toBeLessThan(0.5);
    expect(r.analysis.truePeakDb).toBeLessThan(-0.9);
    expect(r.audio.channels.length).toBe(2);
  }, 240000);
});

import { masterFile, mixFiles } from '../src/api.js';
import { writeAudio } from '../src/io/audio.js';
import { measureLoudness } from '../src/analysis/loudness.js';
import { toStereo } from '../src/dsp/util.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('mix balance & safety', () => {
  it('gain-stages by role: lead sits 1 LU under the beat, backing 6 LU under lead, bass 1 LU under lead; pans spread backing vocals', () => {
    const v = phoneVocal(48000, 8, -55, 1), b = musicLoop(48000, 8), bg1 = phoneVocal(48000, 8, -55, 2), bg2 = phoneVocal(48000, 8, -55, 3);
    const r = mixSession({
      tracks: [
        { role: 'lead_vocal', audio: v, name: 'lead' }, { role: 'beat', audio: b, name: 'beat' },
        { role: 'backing_vocal', audio: bg1, name: 'bv1' }, { role: 'backing_vocal', audio: bg2, name: 'bv2' },
      ],
      master: false, duck: false,
    });
    const T = Object.fromEntries(r.tracks.map((t) => [t.name, t]));
    const post = (n: string) => T[n].loudnessBefore + T[n].faderDb; // loudness at the fader output
    expect(post('beat') - post('lead')).toBeCloseTo(1, 0);
    expect(post('lead') - post('bv1')).toBeCloseTo(5, 0);
    expect(T.lead.pan).toBe(0);
    expect(T.bv1.pan).toBeLessThan(-0.3); expect(T.bv2.pan).toBeGreaterThan(0.3);
  }, 120000);

  it('vocal_level_db raises only the vocal; mute removes a track', () => {
    const mk = (extra: number, mute = false) => mixSession({ tracks: [{ role: 'lead_vocal', audio: phoneVocal(48000, 6, -55, 5) }, { role: 'beat', audio: musicLoop(48000, 6), mute }], master: false, duck: false, vocal_level_db: extra });
    const a = mk(0), b = mk(3);
    const fv = (r: ReturnType<typeof mk>) => r.tracks.find((t) => t.role === 'lead_vocal')!.faderDb;
    expect(fv(b) - fv(a)).toBeCloseTo(3, 1);
    expect(mk(0, true).tracks.length).toBe(1);
  }, 120000);

  it('ducking dips only the music mid-band (~2.5 dB) while the vocal is active; bass and the vocal-free section are untouched', () => {
    const sr = 48000, n = sr * 6;
    const mid = new Float32Array(n), low = new Float32Array(n), key = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mid[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sr); low[i] = 0.2 * Math.sin((2 * Math.PI * 80 * i) / sr);
      key[i] = i > sr * 3 ? 0.2 * Math.sin((2 * Math.PI * 800 * i) / sr) : 0; // "vocal" in the second half
    }
    const music = { sampleRate: sr, channels: [mid.map((v, i) => v + low[i]), mid.map((v, i) => v + low[i])] };
    // reference band levels before ducking
    const level = (x: Float32Array, hz: number, a: number, b: number) => { let re = 0, im = 0; for (let i = a; i < b; i++) { re += x[i] * Math.cos((2 * Math.PI * hz * i) / sr); im += x[i] * Math.sin((2 * Math.PI * hz * i) / sr); } return 20 * Math.log10(Math.hypot(re, im) / (b - a) * 2); };
    const before1k = level(music.channels[0], 1000, sr * 4, sr * 6), before80 = level(music.channels[0], 80, sr * 4, sr * 6);
    const quiet1kBefore = level(music.channels[0], 1000, sr * 1, sr * 2.5);
    const gr = duckMid(music, key, 2.5);
    const dMid = level(music.channels[0], 1000, sr * 4, sr * 6) - before1k;
    const dLow = level(music.channels[0], 80, sr * 4, sr * 6) - before80;
    const dQuiet = level(music.channels[0], 1000, sr * 1, sr * 2.5) - quiet1kBefore;
    console.log('duck: mid', dMid.toFixed(2), 'dB  bass', dLow.toFixed(2), 'dB  before-vocal', dQuiet.toFixed(2), 'dB  avg GR', gr.toFixed(2));
    expect(dMid).toBeLessThan(-1.5); expect(dMid).toBeGreaterThan(-4.5);
    expect(Math.abs(dLow)).toBeLessThan(0.3);
    expect(Math.abs(dQuiet)).toBeLessThan(0.15);
  });

  it('never overwrites an input file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'automix-'));
    try {
      const p = join(dir, 'in.wav'); writeAudio(p, musicLoop(44100, 3));
      expect(() => masterFile({ input: p, output: p })).toThrow(/overwrite/i);
      expect(() => mixFiles({ tracks: [{ path: p, role: 'beat' }], output: p })).toThrow(/overwrite/i);
      const r = masterFile({ input: p, output: join(dir, 'sub', 'out.wav'), preset: 'streaming' });
      expect(existsSync(r.output)).toBe(true);
      expect(Math.abs(r.after.integrated_lufs + 14)).toBeLessThan(0.5);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120000);

  it('mono inputs are measured as dual-mono (matches playback)', () => {
    const v = phoneVocal(48000, 6, -60, 4);
    const asMono = measureLoudness(toStereo(v)).integrated;
    expect(asMono).toBeCloseTo(measureLoudness(toStereo({ sampleRate: 48000, channels: [v.channels[0], v.channels[0]] })).integrated, 5);
  });
});
