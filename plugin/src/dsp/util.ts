export const dbToLin = (db: number) => Math.pow(10, db / 20);
export const linToDb = (lin: number) => 20 * Math.log10(Math.max(lin, 1e-12));
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** One-pole smoothing coefficient for a time constant in ms. */
export function timeCoef(ms: number, sr: number): number {
  if (ms <= 0) return 0;
  return Math.exp(-1 / ((ms / 1000) * sr));
}

export interface Audio {
  sampleRate: number;
  /** One Float32Array per channel, all equal length. */
  channels: Float32Array[];
}

export const frames = (a: Audio) => a.channels[0]?.length ?? 0;
export const duration = (a: Audio) => frames(a) / a.sampleRate;

export function cloneAudio(a: Audio): Audio {
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => new Float32Array(c)) };
}

export function silence(sampleRate: number, nFrames: number, nCh = 2): Audio {
  return { sampleRate, channels: Array.from({ length: nCh }, () => new Float32Array(nFrames)) };
}

/** Force stereo (duplicate mono, or fold >2 channels down). */
export function toStereo(a: Audio): Audio {
  if (a.channels.length === 2) return a;
  if (a.channels.length === 1) return { sampleRate: a.sampleRate, channels: [a.channels[0], new Float32Array(a.channels[0])] };
  return { sampleRate: a.sampleRate, channels: [a.channels[0], a.channels[1]] };
}

export function toMono(a: Audio): Float32Array {
  if (a.channels.length === 1) return a.channels[0];
  const n = frames(a);
  const out = new Float32Array(n);
  const k = 1 / a.channels.length;
  for (const c of a.channels) for (let i = 0; i < n; i++) out[i] += c[i] * k;
  return out;
}

export function applyGain(a: Audio, lin: number): void {
  for (const c of a.channels) for (let i = 0; i < c.length; i++) c[i] *= lin;
}

export function peakOf(a: Audio): number {
  let p = 0;
  for (const c of a.channels) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
  return p;
}
