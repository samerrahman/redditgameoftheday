import { RELICS, UNLOCKABLE_RELIC_IDS } from './relics.ts';
import type {
  AccessoryId,
  CosmeticId,
  CosmeticRarity,
  CosmeticSlot,
  CostumeId,
  PlayerProfile,
  RelicId,
  WeaponId,
} from './types.ts';
import { WEAPONS, isWeaponId } from './weapons.ts';

export type ShopResult = { ok: boolean; profile: PlayerProfile; reason?: string | undefined };

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

/** Coins it costs to unlock a relic into your in-run draft pool. */
export const RELIC_UNLOCK_COST = 150;

/** Gems spent per gacha pull. */
export const GACHA_PULL_COST = 3;

/** Coins refunded when a gacha pull lands on a cosmetic you already own. */
export const GACHA_DUPLICATE_COINS = 40;

// ---------------------------------------------------------------------------
// Cosmetics (gacha-only)
// ---------------------------------------------------------------------------

export type CosmeticDef = {
  id: AccessoryId | CostumeId;
  title: string;
  description: string;
  slot: CosmeticSlot;
  rarity: CosmeticRarity;
  /** Hex tint for costumes (applied to the hero sprite). */
  tint?: number | undefined;
};

export const COSMETICS: Record<AccessoryId | CostumeId, CosmeticDef> = {
  neon_trail: {
    id: 'neon_trail',
    title: 'Neon Slipstream',
    description: 'Cyan afterimage ribbon while moving.',
    slot: 'accessory',
    rarity: 'rare',
  },
  crown_crest: {
    id: 'crown_crest',
    title: 'Thread Crown',
    description: 'Golden 3-peak crown.',
    slot: 'accessory',
    rarity: 'epic',
  },
  snoo_antenna: {
    id: 'snoo_antenna',
    title: 'Antenna Beacon',
    description: 'Bobbing glowing antenna.',
    slot: 'accessory',
    rarity: 'common',
  },
  flame_halo: {
    id: 'flame_halo',
    title: 'Ember Halo',
    description: 'Orbiting sparks.',
    slot: 'accessory',
    rarity: 'epic',
  },
  angel_halo: {
    id: 'angel_halo',
    title: 'Angel Halo',
    description: 'A soft glowing ring overhead.',
    slot: 'accessory',
    rarity: 'rare',
  },
  bunny_ears: {
    id: 'bunny_ears',
    title: 'Bunny Ears',
    description: 'Floppy and fearsome.',
    slot: 'accessory',
    rarity: 'common',
  },
  costume_crimson: {
    id: 'costume_crimson',
    title: 'Crimson Garb',
    description: 'Blood-red adventurer outfit.',
    slot: 'costume',
    rarity: 'common',
    tint: 0xff8a8a,
  },
  costume_forest: {
    id: 'costume_forest',
    title: 'Forest Ranger',
    description: 'Mossy green leathers.',
    slot: 'costume',
    rarity: 'common',
    tint: 0x9ff5a8,
  },
  costume_royal: {
    id: 'costume_royal',
    title: 'Royal Violet',
    description: 'Regal purple robes.',
    slot: 'costume',
    rarity: 'rare',
    tint: 0xc9a2ff,
  },
  costume_shadow: {
    id: 'costume_shadow',
    title: 'Shadow Cloak',
    description: 'Darker than the dungeon.',
    slot: 'costume',
    rarity: 'rare',
    tint: 0x6b6b88,
  },
  costume_gold: {
    id: 'costume_gold',
    title: 'Gilded Champion',
    description: 'Solid gold. Very subtle.',
    slot: 'costume',
    rarity: 'epic',
    tint: 0xffd75e,
  },
};

export const COSMETIC_IDS = Object.keys(COSMETICS) as Array<AccessoryId | CostumeId>;

export const RARITY_WEIGHTS: Record<CosmeticRarity, number> = {
  common: 60,
  rare: 30,
  epic: 10,
};

export const RARITY_LABELS: Record<CosmeticRarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
};

export function isCosmeticId(id: unknown): id is AccessoryId | CostumeId {
  return typeof id === 'string' && id in COSMETICS;
}

export function getCosmeticSlot(id: CosmeticId): CosmeticSlot | null {
  return isCosmeticId(id) ? COSMETICS[id].slot : null;
}

function cloneProfile(profile: PlayerProfile): PlayerProfile {
  return {
    ...profile,
    ownedWeapons: [...profile.ownedWeapons],
    unlockedRelics: [...profile.unlockedRelics],
    ownedCosmetics: [...profile.ownedCosmetics],
    dailyBest: { ...profile.dailyBest },
  };
}

// ---------------------------------------------------------------------------
// Weapons (coins)
// ---------------------------------------------------------------------------

export function purchaseWeapon(profile: PlayerProfile, weaponId: WeaponId): ShopResult {
  if (!isWeaponId(weaponId)) return { ok: false, profile, reason: 'Unknown weapon.' };
  if (profile.ownedWeapons.includes(weaponId)) {
    return { ok: false, profile, reason: 'Already owned.' };
  }
  const def = WEAPONS[weaponId];
  if (profile.coins < def.cost) return { ok: false, profile, reason: 'Not enough coins.' };
  const next = cloneProfile(profile);
  next.coins -= def.cost;
  next.ownedWeapons.push(weaponId);
  next.equippedWeapon = weaponId;
  return { ok: true, profile: next };
}

export function equipWeapon(profile: PlayerProfile, weaponId: WeaponId): ShopResult {
  if (!isWeaponId(weaponId) || !profile.ownedWeapons.includes(weaponId)) {
    return { ok: false, profile, reason: 'You do not own that weapon.' };
  }
  return { ok: true, profile: { ...profile, equippedWeapon: weaponId } };
}

// ---------------------------------------------------------------------------
// Relic unlocks (coins)
// ---------------------------------------------------------------------------

export function getLockedRelics(profile: PlayerProfile): RelicId[] {
  return UNLOCKABLE_RELIC_IDS.filter((id) => !profile.unlockedRelics.includes(id));
}

export function unlockRelic(profile: PlayerProfile, relicId: RelicId): ShopResult {
  if (!(relicId in RELICS)) return { ok: false, profile, reason: 'Unknown relic.' };
  if (profile.unlockedRelics.includes(relicId)) {
    return { ok: false, profile, reason: 'Already unlocked.' };
  }
  if (profile.coins < RELIC_UNLOCK_COST) return { ok: false, profile, reason: 'Not enough coins.' };
  const next = cloneProfile(profile);
  next.coins -= RELIC_UNLOCK_COST;
  next.unlockedRelics.push(relicId);
  return { ok: true, profile: next };
}

// ---------------------------------------------------------------------------
// Gacha (gems) — purely cosmetic
// ---------------------------------------------------------------------------

export type GachaResult = {
  ok: boolean;
  profile: PlayerProfile;
  reason?: string | undefined;
  cosmeticId?: AccessoryId | CostumeId | undefined;
  duplicate?: boolean | undefined;
};

/** `rand` returns a float in [0, 1). Server and client each supply their own source. */
export function pullGacha(profile: PlayerProfile, rand: () => number): GachaResult {
  if (profile.gems < GACHA_PULL_COST) {
    return { ok: false, profile, reason: `Need ${GACHA_PULL_COST} gems.` };
  }

  const totalWeight = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rand() * totalWeight;
  let rarity: CosmeticRarity = 'common';
  for (const key of ['epic', 'rare', 'common'] as const) {
    roll -= RARITY_WEIGHTS[key];
    if (roll < 0) {
      rarity = key;
      break;
    }
  }

  const pool = COSMETIC_IDS.filter((id) => COSMETICS[id].rarity === rarity);
  const cosmeticId = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  if (!cosmeticId) return { ok: false, profile, reason: 'Gacha pool empty.' };

  const next = cloneProfile(profile);
  next.gems -= GACHA_PULL_COST;
  const duplicate = next.ownedCosmetics.includes(cosmeticId);
  if (duplicate) {
    next.coins += GACHA_DUPLICATE_COINS;
  } else {
    // New cosmetics are equipped straight away so the pull feels rewarding.
    next.ownedCosmetics.push(cosmeticId);
    if (COSMETICS[cosmeticId].slot === 'costume') next.equippedCostume = cosmeticId;
    else next.equippedCosmetic = cosmeticId;
  }
  return { ok: true, profile: next, cosmeticId, duplicate };
}

/** Equip an owned cosmetic, or pass 'none' with a slot to unequip that slot. */
export function equipCosmetic(
  profile: PlayerProfile,
  cosmeticId: CosmeticId,
  slotHint?: CosmeticSlot,
): ShopResult {
  if (cosmeticId === 'none') {
    if (slotHint === 'costume') return { ok: true, profile: { ...profile, equippedCostume: 'none' } };
    return { ok: true, profile: { ...profile, equippedCosmetic: 'none' } };
  }
  if (!isCosmeticId(cosmeticId) || !profile.ownedCosmetics.includes(cosmeticId)) {
    return { ok: false, profile, reason: 'You do not own that cosmetic.' };
  }
  const slot = COSMETICS[cosmeticId].slot;
  return {
    ok: true,
    profile:
      slot === 'costume'
        ? { ...profile, equippedCostume: cosmeticId }
        : { ...profile, equippedCosmetic: cosmeticId },
  };
}

// ---------------------------------------------------------------------------
// Single entry point shared by the local adapter and the Devvit server
// ---------------------------------------------------------------------------

export type ShopAction =
  | { action: 'buy_weapon'; weaponId: WeaponId }
  | { action: 'equip_weapon'; weaponId: WeaponId }
  | { action: 'unlock_relic'; relicId: RelicId }
  | { action: 'gacha_pull' }
  | { action: 'equip_cosmetic'; cosmeticId: CosmeticId; slot: CosmeticSlot }
  | { action: 'set_tutorial_dismissed'; dismissed: boolean };

export function applyShopAction(
  profile: PlayerProfile,
  req: ShopAction,
  rand: () => number,
): GachaResult {
  switch (req.action) {
    case 'buy_weapon':
      return purchaseWeapon(profile, req.weaponId);
    case 'equip_weapon':
      return equipWeapon(profile, req.weaponId);
    case 'unlock_relic':
      return unlockRelic(profile, req.relicId);
    case 'gacha_pull':
      return pullGacha(profile, rand);
    case 'equip_cosmetic':
      return equipCosmetic(profile, req.cosmeticId, req.slot);
    case 'set_tutorial_dismissed':
      return { ok: true, profile: { ...profile, tutorialDismissed: req.dismissed } };
    default:
      return { ok: false, profile, reason: 'Unknown shop action.' };
  }
}
