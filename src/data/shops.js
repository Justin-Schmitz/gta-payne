import { scalePrice } from './difficulty.js';
import { WEAPONS } from '../systems/combat.js';

/**
 * Gun-shop catalogue. Weapons: `price` buys the weapon with `ammo` units included; once owned the
 * same row sells a pack of `pack` units for `packPrice`. Armor is a one-off top-up; painkillers are +1 held
 * bottle (max 9, used with H); `dual` is the second pistol (needs the pistol, shares its ammo pool).
 */
export const SHOP_ITEMS = [
  { id: 'sword', type: 'melee', weapon: 'sword', price: 3000 },
  { id: 'pistol', type: 'weapon', weapon: 'pistol', price: 400, ammo: 20, pack: 20, packPrice: 100 },
  { id: 'dual', type: 'dual', weapon: 'dual', name: 'SECOND PISTOL', price: 600 },
  { id: 'uzi', type: 'weapon', weapon: 'uzi', price: 2500, ammo: 50, pack: 50, packPrice: 300 },
  { id: 'shotgun', type: 'weapon', weapon: 'shotgun', price: 1800, ammo: 16, pack: 16, packPrice: 250 },
  { id: 'flame', type: 'weapon', weapon: 'flame', price: 4000, ammo: 50, pack: 50, packPrice: 400 },
  { id: 'rocket', type: 'weapon', weapon: 'rocket', price: 9000, ammo: 3, pack: 1, packPrice: 600 },
  { id: 'grenade', type: 'weapon', weapon: 'grenade', price: 900, ammo: 3, pack: 3, packPrice: 900 },
  { id: 'armor', type: 'armor', name: 'ARMOR VEST', price: 1000, tier: 1 },
  { id: 'heavyarmor', type: 'armor', name: 'HEAVY ARMOR + HELMET', price: 2500, tier: 2 },
  { id: 'painkillers', type: 'painkillers', name: 'PAINKILLERS', price: 150 },
];
const MAX_AMMO = 999;

export const itemName = (it) => (it.type === 'weapon' || it.type === 'melee' ? WEAPONS[it.weapon].name : it.name);
const MAX_PILLS = 9;
export const ammoUnit = (it) => (it.weapon === 'flame' ? 'fuel' : it.weapon === 'rocket' ? 'rockets' : it.weapon === 'grenade' ? 'grenades' : 'rounds');

/** What the row's button would do right now: { price, label, enabled, sub }. */
export function quote(game, it) {
  const p = game.player, cash = game.score, mult = game.priceMult;
  if (it.type === 'weapon') {
    const have = p.weapons[it.weapon] !== undefined;
    const price = scalePrice(have ? it.packPrice : it.price, mult);
    const full = have && p.weapons[it.weapon] >= (WEAPONS[it.weapon].maxAmmo || MAX_AMMO);
    return {
      price,
      have,
      label: have ? `AMMO +${it.pack}` : 'BUY',
      sub: have ? `OWNED · ${Math.ceil(p.weapons[it.weapon])} ${ammoUnit(it)}` : `incl. ${it.ammo} ${ammoUnit(it)} · ammo pack +${it.pack} $${scalePrice(it.packPrice, mult).toLocaleString('en-US')}`,
      enabled: !full && cash >= price && !p.dead,
    };
  }
  const price = scalePrice(it.price, mult);
  if (it.type === 'melee') {
    const owned = p.weapons[it.weapon] !== undefined;
    return { price, have: owned, label: owned ? 'OWNED' : 'BUY', sub: owned ? 'SAMURAI SWORD · slot 2 · no ammo' : 'slot 2 · 120 dmg, 110 degree arc, 2.2 m · blocks bullets in bullet time', enabled: !owned && cash >= price && !p.dead };
  }
  if (it.type === 'dual') {
    const owned = !!p.weapons.dual;
    return { price, have: owned, label: owned ? 'OWNED' : 'BUY', sub: owned ? 'DUAL PISTOLS · slot 3 · shares pistol ammo' : p.weapons.pistol === undefined ? 'needs a pistol first' : 'second pistol incl. 20 rounds · slot 3, shares pistol ammo', enabled: !owned && p.weapons.pistol !== undefined && cash >= price && !p.dead };
  }
  if (it.type === 'painkillers') return { price, label: 'BUY +1', sub: `have ${p.painkillers} / ${MAX_PILLS} · heals 35 over 1.2 s (H)`, enabled: p.painkillers < MAX_PILLS && cash >= price && !p.dead };
  if (it.type === 'armor') { const cap = it.tier >= 2 ? 150 : 100; return { price, label: 'BUY', sub: `${it.tier >= 2 ? '150 pts, helmet halves head shots' : '100 pts'} · now ${Math.round(p.armor)}`, enabled: (p.armor < cap || p.armorTier < it.tier) && cash >= price && !p.dead }; }
  return { price, label: 'BUY', sub: `now ${Math.round(p.hp)}%`, enabled: p.hp < 100 && cash >= price && !p.dead };
}

/** Attempt a purchase. Returns true when it went through. Deducts from game.score (cash). */
export function buy(game, id) {
  const it = SHOP_ITEMS.find((x) => x.id === id);
  if (!it) return false;
  const q = quote(game, it);
  if (!q.enabled) return false;
  const p = game.player;
  game.score -= q.price;
  if (it.type === 'weapon') {
    p.giveWeapon(it.weapon, q.have ? it.pack : it.ammo);   // selects it when it is new
    game.hud.toast(q.have ? `${itemName(it)} AMMO +${it.pack}` : itemName(it));
  } else if (it.type === 'melee') { p.giveWeapon(it.weapon, 0); game.hud.toast(itemName(it)); }
  else if (it.type === 'dual') { p.giveWeapon('dual', 0); game.hud.toast('DUAL PISTOLS'); }
  else if (it.type === 'painkillers') { p.painkillers = Math.min(MAX_PILLS, p.painkillers + 1); game.hud.toast('PAINKILLERS +1'); }
  else if (it.type === 'armor') { p.giveArmor(it.tier || 1); game.hud.toast(itemName(it)); }
  else { p.hp = 100; game.hud.toast('HEALTH'); }
  if (game.audio.buy) game.audio.buy(); else game.audio.cash();
  return true;
}
