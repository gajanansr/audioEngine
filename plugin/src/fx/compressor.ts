import { Biquad, designBiquad } from '../dsp/biquad.js';
import { dbToLin, linToDb, timeCoef, type Audio } from '../dsp/util.js';

export interface CompressorParams {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb?: number;
  /** dB, or 'auto' to compensate roughly half the static gain reduction at threshold. */
  makeupDb?: number | 'auto';
  /** Parallel (New-York) compression: 0..1 wet. */
  mix?: number;
  /** High-pass on the detector to stop bass from pumping the whole signal. */
  sidechainHpHz?: number;
  /** 1 = fully linked stereo detection. */
  link?: number;
  /** Mono key signal to detect from (e.g. vocal for ducking music). */
  sidechain?: Float32Array;
  /** Program-dependent release: fast on transients, slow on sustained material. */
  adaptiveRelease?: boolean;
}

export interface DynamicsResult { avgGainReductionDb: number; maxGainReductionDb: number }

export function compress(a: Audio, p: CompressorParams): DynamicsResult {
  const sr = a.sampleRate, nCh = a.channels.length, n = a.channels[0].length;
  const knee = p.kneeDb ?? 6;
  const slope = 1 / Math.max(p.ratio, 1) - 1;
  const aA = timeCoef(p.attackMs, sr);
  const aR = timeCoef(p.releaseMs, sr);
  const aRfast = timeCoef(Math.max(p.releaseMs * 0.2, 5), sr);
  const link = p.link ?? 1;
  const mix = p.mix ?? 1;
  const makeup = p.makeupDb === 'auto'
    ? -(p.thresholdDb * (1 - 1 / Math.max(p.ratio, 1))) * 0.5
    : (p.makeupDb ?? 0);
  const makeLin = dbToLin(makeup);
  const hp = p.sidechainHpHz ? a.channels.map(() => new Biquad(designBiquad('highpass', sr, p.sidechainHpHz!, 0.7071))) : null;

  let grDb = 0, sum = 0, maxGr = 0;
  let slowEnv = 0;
  const dry = mix < 1 ? a.channels.map((c) => new Float32Array(c)) : null;
  const key = p.sidechain;

  for (let i = 0; i < n; i++) {
    // detector level (linked: blend of per-channel max and mean)
    let mx = 0, mean = 0;
    if (key) { mx = mean = Math.abs(key[i]); }
    else {
      for (let c = 0; c < nCh; c++) {
        let v = a.channels[c][i];
        if (hp) v = hp[c].process(v);
        const av = Math.abs(v);
        if (av > mx) mx = av;
        mean += av;
      }
      mean /= nCh;
    }
    const lvlDb = linToDb(link * mx + (1 - link) * mean);
    // static curve with soft knee → target gain reduction (<= 0 dB)
    const over = lvlDb - p.thresholdDb;
    let target: number;
    if (2 * over < -knee) target = 0;
    else if (2 * Math.abs(over) <= knee) target = slope * ((over + knee / 2) ** 2) / (2 * knee);
    else target = slope * over;
    // ballistics in the dB domain
    if (target < grDb) grDb = aA * grDb + (1 - aA) * target;
    else {
      let rc = aR;
      if (p.adaptiveRelease) {
        // sustained gain reduction → slow release; short transient reduction → fast release
        slowEnv = 0.9995 * slowEnv + 0.0005 * (-grDb);
        const w = Math.min(1, slowEnv / 6);
        rc = aRfast * (1 - w) + aR * w;
      }
      grDb = rc * grDb + (1 - rc) * target;
    }
    sum += grDb; if (grDb < maxGr) maxGr = grDb;
    const g = dbToLin(grDb) * makeLin;
    for (let c = 0; c < nCh; c++) {
      const x = a.channels[c][i];
      a.channels[c][i] = dry ? x * g * mix + dry[c][i] * (1 - mix) : x * g;
    }
  }
  return { avgGainReductionDb: sum / Math.max(n, 1), maxGainReductionDb: maxGr };
}
