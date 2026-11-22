import type { WeaponId } from './types.ts';

export type WeaponProjectileSpec = {
  count: number;
  spreadDeg: number;
  speed: number;
  ttl: number;
  radius: number;
  pierce: boolean;
};

export type WeaponDef = {
  id: WeaponId;
  name: string;
  emoji: string;
  /** One-line playstyle pitch shown in the shop. */
  tagline: string;
  pros: string;
  cons: string;
  cost: number;
  /** Atlas frame used for the held weapon sprite. */
  sprite: string;
  style: 'melee' | 'ranged';
  /** Damage per hit (per projectile for ranged weapons). */
  damage: number;
  cooldown: number;
  animDuration: number;
  endlag: number;
  /** Melee reach, or the radius used for close-range relic effects on ranged weapons. */
  range: number;
  arcDeg: number;
  /** Movement speed multiplier while the attack animation plays. */
  attackMoveMult: number;
  knockback: number;
  staggerSec: number;
  /** Whether hits chip enemy armour (melee) or bounce off it (ranged). */
  stripsArmor: boolean;
  slashColor: string;
  projectile?: WeaponProjectileSpec | undefined;
};

/**
 * Weapons are sidegrades: each one trades reach, speed and burst against the others.
 * Melee weapons sit in a narrow DPS band (~70-85). Ranged weapons deal noticeably less
 * (they keep you out of danger) and never stun.
 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  longsword: {
    id: 'longsword',
    name: 'Longsword',
    emoji: '🗡️',
    tagline: 'Reliable all-rounder. Wide arc, solid reach.',
    pros: 'Wide cleave · breaks armour',
    cons: 'Nothing special',
    cost: 0,
    sprite: 'tile_106',
    style: 'melee',
    damage: 34,
    cooldown: 0.48,
    animDuration: 0.18,
    endlag: 0.22,
    range: 84,
    arcDeg: 85,
    attackMoveMult: 0.35,
    knockback: 360,
    staggerSec: 0.28,
    stripsArmor: true,
    slashColor: '#f8fafc',
  },
  dagger: {
    id: 'dagger',
    name: 'Twin Daggers',
    emoji: '🔪',
    tagline: 'Blinding speed up close. Stay in their face.',
    pros: 'Very fast · move freely while attacking',
    cons: 'Short reach · light knockback',
    cost: 250,
    sprite: 'tile_103',
    style: 'melee',
    damage: 16,
    cooldown: 0.19,
    animDuration: 0.1,
    endlag: 0.05,
    range: 58,
    arcDeg: 70,
    attackMoveMult: 0.9,
    knockback: 150,
    staggerSec: 0.12,
    stripsArmor: true,
    slashColor: '#a7f3d0',
  },
  hammer: {
    id: 'hammer',
    name: 'War Hammer',
    emoji: '🔨',
    tagline: 'Slow, huge swings that flatten whole crowds.',
    pros: 'Massive arc & knockback · long stagger',
    cons: 'Very slow · rooted while swinging',
    cost: 400,
    sprite: 'tile_117',
    style: 'melee',
    damage: 72,
    cooldown: 1.0,
    animDuration: 0.26,
    endlag: 0.42,
    range: 98,
    arcDeg: 150,
    attackMoveMult: 0.15,
    knockback: 620,
    staggerSec: 0.6,
    stripsArmor: true,
    slashColor: '#fcd34d',
  },
  scatter_staff: {
    id: 'scatter_staff',
    name: 'Scatter Staff',
    emoji: '🔮',
    tagline: 'Shotgun blast of bolts. Devastating point-blank.',
    pros: 'Hits several foes at once',
    cons: 'Short range · weak vs armour · no stun',
    cost: 400,
    sprite: 'tile_129',
    style: 'ranged',
    damage: 8,
    cooldown: 0.85,
    animDuration: 0.12,
    endlag: 0.2,
    range: 84,
    arcDeg: 40,
    attackMoveMult: 0.6,
    knockback: 110,
    staggerSec: 0,
    stripsArmor: false,
    slashColor: '#c084fc',
    projectile: { count: 5, spreadDeg: 38, speed: 470, ttl: 0.4, radius: 8, pierce: false },
  },
  arcane_lance: {
    id: 'arcane_lance',
    name: 'Arcane Lance',
    emoji: '🎯',
    tagline: 'Sniper bolt that pierces a whole line of enemies.',
    pros: 'Huge range · pierces a whole line',
    cons: 'Slow to fire · low damage · no stun',
    cost: 600,
    sprite: 'tile_130',
    style: 'ranged',
    damage: 50,
    cooldown: 1.4,
    animDuration: 0.16,
    endlag: 0.38,
    range: 84,
    arcDeg: 0,
    attackMoveMult: 0.3,
    knockback: 140,
    staggerSec: 0,
    stripsArmor: false,
    slashColor: '#38bdf8',
    projectile: { count: 1, spreadDeg: 0, speed: 820, ttl: 0.95, radius: 10, pierce: true },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export function isWeaponId(id: unknown): id is WeaponId {
  return typeof id === 'string' && id in WEAPONS;
}

export function getWeapon(id: WeaponId | undefined | null): WeaponDef {
  return id && isWeaponId(id) ? WEAPONS[id] : WEAPONS.longsword;
}
