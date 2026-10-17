# Julpies House

A browser game that fuses two classics' *styles*: the city is a chunky, top-down, pixel-look crime
sandbox in the spirit of the original GTA while you drive. The moment you step out of the car the
camera drops to an over-the-shoulder third-person view with bullet time and shoot-dodging in the
spirit of Max Payne. Payphone missions, bosses, a score multiplier, wanted "heads", carjacking,
pedestrians, traffic, cops and a respray shop round out the loop.

All content (city, characters, missions, dialogue) is original. The game needs no downloads: by
default every texture is generated on a canvas, every model is low-poly geometry and every sound is
synthesised with Web Audio. You can optionally drop in real CC0 art and sound (see below).

## About this project

Julpies House was built entirely by describing it in natural language to **Claude Fable 5.1**
(Anthropic's Claude Code), as a father-and-sons project about what AI-assisted creation looks like
in practice: you say what the game should feel like ("GTA 1 from above, Max Payne when you get
out of the car", "cheat codes like the old days", "make Julpie the final boss"), the AI plans the
work, writes and tests the code, and you play it and push back. Every system below was requested in
plain English, built by Fable (often delegating scoped sub-tasks to further Claude agents working
in parallel), verified in a browser, and iterated on feedback. No game engine, no asset pipeline:
plain JavaScript, three.js, and CC0 art and sound.

## Architecture overview

One page, one `<canvas>`, no framework. Roughly 13,000 lines of plain ES modules under `src/`.

```
browser
 ├─ index.html + src/style.css      HUD, menus, dialogs, touch layer (all DOM; the game is one canvas)
 ├─ src/main.js                     boot: title screen, difficulty + character pickers, frame loop
 └─ src/game.js                     Game: the hub every system hangs off (scene, entities, state,
                                    mode switching, save/load, events such as onPedDeath / explode)
      ├─ input                      input.js (keys, mouse, pointer lock), gamepad.js, ui/touch.js
      ├─ world                      world/city.js (procedural grid city + collision + lane/sidewalk
      │                             graphs + named places), world/interior.js (shop rooms),
      │                             world/assets.js (Kenney model/sound loading with fallbacks),
      │                             world/textures.js (canvas textures)
      ├─ entities                   entities/vehicle.js (arcade physics + traffic/police/chase AI),
      │                             entities/ped.js (civilians, gangs, cops, bosses; animation),
      │                             entities/player.js (health, armour, weapons, meters, perks)
      ├─ modes                      modes/driveMode.js (top-down camera + driving input),
      │                             modes/footMode.js (third-person camera, aim assist, bullet time,
      │                             shoot-dodge, jump)
      ├─ systems                    combat.js (projectiles, sword, grenades, hit zones), killcam.js,
      │                             wanted.js (heat + police response), population.js (traffic,
      │                             peds, gang turf), missions.js (campaign step runner), jobs.js
      │                             (contacts, vehicle jobs, random events), activities.js (frenzies,
      │                             races), interiors.js, cheats.js, effects.js (particles),
      │                             audio.js (file-first, synth fallback), shouts.js
      ├─ data                       pure content tables: missions, jobs, gangs, shops, dealers,
      │                             characters, difficulty, camera presets, cheats, voices
      └─ ui                         hud.js, minimap.js, map.js, shop.js, dealer.js, saves.js
server.js                           LAN host: serves dist/ + a tiny JSON save API (saves/*.json);
                                    in dev it also launches Vite and proxies /api to itself
scripts/                            scan-assets.js (builds public/assets/manifest.json),
                                    voice-lines.js (exports every spoken line for TTS)
wrangler.jsonc                      Cloudflare Workers static deploy of dist/ (no save API there yet)
```

How a frame flows: `main.js` calls `game.frame()`; the gamepad is polled, then `game.update(raw)`
scales time (bullet time slows the world to 0.2 while your aim stays real-time), runs the active
mode, then vehicles, peds, combat, effects, wanted, population, missions, jobs, activities,
pickups, phones, markers, camera and HUD, in that order. Entering a car swaps `footMode` for
`driveMode` with a camera swoop; walking into a shop swaps the collision world for an interior room
and pauses the city.

Design rules that kept it maintainable: all tuning lives in `src/data/*` and `difficulty.js`
multipliers; only one objective owner runs at a time (`game.isBusy()`); every spoken line goes
through `game.say(id, text, who)` so voices can be dropped in later; every asset has a procedural
fallback so the game runs with an empty `public/assets/`.

## Run it

```bash
npm install
npm run dev
```

`npm run dev` runs `node server.js --dev`: the vite dev server on port 4141 (listening on all
interfaces) **and** the save API on port 4142 (vite proxies `/api` to it). Ctrl-C stops both. Open the
printed URL; it also lists the network address for iPads on the same Wi-Fi (`npm run lan` is an alias).

`npm run serve` builds and then serves `dist/` plus the save API from one port (4141) with
`node server.js --port 4141`; use that for a stable LAN session. `npm run build` alone just produces a
static bundle in `dist/` (the game then runs, but named saves need `server.js`).
Flags: `--port <n>`, `--api-port <n>` (dev only), `--host <addr>`, `--saves <dir>`.

### Named saves (shared on the LAN)

* Pause menu: **SAVE GAME** (type a name; an existing name asks before overwriting) and **LOAD GAME**.
  The title screen has **LOAD GAME** too. Saves store score, multiplier, finished missions, weapons and
  ammo (the dual-pistols flag too), painkillers, health, armour, respect (if present), stolen car types, the cars you bought at a dealer (type, colour, position, health) and your position. Loading puts you on
  foot at the saved spot with the heat off and no mission running.
* Saves are plain JSON files in the `saves/` folder next to `server.js` (git-ignored), one per name
  (`saves/<name-as-slug>.json`). The list is **shared by everyone on the LAN**: anybody connecting to
  the same server sees, loads, overwrites and deletes the same saves.
* If the dialog says the save server is not reachable you opened the game with plain `vite`; start it
  with `npm run dev` or `npm run serve` instead.
* **CONTINUE** still uses the per-browser autosave in `localStorage`.
* API: `GET /api/health`, `GET /api/saves`, `GET|PUT|DELETE /api/saves/:name`.

## Real art and sound (optional)

Everything below is optional and falls back to the built-in procedural look and sound when a file
is missing (the console logs one line: `assets: N cars, N characters, N sfx`).

| Pack | License | Link |
| ---- | ------- | ---- |
| Kenney Car Kit (glTF/GLB) | CC0 | https://kenney.nl/assets/car-kit |
| Kenney Blocky Characters (rigged glTF, 27 animations, 18 skins) | CC0 | https://kenney.nl/assets/blocky-characters |
| The Free Firearm Sound Library (`.ogg`, 194 MB 7z) | CC0 | https://opengameart.org/content/the-free-firearm-sound-library |
| Kenney Impact Sounds (crashes, thuds) | CC0 | https://kenney.nl/assets/impact-sounds |

Cars are matched by exact Kenney file name (`sedan`, `sedan-sports`, `race`, `race-future`, `delivery`,
`delivery-flat`, `suv`, `suv-luxury`, `ambulance`, `firetruck`, `garbage-truck`, `tractor`, `kart-*`, ...);
wheel, debris, cone and box files are never used as vehicles, and the bus and the tank stay procedural.
1. Unzip the Car Kit into `public/assets/cars/` and the Kenney characters (models and the PNG skins)
   into `public/assets/characters/<pack>/`. Subfolders are fine; `.glb` is preferred over `.gltf`.
   Every folder under `characters/` is a **character pack**; the pack with the highest `priority`
   in its optional `pack.json` that loads wins (the Kenney Mini Characters are the priority-0
   fallback, and the procedural box people sit below that). Smoother rigs (Quaternius, Mixamo) plug in
   the same way: see **[CHARACTERS.md](CHARACTERS.md)** for the folder layout, the `pack.json`
   format (clip names, animation library, forward axis, per-pack gun offset) and two recipes.
   Whatever the pack, characters are normalised to 1.75 m, carry the weapon in the right hand bone
   (dual pistols: one per hand) and tilt the spine up/down to follow the aim.
2. Copy the sounds you want into `public/assets/sfx/` and rename each file to its event name
   (`.ogg`, `.mp3` or `.wav`; if one event has several formats the first that decodes is used):

   | Event file name | Used for |
   | --- | --- |
   | `pistol` `uzi` `shotgun` `rocket` | weapon shots |
   | `flame` | flamethrower (loops while firing) |
   | `explosion` `carhit` `thud` `hurt` | blasts, crashes, run-overs, damage |
   | `jump` `land` | jumping and landing |
   | `pickup` `cash` `buy` `ring` | pickups, money, shop purchases, payphone |
   | `bt_in` `bt_out` | bullet time on / off |
   | `heartbeat` | bullet-time heartbeat (loops while active) |
   | `whiz` `dryfire` | enemy bullet past your head, empty-gun / refused bullet-time click |
   | `mission_pass` `mission_fail` `wasted` `busted` | stingers |
   | `engine` `siren` | loops (engine pitch follows speed) |

3. Run `npm run assets` (writes `public/assets/manifest.json`, which is git-ignored and lists what
   it found and which events are still missing), then reload the page. Re-run it whenever you add or
   rename files.

## Controls

| On foot (third person)          | Driving (top down)        |
| ------------------------------- | ------------------------- |
| Mouse: aim (click once to lock) | W / S: gas / brake        |
| WASD: move                      | A / D: steer              |
| LMB: fire                       | Space: handbrake          |
| V: camera (close / medium / high & wide) |
| Shift: toggle bullet time       | E or F: get out           |
| Space: jump (can fire in air)   |                           |
| Shift+Space: bullet-time jump   |                           |
| RMB / double-tap WASD: shoot-dodge (dive, prone) |          |
| K: aim assist off / normal / strong |                       |
| 1–9 / wheel / Q: weapons        |                           |
| H: painkiller (heal 35 / 1.2 s) |                           |
| E: enter car / answer phone     |                           |
| M: full-screen map              | M: full-screen map        |
| Esc: pause                      | Esc: pause                |

### iPad / touch

Touch devices get an on-screen layout automatically (no keyboard needed):

* **On foot:** drag anywhere on the left half for a floating joystick, drag on the right half to
  look. Buttons for FIRE (hold), JUMP, DODGE, BULLET TIME, WEAPON, PILLS (painkiller) and USE (enter car / answer phone).
  JUMP while bullet time is on is the bullet-time jump. Aim assist defaults to STRONG on touch.
* **Driving:** ◀ ▶ steer, GAS, BRAKE (reverse when stopped), HANDBRAKE, GET OUT.
* **MAP** (top-left, under the score) or a tap on the minimap opens the full-screen map.
* The ⏸ button at the top pauses. Hold the iPad in landscape. Add the page to the Home Screen
  for a full-screen, no-browser-chrome experience.

To play over Wi-Fi run `npm run lan` and open `http://<this machine's IP>:4141` on each iPad.

## Playable characters

NEW GAME asks who you are: **Woke-Wendy** (bullet time refills 50% faster, 3 painkillers),
**Beefcake** (25% less damage, double-strength fists, 50 armour, and he is big), **Mike Hunt**
(+25% cash from everything, $2,000 to start) or **Seymour Butts** (runs 15% faster, guns and cars
15% cheaper). Defined in [src/data/characters.js](src/data/characters.js); saves remember the pick.

## Hit zones and armour

Bullets check where they land: head shots do 2.6× damage to enemies (2× to you), legs 0.7×, body 1×.
Head shots on enemies pay a small bonus and a little bullet time. The gun shops sell an **ARMOR VEST**
(100 points) and **HEAVY ARMOR + HELMET** (150 points, absorbs more per hit, and head shots on you
only do 1.3×). Armour is visible on your character (vest; vest, shoulder pads and helmet for heavy)
and disappears when it runs out. Health, armour and the current car's condition are shown as bars at
the top centre of the screen.

## Gamepad

Any standard-layout controller (Xbox, PlayStation, Switch Pro) over Bluetooth or USB works: press
a button once and the game switches to it (keyboard and mouse keep working alongside).

| On foot | Driving |
| --- | --- |
| Left stick move, right stick look | Left stick steer |
| RT fire, LT bullet time (hold) | RT gas, LT brake / reverse |
| A jump, B shoot-dodge (in the stick direction) | A handbrake, X get out |
| X use (cars, phones, shops), Y painkiller | RT fires the tank cannon |
| LB / RB previous / next weapon | |
| D-pad: up camera, down map, left aim assist, right bullet time | |
| Start pause, Back quick-save, RS click aim assist | |

Menus and dialogs are still mouse / touch.

## Cheat codes

Type a code during play (just the letters, any time, like the old days) or press **`** (backtick) or
the CHEATS button in the pause menu for a console that lists every code, works by touch, and shows
which toggles are on. Toggles persist until switched off; the pause menu shows CHEATS USED once
you have used one. Codes: BIGBAG (+$100k), ARMORY (all weapons), PILLZ (health, pills, heavy armour),
GODMODE, SLOWMO (endless bullet time), COPSOFF, ALLCOPS, NEVERWANTED, BIGTANK, SUPERCAR, GOKART,
BIGBUS, COPCAR, AMBO, IRONCLAD, TURBO, SPEEDY, LOWGRAV, SUPERPUNCH, BIGHEAD, SWORDS, BOOM, RIOT,
RESPECT, TURFWAR, LEVELUP, SKIPJOB, ALLJOBS, JULPIE, CAMERA. Defined in
[src/data/cheats.js](src/data/cheats.js).

## Difficulty

Pick **EASY / NORMAL / HARD** on the title screen before NEW GAME; a save remembers its own setting
and the pause menu shows it. Everything is tuned from one table in
[src/data/difficulty.js](src/data/difficulty.js): enemy aim, damage, health and fire rate, enemy
counts in kill missions, police response and heat decay, bullet-time drain/regen, shop prices,
mission payouts, car damage, gang hostility threshold, mission timers, starting ammo. Hard also
costs 10% of your cash when you get wasted or busted, and pays 25% more per mission.

## Voices

Every briefing and pager line can be voiced with your own TTS files: see [VOICES.md](VOICES.md)
(`npm run voice-lines` exports the script).

## How it plays

* Payphones ring in the zone of whichever boss has work for you. Walk up and press **E**.
* Missions chain objectives (see **Campaign** below). Each pays `reward × multiplier`; the
  multiplier rises with every mission. Reach **$1,000,000** to own the city.
* Crimes raise your wanted level (the heads top-right). Cops arrive by car and on foot. At one head
  they try to grab you (**BUSTED**); from two heads up they shoot. Lose them or drive through
  **Harlow Respray** in the centre of the map.
* Getting **WASTED** sends you to the hospital, getting busted to the precinct. Either fails the
  current mission and strips your weapons. Progress (score, multiplier, missions done) is saved in
  `localStorage`.
* **Weapons** (slots 1–9): fists, **samurai sword** (2), pistol, **dual pistols**, machine gun, shotgun, **flamethrower** (hold LMB, 9 m cone,
  sets pedestrians on fire for 3 s and burns cars; ammo is "fuel"), rocket launcher, **sticky stick grenades** (9). The dual pistols
  (`weapons.dual`, from the shop's SECOND PISTOL or a pickup) fire left / right alternately at twice the
  pistol rate with more spread and share the pistol's ammo.
* **Samurai sword** (slot 2, no ammo, shop $3,000 + one pickup in Eastside): LMB swings (0.45 s, left / right alternating,
  hold to keep slashing). The hit test is instantaneous at 40% of the swing: every ped within 2.2 m and a 110 degree arc
  takes 120 (a 70 hp ped dies, bodies are flung along the swing, 45% lose their head), vehicles take 15 and spark. The swing
  runs on player time, so it slows in bullet time; a slash kill in bullet time refills +0.2 of the meter, and standing still with
  the sword in bullet time deflects 35% of enemy bullets that come from the front (60 degrees). Some Hollow Crows carry
  swords: they charge to melee range and swing for 26 (the hit lands at 40% of their swing, so it can be dodged).
* **Sticky stick grenades** (slot 9, 6 at the start of a pack, shop $900 for 3, cap 30, 10% of dead enemies drop 2, two
  pickups): FIRE (one throw per click / tap) lobs one in an arc (16 m/s minimum, more for far targets so it lands on the
  crosshair, +0.25 up, gravity 22). It clings to the first ped (who panics and runs), vehicle or wall it touches and rides
  along, beeps at 1.1 s and 1.6 s and explodes 2.0 s after the throw (radius 6, 140 dmg, +120 on a car it is stuck to).
  Enemies can carry spare grenades (`Ped` option `grenades: n`) or use `weapon: 'grenade'` / `'sword'`.
* **Painkillers** replace instant health: pickups (the old health crosses) and the shop sell bottles
  (max 9). **H** (touch: PILLS) heals 35 hp over 1.2 s; the HUD shows a bottle with the count next to the
  health bar. Respawning and the ambulance still restore full health.
* **Gun shops** — HARLOW ARMS (block 8,2) and PAWN & AMMO (block 1,6) — sell
  weapons, ammo packs, armor and painkillers for your in-game cash (your score). Stand at the door, press
  **E** (touch: the USE button reads SHOP). The world pauses while the shop is open; Esc or CLOSE leaves.
  Prices: pistol $400 (+20 ammo $100), second pistol $600, machine gun $2,500 (+50 $300), shotgun $1,800 (+16 $250),
  flamethrower $4,000 (+50 fuel $400), rocket launcher $9,000 (+1 rocket $600), armor $1,000, painkillers $150 (+1).
* **Car dealers** — HARLOW MOTORS (block 6,4, downtown) and IRONCLAD DEPOT (block 3,9, the docks) — sell
  vehicles for your in-game cash (prices scale with difficulty like the gun shops). Stand at the door,
  press **E** (touch: USE reads DEALER); Esc, CLOSE or a tap outside leaves. A bought car is delivered to
  the first free one of three bays in the road in front of the lot (anything parked there is moved
  aside), is **yours** (never despawned) and is saved with the game (named saves and CONTINUE). Types marked
  *shop only* are never seen in traffic. The ambulance heals you to 100 when you get in. The garbage truck
  does triple ram damage. The **armoured SUV** takes only 15% of bullet damage. The **tank** is immune to
  bullets, takes no damage from collisions and deals ten times the usual damage to the car it hits; its cannon
  (LMB, or the touch FIRE button that appears in the tank) shoots a rocket from the barrel along the hull
  heading, once every 1.5 s.

| type | name | class | model | top mph | hp | price | shop only | dealer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `compact` | MINNOW | COMPACT | hatchback-sports | 58 | 90 | $3,500 |  | Harlow |
| `sedan` | STALLARD | SEDAN | sedan | 72 | 110 | $6,000 |  | Harlow |
| `coupe` | MERIDIAN | COUPE | sedan-sports | 83 | 100 | $14,000 |  | Harlow |
| `sports` | VIPER GT | SPORTS | race | 98 | 90 | $30,000 |  | Harlow |
| `hyper` | VANTA R1 | HYPERCAR | race-future | 130 | 80 | $120,000 | yes | Harlow |
| `taxi` | TAXI | TAXI | taxi | 67 | 110 | $5,000 |  | Harlow |
| `van` | BOXER VAN | VAN | van | 60 | 160 | $8,000 |  | Harlow |
| `pickup` | HAULER | PICKUP | truck | 63 | 170 | $9,000 |  | Harlow |
| `suv` | TRAILBOSS | SUV | suv | 69 | 150 | $16,000 |  | Harlow |
| `limo` | CINELLI LIMO | LIMO | suv-luxury | 76 | 160 | $40,000 |  | Harlow |
| `boxtruck` | PARCEL HAULER | BOX TRUCK | delivery | 56 | 220 | $11,000 |  | Ironclad |
| `flatbed` | LONGBED | FLATBED | delivery-flat | 58 | 200 | $12,000 |  | Ironclad |
| `bus` | HARLOW TRANSIT | BUS | none (box) | 49 | 320 | $25,000 |  | Ironclad |
| `police` | HPD CRUISER | POLICE | police | 85 | 130 | $18,000 |  | Ironclad |
| `ambulance` | HARLOW EMS | AMBULANCE | ambulance | 74 | 200 | $15,000 | yes | Ironclad |
| `firetruck` | ENGINE 9 | FIRE TRUCK | firetruck | 54 | 500 | $45,000 | yes | Ironclad |
| `garbage` | DUMPSTER KING | GARBAGE | garbage-truck | 47 | 450 | $30,000 | yes | Ironclad |
| `tractor` | FIELD MULE | TRACTOR | tractor | 25 | 120 | $4,000 | yes | Ironclad |
| `kart` | SPRITE KART | GO-KART | kart-oobi/oodi/ooli/oopi/oozi (random) | 67 | 40 | $2,500 | yes | Ironclad |
| `armoured` | BASTION | ARMOURED | suv-luxury (black) | 74 | 700 | $60,000 | yes | Ironclad |
| `tank` | JUGGERNAUT | TANK | none (always procedural) | 36 | 3000 | $250,000 | yes | Ironclad |

* **Bullet time** (Shift): the world runs at 0.2 and you at 0.5 (aim stays real-time); the FOV tightens
  from 55 to 47, a film-grain overlay and sepia come on and a heartbeat plays. The hourglass meter drains
  in 9 s (x difficulty), refills in ~22 s (x difficulty), and jumps +15% per kill (+30% for a kill during a
  dodge). With less than 10% left it is refused with a dry click.
* **Shoot-dodge** (RMB / DODGE): a 0.8 s floaty dive (~6 m) that starts bullet time for free (while airborne
  and for 1.5 s after landing), with free look while airborne. You stay prone until you press a move key
  (camera drops to ~0.9 m, shoulder offset shrinks); bullet time ends on get-up unless Shift is held.
  Diving into someone (< 1.5 m) knocks them down for 1.5 s. Enemy bullets are real projectiles you can
  see and sidestep; every bullet leaves a fading 0.25 s trail and a near miss whizzes past your head.
  **Double-tap** W/A/S/D (two presses within 0.25 s) dives in that direction relative to the camera.
* **Bullet-time jump** (Shift+Space; touch: JUMP while bullet time is on): a 1.6 m jump (normal jump 1.28 m)
  that switches bullet time on for the air time at no meter cost and off again on landing unless Shift is
  held. Airborne in bullet time (jump or dive) the camera rolls up to 6 degrees toward your sideways movement
  and the FOV widens 3 degrees. A kill while airborne shows **AIR KILL** and pays $100.
* **Aim assist** (K cycles OFF / NORMAL / STRONG, saved in `localStorage['port-harlow-aim']`; default NORMAL,
  STRONG on touch): a soft lock on the hostile (cops with heat or angry, alerted / mission / hostile-turf
  gangsters, bosses and mini-bosses; never civilians) whose chest is closest to the crosshair, within 40 m,
  in line of sight. NORMAL: 4 degree cone, shots bend 70% of the way to the chest, look sensitivity x0.65
  while locked. STRONG: 8 degrees, 100%, x0.5. Bullet time widens the cone x1.5. A locked shot never ends
  more than 0.3 m from the chest (weapon spread aside). Applies to every gun, rockets and grenade throws, not
  the sword. Crosshair: white idle, red and tighter on a locked target, grey when a wall within 3 m in front
  would take the shot.
* **Kill-cam**: when you fire a lethal shot at the only living hostile within 45 m (and within 32 m, with a
  clear path, at most once per 8 s) the camera follows the bullet from 1.2 m behind at world speed 0.12,
  holds 0.7 s on the falling body and eases back over 0.4 s (hard limit 3 s; input ignored meanwhile).
* Enemies strafe for 0.6 s when a bullet passes within 1 m, 25% of gang members hop sideways when you
  shoot at them from more than 8 m, and they shout (floating text, max 3 on screen).

## Side jobs, events, frenzies and races

Everything below pays cash (scaled by the difficulty's payout) and only one objective runs at a time:
no payphone rings and nothing else starts while a campaign mission, a job or an activity is active.
Dying, getting busted or loading a save cancels the running job and cleans up its cars and people.
Data and dialogue live in [src/data/jobs.js](src/data/jobs.js), logic in `src/systems/jobs.js` and
`src/systems/activities.js`. Progress (`jobsDone`, `frenzies`, `raceBest`) is part of the save.

* **Street contacts** — five named people stand on the sidewalk with a spinning **!** (also on the map).
  Walk up and press **E** (touch: USE). First completion pays in full, repeats 40%:
  **Sal Bruno** (cabbie, $4,000: ram the thief out of his stolen taxi and bring it back),
  **Pete Okafor** (dockworker, $5,000: haul a crate across town before the timer),
  **Lenny Vasco** (witness, $7,000: drive him to the courthouse with the cops on you),
  **Dani Reyes** (street racer, $6,000: beat his Viper to the finish) and
  **Greta Holm** (pawn shop, $4,500: scare three hoods off her shop front).
* **Vehicle jobs** — climb into a **taxi**, **police car** or **ambulance** and the prompt reads
  `E — START ...`; press the use key again within 5 s (touch: the GET OUT button relabels). **Taxi fares**:
  pick up a waving passenger, deliver before the timer, up to five in a row. **Vigilante**: chase and wreck
  marked gang cars within 90 s each (five in a row). **Paramedic**: reach an injured person lying on the
  sidewalk and rush them to Harlow General (five in a row). Leaving the vehicle ends the job.
* **Random street events** — every 2–4 minutes of free roaming (no job, no heat): a **drive-by**
  (survive 45 s or wreck the car), a **mugging** (bring the mugger down) or a stranger who pays you to
  **lose a tail**. Each lasts at most 60 s and drops quietly if you walk 80 m away.
* **Kill frenzies** — six skulls around town. Step on one, get a weapon and kill N people before time runs
  out. Each pays once.
* **Races** — three checkered flags (Downtown Dash, Dockside Sprint, North Shore Run). Drive through the
  start ring in any vehicle, hit every checkpoint before the par time. Best times are saved.

## Minimap and full-screen map

The round minimap draws every place as an outlined glyph at constant size: yellow **P** square =
payphone (pulsing ring while it rings; ringing phones and the objective stick to the rim when off
the map), orange **$** = gun shop, cyan car badge = car dealer, magenta spray can = respray, white
square with a red cross = hospital, blue shield = police HQ, pulsing yellow ring = mission
objective, green **!** = street contact, red **X** = frenzy, chequered square = race, lime diamond =
vehicle job (contacts, frenzies, races and jobs come from `game.jobs.markers()` /
`game.activities.markers()` when those exist). Cops are blue dots, police cars blue bars, gang
members dots in their gang colour, you are the white arrow.

Press **M**, click the minimap (when the pointer is free, e.g. while driving) or tap it / the touch
**MAP** button to open the full map (`src/ui/map.js`): the whole city with place names, gang
territory tints and names, a legend of every icon, and the current objective. The world is paused
while it is open (`game.state = 'map'`, pointer lock released, touch layer hidden). **Esc**, **M**,
**CLOSE** or a click on the dark backdrop closes it and resumes. Drag to pan, wheel or **+ / -** to
zoom, **ME** zooms to your position, **ALL** shows the whole city again.

## Shops and showrooms (interiors)

Press **E** at the door of a gun shop (HARLOW ARMS, PAWN & AMMO) or a car dealer (HARLOW MOTORS,
IRONCLAD DEPOT) and the screen fades to black (0.3 s) and you walk into a real room. Gun shops have a
counter, a weapon rack, shelves and a keeper; showrooms have three of the dealer's cars slowly
turning on podiums (real car models when the Kenney pack is installed) with price placards, and a
keeper at the desk. At the counter or desk **E - BROWSE** opens the usual shop / dealer dialog (a
bought car is still delivered to the bays outside); at the door **E - LEAVE** fades back to the street.

* Third-person controls, aiming and bullet time all work inside. If you hit or kill the keeper the
  shop shows **CLOSED** for 60 s (the keeper is back on your next visit).
* The city is frozen while you are inside: no traffic, pedestrians, heat, mission / job / race
  timers or phone rings advance, and the siren / engine sound is silenced. The minimap shows a flat
  room outline instead of the city. Saving inside stores the street door as your position.
* Code: `src/systems/interiors.js` (`game.interiors`: enter / exit / fade / keeper / closed timer),
  `src/world/interior.js` (room builder and `RoomCollision`, same methods as `City`), and
  `game.world` which returns the current collision provider (room or city). Rooms are built at a far
  offset (3000, 3000) inside the main scene, so bullets, particles and the camera need no changes.

## Campaign

Fourteen jobs for three bosses (`src/data/missions.js`), played in the order of each mission's `order`
field. Eleven come through the ringing payphone; three are **paged**: after a minute of free roaming
(no job, no heat) the boss's pager goes off ("Pick up. It's urgent.") and the mission starts at
once. The phones stay quiet while a paged job is due. Failing any mission removes every car and
gunman it spawned; a paged job comes round again after another minute.

| order | id | boss | job | steps |
| --- | --- | --- | --- | --- |
| 1 | m1 | Cinelli | Taxi Driver: Tony to Pier 9 with Crows cars ramming you | steal, goto, goto + chasers |
| 2 | m2 | Cinelli | Scrap Run: stolen sports car to the crusher, Crows ambush | steal, goto, ambush, goto |
| 3 | m3 | Cinelli | Bad Debt: Fisk (mini-boss) and his boys, then his son flees by car | goto, kill, destroy |
| 4 | m11 | Cinelli (page) | Four Cases: 4-stop collection run, guards, 3 minutes; Sal Twice (mini-boss) minds the last case | collect |
| 5 | m4 | Cinelli | Hot Delivery: the cops made the van, 2 heads and a timer | steal, goto (wanted + timer), bombEscape |
| 6 | m5 | Crows | Payback: bar wipe-out with Knuckles (mini-boss), then a 3-head heat with Cinelli cars on your tail | goto, kill, loseWanted + chasers |
| 7 | m6 | Crows | Tail Lights: wreck the courier while two sedans ram you | destroy + chasers |
| 8 | m12 | Crows (page) | Pink Slip: six-gate race in a stolen Viper at 2 heads | steal, race |
| 9 | m7 | Crows | Clean Slate: lose the heat at the respray | steal, loseWanted, goto |
| 10 | m8 | Mal | The Witness: the limo is a decoy, the witness is in the van | destroy, destroy |
| 11 | m13 | Mal | Collection Plate: escort the donations truck through three Cinelli waves, then The Deacon (mini-boss) waits at the Mission | goto, escort, ambush |
| 12 | m9 | Mal | Bank Job: hold the bank against gang waves, then a 4-head getaway | goto, goto, defend, goto |
| 13 | m14 | Mal (page) | Burn Notice: flamethrower vs three parked Cinelli trucks on a clock, then Foreman Brick (mini-boss) and the night shift | goto, destroyAll, ambush |
| 14 | m10 | Mal | Last Rites (finale): Marco in an armoured SUV, then on foot (mini-boss) with his crew, then **Julpie's House**: assault the gate, fight through the courtyard (Jeeves the Butler, mini-boss), round the side to the back garden and finish **Julpie** (boss) | goto, destroy + chasers, kill, goto, ambush, kill, goto, kill (boss) |

Step types (all accept `text`, `timeLimit`, `failText`, `wanted`, `heat`, `message`, `doneMessage`, `give`/`select`
weapons, and `chasers: {n, vehicle, gang, after, duration}` for gang cars that ram you): `steal`, `goto`
(`inVehicle: 'mission' | 'any'`), `kill`, `ambush`, `destroy`, `destroyAll`, `escort`, `collect`, `race`,
`defend`, `loseWanted`, `bombEscape`. Enemy counts scale with difficulty, rewards with `diff.reward`.

### Julpie's House, mini-bosses and the boss bar

The game is named after the kingpin behind all three bosses. **Julpie's House** is a walled mansion in block (9,0), the
north-east corner (map POI `house`, label "JULPIE'S HOUSE", pink house icon in the legend; `city.locations.house` is the gate,
`MANSION` in `src/world/city.js` holds the key points): 2.5 m garden walls (collision boxes) with a gate gap in the south wall,
a front courtyard with fountain and hedges, the two-storey house, 5 m side passages and a walled back garden (pool, loungers,
statues) under a balcony ("roof terrace"; the fight happens in the garden, no vertical traversal).

* **Mini-bosses** (`miniBoss: true` on a `kill` / `ambush` spawn spec, or on a `collect` item's `guards`): named peds with 280-420 hp,
  a signature weapon, a model `scale` and `tint`, and a `line` said a moment after they appear (voice id `mX.stepN.miniK`,
  `mX.stepN.itemK.mini` for collect guards). Killing one by hand pays **$5,000 x multiplier** ("NAME DOWN") and always drops
  its weapon. Fisk (m3, uzi), Knuckles (m5, shotgun), Sal Twice (m11, shotgun), The Deacon (m13, shotgun), Foreman Brick (m14, uzi),
  Marco Cinelli (m10, shotgun), Jeeves the Butler (m10, shotgun).
* **Julpie** (`boss: true`, 900 hp, dual pistols, grenades, pink guards): throws a telegraphed grenade (red ring on the ground,
  1.7 s fuse, 55 dmg, 5 m) whenever he has a clear throw; at **60 % hp** he calls 4 guards (inside the walls); at **30 %** he swaps
  to the sword (shotgun when no sword exists) and charges. `bossScript` / `grenades` / `bounds: 'mansion'` on a step drive this
  (see `Missions.tickBoss`); phase lines are voiced as `m10.boss1` / `m10.boss2` (exported through the mission's `bossLines`).
* **Boss bar**: a wide red striped bar under the top bars shows the name and hp of the nearest living boss / mini-boss within
  60 m (`game.syncBossBar`, `hud.setBoss(name, frac, kind)`, `hud.setBoss(null)` hides it).

## Gangs, territories and respect

The map is split into three turfs (see `src/data/gangs.js`, also tinted on the minimap): the
**Cinelli Family** (gold, Downtown), the **Hollow Crows** (purple, Eastside) and the **Mercy Street
Saints** (red, Westside). Crossing into one shows an "ENTERING ... TURF" toast, and while you are
inside, about six armed members of that gang stroll the sidewalks in pairs.

* **Respect** is tracked per gang from -100 to 100 and shown as three bars (gang colour, centred
  zero; striped when negative). It is saved with your progress.
* Killing a gang member costs 8 respect with that gang and gives 3 with the other two. Passing a
  boss's job gives 25 with that boss's gang and costs 15 with every gang whose men you killed
  during the job.
* Below -25 a gang's street members attack on sight (30 m, line of sight). Above 25 they ignore
  gunfire. In between they leave you alone unless you shoot at them, shoot very close to them, or
  kill one of their crew within sight (witnesses turn hostile at once).

## Code map

```
src/
  main.js               bootstrap, title/pause buttons, frame loop
  game.js               Game: scene, entities, mode switching, events, HUD sync
  input.js              keyboard / mouse / pointer lock (with a raw-delta fallback)
  world/city.js         grid city generator, collision grid, lane graph, sidewalk graph, locations
  world/textures.js     canvas-generated textures
  world/assets.js       optional glTF cars / character packs loader (retargets animation libraries, hand guns, spine aim; falls back to procedural)
  entities/vehicle.js   arcade car physics, traffic / police / route / follow AI, collisions
  entities/ped.js       blocky humanoids: civilians, gang members, cops, bosses
  entities/player.js    health, armour, weapons, bullet-time hourglass, painkillers
  modes/driveMode.js    GTA-style straight-down camera and driving input
  modes/footMode.js     Max Payne-style camera, aim, movement, bullet time, shoot-dodge
  systems/combat.js     weapons table, projectiles with tracers + fading trails, whiz / near-miss checks, melee
  systems/killcam.js    Max Payne kill-cam (bullet-following camera, 0.12 time scale)
  systems/shouts.js     floating enemy shouts (pooled sprites)
  systems/wanted.js     heat / wanted heads, police spawning
  systems/population.js traffic and pedestrian streaming, parked cars
  systems/missions.js   objective-step runner
  systems/jobs.js       street contacts, taxi / vigilante / paramedic jobs, random street events
  systems/activities.js kill frenzies and time-trial races
  data/jobs.js          contacts, landmarks, frenzies, races and their spoken lines
  data/missions.js      bosses, mini-bosses, Julpie and the fourteen missions
  systems/effects.js    instanced particles, decals, flash lights
  systems/audio.js      synthesised sound, or sfx files when present
scripts/scan-assets.js  `npm run assets`: builds public/assets/manifest.json (cars, `characterPacks`, skins, sfx, voice)
  ui/hud.js             DOM overlay
  systems/interiors.js  walk-in gun shops / showrooms: fade, pause of the city, keeper, CLOSED timer
  world/interior.js     room builder + RoomCollision (same API as City) for those interiors
  ui/dealer.js          car dealer dialog (state 'dealer'), same look as the gun shop
  data/dealers.js       what each dealer sells (from VEHICLE_TYPES), quote / buy / delivery bays
  ui/minimap.js         round minimap + shared icon set
  ui/map.js             full-screen map overlay (M)
```
