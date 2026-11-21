import { getDailyHazard, getDailyModifier } from '../modifiers.ts';
import { draftRelics } from '../relics.ts';
import { createDailyStream, type SeededRng } from '../rng.ts';
import type {
  ActiveRelicMap,
  CosmeticId,
  DailyModifier,
  DoorDirection,
  HazardType,
  InputFrame,
  PlayerProfile,
  RelicDef,
  RoomType,
  RunSummary,
} from '../types.ts';
import {
  ARENA_H,
  ARENA_W,
  ATTACK_ANIM_DURATION,
  ATTACK_BUFFER_TIME,
  ATTACK_CD,
  ATTACK_DMG,
  ATTACK_ENDLAG_DURATION,
  ATTACK_RANGE,
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
  buildDailyDungeonMap,
  buildEndlessRoomBlueprint,
  oppositeDirection,
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
  kind: 'orb' | 'rift_wave';
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

export type PortalEntity = {
  kind: 'extract' | 'endless';
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
  kind: 'decoy_mine' | 'phantom_echo' | 'shatter_quake' | 'volatile_blast' | 'barrel_blast';
  x: number;
  y: number;
  radius: number;
  timer: number;
  maxTimer: number;
  damage: number;
  friendly: boolean;
  hurtPlayerToo?: boolean | undefined;
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
  damageBonusMult: number;
  coinBonusMult: number;
  magnetRadius: number;
};

export type GameState = {
  phase: GamePhase;
  utcDate: string;
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
  dailyHazard: HazardType;
  player: PlayerState;
  enemies: EnemyEntity[];
  projectiles: ProjectileEntity[];
  hazards: HazardEntity[];
  breakables: BreakableEntity[];
  coins: CoinEntity[];
  pedestals: PedestalEntity[];
  fountain: FountainEntity | null;
  portals: PortalEntity[];
  firePatches: FirePatchEffect[];
  delayedBlasts: DelayedBlastEffect[];
  slashes: SlashEffect[];
  rings: RingEffect[];
  lightnings: LightningEffect[];
  particles: ParticleEffect[];
  floatingTexts: FloatingTextEffect[];
  afterimages: AfterimageEffect[];
  stats: {
    coinsEarned: number;
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
    this.dungeonMap = buildDailyDungeonMap(utcDate, getDailyHazard(utcDate));
    const startNode = this.dungeonMap.rooms[0];
    if (!startNode) throw new Error('Dungeon map missing start room');
    this.currentBlueprint = startNode.blueprint;
    this.state = this.createFreshState(utcDate, profile, 'start');
    this.refreshMapView();
  }

  public setOnRunEnd(cb: (summary: RunSummary) => void): void {
    this.endCallback = cb;
  }

  public startNewRun(utcDate: string, profile: PlayerProfile): void {
    this.profile = profile;
    this.relicRng = createDailyStream(utcDate, 'relics');
    this.bossRng = createDailyStream(utcDate, 'boss');
    this.fxRng = createDailyStream(utcDate, 'fx');
    this.dungeonMap = buildDailyDungeonMap(utcDate, getDailyHazard(utcDate));
    this.roomMemory.clear();
    this.doorEntryLockTimer = 0;
    this.state = this.createFreshState(utcDate, profile, 'playing');
    this.enterMapRoom(this.dungeonMap.startRoomId, 'none', null);
  }

  public setPhase(phase: GamePhase): void {
    this.state.phase = phase;
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
    const clearBonus = s.stats.bossDefeated ? 350 : 0;
    const extractBonus = s.stats.extracted ? 200 : 0;
    const roomScore =
      s.clearedRooms * 150 +
      (s.progressPct >= 100 ? 300 : 0) +
      Math.max(0, s.roomIndex - s.totalRooms) * 180;
    const killScore = s.stats.enemiesKilled * 20;
    const speedBonus = s.stats.bossDefeated ? Math.max(0, Math.round(600 - s.elapsedTime)) : 0;
    const penalty = Math.round(s.stats.damageTaken * 1.5);
    const score = Math.max(
      10,
      roomScore + killScore + clearBonus + extractBonus + speedBonus - penalty,
    );

    return {
      utcDate: s.utcDate,
      outcome: s.stats.extracted ? 'extracted' : 'defeated',
      bossDefeated: s.stats.bossDefeated,
      roomReached: s.roomIndex,
      progressPct: s.progressPct,
      totalRooms: s.totalRooms,
      elapsedSec: Math.round(s.elapsedTime * 10) / 10,
      coinsEarned: s.stats.coinsEarned,
      damageTaken: Math.round(s.stats.damageTaken),
      enemiesKilled: s.stats.enemiesKilled,
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
    this.updateProjectiles(dt);
    this.updateCoins(dt);
    this.updatePostRoomInteractions(dt);

    if (s.player.hp <= 0 && s.phase === 'playing') {
      this.beginPlayerDeath();
    }
  }

  private createFreshState(
    utcDate: string,
    profile: PlayerProfile,
    phase: GamePhase,
  ): GameState {
    const modifier = getDailyModifier(utcDate);
    const dailyHazard = getDailyHazard(utcDate);
    const maxHp = BASE_HP + profile.upgrades.vitality * 10;
    const baseShields =
      profile.upgrades.shield + (profile.pendingConsumable === 'shield_tonic' ? 2 : 0);
    const damageBonusMult = profile.pendingConsumable === 'fury_charm' ? 1.15 : 1;
    const magnetLevel = profile.upgrades.magnet;
    const coinBonusMult = 1 + magnetLevel * 0.1;
    const magnetRadius = 115 * (1 + magnetLevel * 0.15);

    const startingRelics: ActiveRelicMap = {};
    if (profile.pendingConsumable === 'bonus_relic') {
      const [bonus] = draftRelics(this.relicRng, profile.unlockedRelics, 1);
      if (bonus) {
        startingRelics[bonus.id] = 1;
      }
    }

    const startNode = this.dungeonMap.rooms[0];
    if (!startNode) throw new Error('Dungeon map missing start room');
    this.currentBlueprint = startNode.blueprint;

    return {
      phase,
      utcDate,
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
      dailyHazard,
      player: {
        x: PLAYER_SPAWN_X,
        y: PLAYER_SPAWN_Y,
        vx: 0,
        vy: 0,
        radius: PLAYER_RADIUS,
        hp: maxHp,
        maxHp,
        shields: baseShields,
        maxShields: baseShields,
        facingX: 0,
        facingY: -1,
        attackCooldown: 0,
        attackMaxCooldown: ATTACK_CD * modifier.attackCdMult,
        attackAnimTimer: 0,
        attackEndlagTimer: 0,
        attackBufferedTimer: 0,
        attackAngle: -Math.PI / 2,
        swingCount: 0,
        meleeHitCount: 0,
        iFramesTimer: 0,
        hurtFlashTimer: 0,
        trailSpawnTimer: 0,
        relics: startingRelics,
        rerollsRemaining: profile.upgrades.reroll,
        cosmetic: profile.equippedCosmetic,
        damageBonusMult,
        coinBonusMult,
        magnetRadius,
      },
      enemies: [],
      projectiles: [],
      hazards: [],
      breakables: [],
      coins: [],
      pedestals: [],
      fountain: null,
      portals: [],
      firePatches: [],
      delayedBlasts: [],
      slashes: [],
      rings: [],
      lightnings: [],
      particles: [],
      floatingTexts: [],
      afterimages: [],
      stats: {
        coinsEarned: 0,
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
      return;
    }
    this.enterEndlessRoom(roomIndex, transitionKind);
  }

  public enterMapRoom(
    roomId: number,
    transitionKind: RoomTransitionKind = 'none',
    travelDir: DoorDirection | null = null,
  ): void {
    const s = this.state;
    const node = this.dungeonMap.rooms.find((r) => r.id === roomId);
    if (!node) {
      this.enterEndlessRoom(this.dungeonMap.totalRooms + 1, transitionKind);
      return;
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
    s.coins = [];

    this.refreshMapView();

    if (mem.cleared) {
      s.hazards = [];
      s.breakables = [];
      s.waveIndex = 0;
      s.totalWaves = 0;
      s.waveDelayTimer = 0;

      if (s.rewardType === 'fountain_and_relics' && !mem.fountainUsed) {
        s.fountain = {
          x: ARENA_W / 2,
          y: 325,
          used: false,
          healAmount: Math.round(s.player.maxHp * 0.35),
        };
      }

      if (node.id === this.dungeonMap.bossRoomId) {
        s.portals = [
          { kind: 'extract', x: ARENA_W / 2 - 116, y: 235, label: 'EXTRACT · LOCK RUN', progress: 0 },
          { kind: 'endless', x: ARENA_W / 2 + 116, y: 235, label: 'PUSH ENDLESS', progress: 0 },
        ];
        s.roomState = 'boss_choice';
      } else {
        if (s.stats.bossDefeated && s.progressPct === 100) {
          s.portals = [
            { kind: 'extract', x: ARENA_W / 2 - 116, y: 330, label: 'EXTRACT · LOCK RUN', progress: 0 },
            { kind: 'endless', x: ARENA_W / 2 + 116, y: 330, label: 'PUSH ENDLESS', progress: 0 },
          ];
        }
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

      this.spawnWave(0);
    }

    s.announcementText = '';
    s.announcementTimer = 0;
  }

  private enterEndlessRoom(
    roomIndex: number,
    transitionKind: RoomTransitionKind = 'portal',
  ): void {
    const s = this.state;
    const depth = Math.max(1, roomIndex - this.dungeonMap.totalRooms);
    const blueprint = buildEndlessRoomBlueprint(s.utcDate, depth, roomIndex, s.dailyHazard);
    this.currentBlueprint = blueprint;

    s.currentRoomId = -roomIndex;
    s.roomIndex = roomIndex;
    s.totalRooms = this.dungeonMap.totalRooms;
    s.roomType = blueprint.roomType;
    s.roomState = 'combat';
    s.rewardType = blueprint.rewardType;
    s.isFirstVisitToRoom = true;
    s.waveIndex = 0;
    s.totalWaves = blueprint.waves.length;
    s.waveDelayTimer = 0;
    s.deathTimer = 0;
    s.deathDuration = DEATH_ANIM_DURATION;
    s.roomTransitionKind = transitionKind;
    s.roomTransitionDir = null;
    if (transitionKind !== 'none') {
      const dur = transitionKind === 'portal' ? 0.64 : 0.48;
      s.roomTransitionDuration = dur;
      s.roomTransitionTimer = dur;
    } else {
      s.roomTransitionDuration = 0.48;
      s.roomTransitionTimer = 0;
    }

    s.player.x = PLAYER_SPAWN_X;
    s.player.y = PLAYER_SPAWN_Y;
    s.player.vx = 0;
    s.player.vy = 0;
    s.player.facingX = 0;
    s.player.facingY = -1;
    s.player.attackCooldown = 0;
    s.player.attackAnimTimer = 0;
    s.player.attackEndlagTimer = 0;
    s.player.attackBufferedTimer = 0;
    s.player.iFramesTimer = Math.max(
      s.player.iFramesTimer,
      transitionKind !== 'none' ? s.roomTransitionDuration + 0.35 : 0.35,
    );
    this.doorEntryLockTimer = 0.28;

    s.enemies = [];
    s.projectiles = [];
    s.pedestals = [];
    s.fountain = null;
    s.portals = [];
    s.firePatches = [];
    s.delayedBlasts = [];
    s.rings = [];
    s.coins = [];
    s.doors = [];
    s.mapRooms = [];

    s.hazards = blueprint.hazards.map((h) => ({
      ...h,
      timer: h.phaseOffset,
      hp: 20,
      destroyed: false,
    }));

    s.breakables = blueprint.breakables.map((b) => ({
      ...b,
      maxHp: b.hp,
      hitFlash: 0,
    }));

    this.spawnWave(0);
    s.announcementText = '';
    s.announcementTimer = 0;
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

    if (s.roomType === 'endless') {
      s.doors = [];
      s.mapRooms = [];
      return;
    }

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

    const moveSpeedMult = p.attackAnimTimer > 0 ? 0.35 : p.attackEndlagTimer > 0 ? 0.55 : 1;
    const targetVx = input.moveX * PLAYER_SPEED * moveSpeedMult;
    const targetVy = input.moveY * PLAYER_SPEED * moveSpeedMult;
    const accelRate = (input.moveX !== 0 || input.moveY !== 0 ? 18 : 16) * s.modifier.frictionMult;
    const blend = 1 - Math.exp(-accelRate * dt);
    p.vx += (targetVx - p.vx) * blend;
    p.vy += (targetVy - p.vy) * blend;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

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
    const angle = Math.atan2(aimVec.y, aimVec.x);

    p.facingX = Math.cos(angle);
    p.facingY = Math.sin(angle);
    p.attackAngle = angle;
    p.attackMaxCooldown = ATTACK_CD * s.modifier.attackCdMult;
    p.attackCooldown = p.attackMaxCooldown;
    p.attackAnimTimer = ATTACK_ANIM_DURATION;
    p.attackEndlagTimer = Math.min(
      p.attackMaxCooldown,
      ATTACK_ENDLAG_DURATION * s.modifier.attackCdMult,
    );
    p.swingCount += 1;

    const vortexLv = p.relics.vortex_slam ?? 0;
    if (vortexLv > 0) {
      const pullRadius = 150 + 25 * (vortexLv - 1);
      for (const enemy of s.enemies) {
        if (enemy.spawnShieldTimer > 0) continue;
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
    const swingDmg =
      ATTACK_DMG *
      s.modifier.attackDamageMult *
      (1 + 0.15 * bloodLv) *
      p.damageBonusMult *
      s.modifier.playerDamageMult;

    const cleaveArc = (85 * Math.PI) / 180;
    const swingSign: 1 | -1 = p.swingCount % 2 === 1 ? 1 : -1;
    const slashColor = bloodLv > 0 || (p.relics.rift_cleave ?? 0) > 0 ? '#fbbf24' : '#f8fafc';
    const slashEffect: SlashEffect = {
      x: p.x,
      y: p.y,
      angle,
      radius: ATTACK_RANGE,
      arc: cleaveArc,
      ttl: ATTACK_ANIM_DURATION,
      maxTtl: ATTACK_ANIM_DURATION,
      color: slashColor,
      heavy: false,
      sign: swingSign,
      hitCount: 0,
    };
    s.slashes.push(slashEffect);

    for (let i = 0; i < 4; i += 1) {
      const frac = i / 3 - 0.5;
      const pAng = angle + swingSign * frac * cleaveArc * 0.85;
      const pDist = ATTACK_RANGE * 0.72;
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
    let chainedArc = false;
    const arcLv = p.relics.arc_conduit ?? 0;
    const goldenLv = p.relics.golden_cleave ?? 0;

    for (const enemy of [...s.enemies]) {
      if (enemy.spawnShieldTimer > 0) continue;
      const dx = enemy.x - p.x;
      const dy = enemy.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ATTACK_RANGE + enemy.radius) {
        const ea = Math.atan2(dy, dx);
        const inFrontCone = Math.abs(normalizeAngle(ea - angle)) <= cleaveArc / 2;
        const inCloseCleave = dist <= 34 + enemy.radius;
        if (inFrontCone || inCloseCleave) {
          hitCount += 1;
          if (enemy.archetype !== 'boss') {
            enemy.state = 'staggered';
            enemy.stateTimer = Math.max(enemy.stateTimer, 0.28);
          }
          const dirX = dist > 0 ? dx / dist : Math.cos(angle);
          const dirY = dist > 0 ? dy / dist : Math.sin(angle);
          const killed = this.damageEnemy(
            enemy,
            swingDmg,
            dirX * 360,
            dirY * 360,
            true,
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
          if (arcLv > 0 && !chainedArc) {
            chainedArc = true;
            this.triggerArcConduit(enemy, arcLv);
          }
          if (killed) {
            killCount += 1;
            if (bloodLv > 0) {
              p.attackCooldown = 0;
              p.attackEndlagTimer = 0;
              this.addFloatingText(p.x, p.y - 26, 'RESET!', '#f87171', 1.05);
            }
          } else if (goldenLv > 0 && enemy.goldenBurstCount < 2) {
            enemy.goldenBurstCount += 1;
            this.spawnCoins(enemy.x, enemy.y, 2 * goldenLv, true);
          }
          if (killed && goldenLv > 0) {
            this.spawnCoins(enemy.x, enemy.y, 2 * goldenLv, true);
          }
        }
      }
    }

    slashEffect.hitCount = hitCount;

    for (const br of [...s.breakables]) {
      const dx = br.x - p.x;
      const dy = br.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ATTACK_RANGE + br.radius) {
        const ea = Math.atan2(dy, dx);
        if (Math.abs(normalizeAngle(ea - angle)) <= cleaveArc / 2 || dist <= 36 + br.radius) {
          this.damageBreakable(br, swingDmg);
        }
      }
    }

    for (const haz of s.hazards) {
      if (haz.type === 'barrels' && !haz.destroyed) {
        const dx = haz.x - p.x;
        const dy = haz.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= ATTACK_RANGE + 20) {
          const ea = Math.atan2(dy, dx);
          if (Math.abs(normalizeAngle(ea - angle)) <= cleaveArc / 2 || dist <= 36) {
            this.triggerBarrelExplosion(haz);
          }
        }
      }
    }

    if (s.roomState === 'reward' && s.pedestals.length > 0) {
      let bestPed: PedestalEntity | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const ped of s.pedestals) {
        const dx = ped.x - p.x;
        const dy = ped.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= ATTACK_RANGE + 24) {
          const ea = Math.atan2(dy, dx);
          const angleDiff = Math.abs(normalizeAngle(ea - angle));
          if (angleDiff <= cleaveArc / 2 || dist <= 44) {
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

    const prevMeleeHits = p.meleeHitCount;
    if (hitCount > 0) {
      p.meleeHitCount += hitCount;
    }
    const nextMeleeHits = p.meleeHitCount;
    // Cross-threshold check so multi-target cleaves jumping across N (e.g. 2 -> 4) still proc 3rd-hit relics.
    const triggeredThirdHit =
      hitCount > 0 && Math.floor(nextMeleeHits / 3) > Math.floor(prevMeleeHits / 3);
    const triggeredSecondHit =
      hitCount > 0 && Math.floor(nextMeleeHits / 2) > Math.floor(prevMeleeHits / 2);

    if (hitCount > 0) {
      s.hitstopTimer = Math.max(s.hitstopTimer, 0.03);
      s.shakeIntensity = Math.max(s.shakeIntensity, 5.2);
      const quakeLv = p.relics.shatter_quake ?? 0;
      if (quakeLv > 0) {
        const quakeMult = 0.65 + 0.1 * (quakeLv - 1);
        s.delayedBlasts.push({
          kind: 'shatter_quake',
          x: p.x + Math.cos(angle) * 56,
          y: p.y + Math.sin(angle) * 56,
          radius: 105,
          timer: 0.45,
          maxTimer: 0.45,
          damage: swingDmg * quakeMult,
          friendly: true,
        });
      }
    }

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
        if (d <= ATTACK_RANGE + 22) {
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
        x: p.x + Math.cos(angle) * 46,
        y: p.y + Math.sin(angle) * 46,
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
      .filter((e) => e.id !== sourceEnemy.id && e.spawnShieldTimer <= 0)
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
      if (enemy.spawnShieldTimer > 0) continue;
      if (Math.hypot(enemy.x - x, enemy.y - y) <= radius + enemy.radius) {
        if (enemy.archetype !== 'boss') {
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
    this.state.delayedBlasts.push({
      kind: 'barrel_blast',
      x: haz.x,
      y: haz.y,
      radius: 105,
      timer: 0.12,
      maxTimer: 0.12,
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

      const color = blast.friendly ? '#fb923c' : '#ef4444';
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
      s.shakeIntensity = Math.max(s.shakeIntensity, 5);

      if (blast.friendly) {
        const armorBreak = blast.kind === 'shatter_quake';
        for (const enemy of [...s.enemies]) {
          if (enemy.spawnShieldTimer > 0) continue;
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
          this.damagePlayer(blast.friendly ? 14 : blast.damage * s.modifier.enemyDamageMult);
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
          if (enemy.spawnShieldTimer > 0) continue;
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

        const hitWall =
          enemy.x - enemy.radius < PLAY_MIN_X ||
          enemy.x + enemy.radius > PLAY_MAX_X ||
          enemy.y - enemy.radius < PLAY_MIN_Y ||
          enemy.y + enemy.radius > PLAY_MAX_Y;

        if (hitWall && kbSpeed > 340) {
          this.clampToArena(enemy);
          enemy.vx *= -0.25;
          enemy.vy *= -0.25;
          if (enemy.archetype !== 'boss') {
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
        this.clampToArena(enemy);
        continue;
      }

      if (enemy.state === 'staggered') {
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = 'chase';
          enemy.stateTimer = 0.45;
        }
        this.clampToArena(enemy);
        continue;
      }

      const dx = p.x - enemy.x;
      const dy = p.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      const dirX = dist > 0 ? dx / dist : 0;
      const dirY = dist > 0 ? dy / dist : 1;

      if (enemy.archetype === 'chaser') {
        this.stepChaserAI(enemy, dist, dirX, dirY, dt);
      } else if (enemy.archetype === 'shooter') {
        this.stepShooterAI(enemy, dist, dirX, dirY, dt);
      } else if (enemy.archetype === 'charger' || enemy.archetype === 'elite_charger') {
        this.stepChargerAI(enemy, dist, dirX, dirY, dt);
      } else {
        this.stepBossAI(enemy, dirX, dirY, dt);
      }

      this.clampToArena(enemy);
    }

    for (let i = 0; i < s.enemies.length; i += 1) {
      const a = s.enemies[i];
      if (!a) continue;
      for (let j = i + 1; j < s.enemies.length; j += 1) {
        const b = s.enemies[j];
        if (!b) continue;
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
    dirX: number,
    dirY: number,
    dt: number,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.x += dirX * enemy.speed * dt;
      enemy.y += dirY * enemy.speed * dt;
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (dist <= 68) {
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
    dt: number,
  ): void {
    const s = this.state;
    if (enemy.state === 'chase') {
      enemy.stateTimer -= dt;
      if (dist > 315) {
        enemy.x += dirX * enemy.speed * dt;
        enemy.y += dirY * enemy.speed * dt;
      } else if (dist < 185) {
        enemy.x -= dirX * enemy.speed * 0.9 * dt;
        enemy.y -= dirY * enemy.speed * 0.9 * dt;
      } else {
        enemy.x += -dirY * enemy.speed * 0.55 * dt;
        enemy.y += dirX * enemy.speed * 0.55 * dt;
      }
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 460) {
        enemy.state = 'telegraph';
        enemy.attackKind = 'shoot';
        enemy.telegraphDuration = 0.6;
        enemy.stateTimer = 0.6;
        enemy.telegraphLocked = false;
      }
    } else if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer > 0.15) {
        enemy.aimAngle = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
      } else {
        enemy.telegraphLocked = true;
      }
      if (enemy.stateTimer <= 0) {
        const spread = s.roomIndex >= 4 ? [-0.14, 0.14] : [0];
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
        enemy.stateTimer = 0.95;
        enemy.attackKind = 'none';
      }
    } else if (enemy.state === 'recover') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
        enemy.stateTimer = 0.75;
      }
    }
  }

  private stepChargerAI(
    enemy: EnemyEntity,
    dist: number,
    dirX: number,
    dirY: number,
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
      enemy.x += dirX * enemy.speed * dt;
      enemy.y += dirY * enemy.speed * dt;
      enemy.aimAngle = Math.atan2(dirY, dirX);
      if (enemy.stateTimer <= 0 && dist <= 320) {
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

      const hitWall =
        enemy.x - enemy.radius <= PLAY_MIN_X + 2 ||
        enemy.x + enemy.radius >= PLAY_MAX_X - 2 ||
        enemy.y - enemy.radius <= PLAY_MIN_Y + 2 ||
        enemy.y + enemy.radius >= PLAY_MAX_Y - 2;

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

  private stepBossAI(
    boss: EnemyEntity,
    dirX: number,
    dirY: number,
    dt: number,
  ): void {
    const s = this.state;

    if (boss.phase === 1 && boss.hp <= boss.maxHp * 0.5) {
      boss.phase = 2;
      boss.state = 'recover';
      boss.stateTimer = 0.7;
      boss.attackKind = 'none';
      this.announce('Phase 2 · Threadkeeper Overclocked!');
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

    if (boss.state === 'chase') {
      boss.x += dirX * boss.speed * dt;
      boss.y += dirY * boss.speed * dt;
      boss.stateTimer -= dt;
      if (boss.stateTimer <= 0) {
        const pattern = chooseBossPattern(boss, this.bossRng);
        boss.state = 'telegraph';
        boss.attackKind = pattern;
        boss.telegraphDuration = pattern === 'boss_radial' ? 0.6 : 0.72;
        boss.stateTimer = boss.telegraphDuration;
        boss.aimAngle = Math.atan2(dirY, dirX);
        boss.targetX = Math.max(PLAY_MIN_X + 64, Math.min(PLAY_MAX_X - 64, s.player.x));
        boss.targetY = Math.max(PLAY_MIN_Y + 64, Math.min(PLAY_MAX_Y - 64, s.player.y));
      }
    } else if (boss.state === 'telegraph') {
      boss.stateTimer -= dt;
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
          boss.x = boss.targetX;
          boss.y = boss.targetY;
          s.shakeIntensity = Math.max(s.shakeIntensity, 7);
          this.spawnParticles(boss.x, boss.y, '#ef4444', 14, 190);
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
      }
    } else if (boss.state === 'recover') {
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

      let consumed = false;
      if (proj.friendly) {
        for (const enemy of [...s.enemies]) {
          if (enemy.spawnShieldTimer > 0 || proj.hitEnemyIds.includes(enemy.id)) continue;
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
          enemy.state = 'staggered';
          enemy.stateTimer = 1.2;
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

      const coinCount = Math.max(1, Math.round(enemy.coinDrop * s.modifier.coinDropMult));
      this.spawnCoins(enemy.x, enemy.y, coinCount, false);

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

  private damageBreakable(br: BreakableEntity, amount: number): void {
    const s = this.state;
    br.hp -= amount;
    br.hitFlash = 0.1;
    this.spawnParticles(br.x, br.y, '#cbd5e1', 4, 90);
    if (br.hp <= 0) {
      const idx = s.breakables.indexOf(br);
      if (idx !== -1) s.breakables.splice(idx, 1);
      this.spawnCoins(br.x, br.y, 2, false);
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
    for (let i = 0; i < count; i += 1) {
      const ang = this.fxRng.range(0, Math.PI * 2);
      const spd = this.fxRng.range(60, 150);
      this.state.coins.push({
        id: this.nextEntityId++,
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        value: 1,
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

    if (s.roomType !== 'endless') {
      const mem = this.roomMemory.get(s.currentRoomId);
      if (mem) {
        mem.cleared = true;
      } else {
        this.roomMemory.set(s.currentRoomId, {
          visited: true,
          cleared: true,
          rewardClaimed: false,
          fountainUsed: false,
        });
      }
      this.refreshMapView();
    }

    const fullClearAfterBoss =
      s.roomType !== 'endless' &&
      s.progressPct === 100 &&
      s.stats.bossDefeated &&
      s.rewardType !== 'boss_chest_and_portals';

    if (s.rewardType === 'coin_cache') {
      this.spawnCoins(ARENA_W / 2, ARENA_H / 2 - 16, 18, true);
      if (fullClearAfterBoss) {
        s.portals = [
          { kind: 'extract', x: ARENA_W / 2 - 116, y: 330, label: 'EXTRACT · LOCK RUN', progress: 0 },
          { kind: 'endless', x: ARENA_W / 2 + 116, y: 330, label: 'PUSH ENDLESS', progress: 0 },
        ];
        s.roomState = 'door_open';
        this.announce('100% Cleared! Extract or Push Endless');
        return;
      }
      s.roomState = 'door_open';
      this.announce('Coin Cache! Doors Open');
      return;
    }

    if (s.rewardType === 'boss_chest_and_portals') {
      s.stats.bossDefeated = true;
      this.spawnCoins(ARENA_W / 2, ARENA_H / 2 - 16, 32, true);
      s.portals = [
        { kind: 'extract', x: ARENA_W / 2 - 116, y: 235, label: 'EXTRACT · LOCK RUN', progress: 0 },
        { kind: 'endless', x: ARENA_W / 2 + 116, y: 235, label: 'PUSH ENDLESS', progress: 0 },
      ];
      s.roomState = 'boss_choice';
      this.announce(
        s.progressPct === 100
          ? '100% Cleared! Extract or Push Endless'
          : 'Boss Defeated! Extract, Explore, or Endless',
      );
      return;
    }

    if (s.rewardType === 'fountain_and_relics') {
      s.fountain = {
        x: ARENA_W / 2,
        y: 325,
        used: false,
        healAmount: Math.round(s.player.maxHp * 0.35),
      };
    }

    if (s.rewardType === 'endless_relics_and_portals') {
      s.portals = [
        { kind: 'extract', x: ARENA_W / 2 - 150, y: 325, label: 'EXTRACT NOW', progress: 0 },
      ];
    } else if (fullClearAfterBoss) {
      s.portals = [
        { kind: 'extract', x: ARENA_W / 2 - 116, y: 330, label: 'EXTRACT · LOCK RUN', progress: 0 },
        { kind: 'endless', x: ARENA_W / 2 + 116, y: 330, label: 'PUSH ENDLESS', progress: 0 },
      ];
    }

    const filter = s.rewardType === 'synergy_relics' ? 'synergy' : undefined;
    const drafted = draftRelics(this.relicRng, this.profile.unlockedRelics, 3, filter);
    const xs = [ARENA_W / 2 - 148, ARENA_W / 2, ARENA_W / 2 + 148];
    const py = s.rewardType === 'fountain_and_relics' ? 205 : 235;

    s.pedestals = drafted.map((relic, idx) => ({
      id: this.nextEntityId++,
      x: xs[idx] ?? ARENA_W / 2,
      y: py,
      relic,
      nextLevel: (s.player.relics[relic.id] ?? 0) + 1,
      claimProgress: 0,
      hovered: false,
    }));

    s.roomState = s.pedestals.length > 0 ? 'reward' : 'door_open';
    this.announce(
      fullClearAfterBoss
        ? '100% Cleared! Extract or Push Endless'
        : s.rewardType === 'fountain_and_relics'
          ? 'Drink Fountain & Attack a Relic!'
          : 'Room Cleared! Attack a Relic to Claim',
    );
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
          if (portal.kind === 'extract') {
            this.finishRun(true);
            return;
          }
          const nextEndless =
            s.roomType === 'endless' ? s.roomIndex + 1 : s.totalRooms + 1;
          this.enterEndlessRoom(nextEndless, 'portal');
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
            ? Math.abs(p.x - ARENA_W / 2) <= 44 && p.y - p.radius <= PLAY_MIN_Y + 10
            : door.dir === 'south'
              ? Math.abs(p.x - ARENA_W / 2) <= 44 && p.y + p.radius >= PLAY_MAX_Y - 10
              : door.dir === 'west'
                ? Math.abs(p.y - ARENA_H / 2) <= 44 && p.x - p.radius <= PLAY_MIN_X + 10
                : Math.abs(p.y - ARENA_H / 2) <= 44 && p.x + p.radius >= PLAY_MAX_X - 10;
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
      `${claimed.relic.emoji} ${claimed.relic.name} Lv ${claimed.nextLevel}`,
      '#fde047',
      1.15,
    );
    s.pedestals = [];
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

    s.floatingTexts = s.floatingTexts.filter((ft) => {
      ft.ttl -= dt;
      ft.y += ft.vy * dt;
      return ft.ttl > 0;
    });
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

function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
