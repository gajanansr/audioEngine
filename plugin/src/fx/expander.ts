import { dbToLin, linToDb, timeCoef, type Audio } from '../dsp/util.js';

export interface ExpanderParams {
  thresholdDb: number;   // below this, signal is attenuated
  ratio?: number;        // 2 = gentle expander, 10+ = gate
  rangeDb?: number;      // max attenuation
  attackMs?: number;
  holdMs?: number;
  releaseMs?: number;
}

/** Downward expander / gate with hysteresis-style hold. Cleans room noise between phrases. */
export function expand(a: Audio, p: ExpanderParams): void {
  const sr = a.sampleRate, n = a.channels[0].length;
  const ratio = p.ratio ?? 3, range = p.rangeDb ?? 18;
  const aA = timeCoef(p.attackMs ?? 3, sr), aR = timeCoef(p.releaseMs ?? 120, sr);
  const hold = Math.round(((p.holdMs ?? 60) / 1000) * sr);
  const look = Math.round(sr * 0.003); // 3 ms lookahead so word onsets aren't clipped
  const envC = timeCoef(8, sr);
  let env = 0, g = -range, holdCnt = 0;
  const det = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0; for (const c of a.channels) m = Math.max(m, Math.abs(c[i]));
    env = m > env ? m : envC * env + (1 - envC) * m;
    det[i] = env;
  }
  for (let i = 0; i < n; i++) {
    const d = det[Math.min(i + look, n - 1)];
    const under = p.thresholdDb - linToDb(d);
    const target = under > 0 ? -Math.min(range, under * (ratio - 1)) : 0;
    if (target >= g) { g = aA * g + (1 - aA) * target; holdCnt = hold; }
    else if (holdCnt > 0) holdCnt--;
    else g = aR * g + (1 - aR) * target;
    const lin = dbToLin(g);
    for (const c of a.channels) c[i] *= lin;
  }
}
