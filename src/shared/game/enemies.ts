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
  | 'boss_leap';

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
  const totalHpScale = hpScale * enemyHpMult;

  if (archetype === 'chaser') {
    const hp = Math.round(44 * totalHpScale);
    return {
      id,
      archetype,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 15,
      hp,
      maxHp: hp,
      armor: 0,
      maxArmor: 0,
      speed: 148 * enemySpeedMult,
      damage: Math.round(12 * enemyDamageMult),
      coinDrop: 3,
      state: 'spawning',
      stateTimer: 0.55,
      attackKind: 'none',
      telegraphDuration: 0.48,
      aimAngle: 0,
      targetX: x,
      targetY: y,
      hitFlashTimer: 0,
      spawnShieldTimer: 0.55,
      phase: 1,
      didPhaseAddSpawn: false,
      bossPatternIndex: 0,
      telegraphLocked: false,
      attackFired: false,
      goldenBurstCount: 0,
      dashTagTimer: 0,
    };
  }

  if (archetype === 'shooter') {
    const hp = Math.round(38 * totalHpScale);
    return {
      id,
      archetype,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 15,
      hp,
      maxHp: hp,
      armor: 0,
      maxArmor: 0,
      speed: 108 * enemySpeedMult,
      damage: Math.round(14 * enemyDamageMult),
      coinDrop: 4,
      state: 'spawning',
      stateTimer: 0.55,
      attackKind: 'none',
      telegraphDuration: 0.60,
      aimAngle: 0,
      targetX: x,
      targetY: y,
      hitFlashTimer: 0,
      spawnShieldTimer: 0.55,
      phase: 1,
      didPhaseAddSpawn: false,
      bossPatternIndex: 0,
      telegraphLocked: false,
      attackFired: false,
      goldenBurstCount: 0,
      dashTagTimer: 0,
    };
  }

  if (archetype === 'charger') {
    const hp = Math.round(86 * totalHpScale);
    return {
      id,
      archetype,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 20,
      hp,
      maxHp: hp,
      armor: 0,
      maxArmor: 0,
      speed: 112 * enemySpeedMult,
      damage: Math.round(18 * enemyDamageMult),
      coinDrop: 6,
      state: 'spawning',
      stateTimer: 0.55,
      attackKind: 'none',
      telegraphDuration: 0.62,
      aimAngle: 0,
      targetX: x,
      targetY: y,
      hitFlashTimer: 0,
      spawnShieldTimer: 0.55,
      phase: 1,
      didPhaseAddSpawn: false,
      bossPatternIndex: 0,
      telegraphLocked: false,
      attackFired: false,
      goldenBurstCount: 0,
      dashTagTimer: 0,
    };
  }

  if (archetype === 'elite_charger') {
    const hp = Math.round(215 * totalHpScale);
    return {
      id,
      archetype,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 25,
      hp,
      maxHp: hp,
      armor: 3,
      maxArmor: 3,
      speed: 118 * enemySpeedMult,
      damage: Math.round(22 * enemyDamageMult),
      coinDrop: 14,
      state: 'spawning',
      stateTimer: 0.65,
      attackKind: 'none',
      telegraphDuration: 0.62,
      aimAngle: 0,
      targetX: x,
      targetY: y,
      hitFlashTimer: 0,
      spawnShieldTimer: 0.65,
      phase: 1,
      didPhaseAddSpawn: false,
      bossPatternIndex: 0,
      telegraphLocked: false,
      attackFired: false,
      goldenBurstCount: 0,
      dashTagTimer: 0,
    };
  }

  const hp = Math.round(620 * totalHpScale);
  return {
    id,
    archetype: 'boss',
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 34,
    hp,
    maxHp: hp,
    armor: 0,
    maxArmor: 0,
    speed: 96 * enemySpeedMult,
    damage: Math.round(22 * enemyDamageMult),
    coinDrop: 30,
    state: 'spawning',
    stateTimer: 0.75,
    attackKind: 'none',
    telegraphDuration: 0.60,
    aimAngle: Math.PI / 2,
    targetX: x,
    targetY: y,
    hitFlashTimer: 0,
    spawnShieldTimer: 0.75,
    phase: 1,
    didPhaseAddSpawn: false,
    bossPatternIndex: 0,
    telegraphLocked: false,
    attackFired: false,
    goldenBurstCount: 0,
    dashTagTimer: 0,
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
