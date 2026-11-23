import type { SeededRng } from '../rng.ts';
import type { EnemyArchetype } from '../types.ts';

export type EnemyAIState =
  | 'spawning'
  | 'chase'
  | 'telegraph'
  | 'attack'
  | 'recover'
  | 'staggered';

export type EnemyAttackKind =
  | 'none'
  | 'lunge'
  | 'shoot'
  | 'charge'
  | 'boss_radial'
  | 'boss_leap'
  | 'blink_fan'
  | 'ice_mortar'
  | 'drop_bomb'
  | 'tank_burst'
  | 'ricochet_charge';

export type EnemyEntity = {
  id: number;
  archetype: EnemyArchetype;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  speed: number;
  damage: number;
  coinDrop: number;
  state: EnemyAIState;
  stateTimer: number;
  attackKind: EnemyAttackKind;
  telegraphDuration: number;
  aimAngle: number;
  targetX: number;
  targetY: number;
  hitFlashTimer: number;
  spawnShieldTimer: number;
  phase: 1 | 2;
  didPhaseAddSpawn: boolean;
  bossPatternIndex: number;
  telegraphLocked: boolean;
  attackFired: boolean;
  goldenBurstCount: number;
  dashTagTimer: number;
  burstLeft: number;
  burstCooldown: number;
  bouncesLeft: number;
};

type EnemyBaseSpec = {
  baseHp: number;
  radius: number;
  armor: number;
  speed: number;
  damage: number;
  coinDrop: number;
  spawnTime: number;
  telegraphDuration: number;
  aimAngle?: number;
};

const ENEMY_SPECS: Record<EnemyArchetype, EnemyBaseSpec> = {
  chaser: {
    baseHp: 44,
    radius: 15,
    armor: 0,
    speed: 148,
    damage: 12,
    coinDrop: 1,
    spawnTime: 0.55,
    telegraphDuration: 0.48,
  },
  shooter: {
    baseHp: 38,
    radius: 15,
    armor: 0,
    speed: 108,
    damage: 14,
    coinDrop: 2,
    spawnTime: 0.55,
    telegraphDuration: 0.6,
  },
  charger: {
    baseHp: 86,
    radius: 20,
    armor: 0,
    speed: 112,
    damage: 18,
    coinDrop: 3,
    spawnTime: 0.55,
    telegraphDuration: 0.62,
  },
  elite_charger: {
    baseHp: 215,
    radius: 25,
    armor: 3,
    speed: 118,
    damage: 22,
    coinDrop: 6,
    spawnTime: 0.65,
    telegraphDuration: 0.62,
  },
  boss: {
    baseHp: 620,
    radius: 34,
    armor: 0,
    speed: 96,
    damage: 22,
    coinDrop: 14,
    spawnTime: 0.75,
    telegraphDuration: 0.6,
    aimAngle: Math.PI / 2,
  },
  shade: {
    baseHp: 46,
    radius: 15,
    armor: 0,
    speed: 112,
    damage: 13,
    coinDrop: 2,
    spawnTime: 0.55,
    telegraphDuration: 0.52,
  },
  yeti: {
    baseHp: 96,
    radius: 19,
    armor: 0,
    speed: 88,
    damage: 16,
    coinDrop: 3,
    spawnTime: 0.55,
    telegraphDuration: 0.65,
  },
  bomber: {
    baseHp: 56,
    radius: 15,
    armor: 0,
    speed: 142,
    damage: 16,
    coinDrop: 2,
    spawnTime: 0.55,
    telegraphDuration: 0.42,
  },
  mortar_tank: {
    baseHp: 115,
    radius: 20,
    armor: 2,
    speed: 78,
    damage: 14,
    coinDrop: 3,
    spawnTime: 0.55,
    telegraphDuration: 0.65,
  },
  stampede: {
    baseHp: 88,
    radius: 18,
    armor: 0,
    speed: 128,
    damage: 18,
    coinDrop: 2,
    spawnTime: 0.55,
    telegraphDuration: 0.55,
  },
};

export function createEnemy(
  id: number,
  archetype: EnemyArchetype,
  x: number,
  y: number,
  hpScale: number,
  enemyHpMult: number,
  enemySpeedMult: number,
  enemyDamageMult: number,
): EnemyEntity {
  const spec = ENEMY_SPECS[archetype];
  const hp = Math.round(spec.baseHp * hpScale * enemyHpMult);
  return {
    id,
    archetype,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: spec.radius,
    hp,
    maxHp: hp,
    armor: spec.armor,
    maxArmor: spec.armor,
    speed: spec.speed * enemySpeedMult,
    damage: Math.round(spec.damage * enemyDamageMult),
    coinDrop: spec.coinDrop,
    state: 'spawning',
    stateTimer: spec.spawnTime,
    attackKind: 'none',
    telegraphDuration: spec.telegraphDuration,
    aimAngle: spec.aimAngle ?? 0,
    targetX: x,
    targetY: y,
    hitFlashTimer: 0,
    spawnShieldTimer: spec.spawnTime,
    phase: 1,
    didPhaseAddSpawn: false,
    bossPatternIndex: 0,
    telegraphLocked: false,
    attackFired: false,
    goldenBurstCount: 0,
    dashTagTimer: 0,
    burstLeft: 0,
    burstCooldown: 0,
    bouncesLeft: 0,
  };
}

export function chooseBossPattern(
  boss: EnemyEntity,
  bossRng: SeededRng,
): 'boss_radial' | 'boss_leap' {
  boss.bossPatternIndex += 1;
  if (boss.bossPatternIndex % 2 === 1) {
    return bossRng.next() < 0.55 ? 'boss_radial' : 'boss_leap';
  }
  return boss.attackKind === 'boss_radial' ? 'boss_leap' : 'boss_radial';
}
