#!/usr/bin/env node
// Walks public/assets/** and writes public/assets/manifest.json:
//   { cars: [paths], characters: [paths], characterPacks: [{dir, priority, config, models, animations, skins}],
//     skins: [paths], sfx: { event: path | [paths] } }
// Paths are relative to public/ (e.g. "assets/cars/sedan.glb"). Run with: npm run assets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const assets = path.join(root, 'assets');

const SFX_EVENTS = ['pistol', 'uzi', 'shotgun', 'rocket', 'flame', 'explosion', 'carhit', 'thud', 'hurt', 'pickup', 'ring',
  'bt_in', 'bt_out', 'mission_pass', 'mission_fail', 'wasted', 'busted', 'cash', 'jump', 'buy', 'engine', 'siren', 'land', 'heartbeat', 'whiz', 'dryfire', 'slash', 'beep', 'throw'];
const AUDIO_EXT = ['.ogg', '.mp3', '.wav'];   // also the preference order within one event
const MODEL_EXT = ['.glb', '.gltf'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const stem = (p) => path.basename(p, path.extname(p)).toLowerCase();

/** Keep one file per base name; .glb wins over .gltf (Kenney ships both formats). */
function models(dir) {
  const byName = new Map();
  for (const f of walk(dir).sort()) {
    const ext = path.extname(f).toLowerCase();
    if (!MODEL_EXT.includes(ext)) continue;
    const k = stem(f), cur = byName.get(k);
    if (!cur || (ext === '.glb' && path.extname(cur).toLowerCase() !== '.glb')) byName.set(k, f);
  }
  return [...byName.values()].map(rel).sort();
}

const cars = models(path.join(assets, 'cars'));

// ---- character packs --------------------------------------------------------------------------
// public/assets/characters/<pack>/ is one pack (loose files directly in characters/ form one more).
// An optional pack.json (see CHARACTERS.md) sets priority, scale, forward, animations, clips, gunOffset...
// The loader uses the highest-priority pack that loads; the folder shipped by the Kenney Mini Characters
// (and any pack without a pack.json priority that is named like it) is the priority-0 fallback.
const MINI_PACK = 'kenney_mini-characters';
const charRoot = path.join(assets, 'characters');
const SKIN_SKIP = /preview|sample|icon/i;
const ANIM_FILE = /anim|^ual\d/i;                 // stems that look like an animation library
const CHARACTER_FILE = /(^|\/)character[^/]*\.(glb|gltf)$/i;   // Kenney names its rigged models character-*; props are not characters

function asList(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

function scanPack(dirAbs, name, recursive) {
  let config = null;
  const cfgFile = path.join(dirAbs, 'pack.json');
  if (fs.existsSync(cfgFile)) {
    try { config = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); }
    catch (e) { console.warn(`pack ${name}: pack.json is not valid JSON (${e.message}); ignoring it`); }
    if (config && (typeof config !== 'object' || Array.isArray(config))) { console.warn(`pack ${name}: pack.json must be an object; ignoring it`); config = null; }
  }
  const files = recursive ? walk(dirAbs) : fs.readdirSync(dirAbs, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => path.join(dirAbs, e.name));
  const modelFiles = files.filter((f) => MODEL_EXT.includes(path.extname(f).toLowerCase()));

  // animation libraries: explicit "animations" (string or list, relative to the pack folder), else files named like one
  const libs = [];
  for (const a of asList(config && config.animations)) {
    const abs = path.resolve(dirAbs, String(a));
    if (fs.existsSync(abs)) libs.push(abs);
    else console.warn(`pack ${name}: animations file "${a}" not found`);
  }
  if (!libs.length && !(config && 'animations' in config)) for (const f of modelFiles.slice().sort()) if (ANIM_FILE.test(stem(f))) libs.push(f);
  const libSet = new Set(libs.map((f) => path.resolve(f)));

  // character models: one file per base name (.glb wins over .gltf)
  const byName = new Map();
  for (const f of modelFiles.slice().sort()) {
    if (libSet.has(path.resolve(f))) continue;
    const ext = path.extname(f).toLowerCase(), k = stem(f), cur = byName.get(k);
    if (!cur || (ext === '.glb' && path.extname(cur).toLowerCase() !== '.glb')) byName.set(k, f);
  }
  let chars = [...byName.values()].map(rel).sort();
  const wanted = asList(config && config.models);
  if (wanted.length) {
    const res = wanted.map((w) => { try { return new RegExp(String(w), 'i'); } catch (e) { return new RegExp(String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } });
    chars = chars.filter((p) => res.some((re) => re.test(path.basename(p))));
  } else if (!config) {
    const named = chars.filter((p) => CHARACTER_FILE.test(p));
    chars = named.length ? named : chars.filter((p) => !ANIM_FILE.test(stem(p)));
  }

  const skinByName = new Map();
  for (const f of files.slice().sort()) {
    if (path.extname(f).toLowerCase() !== '.png' || SKIN_SKIP.test(rel(f))) continue;
    if (!skinByName.has(stem(f))) skinByName.set(stem(f), f);
  }
  const prio = config && Number.isFinite(Number(config.priority)) ? Number(config.priority) : (name === MINI_PACK ? 0 : 1);
  const libRel = libs.map(rel);
  const pack = { dir: rel(dirAbs), priority: prio, config, models: chars, animations: libRel[0] || null, skins: [...skinByName.values()].map(rel).sort() };
  if (libRel.length > 1) pack.animationsExtra = libRel.slice(1);
  return pack;
}

const packs = [];
if (fs.existsSync(charRoot)) {
  const ents = fs.readdirSync(charRoot, { withFileTypes: true }).filter((e) => !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of ents) if (e.isDirectory()) packs.push(scanPack(path.join(charRoot, e.name), e.name, true));
  if (ents.some((e) => e.isFile() && MODEL_EXT.includes(path.extname(e.name).toLowerCase()))) packs.push(scanPack(charRoot, '.', false));
}
const usablePacks = packs.filter((p) => p.models.length);
usablePacks.sort((a, b) => b.priority - a.priority || a.dir.localeCompare(b.dir));
// flat lists stay for older loaders: every pack's models / skins in priority order
const characters = usablePacks.flatMap((p) => p.models);
const skins = [...new Set(usablePacks.flatMap((p) => p.skins))];

const sfx = {};
const unknown = [];
const found = {};
for (const f of walk(path.join(assets, 'sfx')).sort()) {
  const ext = path.extname(f).toLowerCase();
  if (!AUDIO_EXT.includes(ext)) continue;
  const name = stem(f).replace(/[\s-]+/g, '_');
  if (!SFX_EVENTS.includes(name)) { unknown.push(rel(f)); continue; }
  (found[name] = found[name] || []).push(f);
}
for (const [ev, list] of Object.entries(found)) {
  list.sort((a, b) => AUDIO_EXT.indexOf(path.extname(a).toLowerCase()) - AUDIO_EXT.indexOf(path.extname(b).toLowerCase()));
  sfx[ev] = list.length === 1 ? rel(list[0]) : list.map(rel);
}

// voice lines: public/assets/voice/<id>.(ogg|mp3|wav), id = line id from `npm run voice-lines`
const voice = {};
for (const f of walk(path.join(assets, 'voice')).sort()) {
  const ext = path.extname(f).toLowerCase();
  if (!AUDIO_EXT.includes(ext)) continue;
  const id = path.basename(f, ext);
  if (!voice[id] || AUDIO_EXT.indexOf(ext) < AUDIO_EXT.indexOf(path.extname(voice[id]).toLowerCase())) voice[id] = rel(f);
}
const manifest = { cars, characters, characterPacks: usablePacks, skins, sfx, voice };
if (Object.keys(voice).length) console.log(`voice lines: ${Object.keys(voice).length}`);
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const p of usablePacks) console.log(`character pack ${p.dir.replace(/^assets\/characters\//, '')}: priority ${p.priority}, ${p.models.length} models${p.animations ? ', animations ' + p.animations : ''}${p.config ? ', pack.json' : ''}`);
console.log(`manifest written: ${cars.length} cars, ${characters.length} characters, ${skins.length} skins, ${Object.keys(sfx).length}/${SFX_EVENTS.length} sfx`);
const missing = SFX_EVENTS.filter((e) => !sfx[e]);
if (missing.length) console.log('sfx not found (procedural fallback): ' + missing.join(', '));
if (unknown.length) console.log('ignored audio files (name must match an event):\n  ' + unknown.join('\n  '));
