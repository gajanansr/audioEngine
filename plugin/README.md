# AutoMix — a mixing & mastering engineer for Claude

AutoMix is a Claude plugin (MCP server + skills + slash commands) that does **real offline mixing and mastering on
real audio files**. It is not a preset tool: every decision — noise reduction strength, compressor thresholds,
EQ moves, de-ess threshold, level balance, limiter drive — is derived from measurements of your audio, and every
result is verified against the numbers streaming platforms care about.

> For people who just want a decent, release-ready result without learning a DAW: *"Claude, master this"*,
> *"mix my vocal over this beat"*, *"why does my mix sound muddy?"*

## Install

```
/plugin marketplace add gajanansr/audioengine
/plugin install automix@automix
```

No build step: the server ships as a single bundled file (`server/automix-mcp.mjs`, Node ≥ 20).
**WAV** works out of the box. **mp3 / flac / m4a / ogg** need [`ffmpeg`](https://ffmpeg.org) on the PATH.

## What you can ask for

| Say | Tool | What happens |
|---|---|---|
| `/automix:analyze song.wav` | `analyze_audio` | LUFS, true peak, PLR, loudness range, clipping, noise floor, stereo/phase, tonal balance, plain-English diagnosis |
| `/automix:master song.wav loud` | `master_track` | Tone → dynamics → colour → stereo → true-peak limiting to an exact LUFS target |
| `/automix:vocal take.m4a` | `process_vocal` | Phone-vocal rescue: noise, tone, de-ess, compression, presence/air |
| `/automix:song vocal.wav beat.mp3 120` | `mix_vocal_and_beat` | Vocal + beat (+ backing vocals) → finished, mastered song |
| "mix these 8 stems" | `mix_session` | Full multitrack mix by role (drums, bass, guitars, keys, vocals…) |
| "sound like this reference" | `master_track` + `reference` | Linear-phase tonal match to the reference |
| "is my master better than the original?" | `compare_audio` | A/B loudness, dynamics, width and 1/3-octave tonal difference |
| "add 2 dB at 3 kHz, de-ess at 7 kHz" | `apply_effects` | Manual chain: EQ, compressor, multiband, limiter, de-esser, denoise, expander, saturation, width, reverb, delay |

## How it works (the engine)

**Measurement** — ITU-R BS.1770-4 / EBU R128 loudness (K-weighting derived from the standard's analog prototype,
verified: 997 Hz @ −23 dBFS = −23.0 LUFS at 44.1/48/96 kHz), gated integrated / short-term / momentary / LRA,
4× oversampled true peak, Welch third-octave spectrum, stereo correlation (and low-end correlation), noise floor,
sibilance, clipping and DC detection, and a rule-based diagnosis.

**Vocal chain** — 24 dB/oct high-pass (voice-type aware) → spectral noise reduction with an auto-learned noise
profile (confidence-weighted so continuous singing isn't over-processed) → downward expander → *linear-phase*
tonal correction toward a lead-vocal target (cuts preferred to boosts, hard limits, never boosts frequencies the
source doesn't contain) → split-band de-esser with auto threshold → leveling + peak-control compression with
thresholds taken from the performance's own level percentiles → presence/air EQ → oversampled parallel saturation.

**Mix** — per-role chains, loudness-based gain staging in LU relative to the lead (beat +1, bass −1, guitars −3,
keys −4, backing vocals −5…), constant-power panning with alternating backing/guitar placement, **vocal-keyed
mid-band ducking** (250 Hz–5 kHz only, ~2.5 dB, so bass and air don't pump), FDN reverb send (high/low-passed
return) and tempo-synced ping-pong delay.

**Master** — DC + subsonic cleanup → linear-phase tonal correction toward a genre curve or a reference track →
glue compression with program-dependent release → multiband control only on bands that are actually uneven →
oversampled tape saturation → bass-mono + width → peak shaver → look-ahead **true-peak limiter** (sliding-min +
moving-average gain, 4× inter-sample detection) iterated until the integrated loudness lands on the target.
16-bit export is TPDF-dithered.

**Delivery presets** — `streaming` (−14 LUFS / −1 dBTP), `spotify`, `apple_music` (−16), `youtube`, `soundcloud`,
`loud` (−9), `club` (−8), `cd` (−11), `broadcast` (−23), `podcast` (−16), `dynamic` (−18).

## What it does *not* do (yet)

- No pitch correction / auto-tune, and no restoration of heavily clipped or distorted recordings.
- Genre and vocal tonal targets are curated heuristics, not machine-learned; use `reference` for your own taste.
- Offline only (no real-time plugin host). Speed (measured in a small cloud container): mastering ≈ 9× real time (a 4-minute track in ~27 s); a full vocal + beat mix ≈ 3× real time. Memory peaks around 700 MB for a 4-minute stereo file.

## CLI

The same engine is available without Claude:

```
node server/automix-cli.mjs analyze song.wav
node server/automix-cli.mjs master song.wav --preset streaming --genre hiphop
node server/automix-cli.mjs song vocal.wav beat.mp3 --bpm 140 --genre trap -o final.wav
node server/automix-cli.mjs mix session.json
```

## Develop

```
cd plugin && npm install
npm test              # DSP, loudness-standard, quality and end-to-end tests
npm run build         # typecheck + rebuild server/*.mjs (commit the bundles)
```
