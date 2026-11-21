import { createDailyStream } from './rng.ts';
import type { DailyModifier, DailyModifierId, HazardType } from './types.ts';

export const DAILY_MODIFIERS: Record<DailyModifierId, DailyModifier> = {
  glass_cannon: {
    id: 'glass_cannon',
    banner: 'Glass Cannon: 2x Damage',
    description: 'Player and enemy hits deal double damage.',
    playerDamageMult: 2,
    enemyDamageMult: 2,
    frictionMult: 1,
    attackCdMult: 1,
    attackDamageMult: 1,
    enemySpeedMult: 1,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: false,
  },
  slippery_floors: {
    id: 'slippery_floors',
    banner: 'Slippery Floors: Low Friction',
    description: 'Momentum carries further across slick arena stone.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 0.24,
    attackCdMult: 1,
    attackDamageMult: 1,
    enemySpeedMult: 1,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: false,
  },
  heavy_blade: {
    id: 'heavy_blade',
    banner: 'Heavy Blade: +45% Swing Dmg',
    description: 'Swings hit 45% harder with slightly slower recovery.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 1,
    attackCdMult: 1.35,
    attackDamageMult: 1.45,
    enemySpeedMult: 1,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: false,
  },
  volatile_foes: {
    id: 'volatile_foes',
    banner: 'Volatile Foes: Death Blasts',
    description: 'Slain enemies detonate after a short warning pulse.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 1,
    attackCdMult: 1,
    attackDamageMult: 1,
    enemySpeedMult: 1,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: true,
  },
  quick_blades: {
    id: 'quick_blades',
    banner: 'Quick Blades: Faster Swings',
    description: 'Attack recovery is 25% faster; foes move 15% quicker.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 1,
    attackCdMult: 0.75,
    attackDamageMult: 1,
    enemySpeedMult: 1.15,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: false,
  },
  golden_fever: {
    id: 'golden_fever',
    banner: 'Golden Fever: Rich Drops',
    description: 'Enemies drop +50% coins and gain +15% health.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 1,
    attackCdMult: 1,
    attackDamageMult: 1,
    enemySpeedMult: 1,
    enemyHpMult: 1.15,
    coinDropMult: 1.5,
    deathBlast: false,
  },
};

const MODIFIER_LIST = Object.values(DAILY_MODIFIERS);
const HAZARD_TYPES: readonly HazardType[] = ['spikes', 'barrels', 'currents'];

export function getDailyModifier(utcDate: string): DailyModifier {
  const rng = createDailyStream(utcDate, 'meta');
  return rng.pick(MODIFIER_LIST);
}

export function getDailyHazard(utcDate: string): HazardType {
  const rng = createDailyStream(utcDate, 'hazard');
  return rng.pick(HAZARD_TYPES);
}
