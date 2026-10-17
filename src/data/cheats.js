/**
 * Cheat codes. Type a code during play (letters only, any time, like the classics) or open the
 * cheat console with ` (backtick) / the CHEATS button in the pause menu. Codes never start with a
 * bound key (E F M V H K Q) because the first letter is not swallowed; later letters are. `kind: 'toggle'` codes
 * switch on and off; everything else fires once. `run(game, cheats)` returns a toast line.
 */
export const CHEATS = [
  { code: 'BIGBAG', name: 'Big bag', desc: '+$100,000 cash', run: (g) => { g.addScore(100000, null); return 'CHEAT: +$100,000'; } },
  { code: 'ARMORY', name: 'Armory', desc: 'Every weapon with full ammo', run: (g) => { g.cheats.giveAllWeapons(); return 'CHEAT: FULL ARMORY'; } },
  { code: 'PILLZ', name: 'Pillz', desc: 'Full health, 9 painkillers, heavy armour', run: (g) => { const p = g.player; p.hp = 100; p.painkillers = 9; p.giveArmor(2); p.armor = 150; return 'CHEAT: PATCHED UP'; } },
  { code: 'GODMODE', name: 'God mode', desc: 'You cannot be hurt', kind: 'toggle', key: 'god' },
  { code: 'SLOWMO', name: 'Matrix', desc: 'Bullet time never runs out', kind: 'toggle', key: 'matrix' },
  { code: 'COPSOFF', name: 'Cops off', desc: 'Clear the wanted level', run: (g) => { g.wanted.force(0); g.wanted.clear(); return 'CHEAT: HEAT CLEARED'; } },
  { code: 'ALLCOPS', name: 'Heat wave', desc: 'Four wanted heads right now', run: (g) => { g.wanted.set(4); return 'CHEAT: EVERY COP IN TOWN'; } },
  { code: 'NEVERWANTED', name: 'Never wanted', desc: 'The police ignore you', kind: 'toggle', key: 'neverwanted' },
  { code: 'BIGTANK', name: 'Big tank', desc: 'Spawn a JUGGERNAUT tank', run: (g) => g.cheats.spawnCar('tank') },
  { code: 'SUPERCAR', name: 'Fast car', desc: 'Spawn a VANTA R1 hypercar', run: (g) => g.cheats.spawnCar('hyper') },
  { code: 'GOKART', name: 'Go-kart', desc: 'Spawn a go-kart', run: (g) => g.cheats.spawnCar('kart') },
  { code: 'BIGBUS', name: 'Big bus', desc: 'Spawn a bus', run: (g) => g.cheats.spawnCar('bus') },
  { code: 'COPCAR', name: 'Cop car', desc: 'Spawn a police cruiser', run: (g) => g.cheats.spawnCar('police') },
  { code: 'AMBO', name: 'Ambo', desc: 'Spawn an ambulance', run: (g) => g.cheats.spawnCar('ambulance') },
  { code: 'IRONCLAD', name: 'Ironclad', desc: 'Spawn the BASTION armoured SUV', run: (g) => g.cheats.spawnCar('armoured') },
  { code: 'TURBO', name: 'Turbo', desc: 'Your cars go 80% faster', kind: 'toggle', key: 'turbo' },
  { code: 'SPEEDY', name: 'Speedy', desc: 'Run twice as fast', kind: 'toggle', key: 'speedy' },
  { code: 'LOWGRAV', name: 'Moonwalk', desc: 'Low gravity: huge jumps and dives', kind: 'toggle', key: 'moon' },
  { code: 'SUPERPUNCH', name: 'Super punch', desc: 'Fists and sword hit 10x', kind: 'toggle', key: 'superpunch' },
  { code: 'BIGHEAD', name: 'Big head', desc: 'Everyone has a huge head', kind: 'toggle', key: 'bighead' },
  { code: 'SWORDS', name: 'Katana', desc: 'Every gangster and cop carries a sword', kind: 'toggle', key: 'katana' },
  { code: 'BOOM', name: 'Boom', desc: 'Blow up every car within 40 m', run: (g) => g.cheats.boom() },
  { code: 'RIOT', name: 'Riot', desc: 'Everyone on the street grabs a gun and comes for you', run: (g) => g.cheats.riot() },
  { code: 'RESPECT', name: 'Respect', desc: 'Max respect with every gang', run: (g) => { for (const k of Object.keys(g.respect)) g.setRespect({ ...g.respect, [k]: 100 }); return 'CHEAT: EVERYBODY LOVES YOU'; } },
  { code: 'TURFWAR', name: 'Turf war', desc: 'Every gang hates you', run: (g) => { const r = {}; for (const k of Object.keys(g.respect)) r[k] = -100; g.setRespect(r); return 'CHEAT: EVERYBODY HATES YOU'; } },
  { code: 'LEVELUP', name: 'Level up', desc: 'Score multiplier +1', run: (g) => { g.mult += 1; return 'CHEAT: MULTIPLIER x' + g.mult; } },
  { code: 'SKIPJOB', name: 'Skip job', desc: 'Pass the current mission instantly', run: (g) => { if (!g.missions.current) return 'NO MISSION RUNNING'; g.missions.pass(); return 'CHEAT: MISSION SKIPPED'; } },
  { code: 'ALLJOBS', name: 'All jobs', desc: 'Mark every mission as done (free roam)', run: (g) => g.cheats.allJobs() },
  { code: 'JULPIE', name: 'Julpie', desc: 'Julpie comes to you. Right now.', run: (g) => g.cheats.spawnJulpie() },
  { code: 'CAMERA', name: 'Camera', desc: 'Cycle the camera preset', run: (g) => { g.cycleCamera(); return 'CAMERA: ' + g.cam.label; } },
];
export const CHEAT_BY_CODE = Object.fromEntries(CHEATS.map((c) => [c.code, c]));
export const MAX_CODE_LEN = Math.max(...CHEATS.map((c) => c.code.length));
