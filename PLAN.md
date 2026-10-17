# Port Harlow — Round 2 plan

Six scoped tasks, each with owner files and acceptance criteria. Shared rules for every task:

* Existing files are changed with targeted edits only (never rewritten wholesale). Re-read a file
  immediately before editing it; other tasks edit the same files concurrently.
* `npm run build` must pass when the task is done. No new npm dependencies.
* Keyboard/mouse and touch (iPad) paths must both keep working. New UI must be usable by touch
  (big buttons, no hover-only behaviour, no keyboard-only flows).
* Coordinate helpers live in `src/world/city.js` (`curb`, `park`, `center`, `blockMin`, …).
  Forward vector of a yaw is `(sin yaw, cos yaw)`, right is `(-cos yaw, sin yaw)`.
* No real-world brand or trademark names (GTA, Max Payne, Rockstar, Ammu-Nation…).

---

## T1 — Real art assets (Kenney) + real sound files, with fallbacks

Owner files: `src/world/assets.js` (new), `scripts/scan-assets.js` (new), `src/entities/vehicle.js`
(`buildMesh` and damage visuals), `src/entities/ped.js` (`buildMesh`, `updateMesh` animation only),
`src/systems/audio.js`, `package.json` (`assets` script), `src/game.js` (await asset preload in
`start`, title shows "LOADING"), `README.md` (asset section).

Asset drop folders (user downloads and unzips here; file names are NOT known in advance):

* `public/assets/cars/` — Kenney Car Kit (CC0) glTF/GLB models.
* `public/assets/characters/` — Kenney Blocky Characters (CC0): glTF/GLB rigged models with
  animations plus PNG skins.
* `public/assets/sfx/` — audio files named by event (see list below), `.ogg`, `.mp3` or `.wav`.

Design:

1. `npm run assets` runs `scripts/scan-assets.js`: walks `public/assets/**` and writes
   `public/assets/manifest.json` `{ cars: [paths], characters: [paths], skins: [paths], sfx: {event: path} }`.
   The game fetches the manifest at start (missing manifest ⇒ all fallbacks, no error).
2. `assets.js`: `loadAssets()` returns a promise; uses `GLTFLoader` from `three/examples/jsm`.
   Cars: map vehicle type → candidate file-name regexes (`compact: /hatchback|sedan(?!-sports)/`,
   `sedan: /^sedan\.|sedan\b/`, `sports: /race|sports/`, `taxi: /taxi/`, `van: /^van|delivery/`,
   `pickup: /truck/`, `limo: /suv-luxury|limo|sedan/`, `bus: /delivery|truck-flat|bus/`,
   `police: /police/`). A loaded model is normalised: centred on XZ, bottom at y=0, facing +z
   (Kenney cars face +x or −z; detect by bounding-box aspect and rotate so the long axis is z), then
   scaled so its length equals `type.len`. Cache the normalised template; each vehicle clones it.
   Body colour tinting: find the largest material (by triangle count) and set its colour to the
   vehicle colour; keep a reference as `vehicle.bodyMat` so the respray and damage code keep working.
   Characters: load the first rigged model; collect `animations`; pick clips by regex
   (`idle`, `walk`, `run`, `jump`, `shoot|gun|aim|pistol|rifle`, `death|die|fall`), fallback to
   first clip. Skins: match by regex for kinds (`police|cop` → cop, `suit|business|zombie…`).
   Template is normalised to 1.75 m tall, feet at y=0, facing +z. Each ped clones with
   `SkeletonUtils.clone` and gets its own `AnimationMixer`.
3. `vehicle.js buildMesh`: if `ASSETS.car(type)` exists use it (plus the existing shadow plane and
   police light bar/taxi sign attached at the right heights), else the current box model.
   Damage visual for all models: as `hp/maxHp` drops below 0.6 tint `bodyMat` darker (lerp toward
   #2a2a2a), below 0.35 keep the existing smoke.
4. `ped.js buildMesh/updateMesh`: if a character template exists, use it with the mixer: play
   `walk`/`run` scaled by speed, `idle` when still, `shoot` (upper body, if available) while
   `aim`, `death` once when dead (else fall over as today). Keep the existing fields other code
   relies on: `this.mesh`, `this.yOffset`, `this.tilt`, `this.gun` (may be a dummy Object3D),
   `this.aim`, `this.speed`, `this.walkPhase`. Fallback stays the current box character.
5. `audio.js`: on `init`, decode every manifest sfx file into AudioBuffers. Each existing method
   (`gunshot(kind)`, `explosion`, `carHit`, `thud`, `hurt`, `pickup`, `ring`, `btIn`, `btOut`,
   `missionPass`, `missionFail`, `wasted`, `busted`, `cash`, plus new `jump`, `flame` (loop while
   firing), `buy`) first plays the file if present (with `playbackRate = this.pitch`, volume by
   distance), else the synthesised version. Loops `engine`, `siren`, `flame` use buffer sources
   with `loop = true` when files exist, else the oscillators. Event names for files:
   `pistol, uzi, shotgun, rocket, flame, explosion, carhit, thud, hurt, pickup, ring, bt_in,
   bt_out, mission_pass, mission_fail, wasted, busted, cash, jump, buy, engine, siren, land`.
6. README: exact download links, where to unzip, `npm run assets`, the sfx naming table, and
   suggested CC0 sources (Kenney Car Kit, Kenney Blocky Characters, The Free Firearm Sound
   Library on OpenGameArt, Kenney Impact Sounds for crashes/explosions).

Acceptance: with no assets present the game looks and sounds exactly as before and logs one
info line "assets: 0 cars, 0 characters, 0 sfx (procedural fallback)". With a fake manifest
pointing to a small test GLB generated by the task itself (write one with `GLTFExporter` in a
node script or hand-craft a minimal box GLB) the car renders scaled to the right length and tints
to the vehicle colour. `npm run build` passes.

## T2 — Named saves shared on the LAN

Owner files: `server.js` (new, Node ≥18, no deps), `vite.config.js` (new), `package.json` scripts,
`src/ui/saves.js` (new), `src/main.js`, `index.html` (title + pause panel buttons, save dialog),
`src/style.css` (dialog styles), `src/game.js` (`getSaveState()` / `applySaveState()` /
`loadFromServer`).

Design:

1. `server.js`: HTTP server. `--dev` flag spawns `vite --host 0.0.0.0 --port 5173` as a child
   process and runs the API on 8787; without the flag it serves `dist/` statically (SPA fallback)
   on `--port` (default 4173) and the API on the same port. API (JSON):
   `GET /api/saves` → `[{name, time, score, mult, missions}]` sorted newest first;
   `GET /api/saves/:name`; `PUT /api/saves/:name` body = state; `DELETE /api/saves/:name`.
   Files stored as `saves/<slug>.json` (slug = lowercase, `[^a-z0-9-]` → `-`, max 40 chars);
   original name kept inside the JSON. Also `GET /api/health`.
2. `vite.config.js`: `server.proxy['/api'] = 'http://localhost:8787'`, `server.host = true`.
3. Scripts: `dev` → `node server.js --dev`, `lan` → same, `serve` → `vite build && node server.js
   --port 4173`, keep `build`, `preview`.
4. State: `getSaveState()` returns `{version:1, name, time, score, mult, done, respect, weapons,
   weaponId, hp, armor, pos:{x,z}, stolenTypes}` (respect only if `game.respect` exists).
   `applySaveState(s)` restores all of it on a running game (player on foot at `pos`, wanted
   cleared, missions idle). localStorage autosave keeps working as "CONTINUE".
5. UI (`saves.js`): a modal `#saves-dialog` usable by mouse and touch. From the title: **LOAD
   GAME** lists server saves (name, score, missions done, date) with LOAD and DELETE (confirm).
   From the pause menu: **SAVE GAME** (text input for the name, defaults to last used name,
   overwrite needs confirm) and **LOAD GAME**. Shows a clear message when the API is unreachable
   (e.g. opened via plain `vite` without the server). Escape/close returns to the previous panel.
   Saving also shows a HUD toast "SAVED: name".

Acceptance: `npm run dev` starts both processes; saving from the pause menu creates
`saves/<slug>.json`; the title's LOAD GAME lists it and loading restores score, multiplier,
missions done, weapons and position; two browsers see the same list. `npm run serve` works
from `dist/`. `npm run build` passes.

## T3 — Minimap, bounty strip, vehicle health HUD

Owner files: `src/ui/minimap.js` (new), `src/ui/hud.js`, `index.html` (HUD markup), `src/style.css`,
`src/game.js` (create/update minimap, sync vehicle HP).

Design:

1. Minimap: 190×190 canvas, top-right (touch layout: same corner, 150×150). North up, fixed, no
   rotation. Static layer pre-rendered once at start into an offscreen canvas covering the whole
   city at 2 px/m: water, asphalt, blocks (dark grey), parks (green), buildings (lighter grey
   boxes), special places coloured — hospital white/red, police blue, respray yellow, gun shops
   orange (read `city.locations.gunShops` if present), gang territories tinted from
   `src/data/gangs.js` (`GANGS[g].blocks` ranges, `GANGS[g].color`, alpha 0.18). Per frame: draw
   the static layer windowed on the player (0.55 px/m ⇒ ~345 m across), then markers: phones
   (grey, ringing ones pulse yellow), mission marker (yellow ring), cops (blue dots) and police
   cars (blue), gang members (their gang colour, small), the player (white triangle pointing the
   way they face; when driving, the car's yaw). Circular mask with a 2 px border. A tiny "N".
2. Bounty strip under the minimap: the four wanted heads (move the existing `#wanted` element
   here) with the label BOUNTY and, when wanted > 0, the text `LEVEL n`. Keep `hud.setWanted`
   API unchanged.
3. Vehicle health: while driving, show a bar under the weapon line labelled with the vehicle name
   (`v.type.name`) and `hp/maxHp`, green→yellow→red. Hide on foot. `hud.setVehicle(name, frac)`.
4. Mode tag/timer positions must not overlap the minimap (timer moves under the bounty strip).
   Respect bars (T6) will go under the bounty strip: leave a `#respect` container there.

Acceptance: map shows roads/blocks, the player marker moves and turns correctly (verify north is
−z: driving "up" on screen moves the marker up), ringing phones are visible from across the map,
cops appear when wanted, the vehicle bar appears/disappears on enter/exit and drops when crashing.
No overlap with the pager, score or touch buttons at 1024×700 and 1440×900. Build passes.

## T4 — Jump + shoot-dodge rework

Owner files: `src/modes/footMode.js`, `src/entities/player.js`, `src/entities/ped.js` (movement,
`y`, `resolve` only), `src/world/city.js` (ground-height query), `src/systems/combat.js` (hit
height uses the player's `y`), `src/ui/touch.js` + `index.html` (JUMP button; DODGE stays),
`README.md` controls table.

Design:

1. Real elevation for peds: `ped.y` (feet height) with `vy` and gravity 22 m/s². Ground height at
   (x,z) = `city.groundHeight(x,z)`: the max `h` of static boxes containing the point with
   `h ≤ 2.6` (crates, low walls), else 0. `resolve()` ignores boxes whose `h ≤ this.y + 0.05`
   (so you can stand on them) — buildings are tall so nothing changes for them. Landing plays a
   small dust puff.
2. **Jump** = Space on foot (and a touch JUMP button, left of FIRE): `vy = 7.5` when grounded;
   one jump at a time; can fire in the air. Shoot-dodge moves off Space: RMB and the touch
   DODGE button only.
3. **Shoot-dodge rework** (Max-Payne feel): dive in the movement direction (or forward),
   distance ≈ 5 m over 0.7 s with a real arc (`vy` ≈ 4.5, horizontal 7 m/s decaying), body tilted
   forward in flight, lands prone. Bullet time auto-engages for the dive (free, as now). Prone
   lasts until the player presses any move key or 0.9 s passes, then a 0.3 s get-up. While prone the
   hit-box top is 0.7 m (enemy aim already targets 0.5 m); enemy spread ×2.4 while diving stays.
   Firing works throughout; the aim pitch is unchanged. Cannot start another dodge until fully up.
   Camera: during the dive the follow damping is tightened (no visible lag) and the pivot tracks
   the body height. Add a short "whoosh" (`audio.noise`) on launch and a thud on landing.
4. Touch: JUMP button added; DODGE kept. Keyboard help on the title updated.

Acceptance: Space jumps ~1.3 m and the player can land on a courtyard crate and stand there;
RMB dives ~5 m, lands prone, pressing W gets up immediately; dodging into a wall stops cleanly;
no way to clip through buildings; bullets still hit a standing player; build passes.

## T5 — Classic weapon set, flamethrower, gun shops with in-game cash

Owner files: `src/systems/combat.js`, `src/entities/player.js` (weapons/ammo/purchase only),
`src/data/shops.js` (new), `src/ui/shop.js` (new), `src/world/city.js` (two gun-shop buildings,
`locations.gunShops`), `src/game.js` (interact hook, `state === 'shop'` pause), `index.html` +
`src/style.css` (shop dialog), `src/entities/ped.js` (burning status only), `README.md`.

Design:

1. Weapons (slots 1–6): `fist`, `pistol`, `uzi` (MACHINE GUN), `shotgun`, `flame` (FLAMETHROWER),
   `rocket`. Flamethrower: hold to fire, rate 0.05, range 9 m, cone 0.35 rad; each tick spawns
   orange/yellow fire particles along the cone and applies 5 dmg to every ped in the cone and
   3 to vehicles; peds hit get `burning = 3` s: they take 12 dmg/s, panic-run, and emit fire
   particles; death by fire is a kill for the owner. Ammo 100 "fuel". Audio: `audio.flame`
   loop while firing (T1 adds the method; call it guarded: `audio.flame && audio.flame(on)`).
2. Shops: two buildings in `city.js` — "HARLOW ARMS" at block (8,2) and "PAWN & AMMO" at
   block (1,6) — with a sign and a door point on the sidewalk (`locations.gunShops =
   [{name, x, z}]`). Standing within 2.5 m on foot shows the prompt "E — SHOP" (touch USE
   button shows SHOP) and `game.interact()` opens the shop.
3. Shop UI (`shop.js`): modal list, mouse + touch. Rows: PISTOL $400 / ammo 20 $100;
   MACHINE GUN $2,500 / 50 $300; SHOTGUN $1,800 / 16 $250; FLAMETHROWER $4,000 / 50 fuel $400;
   ROCKET LAUNCHER $9,000 / 1 rocket $600; ARMOR $1,000; HEALTH $250. Buying a weapon you own
   just adds its ammo pack. Price is deducted from `game.score` (cash); row disabled when you
   can't afford it. Shows cash at the top. Game pauses while open (`state = 'shop'`, pointer
   lock released, Esc/CLOSE resumes and re-locks). Purchases play `audio.buy` if present else
   `audio.cash`.
4. HUD weapon line shows FUEL for the flamethrower.

Acceptance: walking to a shop door and pressing E opens the shop, buying a machine gun deducts
$2,500 and selects it, buying with insufficient cash is impossible, flamethrower visibly burns a
pedestrian who then dies after ~3 s and counts as a kill, cars catch damage; build passes.

## T6 — Gangs, territories, respect

Owner files: `src/data/gangs.js` (already written: territories, colours, names), `src/systems/population.js`
(gang member streaming), `src/entities/ped.js` (`updateAI` hostility rule only), `src/game.js`
(`respect` state, `onPedDeath` hook, territory toast), `src/systems/missions.js` (respect on
pass), `src/ui/hud.js` + `index.html` + `src/style.css` (respect bars in `#respect`), `README.md`.

Design:

1. `game.respect = { cinelli: 0, crows: 0, mal: 0 }` (−100..100). Killing a gang member: −8 with
   that gang, +3 with the other two. Passing a boss's mission: +25 with that boss's gang, −15 with
   a gang whose members were killed during the mission (track `missions.killedGangs`).
2. Population keeps ~6 members of the owning gang near the player while inside that gang's
   territory (`gangAt(bx,bz)` from `gangs.js`), walking the sidewalks in twos, armed
   (pistol/uzi), coloured by gang. They despawn like civilians. `ped.kind === 'gang'`,
   `ped.turf = true` so missions ignore them.
3. Hostility (`updateAI`): a turf gang member is hostile when `respect[gang] < -25` (alerted
   on LOS within 30 m), or when attacked. With respect ≥ 25 they never react to nearby gunfire
   (`game.noise` skips them). Mission targets keep the current behaviour.
4. HUD: three thin bars under the bounty strip, gang colour, centred zero, label with the gang
   name; toast "ENTERING <zone> — <gang> TURF" when crossing into a territory (debounced 8 s).
5. Saves/loads: expose `respect` on `game`; T2 reads it if present.

Acceptance: walking into Eastside spawns purple-clad Hollow Crows on the sidewalks; shooting
three of them drops Crows respect below −25 and the rest start shooting back; respect bars move;
Westside members ignore you; the toast fires once per crossing. Build passes.

---

# Round 3

Same shared rules as above. Extra rules for this round:

* Verification servers: start your own `vite --port 419x` (x = your task number) and stop it.
  **Never** use ports 4141/4142 (the user's own server) or 4199.
* `game.diff` (src/data/difficulty.js) scales rewards (`reward`) and enemy counts (`enemyCount`);
  use it for anything you add that pays or spawns enemies.
* Voice lines: any new spoken text must go through `game.say(id, text, who)` with a stable id
  (see VOICES.md). Mission data lines get ids automatically from `scripts/voice-lines.js`; if you
  add a new data file with spoken lines, extend that script.
* Only one objective owner at a time: campaign missions (`game.missions.current`), vehicle jobs /
  street jobs (`game.jobs.current`) and activities (`game.activities.current`) must check
  `game.isBusy()` before starting and must leave the HUD objective/timer clean when they end.
  `game.isBusy()` is implemented by T9 (returns true if any of the three is active); until it
  exists, guard with `(game.isBusy ? game.isBusy() : false)`.

## T7 — Full-screen map, legend, clearer minimap icons

Owner files: `src/ui/minimap.js`, `src/ui/map.js` (new), `index.html` (map overlay markup, touch MAP
button), `src/style.css`, `src/game.js` (M key / click handling, `state === 'map'` pause),
`src/ui/touch.js` (nothing unless needed), `README.md`.

1. Minimap icons: replace the plain dots with outlined glyphs drawn at constant screen size with a
   dark outline so they read against any ground: payphone = yellow handset square with `P`
   (ringing = pulsing ring), gun shop = orange `$` badge, car dealer (`city.locations.dealers`, if
   present) = cyan car badge, respray = magenta spray-can circle, hospital = white square with red
   cross, police = blue shield, mission marker = yellow pulsing ring, street contact / job markers
   from `game.jobs && game.jobs.markers()` and `game.activities && game.activities.markers()`
   (each `{x, z, kind: 'contact'|'frenzy'|'race'|'job'}`; read defensively), cops = blue dots,
   gang members = gang colour dots, player = white arrow. Keep per-frame cost low.
2. Full-screen map (`map.js`): opens on **M**, on clicking/tapping the minimap, or the touch
   **MAP** button (top-left under the score, `data-key="KeyM" data-tap="1"`). The game pauses
   (`state = 'map'`, pointer lock released, touch layer hidden). Shows the whole city static layer
   scaled to fit with the same markers at larger size plus labels for named places, the gang
   territory tints with their names, a **legend** panel (every icon with its meaning), the current
   objective text, and a close button. Esc/M/click outside closes and resumes (re-lock pointer).
   Pinch/scroll zoom is not required; a simple +/− zoom with drag-to-pan is a bonus if cheap.
3. The legend and overlay must work with mouse and touch and fit 1024×700 and 1440×900.

Acceptance: pressing M shows the full map with legend and the player arrow at the right place;
the minimap shows distinct icons for phone/gun shop/dealer/respray/hospital/police; opening the
map pauses the world (vehicles stop moving) and closing resumes cleanly in both modes; build passes.

## T8 — Car dealerships and a big vehicle catalogue (with shop-only exotics)

Owner files: `src/entities/vehicle.js` (`VEHICLE_TYPES`, tank model/cannon, armour), `src/world/assets.js`
(car regex map for new types), `src/data/dealers.js` (new), `src/ui/dealer.js` (new, same look as
`src/ui/shop.js`), `src/world/city.js` (two dealer lots + delivery bays, `locations.dealers`),
`src/game.js` (interact hook, `state === 'dealer'`, owned-vehicle save/restore via
`getSaveState/applySaveState`), `index.html` + `src/style.css` (dealer dialog), `src/modes/driveMode.js`
(tank cannon fire on LMB / touch FIRE while driving a tank), `README.md`.

1. Vehicle types (Kenney Car Kit model in brackets; stats are yours to balance, keep the box
   fallback working for every type): compact [hatchback-sports], sedan [sedan], coupe
   [sedan-sports], sports [race], hyper [race-future] (fastest, $120k), taxi [taxi], van [van],
   boxtruck [delivery], flatbed [delivery-flat], pickup [truck], suv [suv], limo [suv-luxury],
   bus [none → box], police [police], ambulance [ambulance] (entering it heals the player to 100,
   $15k), firetruck [firetruck] ($45k, hp 500, mass 5), garbage [garbage-truck] ($30k, hp 450,
   mass 5, ramming does ×3 damage to others), tractor [tractor] ($4k, slow, silly), kart
   [kart-oobi/oodi/ooli/oopi/oozi, random] ($2.5k, tiny, quick, hp 40), **armoured** (black
   suv-luxury, hp 700, bullets do ×0.15, $60k), **tank** (procedural model: hull box, turret, long
   barrel; hp 3000, mass 12, max 16 m/s, immune to bullets, collisions deal ×10 damage to the other
   car and none to the tank, cannon = rocket projectile from the barrel on LMB / touch FIRE with a
   1.5 s cooldown and a muzzle flash, $250k). Shop-only types (`shopOnly: true`): hyper,
   ambulance, firetruck, garbage, tractor, kart, armoured, tank. Traffic may also use coupe, suv,
   boxtruck, flatbed.
2. Dealers: **HARLOW MOTORS** at a free block near downtown (check `SPECIAL` in city.js, e.g.
   (6,4)) selling civilian types, and **IRONCLAD DEPOT** in the industrial south (e.g. (9,5) or
   another free block) selling the heavy/exotic ones. Each has a lot with a showroom building, a
   sign, a door point on the curb (`locations.dealers = [{name, x, z, bays:[{x,z,yaw}]}]`) and
   3 delivery bays (road parking spots along the block edge).
3. Dealer dialog: rows with name, class, top speed, toughness (hp), price (scaled by
   `game.diff.prices`), BUY. Buying deducts cash and spawns the car (`owned = true`, never
   despawned by population, enterable) in the first free bay (push other cars aside if all are
   taken). Toast + `audio.buy`. Pauses like the gun shop (`state = 'dealer'`, Esc closes).
4. Owned cars persist: `getSaveState` stores `[{type, color, x, z, yaw, hp}]` for owned,
   non-wrecked cars; `applySaveState` removes old owned cars and respawns the saved ones.
5. HUD vehicle line shows the class name for new types; `audio.gunshot('rocket')` for the cannon.

Acceptance: both dealers appear on the map (via `locations.dealers`), walking to a door shows
`E — DEALER`, buying a kart with enough cash spawns it in a bay and deducts the price, the tank
drives, fires on click, shrugs off pistol fire and wrecks a sedan on contact, the armoured SUV
survives a machine-gun clip, owned cars survive a save/load; build passes.

## T9 — Campaign overhaul: new objective types, twists, better writing

Owner files: `src/systems/missions.js`, `src/data/missions.js`, `src/game.js` (`isBusy()` helper
only), `README.md` mission section, `scripts/voice-lines.js` only if ids change.

1. New step types in the runner (all with `text`, optional `timeLimit`, optional `failText`):
   * `ambush { spawns, radius }` — spawn already-alerted enemies around the player's current
     position (or `at`); done when all dead.
   * `chasers { n, vehicle, gang, duration? }` as an option on `goto`/`steal` steps — spawn gang
     cars with a new vehicle controller `'chase'` (seek and ram the player's vehicle, driver bails
     and fights when wrecked); cleared when the step completes.
   * `escort { vehicle, route, speed, waves:[{after, n, vehicle, gang}] }` — protect a route
     vehicle; attackers use `'chase'` against the escorted car; fail if it is wrecked, done at
     route end. Reuse `setRoute`/`routeEnd`.
   * `collect { items:[pos], guards? }` — briefcase pickups (spinning marker) collectable on foot
     or by car; each pickup can spawn `guards` alerted enemies; done when all collected.
   * `race { checkpoints:[pos], timeLimit, inVehicle:'any' }` — pass checkpoints in order (marker
     moves to the next); fail on timer.
   * `destroyAll { vehicles:[{type, at, color}] }` — wreck every listed parked vehicle.
   * `defend { at, duration, waves:[{after, n, gang, weapon}] }` — like survive but with gang
     waves spawning at the edge of the radius.
   * `wanted` and `heat` options on any step keep working.
2. Rewrite `MISSIONS` to 14 missions across the three bosses with real twists and sharper
   dialogue (keep the original ids m1–m10 in order so saves stay valid; new ones are m11–m14
   appended, but order the *play* order by a `order` field so new missions can sit between old
   ones). Suggested beats: taxi run with Crows cars ramming you; crusher ambush; the debtor Fisk
   fleeing by car after his boys fall; the hot van with a wanted level and a timer; a 4-stop
   collection run with guards and a 3-minute clock; the bar wipe-out followed by losing a 3-head
   heat; courier with two ramming escorts; a checkpoint race through downtown in a stolen race
   car at 2 heads; the respray job; the courthouse convoy; escorting Mal's "donations" truck
   through three Cinelli waves; the bank job with gang waves + a 4-head escape; a flamethrower
   job burning three parked Cinelli trucks at the scrapyard against the clock; the finale with
   Marco first in an armoured SUV (type `armoured` if T8 landed, else `limo` with hp 700), then on
   foot with his crew, then a 4-head escape to Pier 9. Reward × multiplier × `diff.reward`.
3. Boss-page interruptions: once per mission chain, a boss can page the player while they are
   free-roaming (not busy, ≥ 60 s since the last mission): the pager shows the call and the
   mission starts immediately without a phone ("Pick up. It's urgent."). Mark such missions
   `source: 'page'` in data; the phone chain skips them.

Acceptance: every new step type is exercised by at least one mission; a scripted headless run
drives through m1 and one new-type mission by teleporting (as the earlier tests did) without
errors; failing and retrying a mission leaves no stray vehicles/peds; build passes.

## T10 — Jobs beyond the phone: street contacts, vehicle jobs, random events, frenzies, races

Owner files: `src/systems/jobs.js` (new), `src/systems/activities.js` (new), `src/data/jobs.js`
(new), `src/game.js` (create + update + interact hooks, `isBusy()` reads `jobs`/`activities`),
`src/entities/vehicle.js` (none; use existing controllers; if you need a new one coordinate by
naming it `'flee'` and keep it ≤ 30 lines), `index.html`/`src/style.css` (nothing new unless a
small job banner is needed), `README.md`.

1. **Street contacts** (`jobs.js`): 5 named characters standing at fixed spots with an
   exclamation marker above their head (map kind `'contact'`), each offering a short one-off job
   with its own dialogue (`game.say`), e.g. a cabbie whose taxi was stolen (chase + return it), a
   dockworker wanting a crate delivered before a timer, a nervous witness who needs a ride to the
   courthouse with cops on your tail, a street racer challenging you (race against an AI car on a
   route, win = arrive first), a shopkeeper asking you to scare off three gang members. Walk up,
   press E. Each pays once; repeatable at lower pay afterwards.
2. **Vehicle jobs**: entering a **taxi** offers TAXI FARES (press the use key again within 5 s to
   accept, prompt shown): pick up a fare on a sidewalk, deliver to a marker before the timer, pay
   per fare, chain up to 5; entering a **police** car offers VIGILANTE: chase and wreck a marked
   gang car (chase controller target) within 90 s, chain; entering an **ambulance** offers
   PARAMEDIC: pick up an injured ped (spawned lying down) and bring it to the hospital. Leaving
   the vehicle ends the job (fail text). Rewards scale with `diff.reward`.
3. **Random street events** every 2–4 minutes of free roam (not busy): a ped runs up shouting a
   line (gang drive-by ambush spawning a chase car, a mugging to stop for a reward, a stranger
   paying you to lose a tail). Keep to three event types, each ≤ 60 s, cancellable by walking
   away 80 m.
4. **Activities** (`activities.js`): 6 **Kill Frenzy** skull pickups (weapon given, N kills in
   T s, reward; once each, saved in `game.save.frenzies`) and 3 **time-trial race** flags
   (checkpoint course, target time, best time saved). Markers via `activities.markers()`.
5. Everything must save: extend `getSaveState/applySaveState` minimally with `jobsDone`,
   `frenzies`, `raceBest` (read/write defensively).

Acceptance: a contact's job can be started and completed by teleporting through it headless;
taxi fare job starts on entering a taxi and pays on delivery; a frenzy counts kills and pays;
nothing starts while a campaign mission is active; build passes.

---

# Round 4 — Max Payne focus

Same shared rules and Round-3 rules (own test ports 419x, never 4141/4142/4199). The game's
identity is now: **on foot it must feel like Max Payne 1**. Everything in T12 serves that.

## T11 — Save discoverability + loot drops (done by the lead)

F5 quick-saves to the server as "Quicksave" (and the autosave), SAVE GAME button on the full-screen
map, a one-time hint toast; killed enemies drop their weapon (temporary pickup, 30 s) and sometimes
cash.

## T12 — Bullet time, shoot-dodge and gunplay overhaul

Owner files: `src/modes/footMode.js`, `src/entities/player.js`, `src/systems/combat.js`,
`src/systems/effects.js`, `src/game.js` (time scale, kill-cam camera override, painkiller key),
`src/ui/hud.js` + `index.html` + `src/style.css` (hourglass meter, painkiller count, grain overlay),
`src/systems/audio.js` (heartbeat loop, whiz, dry-fire), `src/data/shops.js` (painkillers item),
`src/entities/ped.js` (enemy reactions only: strafe/dive when shot at, see 6), `README.md`.

1. **Time**: bullet time slows the world to 0.2 (was 0.28) while the player's aim is real-time and
   movement runs at 0.5 of real time; entering it tweens the camera FOV from 55 to 47 over 0.25 s
   and back; a subtle animated film-grain overlay (CSS, cheap) and the existing sepia stay; a low
   heartbeat loop (synth: two soft thumps per 1.1 s) plays while active. The meter is an
   **hourglass**-style bar that drains in ~9 s of continuous use, refills slowly, and jumps on
   kills (+15% per kill, +30% for a kill during a dodge). Entering BT with < 10% is refused with a
   dry click.
2. **Shoot-dodge**: keep T4's dive but: free look while airborne (the body keeps the dive direction,
   the camera/aim turns), slightly longer hang (0.8 s), landing stays prone until a move key, and
   while prone the camera lowers to 0.9 m and the shoulder offset shrinks; the dive auto-triggers
   BT at no meter cost (as now) and ends BT on get-up unless Shift is held. Dodging into an enemy
   within 1.5 m knocks them down (they fall for 1.5 s). Max Payne-style: a kill while airborne gives
   the bigger meter refill.
3. **Bullets**: every projectile leaves a short fading trail (pool of thin, additive, 0.25 s trail
   segments; max 300) in addition to the tracer; bullets within 1.2 m of the player's head that miss
   play a whiz (`audio.whiz`) and spawn a tiny air ripple (a quick-expanding transparent ring). Enemy
   muzzle flashes already exist; add a brief point light per shot if not present.
4. **Kill-cam**: when the player fires at the last living hostile within 45 m (mission targets,
   alerted gang members, angry cops) and the shot's straight path intersects that ped, the camera
   detaches and follows the bullet from 1.2 m behind and 0.3 m above (looking along its velocity)
   at time scale 0.12 until impact, holds 0.7 s on the falling body, then eases back to the
   shoulder camera over 0.4 s. Input is ignored during it; HUD shows nothing extra. Never trigger
   while driving, when the bullet is a rocket/flame, or more than once per 8 s.
5. **Dual pistols** (`dual`, slot 3 in `WEAPON_ORDER`; shift the others): fires alternating
   left/right at twice the pistol rate, spread 0.025, consumes pistol ammo (shares `pistol` ammo
   pool), only available once the player has picked up a second pistol (pickup or shop item
   "SECOND PISTOL" $600) — `player.weapons.dual = true` flag. Both hands aim in the shoot pose.
6. **Enemies**: when a bullet passes within 1 m of a hostile ped they strafe for 0.6 s; 25% of
   hostile gang members dodge sideways (short hop) when the player fires at them from > 8 m;
   enemies shout a short line (`hud.toast`-free: small floating text above the head for 1.5 s, max
   3 on screen) from a small pool when alerted / hurt / when a buddy dies. Keep it cheap.
7. **Painkillers** replace instant health: health pickups and the shop item become PAINKILLERS
   (max 9 held; `H` key or touch PILLS button to use one: heals 35 hp over 1.2 s; the HUD shows a
   bottle icon with the count next to the health bar). The ambulance heal and respawn keep working.
8. **HUD**: hourglass meter, painkiller count, dual-pistol ammo line "DUAL PISTOLS 2x", and the
   crosshair tightens when standing still / loosens while moving.

Acceptance: a scripted run proves: BT time scale 0.2 and meter drain/refill numbers; the kill-cam
triggers on a last-enemy kill and returns control; the dual pistols fire faster and share ammo;
painkillers heal over time and are capped at 9; trails and whiz exist without frame drops (count
particles); enemy shouts appear; build passes.

## T13 — Smoother character pipeline (less blocky)

Owner files: `src/world/assets.js` (character part), `scripts/scan-assets.js` (characters/packs),
`src/entities/ped.js` (`buildModelMesh`, `updateModel` only), `README.md`, `CHARACTERS.md` (new).

1. Pack selection: `public/assets/characters/<pack>/` folders; an optional `pack.json` in a folder
   (`{ "priority": 10, "scale": 1.0, "animations": "animations.glb", "clips": {"idle": "Idle",
   "walk": "Walking", ...}, "forward": "+z"|"-z" }`). The scanner lists packs with their files;
   the loader uses the highest-priority pack that loads. Mixamo/Quaternius rigs: clip matching is
   case-insensitive and accepts a separate animation-library GLB whose clips are retargeted onto
   every model of the pack (same skeleton; match by bone names; use `THREE.AnimationUtils`/
   `SkeletonUtils.retargetClip` if bone names differ only by prefix like `mixamorig:`).
   Default clip regexes: idle `/idle|breath/i`, walk `/walk/i`, run `/run|sprint|jog/i`, jump
   `/jump/i`, shoot `/shoot|fire|pistol|gun|aim/i`, death `/death|die|dying/i`, prone/dodge
   optional `/dive|roll|prone/i`.
2. Gun in hand: if a hand bone exists (`/hand.*r|righthand|hand-right|mixamorig:RightHand/i`),
   attach the weapon mesh to it; otherwise keep the chest-mounted box. Per-weapon procedural
   meshes: pistol, dual (two), uzi, shotgun (long), flame (tank + nozzle), rocket (tube).
3. Upper-body aim: find the spine/chest bone (`/spine2|spine1|chest|upperbody|torso/i`); each
   frame add the player's pitch (and for NPCs their aim pitch toward the target) as an extra
   rotation on that bone after the mixer update so the gun follows the crosshair up/down.
4. Keep the Kenney Mini Characters working as the fallback pack (priority 0) and the box model
   below that. Any pack must normalise to 1.75 m and feet at y=0.
5. `CHARACTERS.md`: how to add a pack, with two concrete recipes: (a) Quaternius **Universal Base
   Characters** + **Universal Animation Library** (quaternius.com; free under the Quaternius
   license for games; GLB; shared rig) and (b) Mixamo (free with an Adobe account; download
   character + animations as FBX "with skin"/"without skin", convert to GLB with Blender's
   glTF exporter, animation names as `pack.json` clips). Include the exact folder layout and the
   `pack.json` example.

Acceptance: with only the Mini Characters present everything works as today; with a synthetic
test pack (a rigged box built in a node script or the existing mini model copied with a
`pack.json` and renamed clips) the pack wins by priority, the renamed clips map, the gun sits in
the hand bone, the spine follows pitch; build passes.

## T14 — Interiors for shops and dealers

Owner files: `src/systems/interiors.js` (new), `src/world/interior.js` (new: room builder +
collision object with the same method names as `City` — `query`, `queryRect`, `resolveCircle`,
`lineOfSight`, `raycast`, `pointFree`, `groundHeight`), `src/game.js` (enter/exit hooks,
collision source swap, HUD/minimap suppression), `src/ui/hud.js` (nothing unless needed),
`README.md`.

1. Gun shops and both dealers get a walk-in interior: pressing E at the door no longer opens the
   dialog directly; it fades to black (0.3 s), moves the player into a procedurally built room on a
   separate `THREE.Scene` (walls, floor, ceiling lights, counter, shelves with weapon props for gun
   shops; a showroom with 3 display cars from the dealer's stock rotating slowly on podiums for
   dealers), with a shopkeeper NPC behind the counter (Ped model, idle, no AI). The counter has a
   prompt `E — BROWSE` that opens the existing shop/dealer dialog; the door has `E — LEAVE` which
   fades back to the street at the door point. Third-person controls, aiming and bullet time keep
   working inside; shooting inside is allowed but the keeper panics and the shop closes for 60 s.
2. While inside: the city simulation pauses (vehicles, peds, wanted, missions timers, jobs); the
   minimap shows a simple room outline instead of the city; exterior audio (sirens/engine) is
   silenced; HUD stays. Save/load inside is allowed (position saved as the door point outside).
3. Collision swap: the game currently calls `this.city.*` for collisions in several places; the
   cleanest route is `game.city` → keep, and add `game.world` returning the current collision
   provider (city or interior) and change those call sites to `game.world` with small targeted
   edits (list them: footMode camera raycast/aim, ped.resolve/groundHeight, combat bullet walls,
   vehicle collideWorld is irrelevant inside). Lights: the interior scene has its own ambient +
   point lights; render that scene instead of the city while inside.

Acceptance: entering HARLOW ARMS shows a room with a counter and keeper; the dialog opens from
the counter; leaving returns to the door with the city resumed where it was; the dealer showroom
shows real car models; a mission timer does not tick inside; build passes.

---

# Round 5 — Julpies House

Same rules as rounds 3–4 (own test ports 419x, never 4141/4142/4199; targeted edits; touch + keyboard).

## T15 — Samurai sword and sticky stick grenades

Owner files: `src/systems/combat.js`, `src/entities/player.js` (fire/weapon branches), `src/entities/ped.js`
(melee animation + `dismember` death visual only), `src/data/shops.js`, `src/game.js` (pickup meshes,
`makePickupMesh` cases, loot), `src/world/city.js` (two pickups), `src/systems/effects.js`,
`src/ui/hud.js` (ammo line), `src/ui/touch.js`/`index.html` (nothing new unless needed), `README.md`.

1. **Samurai sword** (`sword`, slot after `fist` → `WEAPON_ORDER = ['fist','sword','pistol','dual','uzi','shotgun','flame','rocket','grenade']`, keys 1–9):
   melee, no ammo. LMB = slash: 0.45 s swing, 2.2 m reach, 110° arc, 120 dmg (kills most in one),
   hits every ped in the arc, vehicles take 15 and spark. Alternating left/right swings; the player
   model plays `attack-melee-right`/`-left` (Mini Characters have both; use `shoot` fallback when a
   pack lacks them) with the sword mesh in the hand (katana: thin long blade + guard + wrapped grip,
   procedural). Sword kills: strong blood burst + the body is flung along the swing, and a short
   `audio.slash` (synth whoosh + file-first `slash` event). While bullet time is on, a slash kill
   grants +0.2 meter. Blocking bullets: while the sword is held and the player is not moving, bullets
   from the front (within 60°) have a 35% chance to be deflected (spark + whiz) in bullet time only.
   Sold at gun shops ($3,000) and one pickup in the city.
2. **Sticky stick grenades** (`grenade`, ammo 6, pack +3): LMB throws in an arc (initial speed 16 m/s
   plus 0.25 up, affected by gravity 22, spins); the grenade **clings** to the first ped, vehicle or
   wall it touches (parented to the ped/vehicle so it rides along), beeps twice and explodes 2.0 s
   after the throw (`game.explode`, radius 6, dmg 140). A stuck ped panics and runs. Procedural
   model: wooden handle + metal can. Sold at gun shops ($900 for 3) and dropped by some enemies
   (10%). The HUD shows `STICK GRENADE x6`. Touch: FIRE throws.
3. Enemies: a few gang members in Eastside/turf may carry `sword` (add to `GANGS.crows.weapons`
   list once) — their AI must close to melee range and swing with the same arc logic.

Acceptance: slot 2 selects the sword and a swing kills a 70 hp ped in reach; grenade sticks to a
car and wrecks it; sword and grenades appear in the shop and persist through save/load; build passes.

## T16 — Julpies House: rename, Julpie as the final boss, mini-bosses, boss bars

Owner files: `index.html` (title, `<title>`), `README.md`, `VOICES.md`, `src/data/missions.js`,
`src/systems/missions.js` (boss spawning helpers only), `src/data/voices.js`, `src/ui/hud.js` +
`src/style.css` (boss bar), `src/game.js` (boss bar sync), `src/entities/ped.js` (`boss` fields only:
`bossName`, `bossHp`), `src/world/city.js` (one new place: JULPIE'S HOUSE, a mansion block).

1. Rename the game to **Julpies House** everywhere a player sees it (title screen, browser title,
   README headline, pager welcome line "Welcome to Port Harlow" can stay as the city name).
2. **Julpie** is the kingpin behind all three bosses. Add `JULPIE'S HOUSE`: a walled mansion on a
   free block (pick one from `SPECIAL`'s free list, e.g. (9,0) on the north-east corner) with a gate,
   garden walls (collision boxes), a courtyard and the house. Finale (m10, order 14): the three
   bosses' trail leads to Julpie: assault the gate (ambush), fight through the courtyard
   (kill with a mini-boss), then **Julpie** on the roof terrace: `boss: true`, name 'Julpie', 900 hp,
   dual pistols + grenades, phases: at 60% hp calls 4 guards, at 30% switches to sword and charges.
   Marco Cinelli becomes a mini-boss earlier in that mission. Write Julpie's lines (wacky, over the
   top) and add a `Julpie` voice brief.
3. **Mini-bosses** in at least 5 missions (semi-main): named peds with 250–450 hp, a signature weapon,
   a tint/scale, a shout line on appearance, `miniBoss: true`. Examples: Fisk (m3) upgraded, "Knuckles"
   (Dell's enforcer, m5), "The Deacon" (m8/m13), "Sal Twice" (m11 collection run), "Marco Cinelli"
   (finale, before Julpie). Killing a mini-boss pays an extra $5,000 × mult and drops their weapon.
4. **Boss bar**: when a boss/mini-boss is alive within 60 m, a wide HUD bar under the top bars shows
   `NAME` and hp (red, striped). Hidden otherwise. `hud.setBoss(name, frac)`.

Acceptance: title says JULPIES HOUSE; the mansion exists on the map and in the full-screen map with a
label; a scripted run reaches Julpie, sees the boss bar, triggers both phases and finishes the
campaign; `npm run voice-lines` exports Julpie's lines; build passes.

## T17 — Aim assist, dodge/jump flair (after T15)

Owner files: `src/modes/footMode.js`, `src/entities/player.js` (`fire` aim nudge), `src/ui/hud.js` +
`src/style.css` (crosshair states), `src/input.js` (double-tap detection), `src/game.js` (camera
roll in `updateCamera`), `README.md`.

1. **Aim assist**: soft lock. Each frame find the hostile ped whose chest is closest to the crosshair
   ray within 4° (8° on touch, ×1.5 in bullet time) and within 40 m with line of sight; the shot's
   direction is nudged 70% of the way to that chest (100% on touch); the crosshair turns red and
   shrinks over a target; mouse sensitivity drops 35% while the crosshair is on a target ("sticky");
   the kill-cam keeps working. Toggle in the pause menu? No: a `localStorage` flag `port-harlow-aim`
   with a key `K` cycling OFF / NORMAL / STRONG (toast). Default NORMAL.
2. **Dodge direction**: double-tap W/A/S/D (within 0.25 s) = shoot-dodge in that direction (RMB and
   the touch button keep working); the dive direction is the tapped direction relative to the camera.
3. **Jump flair**: Space while holding Shift = bullet-time jump (a higher 1.6 m jump that engages BT
   for the air time at no cost, like the dive); while airborne in BT the camera rolls 6° in the
   movement direction and the FOV widens 3°; landing a kill while airborne shows "AIR KILL" + $100.
4. Crosshair: three states (idle, on-target red, blocked grey when the ray hits a wall before 3 m).

Acceptance: with a target 20 m away 3° off the crosshair, shots hit; double-tap A dives left; Shift+Space
engages BT in the air; build passes.
