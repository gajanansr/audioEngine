export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'notch' | 'allpass';

export interface BiquadCoefs { b0: number; b1: number; b2: number; a1: number; a2: number }

/** RBJ cookbook coefficients (normalised so a0 = 1). */
export function designBiquad(type: FilterType, sr: number, freq: number, q = 0.7071, gainDb = 0): BiquadCoefs {
  const f = Math.min(Math.max(freq, 10), sr * 0.49);
  const w0 = (2 * Math.PI * f) / sr;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sinw / (2 * Math.max(q, 0.05));
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case 'highpass':
      b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case 'notch':
      b0 = 1; b1 = -2 * cosw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case 'allpass':
      b0 = 1 - alpha; b1 = -2 * cosw; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cosw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cosw; a2 = 1 - alpha / A; break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cosw + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
      b2 = A * ((A + 1) - (A - 1) * cosw - s);
      a0 = (A + 1) + (A - 1) * cosw + s;
      a1 = -2 * ((A - 1) + (A + 1) * cosw);
      a2 = (A + 1) + (A - 1) * cosw - s; break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cosw + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
      b2 = A * ((A + 1) + (A - 1) * cosw - s);
      a0 = (A + 1) - (A - 1) * cosw + s;
      a1 = 2 * ((A - 1) - (A + 1) * cosw);
      a2 = (A + 1) - (A - 1) * cosw - s; break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Magnitude response in dB at a frequency. */
export function biquadMagDb(c: BiquadCoefs, sr: number, freq: number): number {
  const w = (2 * Math.PI * freq) / sr;
  const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cw + c.b2 * c2, ni = -(c.b1 * sw + c.b2 * s2);
  const dr = 1 + c.a1 * cw + c.a2 * c2, di = -(c.a1 * sw + c.a2 * s2);
  return 10 * Math.log10(Math.max((nr * nr + ni * ni) / (dr * dr + di * di), 1e-20));
}

/** Transposed direct form II, double precision state. */
export class Biquad {
  private z1 = 0; private z2 = 0;
  constructor(public c: BiquadCoefs) {}
  process(x: number): number {
    const c = this.c;
    const y = c.b0 * x + this.z1;
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
  run(buf: Float32Array): void {
    for (let i = 0; i < buf.length; i++) buf[i] = this.process(buf[i]);
  }
  reset() { this.z1 = 0; this.z2 = 0; }
}

/** Cascade of biquads (e.g. Butterworth / LR4 sections, EQ bands). */
export class BiquadChain {
  filters: Biquad[];
  constructor(coefs: BiquadCoefs[]) { this.filters = coefs.map((c) => new Biquad(c)); }
  process(x: number): number {
    for (const f of this.filters) x = f.process(x);
    return x;
  }
  run(buf: Float32Array): void {
    for (const f of this.filters) f.run(buf);
  }
}

/** Linkwitz-Riley 4th order = two cascaded Butterworth (Q=0.7071) 2nd order sections. */
export function lr4(type: 'lowpass' | 'highpass', sr: number, freq: number): BiquadChain {
  const c = designBiquad(type, sr, freq, Math.SQRT1_2);
  return new BiquadChain([c, { ...c }]);
}
