/**
 * Difficulty tuning. Every number is a multiplier on the Normal value unless noted; systems read
 * them through `game.diff` so a setting is applied in exactly one place per mechanic.
 *
 *  enemySpread     enemy aim spread (lower = more accurate)
 *  enemyDamage     damage the player takes from enemy weapons
 *  enemyHp         hit points of cops / gang members / bosses
 *  enemyFireRate   how often enemies shoot
 *  enemyCount      number of enemies spawned by kill missions (bosses stay single)
 *  heatGain        wanted heat added per crime
 *  heatDecay       how fast heat drains when no cop sees you
 *  copCars/copFoot police response size per wanted level
 *  btDrain/btRegen bullet-time meter speed
 *  prices          gun-shop prices
 *  reward          mission payout
 *  vehicleDamage   damage taken by the car you are driving
 *  turfHostile     respect (absolute) below which a gang attacks you in its own turf
 *  timeLimit       mission timers
 *  startAmmo       pistol rounds you start / respawn with (absolute)
 *  deathCost       fraction of cash lost when WASTED or BUSTED
 */
export const DIFFICULTY = {
  easy: {
    id: 'easy', label: 'EASY', blurb: 'Soft cops, sloppy gunmen, cheap guns. For a first night.',
    enemySpread: 1.5, enemyDamage: 0.65, enemyHp: 0.8, enemyFireRate: 0.8, enemyCount: 0.8,
    heatGain: 0.7, heatDecay: 1.6, copCars: 0.75, copFoot: 0.6,
    btDrain: 0.7, btRegen: 1.5, prices: 0.8, reward: 0.9, vehicleDamage: 0.7,
    turfHostile: -45, timeLimit: 1.25, startAmmo: 60, deathCost: 0,
  },
  normal: {
    id: 'normal', label: 'NORMAL', blurb: 'The intended balance.',
    enemySpread: 1, enemyDamage: 1, enemyHp: 1, enemyFireRate: 1, enemyCount: 1,
    heatGain: 1, heatDecay: 1, copCars: 1, copFoot: 1,
    btDrain: 1, btRegen: 1, prices: 1, reward: 1, vehicleDamage: 1,
    turfHostile: -25, timeLimit: 1, startAmmo: 40, deathCost: 0,
  },
  hard: {
    id: 'hard', label: 'HARD', blurb: 'Sharp shooters, relentless police, short timers, pricey guns. Dying costs 10% of your cash. Bigger payouts.',
    enemySpread: 0.6, enemyDamage: 1.5, enemyHp: 1.3, enemyFireRate: 1.35, enemyCount: 1.3,
    heatGain: 1.5, heatDecay: 0.6, copCars: 1.5, copFoot: 1.5,
    btDrain: 1.4, btRegen: 0.65, prices: 1.35, reward: 1.25, vehicleDamage: 1.35,
    turfHostile: -12, timeLimit: 0.8, startAmmo: 24, deathCost: 0.1,
  },
};
export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];
export const getDifficulty = (id) => DIFFICULTY[id] || DIFFICULTY.normal;
/** Round a shop price to a tidy number after scaling. */
export const scalePrice = (base, mult) => Math.max(10, Math.round((base * mult) / 10) * 10);
