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
import { CELL_SIZE, isNearDoorwayCell, oppositeDirection } from '../../shared/game/rooms.ts';
import type { GameSimulation, GameState } from '../../shared/game/simulation.ts';
import { createDailyStream, type SeededRng } from '../../shared/rng.ts';
import { BIOME_SHEETS, getFloorBiome, type FloorBiome } from '../config/biomes.ts';
import { COSMETIC_IDS, COSMETICS, isCosmeticId } from '../../shared/shop.ts';
import { getWeapon } from '../../shared/weapons.ts';
import {
  computeEnemyPose,
  drawStar,
  ENEMY_COLORS,
  type EnemyFxState,
  FxParticles,
  GOLD_PALETTE,
  HIT_REACT_TIME,
  WEAPON_PALETTES,
  type WeaponPalette,
} from './juice.ts';
import type { AccessoryId, CosmeticId, DoorDirection, EnemyArchetype } from '../../shared/types.ts';
import { hexNum, RELIC_SPRITE_FRAMES, type DungeonTheme } from '../config/theme.ts';
import {
  attachDungeonAtmosphere,
  type DungeonAtmosphereController,
} from '../shaders/DungeonAtmosphereFilter.ts';
import type { InputController } from '../game/input.ts';

const PIXEL_SCALE = 3;

const MONSTER_SKIN_RATES = {
  slime: { idle: 6, run: 10, attack: 12 },
  mage: { idle: 5, run: 8, attack: 10 },
  brute: { idle: 5, run: 8, attack: 12 },
  warden: { idle: 5, run: 8, attack: 12 },
  shade: { idle: 6, run: 9, attack: 12 },
  yeti: { idle: 5, run: 8, attack: 11 },
  sapper: { idle: 6, run: 10, attack: 12 },
  tank: { idle: 6, run: 9, attack: 12 },
  bull: { idle: 6, run: 10, attack: 12 },
  boss: { idle: 6, run: 9, attack: 12 },
  archer: { idle: 5, run: 9, attack: 12 },
  imp: { idle: 7, run: 11, attack: 12 },
  mimic: { idle: 6, run: 9, attack: 12 },
  golem: { idle: 5, run: 7, attack: 11 },
  myconid: { idle: 6, run: 9, attack: 12 },
} as const;

type MonsterSkin = keyof typeof MONSTER_SKIN_RATES;

const CHASER_SKINS: readonly MonsterSkin[] = ['slime', 'mimic'];
const SHOOTER_SKINS: readonly MonsterSkin[] = ['mage'];
const CHARGER_SKINS: readonly MonsterSkin[] = ['brute', 'golem'];

function snapPx(value: number): number {
  return Math.round(value / PIXEL_SCALE) * PIXEL_SCALE;
}

function drawPixelShadow(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  alpha = 0.36,
): void {
  const x = snapPx(cx);
  const y = snapPx(cy);
  const hw = Math.max(PIXEL_SCALE * 2, snapPx(halfW));
  const hh = Math.max(PIXEL_SCALE, snapPx(halfH));
  const inset = hw > PIXEL_SCALE * 3 ? PIXEL_SCALE : 0;
  g.fillStyle(0x14131a, alpha);
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
  private readonly hazardSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly breakableSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly coinSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly gemSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly heartSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly projectileSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly sporeCloudSprites = new Map<number, Phaser.GameObjects.Sprite[]>();
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
  private readonly fxParticles = new FxParticles();
  private readonly enemyFx = new Map<number, EnemyFxState>();
  private fxClock = 0;
  private frameDt = 0;
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
      'monsters',
      './assets/dungeon/monsters_atlas.png',
      './assets/dungeon/monsters_atlas.json',
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
    this.ambientMotes = Array.from({ length: 6 }, () => ({
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
        color: '#96db6e',
        stroke: '#14131a',
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
        color: '#f2efe4',
        stroke: '#14131a',
        strokeThickness: 4,
        align: 'center',
        wordWrap: { width: ARENA_W - 140 },
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(22)
      .setVisible(false);

    this.onboardingText = this.add
      .text(0, 0, 'Move: WASD / Arrows | Attack: Space / Click', {
        fontFamily: "'Pixelify Sans', system-ui, sans-serif",
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#f2efe4',
        stroke: '#14131a',
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
          color: '#f2efe4',
          stroke: '#14131a',
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
      atlasKey: 'dungeon' | 'cosmetics' | 'monsters' | 'ski' | 'town' | 'battle' | 'farm' = 'dungeon',
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

    for (const [skin, rates] of Object.entries(MONSTER_SKIN_RATES) as Array<
      [MonsterSkin, (typeof MONSTER_SKIN_RATES)[MonsterSkin]]
    >) {
      define(
        `monster_${skin}_idle`,
        [0, 1, 2, 3].map((i) => `${skin}_idle_${i}`),
        rates.idle,
        -1,
        'monsters',
      );
      define(
        `monster_${skin}_run`,
        [0, 1, 2, 3].map((i) => `${skin}_run_${i}`),
        rates.run,
        -1,
        'monsters',
      );
      define(
        `monster_${skin}_attack`,
        [0, 1, 2, 3].map((i) => `${skin}_attack_${i}`),
        rates.attack,
        -1,
        'monsters',
      );
    }

    define('monster_mimic_wake', [0, 1, 2, 3].map((i) => `mimic_wake_${i}`), 8, 0, 'monsters');
    define('arrow_fly', ['arrow_0', 'arrow_1'], 14, -1, 'monsters');
    define('ember_dart_fly', ['ember_dart_0', 'ember_dart_1'], 14, -1, 'monsters');
    define('spore_puff_drift', ['spore_puff_0', 'spore_puff_1'], 6, -1, 'monsters');

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
    const biome = getFloorBiome(state.floor, state.utcDate);
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
            .setDisplaySize(tileSize + 1, tileSize + 1);
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
    borderShadow.fillStyle(0x14131a, 0.24);
    borderShadow.fillRect(PLAY_MIN_X, PLAY_MIN_Y, PLAY_MAX_X - PLAY_MIN_X, 12);
    borderShadow.fillStyle(0x14131a, 0.14);
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
      for (const spr of this.breakableSprites.values()) {
        spr.clearTint();
        this.prevRoomContainer.add(spr);
      }
      this.breakableSprites.clear();
      for (const spr of this.hazardSprites.values()) {
        this.prevRoomContainer.add(spr);
      }
      this.hazardSprites.clear();
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
    state.obstacles.forEach((o, i) => {
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
        if (isNearDoorwayCell(c - 1, r - 1)) continue;
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
      tG?.fillStyle(0x14131a, 0.85 * Math.sin(progress * Math.PI));
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
        tG.fillStyle(0x14131a, veilAlpha);
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
      tG.fillStyle(0x14131a, 0.86);
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
      const flashAlpha = 0.24 * (1 - progress / 0.14);
      tG.fillStyle(0xe04f44, flashAlpha);
      tG.fillRect(-ARENA_W * 0.5, -ARENA_H * 0.5, ARENA_W * 2, ARENA_H * 2);
    }

    if (progress > 0.74) {
      const veilProgress = Math.min(1, (progress - 0.74) / 0.18);
      const veilAlpha = 0.86 * Math.pow(veilProgress, 1.3);
      tG.fillStyle(0x14131a, veilAlpha);
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
    g.fillStyle(0x14131a, 0.98);
    g.fillRect(0, topY, ARENA_W, height);

    g.fillStyle(0x43495e, 1);
    for (let bx = 48; bx < ARENA_W; bx += 64) {
      g.fillRect(bx - 5, topY, 10, height);
    }

    const barY = isTop ? topY + Math.max(0, height - 18) : topY + 6;
    if (height >= 20) {
      g.fillStyle(0x2c303e, 1);
      g.fillRect(0, barY, ARENA_W, 12);
      g.fillStyle(0xe6a82e, 0.9);
      for (let rx = 48; rx < ARENA_W; rx += 64) {
        g.fillRect(rx - 2, barY + 4, 4, 4);
      }
    }

    const edgeY = isTop ? topY + height : topY;
    g.lineStyle(3, 0x6a738c, 1);
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

    const live = state.phase === 'playing' || state.phase === 'dying';
    this.frameDt = live ? dt : 0;
    this.fxClock += this.frameDt;
    this.fxParticles.update(this.frameDt);

    this.processCombatEvents(state);
    this.drawTorchGlows(glowG, state);
    this.drawAmbientMotes(glowG, state, dt);
    this.syncExitDoor(fxG, state);
    this.syncHazards(teleG, state);
    this.syncFountain(state);
    this.syncPortals(fxG, state);
    this.syncPedestals(fxG, state);
    this.syncBreakables(state);
    this.syncCoins(state);
    this.syncGems(state);
    this.syncHearts(state);
    this.syncFirePatches(state);
    this.syncSporeClouds(teleG, state);
    this.syncDelayedBlasts(teleG, state);
    this.drawTelegraphs(teleG, state);
    this.syncAfterimages(state);
    this.syncEnemies(shadowG, fxG, state);
    this.syncPlayer(fxG, state);
    this.syncProjectiles(fxG, state);
    this.drawDebris(fxG, state);
    this.drawSlashesRingsLightningsParticles(fxG, state);
    this.spawnProjectileTrails(state);
    this.fxParticles.draw(fxG);
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
          this.shaderFlashColor = [0.9, 0.66, 0.18];
          this.shaderFlash = 0.22;
        }
      }
    }
    this.prevEnemies.clear();
    for (const e of state.enemies) {
      this.prevEnemies.set(e.id, { x: e.x, y: e.y, archetype: e.archetype });
    }

    if (state.player.hurtFlashTimer > 0.45 && !this.prefersReducedMotion()) {
      this.shaderFlashColor = [0.88, 0.31, 0.27];
      this.shaderFlash = Math.max(this.shaderFlash, 0.16);
    }

    if (state.player.swingCount > this.prevSwingCount && !this.prefersReducedMotion()) {
      this.cameras.main.shake(45, 0.0022);
      this.spawnSwingBurst(state);
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
      archetype === 'chaser' || archetype === 'myconid'
        ? 0x265c42
        : archetype === 'shooter' || archetype === 'shade'
          ? 0x4b356e
          : archetype === 'yeti'
            ? 0x45a2e5
            : archetype === 'bomber' || archetype === 'imp'
              ? 0x8c5236
              : archetype === 'mortar_tank' || archetype === 'archer'
                ? 0x43495e
                : archetype === 'stampede'
                  ? 0x4d2e24
                  : archetype === 'boss'
                    ? 0x7a222e
                    : 0x4d2e24;
    const sx = snapPx(x);
    const sy = snapPx(y + 6);
    const s = PIXEL_SCALE;
    const rad = archetype === 'boss' ? 7 : 3;
    d.fillStyle(color, 0.2);
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
        ? 0xe04f44
        : door.targetCleared
          ? 0x6a738c
          : 0xe6a82e;
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
        this.nextLabel(posX + labelOffsetX, posY + labelOffsetY, 'BOSS', '#f2efe4', 16);
      } else if (!door.targetCleared) {
        this.nextLabel(posX + labelOffsetX, posY + labelOffsetY, arrow, '#f7df86', 18);
      }
    }
  }

  private syncHazards(
    teleG: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    if (this.pendingPortalSwap) return;
    const activeIds = new Set<number>();

    for (const haz of state.hazards) {
      if (haz.destroyed) continue;
      activeIds.add(haz.id);

      if (haz.type === 'currents') {
        const halfW = haz.w / 2;
        const halfH = haz.h / 2;
        teleG.fillStyle(0x45a2e5, 0.12);
        teleG.fillRect(haz.x - halfW, haz.y - halfH, haz.w, haz.h);
        teleG.lineStyle(2, 0x45a2e5, 0.32);
        teleG.strokeRect(haz.x - halfW, haz.y - halfH, haz.w, haz.h);

        const offset = ((state.elapsedTime * 90) % 44) * haz.dirX;
        teleG.lineStyle(3, hexNum(this.bridge.theme.hazardAccent), 0.72);
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
        spr
          .setPosition(haz.x, haz.y)
          .setFrame(haz.active ? 'spikes_2' : 'spikes_0')
          .setDisplaySize(haz.w, haz.h)
          .setDepth(5)
          .setVisible(true);
      } else {
        spr
          .setPosition(haz.x, haz.y)
          .setFrame('barrel_tnt')
          .setDisplaySize(haz.w, haz.h)
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

  private syncFountain(state: GameState): void {
    const f = state.fountain;
    if (!f || !this.fountainTop || !this.fountainBottom) {
      this.fountainTop?.setVisible(false);
      this.fountainBottom?.setVisible(false);
      return;
    }

    const active = !f.used;

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
      .setColor(active ? '#96db6e' : '#a9b6cc')
      .setVisible(true);
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

      const primary = 0xe6a82e;
      const sx = snapPx(portal.x);
      const sy = snapPx(portal.y);
      const box = Math.sin(state.elapsedTime * 5) > 0 ? 30 : 27;

      // Crisp stepped pixel rune brackets framing the descent stairs (zero mixels)
      fxG.fillStyle(primary, 0.14);
      fxG.fillRect(sx - 27, sy - 27, 54, 54);
      fxG.fillStyle(primary, 0.9);
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
          fxG.fillStyle(0xf7df86, 1);
          fxG.fillRect(rx - 3, ry - 3, 6, 6);
        }
      }

      this.nextLabel(portal.x, portal.y - 48, portal.label, '#f2efe4', 17);
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
          entry.item.setTint(0xf7df86);
        } else {
          entry.item.clearTint();
        }

        const lvLabel = ped.nextLevel > 1 ? ` ${ped.nextLevel}` : '';
        this.nextLabel(ped.x, ped.y + 50, `${ped.relic.name}${lvLabel}`, ped.hovered ? '#f7df86' : '#f2efe4', 17);
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
        fxG.fillStyle(0x14131a, 0.94);
        fxG.fillRect(boxX, boxY, boxW, boxH);
        fxG.lineStyle(3, 0xe6a82e, 1);
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

  private syncBreakables(state: GameState): void {
    if (this.pendingPortalSwap) return;
    const activeIds = new Set<number>();

    for (const br of state.breakables) {
      activeIds.add(br.id);
      const isChest = br.kind === 'chest';
      const texture = isChest ? 'monsters' : 'dungeon';
      const frame = isChest ? 'chest_closed' : br.kind === 'pillar' ? 'tile_065' : 'tile_063';
      const baseSize = isChest ? 16 * PIXEL_SCALE : CELL_SIZE;
      let spr = this.breakableSprites.get(br.id);
      if (!spr) {
        spr = this.add.image(br.x, br.y, texture, frame).setDisplaySize(baseSize, baseSize).setDepth(9);
        this.breakableSprites.set(br.id, spr);
      }

      const shakeX = br.hitFlash > 0 ? Math.sin(state.elapsedTime * 85 + br.id) * 3 : 0;
      const drawW = br.hitFlash > 0 ? Math.round(baseSize * 1.08) : baseSize;
      const drawH = br.hitFlash > 0 ? Math.round(baseSize * 0.92) : baseSize;
      spr
        .setTexture(texture, frame)
        .setPosition(br.x + shakeX, br.y + (baseSize - drawH) * 0.35)
        .setDisplaySize(drawW, drawH);
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

  private syncCoins(state: GameState): void {
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
      spr.setPosition(coin.x, coin.y - 3 + bob);
    }

    for (const [id, spr] of this.coinSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.coinSprites.delete(id);
      }
    }
  }

  private syncGems(state: GameState): void {
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
      spr.setPosition(gem.x, gem.y - 3 + bob);
    }

    for (const [id, spr] of this.gemSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.gemSprites.delete(id);
      }
    }
  }

  private syncHearts(state: GameState): void {
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

  private syncSporeClouds(teleG: Phaser.GameObjects.Graphics, state: GameState): void {
    const activeIds = new Set<number>();

    if (!this.pendingPortalSwap) {
      for (const cloud of state.sporeClouds) {
        activeIds.add(cloud.id);
        const life = Math.max(0, Math.min(1, cloud.ttl / Math.max(0.01, cloud.maxTtl)));
        const fade = life < 0.28 ? life / 0.28 : 1;

        // Calm, readable moss-teal spore zone (no harsh neon glow).
        teleG.fillStyle(0x265c42, 0.16 * fade);
        teleG.fillCircle(cloud.x, cloud.y, cloud.radius);
        teleG.lineStyle(2, 0x4eab5b, 0.58 * fade);
        teleG.strokeCircle(cloud.x, cloud.y, cloud.radius);
        const innerR = cloud.radius * (0.64 + 0.05 * Math.sin(state.elapsedTime * 3.2 + cloud.id));
        teleG.lineStyle(1.5, 0x96db6e, 0.3 * fade);
        teleG.strokeCircle(cloud.x, cloud.y, innerR);

        let puffs = this.sporeCloudSprites.get(cloud.id);
        if (!puffs) {
          puffs = Array.from({ length: 3 }, () => {
            const s = this.add
              .sprite(cloud.x, cloud.y, 'monsters', 'spore_puff_0')
              .setScale(PIXEL_SCALE)
              .setDepth(7);
            s.play('spore_puff_drift');
            return s;
          });
          this.sporeCloudSprites.set(cloud.id, puffs);
        }

        for (let i = 0; i < puffs.length; i += 1) {
          const spr = puffs[i];
          if (!spr) continue;
          const ang = state.elapsedTime * 0.75 + cloud.id * 1.3 + (i * Math.PI * 2) / puffs.length;
          const dist = cloud.radius * 0.42;
          const bob = Math.sin(state.elapsedTime * 2.8 + i * 2.1 + cloud.id) * 4;
          spr
            .setPosition(cloud.x + Math.cos(ang) * dist, cloud.y + Math.sin(ang) * dist * 0.78 + bob)
            .setScale(PIXEL_SCALE * (0.88 + 0.1 * fade))
            .setAlpha(0.72 * fade)
            .setVisible(true);
        }
      }
    }

    for (const [id, puffs] of this.sporeCloudSprites.entries()) {
      if (!activeIds.has(id)) {
        for (const spr of puffs) {
          spr.destroy();
        }
        this.sporeCloudSprites.delete(id);
      }
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
        ? 0xe6a82e
        : blast.kind === 'ice_mortar'
          ? 0x9edbf7
          : 0xe04f44;
      teleG.fillStyle(stroke, blast.friendly ? 0.12 : 0.14);
      teleG.fillCircle(blast.x, blast.y, blast.radius);
      teleG.lineStyle(2, stroke, 0.9);
      teleG.strokeCircle(blast.x, blast.y, Math.max(4, blast.radius * progress));

      if (blast.kind === 'decoy_mine') {
        spr
          .setTexture('dungeon', 'barrel_tnt')
          .setScale(PIXEL_SCALE)
          .setPosition(blast.x, blast.y)
          .setAlpha(1)
          .clearTint()
          .setVisible(true);
      } else if (blast.kind === 'barrel_blast') {
        const swell = CELL_SIZE * (1 + 0.26 * progress);
        spr
          .setTexture('dungeon', 'barrel_tnt')
          .setDisplaySize(swell, swell * (1 - 0.08 * progress))
          .setPosition(blast.x, blast.y)
          .setAlpha(1)
          .setVisible(true);
        if (Math.floor(progress * 10) % 2 === 0) {
          spr.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        } else {
          spr.setTint(0xf0853a).setTintMode(Phaser.TintModes.MULTIPLY);
        }
      } else if (blast.kind === 'sapper_bomb') {
        spr
          .setTexture('town', 105)
          .setScale(2)
          .setPosition(blast.x, blast.y)
          .setAlpha(1)
          .clearTint()
          .setVisible(true);
      } else if (blast.kind === 'phantom_echo') {
        spr
          .setTexture('dungeon', 'hero_dash_0')
          .setScale(PIXEL_SCALE)
          .setPosition(blast.x, blast.y)
          .setAlpha(0.65)
          .clearTint()
          .setVisible(true);
      } else {
        spr.clearTint().setVisible(false);
      }
    }
  }

  private drawTelegraphs(teleG: Phaser.GameObjects.Graphics, state: GameState): void {
    for (const enemy of state.enemies) {
      if (enemy.state === 'spawning') {
        const t = 1 - enemy.stateTimer / 0.65;
        teleG.lineStyle(2, 0xe04f44, 0.65);
        teleG.strokeCircle(enemy.x, enemy.y, enemy.radius + (1 - Math.max(0, t)) * 22);
      } else if (
        enemy.archetype === 'myconid' &&
        enemy.state === 'telegraph' &&
        enemy.attackKind === 'spore_burst'
      ) {
        const dur = Math.max(0.01, enemy.telegraphDuration);
        const t = Math.max(0, Math.min(1, 1 - enemy.stateTimer / dur));
        const r = 66;
        teleG.fillStyle(0x265c42, 0.08 + 0.08 * t);
        teleG.fillCircle(enemy.x, enemy.y, r);
        teleG.lineStyle(2, 0x4eab5b, 0.35 + 0.4 * t);
        teleG.strokeCircle(enemy.x, enemy.y, r);
        teleG.lineStyle(2, 0x96db6e, 0.3 + 0.45 * t);
        teleG.strokeCircle(enemy.x, enemy.y, Math.max(12, r * t));
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
        const startAsset = this.getEnemyAsset(enemy);
        spr = this.add.sprite(enemy.x, enemy.y, startAsset.texture, startAsset.frame).setDepth(10);
        this.enemySprites.set(enemy.id, spr);
      }

      if (hideEnemies) {
        spr.setVisible(false);
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

      const scale = this.getEnemyScale() * popMult;
      const skin = this.getEnemySkin(enemy);
      const isMimicWake = skin === 'mimic' && enemy.state === 'spawning';
      const isBossLeapTelegraph =
        enemy.archetype === 'boss' &&
        enemy.attackKind === 'boss_leap' &&
        enemy.state === 'telegraph';
      const isBossLeapAir =
        enemy.archetype === 'boss' &&
        enemy.attackKind === 'boss_leap' &&
        enemy.state === 'attack' &&
        enemy.leapZ > 0;
      const heightRatio = Math.max(0, Math.min(1, enemy.leapZ / 135));
      const alpha = isMimicWake ? 1 : enemy.state === 'spawning' ? 0.45 : 1;
      const fx = this.updateEnemyFx(enemy, state);
      const inState = this.fxClock - fx.stateStartedAt;
      const pose = isMimicWake
        ? {
            sx: 1,
            sy: 1,
            rot: 0,
            ox: inState > 0.14 ? Math.sin(state.elapsedTime * 60 + enemy.id) * 1.8 : 0,
            oy: 0,
            charge: 0,
          }
        : computeEnemyPose(enemy, fx, inState, state.elapsedTime);
      const colors = ENEMY_COLORS[enemy.archetype];
      const airborne = Math.min(0, pose.oy);

      // Quiet dark contact shadow under every monster (hidden while Mimic chest is still closed).
      if (!isBossLeapAir && (!isMimicWake || inState >= 0.25)) {
        drawPixelShadow(
          shadowG,
          enemy.x,
          enemy.y + enemy.radius * 0.72,
          enemy.radius * 0.92 * popMult,
          Math.max(5, enemy.radius * 0.34 * popMult),
          0.36,
        );
      }
      if (pose.charge > 0) {
        // Crisp wind-up telegraph ring ONLY during active telegraph.
        const ringR = enemy.radius * (2.2 - 0.95 * pose.charge);
        const ringColor = enemy.archetype === 'myconid' ? 0x4eab5b : 0xe04f44;
        shadowG.lineStyle(2, ringColor, 0.25 + 0.55 * pose.charge);
        shadowG.strokeEllipse(enemy.x, enemy.y + enemy.radius * 0.6, ringR * 2, ringR * 0.9);
      }

      if (isBossLeapAir) {
        const shadowMult = 1 - 0.34 * heightRatio;
        const shadowAlpha = 0.4 * (1 - 0.32 * heightRatio);
        drawPixelShadow(
          shadowG,
          enemy.x,
          enemy.y + enemy.radius * 0.78,
          enemy.radius * 1.05 * popMult * shadowMult * (1 + airborne / 110),
          Math.max(6, enemy.radius * 0.36 * popMult * shadowMult * (1 + airborne / 110)),
          shadowAlpha,
        );
        fxG.lineStyle(2, 0xe04f44, 0.24 + 0.36 * (1 - heightRatio));
        fxG.strokeCircle(enemy.targetX, enemy.targetY, 32 + 46 * (1 - heightRatio));
      }

      let scaleX = scale;
      let scaleY = scale;
      let crouchY = 0;
      if (isBossLeapTelegraph) {
        const chargeT =
          1 - Math.max(0, enemy.stateTimer / Math.max(0.01, enemy.telegraphDuration));
        scaleX = scale * (1 + 0.18 * chargeT);
        scaleY = scale * (1 - 0.16 * chargeT);
        crouchY = 5 * chargeT;
      } else if (isBossLeapAir) {
        const airBoost = 1 + 0.58 * heightRatio;
        scaleX = scale * airBoost;
        scaleY = scale * airBoost;
      }

      const bobY =
        enemy.archetype === 'shade' ? Math.sin(state.elapsedTime * 6 + enemy.id) * 3 : 0;
      spr
        .setDepth(isBossLeapAir ? 18 : 10)
        .setPosition(enemy.x + pose.ox, enemy.y - enemy.leapZ + crouchY + bobY + pose.oy)
        .setScale(scaleX * pose.sx, scaleY * pose.sy)
        .setRotation(pose.rot)
        .setAlpha(alpha)
        .setFlipX(state.player.x < enemy.x);

      const animKey = this.pickEnemyAnim(enemy);
      spr.anims.timeScale = isBossLeapTelegraph ? 1.85 : isBossLeapAir ? 1.35 : 1;
      spr.play(animKey, true);

      if (enemy.hitFlashTimer > 0) {
        spr.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      } else if (pose.charge > 0.75 && Math.sin(state.elapsedTime * 12) > 0) {
        const pulseColor = enemy.archetype === 'myconid' ? 0x96db6e : 0xe04f44;
        spr.setTint(pulseColor).setTintMode(Phaser.TintModes.MULTIPLY);
      } else if (enemy.archetype === 'shade' && enemy.state === 'telegraph') {
        spr.setTint(0xa770d6).setTintMode(Phaser.TintModes.MULTIPLY);
      } else {
        spr.clearTint();
      }

      this.spawnEnemyStateFx(enemy, fx, colors);

      if (enemy.state === 'staggered') {
        // Dizzy stars circling the head.
        for (let i = 0; i < 3; i += 1) {
          const a = state.elapsedTime * 5 + (i * Math.PI * 2) / 3;
          drawStar(
            fxG,
            enemy.x + Math.cos(a) * enemy.radius * 0.9,
            enemy.y - enemy.radius - 10 + Math.sin(a) * 4,
            4,
            i === 1 ? 0x9edbf7 : 0xf7df86,
            0.95,
          );
        }
      } else if (
        (enemy.archetype === 'boss' || enemy.archetype === 'elite_charger') &&
        enemy.hp < enemy.maxHp
      ) {
        const bw = enemy.radius * 2.2;
        const bx = enemy.x - bw / 2;
        const by = enemy.y - enemy.radius - 14;
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        fxG.fillStyle(0x14131a, 0.95);
        fxG.fillRect(bx - 1, by - 1, bw + 2, 6);
        fxG.fillStyle(0x21232e, 1);
        fxG.fillRect(bx, by, bw, 4);
        fxG.fillStyle(0xe04f44, 1);
        fxG.fillRect(bx, by, bw * ratio, 4);
      }
    }

    for (const id of this.enemyFx.keys()) {
      if (!activeIds.has(id)) this.enemyFx.delete(id);
    }

    for (const [id, spr] of this.enemySprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.enemySprites.delete(id);
      }
    }
  }

  private playerPalette(state: GameState): WeaponPalette {
    return WEAPON_PALETTES[state.player.weaponId] ?? WEAPON_PALETTES.longsword;
  }

  /** Track per-monster state changes and hits (client-side) for poses and effects. */
  private updateEnemyFx(enemy: EnemyEntity, state: GameState): EnemyFxState {
    let fx = this.enemyFx.get(enemy.id);
    if (!fx) {
      fx = {
        lastState: enemy.state,
        lastAttackKind: enemy.attackKind,
        stateStartedAt: this.fxClock,
        prevHp: enemy.hp,
        hitT: 0,
        hitDirX: 0,
        hitDirY: 0,
        trailCd: 0,
      };
      this.enemyFx.set(enemy.id, fx);
    }
    const colors = ENEMY_COLORS[enemy.archetype];
    if (enemy.state !== fx.lastState) {
      const wasLeap = fx.lastState === 'attack' && fx.lastAttackKind === 'boss_leap';
      if (wasLeap) {
        // Landing shockwave.
        this.fxParticles.add({ x: enemy.x, y: enemy.y + enemy.radius * 0.6, color: colors.hot, shape: 'ring', size: 16, ttl: 0.45 });
        this.fxParticles.burst(enemy.x, enemy.y + enemy.radius * 0.6, [colors.main, colors.hot, 0xffffff], 18, 300, { shape: 'spark', ttl: 0.4 });
      }
      fx.lastState = enemy.state;
      fx.stateStartedAt = this.fxClock;
      if (enemy.state === 'attack') this.spawnAttackStartFx(enemy, colors);
    }
    if (enemy.attackKind !== 'none') fx.lastAttackKind = enemy.attackKind;

    if (enemy.hp < fx.prevHp - 0.5) {
      const dx = enemy.x - state.player.x;
      const dy = enemy.y - state.player.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      fx.hitT = HIT_REACT_TIME;
      fx.hitDirX = dx / d;
      fx.hitDirY = dy / d;
      this.spawnHitFx(enemy, fx.hitDirX, fx.hitDirY, this.playerPalette(state));
    }
    fx.prevHp = enemy.hp;
    fx.hitT = Math.max(0, fx.hitT - this.frameDt);
    return fx;
  }

  private spawnHitFx(enemy: EnemyEntity, dirX: number, dirY: number, pal: WeaponPalette): void {
    if (this.prefersReducedMotion()) return;
    const colors = ENEMY_COLORS[enemy.archetype];
    const angle = Math.atan2(dirY, dirX);
    this.fxParticles.burst(enemy.x, enemy.y, pal.sparks, 5, 300, { shape: 'spark', angle, spread: 1.6, ttl: 0.24, size: 3 });
    this.fxParticles.burst(enemy.x, enemy.y, [colors.main, colors.hot], 3, 160, { size: 3, ttl: 0.36, gravity: 420, angle, spread: 2.0 });
  }

  private spawnAttackStartFx(enemy: EnemyEntity, colors: { main: number; hot: number }): void {
    if (this.prefersReducedMotion()) return;
    const kind = enemy.attackKind;
    const aimX = Math.cos(enemy.aimAngle);
    const aimY = Math.sin(enemy.aimAngle);
    const behindAngle = enemy.aimAngle + Math.PI;
    if (kind === 'lunge' || kind === 'charge' || kind === 'ricochet_charge') {
      this.fxParticles.burst(enemy.x - aimX * enemy.radius, enemy.y - aimY * enemy.radius + enemy.radius * 0.5, [colors.main, 0xd49562], 4, 180, { angle: behindAngle, spread: 1.2, ttl: 0.32, size: 3 });
    } else if (kind === 'boss_radial') {
      this.fxParticles.add({ x: enemy.x, y: enemy.y, color: colors.main, shape: 'ring', size: 22, ttl: 0.45 });
      this.fxParticles.burst(enemy.x, enemy.y, [colors.main, colors.hot, 0xf2efe4], 12, 320, { shape: 'spark', ttl: 0.38 });
    } else if (kind === 'boss_leap' || kind === 'drop_bomb') {
      this.fxParticles.burst(enemy.x, enemy.y + enemy.radius * 0.7, [0xd49562, colors.main], 6, 140, { ttl: 0.32, size: 3 });
    } else if (kind === 'spore_burst') {
      this.fxParticles.burst(enemy.x, enemy.y, [0x4eab5b, 0x96db6e], 6, 110, { ttl: 0.32, size: 3 });
    } else if (kind === 'shoot_arrow') {
      const mx = enemy.x + aimX * enemy.radius;
      const my = enemy.y + aimY * enemy.radius;
      this.fxParticles.burst(mx, my, [0xf2efe4, 0xd49562], 2, 140, { shape: 'spark', angle: enemy.aimAngle, spread: 0.5, ttl: 0.14, size: 2 });
    } else if (kind === 'imp_dart') {
      const mx = enemy.x + aimX * enemy.radius;
      const my = enemy.y + aimY * enemy.radius;
      this.fxParticles.burst(mx, my, [0xf0853a, 0xf7df86], 4, 190, { shape: 'spark', angle: enemy.aimAngle, spread: 0.6, ttl: 0.18, size: 2 });
    } else {
      const mx = enemy.x + aimX * enemy.radius;
      const my = enemy.y + aimY * enemy.radius;
      this.fxParticles.burst(mx, my, [colors.hot, colors.main, 0xf2efe4], 5, 240, { shape: 'spark', angle: enemy.aimAngle, spread: 0.8, ttl: 0.2 });
    }
  }

  /** Continuous effects while a monster dashes or fans projectiles (kept minimal for visual clarity). */
  private spawnEnemyStateFx(enemy: EnemyEntity, fx: EnemyFxState, colors: { main: number; hot: number }): void {
    if (this.prefersReducedMotion() || this.frameDt <= 0) return;
    fx.trailCd -= this.frameDt;
    if (fx.trailCd > 0) return;
    if (enemy.state === 'attack') {
      const kind = fx.lastAttackKind;
      if (kind === 'lunge' || kind === 'charge' || kind === 'ricochet_charge') {
        fx.trailCd = 0.045;
        const aimX = Math.cos(enemy.aimAngle);
        const aimY = Math.sin(enemy.aimAngle);
        const side = (Math.random() - 0.5) * enemy.radius * 1.2;
        this.fxParticles.add({
          x: enemy.x - aimX * enemy.radius + -aimY * side,
          y: enemy.y - aimY * enemy.radius + aimX * side,
          vx: -aimX * 190,
          vy: -aimY * 190,
          color: Math.random() < 0.6 ? colors.main : colors.hot,
          shape: 'spark',
          size: 3,
          ttl: 0.18,
        });
      } else if (kind === 'shade_fan') {
        fx.trailCd = 0.08;
        this.fxParticles.burst(enemy.x, enemy.y, [colors.main, colors.hot], 1, 100, { ttl: 0.24, size: 3 });
      }
    }
  }

  /** Weapon-coloured sparks along the swing arc (melee) or a muzzle flash (ranged). */
  private spawnSwingBurst(state: GameState): void {
    const p = state.player;
    const w = getWeapon(p.weaponId);
    const pal = (p.relics.blood_reset ?? 0) > 0 || (p.relics.rift_cleave ?? 0) > 0 ? GOLD_PALETTE : this.playerPalette(state);
    const angle = p.attackAngle;
    if (w.style === 'melee') {
      const arc = (Math.max(1, w.arcDeg) * Math.PI) / 180;
      const sign = p.swingCount % 2 === 1 ? 1 : -1;
      const n = w.id === 'hammer' ? 8 : 5;
      for (let i = 0; i < n; i += 1) {
        const u = i / Math.max(1, n - 1) - 0.5;
        const a = angle + sign * u * arc;
        const r = w.range * (0.65 + Math.random() * 0.3);
        const tang = a + sign * Math.PI * 0.5;
        const spd = 110 + Math.random() * 140;
        this.fxParticles.add({
          x: p.x + Math.cos(a) * r,
          y: p.y + Math.sin(a) * r,
          vx: Math.cos(tang) * spd + Math.cos(a) * 35,
          vy: Math.sin(tang) * spd + Math.sin(a) * 35,
          color: pal.sparks[i % pal.sparks.length] ?? pal.main,
          shape: i % 2 === 0 ? 'spark' : 'dot',
          size: w.id === 'hammer' ? 4 : 3,
          ttl: 0.22,
        });
      }
      if (w.id === 'hammer') {
        const ix = p.x + Math.cos(angle) * w.range * 0.7;
        const iy = p.y + Math.sin(angle) * w.range * 0.7;
        this.fxParticles.add({ x: ix, y: iy, color: pal.main, shape: 'ring', size: 18, ttl: 0.32 });
      }
    } else {
      const mx = p.x + Math.cos(angle) * 24;
      const my = p.y + Math.sin(angle) * 24;
      this.fxParticles.burst(mx, my, pal.sparks, 5, 240, { shape: 'spark', angle, spread: 0.9, ttl: 0.18 });
    }
  }

  /** Sparse projectile trails: clean sky tones for friendly shots, warm ember for enemy orbs/darts. */
  private spawnProjectileTrails(state: GameState): void {
    if (this.prefersReducedMotion() || this.frameDt <= 0) return;
    for (const proj of state.projectiles) {
      if (proj.kind === 'arrow') continue;
      if (Math.random() > 0.15) continue;
      let colors: number[];
      if (!proj.friendly) colors = proj.kind === 'ember' ? [0xf0853a, 0xf7df86] : [0xf0853a, 0xf7df86, 0xe04f44];
      else if (proj.kind === 'lance') colors = WEAPON_PALETTES.arcane_lance.sparks;
      else if (proj.kind === 'bolt') colors = WEAPON_PALETTES.scatter_staff.sparks;
      else if (proj.kind === 'rift_wave') colors = [0x45a2e5, 0x9edbf7, 0xf2efe4];
      else colors = [0x9edbf7, 0xf2efe4];
      this.fxParticles.add({
        x: proj.x + (Math.random() - 0.5) * 4,
        y: proj.y + (Math.random() - 0.5) * 4,
        vx: -proj.vx * 0.08,
        vy: -proj.vy * 0.08,
        color: colors[Math.floor(Math.random() * colors.length)] ?? 0xf2efe4,
        size: proj.kind === 'lance' ? 3 : 2,
        ttl: 0.18,
      });
    }
  }

  private getEnemySkin(enemy: EnemyEntity): MonsterSkin {
    const idx = Math.abs(enemy.id);
    switch (enemy.archetype) {
      case 'chaser':
        return CHASER_SKINS[idx % CHASER_SKINS.length]!;
      case 'shooter':
        return SHOOTER_SKINS[idx % SHOOTER_SKINS.length]!;
      case 'charger':
        return CHARGER_SKINS[idx % CHARGER_SKINS.length]!;
      case 'elite_charger':
        return 'warden';
      case 'boss':
        return 'boss';
      case 'shade':
        return 'shade';
      case 'yeti':
        return 'yeti';
      case 'bomber':
        return 'sapper';
      case 'mortar_tank':
        return 'tank';
      case 'stampede':
        return 'bull';
      case 'myconid':
        return 'myconid';
      case 'imp':
        return 'imp';
      case 'archer':
        return 'archer';
    }
  }

  private getEnemyAsset(enemy: EnemyEntity): {
    texture: 'monsters';
    frame: string;
  } {
    const skin = this.getEnemySkin(enemy);
    const frame =
      skin === 'mimic' && enemy.state === 'spawning' ? 'mimic_wake_0' : `${skin}_idle_0`;
    return { texture: 'monsters', frame };
  }

  private getEnemyScale(): number {
    return PIXEL_SCALE;
  }

  private pickEnemyAnim(enemy: EnemyEntity): string {
    const skin = this.getEnemySkin(enemy);
    if (skin === 'mimic' && enemy.state === 'spawning') {
      return 'monster_mimic_wake';
    }
    if (enemy.archetype === 'boss' && enemy.attackKind === 'boss_leap') {
      if (enemy.state === 'telegraph') return 'monster_boss_run';
      if (enemy.state === 'attack') {
        const u = 1 - Math.max(0, enemy.stateTimer) / Math.max(0.01, enemy.leapDuration);
        return u < 0.55 ? 'monster_boss_run' : 'monster_boss_attack';
      }
    }
    if (enemy.state === 'telegraph' || enemy.state === 'attack') {
      return `monster_${skin}_attack`;
    }
    return enemy.state === 'chase' ? `monster_${skin}_run` : `monster_${skin}_idle`;
  }

  private syncPlayer(
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
          fxG.fillStyle(0x14131a, soulAlpha);
          fxG.fillRect(soulX - 9, soulY - 9, 18, 18);
          fxG.fillStyle(0x9edbf7, soulAlpha);
          fxG.fillRect(soulX - 6, soulY - 6, 12, 12);
          fxG.fillStyle(0xf2efe4, soulAlpha);
          fxG.fillRect(soulX - 3, soulY - 3, 6, 6);
          fxG.fillStyle(0x14131a, soulAlpha);
          fxG.fillRect(soulX - 3, soulY - 3, 3, 3);
          fxG.fillRect(soulX + 3, soulY - 3, 3, 3);
          fxG.fillStyle(0x9edbf7, soulAlpha * 0.85);
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
      fxG.fillStyle(0x45a2e5, 0.82);
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
      this.weaponSprite.setTint(0xf7df86).setTintMode(Phaser.TintModes.FILL);
    } else {
      this.weaponSprite.clearTint();
    }
  }

  private syncProjectiles(
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
            fxG.fillStyle(0x14131a, 1);
            fxG.fillRect(bx - 6, by - 6, 12, 12);
          }
          fxG.fillStyle(i === 0 ? 0xf2efe4 : i <= 2 ? 0x9edbf7 : 0x45a2e5, i === 0 ? 1 : 0.85);
          fxG.fillRect(bx - 3, by - 3, 6, 6);
        }
        continue;
      }
      if (proj.kind === 'bolt') {
        const tx = snapPx(proj.x - Math.cos(proj.angle) * 9);
        const ty = snapPx(proj.y - Math.sin(proj.angle) * 9);
        const px = snapPx(proj.x);
        const py = snapPx(proj.y);
        fxG.fillStyle(0x14131a, 1);
        fxG.fillRect(px - 6, py - 6, 12, 12);
        fxG.fillStyle(0xa770d6, 0.78);
        fxG.fillRect(tx - 3, ty - 3, 6, 6);
        fxG.fillStyle(0xf2efe4, 1);
        fxG.fillRect(px - 3, py - 3, 6, 6);
        continue;
      }
      if (proj.kind === 'rift_wave') {
        fxG.lineStyle(6, 0x45a2e5, 1);
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

      if (proj.kind === 'arrow') {
        activeIds.add(proj.id);
        let spr = this.projectileSprites.get(proj.id);
        if (!spr) {
          spr = this.add
            .sprite(proj.x, proj.y, 'monsters', 'arrow_0')
            .setScale(PIXEL_SCALE)
            .setDepth(13);
          spr.play('arrow_fly');
          this.projectileSprites.set(proj.id, spr);
        }
        spr.setPosition(proj.x, proj.y).setRotation(Math.atan2(proj.vy, proj.vx));
        continue;
      }

      if (proj.kind === 'ember') {
        activeIds.add(proj.id);
        let spr = this.projectileSprites.get(proj.id);
        if (!spr) {
          spr = this.add
            .sprite(proj.x, proj.y, 'monsters', 'ember_dart_0')
            .setScale(PIXEL_SCALE)
            .setDepth(13);
          spr.play('ember_dart_fly');
          this.projectileSprites.set(proj.id, spr);
        }
        spr.setPosition(proj.x, proj.y).setRotation(Math.atan2(proj.vy, proj.vx));
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

      spr.setPosition(proj.x, proj.y);
    }

    for (const [id, spr] of this.projectileSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.projectileSprites.delete(id);
      }
    }
  }

  private drawDebris(
    g: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    for (const d of state.debris) {
      const lifeRatio = Math.max(0, Math.min(1, d.ttl / Math.max(0.01, d.maxTtl)));
      const fade = lifeRatio < 0.3 ? lifeRatio / 0.3 : 1;

      const cos = Math.cos(d.angle);
      const sin = Math.sin(d.angle);
      const hw = d.w / 2;
      const hh = d.h / 2;
      const cy = d.y - d.z;
      const pts = [
        { x: d.x + (-hw * cos - -hh * sin), y: cy + (-hw * sin + -hh * cos) },
        { x: d.x + (hw * cos - -hh * sin), y: cy + (hw * sin + -hh * cos) },
        { x: d.x + (hw * cos - hh * sin), y: cy + (hw * sin + hh * cos) },
        { x: d.x + (-hw * cos - hh * sin), y: cy + (-hw * sin + hh * cos) },
      ];
      g.fillStyle(hexNum(d.color), fade);
      this.tracePolygon(g, pts, true);
      g.fillPath();
      g.lineStyle(1.5, hexNum(d.borderColor), fade);
      this.tracePolygon(g, pts, true);
      g.strokePath();
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

      const pal = slash.color === '#fbbf24' ? GOLD_PALETTE : this.playerPalette(state);
      const outerCol = pal.main;
      const outerPoly = [...outerPts, ...[...innerPts].reverse()];
      // Soft outer glow in the weapon's secondary colour.
      const glowPts = outerPts.map((pt) => ({
        x: slash.x + (pt.x - slash.x) * 1.12,
        y: slash.y + (pt.y - slash.y) * 1.12,
      }));
      g.fillStyle(pal.glow, fade * (slash.hitCount > 0 ? 0.4 : 0.24));
      this.tracePolygon(g, [...glowPts, ...[...innerPts].reverse()], true);
      g.fillPath();
      g.fillStyle(outerCol, fade * 0.92);
      this.tracePolygon(g, outerPoly, true);
      g.fillPath();
      g.lineStyle(3, 0x14131a, fade * 0.9);
      this.tracePolygon(g, outerPoly, true);
      g.strokePath();

      const corePoly = [...outerPts, ...[...coreInnerPts].reverse()];
      g.fillStyle(0xf2efe4, fade);
      this.tracePolygon(g, corePoly, true);
      g.fillPath();

      g.lineStyle(2.5, 0xf2efe4, fade);
      this.tracePolygon(g, outerPts, false);
      g.strokePath();

      const headPt = outerPts[outerPts.length - 1];
      if (headPt && t < 0.45) {
        const arm = 7 * (1 - t / 0.45);
        g.lineStyle(2, 0xf2efe4, fade);
        g.lineBetween(headPt.x - arm, headPt.y, headPt.x + arm, headPt.y);
        g.lineBetween(headPt.x, headPt.y - arm, headPt.x, headPt.y + arm);
      }

      if (slash.hitCount > 0 && t < 0.42) {
        const ix = slash.x + Math.cos(slash.angle) * slash.radius * 0.58;
        const iy = slash.y + Math.sin(slash.angle) * slash.radius * 0.58;
        const crossLen = 10 * (1 - (t / 0.42) * 0.4);
        g.lineStyle(4, 0x14131a, fade);
        g.lineBetween(ix - crossLen, iy - crossLen, ix + crossLen, iy + crossLen);
        g.lineBetween(ix + crossLen, iy - crossLen, ix - crossLen, iy + crossLen);
        g.lineStyle(2, pal.sparks[0] ?? 0xf2efe4, fade);
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
      g.lineStyle(3, 0x9edbf7, alpha);
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

    g.fillStyle(0x14131a, 0.94 * alpha);
    g.fillRect(bx, by, boxW, boxH);
    g.lineStyle(2, 0x43495e, alpha);
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

    g.fillStyle(0x6a738c, 0.16);
    g.fillCircle(origin.x, origin.y, joy.maxRadius * invZoom);
    g.lineStyle(2 * invZoom, 0xf2efe4, 0.35);
    g.strokeCircle(origin.x, origin.y, joy.maxRadius * invZoom);

    g.fillStyle(0x45a2e5, 0.75);
    g.fillCircle(knob.x, knob.y, 20 * invZoom);
  }

  private drawAmbientMotes(
    g: Phaser.GameObjects.Graphics,
    state: GameState,
    dt: number,
  ): void {
    if (this.prefersReducedMotion()) return;
    const biome = getFloorBiome(state.floor, state.utcDate);
    const moteColor =
      biome.id === 'snow'
        ? 0x9edbf7
        : biome.id === 'farm'
          ? 0x96db6e
          : biome.id === 'town'
            ? 0xf7df86
            : 0xf0853a;
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
      const alpha = 0.08 + 0.08 * (0.5 + 0.5 * Math.sin(state.elapsedTime * 2.6 + m.phase));
      g.fillStyle(moteColor, alpha);
      g.fillRect(snapPx(m.x), snapPx(m.y), PIXEL_SCALE, PIXEL_SCALE);
    }
  }

  private updateAtmosphere(state: GameState): void {
    const atmo = this.atmosphere;
    if (!atmo) return;

    const biome = getFloorBiome(state.floor, state.utcDate);
    const theme = this.bridge.theme;
    const boss = state.enemies.find((e) => e.archetype === 'boss');

    // Calm Hearth & Slate atmosphere: neutral grade, subtle ink vignette, high readability.
    atmo.grade = [1.02, 1.02, 1.0, 0.0];
    atmo.vignetteColor = [0.078, 0.075, 0.102];
    atmo.vignetteStrength = boss ? 0.22 : 0.16;

    if (biome.id === 'dungeon') {
      atmo.ambientColor = [...theme.shaderAmbient];
    } else if (biome.id === 'snow') {
      atmo.ambientColor = [0.95, 0.97, 1.0];
    } else if (biome.id === 'town') {
      atmo.ambientColor = [0.99, 0.97, 0.95];
    } else if (biome.id === 'battle') {
      atmo.ambientColor = [0.99, 0.96, 0.95];
    } else {
      atmo.ambientColor = [0.95, 0.98, 0.96];
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
        const flicker = Math.sin(state.elapsedTime * 10 + i * 2.1) * 0.012;
        atmo.setLight(
          i,
          {
            x: torch.x / ARENA_W,
            y: (torch.y + 20) / ARENA_H,
            radius: 0.34 + flicker,
            r: 1.0,
            g: 0.68,
            b: 0.32,
          },
          0.38,
        );
      }
    }

    // Light 4: Soft hero lantern
    if (state.phase === 'start' || sliding) {
      atmo.setLight(4, null);
    } else {
      const px = this.heroTransitionPos ? this.heroTransitionPos.x : state.player.x;
      const py = this.heroTransitionPos ? this.heroTransitionPos.y : state.player.y;
      const wid = state.player.weaponId;
      const lightRgb: [number, number, number] =
        wid === 'arcane_lance'
          ? [0.62, 0.86, 0.97]
          : wid === 'scatter_staff'
            ? [0.68, 0.48, 0.84]
            : [0.92, 0.84, 0.72];
      atmo.setLight(
        4,
        {
          x: px / ARENA_W,
          y: py / ARENA_H,
          radius: 0.24,
          r: lightRgb[0],
          g: lightRgb[1],
          b: lightRgb[2],
        },
        0.26,
      );
    }

    // Light 5: Restrained boss hearth aura, portal beacon, or healing fountain shimmer
    const portal = state.portals[0];
    if (boss && !sliding) {
      atmo.setLight(
        5,
        {
          x: boss.x / ARENA_W,
          y: (boss.y - boss.leapZ * 0.4) / ARENA_H,
          radius: 0.26 + Math.sin(state.elapsedTime * 5) * 0.015,
          r: 0.88,
          g: 0.34,
          b: 0.26,
        },
        0.34,
      );
    } else if (portal && !sliding) {
      atmo.setLight(
        5,
        {
          x: portal.x / ARENA_W,
          y: portal.y / ARENA_H,
          radius: 0.22 + Math.sin(state.elapsedTime * 4) * 0.012,
          r: 0.9,
          g: 0.7,
          b: 0.24,
        },
        0.34,
      );
    } else if (state.fountain && !state.fountain.used && !sliding) {
      atmo.setLight(
        5,
        {
          x: state.fountain.x / ARENA_W,
          y: state.fountain.y / ARENA_H,
          radius: 0.2,
          r: 0.36,
          g: 0.78,
          b: 0.46,
        },
        0.28,
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
