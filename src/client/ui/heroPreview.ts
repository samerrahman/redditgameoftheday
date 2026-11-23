import { COSMETICS, isCosmeticId } from '../../shared/shop.ts';
import type { AccessoryId, CosmeticId } from '../../shared/types.ts';

/**
 * Composites the hero, equipped pixel-art outfit, and animated pixel-art hat onto a
 * single native 24×28 buffer before scaling by an exact integer factor (zero mixels).
 */

const COSMETICS_IMG_URL = './assets/dungeon/cosmetics_atlas.png';
const COSMETICS_JSON_URL = './assets/dungeon/cosmetics_atlas.json';
const NATIVE_W = 24;
const NATIVE_H = 28;
const HERO_OX = 2;
const HERO_OY = 6;

type AtlasRect = { x: number; y: number; w: number; h: number };
type CosmeticsBundle = { img: HTMLImageElement; frames: Map<string, AtlasRect> };

let bundlePromise: Promise<CosmeticsBundle> | null = null;
let bufCanvas: HTMLCanvasElement | null = null;
let ghostCanvas: HTMLCanvasElement | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRect(entry: unknown): AtlasRect | null {
  if (!isRecord(entry) || !isRecord(entry.frame)) return null;
  const { x, y, w, h } = entry.frame;
  if (typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number') {
    return { x, y, w, h };
  }
  return null;
}

function parseFrames(data: unknown): Map<string, AtlasRect> {
  const frames = new Map<string, AtlasRect>();
  if (!isRecord(data) || !isRecord(data.frames)) return frames;
  for (const [key, entry] of Object.entries(data.frames)) {
    const rect = readRect(entry);
    if (rect) frames.set(key, rect);
  }
  return frames;
}

function loadCosmetics(): Promise<CosmeticsBundle> {
  if (!bundlePromise) {
    bundlePromise = Promise.all([
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('cosmetics atlas image failed to load'));
        img.src = COSMETICS_IMG_URL;
      }),
      fetch(COSMETICS_JSON_URL)
        .then((res) => {
          if (!res.ok) throw new Error('cosmetics atlas json failed to load');
          return res.json();
        })
        .then(parseFrames),
    ]).then(([img, frames]) => ({ img, frames }));
  }
  return bundlePromise;
}

function getScratch(
  existing: HTMLCanvasElement | null,
  w: number,
  h: number,
): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = existing ?? document.createElement('canvas');
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return [c, c.getContext('2d')];
}

export type HeroLook = { costume: CosmeticId; accessory: CosmeticId };

function heroPrefix(costume: CosmeticId): string {
  if (isCosmeticId(costume) && COSMETICS[costume].slot === 'costume') {
    return costume;
  }
  return 'default';
}

function accessoryIdOf(accessory: CosmeticId): AccessoryId | null {
  if (!isCosmeticId(accessory)) return null;
  const def = COSMETICS[accessory];
  return def.slot === 'accessory' ? def.id : null;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  bundle: CosmeticsBundle,
  look: HeroLook,
  t: number,
  animate: boolean,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  const [buf, bctx] = getScratch(bufCanvas, NATIVE_W, NATIVE_H);
  bufCanvas = buf;
  if (!bctx) return;

  bctx.clearRect(0, 0, NATIVE_W, NATIVE_H);
  bctx.imageSmoothingEnabled = false;

  // Pixel-grid ground shadow directly under boots (hero bottom sits at y=23 in 24x28 space).
  bctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  bctx.fillRect(8, 22, 8, 1);
  bctx.fillRect(7, 23, 10, 2);
  bctx.fillRect(8, 25, 8, 1);

  const idleIdx = animate ? Math.floor(t * 5) % 4 : 0;
  const hatIdx = animate ? Math.floor(t * 6) % 4 : 0;
  const prefix = heroPrefix(look.costume);
  const heroRect = bundle.frames.get(`${prefix}_idle_${idleIdx}`) ?? bundle.frames.get('default_idle_0');
  const accId = accessoryIdOf(look.accessory);

  if (heroRect) {
    if (accId === 'neon_trail') {
      const [gCanvas, gctx] = getScratch(ghostCanvas, heroRect.w, heroRect.h);
      ghostCanvas = gCanvas;
      if (gctx) {
        gctx.globalCompositeOperation = 'source-over';
        gctx.clearRect(0, 0, heroRect.w, heroRect.h);
        gctx.imageSmoothingEnabled = false;
        gctx.drawImage(
          bundle.img,
          heroRect.x,
          heroRect.y,
          heroRect.w,
          heroRect.h,
          0,
          0,
          heroRect.w,
          heroRect.h,
        );
        gctx.globalCompositeOperation = 'source-atop';
        gctx.fillStyle = '#22d3ee';
        gctx.fillRect(0, 0, heroRect.w, heroRect.h);
        gctx.globalCompositeOperation = 'source-over';

        bctx.globalAlpha = 0.24;
        bctx.drawImage(gCanvas, HERO_OX - 3, HERO_OY);
        bctx.globalAlpha = 0.44;
        bctx.drawImage(gCanvas, HERO_OX - 1, HERO_OY);
        bctx.globalAlpha = 1;
      }
    }

    bctx.drawImage(
      bundle.img,
      heroRect.x,
      heroRect.y,
      heroRect.w,
      heroRect.h,
      HERO_OX,
      HERO_OY,
      heroRect.w,
      heroRect.h,
    );
  }

  if (accId !== null) {
    const hatRect = bundle.frames.get(`hat_${accId}_${hatIdx}`) ?? bundle.frames.get(`hat_${accId}_0`);
    if (hatRect) {
      const breathBob = idleIdx === 1 ? 1 : 0;
      bctx.drawImage(
        bundle.img,
        hatRect.x,
        hatRect.y,
        hatRect.w,
        hatRect.h,
        0,
        breathBob,
        hatRect.w,
        hatRect.h,
      );
    }
  }

  const scale = Math.max(1, Math.floor(Math.min(width / NATIVE_W, height / NATIVE_H)));
  const drawW = NATIVE_W * scale;
  const drawH = NATIVE_H * scale;
  const ox = Math.floor((width - drawW) / 2);
  const oy = Math.floor((height - drawH) / 2);
  ctx.drawImage(buf, 0, 0, NATIVE_W, NATIVE_H, ox, oy, drawW, drawH);
}

/** Render a static frame (used for wardrobe thumbnails and gacha reel cards). */
export function drawHeroStill(canvas: HTMLCanvasElement, look: HeroLook): void {
  void loadCosmetics().then((bundle) => {
    const ctx = canvas.getContext('2d');
    if (ctx) drawFrame(ctx, bundle, look, 0, false);
  });
}

/**
 * Animate the hero on `canvas` until the canvas leaves the DOM. Returns a setter
 * to change the look without restarting the animation.
 */
export function animateHero(canvas: HTMLCanvasElement, initial: HeroLook): (look: HeroLook) => void {
  let look = initial;
  const ctx = canvas.getContext('2d');
  const startedAt = performance.now();
  void loadCosmetics().then((bundle) => {
    if (!ctx) return;
    const tick = (now: number): void => {
      if (!canvas.isConnected && now - startedAt > 500) return;
      const t = Math.max(0, (now - startedAt) / 1000);
      drawFrame(ctx, bundle, look, t, true);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return (next) => {
    look = next;
  };
}
