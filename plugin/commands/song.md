---
description: Turn a recorded vocal + a beat into a finished, mastered song
argument-hint: <vocal file> <beat file> [bpm] [genre]
---

Create a finished song from: $ARGUMENTS

Use `analyze_audio` on both files, then `mix_vocal_and_beat` (pass `bpm`/`genre` if given or if you can infer them).
Check the result with the returned numbers, and offer 1–2 concrete adjustments (vocal louder/quieter, more/less reverb)
rather than a long list. Follow the `mix-and-master` and `vocal-rescue` skills.
