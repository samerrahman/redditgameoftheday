import * as Phaser from 'phaser';
import {
  ARENA_H,
  ARENA_W,
  FIXED_DT,
  MAX_FRAME_DT,
  PLAY_MAX_X,
  PLAY_MAX_Y,
  PLAY_MIN_X,
  PLAY_MIN_Y,
  WALL_THICKNESS,
} from '../../shared/game/constants.ts';
import type { EnemyEntity } from '../../shared/game/enemies.ts';
import { CELL_SIZE, oppositeDirection } from '../../shared/game/rooms.ts';
import type { GameSimulation, GameState } from '../../shared/game/simulation.ts';
import { createDailyStream, type SeededRng } from '../../shared/rng.ts';
import { BIOME_SHEETS, getFloorBiome, type FloorBiome } from '../config/biomes.ts';
import { COSMETIC_IDS, COSMETICS, isCosmeticId } from '../../shared/shop.ts';
import { getWeapon } from '../../shared/weapons.ts';
import type { AccessoryId, CosmeticId, DoorDirection, EnemyArchetype } from '../../shared/types.ts';
import { hexNum, RELIC_SPRITE_FRAMES, type DungeonTheme } from '../config/theme.ts';
import {
  attachDungeonAtmosphere,
  type DungeonAtmosphereController,
} from '../shaders/DungeonAtmosphereFilter.ts';
import type { InputController } from '../game/input.ts';

const PIXEL_SCALE = 3;

function snapPx(value: number): number {
  return Math.round(value / PIXEL_SCALE) * PIXEL_SCALE;
}

function drawPixelShadow(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  alpha = 0.42,
): void {
  const x = snapPx(cx);
  const y = snapPx(cy);
  const hw = Math.max(PIXEL_SCALE * 2, snapPx(halfW));
  const hh = Math.max(PIXEL_SCALE, snapPx(halfH));
  const inset = hw > PIXEL_SCALE * 3 ? PIXEL_SCALE : 0;
  g.fillStyle(0x0b0710, alpha);
  g.fillRect(x - hw + inset, y - hh, (hw - inset) * 2, hh * 2);
  if (inset > 0) {
    g.fillRect(x - hw, y - hh + PIXEL_SCALE, hw * 2, Math.max(PIXEL_SCALE, hh * 2 - PIXEL_SCALE * 2));
  }
}

function getHeroAsset(costume: CosmeticId): { texture: 'dungeon' | 'cosmetics'; prefix: string } {
  if (isCosmeticId(costume) && COSMETICS[costume].slot === 'costume') {
    return { texture: 'cosmetics', prefix: costume };
  }
  return { texture: 'dungeon', prefix: 'hero' };
}

function getAccessoryId(cosmetic: CosmeticId): AccessoryId | null {
  if (!isCosmeticId(cosmetic)) return null;
  const def = COSMETICS[cosmetic];
  return def.slot === 'accessory' ? def.id : null;
}

function heroFrameBobPx(frameName: string): number {
  if (
    frameName.endsWith('_idle_1') ||
    frameName.endsWith('_run_1') ||
    frameName.endsWith('_dash_0') ||
    frameName.endsWith('_charge_0')
  ) {
    return 1;
  }
  if (
    frameName.endsWith('_run_0') ||
    frameName.endsWith('_run_2') ||
    frameName.endsWith('_dash_1') ||
    frameName.endsWith('_charge_1')
  ) {
    return -1;
  }
  return 0;
}

export type SceneBridge = {
  sim: GameSimulation;
  theme: DungeonTheme;
  getInput: () => InputController | null;
  onHudSync: () => void;
  onAudioSync: (state: GameState) => void;
};

type ManagedPedestal = {
  plinth: Phaser.GameObjects.Image;
  item: Phaser.GameObjects.Image;
};

type ManagedPortal = {
  hatch: Phaser.GameObjects.Image;
};

export class DungeonScene extends Phaser.Scene {
  private readonly bridge: SceneBridge;
  private assetsReady = false;
  private builtRoomKey = '';

  private roomContainer: Phaser.GameObjects.Container | null = null;
  private prevRoomContainer: Phaser.GameObjects.Container | null = null;
  private doorSprites = new Map<
    DoorDirection,
    { left: Phaser.GameObjects.Image; right: Phaser.GameObjects.Image }
  >();
  private wallTorches: Phaser.GameObjects.Sprite[] = [];
  private chestSprite: Phaser.GameObjects.Image | null = null;

  private torchGlowGraphics: Phaser.GameObjects.Graphics | null = null;
  private decalGraphics: Phaser.GameObjects.Graphics | null = null;
  private shadowGraphics: Phaser.GameObjects.Graphics | null = null;
  private telegraphGraphics: Phaser.GameObjects.Graphics | null = null;
  private fxGraphics: Phaser.GameObjects.Graphics | null = null;
  private transitionGraphics: Phaser.GameObjects.Graphics | null = null;

  private viewX = 0;
  private viewY = 0;
  private viewW = ARENA_W;
  private viewH = ARENA_H;
  private baseZoom = 1;
  private transitionGateSlammed = true;
  private transitionEntryDir: DoorDirection | null = null;
  private pendingPortalSwap = false;
  private pendingPortalKey = '';
  private transitionPoppedEnemyIds = new Set<number>();
  private heroTransitionPos: { x: number; y: number; angle: number } | null = null;

  private heroSprite: Phaser.GameObjects.Sprite | null = null;
  private hatSprite: Phaser.GameObjects.Sprite | null = null;
  private weaponSprite: Phaser.GameObjects.Image | null = null;
  private fountainTop: Phaser.GameObjects.Sprite | null = null;
  private fountainBottom: Phaser.GameObjects.Image | null = null;

  private readonly enemySprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly wardenShields = new Map<number, Phaser.GameObjects.Image>();
  private readonly hazardSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly breakableSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly coinSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly gemSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly heartSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly projectileSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly pedestalSprites = new Map<number, ManagedPedestal>();
  private readonly portalSprites = new Map<string, ManagedPortal>();

  private atmosphere: DungeonAtmosphereController | null = null;
  private shaderFlash = 0;
  private shaderFlashColor: [number, number, number] = [1, 0.85, 0.5];
  private ambientMotes: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    phase: number;
  }> = [];

  private firePool: Phaser.GameObjects.Sprite[] = [];
  private blastPool: Phaser.GameObjects.Image[] = [];
  private afterimagePool: Phaser.GameObjects.Image[] = [];
  private boomPool: Phaser.GameObjects.Sprite[] = [];
  private boomCursor = 0;

  private prevEnemies = new Map<number, { x: number; y: number; archetype: EnemyArchetype }>();
  private prevSwingCount = 0;
  private prevAttackCooldown = 0;
  private readyFlashTimer = 0;

  private fountainLabel: Phaser.GameObjects.Text | null = null;
  private tooltipText: Phaser.GameObjects.Text | null = null;
  private onboardingText: Phaser.GameObjects.Text | null = null;
  private labelPool: Phaser.GameObjects.Text[] = [];
  private poolCursor = 0;

  private accumulator = 0;
  private lastShakeLevel = 0;

  constructor(bridge: SceneBridge) {
    super('DungeonScene');
    this.bridge = bridge;
  }

  public preload(): void {
    this.load.atlas(
      'dungeon',
      './assets/dungeon/dungeon_atlas.png',
      './assets/dungeon/dungeon_atlas.json',
    );
    this.load.atlas(
      'cosmetics',
      './assets/dungeon/cosmetics_atlas.png',
      './assets/dungeon/cosmetics_atlas.json',
    );
    for (const sheet of BIOME_SHEETS) {
      this.load.spritesheet(sheet.key, sheet.url, { frameWidth: 16, frameHeight: 16 });
    }
  }

  public create(): void {
    this.cameras.main.setBackgroundColor(this.bridge.theme.ambientBg);
    this.registerAnimations();

    this.torchGlowGraphics = this.add.graphics().setDepth(2);
    this.shadowGraphics = this.add.graphics().setDepth(4);
    this.telegraphGraphics = this.add.graphics().setDepth(6);
    this.fxGraphics = this.add.graphics().setDepth(16);
    this.transitionGraphics = this.add.graphics().setDepth(30);

    this.atmosphere = attachDungeonAtmosphere(this);

    const moteRng = createDailyStream(this.bridge.sim.state.utcDate, 'ambient-motes');
    this.ambientMotes = Array.from({ length: 10 }, () => ({
      x: PLAY_MIN_X + 16 + moteRng.next() * (PLAY_MAX_X - PLAY_MIN_X - 32),
      y: PLAY_MIN_Y + 16 + moteRng.next() * (PLAY_MAX_Y - PLAY_MIN_Y - 32),
      vx: (moteRng.next() - 0.5) * 14,
      vy: -(6 + moteRng.next() * 14),
      phase: moteRng.next() * Math.PI * 2,
    }));

    this.heroSprite = this.add
      .sprite(ARENA_W / 2, ARENA_H - 90, 'dungeon', 'hero_idle_0')
      .setScale(PIXEL_SCALE)
      .setDepth(12)
      .setVisible(false);
    this.heroSprite.play('hero_idle');

    this.hatSprite = this.add
      .sprite(ARENA_W / 2, ARENA_H - 90, 'cosmetics', 'hat_crown_crest_0')
      .setOrigin(12 / 24, 16 / 28)
      .setScale(PIXEL_SCALE)
      .setDepth(13)
      .setVisible(false);

    this.weaponSprite = this.add
      .image(ARENA_W / 2, ARENA_H - 90, 'dungeon', 'tile_106')
      .setOrigin(0.5, 0.85)
      .setScale(2.75)
      .setDepth(14)
      .setVisible(false);

    this.fountainTop = this.add
      .sprite(0, 0, 'dungeon', 'fountain_0')
      .setScale(PIXEL_SCALE)
      .setDepth(9)
      .setVisible(false);
    this.fountainBottom = this.add
      .image(0, 0, 'dungeon', 'tile_032')
      .setScale(PIXEL_SCALE)
      .setDepth(8)
      .setVisible(false);

    this.chestSprite = this.add
      .image(ARENA_W / 2, ARENA_H / 2 - 20, 'dungeon', 'tile_091')
      .setScale(PIXEL_SCALE)
      .setDepth(8)
      .setVisible(false);

    this.firePool = Array.from({ length: 40 }, () =>
      this.add.sprite(0, 0, 'dungeon', 'fire_0').setScale(PIXEL_SCALE).setDepth(7).setVisible(false),
    );
    this.blastPool = Array.from({ length: 16 }, () =>
      this.add.image(0, 0, 'dungeon', 'barrel_tnt').setScale(PIXEL_SCALE).setDepth(7).setVisible(false),
    );
    this.afterimagePool = Array.from({ length: 16 }, () =>
      this.add
        .image(0, 0, 'dungeon', 'hero_dash_0')
        .setScale(PIXEL_SCALE)
        .setDepth(11)
        .setVisible(false),
    );
    this.boomPool = Array.from({ length: 16 }, () => {
      const s = this.add.sprite(0, 0, 'dungeon', 'boom_0').setScale(PIXEL_SCALE).setDepth(15).setVisible(false);
      s.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        s.setVisible(false);
      });
      return s;
    });

    this.fountainLabel = this.add
      .text(0, 0, '+35% HP FOUNTAIN', {
        fontFamily: "'Pixelify Sans', system-ui, sans-serif",
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#86efac',
        stroke: '#1a121b',
        strokeThickness: 5,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);

    this.tooltipText = this.add
      .text(ARENA_W / 2, 125, '', {
        fontFamily: "'Pixelify Sans', system-ui, sans-serif",
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#fff7e8',
        stroke: '#1a121b',
        strokeThickness: 4,
        align: 'center',
        wordWrap: { width: ARENA_W - 140 },
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(22)
      .setVisible(false);

    this.onboardingText = this.add
      .text(0, 0, 'WASD Move · Space / Click Attack', {
        fontFamily: "'Pixelify Sans', system-ui, sans-serif",
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#fff7e8',
        stroke: '#1a121b',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(22)
      .setVisible(false);

    this.labelPool = Array.from({ length: 32 }, () =>
      this.add
        .text(0, 0, '', {
          fontFamily: "'Pixelify Sans', system-ui, sans-serif",
          fontSize: '19px',
          fontStyle: 'bold',
          color: '#fff7e8',
          stroke: '#1a121b',
          strokeThickness: 5,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(21)
        .setVisible(false),
    );

    this.updateCameraLayout(this.scale.width, this.scale.height);
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.updateCameraLayout(gameSize.width, gameSize.height);
    });

    this.assetsReady = true;
    this.ensureRoomBackdrop(this.bridge.sim.state);
  }

  public screenToArena(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || this.viewW <= 0 || this.viewH <= 0) {
      return { x: ARENA_W / 2, y: ARENA_H / 2 };
    }
    const sx = ((clientX - rect.left) / rect.width) * this.scale.width;
    const sy = ((clientY - rect.top) / rect.height) * this.scale.height;
    return {
      x: ((sx - this.viewX) / this.viewW) * ARENA_W,
      y: ((sy - this.viewY) / this.viewH) * ARENA_H,
    };
  }

  public override update(_time: number, deltaMs: number): void {
    if (!this.assetsReady) return;

    const dt = Math.min(MAX_FRAME_DT, Math.max(0, deltaMs / 1000));
    const input = this.bridge.getInput();
    const sim = this.bridge.sim;

    if ((sim.state.phase === 'playing' || sim.state.phase === 'dying') && input) {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT) {
        sim.step(input.consumeTickInput(), FIXED_DT);
        this.accumulator -= FIXED_DT;
      }
      this.bridge.onHudSync();
    } else {
      this.accumulator = 0;
    }

    if (sim.state.shakeIntensity > this.lastShakeLevel + 0.5 && sim.state.shakeIntensity >= 2.5) {
      const norm = Math.min(0.014, sim.state.shakeIntensity * 0.0013);
      this.cameras.main.shake(90, norm);
    }
    this.lastShakeLevel = sim.state.shakeIntensity;
    this.readyFlashTimer = Math.max(0, this.readyFlashTimer - dt);
    this.shaderFlash = Math.max(0, this.shaderFlash - dt * 3.8);

    this.bridge.onAudioSync(sim.state);
    this.renderFrame(sim.state, dt);
  }

  private registerAnimations(): void {
    const define = (
      key: string,
      frames: Array<string | number>,
      frameRate: number,
      repeat = -1,
      atlasKey: 'dungeon' | 'cosmetics' | 'ski' | 'town' | 'battle' | 'farm' = 'dungeon',
    ) => {
      if (this.anims.exists(key)) return;
      this.anims.create({
        key,
        frames: frames.map((frame) => ({ key: atlasKey, frame })),
        frameRate,
        repeat,
      });
    };

    define('hero_idle', ['hero_idle_0', 'hero_idle_1', 'hero_idle_2', 'hero_idle_3'], 5);
    define('hero_run', ['hero_run_0', 'hero_run_1', 'hero_run_2', 'hero_run_3'], 10);
    define('hero_dash', ['hero_dash_0', 'hero_dash_1'], 12);
    define('hero_charge', ['hero_charge_0', 'hero_charge_1'], 8);

    for (const id of COSMETIC_IDS) {
      const def = COSMETICS[id];
      if (def.slot === 'costume') {
        define(`${id}_idle`, [`${id}_idle_0`, `${id}_idle_1`, `${id}_idle_2`, `${id}_idle_3`], 5, -1, 'cosmetics');
        define(`${id}_run`, [`${id}_run_0`, `${id}_run_1`, `${id}_run_2`, `${id}_run_3`], 10, -1, 'cosmetics');
        define(`${id}_dash`, [`${id}_dash_0`, `${id}_dash_1`], 12, -1, 'cosmetics');
        define(`${id}_charge`, [`${id}_charge_0`, `${id}_charge_1`], 8, -1, 'cosmetics');
      } else {
        define(
          `hat_${id}`,
          [`hat_${id}_0`, `hat_${id}_1`, `hat_${id}_2`, `hat_${id}_3`],
          6,
          -1,
          'cosmetics',
        );
      }
    }

    define('slime_idle', ['slime_idle_0', 'slime_idle_1', 'slime_idle_2', 'slime_idle_3'], 6);
    define('slime_run', ['slime_run_0', 'slime_run_1', 'slime_run_2', 'slime_run_3'], 10);
    define('slime_telegraph', ['slime_telegraph_0', 'slime_telegraph_1'], 12);

    define('wizard_idle', ['wizard_idle_0', 'wizard_idle_1', 'wizard_idle_2', 'wizard_idle_3'], 5);
    define('wizard_run', ['wizard_run_0', 'wizard_run_1', 'wizard_run_2', 'wizard_run_3'], 8);
    define('wizard_cast', ['wizard_cast_0', 'wizard_cast_1'], 10);

    define('cyclops_idle', ['cyclops_idle_0', 'cyclops_idle_1', 'cyclops_idle_2', 'cyclops_idle_3'], 5);
    define('cyclops_run', ['cyclops_run_0', 'cyclops_run_1', 'cyclops_run_2', 'cyclops_run_3'], 8);
    define('cyclops_charge', ['cyclops_charge_0', 'cyclops_charge_1'], 12);

    define('warden_idle', ['warden_idle_0', 'warden_idle_1', 'warden_idle_2', 'warden_idle_3'], 5);
    define('warden_run', ['warden_run_0', 'warden_run_1', 'warden_run_2', 'warden_run_3'], 8);
    define('warden_charge', ['warden_charge_0', 'warden_charge_1'], 12);

    define('boss_idle', ['boss_idle_0', 'boss_idle_1', 'boss_idle_2', 'boss_idle_3'], 6);
    define('boss_run', ['boss_run_0', 'boss_run_1', 'boss_run_2', 'boss_run_3'], 9);
    define('boss_attack', ['boss_attack_0', 'boss_attack_1'], 10);

    define('yeti_walk', [78, 79], 6, -1, 'ski');
    define('yeti_cast', [80], 6, -1, 'ski');
    define('tank_roll', [152], 6, -1, 'battle');
    define('tank_fire', [153], 6, -1, 'battle');

    define('coin_spin', ['coin_0', 'coin_1', 'coin_2', 'coin_3'], 10);
    define('gem_spin', ['gem_0', 'gem_1', 'gem_2', 'gem_3'], 8);
    define('heart_pulse', ['heart_0', 'heart_1'], 4);
    define('torch_burn', ['torch_0', 'torch_1', 'torch_2', 'torch_3'], 8);
    define('fire_burn', ['fire_0', 'fire_1', 'fire_2', 'fire_3'], 10);
    define('orb_enemy', ['orb_enemy_0', 'orb_enemy_1', 'orb_enemy_2', 'orb_enemy_3'], 12);
    define('orb_friendly', ['orb_friendly_0', 'orb_friendly_1', 'orb_friendly_2', 'orb_friendly_3'], 12);
    define('boom_pop', ['boom_0', 'boom_1', 'boom_2', 'boom_3'], 15, 0);
    define('fountain_flow', ['fountain_0', 'fountain_1'], 6);
  }

  private updateCameraLayout(width: number, height: number): void {
    const safeW = Math.max(1, width);
    const safeH = Math.max(1, height);
    this.cameras.resize(safeW, safeH);
    const zoom = Math.min(safeW / ARENA_W, safeH / ARENA_H);
    this.baseZoom = zoom;
    this.viewW = Math.max(1, Math.round(ARENA_W * zoom));
    this.viewH = Math.max(1, Math.round(ARENA_H * zoom));
    this.viewX = Math.floor((safeW - this.viewW) / 2);
    this.viewY = Math.floor((safeH - this.viewH) / 2);

    const cam = this.cameras.main;
    cam.setViewport(this.viewX, this.viewY, this.viewW, this.viewH);
    cam.setZoom(zoom);
    cam.centerOn(ARENA_W / 2, ARENA_H / 2);
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  private buildRoomContainer(
    state: GameState,
    openEntryDir: DoorDirection | null,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0).setDepth(0);
    const theme = this.bridge.theme;
    const biome = getFloorBiome(state.floor);
    const rng = createDailyStream(
      state.utcDate,
      `decor-${state.floor}-${state.currentRoomId}-${state.roomIndex}`,
    );
    const wallTint = biome.floor ? biome.wallTint : theme.wallTint;
    this.cameras.main.setBackgroundColor(biome.floor ? biome.ambientBg : theme.ambientBg);
    const tileSize = CELL_SIZE;
    const half = tileSize / 2;
    const cols = Math.round(ARENA_W / tileSize);
    const rows = Math.round(ARENA_H / tileSize);

    this.wallTorches = [];
    this.doorSprites.clear();
    const floorFrames = ['tile_048', 'tile_049', 'tile_050', 'tile_051', 'tile_052', 'tile_053'];

    const floorUnderlay = this.add.graphics();
    floorUnderlay.fillStyle(hexNum(theme.floorBg), 1);
    floorUnderlay.fillRect(0, 0, ARENA_W, ARENA_H);
    container.add(floorUnderlay);

    if (biome.floor) {
      this.buildBiomeFloor(container, biome, rng, cols, rows, tileSize);
    } else {
      for (let r = 1; r < rows - 1; r += 1) {
        for (let c = 1; c < cols - 1; c += 1) {
          const cx = c * tileSize + half;
          const cy = r * tileSize + half;
          const pickAlt = rng.next() < 0.05 ? 'tile_042' : rng.pick(floorFrames);
          const img = this.add
            .image(cx, cy, 'dungeon', pickAlt)
            .setDisplaySize(tileSize + 1, tileSize + 1)
            .setTint(theme.floorTint);
          container.add(img);
        }
      }
    }

    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cx = c * tileSize + half;
        const cy = r * tileSize + half;

        if (r === 0) {
          const wallFrame =
            c === 0
              ? 'tile_001'
              : c === cols - 1
                ? 'tile_003'
                : c === 3 || c === 8
                  ? 'tile_029'
                  : c === 2 || c === 9
                    ? 'tile_028'
                    : 'tile_014';
          const img = this.add
            .image(cx, cy, 'dungeon', wallFrame)
            .setDisplaySize(tileSize + 0.5, tileSize + 0.5)
            .setTint(wallTint);
          container.add(img);
        } else if (c === 0 || c === cols - 1) {
          const sideFrame = c === 0 ? 'tile_057' : 'tile_059';
          const img = this.add
            .image(cx, cy, 'dungeon', sideFrame)
            .setDisplaySize(tileSize + 0.5, tileSize + 0.5)
            .setTint(wallTint);
          container.add(img);
        }
      }
    }

    const botY = ARENA_H - half;
    for (let c = 0; c < cols; c += 1) {
      const cx = c * tileSize + half;
      const botFrame = c === 0 ? 'tile_025' : c === cols - 1 ? 'tile_027' : 'tile_026';
      const img = this.add
        .image(cx, botY, 'dungeon', botFrame)
        .setDisplaySize(tileSize + 0.5, tileSize)
        .setTint(wallTint);
      container.add(img);
    }

    // Subtle inner wall shadow framing the playable floor
    const borderShadow = this.add.graphics();
    borderShadow.fillStyle(0x000000, 0.28);
    borderShadow.fillRect(PLAY_MIN_X, PLAY_MIN_Y, PLAY_MAX_X - PLAY_MIN_X, 12);
    borderShadow.fillStyle(0x000000, 0.16);
    borderShadow.fillRect(PLAY_MIN_X, PLAY_MIN_Y, 8, PLAY_MAX_Y - PLAY_MIN_Y);
    borderShadow.fillRect(PLAY_MAX_X - 8, PLAY_MIN_Y, 8, PLAY_MAX_Y - PLAY_MIN_Y);
    container.add(borderShadow);

    // Embedded floor decal layer inside container so splatters scroll with old rooms
    const decalG = this.add.graphics();
    container.add(decalG);
    this.decalGraphics = decalG;

    // Cardinal doorway arches for this room's exits + entry door during transition
    const dirsToBuild = new Set<DoorDirection>(state.doors.map((d) => d.dir));
    if (openEntryDir) {
      dirsToBuild.add(openEntryDir);
    }
    const doorsAlreadyOpen = state.roomState === 'door_open' || state.roomState === 'boss_choice';

    for (const dir of dirsToBuild) {
      const open = dir === openEntryDir || doorsAlreadyOpen;
      const fLeft = open ? 'tile_022' : 'tile_046';
      const fRight = open ? 'tile_023' : 'tile_047';

      let left: Phaser.GameObjects.Image;
      let right: Phaser.GameObjects.Image;
      if (dir === 'north') {
        left = this.add.image(ARENA_W / 2 - half, half, 'dungeon', fLeft).setDisplaySize(tileSize, tileSize);
        right = this.add.image(ARENA_W / 2 + half, half, 'dungeon', fRight).setDisplaySize(tileSize, tileSize);
      } else if (dir === 'south') {
        left = this.add
          .image(ARENA_W / 2 - half, botY, 'dungeon', fLeft)
          .setDisplaySize(tileSize, tileSize)
          .setFlipY(true);
        right = this.add
          .image(ARENA_W / 2 + half, botY, 'dungeon', fRight)
          .setDisplaySize(tileSize, tileSize)
          .setFlipY(true);
      } else if (dir === 'east') {
        left = this.add
          .image(ARENA_W - half, ARENA_H / 2 - half, 'dungeon', fLeft)
          .setDisplaySize(tileSize, tileSize)
          .setRotation(Math.PI / 2);
        right = this.add
          .image(ARENA_W - half, ARENA_H / 2 + half, 'dungeon', fRight)
          .setDisplaySize(tileSize, tileSize)
          .setRotation(Math.PI / 2);
      } else {
        left = this.add
          .image(half, ARENA_H / 2 + half, 'dungeon', fLeft)
          .setDisplaySize(tileSize, tileSize)
          .setRotation(-Math.PI / 2);
        right = this.add
          .image(half, ARENA_H / 2 - half, 'dungeon', fRight)
          .setDisplaySize(tileSize, tileSize)
          .setRotation(-Math.PI / 2);
      }

      container.add([left, right]);
      this.doorSprites.set(dir, { left, right });
    }

    this.buildObstacleBlocks(container, biome, state);

    if (biome.decor.length > 0) {
      this.buildBiomeDecor(container, biome, rng, state, cols, rows, tileSize);
    }

    // 2 animated flickering wall torches flanking the north doorway (indoor biomes only)
    for (const tx of biome.torches ? [tileSize * 4.5, ARENA_W - tileSize * 4.5] : []) {
      const torch = this.add.sprite(tx, half, 'dungeon', 'torch_0').setScale(PIXEL_SCALE);
      torch.play('torch_burn');
      container.add(torch);
      this.wallTorches.push(torch);
    }

    return container;
  }

  private ensureRoomBackdrop(state: GameState): void {
    const key = `${state.utcDate}:${state.floor}:${state.currentRoomId}:${state.roomIndex}`;
    if (key === this.builtRoomKey) {
      if (state.currentRoomId === 0 && state.elapsedTime === 0 && this.prevEnemies.size > 0) {
        this.decalGraphics?.clear();
        this.prevEnemies.clear();
      }
      return;
    }

    const reducedMotion = this.prefersReducedMotion();

    if (
      state.roomTransitionTimer > 0 &&
      state.roomTransitionKind === 'door' &&
      this.roomContainer &&
      !reducedMotion
    ) {
      const travelDir = state.roomTransitionDir ?? 'north';
      const entryDir = oppositeDirection(travelDir);
      this.prevRoomContainer?.destroy();
      this.prevRoomContainer = this.roomContainer;
      if (travelDir === 'north') {
        this.prevRoomContainer.setPosition(0, ARENA_H);
      } else if (travelDir === 'south') {
        this.prevRoomContainer.setPosition(0, -ARENA_H);
      } else if (travelDir === 'east') {
        this.prevRoomContainer.setPosition(-ARENA_W, 0);
      } else {
        this.prevRoomContainer.setPosition(ARENA_W, 0);
      }
      this.transitionEntryDir = entryDir;
      this.roomContainer = this.buildRoomContainer(state, entryDir);
      this.prevEnemies.clear();
      this.transitionGateSlammed = false;
      this.transitionPoppedEnemyIds.clear();
      this.pendingPortalSwap = false;
      this.builtRoomKey = key;
      return;
    }

    if (
      state.roomTransitionTimer > 0 &&
      state.roomTransitionKind === 'portal' &&
      this.roomContainer &&
      !reducedMotion
    ) {
      this.pendingPortalSwap = true;
      this.pendingPortalKey = key;
      return;
    }

    this.prevRoomContainer?.destroy();
    this.prevRoomContainer = null;
    this.transitionEntryDir = null;
    this.roomContainer?.destroy();
    this.roomContainer = this.buildRoomContainer(state, null);
    this.prevEnemies.clear();
    this.transitionGateSlammed = true;
    this.transitionPoppedEnemyIds.clear();
    this.pendingPortalSwap = false;
    this.builtRoomKey = key;
  }

  private buildBiomeFloor(
    container: Phaser.GameObjects.Container,
    biome: FloorBiome,
    rng: SeededRng,
    cols: number,
    rows: number,
    tileSize: number,
  ): void {
    const floor = biome.floor;
    if (!floor) return;
    const place = (sheet: string, frame: number, c: number, r: number): void => {
      const img = this.add
        .image(c * tileSize + tileSize / 2, r * tileSize + tileSize / 2, sheet, frame)
        .setDisplaySize(tileSize + 1, tileSize + 1)
        .setTint(biome.floorTint);
      container.add(img);
    };
    for (let r = 1; r < rows - 1; r += 1) {
      for (let c = 1; c < cols - 1; c += 1) {
        const accent = floor.accents && rng.next() < 0.06;
        place(floor.sheet, accent ? rng.pick(floor.accents ?? floor.frames) : rng.pick(floor.frames), c, r);
      }
    }
    // Patches of a second ground (grass in town squares, tilled soil rows on farms).
    const patches = biome.patches;
    if (!patches) return;
    const isStrip = patches.sheet === 'farm';
    for (let i = 0; i < patches.count; i += 1) {
      const w = isStrip ? 4 : rng.int(2, 3);
      const h = isStrip ? 1 : rng.int(1, 2);
      const c0 = rng.int(2, cols - 3 - w);
      const r0 = rng.int(2, rows - 3 - h);
      for (let r = r0; r < r0 + h; r += 1) {
        for (let c = c0; c < c0 + w; c += 1) {
          // Farm soil rows are 4-tile strips: left cap, middles, right cap.
          const frame = isStrip
            ? (rng.next() < 0.5 ? 48 : 60) + Math.min(3, c - c0)
            : rng.pick(patches.frames);
          place(patches.sheet, frame, c, r);
        }
      }
    }
  }

  /** Solid layout blocks: themed sprites outdoors, carved obsidian monoliths in the dungeon. */
  private buildObstacleBlocks(
    container: Phaser.GameObjects.Container,
    biome: FloorBiome,
    state: GameState,
  ): void {
    if (state.obstacles.length === 0) return;
    const g = this.add.graphics();
    container.add(g);
    state.obstacles.forEach((o, i) => {
      g.fillStyle(0x0b0710, 0.36);
      g.fillRect(snapPx(o.x + 3), snapPx(o.y + o.h - 3), snapPx(o.w - 3), 6);
      if (biome.blocks) {
        const frame = biome.blocks.frames[(o.id + i) % biome.blocks.frames.length]!;
        container.add(
          this.add.image(o.x + o.w / 2, o.y + o.h / 2, biome.blocks.sheet, frame).setDisplaySize(o.w, o.h),
        );
        return;
      }
      container.add(
        this.add.image(o.x + o.w / 2, o.y + o.h / 2, 'dungeon', 'tile_064').setDisplaySize(o.w, o.h),
      );
    });
  }

  /** Scatter props around the room's edge, away from doors, crates, hazards and spawn. */
  private buildBiomeDecor(
    container: Phaser.GameObjects.Container,
    biome: FloorBiome,
    rng: SeededRng,
    state: GameState,
    cols: number,
    rows: number,
    tileSize: number,
  ): void {
    const midC = cols / 2;
    const midR = rows / 2;
    const blocked = [
      ...state.breakables.map((b) => ({ x: b.x, y: b.y })),
      ...state.hazards.map((h) => ({ x: h.x, y: h.y })),
      ...state.obstacles.map((o) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 })),
    ];
    const spots: Array<{ c: number; r: number }> = [];
    for (let r = 1; r <= rows - 2; r += 1) {
      for (let c = 1; c <= cols - 2; c += 1) {
        const onEdge = r === 1 || r === rows - 2 || c === 1 || c === cols - 2;
        if (!onEdge) continue;
        const inNsLane = Math.abs(c + 0.5 - midC) < 2;
        const inEwLane = Math.abs(r + 0.5 - midR) < 2;
        if ((r === 1 || r === rows - 2) && inNsLane) continue;
        if ((c === 1 || c === cols - 2) && inEwLane) continue;
        const x = c * tileSize + tileSize / 2;
        const y = r * tileSize + tileSize / 2;
        if (blocked.some((b) => Math.hypot(b.x - x, b.y - y) < 64)) continue;
        spots.push({ c, r });
      }
    }
    const total = biome.decor.reduce((sum, d) => sum + d.weight, 0);
    const count = Math.min(spots.length, rng.int(biome.decorCount[0], biome.decorCount[1]));
    const chosen = rng.shuffle(spots).slice(0, count);
    for (const spot of chosen) {
      let roll = rng.next() * total;
      let decor = biome.decor[0]!;
      for (const d of biome.decor) {
        roll -= d.weight;
        if (roll < 0) {
          decor = d;
          break;
        }
      }
      // Tall props need a free tile above them; fall back to a 1-tile prop on the top row.
      if (decor.frames.length > 1 && spot.r <= 1) {
        decor = biome.decor.find((d) => d.frames.length === 1) ?? decor;
      }
      const x = spot.c * tileSize + tileSize / 2;
      const baseY = spot.r * tileSize + tileSize / 2;
      const shadow = this.add.image(x, baseY + 18, 'dungeon', 'shadow_lg').setScale(PIXEL_SCALE).setAlpha(0.65);
      container.add(shadow);
      decor.frames.forEach((frame, i) => {
        const y = baseY - (decor.frames.length - 1 - i) * tileSize;
        container.add(this.add.image(x, y, decor.sheet, frame).setDisplaySize(tileSize, tileSize));
      });
    }
  }

  private updateRoomTransitionVisuals(state: GameState): void {
    const tG = this.transitionGraphics;
    const cam = this.cameras.main;
    tG?.clear();
    this.heroTransitionPos = null;

    if (state.roomTransitionTimer <= 0) {
      if (this.pendingPortalSwap) {
        this.prevRoomContainer?.destroy();
        this.prevRoomContainer = null;
        this.roomContainer?.destroy();
        this.roomContainer = this.buildRoomContainer(state, null);
        this.prevEnemies.clear();
        this.builtRoomKey = this.pendingPortalKey;
        this.pendingPortalSwap = false;
      }
      if (this.prevRoomContainer) {
        this.prevRoomContainer.destroy();
        this.prevRoomContainer = null;
      }
      this.transitionEntryDir = null;
      const open = state.roomState === 'door_open' || state.roomState === 'boss_choice';
      for (const pair of this.doorSprites.values()) {
        pair.left.setFrame(open ? 'tile_022' : 'tile_046');
        pair.right.setFrame(open ? 'tile_023' : 'tile_047');
      }
      cam.setZoom(this.baseZoom);
      cam.centerOn(ARENA_W / 2, ARENA_H / 2);
      return;
    }

    const dur = Math.max(0.01, state.roomTransitionDuration);
    const progress = Math.max(0, Math.min(1, 1 - state.roomTransitionTimer / dur));
    const reducedMotion = this.prefersReducedMotion();

    if (reducedMotion) {
      cam.setZoom(this.baseZoom);
      cam.centerOn(ARENA_W / 2, ARENA_H / 2);
      if (state.roomTransitionKind === 'portal' && this.pendingPortalSwap && progress >= 0.48) {
        this.roomContainer?.destroy();
        this.roomContainer = this.buildRoomContainer(state, null);
        this.prevEnemies.clear();
        this.builtRoomKey = this.pendingPortalKey;
        this.pendingPortalSwap = false;
      }
      tG?.fillStyle(0x120d14, 0.85 * Math.sin(progress * Math.PI));
      tG?.fillRect(0, 0, ARENA_W, ARENA_H);
      return;
    }

    if (state.roomTransitionKind === 'door') {
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const dir = state.roomTransitionDir ?? 'north';

      let camOffsetX = 0;
      let camOffsetY = 0;
      if (dir === 'north') {
        camOffsetY = ARENA_H * (1 - eased);
      } else if (dir === 'south') {
        camOffsetY = -ARENA_H * (1 - eased);
      } else if (dir === 'east') {
        camOffsetX = -ARENA_W * (1 - eased);
      } else {
        camOffsetX = ARENA_W * (1 - eased);
      }

      cam.setZoom(this.baseZoom);
      cam.centerOn(ARENA_W / 2 + camOffsetX, ARENA_H / 2 + camOffsetY);

      if (progress < 0.28) {
        const u = progress / 0.28;
        if (dir === 'north') {
          this.heroTransitionPos = {
            x: ARENA_W / 2,
            y: ARENA_H + PLAY_MIN_Y + 8 - u * (PLAY_MIN_Y + 12),
            angle: -Math.PI / 2,
          };
        } else if (dir === 'south') {
          this.heroTransitionPos = {
            x: ARENA_W / 2,
            y: -PLAY_MIN_Y - 8 + u * (PLAY_MIN_Y + 12),
            angle: Math.PI / 2,
          };
        } else if (dir === 'east') {
          this.heroTransitionPos = {
            x: -PLAY_MIN_X - 8 + u * (PLAY_MIN_X + 12),
            y: ARENA_H / 2,
            angle: 0,
          };
        } else {
          this.heroTransitionPos = {
            x: ARENA_W + PLAY_MIN_X + 8 - u * (PLAY_MIN_X + 12),
            y: ARENA_H / 2,
            angle: Math.PI,
          };
        }
      } else {
        const u = Math.min(1, (progress - 0.28) / 0.64);
        if (dir === 'north') {
          const endY = PLAY_MAX_Y - 48;
          this.heroTransitionPos = {
            x: ARENA_W / 2,
            y: ARENA_H - 4 - u * (ARENA_H - 4 - endY),
            angle: -Math.PI / 2,
          };
        } else if (dir === 'south') {
          const endY = PLAY_MIN_Y + 48;
          this.heroTransitionPos = {
            x: ARENA_W / 2,
            y: 4 + u * (endY - 4),
            angle: Math.PI / 2,
          };
        } else if (dir === 'east') {
          const endX = PLAY_MIN_X + 48;
          this.heroTransitionPos = {
            x: 4 + u * (endX - 4),
            y: ARENA_H / 2,
            angle: 0,
          };
        } else {
          const endX = PLAY_MAX_X - 48;
          this.heroTransitionPos = {
            x: ARENA_W - 4 - u * (ARENA_W - 4 - endX),
            y: ARENA_H / 2,
            angle: Math.PI,
          };
        }
      }

      if (progress >= 0.88 && !this.transitionGateSlammed) {
        this.transitionGateSlammed = true;
        const entryDir = this.transitionEntryDir;
        if (state.roomState === 'combat' && entryDir) {
          const pair = this.doorSprites.get(entryDir);
          pair?.left.setFrame('tile_046');
          pair?.right.setFrame('tile_047');
          cam.shake(55, 0.003);
          const boomPos =
            entryDir === 'south'
              ? { x: ARENA_W / 2, y: ARENA_H - 28 }
              : entryDir === 'north'
                ? { x: ARENA_W / 2, y: 28 }
                : entryDir === 'west'
                  ? { x: 28, y: ARENA_H / 2 }
                  : { x: ARENA_W - 28, y: ARENA_H / 2 };
          this.spawnBoom(boomPos.x, boomPos.y, 1.8);
        }
      }

      if (tG) {
        const veilAlpha = 0.24 * Math.sin(progress * Math.PI);
        tG.fillStyle(0x120d14, veilAlpha);
        tG.fillRect(camOffsetX, camOffsetY, ARENA_W, ARENA_H);
      }
      return;
    }

    if (state.roomTransitionKind === 'portal') {
      if (progress >= 0.48 && this.pendingPortalSwap) {
        this.prevRoomContainer?.destroy();
        this.prevRoomContainer = null;
        this.roomContainer?.destroy();
        this.roomContainer = this.buildRoomContainer(state, null);
        this.prevEnemies.clear();
        this.builtRoomKey = this.pendingPortalKey;
        this.pendingPortalSwap = false;
      }

      const rawS =
        progress < 0.45
          ? 1 - Math.pow(1 - progress / 0.45, 2)
          : progress < 0.55
            ? 1
            : 1 - Math.pow((progress - 0.55) / 0.45, 2);
      const shutter = Math.max(0, Math.min(1, rawS));
      cam.setZoom(this.baseZoom * (1 + 0.14 * shutter));
      cam.centerOn(ARENA_W / 2, ARENA_H / 2);

      if (tG && shutter > 0.01) {
        const halfH = Math.ceil((ARENA_H / 2) * shutter);
        this.drawPortcullisShutter(tG, 0, halfH, true);
        this.drawPortcullisShutter(tG, ARENA_H - halfH, halfH, false);
      }
    }
  }

  private updateDeathVisuals(state: GameState): void {
    const tG = this.transitionGraphics;
    const cam = this.cameras.main;
    if (!tG) return;

    if (state.phase === 'ended' && !state.stats.extracted) {
      if (!this.prefersReducedMotion()) {
        cam.setZoom(this.baseZoom * 1.22);
        const targetX = ARENA_W / 2 + (state.player.x - ARENA_W / 2) * 0.45;
        const targetY = ARENA_H / 2 + (state.player.y - ARENA_H / 2) * 0.45;
        cam.centerOn(targetX, targetY);
      }
      tG.fillStyle(0x120d14, 0.86);
      tG.fillRect(-ARENA_W * 0.5, -ARENA_H * 0.5, ARENA_W * 2, ARENA_H * 2);
      return;
    }

    if (state.phase !== 'dying') return;

    const dur = Math.max(0.01, state.deathDuration);
    const progress = Math.max(0, Math.min(1, 1 - state.deathTimer / dur));

    if (!this.prefersReducedMotion()) {
      const zoomEase = 1 - Math.pow(1 - Math.min(1, progress / 0.65), 3);
      cam.setZoom(this.baseZoom * (1 + 0.22 * zoomEase));
      const targetX = ARENA_W / 2 + (state.player.x - ARENA_W / 2) * 0.45 * zoomEase;
      const targetY = ARENA_H / 2 + (state.player.y - ARENA_H / 2) * 0.45 * zoomEase;
      cam.centerOn(targetX, targetY);
    }

    if (progress < 0.14) {
      const flashAlpha = 0.28 * (1 - progress / 0.14);
      tG.fillStyle(0xef4444, flashAlpha);
      tG.fillRect(-ARENA_W * 0.5, -ARENA_H * 0.5, ARENA_W * 2, ARENA_H * 2);
    }

    if (progress > 0.74) {
      const veilProgress = Math.min(1, (progress - 0.74) / 0.18);
      const veilAlpha = 0.86 * Math.pow(veilProgress, 1.3);
      tG.fillStyle(0x120d14, veilAlpha);
      tG.fillRect(-ARENA_W * 0.5, -ARENA_H * 0.5, ARENA_W * 2, ARENA_H * 2);
    }
  }

  private drawPortcullisShutter(
    g: Phaser.GameObjects.Graphics,
    topY: number,
    height: number,
    isTop: boolean,
  ): void {
    if (height <= 0) return;
    g.fillStyle(0x161018, 0.98);
    g.fillRect(0, topY, ARENA_W, height);

    g.fillStyle(0x4a3b4c, 1);
    for (let bx = 48; bx < ARENA_W; bx += 64) {
      g.fillRect(bx - 5, topY, 10, height);
    }

    const barY = isTop ? topY + Math.max(0, height - 18) : topY + 6;
    if (height >= 20) {
      g.fillStyle(0x2d2231, 1);
      g.fillRect(0, barY, ARENA_W, 12);
      g.fillStyle(0xf5b82e, 0.9);
      for (let rx = 48; rx < ARENA_W; rx += 64) {
        g.fillRect(rx - 2, barY + 4, 4, 4);
      }
    }

    const edgeY = isTop ? topY + height : topY;
    g.lineStyle(3, 0x7c6582, 1);
    g.lineBetween(0, edgeY, ARENA_W, edgeY);
  }

  private renderFrame(state: GameState, dt = 0): void {
    const shadowG = this.shadowGraphics;
    const teleG = this.telegraphGraphics;
    const fxG = this.fxGraphics;
    const glowG = this.torchGlowGraphics;
    if (!shadowG || !teleG || !fxG || !glowG) return;

    this.ensureRoomBackdrop(state);
    this.updateRoomTransitionVisuals(state);
    this.updateDeathVisuals(state);

    shadowG.clear();
    teleG.clear();
    fxG.clear();
    glowG.clear();
    this.resetLabels();

    this.processCombatEvents(state);
    this.drawTorchGlows(glowG, state);
    this.drawAmbientMotes(glowG, state, dt);
    this.syncExitDoor(fxG, state);
    this.syncHazards(teleG, shadowG, state);
    this.syncFountain(shadowG, state);
    this.syncChest(shadowG, state);
    this.syncPortals(fxG, state);
    this.syncPedestals(fxG, shadowG, state);
    this.syncBreakables(shadowG, state);
    this.syncCoins(shadowG, state);
    this.syncGems(shadowG, state);
    this.syncHearts(shadowG, state);
    this.syncFirePatches(state);
    this.syncDelayedBlasts(teleG, state);
    this.drawTelegraphs(teleG, state);
    this.syncAfterimages(state);
    this.syncEnemies(shadowG, fxG, state);
    this.syncPlayer(shadowG, fxG, state);
    this.syncProjectiles(shadowG, fxG, state);
    this.drawSlashesRingsLightningsParticles(fxG, state);
    this.drawFloatingTexts(state);
    this.drawOnboardingHint(fxG, state);
    this.drawTouchJoystick(fxG);
    this.updateAtmosphere(state);
  }

  private processCombatEvents(state: GameState): void {
    const currentIds = new Set(state.enemies.map((e) => e.id));
    for (const [id, prev] of this.prevEnemies.entries()) {
      if (!currentIds.has(id)) {
        this.stampSplatter(prev.x, prev.y, prev.archetype);
        this.spawnBoom(prev.x, prev.y, prev.archetype === 'boss' ? 4.0 : PIXEL_SCALE);
        if (prev.archetype === 'boss' && !this.prefersReducedMotion()) {
          this.shaderFlashColor = [1, 0.88, 0.55];
          this.shaderFlash = 0.34;
        }
      }
    }
    this.prevEnemies.clear();
    for (const e of state.enemies) {
      this.prevEnemies.set(e.id, { x: e.x, y: e.y, archetype: e.archetype });
    }

    if (state.player.hurtFlashTimer > 0.45 && !this.prefersReducedMotion()) {
      this.shaderFlashColor = [0.95, 0.2, 0.22];
      this.shaderFlash = Math.max(this.shaderFlash, 0.22);
    }

    if (state.player.swingCount > this.prevSwingCount && !this.prefersReducedMotion()) {
      this.cameras.main.shake(45, 0.0022);
    }
    this.prevSwingCount = state.player.swingCount;

    if (this.prevAttackCooldown > 0 && state.player.attackCooldown <= 0) {
      this.readyFlashTimer = 0.08;
    }
    this.prevAttackCooldown = state.player.attackCooldown;
  }

  private stampSplatter(x: number, y: number, archetype: EnemyArchetype): void {
    const d = this.decalGraphics;
    if (!d) return;
    const color =
      archetype === 'chaser'
        ? 0x22c55e
        : archetype === 'shooter' || archetype === 'shade'
          ? 0x9333ea
          : archetype === 'yeti'
            ? 0x38bdf8
            : archetype === 'bomber'
              ? 0xf59e0b
              : archetype === 'mortar_tank'
                ? 0x64748b
                : archetype === 'stampede'
                  ? 0x92400e
                  : archetype === 'boss'
                    ? 0xb02024
                    : 0x965630;
    const sx = snapPx(x);
    const sy = snapPx(y + 6);
    const s = PIXEL_SCALE;
    const rad = archetype === 'boss' ? 8 : 4;
    d.fillStyle(color, 0.36);
    for (let dy = -rad; dy <= rad; dy += 1) {
      for (let dx = -rad; dx <= rad; dx += 1) {
        if (dx * dx + dy * dy <= rad * rad) {
          d.fillRect(sx + dx * s, sy + dy * s, s, s);
        }
      }
    }
    d.fillRect(sx + (rad + 2) * s, sy - s, s * 2, s * 2);
    d.fillRect(sx - (rad + 2) * s, sy + 2 * s, s * 2, s * 2);
  }

  private spawnBoom(x: number, y: number, scale = PIXEL_SCALE): void {
    const sprite = this.boomPool[this.boomCursor];
    this.boomCursor = (this.boomCursor + 1) % this.boomPool.length;
    if (!sprite) return;
    sprite.setPosition(x, y).setScale(scale).setVisible(true).play('boom_pop');
  }

  private drawTorchGlows(g: Phaser.GameObjects.Graphics, state: GameState): void {
    if (this.atmosphere) return;
    const color = this.bridge.theme.torchGlowColor;
    for (let i = 0; i < this.wallTorches.length; i += 1) {
      const torch = this.wallTorches[i];
      if (!torch) continue;
      const flicker = 0.14 + Math.sin(state.elapsedTime * 11 + i * 1.9) * 0.035;
      const tx = snapPx(torch.x);
      const ty = snapPx(torch.y + 18);
      g.fillStyle(color, flicker);
      g.fillRect(tx - 48, ty - 36, 96, 72);
      g.fillStyle(0xfef08a, flicker * 0.55);
      g.fillRect(tx - 24, ty - 18, 48, 36);
    }
  }

  private syncExitDoor(fxG: Phaser.GameObjects.Graphics, state: GameState): void {
    const open = state.roomState === 'door_open' || state.roomState === 'boss_choice';
    const pulse = 0.25 + Math.sin(state.elapsedTime * 5) * 0.08;

    for (const door of state.doors) {
      const pair = this.doorSprites.get(door.dir);
      const isTransitionEntry =
        door.dir === this.transitionEntryDir &&
        state.roomTransitionTimer > 0 &&
        !this.transitionGateSlammed;
      if (pair && !isTransitionEntry) {
        pair.left.setFrame(open ? 'tile_022' : 'tile_046');
        pair.right.setFrame(open ? 'tile_023' : 'tile_047');
      }

      if (!open) continue;

      const glowColor = door.targetIsBoss
        ? 0xef4444
        : door.targetCleared
          ? 0x94a3b8
          : 0xfef08a;
      const glowAlpha = door.targetCleared ? 0.14 : pulse;

      let posX = ARENA_W / 2;
      let posY = WALL_THICKNESS + 18;
      let labelOffsetX = 0;
      let labelOffsetY = 20;
      let arrow = '▲';
      let horiz = true;

      if (door.dir === 'south') {
        posX = ARENA_W / 2;
        posY = ARENA_H - WALL_THICKNESS - 18;
        labelOffsetY = -22;
        arrow = '▼';
      } else if (door.dir === 'east') {
        posX = ARENA_W - WALL_THICKNESS - 18;
        posY = ARENA_H / 2;
        labelOffsetX = -26;
        labelOffsetY = 0;
        arrow = '▶';
        horiz = false;
      } else if (door.dir === 'west') {
        posX = WALL_THICKNESS + 18;
        posY = ARENA_H / 2;
        labelOffsetX = 26;
        labelOffsetY = 0;
        arrow = '◀';
        horiz = false;
      }

      fxG.fillStyle(glowColor, glowAlpha);
      const gx = snapPx(posX);
      const gy = snapPx(posY);
      fxG.fillRect(
        gx - (horiz ? 39 : 15),
        gy - (horiz ? 15 : 39),
        horiz ? 78 : 30,
        horiz ? 30 : 78,
      );

      if (door.targetIsBoss && !door.targetCleared) {
        this.nextLabel(posX + labelOffsetX, posY + labelOffsetY, 'BOSS', '#fecaca', 16);
      } else if (!door.targetCleared) {
        this.nextLabel(posX + labelOffsetX, posY + labelOffsetY, arrow, '#fde68a', 18);
      }
    }
  }

  private syncHazards(
    teleG: Phaser.GameObjects.Graphics,
    shadowG: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    const activeIds = new Set<number>();

    for (const haz of state.hazards) {
      if (haz.destroyed) continue;
      activeIds.add(haz.id);

      if (haz.type === 'currents') {
        const halfW = haz.w / 2;
        const halfH = haz.h / 2;
        teleG.fillStyle(0x38bdf8, 0.13);
        teleG.fillRect(haz.x - halfW, haz.y - halfH, haz.w, haz.h);
        teleG.lineStyle(2, 0x38bdf8, 0.34);
        teleG.strokeRect(haz.x - halfW, haz.y - halfH, haz.w, haz.h);

        const offset = ((state.elapsedTime * 90) % 44) * haz.dirX;
        teleG.lineStyle(3, hexNum(this.bridge.theme.hazardAccent), 0.75);
        for (let cx = haz.x - halfW + 30; cx <= haz.x + halfW - 30; cx += 44) {
          const px = snapPx(cx + offset);
          const py = snapPx(haz.y);
          if (px < haz.x - halfW + 14 || px > haz.x + halfW - 14) continue;
          const d = haz.dirX >= 0 ? 1 : -1;
          teleG.beginPath();
          teleG.moveTo(px - 6 * d, py - 9);
          teleG.lineTo(px + 6 * d, py);
          teleG.lineTo(px - 6 * d, py + 9);
          teleG.strokePath();
        }
        continue;
      }

      let spr = this.hazardSprites.get(haz.id);
      if (!spr) {
        spr = this.add.image(haz.x, haz.y, 'dungeon', 'spikes_0');
        this.hazardSprites.set(haz.id, spr);
      }

      if (haz.type === 'spikes') {
        const warning = haz.timer >= 2.0 && haz.timer < 2.55;
        const active = haz.timer >= 2.55;
        spr
          .setPosition(haz.x, haz.y)
          .setFrame(active ? 'spikes_2' : warning ? 'spikes_1' : 'spikes_0')
          .setDisplaySize(haz.w, haz.h)
          .setDepth(5)
          .setVisible(true);
      } else {
        drawPixelShadow(shadowG, haz.x, haz.y + 15, 18, 6, 0.42);
        spr
          .setPosition(haz.x, haz.y)
          .setFrame('barrel_tnt')
          .setScale(PIXEL_SCALE)
          .setDepth(9)
          .setVisible(true);
      }
    }

    for (const [id, spr] of this.hazardSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.hazardSprites.delete(id);
      }
    }
  }

  private syncFountain(shadowG: Phaser.GameObjects.Graphics, state: GameState): void {
    const f = state.fountain;
    if (!f || !this.fountainTop || !this.fountainBottom) {
      this.fountainTop?.setVisible(false);
      this.fountainBottom?.setVisible(false);
      return;
    }

    const active = !f.used;
    drawPixelShadow(shadowG, f.x, f.y + 21, 24, 9, 0.44);

    this.fountainTop.setPosition(f.x, f.y - 24).setVisible(true);
    this.fountainBottom.setPosition(f.x, f.y + 18).setVisible(true);

    if (active) {
      this.fountainTop.play('fountain_flow', true);
      this.fountainBottom.setFrame('tile_032');
    } else {
      this.fountainTop.stop();
      this.fountainTop.setFrame('tile_019');
      this.fountainBottom.setFrame('tile_031');
    }

    this.fountainLabel
      ?.setPosition(f.x, f.y - 54)
      .setText(active ? '+35% HP FOUNTAIN' : 'FOUNTAIN USED')
      .setColor(active ? '#86efac' : '#94a3b8')
      .setVisible(true);
  }

  private syncChest(shadowG: Phaser.GameObjects.Graphics, state: GameState): void {
    if (!this.chestSprite) return;
    const showChest =
      (state.rewardType === 'coin_cache' && state.roomState === 'door_open') ||
      (state.rewardType === 'boss_chest_and_portals' && state.roomState === 'boss_choice');
    if (!showChest) {
      this.chestSprite.setVisible(false);
      return;
    }
    const cx = ARENA_W / 2;
    const cy = ARENA_H / 2 - 20;
    drawPixelShadow(shadowG, cx, cy + 18, 21, 6, 0.44);
    this.chestSprite.setPosition(cx, cy).setVisible(true);
  }

  private syncPortals(fxG: Phaser.GameObjects.Graphics, state: GameState): void {
    const activeKeys = new Set<string>();

    for (const portal of state.portals) {
      const key = `${portal.kind}:${portal.x}:${portal.y}`;
      activeKeys.add(key);

      let entry = this.portalSprites.get(key);
      if (!entry) {
        const hatch = this.add
          .image(portal.x, portal.y, 'dungeon', 'tile_056')
          .setScale(PIXEL_SCALE)
          .setDepth(7);
        entry = { hatch };
        this.portalSprites.set(key, entry);
      }
      entry.hatch.setPosition(portal.x, portal.y).setVisible(true);

      const primary = 0xf5c234;
      const sx = snapPx(portal.x);
      const sy = snapPx(portal.y);
      const box = Math.sin(state.elapsedTime * 5) > 0 ? 30 : 27;

      // Crisp stepped pixel rune brackets framing the descent stairs (zero mixels)
      fxG.fillStyle(primary, 0.16);
      fxG.fillRect(sx - 27, sy - 27, 54, 54);
      fxG.fillStyle(primary, 0.92);
      fxG.fillRect(sx - box, sy - box, 12, 3);
      fxG.fillRect(sx - box, sy - box, 3, 12);
      fxG.fillRect(sx + box - 12, sy - box, 12, 3);
      fxG.fillRect(sx + box - 3, sy - box, 3, 12);
      fxG.fillRect(sx - box, sy + box - 3, 12, 3);
      fxG.fillRect(sx - box, sy + box - 12, 3, 12);
      fxG.fillRect(sx + box - 12, sy + box - 3, 12, 3);
      fxG.fillRect(sx + box - 3, sy + box - 12, 3, 12);

      if (portal.progress > 0) {
        const segs = 16;
        const lit = Math.ceil(segs * portal.progress);
        for (let i = 0; i < lit; i += 1) {
          const ang = -Math.PI / 2 + (i / segs) * Math.PI * 2;
          const rx = snapPx(sx + Math.cos(ang) * 36);
          const ry = snapPx(sy + Math.sin(ang) * 36);
          fxG.fillStyle(0xfef08a, 1);
          fxG.fillRect(rx - 3, ry - 3, 6, 6);
        }
      }

      this.nextLabel(portal.x, portal.y - 48, portal.label, '#fff7e8', 17);
    }

    for (const [key, entry] of this.portalSprites.entries()) {
      if (!activeKeys.has(key)) {
        entry.hatch.destroy();
        this.portalSprites.delete(key);
      }
    }
  }

  private syncPedestals(
    fxG: Phaser.GameObjects.Graphics,
    shadowG: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    const activeIds = new Set<number>();

    if (state.pedestals.length > 0) {
      for (const ped of state.pedestals) {
        activeIds.add(ped.id);
        const itemFrame = RELIC_SPRITE_FRAMES[ped.relic.id];

        let entry = this.pedestalSprites.get(ped.id);
        if (!entry) {
          const plinth = this.add
            .image(ped.x, ped.y + 9, 'dungeon', 'tile_065')
            .setScale(PIXEL_SCALE)
            .setDepth(8);
          const item = this.add
            .image(ped.x, ped.y - 15, 'dungeon', itemFrame)
            .setScale(PIXEL_SCALE)
            .setDepth(10);
          entry = { plinth, item };
          this.pedestalSprites.set(ped.id, entry);
        }

        const bob = Math.round(Math.sin(state.elapsedTime * 4.2 + ped.id)) * PIXEL_SCALE;
        entry.plinth.setPosition(ped.x, ped.y + 9).setVisible(true);
        entry.item
          .setFrame(itemFrame)
          .setPosition(ped.x, ped.y - 18 + bob)
          .setScale(PIXEL_SCALE)
          .setVisible(true);
        if (ped.hovered) {
          entry.item.setTint(0xfef08a);
        } else {
          entry.item.clearTint();
        }

        drawPixelShadow(shadowG, ped.x, ped.y + 27, 21, 6, 0.44);

        const lvLabel = ped.nextLevel > 1 ? ` ${ped.nextLevel}` : '';
        this.nextLabel(ped.x, ped.y + 50, `${ped.relic.name}${lvLabel}`, ped.hovered ? '#fde047' : '#fff7e8', 17);
      }

      // Only describe a relic when you stand next to it.
      const hovered = state.pedestals.find((p) => p.hovered);
      if (!hovered) {
        this.tooltipText?.setVisible(false);
      } else {
        const tipText = hovered.relic.summary(hovered.nextLevel);

        this.tooltipText?.setText(tipText).setVisible(true);
        const measuredW = this.tooltipText?.width ?? 320;
        const measuredH = this.tooltipText?.height ?? 24;
        const boxW = Math.min(ARENA_W - 80, Math.max(360, Math.ceil(measuredW + 48)));
        const boxH = Math.max(42, Math.ceil(measuredH + 16));
        const boxX = ARENA_W / 2 - boxW / 2;
        const boxY = 104;
        fxG.fillStyle(0x140d1d, 0.94);
        fxG.fillRect(boxX, boxY, boxW, boxH);
        fxG.lineStyle(3, 0xf5c234, 1);
        fxG.strokeRect(boxX, boxY, boxW, boxH);

        this.tooltipText?.setPosition(ARENA_W / 2, boxY + boxH / 2);
      }
    }

    for (const [id, entry] of this.pedestalSprites.entries()) {
      if (!activeIds.has(id)) {
        entry.plinth.destroy();
        entry.item.destroy();
        this.pedestalSprites.delete(id);
      }
    }
  }

  private syncBreakables(shadowG: Phaser.GameObjects.Graphics, state: GameState): void {
    const activeIds = new Set<number>();

    for (const br of state.breakables) {
      activeIds.add(br.id);
      const frame = br.kind === 'pillar' ? 'tile_065' : 'tile_063';
      let spr = this.breakableSprites.get(br.id);
      if (!spr) {
        spr = this.add.image(br.x, br.y, 'dungeon', frame).setScale(PIXEL_SCALE).setDepth(9);
        this.breakableSprites.set(br.id, spr);
      }

      drawPixelShadow(shadowG, br.x, br.y + 18, br.radius * 0.9, 6, 0.38);

      spr.setPosition(br.x, br.y).setFrame(frame);
      if (br.hitFlash > 0) {
        spr.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      } else {
        spr.clearTint();
      }
    }

    for (const [id, spr] of this.breakableSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.breakableSprites.delete(id);
      }
    }
  }

  private syncCoins(shadowG: Phaser.GameObjects.Graphics, state: GameState): void {
    const activeIds = new Set<number>();

    for (const coin of state.coins) {
      activeIds.add(coin.id);
      let spr = this.coinSprites.get(coin.id);
      if (!spr) {
        spr = this.add.sprite(coin.x, coin.y, 'dungeon', 'coin_0').setScale(PIXEL_SCALE).setDepth(9);
        spr.play('coin_spin');
        this.coinSprites.set(coin.id, spr);
      }

      const bob = Math.round(Math.sin(state.elapsedTime * 8 + coin.id)) * PIXEL_SCALE;
      drawPixelShadow(shadowG, coin.x, coin.y + 12, 9, 3, 0.34);
      spr.setPosition(coin.x, coin.y - 3 + bob);
    }

    for (const [id, spr] of this.coinSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.coinSprites.delete(id);
      }
    }
  }

  private syncGems(shadowG: Phaser.GameObjects.Graphics, state: GameState): void {
    const activeIds = new Set<number>();

    for (const gem of state.gems) {
      activeIds.add(gem.id);
      let spr = this.gemSprites.get(gem.id);
      if (!spr) {
        spr = this.add.sprite(gem.x, gem.y, 'dungeon', 'gem_0').setScale(PIXEL_SCALE).setDepth(9);
        spr.play('gem_spin');
        this.gemSprites.set(gem.id, spr);
      }

      const bob = Math.round(Math.sin(state.elapsedTime * 6 + gem.id)) * PIXEL_SCALE;
      drawPixelShadow(shadowG, gem.x, gem.y + 12, 9, 3, 0.36);
      spr.setPosition(gem.x, gem.y - 3 + bob);
    }

    for (const [id, spr] of this.gemSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.gemSprites.delete(id);
      }
    }
  }

  private syncHearts(shadowG: Phaser.GameObjects.Graphics, state: GameState): void {
    const activeIds = new Set<number>();

    for (const heart of state.hearts) {
      activeIds.add(heart.id);
      let spr = this.heartSprites.get(heart.id);
      if (!spr) {
        spr = this.add.sprite(heart.x, heart.y, 'dungeon', 'heart_0').setScale(PIXEL_SCALE).setDepth(9);
        spr.play('heart_pulse');
        this.heartSprites.set(heart.id, spr);
      }

      const bob = Math.round(Math.sin(state.elapsedTime * 5 + heart.id)) * PIXEL_SCALE;
      drawPixelShadow(shadowG, heart.x, heart.y + 12, 9, 3, 0.36);
      spr.setPosition(heart.x, heart.y - 3 + bob);
    }

    for (const [id, spr] of this.heartSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.heartSprites.delete(id);
      }
    }
  }

  private syncFirePatches(state: GameState): void {
    for (let i = 0; i < this.firePool.length; i += 1) {
      const spr = this.firePool[i];
      const patch = state.firePatches[i];
      if (!spr) continue;
      if (!patch) {
        spr.setVisible(false);
        continue;
      }
      const alpha = Math.min(1, patch.ttl / 0.5);
      spr.setPosition(patch.x, patch.y).setAlpha(alpha).setVisible(true);
      spr.play('fire_burn', true);
    }
  }

  private syncDelayedBlasts(teleG: Phaser.GameObjects.Graphics, state: GameState): void {
    for (let i = 0; i < this.blastPool.length; i += 1) {
      const spr = this.blastPool[i];
      const blast = state.delayedBlasts[i];
      if (!spr) continue;
      if (!blast) {
        spr.setVisible(false);
        continue;
      }

      const progress = 1 - blast.timer / blast.maxTimer;
      const stroke = blast.friendly
        ? 0xfb923c
        : blast.kind === 'ice_mortar'
          ? 0x67e8f9
          : 0xef4444;
      teleG.fillStyle(stroke, blast.friendly ? 0.15 : 0.22);
      teleG.fillCircle(blast.x, blast.y, blast.radius);
      teleG.lineStyle(2, stroke, 1);
      teleG.strokeCircle(blast.x, blast.y, Math.max(4, blast.radius * progress));

      if (blast.kind === 'decoy_mine') {
        spr.setTexture('dungeon', 'barrel_tnt').setScale(PIXEL_SCALE).setPosition(blast.x, blast.y).setAlpha(1).setVisible(true);
      } else if (blast.kind === 'sapper_bomb') {
        spr.setTexture('town', 105).setScale(2).setPosition(blast.x, blast.y).setAlpha(1).setVisible(true);
      } else if (blast.kind === 'phantom_echo') {
        spr.setTexture('dungeon', 'hero_dash_0').setScale(PIXEL_SCALE).setPosition(blast.x, blast.y).setAlpha(0.65).setVisible(true);
      } else {
        spr.setVisible(false);
      }
    }
  }

  private drawTelegraphs(teleG: Phaser.GameObjects.Graphics, state: GameState): void {
    for (const enemy of state.enemies) {
      if (enemy.state === 'spawning') {
        const t = 1 - enemy.stateTimer / 0.65;
        teleG.lineStyle(2, 0xf87171, 0.85);
        teleG.strokeCircle(enemy.x, enemy.y, enemy.radius + (1 - Math.max(0, t)) * 22);
      } else if (enemy.state === 'telegraph') {
        if (enemy.attackKind === 'ice_mortar') {
          teleG.lineStyle(2, 0x67e8f9, 0.85);
          teleG.strokeCircle(enemy.targetX, enemy.targetY, 62);
          teleG.fillStyle(0x67e8f9, 0.14);
          teleG.fillCircle(enemy.targetX, enemy.targetY, 62);
        } else if (enemy.attackKind === 'ricochet_charge' || enemy.attackKind === 'tank_burst') {
          const len = enemy.attackKind === 'tank_burst' ? 180 : 140;
          teleG.lineStyle(3, 0xf87171, 0.65);
          teleG.lineBetween(
            enemy.x,
            enemy.y,
            enemy.x + Math.cos(enemy.aimAngle) * len,
            enemy.y + Math.sin(enemy.aimAngle) * len,
          );
        } else if (enemy.attackKind === 'shade_fan') {
          teleG.lineStyle(2, 0xc084fc, 0.85);
          teleG.strokeCircle(enemy.x, enemy.y, enemy.radius + 8);
          teleG.lineStyle(2, 0xc084fc, 0.5);
          for (const offset of [-0.28, 0, 0.28]) {
            const ang = enemy.aimAngle + offset;
            teleG.lineBetween(
              enemy.x,
              enemy.y,
              enemy.x + Math.cos(ang) * 90,
              enemy.y + Math.sin(ang) * 90,
            );
          }
        }
      }
    }
  }

  private syncAfterimages(state: GameState): void {
    const heroAsset = getHeroAsset(state.player.costume);
    const facingLeft = state.player.facingX < -0.1;
    for (let i = 0; i < this.afterimagePool.length; i += 1) {
      const spr = this.afterimagePool[i];
      const img = state.afterimages[i];
      if (!spr) continue;
      if (!img) {
        spr.setVisible(false);
        continue;
      }
      const alpha = Math.max(0, img.ttl / img.maxTtl) * 0.48;
      spr
        .setTexture(heroAsset.texture, `${heroAsset.prefix}_dash_0`)
        .setPosition(img.x, img.y)
        .setFlipX(facingLeft)
        .setTint(hexNum(img.color))
        .setAlpha(alpha)
        .setVisible(true);
    }
  }

  private syncEnemies(
    shadowG: Phaser.GameObjects.Graphics,
    fxG: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    const activeIds = new Set<number>();
    const dur = Math.max(0.01, state.roomTransitionDuration);
    const doorProgress =
      state.roomTransitionTimer > 0 && state.roomTransitionKind === 'door' && !this.prefersReducedMotion()
        ? Math.max(0, Math.min(1, 1 - state.roomTransitionTimer / dur))
        : 1;
    const hideEnemies = doorProgress < 0.7;

    for (const enemy of state.enemies) {
      activeIds.add(enemy.id);
      let spr = this.enemySprites.get(enemy.id);
      if (!spr) {
        const startAsset = this.getEnemyAsset(enemy.archetype);
        spr = this.add.sprite(enemy.x, enemy.y, startAsset.texture, startAsset.frame).setDepth(10);
        this.enemySprites.set(enemy.id, spr);
      }

      if (hideEnemies) {
        spr.setVisible(false);
        const oldShield = this.wardenShields.get(enemy.id);
        oldShield?.setVisible(false);
        continue;
      }

      spr.setVisible(true);
      let popMult = 1;
      if (doorProgress < 1) {
        const u = (doorProgress - 0.7) / 0.3;
        popMult = u < 0.6 ? 0.15 + (u / 0.6) * 1.03 : 1.18 - ((u - 0.6) / 0.4) * 0.18;
        if (!this.transitionPoppedEnemyIds.has(enemy.id)) {
          this.transitionPoppedEnemyIds.add(enemy.id);
          this.spawnBoom(enemy.x, enemy.y, 1.9);
        }
      }

      const scale = this.getEnemyScale(enemy.archetype) * popMult;
      const jitterX =
        enemy.state === 'telegraph' ? Math.sin(state.elapsedTime * 55 + enemy.id) * 1.8 : 0;
      const alpha = enemy.state === 'spawning' ? 0.45 : 1;

      drawPixelShadow(
        shadowG,
        enemy.x,
        enemy.y + enemy.radius * 0.78,
        enemy.radius * 1.05 * popMult,
        Math.max(6, enemy.radius * 0.36 * popMult),
        0.44,
      );

      const bobY =
        enemy.archetype === 'shade' ? Math.sin(state.elapsedTime * 6 + enemy.id) * 3 : 0;
      spr
        .setPosition(enemy.x + jitterX, enemy.y + bobY)
        .setScale(scale)
        .setAlpha(alpha)
        .setFlipX(state.player.x < enemy.x);

      const animKey = this.pickEnemyAnim(enemy);
      if (animKey) {
        spr.play(animKey, true);
      } else {
        const asset = this.getEnemyAsset(enemy.archetype);
        spr.stop();
        spr.setTexture(asset.texture, asset.frame);
      }

      if (enemy.hitFlashTimer > 0) {
        spr.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      } else if (enemy.archetype === 'shade') {
        spr
          .setTint(enemy.state === 'telegraph' ? 0xc084fc : 0xe9d5ff)
          .setTintMode(Phaser.TintModes.MULTIPLY);
      } else if (enemy.archetype === 'stampede' && (enemy.state === 'telegraph' || enemy.state === 'attack')) {
        spr.setTint(0xfca5a5).setTintMode(Phaser.TintModes.MULTIPLY);
      } else if (enemy.archetype === 'bomber' && enemy.state === 'telegraph') {
        spr.setTint(0xfdba74).setTintMode(Phaser.TintModes.MULTIPLY);
      } else {
        spr.clearTint();
      }

      // Floating shield icon on armored foes while armor > 0
      if (enemy.armor > 0) {
        let shield = this.wardenShields.get(enemy.id);
        if (!shield) {
          shield = this.add.image(enemy.x, enemy.y, 'dungeon', 'tile_102').setScale(PIXEL_SCALE).setDepth(11);
          this.wardenShields.set(enemy.id, shield);
        }
        const side = state.player.x < enemy.x ? -1 : 1;
        shield.setPosition(enemy.x + side * 28, enemy.y + 4).setVisible(true);
      } else {
        const oldShield = this.wardenShields.get(enemy.id);
        if (oldShield) {
          oldShield.destroy();
          this.wardenShields.delete(enemy.id);
        }
      }

      if (enemy.state === 'staggered') {
        this.nextLabel(enemy.x, enemy.y - enemy.radius - 18, '✦ STUNNED ✦', '#fde047', 16);
      } else if (enemy.archetype !== 'boss' && enemy.hp < enemy.maxHp) {
        const bw = enemy.radius * 2.1;
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        fxG.fillStyle(0x1d1520, 0.92);
        fxG.fillRect(enemy.x - bw / 2, enemy.y - enemy.radius - 14, bw, 5);
        fxG.fillStyle(enemy.armor > 0 ? 0xf5b82e : 0xe23c3c, 1);
        fxG.fillRect(enemy.x - bw / 2, enemy.y - enemy.radius - 14, bw * ratio, 5);
      }
    }

    for (const [id, spr] of this.enemySprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.enemySprites.delete(id);
        const sh = this.wardenShields.get(id);
        if (sh) {
          sh.destroy();
          this.wardenShields.delete(id);
        }
      }
    }
  }

  private getEnemyAsset(archetype: EnemyArchetype): {
    texture: 'dungeon' | 'ski' | 'battle' | 'farm';
    frame: string | number;
  } {
    switch (archetype) {
      case 'chaser':
        return { texture: 'dungeon', frame: 'slime_idle_0' };
      case 'shooter':
        return { texture: 'dungeon', frame: 'wizard_idle_0' };
      case 'charger':
        return { texture: 'dungeon', frame: 'cyclops_idle_0' };
      case 'elite_charger':
        return { texture: 'dungeon', frame: 'warden_idle_0' };
      case 'boss':
        return { texture: 'dungeon', frame: 'boss_idle_0' };
      case 'shade':
        return { texture: 'dungeon', frame: 'tile_121' };
      case 'yeti':
        return { texture: 'ski', frame: 78 };
      case 'bomber':
        return { texture: 'dungeon', frame: 'tile_111' };
      case 'mortar_tank':
        return { texture: 'battle', frame: 152 };
      case 'stampede':
        return { texture: 'farm', frame: 121 };
    }
  }

  private getEnemyScale(_archetype: EnemyArchetype): number {
    return PIXEL_SCALE;
  }

  private pickEnemyAnim(enemy: EnemyEntity): string | null {
    if (enemy.archetype === 'chaser') {
      if (enemy.state === 'telegraph' || enemy.state === 'attack') return 'slime_telegraph';
      return enemy.state === 'chase' ? 'slime_run' : 'slime_idle';
    }
    if (enemy.archetype === 'shooter') {
      if (enemy.state === 'telegraph') return 'wizard_cast';
      return enemy.state === 'chase' ? 'wizard_run' : 'wizard_idle';
    }
    if (enemy.archetype === 'charger') {
      if (enemy.state === 'telegraph' || enemy.state === 'attack') return 'cyclops_charge';
      return enemy.state === 'chase' ? 'cyclops_run' : 'cyclops_idle';
    }
    if (enemy.archetype === 'elite_charger') {
      if (enemy.state === 'telegraph' || enemy.state === 'attack') return 'warden_charge';
      return enemy.state === 'chase' ? 'warden_run' : 'warden_idle';
    }
    if (enemy.archetype === 'yeti') {
      return enemy.state === 'telegraph' || enemy.state === 'attack' ? 'yeti_cast' : 'yeti_walk';
    }
    if (enemy.archetype === 'mortar_tank') {
      return enemy.state === 'telegraph' || enemy.state === 'attack' ? 'tank_fire' : 'tank_roll';
    }
    if (enemy.archetype === 'shade' || enemy.archetype === 'bomber' || enemy.archetype === 'stampede') {
      return null;
    }
    if (enemy.state === 'telegraph' || enemy.state === 'attack') return 'boss_attack';
    return enemy.state === 'chase' ? 'boss_run' : 'boss_idle';
  }

  private syncPlayer(
    shadowG: Phaser.GameObjects.Graphics,
    fxG: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    const p = state.player;
    if (!this.heroSprite || !this.weaponSprite) return;

    const showHero = state.phase !== 'start';
    this.heroSprite.setVisible(showHero);
    this.weaponSprite.setVisible(showHero);
    const accId = showHero ? getAccessoryId(p.cosmetic) : null;
    if (!showHero || accId === null) {
      this.hatSprite?.setVisible(false);
    }
    if (!showHero) return;

    const heroAsset = getHeroAsset(p.costume);
    const px = this.heroTransitionPos ? this.heroTransitionPos.x : p.x;
    const py = this.heroTransitionPos ? this.heroTransitionPos.y : p.y;

    drawPixelShadow(shadowG, px, py + 21, 18, 6, 0.45);

    if (state.phase === 'dying' || (state.phase === 'ended' && !state.stats.extracted)) {
      const dur = Math.max(0.01, state.deathDuration);
      const dp =
        state.phase === 'ended' ? 1 : Math.max(0, Math.min(1, 1 - state.deathTimer / dur));
      const fallDir = p.facingX < 0 ? -1 : 1;
      const facingLeft = p.facingX < -0.1;

      if (dp < 0.12) {
        const jitterX = Math.sin(dp * 165) * 3;
        this.heroSprite
          .stop()
          .setTexture(heroAsset.texture, `${heroAsset.prefix}_idle_0`)
          .setPosition(p.x + jitterX, p.y)
          .setRotation(0)
          .setScale(PIXEL_SCALE, PIXEL_SCALE)
          .setAlpha(1)
          .setFlipX(facingLeft)
          .setTint(0xffffff)
          .setTintMode(Phaser.TintModes.FILL);
        if (this.hatSprite && accId !== null) {
          this.hatSprite
            .setVisible(true)
            .stop()
            .setTexture('cosmetics', `hat_${accId}_0`)
            .setPosition(p.x + jitterX, p.y)
            .setRotation(0)
            .setScale(PIXEL_SCALE, PIXEL_SCALE)
            .setAlpha(1)
            .setFlipX(facingLeft)
            .setTint(0xffffff)
            .setTintMode(Phaser.TintModes.FILL);
        }
        this.weaponSprite
          .setPosition(p.x + jitterX + fallDir * 20, p.y + 3)
          .setScale(2.75)
          .setRotation(fallDir * 0.25)
          .setAlpha(1)
          .setTint(0xffffff)
          .setTintMode(Phaser.TintModes.FILL);
      } else {
        const fallU = Math.min(1, (dp - 0.12) / 0.32);
        const fallEase = 1 - Math.pow(1 - fallU, 3);
        const alphaDrop = dp > 0.56 ? (dp - 0.56) / 0.44 : 0;
        const heroAlpha = 1 - 0.45 * alphaDrop;
        const weaponAlpha = 1 - 0.4 * alphaDrop;

        this.heroSprite
          .stop()
          .setTexture(heroAsset.texture, `${heroAsset.prefix}_idle_0`)
          .setPosition(p.x, p.y + 8 * fallEase)
          .setRotation(fallDir * (Math.PI * 0.5) * fallEase)
          .setScale(PIXEL_SCALE, PIXEL_SCALE - 0.4 * fallEase)
          .setAlpha(heroAlpha)
          .setFlipX(facingLeft)
          .setTint(0xb87474)
          .setTintMode(Phaser.TintModes.MULTIPLY);

        if (this.hatSprite && accId !== null) {
          this.hatSprite
            .setVisible(true)
            .stop()
            .setTexture('cosmetics', `hat_${accId}_0`)
            .setPosition(p.x, p.y + 8 * fallEase)
            .setRotation(fallDir * (Math.PI * 0.5) * fallEase)
            .setScale(PIXEL_SCALE, PIXEL_SCALE - 0.4 * fallEase)
            .setAlpha(heroAlpha)
            .setFlipX(facingLeft)
            .setTint(0xb87474)
            .setTintMode(Phaser.TintModes.MULTIPLY);
        }

        const clatterX = p.x + fallDir * (20 + 6 * fallEase);
        const clatterY = p.y + 3 + 9 * fallEase - 14 * Math.sin(fallU * Math.PI);
        this.weaponSprite
          .setPosition(clatterX, clatterY)
          .setScale(2.75)
          .setRotation(fallDir * (0.25 + 1.2 * fallEase))
          .setAlpha(weaponAlpha)
          .setTint(0xb87474)
          .setTintMode(Phaser.TintModes.MULTIPLY);

        if (state.phase === 'dying' && dp > 0.4 && dp < 0.78) {
          const soulT = Math.min(1, (dp - 0.4) / 0.34);
          const soulAlpha = Math.sin(soulT * Math.PI) * 0.95;
          const soulX = snapPx(p.x + Math.sin(soulT * Math.PI * 2.5) * 6);
          const soulY = snapPx(p.y - 12 - soulT * 48);
          fxG.fillStyle(0x1c1221, soulAlpha);
          fxG.fillRect(soulX - 9, soulY - 9, 18, 18);
          fxG.fillStyle(0xe0f2fe, soulAlpha);
          fxG.fillRect(soulX - 6, soulY - 6, 12, 12);
          fxG.fillStyle(0xffffff, soulAlpha);
          fxG.fillRect(soulX - 3, soulY - 3, 6, 6);
          fxG.fillStyle(0x1c1221, soulAlpha);
          fxG.fillRect(soulX - 3, soulY - 3, 3, 3);
          fxG.fillRect(soulX + 3, soulY - 3, 3, 3);
          fxG.fillStyle(0xe0f2fe, soulAlpha * 0.85);
          fxG.fillRect(soulX - 6, soulY + 12, 3, 3);
          fxG.fillRect(soulX + 3, soulY + 15, 3, 3);
        }
      }
      return;
    }

    if (this.heroTransitionPos) {
      const walkAngle = this.heroTransitionPos.angle;
      const facingLeft = walkAngle > Math.PI * 0.55 || walkAngle < -Math.PI * 0.55;
      this.heroSprite
        .setPosition(px, py)
        .setRotation(0)
        .setScale(PIXEL_SCALE, PIXEL_SCALE)
        .setAlpha(1)
        .setFlipX(facingLeft)
        .clearTint()
        .play(`${heroAsset.prefix}_run`, true);
      if (this.hatSprite && accId !== null) {
        const bob = heroFrameBobPx(this.heroSprite.frame?.name ?? '') * PIXEL_SCALE;
        this.hatSprite
          .setVisible(true)
          .setPosition(px, py + bob)
          .setRotation(0)
          .setScale(PIXEL_SCALE, PIXEL_SCALE)
          .setAlpha(1)
          .setFlipX(facingLeft)
          .clearTint()
          .play(`hat_${accId}`, true);
      }
      this.weaponSprite
        .setPosition(px + Math.cos(walkAngle) * 20, py + Math.sin(walkAngle) * 20 + 3)
        .setScale(2.75)
        .setAlpha(1)
        .clearTint()
        .setFrame(getWeapon(p.weaponId).sprite)
        .setRotation(walkAngle + Math.PI / 2);
      return;
    }

    if (p.shields > 0) {
      const sx = snapPx(px);
      const sy = snapPx(py);
      const r = snapPx(p.radius + 9);
      fxG.fillStyle(0x38bdf8, 0.82);
      fxG.fillRect(sx - r, sy - r, 9, 3);
      fxG.fillRect(sx - r, sy - r, 3, 9);
      fxG.fillRect(sx + r - 9, sy - r, 9, 3);
      fxG.fillRect(sx + r - 3, sy - r, 3, 9);
      fxG.fillRect(sx - r, sy + r - 3, 9, 3);
      fxG.fillRect(sx - r, sy + r - 9, 3, 9);
      fxG.fillRect(sx + r - 9, sy + r - 3, 9, 3);
      fxG.fillRect(sx + r - 3, sy + r - 9, 3, 9);
    }

    const weaponDef = getWeapon(p.weaponId);
    const animDur = Math.max(0.01, weaponDef.animDuration);
    const swingT = p.attackAnimTimer > 0 ? 1 - p.attackAnimTimer / animDur : 1;
    const sign = p.swingCount % 2 === 1 ? 1 : -1;

    let drawPx = p.x;
    let drawPy = p.y;
    let scaleX = PIXEL_SCALE;
    let scaleY = PIXEL_SCALE;
    if (!this.prefersReducedMotion()) {
      if (p.attackAnimTimer > 0) {
        const punch = Math.sin(Math.min(1, swingT * 1.35) * Math.PI);
        drawPx += Math.cos(p.attackAngle) * 5 * punch;
        drawPy += Math.sin(p.attackAngle) * 5 * punch;
        scaleX = PIXEL_SCALE + 0.25 * punch;
        scaleY = PIXEL_SCALE - 0.2 * punch;
      } else if (p.attackEndlagTimer > 0) {
        drawPx += Math.cos(p.attackAngle) * 1.5;
        drawPy += Math.sin(p.attackAngle) * 1.5;
        scaleX = PIXEL_SCALE + 0.08;
        scaleY = PIXEL_SCALE - 0.08;
      }
    }

    const moving = Math.hypot(p.vx, p.vy) > 25;
    const animSuffix = p.attackAnimTimer > 0 ? 'dash' : moving ? 'run' : 'idle';
    const facingLeft = p.facingX < -0.1;

    this.heroSprite
      .setPosition(drawPx, drawPy)
      .setRotation(0)
      .setScale(scaleX, scaleY)
      .setAlpha(1)
      .setFlipX(facingLeft)
      .play(`${heroAsset.prefix}_${animSuffix}`, true);

    if (p.hurtFlashTimer > 0) {
      this.heroSprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    } else {
      this.heroSprite.clearTint();
    }

    if (this.hatSprite && accId !== null) {
      const bob = heroFrameBobPx(this.heroSprite.frame?.name ?? '') * scaleY;
      this.hatSprite
        .setVisible(true)
        .setPosition(drawPx, drawPy + bob)
        .setRotation(0)
        .setScale(scaleX, scaleY)
        .setAlpha(1)
        .setFlipX(facingLeft)
        .play(`hat_${accId}`, true);
      if (p.hurtFlashTimer > 0) {
        this.hatSprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      } else {
        this.hatSprite.clearTint();
      }
    }

    // Held pixel sword 3-phase swing: whip arc -> heavy endlag follow-through -> eased reset
    const baseAngle =
      p.attackAnimTimer > 0 || p.attackEndlagTimer > 0
        ? p.attackAngle
        : Math.atan2(p.facingY, p.facingX);
    let swingOffset = 0;
    let handDist = 20;
    let weaponScale = 2.75;
    if (p.attackAnimTimer > 0) {
      const whip = 1 - Math.pow(1 - Math.min(1, swingT / 0.55), 3);
      swingOffset = sign * (-0.92 + whip * 1.8);
      handDist = 20 + Math.sin(Math.min(1, swingT / 0.7) * Math.PI) * 11;
      weaponScale = 2.75 + Math.sin(Math.min(1, swingT / 0.65) * Math.PI) * 0.75;
    } else if (p.attackEndlagTimer > 0) {
      swingOffset = sign * 0.88;
      handDist = 22;
      weaponScale = 2.85;
    } else if (p.attackCooldown > 0) {
      const endlagDur = Math.min(
        p.attackMaxCooldown,
        weaponDef.endlag * state.modifier.attackCdMult,
      );
      const recoverSpan = Math.max(0.01, p.attackMaxCooldown - endlagDur);
      const recoverT = 1 - Math.min(1, p.attackCooldown / recoverSpan);
      const ease = recoverT * recoverT * (3 - 2 * recoverT);
      swingOffset = sign * 0.88 * (1 - ease);
      handDist = 22 - 2 * ease;
    }

    if (weaponDef.style === 'ranged') {
      // Staffs point at the target and kick back instead of swinging.
      swingOffset = 0;
      const recoil = p.attackAnimTimer > 0 ? Math.sin(swingT * Math.PI) : 0;
      handDist = 22 - 7 * recoil;
      weaponScale = 2.8;
    }
    const handAngle = baseAngle + swingOffset;
    this.weaponSprite
      .setPosition(
        drawPx + Math.cos(handAngle) * handDist,
        drawPy + Math.sin(handAngle) * handDist + 3,
      )
      .setScale(weaponScale)
      .setAlpha(1)
      .setFrame(weaponDef.sprite)
      .setRotation(handAngle + Math.PI / 2);

    if (p.attackAnimTimer > 0 && swingT < 0.35) {
      this.weaponSprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    } else if (this.readyFlashTimer > 0) {
      this.weaponSprite.setTint(0xfde68a).setTintMode(Phaser.TintModes.FILL);
    } else {
      this.weaponSprite.clearTint();
    }
  }

  private syncProjectiles(
    shadowG: Phaser.GameObjects.Graphics,
    fxG: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    const activeIds = new Set<number>();

    for (const proj of state.projectiles) {
      if (proj.kind === 'lance') {
        const steps = 6;
        for (let i = steps; i >= 0; i -= 1) {
          const bx = snapPx(proj.x - Math.cos(proj.angle) * i * 5);
          const by = snapPx(proj.y - Math.sin(proj.angle) * i * 5);
          if (i <= 2) {
            fxG.fillStyle(0x1c1221, 1);
            fxG.fillRect(bx - 6, by - 6, 12, 12);
          }
          fxG.fillStyle(i === 0 ? 0xffffff : i <= 2 ? 0xe0f2fe : 0x38bdf8, i === 0 ? 1 : 0.85);
          fxG.fillRect(bx - 3, by - 3, 6, 6);
        }
        continue;
      }
      if (proj.kind === 'bolt') {
        const tx = snapPx(proj.x - Math.cos(proj.angle) * 9);
        const ty = snapPx(proj.y - Math.sin(proj.angle) * 9);
        const px = snapPx(proj.x);
        const py = snapPx(proj.y);
        fxG.fillStyle(0x1c1221, 1);
        fxG.fillRect(px - 6, py - 6, 12, 12);
        fxG.fillStyle(0xc084fc, 0.78);
        fxG.fillRect(tx - 3, ty - 3, 6, 6);
        fxG.fillStyle(0xf5d0fe, 1);
        fxG.fillRect(px - 3, py - 3, 6, 6);
        continue;
      }
      if (proj.kind === 'rift_wave') {
        fxG.lineStyle(6, 0x38bdf8, 1);
        fxG.beginPath();
        fxG.arc(
          proj.x - Math.cos(proj.angle) * 8,
          proj.y - Math.sin(proj.angle) * 8,
          proj.radius,
          proj.angle - Math.PI * 0.42,
          proj.angle + Math.PI * 0.42,
          false,
        );
        fxG.strokePath();
        continue;
      }

      activeIds.add(proj.id);
      let spr = this.projectileSprites.get(proj.id);
      if (!spr) {
        const anim = proj.friendly ? 'orb_friendly' : 'orb_enemy';
        spr = this.add
          .sprite(proj.x, proj.y, 'dungeon', proj.friendly ? 'orb_friendly_0' : 'orb_enemy_0')
          .setScale(PIXEL_SCALE)
          .setDepth(13);
        spr.play(anim);
        this.projectileSprites.set(proj.id, spr);
      }

      drawPixelShadow(shadowG, proj.x, proj.y + 12, 9, 3, 0.36);
      spr.setPosition(proj.x, proj.y);
    }

    for (const [id, spr] of this.projectileSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.projectileSprites.delete(id);
      }
    }
  }

  private drawSlashesRingsLightningsParticles(
    g: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    for (const slash of state.slashes) {
      const t = 1 - Math.max(0, Math.min(1, slash.ttl / slash.maxTtl));
      const fade = Math.max(0, 1 - Math.pow(t, 1.55));
      const head = 1 - Math.pow(1 - Math.min(1, t / 0.36), 3);
      const tail = Math.pow(Math.max(0, (t - 0.14) / 0.86), 1.5);
      const span = Math.max(0.04, head - tail);
      const steps = 10;
      const maxThick =
        (slash.hitCount > 0 ? 28 : 22) * (slash.heavy ? 1.35 : 1) * (1 - t * 0.32);
      const outerR = slash.radius * (slash.heavy ? 0.94 : 0.88);

      const outerPts: Array<{ x: number; y: number }> = [];
      const innerPts: Array<{ x: number; y: number }> = [];
      const coreInnerPts: Array<{ x: number; y: number }> = [];

      for (let i = 0; i <= steps; i += 1) {
        const s = i / steps;
        const u = tail + span * s;
        const a = slash.angle + slash.sign * (-slash.arc / 2 + u * slash.arc);
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const belly = Math.sin(Math.pow(s, 0.7) * Math.PI);
        const thick = Math.max(1.5, maxThick * belly);
        outerPts.push({ x: slash.x + cosA * outerR, y: slash.y + sinA * outerR });
        innerPts.push({
          x: slash.x + cosA * Math.max(8, outerR - thick),
          y: slash.y + sinA * Math.max(8, outerR - thick),
        });
        coreInnerPts.push({
          x: slash.x + cosA * Math.max(10, outerR - thick * 0.55),
          y: slash.y + sinA * Math.max(10, outerR - thick * 0.55),
        });
      }

      const isGold = slash.color === '#fbbf24';
      const outerCol = isGold ? 0xf59e0b : slash.hitCount > 0 ? 0xfdba74 : 0x93c5fd;
      const outerPoly = [...outerPts, ...[...innerPts].reverse()];
      g.fillStyle(outerCol, fade * 0.92);
      this.tracePolygon(g, outerPoly, true);
      g.fillPath();
      g.lineStyle(3, 0x120d14, fade * 0.9);
      this.tracePolygon(g, outerPoly, true);
      g.strokePath();

      const corePoly = [...outerPts, ...[...coreInnerPts].reverse()];
      g.fillStyle(0xffffff, fade);
      this.tracePolygon(g, corePoly, true);
      g.fillPath();

      g.lineStyle(2.5, 0xffffff, fade);
      this.tracePolygon(g, outerPts, false);
      g.strokePath();

      const headPt = outerPts[outerPts.length - 1];
      if (headPt && t < 0.45) {
        const arm = 7 * (1 - t / 0.45);
        g.lineStyle(2, 0xffffff, fade);
        g.lineBetween(headPt.x - arm, headPt.y, headPt.x + arm, headPt.y);
        g.lineBetween(headPt.x, headPt.y - arm, headPt.x, headPt.y + arm);
      }

      if (slash.hitCount > 0 && t < 0.42) {
        const ix = slash.x + Math.cos(slash.angle) * slash.radius * 0.58;
        const iy = slash.y + Math.sin(slash.angle) * slash.radius * 0.58;
        const crossLen = 10 * (1 - (t / 0.42) * 0.4);
        g.lineStyle(4, 0x120d14, fade);
        g.lineBetween(ix - crossLen, iy - crossLen, ix + crossLen, iy + crossLen);
        g.lineBetween(ix + crossLen, iy - crossLen, ix - crossLen, iy + crossLen);
        g.lineStyle(2, 0xfff7e8, fade);
        g.lineBetween(ix - crossLen, iy - crossLen, ix + crossLen, iy + crossLen);
        g.lineBetween(ix + crossLen, iy - crossLen, ix - crossLen, iy + crossLen);
      }
    }

    for (const ring of state.rings) {
      const alpha = Math.max(0, ring.ttl / ring.maxTtl);
      g.lineStyle(ring.harmfulToPlayer ? 6 : 3.5, hexNum(ring.color), alpha);
      g.strokeCircle(ring.x, ring.y, ring.radius);
    }

    for (const bolt of state.lightnings) {
      if (bolt.points.length < 2) continue;
      const alpha = Math.max(0, bolt.ttl / bolt.maxTtl);
      g.lineStyle(3, 0x7dd3fc, alpha);
      this.tracePolygon(g, bolt.points, false);
      g.strokePath();
    }

    for (const pt of state.particles) {
      const alpha = Math.max(0, pt.ttl / pt.maxTtl);
      g.fillStyle(hexNum(pt.color), alpha);
      g.fillRect(pt.x - pt.radius, pt.y - pt.radius, pt.radius * 2, pt.radius * 2);
    }
  }

  private drawFloatingTexts(state: GameState): void {
    for (const ft of state.floatingTexts) {
      const alpha = Math.max(0, ft.ttl / ft.maxTtl);
      this.nextLabel(ft.x, ft.y, ft.text, ft.color, Math.round(20 * ft.scale), alpha);
    }
  }

  private drawOnboardingHint(g: Phaser.GameObjects.Graphics, state: GameState): void {
    if (state.onboardingTimer <= 0 || state.roomIndex !== 1 || state.phase !== 'playing') return;
    const alpha = Math.min(1, state.onboardingTimer / 0.8);
    const p = state.player;
    const boxW = 340;
    const boxH = 34;
    const bx = Math.max(PLAY_MIN_X + 8, Math.min(PLAY_MAX_X - boxW - 8, p.x - boxW / 2));
    const by = Math.min(PLAY_MAX_Y - 38, p.y + 26);

    g.fillStyle(0x1d1520, 0.94 * alpha);
    g.fillRect(bx, by, boxW, boxH);
    g.lineStyle(2, 0x5b485e, alpha);
    g.strokeRect(bx, by, boxW, boxH);

    this.onboardingText
      ?.setPosition(bx + boxW / 2, by + boxH / 2)
      .setAlpha(alpha * 0.95)
      .setVisible(true);
  }

  private drawTouchJoystick(g: Phaser.GameObjects.Graphics): void {
    const joy = this.bridge.getInput()?.getTouchJoystickVisual();
    if (!joy?.active) return;

    const origin = this.screenToArena(joy.originX, joy.originY);
    const knob = this.screenToArena(joy.knobX, joy.knobY);
    const invZoom = 1 / Math.max(0.1, this.cameras.main.zoom);

    g.fillStyle(0x94a3b8, 0.16);
    g.fillCircle(origin.x, origin.y, joy.maxRadius * invZoom);
    g.lineStyle(2 * invZoom, 0xf8fafc, 0.35);
    g.strokeCircle(origin.x, origin.y, joy.maxRadius * invZoom);

    g.fillStyle(0x38bdf8, 0.75);
    g.fillCircle(knob.x, knob.y, 20 * invZoom);
  }

  private drawAmbientMotes(
    g: Phaser.GameObjects.Graphics,
    state: GameState,
    dt: number,
  ): void {
    if (this.prefersReducedMotion()) return;
    const biome = getFloorBiome(state.floor);
    const moteColor =
      biome.id === 'snow'
        ? 0xe0f2fe
        : biome.id === 'farm' || biome.id === 'town'
          ? 0xfef08a
          : biome.id === 'battle'
            ? 0xfca5a5
            : 0xfb923c;
    const minY = PLAY_MIN_Y + 6;
    const maxY = PLAY_MAX_Y - 6;
    const minX = PLAY_MIN_X + 6;
    const maxX = PLAY_MAX_X - 6;

    for (const m of this.ambientMotes) {
      if (dt > 0) {
        const yStep = biome.id === 'snow' ? -m.vy : m.vy;
        m.x += (m.vx + Math.sin(state.elapsedTime * 1.4 + m.phase) * 6) * dt;
        m.y += yStep * dt;
        if (m.y < minY) m.y = maxY;
        if (m.y > maxY) m.y = minY;
        if (m.x < minX) m.x = maxX;
        if (m.x > maxX) m.x = minX;
      }
      const alpha = 0.14 + 0.16 * (0.5 + 0.5 * Math.sin(state.elapsedTime * 3.1 + m.phase));
      g.fillStyle(moteColor, alpha);
      g.fillRect(snapPx(m.x), snapPx(m.y), PIXEL_SCALE, PIXEL_SCALE);
    }
  }

  private updateAtmosphere(state: GameState): void {
    const atmo = this.atmosphere;
    if (!atmo) return;

    const biome = getFloorBiome(state.floor);
    const theme = this.bridge.theme;
    const boss = state.enemies.find((e) => e.archetype === 'boss');

    if (biome.id === 'dungeon') {
      atmo.ambientColor = [...theme.shaderAmbient];
      atmo.vignetteColor = boss ? [0.16, 0.02, 0.05] : [...theme.shaderVignette];
      atmo.vignetteStrength = boss ? 0.64 : 0.54;
    } else if (biome.id === 'snow') {
      atmo.ambientColor = [0.88, 0.92, 1.0];
      atmo.vignetteColor = [0.08, 0.14, 0.24];
      atmo.vignetteStrength = 0.34;
    } else if (biome.id === 'town') {
      atmo.ambientColor = [0.82, 0.78, 0.88];
      atmo.vignetteColor = [0.06, 0.04, 0.1];
      atmo.vignetteStrength = 0.42;
    } else if (biome.id === 'battle') {
      atmo.ambientColor = [0.8, 0.78, 0.74];
      atmo.vignetteColor = [0.08, 0.07, 0.04];
      atmo.vignetteStrength = 0.44;
    } else {
      atmo.ambientColor = [0.88, 0.85, 0.78];
      atmo.vignetteColor = [0.1, 0.07, 0.03];
      atmo.vignetteStrength = 0.36;
    }

    atmo.flashColor = [...this.shaderFlashColor];
    atmo.flashStrength = this.prefersReducedMotion() ? 0 : this.shaderFlash;

    // Lights 0..3: indoor wall torches (suppressed during door slide so lights don't swim)
    const sliding = state.roomTransitionTimer > 0 && state.roomTransitionKind === 'door';
    for (let i = 0; i < 4; i += 1) {
      const torch = biome.torches && !sliding ? this.wallTorches[i] : undefined;
      if (!torch) {
        atmo.setLight(i, null);
      } else {
        const flicker = Math.sin(state.elapsedTime * 10 + i * 2.1) * 0.015;
        atmo.setLight(
          i,
          {
            x: torch.x / ARENA_W,
            y: (torch.y + 20) / ARENA_H,
            radius: 0.34 + flicker,
            r: 0.88,
            g: 0.52,
            b: 0.2,
          },
          0.72,
        );
      }
    }

    // Light 4: Hero lantern / arcane weapon aura
    if (state.phase === 'start' || sliding) {
      atmo.setLight(4, null);
    } else {
      const px = this.heroTransitionPos ? this.heroTransitionPos.x : state.player.x;
      const py = this.heroTransitionPos ? this.heroTransitionPos.y : state.player.y;
      const wid = state.player.weaponId;
      const swingBoost = state.player.attackAnimTimer > 0 ? 0.04 : 0;
      const lightRgb: [number, number, number] =
        wid === 'arcane_lance'
          ? [0.42, 0.78, 0.96]
          : wid === 'scatter_staff'
            ? [0.76, 0.45, 0.96]
            : [0.84, 0.72, 0.56];
      atmo.setLight(
        4,
        {
          x: px / ARENA_W,
          y: py / ARENA_H,
          radius: 0.25 + swingBoost,
          r: lightRgb[0],
          g: lightRgb[1],
          b: lightRgb[2],
        },
        0.58,
      );
    }

    // Light 5: Boss furnace aura, active Portal beacon, or Healing Fountain shimmer
    const portal = state.portals[0];
    if (boss && !sliding) {
      atmo.setLight(
        5,
        {
          x: boss.x / ARENA_W,
          y: boss.y / ARENA_H,
          radius: 0.28 + Math.sin(state.elapsedTime * 6) * 0.02,
          r: 0.96,
          g: 0.28,
          b: 0.16,
        },
        0.72,
      );
    } else if (portal && !sliding) {
      atmo.setLight(
        5,
        {
          x: portal.x / ARENA_W,
          y: portal.y / ARENA_H,
          radius: 0.24 + Math.sin(state.elapsedTime * 5) * 0.015,
          r: 0.96,
          g: 0.78,
          b: 0.24,
        },
        0.7,
      );
    } else if (state.fountain && !state.fountain.used && !sliding) {
      atmo.setLight(
        5,
        {
          x: state.fountain.x / ARENA_W,
          y: state.fountain.y / ARENA_H,
          radius: 0.22,
          r: 0.24,
          g: 0.92,
          b: 0.56,
        },
        0.55,
      );
    } else {
      atmo.setLight(5, null);
    }
  }

  private resetLabels(): void {
    this.poolCursor = 0;
    for (const txt of this.labelPool) {
      txt.setVisible(false);
    }
    this.fountainLabel?.setVisible(false);
    this.tooltipText?.setVisible(false);
    this.onboardingText?.setVisible(false);
  }

  private nextLabel(
    x: number,
    y: number,
    text: string,
    color: string,
    fontSize = 13,
    alpha = 1,
  ): void {
    const label = this.labelPool[this.poolCursor];
    if (!label) return;
    this.poolCursor += 1;
    label
      .setPosition(x, y)
      .setText(text)
      .setColor(color)
      .setFontSize(`${fontSize}px`)
      .setAlpha(alpha)
      .setVisible(true);
  }

  private tracePolygon(
    g: Phaser.GameObjects.Graphics,
    pts: ReadonlyArray<{ x: number; y: number }>,
    closed: boolean,
  ): void {
    const first = pts[0];
    if (!first) return;
    g.beginPath();
    g.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i += 1) {
      const pt = pts[i];
      if (pt) {
        g.lineTo(pt.x, pt.y);
      }
    }
    if (closed) {
      g.closePath();
    }
  }
}
