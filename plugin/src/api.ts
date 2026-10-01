import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { analyze, summarize } from './analysis/analyze.js';
import { diagnose } from './analysis/diagnose.js';
import { measureLoudness } from './analysis/loudness.js';
import { thirdOctaveSpectrum } from './analysis/spectrum.js';
import { masterAudio, type MasterOptions } from './chains/master.js';
import { PRESETS } from './chains/presets.js';
import { GENRE_OFFSETS } from './chains/targets.js';
import { processVocal, type VocalOptions } from './chains/vocal.js';
import { compress } from './fx/compressor.js';
import { deEss } from './fx/deesser.js';
import { delayWet } from './fx/delay.js';
import { denoise } from './fx/denoise.js';
import { eq, highpass, lowpass, type EqBand } from './fx/eq.js';
import { expand } from './fx/expander.js';
import { limit } from './fx/limiter.js';
import { multibandCompress } from './fx/multiband.js';
import { reverbWet } from './fx/reverb.js';
import { saturate } from './fx/saturation.js';
import { stereoWidth } from './fx/stereo.js';
import { readAudio, writeAudio, type BitDepth } from './io/audio.js';
import { mixSession, type SessionSpec, type TrackRole } from './mix/session.js';
import { applyGain, cloneAudio, dbToLin, frames, toStereo, type Audio } from './dsp/util.js';

const r1 = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const abs = (p: string) => resolve(process.cwd(), p);

function outPath(input: string, suffix: string, output?: string, ext = '.wav', otherInputs: string[] = []): string {
  const p = output ? abs(output) : join(dirname(abs(input)), `${basename(input, extname(input))}_${suffix}${ext}`);
  for (const i of [input, ...otherInputs]) {
    if (abs(i) === p) throw new Error(`Refusing to overwrite the input file ${p}. Choose a different output path.`);
  }
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return p;
}
function mustExist(p: string): string {
  const full = abs(p);
  if (!existsSync(full)) throw new Error(`File not found: ${full}`);
  return full;
}
const save = (path: string, a: Audio, bitDepth?: number) => writeAudio(path, a, { bitDepth: (bitDepth as BitDepth) ?? 24 });

// ───────────────────────────── analyze ─────────────────────────────
export function analyzeFile(path: string, kind: 'mix' | 'vocal' = 'mix') {
  const a = readAudio(mustExist(path));
  const an = analyze(a);
  return { file: abs(path), ...summarize(an), diagnosis: diagnose(an, kind), third_octave_db: Object.fromEntries(an.spectrum.freqs.map((f, i) => [Math.round(f), r1(an.spectrum.levelsDb[i])])) };
}

// ───────────────────────────── master ─────────────────────────────
export interface MasterArgs extends Omit<MasterOptions, 'reference'> {
  input: string; output?: string; reference?: string; bit_depth?: 16 | 24 | 32;
}
export function masterFile(args: MasterArgs) {
  const t0 = Date.now();
  const a = readAudio(mustExist(args.input));
  const ref = args.reference ? readAudio(mustExist(args.reference)) : undefined;
  const { input, output, reference, bit_depth, ...opts } = args;
  void input; void reference;
  const res = masterAudio(a, { ...opts, reference: ref });
  const out = outPath(args.input, 'mastered', output, '.wav', args.reference ? [args.reference] : []);
  save(out, res.audio, bit_depth);
  return {
    output: out, seconds: r1((Date.now() - t0) / 1000),
    before: summarize(res.before), after: summarize(res.after),
    changes: res.report.steps, warnings: res.warnings,
    diagnosis_before: diagnose(res.before),
  };
}

// ───────────────────────────── vocal ─────────────────────────────
export interface VocalArgs extends VocalOptions { input: string; output?: string; target_lufs?: number; bit_depth?: 16 | 24 | 32 }
export function vocalFile(args: VocalArgs) {
  const a = readAudio(mustExist(args.input));
  const before = analyze(a);
  const { audio, report } = processVocal(a, args);
  if (args.target_lufs !== undefined) {
    const l = measureLoudness(toStereo(audio)).integrated;
    applyGain(audio, dbToLin(args.target_lufs - l));
    report.steps.push(`Level set to ${args.target_lufs} LUFS`);
  }
  const out = outPath(args.input, 'vocal', args.output);
  save(out, audio, args.bit_depth);
  const after = analyze(audio);
  return { output: out, before: summarize(before), after: summarize(after), changes: report.steps, diagnosis_before: diagnose(before, 'vocal'), diagnosis_after: diagnose(after, 'vocal') };
}

// ───────────────────────────── mix ─────────────────────────────
export interface SessionArgs extends Omit<SessionSpec, 'tracks'> {
  tracks: (Omit<SessionSpec['tracks'][number], 'path' | 'audio'> & { path: string })[];
  output?: string; bit_depth?: 16 | 24 | 32;
}
export function mixFiles(args: SessionArgs) {
  const t0 = Date.now();
  const spec: SessionSpec = { ...args, tracks: args.tracks.map((t) => ({ ...t, path: mustExist(t.path) })) };
  const res = mixSession(spec);
  const out = outPath(args.tracks[0].path, 'mix', args.output, '.wav', args.tracks.map((t) => t.path));
  save(out, res.audio, args.bit_depth);
  return {
    output: out, seconds: r1((Date.now() - t0) / 1000),
    tracks: res.tracks.map((t) => ({ name: t.name, role: t.role, fader_db: r1(t.faderDb), pan: r1(t.pan, 2), reverb_send: t.reverbSend, delay_send: t.delaySend, processed_lufs_before_fader: r1(t.loudnessBefore), processing: t.steps })),
    mix_notes: res.notes,
    master: res.master ? { changes: res.master.report.steps, warnings: res.master.warnings } : 'disabled',
    final: summarize(res.analysis), diagnosis: diagnose(res.analysis),
  };
}

export interface EasyMixArgs {
  vocal: string; beat: string; output?: string; backing_vocals?: string[]; bpm?: number; genre?: string; preset?: string;
  vocal_level_db?: number; reverb_style?: 'room' | 'plate' | 'hall'; reverb_amount?: number; voice?: 'male' | 'female' | 'auto'; bit_depth?: 16 | 24 | 32;
}
/** The newbie one-call path: vocal + beat in → radio-ready song out. */
export function easyMix(a: EasyMixArgs) {
  return mixFiles({
    tracks: [
      { path: a.vocal, role: 'lead_vocal', name: 'Lead vocal' },
      { path: a.beat, role: 'beat', name: 'Beat' },
      ...(a.backing_vocals ?? []).map((p, i) => ({ path: p, role: 'backing_vocal' as TrackRole, name: `Backing ${i + 1}` })),
    ],
    output: a.output, bpm: a.bpm, genre: a.genre, vocal_level_db: a.vocal_level_db, reverb_style: a.reverb_style, reverb_amount: a.reverb_amount,
    vocal: { voice: a.voice }, master: { preset: a.preset ?? 'streaming' }, bit_depth: a.bit_depth,
  });
}

// ───────────────────────────── compare ─────────────────────────────
export function compareFiles(aPath: string, bPath: string) {
  const A = analyze(readAudio(mustExist(aPath))), B = analyze(readAudio(mustExist(bPath)));
  const sa = thirdOctaveSpectrum({ sampleRate: A.sampleRate, channels: [new Float32Array(1)] });
  void sa;
  const i1k = A.spectrum.freqs.findIndex((f) => f >= 990);
  const diffs = A.spectrum.freqs.map((f, i) => ({ hz: Math.round(f), a_minus_b_db: r1((A.spectrum.levelsDb[i] - A.spectrum.levelsDb[i1k]) - (B.spectrum.levelsDb[i] - B.spectrum.levelsDb[i1k])) }));
  const biggest = [...diffs].sort((x, y) => Math.abs(y.a_minus_b_db) - Math.abs(x.a_minus_b_db)).slice(0, 5);
  return {
    a: summarize(A), b: summarize(B),
    delta: { lufs: r1(A.loudness.integrated - B.loudness.integrated), true_peak_db: r1(A.truePeakDb - B.truePeakDb), plr_db: r1(A.plr - B.plr), loudness_range_lu: r1(A.loudness.range - B.loudness.range), stereo_width: r1(A.stereo.width - B.stereo.width, 2) },
    biggest_tonal_differences_a_vs_b: biggest, tonal_curve_difference: diffs,
  };
}

// ───────────────────────────── custom effect chain ─────────────────────────────
export type FxStep =
  | { type: 'gain'; db: number }
  | { type: 'highpass' | 'lowpass'; freq: number; order?: 2 | 4 | 6 }
  | { type: 'eq'; bands: EqBand[] }
  | { type: 'compressor'; threshold_db: number; ratio: number; attack_ms?: number; release_ms?: number; knee_db?: number; makeup_db?: number; mix?: number }
  | { type: 'multiband'; crossovers: number[]; bands: { threshold_db?: number; ratio?: number; gain_db?: number }[] }
  | { type: 'limiter'; ceiling_db?: number; gain_db?: number; release_ms?: number }
  | { type: 'deesser'; freq?: number; threshold_db?: number; ratio?: number }
  | { type: 'denoise'; strength?: number; reduction_db?: number }
  | { type: 'expander'; threshold_db: number; ratio?: number; range_db?: number }
  | { type: 'saturation'; drive_db?: number; mode?: 'tape' | 'tube' | 'soft' | 'clip'; mix?: number }
  | { type: 'width'; width: number; mono_below_hz?: number }
  | { type: 'reverb'; mix_db?: number; rt60?: number; pre_delay_ms?: number; damping?: number }
  | { type: 'delay'; mix_db?: number; time_ms: number; feedback?: number; ping_pong?: boolean };

export function runChain(input: string, chain: FxStep[], output?: string, bitDepth?: number) {
  const a = readAudio(mustExist(input));
  const log: string[] = [];
  let cur: Audio = cloneAudio(a);
  for (const s of chain) {
    switch (s.type) {
      case 'gain': applyGain(cur, dbToLin(s.db)); log.push(`gain ${s.db} dB`); break;
      case 'highpass': highpass(cur, s.freq, s.order ?? 4); log.push(`highpass ${s.freq} Hz`); break;
      case 'lowpass': lowpass(cur, s.freq, (s.order as 2 | 4) ?? 4); log.push(`lowpass ${s.freq} Hz`); break;
      case 'eq': eq(cur, s.bands); log.push(`eq ${s.bands.length} band(s)`); break;
      case 'compressor': { const r = compress(cur, { thresholdDb: s.threshold_db, ratio: s.ratio, attackMs: s.attack_ms ?? 10, releaseMs: s.release_ms ?? 120, kneeDb: s.knee_db, makeupDb: s.makeup_db ?? 0, mix: s.mix }); log.push(`compressor ${s.ratio}:1 @ ${s.threshold_db} dB → avg GR ${r1(r.avgGainReductionDb)} dB, max ${r1(r.maxGainReductionDb)} dB`); break; }
      case 'multiband': { const r = multibandCompress(cur, { crossovers: s.crossovers, bands: s.bands.map((b) => ({ thresholdDb: b.threshold_db, ratio: b.ratio, gainDb: b.gain_db })) }); log.push(`multiband GR ${r.gainReductionDb.map((x) => r1(x)).join('/')} dB`); break; }
      case 'limiter': { const r = limit(cur, { ceilingDb: s.ceiling_db ?? -1, gainDb: s.gain_db, releaseMs: s.release_ms }); log.push(`limiter ceiling ${s.ceiling_db ?? -1} dBTP, max GR ${r1(r.maxGainReductionDb)} dB`); break; }
      case 'deesser': { const r = deEss(cur, { freqHz: s.freq, thresholdDb: s.threshold_db ?? 'auto', ratio: s.ratio }); log.push(`de-esser avg ${r1(r.avgReductionDb)} dB`); break; }
      case 'denoise': { denoise(cur, { strength: s.strength, reductionDb: s.reduction_db }); log.push('denoise'); break; }
      case 'expander': expand(cur, { thresholdDb: s.threshold_db, ratio: s.ratio, rangeDb: s.range_db }); log.push(`expander @ ${s.threshold_db} dB`); break;
      case 'saturation': saturate(cur, { driveDb: s.drive_db, mode: s.mode, mix: s.mix }); log.push(`saturation ${s.mode ?? 'tape'}`); break;
      case 'width': cur = toStereo(cur); stereoWidth(cur, s.width, s.mono_below_hz ?? 0); log.push(`width x${s.width}`); break;
      case 'reverb': case 'delay': {
        const st = toStereo(cur);
        const wet = s.type === 'reverb' ? reverbWet(st, { rt60: s.rt60, preDelayMs: s.pre_delay_ms, damping: s.damping }) : delayWet(st, { timeMs: s.time_ms, feedback: s.feedback, pingPong: s.ping_pong });
        const g = dbToLin(s.mix_db ?? -16);
        const out = cloneAudio(st);
        for (let c = 0; c < 2; c++) for (let i = 0; i < frames(out); i++) out.channels[c][i] += wet.channels[c][i] * g;
        cur = out; log.push(`${s.type} return at ${s.mix_db ?? -16} dB`); break;
      }
    }
  }
  const o = outPath(input, 'fx', output);
  save(o, cur, bitDepth);
  return { output: o, applied: log, before: summarize(analyze(a)), after: summarize(analyze(cur)) };
}

export function listPresets() {
  return {
    delivery_presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { target_lufs: v.targetLufs, ceiling_dbtp: v.ceilingDbTp, label: v.label, notes: v.notes }])),
    genres: Object.keys(GENRE_OFFSETS),
    track_roles: ['lead_vocal', 'backing_vocal', 'beat', 'instrumental', 'drums', 'bass', 'guitar', 'keys', 'synth', 'pad', 'fx', 'other'],
  };
}
