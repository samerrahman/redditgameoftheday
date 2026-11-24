// The dungeon atlas uses 16x16 cells in a 28-column grid (2px margin, 18px stride) plus named frames.
const ATLAS_URL = './assets/dungeon/dungeon_atlas.png';
const ATLAS_W = 512;
const ATLAS_H = 184;
const ATLAS_COLS = 28;
const CELL_PX = 16;

type AtlasPoint = {
  x: number;
  y: number;
};

const NAMED_FRAMES: Readonly<Record<string, AtlasPoint>> = {
  barrel_tnt: { x: 252, y: 162 },
};

function resolveFrameOrigin(frame: string): AtlasPoint {
  const named = NAMED_FRAMES[frame];
  if (named) return named;
  if (frame.startsWith('tile_')) {
    const idx = Number.parseInt(frame.slice(5), 10);
    if (Number.isFinite(idx) && idx >= 0) {
      return {
        x: 2 + (idx % ATLAS_COLS) * 18,
        y: 2 + Math.floor(idx / ATLAS_COLS) * 18,
      };
    }
  }
  return { x: 2, y: 2 };
}

/**
 * Create a crisp pixel-art sprite element backed by the dungeon sprite atlas.
 */
export function createAtlasIcon(frame: string, scale = 1, className = 'atlas-icon'): HTMLElement {
  const { x, y } = resolveFrameOrigin(frame);
  const el = document.createElement('span');
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  el.style.inlineSize = `${CELL_PX * scale}px`;
  el.style.blockSize = `${CELL_PX * scale}px`;
  el.style.backgroundImage = `url(${ATLAS_URL})`;
  el.style.backgroundSize = `${ATLAS_W * scale}px ${ATLAS_H * scale}px`;
  el.style.backgroundPosition = `-${x * scale}px -${y * scale}px`;
  return el;
}
