export type Vec2 = {
  x: number;
  y: number;
};

export type InputFrame = {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  hasPointerAim: boolean;
  actionDown: boolean;
  actionJustPressed: boolean;
  actionJustReleased: boolean;
};

export type DailyModifierId =
  | 'glass_cannon'
  | 'slippery_floors'
  | 'heavy_blade'
  | 'volatile_foes'
  | 'quick_blades'
  | 'golden_fever';

export type DailyModifier = {
  id: DailyModifierId;
  banner: string;
  description: string;
  playerDamageMult: number;
  enemyDamageMult: number;
  frictionMult: number;
  attackCdMult: number;
  attackDamageMult: number;
  enemySpeedMult: number;
  enemyHpMult: number;
  coinDropMult: number;
  deathBlast: boolean;
};

export type HazardType = 'spikes' | 'barrels' | 'currents';

export type RelicId =
  | 'ember_wake'
  | 'arc_conduit'
  | 'blood_reset'
  | 'decoy_mine'
  | 'rift_cleave'
  | 'vortex_slam'
  | 'mirror_guard'
  | 'reaper_siphon'
  | 'volt_nova'
  | 'shatter_quake'
  | 'phantom_echo'
  | 'golden_cleave';

export type RelicCategory = 'blade' | 'arcane';

export type RelicDef = {
  id: RelicId;
  name: string;
  category: RelicCategory;
  emoji: string;
  shortTag: string;
  starter: boolean;
  synergyImpact: boolean;
  summary: (nextLevel: number) => string;
};

export type ActiveRelicMap = Partial<Record<RelicId, number>>;

export type UpgradeId = 'vitality' | 'reroll' | 'magnet' | 'shield';

export type CosmeticId =
  | 'none'
  | 'neon_trail'
  | 'crown_crest'
  | 'snoo_antenna'
  | 'flame_halo';

export type ConsumableId = 'bonus_relic' | 'shield_tonic' | 'fury_charm';

export type ShopSlotKind = 'upgrade' | 'relic' | 'consumable' | 'cosmetic';

export type ShopSlot = {
  slotIndex: 0 | 1 | 2;
  kind: ShopSlotKind;
  itemId: string;
  title: string;
  subtitle: string;
  description: string;
  cost: number;
  purchased: boolean;
  maxed: boolean;
  levelLabel?: string | undefined;
};

export type ShopRotation = [ShopSlot, ShopSlot, ShopSlot];

export type DailyBestRecord = {
  utcDate: string;
  highestRoom: number;
  bestProgressPct?: number | undefined;
  bestClearTimeSec: number | null;
  bestScore: number;
  extracted: boolean;
  summary?: RunSummary | undefined;
};

export type PlayerProfile = {
  coins: number;
  upgrades: Record<UpgradeId, number>;
  unlockedRelics: RelicId[];
  ownedCosmetics: CosmeticId[];
  equippedCosmetic: CosmeticId;
  pendingConsumable: ConsumableId | null;
  streak: number;
  lastPlayedDate: string | null;
  totalRuns: number;
  totalClears: number;
  subscribed: boolean;
  dailyBest: Record<string, DailyBestRecord>;
};

export type RunSummary = {
  utcDate: string;
  outcome: 'extracted' | 'defeated';
  bossDefeated: boolean;
  roomReached: number;
  progressPct?: number | undefined;
  totalRooms?: number | undefined;
  elapsedSec: number;
  coinsEarned: number;
  damageTaken: number;
  enemiesKilled: number;
  relics: ActiveRelicMap;
  score: number;
};

export type DailyLeaderboardEntry = {
  player: string;
  roomReached: number;
  progressPct?: number | undefined;
  elapsedSec: number;
  extracted: boolean;
  score: number;
};

export type DoorDirection = 'north' | 'south' | 'east' | 'west';

export type EnemyArchetype = 'chaser' | 'shooter' | 'charger' | 'elite_charger' | 'boss';

export type RoomType = 'warmup' | 'escalation' | 'elite' | 'gauntlet' | 'boss' | 'endless';
