import { createDailyStream } from '../../shared/rng.ts';
import type { EnemyArchetype, HazardType, RelicId, RoomType } from '../../shared/types.ts';

export const GAME_META = {
  title: 'DUNGEONLE',
  tagline: 'Daily dungeon crawl. One seed. Everyone fights the same floor.',
  coinName: 'Coins',
  coinShort: 'coins',
  subredditName: 'r/dungeonle',
} as const;

export type DungeonTheme = {
  id: string;
  name: string;
  subtitle: string;
  floorBg: string;
  floorTileAlt: string;
  floorGrid: string;
  wallFill: string;
  wallStroke: string;
  playerFill: string;
  playerAccent: string;
  playerOutline: string;
  telegraphFill: string;
  telegraphStroke: string;
  projectileFill: string;
  projectileCore: string;
  coinFill: string;
  hazardAccent: string;
  textPrimary: string;
  textMuted: string;
  floorTint: number;
  wallTint: number;
  ambientBg: number;
  torchGlowColor: number;
  shaderAmbient: [number, number, number];
  shaderVignette: [number, number, number];
};

const HEARTH_SLATE_BASE: Omit<DungeonTheme, 'id' | 'name' | 'subtitle'> = {
  floorBg: '#21232e',
  floorTileAlt: '#282b38',
  floorGrid: '#2e3240',
  wallFill: '#14131a',
  wallStroke: '#43495e',
  playerFill: '#45a2e5',
  playerAccent: '#e6a82e',
  playerOutline: '#14131a',
  telegraphFill: 'rgba(224, 79, 68, 0.16)',
  telegraphStroke: '#e04f44',
  projectileFill: '#f0853a',
  projectileCore: '#f7df86',
  coinFill: '#e6a82e',
  hazardAccent: '#9edbf7',
  textPrimary: '#f2efe4',
  textMuted: '#a9b6cc',
  floorTint: 0xffffff,
  wallTint: 0xffffff,
  ambientBg: 0x14131a,
  torchGlowColor: 0xf0853a,
  shaderAmbient: [0.97, 0.96, 0.98],
  shaderVignette: [0.078, 0.075, 0.102],
};

export const DUNGEON_THEMES: readonly DungeonTheme[] = [
  {
    id: 'archives',
    name: 'The Archives',
    subtitle: 'Slate vault of forgotten threads',
    ...HEARTH_SLATE_BASE,
  },
  {
    id: 'deep_thread',
    name: 'The Deep Thread',
    subtitle: 'Quiet cavern of buried replies',
    ...HEARTH_SLATE_BASE,
    shaderAmbient: [0.96, 0.97, 0.99],
  },
  {
    id: 'meme_vault',
    name: 'The Meme Vault',
    subtitle: 'Cellar chambers of viral relics',
    ...HEARTH_SLATE_BASE,
    shaderAmbient: [0.96, 0.98, 0.97],
  },
  {
    id: 'front_page',
    name: 'The Basalt Forge',
    subtitle: 'Hearthstone forge of rising heat',
    ...HEARTH_SLATE_BASE,
    shaderAmbient: [0.99, 0.96, 0.95],
  },
  {
    id: 'mod_queue',
    name: 'The Mod Queue',
    subtitle: 'Iron bastion of locked gates',
    ...HEARTH_SLATE_BASE,
    shaderAmbient: [0.97, 0.97, 0.99],
  },
];

export function getDailyTheme(utcDate: string): DungeonTheme {
  const rng = createDailyStream(utcDate, 'theme');
  return rng.pick(DUNGEON_THEMES);
}

export function hexNum(cssHex: string): number {
  const clean = cssHex.startsWith('#') ? cssHex.slice(1) : cssHex;
  const parsed = Number.parseInt(clean, 16);
  return Number.isNaN(parsed) ? 0xffffff : parsed;
}

export const RELIC_SPRITE_FRAMES: Record<RelicId, string> = {
  ember_wake: 'tile_068',
  arc_conduit: 'tile_069',
  blood_reset: 'tile_070',
  decoy_mine: 'tile_071',
  rift_cleave: 'tile_072',
  vortex_slam: 'tile_073',
  mirror_guard: 'tile_074',
  reaper_siphon: 'tile_075',
  volt_nova: 'tile_076',
  shatter_quake: 'tile_077',
  phantom_echo: 'tile_078',
  golden_cleave: 'tile_079',
  concussion: 'tile_080',
};

export const ENTITY_LABELS = {
  enemies: {
    chaser: 'Slime',
    shooter: 'Hex Mage',
    charger: 'Cyclops',
    elite_charger: 'Armored Warden',
    boss: 'Crimson King',
    shade: 'Crypt Shade',
    yeti: 'Frost Yeti',
    bomber: 'Alley Sapper',
    mortar_tank: 'Iron Tank',
    stampede: 'Stampede Bull',
    myconid: 'Spore Myconid',
    imp: 'Ember Imp',
    archer: 'Bone Archer',
  } satisfies Record<EnemyArchetype, string>,
  rooms: {
    warmup: 'Floor Entrance',
    escalation: 'Escalation Arena',
    elite: 'Elite Vault',
    gauntlet: 'Gauntlet Chamber',
    boss: 'Boss Sanctum',
    endless: 'Endless Overtime',
  } satisfies Record<RoomType, string>,
  hazards: {
    spikes: 'Spike Plates',
    barrels: 'Volatile Barrels',
    currents: 'Floor Currents',
  } satisfies Record<HazardType, string>,
} as const;
