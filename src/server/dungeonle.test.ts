import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ARENA_H,
  ARENA_W,
  ATTACK_CD,
  DEATH_ANIM_DURATION,
  FIXED_DT,
  PLAYER_SPEED,
  PLAY_MAX_X,
  PLAY_MAX_Y,
  PLAY_MIN_X,
  PLAY_MIN_Y,
} from '../shared/game/constants.ts';
import { createEnemy } from '../shared/game/enemies.ts';
import {
  BIOME_SIGNATURE_ENEMY,
  buildDailyDungeonMap,
  CELL_SIZE,
  getBiomeIdForFloor,
  getDailyBiomeOrder,
  getFloorScaling,
  isNearDoorwayCell,
  isReservedCell,
  LAYOUT_COLS,
  LAYOUT_ROWS,
  oppositeDirection,
} from '../shared/game/rooms.ts';
import { GameSimulation } from '../shared/game/simulation.ts';
import {
  BUILD_ID,
  ENFORCE_SINGLE_DAILY_RUN,
  isDevResetAccount,
  isStampedBuildId,
} from '../shared/buildMeta.ts';
import {
  getDailyHazard,
  getDailyModifier,
  getDailyRule,
  resolveDailyWeapon,
} from '../shared/modifiers.ts';
import {
  applyRunToProfile,
  clearDailyRun,
  compareLeaderboardEntries,
  createDefaultProfile,
  getDailyRunSummary,
  getPlayerTitle,
  hasCompletedDailyRun,
  normalizeProfile,
  toLeaderboardEntry,
} from '../shared/profile.ts';
import { draftRelics, RELICS } from '../shared/relics.ts';
import { createDailyStream, formatTimeUntilNextUtcDay } from '../shared/rng.ts';
import { formatShareComment } from '../shared/share.ts';
import {
  applyShopAction,
  COSMETICS,
  COSMETIC_IDS,
  GACHA_PULL_COST,
} from '../shared/shop.ts';
import type { InputFrame, RunSummary } from '../shared/types.ts';
import { WEAPONS, WEAPON_IDS } from '../shared/weapons.ts';

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    utcDate: '2026-11-19',
    outcome: 'defeated',
    bossDefeated: false,
    floorReached: 1,
    roomsCleared: 2,
    floorsCleared: 0,
    roomReached: 3,
    progressPct: 40,
    totalRooms: 5,
    elapsedSec: 185,
    coinsEarned: 45,
    gemsEarned: 0,
    damageTaken: 100,
    enemiesKilled: 22,
    weapon: 'longsword',
    relics: {},
    score: 420,
    ...overrides,
  };
}

/** Kill everything in the current room and advance one frame so it registers as cleared. */
function clearRoom(sim: GameSimulation): void {
  sim.state.totalWaves = 1;
  sim.state.waveIndex = 0;
  sim.state.enemies = [];
  sim.step(idleInput());
}

function idleInput(overrides: Partial<InputFrame> = {}): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    aimX: 480,
    aimY: 200,
    hasPointerAim: false,
    actionDown: false,
    actionJustPressed: false,
    actionJustReleased: false,
    ...overrides,
  };
}

function stepFrames(sim: GameSimulation, count: number, inputFn: (i: number) => InputFrame): void {
  for (let i = 0; i < count; i += 1) {
    sim.step(inputFn(i), FIXED_DT);
  }
}

void describe('Deterministic Daily RNG & Floor Layouts', () => {
  void it('gives everyone the same floor layout for a date and differs across dates/floors', () => {
    const dateA = '2026-11-20';
    const dateB = '2026-11-25';
    const hazardA = getDailyHazard(dateA);
    const hazardB = getDailyHazard(dateB);
    const mapA = buildDailyDungeonMap(dateA, 1, hazardA);
    const mapB = buildDailyDungeonMap(dateB, 1, hazardB);

    assert.deepEqual(getDailyModifier(dateA), getDailyModifier(dateA));
    assert.equal(hazardA, getDailyHazard(dateA));
    assert.deepEqual(mapA, buildDailyDungeonMap(dateA, 1, hazardA));
    assert.notDeepEqual(mapA, buildDailyDungeonMap(dateA, 2, hazardA));

    const differs =
      getDailyModifier(dateA).id !== getDailyModifier(dateB).id ||
      hazardA !== hazardB ||
      JSON.stringify(mapA) !== JSON.stringify(mapB);
    assert.equal(differs, true);
  });

  void it('builds Binding of Isaac style branching floors with dead-end boss/special rooms and no 2x2 blobs', () => {
    let deadEnds = 0;
    let floors = 0;
    for (const date of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-12-01']) {
      for (let floor = 1; floor <= 12; floor += 1) {
        const map = buildDailyDungeonMap(date, floor, getDailyHazard(date));
        floors += 1;
        assert.equal(map.floor, floor);
        assert.ok(map.totalRooms >= 5 && map.totalRooms <= 8, `${date} F${floor}: ${map.totalRooms}`);
        assert.equal(map.rooms.length, map.totalRooms);
        const start = map.rooms.find((r) => r.id === map.startRoomId)!;
        const startDoors = Object.keys(start.doors).length;
        if (floor === 1) assert.equal(startDoors, 1, 'floor 1 entrance has exactly one exit');
        else assert.ok(startDoors >= 1 && startDoors <= 3);
        assert.equal(start.doors.south, undefined, 'entrance never puts a south door behind player spawn');

        // Verify connected graph via BFS and verify no 2x2 room blobs exist on the floor grid.
        const visited = new Set<number>([map.startRoomId]);
        const q = [map.startRoomId];
        while (q.length > 0) {
          const id = q.shift()!;
          const node = map.rooms.find((r) => r.id === id)!;
          for (const target of Object.values(node.doors)) {
            if (target !== undefined && !visited.has(target)) {
              visited.add(target);
              q.push(target);
            }
          }
        }
        assert.equal(visited.size, map.rooms.length, `${date} F${floor} must be fully connected`);

        const coords = new Set(map.rooms.map((r) => `${r.gx},${r.gy}`));
        for (const r of map.rooms) {
          const has2x2 =
            coords.has(`${r.gx + 1},${r.gy}`) &&
            coords.has(`${r.gx},${r.gy + 1}`) &&
            coords.has(`${r.gx + 1},${r.gy + 1}`);
          assert.equal(has2x2, false, `${date} F${floor} contains a 2x2 room blob at (${r.gx},${r.gy})`);
        }

        const boss = map.rooms.find((r) => r.id === map.bossRoomId)!;
        assert.equal(boss.blueprint.roomType, 'boss');
        const floorDeadEnds = map.rooms.filter((r) => r.id !== 0 && Object.keys(r.doors).length === 1);
        assert.ok(floorDeadEnds.length >= 1, `${date} F${floor} must have dead-end rooms`);
        assert.equal(Object.keys(boss.doors).length, 1, 'boss room must always be a dead-end');
        assert.equal(
          boss.bfsDist,
          Math.max(...floorDeadEnds.map((r) => r.bfsDist)),
          'boss room sits at the dead-end farthest from entrance',
        );
        assert.equal(
          map.rooms.filter((r) => r.blueprint.waves.flat().some((w) => w.archetype === 'boss')).length,
          1,
          'exactly one boss per floor',
        );
        deadEnds += floorDeadEnds.length;
      }
    }
    assert.ok(deadEnds / floors >= 1.5, `Isaac floors should have branching dead-end rooms (avg ${deadEnds / floors})`);
  });

  void it('varies room layouts and never blocks perimeter, corners, doorways, centre or spawns', () => {
    const layouts = new Set<string>();
    const warden = createEnemy(1, 'elite_charger', 300, 200, 1, 1, 1, 1);
    assert.ok(warden.radius <= 20, `Armored Warden hitbox too large: ${warden.radius}`);
    for (const date of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-12-01']) {
      for (let floor = 1; floor <= 6; floor += 1) {
        const map = buildDailyDungeonMap(date, floor, getDailyHazard(date));
        for (const room of map.rooms) {
          const bp = room.blueprint;
          layouts.add(bp.layout);
          if (floor === 1 && room.id === map.startRoomId) assert.equal(bp.layout, 'open');
          for (const o of bp.obstacles) {
            const i = o.x / CELL_SIZE - 1;
            const j = o.y / CELL_SIZE - 1;
            assert.ok(Number.isInteger(i) && Number.isInteger(j), 'blocks sit on the tile grid');
            assert.equal(isReservedCell(i, j), false, `${date} F${floor} R${room.roomIndex} blocks a reserved cell`);
            assert.ok(i > 0 && i < LAYOUT_COLS - 1 && j > 0 && j < LAYOUT_ROWS - 1, 'no blocks on perimeter ring');
            assert.equal(isNearDoorwayCell(i, j), false, 'no blocks near doorways');
          }
          const overlaps = (x: number, y: number, r: number): boolean =>
            bp.obstacles.some((o) => {
              const cx = Math.max(o.x, Math.min(o.x + o.w, x));
              const cy = Math.max(o.y, Math.min(o.y + o.h, y));
              return Math.hypot(x - cx, y - cy) < r;
            });
          for (const spawn of bp.waves.flat()) assert.equal(overlaps(spawn.x, spawn.y, 15), false, 'enemy spawned in a block');
          for (const br of bp.breakables) {
            assert.equal(overlaps(br.x, br.y, br.radius), false, 'crate inside a block');
            const bi = (br.x - CELL_SIZE / 2) / CELL_SIZE - 1;
            const bj = (br.y - CELL_SIZE / 2) / CELL_SIZE - 1;
            assert.equal(isNearDoorwayCell(bi, bj), false, 'crate near doorway');
          }
          for (const haz of bp.hazards) {
            if (haz.type === 'spikes' || haz.type === 'barrels') {
              const hi = (haz.x - CELL_SIZE / 2) / CELL_SIZE - 1;
              const hj = (haz.y - CELL_SIZE / 2) / CELL_SIZE - 1;
              assert.equal(isNearDoorwayCell(hi, hj), false, 'hazard near doorway');
            }
          }
        }
      }
    }
    assert.ok(layouts.size >= 5, `expected varied layouts, got ${[...layouts].join(', ')}`);
  });

  void it('blocks stop the player and projectiles', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    const block = { id: 1, x: 200, y: 200, w: 48, h: 48 };
    sim.state.obstacles = [block];
    sim.state.enemies = [];
    sim.state.totalWaves = 5;
    sim.state.player.x = 170;
    sim.state.player.y = 224;
    sim.state.player.iFramesTimer = 99;
    stepFrames(sim, 60, () => idleInput({ moveX: 1 }));
    assert.ok(sim.state.player.x <= block.x - sim.state.player.radius + 0.5, 'player stopped at the block');
    sim.state.projectiles = [
      { id: 77, friendly: false, x: 300, y: 224, vx: -400, vy: 0, radius: 7, damage: 10, ttl: 2, pierce: false, hitEnemyIds: [], kind: 'orb', angle: Math.PI },
    ];
    stepFrames(sim, 30, () => idleInput());
    assert.equal(sim.state.projectiles.some((pr) => pr.id === 77), false, 'projectile destroyed by the block');
    assert.equal(sim.state.player.hp, sim.state.player.maxHp, 'block took the hit');
  });

  void it('drafts the very rare Concussion relic far less often than normal relics', () => {
    const counts: Record<string, number> = {};
    const all = Object.keys(RELICS) as Array<keyof typeof RELICS>;
    for (let i = 0; i < 4000; i += 1) {
      for (const r of draftRelics(createDailyStream(`d${i}`, 'x'), all, 3)) {
        counts[r.id] = (counts[r.id] ?? 0) + 1;
      }
    }
    assert.ok((counts.concussion ?? 0) < (counts.ember_wake ?? 0) / 4);
    assert.ok((counts.concussion ?? 0) > 0);
  });

  void it('scales enemies and bosses up with each floor', () => {
    const f1 = getFloorScaling(1);
    const f5 = getFloorScaling(5);
    assert.equal(f1.hpScale, 1);
    assert.ok(f5.hpScale > f1.hpScale);
    assert.ok(f5.bossHpScale > f5.hpScale);
    assert.ok(f5.damageMult > f1.damageMult);
    assert.ok(f5.coinMult > f1.coinMult);
    const date = '2026-11-20';
    const boss1 = buildDailyDungeonMap(date, 1, getDailyHazard(date));
    const boss4 = buildDailyDungeonMap(date, 4, getDailyHazard(date));
    const bp1 = boss1.rooms.find((r) => r.id === boss1.bossRoomId)!.blueprint;
    const bp4 = boss4.rooms.find((r) => r.id === boss4.bossRoomId)!.blueprint;
    assert.ok(bp4.hpScale > bp1.hpScale);
  });
});

void describe('Simple WASD + 1-Button Manual Attack Combat', () => {
  void it('does NOT auto-attack idle enemies and does NOT dash when pressing attack', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.player.iFramesTimer = 0;

    const enemy = createEnemy(900, 'chaser', sim.state.player.x + 48, sim.state.player.y, 1, 1, 1, 1);
    enemy.spawnShieldTimer = 0;
    enemy.state = 'staggered';
    enemy.stateTimer = 2;
    sim.state.enemies = [enemy];
    sim.state.totalWaves = 1;

    stepFrames(sim, 45, () => idleInput());
    assert.equal(enemy.hp, enemy.maxHp);
    assert.equal(sim.state.slashes.length, 0);

    const startY = sim.state.player.y;
    sim.step(idleInput({ actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.iFramesTimer, 0);
    assert.equal(sim.state.player.y, startY);
    assert.ok(Math.abs(sim.state.player.vy) <= PLAYER_SPEED + 1);
  });

  void it('swings manually in facing/aim direction, knocks back foes, and chips Warden armor in 3 hits', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });

    sim.state.player.x = 480;
    sim.state.player.y = 350;
    const elite = createEnemy(998, 'elite_charger', 480, 275, 1, 1, 1, 1);
    elite.spawnShieldTimer = 0;
    elite.state = 'chase';
    sim.state.enemies = [elite];
    sim.state.totalWaves = 1;

    // 1st manual swing upward -> chips 1 armor plate (3 -> 2)
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.swingCount, 1);
    assert.ok(sim.state.player.attackCooldown > 0);
    assert.equal(elite.armor, 2);
    assert.ok(elite.hp < elite.maxHp);

    // Wait out cooldown + bring elite back in range, then 2nd and 3rd swings
    const cdFrames = Math.ceil((ATTACK_CD * sim.state.modifier.attackCdMult) / FIXED_DT) + 2;
    stepFrames(sim, cdFrames, () => idleInput());
    elite.x = 480;
    elite.y = 275;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(elite.armor, 1);

    stepFrames(sim, cdFrames, () => idleInput());
    elite.x = 480;
    elite.y = 275;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(elite.armor, 0);
    // Only the War Hammer (or the very rare Concussion relic) stuns.
    assert.notEqual(elite.state, 'staggered');
    assert.ok(sim.state.hitstopTimer > 0);
  });

  void it('enforces endlag slowdown and blocks hold-to-spamming past cooldown', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });

    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.swingCount, 1);
    assert.ok(sim.state.player.attackEndlagTimer > 0);

    // During active/endlag window, movement is slowed and extra presses don't swing early
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.swingCount, 1);
    assert.ok(Math.abs(sim.state.player.vy) < PLAYER_SPEED * 0.7);

    // Holding actionDown across full cooldown must NOT auto-repeat swings
    const cdFrames = Math.ceil((ATTACK_CD * sim.state.modifier.attackCdMult) / FIXED_DT) + 4;
    stepFrames(sim, cdFrames, () => idleInput({ actionDown: true }));
    assert.equal(sim.state.player.attackCooldown, 0);
    assert.equal(sim.state.player.swingCount, 1);

    // A fresh tap after cooldown triggers Swing 2
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.swingCount, 2);
  });
});

void describe('Attack Relics (Blade & Arcane)', () => {
  void it('activates ember_wake, arc_conduit, blood_reset, and triggers phantom_echo/decoy_mine/volt_nova on melee hits (never air whiffs)', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });

    sim.state.player.relics = {
      ember_wake: 1,
      arc_conduit: 1,
      blood_reset: 1,
      decoy_mine: 1,
      phantom_echo: 1,
      volt_nova: 1,
    };
    sim.state.totalWaves = 1;
    sim.state.enemies = [];

    const cdFrames = Math.ceil((ATTACK_CD * sim.state.modifier.attackCdMult) / FIXED_DT) + 2;

    // 3 empty-air whiffs must NEVER increment meleeHitCount or proc every-N-hit relics
    for (let i = 0; i < 3; i += 1) {
      sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
      stepFrames(sim, cdFrames, () => idleInput());
    }
    assert.equal(sim.state.player.swingCount, 3);
    assert.equal(sim.state.player.meleeHitCount, 0);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'phantom_echo'), false);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'decoy_mine'), false);
    assert.equal(sim.state.rings.some((r) => r.color === '#38bdf8'), false);

    const e1 = createEnemy(1001, 'chaser', sim.state.player.x, sim.state.player.y - 45, 1, 1, 1, 1);
    e1.hp = 10;
    e1.spawnShieldTimer = 0;
    e1.state = 'chase';

    const e2 = createEnemy(1002, 'chaser', sim.state.player.x + 115, sim.state.player.y - 45, 1, 1, 1, 1);
    e2.hp = 150;
    e2.maxHp = 150;
    e2.spawnShieldTimer = 0;
    e2.state = 'chase';

    sim.state.enemies = [e1, e2];

    // Hit 1: kills e1 -> blood_reset clears cooldown; ember_wake + arc_conduit fire; no 2nd/3rd hit procs yet
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.meleeHitCount, 1);
    assert.equal(sim.state.player.attackCooldown, 0);
    assert.ok(sim.state.firePatches.length > 0);
    assert.ok(sim.state.lightnings.length > 0);
    assert.ok(e2.hp < e2.maxHp);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'phantom_echo'), false);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'decoy_mine'), false);

    // Hit 2 (allowed early thanks to blood_reset): hitting e2 increments meleeHitCount to 2 -> triggers phantom_echo
    stepFrames(sim, 3, () => idleInput());
    e2.x = sim.state.player.x;
    e2.y = sim.state.player.y - 48;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.meleeHitCount, 2);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'phantom_echo'), true);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'decoy_mine'), false);

    // Hit 3: wait cooldown, hit e2 again -> meleeHitCount reaches 3 -> triggers decoy_mine & volt_nova
    stepFrames(sim, cdFrames, () => idleInput());
    e2.x = sim.state.player.x;
    e2.y = sim.state.player.y - 48;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.meleeHitCount, 3);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'decoy_mine'), true);
    assert.equal(sim.state.rings.some((r) => r.color === '#38bdf8' && r.maxRadius === 95), true);

    // Multi-hit threshold crossing (2 -> 4 hits in one cleave still triggers 3rd-hit relics)
    sim.state.delayedBlasts = [];
    sim.state.rings = [];
    sim.state.player.meleeHitCount = 2;
    stepFrames(sim, cdFrames, () => idleInput());
    const m1 = createEnemy(1003, 'chaser', sim.state.player.x - 16, sim.state.player.y - 48, 1, 1, 1, 1);
    const m2 = createEnemy(1004, 'chaser', sim.state.player.x + 16, sim.state.player.y - 48, 1, 1, 1, 1);
    m1.hp = 150;
    m2.hp = 150;
    m1.spawnShieldTimer = 0;
    m2.spawnShieldTimer = 0;
    m1.state = 'chase';
    m2.state = 'chase';
    sim.state.enemies = [m1, m2];
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.meleeHitCount, 4);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'decoy_mine'), true);
    assert.equal(sim.state.rings.some((r) => r.color === '#38bdf8' && r.maxRadius === 95), true);
  });

  void it('activates rift_cleave, vortex_slam, mirror_guard, reaper_siphon, shatter_quake, and golden_cleave on swing', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });

    sim.state.player.x = 480;
    sim.state.player.y = 340;
    sim.state.player.hp = 60;
    sim.state.player.facingX = 0;
    sim.state.player.facingY = -1;
    sim.state.player.relics = {
      rift_cleave: 1,
      vortex_slam: 1,
      mirror_guard: 1,
      reaper_siphon: 1,
      shatter_quake: 1,
      golden_cleave: 1,
    };

    const e1 = createEnemy(1101, 'charger', 460, 235, 1, 1, 1, 1);
    const e2 = createEnemy(1102, 'charger', 505, 240, 1, 1, 1, 1);
    e1.spawnShieldTimer = 0;
    e2.spawnShieldTimer = 0;
    sim.state.enemies = [e1, e2];
    sim.state.totalWaves = 1;

    const startDist = Math.hypot(e1.x - sim.state.player.x, e1.y - sim.state.player.y);

    sim.state.projectiles.push({
      id: 7777,
      friendly: false,
      x: 545,
      y: 300,
      vx: -120,
      vy: 120,
      radius: 7,
      damage: 14,
      ttl: 2,
      pierce: false,
      hitEnemyIds: [],
      kind: 'orb',
      angle: Math.PI / 2,
    });

    sim.step(idleInput({ actionDown: true, actionJustPressed: true }));

    const pulledDist = Math.hypot(e1.x - sim.state.player.x, e1.y - sim.state.player.y);
    assert.ok(pulledDist < startDist);
    assert.equal(
      sim.state.projectiles.some((pr) => pr.friendly && pr.kind === 'rift_wave'),
      true,
    );
    assert.equal(
      sim.state.projectiles.some((pr) => pr.friendly && pr.id === 7777),
      true,
    );
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'shatter_quake'), true);
    assert.ok(sim.state.coins.length > 0);
    assert.ok(sim.state.player.hp > 60);
  });
});

void describe('Floors: rooms, relics, boss, stairs and descent', () => {
  void it('clears rooms, claims relics, beats the boss, and descends to a harder floor', () => {
    const utcDate = '2026-11-20';
    const profile = createDefaultProfile();
    const map = buildDailyDungeonMap(utcDate, 1, getDailyHazard(utcDate));
    const sim = new GameSimulation(utcDate, profile);
    sim.startNewRun(utcDate, profile, { ignoreDailyWeaponRule: true });

    assert.equal(sim.state.floor, 1);
    assert.equal(sim.state.progressPct, 0);
    assert.equal(sim.state.doors.length, 1, 'entrance has one exit');

    // Entrance pays out a coin cache and opens its single door.
    clearRoom(sim);
    assert.equal(sim.state.roomState, 'door_open');
    assert.equal(sim.state.roomsClearedTotal, 1);
    assert.equal(sim.state.progressPct, Math.round((1 / map.totalRooms) * 100));

    const doorCoords = {
      north: { x: ARENA_W / 2, y: PLAY_MIN_Y + 8 },
      south: { x: ARENA_W / 2, y: PLAY_MAX_Y - 8 },
      west: { x: PLAY_MIN_X + 8, y: ARENA_H / 2 },
      east: { x: PLAY_MAX_X - 8, y: ARENA_H / 2 },
    };
    stepFrames(sim, 22, () => idleInput());
    const door = sim.state.doors[0];
    assert.ok(door !== undefined);
    sim.state.player.x = doorCoords[door.dir].x;
    sim.state.player.y = doorCoords[door.dir].y;
    sim.step(idleInput());
    assert.equal(sim.state.currentRoomId, door.targetRoomId);
    stepFrames(sim, 40, () => idleInput());

    // Walking back through the door returns to the cleared entrance.
    clearRoom(sim);
    if (sim.state.currentRoomId !== map.bossRoomId) {
      assert.equal(sim.state.pedestals.length, 0, 'relics only drop between floors');
      assert.equal(sim.state.roomState, 'door_open');
    }
    stepFrames(sim, 22, () => idleInput());
    const back = oppositeDirection(door.dir);
    sim.state.player.x = doorCoords[back].x;
    sim.state.player.y = doorCoords[back].y;
    sim.step(idleInput());
    assert.equal(sim.state.currentRoomId, map.startRoomId);
    assert.equal(sim.state.enemies.length, 0);
    stepFrames(sim, 40, () => idleInput());

    // Boss: heal, relic draft, then stairs appear after claiming.
    sim.enterMapRoom(map.bossRoomId);
    sim.state.player.hp = 30;
    clearRoom(sim);
    assert.equal(sim.state.stats.bossDefeated, true);
    assert.equal(sim.state.floorsCleared, 1);
    assert.ok(sim.state.player.hp > 30, 'boss kill heals');
    assert.equal(sim.state.roomState, 'reward');
    assert.equal(sim.state.portals.length, 0, 'stairs wait for the relic pick');
    const bossRelic = sim.state.pedestals[1]!;
    sim.state.player.x = bossRelic.x;
    sim.state.player.y = bossRelic.y + 56;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.roomState, 'boss_choice');
    assert.deepEqual(
      sim.state.portals.map((p) => p.kind),
      ['stairs'],
    );

    const stairs = sim.state.portals[0]!;
    sim.state.player.x = stairs.x;
    sim.state.player.y = stairs.y;
    stepFrames(sim, 30, () => idleInput());
    assert.equal(sim.state.floor, 2);
    assert.equal(sim.state.roomTransitionKind, 'portal');
    assert.equal(sim.state.clearedRooms, 0);
    assert.equal(sim.state.roomType, 'warmup');
    assert.ok(sim.state.modifier.enemyDamageMult > getDailyModifier(utcDate).enemyDamageMult);
    const floor2 = buildDailyDungeonMap(utcDate, 2, getDailyHazard(utcDate));
    assert.equal(sim.state.totalRooms, floor2.totalRooms);
    assert.ok(Object.keys(sim.state.player.relics).length >= 1, 'relics carry between floors');

    const summary = sim.getRunSummary();
    assert.equal(summary.floorReached, 2);
    assert.equal(summary.floorsCleared, 1);
    assert.ok(summary.roomsCleared >= 3);
    assert.equal(summary.weapon, 'longsword');
  });

  void it('crates sometimes drop hearts that heal on pickup', () => {
    const utcDate = '2026-11-20';
    const profile = createDefaultProfile();
    const sim = new GameSimulation(utcDate, profile);
    sim.startNewRun(utcDate, profile, { ignoreDailyWeaponRule: true });
    let hearts = 0;
    for (let i = 0; i < 40 && hearts === 0; i += 1) {
      sim.state.breakables = [
        { id: 5000 + i, x: sim.state.player.x, y: sim.state.player.y - 50, hp: 1, maxHp: 1, radius: 16, kind: 'crate', hitFlash: 0 },
      ];
      sim.state.player.attackCooldown = 0;
      sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
      stepFrames(sim, 40, () => idleInput());
      hearts = sim.state.hearts.length;
    }
    assert.ok(hearts > 0, 'some crate should have dropped a heart');
    const heart = sim.state.hearts[0]!;
    sim.state.player.hp = 50;
    sim.state.player.x = heart.x;
    sim.state.player.y = heart.y;
    sim.step(idleInput());
    assert.equal(sim.state.hearts.length, 0);
    assert.ok(sim.state.player.hp > 50, 'heart heals');
  });

  void it('keeps going: floors are endless', () => {
    const utcDate = '2026-11-21';
    const profile = createDefaultProfile();
    const sim = new GameSimulation(utcDate, profile);
    sim.startNewRun(utcDate, profile, { ignoreDailyWeaponRule: true });
    for (let i = 0; i < 6; i += 1) {
      const map = buildDailyDungeonMap(utcDate, sim.state.floor, getDailyHazard(utcDate));
      sim.enterMapRoom(map.bossRoomId);
      clearRoom(sim);
      const ped = sim.state.pedestals[0];
      if (ped) {
        sim.state.player.x = ped.x;
        sim.state.player.y = ped.y + 56;
        sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
      }
      const stairs = sim.state.portals[0]!;
      sim.state.player.x = stairs.x;
      sim.state.player.y = stairs.y;
      stepFrames(sim, 70, () => idleInput());
      sim.state.player.hp = sim.state.player.maxHp;
    }
    assert.equal(sim.state.floor, 7);
    assert.equal(sim.getRunSummary().floorsCleared, 6);
  });

  void it('plays death sequence before ending run and ignores input while dying', () => {
    const profile = createDefaultProfile();
    const endedSummaries: string[] = [];
    const sim = new GameSimulation('2026-11-20', profile, (summary) => {
      endedSummaries.push(summary.outcome);
    });
    sim.startNewRun('2026-11-20', profile);
    sim.state.player.iFramesTimer = 0;
    sim.state.player.shields = 0;
    sim.state.player.hp = 5;

    const chaser = createEnemy(
      2001,
      'chaser',
      sim.state.player.x,
      sim.state.player.y,
      1,
      1,
      1,
      1,
    );
    chaser.spawnShieldTimer = 0;
    chaser.state = 'attack';
    chaser.attackKind = 'lunge';
    chaser.stateTimer = 0.2;
    chaser.attackFired = false;
    sim.state.enemies = [chaser];
    sim.state.totalWaves = 1;

    sim.step(idleInput());
    assert.equal(sim.state.phase, 'dying');
    assert.equal(sim.state.deathTimer, DEATH_ANIM_DURATION);
    assert.equal(endedSummaries.length, 0);

    const frozenElapsed = sim.state.elapsedTime;
    const frozenX = sim.state.player.x;
    const swingsBefore = sim.state.player.swingCount;

    // Input during dying does not move, swing, or advance speedrun timer
    stepFrames(sim, 20, () =>
      idleInput({ moveX: 1, actionDown: true, actionJustPressed: true }),
    );
    assert.equal(sim.state.elapsedTime, frozenElapsed);
    assert.equal(sim.state.player.x, frozenX);
    assert.equal(sim.state.player.swingCount, swingsBefore);
    assert.equal(sim.state.phase, 'dying');
    assert.equal(endedSummaries.length, 0);

    // Step remaining hitstop + death duration to finish the run cleanly
    const totalDeathFrames = Math.ceil((0.14 + DEATH_ANIM_DURATION) / FIXED_DT) + 4;
    stepFrames(sim, totalDeathFrames, () => idleInput());
    assert.equal(sim.state.phase, 'ended');
    assert.deepEqual(endedSummaries, ['defeated']);
  });
});

void describe('Coins, gems, streaks, titles & leaderboard', () => {
  void it('banks coins and gems on death, tracks best floor, and updates UTC streaks', () => {
    let profile = createDefaultProfile();
    assert.equal(hasCompletedDailyRun(profile, '2026-11-19'), false);

    profile = applyRunToProfile(
      profile,
      makeSummary({ coinsEarned: 45, gemsEarned: 1, floorReached: 2, floorsCleared: 1 }),
    );
    assert.equal(ENFORCE_SINGLE_DAILY_RUN, false);
    assert.equal(profile.coins, 45);
    assert.equal(profile.gems, 1);
    assert.equal(profile.bestFloor, 2);
    assert.equal(profile.totalClears, 1);
    assert.equal(profile.streak, 1);
    assert.equal(hasCompletedDailyRun(profile, '2026-11-19'), true);
    assert.equal(getDailyRunSummary(profile, '2026-11-19')?.floorReached, 2);

    const locked = applyRunToProfile(
      profile,
      makeSummary({ coinsEarned: 999, floorReached: 9 }),
      { enforceSingleDailyRun: true },
    );
    assert.equal(locked.coins, 45);
    assert.equal(locked.bestFloor, 2);

    const replay = applyRunToProfile(profile, makeSummary({ coinsEarned: 25, floorReached: 1 }));
    assert.equal(replay.coins, 70);
    assert.equal(replay.bestFloor, 2, 'best floor never goes down');
    assert.equal(replay.dailyBest['2026-11-19']?.bestFloor, 2);

    profile = applyRunToProfile(profile, makeSummary({ utcDate: '2026-11-20', floorReached: 4 }));
    assert.equal(profile.streak, 2);
    assert.equal(profile.bestFloor, 4);
    profile = applyRunToProfile(profile, makeSummary({ utcDate: '2026-11-23' }));
    assert.equal(profile.streak, 1, 'missing a day resets the streak');

    const cleared = clearDailyRun(profile, '2026-11-19');
    assert.equal(hasCompletedDailyRun(cleared, '2026-11-19'), false);
    assert.equal(cleared.coins, profile.coins);

    assert.equal(isDevResetAccount('Mental_Glove6343'), true);
    assert.equal(isDevResetAccount('OtherUser'), false);
    assert.equal(isStampedBuildId(BUILD_ID), false);
    assert.equal(isStampedBuildId('client-12345-1'), true);
    assert.equal(formatTimeUntilNextUtcDay(Date.UTC(2026, 10, 21, 22, 30, 15)), '01:29:45');
  });

  void it('earns titles from the deepest floor ever reached', () => {
    assert.equal(getPlayerTitle(0).title, 'Fresh Recruit');
    assert.equal(getPlayerTitle(1).title, 'Fresh Recruit');
    assert.equal(getPlayerTitle(2).title, 'Dungeon Delver');
    assert.equal(getPlayerTitle(5).title, 'Depth Stalker');
    assert.equal(getPlayerTitle(10).title, 'Dungeon Legend');
    assert.equal(getPlayerTitle(10).next, null);
    assert.equal(getPlayerTitle(3).next?.minFloor, 5);
  });

  void it('ranks the leaderboard by deepest floor, then rooms, then time', () => {
    const rows = [
      toLeaderboardEntry('a', makeSummary({ floorReached: 2, roomsCleared: 7, elapsedSec: 300 })),
      toLeaderboardEntry('b', makeSummary({ floorReached: 3, roomsCleared: 9, elapsedSec: 500 })),
      toLeaderboardEntry('c', makeSummary({ floorReached: 2, roomsCleared: 8, elapsedSec: 400 })),
      toLeaderboardEntry('d', makeSummary({ floorReached: 2, roomsCleared: 8, elapsedSec: 350 })),
    ].sort(compareLeaderboardEntries);
    assert.deepEqual(
      rows.map((r) => r.player),
      ['b', 'd', 'c', 'a'],
    );
  });

  void it('migrates old saves that had stat upgrades and consumables', () => {
    const migrated = normalizeProfile(
      JSON.parse(
        '{"coins":120,"upgrades":{"vitality":3},"pendingConsumable":"fury_charm","ownedCosmetics":["none","crown_crest"],"equippedCosmetic":"crown_crest","streak":4}',
      ),
    );
    assert.equal(migrated.coins, 120);
    assert.equal(migrated.streak, 4);
    assert.deepEqual(migrated.ownedWeapons, ['longsword']);
    assert.equal(migrated.equippedWeapon, 'longsword');
    assert.equal(migrated.equippedCosmetic, 'crown_crest');
    assert.equal(migrated.gems, 0);
    assert.equal('upgrades' in migrated, false);
  });
});

void describe('Shop: weapons, relic unlocks, gacha', () => {
  void it('sells weapons once, equips them, and never sells stat upgrades', () => {
    let profile = { ...createDefaultProfile(), coins: 1000 };
    const noop = () => 0;
    assert.equal(applyShopAction(profile, { action: 'equip_weapon', weaponId: 'dagger' }, noop).ok, false);
    const buy = applyShopAction(profile, { action: 'buy_weapon', weaponId: 'dagger' }, noop);
    assert.equal(buy.ok, true);
    profile = buy.profile;
    assert.equal(profile.coins, 1000 - WEAPONS.dagger.cost);
    assert.equal(profile.equippedWeapon, 'dagger');
    assert.equal(applyShopAction(profile, { action: 'buy_weapon', weaponId: 'dagger' }, noop).ok, false);
    profile = applyShopAction(profile, { action: 'equip_weapon', weaponId: 'longsword' }, noop).profile;
    assert.equal(profile.equippedWeapon, 'longsword');
    const poor = applyShopAction(
      { ...profile, coins: 10 },
      { action: 'buy_weapon', weaponId: 'arcane_lance' },
      noop,
    );
    assert.equal(poor.ok, false);
    assert.equal(poor.reason, 'Not enough coins.');
  });

  void it('keeps melee weapons as sidegrades and ranged weapons weaker', () => {
    const dps = (id: (typeof WEAPON_IDS)[number]): number => {
      const w = WEAPONS[id];
      return (w.damage * (w.projectile?.count ?? 1)) / w.cooldown;
    };
    const melee = WEAPON_IDS.filter((id) => WEAPONS[id].style === 'melee').map(dps);
    const ranged = WEAPON_IDS.filter((id) => WEAPONS[id].style === 'ranged').map(dps);
    assert.ok(Math.max(...melee) / Math.min(...melee) < 1.35, `melee spread: ${melee.join(', ')}`);
    assert.ok(Math.max(...ranged) < Math.min(...melee), 'ranged must deal less than any melee');
    for (const id of WEAPON_IDS) {
      if (WEAPONS[id].style === 'ranged') assert.equal(WEAPONS[id].staggerSec, 0);
    }
  });

  void it('ranged hits never stun enemies', () => {
    const profile = { ...createDefaultProfile(), ownedWeapons: ['longsword' as const, 'arcane_lance' as const], equippedWeapon: 'arcane_lance' as const };
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    const target = createEnemy(9001, 'chaser', sim.state.player.x, sim.state.player.y - 120, 5, 1, 1, 1);
    target.spawnShieldTimer = 0;
    target.state = 'chase';
    sim.state.enemies = [target];
    sim.state.totalWaves = 2;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    stepFrames(sim, 20, () => idleInput());
    assert.ok(target.hp < target.maxHp, 'lance bolt should hit');
    assert.notEqual(target.state, 'staggered');
  });

  void it('every relic is always in the draft pool (relics are not sold)', () => {
    const fresh = createDefaultProfile();
    assert.equal(fresh.unlockedRelics.length, Object.keys(RELICS).length);
    const migrated = normalizeProfile({ unlockedRelics: ['ember_wake'] });
    assert.equal(migrated.unlockedRelics.length, Object.keys(RELICS).length);
  });

  void it('gacha spends gems for cosmetics only and refunds duplicates', () => {
    let profile = { ...createDefaultProfile(), gems: GACHA_PULL_COST * 2 };
    const first = applyShopAction(profile, { action: 'gacha_pull' }, () => 0.99);
    assert.equal(first.ok, true);
    assert.ok(first.cosmeticId !== undefined && COSMETIC_IDS.includes(first.cosmeticId as never));
    profile = first.profile;
    assert.equal(profile.gems, GACHA_PULL_COST);
    assert.ok(profile.ownedCosmetics.includes(first.cosmeticId!));
    const coinsBefore = profile.coins;
    const dupe = applyShopAction(profile, { action: 'gacha_pull' }, () => 0.99);
    assert.equal(dupe.ok, true);
    assert.equal(dupe.duplicate, true);
    assert.ok(dupe.profile.coins > coinsBefore);
    assert.equal(applyShopAction(dupe.profile, { action: 'gacha_pull' }, () => 0.5).ok, false);
    const equip = applyShopAction(
      dupe.profile,
      { action: 'equip_cosmetic', cosmeticId: first.cosmeticId!, slot: 'accessory' },
      () => 0,
    );
    assert.equal(equip.ok, true);
    const slotField =
      equip.profile.equippedCostume === first.cosmeticId ? 'costume' : 'accessory';
    assert.ok(slotField === 'costume' || equip.profile.equippedCosmetic === first.cosmeticId);
  });

  void it('formats the share comment around floor depth', () => {
    const text = formatShareComment(
      makeSummary({ utcDate: '2026-11-20', floorReached: 4, floorsCleared: 3, roomsCleared: 17, elapsedSec: 412, gemsEarned: 2 }),
      'The Archives',
      'Glass Cannon: 2x Damage',
      'KC',
      2,
    );
    assert.ok(text.includes('DUNGEONLE 2026-11-20'));
    assert.ok(text.includes('REACHED FLOOR 4'));
    assert.ok(text.includes('17 rooms'));
    assert.ok(text.includes('6:52'));
    assert.ok(text.includes('+2 💎'));
    assert.ok(text.includes('2🔥'));
  });

  void it('ships complete 20x20 costume sheets and 24x28 hat overlays in cosmetics_atlas.json', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../../public/assets/dungeon/cosmetics_atlas.json', import.meta.url), 'utf8'),
    );
    assert.ok(typeof raw === 'object' && raw !== null && 'frames' in raw);
    const framesObj = raw.frames;
    assert.ok(typeof framesObj === 'object' && framesObj !== null);
    const frameMap = new Map(Object.entries(framesObj));

    const expectFrame = (key: string, w: number, h: number): void => {
      const entry: unknown = frameMap.get(key);
      assert.ok(typeof entry === 'object' && entry !== null && 'frame' in entry, `Missing atlas frame ${key}`);
      const f: unknown = entry.frame;
      assert.ok(
        typeof f === 'object' && f !== null && 'w' in f && 'h' in f && f.w === w && f.h === h,
        `Unexpected dimensions for ${key}`,
      );
    };

    for (let i = 0; i < 4; i += 1) {
      expectFrame(`default_idle_${i}`, 20, 20);
    }

    const costumeSuffixes = [
      'idle_0', 'idle_1', 'idle_2', 'idle_3',
      'run_0', 'run_1', 'run_2', 'run_3',
      'dash_0', 'dash_1',
      'charge_0', 'charge_1',
    ];
    for (const id of COSMETIC_IDS) {
      if (COSMETICS[id].slot === 'costume') {
        for (const suffix of costumeSuffixes) {
          expectFrame(`${id}_${suffix}`, 20, 20);
        }
      } else {
        for (let i = 0; i < 4; i += 1) {
          expectFrame(`hat_${id}_${i}`, 24, 28);
        }
      }
    }
  });
});

void describe('Gameplay Balance & Biome Enemy Updates', () => {
  void it('uses compact 672x448 rooms on a larger 56px 10x6 interior tile grid', () => {
    assert.equal(ARENA_W, 672);
    assert.equal(ARENA_H, 448);
    assert.equal(CELL_SIZE, 56);
    assert.equal(LAYOUT_COLS, 10);
    assert.equal(LAYOUT_ROWS, 6);

    for (const date of ['2026-11-18', '2026-11-19', '2026-11-20']) {
      for (let floor = 1; floor <= 3; floor += 1) {
        for (const hazardType of ['spikes', 'barrels', 'currents'] as const) {
          const map = buildDailyDungeonMap(date, floor, hazardType);
          for (const room of map.rooms) {
            const bp = room.blueprint;
            const seen = new Set(
              bp.obstacles.map((o) => `${Math.round(o.x / CELL_SIZE) - 1},${Math.round(o.y / CELL_SIZE) - 1}`),
            );
            for (const br of bp.breakables) {
              const i = (br.x - CELL_SIZE / 2) / CELL_SIZE - 1;
              const j = (br.y - CELL_SIZE / 2) / CELL_SIZE - 1;
              assert.ok(Number.isInteger(i) && Number.isInteger(j), `breakable (${br.x},${br.y}) off 56px tile grid`);
              assert.ok(br.radius >= 22, `breakable radius ${br.radius} too small for 56px tiles`);
              const key = `${i},${j}`;
              assert.equal(seen.has(key), false, `breakable collides with occupied cell ${key}`);
              seen.add(key);
            }
            for (const haz of bp.hazards) {
              if (haz.type === 'spikes' || haz.type === 'barrels') {
                assert.equal(haz.w, CELL_SIZE);
                assert.equal(haz.h, CELL_SIZE);
                const i = (haz.x - CELL_SIZE / 2) / CELL_SIZE - 1;
                const j = (haz.y - CELL_SIZE / 2) / CELL_SIZE - 1;
                assert.ok(Number.isInteger(i) && Number.isInteger(j), `hazard ${haz.type} (${haz.x},${haz.y}) off 56px tile grid`);
                const key = `${i},${j}`;
                assert.equal(seen.has(key), false, `hazard ${haz.type} collides with occupied cell ${key}`);
                seen.add(key);
              }
            }
          }
        }
      }
    }
  });

  void it('keeps monster coin drops low and restricts gem drops to end-of-floor bosses', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.totalWaves = 99;
    sim.state.player.iFramesTimer = 999;

    const nonBossTypes = [
      'chaser',
      'shooter',
      'charger',
      'elite_charger',
      'shade',
      'yeti',
      'bomber',
      'mortar_tank',
      'stampede',
    ] as const;

    for (let i = 0; i < 200; i += 1) {
      const arch = nonBossTypes[i % nonBossTypes.length]!;
      sim.state.hitstopTimer = 0;
      sim.state.waveIndex = 0;
      sim.state.totalWaves = 2;
      sim.state.waveDelayTimer = 0;
      sim.state.player.x = ARENA_W / 2;
      sim.state.player.y = ARENA_H / 2;
      const e = createEnemy(10_000 + i, arch, sim.state.player.x, sim.state.player.y - 36, 1, 1, 1, 1);
      e.spawnShieldTimer = 0;
      e.hp = 1;
      e.armor = 0;
      assert.ok(e.coinDrop <= (arch === 'elite_charger' ? 6 : 3), `unexpected coinDrop for ${arch}: ${e.coinDrop}`);
      sim.state.enemies = [e];
      sim.state.player.attackCooldown = 0;
      sim.state.player.attackEndlagTimer = 0;
      sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
      assert.equal(sim.state.enemies.length, 0, `${arch} should die in hit`);
    }
    assert.equal(sim.state.gems.length, 0, 'non-boss enemies must never drop gems');

    sim.state.hitstopTimer = 0;
    sim.state.waveDelayTimer = 0;
    sim.state.player.x = ARENA_W / 2;
    sim.state.player.y = ARENA_H / 2;
    const boss = createEnemy(99_999, 'boss', sim.state.player.x, sim.state.player.y - 40, 1, 1, 1, 1);
    boss.spawnShieldTimer = 0;
    boss.hp = 1;
    assert.ok(boss.coinDrop <= 14);
    sim.state.enemies = [boss];
    sim.state.player.attackCooldown = 0;
    sim.state.player.attackEndlagTimer = 0;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.enemies.length, 0, 'boss should die in hit');
    assert.equal(sim.state.gems.length, 1, 'floor boss kill must drop a gem');
  });

  void it('shuffles the 5 biomes deterministically per date with biome-specific signature enemies and repeats from floor 6', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7].map((f) => getBiomeIdForFloor(f)),
      ['dungeon', 'snow', 'town', 'battle', 'farm', 'dungeon', 'snow'],
    );
    const dates = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'];
    const startingBiomes = new Set(dates.map((d) => getBiomeIdForFloor(1, d)));
    assert.ok(startingBiomes.size >= 2, `expected different dates to start in different biomes, got ${[...startingBiomes].join(', ')}`);

    const date = '2026-11-20';
    const order = getDailyBiomeOrder(date);
    assert.equal(order.length, 5);
    assert.equal(getBiomeIdForFloor(6, date), getBiomeIdForFloor(1, date));

    const hazard = getDailyHazard(date);
    for (let floor = 1; floor <= 6; floor += 1) {
      const expectedSig = BIOME_SIGNATURE_ENEMY[getBiomeIdForFloor(floor, date)];
      const map = buildDailyDungeonMap(date, floor, hazard);
      const spawnedTypes = new Set(map.rooms.flatMap((r) => r.blueprint.waves.flat().map((w) => w.archetype)));
      assert.equal(spawnedTypes.has(expectedSig), true, `Floor ${floor} missing signature enemy ${expectedSig}`);
    }
  });

  void it('runs distinct AI behaviors for shade, yeti, bomber, mortar_tank, and stampede', () => {
    const profile = createDefaultProfile();
    const setupWith = (
      arch: 'shade' | 'yeti' | 'bomber' | 'mortar_tank' | 'stampede',
      x: number,
      y: number,
    ): GameSimulation => {
      const sim = new GameSimulation('2026-11-20', profile);
      sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
      sim.state.obstacles = [];
      sim.state.hazards = [];
      sim.state.totalWaves = 5;
      sim.state.player.iFramesTimer = 999;
      const e = createEnemy(5001, arch, x, y, 1, 1, 1, 1);
      e.spawnShieldTimer = 0;
      e.state = 'chase';
      e.stateTimer = 0;
      sim.state.enemies = [e];
      return sim;
    };

    // Shade: orbits smoothly without teleporting and fires 3 projectiles
    const shadeSim = setupWith('shade', ARENA_W / 2, 170);
    let maxShadeProj = 0;
    let maxShadeStepDist = 0;
    let prevShadeX = shadeSim.state.enemies[0]!.x;
    let prevShadeY = shadeSim.state.enemies[0]!.y;
    for (let i = 0; i < 75; i += 1) {
      shadeSim.step(idleInput());
      const shadeNow = shadeSim.state.enemies[0]!;
      maxShadeStepDist = Math.max(maxShadeStepDist, Math.hypot(shadeNow.x - prevShadeX, shadeNow.y - prevShadeY));
      prevShadeX = shadeNow.x;
      prevShadeY = shadeNow.y;
      maxShadeProj = Math.max(maxShadeProj, shadeSim.state.projectiles.length);
    }
    assert.ok(maxShadeProj >= 3, 'shade should fire a 3-shot fan');
    assert.ok(maxShadeStepDist <= 12, 'shade must move continuously without teleporting');

    // Yeti: launches ice_mortar that bursts into 4 cardinal frost shards
    const yetiSim = setupWith('yeti', ARENA_W / 2, 160);
    yetiSim.state.player.x = ARENA_W / 2;
    yetiSim.state.player.y = ARENA_H / 2;
    stepFrames(yetiSim, 45, () => idleInput());
    assert.equal(yetiSim.state.delayedBlasts.some((b) => b.kind === 'ice_mortar'), true, 'yeti should queue ice_mortar');
    let maxYetiShards = 0;
    for (let i = 0; i < 50; i += 1) {
      yetiSim.step(idleInput());
      maxYetiShards = Math.max(maxYetiShards, yetiSim.state.projectiles.length);
    }
    assert.ok(maxYetiShards >= 4, 'ice_mortar should burst into 4 shards');

    // Bomber: drops sapper_bomb and retreats away from the player
    const bomberSim = setupWith('bomber', ARENA_W / 2, 230);
    stepFrames(bomberSim, 30, () => idleInput());
    assert.equal(bomberSim.state.delayedBlasts.some((b) => b.kind === 'sapper_bomb'), true, 'bomber should drop bomb');
    const bombDropDist = Math.hypot(
      bomberSim.state.enemies[0]!.x - bomberSim.state.player.x,
      bomberSim.state.enemies[0]!.y - bomberSim.state.player.y,
    );
    stepFrames(bomberSim, 30, () => idleInput());
    const afterRetreatDist = Math.hypot(
      bomberSim.state.enemies[0]!.x - bomberSim.state.player.x,
      bomberSim.state.enemies[0]!.y - bomberSim.state.player.y,
    );
    assert.ok(afterRetreatDist > bombDropDist, 'bomber should retreat after dropping bomb');

    // Mortar Tank: fires a 3-round burst
    const tankSim = setupWith('mortar_tank', 140, 140);
    stepFrames(tankSim, 70, () => idleInput());
    assert.ok(tankSim.state.projectiles.length >= 3, 'mortar_tank should fire a 3-shot burst');

    // Stampede: charges and ricochets off arena wall
    const stampedeSim = setupWith('stampede', PLAY_MAX_X - 45, 220);
    stampedeSim.state.player.x = PLAY_MAX_X - 30;
    stampedeSim.state.player.y = 220;
    stepFrames(stampedeSim, 55, () => idleInput());
    const bull = stampedeSim.state.enemies[0]!;
    assert.ok(bull.bouncesLeft < 2, 'stampede should ricochet off wall during charge');
  });

  void it('fires Scatter Staff faster and keeps relic descriptions weapon-neutral', () => {
    assert.ok(WEAPONS.scatter_staff.cooldown < 0.75, 'shotgun cooldown should be buffed below 0.75s');
    assert.equal(WEAPONS.scatter_staff.staggerSec, 0);
    assert.equal(WEAPONS.scatter_staff.stripsArmor, false);

    for (const def of Object.values(RELICS)) {
      const desc1 = def.summary(1);
      const desc2 = def.summary(2);
      assert.equal(/\b(blade|swing|swings|melee|slash)\b/i.test(desc1), false, `Relic ${def.id} mentions melee terms: ${desc1}`);
      assert.equal(/\b(blade|swing|swings|melee|slash)\b/i.test(desc2), false, `Relic ${def.id} mentions melee terms: ${desc2}`);
    }
  });

  void it('paths enemies around solid obstacle walls instead of getting stuck', () => {
    const profile = createDefaultProfile();
    const wallBlocks = [3, 4, 5].map((col, idx) => ({
      id: 700 + idx,
      x: (col + 1) * CELL_SIZE,
      y: 3 * CELL_SIZE,
      w: CELL_SIZE,
      h: CELL_SIZE,
    }));

    const chaserSim = new GameSimulation('2026-11-20', profile);
    chaserSim.startNewRun('2026-11-20', profile);
    chaserSim.state.obstacles = wallBlocks;
    chaserSim.state.hazards = [];
    chaserSim.state.totalWaves = 5;
    chaserSim.state.player.iFramesTimer = 999;
    chaserSim.state.player.x = 5.5 * CELL_SIZE;
    chaserSim.state.player.y = 5.5 * CELL_SIZE;
    const chaser = createEnemy(6001, 'chaser', 5.5 * CELL_SIZE, 1.5 * CELL_SIZE, 1, 1, 1, 1);
    chaser.spawnShieldTimer = 0;
    chaser.state = 'chase';
    chaser.stateTimer = 0;
    chaserSim.state.enemies = [chaser];

    stepFrames(chaserSim, 180, () => idleInput());
    const distToPlayer = Math.hypot(
      chaser.x - chaserSim.state.player.x,
      chaser.y - chaserSim.state.player.y,
    );
    assert.ok(
      chaser.y > 4 * CELL_SIZE || distToPlayer < 110,
      `chaser stuck behind wall at (${chaser.x.toFixed(1)}, ${chaser.y.toFixed(1)})`,
    );

    const shadeSim = new GameSimulation('2026-11-20', profile);
    shadeSim.startNewRun('2026-11-20', profile);
    shadeSim.state.obstacles = wallBlocks;
    shadeSim.state.hazards = [];
    shadeSim.state.totalWaves = 5;
    shadeSim.state.player.iFramesTimer = 999;
    shadeSim.state.player.x = 5.5 * CELL_SIZE;
    shadeSim.state.player.y = 5.5 * CELL_SIZE;
    const shade = createEnemy(6002, 'shade', 5.5 * CELL_SIZE, 1.5 * CELL_SIZE, 1, 1, 1, 1);
    shade.spawnShieldTimer = 0;
    shade.state = 'chase';
    shade.stateTimer = 0;
    shadeSim.state.enemies = [shade];

    let maxProj = 0;
    for (let i = 0; i < 180; i += 1) {
      shadeSim.step(idleInput());
      maxProj = Math.max(maxProj, shadeSim.state.projectiles.length);
    }
    assert.ok(maxProj >= 3, `shade failed to path around wall into shot LOS (maxProj=${maxProj})`);
  });

  void it('requires two Arcane Lance shots to kill base purple enemies while leaving visible HP', () => {
    for (const arch of ['shooter', 'shade'] as const) {
      const profile = {
        ...createDefaultProfile(),
        ownedWeapons: ['longsword' as const, 'arcane_lance' as const],
        equippedWeapon: 'arcane_lance' as const,
      };
      const sim = new GameSimulation('2026-11-20', profile);
      sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
      sim.state.obstacles = [];
      sim.state.hazards = [];
      sim.state.totalWaves = 5;
      sim.state.player.damageBonusMult = 1;
      sim.state.modifier.playerDamageMult = 1;
      sim.state.modifier.enemyHpMult = 1;
      sim.state.player.iFramesTimer = 999;

      const foe = createEnemy(7001, arch, sim.state.player.x, sim.state.player.y - 120, 1, 1, 1, 1);
      foe.spawnShieldTimer = 0;
      foe.state = 'chase';
      foe.stateTimer = 99;
      sim.state.enemies = [foe];

      sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
      stepFrames(sim, 12, () => idleInput());
      assert.equal(sim.state.enemies.length, 1, `${arch} should survive the first base Arcane Lance shot`);
      assert.ok(
        foe.hp >= 6 && foe.hp < foe.maxHp,
        `expected reasonable remaining HP for ${arch} after 1 lance shot, got ${foe.hp}/${foe.maxHp}`,
      );

      sim.state.player.attackCooldown = 0;
      sim.state.player.attackEndlagTimer = 0;
      sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
      stepFrames(sim, 12, () => idleInput());
      assert.equal(sim.state.enemies.length, 0, `${arch} should die on the second Arcane Lance shot`);
    }
  });

  void it('preserves unbroken boxes when moving between rooms and keeps broken boxes broken', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    const startRoomId = sim.state.currentRoomId;
    const initialCount = sim.state.breakables.length;
    assert.ok(initialCount >= 4, `entrance room starts with at least 4 boxes, got ${initialCount}`);

    clearRoom(sim);
    const brokenTarget = sim.state.breakables[0]!;
    sim.state.player.x = brokenTarget.x;
    sim.state.player.y = brokenTarget.y + 32;
    sim.state.player.attackCooldown = 0;
    sim.state.player.attackEndlagTimer = 0;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.breakables.length, initialCount - 1, 'breaking 1 box leaves initialCount - 1 remaining');

    const door = sim.state.doors[0]!;
    assert.ok(door, 'cleared room must have at least one open door');
    sim.enterMapRoom(door.targetRoomId, 'door', door.dir);
    assert.notEqual(sim.state.currentRoomId, startRoomId);
    assert.ok(sim.state.breakables.length > 0, 'adjacent room loads its own boxes');

    clearRoom(sim);
    sim.enterMapRoom(startRoomId, 'door', oppositeDirection(door.dir));
    assert.equal(sim.state.currentRoomId, startRoomId);
    assert.equal(sim.state.breakables.length, initialCount - 1, 'revisiting room must keep unbroken boxes');
    assert.equal(
      sim.state.breakables.some((b) => b.id === brokenTarget.id),
      false,
      'broken box must stay destroyed after revisiting room',
    );
  });

  void it('varies daily rules and weapon restrictions without mutating the player profile', () => {
    const seenModes = new Set<string>();
    let sawTrialDate: string | null = null;
    let sawMeleeDate: string | null = null;
    let sawRangedDate: string | null = null;
    let sawStarterRelicDate: string | null = null;
    for (let day = 1; day <= 60; day += 1) {
      const mm = day <= 30 ? '11' : '12';
      const dd = String(day <= 30 ? day : day - 30).padStart(2, '0');
      const d = `2026-${mm}-${dd}`;
      const rule = getDailyRule(d);
      seenModes.add(rule.id);
      if (rule.weaponMode === 'locked' && !sawTrialDate) sawTrialDate = d;
      if (rule.weaponMode === 'melee_only' && !sawMeleeDate) sawMeleeDate = d;
      if (rule.weaponMode === 'ranged_only' && !sawRangedDate) sawRangedDate = d;
      if (rule.grantStarterRelic && !sawStarterRelicDate) sawStarterRelicDate = d;
    }
    assert.ok(seenModes.size >= 5, `expected varied daily rules, saw ${[...seenModes].join(', ')}`);
    assert.ok(sawTrialDate && sawMeleeDate && sawRangedDate && sawStarterRelicDate);

    const profile = {
      ...createDefaultProfile(),
      ownedWeapons: ['longsword' as const],
      equippedWeapon: 'longsword' as const,
    };
    const trialResolved = resolveDailyWeapon(sawTrialDate, profile);
    assert.equal(trialResolved.weaponId, getDailyRule(sawTrialDate).forcedWeapon);
    const trialSim = new GameSimulation(sawTrialDate, profile);
    trialSim.startNewRun(sawTrialDate, profile);
    assert.equal(trialSim.state.player.weaponId, getDailyRule(sawTrialDate).forcedWeapon);
    assert.equal(profile.equippedWeapon, 'longsword', 'profile must remain unmodified');

    const rangedResolved = resolveDailyWeapon(sawRangedDate, profile);
    assert.equal(WEAPONS[rangedResolved.weaponId].style, 'ranged');

    const relicSim = new GameSimulation(sawStarterRelicDate, profile);
    relicSim.startNewRun(sawStarterRelicDate, profile);
    assert.ok(Object.keys(relicSim.state.player.relics).length >= 1, 'starter_relic rule grants a Floor 1 relic');
  });

  void it('spawns breaking debris physics for crates and TNT barrels', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    clearRoom(sim);

    const target = sim.state.breakables[0]!;
    sim.state.player.x = target.x;
    sim.state.player.y = target.y + 32;
    sim.state.player.attackCooldown = 0;
    sim.state.player.attackEndlagTimer = 0;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.ok(sim.state.debris.length >= 6, `breaking crate should spawn wood debris, got ${sim.state.debris.length}`);

    const firstZ = sim.state.debris[0]!.z;
    stepFrames(sim, 10, () => idleInput());
    assert.notEqual(sim.state.debris[0]?.z, firstZ, 'debris should animate through the air');

    // Barrel explosion spawns stave debris upon detonation
    sim.state.debris = [];
    sim.state.hazards = [
      { id: 9901, type: 'barrels', x: sim.state.player.x, y: sim.state.player.y - 36, w: 56, h: 56, dirX: 0, dirY: 0, timer: 0, hp: 20, destroyed: false },
    ];
    sim.state.player.iFramesTimer = 999;
    sim.state.player.attackCooldown = 0;
    sim.state.player.attackEndlagTimer = 0;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.ok(sim.state.debris.length >= 3, 'hitting barrel spawns initial wood splinters');
    stepFrames(sim, 12, () => idleInput());
    assert.ok(sim.state.debris.length >= 10, 'detonating barrel bursts into stave debris');
  });

  void it('animates Boss Leap in an arc over obstacles with zero teleporting', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.obstacles = [];
    sim.state.hazards = [];
    sim.state.totalWaves = 5;
    sim.state.player.iFramesTimer = 0;
    sim.state.player.hp = 100;
    sim.state.player.x = 420;
    sim.state.player.y = 260;

    const boss = createEnemy(8801, 'boss', 180, 140, 1, 1, 1, 1);
    boss.spawnShieldTimer = 0;
    boss.state = 'telegraph';
    boss.attackKind = 'boss_leap';
    boss.telegraphDuration = 0.72;
    boss.stateTimer = 0.72;
    boss.targetX = 420;
    boss.targetY = 260;
    sim.state.enemies = [boss];

    let maxStepDist = 0;
    let maxLeapZ = 0;
    let landed = false;
    let airborneSwingMissed = false;
    let prevX = boss.x;
    let prevY = boss.y;

    for (let i = 0; i < 120; i += 1) {
      // Keep hero right under target to verify landing slam hits AND airborne hero swings don't strike high airborne boss.
      sim.state.player.x = 420;
      sim.state.player.y = 260;
      const fireSwing = boss.leapZ > 40 && sim.state.player.attackCooldown <= 0;
      const hpBeforeAirSwing = boss.hp;
      sim.step(idleInput({ actionDown: fireSwing, actionJustPressed: fireSwing }));
      const liveBoss = sim.state.enemies[0]!;
      if (fireSwing && liveBoss.hp === hpBeforeAirSwing) {
        airborneSwingMissed = true;
      }

      const stepDist = Math.hypot(liveBoss.x - prevX, liveBoss.y - prevY);
      maxStepDist = Math.max(maxStepDist, stepDist);
      maxLeapZ = Math.max(maxLeapZ, liveBoss.leapZ);
      prevX = liveBoss.x;
      prevY = liveBoss.y;
      if (liveBoss.state === 'recover') {
        landed = true;
        break;
      }
    }

    assert.equal(landed, true, 'boss should finish leap and enter recover');
    assert.ok(maxLeapZ >= 110, `boss should leap high into the air, maxLeapZ=${maxLeapZ}`);
    assert.ok(maxStepDist <= 25, `boss must glide continuously without teleporting, maxStepDist=${maxStepDist}`);
    assert.equal(airborneSwingMissed, true, 'ground swings must not hit boss high in the air');
    assert.equal(boss.leapZ, 0, 'boss leapZ resets to 0 on landing');
    assert.ok(sim.state.player.hp < 100, 'boss slam should deal landing damage');
  });

  void it('consolidates coin drops to at most 4 entities while preserving full coin value', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.obstacles = [];
    sim.state.hazards = [];
    sim.state.coins = [];
    sim.state.totalWaves = 5;
    sim.state.player.x = 200;
    sim.state.player.y = 224;
    sim.state.modifier.coinDropMult = 1;
    sim.state.player.damageBonusMult = 10;

    const target = createEnemy(9101, 'charger', 270, 224, 1, 1, 1, 1);
    target.spawnShieldTimer = 0;
    target.hp = 1;
    target.maxHp = 1;
    target.coinDrop = 16;
    target.state = 'recover';
    target.stateTimer = 99;
    // Keep a second passive enemy alive so clearing wave does not auto-magnetize everything.
    const anchor = createEnemy(9102, 'chaser', 560, 224, 1, 1, 1, 1);
    anchor.state = 'recover';
    anchor.stateTimer = 99;
    sim.state.enemies = [target, anchor];

    sim.step(idleInput({ moveX: 1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.coins.length, 4, 'coinDrop=16 should consolidate into 4 physical coins');
    const totalVal = sim.state.coins.reduce((acc, c) => acc + c.value, 0);
    assert.equal(totalVal, 16, 'consolidated coins must preserve exact coin total');
  });

  void it('uses +1 GEM floating text on gem pickup and never OS emoji', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.floatingTexts = [];
    sim.state.gems.push({
      id: 9201,
      x: sim.state.player.x,
      y: sim.state.player.y,
      vx: 0,
      vy: 0,
      age: 0,
    });
    sim.step(idleInput());
    const texts = sim.state.floatingTexts.map((t) => t.text);
    assert.ok(texts.includes('+1 GEM'), `expected +1 GEM popup, got: ${texts.join(', ')}`);
    assert.equal(texts.some((t) => t.includes('💎')), false);
  });

  void it('scales shooter orb patterns by depth and reverses strafe when wall-blocked', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.obstacles = [];
    sim.state.hazards = [];
    sim.state.totalWaves = 5;
    sim.state.player.x = 460;
    sim.state.player.y = 224;
    sim.state.player.iFramesTimer = 999;

    const shooter = createEnemy(9301, 'shooter', 200, 224, 1, 1, 1, 1);
    shooter.spawnShieldTimer = 0;

    // Floor 1 Room 1 -> single orb
    sim.state.floor = 1;
    sim.state.roomIndex = 0;
    sim.state.projectiles = [];
    shooter.state = 'telegraph';
    shooter.attackKind = 'shoot';
    shooter.telegraphDuration = 0.05;
    shooter.stateTimer = 0.01;
    sim.state.enemies = [shooter];
    sim.step(idleInput());
    assert.equal(sim.state.projectiles.filter((p) => !p.friendly).length, 1);

    // Floor 2 Room 1 -> twin split
    sim.state.floor = 2;
    sim.state.roomIndex = 0;
    sim.state.projectiles = [];
    shooter.state = 'telegraph';
    shooter.attackKind = 'shoot';
    shooter.telegraphDuration = 0.05;
    shooter.stateTimer = 0.01;
    sim.step(idleInput());
    assert.equal(sim.state.projectiles.filter((p) => !p.friendly).length, 2);

    // Floor 3+ -> alternates twin (2) and 3-orb fan (3)
    sim.state.floor = 3;
    sim.state.projectiles = [];
    shooter.burstLeft = 0;
    shooter.state = 'telegraph';
    shooter.stateTimer = 0.01;
    sim.step(idleInput());
    assert.equal(sim.state.projectiles.filter((p) => !p.friendly).length, 2);

    sim.state.projectiles = [];
    shooter.state = 'telegraph';
    shooter.stateTimer = 0.01;
    sim.step(idleInput());
    assert.equal(sim.state.projectiles.filter((p) => !p.friendly).length, 3);

    // Wall-blocked strafe reverses bouncesLeft direction instead of pinning
    shooter.x = PLAY_MIN_X + shooter.radius;
    shooter.y = 110;
    sim.state.player.x = shooter.x;
    sim.state.player.y = 330;
    shooter.state = 'chase';
    shooter.stateTimer = 10;
    shooter.bouncesLeft = 1;
    sim.step(idleInput());
    assert.equal(shooter.bouncesLeft, -1, 'shooter should flip strafe direction when blocked by arena wall');
  });

  void it('places gem icon to the left of counters and uses collapsed #end-details dropdown', () => {
    const gameHtml = readFileSync(new URL('../client/game.html', import.meta.url), 'utf8');
    const shopHtml = readFileSync(new URL('../client/shop.html', import.meta.url), 'utf8');
    const startGemBlock = gameHtml.slice(
      gameHtml.indexOf('<span class="strip-label">Gems</span>'),
      gameHtml.indexOf('<div class="start-actions">'),
    );
    assert.ok(
      startGemBlock.indexOf('gem.svg') < startGemBlock.indexOf('id="start-gems"'),
      'gem.svg must appear to the left of #start-gems',
    );
    const shopOverlayGemBlock = gameHtml.slice(gameHtml.indexOf('gem-pill'), gameHtml.indexOf('id="shop-back-btn"'));
    assert.ok(
      shopOverlayGemBlock.indexOf('gem.svg') < shopOverlayGemBlock.indexOf('id="shop-gems"'),
      'gem.svg must appear to the left of #shop-gems in game.html',
    );
    assert.ok(
      shopHtml.indexOf('gem.svg') < shopHtml.indexOf('id="shop-gems"'),
      'gem.svg must appear to the left of #shop-gems in shop.html',
    );

    const detailsMatch = /<details\b[^>]*id="end-details"[^>]*>/.exec(gameHtml);
    assert.ok(detailsMatch, 'missing <details id="end-details"> dropdown in game.html');
    assert.equal(/\bopen\b/.test(detailsMatch[0]), false, '#end-details should start collapsed');
    const detailsStart = gameHtml.indexOf('id="end-details"');
    const detailsEnd = gameHtml.indexOf('</details>', detailsStart);
    const insideDetails = gameHtml.slice(detailsStart, detailsEnd);
    assert.ok(insideDetails.includes('id="end-stats"'), '#end-stats should live inside #end-details');
    assert.ok(insideDetails.includes('id="end-relics"'), '#end-relics should live inside #end-details');
    assert.ok(insideDetails.includes('class="leaderboard-box"'), '.leaderboard-box should live inside #end-details');
  });

  void it('contains zero middle-dot punctuation characters across src/', () => {
    const srcRoot = new URL('../', import.meta.url);
    const hits: string[] = [];
    const scanDir = (dirUrl: URL): void => {
      for (const entry of readdirSync(dirUrl, { withFileTypes: true })) {
        const nextUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl);
        if (entry.isDirectory()) {
          scanDir(nextUrl);
        } else if (/\.(ts|html|css)$/.test(entry.name)) {
          const text = readFileSync(nextUrl, 'utf8');
          if (text.includes('\u00b7')) {
            hits.push(nextUrl.pathname);
          }
        }
      }
    };
    scanDir(srcRoot);
    assert.deepEqual(hits, [], `Found middle-dot characters in: ${hits.join(', ')}`);
  });
});
