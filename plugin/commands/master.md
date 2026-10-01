---
description: Master a finished mix to streaming loudness (or another target) with true-peak limiting
argument-hint: <audio file> [preset: streaming|loud|club|cd|podcast|...] [reference file]
---

Master the audio file given in: $ARGUMENTS

Follow the `mix-and-master` skill: run `analyze_audio` first, then `master_track` (use a delivery preset if the user
named one, `streaming` otherwise; pass `reference` if a second file was given). Verify the result against the
target, then explain the changes and the before/after numbers in plain language. Do not overwrite the original.
