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
import { ALL_ENEMY_ARCHETYPES, createEnemy } from '../shared/game/enemies.ts';
import {
  BIOME_SIGNATURE_ENEMY,
  buildDailyDungeonMap,
  CELL_SIZE,
  getBiomeIdForFloor,
  getDailyBiomeOrder,
  getFloorBossSpec,
  getFloorRoster,
  getFloorScaling,
  getRosterSizeForFloor,
  isNearDoorwayCell,
  isReservedCell,
  LAYOUT_COLS,
  LAYOUT_ROWS,
  oppositeDirection,
} from '../shared/game/rooms.ts';
import {
  computeRunScore,
  GameSimulation,
  SPIKE_ACTIVE_THRESHOLD,
  SPIKE_CYCLE_SEC,
} from '../shared/game/simulation.ts';
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
import type { EnemyArchetype, InputFrame, RunSummary } from '../shared/types.ts';
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
function makeProp(kind: 'crate' | 'chest', x: number, y: number, id = 990001) {
  return { id, x, y, hp: kind === 'chest' ? 1 : 22, maxHp: kind === 'chest' ? 1 : 22, radius: 22, kind, hitFlash: 0 };
}

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
        if (floor === 1) assert.ok(startDoors >= 1 && startDoors <= 2, 'floor 1 entrance has 1-2 exits');
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
        const minDeadEnds = map.rooms.length >= 6 ? 3 : 2;
        assert.ok(
          floorDeadEnds.length >= minDeadEnds,
          `${date} F${floor} must have at least ${minDeadEnds} dead-end rooms (got ${floorDeadEnds.length})`,
        );
        assert.equal(Object.keys(boss.doors).length, 1, 'boss room must always be a dead-end');
        const elite = map.rooms.find((r) => r.blueprint.roomType === 'elite');
        assert.ok(elite && Object.keys(elite.doors).length === 1, 'elite vault must sit on a dead-end leaf');
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

  void it('swings manually in facing/aim direction, knocks back Warden, and deals direct HP damage without armor', () => {
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

    assert.equal(elite.armor, 0);
    assert.equal(elite.maxArmor, 0);
    assert.ok(elite.maxHp >= 240, `expected chunky Warden HP >= 240, got ${elite.maxHp}`);

    const hpBefore = elite.hp;
    const yBefore = elite.y;

    // 1st manual swing upward deals full direct HP damage and applies upward knockback
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.swingCount, 1);
    assert.ok(sim.state.player.attackCooldown > 0);
    assert.equal(elite.armor, 0);
    const firstSwingDmg = hpBefore - elite.hp;
    assert.ok(firstSwingDmg > 0, 'Warden should take immediate direct HP damage');
    assert.ok(elite.vy < 0, 'upward swing should knock Warden upward');
    // Only the War Hammer (or the very rare Concussion relic) stuns.
    assert.notEqual(elite.state, 'staggered');
    assert.ok(sim.state.hitstopTimer > 0);

    // Knockback pushes Warden back over subsequent frames
    stepFrames(sim, 6, () => idleInput());
    assert.ok(elite.y < yBefore, 'knockback should visibly push Warden away');

    // Wait out cooldown, bring Warden back in range, and confirm identical unmitigated damage on swing 2
    const cdFrames = Math.ceil((ATTACK_CD * sim.state.modifier.attackCdMult) / FIXED_DT) + 2;
    stepFrames(sim, cdFrames, () => idleInput());
    elite.x = 480;
    elite.y = 275;
    const hpBeforeSecond = elite.hp;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(elite.armor, 0);
    assert.equal(hpBeforeSecond - elite.hp, firstSwingDmg, 'unarmored Warden takes consistent full swing damage');
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
  void it('activates ember_wake, arc_conduit, whetstone, and triggers phantom_echo/decoy_mine/volt_nova on melee hits (never air whiffs)', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });

    sim.state.player.relics = {
      ember_wake: 1,
      arc_conduit: 1,
      whetstone: 1,
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

    // Hit 1: kills e1 -> ember_wake drops fire where the hit landed; arc_conduit fires; no 2nd/3rd hit procs yet
    const e1x = e1.x;
    const e1y = e1.y;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.player.meleeHitCount, 1);
    assert.ok(sim.state.firePatches.length > 0);
    assert.ok(Math.hypot(sim.state.firePatches[0]!.x - e1x, sim.state.firePatches[0]!.y - e1y) < 8, 'fire lands on the enemy that was hit');
    assert.ok(sim.state.lightnings.length > 0);
    assert.ok(e2.hp < e2.maxHp);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'phantom_echo'), false);
    assert.equal(sim.state.delayedBlasts.some((b) => b.kind === 'decoy_mine'), false);

    // Hit 2: hitting e2 increments meleeHitCount to 2 -> triggers phantom_echo
    stepFrames(sim, cdFrames, () => idleInput());
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
    assert.ok(sim.state.doors.length >= 1 && sim.state.doors.length <= 2, 'entrance has 1-2 exits');

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

  void it('ships complete non-mixel sprites and weapon/relic grid slots in dungeon_atlas.json', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../../public/assets/dungeon/dungeon_atlas.json', import.meta.url), 'utf8'),
    );
    assert.ok(typeof raw === 'object' && raw !== null && 'meta' in raw && 'frames' in raw);
    const meta: unknown = raw.meta;
    assert.ok(typeof meta === 'object' && meta !== null && 'size' in meta);
    const size: unknown = meta.size;
    assert.ok(
      typeof size === 'object' && size !== null && 'w' in size && 'h' in size && size.w === 512 && size.h === 236,
      'Expected 512x236 dungeon_atlas.json sheet',
    );

    const framesObj = raw.frames;
    assert.ok(typeof framesObj === 'object' && framesObj !== null);
    const frameMap = new Map(Object.entries(framesObj));

    const expectRect = (
      key: string,
      w: number,
      h: number,
      exactX?: number,
      exactY?: number,
    ): void => {
      const entry: unknown = frameMap.get(key);
      assert.ok(typeof entry === 'object' && entry !== null && 'frame' in entry, `Missing atlas frame ${key}`);
      const f: unknown = entry.frame;
      assert.ok(
        typeof f === 'object'
          && f !== null
          && 'x' in f
          && 'y' in f
          && 'w' in f
          && 'h' in f
          && f.w === w
          && f.h === h,
        `Unexpected dimensions for ${key}`,
      );
      if (exactX !== undefined && exactY !== undefined) {
        assert.equal(f.x, exactX, `Unexpected x for ${key}`);
        assert.equal(f.y, exactY, `Unexpected y for ${key}`);
      }
    };

    // Weapons (tile_106, 103, 117, 129, 130), obsidian monolith (tile_064), biome enemies (tile_111, 121),
    // and 8 relics must align to the 28-col x 18px-stride 16x16 grid expected by shopView.ts.
    const gridTileIds = [64, 102, 103, 105, 106, 107, 111, 114, 115, 116, 117, 118, 119, 121, 129, 130];
    for (const idx of gridTileIds) {
      const key = `tile_${String(idx).padStart(3, '0')}`;
      const col = idx % 28;
      const row = Math.floor(idx / 28);
      expectRect(key, 16, 16, 2 + col * 18, 2 + row * 18);
    }

    for (let i = 0; i < 4; i += 1) {
      expectRect(`gem_${i}`, 16, 16);
      expectRect(`coin_${i}`, 16, 16);
      expectRect(`boom_${i}`, 24, 24);
    }
    for (let i = 0; i < 2; i += 1) {
      expectRect(`heart_${i}`, 16, 16);
    }

    const creatureSpecs: Array<[string, number, number, string]> = [
      ['hero', 20, 20, 'dash'],
      ['slime', 20, 20, 'telegraph'],
      ['wizard', 20, 20, 'cast'],
      ['cyclops', 24, 24, 'charge'],
      ['warden', 26, 26, 'charge'],
      ['boss', 32, 32, 'attack'],
    ];
    for (const [prefix, w, h, action] of creatureSpecs) {
      for (let i = 0; i < 4; i += 1) {
        expectRect(`${prefix}_idle_${i}`, w, h);
        expectRect(`${prefix}_run_${i}`, w, h);
      }
      for (let i = 0; i < 2; i += 1) {
        const suffix = action === 'dash' ? 'dash' : action;
        expectRect(`${prefix}_${suffix}_${i}`, w, h);
      }
      if (prefix === 'hero') {
        expectRect('hero_charge_0', w, h);
        expectRect('hero_charge_1', w, h);
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

  void it('starts on the Dungeon, then the 6 themed worlds, looping back to Floor 1 at Floor 8', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => getBiomeIdForFloor(f)),
      ['dungeon', 'candy', 'neon', 'space', 'reef', 'haunted', 'sky', 'dungeon', 'candy'],
    );
    const dates = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'];
    for (const d of dates) assert.equal(getBiomeIdForFloor(1, d), 'dungeon', `floor 1 on ${d} should be the Dungeon`);
    const secondFloors = new Set(dates.map((d) => getBiomeIdForFloor(2, d)));
    assert.ok(secondFloors.size >= 2, `expected the themed worlds to shuffle per date, got ${[...secondFloors].join(', ')}`);

    const date = '2026-11-20';
    const order = getDailyBiomeOrder(date);
    assert.equal(order.length, 7);
    assert.equal(getBiomeIdForFloor(8, date), getBiomeIdForFloor(1, date));
    for (const d of dates) {
      const themed = new Set([2, 3, 4, 5, 6, 7].map((f) => getBiomeIdForFloor(f, d)));
      assert.deepEqual(
        [...themed].sort(),
        ['candy', 'haunted', 'neon', 'reef', 'sky', 'space'],
        `floors 2-7 on ${d} should be the themed worlds`,
      );
    }

    const hazard = getDailyHazard(date);
    // Floor 1 uses only classic monsters (plus the boss); themed specials start on floor 2.
    const floor1 = buildDailyDungeonMap(date, 1, hazard);
    const floor1Types = new Set(floor1.rooms.flatMap((r) => r.blueprint.waves.flat().map((w) => w.archetype)));
    for (const t of floor1Types) {
      assert.ok(
        ['chaser', 'shooter', 'charger', 'elite_charger', 'boss', 'myconid', 'imp', 'archer'].includes(t),
        `floor 1 spawned special monster ${t}`,
      );
    }
    for (let floor = 2; floor <= 8; floor += 1) {
      if (getBiomeIdForFloor(floor, date) === 'dungeon') continue; // floor 8 = dungeon again
      const expectedSig = BIOME_SIGNATURE_ENEMY[getBiomeIdForFloor(floor, date)];
      const map = buildDailyDungeonMap(date, floor, hazard);
      const spawnedTypes = new Set(map.rooms.flatMap((r) => r.blueprint.waves.flat().map((w) => w.archetype)));
      assert.equal(spawnedTypes.has(expectedSig), true, `Floor ${floor} missing signature enemy ${expectedSig}`);
    }
  });

  void it('gives Floor 1 an open entrance and curated, non-repeating layouts (never scatter)', () => {
    for (const d of ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-26']) {
      const map = buildDailyDungeonMap(d, 1, getDailyHazard(d));
      const entrance = map.rooms.find((r) => r.id === 0)!;
      assert.equal(entrance.blueprint.layout, 'open');
      const rooms = map.rooms.filter((r) => r.id !== 0 && r.blueprint.waves.flat().every((w) => w.archetype !== 'boss'));
      const layouts = rooms.map((r) => r.blueprint.layout);
      assert.ok(!layouts.includes('scatter'), `floor 1 on ${d} used scatter: ${layouts.join(', ')}`);
      assert.equal(new Set(layouts).size, Math.min(layouts.length, 5), `floor 1 on ${d} repeated a layout: ${layouts.join(', ')}`);
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
      sim.state.breakables = [];
      sim.state.totalWaves = 5;
      sim.state.player.iFramesTimer = 999;
      const e = createEnemy(5001, arch, x, y, 1, 1, 1, 1);
      e.spawnShieldTimer = 0;
      e.state = 'chase';
      e.stateTimer = 0;
      sim.state.enemies = [e];
      return sim;
    };

    // Shade (Floor 2 = 2 attacks): vanishes and strikes from behind, then fires a 3-shot shadow fan
    const shadeSim = setupWith('shade', ARENA_W / 2, 170);
    shadeSim.state.floor = 2;
    let maxShadeProj = 0;
    let sawPhaseStrike = false;
    for (let i = 0; i < 200; i += 1) {
      shadeSim.step(idleInput());
      const shadeNow = shadeSim.state.enemies[0]!;
      if (shadeNow.attackKind === 'phase_strike') sawPhaseStrike = true;
      maxShadeProj = Math.max(maxShadeProj, shadeSim.state.projectiles.filter((pr) => pr.kind === 'shadow').length);
    }
    assert.ok(sawPhaseStrike, 'shade should phase-strike from behind');
    assert.ok(maxShadeProj >= 3, 'shade should fire a 3-shot shadow fan');

    // Yeti: throws a snowball in a visible arc that bursts into 4 ice shards
    const yetiSim = setupWith('yeti', ARENA_W / 2, 160);
    yetiSim.state.player.x = ARENA_W / 2;
    yetiSim.state.player.y = ARENA_H / 2;
    let sawSnowball = false;
    let maxYetiShards = 0;
    for (let i = 0; i < 110; i += 1) {
      yetiSim.step(idleInput());
      if (yetiSim.state.lobs.some((l) => l.kind === 'snowball')) sawSnowball = true;
      maxYetiShards = Math.max(maxYetiShards, yetiSim.state.projectiles.filter((pr) => pr.kind === 'ice').length);
    }
    assert.equal(sawSnowball, true, 'yeti should throw a snowball lob');
    assert.ok(maxYetiShards >= 4, 'snowball should burst into 4 shards');

    // Bomber: throws a bomb that flies in an arc, lands as a fizzing bomb, and the sapper backs off
    const bomberSim = setupWith('bomber', ARENA_W / 2, 230);
    let sawBombLob = false;
    for (let f = 0; f < 120 && !bomberSim.state.delayedBlasts.some((b) => b.kind === 'sapper_bomb'); f += 1) {
      bomberSim.step(idleInput());
      if (bomberSim.state.lobs.some((l) => l.kind === 'bomb')) sawBombLob = true;
    }
    assert.equal(sawBombLob, true, 'bomber should visibly throw the bomb');
    assert.equal(bomberSim.state.delayedBlasts.some((b) => b.kind === 'sapper_bomb'), true, 'thrown bomb should land and fizz');

    // Mortar Tank: the shell is lobbed in an arc (never just appears); Floor 2 adds a 3-round cannon burst
    const tankSim = setupWith('mortar_tank', 140, 140);
    tankSim.state.floor = 2;
    let sawShellLob = false;
    let maxTankShots = 0;
    for (let i = 0; i < 300; i += 1) {
      tankSim.step(idleInput());
      const lob = tankSim.state.lobs.find((l) => l.kind === 'shell');
      if (lob && Math.hypot(lob.tx - lob.sx, lob.ty - lob.sy) > 40) sawShellLob = true;
      maxTankShots = Math.max(maxTankShots, tankSim.state.projectiles.filter((pr) => pr.kind === 'shell').length);
    }
    assert.equal(sawShellLob, true, 'mortar_tank should lob a visible shell from its barrel');
    assert.ok(maxTankShots >= 3, 'mortar_tank should fire a 3-shot burst');

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

    const archerSim = new GameSimulation('2026-11-20', profile);
    archerSim.startNewRun('2026-11-20', profile);
    archerSim.state.obstacles = wallBlocks;
    archerSim.state.hazards = [];
    archerSim.state.totalWaves = 5;
    archerSim.state.player.iFramesTimer = 999;
    archerSim.state.player.x = 5.5 * CELL_SIZE;
    archerSim.state.player.y = 5.5 * CELL_SIZE;
    const archer = createEnemy(6002, 'archer', 5.5 * CELL_SIZE, 1.5 * CELL_SIZE, 1, 1, 1, 1);
    archer.spawnShieldTimer = 0;
    archer.state = 'chase';
    archer.stateTimer = 0;
    archerSim.state.enemies = [archer];

    let shots = 0;
    for (let i = 0; i < 240; i += 1) {
      archerSim.step(idleInput());
      shots = Math.max(shots, archerSim.state.projectiles.filter((pr) => pr.kind === 'arrow').length);
    }
    assert.ok(shots >= 1, 'archer should walk around the wall to get a clear shot');

    // A big brute wedged against the middle of a wall must route around it (no endless scraping).
    const bruteSim = new GameSimulation('2026-11-20', profile);
    bruteSim.startNewRun('2026-11-20', profile);
    bruteSim.state.obstacles = wallBlocks;
    bruteSim.state.hazards = [];
    bruteSim.state.totalWaves = 5;
    bruteSim.state.player.iFramesTimer = 999;
    bruteSim.state.player.x = 5 * CELL_SIZE;
    bruteSim.state.player.y = 5.5 * CELL_SIZE;
    const brute = createEnemy(6003, 'charger', 5 * CELL_SIZE, 2.4 * CELL_SIZE, 1, 1, 1, 1);
    brute.spawnShieldTimer = 0;
    brute.state = 'chase';
    brute.stateTimer = 99;
    bruteSim.state.enemies = [brute];
    stepFrames(bruteSim, 240, () => idleInput());
    assert.ok(brute.y > 4 * CELL_SIZE, `brute stuck behind wall at (${brute.x.toFixed(1)}, ${brute.y.toFixed(1)})`);
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

  void it('puts exactly one crate, chest or Mimic in every non-boss room, near the middle', () => {
    for (const d of ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']) {
      for (const floor of [1, 2, 3]) {
        const map = buildDailyDungeonMap(d, floor, getDailyHazard(d));
        for (const node of map.rooms) {
          if (node.id === map.bossRoomId) continue;
          const props = node.blueprint.breakables.filter((b) => b.kind === 'crate' || b.kind === 'chest');
          const mimics = node.blueprint.waves.flat().filter((w) => w.mimic);
          assert.equal(props.length + mimics.length, 1, `room ${node.roomIndex} on ${d} F${floor} should have 1 prop`);
          const pos = props[0] ?? mimics[0]!;
          const col = Math.floor(pos.x / CELL_SIZE) - 1;
          const row = Math.floor(pos.y / CELL_SIZE) - 1;
          assert.ok(col >= 2 && col <= 7 && row >= 1 && row <= 4, `prop should sit near the middle, got cell ${col},${row}`);
          if (node.id === 0) assert.equal(mimics.length, 0, 'the entrance never hides a Mimic');
        }
      }
    }
  });

  void it('preserves unbroken boxes when moving between rooms and keeps broken boxes broken', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    const startRoomId = sim.state.currentRoomId;
    clearRoom(sim);
    const px = sim.state.player.x;
    const py = sim.state.player.y;
    sim.state.breakables = [makeProp('crate', px, py - 40, 990001), makeProp('crate', px + 160, py - 160, 990002)];
    sim.state.player.attackCooldown = 0;
    sim.state.player.attackEndlagTimer = 0;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.breakables.length, 1, 'breaking 1 crate leaves the other');

    const door = sim.state.doors[0]!;
    assert.ok(door, 'cleared room must have at least one open door');
    sim.enterMapRoom(door.targetRoomId, 'door', door.dir);
    assert.notEqual(sim.state.currentRoomId, startRoomId);
    clearRoom(sim);
    sim.enterMapRoom(startRoomId, 'door', oppositeDirection(door.dir));
    assert.equal(sim.state.currentRoomId, startRoomId);
    assert.equal(sim.state.breakables.length, 1, 'revisiting room must keep the unbroken crate');
    assert.equal(sim.state.breakables.some((b) => b.id === 990001), false, 'broken crate stays broken');
  });

  void it('opens treasure chests by walking up to them (never by smashing) for 4 coins', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    clearRoom(sim);
    sim.state.coins = [];
    sim.state.hearts = [];
    const earnedBefore = sim.state.stats.coinsEarned;
    const chest = makeProp('chest', 300, 200);
    sim.state.breakables = [chest];

    // Swinging at it from range does nothing.
    sim.state.player.x = chest.x;
    sim.state.player.y = chest.y + 80;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(sim.state.breakables[0]!.opened ?? false, false, 'attacks never open or break chests');

    // Walking up opens it, and it stays in the room as an open chest.
    sim.state.player.x = chest.x;
    sim.state.player.y = chest.y + 34;
    sim.step(idleInput());
    assert.equal(sim.state.breakables.length, 1, 'chest stays in the room');
    assert.equal(sim.state.breakables[0]!.opened, true, 'chest opens when you walk up');
    const uncollected = sim.state.coins.reduce((sum, c) => sum + c.value, 0);
    assert.equal(sim.state.stats.coinsEarned - earnedBefore + uncollected, 4, 'a chest gives 4 coins');
  });

  void it('disguises Mimics as still chests that wake when you get close and never block room clears', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.obstacles = [];
    sim.state.hazards = [];
    sim.state.player.iFramesTimer = 999;
    const mimicSpawn = { archetype: 'chaser' as const, x: 300, y: 160, mimic: true, dormant: true };
    const bp = (sim as unknown as { currentBlueprint: { waves: unknown[][] } }).currentBlueprint;
    bp.waves = [[mimicSpawn]];
    sim.state.enemies = [];
    sim.state.totalWaves = 1;
    sim.state.roomState = 'combat';
    (sim as unknown as { spawnWave: (i: number) => void }).spawnWave(0);
    const mimic = sim.state.enemies[0]!;
    assert.equal(mimic.mimic, true);
    assert.equal(mimic.dormant, true);

    sim.state.player.x = 300;
    sim.state.player.y = 380;
    stepFrames(sim, 30, () => idleInput());
    assert.equal(mimic.x, 300, 'a sleeping Mimic does not move');
    assert.equal(sim.state.roomState, 'door_open', 'a sleeping Mimic does not keep the doors shut');

    sim.state.player.y = 160 + 50;
    sim.step(idleInput());
    assert.equal(mimic.dormant, false, 'walking up wakes the Mimic');
    assert.equal(mimic.state, 'spawning', 'it plays its wake-up reveal first');
  });

  void it('varies daily rules and weapon restrictions without mutating the player profile', () => {
    const seenModes = new Set<string>();
    let sawTrialDate: string | null = null;
    let sawMeleeDate: string | null = null;
    let sawRangedDate: string | null = null;
    for (let day = 1; day <= 60; day += 1) {
      const mm = day <= 30 ? '11' : '12';
      const dd = String(day <= 30 ? day : day - 30).padStart(2, '0');
      const d = `2026-${mm}-${dd}`;
      const rule = getDailyRule(d);
      assert.notEqual(
        getDailyModifier(d).id,
        'slippery_floors',
        'Slippery Floors should not be selected',
      );
      assert.notEqual(rule.id, 'starter_relic', 'Head Start should never be selected');
      seenModes.add(rule.id);
      if (rule.weaponMode === 'locked' && !sawTrialDate) sawTrialDate = d;
      if (rule.weaponMode === 'melee_only' && !sawMeleeDate) sawMeleeDate = d;
      if (rule.weaponMode === 'ranged_only' && !sawRangedDate) sawRangedDate = d;
    }
    assert.ok(seenModes.size >= 5, `expected varied daily rules, saw ${[...seenModes].join(', ')}`);
    assert.ok(sawTrialDate && sawMeleeDate && sawRangedDate);

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
  });

  void it('never repeats the same modifier, rule, Floor 2 themed world, or Floor 1 boss on consecutive UTC dates', () => {
    let prevDate = '2026-11-01';
    for (let day = 2; day <= 30; day += 1) {
      const nextDate = `2026-11-${String(day).padStart(2, '0')}`;
      assert.notEqual(
        getDailyModifier(prevDate).id,
        getDailyModifier(nextDate).id,
        `modifier repeated on ${prevDate} -> ${nextDate}`,
      );
      assert.notEqual(
        getDailyRule(prevDate).id,
        getDailyRule(nextDate).id,
        `daily rule repeated on ${prevDate} -> ${nextDate}`,
      );
      assert.notEqual(
        getBiomeIdForFloor(2, prevDate),
        getBiomeIdForFloor(2, nextDate),
        `Floor 2 themed world repeated on ${prevDate} -> ${nextDate}`,
      );
      const bossKey = (d: string): string => {
        const spec = getFloorBossSpec(1, d);
        return `${spec.bossBase}:${spec.bossVariant}`;
      };
      assert.notEqual(bossKey(prevDate), bossKey(nextDate), `Floor 1 boss repeated on ${prevDate} -> ${nextDate}`);
      prevDate = nextDate;
    }
  });

  void it('spawns breaking debris physics for crates and TNT barrels', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    clearRoom(sim);

    const target = makeProp('crate', 300, 200);
    sim.state.breakables = [target];
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
      { id: 9901, type: 'barrels', x: sim.state.player.x, y: sim.state.player.y - 36, w: 56, h: 56, dirX: 0, dirY: 0, timer: 0, active: false, hp: 20, destroyed: false },
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

  void it('gives mages a slow homing bolt and leaves the Arch-Mage open after its nova', () => {
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
    shooter.state = 'telegraph';
    shooter.attackKind = 'arcane_bolt';
    shooter.telegraphDuration = 0.05;
    shooter.stateTimer = 0.01;
    sim.state.floor = 1;
    sim.state.projectiles = [];
    sim.state.enemies = [shooter];
    sim.step(idleInput());
    const bolts = sim.state.projectiles.filter((p) => !p.friendly);
    assert.equal(bolts.length, 1, 'a normal mage fires one bolt');
    assert.equal(bolts[0]!.kind, 'arcane');
    assert.ok((bolts[0]!.homing ?? 0) > 0, 'mage bolts gently home in');
    assert.ok(Math.hypot(bolts[0]!.vx, bolts[0]!.vy) < 260, 'mage bolts are slow enough to dodge');

    // Arch-Mage: after the blink nova it is exhausted (long still recovery) so melee can punish.
    const boss = createEnemy(9302, 'boss', 300, 200, 1, 1, 1, 1, 'shooter');
    boss.spawnShieldTimer = 0;
    boss.state = 'attack';
    boss.attackKind = 'blink_nova';
    boss.stateTimer = 0.01;
    sim.state.projectiles = [];
    sim.state.enemies = [boss];
    sim.step(idleInput());
    assert.equal(boss.state, 'recover');
    assert.ok(boss.stateTimer >= 1.2, 'Arch-Mage should be exhausted after its nova');
    const ring = sim.state.projectiles.filter((p) => !p.friendly);
    assert.ok(ring.length >= 8 && ring.length < 12, 'the nova ring always leaves a gap to slip through');

    // Wall-blocked strafe reverses direction instead of pinning
    shooter.x = PLAY_MIN_X + shooter.radius;
    shooter.y = 110;
    shooter.state = 'chase';
    shooter.stateTimer = 10;
    shooter.bouncesLeft = 1;
    sim.state.enemies = [shooter];
    sim.state.player.x = 360;
    sim.state.player.y = 110;
    sim.step(idleInput());
    sim.state.player.x = shooter.x;
    sim.state.player.y = 330;
    sim.step(idleInput());
    assert.equal(shooter.bouncesLeft, -1, 'shooter should flip strafe direction when blocked by arena wall');
  });

  void it('gives monsters 1 attack on Floor 1, 2 from Floor 2, and 3 as a boss', () => {
    const profile = createDefaultProfile();
    const attacksSeen = (floor: number, boss: boolean): Set<string> => {
      const sim = new GameSimulation('2026-11-20', profile);
      sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
      sim.state.obstacles = [];
      sim.state.hazards = [];
      sim.state.totalWaves = 5;
      sim.state.floor = floor;
      sim.state.player.iFramesTimer = 999;
      sim.state.player.x = ARENA_W / 2;
      sim.state.player.y = 330;
      const e = boss
        ? createEnemy(9401, 'boss', ARENA_W / 2, 140, 50, 1, 1, 1, 'archer')
        : createEnemy(9401, 'archer', ARENA_W / 2, 140, 50, 1, 1, 1);
      e.spawnShieldTimer = 0;
      e.state = 'chase';
      e.stateTimer = 0;
      sim.state.enemies = [e];
      const seen = new Set<string>();
      for (let i = 0; i < 900; i += 1) {
        sim.state.player.iFramesTimer = 999;
        sim.step(idleInput());
        if (e.attackKind !== 'none') seen.add(e.attackKind);
      }
      return seen;
    };
    assert.deepEqual([...attacksSeen(1, false)].sort(), ['shoot_arrow']);
    assert.deepEqual([...attacksSeen(2, false)].sort(), ['arrow_rain', 'shoot_arrow']);
    assert.deepEqual([...attacksSeen(1, true)].sort(), ['arrow_rain', 'shoot_arrow', 'snipe']);
  });

  void it('limits monster variety early and themes each world with its own cast', () => {
    for (const d of ['2026-11-20', '2026-11-25']) {
      const f1 = buildDailyDungeonMap(d, 1, getDailyHazard(d));
      const kinds = new Set(
        f1.rooms.flatMap((r) => r.blueprint.waves.flat().filter((w) => w.archetype !== 'boss').map((w) => w.archetype)),
      );
      kinds.delete('elite_charger');
      assert.ok(kinds.size <= 3, `Floor 1 should use at most 3 monster kinds, got ${[...kinds].join(', ')}`);
      for (const floor of [2, 4, 7]) {
        const roster = new Set(getFloorRoster(floor, d));
        const map = buildDailyDungeonMap(d, floor, getDailyHazard(d));
        for (const w of map.rooms.flatMap((r) => r.blueprint.waves.flat())) {
          if (w.archetype === 'boss' || w.archetype === 'elite_charger') continue;
          assert.ok(roster.has(w.archetype), `F${floor} spawned off-theme ${w.archetype}`);
        }
        assert.ok(roster.size <= getRosterSizeForFloor(floor));
      }
      assert.ok(getRosterSizeForFloor(8) > getRosterSizeForFloor(1), 'variety grows deeper down');
    }
  });

  void it('offers Whetstone (+15% dmg/lv) normally in the relic pool and never auto-scales player damage between floors', () => {
    const profile = createDefaultProfile();
    assert.ok(RELICS.whetstone.summary(1).includes('+15%'));
    assert.ok(RELICS.whetstone.summary(3).includes('+45%'));
    let whetstoneCount = 0;
    for (let i = 0; i < 30; i += 1) {
      const picks = draftRelics(createDailyStream('2026-11-20', `draft-${i}`), profile.unlockedRelics, 3);
      assert.equal(picks.length, 3);
      assert.equal(new Set(picks.map((r) => r.id)).size, 3);
      if (picks.some((r) => r.id === 'whetstone')) whetstoneCount += 1;
    }
    assert.ok(whetstoneCount > 0 && whetstoneCount < 30, `expected Whetstone in some but not all drafts (saw ${whetstoneCount}/30)`);
    assert.equal(Object.keys(RELICS).includes('blood_reset'), false, 'cooldown-on-kill relic is removed');

    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    const before = sim.state.player.damageBonusMult;
    sim.debugJumpToFloor(4);
    assert.equal(sim.state.player.damageBonusMult, before, 'going deeper alone never makes you stronger');
  });

  void it('freezes the run clock after the boss falls and hides the boss room until visited', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    assert.equal(sim.state.mapRooms.some((r) => r.isBoss), false, 'boss room is unknown at the start');
    assert.equal(sim.state.doors.some((d) => d.targetIsBoss), false, 'doors do not reveal the boss room');

    const map = (sim as unknown as { dungeonMap: { bossRoomId: number } }).dungeonMap;
    sim.enterMapRoom(map.bossRoomId, 'none', null);
    assert.equal(sim.state.mapRooms.some((r) => r.isBoss), true, 'boss room shows once you have been inside');
    clearRoom(sim);
    assert.ok(sim.state.roomState === 'reward' || sim.state.roomState === 'boss_choice');
    const scoreBefore = sim.getLiveScore();
    const clockBefore = sim.state.runTime;
    stepFrames(sim, 240, () => idleInput());
    assert.equal(sim.state.runTime, clockBefore, 'clock stops after the boss is beaten');
    assert.ok(sim.getLiveScore() >= scoreBefore, 'Score no longer ticks down after the boss');
  });

  void it('uses plain-language daily modifier names', () => {
    const banners = new Set<string>();
    for (let day = 1; day <= 28; day += 1) {
      banners.add(getDailyModifier(`2026-11-${String(day).padStart(2, '0')}`).banner);
    }
    assert.ok(banners.has('Enemies Explode on Death'));
    for (const b of banners) assert.equal(b.includes(':'), false, `banner should be plain: ${b}`);
  });

  void it('omits slidey currents on Floor 1, pulses mirror_guard bubble on ranged attacks, scales vitality proportionally, ships themed doors, and hides shop rule banner', () => {
    const f1 = buildDailyDungeonMap('2026-11-20', 1, 'currents');
    assert.equal(
      f1.rooms.some((r) => r.blueprint.hazards.some((h) => h.type === 'currents')),
      false,
      'Floor 1 must never spawn slidey current tiles',
    );

    const profile = {
      ...createDefaultProfile(),
      ownedWeapons: ['longsword' as const, 'arcane_lance' as const],
      equippedWeapon: 'arcane_lance' as const,
    };
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.obstacles = [];
    sim.state.hazards = [];
    sim.state.enemies = [];
    sim.state.totalWaves = 1;
    sim.state.player.hp = 60;
    sim.state.player.maxHp = 100;
    (sim as unknown as { claimPedestal: (p: { id: number; x: number; y: number; relic: typeof RELICS.vitality; nextLevel: number; claimProgress: number; hovered: boolean }) => void }).claimPedestal({
      id: 9991,
      x: 300,
      y: 220,
      relic: RELICS.vitality,
      nextLevel: 1,
      claimProgress: 0,
      hovered: true,
    });
    assert.equal(sim.state.player.maxHp, 125, 'Heart Vessel increases maxHp by 25');
    assert.equal(sim.state.player.hp, 75, 'Heart Vessel keeps exact 60% HP ratio (75/125)');

    sim.state.player.relics.mirror_guard = 1;
    sim.state.projectiles = [
      {
        id: 9992,
        friendly: false,
        x: sim.state.player.x + 50,
        y: sim.state.player.y,
        vx: -200,
        vy: 0,
        radius: 6,
        damage: 10,
        ttl: 2,
        pierce: false,
        hitEnemyIds: [],
        kind: 'orb',
        angle: Math.PI,
      },
    ];
    sim.state.hitstopTimer = 0;
    sim.state.rings = [];
    sim.step(idleInput({ aimX: sim.state.player.x + 60, aimY: sim.state.player.y, hasPointerAim: true, actionDown: true, actionJustPressed: true }));
    assert.ok(sim.state.player.mirrorBubbleTimer > 0, 'ranged attack with mirror_guard triggers shield bubble timer');
    assert.ok(sim.state.rings.some((r) => r.color === '#38bdf8'), 'mirror_guard emits cyan shield ward ring');
    assert.equal(sim.state.projectiles.some((pr) => pr.friendly && pr.kind === 'orb'), true, 'mirror_guard reflects nearby enemy shot');

    const doorsJson = JSON.parse(
      readFileSync(new URL('../../public/assets/dungeon/doors_atlas.json', import.meta.url), 'utf8'),
    ) as { frames: Record<string, unknown> };
    for (const w of ['candy', 'neon', 'space', 'reef', 'haunted', 'sky']) {
      for (const suffix of ['door_closed_l', 'door_closed_r', 'door_open_l', 'door_open_r']) {
        assert.ok(doorsJson.frames[`${w}_${suffix}`], `missing doors_atlas frame ${w}_${suffix}`);
      }
    }

    const shopViewSrc = readFileSync(new URL('../client/ui/shopView.ts', import.meta.url), 'utf8');
    assert.equal(shopViewSrc.includes('shop-rule-banner'), false, 'shop should not show Today\'s Rule banner');
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

void describe('Explosive barrels react to monster attacks', () => {
  const barrel = (id: number, x: number, y: number) => ({
    id,
    type: 'barrels' as const,
    x,
    y,
    w: 36,
    h: 36,
    dirX: 0,
    dirY: 0,
    timer: 0,
    active: false,
    hp: 20,
    destroyed: false,
  });

  const freshSim = (): GameSimulation => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile);
    sim.state.enemies = [];
    sim.state.totalWaves = 5;
    sim.state.obstacles = [];
    sim.state.breakables = [];
    sim.state.player.x = 100;
    sim.state.player.y = 400;
    sim.state.player.iFramesTimer = 99;
    return sim;
  };

  void it('monster bullets detonate barrels they hit', () => {
    const sim = freshSim();
    sim.state.hazards = [barrel(1, 400, 200)];
    sim.state.projectiles = [
      { id: 900, friendly: false, x: 330, y: 200, vx: 400, vy: 0, radius: 7, damage: 10, ttl: 2, pierce: false, hitEnemyIds: [], kind: 'orb', angle: 0 },
    ];
    stepFrames(sim, 20, () => idleInput());
    assert.equal(sim.state.hazards[0]!.destroyed, true);
    assert.equal(sim.state.projectiles.some((p) => p.id === 900), false, 'bullet is used up');
  });

  void it('charging monsters set off barrels they ram', () => {
    const sim = freshSim();
    sim.state.hazards = [barrel(2, 400, 200)];
    const charger = createEnemy(3001, 'charger', 330, 200, 1, 1, 1, 1);
    charger.spawnShieldTimer = 0;
    charger.state = 'attack';
    charger.attackKind = 'charge';
    charger.aimAngle = 0;
    charger.stateTimer = 1;
    sim.state.enemies = [charger];
    stepFrames(sim, 20, () => idleInput());
    assert.equal(sim.state.hazards[0]!.destroyed, true);
  });

  void it('barrel explosions chain into nearby barrels, but not far ones', () => {
    const sim = freshSim();
    sim.state.hazards = [barrel(4, 400, 200), barrel(5, 460, 200), barrel(6, 700, 420)];
    sim.state.projectiles = [
      { id: 901, friendly: false, x: 360, y: 200, vx: 400, vy: 0, radius: 7, damage: 10, ttl: 2, pierce: false, hitEnemyIds: [], kind: 'orb', angle: 0 },
    ];
    stepFrames(sim, 40, () => idleInput());
    assert.equal(sim.state.hazards[0]!.destroyed, true, 'first barrel hit by the bullet');
    assert.equal(sim.state.hazards[1]!.destroyed, true, 'neighbour chain-reacts');
    assert.equal(sim.state.hazards[2]!.destroyed, false, 'distant barrel untouched');
  });
});

void describe('Promoted Archetypes (Myconid, Imp, Archer), Zero Enemy Armor & Binary Spikes', () => {
  const setupArenaWith = (
    arch: EnemyArchetype,
    x: number,
    y: number,
    playerX = ARENA_W / 2,
    playerY = ARENA_H - 96,
  ): GameSimulation => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.obstacles = [];
    sim.state.hazards = [];
    sim.state.breakables = [];
    sim.state.totalWaves = 5;
    sim.state.player.x = playerX;
    sim.state.player.y = playerY;
    sim.state.player.iFramesTimer = 999;
    const foe = createEnemy(8101, arch, x, y, 1, 1, 1, 1);
    foe.spawnShieldTimer = 0;
    foe.state = 'chase';
    foe.stateTimer = 0;
    sim.state.enemies = [foe];
    return sim;
  };

  void it('spawns every enemy archetype with zero armor and chunky miniboss HP', () => {
    assert.equal(ALL_ENEMY_ARCHETYPES.length, 13);
    for (const arch of ALL_ENEMY_ARCHETYPES) {
      const foe = createEnemy(1, arch, 240, 200, 1, 1, 1, 1);
      assert.equal(foe.armor, 0, `${arch} must spawn with armor === 0`);
      assert.equal(foe.maxArmor, 0, `${arch} must spawn with maxArmor === 0`);
    }
    const warden = createEnemy(2, 'elite_charger', 240, 200, 1, 1, 1, 1);
    const tank = createEnemy(3, 'mortar_tank', 240, 200, 1, 1, 1, 1);
    assert.ok(warden.maxHp >= 240, `Warden baseHp should be bumped >= 240, got ${warden.maxHp}`);
    assert.ok(tank.maxHp >= 130, `Mortar Tank baseHp should be bumped >= 130, got ${tank.maxHp}`);
  });

  void it('Myconid telegraphs spore_burst, emits a lingering spore cloud, and damages overlapping hero', () => {
    const sim = setupArenaWith('myconid', ARENA_W / 2, ARENA_H - 180, ARENA_W / 2, ARENA_H - 96);
    const myc = sim.state.enemies[0]!;

    let sawSporeTelegraph = false;
    for (let i = 0; i < 60 && sim.state.sporeClouds.length === 0; i += 1) {
      sim.step(idleInput());
      if (myc.state === 'telegraph' && myc.attackKind === 'spore_burst') {
        sawSporeTelegraph = true;
      }
    }
    assert.equal(sawSporeTelegraph, true, 'Myconid should telegraph attackKind === spore_burst');
    assert.equal(sim.state.sporeClouds.length, 1, 'Myconid should emit a lingering spore cloud');
    const cloud = sim.state.sporeClouds[0]!;
    assert.ok(cloud.id > 0 && cloud.radius >= 50 && cloud.ttl > 0 && cloud.maxTtl === 2.6 && cloud.damage > 0);

    sim.state.player.iFramesTimer = 0;
    sim.state.player.hp = sim.state.player.maxHp;
    sim.state.player.x = cloud.x;
    sim.state.player.y = cloud.y;
    sim.step(idleInput());
    assert.ok(sim.state.player.hp < sim.state.player.maxHp, 'standing inside spore cloud should damage the player');

    sim.state.player.iFramesTimer = 999;
    sim.state.enemies = [];
    sim.state.totalWaves = 5;
    sim.state.waveIndex = 0;
    stepFrames(sim, Math.ceil(cloud.maxTtl / FIXED_DT) + 4, () => idleInput());
    assert.equal(sim.state.sporeClouds.length, 0, 'spore cloud should expire cleanly after ttl');
  });

  void it('Imp fires distinct ember dart projectiles and performs a diagonal flank hop', () => {
    const sim = setupArenaWith('imp', ARENA_W / 2, 160, ARENA_W / 2, 330);
    const imp = sim.state.enemies[0]!;

    let sawImpTelegraph = false;
    let sawEmberDart = false;
    let hopStartX = imp.x;
    let hopStartY = imp.y;
    let capturedHopStart = false;

    for (let i = 0; i < 65; i += 1) {
      sim.step(idleInput());
      if (imp.state === 'telegraph' && imp.attackKind === 'imp_dart') {
        sawImpTelegraph = true;
      }
      const ember = sim.state.projectiles.find((pr) => !pr.friendly && pr.kind === 'ember');
      if (ember) {
        sawEmberDart = true;
        assert.ok(Math.hypot(ember.vx, ember.vy) >= 380, 'ember dart should be fast');
        if (!capturedHopStart) {
          hopStartX = imp.x;
          hopStartY = imp.y;
          capturedHopStart = true;
        }
      }
    }

    assert.equal(sawImpTelegraph, true, 'Imp should telegraph attackKind === imp_dart');
    assert.equal(sawEmberDart, true, 'Imp should fire kind === ember dart projectile');
    const lateralShift = Math.abs(imp.x - hopStartX);
    const totalHopDist = Math.hypot(imp.x - hopStartX, imp.y - hopStartY);
    assert.ok(lateralShift >= 20 && totalHopDist >= 30, `Imp should flank hop sideways (dx=${lateralShift.toFixed(1)}, d=${totalHopDist.toFixed(1)})`);
  });

  void it('Archer fires fast narrow arrow projectiles aligned with aimAngle and mirror_guard rotates reflected arrows', () => {
    const sim = setupArenaWith('archer', ARENA_W / 2, 120, ARENA_W / 2, 360);
    const archer = sim.state.enemies[0]!;

    let sawArrowTelegraph = false;
    let arrowProj = sim.state.projectiles.find((pr) => !pr.friendly && pr.kind === 'arrow');
    for (let i = 0; i < 65 && !arrowProj; i += 1) {
      sim.step(idleInput());
      if (archer.state === 'telegraph' && archer.attackKind === 'shoot_arrow') {
        sawArrowTelegraph = true;
      }
      arrowProj = sim.state.projectiles.find((pr) => !pr.friendly && pr.kind === 'arrow');
    }

    assert.equal(sawArrowTelegraph, true, 'Archer should telegraph attackKind === shoot_arrow');
    assert.ok(arrowProj, 'Archer must fire a kind === arrow projectile');
    const speed = Math.hypot(arrowProj.vx, arrowProj.vy);
    assert.ok(speed >= 480, `arrow should be fast (got ${speed})`);
    assert.ok(arrowProj.radius <= 6, `arrow should have narrow hitbox (got ${arrowProj.radius})`);
    const velAngle = Math.atan2(arrowProj.vy, arrowProj.vx);
    assert.ok(Math.abs(arrowProj.angle - velAngle) < 0.01, 'arrow angle must match its flight velocity');

    sim.state.player.relics = { mirror_guard: 1 };
    arrowProj.x = sim.state.player.x;
    arrowProj.y = sim.state.player.y - 42;
    sim.state.player.attackCooldown = 0;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    assert.equal(arrowProj.friendly, true, 'mirror_guard should reflect enemy arrow');
    assert.ok(
      Math.abs(arrowProj.angle - Math.atan2(arrowProj.vy, arrowProj.vx)) < 0.01,
      'reflected arrow angle should match new reflected flight direction',
    );
  });

  void it('runs spikes with strict binary OFF/ON behavior and zero ambiguous half-active damage window', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.obstacles = [];
    sim.state.enemies = [];
    sim.state.totalWaves = 5;
    sim.state.player.x = 300;
    sim.state.player.y = 220;
    sim.state.player.iFramesTimer = 0;
    sim.state.player.hp = sim.state.player.maxHp;

    const spike = {
      id: 7701,
      type: 'spikes' as const,
      x: 300,
      y: 220,
      w: CELL_SIZE,
      h: CELL_SIZE,
      dirX: 0,
      dirY: 0,
      timer: 2.05,
      active: false,
      hp: 20,
      destroyed: false,
    };
    sim.state.hazards = [spike];

    while (spike.timer + FIXED_DT < SPIKE_ACTIVE_THRESHOLD) {
      sim.step(idleInput());
      assert.equal(spike.active, false, `spike must stay OFF at t=${spike.timer.toFixed(3)}`);
      assert.equal(sim.state.player.hp, sim.state.player.maxHp, 'OFF spikes must deal zero damage');
    }

    sim.step(idleInput());
    assert.equal(spike.active, true, 'spike must flip cleanly ON at threshold');
    assert.ok(sim.state.player.hp < sim.state.player.maxHp, 'ON spikes must damage player');

    const hpAfterHit = sim.state.player.hp;
    const framesToWrap = Math.ceil((SPIKE_CYCLE_SEC - spike.timer) / FIXED_DT) + 2;
    sim.state.player.iFramesTimer = 99;
    stepFrames(sim, framesToWrap, () => idleInput());
    assert.equal(spike.active, false, 'spike must flip cleanly OFF after cycle wrap');
    sim.state.player.iFramesTimer = 0;
    stepFrames(sim, 10, () => idleInput());
    assert.equal(spike.active, false);
    assert.equal(sim.state.player.hp, hpAfterHit, 'wrapped OFF spikes must deal zero damage');
  });

  void it('Bomber and Myconid close in and hit a completely stationary player', () => {
    for (const kind of ['bomber', 'myconid'] as const) {
      const sim = setupArenaWith(kind, 110, 224, 340, 224);
      sim.state.player.iFramesTimer = 0;
      sim.state.player.hp = 100;
      for (let i = 0; i < 240 && sim.state.player.hp === 100; i += 1) {
        sim.step(idleInput());
      }
      assert.ok(
        sim.state.player.hp < 100,
        `${kind} must close all the way in and damage a stationary player`,
      );
    }
  });

  void it('Golden Cleave scales attack damage with coins and triggers gilded AoE splash', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile, { ignoreDailyWeaponRule: true });
    sim.state.obstacles = [];
    sim.state.hazards = [];
    sim.state.totalWaves = 5;
    sim.state.player.relics = { golden_cleave: 2 };
    sim.state.stats.coinsEarned = 50;
    sim.state.player.x = 300;
    sim.state.player.y = 260;

    const primary = createEnemy(9101, 'charger', 300, 220, 1, 1, 1, 1);
    const splashTarget = createEnemy(9102, 'charger', 345, 220, 1, 1, 1, 1);
    primary.spawnShieldTimer = 0;
    splashTarget.spawnShieldTimer = 0;
    primary.hp = 200;
    splashTarget.hp = 200;
    sim.state.enemies = [primary, splashTarget];

    sim.state.player.attackCooldown = 0;
    sim.state.player.attackEndlagTimer = 0;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));

    assert.ok(primary.hp < 200, 'primary enemy should take buffed damage');
    assert.ok(splashTarget.hp < 200, 'nearby enemy should take Golden Cleave gild-blast damage');
    assert.ok(sim.state.coins.length >= 1, 'Golden Cleave should burst coins on hit');
  });

  void it('computes run Score in 1000s-100000s capped at 999999 from floor, coins, time, and HP lost', () => {
    const shallow = computeRunScore({
      floorReached: 1,
      floorsCleared: 0,
      roomsCleared: 2,
      coinsEarned: 12,
      elapsedSec: 65,
      damageTaken: 40,
      enemiesKilled: 8,
    });
    const deepFast = computeRunScore({
      floorReached: 5,
      floorsCleared: 4,
      roomsCleared: 24,
      coinsEarned: 180,
      elapsedSec: 320,
      damageTaken: 25,
      enemiesKilled: 95,
    });
    const deepSlow = computeRunScore({
      floorReached: 5,
      floorsCleared: 4,
      roomsCleared: 24,
      coinsEarned: 180,
      elapsedSec: 1800,
      damageTaken: 25,
      enemiesKilled: 95,
    });
    const deepHurt = computeRunScore({
      floorReached: 5,
      floorsCleared: 4,
      roomsCleared: 24,
      coinsEarned: 180,
      elapsedSec: 320,
      damageTaken: 250,
      enemiesKilled: 95,
    });
    const capped = computeRunScore({
      floorReached: 90,
      floorsCleared: 89,
      roomsCleared: 600,
      coinsEarned: 9000,
      elapsedSec: 120,
      damageTaken: 0,
      enemiesKilled: 3000,
    });

    assert.ok(shallow >= 1000 && shallow < 15000, `expected 1000s range for early run, got ${shallow}`);
    assert.ok(deepFast >= 40000 && deepFast <= 200000, `expected 10k-100k range, got ${deepFast}`);
    assert.ok(deepFast > deepSlow, 'faster clear time must earn higher score');
    assert.ok(deepSlow >= deepFast * 0.72, 'long clear time must not over-punish score');
    assert.ok(deepFast > deepHurt, 'losing less HP must earn higher score');
    assert.equal(capped, 999_999, 'score must cap cleanly at 999999');
  });

  void it('uses scaled-up existing monsters as floor bosses and keeps Floor 1 boss approachable', () => {
    const map1 = buildDailyDungeonMap('2026-11-24', 1, 'spikes');
    const bossRoom = map1.rooms.find((r) => r.blueprint.roomType === 'boss');
    assert.ok(bossRoom);
    const bossSpawn = bossRoom.blueprint.waves[0]?.find((w) => w.archetype === 'boss');
    assert.ok(bossSpawn?.bossBase, 'boss wave spawn should specify a base monster');
    assert.deepEqual(bossSpawn.bossBase, getFloorBossSpec(1, '2026-11-24').bossBase);

    for (const d of ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']) {
      const f1Spec = getFloorBossSpec(1, d);
      assert.ok(
        ['chaser', 'myconid', 'archer', 'shooter'].includes(f1Spec.bossBase),
        `Floor 1 boss on ${d} should be an approachable starter boss, got ${f1Spec.bossBase}`,
      );
      assert.notEqual(f1Spec.bossBase, 'stampede', 'Floor 1 boss must never be Alpha Bull');
    }
    assert.ok(getFloorScaling(1).bossHpScale < 0.8, 'Floor 1 boss HP scale should be softened below 0.8');

    const seenBossForms = new Set(
      [1, 2, 3, 4, 5].map((f) => {
        const s = getFloorBossSpec(f, '2026-11-24');
        return `${s.bossBase}:${s.bossVariant}`;
      }),
    );
    assert.equal(seenBossForms.size, 5, 'different floors should showcase distinct monster boss forms');
  });
});
