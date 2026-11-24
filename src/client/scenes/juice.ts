import type * as Phaser from 'phaser';
import type { EnemyEntity } from '../../shared/game/enemies.ts';
import type { EnemyArchetype, WeaponId } from '../../shared/types.ts';

/**
 * Client-only "game feel" effects: colourful particles, monster poses for wind-ups,
 * attacks and hit reactions, and weapon colour palettes. Purely visual — nothing here
 * touches the simulation, so daily seeds and the leaderboard are unaffected.
 */

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/** Signature colour per monster: used for its glow, wind-up charge and attack trails. */
export const ENEMY_COLORS: Record<EnemyArchetype, { main: number; hot: number }> = {
  chaser: { main: 0x4ade80, hot: 0xbef264 },
  shooter: { main: 0xa855f7, hot: 0xf0abfc },
  charger: { main: 0xf97316, hot: 0xfde047 },
  elite_charger: { main: 0xfacc15, hot: 0xfff7ae },
  boss: { main: 0xef4444, hot: 0xfb923c },
  shade: { main: 0xd946ef, hot: 0xf5d0fe },
  yeti: { main: 0x38bdf8, hot: 0xe0f2fe },
  bomber: { main: 0xfb923c, hot: 0xfef08a },
  mortar_tank: { main: 0x84cc16, hot: 0xd9f99d },
  stampede: { main: 0xf472b6, hot: 0xfbcfe8 },
};

export type WeaponPalette = { main: number; glow: number; sparks: number[] };

export const WEAPON_PALETTES: Record<WeaponId, WeaponPalette> = {
  longsword: { main: 0x38bdf8, glow: 0x6366f1, sparks: [0x7dd3fc, 0xa5b4fc, 0xffffff, 0x22d3ee] },
  dagger: { main: 0x34d399, glow: 0x14b8a6, sparks: [0x6ee7b7, 0xa7f3d0, 0xffffff, 0x2dd4bf] },
  hammer: { main: 0xfb923c, glow: 0xef4444, sparks: [0xfdba74, 0xfde047, 0xffffff, 0xf87171] },
  scatter_staff: { main: 0xd946ef, glow: 0x8b5cf6, sparks: [0xf0abfc, 0xc4b5fd, 0xffffff, 0xe879f9] },
  arcane_lance: { main: 0x22d3ee, glow: 0x3b82f6, sparks: [0x67e8f9, 0x93c5fd, 0xffffff, 0x38bdf8] },
};

/** Gold override when blade relics recolour the slash (matches the sim's '#fbbf24'). */
export const GOLD_PALETTE: WeaponPalette = {
  main: 0xfbbf24,
  glow: 0xf97316,
  sparks: [0xfde047, 0xfef3c7, 0xffffff, 0xfb923c],
};

export function rgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  maxTtl: number;
  size: number;
  color: number;
  drag: number;
  gravity: number;
  /** 'dot' = square pixel, 'spark' = streak along velocity, 'ring' = expanding circle */
  shape: 'dot' | 'spark' | 'ring';
};

const MAX_PARTICLES = 600;

export class FxParticles {
  private items: Particle[] = [];

  public get count(): number {
    return this.items.length;
  }

  public clear(): void {
    this.items = [];
  }

  public add(p: Partial<Particle> & { x: number; y: number; color: number }): void {
    if (this.items.length >= MAX_PARTICLES) this.items.shift();
    const ttl = p.ttl ?? 0.35;
    this.items.push({
      vx: 0,
      vy: 0,
      size: 3,
      drag: 4,
      gravity: 0,
      shape: 'dot',
      ...p,
      ttl,
      maxTtl: p.maxTtl ?? ttl,
    });
  }

  /** Radial burst of coloured pixels/streaks. */
  public burst(
    x: number,
    y: number,
    colors: number[],
    count: number,
    speed: number,
    opts: { shape?: Particle['shape']; size?: number; ttl?: number; gravity?: number; spread?: number; angle?: number } = {},
  ): void {
    for (let i = 0; i < count; i += 1) {
      const base = opts.angle ?? Math.random() * Math.PI * 2;
      const ang = opts.angle !== undefined ? base + (Math.random() - 0.5) * (opts.spread ?? Math.PI) : base;
      const spd = speed * (0.45 + Math.random() * 0.75);
      this.add({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        color: colors[i % colors.length] ?? 0xffffff,
        size: (opts.size ?? 3) * (0.7 + Math.random() * 0.6),
        ttl: (opts.ttl ?? 0.35) * (0.7 + Math.random() * 0.6),
        shape: opts.shape ?? 'dot',
        gravity: opts.gravity ?? 0,
        drag: 5,
      });
    }
  }

  public update(dt: number): void {
    if (dt <= 0) return;
    const kept: Particle[] = [];
    for (const p of this.items) {
      p.ttl -= dt;
      if (p.ttl <= 0) continue;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      kept.push(p);
    }
    this.items = kept;
  }

  public draw(g: Phaser.GameObjects.Graphics): void {
    for (const p of this.items) {
      const life = p.ttl / p.maxTtl;
      const alpha = Math.min(1, life * 1.6);
      if (p.shape === 'ring') {
        const r = p.size * (1 + (1 - life) * 4);
        g.lineStyle(Math.max(1.5, 4 * life), p.color, alpha);
        g.strokeCircle(p.x, p.y, r);
      } else if (p.shape === 'spark') {
        const len = Math.max(4, Math.hypot(p.vx, p.vy) * 0.045) * (0.5 + life);
        const a = Math.atan2(p.vy, p.vx);
        g.lineStyle(Math.max(1.5, p.size * life), p.color, alpha);
        g.lineBetween(p.x, p.y, p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
      } else {
        const s = Math.max(1, p.size * (0.4 + life * 0.6));
        g.fillStyle(p.color, alpha);
        g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Monster poses
// ---------------------------------------------------------------------------

export type EnemyPose = {
  /** Multipliers applied on top of the sprite's base scale. */
  sx: number;
  sy: number;
  rot: number;
  ox: number;
  oy: number;
  /** 0..1 charge glow (wind-up), drawn as a coloured aura ring. */
  charge: number;
};

export type EnemyFxState = {
  lastState: string;
  lastAttackKind: string;
  stateStartedAt: number;
  prevHp: number;
  hitT: number;
  hitDirX: number;
  hitDirY: number;
  trailCd: number;
};

export const HIT_REACT_TIME = 0.26;

const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/**
 * Pose for this frame. `inState` = seconds since the monster entered its current
 * AI state (tracked client-side), `time` = global elapsed time.
 */
export function computeEnemyPose(
  enemy: EnemyEntity,
  fx: EnemyFxState,
  inState: number,
  time: number,
): EnemyPose {
  const pose: EnemyPose = { sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, charge: 0 };
  const aimX = Math.cos(enemy.aimAngle);
  const aimY = Math.sin(enemy.aimAngle);
  const squishy = enemy.archetype === 'chaser' || enemy.archetype === 'shade' ? 1.6 : 1;

  switch (enemy.state) {
    case 'spawning': {
      const t = easeOut(inState / 0.5);
      pose.sx = 0.4 + 0.6 * t + Math.sin(t * Math.PI) * 0.2;
      pose.sy = 0.4 + 0.6 * t + Math.sin(t * Math.PI) * 0.25;
      break;
    }
    case 'chase': {
      // Bouncy walk cycle.
      const bob = Math.sin(time * 12 + enemy.id * 1.7);
      pose.sy = 1 + bob * 0.05 * squishy;
      pose.sx = 1 - bob * 0.04 * squishy;
      pose.oy = -Math.abs(bob) * 2 * squishy;
      break;
    }
    case 'telegraph': {
      // Wind-up: crouch, lean away from the target, charge up colour, shiver near the end.
      const dur = Math.max(0.2, enemy.telegraphDuration || 0.5);
      const p = Math.min(1, inState / dur);
      const e = easeOut(p);
      pose.sx = 1 + 0.16 * e * squishy;
      pose.sy = 1 - 0.2 * e * squishy;
      pose.ox = -aimX * 5 * e + (p > 0.6 ? Math.sin(time * 70 + enemy.id) * 1.6 * p : 0);
      pose.oy = -aimY * 3 * e;
      pose.charge = e;
      // (Boss leap crouch is drawn by the scene from the real leap state.)
      if (enemy.attackKind === 'boss_radial') {
        pose.sx += 0.08 * Math.sin(time * 30) * e;
        pose.sy += 0.08 * Math.sin(time * 30) * e;
      }
      break;
    }
    case 'attack': {
      const kind = fx.lastAttackKind !== 'none' ? fx.lastAttackKind : enemy.attackKind;
      if (kind === 'lunge' || kind === 'charge' || kind === 'ricochet_charge') {
        // Stretch along the dash and lean into it.
        const stretch = 0.22 * squishy;
        pose.sx = 1 + stretch * Math.abs(aimX) - 0.08 * Math.abs(aimY);
        pose.sy = 1 + stretch * Math.abs(aimY) - 0.1 * Math.abs(aimX);
        pose.rot = aimX * 0.22 * (kind === 'ricochet_charge' ? Math.sin(time * 25) : 1);
      } else if (kind === 'boss_leap') {
        // The real leap arc/height comes from the simulation (leapZ); just stretch a bit mid-air.
        pose.sx = 0.94;
        pose.sy = 1.08;
      } else if (kind === 'boss_radial') {
        const t = Math.min(1, inState / 0.3);
        const swell = Math.sin(t * Math.PI);
        pose.sx = 1 + 0.25 * swell;
        pose.sy = 1 + 0.25 * swell;
      } else if (kind === 'drop_bomb') {
        const t = Math.min(1, inState / 0.35);
        pose.oy = -Math.sin(t * Math.PI) * 16;
        pose.sy = 1 + 0.12 * Math.sin(t * Math.PI);
      } else if (kind === 'shade_fan') {
        pose.rot = Math.sin(time * 20) * 0.35;
        pose.sx = 1.1;
        pose.sy = 1.1;
      } else {
        // Shooting/casting: recoil away from the shot, quick squash.
        const t = Math.min(1, inState / 0.22);
        const kick = 1 - t;
        pose.ox = -aimX * 7 * kick;
        pose.oy = -aimY * 7 * kick;
        pose.sx = 1 + 0.14 * kick;
        pose.sy = 1 - 0.12 * kick;
      }
      break;
    }
    case 'recover': {
      // Off-balance wobble that settles.
      const decay = Math.max(0, 1 - inState / 0.6);
      pose.rot = Math.sin(time * 18 + enemy.id) * 0.14 * decay;
      pose.sy = 1 - 0.06 * decay;
      break;
    }
    case 'staggered': {
      // Dizzy sway.
      pose.rot = Math.sin(time * 9 + enemy.id) * 0.18;
      pose.sx = 1 + Math.sin(time * 14) * 0.04;
      break;
    }
    default:
      break;
  }

  // Hit reaction: squash + shove away from the hit, springing back.
  if (fx.hitT > 0) {
    const k = fx.hitT / HIT_REACT_TIME;
    const spring = Math.sin((1 - k) * Math.PI * 2.5) * k;
    pose.sx *= 1 + 0.3 * k;
    pose.sy *= 1 - 0.24 * k + 0.06 * spring;
    pose.ox += fx.hitDirX * 7 * k;
    pose.oy += fx.hitDirY * 7 * k;
    pose.rot += fx.hitDirX * 0.18 * k;
  }
  return pose;
}

/** Draws a 4-point twinkle star. */
export function drawStar(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
  g.fillStyle(color, alpha);
  g.fillRect(x - r, y - 1, r * 2, 2);
  g.fillRect(x - 1, y - r, 2, r * 2);
  g.fillRect(x - r * 0.45, y - r * 0.45, r * 0.9, r * 0.9);
}
