import { createDailyStream, type SeededRng } from '../rng.ts';
import type { BiomeId, DoorDirection, EnemyArchetype, HazardType, RoomType } from '../types.ts';
import {
  ARENA_H,
  ARENA_W,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Y,
  PLAY_MAX_X,
  PLAY_MAX_Y,
  PLAY_MIN_X,
  PLAY_MIN_Y,
} from './constants.ts';

export type WaveSpawn = {
  archetype: EnemyArchetype;
  x: number;
  y: number;
};

export type HazardBlueprint = {
  id: number;
  type: HazardType;
  x: number;
  y: number;
  w: number;
  h: number;
  dirX: number;
  dirY: number;
  phaseOffset: number;
};

export type BreakableBlueprint = {
  id: number;
  x: number;
  y: number;
  hp: number;
  radius: number;
  kind: 'crate' | 'pillar';
};

/** Solid, indestructible block (one 56px floor cell). Blocks movement and projectiles. */
export type ObstacleBlueprint = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type RoomRewardType =
  | 'relics'
  | 'coin_cache'
  | 'synergy_relics'
  | 'fountain_and_relics'
  | 'boss_chest_and_portals'
  | 'endless_relics_and_portals';

export type RoomBlueprint = {
  roomIndex: number;
  roomType: RoomType;
  waves: WaveSpawn[][];
  hazards: HazardBlueprint[];
  breakables: BreakableBlueprint[];
  obstacles: ObstacleBlueprint[];
  /** Which layout pattern was used (for debugging/tests). */
  layout: RoomLayoutId;
  rewardType: RoomRewardType;
  hpScale: number;
  hasHazard: boolean;
};

export type DungeonRoomNode = {
  id: number;
  roomIndex: number;
  gx: number;
  gy: number;
  bfsDist: number;
  doors: Partial<Record<DoorDirection, number>>;
  blueprint: RoomBlueprint;
};

export type DailyDungeonMap = {
  utcDate: string;
  floor: number;
  totalRooms: number;
  startRoomId: number;
  bossRoomId: number;
  rooms: DungeonRoomNode[];
};

const DIR_DELTAS: Record<DoorDirection, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

const ALL_DIRS: readonly DoorDirection[] = ['north', 'east', 'west', 'south'];

export function oppositeDirection(dir: DoorDirection): DoorDirection {
  switch (dir) {
    case 'north':
      return 'south';
    case 'south':
      return 'north';
    case 'east':
      return 'west';
    case 'west':
      return 'east';
  }
}

// ---------------------------------------------------------------------------
// Room layouts: patterns of solid blocks on the interior 10x6 grid of 56px cells.
// Cell (i, j) covers x = (i + 1) * 56 .. +56, y = (j + 1) * 56 .. +56.
// ---------------------------------------------------------------------------

export const CELL_SIZE = 56;
export const LAYOUT_COLS = 10;
export const LAYOUT_ROWS = 6;

export type RoomLayoutId =
  | 'open'
  | 'pillars'
  | 'side_walls'
  | 'ledges'
  | 'corners'
  | 'columns'
  | 'scatter';

const LAYOUT_MAPS: Record<Exclude<RoomLayoutId, 'scatter'>, readonly string[]> = {
  open: [],
  pillars: [
    '..........',
    '.#......#.',
    '..........',
    '..........',
    '.#......#.',
    '..........',
  ],
  side_walls: [
    '..#....#..',
    '..#....#..',
    '..........',
    '..........',
    '..#....#..',
    '..#....#..',
  ],
  ledges: [
    '..........',
    '.###..###.',
    '..........',
    '..........',
    '.##....##.',
    '..........',
  ],
  corners: [
    '.#......#.',
    '.##....##.',
    '..........',
    '..........',
    '.##....##.',
    '.#......#.',
  ],
  columns: [
    '..........',
    '.#.#..#.#.',
    '..........',
    '..........',
    '..#....#..',
    '..........',
  ],
};

/**
 * Cells that must stay walkable: door lanes, the centre (relic pedestals, stairs,
 * fountain, boss spawn) and the player's spawn at the bottom middle.
 */
export function isReservedCell(i: number, j: number): boolean {
  const nsLane = (i === 4 || i === 5) && (j <= 1 || j >= 4);
  const ewLane = (j === 2 || j === 3) && (i <= 1 || i >= 8);
  const centre = i >= 2 && i <= 7 && j >= 2 && j <= 3;
  const spawn = i >= 3 && i <= 6 && j >= 4;
  return nsLane || ewLane || centre || spawn;
}

function cellToObstacle(i: number, j: number, id: number): ObstacleBlueprint {
  return { id, x: (i + 1) * CELL_SIZE, y: (j + 1) * CELL_SIZE, w: CELL_SIZE, h: CELL_SIZE };
}

function cellCenter(i: number, j: number): { x: number; y: number } {
  return { x: (i + 1.5) * CELL_SIZE, y: (j + 1.5) * CELL_SIZE };
}

function pickFreeCells(
  candidates: readonly (readonly [number, number])[],
  blocked: Set<string>,
  count: number,
): Array<[number, number]> {
  const chosen: Array<[number, number]> = [];
  for (const [i, j] of candidates) {
    if (chosen.length >= count) break;
    const key = `${i},${j}`;
    if (blocked.has(key)) continue;
    blocked.add(key);
    chosen.push([i, j]);
  }
  return chosen;
}

export function buildObstacles(rng: SeededRng, layout: RoomLayoutId, roomIndex: number): ObstacleBlueprint[] {
  const cells: Array<[number, number]> = [];
  if (layout === 'scatter') {
    const free: Array<[number, number]> = [];
    for (let j = 0; j < LAYOUT_ROWS; j += 1) {
      for (let i = 0; i < LAYOUT_COLS; i += 1) {
        // Keep the outermost ring mostly clear so scattered rocks read as islands.
        if (!isReservedCell(i, j) && i > 0 && i < LAYOUT_COLS - 1 && j > 0 && j < LAYOUT_ROWS - 1) {
          free.push([i, j]);
        }
      }
    }
    cells.push(...rng.shuffle(free).slice(0, rng.int(4, 6)));
  } else {
    LAYOUT_MAPS[layout].forEach((row, j) => {
      for (let i = 0; i < row.length; i += 1) {
        if (row[i] === '#' && !isReservedCell(i, j)) cells.push([i, j]);
      }
    });
  }
  return cells.map(([i, j], k) => cellToObstacle(i, j, roomIndex * 100 + k));
}

function circleHitsObstacle(x: number, y: number, r: number, obstacles: readonly ObstacleBlueprint[]): boolean {
  return obstacles.some((o) => {
    const cx = Math.max(o.x, Math.min(o.x + o.w, x));
    const cy = Math.max(o.y, Math.min(o.y + o.h, y));
    return Math.hypot(x - cx, y - cy) < r;
  });
}

function pickLayout(rng: SeededRng, role: 'entrance' | 'boss' | 'room', floor: number): RoomLayoutId {
  if (role === 'entrance' && floor === 1) return 'open';
  if (role === 'boss') return rng.pick(['open', 'pillars', 'corners'] as const);
  return rng.pick([
    'open',
    'pillars',
    'side_walls',
    'ledges',
    'corners',
    'columns',
    'scatter',
    'scatter',
  ] as const);
}

function getSafeSpawnPoint(
  rng: SeededRng,
  avoidCenter = false,
  obstacles: readonly ObstacleBlueprint[] = [],
): { x: number; y: number } {
  const doorCenters = [
    { x: ARENA_W / 2, y: PLAY_MIN_Y },
    { x: ARENA_W / 2, y: PLAY_MAX_Y },
    { x: PLAY_MIN_X, y: ARENA_H / 2 },
    { x: PLAY_MAX_X, y: ARENA_H / 2 },
  ];

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const x = rng.range(PLAY_MIN_X + 52, PLAY_MAX_X - 52);
    const y = rng.range(PLAY_MIN_Y + 46, PLAY_MAX_Y - 46);
    const distFromSpawn = Math.hypot(x - PLAYER_SPAWN_X, y - PLAYER_SPAWN_Y);
    const distFromCenter = Math.hypot(x - ARENA_W / 2, y - ARENA_H / 2);
    const clearOfDoors = doorCenters.every((d) => Math.hypot(x - d.x, y - d.y) >= 84);
    const clearOfBlocks = !circleHitsObstacle(x, y, 28, obstacles);
    if (
      distFromSpawn >= 100 &&
      clearOfDoors &&
      clearOfBlocks &&
      (!avoidCenter || distFromCenter >= 70)
    ) {
      return { x, y };
    }
  }
  for (let j = 0; j < LAYOUT_ROWS; j += 1) {
    for (let i = 0; i < LAYOUT_COLS; i += 1) {
      const x = (i + 1.5) * CELL_SIZE;
      const y = (j + 1.5) * CELL_SIZE;
      const distFromSpawn = Math.hypot(x - PLAYER_SPAWN_X, y - PLAYER_SPAWN_Y);
      const clearOfDoors = doorCenters.every((d) => Math.hypot(x - d.x, y - d.y) >= 84);
      if (distFromSpawn >= 100 && clearOfDoors && !circleHitsObstacle(x, y, 28, obstacles)) {
        return { x, y };
      }
    }
  }
  return { x: Math.round(ARENA_W * 0.25), y: Math.round(ARENA_H * 0.28) };
}

const HAZARD_CELLS: readonly (readonly [number, number])[] = [
  [2, 1], [7, 1], [2, 4], [7, 4],
  [3, 1], [6, 1], [1, 1], [8, 1],
  [1, 4], [8, 4], [2, 2], [7, 2],
  [2, 3], [7, 3], [0, 1], [9, 1],
  [0, 4], [9, 4],
];

function buildHazards(
  rng: SeededRng,
  hazardType: HazardType,
  roomIndex: number,
  blockedCells: Set<string>,
): HazardBlueprint[] {
  const hazards: HazardBlueprint[] = [];
  if (hazardType === 'spikes') {
    const cells = pickFreeCells(HAZARD_CELLS, blockedCells, 4);
    cells.forEach(([i, j], idx) => {
      const pt = cellCenter(i, j);
      hazards.push({
        id: roomIndex * 100 + idx,
        type: 'spikes',
        x: pt.x,
        y: pt.y,
        w: CELL_SIZE,
        h: CELL_SIZE,
        dirX: 0,
        dirY: 0,
        phaseOffset: (idx % 2) * 1.6,
      });
    });
  } else if (hazardType === 'barrels') {
    const cells = pickFreeCells(HAZARD_CELLS, blockedCells, 4);
    cells.forEach(([i, j], idx) => {
      const pt = cellCenter(i, j);
      hazards.push({
        id: roomIndex * 100 + idx,
        type: 'barrels',
        x: pt.x,
        y: pt.y,
        w: CELL_SIZE,
        h: CELL_SIZE,
        dirX: 0,
        dirY: 0,
        phaseOffset: 0,
      });
    });
  } else {
    const dir = rng.next() < 0.5 ? 1 : -1;
    hazards.push(
      {
        id: roomIndex * 100 + 1,
        type: 'currents',
        x: ARENA_W / 2,
        y: cellCenter(0, 1).y,
        w: CELL_SIZE * 4,
        h: CELL_SIZE,
        dirX: dir,
        dirY: 0,
        phaseOffset: 0,
      },
      {
        id: roomIndex * 100 + 2,
        type: 'currents',
        x: ARENA_W / 2,
        y: cellCenter(0, 4).y,
        w: CELL_SIZE * 4,
        h: CELL_SIZE,
        dirX: -dir,
        dirY: 0,
        phaseOffset: 0,
      },
    );
  }
  return hazards;
}

function buildBreakables(
  roomIndex: number,
  kind: 'crate' | 'pillar',
  count: number,
  blockedCells: Set<string>,
): BreakableBlueprint[] {
  const candidates: readonly (readonly [number, number])[] =
    kind === 'pillar'
      ? [
          [2, 2], [7, 2], [2, 3], [7, 3], [1, 2], [8, 2],
        ]
      : [
          [1, 1], [8, 1], [1, 4], [8, 4],
          [0, 0], [9, 0], [0, 5], [9, 5],
          [0, 1], [9, 1], [0, 4], [9, 4],
          [2, 0], [7, 0], [2, 5], [7, 5],
        ];
  return pickFreeCells(candidates, blockedCells, count).map(([i, j], idx) => {
    const pt = cellCenter(i, j);
    return {
      id: roomIndex * 1000 + idx,
      x: pt.x,
      y: pt.y,
      hp: kind === 'pillar' ? 50 : 22,
      radius: kind === 'pillar' ? 24 : 22,
      kind,
    };
  });
}

function makeWave(
  rng: SeededRng,
  archetypes: EnemyArchetype[],
  obstacles: readonly ObstacleBlueprint[] = [],
): WaveSpawn[] {
  return archetypes.map((archetype) => {
    const pt = getSafeSpawnPoint(rng, archetype === 'boss', obstacles);
    return { archetype, x: pt.x, y: pt.y };
  });
}

function connectNodes(a: DungeonRoomNode, dir: DoorDirection, b: DungeonRoomNode): void {
  a.doors[dir] = b.id;
  b.doors[oppositeDirection(dir)] = a.id;
}

export type FloorScaling = {
  floor: number;
  /** Multiplier on regular enemy HP. */
  hpScale: number;
  /** Multiplier on boss HP. */
  bossHpScale: number;
  /** Multiplier on enemy damage. */
  damageMult: number;
  /** Multiplier on enemy movement speed. */
  speedMult: number;
  /** Multiplier on coin drops, so deeper floors pay out more. */
  coinMult: number;
  /** Extra enemies added to every wave. */
  extraEnemies: number;
};

export const BIOME_ORDER: readonly BiomeId[] = ['dungeon', 'snow', 'town', 'battle', 'farm'];

export function getBiomeIdForFloor(floor: number): BiomeId {
  const f = Math.max(1, Math.floor(floor));
  return BIOME_ORDER[(f - 1) % BIOME_ORDER.length]!;
}

export const BIOME_SIGNATURE_ENEMY: Record<BiomeId, EnemyArchetype> = {
  dungeon: 'shade',
  snow: 'yeti',
  town: 'bomber',
  battle: 'mortar_tank',
  farm: 'stampede',
};

export function getFloorScaling(floor: number): FloorScaling {
  const f = Math.max(1, Math.floor(floor));
  const depth = f - 1;
  return {
    floor: f,
    hpScale: 1 + 0.3 * depth,
    bossHpScale: 1 + 0.45 * depth,
    damageMult: 1 + 0.12 * depth,
    speedMult: Math.min(1.3, 1 + 0.03 * depth),
    coinMult: 1 + 0.12 * depth,
    extraEnemies: Math.min(3, Math.floor(depth / 2)),
  };
}

function enemyPoolForFloor(floor: number): EnemyArchetype[] {
  const sig = BIOME_SIGNATURE_ENEMY[getBiomeIdForFloor(floor)];
  if (floor <= 1) return ['chaser', 'shooter', sig, sig];
  if (floor <= 3) return [sig, sig, 'chaser', 'shooter', 'charger'];
  return [sig, sig, 'chaser', 'shooter', 'charger', 'elite_charger'];
}

function withExtras(
  rng: SeededRng,
  base: EnemyArchetype[],
  floor: number,
  extraEnemies: number,
): EnemyArchetype[] {
  const pool = enemyPoolForFloor(floor);
  const out = [...base];
  for (let i = 0; i < extraEnemies; i += 1) out.push(rng.pick(pool));
  return out;
}

/**
 * Builds one floor of the daily dungeon. Every player gets the same layout for a
 * given (utcDate, floor) pair. Floors are endless: floor N+1 is generated when the
 * player takes the stairs out of floor N's boss room.
 *
 * Layout rules:
 * - 4-6 rooms per floor (including the entrance and the boss room).
 * - The entrance room has exactly one exit.
 * - The boss room is the room farthest from the entrance.
 */
export function buildDailyDungeonMap(
  utcDate: string,
  floor: number,
  dailyHazard: HazardType,
): DailyDungeonMap {
  const f = Math.max(1, Math.floor(floor));
  const scaling = getFloorScaling(f);
  const rng = createDailyStream(utcDate, `floor-${f}-map`);
  const totalRooms = rng.int(5, 7);
  // Only the very first room of the run is a single-door corridor. Later floors open up.
  const entranceMaxDoors = f === 1 ? 1 : 2;

  const emptyBlueprint = (roomIndex: number): RoomBlueprint => ({
    roomIndex,
    roomType: 'escalation',
    waves: [],
    hazards: [],
    breakables: [],
    obstacles: [],
    layout: 'open',
    rewardType: 'relics',
    hpScale: 1,
    hasHazard: false,
  });

  const makeNode = (gx: number, gy: number, bfsDist: number): DungeonRoomNode => {
    const id = nodes.length;
    return { id, roomIndex: id + 1, gx, gy, bfsDist, doors: {}, blueprint: emptyBlueprint(id + 1) };
  };

  const nodes: DungeonRoomNode[] = [];
  const start = makeNode(0, 0, 0);
  nodes.push(start);
  const grid = new Map<string, DungeonRoomNode>([['0,0', start]]);
  const degree = (n: DungeonRoomNode): number => Object.keys(n.doors).length;
  const canTakeDoor = (n: DungeonRoomNode): boolean =>
    n.id === 0 ? degree(n) < entranceMaxDoors : degree(n) < 4;

  // First exit out of the entrance.
  const firstDir = rng.pick(['north', 'east', 'west'] as const);
  const firstDelta = DIR_DELTAS[firstDir];
  const first = makeNode(firstDelta.dx, firstDelta.dy, 1);
  nodes.push(first);
  grid.set(`${first.gx},${first.gy}`, first);
  connectNodes(start, firstDir, first);

  // Grow compactly: prefer empty cells that touch several existing rooms, so we can
  // add loops afterwards and avoid one long corridor.
  while (nodes.length < totalRooms) {
    const candidates: Array<{ parent: DungeonRoomNode; dir: DoorDirection; nx: number; ny: number; score: number }> = [];
    for (const parent of nodes) {
      if (!canTakeDoor(parent)) continue;
      for (const dir of ALL_DIRS) {
        const delta = DIR_DELTAS[dir];
        const nx = parent.gx + delta.dx;
        const ny = parent.gy + delta.dy;
        if (Math.abs(nx) > 2 || ny < -3 || ny > 1) continue;
        if (nx === 0 && ny === 1) continue;
        if (grid.has(`${nx},${ny}`)) continue;
        let touching = 0;
        for (const d of ALL_DIRS) {
          const nb = grid.get(`${nx + DIR_DELTAS[d].dx},${ny + DIR_DELTAS[d].dy}`);
          if (nb && nb.id !== 0) touching += 1;
        }
        const score = touching + (degree(parent) <= 1 ? 0.5 : 0) + rng.next();
        candidates.push({ parent, dir, nx, ny, score });
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((x, y) => y.score - x.score);
    const chosen = candidates[0]!;
    const node = makeNode(chosen.nx, chosen.ny, chosen.parent.bfsDist + 1);
    nodes.push(node);
    grid.set(`${node.gx},${node.gy}`, node);
    connectNodes(chosen.parent, chosen.dir, node);
  }

  // Give dead ends a second door where a neighbour exists, then sprinkle a few loops.
  const tryLink = (a: DungeonRoomNode, chance: number): void => {
    for (const dir of rng.shuffle(ALL_DIRS)) {
      if (a.doors[dir] !== undefined) continue;
      const b = grid.get(`${a.gx + DIR_DELTAS[dir].dx},${a.gy + DIR_DELTAS[dir].dy}`);
      if (!b || !canTakeDoor(a) || !canTakeDoor(b)) continue;
      if (rng.next() < chance) {
        connectNodes(a, dir, b);
        return;
      }
    }
  };
  for (const node of nodes) {
    if (node.id !== 0 && degree(node) === 1) tryLink(node, 1);
  }
  for (const node of nodes) {
    if (node.id !== 0) tryLink(node, 0.3);
  }
  if (f > 1 && degree(start) < entranceMaxDoors) tryLink(start, 1);

  // Shortest distances from the entrance.
  const distMap = new Map<number, number>([[0, 0]]);
  const queue: number[] = [0];
  while (queue.length > 0) {
    const curId = queue.shift()!;
    const curNode = nodes[curId]!;
    const curDist = distMap.get(curId) ?? 0;
    for (const targetId of Object.values(curNode.doors)) {
      if (targetId === undefined || distMap.has(targetId)) continue;
      distMap.set(targetId, curDist + 1);
      queue.push(targetId);
    }
  }
  for (const node of nodes) {
    node.bfsDist = distMap.get(node.id) ?? node.bfsDist;
  }

  const ranked = nodes
    .filter((n) => n.id !== 0)
    .sort((a, b) => (a.bfsDist !== b.bfsDist ? b.bfsDist - a.bfsDist : b.id - a.id));
  const bossNode = ranked[0] ?? nodes[nodes.length - 1]!;
  const eliteNode = nodes.length >= 5 ? ranked[1] : undefined;
  const gauntletNode = nodes.length >= 6 ? ranked[2] : undefined;
  const bossRoomId = bossNode.id;
  const extra = scaling.extraEnemies;
  const sig = BIOME_SIGNATURE_ENEMY[getBiomeIdForFloor(f)];
  const centerSpawnY = Math.round(ARENA_H * 0.3);

  for (const node of nodes) {
    const roomRng = createDailyStream(utcDate, `floor-${f}-room-${node.roomIndex}`);
    const layoutRng = createDailyStream(utcDate, `floor-${f}-layout-${node.roomIndex}`);
    const role = node.id === 0 ? 'entrance' : node.id === bossRoomId ? 'boss' : 'room';
    const layout = pickLayout(layoutRng, role, f);
    const obstacles = buildObstacles(layoutRng, layout, node.roomIndex);
    const occupiedCells = new Set(
      obstacles.map((o) => `${Math.round(o.x / CELL_SIZE) - 1},${Math.round(o.y / CELL_SIZE) - 1}`),
    );
    const wave = (archetypes: EnemyArchetype[]): WaveSpawn[] => makeWave(roomRng, archetypes, obstacles);
    if (node.id === 0) {
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'warmup',
        waves:
          f === 1
            ? [wave(['chaser', 'chaser']), wave(['chaser', 'shade'])]
            : [wave(withExtras(roomRng, [sig, 'chaser', 'shooter'], f, extra))],
        hazards: [],
        breakables: buildBreakables(node.roomIndex, 'crate', 4, occupiedCells),
        obstacles,
        layout,
        rewardType: 'coin_cache',
        hpScale: scaling.hpScale,
        hasHazard: false,
      };
    } else if (node.id === bossRoomId) {
      const escorts: EnemyArchetype[] =
        f >= 3 ? withExtras(roomRng, [], f, Math.min(2, Math.floor((f - 1) / 2))) : [];
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'boss',
        waves: [[{ archetype: 'boss', x: ARENA_W / 2, y: centerSpawnY }, ...wave(escorts)]],
        hazards: [],
        breakables: buildBreakables(node.roomIndex, 'pillar', 2, occupiedCells),
        obstacles,
        layout,
        rewardType: 'boss_chest_and_portals',
        hpScale: scaling.bossHpScale,
        hasHazard: false,
      };
    } else if (gauntletNode && node.id === gauntletNode.id) {
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'gauntlet',
        waves: [
          wave(withExtras(roomRng, [sig, 'chaser', 'shooter'], f, extra)),
          wave(withExtras(roomRng, [sig, 'charger', 'shooter', 'chaser'], f, extra)),
        ],
        hazards: buildHazards(roomRng, dailyHazard, node.roomIndex, occupiedCells),
        breakables: buildBreakables(node.roomIndex, 'crate', 3, occupiedCells),
        obstacles,
        layout,
        rewardType: 'fountain_and_relics',
        hpScale: scaling.hpScale * 1.1,
        hasHazard: true,
      };
    } else if (eliteNode && node.id === eliteNode.id) {
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'elite',
        waves: [
          [
            { archetype: 'elite_charger', x: ARENA_W / 2, y: centerSpawnY },
            ...wave(withExtras(roomRng, [sig, 'shooter'], f, extra)),
          ],
        ],
        hazards: [],
        breakables: buildBreakables(node.roomIndex, 'crate', 4, occupiedCells),
        obstacles,
        layout,
        rewardType: 'synergy_relics',
        hpScale: scaling.hpScale * 1.08,
        hasHazard: false,
      };
    } else {
      const rewardType: RoomRewardType = roomRng.next() < 0.55 ? 'relics' : 'coin_cache';
      const pool = enemyPoolForFloor(f);
      const waveA = withExtras(roomRng, [sig, roomRng.pick(pool), 'chaser'], f, extra);
      const waveB = withExtras(roomRng, ['shooter', roomRng.pick(pool), sig], f, extra);
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'escalation',
        waves:
          node.bfsDist <= 1 && f === 1
            ? [wave(waveA)]
            : [wave(waveA), wave(waveB)],
        hazards: buildHazards(roomRng, dailyHazard, node.roomIndex, occupiedCells),
        breakables: buildBreakables(node.roomIndex, 'crate', 3, occupiedCells),
        obstacles,
        layout,
        rewardType,
        hpScale: scaling.hpScale * (1 + 0.04 * node.bfsDist),
        hasHazard: true,
      };
    }
    // Crates/pillars never sit inside a block.
    node.blueprint.breakables = node.blueprint.breakables.filter(
      (b) => !circleHitsObstacle(b.x, b.y, b.radius, obstacles),
    );
  }

  return {
    utcDate,
    floor: f,
    totalRooms: nodes.length,
    startRoomId: 0,
    bossRoomId,
    rooms: nodes,
  };
}
