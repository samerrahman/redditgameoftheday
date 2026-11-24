/**
 * Per-floor visual themes ("biomes"). Floor 1 is the dungeon; deeper floors cycle
 * through custom 1:1 outdoor biome tilemaps. Purely cosmetic: layouts and enemies
 * come from the simulation and are unaffected.
 *
 * Frame numbers index each sheet's `tilemap_packed.png` (16x16 tiles, row-major:
 * ski/town/farm are 12 columns wide, battle is 18).
 */

import { getBiomeIdForFloor } from '../../shared/game/rooms.ts';
import type { BiomeId } from '../../shared/types.ts';

export type BiomeSheet = 'ski' | 'town' | 'battle' | 'farm';

export type BiomeDecor = {
  sheet: BiomeSheet;
  /** One frame, or a vertical stack (top first) for 2-tile-tall props like trees. */
  frames: number[];
  weight: number;
};

export type FloorBiome = {
  id: BiomeId;
  name: string;
  /** null = use the dungeon atlas floor (the original look). */
  floor: { sheet: BiomeSheet; frames: number[]; accents?: number[] | undefined } | null;
  /** Optional patches of a second ground (dirt paths, tilled soil). */
  patches?: { sheet: BiomeSheet; frames: number[]; count: number } | undefined;
  floorTint: number;
  wallTint: number;
  ambientBg: number;
  decor: BiomeDecor[];
  /** How many props to scatter around the room edges. */
  decorCount: [number, number];
  /** Wall torches only make sense indoors / at night. */
  torches: boolean;
  /** Sprites for solid layout blocks; null = drawn stone blocks (dungeon). */
  blocks: { sheet: BiomeSheet; frames: number[] } | null;
};

export const BIOMES: readonly FloorBiome[] = [
  {
    id: 'dungeon',
    name: 'The Dungeon',
    floor: null,
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    ambientBg: 0x1e181f,
    decor: [],
    decorCount: [0, 0],
    torches: true,
    blocks: null,
  },
  {
    id: 'snow',
    name: 'Frozen Slopes',
    floor: { sheet: 'ski', frames: [0, 0, 0, 13, 16, 49, 52] },
    floorTint: 0xffffff,
    wallTint: 0xa9d6ff,
    ambientBg: 0x14305a,
    decor: [
      { sheet: 'ski', frames: [6, 18], weight: 4 }, // tall pine
      { sheet: 'ski', frames: [30], weight: 3 }, // small pine
      { sheet: 'ski', frames: [7, 19], weight: 1 }, // bare tree
      { sheet: 'ski', frames: [69], weight: 2 }, // snowman
      { sheet: 'ski', frames: [47], weight: 1 }, // stump
      { sheet: 'ski', frames: [8, 20], weight: 1 }, // red slalom flag
      { sheet: 'ski', frames: [9, 21], weight: 1 }, // blue slalom flag
    ],
    decorCount: [4, 6],
    torches: false,
    blocks: { sheet: 'ski', frames: [81] }, // glacier crags
  },
  {
    id: 'town',
    name: 'Old Town',
    floor: { sheet: 'town', frames: [109] },
    patches: { sheet: 'town', frames: [0, 1, 2], count: 3 },
    floorTint: 0xffffff,
    wallTint: 0xffc7a0,
    ambientBg: 0x2c1436,
    decor: [
      { sheet: 'town', frames: [4, 16], weight: 2 }, // green tree
      { sheet: 'town', frames: [3, 15], weight: 2 }, // autumn tree
      { sheet: 'town', frames: [5], weight: 2 }, // bush
      { sheet: 'town', frames: [83], weight: 1 }, // signpost
      { sheet: 'town', frames: [94], weight: 1 }, // beehive
    ],
    decorCount: [4, 6],
    torches: true,
    blocks: { sheet: 'town', frames: [106, 130, 107, 131] }, // logs, barrels, and pots
  },
  {
    id: 'battle',
    name: 'Battlefield',
    floor: { sheet: 'battle', frames: [0, 0, 0, 1] },
    patches: { sheet: 'town', frames: [25], count: 4 }, // churned-up mud
    floorTint: 0xd9e68a,
    wallTint: 0xe0cf8c,
    ambientBg: 0x22300f,
    decor: [
      { sheet: 'battle', frames: [94], weight: 3 }, // spruce
      { sheet: 'battle', frames: [112], weight: 2 }, // pine thicket
      { sheet: 'battle', frames: [16], weight: 2 }, // war flag
    ],
    decorCount: [4, 6],
    torches: false,
    blocks: { sheet: 'battle', frames: [25, 23, 5, 24] }, // barricades, tank traps, boulders, bunkers
  },
  {
    id: 'farm',
    name: 'Farmlands',
    floor: { sheet: 'battle', frames: [0, 0, 0, 1, 2] },
    patches: { sheet: 'farm', frames: [48, 49, 50, 60, 61, 62], count: 4 },
    floorTint: 0xffffff,
    wallTint: 0xffcf8f,
    ambientBg: 0x33200a,
    decor: [
      { sheet: 'farm', frames: [3, 15], weight: 2 }, // pine
      { sheet: 'farm', frames: [39], weight: 2 }, // bush
      { sheet: 'farm', frames: [83], weight: 1 }, // sunflower
      { sheet: 'farm', frames: [8], weight: 1 }, // carrot
      { sheet: 'farm', frames: [32], weight: 1 }, // corn
      { sheet: 'farm', frames: [44], weight: 1 }, // tomato
      { sheet: 'farm', frames: [56], weight: 1 }, // cabbage
      { sheet: 'farm', frames: [122], weight: 1 }, // chicken
      { sheet: 'farm', frames: [120], weight: 1 }, // sheep
    ],
    decorCount: [4, 6],
    torches: false,
    blocks: { sheet: 'farm', frames: [96, 97, 85] }, // all hay bales and cider barrels
  },
];

/** Floors cycle daily-shuffled biomes across all 5 themes, repeating from Floor 6. */
export function getFloorBiome(floor: number, utcDate?: string): FloorBiome {
  const biomeId = getBiomeIdForFloor(floor, utcDate);
  return BIOMES.find((b) => b.id === biomeId) ?? BIOMES[0]!;
}

export const BIOME_SHEETS: ReadonlyArray<{ key: BiomeSheet; url: string }> = [
  { key: 'ski', url: './assets/ski/tilemap_packed.png' },
  { key: 'town', url: './assets/town/tilemap_packed.png' },
  { key: 'battle', url: './assets/battle/tilemap_packed.png' },
  { key: 'farm', url: './assets/farm/tilemap_packed.png' },
];
