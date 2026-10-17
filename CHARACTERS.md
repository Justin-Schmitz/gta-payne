# Character packs

The game ships no character art. Out of the box it uses the **Kenney Mini Characters** (CC0, blocky)
when they are unzipped into `public/assets/characters/`, and procedural box people when nothing is
there. This page explains how to drop in a smoother rigged pack (Quaternius, Mixamo, anything that
exports a skinned glTF) so pedestrians, cops, gangs and the player look less blocky.

Nothing in the game code changes: you add a folder, optionally a `pack.json`, run `npm run assets`
and reload. The browser console prints one line such as
`assets: 50 cars, 12 characters (pack quaternius), 12 sfx`, and warnings starting with `assets:` when a
clip, bone or animation library could not be matched.

## How packs are chosen

* Every folder directly under `public/assets/characters/` is one pack (loose `.glb` files placed
  directly in `characters/` form one more pack).
* A pack's **priority** comes from its `pack.json` (`"priority": 10`). Without it the folder
  `kenney_mini-characters` has priority 0 and any other folder has priority 1, so a pack you drop in
  wins over the Mini Characters by default.
* The loader tries packs from the highest priority down and uses the first one that produces at
  least one animated model (an idle clip must be found). A pack that fails (missing file, skeleton
  that does not match the animation library) logs a warning and the next pack is tried; the box
  people are the last fallback.
* Whatever the pack, models are rotated to face +Z, scaled to **1.75 m** tall and put on the ground
  (feet at y = 0). `pack.json` can turn a model that faces the wrong way (`forward`) or fine-tune the
  height (`scale`).

## Folder layout

```
public/assets/characters/
  kenney_mini-characters/          the fallback (priority 0), no pack.json needed
  quaternius/                      a pack: any folder name
    pack.json                      optional, see below
    Superhero_Male.glb             character models (rigged, skinned); names are arbitrary
    Casual_Female.glb
    UAL1_Standard.glb              animation library (listed in pack.json "animations")
    Textures/...                   whatever the models reference
```

`npm run assets` scans the folders and writes `public/assets/manifest.json`:
`characterPacks: [{ dir, priority, config, models, animations, skins }]` sorted by priority, next to
the flat `characters` and `skins` lists older versions of the loader use. Re-run it whenever you add,
remove or rename files.

Without a `pack.json` a folder is scanned like the Mini Characters: only files named `character*.glb`
are characters (the Kenney folder also holds wheelchairs and canes), or, if there are none, every
model whose name does not look like an animation file. With a `pack.json` every `.glb`/`.gltf` in the
folder is a character except the animation libraries; use `"models"` to narrow it down.

## pack.json

All fields are optional.

```json
{
  "priority": 10,
  "scale": 1.0,
  "forward": "+z",
  "animations": ["UAL1_Standard.glb", "UAL2_Standard.glb"],
  "clips": {
    "idle": "Idle_Loop",
    "walk": "Walk_Loop",
    "run": "Sprint_Loop",
    "jump": "Jump_Loop",
    "shoot": "Pistol_Aim_Neutral",
    "death": "Death01"
  },
  "models": ["^Superhero", "^Casual"],
  "skins": false,
  "bones": { "hand": "hand_r", "handLeft": "hand_l", "spine": "spine_03" },
  "gunOffset": { "pos": [0.0, 0.02, 0.05], "rot": [-90, 0, 0] },
  "gunScale": 1.0
}
```

| field | meaning |
| --- | --- |
| `priority` | higher wins. Default 1 (0 for the folder `kenney_mini-characters`). |
| `scale` | multiplier on top of the 1.75 m normalisation (default 1). Leave at 1 unless a pack looks too tall or short next to the cars. |
| `forward` | direction the model faces in the file: `"+z"` (default, what Blender/glTF exports normally give), `"-z"`, `"+x"`, `"-x"`. |
| `animations` | animation-library GLB, or a list of them, relative to the pack folder. Their clips are retargeted onto every model. `null` disables. If omitted, a model file whose name contains "anim" (or starts with `UAL1`, `UAL2`...) is used automatically. |
| `clips` | role -> clip name. The value is an exact clip name, a `"/regex/flags"` string or a substring, case-insensitive, searched in the animation libraries first and then in the model's own clips. Roles: `idle`, `walk`, `run`, `jump`, `shoot` (one-handed aim pose), `shoot2` (two-handed aim, used for the dual pistols), `death`, `prone`. Aliases: `sprint`/`jog` = run, `die`/`dying` = death, `aim`/`fire` = shoot. Roles you do not list use the default matching below. |
| `models` | list of regexes tested against the file names; only matching files are characters. |
| `skins` | `false` (default whenever a `pack.json` exists), `true` or a list of PNG names. Skins are plain texture swaps made for the Kenney models; real packs carry their own textures. |
| `bones` | override the bone found for `hand` (right), `handLeft`, `spine`: a bone name (case and punctuation ignored) or a regex. |
| `gunOffset` | where the weapon sits in the **right hand bone's local space**: `pos` in metres, `rot` as XYZ Euler angles in **degrees**. The gun's barrel points along its local +Z and its top along +Y. Replaces the automatic orientation (below). |
| `gunOffsetLeft` | same for the left hand (dual pistols). Default: `gunOffset` mirrored (x of `pos` negated, y and z of `rot` negated). |
| `gunScale` | size multiplier for the procedural guns (1 = real size). |

### Default clip matching

Clip names are compared lower-case; the first expression that matches wins (shorter names first when
several match). Everything is overridable with `clips`.

| role | expressions, best first |
| --- | --- |
| idle | `^idle.*loop`, `^idle`, `idle\|breath`, `static` |
| walk | `^walk.*loop`, `^walk`, `walk` |
| run | `^run`, `sprint`, `run`, `jog` |
| jump | `^jump.*loop`, `^jump`, `jump` |
| shoot | `holding-right-shoot`, `pistol.*aim`, `pistol.*shoot`, `pistol`, `shoot`, `fire`, `gun\|aim\|rifle` |
| shoot2 | `holding-both-shoot`, `both.*shoot`, `two.?hand.*(shoot\|aim)`, `dual` |
| death | `^die`, `death\|dying\|die`, `fall` |
| prone (optional) | `dive`, `roll`, `prone` |

The aim clip is reduced to its arm / head / spine tracks so the legs keep walking while the arms
aim, and the idle / walk / run / jump clips are split the same way so the aim pose replaces the arms
instead of being averaged with them.

## Bone and clip matching rules

* **Animation library -> model.** A clip is reused on a model when its tracks bind to bones that
  exist on the model. Names that differ only by a prefix are matched too: `mixamorig:` /
  `mixamorig1:` (Blender/three drop the colon), `Armature_`, `Bip001_`, case and punctuation
  ignored. At least half of the bones a clip animates must exist on the model, otherwise the clip is
  rejected with a console warning and the model's own clips (or the next pack) are used.
* Retargeted clips keep rotation tracks only. Position and scale tracks are dropped, except the
  hips / pelvis / root bob: its horizontal travel is flattened (clips are played in place, the game
  moves the ped) and its height is rescaled by the ratio of the two rigs' hip heights.
* **Right hand:** the first bone matching (after removing the prefix) `righthand`, `hand_r`,
  `hand.r`, `hand-right`, `rhand`, ..., then a forearm / `arm-right` bone for rigs that have no hand
  (the Mini Characters), and finally a loose `hand.*r` match that ignores finger bones. Left hand
  is symmetric. Without a hand bone the old chest-mounted gun box is used.
* **Spine:** `spine2`, `spine_03`, `chest`, `upperchest`, `upperbody`, `spine_02`, `spine1`,
  `torso`, then any `spine`.
* **Gun orientation.** For known rigs (the Mini Characters) a built-in offset is used. For any other
  rig, with no `gunOffset`, the barrel points along the hand bone toward its children (along the
  fingers) with zero offset. That is usually close; fine-tune with `gunOffset`. The scanner copies
  `pack.json` into the manifest, so after every edit run `npm run assets` and reload.
* **Aim pitch.** While a ped aims a weapon, the spine bone is rotated about the character's
  left-right axis after the animation update: the player by the camera pitch, enemies by the angle
  to the player's chest; clamped to +-0.8 rad and eased back to 0 when not aiming. Positive pitch
  means looking down and lowers the gun.

## Recipe A: Quaternius Universal Base Characters + Universal Animation Library

Both are free downloads from <https://quaternius.com> (search for "Universal Base Characters" and
"Universal Animation Library"). They share one skeleton, which is exactly what makes the pair work:
the characters carry no animations and the library carries a large set of them. The Quaternius license lets
you use them in a game but **not redistribute the files**: keep the downloaded `.glb` files local
(do not commit them or ship them in a public repository) and check the license on the download page.

1. Download the characters (GLB) and the animation library (GLB, the "Standard" file or both
   `UAL1_Standard.glb` and `UAL2_Standard.glb`).
2. Create `public/assets/characters/quaternius/` and put the character `.glb` files and the library
   file(s) in it.
3. Add `public/assets/characters/quaternius/pack.json`:

   ```json
   {
     "priority": 10,
     "animations": ["UAL1_Standard.glb"],
     "clips": {
       "idle": "Idle_Loop",
       "walk": "Walk_Loop",
       "run": "Sprint_Loop",
       "jump": "Jump_Loop",
       "shoot": "Pistol_Aim_Neutral",
       "death": "Death01",
       "prone": "Roll"
     }
   }
   ```

   Open the library in any glTF viewer (or in Blender) to read the real clip names; the clip names
   above are typical, and most are already found by the default matching. Drop the `clips` block if
   you are happy with what the defaults pick.
4. Run `npm run assets` and reload. If the gun sits oddly in the hand, add a `gunOffset`.

## Recipe B: Mixamo (via Blender)

Mixamo (<https://www.mixamo.com>) is free with an Adobe account; check Adobe's terms (use in your
game is fine, redistributing the raw files is not).

1. Pick a character (or upload your own) and download it as **FBX, "With Skin", T-pose**.
2. Pick the animations you need (Idle, Walking, Running, Jump, Pistol Idle / Aim, Death, Dive...)
   and download each as **FBX, "Without Skin"**, with **"In Place"** ticked for walks and runs.
3. In Blender, import the character FBX and export it as **glTF 2.0 (.glb)** with *Animation*
   unchecked, into `public/assets/characters/mixamo/` (one file per character).
4. Import the animation FBXs into a second Blender file, rename each action to a readable name
   (`Idle`, `Walking`, `Running`, ...; Mixamo names them all `mixamo.com`), push them into NLA
   tracks and export one **`animations.glb`** with *Animation* on and every action exported. Put it
   next to the characters. The bones are called `mixamorig:Hips`, `mixamorig:RightHand`... in both
   files; the loader strips that prefix when it compares names, so slightly different exports still
   match.
5. Add `public/assets/characters/mixamo/pack.json`:

   ```json
   {
     "priority": 10,
     "animations": "animations.glb",
     "clips": {
       "idle": "Idle",
       "walk": "Walking",
       "run": "Running",
       "jump": "Jump",
       "shoot": "Pistol Idle",
       "death": "Death",
       "prone": "Dive"
     }
   }
   ```
6. Run `npm run assets` and reload. Models that face the wrong way need `"forward": "-z"`.

## Checking a pack

After `npm run assets` the script prints one line per pack
(`character pack mixamo: priority 10, 3 models, animations ..., pack.json`). In the browser console
look for the `assets:` line and for warnings (`animation library bones do not match`, `pack.json maps
idle -> ... but no such clip exists`, `no usable idle clip`). To see which pack is active from the
devtools console: `game.player.ped.model.pack` is the folder of the pack in use and
`game.player.ped.model.hasHand` / `.hasSpine` tell whether the gun mount and the aim bone were found.
