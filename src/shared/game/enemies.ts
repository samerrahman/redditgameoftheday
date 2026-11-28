import type { SeededRng } from '../rng.ts';
import type { EnemyArchetype } from '../types.ts';

export type EnemyAIState =
  | 'spawning'
  | 'chase'
  | 'telegraph'
  | 'attack'
  | 'recover'
  | 'staggered';

export type BossBaseArchetype = Exclude<EnemyArchetype, 'boss'>;

export type EnemyAttackKind =
  | 'none'
  | 'lunge'
  | 'shoot'
  | 'charge'
  | 'boss_radial'
  | 'boss_leap'
  | 'shade_fan'
  | 'ice_mortar'
  | 'drop_bomb'
  | 'tank_burst'
  | 'ricochet_charge'
  | 'spore_burst'
  | 'imp_dart'
  | 'shoot_arrow'
  | 'spore_lob'
  | 'imp_swoop'
  | 'arrow_volley'
  | 'throw_bomb'
  | 'quake_slam'
  | 'arcane_ring'
  | 'shade_ring'
  | 'frost_rush'
  | 'tank_shell'
  | 'arcane_bolt'
  | 'arcane_rune'
  | 'blink_nova'
  | 'slime_split'
  | 'coin_spit'
  | 'chomp_chain'
  | 'boulder_toss'
  | 'warden_sweep'
  | 'phase_strike'
  | 'icicle_rain'
  | 'bomb_ring'
  | 'bomb_line'
  | 'tank_crush'
  | 'stomp_quake'
  | 'mushroom_ring'
  | 'ember_nova'
  | 'arrow_rain'
  | 'snipe';

export type EnemyEntity = {
  id: number;
  archetype: EnemyArchetype;
  bossBase?: BossBaseArchetype | undefined;
  bossVariant?: 0 | 1 | undefined;
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
  leapStartX: number;
  leapStartY: number;
  leapZ: number;
  leapDuration: number;
  /** Mimics wear a treasure chest disguise until the player walks up or hits them. */
  mimic?: boolean | undefined;
  /** Disguised and stationary (sleeping Mimic); ignored for room-clear checks. */
  dormant?: boolean | undefined;
  /** Spawned by a boss or warden (adds are capped so fights stay readable). */
  isAdd?: boolean | undefined;
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
    baseHp: 44,
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
    baseHp: 250,
    radius: 20,
    armor: 0,
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
    baseHp: 135,
    radius: 20,
    armor: 0,
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
  myconid: {
    baseHp: 58,
    radius: 15,
    armor: 0,
    speed: 112,
    damage: 12,
    coinDrop: 2,
    spawnTime: 0.55,
    telegraphDuration: 0.56,
  },
  imp: {
    baseHp: 38,
    radius: 14,
    armor: 0,
    speed: 162,
    damage: 12,
    coinDrop: 2,
    spawnTime: 0.55,
    telegraphDuration: 0.42,
  },
  archer: {
    baseHp: 44,
    radius: 15,
    armor: 0,
    speed: 116,
    damage: 14,
    coinDrop: 2,
    spawnTime: 0.55,
    telegraphDuration: 0.52,
  },
};

export const ALL_ENEMY_ARCHETYPES = Object.keys(ENEMY_SPECS) as readonly EnemyArchetype[];

export function getBossDisplayName(
  bossBase: BossBaseArchetype = 'shooter',
  bossVariant?: 0 | 1,
): string {
  switch (bossBase) {
    case 'chaser':
      return bossVariant === 1 ? 'King Mimic' : 'Giant Slime';
    case 'shooter':
      return 'Arch-Mage';
    case 'charger':
      return bossVariant === 1 ? 'Molten Colossus' : 'Giant Brute';
    case 'elite_charger':
      return 'High Warden';
    case 'shade':
      return 'Dread Shade';
    case 'yeti':
      return 'Elder Yeti';
    case 'bomber':
      return 'Master Sapper';
    case 'mortar_tank':
      return 'Siege Tank';
    case 'stampede':
      return 'Alpha Bull';
    case 'myconid':
      return 'Elder Myconid';
    case 'imp':
      return 'Dread Imp';
    case 'archer':
      return 'Bone Marksman';
  }
}

export function createEnemy(
  id: number,
  archetype: EnemyArchetype,
  x: number,
  y: number,
  hpScale: number,
  enemyHpMult: number,
  enemySpeedMult: number,
  enemyDamageMult: number,
  bossBase?: BossBaseArchetype,
  bossVariant?: 0 | 1,
): EnemyEntity {
  const spec = ENEMY_SPECS[archetype];
  const resolvedBossBase: BossBaseArchetype | undefined =
    archetype === 'boss' ? (bossBase ?? 'shooter') : undefined;
  const resolvedRadius =
    archetype === 'boss' && resolvedBossBase
      ? Math.max(26, Math.min(34, Math.round(ENEMY_SPECS[resolvedBossBase].radius * 1.65)))
      : spec.radius;
  const hp = Math.round(spec.baseHp * hpScale * enemyHpMult);
  return {
    id,
    archetype,
    ...(resolvedBossBase ? { bossBase: resolvedBossBase, bossVariant: bossVariant ?? 0 } : {}),
    x,
    y,
    vx: 0,
    vy: 0,
    radius: resolvedRadius,
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
    leapStartX: x,
    leapStartY: y,
    leapZ: 0,
    leapDuration: 0,
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
