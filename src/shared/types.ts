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

export type DailyRuleId =
  | 'open_armory'
  | 'melee_only'
  | 'ranged_only'
  | 'trial_dagger'
  | 'trial_hammer'
  | 'trial_scatter'
  | 'trial_lance'
  | 'starter_relic'
  | 'crate_bonanza';

export type DailyRuleWeaponMode = 'any' | 'melee_only' | 'ranged_only' | 'locked';

export type DailyRule = {
  id: DailyRuleId;
  label: string;
  description: string;
  weaponMode: DailyRuleWeaponMode;
  forcedWeapon?: WeaponId | undefined;
  grantStarterRelic?: boolean | undefined;
  extraCrates?: number | undefined;
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
  | 'golden_cleave'
  | 'concussion';

export type RelicCategory = 'blade' | 'arcane';

export type RelicDef = {
  id: RelicId;
  name: string;
  category: RelicCategory;
  emoji: string;
  shortTag: string;
  starter: boolean;
  synergyImpact: boolean;
  /** Draft weight; 1 for normal relics, tiny for very rare ones. */
  draftWeight?: number | undefined;
  summary: (nextLevel: number) => string;
};

export type ActiveRelicMap = Partial<Record<RelicId, number>>;

export type WeaponId = 'longsword' | 'dagger' | 'hammer' | 'scatter_staff' | 'arcane_lance';

export type AccessoryId =
  | 'neon_trail'
  | 'crown_crest'
  | 'snoo_antenna'
  | 'flame_halo'
  | 'angel_halo'
  | 'bunny_ears'
  | 'wizard_hat'
  | 'cat_ears'
  | 'devil_horns'
  | 'frog_hat';

export type CostumeId =
  | 'costume_crimson'
  | 'costume_forest'
  | 'costume_viking'
  | 'costume_royal'
  | 'costume_shadow'
  | 'costume_yeti'
  | 'costume_gold'
  | 'costume_skeleton'
  | 'costume_phantom';

export type CosmeticId = 'none' | AccessoryId | CostumeId;

export type CosmeticSlot = 'accessory' | 'costume';

export type CosmeticRarity = 'common' | 'rare' | 'epic';

export type DailyBestRecord = {
  utcDate: string;
  highestRoom: number;
  bestFloor?: number | undefined;
  bestProgressPct?: number | undefined;
  bestClearTimeSec: number | null;
  bestScore: number;
  extracted: boolean;
  summary?: RunSummary | undefined;
};

export type PlayerProfile = {
  coins: number;
  gems: number;
  ownedWeapons: WeaponId[];
  equippedWeapon: WeaponId;
  unlockedRelics: RelicId[];
  ownedCosmetics: CosmeticId[];
  /** Equipped accessory (or 'none'). */
  equippedCosmetic: CosmeticId;
  /** Equipped costume colour (or 'none'). */
  equippedCostume: CosmeticId;
  streak: number;
  lastPlayedDate: string | null;
  totalRuns: number;
  totalClears: number;
  /** Deepest floor ever reached, across all days. */
  bestFloor: number;
  tutorialDismissed: boolean;
  subscribed: boolean;
  dailyBest: Record<string, DailyBestRecord>;
};

export type RunSummary = {
  utcDate: string;
  outcome: 'extracted' | 'defeated';
  bossDefeated: boolean;
  /** Floor the run ended on (1-based). */
  floorReached: number;
  /** Total rooms cleared across every floor this run. */
  roomsCleared: number;
  /** Bosses beaten this run (= floors fully completed). */
  floorsCleared: number;
  roomReached: number;
  progressPct?: number | undefined;
  totalRooms?: number | undefined;
  elapsedSec: number;
  coinsEarned: number;
  gemsEarned: number;
  damageTaken: number;
  enemiesKilled: number;
  weapon: WeaponId;
  relics: ActiveRelicMap;
  score: number;
};

export type DailyLeaderboardEntry = {
  player: string;
  floorReached: number;
  roomsCleared: number;
  roomReached: number;
  progressPct?: number | undefined;
  elapsedSec: number;
  extracted: boolean;
  score: number;
};

export type DoorDirection = 'north' | 'south' | 'east' | 'west';

export type BiomeId =
  | 'dungeon'
  | 'snow'
  | 'town'
  | 'battle'
  | 'farm'
  | 'candy'
  | 'neon'
  | 'space'
  | 'reef'
  | 'haunted'
  | 'sky';

export type EnemyArchetype =
  | 'chaser'
  | 'shooter'
  | 'charger'
  | 'elite_charger'
  | 'boss'
  | 'shade'
  | 'yeti'
  | 'bomber'
  | 'mortar_tank'
  | 'stampede';

export type RoomType = 'warmup' | 'escalation' | 'elite' | 'gauntlet' | 'boss' | 'endless';
