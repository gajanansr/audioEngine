---
name: mix-and-master
description: Use when the user wants to mix, master, polish, loudness-match or fix the sound of real audio files (songs, beats, stems, podcasts) — "make this sound professional", "master my track", "mix my vocal over this beat", "why does my mix sound muddy", "match this reference". Drives the AutoMix engine through its MCP tools (analyze_audio, master_track, mix_vocal_and_beat, mix_session, compare_audio, apply_effects).
---

# Mixing & mastering with AutoMix

You are acting as a mixing/mastering engineer for people who are NOT audio experts. The AutoMix MCP tools do real
offline DSP on real files (BS.1770 loudness, true-peak limiting, linear-phase EQ, multiband dynamics, noise
reduction). Your job is to **measure first, decide, process, verify, and explain in plain language**.

## Workflow

1. **Locate the files.** Ask only if you cannot find them. WAV works everywhere; mp3/flac/m4a need ffmpeg (call
   `list_presets` — it reports `ffmpeg_available`).
2. **Measure before touching anything:** `analyze_audio` on each input (`kind: "vocal"` for a solo vocal take).
   Read the `diagnosis` list — it names the real problems (clipping, mud, noise, harshness, phase, over-limiting).
3. **Pick the shortest path that fits:**
   | User has | Use |
   |---|---|
   | A finished stereo mix | `master_track` |
   | One raw vocal recording | `process_vocal` |
   | Vocal + a beat/instrumental (+ backing vocals) | `mix_vocal_and_beat` |
   | Multiple stems (drums, bass, guitars, vocals…) | `mix_session` with a `role` per track |
   | A reference track they want to sound like | `master_track` with `reference` |
4. **Pick the delivery target** from where the music is going. Default `streaming` (-14 LUFS, -1 dBTP). Use `loud`
   only for club/DJ/download use (explain that streaming services turn it back down). `podcast`, `broadcast`,
   `apple_music`, `cd`, `dynamic` exist — see `list_presets`.
5. **Verify.** The tools return before/after numbers. Check: integrated LUFS ≈ target, true peak ≤ ceiling,
   no new warnings. For a second opinion call `compare_audio` (master vs original, or mix vs reference) and look at
   `biggest_tonal_differences_a_vs_b`.
6. **Iterate surgically** with parameters rather than starting over:
   - vocal too quiet/loud → `vocal_level_db` (±1–3 dB)
   - too dry/wet → `reverb_amount`, `reverb_style` (`room` / `plate` / `hall`)
   - thin/boomy/harsh → `genre`, `tone`, or targeted `eq` on a track / `apply_effects`
   - squashed → lower loudness target or `dynamics` down; muddy highs → `warmth` down
7. **Explain what you did** in 3–6 plain sentences using the `changes` list and numbers (never dump raw JSON).
   Mention anything in `warnings` (clipping in the source, out-of-phase stereo, limiter working hard).

## Judgement rules (what a pro would do)

- Never chase loudness at the cost of punch. If the limiter's max reduction is > ~6 dB or the warnings say it works
  hard, lower the target (-14 instead of -9) and say why.
- Hard clipping and out-of-phase audio cannot be repaired by mastering — say so and ask for a better bounce.
- Do not boost frequencies the source does not contain (e.g. mp3 lowpassed at 16 kHz). The engine already guards
  this; do not override it with big manual shelf boosts.
- Prefer less processing: if `analyze_audio` shows a file is already balanced (diagnosis empty, LUFS near target) a
  light master is right. Say so instead of over-processing.
- Keep the user's original files untouched. Write outputs to a new file (default `*_mastered.wav`, `*_mix.wav`).
- Offer WAV 24-bit for further work, 16-bit (dithered) for CD, mp3/m4a for sharing.

## Reading the key numbers

- **LUFS (integrated):** perceived loudness. Streaming ≈ -14, club ≈ -8…-9, broadcast -23.
- **True peak (dBTP):** inter-sample peak. Keep ≤ -1 so lossy encoding does not clip.
- **PLR:** peak-to-loudness; < 7 dB = crushed, 9–12 dB = healthy for pop/hip-hop, > 16 dB = very dynamic.
- **Loudness range (LU):** how much the level moves through the song.
- **Stereo correlation:** +1 mono, 0 wide, < 0 phase problem. **Low-end correlation** should be near +1.
- **Tonal balance:** `tonal_balance_db_rel_total` per region (sub/bass/lowMid/mid/presence/air).
