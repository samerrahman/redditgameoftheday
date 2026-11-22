import { createDailyStream } from '../../shared/rng.ts';
import type { EnemyArchetype, HazardType, RelicId, RoomType } from '../../shared/types.ts';

export const GAME_META = {
  title: 'DUNGEONLE',
  tagline: 'Daily dungeon crawl. One seed. Everyone fights the same floor.',
  coinName: 'Karma Coins',
  coinShort: 'KC',
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
};

export const DUNGEON_THEMES: readonly DungeonTheme[] = [
  {
    id: 'archives',
    name: 'The Archives',
    subtitle: 'Slate vault of forgotten threads',
    floorBg: '#141923',
    floorTileAlt: '#181f2c',
    floorGrid: '#20293a',
    wallFill: '#0c1017',
    wallStroke: '#2d3a52',
    playerFill: '#38bdf8',
    playerAccent: '#fb923c',
    playerOutline: '#090d14',
    telegraphFill: 'rgba(239, 68, 68, 0.25)',
    telegraphStroke: '#ef4444',
    projectileFill: '#f97316',
    projectileCore: '#fef08a',
    coinFill: '#fbbf24',
    hazardAccent: '#f43f5e',
    textPrimary: '#f1f5f9',
    textMuted: '#94a3b8',
    floorTint: 0xd8d0c8,
    wallTint: 0xdfe6f2,
    ambientBg: 0x1e181f,
    torchGlowColor: 0xfb923c,
  },
  {
    id: 'deep_thread',
    name: 'The Deep Thread',
    subtitle: 'Indigo cavern of buried replies',
    floorBg: '#161524',
    floorTileAlt: '#1b1a2d',
    floorGrid: '#26243d',
    wallFill: '#0d0c17',
    wallStroke: '#3b375e',
    playerFill: '#22d3ee',
    playerAccent: '#f97316',
    playerOutline: '#090910',
    telegraphFill: 'rgba(244, 63, 94, 0.26)',
    telegraphStroke: '#fb7185',
    projectileFill: '#fb7185',
    projectileCore: '#fff1f2',
    coinFill: '#facc15',
    hazardAccent: '#e879f9',
    textPrimary: '#f8fafc',
    textMuted: '#a5b4fc',
    floorTint: 0xc2c8e8,
    wallTint: 0xd0d6ff,
    ambientBg: 0x181526,
    torchGlowColor: 0x38bdf8,
  },
  {
    id: 'meme_vault',
    name: 'The Meme Vault',
    subtitle: 'Mossy chambers of viral relics',
    floorBg: '#131d1b',
    floorTileAlt: '#182421',
    floorGrid: '#22332f',
    wallFill: '#0b1210',
    wallStroke: '#314c45',
    playerFill: '#60a5fa',
    playerAccent: '#fbbf24',
    playerOutline: '#070d0b',
    telegraphFill: 'rgba(239, 68, 68, 0.27)',
    telegraphStroke: '#f87171',
    projectileFill: '#fb923c',
    projectileCore: '#fef9c3',
    coinFill: '#fbbf24',
    hazardAccent: '#f59e0b',
    textPrimary: '#f1f5f9',
    textMuted: '#99b8b0',
    floorTint: 0xc8decb,
    wallTint: 0xd6eadc,
    ambientBg: 0x151e1b,
    torchGlowColor: 0xfbbf24,
  },
  {
    id: 'front_page',
    name: 'The Front Page',
    subtitle: 'Obsidian hall of rising heat',
    floorBg: '#1c1619',
    floorTileAlt: '#231b1f',
    floorGrid: '#33262c',
    wallFill: '#110c0f',
    wallStroke: '#4d3640',
    playerFill: '#34d399',
    playerAccent: '#fb923c',
    playerOutline: '#0b0809',
    telegraphFill: 'rgba(248, 113, 113, 0.26)',
    telegraphStroke: '#ef4444',
    projectileFill: '#f43f5e',
    projectileCore: '#fef08a',
    coinFill: '#fbbf24',
    hazardAccent: '#fb7185',
    textPrimary: '#f8fafc',
    textMuted: '#cbd5e1',
    floorTint: 0xe6cbb8,
    wallTint: 0xf0dcd0,
    ambientBg: 0x241618,
    torchGlowColor: 0xf97316,
  },
  {
    id: 'mod_queue',
    name: 'The Mod Queue',
    subtitle: 'Steel bastion of locked gates',
    floorBg: '#17191e',
    floorTileAlt: '#1d2027',
    floorGrid: '#292e38',
    wallFill: '#0e1014',
    wallStroke: '#41495a',
    playerFill: '#38bdf8',
    playerAccent: '#f43f5e',
    playerOutline: '#08090c',
    telegraphFill: 'rgba(239, 68, 68, 0.27)',
    telegraphStroke: '#ef4444',
    projectileFill: '#fb923c',
    projectileCore: '#ffffff',
    coinFill: '#fbbf24',
    hazardAccent: '#38bdf8',
    textPrimary: '#f8fafc',
    textMuted: '#9ca3af',
    floorTint: 0xcbd5e1,
    wallTint: 0xe2e8f0,
    ambientBg: 0x161922,
    torchGlowColor: 0xfbbf24,
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
