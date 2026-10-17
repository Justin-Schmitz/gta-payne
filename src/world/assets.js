import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Optional art assets (Kenney Car Kit, Kenney Blocky Characters, sound files).
 * Everything here is best effort: when the manifest or any file is missing the game keeps using
 * its procedural models and synthesised sound. See README "Real art and sound".
 */

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
export const assetUrl = (p) => BASE + String(p).replace(/^\/+/, '');

/** vehicle type -> ordered file-name regexes (tested against the lower-case base name, no extension). */
const CAR_PICK = {
  compact: [/^hatchback-sports$/, /^hatchback/],
  sedan: [/^sedan$/],
  coupe: [/^sedan-sports$/],
  sports: [/^race$/],
  hyper: [/^race-future$/],
  taxi: [/^taxi$/],
  van: [/^van$/],
  boxtruck: [/^delivery$/],
  flatbed: [/^delivery-flat$/],
  pickup: [/^truck$/],
  suv: [/^suv$/],
  limo: [/^suv-luxury$/],
  police: [/^police$/],
  ambulance: [/^ambulance$/],
  firetruck: [/^firetruck$/],
  garbage: [/^garbage-truck$/],
  tractor: [/^tractor$/],
  armoured: [/^suv-luxury$/],
  // bus has no model (procedural box) and the tank is always procedural: neither is listed here
};
/** Types with several equally good models: one is picked at random per car. */
const CAR_VARIANTS = {
  kart: /^kart-(oobi|oodi|ooli|oopi|oozi)$/,
};
/** Never used as a vehicle body, whatever the regexes say. */
const NOT_A_CAR = /wheel|debris|cone|tire|^box$/;

/** Ordered clip-name regexes per role (tested against the lower-case clip name); earlier = better. pack.json "clips" overrides. */
const CLIP_PICK = {
  idle: [/^idle.*loop/, /^idle/, /idle|breath/, /static/],
  walk: [/^walk.*loop/, /^walk/, /walk/],
  run: [/^run/, /sprint/, /run/, /jog/],
  jump: [/^jump.*loop/, /^jump/, /jump/],
  shoot: [/holding-right-shoot/, /pistol.*aim|aim.*pistol/, /pistol.*shoot|shoot.*pistol/, /pistol/, /shoot/, /fire/, /gun|aim|rifle/],
  shoot2: [/holding-both-shoot/, /both.*shoot|two.?hand.*(shoot|aim)|dual/],   // optional two-handed aim, used for the dual pistols
  melee: [/attack-melee-right/, /melee.*right|right.*melee/, /melee|slash|attack/],   // sword swings (one-shot, upper body); alternates with melee2
  melee2: [/attack-melee-left/, /melee.*left|left.*melee/],
  death: [/^die/, /death|dying|die/, /fall/],
  prone: [/dive/, /roll/, /prone/],   // optional: exposed as ASSETS actions.prone for the dodge, not played by default
};
/** Tracks of the aim clip that are kept so the legs keep walking while the arms aim. */
const UPPER_RE = /arm|hand|shoulder|elbow|head|neck|clavicle|wrist|finger|thumb|spine|chest/i;
const LOWER_RE = /leg|foot|toe|hip|pelvis|root|thigh|knee|calf/i;

const SKIN_RE = {
  cop: /police|cop/,
  boss: /suit|business|boss|zombie/,
  gang: /gang|criminal|robber|thug|punk/,
};

/** Truck-like Kenney files whose cab sits ahead of the middle; they face +Z already (see buildCarTemplate). */
const TRUCKISH = /delivery|truck|tractor|firetruck|garbage|ambulance/;

const base = (p) => p.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();

function findByRegexes(list, res, nameOf = (x) => x, skip = null) {
  for (const re of res) {
    const hit = list.filter((x) => re.test(nameOf(x).toLowerCase()) && !(skip && skip.test(nameOf(x).toLowerCase())));
    if (hit.length) return hit.sort((a, b) => nameOf(a).length - nameOf(b).length)[0];
  }
  return null;
}

function meshesOf(root) {
  const out = [];
  root.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

/** The material that covers the most triangles: the paintwork. */
function largestMaterial(root) {
  const tris = new Map();
  for (const m of meshesOf(root)) {
    const g = m.geometry;
    const total = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (Array.isArray(m.material)) {
      const groups = g.groups.length ? g.groups : [{ materialIndex: 0, count: total * 3 }];
      for (const gr of groups) { const mat = m.material[gr.materialIndex]; if (mat) tris.set(mat, (tris.get(mat) || 0) + gr.count / 3); }
    } else tris.set(m.material, (tris.get(m.material) || 0) + total);
  }
  let best = null, bn = -1;
  for (const [mat, n] of tris) if (n > bn) { best = mat; bn = n; }
  return best;
}

/** Give each instance its own materials (shared ones stay shared inside the instance). Returns the map orig->copy. */
function cloneMaterials(root) {
  const map = new Map();
  const cp = (mat) => { if (!map.has(mat)) map.set(mat, mat.clone()); return map.get(mat); };
  for (const m of meshesOf(root)) m.material = Array.isArray(m.material) ? m.material.map(cp) : cp(m.material);
  return map;
}

/** Palette-textured cars: recolour only the saturated (paint) texels with the material colour. */
function installPaintShader(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 texel = texture2D( map, vMapUv );
        float mxv = max(texel.r, max(texel.g, texel.b));
        float mnv = min(texel.r, min(texel.g, texel.b));
        float satv = (mxv - mnv) / max(mxv, 0.001);
        float paintv = smoothstep(0.4, 0.6, satv) * step(0.25, mxv);
        diffuseColor.rgb = mix(texel.rgb, diffuseColor.rgb * (0.45 + 0.75 * mxv), paintv);
        diffuseColor.a *= texel.a;
      #endif`);
  };
  mat.customProgramCacheKey = () => 'car-paint';
}

export const ASSETS = {
  ready: false,
  manifest: null,
  counts: { cars: 0, characters: 0, sfx: 0 },
  _cars: new Map(),   // type key -> car template
  _variants: new Map(), // type key -> [car templates] (random pick per car, e.g. the karts)
  _char: null,        // first character template (kept for compatibility)
  _chars: [],         // all character templates: variety comes from picking different models per ped
  _skinTex: new Map(),
  _skins: [],         // skin texture paths of the active character pack (empty when the pack has no texture swaps)
  pack: null,         // { dir, priority, config } of the character pack in use (null = box models)

  /** Car template for a vehicle type key, or null (use the procedural box car). */
  car(typeKey) { return this._cars.get(typeKey) || null; },
  /** Character template or null. */
  character() { return this._char; },

  /**
   * Fresh car instance scaled to `len` metres: { group, bodyMat, wheels, height, file } or null.
   * `wheels` contains only nodes that can safely be spun (userData.ax / userData.sg give axis and sign).
   */
  makeCar(typeKey, len, color) {
    const vs = this._variants.get(typeKey);
    const tpl = vs && vs.length ? vs[Math.floor(Math.random() * vs.length)] : this._cars.get(typeKey);
    if (!tpl) return null;
    const inst = tpl.holder.clone(true);
    const mats = cloneMaterials(inst);
    const bodyMat = mats.get(tpl.bodyMat) || null;
    if (bodyMat) {
      if (bodyMat.map) installPaintShader(bodyMat);
      bodyMat.color.set(color);
    }
    const s = len / tpl.length;
    inst.scale.setScalar(s);
    const group = new THREE.Group();
    group.add(inst);
    const wheels = [];
    inst.traverse((o) => {
      if (!o.name || !tpl.wheelNames.has(o.name) || (o.parent && wheels.includes(o.parent))) return;
      o.userData.ax = tpl.spin.ax; o.userData.sg = tpl.spin.sg; wheels.push(o);
    });
    return { group, bodyMat, wheels, height: tpl.height * s, file: tpl.file };
  },

  /** Pick a model for a ped kind: fixed looks for cops / bosses / the player, random for everyone else. */
  _pickTemplate(kind, opts) {
    const all = this._chars.length ? this._chars : (this._char ? [this._char] : []);
    if (!all.length) return null;
    const byName = (re) => all.find((t) => re.test(t.file || ''));
    if (opts.model) { const t = byName(opts.model); if (t) return t; }
    if (kind === 'player') return byName(/male-c/) || all[0];
    if (kind === 'cop') return byName(/male-a/) || all[Math.min(1, all.length - 1)];
    if (kind === 'gang' && opts.boss) return byName(/male-f/) || all[all.length - 1];
    return all[Math.floor(Math.random() * all.length)];
  },
  /**
   * Fresh animated character: { group, mixer, actions, gun, torso, setWeapon, beforeMix, afterMix, hasHand } or null.
   * kind: civ | cop | gang | player; opts.tint colour tint, opts.boss.
   * setWeapon(id|null) shows the weapon mesh in the hand (or the chest box when the rig has no hand bone);
   * beforeMix()/afterMix(dt, pitch, on, group) wrap mixer.update to add the upper-body aim pitch (see ped.updateModel).
   */
  makePed(kind, opts = {}) {
    const tpl = this._pickTemplate(kind, opts);
    if (!tpl) return null;
    const inst = cloneSkinned(tpl.holder);
    const mats = cloneMaterials(inst);
    const skin = this._pickSkin(kind, opts);
    if (skin) for (const mat of mats.values()) if (mat.map) { mat.map = skin.tex; mat.needsUpdate = true; }
    // no dedicated skin: tint so cops / gangs are still told apart
    if (!skin || !skin.exact) {
      const tint = opts.tint || (kind === 'cop' ? '#5b74e0' : (kind === 'gang' && opts.boss) ? '#8a8a8a' : null);
      if (tint) for (const mat of mats.values()) mat.color.set(tint);
    }
    const mixer = new THREE.AnimationMixer(inst);
    const actions = {};
    for (const k of Object.keys(tpl.clips)) {
      const clip = tpl.clips[k];
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      a.enabled = true;
      if (k === 'death' || k === 'melee' || k === 'melee2') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      const bk = k.replace(/U$/, '');
      if (bk === 'idle' || bk === 'walk' || bk === 'run') { a.setEffectiveWeight(bk === 'idle' ? 1 : 0); a.play(); }
      actions[k] = a;
    }
    const group = new THREE.Group();
    group.add(inst);
    if (opts.scale && opts.scale !== 1) inst.scale.multiplyScalar(opts.scale);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.36), new THREE.MeshLambertMaterial({ color: '#222' }));
    gun.position.set(0.2, tpl.height * 0.58, 0.38);
    gun.visible = false;
    group.add(gun);

    // weapons in the hand bones
    const boneOf = (name) => { let r = null; if (name) inst.traverse((o) => { if (!r && o.isBone && o.name === name) r = o; }); return r; };
    const mountOn = (m) => {
      const b = m && boneOf(m.bone);
      if (!b) return null;
      const g = new THREE.Group();
      g.position.copy(m.pos); g.quaternion.copy(m.quat); g.scale.setScalar(tpl.mount.scale / m.ws);
      b.add(g);
      return g;
    };
    const mountR = mountOn(tpl.mount.r), mountL = mountR ? mountOn(tpl.mount.l) : null;
    const built = new Map();
    let cur = null;
    const setWeapon = (id) => {
      if (id === cur) return;
      const old = built.get(cur);
      if (old) for (const o of old) o.visible = false;
      cur = id || null;
      if (!cur) { gun.visible = false; return; }
      if (!mountR) { gun.visible = true; return; }   // rig without a hand bone: keep the chest-mounted box
      gun.visible = false;
      const kind = cur === 'dual' ? 'dual' : GUN_BUILDERS[cur] ? cur : 'pistol';   // unknown weapon ids show a pistol
      let objs = built.get(kind);
      if (!objs) {
        const first = makeGunMesh(kind === 'dual' ? 'pistol' : kind);
        objs = [first];
        mountR.add(first);
        if (kind === 'dual') {
          const second = makeGunMesh('pistol');
          if (mountL) mountL.add(second); else { second.position.x = 0.13; mountR.add(second); }
          objs.push(second);
        }
        built.set(kind, objs);
      }
      built.set(cur, objs);
      for (const o of objs) o.visible = true;
    };

    // upper-body aim: extra pitch on the spine/chest bone after the mixer (restored before the next update)
    const spine = boneOf(tpl.bones.spine);
    const pre = new THREE.Quaternion(), dq = new THREE.Quaternion(), qP = new THREE.Quaternion(), qG = new THREE.Quaternion(), ax = new THREE.Vector3();
    let applied = false, amount = 0;
    const beforeMix = () => { if (applied && spine) { spine.quaternion.copy(pre); applied = false; } };
    const afterMix = (dt, pitch, on, grp) => {
      const target = on ? Math.max(-0.8, Math.min(0.8, pitch || 0)) : 0;
      amount += (target - amount) * (1 - Math.exp(-dt * 14));
      if (!spine || (!on && Math.abs(amount) < 0.002)) { amount = on ? amount : 0; return; }
      pre.copy(spine.quaternion);
      // rotate about the character's lateral axis (group +x): positive pitch = barrel down
      spine.parent.updateWorldMatrix(true, false);
      spine.parent.getWorldQuaternion(qP);
      (grp || group).getWorldQuaternion(qG);
      ax.set(1, 0, 0).applyQuaternion(qG).applyQuaternion(qP.invert()).normalize();
      dq.setFromAxisAngle(ax, amount);
      spine.quaternion.premultiply(dq);
      applied = true;
    };
    return { group, mixer, actions, gun, torso: inst, setWeapon, beforeMix, afterMix, hasHand: !!mountR, hasSpine: !!spine, pack: tpl.packDir, file: tpl.file };
  },

  /** { tex, exact } or null. exact = a skin made for this kind (otherwise the caller tints). */
  _pickSkin(kind, opts) {
    const skins = this._skins;
    if (!skins.length) return null;
    const special = Object.values(SKIN_RE);
    let pool = null, exact = true;
    if (kind === 'cop') pool = skins.filter((p) => SKIN_RE.cop.test(base(p)));
    else if (kind === 'gang') pool = skins.filter((p) => (opts.boss ? SKIN_RE.boss : SKIN_RE.gang).test(base(p)));
    if (pool && !pool.length && kind === 'gang') pool = skins.filter((p) => SKIN_RE.boss.test(base(p)));
    if (!pool || !pool.length) {
      if (kind === 'cop' || kind === 'gang') exact = false;
      pool = skins.filter((p) => !special.some((re) => re.test(base(p))));
      if (!pool.length) pool = skins;
    }
    const path = kind === 'player' ? pool[0] : pool[Math.floor(Math.random() * pool.length)];
    const tex = this._skinTex.get(path);
    return tex ? { tex, exact } : null;
  },
};

// ---- template building ------------------------------------------------------------------------

function buildCarTemplate(gltf, file) {
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const axis = size.x > size.z ? 'x' : 'z';
  const len = size[axis];
  // cabin / roof mass sits behind the middle on almost every vehicle: the front is the other way
  const v = new THREE.Vector3();
  let sum = 0, n = 0;
  const yCut = box.min.y + size.y * 0.62;
  for (const m of meshesOf(model)) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y > yCut) { sum += v[axis] - ctr[axis]; n++; }
    }
  }
  const off = n ? sum / n : 0;
  // Kenney trucks / flatbeds have the cab at the front (roof mass ahead of the middle) so the heuristic would flip them;
  // every Kenney Car Kit model faces +Z natively, so trust that for the truck-like files.
  const sign = axis === 'z' && TRUCKISH.test(file.toLowerCase()) ? 1 : off > len * 0.01 ? -1 : 1;
  const theta = axis === 'z' ? (sign > 0 ? 0 : Math.PI) : (sign > 0 ? -Math.PI / 2 : Math.PI / 2);
  const spin = axis === 'z' ? { ax: 'x', sg: sign } : { ax: 'z', sg: -sign };

  const pivot = new THREE.Group();
  pivot.rotation.y = theta;
  pivot.add(model);
  const holder = new THREE.Group();
  holder.add(pivot);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder, true);
  pivot.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  holder.updateMatrixWorld(true);
  const fin = new THREE.Box3().setFromObject(holder, true).getSize(new THREE.Vector3());

  // spin-able wheels: named nodes whose origin is their own centre and that carry no rotation
  const wheelNames = new Set();
  holder.traverse((o) => {
    if (!o.name || !/wheel/i.test(o.name) || wheelNames.has(o.parent && o.parent.name)) return;
    const b = new THREE.Box3().setFromObject(o, true), c = b.getCenter(new THREE.Vector3());
    const wp = o.getWorldPosition(new THREE.Vector3());
    const sz = Math.max(b.getSize(new THREE.Vector3()).y, 0.01);
    const identity = Math.abs(o.quaternion.w) > 0.999;
    if (identity && c.distanceTo(wp) < sz * 0.15) wheelNames.add(o.name);
  });
  const bodyMat = largestMaterial(model);
  return { holder, length: fin.z || 1, height: fin.y, bodyMat, wheelNames, spin, file };
}

// ---- character packs: bones, clips, retargeting, guns -------------------------------------------

/** 'mixamorigRightHand' / 'Armature_RightHand' / 'hand.R' -> 'righthand' / 'righthand' / 'handr' (lower case, letters and digits only). */
const normBone = (n) => String(n || '').toLowerCase().replace(/^(mixamorig\d*|armature|bip\d*)[_:.]?/, '').replace(/[^a-z0-9]/g, '');
const looseName = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const FINGER = /thumb|index|middle|ring|pinky|finger/;
/** Bone-name patterns, tested against normBone(name), best first. */
const HAND_R = [/^righthand$/, /^handr(ight)?$/, /^rhand$/, /^handright$/, /righthand$/, /^armright$/, /^right(fore|lower)?arm$/, /^r(fore|lower)arm$/];
const HAND_L = [/^lefthand$/, /^handl(eft)?$/, /^lhand$/, /^handleft$/, /lefthand$/, /^armleft$/, /^left(fore|lower)?arm$/, /^l(fore|lower)arm$/];
const HAND_R_LAST = /hand.*r|righthand|handright/, HAND_L_LAST = /hand.*l|lefthand|handleft/;
const SPINE_RES = [/^spine2$/, /^spine0?3$/, /^chest$/, /upperchest/, /upperbody/, /^spine0?2$/, /^spine1$/, /^torso$/, /spine/];
const ROOTISH = /^(hips|pelvis|root)$/;
const ALIASES = { sprint: 'run', jog: 'run', die: 'death', dying: 'death', dead: 'death', aim: 'shoot', fire: 'shoot', dive: 'prone', roll: 'prone', crouch: null };

function boneList(root) {
  const out = [];
  root.traverse((o) => { if (o.isBone) out.push(o); });
  return out;
}

/** A bone by pack.json override (exact name ignoring punctuation/case, else a regex) or by the default patterns. */
function pickBone(bones, override, patterns, last, avoid) {
  if (override) {
    const want = looseName(override);
    let hit = bones.find((b) => looseName(b.name) === want);
    if (!hit) { try { const re = new RegExp(String(override), 'i'); hit = bones.find((b) => re.test(b.name)); } catch (e) { /* not a regex */ } }
    if (hit) return hit;
    console.warn(`assets: pack.json bone "${override}" not found; using the default match`);
  }
  for (const re of patterns) { const hit = bones.find((b) => re.test(normBone(b.name))); if (hit) return hit; }
  if (last) return bones.find((b) => last.test(normBone(b.name)) && !FINGER.test(normBone(b.name)) && !(avoid && avoid.test(normBone(b.name)))) || null;
  return null;
}

/** Clip lookup in one list: pack.json mapping (exact name, /regex/ or substring, case-insensitive) or the default regexes. */
function findClip(clips, key, mapped) {
  if (mapped) {
    const w = String(mapped).trim(), lw = w.toLowerCase();
    let hit = clips.find((c) => c.name.toLowerCase() === lw);
    if (!hit) {
      const m = /^\/(.+)\/([a-z]*)$/.exec(w);
      try { hit = m ? clips.find((c) => new RegExp(m[1], m[2] || 'i').test(c.name)) : clips.find((c) => c.name.toLowerCase().includes(lw)); } catch (e) { hit = null; }
    }
    return hit || null;
  }
  const names = clips.map((c) => c.name);
  const name = findByRegexes(names, CLIP_PICK[key]);
  return name ? clips.find((c) => c.name === name) : null;
}

/**
 * Re-bind a library clip onto a model's skeleton. Tracks are matched by node name; names that differ only by a prefix
 * ("mixamorig:", "Armature_") match through normBone. Position/scale tracks are dropped (different proportions would
 * deform the rig) except the root/hips bob, whose horizontal travel is flattened (in place) and height rescaled.
 * Returns null when the clip's skeleton does not match the model.
 */
function retargetClip(clip, ctx) {
  const tracks = [], nodes = new Set(), hit = new Set();
  for (const tr of clip.tracks) {
    const i = tr.name.indexOf('.');
    if (i < 0) continue;
    const node = tr.name.slice(0, i), prop = tr.name.slice(i);
    nodes.add(node);
    const target = ctx.names.has(node) ? node : ctx.byNorm.get(normBone(node));
    if (!target) continue;
    hit.add(node);
    if (prop === '.scale') continue;
    const t = tr.clone();
    t.name = target + prop;
    if (prop === '.position') {
      if (!ROOTISH.test(normBone(target))) continue;
      const v = t.values;
      for (let k = 0; k < v.length; k += 3) { v[k + 1] *= ctx.ratio; v[k] = v[0]; v[k + 2] = v[2]; }
    }
    tracks.push(t);
  }
  if (!nodes.size || hit.size < nodes.size * 0.5 || !tracks.length) return null;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Choose the clip for each role. Sources are tried in order (animation libraries retargeted onto this model first,
 * then the model's own clips). packClips is pack.json "clips": { role: clip name | /regex/ }.
 */
function pickClips(sources, packClips, ctxWarn) {
  const map = {};
  for (const [k, v] of Object.entries(packClips || {})) {
    const key = Object.prototype.hasOwnProperty.call(CLIP_PICK, k) ? k : ALIASES[k];
    if (key && v) map[key] = v;
  }
  const out = {};
  for (const key of Object.keys(CLIP_PICK)) {
    let clip = null;
    for (const mapped of map[key] ? [map[key], null] : [null]) {
      let found = false;
      for (const src of sources) {
        const raw = findClip(src.clips, key, mapped);
        if (!raw) continue;
        found = true;
        clip = src.ctx ? retargetClip(raw, src.ctx) : raw;
        if (!clip && ctxWarn) ctxWarn(src, raw);
        if (clip) break;
      }
      if (clip) break;
      if (mapped && !found) console.warn(`assets: pack.json maps ${key} -> "${mapped}" but no such clip exists; using the default match`);
    }
    out[key] = clip;
  }
  const any = sources.flatMap((s) => (s.ctx ? [] : s.clips));
  if (!out.idle) out.idle = any[0] || null;
  if (!out.walk) out.walk = null;
  for (const sk of ['shoot2', 'shoot', 'melee', 'melee2']) {
    if (!out[sk]) continue;
    // upper body only so the legs keep walking while the arms aim
    const upper = out[sk].clone();
    upper.name = out[sk].name + '-upper';
    const keep = upper.tracks.filter((t) => { const n = normBone(t.name.split('.')[0]); return UPPER_RE.test(n) && !LOWER_RE.test(n); });
    if (keep.length) upper.tracks = keep;
    out[sk] = upper;
  }
  if (out.shoot || out.melee) {
    // Locomotion clips are split into a lower and an upper-body part (clip + 'U') so the aim pose can replace the arms
    // instead of being averaged with the idle / walk arms: the upper parts play at weight * (1 - aim weight).
    const done = new Map();
    for (const k of ['idle', 'walk', 'run', 'jump']) {
      const c = out[k];
      if (!c) continue;
      if (!done.has(c)) {
        const isUp = (t) => { const n = normBone(t.name.split('.')[0]); return UPPER_RE.test(n) && !LOWER_RE.test(n); };
        const up = c.tracks.filter(isUp), lo = c.tracks.filter((t) => !isUp(t));
        done.set(c, up.length && lo.length ? [new THREE.AnimationClip(c.name, c.duration, lo), new THREE.AnimationClip(c.name + '-upper', c.duration, up)] : null);
      }
      const parts = done.get(c);
      if (parts) { out[k] = parts[0]; out[k + 'U'] = parts[1]; }
    }
  }
  return out;
}

// -- guns: procedural meshes, barrel along +z, grip at the origin, sizes in metres --
const _gunGeo = new Map();
const gunGeo = (key, make) => { let g = _gunGeo.get(key); if (!g) { g = make(); _gunGeo.set(key, g); } return g; };
const box = (w, h, d) => gunGeo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const tube = (r, len, seg = 8, r2 = r) => gunGeo(`c${r},${r2},${len},${seg}`, () => { const g = new THREE.CylinderGeometry(r2, r, len, seg); g.rotateX(Math.PI / 2); return g; });
const GUN_MATS = {};
const gunMat = (c) => GUN_MATS[c] || (GUN_MATS[c] = new THREE.MeshLambertMaterial({ color: c }));
const GUN_BUILDERS = {
  pistol: (add) => {
    add(box(0.034, 0.05, 0.2), '#2b2b30', 0, 0.035, 0.07);
    add(box(0.03, 0.085, 0.05), '#4b3a2a', 0, -0.02, -0.01, -0.2);
  },
  uzi: (add) => {
    add(box(0.05, 0.075, 0.28), '#2b2b30', 0, 0.02, 0.07);
    add(box(0.03, 0.13, 0.045), '#222226', 0, -0.09, 0.03);
    add(box(0.03, 0.08, 0.045), '#4b3a2a', 0, -0.05, -0.04, -0.2);
    add(tube(0.012, 0.12), '#1a1a1d', 0, 0.03, 0.27);
  },
  shotgun: (add) => {
    add(tube(0.017, 0.68), '#2b2b30', 0, 0.035, 0.34);
    add(tube(0.014, 0.4), '#3a3a40', 0, -0.005, 0.28);
    add(box(0.045, 0.06, 0.2), '#2b2b30', 0, 0.02, 0.0);
    add(box(0.04, 0.09, 0.3), '#6a4a2a', 0, 0.0, -0.24, 0.12);
    add(box(0.035, 0.07, 0.05), '#6a4a2a', 0, -0.05, 0.0);
  },
  flame: (add) => {
    add(tube(0.075, 0.42, 10), '#b23a2a', 0, 0.09, -0.28);
    add(tube(0.03, 0.06, 8), '#555', 0, 0.09, -0.04);
    add(tube(0.02, 0.42), '#2b2b30', 0, 0.03, 0.22);
    add(tube(0.032, 0.07, 8, 0.02), '#ff8a1c', 0, 0.03, 0.46);
    add(box(0.035, 0.09, 0.045), '#222226', 0, -0.05, 0.02);
  },
  rocket: (add) => {
    add(tube(0.07, 0.95, 10), '#4b5a3a', 0, 0.06, 0.12);
    add(tube(0.09, 0.12, 10, 0.07), '#3b4a2a', 0, 0.06, 0.64);
    add(tube(0.045, 0.1, 8, 0.07), '#222226', 0, 0.06, -0.38);
    add(box(0.035, 0.09, 0.045), '#222226', 0, -0.03, 0.05);
  },
  // katana: wrapped grip at the origin, round guard, long slightly flattened blade along +z (tip at ~0.95 m)
  sword: (add) => {
    add(tube(0.016, 0.24, 6), '#1c1c24', 0, 0, 0.0);
    add(box(0.034, 0.036, 0.02), '#d4af37', 0, 0, 0.0, 0);
    add(tube(0.045, 0.012, 10), '#c9a227', 0, 0, 0.13);
    add(box(0.018, 0.04, 0.74), '#f2f6fa', 0, 0.004, 0.51);
    add(box(0.022, 0.012, 0.74), '#b8c4d0', 0, 0.026, 0.51);
    add(box(0.006, 0.028, 0.06), '#f4f8fb', 0, 0.004, 0.9);
  },
  // sticky stick grenade: wooden handle with a metal can on the end and a blinking light
  grenade: (add) => {
    add(tube(0.02, 0.26, 6), '#8a5a2b', 0, 0, 0.02);
    add(tube(0.055, 0.14, 8), '#4d5a4a', 0, 0, 0.19);
    add(tube(0.058, 0.025, 8), '#222', 0, 0, 0.19);
    add(box(0.02, 0.02, 0.02), '#c0392b', 0, 0.06, 0.19);
  },
};
function makeGunMesh(kind) {
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, gunMat(color));
    m.position.set(x, y, z); m.rotation.x = rx; g.add(m);
  };
  (GUN_BUILDERS[kind] || GUN_BUILDERS.pistol)(add);
  if (kind === 'sword') g.rotation.x = -0.55;   // carried with the tip raised
  return g;
}

/** Built-in grip offsets for known rigs (bone-local, metres / degrees); pack.json gunOffset wins. */
const GUN_PRESETS = [
  // Kenney Mini Characters: no hand bone, the arm bone carries the hand at its far end
  // (the arm bone points along -x / +x in its own frame and the hand sits about 0.6 m out; the barrel follows the arm)
  { test: /^arm(right|left)$/, scale: 1.7, right: { pos: [-0.56, 0, 0], rot: [0, -90, 0] }, left: { pos: [0.56, 0, 0], rot: [0, 90, 0] } },
];
const mirrorOffset = (o) => ({ pos: [-o.pos[0], o.pos[1], o.pos[2]], rot: [o.rot[0], -o.rot[1], -o.rot[2]] });
const validOffset = (o) => o && Array.isArray(o.pos) && o.pos.length === 3 && o.pos.every(Number.isFinite) && (!o.rot || (Array.isArray(o.rot) && o.rot.length === 3 && o.rot.every(Number.isFinite)));

/** Where a gun sits on a hand bone: { pos, quat, ws } in bone-local space (bone world scale compensated). */
function handMount(bone, offset) {
  if (!bone) return null;
  const sc = bone.getWorldScale(new THREE.Vector3());
  const ws = Math.max(1e-4, (sc.x + sc.y + sc.z) / 3);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  if (offset) {
    pos.fromArray(offset.pos).divideScalar(ws);
    const r = offset.rot || [0, 0, 0];
    quat.setFromEuler(new THREE.Euler(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180, 'XYZ'));
  } else {
    // unknown rig: point the barrel along the bone (towards its children, i.e. along the fingers)
    const dir = new THREE.Vector3();
    for (const k of bone.children) if (k.isBone) dir.add(k.position);
    if (dir.lengthSq() < 1e-12) dir.set(0, 1, 0); else dir.normalize();
    quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  }
  return { bone: bone.name, pos, quat, ws };
}

function buildCharacterTemplate(gltf, file, pack, libs = []) {
  const cfg = (pack && pack.config) || {};
  const model = gltf.scene;
  const spin = new THREE.Group();   // forward fix: models that look down -z / along x are turned to +z
  spin.add(model);
  const fwd = String(cfg.forward || '+z').replace(/\s/g, '').toLowerCase();
  spin.rotation.y = fwd === '-z' ? Math.PI : fwd === '+x' ? -Math.PI / 2 : fwd === '-x' ? Math.PI / 2 : 0;
  spin.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(spin, true);
  const size = box.getSize(new THREE.Vector3());
  const mult = Number(cfg.scale) > 0 ? Number(cfg.scale) : 1;
  const s = (1.75 / (size.y || 1)) * mult;   // every pack is normalised to 1.75 m with the feet at y = 0
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(s);
  inner.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  inner.add(spin);
  holder.add(inner);
  holder.updateMatrixWorld(true);
  if (pack && pack.config) model.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });   // bind-pose bounds can be off for foreign rigs

  // clip sources: retargeted animation libraries first, the model's own clips last
  const bones = boneList(model);
  const names = new Set(); model.traverse((o) => { if (o.name) names.add(o.name); });
  const byNorm = new Map(); for (const b of bones) if (!byNorm.has(normBone(b.name))) byNorm.set(normBone(b.name), b.name);
  const hips = bones.find((b) => /^(hips|pelvis)$/.test(normBone(b.name)));
  const sources = [];
  for (const lib of libs) {
    const lh = boneList(lib.scene).find((b) => /^(hips|pelvis)$/.test(normBone(b.name)));
    let ratio = hips && lh && Math.abs(lh.position.y) > 1e-6 ? Math.abs(hips.position.y) / Math.abs(lh.position.y) : 1;
    if (!(ratio > 0.2 && ratio < 5)) ratio = 1;
    sources.push({ clips: lib.animations, ctx: { names, byNorm, ratio }, lib: lib.file || 'animation library' });
  }
  if (gltf.animations && gltf.animations.length) sources.push({ clips: gltf.animations, ctx: null });
  const warned = pack ? (pack._warned || (pack._warned = new Set())) : new Set();
  const clips = pickClips(sources, cfg.clips, (src, raw) => {
    const k = src.lib + '|' + file;
    if (warned.has(k)) return;
    warned.add(k);
    const nodes = [...new Set(raw.tracks.map((t) => t.name.split('.')[0]))];
    console.warn(`assets: ${file}: animation library bones do not match this model's skeleton (clip "${raw.name}" binds ${nodes.slice(0, 4).join(', ')}... ; model has ${bones.slice(0, 4).map((b) => b.name).join(', ')}...). Falling back to the model's own clips / the next pack.`);
  });

  // hand / spine bones and the weapon mounts
  const bo = cfg.bones || {};
  const handR = pickBone(bones, bo.hand, HAND_R, HAND_R_LAST, /left/);
  const handL = pickBone(bones, bo.handLeft, HAND_L, HAND_L_LAST, /right/);
  const spine = pickBone(bones, bo.spine, SPINE_RES, null);
  const preset = handR ? GUN_PRESETS.find((p) => p.test.test(normBone(handR.name))) : null;
  let offR = validOffset(cfg.gunOffset) ? cfg.gunOffset : preset ? preset.right : null;
  let offL = validOffset(cfg.gunOffsetLeft) ? cfg.gunOffsetLeft : validOffset(cfg.gunOffset) ? mirrorOffset(cfg.gunOffset) : preset ? preset.left : null;
  if (cfg.gunOffset && !validOffset(cfg.gunOffset)) console.warn('assets: pack.json gunOffset needs {"pos":[x,y,z],"rot":[x,y,z]}');
  const gunScale = Number(cfg.gunScale) > 0 ? Number(cfg.gunScale) : preset ? preset.scale : 1;
  if (handR === handL) offL = null;
  return {
    holder, clips, height: 1.75 * mult, file, packDir: pack ? pack.dir : '',
    bones: { hand: handR ? handR.name : null, handL: handL && handL !== handR ? handL.name : null, spine: spine ? spine.name : null },
    mount: { r: handMount(handR, offR), l: handL && handL !== handR ? handMount(handL, offL) : null, scale: gunScale },
  };
}

// ---- loading ----------------------------------------------------------------------------------

/** Load one character pack: its animation libraries and models, built into templates. */
async function loadPack(pack, loadGltf) {
  const libPaths = [pack.animations, ...(pack.animationsExtra || [])].filter(Boolean);
  const libs = [];
  for (const [f, g] of await Promise.all(libPaths.map((f) => loadGltf(f).then((g) => [f, g])))) {
    if (g && g.animations && g.animations.length) { g.file = f; libs.push(g); }
    else console.warn(`assets: animation library ${f} could not be used (missing or no clips)`);
  }
  const loaded = await Promise.all(pack.models.slice(0, 24).map((f) => loadGltf(f).then((g) => [f, g])));
  const templates = [];
  let fallback = null;
  for (const [f, g] of loaded) {
    if (!g) continue;
    if ((g.animations && g.animations.length) || libs.length) {
      try {
        const t = buildCharacterTemplate(g, f, pack, libs);
        if (t.clips.idle) { templates.push(t); continue; }
        console.warn(`assets: ${f}: no usable idle clip (own or from the animation library); skipping this model`);
      } catch (e) { console.warn('assets: bad character model', f, e); }
    }
    if (!fallback) fallback = g;
  }
  return { templates, fallback };
}

let promise = null;

export function loadAssets() {
  if (!promise) promise = doLoad();
  return promise;
}

async function doLoad() {
  let manifest = null;
  try {
    const r = await fetch(assetUrl('assets/manifest.json'), { cache: 'no-cache' });
    if (r.ok) manifest = await r.json();
  } catch (e) { manifest = null; }   // missing manifest (or SPA fallback html) -> procedural fallback
  if (!manifest || typeof manifest !== 'object') manifest = {};
  manifest = { cars: manifest.cars || [], characters: manifest.characters || [], characterPacks: manifest.characterPacks, skins: manifest.skins || [], sfx: manifest.sfx || {}, voice: manifest.voice };
  // older manifests only list the flat character files: treat them as one priority-0 pack
  if (!Array.isArray(manifest.characterPacks)) manifest.characterPacks = manifest.characters.length ? [{ dir: '', priority: 0, config: null, models: manifest.characters, animations: null, skins: manifest.skins }] : [];
  ASSETS.manifest = manifest;
  const loader = new GLTFLoader();
  const loadGltf = (p) => loader.loadAsync(assetUrl(p)).catch((e) => { console.warn('assets: could not load', p, e && e.message ? e.message : e); return null; });

  // cars: load each distinct file once, share the template between the types that map to it
  const files = new Map();
  for (const key of Object.keys(CAR_PICK)) {
    const f = findByRegexes(manifest.cars, CAR_PICK[key], base, NOT_A_CAR);
    if (f) files.set(key, f);
  }
  const variantFiles = new Map();
  for (const key of Object.keys(CAR_VARIANTS)) {
    const fs = manifest.cars.filter((f) => CAR_VARIANTS[key].test(base(f)) && !NOT_A_CAR.test(base(f))).sort();
    if (fs.length) variantFiles.set(key, fs);
  }
  const templates = new Map();
  await Promise.all([...new Set([...files.values(), ...[...variantFiles.values()].flat()])].map(async (f) => {
    const g = await loadGltf(f);
    if (!g) return;
    try { templates.set(f, buildCarTemplate(g, f)); } catch (e) { console.warn('assets: bad car model', f, e); }
  }));
  for (const [key, f] of files) if (templates.has(f)) ASSETS._cars.set(key, templates.get(f));
  for (const [key, fs] of variantFiles) {
    const list = fs.filter((f) => templates.has(f)).map((f) => templates.get(f));
    if (list.length) { ASSETS._variants.set(key, list); ASSETS._cars.set(key, list[0]); }
  }

  // characters: packs by priority (highest first); the first pack that yields a usable (animated) model wins.
  // Unrigged models are only a last resort.
  const packs = manifest.characterPacks
    .filter((p) => p && Array.isArray(p.models) && p.models.length)
    .map((p) => ({ dir: p.dir || '', priority: Number(p.priority) || 0, config: p.config && typeof p.config === 'object' ? p.config : null, models: p.models, animations: p.animations || null, animationsExtra: p.animationsExtra || [], skins: Array.isArray(p.skins) ? p.skins : [] }))
    .sort((a, b) => b.priority - a.priority);
  let fallbackChar = null, winner = null;
  for (const pack of packs) {
    const r = await loadPack(pack, loadGltf);
    if (r.templates.length) { ASSETS._chars.push(...r.templates); winner = pack; break; }
    console.warn(`assets: character pack ${pack.dir || '(loose files)'} has no usable animated model` + (packs.indexOf(pack) < packs.length - 1 ? '; trying the next pack' : ''));
    if (!fallbackChar && r.fallback) fallbackChar = { g: r.fallback, pack };
  }
  if (winner) ASSETS._char = ASSETS._chars[0];
  else if (fallbackChar) { winner = fallbackChar.pack; ASSETS._char = buildCharacterTemplate(fallbackChar.g, '', winner); ASSETS._chars.push(ASSETS._char); }
  ASSETS.pack = winner ? { dir: winner.dir, priority: winner.priority, config: winner.config } : null;

  ASSETS._skins = [];
  if (ASSETS._char) {
    // texture swaps only suit packs that were made for it (Mini Characters); packs with a pack.json opt in via "skins"
    const cfg = winner.config || {};
    const sk = cfg.skins === undefined ? !winner.config : cfg.skins;
    const want = sk === true ? winner.skins : Array.isArray(sk) ? winner.skins.filter((p) => sk.some((n) => base(p) === String(n).toLowerCase().replace(/\.[^.]+$/, ''))) : [];
    const tl = new THREE.TextureLoader();
    await Promise.all(want.map((p) => new Promise((res) => {
      tl.load(assetUrl(p), (t) => {
        t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
        ASSETS._skinTex.set(p, t); res();
      }, undefined, () => res());
    })));
    ASSETS._skins = want.filter((p) => ASSETS._skinTex.has(p));
  }
  manifest.skins = ASSETS._skins;

  ASSETS.counts = { cars: new Set([...ASSETS._cars.values()]).size, characters: ASSETS._chars.length, sfx: Object.keys(manifest.sfx).length };
  const c = ASSETS.counts, total = c.cars + c.characters + c.sfx;
  const missing = !c.cars || !c.characters || !c.sfx;
  console.info(`assets: ${c.cars} cars, ${c.characters} characters${ASSETS.pack && ASSETS.pack.dir ? ' (pack ' + ASSETS.pack.dir.replace(/^assets\/characters\//, '') + ')' : ''}, ${c.sfx} sfx` + (total === 0 ? ' (procedural fallback)' : missing ? ' (procedural fallback for the rest)' : ''));
  ASSETS.ready = true;
  return ASSETS;
}
