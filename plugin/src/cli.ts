#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { analyzeFile, compareFiles, easyMix, listPresets, masterFile, mixFiles, runChain, vocalFile } from './api.js';

const HELP = `AutoMix — professional mixing & mastering engine

  automix analyze <file> [--vocal]
  automix master <in> [-o out.wav] [--preset streaming|loud|...] [--genre pop] [--reference ref.wav] [--lufs -14] [--tone 0.6] [--dynamics 0.5] [--warmth 0.3]
  automix vocal <in> [-o out.wav] [--cleanup auto|0..1] [--polish 0.5] [--control 0.6] [--voice male|female]
  automix song <vocal> <beat> [-o out.wav] [--bpm 120] [--genre hiphop] [--preset streaming] [--backing a.wav,b.wav]
  automix mix <session.json> [-o out.wav]
  automix chain <in> <chain.json> [-o out.wav]
  automix compare <a> <b>
  automix presets
`;

function parse(argv: string[]) {
  const pos: string[] = []; const f: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') f.output = argv[++i];
    else if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) f[k] = true; else { f[k] = nx; i++; } }
    else pos.push(a);
  }
  return { pos, f };
}
const num = (v: string | boolean | undefined) => (typeof v === 'string' ? Number(v) : undefined);
const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined);

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, f } = parse(rest);
  let res: unknown;
  switch (cmd) {
    case 'analyze': res = analyzeFile(pos[0], f.vocal ? 'vocal' : 'mix'); break;
    case 'master': res = masterFile({ input: pos[0], output: str(f.output), preset: str(f.preset), genre: str(f.genre), reference: str(f.reference), targetLufs: num(f.lufs), tone: num(f.tone), dynamics: num(f.dynamics), warmth: num(f.warmth), ceilingDbTp: num(f.ceiling), bit_depth: num(f.bits) as 16 | 24 | 32 | undefined }); break;
    case 'vocal': res = vocalFile({ input: pos[0], output: str(f.output), cleanup: f.cleanup === 'auto' ? 'auto' : num(f.cleanup), polish: num(f.polish), control: num(f.control), tone: num(f.tone), voice: str(f.voice) as 'male' | 'female' | undefined, target_lufs: num(f.lufs) }); break;
    case 'song': res = easyMix({ vocal: pos[0], beat: pos[1], output: str(f.output), bpm: num(f.bpm), genre: str(f.genre), preset: str(f.preset), backing_vocals: str(f.backing)?.split(','), vocal_level_db: num(f.vocal_db) }); break;
    case 'mix': { const s = JSON.parse(readFileSync(pos[0], 'utf8')); if (f.output) s.output = f.output; res = mixFiles(s); break; }
    case 'chain': res = runChain(pos[0], JSON.parse(readFileSync(pos[1], 'utf8')), str(f.output)); break;
    case 'compare': res = compareFiles(pos[0], pos[1]); break;
    case 'presets': res = listPresets(); break;
    default: console.log(HELP); return;
  }
  console.log(JSON.stringify(res, null, 2));
}
try { main(); } catch (e) { console.error(`Error: ${(e as Error).message}`); process.exit(1); }
