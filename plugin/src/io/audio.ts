import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { Audio } from '../dsp/util.js';

export function hasFfmpeg(): boolean {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

// ───────────────────────── WAV (native) ─────────────────────────

function parseWav(buf: Buffer): Audio {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let pos = 12;
  let fmt: { tag: number; ch: number; sr: number; bits: number } | null = null;
  let dataStart = -1, dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      let tag = buf.readUInt16LE(body);
      const ch = buf.readUInt16LE(body + 2);
      const sr = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (tag === 0xfffe && size >= 26) tag = buf.readUInt16LE(body + 24);
      fmt = { tag, ch, sr, bits };
    } else if (id === 'data') {
      dataStart = body;
      if (size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      dataLen = size;
      break;
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || dataStart < 0) throw new Error('malformed WAV');
  const { tag, ch, sr, bits } = fmt;
  const bytes = bits / 8;
  const n = Math.floor(dataLen / (bytes * ch));
  const channels = Array.from({ length: ch }, () => new Float32Array(n));
  let p = dataStart;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let v: number;
      if (tag === 3 && bits === 32) v = buf.readFloatLE(p);
      else if (tag === 3 && bits === 64) v = buf.readDoubleLE(p);
      else if (tag === 1 && bits === 16) v = buf.readInt16LE(p) / 32768;
      else if (tag === 1 && bits === 24) v = buf.readIntLE(p, 3) / 8388608;
      else if (tag === 1 && bits === 32) v = buf.readInt32LE(p) / 2147483648;
      else if (tag === 1 && bits === 8) v = (buf[p] - 128) / 128;
      else throw new Error(`unsupported WAV encoding (tag ${tag}, ${bits}-bit)`);
      channels[c][i] = v;
      p += bytes;
    }
  }
  return { sampleRate: sr, channels };
}

/** Deterministic PRNG so dither is reproducible. */
function rng(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export type BitDepth = 16 | 24 | 32;

export function encodeWav(a: Audio, bits: BitDepth = 24): Buffer {
  const ch = a.channels.length;
  const n = a.channels[0].length;
  const bytes = bits / 8;
  const dataLen = n * ch * bytes;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(bits === 32 ? 3 : 1, 20); buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(a.sampleRate, 24); buf.writeUInt32LE(a.sampleRate * ch * bytes, 28);
  buf.writeUInt16LE(ch * bytes, 32); buf.writeUInt16LE(bits, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  const r = rng();
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = a.channels[c][i];
      if (bits === 32) { buf.writeFloatLE(x, p); }
      else {
        const scale = bits === 16 ? 32767 : 8388607;
        // TPDF dither (±1 LSB) to avoid quantisation distortion on the final bit depth
        const d = r() - r();
        let v = Math.round(x * scale + d);
        v = Math.max(-scale - 1, Math.min(scale, v));
        if (bits === 16) buf.writeInt16LE(v, p); else buf.writeIntLE(v, p, 3);
      }
      p += bytes;
    }
  }
  return buf;
}

// ───────────────────────── ffmpeg bridge ─────────────────────────

function probe(path: string): { sampleRate: number; channels: number } {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr || 'unknown error'}`);
  const [sr, ch] = r.stdout.trim().split(',').map(Number);
  if (!sr || !ch) throw new Error('could not determine audio format');
  return { sampleRate: sr, channels: ch };
}

function decodeFfmpeg(path: string): Audio {
  const { sampleRate, channels } = probe(path);
  const outCh = Math.min(channels, 2);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-vn', '-ac', String(outCh), '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { maxBuffer: Infinity });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${r.stderr?.toString()}`);
  const raw = r.stdout;
  const n = Math.floor(raw.length / 4 / outCh);
  const f = new Float32Array(raw.buffer, raw.byteOffset, n * outCh);
  const chans = Array.from({ length: outCh }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < outCh; c++) chans[c][i] = f[i * outCh + c];
  return { sampleRate, channels: chans };
}

/** Load any audio file. WAV is read natively; everything else (mp3, flac, m4a, ogg, ...) needs ffmpeg. */
export function readAudio(path: string): Audio {
  const ext = extname(path).toLowerCase();
  if (ext === '.wav' || ext === '.wave') {
    try { return parseWav(readFileSync(path)); } catch (e) {
      if (!hasFfmpeg()) throw e;
    }
  }
  if (!hasFfmpeg()) throw new Error(`Cannot read ${ext || 'this'} file: ffmpeg is not installed (WAV works without it).`);
  return decodeFfmpeg(path);
}

export interface WriteOptions { bitDepth?: BitDepth; mp3Bitrate?: string }

/** Save audio. Format is inferred from extension: .wav (native), .flac/.mp3/.m4a/.ogg via ffmpeg. */
export function writeAudio(path: string, a: Audio, opts: WriteOptions = {}): void {
  const ext = extname(path).toLowerCase();
  if (ext === '.wav' || ext === '') { writeFileSync(path, encodeWav(a, opts.bitDepth ?? 24)); return; }
  if (!hasFfmpeg()) throw new Error(`Cannot write ${ext}: ffmpeg is not installed. Use .wav instead.`);
  const ch = a.channels.length, n = a.channels[0].length;
  const inter = Buffer.alloc(n * ch * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) inter.writeFloatLE(a.channels[c][i], (i * ch + c) * 4);
  const codecArgs: string[] =
    ext === '.mp3' ? ['-codec:a', 'libmp3lame', '-b:a', opts.mp3Bitrate ?? '320k']
    : ext === '.flac' ? ['-codec:a', 'flac', '-sample_fmt', opts.bitDepth === 16 ? 's16' : 's32']
    : ext === '.m4a' || ext === '.aac' ? ['-codec:a', 'aac', '-b:a', '256k']
    : ext === '.ogg' ? ['-codec:a', 'libvorbis', '-q:a', '8']
    : [];
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(a.sampleRate), '-ac', String(ch), '-i', '-', ...codecArgs, path], { input: inter, maxBuffer: Infinity });
  if (r.status !== 0) throw new Error(`ffmpeg encode failed: ${r.stderr?.toString()}`);
}

/** High quality sample-rate conversion (ffmpeg soxr when available, else linear fallback for tiny jobs). */
export function resample(a: Audio, targetRate: number): Audio {
  if (a.sampleRate === targetRate) return a;
  const ch = a.channels.length, n = a.channels[0].length;
  if (hasFfmpeg()) {
    const inter = Buffer.alloc(n * ch * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) inter.writeFloatLE(a.channels[c][i], (i * ch + c) * 4);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', String(a.sampleRate), '-ac', String(ch), '-i', '-', '-af', 'aresample=resampler=soxr', '-ar', String(targetRate), '-f', 'f32le', '-'], { input: inter, maxBuffer: Infinity });
    if (r.status === 0) {
      const raw = r.stdout;
      const m = Math.floor(raw.length / 4 / ch);
      const f = new Float32Array(raw.buffer, raw.byteOffset, m * ch);
      const chans = Array.from({ length: ch }, () => new Float32Array(m));
      for (let i = 0; i < m; i++) for (let c = 0; c < ch; c++) chans[c][i] = f[i * ch + c];
      return { sampleRate: targetRate, channels: chans };
    }
  }
  const ratio = targetRate / a.sampleRate;
  const m = Math.round(n * ratio);
  return { sampleRate: targetRate, channels: a.channels.map((src) => {
    const out = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const x = i / ratio, i0 = Math.floor(x), t = x - i0;
      out[i] = src[i0] * (1 - t) + (src[Math.min(i0 + 1, n - 1)] ?? 0) * t;
    }
    return out;
  }) };
}
