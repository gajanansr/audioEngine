import { Biquad, designBiquad } from '../dsp/biquad.js';
import { toMono, type Audio } from '../dsp/util.js';

export interface DelayParams {
  timeMs: number;
  feedback?: number;       // 0..0.9
  pingPong?: boolean;
  lpHz?: number;           // dark repeats sit behind the dry vocal
  hpHz?: number;
}

/** Returns WET only. Mono-summed input, stereo ping-pong or dual-mono output. */
export function delayWet(a: Audio, p: DelayParams): Audio {
  const sr = a.sampleRate, n = a.channels[0].length;
  const d = Math.max(1, Math.round((p.timeMs / 1000) * sr));
  const fb = Math.min(p.feedback ?? 0.3, 0.92);
  const mono = toMono(a);
  const L = new Float32Array(n), R = new Float32Array(n);
  const lp = new Biquad(designBiquad('lowpass', sr, p.lpHz ?? 5000, 0.7071));
  const hp = new Biquad(designBiquad('highpass', sr, p.hpHz ?? 300, 0.7071));
  const ping = p.pingPong ?? true;
  for (let i = 0; i < n; i++) {
    const inp = mono[i];
    const fl = i >= d ? L[i - d] : 0, fr = i >= d ? R[i - d] : 0;
    if (ping) {
      L[i] = lp.process(hp.process(inp + fr * fb));
      R[i] = fl * 1;
    } else {
      L[i] = lp.process(hp.process(inp + fl * fb));
      R[i] = L[i];
    }
  }
  return { sampleRate: sr, channels: [L, R] };
}
