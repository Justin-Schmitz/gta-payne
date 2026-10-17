import { HALF, ROAD, P } from '../world/city.js';

/**
 * Gangs and their territories. Blocks are indexed (bx, bz) 0..9, z grows southward.
 * Residential north-centre and the hospital/police blocks are neutral.
 */
export const GANGS = {
  cinelli: {
    name: 'Cinelli Family', zone: 'Downtown', color: '#d9b24c', boss: 'cinelli',
    blocks: [{ x0: 3, x1: 6, z0: 2, z1: 6 }, { x0: 3, x1: 6, z0: 9, z1: 9 }],
    weapons: ['pistol', 'pistol', 'uzi'],
  },
  crows: {
    name: 'Hollow Crows', zone: 'Eastside', color: '#7c4dff', boss: 'crows',
    blocks: [{ x0: 7, x1: 9, z0: 0, z1: 9 }],
    weapons: ['pistol', 'uzi', 'uzi', 'sword'],
  },
  mal: {
    name: 'Mercy Street Saints', zone: 'Westside', color: '#ff5e5e', boss: 'mal',
    blocks: [{ x0: 0, x1: 2, z0: 0, z1: 9 }],
    weapons: ['pistol', 'shotgun'],
  },
};
export const GANG_IDS = Object.keys(GANGS);

/** Gang id owning block (bx,bz) or null. */
export function gangAt(bx, bz) {
  for (const id of GANG_IDS) {
    for (const r of GANGS[id].blocks) if (bx >= r.x0 && bx <= r.x1 && bz >= r.z0 && bz <= r.z1) return id;
  }
  return null;
}

/** Block index (0..9) containing a world coordinate. */
export const blockIndex = (v) => Math.max(0, Math.min(9, Math.floor((v + HALF - ROAD) / P)));
/** Gang id owning the block under world position (x,z) or null. */
export const gangAtXZ = (x, z) => gangAt(blockIndex(x), blockIndex(z));
