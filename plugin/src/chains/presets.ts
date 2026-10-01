export interface DeliveryPreset {
  label: string;
  targetLufs: number;
  ceilingDbTp: number;
  /** Rough character of the limiter / how much density is acceptable. */
  limiterReleaseMs: number;
  notes: string;
}

export const PRESETS: Record<string, DeliveryPreset> = {
  streaming:   { label: 'Streaming (Spotify/YouTube/Tidal)', targetLufs: -14, ceilingDbTp: -1.0, limiterReleaseMs: 90, notes: 'Matches the loudness normalisation of the major streaming platforms; no further turn-down so full dynamics are preserved.' },
  spotify:     { label: 'Spotify', targetLufs: -14, ceilingDbTp: -1.0, limiterReleaseMs: 90, notes: 'Spotify normalises to -14 LUFS; -1 dBTP leaves headroom for lossy encoding.' },
  apple_music: { label: 'Apple Music', targetLufs: -16, ceilingDbTp: -1.0, limiterReleaseMs: 100, notes: 'Sound Check targets -16 LUFS.' },
  youtube:     { label: 'YouTube', targetLufs: -14, ceilingDbTp: -1.0, limiterReleaseMs: 90, notes: 'YouTube turns louder content down to about -14 LUFS.' },
  soundcloud:  { label: 'SoundCloud', targetLufs: -14, ceilingDbTp: -1.0, limiterReleaseMs: 90, notes: 'Conservative level that survives SoundCloud transcoding.' },
  loud:        { label: 'Loud / club / hip-hop & EDM', targetLufs: -9, ceilingDbTp: -0.8, limiterReleaseMs: 60, notes: 'Competitive loudness. Streaming platforms will turn this down, so the extra limiting costs punch for no gain online — use for DJ/club/download use.' },
  club:        { label: 'Club / DJ', targetLufs: -8, ceilingDbTp: -0.5, limiterReleaseMs: 50, notes: 'Maximum-density master for DJ sets.' },
  cd:          { label: 'CD / download', targetLufs: -11, ceilingDbTp: -0.3, limiterReleaseMs: 70, notes: 'Classic CD-era level.' },
  broadcast:   { label: 'Broadcast (EBU R128)', targetLufs: -23, ceilingDbTp: -1.0, limiterReleaseMs: 150, notes: 'EBU R128 television/radio standard.' },
  podcast:     { label: 'Podcast / spoken word', targetLufs: -16, ceilingDbTp: -1.0, limiterReleaseMs: 120, notes: 'Spoken word is normalised around -16 LUFS (mono: -19).' },
  dynamic:     { label: 'Audiophile / dynamic', targetLufs: -18, ceilingDbTp: -1.0, limiterReleaseMs: 150, notes: 'Preserves transients and dynamic range.' },
};

export function getPreset(name: string): DeliveryPreset {
  const p = PRESETS[name.toLowerCase()];
  if (!p) throw new Error(`Unknown preset '${name}'. Available: ${Object.keys(PRESETS).join(', ')}`);
  return p;
}
