import { COSMETICS, isCosmeticId } from '../../shared/shop.ts';
import type { CosmeticId } from '../../shared/types.ts';

/**
 * Draws the hero (with costume tint + accessory) onto a small canvas for the shop.
 * Accessory shapes mirror DungeonScene's in-game drawings, using the same offsets
 * relative to the hero's centre (the in-game hero is drawn at 2.75x).
 */

const ATLAS_URL = './assets/dungeon/dungeon_atlas.png';
const IDLE_FRAMES = [362, 384, 406, 428].map((x) => ({ x, y: 74, w: 20, h: 20 }));
const GAME_SCALE = 2.75;

let atlasPromise: Promise<HTMLImageElement> | null = null;

function loadAtlas(): Promise<HTMLImageElement> {
  if (!atlasPromise) {
    atlasPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('atlas failed to load'));
      img.src = ATLAS_URL;
    });
  }
  return atlasPromise;
}

export type HeroLook = { costume: CosmeticId; accessory: CosmeticId };

function costumeTint(id: CosmeticId): string | null {
  if (!isCosmeticId(id)) return null;
  const def = COSMETICS[id];
  if (def.slot !== 'costume' || def.tint === undefined) return null;
  return `#${def.tint.toString(16).padStart(6, '0')}`;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  frameIdx: number,
  look: HeroLook,
  t: number,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  const scale = Math.floor(Math.min(width, height) / 20 / 1.35);
  const k = scale / GAME_SCALE; // converts in-game offsets to preview pixels
  const cx = width / 2;
  const cy = height / 2 + 6 * k;
  const n = IDLE_FRAMES.length;
  const f = IDLE_FRAMES[((Math.floor(frameIdx) % n) + n) % n]!;
  const dw = f.w * scale;
  const dh = f.h * scale;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + dh * 0.42, dw * 0.32, dh * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  if (look.accessory === 'neon_trail') {
    for (let i = 3; i >= 1; i -= 1) {
      ctx.globalAlpha = 0.12 * (4 - i);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(cx - dw / 2 - i * 9 * k, cy - dh / 2 + 6 * k, dw * 0.8, dh * 0.8);
    }
    ctx.globalAlpha = 1;
  }

  // Hero sprite, tinted on an offscreen canvas so transparency is preserved.
  const off = document.createElement('canvas');
  off.width = f.w;
  off.height = f.h;
  const octx = off.getContext('2d');
  if (octx) {
    octx.imageSmoothingEnabled = false;
    octx.drawImage(atlas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    const tint = costumeTint(look.costume);
    if (tint) {
      octx.globalCompositeOperation = 'multiply';
      octx.fillStyle = tint;
      octx.fillRect(0, 0, f.w, f.h);
      octx.globalCompositeOperation = 'destination-in';
      octx.drawImage(atlas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      octx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(off, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  const X = (dx: number): number => cx + dx * k;
  const Y = (dy: number): number => cy + dy * k;
  const line = (w: number): number => Math.max(1, w * k);

  switch (look.accessory) {
    case 'flame_halo': {
      ctx.fillStyle = '#fb923c';
      for (let i = 0; i < 4; i += 1) {
        const ang = t * 3.8 + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.arc(X(Math.cos(ang) * 23), Y(Math.sin(ang) * 23), 3.2 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'crown_crest': {
      const pts: Array<[number, number]> = [
        [-8, -22], [-9, -30], [-3, -26], [0, -32], [3, -26], [9, -30], [8, -22],
      ];
      ctx.beginPath();
      pts.forEach(([dx, dy], i) => (i === 0 ? ctx.moveTo(X(dx), Y(dy)) : ctx.lineTo(X(dx), Y(dy))));
      ctx.closePath();
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.lineWidth = line(1.5);
      ctx.strokeStyle = '#090d14';
      ctx.stroke();
      break;
    }
    case 'angel_halo': {
      const bob = Math.sin(t * 3) * 1.5;
      ctx.lineWidth = line(3);
      ctx.strokeStyle = '#fef08a';
      ctx.beginPath();
      ctx.ellipse(X(0), Y(-30 + bob), 11 * k, 3.5 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'bunny_ears': {
      const wob = Math.sin(t * 4) * 1.5;
      const ear = (dx: number, w: number): void => {
        ctx.fillStyle = '#120d14';
        ctx.fillRect(X(dx - 1), Y(-38 + w), 7 * k, 18 * k);
        ctx.fillStyle = '#fdf2f8';
        ctx.fillRect(X(dx), Y(-37 + w), 5 * k, 16 * k);
        ctx.fillStyle = '#f9a8d4';
        ctx.fillRect(X(dx + 1), Y(-34 + w), 3 * k, 10 * k);
      };
      ear(-8, wob);
      ear(3, -wob);
      break;
    }
    case 'snoo_antenna': {
      const bob = Math.sin(t * 5) * 2;
      ctx.lineWidth = line(2);
      ctx.strokeStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(X(0), Y(-20));
      ctx.lineTo(X(8), Y(-30 + bob));
      ctx.stroke();
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(X(8), Y(-30 + bob), 4 * k, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      break;
  }
}

/** Render a static frame (used for the many small cards in the gacha reel). */
export function drawHeroStill(canvas: HTMLCanvasElement, look: HeroLook): void {
  void loadAtlas().then((atlas) => {
    const ctx = canvas.getContext('2d');
    if (ctx) drawFrame(ctx, atlas, 0, look, 0.4);
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
  void loadAtlas().then((atlas) => {
    if (!ctx) return;
    const tick = (now: number): void => {
      if (!canvas.isConnected && now - startedAt > 500) return;
      // rAF timestamps can be slightly earlier than performance.now() at start.
      const t = Math.max(0, (now - startedAt) / 1000);
      drawFrame(ctx, atlas, Math.floor(t * 5), look, t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return (next) => {
    look = next;
  };
}
