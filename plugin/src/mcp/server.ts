import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { analyzeFile, compareFiles, easyMix, listPresets, masterFile, mixFiles, runChain, vocalFile, type FxStep } from '../api.js';
import { hasFfmpeg } from '../io/audio.js';

const server = new McpServer({ name: 'automix', version: '1.0.0' });

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const wrap = <T>(fn: (a: T) => unknown) => async (a: T) => {
  try { return json(fn(a)); }
  catch (e) { return { isError: true, content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] }; }
};

const bitDepth = z.union([z.literal(16), z.literal(24), z.literal(32)]).optional().describe('WAV bit depth (default 24; 16 adds TPDF dither). Ignored for mp3/flac/etc.');
const out = z.string().optional().describe('Output file path (.wav, or .flac/.mp3/.m4a with ffmpeg). Default: next to the input.');
const unit = (d: string) => z.number().min(0).max(1).optional().describe(d);
const role = z.enum(['lead_vocal', 'backing_vocal', 'beat', 'instrumental', 'drums', 'bass', 'guitar', 'keys', 'synth', 'pad', 'fx', 'other']);

server.registerTool('analyze_audio', {
  description: 'Measure an audio file like a mastering engineer: LUFS (BS.1770), true peak, loudness range, crest/PLR, clipping, noise floor, stereo width/phase, tonal balance per 1/3-octave, sibilance — and a plain-English diagnosis with fixes. Always call this first on an unfamiliar file.',
  inputSchema: { path: z.string().describe('Audio file path'), kind: z.enum(['mix', 'vocal']).optional().describe("'vocal' for a solo vocal recording (stricter noise/sibilance checks)") },
}, wrap(({ path, kind }: { path: string; kind?: 'mix' | 'vocal' }) => analyzeFile(path, kind)));

server.registerTool('master_track', {
  description: 'Professionally master a finished stereo mix: DC/subsonic cleanup → adaptive linear-phase tonal correction (genre curve or a reference track) → glue + multiband compression → warmth → bass-mono/width → iterative true-peak limiting to an exact LUFS target. Returns before/after measurements and what was changed.',
  inputSchema: {
    input: z.string(), output: out,
    preset: z.string().optional().describe('Delivery preset: streaming (default, -14 LUFS), spotify, apple_music, youtube, soundcloud, loud (-9), club, cd, broadcast, podcast, dynamic'),
    targetLufs: z.number().min(-30).max(-5).optional().describe('Override preset loudness'),
    ceilingDbTp: z.number().min(-6).max(0).optional().describe('True-peak ceiling in dBTP (default -1)'),
    genre: z.string().optional().describe('balanced, pop, hiphop, trap, edm, rock, acoustic, rnb, jazz, classical, podcast'),
    reference: z.string().optional().describe('Path to a reference track whose tonal balance should be matched'),
    tone: unit('Tonal correction strength (default 0.55; 0.8 when a reference is given)'),
    dynamics: unit('Glue/multiband compression amount (default 0.5)'),
    warmth: unit('Harmonic saturation (default 0.3)'),
    width: z.number().min(0).max(2).optional().describe('Stereo width multiplier (default: automatic)'),
    monoBassHz: z.number().min(0).max(300).optional().describe('Keep bass mono below this (default 120, 0 disables)'),
    bit_depth: bitDepth,
  },
}, wrap((a: Parameters<typeof masterFile>[0]) => masterFile(a)));

server.registerTool('process_vocal', {
  description: 'Clean up and polish a solo vocal recording (ideal for phone recordings): high-pass → automatic noise reduction → adaptive tonal balance (linear-phase) → de-ess → two-stage compression → presence/air EQ → saturation. All thresholds are derived from measurements of the take. Output is a processed dry vocal stem (no reverb) — use mix_session / mix_vocal_and_beat for the full song.',
  inputSchema: {
    input: z.string(), output: out,
    cleanup: z.union([z.literal('auto'), z.number().min(0).max(1)]).optional().describe("Noise reduction amount; 'auto' (default) decides from the measured noise floor"),
    control: unit('Compression/leveling (default 0.6)'), polish: unit('Presence, air, harmonics (default 0.5)'), tone: unit('Tonal correction toward ideal vocal balance (default 0.6)'),
    voice: z.enum(['male', 'female', 'auto']).optional(), role: z.enum(['lead', 'backing']).optional(),
    target_lufs: z.number().optional().describe('Normalise the result to this loudness'), bit_depth: bitDepth,
  },
}, wrap((a: Parameters<typeof vocalFile>[0]) => vocalFile(a)));

server.registerTool('mix_vocal_and_beat', {
  description: 'THE EASY PATH: a recorded vocal (optionally backing vocals) + a beat/instrumental in → finished, mastered song out. Auto-processes the vocal, balances levels in LUFS, ducks the beat\'s mids under the voice, adds tempo-synced delay and reverb, then masters to the delivery target.',
  inputSchema: {
    vocal: z.string(), beat: z.string(), backing_vocals: z.array(z.string()).optional(), output: out,
    bpm: z.number().min(40).max(240).optional().describe('Beat tempo for synced delay'), genre: z.string().optional(),
    preset: z.string().optional().describe('Delivery preset (default streaming)'), vocal_level_db: z.number().min(-12).max(12).optional().describe('Make the vocal louder (+) or quieter (−) than the automatic balance'),
    reverb_style: z.enum(['room', 'plate', 'hall']).optional(), reverb_amount: z.number().min(0).max(2).optional(), voice: z.enum(['male', 'female', 'auto']).optional(), bit_depth: bitDepth,
  },
}, wrap((a: Parameters<typeof easyMix>[0]) => easyMix(a)));

server.registerTool('mix_session', {
  description: 'Full multitrack mix & master. Give each stem a role; every track gets a role-specific, measurement-driven chain, loudness-based gain staging, panning, sends, vocal-keyed ducking, then the mastering chain on the bus. Use per-track gain_db/pan/reverb/delay/eq to steer details after hearing the report.',
  inputSchema: {
    tracks: z.array(z.object({
      path: z.string(), role, name: z.string().optional(), gain_db: z.number().optional(), pan: z.number().min(-1).max(1).optional(), mute: z.boolean().optional(),
      reverb: z.number().min(0).max(1.5).optional(), delay: z.number().min(0).max(1).optional(), raw: z.boolean().optional().describe('Skip automatic processing'),
      start_sec: z.number().min(0).optional(),
      eq: z.array(z.object({ type: z.enum(['lowpass', 'highpass', 'bandpass', 'peaking', 'lowshelf', 'highshelf', 'notch', 'allpass']), freq: z.number(), gainDb: z.number().optional(), q: z.number().optional() })).optional(),
    })).min(1),
    output: out, bpm: z.number().optional(), genre: z.string().optional(), vocal_level_db: z.number().optional(), duck: z.boolean().optional(),
    reverb_style: z.enum(['room', 'plate', 'hall']).optional(), reverb_amount: z.number().min(0).max(2).optional(),
    master: z.union([z.literal(false), z.object({ preset: z.string().optional(), targetLufs: z.number().optional(), ceilingDbTp: z.number().optional(), tone: z.number().optional(), dynamics: z.number().optional(), warmth: z.number().optional(), reference: z.never().optional() })]).optional(),
    vocal: z.object({ cleanup: z.union([z.literal('auto'), z.number()]).optional(), control: z.number().optional(), polish: z.number().optional(), tone: z.number().optional(), voice: z.enum(['male', 'female', 'auto']).optional() }).optional(),
    bit_depth: bitDepth,
  },
}, wrap((a: Parameters<typeof mixFiles>[0]) => mixFiles(a)));

server.registerTool('compare_audio', {
  description: 'A/B two files: loudness, true peak, dynamics, stereo width and a 1/3-octave tonal difference curve. Use it to compare a mix against a reference, or a master against its source, to decide what to adjust.',
  inputSchema: { a: z.string(), b: z.string() },
}, wrap(({ a, b }: { a: string; b: string }) => compareFiles(a, b)));

const fxStep = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gain'), db: z.number() }),
  z.object({ type: z.literal('highpass'), freq: z.number(), order: z.union([z.literal(2), z.literal(4), z.literal(6)]).optional() }),
  z.object({ type: z.literal('lowpass'), freq: z.number(), order: z.union([z.literal(2), z.literal(4), z.literal(6)]).optional() }),
  z.object({ type: z.literal('eq'), bands: z.array(z.object({ type: z.enum(['lowpass', 'highpass', 'bandpass', 'peaking', 'lowshelf', 'highshelf', 'notch', 'allpass']), freq: z.number(), gainDb: z.number().optional(), q: z.number().optional() })) }),
  z.object({ type: z.literal('compressor'), threshold_db: z.number(), ratio: z.number(), attack_ms: z.number().optional(), release_ms: z.number().optional(), knee_db: z.number().optional(), makeup_db: z.number().optional(), mix: z.number().optional() }),
  z.object({ type: z.literal('multiband'), crossovers: z.array(z.number()), bands: z.array(z.object({ threshold_db: z.number().optional(), ratio: z.number().optional(), gain_db: z.number().optional() })) }),
  z.object({ type: z.literal('limiter'), ceiling_db: z.number().optional(), gain_db: z.number().optional(), release_ms: z.number().optional() }),
  z.object({ type: z.literal('deesser'), freq: z.number().optional(), threshold_db: z.number().optional(), ratio: z.number().optional() }),
  z.object({ type: z.literal('denoise'), strength: z.number().optional(), reduction_db: z.number().optional() }),
  z.object({ type: z.literal('expander'), threshold_db: z.number(), ratio: z.number().optional(), range_db: z.number().optional() }),
  z.object({ type: z.literal('saturation'), drive_db: z.number().optional(), mode: z.enum(['tape', 'tube', 'soft', 'clip']).optional(), mix: z.number().optional() }),
  z.object({ type: z.literal('width'), width: z.number(), mono_below_hz: z.number().optional() }),
  z.object({ type: z.literal('reverb'), mix_db: z.number().optional(), rt60: z.number().optional(), pre_delay_ms: z.number().optional(), damping: z.number().optional() }),
  z.object({ type: z.literal('delay'), mix_db: z.number().optional(), time_ms: z.number(), feedback: z.number().optional(), ping_pong: z.boolean().optional() }),
]);

server.registerTool('apply_effects', {
  description: 'Manual control: run an ordered chain of studio effects (eq, compressor, multiband, limiter, de-esser, denoise, expander, saturation, width, reverb, delay, gain, filters) on one file. Use this to make targeted corrections after analyze_audio / compare_audio, e.g. one more dB of 3 kHz or a de-esser at 7 kHz.',
  inputSchema: { input: z.string(), chain: z.array(fxStep).min(1), output: out, bit_depth: bitDepth },
}, wrap(({ input, chain, output, bit_depth }: { input: string; chain: FxStep[]; output?: string; bit_depth?: number }) => runChain(input, chain, output, bit_depth)));

server.registerTool('list_presets', {
  description: 'List delivery presets (loudness/true-peak targets), genre tonal targets and track roles.',
  inputSchema: {},
}, wrap(() => ({ ...listPresets(), ffmpeg_available: hasFfmpeg() })));

await server.connect(new StdioServerTransport());
