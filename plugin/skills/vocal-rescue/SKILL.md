---
name: vocal-rescue
description: Use when the user has a vocal recorded on a phone/laptop/cheap mic and wants it to sound clean and professional — noise, room sound, harsh "s" sounds, uneven volume, boomy or thin tone. Uses AutoMix process_vocal and mix_vocal_and_beat.
---

# Vocal rescue

1. `analyze_audio` with `kind: "vocal"`. Typical findings and what the engine does about them automatically:
   - **noisy** (floor above -50 dBFS) → learned-profile spectral noise reduction + gentle expander
   - **sibilant** → split-band de-esser with an auto threshold
   - **muddy / thin / harsh** → adaptive linear-phase EQ toward a lead-vocal target (cuts are preferred to boosts)
   - **uneven level** → two-stage compression with thresholds derived from the take's own level distribution
2. Run `process_vocal` (dry vocal stem out). Tell the user it is intentionally dry; reverb/delay are added in the mix.
3. If they also have a beat: skip step 2 and call `mix_vocal_and_beat` directly — it processes the vocal itself.
4. Tune only if asked or if the numbers say so:
   - still noisy → `cleanup: 0.8` (more reduction; warn about "watery" artifacts above ~0.9)
   - too processed / natural sound wanted → `polish: 0.2`, `control: 0.4`
   - extra-bright or dark voice → `tone` 0.3–0.8
   - set `voice` to `male`/`female` if auto-detection picks wrong (affects high-pass and de-ess frequency)
5. Backing vocals/doubles go in as `backing_vocals` (or role `backing_vocal` in `mix_session`): they get a darker,
   flatter chain, are panned alternately and sit ~5 dB under the lead.

Be honest about limits: this engine does not do pitch correction or fix off-key notes, and cannot restore a
severely clipped or distorted take.
