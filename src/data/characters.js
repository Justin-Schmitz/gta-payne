/**
 * Playable characters. `model` is a regex on the character-pack file name, `tint` colours the
 * whole model (the packs share one colour map), `scale` multiplies the normalised 1.75 m height.
 * Perks are multipliers unless noted.
 */
export const CHARACTERS = {
  wendy: {
    id: 'wendy', name: 'WOKE-WENDY', initials: 'WW', color: '#7ed957',
    model: /female-a/, tint: '#9af07a', scale: 1.0,
    tagline: 'Cancelled the mob on social media. Now cancelling them for real.',
    perk: 'Bullet time refills 50% faster · starts with 3 painkillers',
    btRegen: 1.5, damageTaken: 1, speed: 1, cashMult: 1, priceMult: 1,
    startPainkillers: 3, startArmor: 0, startCash: 0, meleeMult: 1,
  },
  beefcake: {
    id: 'beefcake', name: 'BEEFCAKE', initials: 'BC', color: '#e8a15a',
    model: /male-b/, tint: '#f2b27a', scale: 1.18,
    tagline: 'Protein, pistols, no plan.',
    perk: 'Takes 25% less damage · fists hit 2× · starts with 50 armour',
    btRegen: 1, damageTaken: 0.75, speed: 0.95, cashMult: 1, priceMult: 1,
    startPainkillers: 1, startArmor: 50, startCash: 0, meleeMult: 2,
  },
  mike: {
    id: 'mike', name: 'MIKE HUNT', initials: 'MH', color: '#6fa8ff',
    model: /male-d/, tint: '#8fb4ff', scale: 1.0,
    tagline: 'Private investigator. Nobody says his name twice.',
    perk: '+25% cash from everything · starts with $2,000',
    btRegen: 1, damageTaken: 1, speed: 1, cashMult: 1.25, priceMult: 1,
    startPainkillers: 1, startArmor: 0, startCash: 2000, meleeMult: 1,
  },
  seymour: {
    id: 'seymour', name: 'SEYMOUR BUTTS', initials: 'SB', color: '#ff7eb6',
    model: /male-e/, tint: '#ffb3d6', scale: 1.0,
    tagline: "Former proctologist. Now he's got the whole city's back end.",
    perk: 'Runs 15% faster · guns and cars 15% cheaper',
    btRegen: 1, damageTaken: 1, speed: 1.15, cashMult: 1, priceMult: 0.85,
    startPainkillers: 1, startArmor: 0, startCash: 0, meleeMult: 1,
  },
};
export const CHARACTER_ORDER = ['wendy', 'beefcake', 'mike', 'seymour'];
export const getCharacter = (id) => CHARACTERS[id] || CHARACTERS.mike;
