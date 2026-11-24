import {
  getDailyHazard,
  getDailyModifier,
  getDailyStarterRelic,
  resolveDailyWeapon,
} from '../modifiers.ts';
import { draftRelics } from '../relics.ts';
import { getWeapon, type WeaponDef } from '../weapons.ts';
import { createDailyStream, type SeededRng } from '../rng.ts';
import type {
  ActiveRelicMap,
  CosmeticId,
  DailyModifier,
  DailyRule,
  DoorDirection,
  HazardType,
  InputFrame,
  PlayerProfile,
  RelicDef,
  RoomType,
  RunSummary,
  WeaponId,
} from '../types.ts';
import {
  ARENA_H,
  ARENA_W,
  ATTACK_BUFFER_TIME,
  BASE_HP,
  DEATH_ANIM_DURATION,
  FIXED_DT,
  HITSTOP_DURATION,
  HURT_IFRAMES,
  ONBOARDING_HINT_DURATION,
  PLAYER_RADIUS,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Y,
  PLAYER_SPEED,
  PLAY_MAX_X,
  PLAY_MAX_Y,
  PLAY_MIN_X,
  PLAY_MIN_Y,
} from './constants.ts';
import { chooseBossPattern, createEnemy, type EnemyEntity } from './enemies.ts';
import {
  CELL_SIZE,
  LAYOUT_COLS,
  LAYOUT_ROWS,
  buildDailyDungeonMap,
  getFloorScaling,
  oppositeDirection,
  type FloorScaling,
  type ObstacleBlueprint,
  type DailyDungeonMap,
  type RoomBlueprint,
  type RoomRewardType,
} from './rooms.ts';

export type GamePhase = 'start' | 'playing' | 'dying' | 'paused' | 'ended';
export type RoomState = 'combat' | 'reward' | 'door_open' | 'boss_choice';
export type RoomTransitionKind = 'none' | 'door' | 'portal';

export type RoomDoor = {
  dir: DoorDirection;
  targetRoomId: number;
  targetCleared: boolean;
  targetIsBoss: boolean;
};

export type DungeonMapRoomView = {
  id: number;
  roomIndex: number;
  gx: number;
  gy: number;
  roomType: RoomType;
  visited: boolean;
  cleared: boolean;
  isCurrent: boolean;
  isBoss: boolean;
  doors: DoorDirection[];
};

export type ProjectileEntity = {
  id: number;
  friendly: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  ttl: number;
  pierce: boolean;
  hitEnemyIds: number[];
  kind: 'orb' | 'rift_wave' | 'bolt' | 'lance';
  /** Weapon projectiles proc on-hit relics; relic/reflected projectiles do not. */
  weaponShot?: boolean | undefined;
  stripsArmor?: boolean | undefined;
  attackSeq?: number | undefined;
  angle: number;
};

export type HazardEntity = {
  id: number;
  type: HazardType;
  x: number;
  y: number;
  w: number;
  h: number;
  dirX: number;
  dirY: number;
  timer: number;
  hp: number;
  destroyed: boolean;
};

export type BreakableEntity = {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  kind: 'crate' | 'pillar';
  hitFlash: number;
};

export type CoinEntity = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  magnetized: boolean;
  age: number;
};

export type PedestalEntity = {
  id: number;
  x: number;
  y: number;
  relic: RelicDef;
  nextLevel: number;
  claimProgress: number;
  hovered: boolean;
};

export type FountainEntity = {
  x: number;
  y: number;
  used: boolean;
  healAmount: number;
};

export type GemEntity = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
};

/** Heal pickup that sometimes pops out of broken crates. */
export type HeartEntity = {
  id: number;
  x: number;
  y: number;
  age: number;
};

export type PortalEntity = {
  kind: 'stairs';
  x: number;
  y: number;
  label: string;
  progress: number;
};

export type FirePatchEffect = {
  x: number;
  y: number;
  radius: number;
  ttl: number;
  dps: number;
  tickTimer: number;
};

export type DelayedBlastEffect = {
  kind:
    | 'decoy_mine'
    | 'phantom_echo'
    | 'shatter_quake'
    | 'volatile_blast'
    | 'barrel_blast'
    | 'ice_mortar'
    | 'sapper_bomb';
  x: number;
  y: number;
  radius: number;
  timer: number;
  maxTimer: number;
  damage: number;
  friendly: boolean;
  hurtPlayerToo?: boolean | undefined;
  alreadyScaled?: boolean | undefined;
};

export type SlashEffect = {
  x: number;
  y: number;
  angle: number;
  radius: number;
  arc: number;
  ttl: number;
  maxTtl: number;
  color: string;
  heavy: boolean;
  sign: 1 | -1;
  hitCount: number;
};

export type RingEffect = {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  ttl: number;
  maxTtl: number;
  color: string;
  harmfulToPlayer?: boolean | undefined;
  damage?: number | undefined;
  hitPlayer?: boolean | undefined;
};

export type LightningEffect = {
  points: Array<{ x: number; y: number }>;
  ttl: number;
  maxTtl: number;
};

export type ParticleEffect = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  ttl: number;
  maxTtl: number;
  color: string;
};

export type DebrisEffect = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  spin: number;
  w: number;
  h: number;
  color: string;
  borderColor: string;
  ttl: number;
  maxTtl: number;
};

export type FloatingTextEffect = {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  ttl: number;
  maxTtl: number;
  scale: number;
};

export type AfterimageEffect = {
  x: number;
  y: number;
  ttl: number;
  maxTtl: number;
  color: string;
};

export type PlayerState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  shields: number;
  maxShields: number;
  facingX: number;
  facingY: number;
  attackCooldown: number;
  attackMaxCooldown: number;
  attackAnimTimer: number;
  attackEndlagTimer: number;
  attackBufferedTimer: number;
  attackAngle: number;
  swingCount: number;
  meleeHitCount: number;
  iFramesTimer: number;
  hurtFlashTimer: number;
  trailSpawnTimer: number;
  relics: ActiveRelicMap;
  rerollsRemaining: number;
  cosmetic: CosmeticId;
  costume: CosmeticId;
  weaponId: WeaponId;
  damageBonusMult: number;
  coinBonusMult: number;
  magnetRadius: number;
};

export type GameState = {
  phase: GamePhase;
  utcDate: string;
  /** Current floor (1-based, endless). */
  floor: number;
  /** Rooms cleared across all floors this run. */
  roomsClearedTotal: number;
  floorsCleared: number;
  currentRoomId: number;
  roomIndex: number;
  totalRooms: number;
  clearedRooms: number;
  progressPct: number;
  roomType: RoomType;
  roomState: RoomState;
  rewardType: RoomRewardType;
  doors: RoomDoor[];
  mapRooms: DungeonMapRoomView[];
  waveIndex: number;
  totalWaves: number;
  waveDelayTimer: number;
  elapsedTime: number;
  hitstopTimer: number;
  shakeIntensity: number;
  onboardingTimer: number;
  roomTransitionTimer: number;
  roomTransitionDuration: number;
  roomTransitionKind: RoomTransitionKind;
  roomTransitionDir: DoorDirection | null;
  isFirstVisitToRoom: boolean;
  deathTimer: number;
  deathDuration: number;
  announcementText: string;
  announcementTimer: number;
  modifier: DailyModifier;
  dailyRule: DailyRule;
  dailyHazard: HazardType;
  player: PlayerState;
  enemies: EnemyEntity[];
  projectiles: ProjectileEntity[];
  hazards: HazardEntity[];
  breakables: BreakableEntity[];
  /** Solid blocks from the room layout; they never break. */
  obstacles: ObstacleBlueprint[];
  coins: CoinEntity[];
  gems: GemEntity[];
  hearts: HeartEntity[];
  pedestals: PedestalEntity[];
  fountain: FountainEntity | null;
  portals: PortalEntity[];
  firePatches: FirePatchEffect[];
  delayedBlasts: DelayedBlastEffect[];
  slashes: SlashEffect[];
  rings: RingEffect[];
  lightnings: LightningEffect[];
  particles: ParticleEffect[];
  debris: DebrisEffect[];
  floatingTexts: FloatingTextEffect[];
  afterimages: AfterimageEffect[];
  stats: {
    coinsEarned: number;
    gemsEarned: number;
    damageTaken: number;
    enemiesKilled: number;
    extracted: boolean;
    bossDefeated: boolean;
  };
};

type RoomVisitMemory = {
  visited: boolean;
  cleared: boolean;
  rewardClaimed: boolean;
  fountainUsed: boolean;
  breakables?: BreakableEntity[] | undefined;
};

export class GameSimulation {
  public state: GameState;
  private profile: PlayerProfile;
  private dungeonMap: DailyDungeonMap;
  private currentBlueprint: RoomBlueprint;
  private roomMemory = new Map<number, RoomVisitMemory>();
  private doorEntryLockTimer = 0;
  private nextEntityId = 1;
  private relicRng: SeededRng;
  private bossRng: SeededRng;
  private fxRng: SeededRng;
  private lootRng: SeededRng;
  private attackSeq = 0;
  private lastHitProcSeq = -1;
  private weapon: WeaponDef;
  private baseModifier: DailyModifier;
  private dailyRule: DailyRule;
  private floorScaling: FloorScaling;
  private endCallback?: ((summary: RunSummary) => void) | undefined;

  constructor(
    utcDate: string,
    profile: PlayerProfile,
    onRunEnd?: (summary: RunSummary) => void,
  ) {
    this.profile = profile;
    this.endCallback = onRunEnd;
    this.relicRng = createDailyStream(utcDate, 'relics');
    this.bossRng = createDailyStream(utcDate, 'boss');
    this.fxRng = createDailyStream(utcDate, 'fx');
    this.lootRng = createDailyStream(utcDate, 'loot');
    const resolved = resolveDailyWeapon(utcDate, profile);
    this.dailyRule = resolved.rule;
    this.weapon = getWeapon(resolved.weaponId);
    this.baseModifier = getDailyModifier(utcDate);
    this.floorScaling = getFloorScaling(1);
    this.dungeonMap = buildDailyDungeonMap(
      utcDate,
      1,
      getDailyHazard(utcDate),
      this.dailyRule.extraCrates ?? 0,
    );
    const startNode = this.dungeonMap.rooms[0];
    if (!startNode) throw new Error('Dungeon map missing start room');
    this.currentBlueprint = startNode.blueprint;
    this.state = this.createFreshState(utcDate, profile, 'start', false);
    this.refreshMapView();
  }

  public setOnRunEnd(cb: (summary: RunSummary) => void): void {
    this.endCallback = cb;
  }

  public startNewRun(
    utcDate: string,
    profile: PlayerProfile,
    options?: { ignoreDailyWeaponRule?: boolean },
  ): void {
    this.profile = profile;
    this.relicRng = createDailyStream(utcDate, 'relics');
    this.bossRng = createDailyStream(utcDate, 'boss');
    this.fxRng = createDailyStream(utcDate, 'fx');
    this.lootRng = createDailyStream(utcDate, 'loot');
    const ignoreRule = Boolean(options?.ignoreDailyWeaponRule);
    const resolved = resolveDailyWeapon(utcDate, profile);
    this.dailyRule = resolved.rule;
    this.weapon = getWeapon(ignoreRule ? profile.equippedWeapon : resolved.weaponId);
    this.baseModifier = getDailyModifier(utcDate);
    this.floorScaling = getFloorScaling(1);
    this.dungeonMap = buildDailyDungeonMap(
      utcDate,
      1,
      getDailyHazard(utcDate),
      this.dailyRule.extraCrates ?? 0,
    );
    this.roomMemory.clear();
    this.doorEntryLockTimer = 0;
    this.state = this.createFreshState(utcDate, profile, 'playing', ignoreRule);
    this.enterMapRoom(this.dungeonMap.startRoomId, 'none', null);
  }

  /** Enemy damage/speed multipliers combine today's modifier with the current floor depth. */
  private buildScaledModifier(): DailyModifier {
    return {
      ...this.baseModifier,
      enemyDamageMult: this.baseModifier.enemyDamageMult * this.floorScaling.damageMult,
      enemySpeedMult: this.baseModifier.enemySpeedMult * this.floorScaling.speedMult,
    };
  }

  public setPhase(phase: GamePhase): void {
    this.state.phase = phase;
  }

  public getWeapon(): WeaponDef {
    return this.weapon;
  }

  public rerollPedestals(): boolean {
    if (
      this.state.phase !== 'playing' ||
      this.state.pedestals.length === 0 ||
      this.state.player.rerollsRemaining <= 0
    ) {
      return false;
    }
    this.state.player.rerollsRemaining -= 1;
    const filter = this.state.rewardType === 'synergy_relics' ? 'synergy' : undefined;
    const drafted = draftRelics(
      this.relicRng,
      this.profile.unlockedRelics,
      this.state.pedestals.length,
      filter,
    );
    this.state.pedestals.forEach((pedestal, idx) => {
      const nextRelic = drafted[idx] ?? pedestal.relic;
      const curLv = this.state.player.relics[nextRelic.id] ?? 0;
      pedestal.relic = nextRelic;
      pedestal.nextLevel = curLv + 1;
      pedestal.claimProgress = 0;
    });
    this.announce('Relics rerolled!');
    return true;
  }

  public getRunSummary(): RunSummary {
    const s = this.state;
    const roomsOnFloor = s.clearedRooms;
    // Depth dominates: one extra floor always beats any amount of rooms/kills on a shallower floor.
    const score = Math.max(
      10,
      s.floorsCleared * 1000 + roomsOnFloor * 120 + s.stats.enemiesKilled * 5,
    );

    return {
      utcDate: s.utcDate,
      outcome: 'defeated',
      bossDefeated: s.floorsCleared > 0,
      floorReached: s.floor,
      roomsCleared: s.roomsClearedTotal,
      floorsCleared: s.floorsCleared,
      roomReached: s.roomIndex,
      progressPct: s.progressPct,
      totalRooms: s.totalRooms,
      elapsedSec: Math.round(s.elapsedTime * 10) / 10,
      coinsEarned: s.stats.coinsEarned,
      gemsEarned: s.stats.gemsEarned,
      damageTaken: Math.round(s.stats.damageTaken),
      enemiesKilled: s.stats.enemiesKilled,
      weapon: this.weapon.id,
      relics: { ...s.player.relics },
      score,
    };
  }

  public step(input: InputFrame, dt = FIXED_DT): void {
    const s = this.state;
    if (s.phase === 'dying') {
      if (s.hitstopTimer > 0) {
        s.hitstopTimer = Math.max(0, s.hitstopTimer - dt);
        return;
      }
      this.updateVisualEffects(dt * 0.65);
      s.shakeIntensity = Math.max(0, s.shakeIntensity - dt * 22);
      s.deathTimer = Math.max(0, s.deathTimer - dt);
      if (s.deathTimer <= 0) {
        this.finishRun(false);
      }
      return;
    }

    if (s.phase !== 'playing') return;

    this.updateVisualEffects(dt);

    if (s.announcementTimer > 0) {
      s.announcementTimer = Math.max(0, s.announcementTimer - dt);
    }

    if (s.roomTransitionTimer > 0) {
      s.roomTransitionTimer = Math.max(0, s.roomTransitionTimer - dt);
      if (s.roomTransitionTimer === 0) {
        s.roomTransitionKind = 'none';
        s.roomTransitionDir = null;
      }
      return;
    }

    if (s.hitstopTimer > 0) {
      if (input.actionJustPressed) {
        s.player.attackBufferedTimer = ATTACK_BUFFER_TIME;
      }
      s.hitstopTimer = Math.max(0, s.hitstopTimer - dt);
      return;
    }

    s.elapsedTime += dt;
    if (s.onboardingTimer > 0) {
      s.onboardingTimer = Math.max(0, s.onboardingTimer - dt);
    }
    if (this.doorEntryLockTimer > 0) {
      this.doorEntryLockTimer = Math.max(0, this.doorEntryLockTimer - dt);
    }
    s.shakeIntensity = Math.max(0, s.shakeIntensity - dt * 26);

    this.updatePlayer(input, dt);
    this.updateHazards(dt);
    this.updateDelayedBlasts(dt);
    this.updateFirePatches(dt);
    this.updateEnemies(dt);
    for (const enemy of s.enemies) {
      if (enemy.leapZ <= 24) this.pushOutOfObstacles(enemy, enemy.radius);
    }
    this.updateProjectiles(dt);
    this.updateCoins(dt);
    this.updateGems(dt);
    this.updateHearts(dt);
    this.updatePostRoomInteractions(dt);

    if (s.player.hp <= 0 && s.phase === 'playing') {
      this.beginPlayerDeath();
    }
  }

  private createFreshState(
    utcDate: string,
    profile: PlayerProfile,
    phase: GamePhase,
    ignoreRule: boolean,
  ): GameState {
    const modifier = this.buildScaledModifier();
    const dailyRule = this.dailyRule;
    const dailyHazard = getDailyHazard(utcDate);
    const maxHp = BASE_HP;
    const weapon = this.weapon;
    const initialRelics: ActiveRelicMap = {};
    if (dailyRule.grantStarterRelic && !ignoreRule) {
      initialRelics[getDailyStarterRelic(utcDate)] = 1;
    }

    const startNode = this.dungeonMap.rooms[0];
    if (!startNode) throw new Error('Dungeon map missing start room');
    this.currentBlueprint = startNode.blueprint;

    return {
      phase,
      utcDate,
      floor: this.dungeonMap.floor,
      roomsClearedTotal: 0,
      floorsCleared: 0,
      currentRoomId: startNode.id,
      roomIndex: startNode.roomIndex,
      totalRooms: this.dungeonMap.totalRooms,
      clearedRooms: 0,
      progressPct: 0,
      roomType: startNode.blueprint.roomType,
      roomState: 'combat',
      rewardType: startNode.blueprint.rewardType,
      doors: [],
      mapRooms: [],
      waveIndex: 0,
      totalWaves: startNode.blueprint.waves.length,
      waveDelayTimer: 0,
      elapsedTime: 0,
      hitstopTimer: 0,
      shakeIntensity: 0,
      onboardingTimer: ONBOARDING_HINT_DURATION,
      roomTransitionTimer: 0,
      roomTransitionDuration: 0.48,
      roomTransitionKind: 'none',
      roomTransitionDir: null,
      isFirstVisitToRoom: true,
      deathTimer: 0,
      deathDuration: DEATH_ANIM_DURATION,
      announcementText: '',
      announcementTimer: 0,
      modifier,
      dailyRule,
      dailyHazard,
      player: {
        x: PLAYER_SPAWN_X,
        y: PLAYER_SPAWN_Y,
        vx: 0,
        vy: 0,
        radius: PLAYER_RADIUS,
        hp: maxHp,
        maxHp,
        shields: 0,
        maxShields: 0,
        facingX: 0,
        facingY: -1,
        attackCooldown: 0,
        attackMaxCooldown: weapon.cooldown * modifier.attackCdMult,
        attackAnimTimer: 0,
        attackEndlagTimer: 0,
        attackBufferedTimer: 0,
        attackAngle: -Math.PI / 2,
        swingCount: 0,
        meleeHitCount: 0,
        iFramesTimer: 0,
        hurtFlashTimer: 0,
        trailSpawnTimer: 0,
        relics: initialRelics,
        rerollsRemaining: 1,
        cosmetic: profile.equippedCosmetic,
        costume: profile.equippedCostume,
        weaponId: weapon.id,
        damageBonusMult: 1,
        coinBonusMult: 1,
        magnetRadius: 115,
      },
      enemies: [],
      projectiles: [],
      hazards: [],
      breakables: [],
      obstacles: [],
      coins: [],
      gems: [],
      hearts: [],
      pedestals: [],
      fountain: null,
      portals: [],
      firePatches: [],
      delayedBlasts: [],
      slashes: [],
      rings: [],
      lightnings: [],
      particles: [],
      debris: [],
      floatingTexts: [],
      afterimages: [],
      stats: {
        coinsEarned: 0,
        gemsEarned: 0,
        damageTaken: 0,
        enemiesKilled: 0,
        extracted: false,
        bossDefeated: false,
      },
    };
  }

  public enterRoom(roomIndex: number, transitionKind: RoomTransitionKind = 'none'): void {
    const node = this.dungeonMap.rooms.find((r) => r.roomIndex === roomIndex);
    if (node) {
      this.enterMapRoom(node.id, transitionKind, null);
    }
  }

  public enterMapRoom(
    roomId: number,
    transitionKind: RoomTransitionKind = 'none',
    travelDir: DoorDirection | null = null,
  ): void {
    const s = this.state;
    const node = this.dungeonMap.rooms.find((r) => r.id === roomId);
    if (!node) return;

    if (transitionKind === 'door') {
      const leavingMem = this.roomMemory.get(s.currentRoomId);
      if (leavingMem) {
        leavingMem.breakables = s.breakables.map((b) => ({ ...b, hitFlash: 0 }));
      }
    }

    const prevMem = this.roomMemory.get(node.id);
    const isFirstVisit = !prevMem?.visited;
    const mem: RoomVisitMemory = prevMem ?? {
      visited: true,
      cleared: false,
      rewardClaimed: false,
      fountainUsed: false,
    };
    mem.visited = true;
    this.roomMemory.set(node.id, mem);

    s.currentRoomId = node.id;
    s.roomIndex = node.roomIndex;
    s.totalRooms = this.dungeonMap.totalRooms;
    s.roomType = node.blueprint.roomType;
    s.rewardType = node.blueprint.rewardType;
    s.isFirstVisitToRoom = isFirstVisit;
    s.deathTimer = 0;
    s.deathDuration = DEATH_ANIM_DURATION;
    s.roomTransitionKind = transitionKind;
    s.roomTransitionDir = travelDir;
    if (transitionKind !== 'none') {
      const dur = transitionKind === 'portal' ? 0.64 : 0.48;
      s.roomTransitionDuration = dur;
      s.roomTransitionTimer = dur;
    } else {
      s.roomTransitionDuration = 0.48;
      s.roomTransitionTimer = 0;
    }

    const entryDir = travelDir ? oppositeDirection(travelDir) : null;
    if (entryDir === 'south') {
      s.player.x = ARENA_W / 2;
      s.player.y = PLAY_MAX_Y - 48;
      s.player.facingX = 0;
      s.player.facingY = -1;
    } else if (entryDir === 'north') {
      s.player.x = ARENA_W / 2;
      s.player.y = PLAY_MIN_Y + 48;
      s.player.facingX = 0;
      s.player.facingY = 1;
    } else if (entryDir === 'west') {
      s.player.x = PLAY_MIN_X + 48;
      s.player.y = ARENA_H / 2;
      s.player.facingX = 1;
      s.player.facingY = 0;
    } else if (entryDir === 'east') {
      s.player.x = PLAY_MAX_X - 48;
      s.player.y = ARENA_H / 2;
      s.player.facingX = -1;
      s.player.facingY = 0;
    } else {
      s.player.x = PLAYER_SPAWN_X;
      s.player.y = PLAYER_SPAWN_Y;
      s.player.facingX = 0;
      s.player.facingY = -1;
    }

    this.doorEntryLockTimer = 0.28;
    s.player.vx = 0;
    s.player.vy = 0;
    s.player.attackCooldown = 0;
    s.player.attackAnimTimer = 0;
    s.player.attackEndlagTimer = 0;
    s.player.attackBufferedTimer = 0;
    s.player.iFramesTimer = Math.max(
      s.player.iFramesTimer,
      transitionKind !== 'none' ? s.roomTransitionDuration + 0.35 : 0.35,
    );

    s.enemies = [];
    s.projectiles = [];
    s.pedestals = [];
    s.fountain = null;
    s.portals = [];
    s.firePatches = [];
    s.delayedBlasts = [];
    s.rings = [];
    s.debris = [];
    s.coins = [];
    s.gems = [];
    s.hearts = [];
    s.obstacles = node.blueprint.obstacles;

    this.refreshMapView();

    if (mem.cleared) {
      s.hazards = [];
      s.breakables = (mem.breakables ?? []).map((b) => ({ ...b, hitFlash: 0 }));
      s.waveIndex = 0;
      s.totalWaves = 0;
      s.waveDelayTimer = 0;

      if (s.rewardType === 'fountain_and_relics' && !mem.fountainUsed) {
        s.fountain = {
          x: ARENA_W / 2,
          y: Math.round(ARENA_H * 0.67),
          used: false,
          healAmount: Math.round(s.player.maxHp * 0.35),
        };
      }

      if (node.id === this.dungeonMap.bossRoomId) {
        s.portals = [this.makeStairsPortal()];
        s.roomState = 'boss_choice';
      } else {
        s.roomState = 'door_open';
      }
    } else {
      this.currentBlueprint = node.blueprint;
      s.roomState = 'combat';
      s.waveIndex = 0;
      s.totalWaves = node.blueprint.waves.length;
      s.waveDelayTimer = 0;

      s.hazards = node.blueprint.hazards.map((h) => ({
        ...h,
        timer: h.phaseOffset,
        hp: 20,
        destroyed: false,
      }));

      s.breakables = node.blueprint.breakables.map((b) => ({
        ...b,
        maxHp: b.hp,
        hitFlash: 0,
      }));
      mem.breakables = s.breakables.map((b) => ({ ...b, hitFlash: 0 }));

      this.spawnWave(0);
    }

    s.announcementText = '';
    s.announcementTimer = 0;
  }

  private makeStairsPortal(): PortalEntity {
    return {
      kind: 'stairs',
      x: ARENA_W / 2,
      y: Math.round(ARENA_H * 0.62),
      label: `DESCEND TO FLOOR ${this.state.floor + 1}`,
      progress: 0,
    };
  }

  /** Take the stairs: build the next floor's seeded layout and drop into its entrance. */
  private descendFloor(): void {
    this.goToFloor(this.state.floor + 1);
  }

  /**
   * Developer shortcut (local testing only): jump straight to a floor, keeping the
   * current HP and relics. Counts skipped floors as cleared so summaries stay sane.
   */
  public debugJumpToFloor(floor: number): void {
    const s = this.state;
    const target = Math.max(1, Math.floor(floor));
    if (s.phase !== 'playing' || target === s.floor) return;
    s.floorsCleared = Math.max(s.floorsCleared, target - 1);
    this.goToFloor(target);
  }

  private goToFloor(nextFloor: number): void {
    const s = this.state;
    this.floorScaling = getFloorScaling(nextFloor);
    this.dungeonMap = buildDailyDungeonMap(
      s.utcDate,
      nextFloor,
      s.dailyHazard,
      this.dailyRule.extraCrates ?? 0,
    );
    this.roomMemory.clear();
    s.floor = nextFloor;
    s.modifier = this.buildScaledModifier();
    s.slashes = [];
    s.afterimages = [];
    this.enterMapRoom(this.dungeonMap.startRoomId, 'portal', null);
    s.isFirstVisitToRoom = true;
    this.announce(`Floor ${nextFloor} - Enemies grow stronger`);
  }

  private refreshMapView(): void {
    const s = this.state;
    let clearedRooms = 0;
    for (const node of this.dungeonMap.rooms) {
      if (this.roomMemory.get(node.id)?.cleared) {
        clearedRooms += 1;
      }
    }
    s.clearedRooms = clearedRooms;
    s.progressPct = Math.min(
      100,
      Math.round((clearedRooms / Math.max(1, this.dungeonMap.totalRooms)) * 100),
    );

    const orderedDirs: readonly DoorDirection[] = ['north', 'east', 'west', 'south'];
    const curNode = this.dungeonMap.rooms.find((r) => r.id === s.currentRoomId);
    if (curNode) {
      const doors: RoomDoor[] = [];
      for (const dir of orderedDirs) {
        const targetId = curNode.doors[dir];
        if (targetId === undefined) continue;
        doors.push({
          dir,
          targetRoomId: targetId,
          targetCleared: Boolean(this.roomMemory.get(targetId)?.cleared),
          targetIsBoss: targetId === this.dungeonMap.bossRoomId,
        });
      }
      s.doors = doors;
    } else {
      s.doors = [];
    }

    s.mapRooms = this.dungeonMap.rooms.map((node) => {
      const mem = this.roomMemory.get(node.id);
      const doors: DoorDirection[] = orderedDirs.filter((d) => node.doors[d] !== undefined);
      return {
        id: node.id,
        roomIndex: node.roomIndex,
        gx: node.gx,
        gy: node.gy,
        roomType: node.blueprint.roomType,
        visited: Boolean(mem?.visited),
        cleared: Boolean(mem?.cleared),
        isCurrent: node.id === s.currentRoomId,
        isBoss: node.id === this.dungeonMap.bossRoomId,
        doors,
      };
    });
  }

  private spawnWave(waveIdx: number): void {
    const s = this.state;
    const wave = this.currentBlueprint.waves[waveIdx];
    if (!wave) return;
    s.waveIndex = waveIdx;
    for (const spawn of wave) {
      const enemy = createEnemy(
        this.nextEntityId++,
        spawn.archetype,
        spawn.x,
        spawn.y,
        this.currentBlueprint.hpScale,
        s.modifier.enemyHpMult,
        s.modifier.enemySpeedMult,
        s.modifier.enemyDamageMult,
      );
      s.enemies.push(enemy);
      this.spawnParticles(spawn.x, spawn.y, '#ef4444', 6, 90);
    }
  }

  private updatePlayer(input: InputFrame, dt: number): void {
    const s = this.state;
    const p = s.player;

    p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    p.attackAnimTimer = Math.max(0, p.attackAnimTimer - dt);
    p.attackEndlagTimer = Math.max(0, p.attackEndlagTimer - dt);
    p.attackBufferedTimer = Math.max(0, p.attackBufferedTimer - dt);
    p.iFramesTimer = Math.max(0, p.iFramesTimer - dt);
    p.hurtFlashTimer = Math.max(0, p.hurtFlashTimer - dt);

    const aimVec = this.resolveAimDirection(input);
    if (p.attackAnimTimer <= 0 && (input.moveX !== 0 || input.moveY !== 0)) {
      p.facingX = input.moveX;
      p.facingY = input.moveY;
    }

    if (input.actionJustPressed) {
      p.attackBufferedTimer = ATTACK_BUFFER_TIME;
    }

    if (
      (input.actionJustPressed || p.attackBufferedTimer > 0) &&
      p.attackCooldown <= 0
    ) {
      p.attackBufferedTimer = 0;
      this.executeAttack(aimVec);
    }

    const attackMove = this.weapon.attackMoveMult;
    const moveSpeedMult =
      p.attackAnimTimer > 0
        ? attackMove
        : p.attackEndlagTimer > 0
          ? Math.min(1, attackMove + 0.2)
          : 1;
    const targetVx = input.moveX * PLAYER_SPEED * moveSpeedMult;
    const targetVy = input.moveY * PLAYER_SPEED * moveSpeedMult;
    const accelRate = (input.moveX !== 0 || input.moveY !== 0 ? 18 : 16) * s.modifier.frictionMult;
    const blend = 1 - Math.exp(-accelRate * dt);
    p.vx += (targetVx - p.vx) * blend;
    p.vy += (targetVy - p.vy) * blend;

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.pushOutOfObstacles(p, p.radius);

    if (p.cosmetic === 'neon_trail' && Math.hypot(p.vx, p.vy) > 120) {
      p.trailSpawnTimer -= dt;
      if (p.trailSpawnTimer <= 0) {
        p.trailSpawnTimer = 0.07;
        s.afterimages.push({
          x: p.x,
          y: p.y,
          ttl: 0.18,
          maxTtl: 0.18,
          color: '#22d3ee',
        });
      }
    }

    this.clampToArena(p);
  }

  private resolveAimDirection(input: InputFrame): { x: number; y: number } {
    const p = this.state.player;
    if (input.hasPointerAim) {
      const dx = input.aimX - p.x;
      const dy = input.aimY - p.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        return { x: dx / len, y: dy / len };
      }
    }
    if (input.moveX !== 0 || input.moveY !== 0) {
      return { x: input.moveX, y: input.moveY };
    }
    return { x: p.facingX, y: p.facingY };
  }

  private executeAttack(aimVec: { x: number; y: number }): void {
    const s = this.state;
    const p = s.player;
    const w = this.weapon;
    const angle = Math.atan2(aimVec.y, aimVec.x);

    p.facingX = Math.cos(angle);
    p.facingY = Math.sin(angle);
    p.attackAngle = angle;
    p.attackMaxCooldown = w.cooldown * s.modifier.attackCdMult;
    p.attackCooldown = p.attackMaxCooldown;
    p.attackAnimTimer = w.animDuration;
    p.attackEndlagTimer = Math.min(p.attackMaxCooldown, w.endlag * s.modifier.attackCdMult);
    p.swingCount += 1;
    this.attackSeq += 1;
    const seq = this.attackSeq;

    const vortexLv = p.relics.vortex_slam ?? 0;
    if (vortexLv > 0) {
      const pullRadius = 150 + 25 * (vortexLv - 1);
      for (const enemy of s.enemies) {
        if (enemy.spawnShieldTimer > 0 || enemy.leapZ > 24) continue;
        const dx = p.x - enemy.x;
        const dy = p.y - enemy.y;
        const dist = Math.hypot(dx, dy);
        if (dist > p.radius + enemy.radius + 8 && dist <= pullRadius) {
          const pullDist = enemy.archetype === 'boss' ? 14 : 34 + 6 * (vortexLv - 1);
          const step = Math.min(pullDist, dist - (p.radius + enemy.radius + 6));
          enemy.x += (dx / dist) * step;
          enemy.y += (dy / dist) * step;
        }
      }
    }

    const bloodLv = p.relics.blood_reset ?? 0;
    const hitDmg =
      w.damage *
      s.modifier.attackDamageMult *
      (1 + 0.15 * bloodLv) *
      p.damageBonusMult *
      s.modifier.playerDamageMult;

    const range = w.range;
    const cleaveArc = (Math.max(1, w.arcDeg) * Math.PI) / 180;
    const swingSign: 1 | -1 = p.swingCount % 2 === 1 ? 1 : -1;
    const slashColor =
      bloodLv > 0 || (p.relics.rift_cleave ?? 0) > 0 ? '#fbbf24' : w.slashColor;

    // Claiming a relic: any weapon can "tap" a pedestal in front of the player.
    if (s.roomState === 'reward' && s.pedestals.length > 0) {
      const claimReach = Math.max(range, 84) + 24;
      const claimArc = Math.max(cleaveArc, (85 * Math.PI) / 180);
      let bestPed: PedestalEntity | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const ped of s.pedestals) {
        const dx = ped.x - p.x;
        const dy = ped.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= claimReach) {
          const angleDiff = Math.abs(normalizeAngle(Math.atan2(dy, dx) - angle));
          if (angleDiff <= claimArc / 2 || dist <= 44) {
            const score = angleDiff * 80 + dist;
            if (score < bestScore) {
              bestScore = score;
              bestPed = ped;
            }
          }
        }
      }
      if (bestPed) {
        this.claimPedestal(bestPed);
        return;
      }
    }

    if (w.style === 'melee') {
      const slashEffect: SlashEffect = {
        x: p.x,
        y: p.y,
        angle,
        radius: range,
        arc: cleaveArc,
        ttl: w.animDuration,
        maxTtl: w.animDuration,
        color: slashColor,
        heavy: w.id === 'hammer',
        sign: swingSign,
        hitCount: 0,
      };
      s.slashes.push(slashEffect);

      for (let i = 0; i < 4; i += 1) {
        const frac = i / 3 - 0.5;
        const pAng = angle + swingSign * frac * cleaveArc * 0.85;
        const pDist = range * 0.72;
        const tangAng = pAng + swingSign * (Math.PI * 0.35);
        const windSpd = this.fxRng.range(70, 130);
        const ttl = this.fxRng.range(0.14, 0.22);
        s.particles.push({
          x: p.x + Math.cos(pAng) * pDist,
          y: p.y + Math.sin(pAng) * pDist,
          vx: Math.cos(tangAng) * windSpd,
          vy: Math.sin(tangAng) * windSpd,
          radius: 2.6,
          ttl,
          maxTtl: ttl,
          color: slashColor,
        });
      }

      let hitCount = 0;
      let killCount = 0;
      const chain = { arcUsed: false };
      for (const enemy of [...s.enemies]) {
        if (enemy.spawnShieldTimer > 0 || enemy.leapZ > 24) continue;
        const dx = enemy.x - p.x;
        const dy = enemy.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > range + enemy.radius) continue;
        const inFrontCone = Math.abs(normalizeAngle(Math.atan2(dy, dx) - angle)) <= cleaveArc / 2;
        const inCloseCleave = dist <= 34 + enemy.radius;
        if (!inFrontCone && !inCloseCleave) continue;
        hitCount += 1;
        const dirX = dist > 0 ? dx / dist : Math.cos(angle);
        const dirY = dist > 0 ? dy / dist : Math.sin(angle);
        const killed = this.weaponHitEnemy(enemy, hitDmg, dirX, dirY, w.stripsArmor, chain);
        if (killed) killCount += 1;
      }
      slashEffect.hitCount = hitCount;

      for (const br of [...s.breakables]) {
        const dx = br.x - p.x;
        const dy = br.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= range + br.radius) {
          const ea = Math.atan2(dy, dx);
          if (Math.abs(normalizeAngle(ea - angle)) <= cleaveArc / 2 || dist <= 36 + br.radius) {
            this.damageBreakable(br, hitDmg);
          }
        }
      }

      for (const haz of s.hazards) {
        if (haz.type === 'barrels' && !haz.destroyed) {
          const dx = haz.x - p.x;
          const dy = haz.y - p.y;
          const dist = Math.hypot(dx, dy);
          const hitRadius = Math.round(haz.w * 0.42);
          if (dist <= range + hitRadius) {
            const ea = Math.atan2(dy, dx);
            if (Math.abs(normalizeAngle(ea - angle)) <= cleaveArc / 2 || dist <= 36) {
              this.triggerBarrelExplosion(haz);
            }
          }
        }
      }

      this.afterWeaponHits(hitCount, killCount, angle, hitDmg, p.x + Math.cos(angle) * 56, p.y + Math.sin(angle) * 56, seq);
    } else if (w.projectile) {
      const spec = w.projectile;
      const spread = (spec.spreadDeg * Math.PI) / 180;
      for (let i = 0; i < spec.count; i += 1) {
        const frac = spec.count > 1 ? i / (spec.count - 1) - 0.5 : 0;
        const a = angle + frac * spread;
        s.projectiles.push({
          id: this.nextEntityId++,
          friendly: true,
          x: p.x + Math.cos(a) * 22,
          y: p.y + Math.sin(a) * 22,
          vx: Math.cos(a) * spec.speed,
          vy: Math.sin(a) * spec.speed,
          radius: spec.radius,
          damage: hitDmg,
          ttl: spec.ttl,
          pierce: spec.pierce,
          hitEnemyIds: [],
          kind: w.id === 'arcane_lance' ? 'lance' : 'bolt',
          angle: a,
          weaponShot: true,
          stripsArmor: w.stripsArmor,
          attackSeq: seq,
        });
      }
      s.rings.push({
        x: p.x + Math.cos(angle) * 22,
        y: p.y + Math.sin(angle) * 22,
        radius: 6,
        maxRadius: w.id === 'arcane_lance' ? 30 : 40,
        ttl: 0.12,
        maxTtl: 0.12,
        color: w.slashColor,
      });
      this.spawnParticles(p.x + Math.cos(angle) * 24, p.y + Math.sin(angle) * 24, w.slashColor, 5, 120);
      s.shakeIntensity = Math.max(s.shakeIntensity, w.id === 'arcane_lance' ? 4 : 3);
    }

    // On-attack relics fire regardless of weapon style.
    const emberLv = p.relics.ember_wake ?? 0;
    if (emberLv > 0) {
      s.firePatches.push({
        x: p.x + Math.cos(angle) * 42,
        y: p.y + Math.sin(angle) * 42,
        radius: 34 + emberLv * 4,
        ttl: 2.2,
        dps: 14 + 7 * (emberLv - 1),
        tickTimer: 0.08,
      });
    }

    const riftLv = p.relics.rift_cleave ?? 0;
    if (riftLv > 0) {
      const waveDmg =
        (24 + 10 * (riftLv - 1)) * p.damageBonusMult * s.modifier.playerDamageMult;
      s.projectiles.push({
        id: this.nextEntityId++,
        friendly: true,
        x: p.x + Math.cos(angle) * 24,
        y: p.y + Math.sin(angle) * 24,
        vx: Math.cos(angle) * 620,
        vy: Math.sin(angle) * 620,
        radius: 26,
        damage: waveDmg,
        ttl: 0.85,
        pierce: true,
        hitEnemyIds: [],
        kind: 'rift_wave',
        angle,
      });
    }

    const mirrorLv = p.relics.mirror_guard ?? 0;
    if (mirrorLv > 0) {
      const dmgMult = 2.5 + 0.25 * (mirrorLv - 1);
      for (const proj of s.projectiles) {
        if (proj.friendly) continue;
        const d = Math.hypot(proj.x - p.x, proj.y - p.y);
        if (d <= Math.max(range, 84) + 22) {
          proj.friendly = true;
          const speed = Math.hypot(proj.vx, proj.vy) * 2.2;
          proj.vx = Math.cos(angle) * speed;
          proj.vy = Math.sin(angle) * speed;
          proj.damage = Math.round(proj.damage * dmgMult);
          proj.ttl = 1.6;
          this.spawnParticles(proj.x, proj.y, '#38bdf8', 5, 110);
        }
      }
    }
  }

  /**
   * Only the War Hammer stuns by default; any weapon can stun with the very rare
   * Concussion relic. Returns 0 when hits should not stun.
   */
  private getStunSeconds(): number {
    const w = this.weapon;
    const base = w.style === 'melee' ? w.staggerSec : 0;
    const concussionLv = this.state.player.relics.concussion ?? 0;
    const fromRelic = concussionLv > 0 ? 0.3 + 0.1 * (concussionLv - 1) : 0;
    return Math.max(base, fromRelic);
  }

  /** Damage one enemy with the equipped weapon and apply per-enemy on-hit relics. */
  private weaponHitEnemy(
    enemy: EnemyEntity,
    dmg: number,
    dirX: number,
    dirY: number,
    stripsArmor: boolean,
    chain: { arcUsed: boolean },
  ): boolean {
    const s = this.state;
    const p = s.player;
    const w = this.weapon;
    const stunSec = this.getStunSeconds();
    if (enemy.archetype !== 'boss' && stunSec > 0) {
      enemy.state = 'staggered';
      enemy.stateTimer = Math.max(enemy.stateTimer, stunSec);
    }
    const killed = this.damageEnemy(
      enemy,
      dmg,
      dirX * w.knockback,
      dirY * w.knockback,
      stripsArmor,
      '#f8fafc',
    );
    this.spawnParticles(enemy.x, enemy.y, '#fff7e8', 5, 195);
    s.rings.push({
      x: enemy.x,
      y: enemy.y,
      radius: 8,
      maxRadius: 34,
      ttl: 0.14,
      maxTtl: 0.14,
      color: '#fff7e8',
    });
    const arcLv = p.relics.arc_conduit ?? 0;
    if (arcLv > 0 && !chain.arcUsed) {
      chain.arcUsed = true;
      this.triggerArcConduit(enemy, arcLv);
    }
    const bloodLv = p.relics.blood_reset ?? 0;
    const goldenLv = p.relics.golden_cleave ?? 0;
    if (killed) {
      if (bloodLv > 0) {
        p.attackCooldown = 0;
        p.attackEndlagTimer = 0;
        this.addFloatingText(p.x, p.y - 26, 'RESET!', '#f87171', 1.05);
      }
      if (goldenLv > 0) this.spawnCoins(enemy.x, enemy.y, 2 * goldenLv, true);
    } else if (goldenLv > 0 && enemy.goldenBurstCount < 2) {
      enemy.goldenBurstCount += 1;
      this.spawnCoins(enemy.x, enemy.y, 2 * goldenLv, true);
    }
    return killed;
  }

  /**
   * Hit-count relics (3rd-hit, 2nd-hit, on-hit). Melee calls this once per swing; ranged
   * weapons call it on each projectile impact, with once-per-attack effects gated by `seq`.
   */
  private afterWeaponHits(
    hitCount: number,
    killCount: number,
    angle: number,
    hitDmg: number,
    originX: number,
    originY: number,
    seq: number,
  ): void {
    if (hitCount <= 0) return;
    const s = this.state;
    const p = s.player;
    const firstProcThisAttack = this.lastHitProcSeq !== seq;
    this.lastHitProcSeq = seq;

    const prevHits = p.meleeHitCount;
    p.meleeHitCount += hitCount;
    const nextHits = p.meleeHitCount;
    // Cross-threshold check so multi-target hits jumping across N (e.g. 2 -> 4) still proc.
    const triggeredThirdHit = Math.floor(nextHits / 3) > Math.floor(prevHits / 3);
    const triggeredSecondHit = Math.floor(nextHits / 2) > Math.floor(prevHits / 2);

    s.hitstopTimer = Math.max(s.hitstopTimer, 0.03);
    s.shakeIntensity = Math.max(s.shakeIntensity, this.weapon.id === 'hammer' ? 8 : 5.2);

    if (firstProcThisAttack) {
      const quakeLv = p.relics.shatter_quake ?? 0;
      if (quakeLv > 0) {
        const quakeMult = 0.65 + 0.1 * (quakeLv - 1);
        s.delayedBlasts.push({
          kind: 'shatter_quake',
          x: originX,
          y: originY,
          radius: 105,
          timer: 0.45,
          maxTimer: 0.45,
          damage: Math.max(hitDmg, 30) * quakeMult,
          friendly: true,
        });
      }
    }

    const mineLv = p.relics.decoy_mine ?? 0;
    if (mineLv > 0 && triggeredThirdHit) {
      s.delayedBlasts.push({
        kind: 'decoy_mine',
        x: p.x,
        y: p.y,
        radius: 95,
        timer: 0.75,
        maxTimer: 0.75,
        damage: 34 + 14 * (mineLv - 1),
        friendly: true,
      });
    }

    const siphonLv = p.relics.reaper_siphon ?? 0;
    if (siphonLv > 0 && (hitCount >= 2 || killCount >= 1)) {
      const heal = 5 + 3 * (siphonLv - 1);
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + heal);
      const gained = Math.round(p.hp - before);
      if (gained > 0) {
        this.addFloatingText(p.x, p.y - 26, `+${gained} HP`, '#4ade80', 1.1);
      }
    }

    const voltLv = p.relics.volt_nova ?? 0;
    if (voltLv > 0 && triggeredThirdHit) {
      this.triggerVoltNova(p.x, p.y, voltLv);
    }

    const echoLv = p.relics.phantom_echo ?? 0;
    if (echoLv > 0 && triggeredSecondHit) {
      s.delayedBlasts.push({
        kind: 'phantom_echo',
        x: originX - Math.cos(angle) * 10,
        y: originY - Math.sin(angle) * 10,
        radius: 82,
        timer: 0.25,
        maxTimer: 0.25,
        damage: 22 + 9 * (echoLv - 1),
        friendly: true,
      });
    }
  }

  private triggerArcConduit(sourceEnemy: EnemyEntity, level: number): void {
    const s = this.state;
    const maxTargets = 2 + (level - 1);
    const dmg = (18 + 8 * (level - 1)) * s.player.damageBonusMult * s.modifier.playerDamageMult;

    const candidates = s.enemies
      .filter((e) => e.id !== sourceEnemy.id && e.spawnShieldTimer <= 0 && e.leapZ <= 24)
      .map((e) => ({ e, dist: Math.hypot(e.x - sourceEnemy.x, e.y - sourceEnemy.y) }))
      .filter((item) => item.dist <= 210)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, maxTargets);

    let prevX = sourceEnemy.x;
    let prevY = sourceEnemy.y;
    for (const { e } of candidates) {
      s.lightnings.push({
        points: this.buildLightningPolyline(prevX, prevY, e.x, e.y),
        ttl: 0.16,
        maxTtl: 0.16,
      });
      this.damageEnemy(e, dmg, 0, 0, false, '#60a5fa');
      prevX = e.x;
      prevY = e.y;
    }
  }

  private triggerVoltNova(x: number, y: number, level: number): void {
    const s = this.state;
    const dmg = (20 + 8 * (level - 1)) * s.player.damageBonusMult * s.modifier.playerDamageMult;
    const radius = 95;
    s.rings.push({
      x,
      y,
      radius: 16,
      maxRadius: radius,
      ttl: 0.2,
      maxTtl: 0.2,
      color: '#38bdf8',
    });
    for (const enemy of [...s.enemies]) {
      if (enemy.spawnShieldTimer > 0 || enemy.leapZ > 24) continue;
      if (Math.hypot(enemy.x - x, enemy.y - y) <= radius + enemy.radius) {
        if (enemy.archetype !== 'boss' && this.getStunSeconds() > 0) {
          enemy.state = 'staggered';
          enemy.stateTimer = Math.max(enemy.stateTimer, 0.35);
        }
        this.damageEnemy(enemy, dmg, 0, 0, false, '#38bdf8');
      }
    }
  }

  private buildLightningPolyline(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): Array<{ x: number; y: number }> {
    const pts = [{ x: x1, y: y1 }];
    const segments = 4;
    for (let i = 1; i < segments; i += 1) {
      const t = i / segments;
      const jitter = 14;
      pts.push({
        x: x1 + (x2 - x1) * t + this.fxRng.range(-jitter, jitter),
        y: y1 + (y2 - y1) * t + this.fxRng.range(-jitter, jitter),
      });
    }
    pts.push({ x: x2, y: y2 });
    return pts;
  }

  private updateHazards(dt: number): void {
    const s = this.state;
    const p = s.player;

    for (const haz of s.hazards) {
      if (haz.destroyed) continue;

      if (haz.type === 'spikes') {
        haz.timer = (haz.timer + dt) % 3.2;
        const active = haz.timer >= 2.55;
        if (active) {
          const halfW = haz.w / 2;
          const halfH = haz.h / 2;
          if (
            Math.abs(p.x - haz.x) <= halfW + p.radius * 0.5 &&
            Math.abs(p.y - haz.y) <= halfH + p.radius * 0.5
          ) {
            this.damagePlayer(12 * s.modifier.enemyDamageMult);
          }
          for (const enemy of [...s.enemies]) {
            if (enemy.spawnShieldTimer > 0 || enemy.archetype === 'boss') continue;
            if (
              Math.abs(enemy.x - haz.x) <= halfW + enemy.radius * 0.4 &&
              Math.abs(enemy.y - haz.y) <= halfH + enemy.radius * 0.4
            ) {
              if (Math.floor((haz.timer - dt) * 4) !== Math.floor(haz.timer * 4)) {
                this.damageEnemy(enemy, 14, 0, 0, false, '#f43f5e');
              }
            }
          }
        }
      } else if (haz.type === 'currents') {
        const halfW = haz.w / 2;
        const halfH = haz.h / 2;
        if (Math.abs(p.x - haz.x) <= halfW && Math.abs(p.y - haz.y) <= halfH) {
          p.x += haz.dirX * 135 * dt;
          p.y += haz.dirY * 135 * dt;
          this.clampToArena(p);
        }
        for (const enemy of s.enemies) {
          if (enemy.spawnShieldTimer > 0 || enemy.archetype === 'boss') continue;
          if (Math.abs(enemy.x - haz.x) <= halfW && Math.abs(enemy.y - haz.y) <= halfH) {
            enemy.x += haz.dirX * 110 * dt;
            enemy.y += haz.dirY * 110 * dt;
          }
        }
      }
    }
  }

  private triggerBarrelExplosion(haz: HazardEntity): void {
    if (haz.destroyed) return;
    haz.destroyed = true;
    this.spawnBreakDebris(haz.x, haz.y, 'barrel', true);
    this.state.delayedBlasts.push({
      kind: 'barrel_blast',
      x: haz.x,
      y: haz.y,
      radius: 105,
      timer: 0.14,
      maxTimer: 0.14,
      damage: 48,
      friendly: true,
      hurtPlayerToo: true,
    });
  }

  private updateDelayedBlasts(dt: number): void {
    const s = this.state;
    const remaining: DelayedBlastEffect[] = [];

    for (const blast of s.delayedBlasts) {
      blast.timer -= dt;
      if (blast.timer > 0) {
        remaining.push(blast);
        continue;
      }

      const color = blast.friendly
        ? '#fb923c'
        : blast.kind === 'ice_mortar'
          ? '#67e8f9'
          : '#ef4444';
      s.rings.push({
        x: blast.x,
        y: blast.y,
        radius: 14,
        maxRadius: blast.radius,
        ttl: 0.22,
        maxTtl: 0.22,
        color,
      });
      this.spawnParticles(blast.x, blast.y, color, 12, 180);
      if (blast.kind === 'barrel_blast') {
        this.spawnBreakDebris(blast.x, blast.y, 'barrel', false);
      }
      s.shakeIntensity = Math.max(s.shakeIntensity, 5);

      if (blast.friendly) {
        const armorBreak = blast.kind === 'shatter_quake';
        for (const enemy of [...s.enemies]) {
          if (enemy.spawnShieldTimer > 0 || enemy.leapZ > 24) continue;
          const dx = enemy.x - blast.x;
          const dy = enemy.y - blast.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= blast.radius + enemy.radius) {
            const nx = dist > 0 ? dx / dist : 0;
            const ny = dist > 0 ? dy / dist : 0;
            this.damageEnemy(enemy, blast.damage, nx * 280, ny * 280, armorBreak, color);
          }
        }
      }

      if (!blast.friendly || blast.hurtPlayerToo) {
        const dist = Math.hypot(s.player.x - blast.x, s.player.y - blast.y);
        if (dist <= blast.radius + s.player.radius * 0.7) {
          const hitDmg = blast.friendly
            ? 14
            : blast.alreadyScaled
              ? blast.damage
              : blast.damage * s.modifier.enemyDamageMult;
          this.damagePlayer(hitDmg);
        }
        if (blast.kind === 'ice_mortar') {
          const shardDmg = Math.max(1, Math.round(blast.damage * 0.75));
          const spawnDist = Math.max(26, blast.radius * 0.45);
          for (const ang of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
            s.projectiles.push({
              id: this.nextEntityId++,
              friendly: false,
              x: blast.x + Math.cos(ang) * spawnDist,
              y: blast.y + Math.sin(ang) * spawnDist,
              vx: Math.cos(ang) * 260,
              vy: Math.sin(ang) * 260,
              radius: 7,
              damage: shardDmg,
              ttl: 1.3,
              pierce: false,
              hitEnemyIds: [],
              kind: 'orb',
              angle: ang,
            });
          }
        }
      }
    }

    s.delayedBlasts = remaining;
  }

  private updateFirePatches(dt: number): void {
    const s = this.state;
    const next: FirePatchEffect[] = [];

    for (const patch of s.firePatches) {
      patch.ttl -= dt;
      if (patch.ttl <= 0) continue;
      patch.tickTimer -= dt;
      if (patch.tickTimer <= 0) {
        patch.tickTimer = 0.25;
        const tickDmg = patch.dps * 0.25 * s.player.damageBonusMult * s.modifier.playerDamageMult;
        for (const enemy of [...s.enemies]) {
          if (enemy.spawnShieldTimer > 0 || enemy.leapZ > 24) continue;
          if (Math.hypot(enemy.x - patch.x, enemy.y - patch.y) <= patch.radius + enemy.radius) {
            this.damageEnemy(enemy, tickDmg, 0, 0, false, '#fb923c');
          }
        }
      }
      next.push(patch);
    }

    s.firePatches = next;
  }

  private updateEnemies(dt: number): void {
    const s = this.state;
    const p = s.player;
    const flowField = this.computePlayerFlowField();

    for (const enemy of [...s.enemies]) {
      enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
      enemy.spawnShieldTimer = Math.max(0, enemy.spawnShieldTimer - dt);
      enemy.dashTagTimer = Math.max(0, enemy.dashTagTimer - dt);

      const kbSpeed = Math.hypot(enemy.vx, enemy.vy);
      if (kbSpeed > 12) {
        enemy.x += enemy.vx * dt;
        enemy.y += enemy.vy * dt;
        const damp = Math.exp(-9 * s.modifier.frictionMult * dt);
        enemy.vx *= damp;
        enemy.vy *= damp;
        if (enemy.leapZ <= 24) this.pushOutOfObstacles(enemy, enemy.radius);

        const hitWall =
          enemy.x - enemy.radius < PLAY_MIN_X ||
          enemy.x + enemy.radius > PLAY_MAX_X ||
          enemy.y - enemy.radius < PLAY_MIN_Y ||
          enemy.y + enemy.radius > PLAY_MAX_Y;

        if (hitWall && kbSpeed > 340) {
          this.clampToArena(enemy);
          enemy.vx *= -0.25;
          enemy.vy *= -0.25;
          if (enemy.archetype !== 'boss' && this.getStunSeconds() > 0) {
            enemy.state = 'staggered';
            enemy.stateTimer = 0.45;
          }
          this.spawnParticles(enemy.x, enemy.y, '#fbbf24', 8, 160);
          this.damageEnemy(enemy, 14, 0, 0, false, '#fbbf24', 'WALL SLAM!');
          if (!s.enemies.includes(enemy)) continue;
        }
      }

      if (enemy.state === 'spawning') {
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = 'chase';
          enemy.stateTimer = enemy.archetype === 'boss' ? 0.85 : 0.65;
        }
        this.pushOutOfObstacles(enemy, enemy.radius);
        this.clampToArena(enemy);
        continue;
      }

      if (enemy.state === 'staggered') {
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = 'chase';
          enemy.stateTimer = 0.45;
        }
        this.pushOutOfObstacles(enemy, enemy.radius);
        this.clampToArena(enemy);
        continue;
      }

      const dx = p.x - enemy.x;
      const dy = p.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      const dirX = dist > 0 ? dx / dist : 0;
      const dirY = dist > 0 ? dy / dist : 1;
      const nav = this.getNavDirection(enemy, flowField, dirX, dirY);

      if (enemy.archetype === 'chaser') {
        this.stepChaserAI(enemy, dist, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
      } else if (enemy.archetype === 'shooter') {
        this.stepShooterAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasShotLOS, dt);
      } else if (enemy.archetype === 'charger' || enemy.archetype === 'elite_charger') {
        this.stepChargerAI(enemy, dist, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
      } else if (enemy.archetype === 'shade') {
        this.stepShadeAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasShotLOS, dt);
      } else if (enemy.archetype === 'yeti') {
        this.stepYetiAI(enemy, dist, nav.dirX, nav.dirY, dt);
      } else if (enemy.archetype === 'bomber') {
        this.stepBomberAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
      } else if (enemy.archetype === 'mortar_tank') {
        this.stepMortarTankAI(enemy, dist, nav.dirX, nav.dirY, nav.hasShotLOS, dt);
      } else if (enemy.archetype === 'stampede') {
        this.stepStampedeAI(enemy, dist, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
      } else {
        this.stepBossAI(enemy, nav.dirX, nav.dirY, dt);
      }

      if (enemy.leapZ <= 24) {
        this.pushOutOfObstacles(enemy, enemy.radius);
      }
      this.clampToArena(enemy);
    }

    for (let i = 0; i < s.enemies.length; i += 1) {
      const a = s.enemies[i];
      if (!a || a.leapZ > 24) continue;
      for (let j = i + 1; j < s.enemies.length; j += 1) {
        const b = s.enemies[j];
        if (!b || b.leapZ > 24) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minDist = a.radius + b.radius + 4;
        if (d > 0 && d < minDist) {
          const push = (minDist - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          this.clampToArena(a);
          this.clampToArena(b);
        }
      }
    }

    if (s.roomState === 'combat' && s.enemies.length === 0) {
      if (s.waveIndex + 1 < s.totalWaves) {
        s.waveDelayTimer += dt;
        if (s.waveDelayTimer >= 0.45) {
          s.waveDelayTimer = 0;
          this.spawnWave(s.waveIndex + 1);
        }
      } else {
        this.onRoomCleared();
      }
    }
  }

  private stepChaserAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (dist <= 68 && hasMoveLOS) {
        enemy.state = 'telegraph';
        enemy.attackKind = 'lunge';
        enemy.telegraphDuration = 0.48;
        enemy.stateTimer = 0.48;
        enemy.targetX = s.player.x;
        enemy.targetY = s.player.y;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'attack';
        enemy.stateTimer = 0.2;
        enemy.attackFired = false;
      }
    } else if (enemy.state === 'attack') {
      const lx = Math.cos(enemy.aimAngle);
      const ly = Math.sin(enemy.aimAngle);
      enemy.x += lx * 440 * dt;
      enemy.y += ly * 440 * dt;
      if (
        !enemy.attackFired &&
        Math.hypot(s.player.x - enemy.x, s.player.y - enemy.y) <=
          s.player.radius + enemy.radius + 14
      ) {
        enemy.attackFired = true;
        this.damagePlayer(enemy.damage);
      }
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'recover';
        enemy.stateTimer = 0.42;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
      }
    }
  }

  private stepShooterAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasShotLOS: boolean,
    dt: number,
  ): void {
    const s = this.state;
    if (enemy.bouncesLeft === 0) {
      enemy.bouncesLeft = enemy.id % 2 === 0 ? 1 : -1;
    }
    const strafeDir = enemy.bouncesLeft >= 0 ? 1 : -1;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      const prevX = enemy.x;
      const prevY = enemy.y;
      if (!hasShotLOS || dist > 315) {
        this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      } else if (dist < 185) {
        this.moveWithSlide(enemy, -dirX * enemy.speed * 0.9 * dt, -dirY * enemy.speed * 0.9 * dt);
        if (
          dt > 0 &&
          enemy.speed > 0 &&
          Math.hypot(enemy.x - prevX, enemy.y - prevY) < enemy.speed * dt * 0.15
        ) {
          enemy.bouncesLeft = -strafeDir;
          this.moveWithSlide(
            enemy,
            -dirY * -strafeDir * enemy.speed * 0.72 * dt,
            dirX * -strafeDir * enemy.speed * 0.72 * dt,
          );
        }
      } else {
        this.moveWithSlide(
          enemy,
          -dirY * strafeDir * enemy.speed * 0.72 * dt,
          dirX * strafeDir * enemy.speed * 0.72 * dt,
        );
        if (
          dt > 0 &&
          enemy.speed > 0 &&
          Math.hypot(enemy.x - prevX, enemy.y - prevY) < enemy.speed * dt * 0.15
        ) {
          enemy.bouncesLeft = -strafeDir;
          this.moveWithSlide(
            enemy,
            -dirY * -strafeDir * enemy.speed * 0.72 * dt,
            dirX * -strafeDir * enemy.speed * 0.72 * dt,
          );
        }
      }
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 460 && hasShotLOS) {
        enemy.state = 'telegraph';
        enemy.attackKind = 'shoot';
        enemy.telegraphDuration = 0.52;
        enemy.stateTimer = 0.52;
        enemy.telegraphLocked = false;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0.16) {
        const rawLeadX = s.player.vx * 0.18;
        const rawLeadY = s.player.vy * 0.18;
        const rawLeadMag = Math.hypot(rawLeadX, rawLeadY);
        const leadScale = rawLeadMag > 42 ? 42 / rawLeadMag : 1;
        enemy.aimAngle = Math.atan2(
          s.player.y + rawLeadY * leadScale - enemy.y,
          s.player.x + rawLeadX * leadScale - enemy.x,
        );
      } else {
        enemy.telegraphLocked = true;
      }
      if (enemy.stateTimer <= 0) {
        const spread =
          s.floor >= 3
            ? enemy.burstLeft
              ? [-0.22, 0, 0.22]
              : [-0.14, 0.14]
            : s.floor >= 2 || s.roomIndex >= 4
              ? [-0.14, 0.14]
              : [0];
        if (s.floor >= 3) {
          enemy.burstLeft = enemy.burstLeft ? 0 : 1;
        }
        for (const offset of spread) {
          const ang = enemy.aimAngle + offset;
          s.projectiles.push({
            id: this.nextEntityId++,
            friendly: false,
            x: enemy.x + Math.cos(ang) * (enemy.radius + 6),
            y: enemy.y + Math.sin(ang) * (enemy.radius + 6),
            vx: Math.cos(ang) * 340,
            vy: Math.sin(ang) * 340,
            radius: 7,
            damage: enemy.damage,
            ttl: 2.6,
            pierce: false,
            hitEnemyIds: [],
            kind: 'orb',
            angle: ang,
          });
        }
        enemy.state = 'recover';
        enemy.stateTimer = 0.78;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
        enemy.stateTimer = 0.65;
      }
    }
  }

  private stepChargerAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
  ): void {
    const s = this.state;

    if (
      enemy.archetype === 'elite_charger' &&
      !enemy.didPhaseAddSpawn &&
      enemy.hp <= enemy.maxHp * 0.6
    ) {
      enemy.didPhaseAddSpawn = true;
      this.announce('Warden calls reinforcements!');
      for (const offsetX of [-70, 70]) {
        const sx = Math.max(PLAY_MIN_X + 40, Math.min(PLAY_MAX_X - 40, enemy.x + offsetX));
        const sy = Math.max(PLAY_MIN_Y + 40, Math.min(PLAY_MAX_Y - 40, enemy.y + 45));
        s.enemies.push(
          createEnemy(
            this.nextEntityId++,
            'chaser',
            sx,
            sy,
            this.currentBlueprint.hpScale,
            s.modifier.enemyHpMult,
            s.modifier.enemySpeedMult,
            s.modifier.enemyDamageMult,
          ),
        );
      }
    }

    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (enemy.stateTimer <= 0 && dist <= 320 && hasMoveLOS) {
        enemy.state = 'telegraph';
        enemy.attackKind = 'charge';
        enemy.telegraphDuration = 0.62;
        enemy.stateTimer = 0.62;
        enemy.targetX = enemy.x + Math.cos(enemy.aimAngle) * 280;
        enemy.targetY = enemy.y + Math.sin(enemy.aimAngle) * 280;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'attack';
        enemy.stateTimer = 0.46;
        enemy.attackFired = false;
      }
    } else if (enemy.state === 'attack') {
      const chargeSpeed = 560 * s.modifier.enemySpeedMult;
      enemy.x += Math.cos(enemy.aimAngle) * chargeSpeed * dt;
      enemy.y += Math.sin(enemy.aimAngle) * chargeSpeed * dt;

      if (
        !enemy.attackFired &&
        Math.hypot(s.player.x - enemy.x, s.player.y - enemy.y) <=
          s.player.radius + enemy.radius + 8
      ) {
        enemy.attackFired = true;
        this.damagePlayer(enemy.damage);
      }

      // Blocks count as walls, so baiting a charge into one stuns the charger.
      const hitWall =
        enemy.x - enemy.radius <= PLAY_MIN_X + 2 ||
        enemy.x + enemy.radius >= PLAY_MAX_X - 2 ||
        enemy.y - enemy.radius <= PLAY_MIN_Y + 2 ||
        enemy.y + enemy.radius >= PLAY_MAX_Y - 2 ||
        this.pushOutOfObstacles(enemy, enemy.radius);

      enemy.stateTimer -= dt;
      if (hitWall) {
        s.shakeIntensity = Math.max(s.shakeIntensity, 4);
        this.spawnParticles(enemy.x, enemy.y, '#fbbf24', 7, 130);
        enemy.state = 'staggered';
        enemy.stateTimer = 0.8;
        enemy.attackKind = 'none';
      } else if (enemy.stateTimer <= 0) {
        enemy.state = 'recover';
        enemy.stateTimer = 0.65;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
        enemy.stateTimer = 0.65;
      }
    }
  }

  private stepShadeAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasShotLOS: boolean,
    dt: number,
  ): void {
    const s = this.state;
    const orbitDir = enemy.id % 2 === 0 ? 1 : -1;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      if (!hasShotLOS || dist > 210) {
        this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      } else if (dist < 130) {
        this.moveWithSlide(enemy, -dirX * enemy.speed * 0.85 * dt, -dirY * enemy.speed * 0.85 * dt);
      } else {
        this.moveWithSlide(enemy, -dirY * orbitDir * enemy.speed * 0.75 * dt, dirX * orbitDir * enemy.speed * 0.75 * dt);
      }
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 380 && hasShotLOS) {
        enemy.state = 'telegraph';
        enemy.attackKind = 'shade_fan';
        enemy.telegraphDuration = 0.55;
        enemy.stateTimer = 0.55;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        for (const offset of [-0.28, 0, 0.28]) {
          const ang = enemy.aimAngle + offset;
          s.projectiles.push({
            id: this.nextEntityId++,
            friendly: false,
            x: enemy.x + Math.cos(ang) * (enemy.radius + 6),
            y: enemy.y + Math.sin(ang) * (enemy.radius + 6),
            vx: Math.cos(ang) * 265,
            vy: Math.sin(ang) * 265,
            radius: 7,
            damage: enemy.damage,
            ttl: 1.45,
            pierce: false,
            hitEnemyIds: [],
            kind: 'orb',
            angle: ang,
          });
        }
        this.spawnParticles(enemy.x, enemy.y, '#c084fc', 6, 110);
        enemy.state = 'recover';
        enemy.stateTimer = 0.9;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      this.moveWithSlide(enemy, -dirY * orbitDir * enemy.speed * 0.4 * dt, dirX * orbitDir * enemy.speed * 0.4 * dt);
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
        enemy.stateTimer = 0.85;
      }
    }
  }

  private stepYetiAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    dt: number,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (enemy.stateTimer <= 0 && dist <= 420) {
        enemy.targetX = Math.max(PLAY_MIN_X + 36, Math.min(PLAY_MAX_X - 36, s.player.x));
        enemy.targetY = Math.max(PLAY_MIN_Y + 36, Math.min(PLAY_MAX_Y - 36, s.player.y));
        enemy.aimAngle = Math.atan2(enemy.targetY - enemy.y, enemy.targetX - enemy.x);
        enemy.state = 'telegraph';
        enemy.attackKind = 'ice_mortar';
        enemy.telegraphDuration = 0.65;
        enemy.stateTimer = 0.65;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        s.delayedBlasts.push({
          kind: 'ice_mortar',
          x: enemy.targetX,
          y: enemy.targetY,
          radius: 62,
          timer: 0.6,
          maxTimer: 0.6,
          damage: enemy.damage,
          friendly: false,
          alreadyScaled: true,
        });
        enemy.state = 'recover';
        enemy.stateTimer = 1.0;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
        enemy.stateTimer = 0.9;
      }
    }
  }

  private stepBomberAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      if (!hasMoveLOS || dist > 165) {
        this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      } else if (dist < 95) {
        this.moveWithSlide(enemy, -dirX * enemy.speed * 0.85 * dt, -dirY * enemy.speed * 0.85 * dt);
      } else {
        this.moveWithSlide(enemy, -dirY * enemy.speed * 0.7 * dt, dirX * enemy.speed * 0.7 * dt);
      }
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 185 && hasMoveLOS) {
        enemy.state = 'telegraph';
        enemy.attackKind = 'drop_bomb';
        enemy.telegraphDuration = 0.42;
        enemy.stateTimer = 0.42;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        s.delayedBlasts.push({
          kind: 'sapper_bomb',
          x: enemy.x,
          y: enemy.y,
          radius: 72,
          timer: 0.9,
          maxTimer: 0.9,
          damage: enemy.damage,
          friendly: false,
          alreadyScaled: true,
        });
        enemy.state = 'recover';
        enemy.stateTimer = 0.95;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      this.moveWithSlide(enemy, -dirX * enemy.speed * 1.15 * dt, -dirY * enemy.speed * 1.15 * dt);
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
        enemy.stateTimer = 0.7;
      }
    }
  }

  private stepMortarTankAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    hasShotLOS: boolean,
    dt: number,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      const moveX = Math.sign(navDirX) * enemy.speed * dt;
      const moveY = Math.sign(navDirY) * enemy.speed * dt;
      if (Math.abs(navDirX) >= Math.abs(navDirY) && moveX !== 0) {
        if (!this.tryMoveCardinal(enemy, moveX, 0) && moveY !== 0) {
          this.tryMoveCardinal(enemy, 0, moveY);
        }
      } else if (moveY !== 0) {
        if (!this.tryMoveCardinal(enemy, 0, moveY) && moveX !== 0) {
          this.tryMoveCardinal(enemy, moveX, 0);
        }
      }
      enemy.aimAngle = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
      if (enemy.stateTimer <= 0 && dist <= 440 && hasShotLOS) {
        enemy.state = 'telegraph';
        enemy.attackKind = 'tank_burst';
        enemy.telegraphDuration = 0.65;
        enemy.stateTimer = 0.65;
        enemy.burstLeft = 3;
        enemy.burstCooldown = 0;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'attack';
        enemy.burstCooldown = 0;
      }
    } else if (enemy.state === 'attack') {
      enemy.burstCooldown -= dt;
      while (enemy.burstLeft > 0 && enemy.burstCooldown <= 0) {
        const targetAng = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
        const delta = Math.max(-0.12, Math.min(0.12, normalizeAngle(targetAng - enemy.aimAngle)));
        enemy.aimAngle = normalizeAngle(enemy.aimAngle + delta);
        s.projectiles.push({
          id: this.nextEntityId++,
          friendly: false,
          x: enemy.x + Math.cos(enemy.aimAngle) * (enemy.radius + 6),
          y: enemy.y + Math.sin(enemy.aimAngle) * (enemy.radius + 6),
          vx: Math.cos(enemy.aimAngle) * 380,
          vy: Math.sin(enemy.aimAngle) * 380,
          radius: 7,
          damage: enemy.damage,
          ttl: 2.2,
          pierce: false,
          hitEnemyIds: [],
          kind: 'orb',
          angle: enemy.aimAngle,
        });
        enemy.burstLeft -= 1;
        enemy.burstCooldown += 0.15;
      }
      if (enemy.burstLeft <= 0) {
        enemy.state = 'recover';
        enemy.stateTimer = 1.05;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
        enemy.stateTimer = 0.95;
      }
    }
  }

  private stepStampedeAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (enemy.stateTimer <= 0 && dist <= 340 && hasMoveLOS) {
        enemy.state = 'telegraph';
        enemy.attackKind = 'ricochet_charge';
        enemy.telegraphDuration = 0.55;
        enemy.stateTimer = 0.55;
        enemy.bouncesLeft = 2;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0.12) {
        enemy.aimAngle = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
      }
      if (enemy.stateTimer <= 0) {
        enemy.state = 'attack';
        enemy.stateTimer = 1.25;
        enemy.attackFired = false;
      }
    } else if (enemy.state === 'attack') {
      const chargeSpeed = 480 * s.modifier.enemySpeedMult;
      const prevX = enemy.x;
      enemy.x += Math.cos(enemy.aimAngle) * chargeSpeed * dt;
      const hitX =
        enemy.x - enemy.radius <= PLAY_MIN_X + 2 ||
        enemy.x + enemy.radius >= PLAY_MAX_X - 2 ||
        this.pointInObstacle(enemy.x, enemy.y, enemy.radius - 1);
      if (hitX) enemy.x = prevX;

      const prevY = enemy.y;
      enemy.y += Math.sin(enemy.aimAngle) * chargeSpeed * dt;
      const hitY =
        enemy.y - enemy.radius <= PLAY_MIN_Y + 2 ||
        enemy.y + enemy.radius >= PLAY_MAX_Y - 2 ||
        this.pointInObstacle(enemy.x, enemy.y, enemy.radius - 1);
      if (hitY) enemy.y = prevY;

      if (
        !enemy.attackFired &&
        Math.hypot(s.player.x - enemy.x, s.player.y - enemy.y) <=
          s.player.radius + enemy.radius + 8
      ) {
        enemy.attackFired = true;
        this.damagePlayer(enemy.damage);
      }

      enemy.stateTimer -= dt;
      if (hitX || hitY) {
        if (hitX) enemy.aimAngle = Math.PI - enemy.aimAngle;
        if (hitY) enemy.aimAngle = -enemy.aimAngle;
        enemy.aimAngle = normalizeAngle(enemy.aimAngle);
        enemy.bouncesLeft -= 1;
        enemy.attackFired = false;
        s.shakeIntensity = Math.max(s.shakeIntensity, 3.5);
        this.spawnParticles(enemy.x, enemy.y, '#fbbf24', 6, 120);
        if (enemy.bouncesLeft < 0) {
          enemy.state = 'recover';
          enemy.stateTimer = 0.78;
          enemy.attackKind = 'none';
        }
      } else if (enemy.stateTimer <= 0) {
        enemy.state = 'recover';
        enemy.stateTimer = 0.78;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
        enemy.stateTimer = 0.65;
      }
    }
  }

  private stepBossAI(
    boss: EnemyEntity,
    navDirX: number,
    navDirY: number,
    dt: number,
  ): void {
    const s = this.state;

    if (boss.phase === 1 && boss.leapZ <= 0 && boss.hp <= boss.maxHp * 0.5) {
      boss.phase = 2;
      boss.state = 'recover';
      boss.stateTimer = 0.7;
      boss.attackKind = 'none';
      this.announce('Phase 2 - Threadkeeper Overclocked!');
      s.rings.push({
        x: boss.x,
        y: boss.y,
        radius: 25,
        maxRadius: 210,
        ttl: 0.4,
        maxTtl: 0.4,
        color: '#f43f5e',
      });
      if (!boss.didPhaseAddSpawn) {
        boss.didPhaseAddSpawn = true;
        for (const ox of [-110, 110]) {
          s.enemies.push(
            createEnemy(
              this.nextEntityId++,
              'chaser',
              Math.max(PLAY_MIN_X + 60, Math.min(PLAY_MAX_X - 60, boss.x + ox)),
              Math.max(PLAY_MIN_Y + 60, Math.min(PLAY_MAX_Y - 60, boss.y + 40)),
              1,
              s.modifier.enemyHpMult,
              s.modifier.enemySpeedMult,
              s.modifier.enemyDamageMult,
            ),
          );
        }
      }
      return;
    }

    const cadenceMult = boss.phase === 2 ? 0.8 : 1;
    const pickSafeLeapLanding = (): { x: number; y: number } => {
      const pt = {
        x: Math.max(PLAY_MIN_X + 64, Math.min(PLAY_MAX_X - 64, s.player.x)),
        y: Math.max(PLAY_MIN_Y + 64, Math.min(PLAY_MAX_Y - 64, s.player.y)),
      };
      this.pushOutOfObstacles(pt, boss.radius);
      this.clampToArena(pt, boss.radius);
      return pt;
    };

    if (boss.state === 'chase') {
      this.moveWithSlide(boss, navDirX * boss.speed * dt, navDirY * boss.speed * dt);
      boss.stateTimer -= dt;
      if (boss.stateTimer <= 0) {
        const pattern = chooseBossPattern(boss, this.bossRng);
        boss.state = 'telegraph';
        boss.attackKind = pattern;
        boss.telegraphDuration = pattern === 'boss_radial' ? 0.6 : 0.72;
        boss.stateTimer = boss.telegraphDuration;
        boss.aimAngle = Math.atan2(s.player.y - boss.y, s.player.x - boss.x);
        const landing = pickSafeLeapLanding();
        boss.targetX = landing.x;
        boss.targetY = landing.y;
        boss.leapStartX = boss.x;
        boss.leapStartY = boss.y;
        boss.leapZ = 0;
      }
    } else if (boss.state === 'telegraph') {
      boss.stateTimer -= dt;
      if (boss.attackKind === 'boss_leap') {
        if (boss.stateTimer > 0.25) {
          const landing = pickSafeLeapLanding();
          boss.targetX = landing.x;
          boss.targetY = landing.y;
          boss.aimAngle = Math.atan2(boss.targetY - boss.y, boss.targetX - boss.x);
        }
        if (this.fxRng.next() < dt * 10) {
          this.spawnParticles(boss.x, boss.y + boss.radius * 0.55, '#cbd5e1', 1, 55);
        }
      }
      if (boss.stateTimer <= 0) {
        if (boss.attackKind === 'boss_radial') {
          const count = boss.phase === 2 ? 8 : 6;
          for (let i = 0; i < count; i += 1) {
            const ang = boss.aimAngle + (i * Math.PI * 2) / count;
            s.projectiles.push({
              id: this.nextEntityId++,
              friendly: false,
              x: boss.x + Math.cos(ang) * (boss.radius + 8),
              y: boss.y + Math.sin(ang) * (boss.radius + 8),
              vx: Math.cos(ang) * 290,
              vy: Math.sin(ang) * 290,
              radius: 9,
              damage: boss.damage,
              ttl: 3.1,
              pierce: false,
              hitEnemyIds: [],
              kind: 'orb',
              angle: ang,
            });
          }
          boss.state = 'recover';
          boss.stateTimer = 0.85 * cadenceMult;
          boss.attackKind = 'none';
        } else {
          // Launch parabolic leap toward locked target (never instant teleport).
          boss.state = 'attack';
          boss.leapStartX = boss.x;
          boss.leapStartY = boss.y;
          boss.leapDuration = BOSS_LEAP_DURATION;
          boss.stateTimer = BOSS_LEAP_DURATION;
          boss.leapZ = 1;
          s.rings.push({
            x: boss.x,
            y: boss.y,
            radius: 16,
            maxRadius: 64,
            ttl: 0.22,
            maxTtl: 0.22,
            color: '#cbd5e1',
          });
          this.spawnParticles(boss.x, boss.y, '#cbd5e1', 8, 120);
        }
      }
    } else if (boss.state === 'attack' && boss.attackKind === 'boss_leap') {
      boss.stateTimer -= dt;
      const u = Math.max(
        0,
        Math.min(1, 1 - boss.stateTimer / Math.max(0.01, boss.leapDuration)),
      );
      boss.x = boss.leapStartX + (boss.targetX - boss.leapStartX) * u;
      boss.y = boss.leapStartY + (boss.targetY - boss.leapStartY) * u;
      boss.leapZ = Math.sin(u * Math.PI) * BOSS_LEAP_MAX_Z;

      if (boss.stateTimer <= 0) {
        boss.leapZ = 0;
        boss.x = boss.targetX;
        boss.y = boss.targetY;
        this.pushOutOfObstacles(boss, boss.radius);
        this.clampToArena(boss);
        s.shakeIntensity = Math.max(s.shakeIntensity, 8.5);
        this.spawnParticles(boss.x, boss.y, '#ef4444', 16, 210);
        this.spawnBreakDebris(boss.x, boss.y, 'pillar', true);
        if (Math.hypot(s.player.x - boss.x, s.player.y - boss.y) <= 86 + s.player.radius * 0.5) {
          this.damagePlayer(boss.damage);
        }
        s.rings.push({
          x: boss.x,
          y: boss.y,
          radius: 32,
          maxRadius: 150,
          ttl: 0.45,
          maxTtl: 0.45,
          color: '#f43f5e',
        });
        boss.state = 'recover';
        boss.stateTimer = 0.95 * cadenceMult;
        boss.attackKind = 'none';
      }
    } else if (boss.state === 'recover') {
      boss.leapZ = 0;
      boss.stateTimer -= dt;
      if (boss.stateTimer <= 0) {
        boss.state = 'chase';
        boss.stateTimer = 0.9 * cadenceMult;
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const s = this.state;
    const p = s.player;
    const active: ProjectileEntity[] = [];

    for (const proj of s.projectiles) {
      proj.ttl -= dt;
      if (proj.ttl <= 0) continue;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;

      if (
        proj.x - proj.radius < PLAY_MIN_X ||
        proj.x + proj.radius > PLAY_MAX_X ||
        proj.y - proj.radius < PLAY_MIN_Y ||
        proj.y + proj.radius > PLAY_MAX_Y
      ) {
        this.spawnParticles(proj.x, proj.y, proj.friendly ? '#fbbf24' : '#f97316', 4, 80);
        continue;
      }

      // Blocks stop every projectile (cover from shooters, and no shooting through walls).
      if (this.pointInObstacle(proj.x, proj.y, Math.min(proj.radius, 10) * 0.5)) {
        this.spawnParticles(proj.x, proj.y, proj.friendly ? '#fbbf24' : '#f97316', 4, 80);
        continue;
      }

      let consumed = false;
      if (proj.friendly && proj.weaponShot) {
        const speed = Math.max(1, Math.hypot(proj.vx, proj.vy));
        for (const enemy of [...s.enemies]) {
          if (enemy.spawnShieldTimer > 0 || enemy.leapZ > 24 || proj.hitEnemyIds.includes(enemy.id)) continue;
          if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= enemy.radius + proj.radius) {
            proj.hitEnemyIds.push(enemy.id);
            const killed = this.weaponHitEnemy(
              enemy,
              proj.damage,
              proj.vx / speed,
              proj.vy / speed,
              Boolean(proj.stripsArmor),
              { arcUsed: false },
            );
            this.afterWeaponHits(1, killed ? 1 : 0, proj.angle, proj.damage, proj.x, proj.y, proj.attackSeq ?? -1);
            if (!proj.pierce) {
              consumed = true;
              break;
            }
          }
        }
        if (!consumed) {
          for (const br of [...s.breakables]) {
            if (Math.hypot(br.x - proj.x, br.y - proj.y) <= br.radius + proj.radius) {
              this.damageBreakable(br, proj.damage);
              if (!proj.pierce) consumed = true;
              break;
            }
          }
        }
        if (!consumed) {
          for (const haz of s.hazards) {
            const hitRadius = Math.round(haz.w * 0.42);
            if (haz.type === 'barrels' && !haz.destroyed && Math.hypot(haz.x - proj.x, haz.y - proj.y) <= hitRadius + proj.radius) {
              this.triggerBarrelExplosion(haz);
              if (!proj.pierce) consumed = true;
              break;
            }
          }
        }
      } else if (proj.friendly) {
        for (const enemy of [...s.enemies]) {
          if (enemy.spawnShieldTimer > 0 || enemy.leapZ > 24 || proj.hitEnemyIds.includes(enemy.id)) continue;
          if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= enemy.radius + proj.radius) {
            proj.hitEnemyIds.push(enemy.id);
            this.damageEnemy(enemy, proj.damage, proj.vx * 0.25, proj.vy * 0.25, false, '#38bdf8');
            if (!proj.pierce) {
              consumed = true;
              break;
            }
          }
        }
      } else {
        if (Math.hypot(p.x - proj.x, p.y - proj.y) <= p.radius + proj.radius) {
          this.damagePlayer(proj.damage);
          consumed = true;
        } else {
          for (const br of [...s.breakables]) {
            if (Math.hypot(br.x - proj.x, br.y - proj.y) <= br.radius + proj.radius) {
              this.damageBreakable(br, 10);
              consumed = true;
              break;
            }
          }
        }
      }

      if (!consumed) {
        active.push(proj);
      }
    }

    s.projectiles = active;
  }

  private damageEnemy(
    enemy: EnemyEntity,
    rawDamage: number,
    knockVx: number,
    knockVy: number,
    stripsArmor: boolean,
    color: string,
    overrideLabel?: string,
  ): boolean {
    const s = this.state;
    if (enemy.spawnShieldTimer > 0) return false;

    let finalDamage = rawDamage;
    if (enemy.armor > 0) {
      if (stripsArmor) {
        enemy.armor = Math.max(0, enemy.armor - 1);
        if (enemy.armor === 0) {
          if (this.getStunSeconds() > 0) {
            enemy.state = 'staggered';
            enemy.stateTimer = 1.2;
          }
          this.addFloatingText(enemy.x, enemy.y - 34, 'ARMOR BROKEN!', '#fbbf24', 1.15);
          this.spawnParticles(enemy.x, enemy.y, '#fbbf24', 10, 175);
        } else {
          finalDamage *= 0.55;
          this.spawnParticles(enemy.x, enemy.y, '#94a3b8', 5, 110);
        }
      } else {
        finalDamage *= 0.4;
      }
    }

    const rounded = Math.max(1, Math.round(finalDamage));
    enemy.hp -= rounded;
    enemy.hitFlashTimer = 0.09;
    const kbResist = enemy.archetype === 'boss' ? 0.2 : 1;
    enemy.vx += knockVx * kbResist;
    enemy.vy += knockVy * kbResist;

    this.addFloatingText(
      enemy.x + this.fxRng.range(-10, 10),
      enemy.y - enemy.radius - 8,
      overrideLabel ?? `${rounded}`,
      color,
      1.0,
    );
    this.spawnParticles(enemy.x, enemy.y, color, 5, 120);

    if (enemy.hp <= 0) {
      const idx = s.enemies.indexOf(enemy);
      if (idx !== -1) {
        s.enemies.splice(idx, 1);
      }
      s.stats.enemiesKilled += 1;
      s.hitstopTimer = Math.max(s.hitstopTimer, HITSTOP_DURATION);
      this.spawnParticles(enemy.x, enemy.y, '#f8fafc', 11, 165);

      const coinCount = Math.max(
        1,
        Math.round(enemy.coinDrop * s.modifier.coinDropMult * this.floorScaling.coinMult),
      );
      this.spawnCoins(enemy.x, enemy.y, coinCount, false);
      this.maybeDropGem(enemy);

      if (s.modifier.deathBlast && enemy.archetype !== 'boss') {
        s.delayedBlasts.push({
          kind: 'volatile_blast',
          x: enemy.x,
          y: enemy.y,
          radius: 72,
          timer: 0.48,
          maxTimer: 0.48,
          damage: 16,
          friendly: false,
        });
      }

      return true;
    }

    return false;
  }

  /** Gems come only from defeating end-of-floor bosses. */
  private maybeDropGem(enemy: EnemyEntity): void {
    if (enemy.archetype !== 'boss') return;
    const ang = this.fxRng.range(0, Math.PI * 2);
    this.state.gems.push({
      id: this.nextEntityId++,
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(ang) * 90,
      vy: Math.sin(ang) * 90,
      age: 0,
    });
    this.addFloatingText(enemy.x, enemy.y - enemy.radius - 22, 'GEM!', '#f0abfc', 1.2);
    this.spawnParticles(enemy.x, enemy.y, '#e879f9', 12, 150);
  }

  private updateGems(dt: number): void {
    const s = this.state;
    const p = s.player;
    const kept: GemEntity[] = [];
    for (const gem of s.gems) {
      gem.age += dt;
      const dx = p.x - gem.x;
      const dy = p.y - gem.y;
      const dist = Math.hypot(dx, dy);
      if ((dist <= p.magnetRadius || s.roomState !== 'combat') && gem.age > 0.4 && dist > 1) {
        const pull = 360 + gem.age * 120;
        gem.vx = (dx / dist) * pull;
        gem.vy = (dy / dist) * pull;
      } else {
        const damp = Math.exp(-5 * dt);
        gem.vx *= damp;
        gem.vy *= damp;
      }
      gem.x += gem.vx * dt;
      gem.y += gem.vy * dt;
      this.clampToArena(gem, 10);
      if (Math.hypot(p.x - gem.x, p.y - gem.y) <= p.radius + 14) {
        s.stats.gemsEarned += 1;
        this.addFloatingText(p.x, p.y - 30, '+1 GEM', '#f0abfc', 1.2);
        this.spawnParticles(gem.x, gem.y, '#e879f9', 10, 120);
        continue;
      }
      kept.push(gem);
    }
    s.gems = kept;
  }

  private updateHearts(dt: number): void {
    const s = this.state;
    const p = s.player;
    const kept: HeartEntity[] = [];
    for (const heart of s.hearts) {
      heart.age += dt;
      const touching = Math.hypot(p.x - heart.x, p.y - heart.y) <= p.radius + 16;
      // Only picked up when it would actually heal, so you can save it for later.
      if (touching && heart.age > 0.25 && p.hp < p.maxHp) {
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + HEART_HEAL);
        this.addFloatingText(p.x, p.y - 26, `+${Math.round(p.hp - before)} HP`, '#4ade80', 1.15);
        this.spawnParticles(heart.x, heart.y, '#f87171', 10, 120);
        continue;
      }
      kept.push(heart);
    }
    s.hearts = kept;
  }

  private damageBreakable(br: BreakableEntity, amount: number): void {
    const s = this.state;
    br.hp -= amount;
    br.hitFlash = 0.1;
    const isBroken = br.hp <= 0;
    this.spawnBreakDebris(br.x, br.y, br.kind, !isBroken);
    if (isBroken) {
      const idx = s.breakables.indexOf(br);
      if (idx !== -1) s.breakables.splice(idx, 1);
      this.spawnCoins(br.x, br.y, 1, false);
      if (br.kind === 'crate' && this.lootRng.next() < HEART_CRATE_CHANCE) {
        s.hearts.push({ id: this.nextEntityId++, x: br.x, y: br.y, age: 0 });
      }
    }
  }

  private damagePlayer(rawAmount: number): void {
    const s = this.state;
    const p = s.player;
    if (p.iFramesTimer > 0 || s.phase !== 'playing') return;

    p.iFramesTimer = HURT_IFRAMES;
    p.hurtFlashTimer = 0.22;
    s.shakeIntensity = Math.max(s.shakeIntensity, 6);

    if (p.shields > 0) {
      p.shields -= 1;
      this.addFloatingText(p.x, p.y - 26, 'SHIELDED!', '#38bdf8', 1.1);
      this.spawnParticles(p.x, p.y, '#38bdf8', 10, 145);
      return;
    }

    const dmg = Math.max(1, Math.round(rawAmount));
    p.hp = Math.max(0, p.hp - dmg);
    s.stats.damageTaken += dmg;
    this.addFloatingText(p.x, p.y - 24, `-${dmg}`, '#ef4444', 1.1);
    this.spawnParticles(p.x, p.y, '#ef4444', 9, 140);
  }

  private spawnCoins(x: number, y: number, count: number, magnetized: boolean): void {
    if (count <= 0) return;
    const maxEntities = count >= 10 ? 4 : count >= 4 ? 3 : count;
    const baseValue = Math.floor(count / maxEntities);
    const remainder = count % maxEntities;
    for (let i = 0; i < maxEntities; i += 1) {
      const value = baseValue + (i < remainder ? 1 : 0);
      const ang = this.fxRng.range(0, Math.PI * 2);
      const spd = this.fxRng.range(40, 105);
      this.state.coins.push({
        id: this.nextEntityId++,
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        value,
        magnetized,
        age: 0,
      });
    }
  }

  private updateCoins(dt: number): void {
    const s = this.state;
    const p = s.player;
    const kept: CoinEntity[] = [];

    for (const coin of s.coins) {
      coin.age += dt;
      const dx = p.x - coin.x;
      const dy = p.y - coin.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= p.magnetRadius || s.roomState !== 'combat') {
        coin.magnetized = true;
      }

      if (coin.magnetized && dist > 1) {
        const pullSpeed = 430 + coin.age * 160;
        coin.vx = (dx / dist) * pullSpeed;
        coin.vy = (dy / dist) * pullSpeed;
      } else {
        const damp = Math.exp(-6 * dt);
        coin.vx *= damp;
        coin.vy *= damp;
      }

      coin.x += coin.vx * dt;
      coin.y += coin.vy * dt;
      this.clampToArena(coin, 8);

      if (Math.hypot(p.x - coin.x, p.y - coin.y) <= p.radius + 14) {
        const value = Math.max(1, Math.round(coin.value * p.coinBonusMult));
        s.stats.coinsEarned += value;
        this.spawnParticles(coin.x, coin.y, '#fbbf24', 3, 60);
        continue;
      }

      kept.push(coin);
    }

    s.coins = kept;
  }

  private onRoomCleared(): void {
    const s = this.state;
    s.projectiles = s.projectiles.filter((proj) => proj.friendly);
    s.delayedBlasts = s.delayedBlasts.filter((blast) => blast.friendly && !blast.hurtPlayerToo);
    s.coins.forEach((c) => {
      c.magnetized = true;
    });

    const savedBreakables = s.breakables.map((b) => ({ ...b, hitFlash: 0 }));
    const mem = this.roomMemory.get(s.currentRoomId);
    if (mem) {
      mem.cleared = true;
      mem.breakables = savedBreakables;
    } else {
      this.roomMemory.set(s.currentRoomId, {
        visited: true,
        cleared: true,
        rewardClaimed: false,
        fountainUsed: false,
        breakables: savedBreakables,
      });
    }
    s.roomsClearedTotal += 1;
    this.refreshMapView();

    const coinMult = this.floorScaling.coinMult;

    if (s.rewardType === 'coin_cache') {
      this.spawnCoins(ARENA_W / 2, ARENA_H / 2 - 16, Math.round(5 * coinMult), true);
      s.roomState = 'door_open';
      this.announce('Coin Cache! Doors Open');
      return;
    }

    if (s.rewardType === 'boss_chest_and_portals') {
      s.stats.bossDefeated = true;
      s.floorsCleared += 1;
      this.spawnCoins(ARENA_W / 2, ARENA_H / 2 - 16, Math.round(10 * coinMult), true);
      const p = s.player;
      const heal = Math.round(p.maxHp * 0.4);
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + heal);
      const healed = Math.round(p.hp - before);
      if (healed > 0) this.addFloatingText(p.x, p.y - 26, `+${healed} HP`, '#4ade80', 1.2);

      this.spawnRelicPedestals(undefined, Math.round(ARENA_H * 0.49));
      if (s.pedestals.length > 0) {
        s.roomState = 'reward';
        this.announce(`Floor ${s.floor} cleared! Pick a relic`);
      } else {
        s.portals = [this.makeStairsPortal()];
        s.roomState = 'boss_choice';
        this.announce(`Floor ${s.floor} cleared! Take the stairs`);
      }
      return;
    }

    // Relics only drop between floors (after the boss). Other rooms pay out coins or heal.
    if (s.rewardType === 'fountain_and_relics') {
      s.fountain = {
        x: ARENA_W / 2,
        y: Math.round(ARENA_H * 0.67),
        used: false,
        healAmount: Math.round(s.player.maxHp * 0.35),
      };
      s.roomState = 'door_open';
      this.announce('Fountain unlocked');
      return;
    }

    const cache = s.rewardType === 'synergy_relics' ? 8 : 4;
    this.spawnCoins(ARENA_W / 2, ARENA_H / 2 - 16, Math.round(cache * coinMult), true);
    s.roomState = 'door_open';
    this.announce('Room cleared');
  }

  private spawnRelicPedestals(filter: 'synergy' | undefined, py: number): void {
    const s = this.state;
    const drafted = draftRelics(this.relicRng, this.profile.unlockedRelics, 3, filter);
    const xs = [ARENA_W / 2 - 126, ARENA_W / 2, ARENA_W / 2 + 126];
    s.pedestals = drafted.map((relic, idx) => ({
      id: this.nextEntityId++,
      x: xs[idx] ?? ARENA_W / 2,
      y: py,
      relic,
      nextLevel: (s.player.relics[relic.id] ?? 0) + 1,
      claimProgress: 0,
      hovered: false,
    }));
  }

  private updatePostRoomInteractions(dt: number): void {
    const s = this.state;
    const p = s.player;

    if (s.fountain && !s.fountain.used) {
      if (Math.hypot(p.x - s.fountain.x, p.y - s.fountain.y) <= p.radius + 26) {
        s.fountain.used = true;
        const mem = this.roomMemory.get(s.currentRoomId);
        if (mem) {
          mem.fountainUsed = true;
        }
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + s.fountain.healAmount);
        const healed = Math.round(p.hp - before);
        this.addFloatingText(p.x, p.y - 26, `+${healed || s.fountain.healAmount} HP`, '#4ade80', 1.2);
        this.spawnParticles(s.fountain.x, s.fountain.y, '#4ade80', 14, 150);
      }
    }

    if (s.roomState === 'reward' && s.pedestals.length > 0) {
      let closestPed: PedestalEntity | null = null;
      let closestDist = 84;
      for (const ped of s.pedestals) {
        ped.claimProgress = 0;
        ped.hovered = false;
        const dist = Math.hypot(p.x - ped.x, p.y - ped.y);
        if (dist <= closestDist) {
          closestDist = dist;
          closestPed = ped;
        }
      }
      if (closestPed) {
        closestPed.hovered = true;
      }
    }

    for (const portal of s.portals) {
      const dist = Math.hypot(p.x - portal.x, p.y - portal.y);
      if (dist <= 40) {
        portal.progress = Math.min(1, portal.progress + dt / 0.45);
        if (portal.progress >= 1) {
          this.descendFloor();
          return;
        }
      } else {
        portal.progress = Math.max(0, portal.progress - dt * 2);
      }
    }

    if (
      (s.roomState === 'door_open' || s.roomState === 'boss_choice') &&
      this.doorEntryLockTimer <= 0
    ) {
      for (const door of s.doors) {
        const hitDoor =
          door.dir === 'north'
            ? Math.abs(p.x - ARENA_W / 2) <= 50 && p.y - p.radius <= PLAY_MIN_Y + 10
            : door.dir === 'south'
              ? Math.abs(p.x - ARENA_W / 2) <= 50 && p.y + p.radius >= PLAY_MAX_Y - 10
              : door.dir === 'west'
                ? Math.abs(p.y - ARENA_H / 2) <= 50 && p.x - p.radius <= PLAY_MIN_X + 10
                : Math.abs(p.y - ARENA_H / 2) <= 50 && p.x + p.radius >= PLAY_MAX_X - 10;
        if (hitDoor) {
          this.enterMapRoom(door.targetRoomId, 'door', door.dir);
          return;
        }
      }
    }
  }

  private claimPedestal(claimed: PedestalEntity): void {
    const s = this.state;
    const p = s.player;
    p.relics[claimed.relic.id] = claimed.nextLevel;
    const mem = this.roomMemory.get(s.currentRoomId);
    if (mem) {
      mem.rewardClaimed = true;
    }
    s.hitstopTimer = Math.max(s.hitstopTimer, 0.03);
    s.shakeIntensity = Math.max(s.shakeIntensity, 4.5);
    s.rings.push({
      x: claimed.x,
      y: claimed.y,
      radius: 14,
      maxRadius: 72,
      ttl: 0.24,
      maxTtl: 0.24,
      color: '#fbbf24',
    });
    this.spawnParticles(claimed.x, claimed.y, '#fbbf24', 22, 185);
    this.addFloatingText(
      claimed.x,
      claimed.y - 32,
      `${claimed.relic.name} Lv ${claimed.nextLevel}`,
      '#fde047',
      1.15,
    );
    s.pedestals = [];
    if (s.currentRoomId === this.dungeonMap.bossRoomId) {
      s.portals = [this.makeStairsPortal()];
      s.roomState = 'boss_choice';
      this.announce('The stairs open — descend when ready');
      return;
    }
    s.roomState = 'door_open';
    this.announce('Doors Open!');
  }

  private updateVisualEffects(dt: number): void {
    const s = this.state;

    for (const br of s.breakables) {
      br.hitFlash = Math.max(0, br.hitFlash - dt);
    }

    s.slashes = s.slashes.filter((item) => {
      item.ttl -= dt;
      return item.ttl > 0;
    });

    const nextRings: RingEffect[] = [];
    for (const ring of s.rings) {
      ring.ttl -= dt;
      if (ring.ttl <= 0) continue;
      const progress = 1 - ring.ttl / ring.maxTtl;
      ring.radius = 24 + (ring.maxRadius - 24) * progress;

      if (ring.harmfulToPlayer && !ring.hitPlayer && s.phase === 'playing') {
        const dist = Math.hypot(s.player.x - ring.x, s.player.y - ring.y);
        if (Math.abs(dist - ring.radius) <= 18 + s.player.radius * 0.5) {
          ring.hitPlayer = true;
          this.damagePlayer((ring.damage ?? 16) * s.modifier.enemyDamageMult);
        }
      }

      nextRings.push(ring);
    }
    s.rings = nextRings;

    s.lightnings = s.lightnings.filter((l) => {
      l.ttl -= dt;
      return l.ttl > 0;
    });

    s.afterimages = s.afterimages.filter((a) => {
      a.ttl -= dt;
      return a.ttl > 0;
    });

    s.particles = s.particles.filter((pt) => {
      pt.ttl -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.92;
      pt.vy *= 0.92;
      return pt.ttl > 0;
    });

    const nextDebris: DebrisEffect[] = [];
    for (const d of s.debris) {
      d.ttl -= dt;
      if (d.ttl <= 0) continue;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vz -= 640 * dt;
      d.z += d.vz * dt;
      d.angle += d.spin * dt;
      if (d.z < 0) {
        d.z = 0;
        d.vz = Math.abs(d.vz) * 0.36;
        d.vx *= 0.68;
        d.vy *= 0.68;
        d.spin *= 0.6;
      } else {
        d.vx *= 0.97;
        d.vy *= 0.97;
      }
      nextDebris.push(d);
    }
    s.debris = nextDebris;

    s.floatingTexts = s.floatingTexts.filter((ft) => {
      ft.ttl -= dt;
      ft.y += ft.vy * dt;
      return ft.ttl > 0;
    });
  }

  private spawnBreakDebris(
    x: number,
    y: number,
    kind: 'crate' | 'pillar' | 'barrel',
    light = false,
  ): void {
    const palette =
      kind === 'crate'
        ? (['#c2844c', '#9a5b2d', '#e0a96d', '#7c4521'] as const)
        : kind === 'barrel'
          ? (['#b91c1c', '#92400e', '#dc2626', '#52525b', '#78350f'] as const)
          : (['#94a3b8', '#64748b', '#cbd5e1', '#475569'] as const);
    const borderColor =
      kind === 'crate' ? '#2a1810' : kind === 'barrel' ? '#18181b' : '#1e293b';
    const count = light ? (kind === 'barrel' ? 4 : 3) : kind === 'crate' ? 9 : kind === 'barrel' ? 11 : 10;

    for (let i = 0; i < count; i += 1) {
      const ang = this.fxRng.range(0, Math.PI * 2);
      const minSpd = light ? 50 : kind === 'barrel' ? 130 : 85;
      const maxSpd = light ? 115 : kind === 'barrel' ? 270 : 185;
      const spd = this.fxRng.range(minSpd, maxSpd);
      const minVz = light ? 90 : kind === 'barrel' ? 150 : 135;
      const maxVz = light ? 150 : kind === 'barrel' ? 300 : 240;
      const ttl = light ? this.fxRng.range(0.25, 0.38) : this.fxRng.range(0.45, 0.72);
      const w =
        kind === 'pillar'
          ? this.fxRng.range(6, 12)
          : kind === 'barrel'
            ? this.fxRng.range(9, 15)
            : this.fxRng.range(8, 14);
      const h = kind === 'pillar' ? this.fxRng.range(6, 10) : this.fxRng.range(4, 6);
      const spinSign = this.fxRng.next() < 0.5 ? -1 : 1;
      this.state.debris.push({
        x: x + this.fxRng.range(-10, 10),
        y: y + this.fxRng.range(-8, 8),
        z: this.fxRng.range(4, 14),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        vz: this.fxRng.range(minVz, maxVz),
        angle: this.fxRng.range(0, Math.PI * 2),
        spin: spinSign * this.fxRng.range(5, 12),
        w,
        h,
        color: palette[i % palette.length]!,
        borderColor,
        ttl,
        maxTtl: ttl,
      });
    }

    if (!light) {
      const s = this.state;
      if (kind === 'crate') {
        s.rings.push({
          x,
          y,
          radius: 8,
          maxRadius: 34,
          ttl: 0.16,
          maxTtl: 0.16,
          color: '#d97706',
        });
        this.spawnParticles(x, y, '#e7c89c', 7, 130);
        s.shakeIntensity = Math.max(s.shakeIntensity, 2.5);
      } else if (kind === 'pillar') {
        s.rings.push({
          x,
          y,
          radius: 10,
          maxRadius: 38,
          ttl: 0.18,
          maxTtl: 0.18,
          color: '#cbd5e1',
        });
        this.spawnParticles(x, y, '#cbd5e1', 8, 145);
        s.shakeIntensity = Math.max(s.shakeIntensity, 3.8);
      } else {
        this.spawnParticles(x, y, '#fb923c', 7, 175);
        this.spawnParticles(x, y, '#fde047', 5, 150);
      }
    }
  }

  private spawnParticles(x: number, y: number, color: string, count: number, maxSpeed: number): void {
    for (let i = 0; i < count; i += 1) {
      const ang = this.fxRng.range(0, Math.PI * 2);
      const spd = this.fxRng.range(maxSpeed * 0.3, maxSpeed);
      const ttl = this.fxRng.range(0.18, 0.42);
      this.state.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        radius: this.fxRng.range(2, 4.2),
        ttl,
        maxTtl: ttl,
        color,
      });
    }
  }

  private addFloatingText(
    x: number,
    y: number,
    text: string,
    color: string,
    scale = 1,
  ): void {
    this.state.floatingTexts.push({
      x,
      y,
      vy: -36,
      text,
      color,
      ttl: 0.65,
      maxTtl: 0.65,
      scale,
    });
  }

  private announce(text: string): void {
    this.state.announcementText = text;
    this.state.announcementTimer = 2.6;
  }

  private worldToCell(x: number, y: number): { col: number; row: number } {
    return {
      col: Math.max(0, Math.min(LAYOUT_COLS - 1, Math.floor(x / CELL_SIZE) - 1)),
      row: Math.max(0, Math.min(LAYOUT_ROWS - 1, Math.floor(y / CELL_SIZE) - 1)),
    };
  }

  private cellCenterWorld(col: number, row: number): { x: number; y: number } {
    return {
      x: (col + 1.5) * CELL_SIZE,
      y: (row + 1.5) * CELL_SIZE,
    };
  }

  private hasClearLine(x1: number, y1: number, x2: number, y2: number, pad: number): boolean {
    if (this.state.obstacles.length === 0) return true;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist <= 1) return !this.pointInObstacle(x2, y2, pad);
    const steps = Math.max(2, Math.ceil(dist / 12));
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      if (this.pointInObstacle(x1 + dx * t, y1 + dy * t, pad)) {
        return false;
      }
    }
    return true;
  }

  private computePlayerFlowField(): Int16Array | null {
    if (this.state.obstacles.length === 0) return null;
    const blocked = new Uint8Array(LAYOUT_COLS * LAYOUT_ROWS);
    for (let r = 0; r < LAYOUT_ROWS; r += 1) {
      const y0 = (r + 1) * CELL_SIZE;
      const y1 = y0 + CELL_SIZE;
      for (let c = 0; c < LAYOUT_COLS; c += 1) {
        const x0 = (c + 1) * CELL_SIZE;
        const x1 = x0 + CELL_SIZE;
        for (const o of this.state.obstacles) {
          if (o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0) {
            blocked[r * LAYOUT_COLS + c] = 1;
            break;
          }
        }
      }
    }

    const dist = new Int16Array(LAYOUT_COLS * LAYOUT_ROWS).fill(-1);
    const { col: pCol, row: pRow } = this.worldToCell(this.state.player.x, this.state.player.y);
    const queue: number[] = [];
    const startIdx = pRow * LAYOUT_COLS + pCol;
    if (blocked[startIdx] === 0) {
      dist[startIdx] = 0;
      queue.push(startIdx);
    } else {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dc === 0 && dr === 0) continue;
          const nc = pCol + dc;
          const nr = pRow + dr;
          if (nc < 0 || nc >= LAYOUT_COLS || nr < 0 || nr >= LAYOUT_ROWS) continue;
          const idx = nr * LAYOUT_COLS + nc;
          if (blocked[idx] === 0 && dist[idx] === -1) {
            dist[idx] = 0;
            queue.push(idx);
          }
        }
      }
    }

    const dirs: readonly (readonly [number, number])[] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head]!;
      head += 1;
      const c = idx % LAYOUT_COLS;
      const r = Math.floor(idx / LAYOUT_COLS);
      const nextD = dist[idx]! + 1;
      for (const [dc, dr] of dirs) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= LAYOUT_COLS || nr < 0 || nr >= LAYOUT_ROWS) continue;
        const nIdx = nr * LAYOUT_COLS + nc;
        if (blocked[nIdx] === 0 && dist[nIdx] === -1) {
          dist[nIdx] = nextD;
          queue.push(nIdx);
        }
      }
    }
    return dist;
  }

  private pickBestNeighborCell(
    distGrid: Int16Array,
    col: number,
    row: number,
    refX: number,
    refY: number,
  ): { col: number; row: number } | null {
    const p = this.state.player;
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    let bestRefDist = Infinity;
    let bestPlayerDist = Infinity;

    const consider = (nc: number, nr: number): void => {
      if (nc < 0 || nc >= LAYOUT_COLS || nr < 0 || nr >= LAYOUT_ROWS) return;
      const d = distGrid[nr * LAYOUT_COLS + nc]!;
      if (d < 0) return;
      const center = this.cellCenterWorld(nc, nr);
      const refDist = Math.hypot(center.x - refX, center.y - refY);
      const playerDist = Math.hypot(center.x - p.x, center.y - p.y);
      if (
        d < bestDist ||
        (d === bestDist && refDist + 0.01 < bestRefDist) ||
        (d === bestDist && Math.abs(refDist - bestRefDist) <= 0.01 && playerDist < bestPlayerDist)
      ) {
        best = { col: nc, row: nr };
        bestDist = d;
        bestRefDist = refDist;
        bestPlayerDist = playerDist;
      }
    };

    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dc === 0 && dr === 0) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= LAYOUT_COLS || nr < 0 || nr >= LAYOUT_ROWS) continue;
        if (dc !== 0 && dr !== 0) {
          // Never corner-cut around solid blocks.
          if (distGrid[row * LAYOUT_COLS + nc]! < 0 || distGrid[nr * LAYOUT_COLS + col]! < 0) continue;
        }
        consider(nc, nr);
      }
    }

    if (!best) {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dc !== 0 || dr !== 0) consider(col + dc, row + dr);
        }
      }
    }
    return best;
  }

  private getNavDirection(
    enemy: EnemyEntity,
    distGrid: Int16Array | null,
    rawDirX: number,
    rawDirY: number,
  ): { dirX: number; dirY: number; hasMoveLOS: boolean; hasShotLOS: boolean } {
    if (!distGrid) {
      return { dirX: rawDirX, dirY: rawDirY, hasMoveLOS: true, hasShotLOS: true };
    }
    const p = this.state.player;
    const movePad = Math.min(enemy.radius - 1, 14);
    const hasMoveLOS = this.hasClearLine(enemy.x, enemy.y, p.x, p.y, movePad);
    const hasShotLOS = this.hasClearLine(enemy.x, enemy.y, p.x, p.y, 12);
    if (hasMoveLOS) {
      return { dirX: rawDirX, dirY: rawDirY, hasMoveLOS: true, hasShotLOS };
    }

    const { col, row } = this.worldToCell(enemy.x, enemy.y);
    const next = this.pickBestNeighborCell(distGrid, col, row, enemy.x, enemy.y);
    if (!next) {
      return { dirX: rawDirX, dirY: rawDirY, hasMoveLOS: false, hasShotLOS };
    }

    let target = this.cellCenterWorld(next.col, next.row);
    const lookAhead = this.pickBestNeighborCell(distGrid, next.col, next.row, enemy.x, enemy.y);
    if (lookAhead) {
      const nextCenter = this.cellCenterWorld(lookAhead.col, lookAhead.row);
      if (this.hasClearLine(enemy.x, enemy.y, nextCenter.x, nextCenter.y, Math.min(enemy.radius + 1, 20))) {
        target = nextCenter;
      }
    }

    const tx = target.x - enemy.x;
    const ty = target.y - enemy.y;
    const tDist = Math.hypot(tx, ty);
    if (tDist <= 0.001) {
      return { dirX: rawDirX, dirY: rawDirY, hasMoveLOS: false, hasShotLOS };
    }
    return { dirX: tx / tDist, dirY: ty / tDist, hasMoveLOS: false, hasShotLOS };
  }

  private tryMoveCardinal(enemy: EnemyEntity, dx: number, dy: number): boolean {
    const prevX = enemy.x;
    const prevY = enemy.y;
    enemy.x += dx;
    enemy.y += dy;
    const blocked =
      enemy.x - enemy.radius < PLAY_MIN_X ||
      enemy.x + enemy.radius > PLAY_MAX_X ||
      enemy.y - enemy.radius < PLAY_MIN_Y ||
      enemy.y + enemy.radius > PLAY_MAX_Y ||
      this.pointInObstacle(enemy.x, enemy.y, enemy.radius - 1);
    if (blocked) {
      enemy.x = prevX;
      enemy.y = prevY;
      return false;
    }
    return true;
  }

  private moveWithSlide(enemy: EnemyEntity, dxStep: number, dyStep: number): void {
    const prevX = enemy.x;
    enemy.x += dxStep;
    if (
      enemy.x - enemy.radius < PLAY_MIN_X ||
      enemy.x + enemy.radius > PLAY_MAX_X ||
      this.pointInObstacle(enemy.x, enemy.y, enemy.radius - 1)
    ) {
      enemy.x = prevX;
    }
    const prevY = enemy.y;
    enemy.y += dyStep;
    if (
      enemy.y - enemy.radius < PLAY_MIN_Y ||
      enemy.y + enemy.radius > PLAY_MAX_Y ||
      this.pointInObstacle(enemy.x, enemy.y, enemy.radius - 1)
    ) {
      enemy.y = prevY;
    }
  }

  /** Push a circle out of any solid block it overlaps. Returns true if it touched one. */
  private pushOutOfObstacles(e: { x: number; y: number }, radius: number): boolean {
    let hit = false;
    for (const o of this.state.obstacles) {
      const cx = Math.max(o.x, Math.min(o.x + o.w, e.x));
      const cy = Math.max(o.y, Math.min(o.y + o.h, e.y));
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      hit = true;
      if (d > 0.0001) {
        e.x = cx + (dx / d) * radius;
        e.y = cy + (dy / d) * radius;
      } else {
        // Centre is inside the block: leave by the shortest side.
        const left = e.x - o.x;
        const right = o.x + o.w - e.x;
        const top = e.y - o.y;
        const bottom = o.y + o.h - e.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) e.x = o.x - radius;
        else if (m === right) e.x = o.x + o.w + radius;
        else if (m === top) e.y = o.y - radius;
        else e.y = o.y + o.h + radius;
      }
    }
    return hit;
  }

  private pointInObstacle(x: number, y: number, pad: number): boolean {
    return this.state.obstacles.some(
      (o) => x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad,
    );
  }

  private clampToArena(entity: { x: number; y: number; radius?: number }, pad?: number): void {
    const r = pad ?? entity.radius ?? 14;
    entity.x = Math.max(PLAY_MIN_X + r, Math.min(PLAY_MAX_X - r, entity.x));
    entity.y = Math.max(PLAY_MIN_Y + r, Math.min(PLAY_MAX_Y - r, entity.y));
  }

  private beginPlayerDeath(): void {
    const s = this.state;
    const p = s.player;
    s.phase = 'dying';
    s.deathDuration = DEATH_ANIM_DURATION;
    s.deathTimer = DEATH_ANIM_DURATION;
    p.vx = 0;
    p.vy = 0;
    p.attackAnimTimer = 0;
    p.attackEndlagTimer = 0;
    p.attackBufferedTimer = 0;
    p.hurtFlashTimer = 0.25;
    s.hitstopTimer = 0.14;
    s.shakeIntensity = Math.max(s.shakeIntensity, 10);
    s.rings.push({
      x: p.x,
      y: p.y,
      radius: 10,
      maxRadius: 96,
      ttl: 0.45,
      maxTtl: 0.45,
      color: '#ef4444',
    });
    this.spawnParticles(p.x, p.y, '#ef4444', 18, 210);
    this.spawnParticles(p.x, p.y, '#fff7e8', 10, 150);
    this.addFloatingText(p.x, p.y - 30, 'YOU DIED', '#fecaca', 1.25);
  }

  private finishRun(extracted: boolean): void {
    if (this.state.phase === 'ended') return;
    this.state.stats.extracted = extracted;
    this.state.phase = 'ended';
    const summary = this.getRunSummary();
    this.endCallback?.(summary);
  }
}

const HEART_CRATE_CHANCE = 0.35;
const HEART_HEAL = 15;
const BOSS_LEAP_DURATION = 0.78;
const BOSS_LEAP_MAX_Z = 135;

function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
