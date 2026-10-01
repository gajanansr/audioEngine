import { dbToLin, timeCoef, type Audio } from '../dsp/util.js';
import { truePeakEnvelope } from '../analysis/loudness.js';

export interface LimiterParams {
  ceilingDb: number;       // true-peak ceiling in dBTP
  releaseMs?: number;
  lookaheadMs?: number;
  /** Pre-gain in dB before limiting (drives loudness). */
  gainDb?: number;
}

/**
 * Lookahead brick-wall limiter with inter-sample (true-peak) detection.
 * Gain = moving-average(sliding-min(required gain)) guarantees no overshoot with a smooth attack;
 * an exponential release stage keeps it musical.
 */
export function limit(a: Audio, p: LimiterParams): { maxGainReductionDb: number; avgGainReductionDb: number } {
  const sr = a.sampleRate, n = a.channels[0].length;
  const ceiling = dbToLin(p.ceilingDb);
  const L = Math.max(2, Math.round(((p.lookaheadMs ?? 2) / 1000) * sr));
  const pre = dbToLin(p.gainDb ?? 0);
  for (const c of a.channels) for (let i = 0; i < n; i++) c[i] *= pre;

  // required gain per sample (linked across channels using inter-sample peak estimate)
  const env = a.channels.map((c) => truePeakEnvelope(c, ceiling / 2.5));
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const e of env) if (e[i] > m) m = e[i];
    g[i] = m > ceiling ? ceiling / m : 1;
  }
  // sliding minimum over forward window [i, i+L-1] (monotonic deque)
  const gmin = new Float32Array(n);
  const dq = new Int32Array(n + 1);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && g[dq[tail - 1]] >= g[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + L - 1) head++;
    gmin[i] = g[dq[head]];
  }
  // moving average over [i-L+1, i] → smooth attack, guaranteed <= g[i]
  const gatt = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += gmin[i];
    if (i >= L) acc -= gmin[i - L];
    gatt[i] = acc / Math.min(i + 1, L) * 1;
  }
  // The first L-1 samples average fewer terms — fine, since missing terms are ≥ the same window value.
  const rel = timeCoef(p.releaseMs ?? 80, sr);
  let y = 1, maxGr = 1, sum = 0;
  for (let i = 0; i < n; i++) {
    const t = gatt[i];
    y = t < y ? t : rel * y + (1 - rel) * t;
    if (y > t) y = t;
    gatt[i] = y;
    if (y < maxGr) maxGr = y;
    sum += y;
  }
  for (const c of a.channels) for (let i = 0; i < n; i++) c[i] *= gatt[i];
  // safety: hard-trim any residual overs (numerical)
  for (const c of a.channels) for (let i = 0; i < n; i++) { if (c[i] > ceiling) c[i] = ceiling; else if (c[i] < -ceiling) c[i] = -ceiling; }
  return { maxGainReductionDb: 20 * Math.log10(maxGr), avgGainReductionDb: 20 * Math.log10(sum / Math.max(n, 1)) };
}
