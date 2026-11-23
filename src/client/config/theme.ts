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

export const DUNGEON_THEMES: readonly DungeonTheme[] = [
  {
    id: 'archives',
    name: 'The Archives',
    subtitle: 'Obsidian vault of forgotten threads',
    floorBg: '#120d1c',
    floorTileAlt: '#1b1428',
    floorGrid: '#271e38',
    wallFill: '#0b0812',
    wallStroke: '#3c2e54',
    playerFill: '#38bdf8',
    playerAccent: '#fb923c',
    playerOutline: '#1c1221',
    telegraphFill: 'rgba(232, 64, 58, 0.28)',
    telegraphStroke: '#ef4444',
    projectileFill: '#fb923c',
    projectileCore: '#fef08a',
    coinFill: '#f5c234',
    hazardAccent: '#f43f5e',
    textPrimary: '#fff7e8',
    textMuted: '#c4b8d6',
    floorTint: 0xf4f0ff,
    wallTint: 0xf6f2ff,
    ambientBg: 0x100b18,
    torchGlowColor: 0xfb923c,
    shaderAmbient: [0.74, 0.7, 0.84],
    shaderVignette: [0.05, 0.03, 0.1],
  },
  {
    id: 'deep_thread',
    name: 'The Deep Thread',
    subtitle: 'Indigo cavern of buried replies',
    floorBg: '#111022',
    floorTileAlt: '#191730',
    floorGrid: '#282448',
    wallFill: '#0a0915',
    wallStroke: '#41396c',
    playerFill: '#22d3ee',
    playerAccent: '#fb923c',
    playerOutline: '#1c1221',
    telegraphFill: 'rgba(244, 63, 94, 0.28)',
    telegraphStroke: '#fb7185',
    projectileFill: '#fb7185',
    projectileCore: '#fff1f2',
    coinFill: '#facc15',
    hazardAccent: '#e879f9',
    textPrimary: '#f8fafc',
    textMuted: '#a5b4fc',
    floorTint: 0xe2e8ff,
    wallTint: 0xe6ecff,
    ambientBg: 0x0e0d1d,
    torchGlowColor: 0x38bdf8,
    shaderAmbient: [0.68, 0.72, 0.88],
    shaderVignette: [0.04, 0.04, 0.12],
  },
  {
    id: 'meme_vault',
    name: 'The Meme Vault',
    subtitle: 'Veridian chambers of viral relics',
    floorBg: '#0f1a18',
    floorTileAlt: '#162421',
    floorGrid: '#223833',
    wallFill: '#09110f',
    wallStroke: '#315249',
    playerFill: '#60a5fa',
    playerAccent: '#f5c234',
    playerOutline: '#1c1221',
    telegraphFill: 'rgba(232, 64, 58, 0.28)',
    telegraphStroke: '#f87171',
    projectileFill: '#fb923c',
    projectileCore: '#fef9c3',
    coinFill: '#f5c234',
    hazardAccent: '#f59e0b',
    textPrimary: '#f1f5f9',
    textMuted: '#9ec4b8',
    floorTint: 0xe4f5ea,
    wallTint: 0xe8f5ec,
    ambientBg: 0x0e1815,
    torchGlowColor: 0xfbbf24,
    shaderAmbient: [0.68, 0.8, 0.76],
    shaderVignette: [0.03, 0.09, 0.07],
  },
  {
    id: 'front_page',
    name: 'The Front Page',
    subtitle: 'Basalt forge of rising heat',
    floorBg: '#191016',
    floorTileAlt: '#24161e',
    floorGrid: '#38222d',
    wallFill: '#100a0e',
    wallStroke: '#573642',
    playerFill: '#34d399',
    playerAccent: '#fb923c',
    playerOutline: '#1c1221',
    telegraphFill: 'rgba(248, 113, 113, 0.28)',
    telegraphStroke: '#ef4444',
    projectileFill: '#f43f5e',
    projectileCore: '#fef08a',
    coinFill: '#f5c234',
    hazardAccent: '#fb7185',
    textPrimary: '#fff7e8',
    textMuted: '#d6c4cc',
    floorTint: 0xffeae0,
    wallTint: 0xfff0e8,
    ambientBg: 0x180e13,
    torchGlowColor: 0xf97316,
    shaderAmbient: [0.78, 0.68, 0.72],
    shaderVignette: [0.12, 0.03, 0.05],
  },
  {
    id: 'mod_queue',
    name: 'The Mod Queue',
    subtitle: 'Steel bastion of locked gates',
    floorBg: '#131620',
    floorTileAlt: '#1b202d',
    floorGrid: '#283042',
    wallFill: '#0b0d14',
    wallStroke: '#3f4961',
    playerFill: '#38bdf8',
    playerAccent: '#f43f5e',
    playerOutline: '#1c1221',
    telegraphFill: 'rgba(232, 64, 58, 0.28)',
    telegraphStroke: '#ef4444',
    projectileFill: '#fb923c',
    projectileCore: '#ffffff',
    coinFill: '#f5c234',
    hazardAccent: '#38bdf8',
    textPrimary: '#f8fafc',
    textMuted: '#a6b2c8',
    floorTint: 0xeaf0f8,
    wallTint: 0xf0f4fa,
    ambientBg: 0x111520,
    torchGlowColor: 0xfbbf24,
    shaderAmbient: [0.72, 0.76, 0.84],
    shaderVignette: [0.05, 0.07, 0.12],
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
  ember_wake: 'tile_115',
  arc_conduit: 'tile_130',
  blood_reset: 'tile_103',
  decoy_mine: 'barrel_tnt',
  rift_cleave: 'tile_107',
  vortex_slam: 'tile_129',
  mirror_guard: 'tile_102',
  reaper_siphon: 'tile_114',
  volt_nova: 'tile_116',
  shatter_quake: 'tile_117',
  phantom_echo: 'tile_105',
  golden_cleave: 'tile_118',
  concussion: 'tile_119',
};

export const ENTITY_LABELS = {
  enemies: {
    chaser: 'Slime',
    shooter: 'Hex Mage',
    charger: 'Cyclops',
    elite_charger: 'Armored Warden',
    boss: 'Crimson King',
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
