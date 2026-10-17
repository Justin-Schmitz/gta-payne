// Export every spoken line to voice-lines.csv / voice-lines.json for batch text-to-speech.
// Run with: npm run voice-lines   (see VOICES.md)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// city.js imports three; give it a minimal browser-ish global so the module graph loads in node.
globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => ({}) }) };
globalThis.self = globalThis.self || globalThis;
const { MISSIONS, BOSSES } = await import('../src/data/missions.js');
const { VOICES } = await import('../src/data/voices.js');
const { VOICE_LINES } = await import('../src/data/voiceLines.js');
const { JOB_LINES } = await import('../src/data/jobs.js');

const lines = [];
const add = (id, speaker, text) => lines.push({ id, speaker, voice: (VOICES[speaker] || {}).voice || '', ref: (VOICES[speaker] || {}).ref || '', text });

for (const [id, l] of Object.entries(VOICE_LINES)) add(id, l.who, l.text);
for (const [id, l] of Object.entries(JOB_LINES)) add(id, l.who, l.text); // street contacts, vehicle jobs, events, frenzies, races (src/data/jobs.js)
for (const m of [...MISSIONS].sort((a, b) => a.order - b.order)) {
  const boss = BOSSES[m.boss].name;
  if (m.source === 'page') add(`${m.id}.page`, boss, m.page || "Pick up. It's urgent.");
  add(`${m.id}.intro`, boss, m.intro);
  m.steps.forEach((s, i) => {
    if (s.message) add(`${m.id}.step${i}.message`, s.who || boss, s.message);
    (s.waves || []).forEach((w, k) => { if (w.message) add(`${m.id}.step${i}.wave${k}`, w.who || s.who || boss, w.message); });
    if (s.doneMessage) add(`${m.id}.step${i}.done`, s.doneWho || boss, s.doneMessage);
    // mini-boss / boss appearance lines (kill / ambush spawn specs, and collect items with guards), see Missions.announceMinis
    (s.spawns || []).forEach((sp, k) => { if (sp.line) add(`${m.id}.step${i}.mini${k}`, sp.name || boss, sp.line); });
    (s.items || []).forEach((it, k) => { if (it.guards && it.guards.line) add(`${m.id}.step${i}.item${k}.mini`, it.guards.name || boss, it.guards.line); });
  });
  for (const l of m.bossLines || []) add(l.id, l.who, l.text); // boss phase lines (bossScript), ids mX.bossN
  add(`${m.id}.outro`, boss, m.outro);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csvCell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const csv = ['id,speaker,file,text,voice_direction,reference_clip']
  .concat(lines.map((l) => [l.id, l.speaker, l.id + '.mp3', l.text, l.voice, l.ref].map(csvCell).join(',')))
  .join('\n') + '\n';
fs.writeFileSync(path.join(root, 'voice-lines.csv'), csv);
fs.writeFileSync(path.join(root, 'voice-lines.json'), JSON.stringify(lines, null, 2) + '\n');
const bySpeaker = {};
for (const l of lines) bySpeaker[l.speaker] = (bySpeaker[l.speaker] || 0) + 1;
console.log(`${lines.length} lines written to voice-lines.csv and voice-lines.json`);
for (const [s, n] of Object.entries(bySpeaker)) console.log(`  ${s}: ${n}`);
console.log('Drop the generated audio into public/assets/voice/<id>.mp3 and run: npm run assets');
