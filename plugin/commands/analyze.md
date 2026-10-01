---
description: Diagnose an audio file like a mastering engineer (loudness, peaks, tone, stereo, noise)
argument-hint: <audio file> [--vocal]
---

Analyze: $ARGUMENTS

Call `analyze_audio` (use `kind: "vocal"` if this is a solo vocal). Summarize in plain language: loudness vs
streaming targets, peak safety, tonal balance, stereo/phase, noise, and the diagnosed problems with the recommended
fix for each. End with the single best next step (which AutoMix tool and parameters).
