import { analyze, type Analysis } from '../analysis/analyze.js';
import { levelPercentileDb } from '../analysis/levels.js';
import { measureLoudness } from '../analysis/loudness.js';
import { masterAudio, type MasterOptions, type MasterResult } from '../chains/master.js';
import { processInstrument, type InstrumentRole } from '../chains/instrument.js';
import { processVocal } from '../chains/vocal.js';
import { compress } from '../fx/compressor.js';
import { delayWet } from '../fx/delay.js';
import { eq, highpass, lowpass, type EqBand } from '../fx/eq.js';
import { splitBands } from '../fx/multiband.js';
import { reverbWet } from '../fx/reverb.js';
import { balance, panMono } from '../fx/stereo.js';
import { readAudio, resample } from '../io/audio.js';
import { cloneAudio, dbToLin, frames, toStereo, type Audio } from '../dsp/util.js';

export type TrackRole = 'lead_vocal' | 'backing_vocal' | 'beat' | 'instrumental' | 'drums' | 'bass' | 'guitar' | 'keys' | 'synth' | 'pad' | 'fx' | 'other';

export interface TrackSpec {
  name?: string;
  /** File path (wav/mp3/flac/m4a/...). Either path or audio must be given. */
  path?: string;
  audio?: Audio;
  role: TrackRole;
  /** Extra fader offset in dB on top of the automatic level balance. */
  gain_db?: number;
  /** -1 (left) … +1 (right). Defaults by role. */
  pan?: number;
  mute?: boolean;
  /** Reverb send 0..1 (default depends on role). */
  reverb?: number;
  /** Delay send 0..1 */
  delay?: number;
  /** Extra EQ applied after the automatic chain. */
  eq?: EqBand[];
  /** Skip all automatic processing (track is already mixed/mastered). */
  raw?: boolean;
  /** Start offset in seconds. */
  start_sec?: number;
}

export interface SessionSpec {
  tracks: TrackSpec[];
  bpm?: number;
  genre?: string;
  /** Vocal level relative to the automatic balance, in dB (positive = louder vocal). */
  vocal_level_db?: number;
  duck?: boolean;
  reverb_style?: 'room' | 'plate' | 'hall';
  reverb_amount?: number; // global multiplier 0..2 (default 1)
  master?: (MasterOptions & { enabled?: boolean }) | false;
  vocal?: { cleanup?: number | 'auto'; control?: number; polish?: number; tone?: number; voice?: 'male' | 'female' | 'auto' };
}

export interface TrackReport { name: string; role: TrackRole; steps: string[]; loudnessBefore: number; faderDb: number; pan: number; reverbSend: number; delaySend: number }
export interface MixResult { audio: Audio; tracks: TrackReport[]; master?: MasterResult; analysis: Analysis; notes: string[] }

/** LU relative to the lead (vocal) track. Beats sit slightly above a compressed lead because they're broadband. */
const ROLE_OFFSET: Record<TrackRole, number> = {
  lead_vocal: 0, beat: 1, instrumental: 1, drums: 0, bass: -1, guitar: -3, keys: -4, synth: -4, pad: -5, fx: -5, backing_vocal: -5, other: -4,
};
const DEFAULT_PAN: Partial<Record<TrackRole, number>> = { lead_vocal: 0, bass: 0, drums: 0 };
const DEFAULT_REVERB: Partial<Record<TrackRole, number>> = { lead_vocal: 0.5, backing_vocal: 0.65, guitar: 0.15, keys: 0.2, synth: 0.15, pad: 0.1 };
const DEFAULT_DELAY: Partial<Record<TrackRole, number>> = { lead_vocal: 0.25, backing_vocal: 0.15 };
const isVocal = (r: TrackRole) => r === 'lead_vocal' || r === 'backing_vocal';
const isMusicBed = (r: TrackRole) => !isVocal(r) && r !== 'fx';

function loudnessOf(a: Audio): number {
  return measureLoudness(toStereo(a)).integrated;
}

function padTo(a: Audio, n: number, offset = 0): Audio {
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => { const o = new Float32Array(n); o.set(c.subarray(0, Math.max(0, n - offset)), offset); return o; }) };
}

function addInto(dst: Audio, src: Audio, gain: number): void {
  const n = dst.channels[0].length;
  for (let c = 0; c < 2; c++) { const s = src.channels[Math.min(c, src.channels.length - 1)], d = dst.channels[c]; for (let i = 0; i < n; i++) d[i] += s[i] * gain; }
}

/** Duck the mid band (250 Hz–5 kHz) of a music track from a vocal key so the voice sits in a pocket, leaving bass & air untouched. */
export function duckMid(a: Audio, key: Float32Array, depthDb: number): number {
  const sr = a.sampleRate;
  const xo = [250, 5000];
  const bands = a.channels.map((c) => splitBands(c, sr, xo));
  const mid: Audio = { sampleRate: sr, channels: bands.map((b) => b[1]) };
  const keyP90 = levelPercentileDb([key], sr, 90);
  const ratio = 3;
  // the detector follows instantaneous peaks, which sit ~2.5 dB above the RMS-window percentile used for the key level
  const res = compress(mid, { thresholdDb: keyP90 + 2.5 - depthDb / (1 - 1 / ratio), ratio, attackMs: 8, releaseMs: 180, kneeDb: 8, sidechain: key });
  for (let c = 0; c < a.channels.length; c++) { const o = a.channels[c]; for (let i = 0; i < o.length; i++) o[i] = bands[c][0][i] + bands[c][1][i] + bands[c][2][i]; }
  return res.avgGainReductionDb;
}

export function mixSession(spec: SessionSpec): MixResult {
  const notes: string[] = [];
  const active = spec.tracks.filter((t) => !t.mute);
  if (!active.length) throw new Error('No audible tracks in the session');

  // 1. load + conform
  const loaded = active.map((t) => {
    const a = t.audio ?? (t.path ? readAudio(t.path) : (() => { throw new Error(`Track '${t.name ?? t.role}' has neither path nor audio`); })());
    return { spec: t, audio: a };
  });
  const sr = loaded.some((l) => l.audio.sampleRate >= 48000) ? 48000 : 44100;
  for (const l of loaded) {
    if (l.audio.sampleRate !== sr) { notes.push(`Resampled '${l.spec.name ?? l.spec.role}' ${l.audio.sampleRate}→${sr} Hz`); l.audio = resample(l.audio, sr); }
  }

  // 2. per-track processing
  const vocalOpts = spec.vocal ?? {};
  const processed = loaded.map(({ spec: t, audio }, idx) => {
    let steps: string[] = [];
    let a = audio;
    if (!t.raw) {
      if (isVocal(t.role)) { const r = processVocal(a, { ...vocalOpts, role: t.role === 'backing_vocal' ? 'backing' : 'lead' }); a = r.audio; steps = r.report.steps; }
      else { const r = processInstrument(a, t.role as InstrumentRole, spec.genre ?? 'balanced'); a = r.audio; steps = r.report.steps; }
    } else steps = ['Raw: no automatic processing'];
    if (t.eq?.length) { a = cloneAudio(a); eq(a, t.eq); steps.push(`Custom EQ: ${t.eq.map((b) => `${b.type} ${b.freq} Hz ${b.gainDb ?? 0} dB`).join(', ')}`); }
    return { t, a, steps, idx, name: t.name ?? `${t.role}_${idx + 1}` };
  });

  // 3. loudness-based gain staging
  const leadRef = processed.find((p) => p.t.role === 'lead_vocal') ?? processed.find((p) => p.t.role === 'beat' || p.t.role === 'instrumental') ?? processed[0];
  const refLufs = loudnessOf(leadRef.a);
  const refOffset = ROLE_OFFSET[leadRef.t.role];
  const vocalExtra = spec.vocal_level_db ?? 0;

  const maxLen = Math.max(...processed.map((p) => frames(p.a) + Math.round((p.t.start_sec ?? 0) * sr)));
  const revStyle = { room: { rt60: 0.7, pre: 8 }, plate: { rt60: 1.5, pre: 18 }, hall: { rt60: 2.6, pre: 30 } }[spec.reverb_style ?? 'plate'];
  const tail = Math.round(sr * (revStyle.rt60 * 1.3 + 0.5));
  const total = maxLen + tail;
  const mixBus: Audio = { sampleRate: sr, channels: [new Float32Array(total), new Float32Array(total)] };
  const verbSend: Audio = { sampleRate: sr, channels: [new Float32Array(total), new Float32Array(total)] };
  const delaySend: Audio = { sampleRate: sr, channels: [new Float32Array(total), new Float32Array(total)] };
  const reverbMul = spec.reverb_amount ?? 1;
  const reports: TrackReport[] = [];
  const placed: { p: typeof processed[number]; audio: Audio; fader: number }[] = [];
  const bedIdxCounter: Record<string, number> = {};

  for (const p of processed) {
    const own = loudnessOf(p.a);
    const raw = !!p.t.raw && !p.t.gain_db;
    const auto = raw ? 0 : refLufs + (ROLE_OFFSET[p.t.role] - refOffset) - own + (isVocal(p.t.role) ? vocalExtra : 0);
    const fader = (Number.isFinite(auto) ? Math.max(-40, Math.min(40, auto)) : 0) + (p.t.gain_db ?? 0);
    // pan
    let pan = p.t.pan ?? DEFAULT_PAN[p.t.role] ?? 0;
    if (p.t.pan === undefined && (p.t.role === 'backing_vocal' || p.t.role === 'guitar' || p.t.role === 'keys' || p.t.role === 'synth')) {
      const k = (bedIdxCounter[p.t.role] = (bedIdxCounter[p.t.role] ?? 0) + 1);
      const side = k % 2 === 1 ? -1 : 1;
      pan = side * (p.t.role === 'backing_vocal' ? 0.55 : p.t.role === 'guitar' ? 0.65 : 0.35) * (1 - 0.15 * Math.floor((k - 1) / 2));
    }
    let st: Audio;
    if (p.a.channels.length === 1) { const [l, r] = panMono(p.a.channels[0], pan); st = { sampleRate: sr, channels: [l, r] }; }
    else { st = cloneAudio(p.a); if (pan) balance(st, pan); }
    for (const c of st.channels) { const g = dbToLin(fader); for (let i = 0; i < c.length; i++) c[i] *= g; }
    const off = Math.round((p.t.start_sec ?? 0) * sr);
    const placedAudio = padTo(st, total, off);
    placed.push({ p, audio: placedAudio, fader });
    const rv = (p.t.reverb ?? DEFAULT_REVERB[p.t.role] ?? 0) * reverbMul;
    const dl = p.t.delay ?? DEFAULT_DELAY[p.t.role] ?? 0;
    if (rv > 0) addInto(verbSend, placedAudio, dbToLin(-26 + 14 * Math.min(rv, 1.5)) );
    if (dl > 0) addInto(delaySend, placedAudio, dbToLin(-30 + 16 * Math.min(dl, 1)));
    reports.push({ name: p.name, role: p.t.role, steps: p.steps, loudnessBefore: own, faderDb: fader, pan, reverbSend: rv, delaySend: dl });
  }

  // 4. vocal-keyed ducking of the music bed
  const lead = placed.filter((x) => x.p.t.role === 'lead_vocal');
  const doDuck = spec.duck !== false && lead.length > 0 && placed.some((x) => isMusicBed(x.p.t.role));
  if (doDuck) {
    const key = new Float32Array(total);
    for (const l of lead) for (let c = 0; c < 2; c++) for (let i = 0; i < total; i++) key[i] += l.audio.channels[c][i] * 0.5;
    const kA: Audio = { sampleRate: sr, channels: [key] };
    highpass(kA, 250, 2); lowpass(kA, 4500, 2);
    let gr = 0, cnt = 0;
    for (const x of placed) if (isMusicBed(x.p.t.role) && x.p.t.role !== 'bass' && x.p.t.role !== 'drums') { gr += duckMid(x.audio, key, 2.5); cnt++; }
    if (cnt) notes.push(`Vocal-keyed mid-band ducking (250 Hz–5 kHz, ~2.5 dB at vocal peaks) on ${cnt} music track(s) so the voice sits in a pocket without dulling bass or air`);
  }
  for (const x of placed) addInto(mixBus, x.audio, 1);

  // 5. effects returns
  if ([...verbSend.channels[0]].some((v) => v !== 0)) {
    const wet = reverbWet(verbSend, { rt60: revStyle.rt60, preDelayMs: revStyle.pre, damping: 0.5, wetHpHz: 300, wetLpHz: 8500, width: 1 });
    addInto(mixBus, wet, 1);
    notes.push(`Reverb return: ${spec.reverb_style ?? 'plate'} (${revStyle.rt60}s) with high-passed/low-passed wet so it never muddies the mix`);
  }
  if ([...delaySend.channels[0]].some((v) => v !== 0)) {
    const beatMs = spec.bpm ? (60000 / spec.bpm) * 0.75 : 300; // dotted eighth
    const wet = delayWet(delaySend, { timeMs: beatMs, feedback: 0.3, pingPong: true, lpHz: 4500, hpHz: 350 });
    addInto(mixBus, wet, 1);
    notes.push(`Ping-pong delay (${Math.round(beatMs)} ms${spec.bpm ? `, dotted-1/8 @ ${spec.bpm} BPM` : ''}), filtered to sit behind the vocal`);
  }

  // 6. master
  let masterRes: MasterResult | undefined;
  let finalAudio = mixBus;
  if (spec.master !== false && spec.master?.enabled !== false) {
    // fade the last 15 ms to avoid a click where the reverb tail is truncated
    const f = Math.round(sr * 0.015);
    for (const c of mixBus.channels) for (let i = 0; i < f; i++) c[total - 1 - i] *= i / f;
    masterRes = masterAudio(mixBus, { genre: spec.genre, ...(spec.master ?? {}) });
    finalAudio = masterRes.audio;
  }
  return { audio: finalAudio, tracks: reports, master: masterRes, analysis: analyze(finalAudio), notes };
}
