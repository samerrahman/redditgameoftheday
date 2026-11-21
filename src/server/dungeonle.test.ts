import assert from 'node:assert/strict';
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
  buildDailyDungeonMap,
  buildRoomBlueprint,
  oppositeDirection,
} from '../shared/game/rooms.ts';
import { GameSimulation } from '../shared/game/simulation.ts';
import {
  BUILD_ID,
  isDevResetAccount,
  isStampedBuildId,
} from '../shared/buildMeta.ts';
import { getDailyHazard, getDailyModifier } from '../shared/modifiers.ts';
import {
  applyRunToProfile,
  clearDailyRun,
  createDefaultProfile,
  getDailyRunSummary,
  hasCompletedDailyRun,
} from '../shared/profile.ts';
import { draftRelics } from '../shared/relics.ts';
import { createDailyStream, formatTimeUntilNextUtcDay } from '../shared/rng.ts';
import { formatShareComment } from '../shared/share.ts';
import { getDailyShopRotation, purchaseShopSlot, UPGRADES } from '../shared/shop.ts';
import type { InputFrame } from '../shared/types.ts';

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

void describe('Deterministic Daily RNG & Blueprints', () => {
  void it('produces identical results for the same UTC date and differs across dates', () => {
    const dateA = '2026-11-20';
    const dateB = '2026-11-25';
    const profile = createDefaultProfile();

    const hazardA = getDailyHazard(dateA);
    const hazardB = getDailyHazard(dateB);
    const mapA = buildDailyDungeonMap(dateA, hazardA);
    const mapB = buildDailyDungeonMap(dateB, hazardB);

    assert.deepEqual(getDailyModifier(dateA), getDailyModifier(dateA));
    assert.equal(hazardA, getDailyHazard(dateA));
    assert.deepEqual(getDailyShopRotation(dateA, profile), getDailyShopRotation(dateA, profile));
    assert.deepEqual(buildRoomBlueprint(dateA, 1, hazardA), buildRoomBlueprint(dateA, 1, hazardA));
    assert.deepEqual(mapA, buildDailyDungeonMap(dateA, hazardA));

    assert.ok(mapA.totalRooms >= 6 && mapA.totalRooms <= 8);
    assert.equal(mapA.rooms.length, mapA.totalRooms);
    const startRoom = mapA.rooms.find((r) => r.id === mapA.startRoomId);
    assert.ok(startRoom !== undefined);
    assert.ok(Object.keys(startRoom.doors).length >= 2);
    assert.ok(
      mapA.rooms.some((r) => r.id !== mapA.startRoomId && Object.keys(r.doors).length >= 2),
    );
    const bossNode = mapA.rooms.find((r) => r.id === mapA.bossRoomId);
    assert.ok(bossNode !== undefined);
    assert.equal(bossNode.blueprint.roomType, 'boss');

    const differs =
      getDailyModifier(dateA).id !== getDailyModifier(dateB).id ||
      hazardA !== hazardB ||
      JSON.stringify(mapA) !== JSON.stringify(mapB);
    assert.equal(differs, true);
  });
});

void describe('Simple WASD + 1-Button Manual Attack Combat', () => {
  void it('does NOT auto-attack idle enemies and does NOT dash when pressing attack', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile);
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
    sim.startNewRun('2026-11-20', profile);

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
    assert.equal(elite.state, 'staggered');
    assert.ok(sim.state.hitstopTimer > 0);
  });

  void it('enforces endlag slowdown and blocks hold-to-spamming past cooldown', () => {
    const profile = createDefaultProfile();
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile);

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
    sim.startNewRun('2026-11-20', profile);

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
    sim.startNewRun('2026-11-20', profile);

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

void describe('Branching Dungeon, Progress %, Fountain, Boss Extract vs Endless', () => {
  void it('navigates branching exits, remembers cleared rooms, heals at fountain, and supports Endless after boss', () => {
    const utcDate = '2026-11-20';
    const profile = createDefaultProfile();
    const map = buildDailyDungeonMap(utcDate, getDailyHazard(utcDate));
    const sim = new GameSimulation(utcDate, profile);
    sim.startNewRun(utcDate, profile);

    assert.equal(sim.state.progressPct, 0);
    assert.ok(sim.state.doors.length >= 2);

    sim.state.totalWaves = 1;
    sim.state.enemies = [];
    sim.step(idleInput());

    assert.equal(sim.state.progressPct, Math.round((1 / map.totalRooms) * 100));
    assert.equal(sim.state.roomState, 'reward');
    assert.equal(sim.state.pedestals.length, 3);

    const chosen = sim.state.pedestals[1];
    assert.ok(chosen !== undefined);
    sim.state.player.x = chosen.x;
    sim.state.player.y = chosen.y;
    stepFrames(sim, 32, () => idleInput());

    // Standing near/on a pedestal previews it but does NOT auto-claim
    assert.equal(sim.state.roomState, 'reward');
    assert.equal(sim.state.pedestals.length, 3);
    assert.equal(chosen.hovered, true);

    // Slashing at the pedestal claims the relic and opens the door
    sim.state.player.x = chosen.x;
    sim.state.player.y = chosen.y + 56;
    sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));

    assert.equal(sim.state.roomState, 'door_open');
    assert.equal(sim.state.pedestals.length, 0);
    assert.equal(sim.state.player.relics[chosen.relic.id], 1);

    const doorCoords = {
      north: { x: ARENA_W / 2, y: PLAY_MIN_Y + 8 },
      south: { x: ARENA_W / 2, y: PLAY_MAX_Y - 8 },
      west: { x: PLAY_MIN_X + 8, y: ARENA_H / 2 },
      east: { x: PLAY_MAX_X - 8, y: ARENA_H / 2 },
    };

    stepFrames(sim, 22, () => idleInput());
    const firstDoor = sim.state.doors[0];
    assert.ok(firstDoor !== undefined);
    sim.state.player.x = doorCoords[firstDoor.dir].x;
    sim.state.player.y = doorCoords[firstDoor.dir].y;
    sim.step(idleInput());

    assert.equal(sim.state.currentRoomId, firstDoor.targetRoomId);
    assert.equal(sim.state.roomTransitionKind, 'door');
    assert.equal(sim.state.roomTransitionDir, firstDoor.dir);
    assert.ok(sim.state.roomTransitionTimer > 0);

    const timeDuringTransition = sim.state.elapsedTime;
    sim.step(idleInput());
    assert.equal(sim.state.elapsedTime, timeDuringTransition);

    stepFrames(sim, 32, () => idleInput());
    assert.equal(sim.state.roomTransitionTimer, 0);
    assert.equal(sim.state.roomTransitionKind, 'none');

    // Clear neighbor room and walk back to Room 0 via opposite doorway
    sim.state.totalWaves = 1;
    sim.state.enemies = [];
    sim.step(idleInput());
    if (sim.state.roomState === 'reward' && sim.state.pedestals.length > 0) {
      const nextRelic = sim.state.pedestals[0];
      assert.ok(nextRelic !== undefined);
      sim.state.player.x = nextRelic.x;
      sim.state.player.y = nextRelic.y + 56;
      sim.step(idleInput({ moveY: -1, actionDown: true, actionJustPressed: true }));
    }

    stepFrames(sim, 22, () => idleInput());
    const returnDir = oppositeDirection(firstDoor.dir);
    sim.state.player.x = doorCoords[returnDir].x;
    sim.state.player.y = doorCoords[returnDir].y;
    sim.step(idleInput());

    assert.equal(sim.state.currentRoomId, map.startRoomId);
    assert.equal(sim.state.enemies.length, 0);
    assert.equal(sim.state.roomState, 'door_open');
    stepFrames(sim, 32, () => idleInput());

    const fountainNode = map.rooms.find((r) => r.blueprint.rewardType === 'fountain_and_relics');
    assert.ok(fountainNode !== undefined);
    sim.enterMapRoom(fountainNode.id);
    sim.state.player.hp = 40;
    sim.state.totalWaves = 1;
    sim.state.enemies = [];
    sim.step(idleInput());

    assert.ok(sim.state.fountain !== null);
    sim.state.player.x = sim.state.fountain.x;
    sim.state.player.y = sim.state.fountain.y;
    sim.step(idleInput());
    assert.equal(sim.state.player.hp, 75);

    const bossNode = map.rooms.find((r) => r.id === map.bossRoomId);
    assert.ok(bossNode !== undefined);
    sim.enterMapRoom(bossNode.id);
    sim.state.totalWaves = 1;
    sim.state.enemies = [];
    sim.step(idleInput());

    assert.equal(sim.state.roomState, 'boss_choice');
    assert.equal(sim.state.stats.bossDefeated, true);
    assert.deepEqual(
      sim.state.portals.map((p) => p.kind).sort(),
      ['endless', 'extract'],
    );

    const endlessPortal = sim.state.portals.find((p) => p.kind === 'endless');
    assert.ok(endlessPortal !== undefined);
    sim.state.player.x = endlessPortal.x;
    sim.state.player.y = endlessPortal.y;
    stepFrames(sim, 30, () => idleInput());
    assert.equal(sim.state.roomIndex, map.totalRooms + 1);
    assert.equal(sim.state.roomTransitionKind, 'portal');
    assert.ok(sim.state.roomTransitionTimer > 0);

    stepFrames(sim, 42, () => idleInput());
    assert.equal(sim.state.roomTransitionTimer, 0);

    sim.state.totalWaves = 1;
    sim.state.enemies = [];
    sim.step(idleInput());
    const extractPortal = sim.state.portals.find((p) => p.kind === 'extract');
    assert.ok(extractPortal !== undefined);
    sim.state.player.x = extractPortal.x;
    sim.state.player.y = extractPortal.y;
    stepFrames(sim, 30, () => idleInput());

    assert.equal(sim.state.phase, 'ended');
    assert.equal(sim.getRunSummary().outcome, 'extracted');
    assert.equal(sim.getRunSummary().roomReached, map.totalRooms + 1);
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

void describe('Coins, Streaks, Shop & Share Formatter', () => {
  void it('keeps coins on defeat/clear, updates UTC streaks, enforces shop rules, and formats share text', () => {
    let profile = createDefaultProfile();
    assert.equal(hasCompletedDailyRun(profile, '2026-11-19'), false);

    profile = applyRunToProfile(profile, {
      utcDate: '2026-11-19',
      outcome: 'defeated',
      bossDefeated: false,
      roomReached: 3,
      progressPct: 33,
      totalRooms: 6,
      elapsedSec: 185,
      coinsEarned: 45,
      damageTaken: 100,
      enemiesKilled: 22,
      relics: { ember_wake: 1 },
      score: 420,
    });

    assert.equal(profile.coins, 45);
    assert.equal(profile.streak, 1);
    assert.equal(hasCompletedDailyRun(profile, '2026-11-19'), true);
    assert.equal(getDailyRunSummary(profile, '2026-11-19')?.roomReached, 3);

    // Second run on the same UTC day must be rejected without changing profile or dailyBest
    profile = applyRunToProfile(profile, {
      utcDate: '2026-11-19',
      outcome: 'extracted',
      bossDefeated: true,
      roomReached: 6,
      progressPct: 100,
      totalRooms: 6,
      elapsedSec: 99,
      coinsEarned: 999,
      damageTaken: 10,
      enemiesKilled: 60,
      relics: {},
      score: 9999,
    });
    assert.equal(profile.coins, 45);
    assert.equal(profile.totalRuns, 1);
    assert.equal(profile.dailyBest['2026-11-19']?.bestScore, 420);

    assert.equal(isDevResetAccount('Mental_Glove6343'), true);
    assert.equal(isDevResetAccount('mental_glove6343'), true);
    assert.equal(isDevResetAccount('OtherUser'), false);
    assert.equal(isDevResetAccount(undefined), false);
    assert.equal(isStampedBuildId(BUILD_ID), false);
    assert.equal(isStampedBuildId('client-12345-1'), true);

    const clearedNov19 = clearDailyRun(profile, '2026-11-19');
    assert.equal(hasCompletedDailyRun(clearedNov19, '2026-11-19'), false);
    assert.equal(clearedNov19.coins, 45);
    assert.equal(clearedNov19.streak, 1);
    const replayedNov19 = applyRunToProfile(clearedNov19, {
      utcDate: '2026-11-19',
      outcome: 'defeated',
      bossDefeated: false,
      roomReached: 4,
      progressPct: 50,
      totalRooms: 6,
      elapsedSec: 200,
      coinsEarned: 15,
      damageTaken: 90,
      enemiesKilled: 25,
      relics: {},
      score: 510,
    });
    assert.equal(hasCompletedDailyRun(replayedNov19, '2026-11-19'), true);
    assert.equal(replayedNov19.streak, 1);
    assert.equal(replayedNov19.dailyBest['2026-11-19']?.bestScore, 510);

    assert.equal(formatTimeUntilNextUtcDay(Date.UTC(2026, 10, 21, 22, 30, 15)), '01:29:45');

    profile = applyRunToProfile(profile, {
      utcDate: '2026-11-20',
      outcome: 'extracted',
      bossDefeated: true,
      roomReached: 5,
      elapsedSec: 412,
      coinsEarned: 195,
      damageTaken: 42,
      enemiesKilled: 48,
      relics: { ember_wake: 2, rift_cleave: 1 },
      score: 1850,
    });

    assert.equal(profile.coins, 240);
    assert.equal(profile.streak, 2);

    const clearedKeepNov20 = clearDailyRun(profile, '2026-11-19');
    assert.equal(hasCompletedDailyRun(clearedKeepNov20, '2026-11-19'), false);
    assert.equal(hasCompletedDailyRun(clearedKeepNov20, '2026-11-20'), true);
    assert.equal(clearedKeepNov20.coins, 240);
    assert.equal(clearedKeepNov20.streak, 2);

    const slots = getDailyShopRotation('2026-11-20', profile);
    assert.equal(slots.length, 3);

    const relicSlot = slots[1];
    assert.equal(relicSlot.kind, 'relic');
    const buyRelic = purchaseShopSlot(profile, relicSlot);
    assert.equal(buyRelic.ok, true);
    profile = buyRelic.profile;
    assert.equal(
      profile.unlockedRelics.some((id) => id === relicSlot.itemId),
      true,
    );

    const drafted = draftRelics(
      createDailyStream('2026-11-20', 'test-draft'),
      profile.unlockedRelics,
      profile.unlockedRelics.length,
    );
    assert.equal(
      drafted.some((d) => d.id === relicSlot.itemId),
      true,
    );

    const upgradeSlot = slots[0];
    const upgradeId = upgradeSlot.itemId;
    if (
      upgradeId === 'vitality' ||
      upgradeId === 'reroll' ||
      upgradeId === 'magnet' ||
      upgradeId === 'shield'
    ) {
      profile.upgrades[upgradeId] = UPGRADES[upgradeId].maxLevel;
    }
    const maxedRotation = getDailyShopRotation('2026-11-20', profile);
    assert.equal(maxedRotation[0].maxed, true);
    const overBuy = purchaseShopSlot(profile, maxedRotation[0]);
    assert.equal(overBuy.ok, false);

    profile.pendingConsumable = 'bonus_relic';
    const sim = new GameSimulation('2026-11-20', profile);
    sim.startNewRun('2026-11-20', profile);
    assert.equal(Object.keys(sim.state.player.relics).length, 1);

    const shareText = formatShareComment(
      {
        utcDate: '2026-11-20',
        outcome: 'extracted',
        bossDefeated: true,
        roomReached: 7,
        totalRooms: 7,
        progressPct: 100,
        elapsedSec: 412,
        coinsEarned: 195,
        damageTaken: 42,
        enemiesKilled: 48,
        relics: { ember_wake: 2, rift_cleave: 1 },
        score: 1850,
      },
      'The Archives',
      'Glass Cannon: 2x Damage',
      'KC',
      2,
    );
    assert.ok(shareText.includes('DUNGEONLE 2026-11-20'));
    assert.ok(shareText.includes('CLEARED & EXTRACTED'));
    assert.ok(shareText.includes('100% Progress'));
    assert.ok(shareText.includes('6:52'));
    assert.ok(shareText.includes('2🔥'));

    const defeatShare = formatShareComment(
      {
        utcDate: '2026-11-20',
        outcome: 'defeated',
        bossDefeated: false,
        roomReached: 3,
        totalRooms: 7,
        progressPct: 33,
        elapsedSec: 95,
        coinsEarned: 15,
        damageTaken: 100,
        enemiesKilled: 12,
        relics: {},
        score: 210,
      },
      'The Archives',
      'Glass Cannon: 2x Damage',
      'KC',
    );
    assert.ok(defeatShare.includes('DIED IN ROOM 3'));
    assert.ok(defeatShare.includes('33% Progress'));
    assert.ok(defeatShare.includes('1🔥'));
    assert.equal(defeatShare.includes('FALLEN'), false);
  });
});
