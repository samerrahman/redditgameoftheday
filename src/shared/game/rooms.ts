import { createDailyStream, type SeededRng } from '../rng.ts';
import type { DoorDirection, EnemyArchetype, HazardType, RoomType } from '../types.ts';
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

function getSafeSpawnPoint(rng: SeededRng, avoidCenter = false): { x: number; y: number } {
  const doorCenters = [
    { x: ARENA_W / 2, y: PLAY_MIN_Y },
    { x: ARENA_W / 2, y: PLAY_MAX_Y },
    { x: PLAY_MIN_X, y: ARENA_H / 2 },
    { x: PLAY_MAX_X, y: ARENA_H / 2 },
  ];

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const x = rng.range(PLAY_MIN_X + 64, PLAY_MAX_X - 64);
    const y = rng.range(PLAY_MIN_Y + 56, PLAY_MAX_Y - 56);
    const distFromSpawn = Math.hypot(x - PLAYER_SPAWN_X, y - PLAYER_SPAWN_Y);
    const distFromCenter = Math.hypot(x - ARENA_W / 2, y - ARENA_H / 2);
    const clearOfDoors = doorCenters.every((d) => Math.hypot(x - d.x, y - d.y) >= 96);
    if (distFromSpawn >= 115 && clearOfDoors && (!avoidCenter || distFromCenter >= 75)) {
      return { x, y };
    }
  }
  return { x: Math.round(ARENA_W * 0.25), y: Math.round(ARENA_H * 0.28) };
}

function buildHazards(
  rng: SeededRng,
  hazardType: HazardType,
  roomIndex: number,
): HazardBlueprint[] {
  const hazards: HazardBlueprint[] = [];
  if (hazardType === 'spikes') {
    const spots = [
      { x: Math.round(ARENA_W * 0.27), y: Math.round(ARENA_H * 0.34) },
      { x: Math.round(ARENA_W * 0.73), y: Math.round(ARENA_H * 0.34) },
      { x: Math.round(ARENA_W * 0.27), y: Math.round(ARENA_H * 0.66) },
      { x: Math.round(ARENA_W * 0.73), y: Math.round(ARENA_H * 0.66) },
    ];
    const jitter = rng.range(-14, 14);
    spots.forEach((spot, idx) => {
      hazards.push({
        id: roomIndex * 100 + idx,
        type: 'spikes',
        x: spot.x + jitter * (idx % 2 === 0 ? 1 : -1),
        y: spot.y,
        w: 56,
        h: 56,
        dirX: 0,
        dirY: 0,
        phaseOffset: (idx % 2) * 1.6,
      });
    });
  } else if (hazardType === 'barrels') {
    const spots = [
      { x: Math.round(ARENA_W * 0.28), y: Math.round(ARENA_H * 0.33) },
      { x: Math.round(ARENA_W * 0.72), y: Math.round(ARENA_H * 0.33) },
      { x: Math.round(ARENA_W * 0.28), y: Math.round(ARENA_H * 0.67) },
      { x: Math.round(ARENA_W * 0.72), y: Math.round(ARENA_H * 0.67) },
    ];
    spots.forEach((spot, idx) => {
      hazards.push({
        id: roomIndex * 100 + idx,
        type: 'barrels',
        x: spot.x + rng.range(-16, 16),
        y: spot.y + rng.range(-14, 14),
        w: 36,
        h: 36,
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
        y: Math.round(ARENA_H * 0.36),
        w: 340,
        h: 54,
        dirX: dir,
        dirY: 0,
        phaseOffset: 0,
      },
      {
        id: roomIndex * 100 + 2,
        type: 'currents',
        x: ARENA_W / 2,
        y: Math.round(ARENA_H * 0.64),
        w: 340,
        h: 54,
        dirX: -dir,
        dirY: 0,
        phaseOffset: 0,
      },
    );
  }
  return hazards;
}

function buildBreakables(
  rng: SeededRng,
  roomIndex: number,
  kind: 'crate' | 'pillar',
  count: number,
): BreakableBlueprint[] {
  const presets =
    kind === 'pillar'
      ? [
          { x: Math.round(ARENA_W * 0.28), y: ARENA_H / 2 },
          { x: Math.round(ARENA_W * 0.72), y: ARENA_H / 2 },
        ]
      : [
          { x: Math.round(ARENA_W * 0.19), y: Math.round(ARENA_H * 0.25) },
          { x: Math.round(ARENA_W * 0.81), y: Math.round(ARENA_H * 0.25) },
          { x: Math.round(ARENA_W * 0.19), y: Math.round(ARENA_H * 0.75) },
          { x: Math.round(ARENA_W * 0.81), y: Math.round(ARENA_H * 0.75) },
        ];
  return presets.slice(0, count).map((p, idx) => ({
    id: roomIndex * 1000 + idx,
    x: p.x + rng.range(-10, 10),
    y: p.y + rng.range(-10, 10),
    hp: kind === 'pillar' ? 50 : 22,
    radius: kind === 'pillar' ? 22 : 16,
    kind,
  }));
}

function makeWave(rng: SeededRng, archetypes: EnemyArchetype[]): WaveSpawn[] {
  return archetypes.map((archetype) => {
    const pt = getSafeSpawnPoint(rng, archetype === 'boss');
    return { archetype, x: pt.x, y: pt.y };
  });
}

function connectNodes(a: DungeonRoomNode, dir: DoorDirection, b: DungeonRoomNode): void {
  a.doors[dir] = b.id;
  b.doors[oppositeDirection(dir)] = a.id;
}

export function buildDailyDungeonMap(utcDate: string, dailyHazard: HazardType): DailyDungeonMap {
  const rng = createDailyStream(utcDate, 'dungeon-map');
  const totalRooms = rng.int(6, 8);

  const emptyBlueprint = (roomIndex: number): RoomBlueprint => ({
    roomIndex,
    roomType: 'escalation',
    waves: [],
    hazards: [],
    breakables: [],
    rewardType: 'relics',
    hpScale: 1,
    hasHazard: false,
  });

  const nodes: DungeonRoomNode[] = [
    {
      id: 0,
      roomIndex: 1,
      gx: 0,
      gy: 0,
      bfsDist: 0,
      doors: {},
      blueprint: emptyBlueprint(1),
    },
  ];
  const grid = new Map<string, DungeonRoomNode>([['0,0', nodes[0]!]]);

  // Seed Room 1 with two guaranteed branches (north, east, or west)
  const startDirs = rng.shuffle(['north', 'east', 'west'] as const).slice(0, 2);
  for (const dir of startDirs) {
    const delta = DIR_DELTAS[dir];
    const id = nodes.length;
    const node: DungeonRoomNode = {
      id,
      roomIndex: id + 1,
      gx: delta.dx,
      gy: delta.dy,
      bfsDist: 1,
      doors: {},
      blueprint: emptyBlueprint(id + 1),
    };
    nodes.push(node);
    grid.set(`${node.gx},${node.gy}`, node);
    connectNodes(nodes[0]!, dir, node);
  }

  // Grow remaining rooms from Room 1's children so branches split naturally
  while (nodes.length < totalRooms) {
    const preferred: Array<{ parent: DungeonRoomNode; dir: DoorDirection; nx: number; ny: number }> = [];
    const fallback: Array<{ parent: DungeonRoomNode; dir: DoorDirection; nx: number; ny: number }> = [];

    for (const parent of nodes) {
      const deg = Object.keys(parent.doors).length;
      if (parent.id === 0 && deg >= 3) continue;
      for (const dir of ALL_DIRS) {
        const delta = DIR_DELTAS[dir];
        const nx = parent.gx + delta.dx;
        const ny = parent.gy + delta.dy;
        if (nx === 0 && ny === 1) continue;
        if (Math.abs(nx) > 2 || ny < -3 || ny > 1) continue;
        if (grid.has(`${nx},${ny}`)) continue;
        const cand = { parent, dir, nx, ny };
        if (parent.id >= 1 && deg < 3) {
          preferred.push(cand);
        } else {
          fallback.push(cand);
        }
      }
    }

    const pool = preferred.length > 0 ? preferred : fallback;
    if (pool.length === 0) break;

    const chosen = rng.pick(pool);
    const id = nodes.length;
    const node: DungeonRoomNode = {
      id,
      roomIndex: id + 1,
      gx: chosen.nx,
      gy: chosen.ny,
      bfsDist: chosen.parent.bfsDist + 1,
      doors: {},
      blueprint: emptyBlueprint(id + 1),
    };
    nodes.push(node);
    grid.set(`${node.gx},${node.gy}`, node);
    connectNodes(chosen.parent, chosen.dir, node);
  }

  // Optional shortcut loop between non-start neighbors
  if (nodes.length >= 6) {
    const loopCandidates: Array<{ a: DungeonRoomNode; dir: DoorDirection; b: DungeonRoomNode }> = [];
    for (const a of nodes) {
      if (a.id < 2 || Object.keys(a.doors).length >= 3) continue;
      for (const dir of ALL_DIRS) {
        if (a.doors[dir] !== undefined) continue;
        const delta = DIR_DELTAS[dir];
        const b = grid.get(`${a.gx + delta.dx},${a.gy + delta.dy}`);
        if (b && b.id >= 2 && Object.keys(b.doors).length < 3) {
          loopCandidates.push({ a, dir, b });
        }
      }
    }
    if (loopCandidates.length > 0 && rng.next() < 0.25) {
      const edge = rng.pick(loopCandidates);
      connectNodes(edge.a, edge.dir, edge.b);
    }
  }

  // Compute exact shortest BFS distances from Room 0
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

  // Rank non-start rooms farthest-first for special roles
  const ranked = nodes
    .filter((n) => n.id !== 0)
    .sort((a, b) => (a.bfsDist !== b.bfsDist ? b.bfsDist - a.bfsDist : b.id - a.id));

  const bossNode = ranked[0] ?? nodes[nodes.length - 1]!;
  const gauntletNode = ranked[1];
  const eliteNode = ranked[2];

  const bossRoomId = bossNode.id;

  for (const node of nodes) {
    const roomRng = createDailyStream(utcDate, `room-${node.roomIndex}`);
    if (node.id === 0) {
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'warmup',
        waves: [
          makeWave(roomRng, ['chaser', 'chaser', 'shooter']),
          makeWave(roomRng, ['chaser', 'shooter', 'chaser']),
        ],
        hazards: [],
        breakables: buildBreakables(roomRng, node.roomIndex, 'crate', 4),
        rewardType: 'relics',
        hpScale: 1,
        hasHazard: false,
      };
    } else if (node.id === bossRoomId) {
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'boss',
        waves: [[{ archetype: 'boss', x: ARENA_W / 2, y: 145 }]],
        hazards: [],
        breakables: buildBreakables(roomRng, node.roomIndex, 'pillar', 2),
        rewardType: 'boss_chest_and_portals',
        hpScale: 1,
        hasHazard: false,
      };
    } else if (gauntletNode && node.id === gauntletNode.id) {
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'gauntlet',
        waves: [
          makeWave(roomRng, ['chaser', 'chaser', 'shooter']),
          makeWave(roomRng, ['charger', 'shooter', 'chaser', 'shooter']),
        ],
        hazards: buildHazards(roomRng, dailyHazard, node.roomIndex),
        breakables: buildBreakables(roomRng, node.roomIndex, 'crate', 3),
        rewardType: 'fountain_and_relics',
        hpScale: 1.12,
        hasHazard: true,
      };
    } else if (eliteNode && node.id === eliteNode.id) {
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'elite',
        waves: [
          [
            { archetype: 'elite_charger', x: ARENA_W / 2, y: 145 },
            ...makeWave(roomRng, ['chaser', 'shooter']),
          ],
        ],
        hazards: [],
        breakables: buildBreakables(roomRng, node.roomIndex, 'crate', 4),
        rewardType: 'synergy_relics',
        hpScale: 1.08,
        hasHazard: false,
      };
    } else {
      const rewardType: RoomRewardType = roomRng.next() < 0.7 ? 'relics' : 'coin_cache';
      const waves =
        node.bfsDist <= 1
          ? [makeWave(roomRng, ['chaser', 'shooter', 'charger'])]
          : [
              makeWave(roomRng, ['chaser', 'shooter', 'charger']),
              makeWave(roomRng, ['chaser', 'chaser', 'shooter']),
            ];
      node.blueprint = {
        roomIndex: node.roomIndex,
        roomType: 'escalation',
        waves,
        hazards: buildHazards(roomRng, dailyHazard, node.roomIndex),
        breakables: buildBreakables(roomRng, node.roomIndex, 'crate', 3),
        rewardType,
        hpScale: 1 + 0.04 * node.bfsDist,
        hasHazard: true,
      };
    }
  }

  return {
    utcDate,
    totalRooms: nodes.length,
    startRoomId: 0,
    bossRoomId,
    rooms: nodes,
  };
}

export function buildEndlessRoomBlueprint(
  utcDate: string,
  endlessDepth: number,
  roomIndex: number,
  dailyHazard: HazardType,
): RoomBlueprint {
  const rng = createDailyStream(utcDate, `endless-${endlessDepth}-${roomIndex}`);
  const hpScale = 1 + Math.max(1, endlessDepth) * 0.25;
  const wave1: EnemyArchetype[] = ['chaser', 'shooter', 'charger', 'shooter'];
  const wave2: EnemyArchetype[] =
    endlessDepth % 2 === 0
      ? ['elite_charger', 'shooter', 'chaser', 'charger']
      : ['charger', 'charger', 'shooter', 'chaser', 'chaser'];

  return {
    roomIndex,
    roomType: 'endless',
    waves: [makeWave(rng, wave1), makeWave(rng, wave2)],
    hazards: buildHazards(rng, dailyHazard, roomIndex),
    breakables: buildBreakables(rng, roomIndex, 'crate', 3),
    rewardType: 'endless_relics_and_portals',
    hpScale,
    hasHazard: true,
  };
}

export function buildRoomBlueprint(
  utcDate: string,
  roomIndex: number,
  dailyHazard: HazardType,
): RoomBlueprint {
  const map = buildDailyDungeonMap(utcDate, dailyHazard);
  const found = map.rooms.find((r) => r.roomIndex === roomIndex);
  if (found) {
    return found.blueprint;
  }
  return buildEndlessRoomBlueprint(
    utcDate,
    Math.max(1, roomIndex - map.totalRooms),
    roomIndex,
    dailyHazard,
  );
}
