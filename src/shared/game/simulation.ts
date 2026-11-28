import {
  getDailyHazard,
  getDailyModifier,
  getDailyStarterRelic,
  resolveDailyWeapon,
} from '../modifiers.ts';
import {
  draftRelics,
  VITALITY_HP_PER_LEVEL,
  WHETSTONE_DAMAGE_PER_LEVEL,
} from '../relics.ts';
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
import {
  createEnemy,
  getBossDisplayName,
  type BossBaseArchetype,
  type EnemyAttackKind,
  type EnemyEntity,
} from './enemies.ts';
import {
  CELL_SIZE,
  LAYOUT_COLS,
  LAYOUT_ROWS,
  buildDailyDungeonMap,
  getFloorBossSpec,
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

export type ProjectileKind =
  | 'orb'
  | 'rift_wave'
  | 'bolt'
  | 'lance'
  | 'arrow'
  | 'ember'
  | 'arcane'
  | 'shadow'
  | 'ice'
  | 'shell'
  | 'rock'
  | 'coin';

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
  kind: ProjectileKind;
  /** Weapon projectiles proc on-hit relics; relic/reflected projectiles do not. */
  weaponShot?: boolean | undefined;
  stripsArmor?: boolean | undefined;
  attackSeq?: number | undefined;
  angle: number;
  /** Enemy shots that gently steer toward the player (turn rate in rad/s). */
  homing?: number | undefined;
  /** Seconds of homing left before the shot flies straight. */
  homingTime?: number | undefined;
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
  /** Binary ON/OFF state for spike plates (true = extended/lethal, false = recessed/safe). */
  active: boolean;
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
  kind: 'crate' | 'pillar' | 'chest';
  hitFlash: number;
  /** Chests open when the player walks up to them (they are never smashed). */
  opened?: boolean | undefined;
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

export type SporeCloudEffect = {
  id: number;
  x: number;
  y: number;
  radius: number;
  ttl: number;
  maxTtl: number;
  damage: number;
};

export type LobKind = 'bomb' | 'shell' | 'spore_pod' | 'snowball' | 'rock';

/** Something a monster throws in a visible arc; it lands at (tx, ty). */
export type LobEffect = {
  id: number;
  kind: LobKind;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  timer: number;
  duration: number;
  /** Arc height in px. */
  peak: number;
  radius: number;
  /** Seconds a landed bomb fizzes before exploding. */
  fuse: number;
  damage: number;
};

export type DelayedBlastEffect = {
  kind:
    | 'decoy_mine'
    | 'phantom_echo'
    | 'shatter_quake'
    | 'volatile_blast'
    | 'barrel_blast'
    | 'ice_mortar'
    | 'sapper_bomb'
    | 'spore_pod'
    | 'tank_shell'
    | 'rock_impact'
    | 'arcane_rune'
    | 'arrow_rain'
    | 'icicle';
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
  mirrorBubbleTimer: number;
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
  /** Run clock used for the timer and Score; it pauses once the floor's boss is beaten. */
  runTime: number;
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
  sporeClouds: SporeCloudEffect[];
  delayedBlasts: DelayedBlastEffect[];
  lobs: LobEffect[];
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
  /** Mimics left in a cleared room go back to sleep as chests. */
  mimics?: Array<{ x: number; y: number }> | undefined;
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
  private fxRng: SeededRng;
  private lootRng: SeededRng;
  private attackSeq = 0;
  private lastHitProcSeq = -1;
  private weapon: WeaponDef;
  private baseModifier: DailyModifier;
  private dailyRule: DailyRule;
  private floorScaling: FloorScaling;
  private endCallback?: ((summary: RunSummary) => void) | undefined;
  private readonly stuckTimers = new Map<number, number>();

  constructor(
    utcDate: string,
    profile: PlayerProfile,
    onRunEnd?: (summary: RunSummary) => void,
  ) {
    this.profile = profile;
    this.endCallback = onRunEnd;
    this.relicRng = createDailyStream(utcDate, 'relics');
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

  public getLiveScore(): number {
    return this.getRunSummary().score;
  }

  public getRunSummary(): RunSummary {
    const s = this.state;
    const elapsedSec = Math.round(s.runTime * 10) / 10;
    const damageTaken = Math.round(s.stats.damageTaken);
    const score = computeRunScore({
      floorReached: s.floor,
      floorsCleared: s.floorsCleared,
      roomsCleared: s.roomsClearedTotal,
      coinsEarned: s.stats.coinsEarned,
      elapsedSec,
      damageTaken,
      enemiesKilled: s.stats.enemiesKilled,
    });

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
      elapsedSec,
      coinsEarned: s.stats.coinsEarned,
      gemsEarned: s.stats.gemsEarned,
      damageTaken,
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
    if (!this.isBossRoomCleared()) s.runTime += dt;
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
    this.updateLobs(dt);
    this.updateFirePatches(dt);
    this.updateSporeClouds(dt);
    this.updateEnemies(dt);
    for (const enemy of s.enemies) {
      if (enemy.leapZ <= 24) {
        this.pushOutOfObstacles(enemy, enemy.radius);
        // Monsters lunging/charging into a barrel set it off (only on the ground).
        if (enemy.state === 'attack' && BARREL_CONTACT_ATTACKS.has(enemy.attackKind)) {
          this.triggerBarrelsInRadius(enemy.x, enemy.y, enemy.radius);
        }
      }
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

  /** True once this floor's boss is dead (the run clock stops so Score stops dropping). */
  private isBossRoomCleared(): boolean {
    const s = this.state;
    return (
      s.currentRoomId === this.dungeonMap.bossRoomId &&
      (s.roomState === 'reward' || s.roomState === 'boss_choice')
    );
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
    const weapon = this.weapon;
    const initialRelics: ActiveRelicMap = {};
    if (dailyRule.grantStarterRelic && !ignoreRule) {
      initialRelics[getDailyStarterRelic(utcDate)] = 1;
    }
    const maxHp = BASE_HP + VITALITY_HP_PER_LEVEL * (initialRelics.vitality ?? 0);

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
      runTime: 0,
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
        mirrorBubbleTimer: 0,
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
      sporeClouds: [],
      delayedBlasts: [],
      lobs: [],
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
        if (leavingMem.cleared) {
          leavingMem.mimics = s.enemies.filter((e) => e.mimic).map((e) => ({ x: e.x, y: e.y }));
        }
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
    s.player.mirrorBubbleTimer = 0;
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
    s.sporeClouds = [];
    s.delayedBlasts = [];
    s.lobs = [];
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
      for (const m of mem.mimics ?? []) {
        s.enemies.push(this.makeDormantMimic(m.x, m.y, node.blueprint.hpScale));
      }

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
        active: h.type === 'spikes' ? isSpikeActive(h.phaseOffset) : false,
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
          // The boss room stays a mystery until you have been inside it.
          targetIsBoss:
            targetId === this.dungeonMap.bossRoomId && Boolean(this.roomMemory.get(targetId)?.visited),
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
        isBoss: node.id === this.dungeonMap.bossRoomId && Boolean(mem?.visited),
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
      if (spawn.mimic) {
        s.enemies.push(this.makeDormantMimic(spawn.x, spawn.y, this.currentBlueprint.hpScale));
        continue;
      }
      const bossSpec =
        spawn.archetype === 'boss'
          ? spawn.bossBase
            ? { bossBase: spawn.bossBase, bossVariant: spawn.bossVariant ?? (0 as const) }
            : getFloorBossSpec(s.floor, s.utcDate)
          : undefined;
      const enemy = createEnemy(
        this.nextEntityId++,
        spawn.archetype,
        spawn.x,
        spawn.y,
        this.currentBlueprint.hpScale,
        s.modifier.enemyHpMult,
        s.modifier.enemySpeedMult,
        s.modifier.enemyDamageMult,
        bossSpec?.bossBase,
        bossSpec?.bossVariant,
      );
      if (s.floor === 1 && spawn.archetype === 'boss') {
        enemy.damage = Math.max(10, Math.round(enemy.damage * 0.72));
      }
      s.enemies.push(enemy);
      this.spawnParticles(spawn.x, spawn.y, '#ef4444', 6, 90);
    }
  }

  /** A Mimic disguised as a treasure chest: it sits still until you walk up or hit it. */
  private makeDormantMimic(x: number, y: number, hpScale: number): EnemyEntity {
    const s = this.state;
    const mimic = createEnemy(
      this.nextEntityId++,
      'chaser',
      x,
      y,
      hpScale * 1.6,
      s.modifier.enemyHpMult,
      s.modifier.enemySpeedMult,
      s.modifier.enemyDamageMult,
    );
    mimic.mimic = true;
    mimic.dormant = true;
    mimic.state = 'chase';
    mimic.stateTimer = 0.4;
    mimic.spawnShieldTimer = 0;
    mimic.coinDrop = 3;
    return mimic;
  }

  private wakeMimic(enemy: EnemyEntity): void {
    const s = this.state;
    if (!enemy.dormant) return;
    enemy.dormant = false;
    enemy.state = 'spawning';
    enemy.stateTimer = 0.55;
    enemy.spawnShieldTimer = Math.max(enemy.spawnShieldTimer, 0.25);
    s.shakeIntensity = Math.max(s.shakeIntensity, 4);
    this.addFloatingText(enemy.x, enemy.y - 30, 'MIMIC!', '#f87171', 1.25);
    this.spawnParticles(enemy.x, enemy.y, '#fde047', 10, 150);
  }

  private openChest(br: BreakableEntity): void {
    const s = this.state;
    if (br.kind !== 'chest' || br.opened) return;
    br.opened = true;
    br.hitFlash = 0.12;
    const coins = Math.max(4, Math.round(4 * this.floorScaling.coinMult));
    this.spawnCoins(br.x, br.y - 6, coins, false);
    this.spawnParticles(br.x, br.y, '#fde047', 12, 155);
    this.addFloatingText(br.x, br.y - 28, `CHEST! +${coins}`, '#fde047', 1.1);
    if (this.lootRng.next() < HEART_CRATE_CHANCE) {
      s.hearts.push({ id: this.nextEntityId++, x: br.x, y: br.y + 26, age: 0 });
    }
    const mem = this.roomMemory.get(s.currentRoomId);
    if (mem) mem.breakables = s.breakables.map((b) => ({ ...b, hitFlash: 0 }));
  }

  private placeEmberPatch(x: number, y: number): void {
    const s = this.state;
    const emberLv = s.player.relics.ember_wake ?? 0;
    if (emberLv <= 0) return;
    const pt = this.clampPoint(x, y, 12);
    s.firePatches.push({
      x: pt.x,
      y: pt.y,
      radius: 34 + emberLv * 4,
      ttl: 2.2,
      dps: 14 + 7 * (emberLv - 1),
      tickTimer: 0.08,
    });
    if (s.firePatches.length > 10) s.firePatches.splice(0, s.firePatches.length - 10);
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
    p.mirrorBubbleTimer = Math.max(0, p.mirrorBubbleTimer - dt);

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

    const whetLv = p.relics.whetstone ?? 0;
    const goldenLv = p.relics.golden_cleave ?? 0;
    const goldenCoinMult =
      goldenLv > 0
        ? 1 + Math.min(0.4 * goldenLv, Math.floor(s.stats.coinsEarned / 10) * 0.02 * goldenLv)
        : 1;
    const hitDmg =
      w.damage *
      s.modifier.attackDamageMult *
      (1 + WHETSTONE_DAMAGE_PER_LEVEL * whetLv) *
      goldenCoinMult *
      p.damageBonusMult *
      s.modifier.playerDamageMult;

    const range = w.range;
    const cleaveArc = (Math.max(1, w.arcDeg) * Math.PI) / 180;
    const swingSign: 1 | -1 = p.swingCount % 2 === 1 ? 1 : -1;
    const slashColor = (p.relics.rift_cleave ?? 0) > 0 ? '#fbbf24' : w.slashColor;

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
      let firstHit: { x: number; y: number } | null = null;
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
        if (!firstHit) firstHit = { x: enemy.x, y: enemy.y };
        const dirX = dist > 0 ? dx / dist : Math.cos(angle);
        const dirY = dist > 0 ? dy / dist : Math.sin(angle);
        const killed = this.weaponHitEnemy(enemy, hitDmg, dirX, dirY, w.stripsArmor, chain);
        if (killed) killCount += 1;
      }
      slashEffect.hitCount = hitCount;
      if (firstHit) this.placeEmberPatch(firstHit.x, firstHit.y);

      for (const br of [...s.breakables]) {
        if (br.kind === 'chest') continue;
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

    // On-attack relics fire regardless of weapon style (Ember Wake lands where hits land).
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
      const bubbleRadius = Math.max(range, 84) + 22;
      p.mirrorBubbleTimer = 0.28;
      s.rings.push({
        x: p.x,
        y: p.y,
        radius: p.radius + 8,
        maxRadius: bubbleRadius,
        ttl: 0.22,
        maxTtl: 0.22,
        color: '#38bdf8',
      });
      const dmgMult = 2.5 + 0.25 * (mirrorLv - 1);
      let reflected = 0;
      for (const proj of s.projectiles) {
        if (proj.friendly) continue;
        const d = Math.hypot(proj.x - p.x, proj.y - p.y);
        if (d <= bubbleRadius) {
          reflected += 1;
          proj.friendly = true;
          const speed = Math.hypot(proj.vx, proj.vy) * 2.2;
          proj.vx = Math.cos(angle) * speed;
          proj.vy = Math.sin(angle) * speed;
          proj.angle = angle;
          proj.damage = Math.round(proj.damage * dmgMult);
          proj.ttl = 1.6;
          this.spawnParticles(proj.x, proj.y, '#38bdf8', 5, 110);
        }
      }
      if (reflected > 0) {
        this.addFloatingText(p.x, p.y - 28, 'REFLECT!', '#7dd3fc', 1.05);
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
    const arcLv = p.relics.arc_conduit ?? 0;
    if (arcLv > 0 && !chain.arcUsed) {
      chain.arcUsed = true;
      this.triggerArcConduit(enemy, arcLv);
    }
    const goldenLv = p.relics.golden_cleave ?? 0;
    if (goldenLv > 0 && (killed || enemy.goldenBurstCount < 2)) {
      if (!killed) {
        enemy.goldenBurstCount += 1;
      }
      this.spawnCoins(enemy.x, enemy.y, 2 * goldenLv, true);
      const gildDmg = Math.round(
        (16 + 8 * (goldenLv - 1)) * p.damageBonusMult * s.modifier.playerDamageMult,
      );
      this.spawnParticles(enemy.x, enemy.y, '#f7df86', 7, 165);
      for (const other of [...s.enemies]) {
        if (other.id === enemy.id || other.spawnShieldTimer > 0 || other.leapZ > 24) continue;
        const gdx = other.x - enemy.x;
        const gdy = other.y - enemy.y;
        const gDist = Math.hypot(gdx, gdy);
        if (gDist <= 68 + other.radius) {
          const gnx = gDist > 0 ? gdx / gDist : 0;
          const gny = gDist > 0 ? gdy / gDist : 0;
          this.damageEnemy(other, gildDmg, gnx * 180, gny * 180, false, '#f7df86');
        }
      }
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
        const prevTimer = haz.timer;
        haz.timer = (haz.timer + dt) % SPIKE_CYCLE_SEC;
        haz.active = isSpikeActive(haz.timer);
        if (haz.active) {
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
              if (!isSpikeActive(prevTimer) || Math.floor(prevTimer * 4) !== Math.floor(haz.timer * 4)) {
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

  /**
   * Set off every intact explosive barrel overlapping a circle. Used for monster
   * attacks (bullets, lunges/charges, bombs, shockwaves) and for chain reactions.
   * Returns true if at least one barrel went off.
   */
  private triggerBarrelsInRadius(x: number, y: number, radius: number): boolean {
    let hit = false;
    for (const haz of this.state.hazards) {
      if (haz.type !== 'barrels' || haz.destroyed) continue;
      const barrelRadius = Math.round(haz.w * 0.42);
      if (Math.hypot(haz.x - x, haz.y - y) <= radius + barrelRadius) {
        this.triggerBarrelExplosion(haz);
        hit = true;
      }
    }
    return hit;
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
        ? '#f0853a'
        : blast.kind === 'ice_mortar' || blast.kind === 'icicle'
          ? '#9edbf7'
          : blast.kind === 'spore_pod'
            ? '#4eab5b'
            : blast.kind === 'arcane_rune'
              ? '#a770d6'
              : blast.kind === 'rock_impact' || blast.kind === 'arrow_rain'
                ? '#d49562'
                : '#e04f44';
      this.spawnParticles(blast.x, blast.y, color, 10, 175);
      if (blast.kind === 'barrel_blast') {
        this.spawnBreakDebris(blast.x, blast.y, 'barrel', false);
      }
      if (blast.kind === 'spore_pod') {
        s.sporeClouds.push({
          id: this.nextEntityId++,
          x: blast.x,
          y: blast.y,
          radius: blast.radius,
          ttl: 2.2,
          maxTtl: 2.2,
          damage: Math.max(1, Math.round(blast.damage * 0.85)),
        });
      }
      s.shakeIntensity = Math.max(s.shakeIntensity, 5);
      // Explosions set off nearby barrels, so barrels can chain-react.
      this.triggerBarrelsInRadius(blast.x, blast.y, blast.radius * 0.75);

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
              kind: 'ice',
              angle: ang,
            });
          }
        }
        if (blast.kind === 'rock_impact') {
          const shardDmg = Math.max(1, Math.round(blast.damage * 0.6));
          for (let i = 0; i < 6; i += 1) {
            const ang = (i * Math.PI * 2) / 6 + 0.26;
            s.projectiles.push({
              id: this.nextEntityId++,
              friendly: false,
              x: blast.x + Math.cos(ang) * 22,
              y: blast.y + Math.sin(ang) * 22,
              vx: Math.cos(ang) * 230,
              vy: Math.sin(ang) * 230,
              radius: 7,
              damage: shardDmg,
              ttl: 0.9,
              pierce: false,
              hitEnemyIds: [],
              kind: 'rock',
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

  private updateSporeClouds(dt: number): void {
    const s = this.state;
    const p = s.player;
    const next: SporeCloudEffect[] = [];

    for (const cloud of s.sporeClouds) {
      cloud.ttl -= dt;
      if (cloud.ttl <= 0) continue;
      if (
        s.phase === 'playing' &&
        Math.hypot(p.x - cloud.x, p.y - cloud.y) <= cloud.radius + p.radius * 0.55
      ) {
        this.damagePlayer(cloud.damage);
      }
      next.push(cloud);
    }

    s.sporeClouds = next;
  }

  private updateEnemies(dt: number): void {
    const s = this.state;
    const p = s.player;
    const flowField = this.computePlayerFlowField();

    for (const enemy of [...s.enemies]) {
      enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
      enemy.spawnShieldTimer = Math.max(0, enemy.spawnShieldTimer - dt);
      enemy.dashTagTimer = Math.max(0, enemy.dashTagTimer - dt);

      if (enemy.dormant) {
        // Disguised Mimic: a perfectly still chest until the player walks right up.
        enemy.vx = 0;
        enemy.vy = 0;
        if (Math.hypot(p.x - enemy.x, p.y - enemy.y) <= p.radius + enemy.radius + 40) {
          this.wakeMimic(enemy);
        }
        continue;
      }

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
      const beforeX = enemy.x;
      const beforeY = enemy.y;
      const wasChasing = enemy.state === 'chase';

      switch (enemy.archetype) {
        case 'chaser':
          this.stepChaserAI(enemy, dist, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
          break;
        case 'shooter':
          this.stepShooterAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasShotLOS, dt);
          break;
        case 'charger':
        case 'elite_charger':
          this.stepChargerAI(enemy, dist, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
          break;
        case 'shade':
          this.stepShadeAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasShotLOS, dt);
          break;
        case 'yeti':
          this.stepYetiAI(enemy, dist, nav.dirX, nav.dirY, dt);
          break;
        case 'bomber':
          this.stepBomberAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
          break;
        case 'mortar_tank':
          this.stepMortarTankAI(enemy, dist, nav.dirX, nav.dirY, nav.hasShotLOS, dt);
          break;
        case 'stampede':
          this.stepStampedeAI(enemy, dist, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
          break;
        case 'myconid':
          this.stepMyconidAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasMoveLOS, dt);
          break;
        case 'imp':
          this.stepImpAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasShotLOS, dt);
          break;
        case 'archer':
          this.stepArcherAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasShotLOS, dt);
          break;
        case 'boss':
          this.stepBossAI(enemy, dist, dirX, dirY, nav.dirX, nav.dirY, nav.hasMoveLOS, nav.hasShotLOS, dt);
          break;
      }

      if (enemy.leapZ <= 24) {
        this.pushOutOfObstacles(enemy, enemy.radius);
      }
      this.clampToArena(enemy);

      // Notice when a monster is pressing into a wall so it switches to path-finding.
      if (wasChasing && enemy.state === 'chase' && dt > 0) {
        const moved = Math.hypot(enemy.x - beforeX, enemy.y - beforeY);
        const prev = this.stuckTimers.get(enemy.id) ?? 0;
        const stuck = moved < enemy.speed * dt * 0.3 && dist > enemy.radius + p.radius + 24;
        this.stuckTimers.set(enemy.id, stuck ? Math.min(2, prev + dt) : Math.max(0, prev - dt * 0.5));
      }
    }

    for (let i = 0; i < s.enemies.length; i += 1) {
      const a = s.enemies[i];
      if (!a || a.leapZ > 24 || a.dormant) continue;
      for (let j = i + 1; j < s.enemies.length; j += 1) {
        const b = s.enemies[j];
        if (!b || b.leapZ > 24 || b.dormant) continue;
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

    if (s.roomState === 'combat' && s.enemies.every((e) => e.dormant)) {
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

  // ---------------------------------------------------------------------------
  // Monster AI. Every monster has 1 attack on Floor 1 and 2 attacks from Floor 2
  // (elites always have 2). The giant boss version of each monster gets a 3rd,
  // signature attack. Attacks cycle in order so they are easy to learn.
  // ---------------------------------------------------------------------------

  /** How many attacks of its kit this monster may use right now. */
  private kitSize(enemy: EnemyEntity): number {
    if (enemy.archetype === 'boss') return 3;
    if (enemy.archetype === 'elite_charger') return 2;
    return this.state.floor >= 2 ? 2 : 1;
  }

  /** The next attack in this monster's cycle (does not advance the cycle). */
  private peekAttack(enemy: EnemyEntity, kit: readonly EnemyAttackKind[]): EnemyAttackKind {
    const n = Math.max(1, Math.min(kit.length, this.kitSize(enemy)));
    return kit[enemy.bossPatternIndex % n]!;
  }

  private beginTelegraph(enemy: EnemyEntity, kind: EnemyAttackKind, duration: number): void {
    enemy.bossPatternIndex += 1;
    enemy.state = 'telegraph';
    enemy.attackKind = kind;
    enemy.telegraphDuration = duration;
    enemy.stateTimer = duration;
    enemy.telegraphLocked = false;
    enemy.attackFired = false;
  }

  private endAttack(enemy: EnemyEntity, recover: number): void {
    enemy.state = 'recover';
    enemy.stateTimer = recover;
    enemy.attackKind = 'none';
    enemy.leapZ = 0;
  }

  private stepRecover(enemy: EnemyEntity, dt: number, nextChaseDelay: number): void {
    enemy.leapZ = 0;
    enemy.stateTimer -= dt;
    if (enemy.stateTimer <= 0) {
      enemy.state = 'chase';
      enemy.stateTimer = nextChaseDelay;
    }
  }

  private clampPoint(x: number, y: number, pad = 36): { x: number; y: number } {
    const pt = {
      x: Math.max(PLAY_MIN_X + pad, Math.min(PLAY_MAX_X - pad, x)),
      y: Math.max(PLAY_MIN_Y + pad, Math.min(PLAY_MAX_Y - pad, y)),
    };
    return pt;
  }

  /** Track the player during a wind-up, with a little lead, then lock in. */
  private aimAtPlayer(enemy: EnemyEntity, lead = 0.14, maxLead = 32): void {
    const s = this.state;
    const rawLeadX = s.player.vx * lead;
    const rawLeadY = s.player.vy * lead;
    const mag = Math.hypot(rawLeadX, rawLeadY);
    const k = mag > maxLead ? maxLead / mag : 1;
    enemy.aimAngle = Math.atan2(s.player.y + rawLeadY * k - enemy.y, s.player.x + rawLeadX * k - enemy.x);
  }

  private fireEnemyProjectile(
    enemy: EnemyEntity,
    angle: number,
    speed: number,
    kind: ProjectileKind,
    radius: number,
    ttl = 2.4,
    opts: { homing?: number; homingTime?: number; pierce?: boolean; damageMult?: number } = {},
  ): void {
    this.state.projectiles.push({
      id: this.nextEntityId++,
      friendly: false,
      x: enemy.x + Math.cos(angle) * (enemy.radius + 6),
      y: enemy.y + Math.sin(angle) * (enemy.radius + 6),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      damage: Math.max(1, Math.round(enemy.damage * (opts.damageMult ?? 1))),
      ttl,
      pierce: Boolean(opts.pierce),
      hitEnemyIds: [],
      kind,
      angle,
      ...(opts.homing ? { homing: opts.homing, homingTime: opts.homingTime ?? 1 } : {}),
    });
  }

  /** A ring of projectiles with a gap the player can slip through. */
  private fireProjectileRing(
    enemy: EnemyEntity,
    count: number,
    gapSize: number,
    speed: number,
    kind: ProjectileKind,
    radius: number,
  ): void {
    const gapStart = this.fxRng.int(0, count - 1);
    const offset = this.fxRng.range(0, Math.PI * 2);
    for (let i = 0; i < count; i += 1) {
      const rel = (i - gapStart + count) % count;
      if (rel < gapSize) continue;
      this.fireEnemyProjectile(enemy, offset + (i * Math.PI * 2) / count, speed, kind, radius, 2.4);
    }
  }

  /** Throw something in a visible arc (bomb, shell, spore pod, snowball, boulder). */
  private launchLob(
    enemy: EnemyEntity,
    kind: LobKind,
    tx: number,
    ty: number,
    opts: { duration: number; peak: number; radius: number; fuse?: number; damageMult?: number },
  ): void {
    const target = this.clampPoint(tx, ty, 32);
    this.state.lobs.push({
      id: this.nextEntityId++,
      kind,
      sx: enemy.x,
      sy: enemy.y - enemy.radius * 0.6,
      tx: target.x,
      ty: target.y,
      timer: 0,
      duration: opts.duration,
      peak: opts.peak,
      radius: opts.radius,
      fuse: opts.fuse ?? 0,
      damage: Math.max(1, Math.round(enemy.damage * (opts.damageMult ?? 1))),
    });
  }

  private spawnAdds(boss: EnemyEntity, kind: BossBaseArchetype, count: number, hpScale: number): void {
    const s = this.state;
    const alive = s.enemies.filter((e) => e.isAdd).length;
    const toSpawn = Math.max(0, Math.min(count, 4 - alive));
    for (let i = 0; i < toSpawn; i += 1) {
      const ang = this.fxRng.range(0, Math.PI * 2);
      const pt = this.clampPoint(boss.x + Math.cos(ang) * 80, boss.y + Math.sin(ang) * 80, 48);
      this.pushOutOfObstacles(pt, 18);
      const add = createEnemy(
        this.nextEntityId++,
        kind,
        pt.x,
        pt.y,
        hpScale,
        s.modifier.enemyHpMult,
        s.modifier.enemySpeedMult,
        s.modifier.enemyDamageMult,
      );
      add.isAdd = true;
      add.coinDrop = 0;
      s.enemies.push(add);
      this.spawnParticles(pt.x, pt.y, '#e04f44', 6, 90);
    }
  }

  private contactHit(enemy: EnemyEntity, pad: number): void {
    const s = this.state;
    if (enemy.attackFired) return;
    if (Math.hypot(s.player.x - enemy.x, s.player.y - enemy.y) <= s.player.radius + enemy.radius + pad) {
      enemy.attackFired = true;
      this.damagePlayer(enemy.damage);
    }
  }

  /** Expanding shockwave ring that hurts the player once as it sweeps past. */
  private pushShockwave(x: number, y: number, maxRadius: number, ttl: number, enemy: EnemyEntity, color = '#e04f44'): void {
    this.state.rings.push({
      x,
      y,
      radius: 24,
      maxRadius,
      ttl,
      maxTtl: ttl,
      color,
      harmfulToPlayer: true,
      damage: enemy.damage / Math.max(0.01, this.state.modifier.enemyDamageMult),
    });
  }

  /** Slime: lunge / hop slam / (boss) split into minis. Mimic: chomp / chomp chain / (boss) coin spit. */
  private stepChaserAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    const isMimic = Boolean(enemy.mimic) || (isBoss && enemy.bossVariant === 1);
    if (enemy.state === 'attack' && enemy.attackKind === 'boss_leap') {
      this.stepLeapAttack(enemy, isBoss ? 86 : 48, isBoss, dt);
      return;
    }

    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (enemy.stateTimer > 0) return;
      const kit: EnemyAttackKind[] = isMimic
        ? ['lunge', 'chomp_chain', 'coin_spit']
        : ['lunge', 'boss_leap', 'slime_split'];
      const next = this.peekAttack(enemy, kit);
      if (next === 'lunge' || next === 'chomp_chain') {
        if (dist <= (isBoss ? 112 : 74) && hasMoveLOS) {
          this.beginTelegraph(enemy, next, isBoss ? 0.44 : 0.48);
          enemy.burstLeft = next === 'chomp_chain' ? (isBoss ? 3 : 2) : 0;
          enemy.targetX = s.player.x;
          enemy.targetY = s.player.y;
        }
      } else if (next === 'boss_leap') {
        if (dist <= (isBoss ? 300 : 210) && hasMoveLOS) {
          enemy.bossPatternIndex += 1;
          this.beginLeapTelegraph(enemy, isBoss ? 0.64 : 0.52);
        }
      } else if (dist <= 380) {
        this.beginTelegraph(enemy, next, 0.6);
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.attackKind === 'boss_leap') {
        this.updateLeapTelegraph(enemy);
        if (enemy.stateTimer <= 0) {
          this.launchLeapAttack(enemy, isBoss ? BOSS_LEAP_DURATION : 0.46, isBoss);
        }
        return;
      }
      if (enemy.attackKind === 'lunge' || enemy.attackKind === 'chomp_chain') {
        if (enemy.stateTimer > 0.12) this.aimAtPlayer(enemy, 0.05, 12);
      }
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'slime_split') {
        this.spawnAdds(enemy, 'chaser', 2, 0.35 * this.currentBlueprint.hpScale);
        s.rings.push({ x: enemy.x, y: enemy.y, radius: 20, maxRadius: 90, ttl: 0.35, maxTtl: 0.35, color: '#4eab5b' });
        this.endAttack(enemy, 0.7);
      } else if (enemy.attackKind === 'coin_spit') {
        this.aimAtPlayer(enemy, 0, 0);
        for (const off of [-0.5, -0.25, 0, 0.25, 0.5]) {
          this.fireEnemyProjectile(enemy, enemy.aimAngle + off, 300, 'coin', 8, 1.8);
        }
        this.endAttack(enemy, 0.8);
      } else {
        enemy.state = 'attack';
        enemy.stateTimer = isBoss ? 0.28 : 0.2;
        enemy.attackFired = false;
      }
    } else if (enemy.state === 'attack') {
      const spd = (isBoss ? 540 : 440) * s.modifier.enemySpeedMult;
      this.moveWithSlide(enemy, Math.cos(enemy.aimAngle) * spd * dt, Math.sin(enemy.aimAngle) * spd * dt);
      this.contactHit(enemy, 14);
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        if (enemy.attackKind === 'chomp_chain' && enemy.burstLeft > 0) {
          enemy.burstLeft -= 1;
          enemy.state = 'telegraph';
          enemy.stateTimer = 0.22;
          enemy.telegraphDuration = 0.22;
          enemy.attackFired = false;
          return;
        }
        this.endAttack(enemy, isBoss ? 0.36 : 0.42);
      }
    } else if (enemy.state === 'recover') {
      this.stepRecover(enemy, dt, isBoss ? 0.45 : 0.55);
    }
  }

  /**
   * Mage: slow homing arcane bolt / rune trap under you / (boss) blink + nova.
   * Casters stand still while casting and the Arch-Mage is left exhausted after
   * its nova, so melee builds always get an opening.
   */
  private stepShooterAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasShotLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    if (enemy.bouncesLeft === 0) {
      enemy.bouncesLeft = enemy.id % 2 === 0 ? 1 : -1;
    }
    const strafeDir = enemy.bouncesLeft >= 0 ? 1 : -1;
    const far = isBoss ? 270 : 300;
    const near = isBoss ? 140 : 150;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      const prevX = enemy.x;
      const prevY = enemy.y;
      if (!hasShotLOS || dist > far) {
        this.moveWithSlide(enemy, navDirX * enemy.speed * 0.85 * dt, navDirY * enemy.speed * 0.85 * dt);
      } else if (dist < near) {
        // Back off slowly: a melee player can always catch a caster.
        this.moveWithSlide(enemy, -dirX * enemy.speed * 0.5 * dt, -dirY * enemy.speed * 0.5 * dt);
      } else {
        this.moveWithSlide(
          enemy,
          -dirY * strafeDir * enemy.speed * 0.5 * dt,
          dirX * strafeDir * enemy.speed * 0.5 * dt,
        );
      }
      if (dt > 0 && enemy.speed > 0 && Math.hypot(enemy.x - prevX, enemy.y - prevY) < enemy.speed * dt * 0.1) {
        enemy.bouncesLeft = -strafeDir;
      }
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 440 && hasShotLOS) {
        const next = this.peekAttack(enemy, ['arcane_bolt', 'arcane_rune', 'blink_nova']);
        this.beginTelegraph(enemy, next, next === 'arcane_bolt' ? 0.6 : next === 'arcane_rune' ? 0.5 : 0.45);
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0.16) this.aimAtPlayer(enemy, 0.12, 30);
      else enemy.telegraphLocked = true;
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'arcane_bolt') {
        const offsets = isBoss ? [-0.45, 0, 0.45] : [0];
        for (const off of offsets) {
          this.fireEnemyProjectile(enemy, enemy.aimAngle + off, isBoss ? 215 : 235, 'arcane', isBoss ? 9 : 8, 3, {
            homing: isBoss ? 1.2 : 1.5,
            homingTime: isBoss ? 1.3 : 1.1,
          });
        }
        this.endAttack(enemy, isBoss ? 0.7 : 0.85);
      } else if (enemy.attackKind === 'arcane_rune') {
        const spots: Array<{ x: number; y: number }> = [{ x: s.player.x, y: s.player.y }];
        if (isBoss) {
          const perp = enemy.aimAngle + Math.PI / 2;
          spots.push(
            { x: s.player.x + Math.cos(perp) * 88, y: s.player.y + Math.sin(perp) * 88 },
            { x: s.player.x - Math.cos(perp) * 88, y: s.player.y - Math.sin(perp) * 88 },
          );
        }
        for (const spot of spots) {
          const pt = this.clampPoint(spot.x, spot.y, 30);
          s.delayedBlasts.push({
            kind: 'arcane_rune',
            x: pt.x,
            y: pt.y,
            radius: isBoss ? 56 : 50,
            timer: 1.0,
            maxTimer: 1.0,
            damage: enemy.damage,
            friendly: false,
            alreadyScaled: true,
          });
        }
        this.endAttack(enemy, isBoss ? 0.7 : 0.9);
      } else {
        // Blink to a new spot, then charge a nova (standing still).
        const ang = this.fxRng.range(0, Math.PI * 2);
        let dest = this.clampPoint(s.player.x + Math.cos(ang) * 200, s.player.y + Math.sin(ang) * 200, 60);
        if (this.pointInObstacle(dest.x, dest.y, enemy.radius)) {
          dest = this.clampPoint(s.player.x - Math.cos(ang) * 200, s.player.y - Math.sin(ang) * 200, 60);
        }
        this.spawnParticles(enemy.x, enemy.y, '#a770d6', 10, 140);
        enemy.x = dest.x;
        enemy.y = dest.y;
        this.pushOutOfObstacles(enemy, enemy.radius);
        this.spawnParticles(enemy.x, enemy.y, '#a770d6', 10, 140);
        enemy.state = 'attack';
        enemy.stateTimer = 0.5;
        enemy.attackFired = false;
      }
    } else if (enemy.state === 'attack') {
      // Nova wind-up after the blink.
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        this.fireProjectileRing(enemy, 12, 3, 175, 'arcane', 8);
        s.rings.push({ x: enemy.x, y: enemy.y, radius: 20, maxRadius: 110, ttl: 0.3, maxTtl: 0.3, color: '#a770d6' });
        // Exhausted: a long, still recovery window for melee.
        this.endAttack(enemy, 1.5);
      }
    } else if (enemy.state === 'recover') {
      this.stepRecover(enemy, dt, isBoss ? 0.55 : 0.7);
    }
  }

  /** Brute/Warden: charge / ground slam (warden: shield sweep) / (boss) leap + boulder toss. */
  private stepChargerAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    const isWarden = enemy.archetype === 'elite_charger' || (isBoss && enemy.bossBase === 'elite_charger');

    if (enemy.archetype === 'elite_charger' && !enemy.didPhaseAddSpawn && enemy.hp <= enemy.maxHp * 0.6) {
      enemy.didPhaseAddSpawn = true;
      this.announce('Warden calls reinforcements!');
      this.spawnAdds(enemy, 'chaser', 2, this.currentBlueprint.hpScale);
    }

    if (enemy.state === 'attack' && enemy.attackKind === 'boss_leap') {
      this.stepLeapAttack(enemy, isBoss ? 88 : 56, true, dt);
      return;
    }

    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (enemy.stateTimer > 0) return;
      const kit: EnemyAttackKind[] = isWarden
        ? ['charge', 'warden_sweep', 'boss_leap']
        : isBoss
          ? ['charge', 'boss_leap', 'boulder_toss']
          : ['charge', 'quake_slam'];
      const next = this.peekAttack(enemy, kit);
      if (next === 'charge') {
        if (dist <= 320 && hasMoveLOS) {
          this.beginTelegraph(enemy, 'charge', isBoss ? 0.56 : 0.62);
        }
      } else if (next === 'quake_slam' || next === 'warden_sweep') {
        if (dist <= (next === 'warden_sweep' ? 140 : 110)) {
          this.beginTelegraph(enemy, next, 0.52);
        }
      } else if (next === 'boss_leap') {
        if (dist <= 320) {
          enemy.bossPatternIndex += 1;
          this.beginLeapTelegraph(enemy, 0.68);
        }
      } else if (dist <= 460) {
        this.beginTelegraph(enemy, 'boulder_toss', 0.6);
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.attackKind === 'boss_leap') {
        this.updateLeapTelegraph(enemy);
        if (enemy.stateTimer <= 0) this.launchLeapAttack(enemy, BOSS_LEAP_DURATION, true);
        return;
      }
      if (enemy.attackKind === 'charge' && enemy.stateTimer > 0.16) this.aimAtPlayer(enemy, 0, 0);
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'quake_slam') {
        const slamRadius = 66;
        this.spawnParticles(enemy.x, enemy.y, '#f0853a', 12, 175);
        this.triggerBarrelsInRadius(enemy.x, enemy.y, slamRadius);
        s.rings.push({ x: enemy.x, y: enemy.y, radius: 20, maxRadius: slamRadius + 10, ttl: 0.25, maxTtl: 0.25, color: '#d49562' });
        s.shakeIntensity = Math.max(s.shakeIntensity, 4);
        if (Math.hypot(s.player.x - enemy.x, s.player.y - enemy.y) <= slamRadius + s.player.radius * 0.5) {
          this.damagePlayer(enemy.damage);
        }
        this.endAttack(enemy, 0.75);
      } else if (enemy.attackKind === 'warden_sweep') {
        this.pushShockwave(enemy.x, enemy.y, isBoss ? 160 : 120, isBoss ? 0.5 : 0.4, enemy, '#f7df86');
        s.shakeIntensity = Math.max(s.shakeIntensity, 4);
        this.endAttack(enemy, 0.75);
      } else if (enemy.attackKind === 'boulder_toss') {
        this.launchLob(enemy, 'rock', s.player.x, s.player.y, { duration: 0.8, peak: 130, radius: 62 });
        this.endAttack(enemy, 0.85);
      } else {
        enemy.state = 'attack';
        enemy.stateTimer = isBoss ? 0.54 : 0.46;
        enemy.attackFired = false;
      }
    } else if (enemy.state === 'attack') {
      const chargeSpeed = (isBoss ? 640 : 560) * s.modifier.enemySpeedMult;
      enemy.x += Math.cos(enemy.aimAngle) * chargeSpeed * dt;
      enemy.y += Math.sin(enemy.aimAngle) * chargeSpeed * dt;
      this.contactHit(enemy, 8);
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
        enemy.state = isBoss ? 'recover' : 'staggered';
        enemy.stateTimer = 0.8;
        enemy.attackKind = 'none';
      } else if (enemy.stateTimer <= 0) {
        this.endAttack(enemy, 0.65);
      }
    } else if (enemy.state === 'recover') {
      this.stepRecover(enemy, dt, isBoss ? 0.55 : 0.65);
    }
  }

  /** Shade: vanish and strike from behind / slow shadow fan / (boss) shadow ring. */
  private stepShadeAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasShotLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    const orbitDir = enemy.id % 2 === 0 ? 1 : -1;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      if (!hasShotLOS || dist > 220) {
        this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      } else if (dist < 120) {
        this.moveWithSlide(enemy, -dirX * enemy.speed * 0.7 * dt, -dirY * enemy.speed * 0.7 * dt);
      } else {
        this.moveWithSlide(enemy, -dirY * orbitDir * enemy.speed * 0.7 * dt, dirX * orbitDir * enemy.speed * 0.7 * dt);
      }
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 380) {
        const next = this.peekAttack(enemy, ['phase_strike', 'shade_fan', 'shade_ring']);
        if (next !== 'phase_strike' && !hasShotLOS) return;
        this.beginTelegraph(enemy, next, next === 'phase_strike' ? 0.5 : 0.55);
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.attackKind !== 'phase_strike' && enemy.stateTimer > 0.14) this.aimAtPlayer(enemy, 0, 0);
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'phase_strike') {
        // Reappear behind the player (opposite to where they are facing).
        const fx = s.player.facingX || 0;
        const fy = s.player.facingY || -1;
        const flen = Math.max(0.001, Math.hypot(fx, fy));
        let dest = this.clampPoint(s.player.x - (fx / flen) * 72, s.player.y - (fy / flen) * 72, 40);
        if (this.pointInObstacle(dest.x, dest.y, enemy.radius)) {
          dest = this.clampPoint(s.player.x + (fx / flen) * 72, s.player.y + (fy / flen) * 72, 40);
        }
        this.spawnParticles(enemy.x, enemy.y, '#a770d6', 8, 110);
        enemy.x = dest.x;
        enemy.y = dest.y;
        this.pushOutOfObstacles(enemy, enemy.radius);
        enemy.aimAngle = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
        enemy.state = 'attack';
        enemy.stateTimer = isBoss ? 0.3 : 0.36;
        enemy.attackFired = false;
        return;
      }
      if (enemy.attackKind === 'shade_fan') {
        const offsets = isBoss ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.3, 0, 0.3];
        for (const off of offsets) {
          this.fireEnemyProjectile(enemy, enemy.aimAngle + off, isBoss ? 230 : 210, 'shadow', isBoss ? 8 : 7, 2);
        }
      } else {
        this.fireProjectileRing(enemy, 14, 3, 200, 'shadow', 8);
      }
      this.spawnParticles(enemy.x, enemy.y, '#a770d6', 6, 110);
      this.endAttack(enemy, isBoss ? 0.75 : 0.9);
    } else if (enemy.state === 'attack') {
      // Visible wind-up after reappearing, then a short slash.
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        if (Math.hypot(s.player.x - enemy.x, s.player.y - enemy.y) <= s.player.radius + enemy.radius + 36) {
          this.damagePlayer(enemy.damage);
        }
        this.spawnParticles(enemy.x + Math.cos(enemy.aimAngle) * 24, enemy.y + Math.sin(enemy.aimAngle) * 24, '#d8b4fe', 8, 150);
        if (isBoss) this.fireProjectileRing(enemy, 8, 2, 190, 'shadow', 7);
        this.endAttack(enemy, isBoss ? 0.7 : 0.85);
      }
    } else if (enemy.state === 'recover') {
      this.moveWithSlide(enemy, -dirY * orbitDir * enemy.speed * 0.4 * dt, dirX * orbitDir * enemy.speed * 0.4 * dt);
      this.stepRecover(enemy, dt, isBoss ? 0.6 : 0.8);
    }
  }

  /** Yeti: thrown snowball that shatters / frost rush / (boss) icicle rain. */
  private stepYetiAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (enemy.stateTimer > 0) return;
      const next = this.peekAttack(enemy, ['ice_mortar', 'frost_rush', 'icicle_rain']);
      if (next === 'frost_rush' ? dist <= (isBoss ? 300 : 210) : dist <= 420) {
        this.beginTelegraph(enemy, next, next === 'frost_rush' ? 0.54 : 0.6);
        enemy.targetX = s.player.x;
        enemy.targetY = s.player.y;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0.14) this.aimAtPlayer(enemy, 0, 0);
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'frost_rush') {
        enemy.state = 'attack';
        enemy.stateTimer = isBoss ? 0.42 : 0.34;
        enemy.attackFired = false;
      } else if (enemy.attackKind === 'ice_mortar') {
        const spots = isBoss ? [[0, 0], [-70, -40], [70, 40]] : [[0, 0]];
        for (const [ox, oy] of spots) {
          this.launchLob(enemy, 'snowball', s.player.x + ox!, s.player.y + oy!, {
            duration: 0.7,
            peak: 110,
            radius: isBoss ? 66 : 56,
          });
        }
        this.endAttack(enemy, isBoss ? 0.8 : 1.0);
      } else {
        for (let i = 0; i < 5; i += 1) {
          const ang = this.fxRng.range(0, Math.PI * 2);
          const r = i === 0 ? 0 : this.fxRng.range(50, 120);
          const pt = this.clampPoint(s.player.x + Math.cos(ang) * r, s.player.y + Math.sin(ang) * r, 30);
          const t = 0.75 + i * 0.14;
          s.delayedBlasts.push({
            kind: 'icicle',
            x: pt.x,
            y: pt.y,
            radius: 40,
            timer: t,
            maxTimer: t,
            damage: enemy.damage,
            friendly: false,
            alreadyScaled: true,
          });
        }
        this.endAttack(enemy, 0.9);
      }
    } else if (enemy.state === 'attack') {
      const rushSpeed = (isBoss ? 470 : 390) * s.modifier.enemySpeedMult;
      this.moveWithSlide(enemy, Math.cos(enemy.aimAngle) * rushSpeed * dt, Math.sin(enemy.aimAngle) * rushSpeed * dt);
      this.contactHit(enemy, 10);
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) this.endAttack(enemy, 0.8);
    } else if (enemy.state === 'recover') {
      this.stepRecover(enemy, dt, isBoss ? 0.7 : 0.9);
    }
  }

  /** Sapper: thrown bomb / plant a bomb and run / (boss) bomb ring + bomb carpet. */
  private stepBomberAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      // Always keeps closing in, so standing still is never safe.
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer > 0) return;
      const kit: EnemyAttackKind[] = isBoss ? ['throw_bomb', 'bomb_ring', 'bomb_line'] : ['throw_bomb', 'drop_bomb'];
      const next = this.peekAttack(enemy, kit);
      if (next === 'drop_bomb' ? dist <= 70 && hasMoveLOS : next === 'bomb_ring' ? dist <= 200 : dist <= 250) {
        this.beginTelegraph(enemy, next, next === 'drop_bomb' ? 0.3 : 0.45);
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0.12) this.aimAtPlayer(enemy, 0.1, 24);
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'throw_bomb') {
        const spots = isBoss ? [[0, 0], [-60, 36], [60, 36]] : [[0, 0]];
        for (const [ox, oy] of spots) {
          this.launchLob(enemy, 'bomb', s.player.x + ox!, s.player.y + oy!, {
            duration: 0.62,
            peak: 95,
            radius: isBoss ? 72 : 64,
            fuse: 0.5,
          });
        }
      } else if (enemy.attackKind === 'drop_bomb') {
        s.delayedBlasts.push({
          kind: 'sapper_bomb',
          x: enemy.x,
          y: enemy.y,
          radius: 78,
          timer: 0.9,
          maxTimer: 0.9,
          damage: enemy.damage,
          friendly: false,
          alreadyScaled: true,
        });
      } else if (enemy.attackKind === 'bomb_ring') {
        for (let i = 0; i < 5; i += 1) {
          const ang = (i * Math.PI * 2) / 5 + this.fxRng.range(0, 0.6);
          this.launchLob(enemy, 'bomb', enemy.x + Math.cos(ang) * 110, enemy.y + Math.sin(ang) * 110, {
            duration: 0.45,
            peak: 70,
            radius: 60,
            fuse: 0.55,
          });
        }
      } else {
        const len = Math.max(140, Math.min(360, dist + 60));
        for (let i = 1; i <= 5; i += 1) {
          const d = (len * i) / 5;
          this.launchLob(
            enemy,
            'bomb',
            enemy.x + Math.cos(enemy.aimAngle) * d,
            enemy.y + Math.sin(enemy.aimAngle) * d,
            { duration: 0.3 + i * 0.12, peak: 60 + i * 12, radius: 54, fuse: 0.35 },
          );
        }
      }
      this.endAttack(enemy, isBoss ? 0.8 : 0.92);
    } else if (enemy.state === 'recover') {
      this.moveWithSlide(enemy, -dirX * enemy.speed * 1.1 * dt, -dirY * enemy.speed * 1.1 * dt);
      this.stepRecover(enemy, dt, isBoss ? 0.55 : 0.65);
    }
  }

  /** Tank: lobbed mortar shell / cannon burst / (boss) tread crush. */
  private stepMortarTankAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    hasShotLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      const moveX = Math.sign(navDirX) * enemy.speed * dt;
      const moveY = Math.sign(navDirY) * enemy.speed * dt;
      if (Math.abs(navDirX) >= Math.abs(navDirY) && moveX !== 0) {
        if (!this.tryMoveCardinal(enemy, moveX, 0) && moveY !== 0) this.tryMoveCardinal(enemy, 0, moveY);
      } else if (moveY !== 0) {
        if (!this.tryMoveCardinal(enemy, 0, moveY) && moveX !== 0) this.tryMoveCardinal(enemy, moveX, 0);
      }
      enemy.aimAngle = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
      if (enemy.stateTimer > 0 || dist > 460) return;
      const next = this.peekAttack(enemy, ['tank_shell', 'tank_burst', 'tank_crush']);
      if (next === 'tank_burst' && !hasShotLOS) return;
      if (next === 'tank_crush' && (dist > 340 || !hasShotLOS)) return;
      this.beginTelegraph(enemy, next, 0.62);
      enemy.burstLeft = isBoss ? 5 : 3;
      enemy.burstCooldown = 0;
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0.14) this.aimAtPlayer(enemy, 0, 0);
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'tank_shell') {
        const spots = isBoss ? [[0, 0], [-70, -30], [70, 30]] : [[0, 0]];
        for (const [ox, oy] of spots) {
          this.launchLob(enemy, 'shell', s.player.x + ox!, s.player.y + oy!, {
            duration: 0.85,
            peak: 150,
            radius: isBoss ? 68 : 58,
          });
        }
        s.shakeIntensity = Math.max(s.shakeIntensity, 2.5);
        this.endAttack(enemy, 0.95);
      } else {
        enemy.state = 'attack';
        enemy.stateTimer = enemy.attackKind === 'tank_crush' ? 0.75 : 2;
        enemy.burstCooldown = 0;
        enemy.attackFired = false;
      }
    } else if (enemy.state === 'attack') {
      if (enemy.attackKind === 'tank_crush') {
        const spd = 380 * s.modifier.enemySpeedMult;
        this.moveWithSlide(enemy, Math.cos(enemy.aimAngle) * spd * dt, Math.sin(enemy.aimAngle) * spd * dt);
        this.contactHit(enemy, 8);
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) this.endAttack(enemy, 0.9);
        return;
      }
      enemy.burstCooldown -= dt;
      while (enemy.burstLeft > 0 && enemy.burstCooldown <= 0) {
        const targetAng = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
        const delta = Math.max(-0.14, Math.min(0.14, normalizeAngle(targetAng - enemy.aimAngle)));
        enemy.aimAngle = normalizeAngle(enemy.aimAngle + delta);
        this.fireEnemyProjectile(enemy, enemy.aimAngle, isBoss ? 410 : 380, 'shell', isBoss ? 8 : 7, 2.2);
        enemy.burstLeft -= 1;
        enemy.burstCooldown += isBoss ? 0.12 : 0.15;
      }
      if (enemy.burstLeft <= 0) this.endAttack(enemy, isBoss ? 0.85 : 1.05);
    } else if (enemy.state === 'recover') {
      this.stepRecover(enemy, dt, isBoss ? 0.75 : 0.95);
    }
  }

  /** Bull: ricochet charge / leaping stomp / (boss) triple quake. */
  private stepStampedeAI(
    enemy: EnemyEntity,
    dist: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    if (enemy.state === 'attack' && enemy.attackKind === 'boss_leap') {
      this.stepLeapAttack(enemy, isBoss ? 86 : 52, true, dt);
      return;
    }

    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (enemy.stateTimer > 0) return;
      const next = this.peekAttack(enemy, ['ricochet_charge', 'boss_leap', 'stomp_quake']);
      if (next === 'ricochet_charge') {
        if (dist <= 340 && hasMoveLOS) {
          this.beginTelegraph(enemy, 'ricochet_charge', 0.55);
          enemy.bouncesLeft = isBoss ? 3 : 1;
        }
      } else if (next === 'boss_leap') {
        if (dist <= (isBoss ? 320 : 210)) {
          enemy.bossPatternIndex += 1;
          this.beginLeapTelegraph(enemy, isBoss ? 0.68 : 0.54);
        }
      } else if (dist <= 260) {
        this.beginTelegraph(enemy, 'stomp_quake', 0.55);
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.attackKind === 'boss_leap') {
        this.updateLeapTelegraph(enemy);
        if (enemy.stateTimer <= 0) this.launchLeapAttack(enemy, isBoss ? BOSS_LEAP_DURATION : 0.5, isBoss);
        return;
      }
      if (enemy.stateTimer > 0.12) this.aimAtPlayer(enemy, 0, 0);
      if (enemy.stateTimer > 0) return;
      enemy.state = 'attack';
      enemy.attackFired = false;
      if (enemy.attackKind === 'stomp_quake') {
        enemy.burstLeft = 3;
        enemy.burstCooldown = 0;
        enemy.stateTimer = 1.0;
      } else {
        enemy.stateTimer = isBoss ? 1.55 : 1.25;
      }
    } else if (enemy.state === 'attack') {
      if (enemy.attackKind === 'stomp_quake') {
        enemy.burstCooldown -= dt;
        if (enemy.burstLeft > 0 && enemy.burstCooldown <= 0) {
          this.pushShockwave(enemy.x, enemy.y, 170, 0.55, enemy, '#d49562');
          s.shakeIntensity = Math.max(s.shakeIntensity, 5);
          this.spawnParticles(enemy.x, enemy.y, '#d49562', 10, 160);
          enemy.burstLeft -= 1;
          enemy.burstCooldown = 0.34;
        }
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0 && enemy.burstLeft <= 0) this.endAttack(enemy, 0.8);
        return;
      }
      const chargeSpeed = (isBoss ? 560 : 480) * s.modifier.enemySpeedMult;
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
      this.contactHit(enemy, 8);
      enemy.stateTimer -= dt;
      if (hitX || hitY) {
        if (hitX) enemy.aimAngle = Math.PI - enemy.aimAngle;
        if (hitY) enemy.aimAngle = -enemy.aimAngle;
        enemy.aimAngle = normalizeAngle(enemy.aimAngle);
        enemy.bouncesLeft -= 1;
        enemy.attackFired = false;
        s.shakeIntensity = Math.max(s.shakeIntensity, 3.5);
        this.spawnParticles(enemy.x, enemy.y, '#fbbf24', 6, 120);
        if (enemy.bouncesLeft < 0) this.endAttack(enemy, 0.78);
      } else if (enemy.stateTimer <= 0) {
        this.endAttack(enemy, 0.78);
      }
    } else if (enemy.state === 'recover') {
      this.stepRecover(enemy, dt, isBoss ? 0.55 : 0.65);
    }
  }

  /** Myconid: spore burst around itself / lobbed spore pod / (boss) mushroom ring around you. */
  private stepMyconidAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      // Closes all the way in, so standing still never leaves the mushroom short.
      this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      enemy.aimAngle = Math.atan2(navDirY, navDirX);
      if (enemy.stateTimer > 0) return;
      const next = this.peekAttack(enemy, ['spore_burst', 'spore_lob', 'mushroom_ring']);
      if (next === 'spore_burst' ? dist <= (isBoss ? 90 : 56) && hasMoveLOS : dist <= 280) {
        this.beginTelegraph(enemy, next, next === 'spore_burst' ? 0.52 : 0.55);
        enemy.targetX = s.player.x;
        enemy.targetY = s.player.y;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'spore_burst') {
        enemy.state = 'attack';
        enemy.stateTimer = 0.28;
        enemy.attackFired = true;
        s.sporeClouds.push({
          id: this.nextEntityId++,
          x: enemy.x,
          y: enemy.y,
          radius: isBoss ? 102 : 72,
          ttl: 2.6,
          maxTtl: 2.6,
          damage: enemy.damage,
        });
        this.spawnParticles(enemy.x, enemy.y, '#96db6e', 8, 120);
        return;
      }
      if (enemy.attackKind === 'spore_lob') {
        const spots = isBoss ? [[0, 0], [-64, 26], [64, -26]] : [[0, 0]];
        for (const [ox, oy] of spots) {
          this.launchLob(enemy, 'spore_pod', s.player.x + ox!, s.player.y + oy!, {
            duration: 0.7,
            peak: 100,
            radius: isBoss ? 68 : 56,
          });
        }
      } else {
        const base = this.fxRng.range(0, Math.PI * 2);
        for (let i = 0; i < 4; i += 1) {
          const ang = base + (i * Math.PI) / 2;
          const pt = this.clampPoint(s.player.x + Math.cos(ang) * 92, s.player.y + Math.sin(ang) * 92, 30);
          s.delayedBlasts.push({
            kind: 'spore_pod',
            x: pt.x,
            y: pt.y,
            radius: 52,
            timer: 0.9,
            maxTimer: 0.9,
            damage: enemy.damage,
            friendly: false,
            alreadyScaled: true,
          });
        }
      }
      this.endAttack(enemy, isBoss ? 0.7 : 0.85);
    } else if (enemy.state === 'attack') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) this.endAttack(enemy, isBoss ? 0.65 : 0.85);
    } else if (enemy.state === 'recover') {
      this.moveWithSlide(enemy, -dirX * enemy.speed * 0.45 * dt, -dirY * enemy.speed * 0.45 * dt);
      this.stepRecover(enemy, dt, isBoss ? 0.6 : 0.75);
    }
  }

  /** Imp: ember dart + hop / diving swoop / (boss) ember nova. */
  private stepImpAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasShotLOS: boolean,
    dt: number,
    isBoss = false,
  ): void {
    const s = this.state;
    if (enemy.bouncesLeft === 0) {
      enemy.bouncesLeft = enemy.id % 2 === 0 ? 1 : -1;
    }
    const flankDir = enemy.bouncesLeft >= 0 ? 1 : -1;

    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      const prevX = enemy.x;
      const prevY = enemy.y;
      if (!hasShotLOS || dist > 235) {
        const vx = navDirX * 0.84 + -navDirY * flankDir * 0.54;
        const vy = navDirY * 0.84 + navDirX * flankDir * 0.54;
        const mag = Math.max(0.001, Math.hypot(vx, vy));
        this.moveWithSlide(enemy, (vx / mag) * enemy.speed * dt, (vy / mag) * enemy.speed * dt);
      } else if (dist < 115) {
        const vx = -dirX * 0.72 + -dirY * flankDir * 0.68;
        const vy = -dirY * 0.72 + dirX * flankDir * 0.68;
        const mag = Math.max(0.001, Math.hypot(vx, vy));
        this.moveWithSlide(enemy, (vx / mag) * enemy.speed * 0.95 * dt, (vy / mag) * enemy.speed * 0.95 * dt);
      } else {
        this.moveWithSlide(enemy, -dirY * flankDir * enemy.speed * 0.92 * dt, dirX * flankDir * enemy.speed * 0.92 * dt);
      }
      if (dt > 0 && enemy.speed > 0 && Math.hypot(enemy.x - prevX, enemy.y - prevY) < enemy.speed * dt * 0.15) {
        enemy.bouncesLeft = -flankDir;
      }
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 320 && hasShotLOS) {
        const next = this.peekAttack(enemy, ['imp_dart', 'imp_swoop', 'ember_nova']);
        this.beginTelegraph(enemy, next, next === 'ember_nova' ? 0.55 : 0.42);
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0.14) this.aimAtPlayer(enemy, 0, 0);
      else enemy.telegraphLocked = true;
      if (enemy.stateTimer > 0) return;
      if (enemy.attackKind === 'imp_swoop') {
        enemy.targetX = s.player.x + Math.cos(enemy.aimAngle) * 32;
        enemy.targetY = s.player.y + Math.sin(enemy.aimAngle) * 32;
        enemy.attackFired = false;
        enemy.state = 'attack';
        enemy.stateTimer = isBoss ? 0.34 : 0.28;
        return;
      }
      if (enemy.attackKind === 'ember_nova') {
        this.fireProjectileRing(enemy, 12, 3, 260, 'ember', 7);
        this.endAttack(enemy, 0.7);
        return;
      }
      const spread = isBoss ? [-0.2, 0, 0.2] : [0];
      for (const off of spread) {
        this.fireEnemyProjectile(enemy, enemy.aimAngle + off, isBoss ? 460 : 420, 'ember', isBoss ? 8 : 6, 1.8);
      }
      this.spawnParticles(
        enemy.x + Math.cos(enemy.aimAngle) * enemy.radius,
        enemy.y + Math.sin(enemy.aimAngle) * enemy.radius,
        '#f0853a',
        4,
        110,
      );
      // Diagonal flank hop after each dart.
      const ax = Math.cos(enemy.aimAngle);
      const ay = Math.sin(enemy.aimAngle);
      const radialBias = dist < 175 ? -0.45 : 0.35;
      let hopSide = flankDir;
      const makeHopDir = (side: number): { hx: number; hy: number } => {
        const rx = -ay * side * 0.84 + ax * radialBias;
        const ry = ax * side * 0.84 + ay * radialBias;
        const len = Math.max(0.001, Math.hypot(rx, ry));
        return { hx: rx / len, hy: ry / len };
      };
      let hop = makeHopDir(hopSide);
      const probeX = enemy.x + hop.hx * 32;
      const probeY = enemy.y + hop.hy * 32;
      if (
        probeX - enemy.radius < PLAY_MIN_X ||
        probeX + enemy.radius > PLAY_MAX_X ||
        probeY - enemy.radius < PLAY_MIN_Y ||
        probeY + enemy.radius > PLAY_MAX_Y ||
        this.pointInObstacle(probeX, probeY, enemy.radius)
      ) {
        hopSide = -hopSide;
        hop = makeHopDir(hopSide);
      }
      enemy.targetX = enemy.x + hop.hx * 84;
      enemy.targetY = enemy.y + hop.hy * 84;
      enemy.bouncesLeft = -hopSide;
      enemy.attackFired = true;
      enemy.state = 'attack';
      enemy.stateTimer = 0.24;
    } else if (enemy.state === 'attack') {
      const hdx = enemy.targetX - enemy.x;
      const hdy = enemy.targetY - enemy.y;
      const hDist = Math.hypot(hdx, hdy);
      if (hDist > 2) {
        const hopSpeed = (enemy.attackKind === 'imp_swoop' ? 420 : 295) * s.modifier.enemySpeedMult;
        const step = Math.min(hDist, hopSpeed * dt);
        this.moveWithSlide(enemy, (hdx / hDist) * step, (hdy / hDist) * step);
      }
      if (enemy.attackKind === 'imp_swoop') this.contactHit(enemy, 10);
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) this.endAttack(enemy, isBoss ? 0.42 : 0.52);
    } else if (enemy.state === 'recover') {
      this.stepRecover(enemy, dt, isBoss ? 0.45 : 0.55);
    }
  }

  private fireEnemyArrow(enemy: EnemyEntity, angOffset = 0, radius = 5, speed = 500, pierce = false): void {
    this.fireEnemyProjectile(enemy, enemy.aimAngle + angOffset, speed, 'arrow', radius, 2.2, { pierce });
  }

  /** Archer: aimed shot / arrow rain on your position / (boss) charged piercing snipe. */
  private stepArcherAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasShotLOS: boolean,
    dt: number,
    isBoss = false,
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
      if (!hasShotLOS || dist > 360) {
        this.moveWithSlide(enemy, navDirX * enemy.speed * dt, navDirY * enemy.speed * dt);
      } else if (dist < 190) {
        this.moveWithSlide(enemy, -dirX * enemy.speed * 0.7 * dt, -dirY * enemy.speed * 0.7 * dt);
      } else {
        this.moveWithSlide(enemy, -dirY * strafeDir * enemy.speed * 0.58 * dt, dirX * strafeDir * enemy.speed * 0.58 * dt);
      }
      if (dt > 0 && enemy.speed > 0 && Math.hypot(enemy.x - prevX, enemy.y - prevY) < enemy.speed * dt * 0.15) {
        enemy.bouncesLeft = -strafeDir;
      }
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 500) {
        const next = this.peekAttack(enemy, ['shoot_arrow', 'arrow_rain', 'snipe']);
        if (next !== 'arrow_rain' && !hasShotLOS) return;
        this.beginTelegraph(enemy, next, next === 'snipe' ? 1.0 : next === 'arrow_rain' ? 0.45 : 0.52);
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      const lockAt = enemy.attackKind === 'snipe' ? 0.26 : 0.18;
      if (enemy.stateTimer > lockAt) {
        this.aimAtPlayer(enemy, enemy.attackKind === 'snipe' ? 0.2 : 0.14, enemy.attackKind === 'snipe' ? 44 : 28);
        enemy.targetX = enemy.x + Math.cos(enemy.aimAngle) * 640;
        enemy.targetY = enemy.y + Math.sin(enemy.aimAngle) * 640;
      } else {
        enemy.telegraphLocked = true;
      }
      if (enemy.stateTimer > 0) return;
      enemy.attackFired = true;
      if (enemy.attackKind === 'arrow_rain') {
        const spots: Array<{ x: number; y: number }> = [{ x: s.player.x, y: s.player.y }];
        if (isBoss) {
          const base = this.fxRng.range(0, Math.PI * 2);
          spots.push(
            { x: s.player.x + Math.cos(base) * 90, y: s.player.y + Math.sin(base) * 90 },
            { x: s.player.x - Math.cos(base) * 90, y: s.player.y - Math.sin(base) * 90 },
          );
        }
        for (const spot of spots) {
          const pt = this.clampPoint(spot.x, spot.y, 30);
          s.delayedBlasts.push({
            kind: 'arrow_rain',
            x: pt.x,
            y: pt.y,
            radius: isBoss ? 58 : 54,
            timer: 0.95,
            maxTimer: 0.95,
            damage: enemy.damage,
            friendly: false,
            alreadyScaled: true,
          });
        }
        this.endAttack(enemy, isBoss ? 0.6 : 0.8);
      } else if (enemy.attackKind === 'snipe') {
        this.fireEnemyArrow(enemy, 0, 7, 950, true);
        s.shakeIntensity = Math.max(s.shakeIntensity, 3);
        this.endAttack(enemy, 0.9);
      } else {
        this.fireEnemyArrow(enemy, 0, isBoss ? 6 : 5);
        enemy.state = 'attack';
        enemy.burstLeft = isBoss ? 2 : 0;
        enemy.burstCooldown = 0.16;
        enemy.stateTimer = isBoss ? 0.4 : 0.16;
      }
    } else if (enemy.state === 'attack') {
      enemy.stateTimer -= dt;
      if (enemy.burstLeft > 0) {
        enemy.burstCooldown -= dt;
        if (enemy.burstCooldown <= 0) {
          const targetAng = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
          const delta = Math.max(-0.16, Math.min(0.16, normalizeAngle(targetAng - enemy.aimAngle)));
          enemy.aimAngle = normalizeAngle(enemy.aimAngle + delta);
          this.fireEnemyArrow(enemy, 0, isBoss ? 6 : 5);
          enemy.burstLeft -= 1;
          enemy.burstCooldown += 0.16;
        }
      }
      if (enemy.stateTimer <= 0) this.endAttack(enemy, isBoss ? 0.58 : 0.72);
    } else if (enemy.state === 'recover') {
      this.stepRecover(enemy, dt, isBoss ? 0.56 : 0.68);
    }
  }

  private beginLeapTelegraph(enemy: EnemyEntity, duration: number): void {
    const landing = this.pickSafeLeapLanding(enemy.radius);
    enemy.state = 'telegraph';
    enemy.attackKind = 'boss_leap';
    enemy.telegraphDuration = duration;
    enemy.stateTimer = duration;
    enemy.aimAngle = Math.atan2(landing.y - enemy.y, landing.x - enemy.x);
    enemy.targetX = landing.x;
    enemy.targetY = landing.y;
    enemy.leapStartX = enemy.x;
    enemy.leapStartY = enemy.y;
    enemy.leapZ = 0;
  }

  private updateLeapTelegraph(enemy: EnemyEntity): void {
    if (enemy.stateTimer > 0.25) {
      const landing = this.pickSafeLeapLanding(enemy.radius);
      enemy.targetX = landing.x;
      enemy.targetY = landing.y;
      enemy.aimAngle = Math.atan2(enemy.targetY - enemy.y, enemy.targetX - enemy.x);
    }
  }

  private launchLeapAttack(enemy: EnemyEntity, duration: number, isBoss: boolean): void {
    enemy.state = 'attack';
    enemy.leapStartX = enemy.x;
    enemy.leapStartY = enemy.y;
    enemy.leapDuration = duration;
    enemy.stateTimer = duration;
    enemy.leapZ = 1;
    if (isBoss) {
      this.spawnParticles(enemy.x, enemy.y, '#cbd5e1', 8, 120);
    }
  }

  private stepLeapAttack(enemy: EnemyEntity, slamRadius: number, isBoss: boolean, dt: number): void {
    const s = this.state;
    enemy.stateTimer -= dt;
    const u = Math.max(0, Math.min(1, 1 - enemy.stateTimer / Math.max(0.01, enemy.leapDuration)));
    enemy.x = enemy.leapStartX + (enemy.targetX - enemy.leapStartX) * u;
    enemy.y = enemy.leapStartY + (enemy.targetY - enemy.leapStartY) * u;
    enemy.leapZ = Math.sin(u * Math.PI) * (isBoss ? BOSS_LEAP_MAX_Z : 58);

    if (enemy.stateTimer <= 0) {
      enemy.leapZ = 0;
      enemy.x = enemy.targetX;
      enemy.y = enemy.targetY;
      this.pushOutOfObstacles(enemy, enemy.radius);
      this.clampToArena(enemy);
      s.shakeIntensity = Math.max(s.shakeIntensity, isBoss ? 8.5 : 4.5);
      this.spawnParticles(enemy.x, enemy.y, '#e04f44', isBoss ? 14 : 8, 200);
      if (isBoss) this.spawnBreakDebris(enemy.x, enemy.y, 'pillar', true);
      if (Math.hypot(s.player.x - enemy.x, s.player.y - enemy.y) <= slamRadius + s.player.radius * 0.5) {
        this.damagePlayer(enemy.damage);
      }
      this.triggerBarrelsInRadius(enemy.x, enemy.y, slamRadius);
      if (isBoss) {
        s.rings.push({ x: enemy.x, y: enemy.y, radius: 32, maxRadius: 150, ttl: 0.45, maxTtl: 0.45, color: '#e04f44' });
      }
      enemy.state = 'recover';
      enemy.stateTimer = enemy.phase === 2 ? 0.72 : 0.88;
      enemy.attackKind = 'none';
    }
  }

  private pickSafeLeapLanding(radius: number): { x: number; y: number } {
    const s = this.state;
    const pt = {
      x: Math.max(PLAY_MIN_X + 64, Math.min(PLAY_MAX_X - 64, s.player.x)),
      y: Math.max(PLAY_MIN_Y + 64, Math.min(PLAY_MAX_Y - 64, s.player.y)),
    };
    this.pushOutOfObstacles(pt, radius);
    this.clampToArena(pt, radius);
    return pt;
  }

  private stepBossAI(
    boss: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
    navDirX: number,
    navDirY: number,
    hasMoveLOS: boolean,
    hasShotLOS: boolean,
    dt: number,
  ): void {
    const s = this.state;
    const base: BossBaseArchetype = boss.bossBase ?? 'shooter';

    if (boss.phase === 1 && boss.leapZ <= 0 && boss.hp <= boss.maxHp * 0.5) {
      boss.phase = 2;
      boss.state = 'recover';
      boss.stateTimer = 0.65;
      boss.attackKind = 'none';
      this.announce(`${getBossDisplayName(base, boss.bossVariant)} Enraged!`);
      s.rings.push({ x: boss.x, y: boss.y, radius: 25, maxRadius: 210, ttl: 0.4, maxTtl: 0.4, color: '#e04f44' });
      if (!boss.didPhaseAddSpawn && s.floor >= 2) {
        boss.didPhaseAddSpawn = true;
        const addKind: BossBaseArchetype =
          base === 'elite_charger' || base === 'mortar_tank' ? 'chaser' : base;
        this.spawnAdds(boss, addKind, 2, 1);
      }
      return;
    }

    // Preserve an explicit boss_leap (used by Boss Leap physics & animation test).
    if (boss.attackKind === 'boss_leap') {
      if (boss.state === 'telegraph') {
        boss.stateTimer -= dt;
        this.updateLeapTelegraph(boss);
        if (boss.stateTimer <= 0) this.launchLeapAttack(boss, BOSS_LEAP_DURATION, true);
        return;
      }
      if (boss.state === 'attack') {
        this.stepLeapAttack(boss, 86, true, dt);
        return;
      }
    }

    const baseDt = s.floor === 1 ? dt * 0.88 : dt;
    const scaledDt = boss.phase === 2 ? baseDt * 1.12 : baseDt;
    switch (base) {
      case 'chaser':
        this.stepChaserAI(boss, dist, navDirX, navDirY, hasMoveLOS, scaledDt, true);
        break;
      case 'shooter':
        this.stepShooterAI(boss, dist, dirX, dirY, navDirX, navDirY, hasShotLOS, scaledDt, true);
        break;
      case 'charger':
      case 'elite_charger':
        this.stepChargerAI(boss, dist, navDirX, navDirY, hasMoveLOS, scaledDt, true);
        break;
      case 'shade':
        this.stepShadeAI(boss, dist, dirX, dirY, navDirX, navDirY, hasShotLOS, scaledDt, true);
        break;
      case 'yeti':
        this.stepYetiAI(boss, dist, navDirX, navDirY, scaledDt, true);
        break;
      case 'bomber':
        this.stepBomberAI(boss, dist, dirX, dirY, navDirX, navDirY, hasMoveLOS, scaledDt, true);
        break;
      case 'mortar_tank':
        this.stepMortarTankAI(boss, dist, navDirX, navDirY, hasShotLOS, scaledDt, true);
        break;
      case 'stampede':
        this.stepStampedeAI(boss, dist, navDirX, navDirY, hasMoveLOS, scaledDt, true);
        break;
      case 'myconid':
        this.stepMyconidAI(boss, dist, dirX, dirY, navDirX, navDirY, hasMoveLOS, scaledDt, true);
        break;
      case 'imp':
        this.stepImpAI(boss, dist, dirX, dirY, navDirX, navDirY, hasShotLOS, scaledDt, true);
        break;
      case 'archer':
        this.stepArcherAI(boss, dist, dirX, dirY, navDirX, navDirY, hasShotLOS, scaledDt, true);
        break;
    }
  }

  /** Thrown things fly in an arc, then land as a blast, a fused bomb or a spore cloud. */
  private updateLobs(dt: number): void {
    const s = this.state;
    const flying: LobEffect[] = [];
    for (const lob of s.lobs) {
      lob.timer += dt;
      if (lob.timer < lob.duration) {
        flying.push(lob);
        continue;
      }
      const kind: DelayedBlastEffect['kind'] =
        lob.kind === 'bomb'
          ? 'sapper_bomb'
          : lob.kind === 'shell'
            ? 'tank_shell'
            : lob.kind === 'spore_pod'
              ? 'spore_pod'
              : lob.kind === 'snowball'
                ? 'ice_mortar'
                : 'rock_impact';
      const fuse = Math.max(0.01, lob.fuse);
      s.delayedBlasts.push({
        kind,
        x: lob.tx,
        y: lob.ty,
        radius: lob.radius,
        timer: fuse,
        maxTimer: fuse,
        damage: lob.damage,
        friendly: false,
        alreadyScaled: true,
      });
      this.spawnParticles(lob.tx, lob.ty, lob.kind === 'spore_pod' ? '#96db6e' : '#d6c8b0', 5, 90);
    }
    s.lobs = flying;
  }

  private updateProjectiles(dt: number): void {
    const s = this.state;
    const p = s.player;
    const active: ProjectileEntity[] = [];

    for (const proj of s.projectiles) {
      proj.ttl -= dt;
      if (proj.ttl <= 0) continue;
      if (!proj.friendly && proj.homing && (proj.homingTime ?? 0) > 0) {
        proj.homingTime = (proj.homingTime ?? 0) - dt;
        const want = Math.atan2(p.y - proj.y, p.x - proj.x);
        const cur = Math.atan2(proj.vy, proj.vx);
        const turn = Math.max(-proj.homing * dt, Math.min(proj.homing * dt, normalizeAngle(want - cur)));
        const speed = Math.hypot(proj.vx, proj.vy);
        const next = cur + turn;
        proj.vx = Math.cos(next) * speed;
        proj.vy = Math.sin(next) * speed;
        proj.angle = next;
      }
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      const emberShot = proj.friendly && Boolean(proj.weaponShot);

      const hitColor = proj.friendly
        ? '#fbbf24'
        : proj.kind === 'arrow'
          ? '#d49562'
          : proj.kind === 'ember'
            ? '#f0853a'
            : '#f97316';

      if (
        proj.x - proj.radius < PLAY_MIN_X ||
        proj.x + proj.radius > PLAY_MAX_X ||
        proj.y - proj.radius < PLAY_MIN_Y ||
        proj.y + proj.radius > PLAY_MAX_Y
      ) {
        this.spawnParticles(proj.x, proj.y, hitColor, 4, 80);
        if (emberShot) this.placeEmberPatch(proj.x, proj.y);
        continue;
      }

      // Blocks stop every projectile (cover from shooters, and no shooting through walls).
      if (this.pointInObstacle(proj.x, proj.y, Math.min(proj.radius, 10) * 0.5)) {
        this.spawnParticles(proj.x, proj.y, hitColor, 4, 80);
        if (emberShot) this.placeEmberPatch(proj.x, proj.y);
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
            this.placeEmberPatch(enemy.x, enemy.y);
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
              if (!proj.pierce || br.kind === 'chest') consumed = true;
              if (consumed) this.placeEmberPatch(proj.x, proj.y);
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
        } else if (this.triggerBarrelsInRadius(proj.x, proj.y, proj.radius)) {
          // Monster shots detonate barrels they hit.
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
    if (enemy.dormant && enemy.hp > 0) this.wakeMimic(enemy);
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
      this.stuckTimers.delete(enemy.id);
      if (enemy.mimic) {
        this.addFloatingText(enemy.x, enemy.y - 30, 'TREASURE!', '#fde047', 1.1);
        if (this.lootRng.next() < HEART_CRATE_CHANCE) {
          s.hearts.push({ id: this.nextEntityId++, x: enemy.x, y: enemy.y, age: 0 });
        }
      }

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
    if (br.kind === 'chest') return;
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
    s.lobs = [];
    s.sporeClouds = [];
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

    for (const br of s.breakables) {
      if (br.kind === 'chest' && !br.opened && Math.hypot(p.x - br.x, p.y - br.y) <= p.radius + br.radius + 14) {
        this.openChest(br);
      }
    }

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
    if (claimed.relic.id === 'vitality') {
      const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
      p.maxHp += VITALITY_HP_PER_LEVEL;
      p.hp = Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * ratio)));
    }
    const mem = this.roomMemory.get(s.currentRoomId);
    if (mem) {
      mem.rewardClaimed = true;
    }
    s.hitstopTimer = Math.max(s.hitstopTimer, 0.03);
    s.shakeIntensity = Math.max(s.shakeIntensity, 4.5);
    this.spawnParticles(claimed.x, claimed.y, '#fbbf24', 18, 175);
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

      if (ring.harmfulToPlayer) {
        // Boss shockwaves detonate barrels as the ring sweeps over them.
        for (const haz of s.hazards) {
          if (haz.type !== 'barrels' || haz.destroyed) continue;
          if (Math.abs(Math.hypot(haz.x - ring.x, haz.y - ring.y) - ring.radius) <= 18) {
            this.triggerBarrelExplosion(haz);
          }
        }
      }

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
    kind: 'crate' | 'pillar' | 'barrel' | 'chest',
    light = false,
  ): void {
    const palette =
      kind === 'chest'
        ? (['#894c37', '#c47e52', '#f3a629', '#fef074'] as const)
        : kind === 'crate'
          ? (['#c2844c', '#9a5b2d', '#e0a96d', '#7c4521'] as const)
          : kind === 'barrel'
            ? (['#b91c1c', '#92400e', '#dc2626', '#52525b', '#78350f'] as const)
            : (['#94a3b8', '#64748b', '#cbd5e1', '#475569'] as const);
    const borderColor =
      kind === 'crate' || kind === 'chest' ? '#2a1810' : kind === 'barrel' ? '#18181b' : '#1e293b';
    const count = light ? (kind === 'barrel' ? 4 : 3) : kind === 'crate' ? 9 : kind === 'chest' ? 10 : kind === 'barrel' ? 11 : 10;

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
      if (kind === 'chest') {
        this.spawnParticles(x, y, '#fde047', 10, 150);
        s.shakeIntensity = Math.max(s.shakeIntensity, 3);
      } else if (kind === 'crate') {
        this.spawnParticles(x, y, '#e7c89c', 7, 130);
        s.shakeIntensity = Math.max(s.shakeIntensity, 2.5);
      } else if (kind === 'pillar') {
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
    // Check the whole body (not just a thin line) so big monsters don't scrape along blocks.
    const movePad = Math.min(enemy.radius + 2, 26);
    const hasMoveLOS = this.hasClearLine(enemy.x, enemy.y, p.x, p.y, movePad);
    const hasShotLOS = this.hasClearLine(enemy.x, enemy.y, p.x, p.y, 12);
    const stuck = (this.stuckTimers.get(enemy.id) ?? 0) > 0.25;
    if (hasMoveLOS && !stuck) {
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
      if (this.hasClearLine(enemy.x, enemy.y, nextCenter.x, nextCenter.y, Math.min(enemy.radius + 2, 26))) {
        target = nextCenter;
      }
    }

    const tx = target.x - enemy.x;
    const ty = target.y - enemy.y;
    const tDist = Math.hypot(tx, ty);
    if (tDist <= 0.001) {
      return { dirX: rawDirX, dirY: rawDirY, hasMoveLOS, hasShotLOS };
    }
    return { dirX: tx / tDist, dirY: ty / tDist, hasMoveLOS, hasShotLOS };
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

export function computeRunScore(params: {
  floorReached: number;
  floorsCleared: number;
  roomsCleared: number;
  coinsEarned: number;
  elapsedSec: number;
  damageTaken: number;
  enemiesKilled: number;
}): number {
  const base =
    params.floorsCleared * 8500 +
    Math.max(0, params.floorReached - 1) * 2500 +
    params.roomsCleared * 800 +
    params.coinsEarned * 95 +
    params.enemiesKilled * 50;
  if (base <= 0) return 0;
  const targetSec = Math.max(45, params.roomsCleared * 18 + params.floorsCleared * 35);
  const speedMult = 1 + 0.55 * (targetSec / (targetSec + Math.max(0, params.elapsedSec)));
  const hpMult = 0.8 + 0.25 * Math.exp(-Math.max(0, params.damageTaken) / 110);
  return Math.min(999_999, Math.max(0, Math.round(base * speedMult * hpMult)));
}

export const SPIKE_CYCLE_SEC = 3.2;
export const SPIKE_ACTIVE_THRESHOLD = 2.55;

export function isSpikeActive(timer: number): boolean {
  return timer >= SPIKE_ACTIVE_THRESHOLD;
}

/**
 * Monster attacks where the body itself rams things (and can bump barrels).
 * The boss leap is handled at its landing slam instead.
 */
const BARREL_CONTACT_ATTACKS: ReadonlySet<string> = new Set(['lunge', 'charge', 'ricochet_charge']);

function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
