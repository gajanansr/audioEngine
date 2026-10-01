import type { Analysis } from './analyze.js';
import { bandEnergyDb } from './spectrum.js';

export interface Diagnosis { id: string; severity: 'info' | 'warning' | 'problem'; issue: string; fix: string }

/** Turn raw measurements into actionable, plain-English findings (what a mastering engineer notices in the first minute). */
export function diagnose(an: Analysis, kind: 'mix' | 'vocal' = 'mix'): Diagnosis[] {
  const out: Diagnosis[] = [];
  const sp = an.spectrum;
  const rel = (lo: number, hi: number) => bandEnergyDb(sp, lo, hi);

  if (an.clippedSamples > 5) out.push({ id: 'clipping', severity: 'problem', issue: `${an.clippedSamples} clipped regions detected (samples at full scale for 3+ frames).`, fix: 'Re-export/re-record at a lower level. Mastering cannot fully repair hard clipping.' });
  if (an.truePeakDb > -0.5) out.push({ id: 'true_peak', severity: an.truePeakDb > 0 ? 'problem' : 'warning', issue: `True peak is ${an.truePeakDb.toFixed(1)} dBTP — will distort after MP3/AAC encoding.`, fix: 'Mastering ceiling of -1 dBTP gives lossy codecs headroom.' });
  if (Math.abs(an.dcOffset) > 0.002) out.push({ id: 'dc_offset', severity: 'warning', issue: `DC offset of ${an.dcOffset.toFixed(4)} wastes headroom and can cause clicks.`, fix: 'Automatically removed in the chain.' });
  if (kind === 'mix') {
    if (an.loudness.integrated > -9) out.push({ id: 'too_loud', severity: 'warning', issue: `Very loud (${an.loudness.integrated.toFixed(1)} LUFS): streaming platforms will turn it down, and heavy limiting costs punch.`, fix: 'Target about -14 LUFS for streaming; keep louder versions only for club/DJ use.' });
    if (an.loudness.integrated < -20) out.push({ id: 'too_quiet', severity: 'info', issue: `Quiet (${an.loudness.integrated.toFixed(1)} LUFS) compared with commercial releases.`, fix: 'Mastering will raise it to the target loudness.' });
    if (an.plr < 7 && an.loudness.integrated > -12) out.push({ id: 'over_compressed', severity: 'warning', issue: `Peak-to-loudness ratio is only ${an.plr.toFixed(1)} dB — the track is already heavily compressed/limited.`, fix: 'Request the pre-limiter mix; avoid additional loudness gain.' });
    if (an.plr > 18 && an.loudness.integrated < -16) out.push({ id: 'very_dynamic', severity: 'info', issue: `Large dynamic range (PLR ${an.plr.toFixed(1)} dB): transients are far above the average level.`, fix: 'Bus compression before limiting will let it get louder with less distortion.' });
    if (an.stereo.correlation < 0) out.push({ id: 'phase', severity: 'problem', issue: `Left/right are out of phase (correlation ${an.stereo.correlation.toFixed(2)}): it will lose bass and body in mono.`, fix: 'Check polarity of stereo sources; avoid wide-stereo effects on bass.' });
    else if (an.stereo.lowCorrelation < 0.8 && !an.stereo.mono) out.push({ id: 'wide_bass', severity: 'warning', issue: 'Stereo information in the bass region will weaken on phones and club systems.', fix: 'Keep sub/bass mono (done automatically in the master).' });
    if (!an.stereo.mono && an.stereo.width < 0.03) out.push({ id: 'narrow', severity: 'info', issue: 'The mix is nearly mono.', fix: 'Pan supporting instruments and add stereo reverb/width for a bigger image.' });
  }
  // tonal
  const total = rel(20, 20500);
  const lowMid = rel(180, 450) - total, mid = rel(800, 2500) - total, hi = rel(5000, 9000) - total, air = rel(10000, 20000) - total, sub = rel(20, 60) - total, bass = rel(60, 160) - total;
  const pres = rel(2500, 5000) - total;
  if (lowMid - mid > (kind === 'vocal' ? 6 : 5)) out.push({ id: 'muddy', severity: 'warning', issue: 'Too much energy around 200–450 Hz (muddy/boxy).', fix: 'Cut 2–4 dB around 250–350 Hz with a wide EQ band.' });
  if (pres - mid > 1.5) out.push({ id: 'harsh', severity: 'warning', issue: 'Strong 2.5–5 kHz region: likely harsh or fatiguing.', fix: 'Gentle 1–2 dB dip around 3–4 kHz; check for over-bright saturation.' });
  if (hi - mid < -22 && an.centroidHz < 1500) out.push({ id: 'dull', severity: 'info', issue: 'Little energy above 5 kHz (dull).', fix: 'High shelf +2 dB at 10 kHz (only if the source contains high-frequency content).' });
  if (kind === 'mix') {
    if (sub > -17 && bass < sub + 6) out.push({ id: 'sub_heavy', severity: 'warning', issue: 'Sub-bass dominates (<60 Hz): wastes headroom and disappears on small speakers.', fix: 'High-pass at 25–30 Hz; reduce 40–60 Hz or add harmonics at 100–200 Hz.' });
    if (bass < -14 && an.bands.sub < -22) out.push({ id: 'thin', severity: 'info', issue: 'Light low end (thin).', fix: 'Shelf +2 dB at 100 Hz or add bass saturation.' });
    if (air < -42 && an.centroidHz < 2500) out.push({ id: 'no_air', severity: 'info', issue: 'Almost no content above 10 kHz — dull or low-passed source (e.g. MP3).', fix: 'Gentle air shelf only if the content exists; do not boost noise.' });
  }
  if (kind === 'vocal' || an.sibilanceDb > -10) {
    if (an.sibilanceDb > -6.5) out.push({ id: 'sibilant', severity: 'warning', issue: 'Strong 5–9 kHz energy relative to the mids (sibilance / "s" sounds).', fix: 'De-ess around 5–8 kHz before compression.' });
  }
  if (an.noiseFloorDb > -50) out.push({ id: 'noisy', severity: an.noiseFloorDb > -40 ? 'problem' : 'warning', issue: `Noise floor is high (${an.noiseFloorDb.toFixed(0)} dBFS) — background hiss/room noise is audible between phrases.`, fix: 'Noise reduction + downward expander (included in the vocal chain).' });
  return out;
}
