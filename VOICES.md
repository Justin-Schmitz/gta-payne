# Custom voices for Julpies House

Every spoken line in the game (mission briefings, mid-mission radio, the pager) can be voiced by
dropping one audio file per line into `public/assets/voice/`. No code changes needed: the game plays
the file when it shows the pager text, and keeps using silent text for any line without a file.

## 1. Get the script

```bash
npm run voice-lines
```

This writes `voice-lines.csv` and `voice-lines.json` (about 120 lines today; re-run whenever missions
change). Columns:

| column            | meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `id`              | line id, also the audio **file name** (`m3.intro`, `m9.step2.done`, `pager.welcome`) |
| `speaker`         | character                                                               |
| `file`            | the exact file name to produce, e.g. `m3.intro.mp3`                      |
| `text`            | what they say                                                           |
| `voice_direction` | the wacky-voice brief for that character (from `src/data/voices.js`)    |
| `reference_clip`  | suggested reference clip name for voice-cloning models                  |

Julpie (the final boss) and the mini-bosses Knuckles, Sal Twice, The Deacon, Foreman Brick and Jeeves the Butler have briefs too; their
lines (appearance lines `mX.stepN.miniK`, Julpie's phases `m10.boss1` / `m10.boss2`, death line `m10.step7.done`) are exported like the rest.

Characters and their briefs live in [src/data/voices.js](src/data/voices.js): Marco Cinelli
(gravelly mob boss), Big Dell (booming garage shouter), Sister Mal (too-sweet church lady), Tony
(car-sick cousin), Fisk (panicky debtor), Crew (tense and clipped), Pager (deadpan answering machine), plus the street
contacts Sal Bruno, Pete Okafor, Lenny Vasco, Dani Reyes and Greta Holm and the generic Dispatch,
Fare, Stranger and Cab Thief (lines for these live in [src/data/jobs.js](src/data/jobs.js)). Edit the briefs
there; they're only used for the script export.

## 2. Generate with Pinokio on the Windows GPU box

Any TTS app works as long as you can batch lines. Good Pinokio options:

* **Chatterbox** or **F5-TTS** (voice cloning): record or find a 6–15 s reference clip per
  character (`cinelli.wav`, `dell.wav`, …), then generate each line from the CSV `text` column with
  that reference. Exaggeration / emotion sliders are where the wacky comes from.
* **Kokoro** (fast, fixed voices): pick a different preset voice per character; no reference clip.
* **XTTS / AllTalk**: same idea as Chatterbox with a reference clip.

Batch tip: most of these apps accept a CSV or a text file; if yours only has a text box, feed it
`voice-lines.json` with a tiny Python loop in the app's console. Keep one output file per `id`.

Make it wackier after generation (optional, all CC0-friendly, runs anywhere ffmpeg does):

```bash
# Tony: nasal + faster     | Pager: robot          | Dell: louder, roomy
ffmpeg -i in.wav -af "asetrate=44100*1.12,aresample=44100,highpass=f=300" tony.mp3
ffmpeg -i in.wav -af "aecho=0.8:0.6:8:0.4,chorus=0.6:0.9:50:0.4:0.25:2" pager.mp3
ffmpeg -i in.wav -af "volume=1.6,aecho=0.6:0.5:60:0.3" dell.mp3
```

## 3. Export format

* `.mp3` (safest for iPad Safari), `.ogg` or `.wav`; mono; 44.1 kHz; normalise to about −16 LUFS so
  lines sit under the gunfire.
* File name = `<id>.<ext>`, e.g. `m1.intro.mp3`, `m4.step1.done.mp3`, `pager.welcome_back.mp3`.
* Put them all flat in `public/assets/voice/` (sub-folders are fine too).

## 4. Enable

```bash
npm run assets
```

The scanner reports `voice lines: N`. Reload the game. Lines play once when their pager text
appears; a new line cuts off the previous one. Lines are decoded on first use, so the first play of
each has a tiny delay.

## Where lines come from

* `src/data/missions.js`: `intro`, `outro`, per-step `message` and `doneMessage`, the pager line of paged
  missions and the radio calls of escort / defend waves → ids `<missionId>.intro`, `<missionId>.outro`,
  `<missionId>.page`, `<missionId>.step<n>.message`, `<missionId>.step<n>.done`, `<missionId>.step<n>.wave<k>`.
* `src/data/voiceLines.js`: everything else (pager welcome, all-missions-done). Add new one-off
  lines there and call `game.say(id, text, who)` from code.

Short HUD toasts (STOLEN, RESPRAYED, …) are deliberately not voiced.
