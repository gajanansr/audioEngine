import type { Audio } from '../src/dsp/util.js';

function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

export function sine(sr: number, sec: number, hz: number, amp = 0.5): Audio {
  const n = Math.round(sr * sec); const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return { sampleRate: sr, channels: [x, new Float32Array(x)] };
}

/** Synthetic "song": kick + bass + chord pad + hat, 120 bpm, stereo, deliberately boomy & dull (tonal problem to fix). */
export function musicLoop(sr = 48000, sec = 12, seed = 3): Audio {
  const n = Math.round(sr * sec); const L = new Float32Array(n), R = new Float32Array(n); const r = rng(seed);
  const beat = sr * 0.5;
  const chord = [220, 277.18, 329.63, 440];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const bp = i % beat, ph = bp / sr;
    const kick = Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-ph * 30)) * ph) * Math.exp(-ph * 9) * 0.9;
    const bass = Math.sin(2 * Math.PI * 55 * t) * 0.35 * (0.6 + 0.4 * Math.exp(-ph * 4));
    let pad = 0; for (const f of chord) pad += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t);
    pad *= 0.07;
    const off = (i + beat / 2) % beat / sr;
    const hat = (r() * 2 - 1) * Math.exp(-off * 90) * 0.12;
    L[i] = kick + bass + pad * 0.9 + hat * 0.6;
    R[i] = kick + bass + pad * 1.1 + hat * 1.0 + 0.0;
  }
  return { sampleRate: sr, channels: [L, R] };
}

/** Synthetic vocal-ish: formant-filtered harmonic series with vibrato + sibilant noise bursts + room noise. */
export function phoneVocal(sr = 48000, sec = 10, noiseDb = -50, seed = 7): Audio {
  const n = Math.round(sr * sec); const x = new Float32Array(n); const r = rng(seed);
  const noiseAmp = Math.pow(10, noiseDb / 20);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const note = [196, 220, 247, 220][Math.floor(t * 1.5) % 4];
    const f0 = note * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t));
    ph += (2 * Math.PI * f0) / sr;
    let v = 0;
    for (let h = 1; h <= 20; h++) {
      const f = h * f0;
      const form = Math.exp(-Math.pow((f - 700) / 500, 2)) + 0.7 * Math.exp(-Math.pow((f - 2600) / 700, 2));
      v += (form / h) * Math.sin(h * ph);
    }
    const phrase = Math.pow(Math.max(0, Math.sin(Math.PI * ((t * 1.5) % 1))), 0.6);
    const dyn = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.4 * t)); // wide dynamics
    x[i] = v * 0.25 * phrase * dyn + gauss(r) * noiseAmp;
  }
  // add sibilance bursts: high-passed noise at phrase ends
  for (let k = 0; k < Math.floor(sec * 1.5); k++) {
    const start = Math.round(((k + 0.85) / 1.5) * sr), len = Math.round(0.12 * sr);
    let y1 = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const w = gauss(r); const hp = w - y1; y1 = w * 0.3 + y1 * 0.7; // crude high-pass
      x[start + i] += hp * 0.12 * Math.sin((Math.PI * i) / len);
    }
  }
  return { sampleRate: sr, channels: [x] };
}
