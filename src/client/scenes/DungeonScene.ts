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
import { oppositeDirection } from '../../shared/game/rooms.ts';
import type { GameSimulation, GameState } from '../../shared/game/simulation.ts';
import { createDailyStream, type SeededRng } from '../../shared/rng.ts';
import { BIOME_SHEETS, getFloorBiome, type FloorBiome } from '../config/biomes.ts';
import { COSMETIC_IDS, COSMETICS, isCosmeticId } from '../../shared/shop.ts';
import { getWeapon } from '../../shared/weapons.ts';
import type { AccessoryId, CosmeticId, DoorDirection, EnemyArchetype } from '../../shared/types.ts';
import { hexNum, RELIC_SPRITE_FRAMES, type DungeonTheme } from '../config/theme.ts';
import type { InputController } from '../game/input.ts';

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
  if (frameName === 'hero_dash_0') return 2;
  if (frameName === 'hero_dash_1') return 0;
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
  private readonly projectileSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly pedestalSprites = new Map<number, ManagedPedestal>();
  private readonly portalSprites = new Map<string, ManagedPortal>();

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

    this.heroSprite = this.add
      .sprite(ARENA_W / 2, ARENA_H - 90, 'dungeon', 'hero_idle_0')
      .setScale(2.75)
      .setDepth(12)
      .setVisible(false);
    this.heroSprite.play('hero_idle');

    this.hatSprite = this.add
      .sprite(ARENA_W / 2, ARENA_H - 90, 'cosmetics', 'hat_crown_crest_0')
      .setOrigin(12 / 24, 16 / 28)
      .setScale(2.75)
      .setDepth(13)
      .setVisible(false);

    this.weaponSprite = this.add
      .image(ARENA_W / 2, ARENA_H - 90, 'dungeon', 'tile_106')
      .setOrigin(0.5, 0.85)
      .setScale(2.2)
      .setDepth(14)
      .setVisible(false);

    this.fountainTop = this.add
      .sprite(0, 0, 'dungeon', 'fountain_0')
      .setScale(2.75)
      .setDepth(9)
      .setVisible(false);
    this.fountainBottom = this.add
      .image(0, 0, 'dungeon', 'tile_032')
      .setScale(2.75)
      .setDepth(8)
      .setVisible(false);

    this.chestSprite = this.add
      .image(ARENA_W / 2, ARENA_H / 2 - 20, 'dungeon', 'tile_091')
      .setScale(2.75)
      .setDepth(8)
      .setVisible(false);

    this.firePool = Array.from({ length: 40 }, () =>
      this.add.sprite(0, 0, 'dungeon', 'fire_0').setScale(2.4).setDepth(7).setVisible(false),
    );
    this.blastPool = Array.from({ length: 16 }, () =>
      this.add.image(0, 0, 'dungeon', 'barrel_tnt').setScale(2.0).setDepth(7).setVisible(false),
    );
    this.afterimagePool = Array.from({ length: 16 }, () =>
      this.add
        .image(0, 0, 'dungeon', 'hero_dash_0')
        .setScale(2.75)
        .setDepth(11)
        .setVisible(false),
    );
    this.boomPool = Array.from({ length: 16 }, () => {
      const s = this.add.sprite(0, 0, 'dungeon', 'boom_0').setScale(2.6).setDepth(15).setVisible(false);
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

    this.bridge.onAudioSync(sim.state);
    this.renderFrame(sim.state);
  }

  private registerAnimations(): void {
    const define = (
      key: string,
      frames: string[],
      frameRate: number,
      repeat = -1,
      atlasKey: 'dungeon' | 'cosmetics' = 'dungeon',
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

    define('coin_spin', ['coin_0', 'coin_1', 'coin_2', 'coin_3'], 10);
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
    const tileSize = 48;
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
          const cx = c * tileSize + tileSize / 2;
          const cy = r * tileSize + tileSize / 2;
          const pickAlt = rng.next() < 0.08 ? 'tile_042' : rng.pick(floorFrames);
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
        const cx = c * tileSize + tileSize / 2;
        const cy = r * tileSize + tileSize / 2;

        if (r === 0) {
          const wallFrame =
            c === 0
              ? 'tile_001'
              : c === cols - 1
                ? 'tile_003'
                : c === 4 || c === 11
                  ? 'tile_029'
                  : c % 4 === 2
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

    const botY = ARENA_H - 24;
    for (let c = 0; c < cols; c += 1) {
      const cx = c * tileSize + tileSize / 2;
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
        left = this.add.image(ARENA_W / 2 - 24, 24, 'dungeon', fLeft).setDisplaySize(48, 48);
        right = this.add.image(ARENA_W / 2 + 24, 24, 'dungeon', fRight).setDisplaySize(48, 48);
      } else if (dir === 'south') {
        left = this.add
          .image(ARENA_W / 2 - 24, botY, 'dungeon', fLeft)
          .setDisplaySize(48, 48)
          .setFlipY(true);
        right = this.add
          .image(ARENA_W / 2 + 24, botY, 'dungeon', fRight)
          .setDisplaySize(48, 48)
          .setFlipY(true);
      } else if (dir === 'east') {
        left = this.add
          .image(ARENA_W - 24, ARENA_H / 2 - 24, 'dungeon', fLeft)
          .setDisplaySize(48, 48)
          .setRotation(Math.PI / 2);
        right = this.add
          .image(ARENA_W - 24, ARENA_H / 2 + 24, 'dungeon', fRight)
          .setDisplaySize(48, 48)
          .setRotation(Math.PI / 2);
      } else {
        left = this.add
          .image(24, ARENA_H / 2 + 24, 'dungeon', fLeft)
          .setDisplaySize(48, 48)
          .setRotation(-Math.PI / 2);
        right = this.add
          .image(24, ARENA_H / 2 - 24, 'dungeon', fRight)
          .setDisplaySize(48, 48)
          .setRotation(-Math.PI / 2);
      }

      container.add([left, right]);
      this.doorSprites.set(dir, { left, right });
    }

    this.buildObstacleBlocks(container, biome, state);

    if (biome.decor.length > 0) {
      this.buildBiomeDecor(container, biome, rng, state, cols, rows, tileSize);
    }

    // 4 animated flickering wall torches (indoor biomes only)
    for (const tx of biome.torches ? [120, 264, 504, 648] : []) {
      const torch = this.add.sprite(tx, 24, 'dungeon', 'torch_0').setScale(2.75);
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

  /** Solid layout blocks: themed sprites outdoors, chunky stone blocks in the dungeon. */
  private buildObstacleBlocks(
    container: Phaser.GameObjects.Container,
    biome: FloorBiome,
    state: GameState,
  ): void {
    if (state.obstacles.length === 0) return;
    const g = this.add.graphics();
    container.add(g);
    state.obstacles.forEach((o, i) => {
      // Contact shadow so blocks sit on the floor.
      g.fillStyle(0x000000, 0.3);
      g.fillRect(o.x + 3, o.y + o.h - 6, o.w - 2, 8);
      if (biome.blocks) {
        const frame = biome.blocks.frames[(o.id + i) % biome.blocks.frames.length]!;
        container.add(
          this.add.image(o.x + o.w / 2, o.y + o.h / 2, biome.blocks.sheet, frame).setDisplaySize(o.w, o.h),
        );
        return;
      }
      g.fillStyle(0x120d14, 1);
      g.fillRect(o.x, o.y, o.w, o.h);
      g.fillStyle(0x5f5868, 1);
      g.fillRect(o.x + 2, o.y + 2, o.w - 4, o.h - 4);
      g.fillStyle(0x8c8498, 1);
      g.fillRect(o.x + 2, o.y + 2, o.w - 4, 12);
      g.fillStyle(0x47404f, 1);
      g.fillRect(o.x + 2, o.y + 26, o.w - 4, 2);
      g.fillRect(o.x + 2, o.y + 38, o.w - 4, 2);
      g.fillRect(o.x + 16, o.y + 14, 2, 12);
      g.fillRect(o.x + 32, o.y + 28, 2, 10);
      g.fillRect(o.x + 12, o.y + 40, 2, 6);
      g.fillStyle(0x3a3441, 1);
      g.fillRect(o.x + 2, o.y + o.h - 6, o.w - 4, 4);
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
      const shadow = this.add.ellipse(x, baseY + 18, 34, 10, 0x000000, 0.25);
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

  private renderFrame(state: GameState): void {
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
    this.syncExitDoor(fxG, state);
    this.syncHazards(teleG, shadowG, state);
    this.syncFountain(shadowG, state);
    this.syncChest(shadowG, state);
    this.syncPortals(fxG, state);
    this.syncPedestals(fxG, shadowG, state);
    this.syncBreakables(shadowG, state);
    this.syncCoins(shadowG, state);
    this.drawGems(fxG, shadowG, state);
    this.drawHearts(fxG, shadowG, state);
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
  }

  private processCombatEvents(state: GameState): void {
    const currentIds = new Set(state.enemies.map((e) => e.id));
    for (const [id, prev] of this.prevEnemies.entries()) {
      if (!currentIds.has(id)) {
        this.stampSplatter(prev.x, prev.y, prev.archetype);
        this.spawnBoom(prev.x, prev.y, prev.archetype === 'boss' ? 4.2 : 2.6);
      }
    }
    this.prevEnemies.clear();
    for (const e of state.enemies) {
      this.prevEnemies.set(e.id, { x: e.x, y: e.y, archetype: e.archetype });
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
        ? 0x25956a
        : archetype === 'shooter'
          ? 0x7e22ce
          : archetype === 'boss'
            ? 0x991b1b
            : 0x7c2d12;
    d.fillStyle(color, 0.34);
    d.fillCircle(x, y + 6, archetype === 'boss' ? 28 : 13);
    d.fillCircle(x + 9, y + 2, 5);
    d.fillCircle(x - 8, y + 10, 4);
  }

  private spawnBoom(x: number, y: number, scale = 2.6): void {
    const sprite = this.boomPool[this.boomCursor];
    this.boomCursor = (this.boomCursor + 1) % this.boomPool.length;
    if (!sprite) return;
    sprite.setPosition(x, y).setScale(scale).setVisible(true).play('boom_pop');
  }

  private drawTorchGlows(g: Phaser.GameObjects.Graphics, state: GameState): void {
    const color = this.bridge.theme.torchGlowColor;
    for (let i = 0; i < this.wallTorches.length; i += 1) {
      const torch = this.wallTorches[i];
      if (!torch) continue;
      const flicker = 0.14 + Math.sin(state.elapsedTime * 11 + i * 1.9) * 0.035;
      g.fillStyle(color, flicker);
      g.fillCircle(torch.x, torch.y + 24, 58);
      g.fillStyle(0xfef08a, flicker * 0.55);
      g.fillCircle(torch.x, torch.y + 18, 28);
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
      fxG.fillEllipse(posX, posY, horiz ? 88 : 38, horiz ? 38 : 88);

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
        teleG.lineStyle(1.5, 0x38bdf8, 0.34);
        teleG.strokeRect(haz.x - halfW, haz.y - halfH, haz.w, haz.h);

        const offset = ((state.elapsedTime * 90) % 44) * haz.dirX;
        teleG.lineStyle(2.5, hexNum(this.bridge.theme.hazardAccent), 0.72);
        for (let cx = haz.x - halfW + 30; cx <= haz.x + halfW - 30; cx += 44) {
          const px = cx + offset;
          if (px < haz.x - halfW + 14 || px > haz.x + halfW - 14) continue;
          const d = haz.dirX >= 0 ? 1 : -1;
          teleG.beginPath();
          teleG.moveTo(px - 7 * d, haz.y - 10);
          teleG.lineTo(px + 6 * d, haz.y);
          teleG.lineTo(px - 7 * d, haz.y + 10);
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
        shadowG.fillStyle(0x000000, 0.38);
        shadowG.fillEllipse(haz.x, haz.y + 14, 32, 12);
        spr
          .setPosition(haz.x, haz.y)
          .setFrame('barrel_tnt')
          .setScale(2.5)
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
    shadowG.fillStyle(0x000000, 0.42);
    shadowG.fillEllipse(f.x, f.y + 20, 48, 18);

    this.fountainTop.setPosition(f.x, f.y - 22).setVisible(true);
    this.fountainBottom.setPosition(f.x, f.y + 16).setVisible(true);

    if (active) {
      this.fountainTop.play('fountain_flow', true);
      this.fountainBottom.setFrame('tile_032');
    } else {
      this.fountainTop.stop();
      this.fountainTop.setFrame('tile_019');
      this.fountainBottom.setFrame('tile_031');
    }

    this.fountainLabel
      ?.setPosition(f.x, f.y - 50)
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
    shadowG.fillStyle(0x000000, 0.4);
    shadowG.fillEllipse(cx, cy + 16, 42, 14);
    this.chestSprite.setPosition(cx, cy).setVisible(true);
  }

  private syncPortals(fxG: Phaser.GameObjects.Graphics, state: GameState): void {
    const activeKeys = new Set<string>();

    for (const portal of state.portals) {
      const key = `${portal.kind}:${portal.x}:${portal.y}`;
      activeKeys.add(key);

      let entry = this.portalSprites.get(key);
      if (!entry) {
        const hatch = this.add.image(portal.x, portal.y, 'dungeon', 'tile_056').setScale(3.0).setDepth(7);
        entry = { hatch };
        this.portalSprites.set(key, entry);
      }
      entry.hatch.setPosition(portal.x, portal.y).setVisible(true);

      const primary = 0xfbbf24;
      const pulse = 1 + Math.sin(state.elapsedTime * 4.5) * 0.08;

      fxG.fillStyle(primary, 0.18);
      fxG.fillCircle(portal.x, portal.y, 40 * pulse);
      fxG.lineStyle(3, primary, 0.9);
      fxG.strokeCircle(portal.x, portal.y, 32);

      if (portal.progress > 0) {
        fxG.lineStyle(4, 0xfef08a, 1);
        fxG.beginPath();
        fxG.arc(
          portal.x,
          portal.y,
          38,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * portal.progress,
          false,
        );
        fxG.strokePath();
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
            .image(ped.x, ped.y + 8, 'dungeon', 'tile_065')
            .setScale(2.7)
            .setDepth(8);
          const item = this.add
            .image(ped.x, ped.y - 14, 'dungeon', itemFrame)
            .setScale(2.5)
            .setDepth(10);
          entry = { plinth, item };
          this.pedestalSprites.set(ped.id, entry);
        }

        const bob = Math.sin(state.elapsedTime * 4.2 + ped.id) * 4;
        entry.plinth.setPosition(ped.x, ped.y + 8).setVisible(true);
        entry.item
          .setFrame(itemFrame)
          .setPosition(ped.x, ped.y - 16 + bob)
          .setScale(ped.hovered ? 2.8 : 2.5)
          .setVisible(true);

        shadowG.fillStyle(0x000000, 0.42);
        shadowG.fillEllipse(ped.x, ped.y + 26, 40, 14);

        const lvLabel = ped.nextLevel > 1 ? ` ${ped.nextLevel}` : '';
        this.nextLabel(ped.x, ped.y + 48, `${ped.relic.name}${lvLabel}`, ped.hovered ? '#fde047' : '#fff7e8', 17);
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
        fxG.fillStyle(0x1d1520, 0.94);
        fxG.fillRect(boxX, boxY, boxW, boxH);
        fxG.lineStyle(2, 0xf5b82e, 1);
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
        spr = this.add.image(br.x, br.y, 'dungeon', frame).setScale(2.6).setDepth(9);
        this.breakableSprites.set(br.id, spr);
      }

      shadowG.fillStyle(0x000000, 0.36);
      shadowG.fillEllipse(br.x, br.y + 15, br.radius * 1.8, 12);

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
        spr = this.add.sprite(coin.x, coin.y, 'dungeon', 'coin_0').setScale(2.0).setDepth(9);
        spr.play('coin_spin');
        this.coinSprites.set(coin.id, spr);
      }

      const bob = Math.sin(state.elapsedTime * 8 + coin.id) * 2.5;
      shadowG.fillStyle(0x000000, 0.32);
      shadowG.fillEllipse(coin.x, coin.y + 9, 14, 6);
      spr.setPosition(coin.x, coin.y - 2 + bob);
    }

    for (const [id, spr] of this.coinSprites.entries()) {
      if (!activeIds.has(id)) {
        spr.destroy();
        this.coinSprites.delete(id);
      }
    }
  }

  private drawGems(
    fxG: Phaser.GameObjects.Graphics,
    shadowG: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    for (const gem of state.gems) {
      const bob = Math.sin(state.elapsedTime * 6 + gem.id) * 3;
      const x = gem.x;
      const y = gem.y - 4 + bob;
      shadowG.fillStyle(0x000000, 0.35);
      shadowG.fillEllipse(gem.x, gem.y + 10, 16, 6);
      const glow = 0.25 + 0.15 * Math.sin(state.elapsedTime * 8 + gem.id);
      fxG.fillStyle(0xe879f9, glow);
      fxG.fillCircle(x, y, 16);
      const pts = [
        { x, y: y - 11 },
        { x: x + 8, y: y - 2 },
        { x, y: y + 10 },
        { x: x - 8, y: y - 2 },
      ];
      fxG.fillStyle(0xd946ef, 1);
      this.tracePolygon(fxG, pts, true);
      fxG.fillPath();
      fxG.fillStyle(0xf5d0fe, 1);
      fxG.fillRect(x - 3, y - 6, 3, 4);
      fxG.lineStyle(2, 0x120d14, 1);
      this.tracePolygon(fxG, pts, true);
      fxG.strokePath();
    }
  }

  private drawHearts(
    fxG: Phaser.GameObjects.Graphics,
    shadowG: Phaser.GameObjects.Graphics,
    state: GameState,
  ): void {
    // 11x10 pixel heart, same shape as the HUD heart.
    const rows = ['01110001110', '11111011111', '11111111111', '11111111111', '01111111110', '00111111100', '00011111000', '00001110000', '00000100000'];
    for (const heart of state.hearts) {
      const bob = Math.sin(state.elapsedTime * 5 + heart.id) * 2.5;
      const px = 2;
      const ox = heart.x - (11 * px) / 2;
      const oy = heart.y - 12 + bob;
      shadowG.fillStyle(0x000000, 0.35);
      shadowG.fillEllipse(heart.x, heart.y + 10, 18, 6);
      fxG.fillStyle(0xf87171, 0.22 + 0.12 * Math.sin(state.elapsedTime * 6 + heart.id));
      fxG.fillCircle(heart.x, oy + 9, 15);
      fxG.fillStyle(0x120d14, 1);
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx += 1) {
          if (row[rx] !== '1') continue;
          fxG.fillRect(ox + rx * px - px, oy + ry * px - px, px * 3, px * 3);
        }
      });
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx += 1) {
          if (row[rx] !== '1') continue;
          const highlight = ry <= 1 && (rx === 1 || rx === 2);
          fxG.fillStyle(highlight ? 0xffd1d1 : 0xe23c3c, 1);
          fxG.fillRect(ox + rx * px, oy + ry * px, px, px);
        }
      });
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
      const stroke = blast.friendly ? 0xfb923c : 0xef4444;
      teleG.fillStyle(stroke, blast.friendly ? 0.15 : 0.22);
      teleG.fillCircle(blast.x, blast.y, blast.radius);
      teleG.lineStyle(2, stroke, 1);
      teleG.strokeCircle(blast.x, blast.y, Math.max(4, blast.radius * progress));

      if (blast.kind === 'decoy_mine') {
        spr.setPosition(blast.x, blast.y).setFrame('barrel_tnt').setAlpha(1).setVisible(true);
      } else if (blast.kind === 'phantom_echo') {
        spr.setPosition(blast.x, blast.y).setFrame('hero_dash_0').setAlpha(0.65).setVisible(true);
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
        const startFrame = this.getEnemyBaseFrame(enemy.archetype);
        spr = this.add.sprite(enemy.x, enemy.y, 'dungeon', startFrame).setDepth(10);
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

      shadowG.fillStyle(0x000000, 0.4);
      shadowG.fillEllipse(
        enemy.x,
        enemy.y + enemy.radius * 0.72,
        enemy.radius * 2.1 * popMult,
        enemy.radius * 0.78 * popMult,
      );

      spr
        .setPosition(enemy.x + jitterX, enemy.y)
        .setScale(scale)
        .setAlpha(alpha)
        .setFlipX(state.player.x < enemy.x);

      if (enemy.hitFlashTimer > 0) {
        spr.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      } else {
        spr.clearTint();
      }

      const animKey = this.pickEnemyAnim(enemy);
      spr.play(animKey, true);

      // Floating shield icon on Armored Warden while armor > 0
      if (enemy.archetype === 'elite_charger' && enemy.armor > 0) {
        let shield = this.wardenShields.get(enemy.id);
        if (!shield) {
          shield = this.add.image(enemy.x, enemy.y, 'dungeon', 'tile_102').setScale(2.0).setDepth(11);
          this.wardenShields.set(enemy.id, shield);
        }
        const side = state.player.x < enemy.x ? -1 : 1;
        shield.setPosition(enemy.x + side * 22, enemy.y + 4).setVisible(true);
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

  private getEnemyBaseFrame(archetype: EnemyArchetype): string {
    switch (archetype) {
      case 'chaser':
        return 'slime_idle_0';
      case 'shooter':
        return 'wizard_idle_0';
      case 'charger':
        return 'cyclops_idle_0';
      case 'elite_charger':
        return 'warden_idle_0';
      case 'boss':
        return 'boss_idle_0';
    }
  }

  private getEnemyScale(archetype: EnemyArchetype): number {
    switch (archetype) {
      case 'chaser':
        return 2.6;
      case 'shooter':
        return 2.7;
      case 'charger':
        return 3.0;
      case 'elite_charger':
        return 3.35;
      case 'boss':
        return 4.35;
    }
  }

  private pickEnemyAnim(enemy: EnemyEntity): string {
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

    shadowG.fillStyle(0x000000, 0.45);
    shadowG.fillEllipse(px, py + 16, 32, 12);

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
          .setScale(2.75, 2.75)
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
            .setScale(2.75, 2.75)
            .setAlpha(1)
            .setFlipX(facingLeft)
            .setTint(0xffffff)
            .setTintMode(Phaser.TintModes.FILL);
        }
        this.weaponSprite
          .setPosition(p.x + jitterX + fallDir * 18, p.y + 3)
          .setScale(2.2)
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
          .setScale(2.75, 2.75 - 0.37 * fallEase)
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
            .setScale(2.75, 2.75 - 0.37 * fallEase)
            .setAlpha(heroAlpha)
            .setFlipX(facingLeft)
            .setTint(0xb87474)
            .setTintMode(Phaser.TintModes.MULTIPLY);
        }

        const clatterX = p.x + fallDir * (18 + 6 * fallEase);
        const clatterY = p.y + 3 + 9 * fallEase - 14 * Math.sin(fallU * Math.PI);
        this.weaponSprite
          .setPosition(clatterX, clatterY)
          .setScale(2.2)
          .setRotation(fallDir * (0.25 + 1.2 * fallEase))
          .setAlpha(weaponAlpha)
          .setTint(0xb87474)
          .setTintMode(Phaser.TintModes.MULTIPLY);

        if (state.phase === 'dying' && dp > 0.4 && dp < 0.78) {
          const soulT = Math.min(1, (dp - 0.4) / 0.34);
          const soulAlpha = Math.sin(soulT * Math.PI) * 0.95;
          const soulX = p.x + Math.sin(soulT * Math.PI * 2.5) * 5;
          const soulY = p.y - 10 - soulT * 48;
          fxG.fillStyle(0x120d14, soulAlpha);
          fxG.fillRect(soulX - 7, soulY - 8, 14, 16);
          fxG.fillStyle(0xe0f2fe, soulAlpha);
          fxG.fillRect(soulX - 5, soulY - 6, 10, 12);
          fxG.fillStyle(0xffffff, soulAlpha);
          fxG.fillRect(soulX - 3, soulY - 3, 6, 6);
          fxG.fillStyle(0x120d14, soulAlpha);
          fxG.fillRect(soulX - 3, soulY - 2, 2, 2);
          fxG.fillRect(soulX + 1, soulY - 2, 2, 2);
          fxG.fillStyle(0xe0f2fe, soulAlpha * 0.85);
          fxG.fillRect(soulX - 5, soulY + 10, 3, 3);
          fxG.fillRect(soulX + 2, soulY + 14, 3, 3);
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
        .setScale(2.75, 2.75)
        .setAlpha(1)
        .setFlipX(facingLeft)
        .clearTint()
        .play(`${heroAsset.prefix}_run`, true);
      if (this.hatSprite && accId !== null) {
        const bob = heroFrameBobPx(this.heroSprite.frame?.name ?? '') * 2.75;
        this.hatSprite
          .setVisible(true)
          .setPosition(px, py + bob)
          .setRotation(0)
          .setScale(2.75, 2.75)
          .setAlpha(1)
          .setFlipX(facingLeft)
          .clearTint()
          .play(`hat_${accId}`, true);
      }
      this.weaponSprite
        .setPosition(px + Math.cos(walkAngle) * 18, py + Math.sin(walkAngle) * 18 + 3)
        .setScale(2.2)
        .setAlpha(1)
        .clearTint()
        .setFrame(getWeapon(p.weaponId).sprite)
        .setRotation(walkAngle + Math.PI / 2);
      return;
    }

    if (p.shields > 0) {
      fxG.lineStyle(2.5, 0x38bdf8, 0.72);
      fxG.strokeCircle(px, py, p.radius + 6);
    }

    const weaponDef = getWeapon(p.weaponId);
    const animDur = Math.max(0.01, weaponDef.animDuration);
    const swingT = p.attackAnimTimer > 0 ? 1 - p.attackAnimTimer / animDur : 1;
    const sign = p.swingCount % 2 === 1 ? 1 : -1;

    let drawPx = p.x;
    let drawPy = p.y;
    let scaleX = 2.75;
    let scaleY = 2.75;
    if (!this.prefersReducedMotion()) {
      if (p.attackAnimTimer > 0) {
        const punch = Math.sin(Math.min(1, swingT * 1.35) * Math.PI);
        drawPx += Math.cos(p.attackAngle) * 5 * punch;
        drawPy += Math.sin(p.attackAngle) * 5 * punch;
        scaleX = 2.75 + 0.25 * punch;
        scaleY = 2.75 - 0.2 * punch;
      } else if (p.attackEndlagTimer > 0) {
        drawPx += Math.cos(p.attackAngle) * 1.5;
        drawPy += Math.sin(p.attackAngle) * 1.5;
        scaleX = 2.82;
        scaleY = 2.68;
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
    let handDist = 18;
    let weaponScale = 2.2;
    if (p.attackAnimTimer > 0) {
      const whip = 1 - Math.pow(1 - Math.min(1, swingT / 0.55), 3);
      swingOffset = sign * (-0.92 + whip * 1.8);
      handDist = 18 + Math.sin(Math.min(1, swingT / 0.7) * Math.PI) * 11;
      weaponScale = 2.2 + Math.sin(Math.min(1, swingT / 0.65) * Math.PI) * 0.85;
    } else if (p.attackEndlagTimer > 0) {
      swingOffset = sign * 0.88;
      handDist = 21;
      weaponScale = 2.28;
    } else if (p.attackCooldown > 0) {
      const endlagDur = Math.min(
        p.attackMaxCooldown,
        weaponDef.endlag * state.modifier.attackCdMult,
      );
      const recoverSpan = Math.max(0.01, p.attackMaxCooldown - endlagDur);
      const recoverT = 1 - Math.min(1, p.attackCooldown / recoverSpan);
      const ease = recoverT * recoverT * (3 - 2 * recoverT);
      swingOffset = sign * 0.88 * (1 - ease);
      handDist = 21 - 3 * ease;
    }

    if (weaponDef.style === 'ranged') {
      // Staffs point at the target and kick back instead of swinging.
      swingOffset = 0;
      const recoil = p.attackAnimTimer > 0 ? Math.sin(swingT * Math.PI) : 0;
      handDist = 20 - 7 * recoil;
      weaponScale = 2.3;
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
        const len = 34;
        const tx = proj.x - Math.cos(proj.angle) * len;
        const ty = proj.y - Math.sin(proj.angle) * len;
        fxG.lineStyle(9, 0x38bdf8, 0.35);
        fxG.lineBetween(tx, ty, proj.x, proj.y);
        fxG.lineStyle(4, 0xe0f2fe, 1);
        fxG.lineBetween(tx, ty, proj.x, proj.y);
        fxG.fillStyle(0xffffff, 1);
        fxG.fillCircle(proj.x, proj.y, 5);
        continue;
      }
      if (proj.kind === 'bolt') {
        const tx = proj.x - Math.cos(proj.angle) * 12;
        const ty = proj.y - Math.sin(proj.angle) * 12;
        fxG.lineStyle(5, 0xc084fc, 0.55);
        fxG.lineBetween(tx, ty, proj.x, proj.y);
        fxG.fillStyle(0xf5d0fe, 1);
        fxG.fillCircle(proj.x, proj.y, proj.radius * 0.6);
        continue;
      }
      if (proj.kind === 'rift_wave') {
        fxG.lineStyle(7, 0x38bdf8, 1);
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
          .setScale(2.15)
          .setDepth(13);
        spr.play(anim);
        this.projectileSprites.set(proj.id, spr);
      }

      shadowG.fillStyle(0x000000, 0.34);
      shadowG.fillEllipse(proj.x, proj.y + 10, 14, 6);
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
