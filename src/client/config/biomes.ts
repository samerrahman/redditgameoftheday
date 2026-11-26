/**
 * Per-floor visual themes ("biomes"). Floor 1 is the dungeon; deeper floors cycle
 * through the outdoor Kenney packs. Purely cosmetic: layouts and enemies come from
 * the simulation and are unaffected.
 *
 * Frame numbers index each pack's `tilemap_packed.png` (16x16 tiles, row-major:
 * ski/town/farm are 12 columns wide, battle is 18).
 */

import { getBiomeIdForFloor } from '../../shared/game/rooms.ts';
import type { BiomeId } from '../../shared/types.ts';

export type BiomeSheet = 'ski' | 'town' | 'battle' | 'farm' | ThemeKey;

/** Atlases with named frames for the original-art themed worlds. */
export type ThemeKey = 'keep' | 'candy' | 'neon' | 'space' | 'reef' | 'haunted' | 'sky';

/** Frames are tile indices for Kenney packs, or frame names for theme atlases. */
export type BiomeFrame = number | string;

export type BiomeDecor = {
  sheet: BiomeSheet;
  /** One frame, or a vertical stack (top first) for 2-tile-tall props like trees. */
  frames: BiomeFrame[];
  weight: number;
};

export type FloorBiome = {
  id: BiomeId;
  name: string;
  /** null = use the dungeon atlas floor (the original look). */
  floor: { sheet: BiomeSheet; frames: BiomeFrame[]; accents?: BiomeFrame[] | undefined } | null;
  /** Checkerboard floors (Candy Land): even/odd tiles pick from these two lists. */
  checker?: [BiomeFrame[], BiomeFrame[]] | undefined;
  /** Themed wall tiles drawn instead of tinted dungeon walls. */
  walls?: { sheet: ThemeKey; top: string[]; side: string[] } | undefined;
  /** Theme atlas whose monster sprites replace the defaults on this world's floors. */
  monsters?: ThemeKey | undefined;
  /** A 2-tile carpet runner down the middle of the room, door to door. */
  runner?: { sheet: ThemeKey; left: string; right: string } | undefined;
  /** Cobwebs drawn in the two top corners of the room. */
  cobweb?: { sheet: ThemeKey; frame: string } | undefined;
  /** Optional patches of a second ground (dirt paths, tilled soil). */
  patches?: { sheet: BiomeSheet; frames: BiomeFrame[]; count: number } | undefined;
  floorTint: number;
  wallTint: number;
  ambientBg: number;
  decor: BiomeDecor[];
  /** How many props to scatter around the room edges. */
  decorCount: [number, number];
  /** Wall torches only make sense indoors / at night. */
  torches: boolean;
  /** Sprites for solid layout blocks; null = drawn stone blocks (dungeon). */
  blocks: { sheet: BiomeSheet; frames: BiomeFrame[] } | null;
};

export const BIOMES: readonly FloorBiome[] = [
  {
    // Floor 1's home, so it gets the most detailed art: "The Keep" sheet (warm flagstones,
    // a royal runner, knight statues, bookshelves) with the classic Kenney walls and monsters.
    id: 'dungeon',
    name: 'The Dungeon',
    floor: {
      sheet: 'keep',
      frames: ['floor_0', 'floor_1', 'floor_2'],
      accents: ['floor_3', 'floor_4', 'floor_5', 'floor_6', 'floor_7'],
    },
    runner: { sheet: 'keep', left: 'rug_l', right: 'rug_r' },
    cobweb: { sheet: 'keep', frame: 'cobweb' },
    // Castle cast: Rat Squires, Cursed Grimoires, Mimic Chests, Haunted Armor and the Rat King.
    monsters: 'keep',
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    ambientBg: 0x1e181f,
    decor: [
      { sheet: 'keep', frames: ['knight_top', 'knight_bottom'], weight: 3 },
      { sheet: 'keep', frames: ['bookshelf_top', 'bookshelf_bottom'], weight: 2 },
      { sheet: 'keep', frames: ['candles'], weight: 3 },
      { sheet: 'keep', frames: ['bones'], weight: 2 },
      { sheet: 'keep', frames: ['urns'], weight: 2 },
      { sheet: 'keep', frames: ['rack'], weight: 2 },
    ],
    decorCount: [5, 7],
    torches: true,
    blocks: { sheet: 'keep', frames: ['block'] }, // carved rune pillars
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
      { sheet: 'ski', frames: [81], weight: 2 }, // rock
      { sheet: 'ski', frames: [47], weight: 1 }, // stump
      { sheet: 'ski', frames: [8, 20], weight: 1 }, // red slalom flag
      { sheet: 'ski', frames: [9, 21], weight: 1 }, // blue slalom flag
    ],
    decorCount: [4, 6],
    torches: false,
    blocks: { sheet: 'ski', frames: [81] }, // snowy rocks
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
      { sheet: 'town', frames: [107], weight: 2 }, // pot
      { sheet: 'town', frames: [130], weight: 2 }, // barrel
      { sheet: 'town', frames: [131], weight: 1 }, // water barrel
      { sheet: 'town', frames: [83], weight: 1 }, // signpost
      { sheet: 'town', frames: [94], weight: 1 }, // beehive
      { sheet: 'town', frames: [106], weight: 1 }, // log
    ],
    decorCount: [4, 6],
    torches: true,
    blocks: { sheet: 'town', frames: [130, 107, 131] }, // barrels and pots
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
      { sheet: 'battle', frames: [23], weight: 3 }, // tank trap
      { sheet: 'battle', frames: [25], weight: 2 }, // barricade
      { sheet: 'battle', frames: [5], weight: 2 }, // boulder
      { sheet: 'battle', frames: [94], weight: 2 }, // tree
      { sheet: 'battle', frames: [112], weight: 1 }, // tree pair
      { sheet: 'battle', frames: [16], weight: 1 }, // flag
      { sheet: 'battle', frames: [24], weight: 1 }, // bunker
    ],
    decorCount: [4, 6],
    torches: false,
    blocks: { sheet: 'battle', frames: [25, 23] }, // barricades and tank traps
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
      { sheet: 'farm', frames: [96], weight: 2 }, // hay bale
      { sheet: 'farm', frames: [85], weight: 2 }, // barrel
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
    blocks: { sheet: 'farm', frames: [96, 97] }, // hay bales
  },
  {
    id: 'candy',
    name: 'Candy Land',
    floor: { sheet: 'candy', frames: ['floor_0', 'floor_1'] },
    checker: [
      ['floor_0', 'floor_0', 'floor_3'],
      ['floor_1', 'floor_1', 'floor_4'],
    ],
    walls: { sheet: 'candy', top: ['wall_top_0', 'wall_top_1', 'wall_top_2'], side: ['wall_side_0', 'wall_side_1', 'wall_side_2'] },
    monsters: 'candy',
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    ambientBg: 0xffc2e2,
    decor: [
      { sheet: 'candy', frames: ['lollipop_top', 'lollipop_bottom'], weight: 3 },
      { sheet: 'candy', frames: ['candy_cane_top', 'candy_cane_bottom'], weight: 3 },
      { sheet: 'candy', frames: ['gumdrop'], weight: 2 },
      { sheet: 'candy', frames: ['gumdrop_mint'], weight: 2 },
      { sheet: 'candy', frames: ['cupcake'], weight: 2 },
      { sheet: 'candy', frames: ['donut'], weight: 2 },
    ],
    decorCount: [5, 7],
    torches: false,
    blocks: { sheet: 'candy', frames: ['block'] }, // chocolate bars
  },
  {
    id: 'neon',
    name: 'Neon City',
    floor: { sheet: 'neon', frames: ['floor_0', 'floor_1', 'floor_2', 'floor_3', 'floor_4', 'floor_5'] },
    walls: { sheet: 'neon', top: ['wall_top_0', 'wall_top_1', 'wall_top_2'], side: ['wall_side_0', 'wall_side_1', 'wall_side_2'] },
    monsters: 'neon',
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    ambientBg: 0x0c0e1e,
    decor: [
      { sheet: 'neon', frames: ['neon_sign_top', 'neon_sign_bottom'], weight: 3 },
      { sheet: 'neon', frames: ['vending_top', 'vending_bottom'], weight: 3 },
      { sheet: 'neon', frames: ['cone'], weight: 2 },
      { sheet: 'neon', frames: ['hologram'], weight: 2 },
    ],
    decorCount: [5, 7],
    torches: false,
    blocks: { sheet: 'neon', frames: ['block'] }, // neon-trimmed crates
  },
  {
    id: 'space',
    name: 'Space',
    floor: { sheet: 'space', frames: ['floor_0', 'floor_1', 'floor_2', 'floor_3', 'floor_4', 'floor_5'] },
    walls: { sheet: 'space', top: ['wall_top_0', 'wall_top_1', 'wall_top_2'], side: ['wall_side_0', 'wall_side_1', 'wall_side_2'] },
    monsters: 'space',
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    ambientBg: 0x0a0620,
    decor: [
      { sheet: 'space', frames: ['rocket_top', 'rocket_bottom'], weight: 3 },
      { sheet: 'space', frames: ['planet'], weight: 2 },
      { sheet: 'space', frames: ['crystals'], weight: 2 },
      { sheet: 'space', frames: ['dish'], weight: 2 },
      { sheet: 'space', frames: ['moon_rock'], weight: 2 },
    ],
    decorCount: [5, 7],
    torches: false,
    blocks: { sheet: 'space', frames: ['block'] }, // supply crates
  },
  {
    id: 'reef',
    name: 'Coral Reef',
    floor: { sheet: 'reef', frames: ['floor_0', 'floor_1', 'floor_2', 'floor_0', 'floor_1'], accents: ['floor_3', 'floor_4', 'floor_5'] },
    walls: { sheet: 'reef', top: ['wall_top_0', 'wall_top_1', 'wall_top_2'], side: ['wall_side_0', 'wall_side_1', 'wall_side_2'] },
    monsters: 'reef',
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    ambientBg: 0x1f6fa8,
    decor: [
      { sheet: 'reef', frames: ['kelp_top', 'kelp_bottom'], weight: 3 },
      { sheet: 'reef', frames: ['coral_fan'], weight: 2 },
      { sheet: 'reef', frames: ['anemone'], weight: 2 },
      { sheet: 'reef', frames: ['starfish'], weight: 2 },
      { sheet: 'reef', frames: ['treasure'], weight: 1 },
    ],
    decorCount: [5, 7],
    torches: false,
    blocks: { sheet: 'reef', frames: ['block'] }, // giant clams
  },
  {
    id: 'haunted',
    name: 'Haunted Manor',
    floor: { sheet: 'haunted', frames: ['floor_0', 'floor_1', 'floor_2'], accents: ['floor_3', 'floor_4', 'floor_5'] },
    walls: { sheet: 'haunted', top: ['wall_top_0', 'wall_top_1', 'wall_top_2'], side: ['wall_side_0', 'wall_side_1', 'wall_side_2'] },
    monsters: 'haunted',
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    ambientBg: 0x1a0f24,
    decor: [
      { sheet: 'haunted', frames: ['clock_top', 'clock_bottom'], weight: 2 },
      { sheet: 'haunted', frames: ['candelabra_top', 'candelabra_bottom'], weight: 2 },
      { sheet: 'haunted', frames: ['pumpkin'], weight: 3 },
      { sheet: 'haunted', frames: ['tombstone'], weight: 2 },
      { sheet: 'haunted', frames: ['cauldron'], weight: 2 },
    ],
    decorCount: [5, 7],
    torches: true,
    blocks: { sheet: 'haunted', frames: ['block'] }, // coffins
  },
  {
    id: 'sky',
    name: 'Sky Kingdom',
    floor: { sheet: 'sky', frames: ['floor_0', 'floor_1', 'floor_2', 'floor_3', 'floor_4'], accents: ['floor_5'] },
    walls: { sheet: 'sky', top: ['wall_top_0', 'wall_top_1', 'wall_top_2'], side: ['wall_side_0', 'wall_side_1', 'wall_side_2'] },
    monsters: 'sky',
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    ambientBg: 0x8fd0ff,
    decor: [
      { sheet: 'sky', frames: ['rainbow_top', 'rainbow_bottom'], weight: 2 },
      { sheet: 'sky', frames: ['balloon_top', 'balloon_bottom'], weight: 2 },
      { sheet: 'sky', frames: ['cloud'], weight: 3 },
      { sheet: 'sky', frames: ['harp'], weight: 2 },
      { sheet: 'sky', frames: ['sun'], weight: 2 },
    ],
    decorCount: [5, 7],
    torches: false,
    blocks: { sheet: 'sky', frames: ['block'] }, // marble blocks
  },
];

/** Floors cycle daily-shuffled biomes across all 5 themes, repeating from Floor 6. */
export function getFloorBiome(floor: number, utcDate?: string): FloorBiome {
  const biomeId = getBiomeIdForFloor(floor, utcDate);
  return BIOMES.find((b) => b.id === biomeId) ?? BIOMES[0]!;
}

/** Theme atlases (named frames), loaded with this.load.atlas. */
export const THEME_ATLASES: ReadonlyArray<{ key: ThemeKey; png: string; json: string }> = [
  { key: 'keep', png: './assets/themes/keep_sheet.png', json: './assets/themes/keep_sheet.json' },
  { key: 'candy', png: './assets/themes/candy_sheet.png', json: './assets/themes/candy_sheet.json' },
  { key: 'neon', png: './assets/themes/neon_sheet.png', json: './assets/themes/neon_sheet.json' },
  { key: 'space', png: './assets/themes/space_sheet.png', json: './assets/themes/space_sheet.json' },
  { key: 'reef', png: './assets/themes/reef_sheet.png', json: './assets/themes/reef_sheet.json' },
  { key: 'haunted', png: './assets/themes/haunted_sheet.png', json: './assets/themes/haunted_sheet.json' },
  { key: 'sky', png: './assets/themes/sky_sheet.png', json: './assets/themes/sky_sheet.json' },
];

export const BIOME_SHEETS: ReadonlyArray<{ key: BiomeSheet; url: string }> = [
  { key: 'ski', url: './assets/ski/tilemap_packed.png' },
  { key: 'town', url: './assets/town/tilemap_packed.png' },
  { key: 'battle', url: './assets/battle/tilemap_packed.png' },
  { key: 'farm', url: './assets/farm/tilemap_packed.png' },
];
