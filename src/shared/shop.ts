import type {
  AccessoryId,
  CosmeticId,
  CosmeticRarity,
  CosmeticSlot,
  CostumeId,
  PlayerProfile,
  WeaponId,
} from './types.ts';
import { WEAPONS, isWeaponId } from './weapons.ts';

export type ShopResult = { ok: boolean; profile: PlayerProfile; reason?: string | undefined };

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

/** Gems spent per gacha pull. */
export const GACHA_PULL_COST = 3;

/** Coins refunded when a gacha pull lands on a cosmetic you already own. */
export const GACHA_DUPLICATE_COINS = 40;

// ---------------------------------------------------------------------------
// Cosmetics (gacha-only)
// ---------------------------------------------------------------------------

export type CosmeticDef =
  | {
      id: AccessoryId;
      title: string;
      description: string;
      slot: 'accessory';
      rarity: CosmeticRarity;
    }
  | {
      id: CostumeId;
      title: string;
      description: string;
      slot: 'costume';
      rarity: CosmeticRarity;
    };

export const COSMETICS: Record<AccessoryId | CostumeId, CosmeticDef> = {
  // Outfits (distinct 12-frame pixel characters)
  costume_crimson: {
    id: 'costume_crimson',
    title: 'Crimson Berserker',
    description: 'Scarlet war bandana, sash, and battle boots.',
    slot: 'costume',
    rarity: 'common',
  },
  costume_forest: {
    id: 'costume_forest',
    title: 'Forest Ranger',
    description: 'Emerald cloak, quiver strap, and woodland beard.',
    slot: 'costume',
    rarity: 'common',
  },
  costume_viking: {
    id: 'costume_viking',
    title: 'Frost Viking',
    description: 'Horned iron helm and wolf-fur Nordic mantle.',
    slot: 'costume',
    rarity: 'common',
  },
  costume_royal: {
    id: 'costume_royal',
    title: 'Royal Archmage',
    description: 'Violet arcane robes trimmed in filigree gold.',
    slot: 'costume',
    rarity: 'rare',
  },
  costume_shadow: {
    id: 'costume_shadow',
    title: 'Shadow Shinobi',
    description: 'Midnight cowl, crimson scarf, and glowing eyes.',
    slot: 'costume',
    rarity: 'rare',
  },
  costume_yeti: {
    id: 'costume_yeti',
    title: 'Snow Yeti',
    description: 'Shaggy glacier beast from the frozen peaks.',
    slot: 'costume',
    rarity: 'rare',
  },
  costume_gold: {
    id: 'costume_gold',
    title: 'Gilded Paladin',
    description: 'Gleaming 24k plate armor and royal crimson cape.',
    slot: 'costume',
    rarity: 'epic',
  },
  costume_skeleton: {
    id: 'costume_skeleton',
    title: 'Bone Knight',
    description: 'Grinning ivory skull, iron ribs, and crypt cloak.',
    slot: 'costume',
    rarity: 'epic',
  },
  costume_phantom: {
    id: 'costume_phantom',
    title: 'Spectral Wraith',
    description: 'Luminous dungeon spirit trailing cold mist.',
    slot: 'costume',
    rarity: 'epic',
  },

  // Hats & headgear (animated 1:1 pixel overlays)
  bunny_ears: {
    id: 'bunny_ears',
    title: 'Bunny Ears',
    description: 'Tall floppy ears stitched from lucky felt.',
    slot: 'accessory',
    rarity: 'common',
  },
  snoo_antenna: {
    id: 'snoo_antenna',
    title: 'Snoo Antenna',
    description: 'Springy pixel antenna with glowing orange beacon.',
    slot: 'accessory',
    rarity: 'common',
  },
  cat_ears: {
    id: 'cat_ears',
    title: 'Shadow Cat Ears',
    description: 'Perky midnight kitty ears with pink lining.',
    slot: 'accessory',
    rarity: 'common',
  },
  frog_hat: {
    id: 'frog_hat',
    title: 'Frog Hood',
    description: 'Lucky lime frog cap with blinking bug eyes.',
    slot: 'accessory',
    rarity: 'common',
  },
  angel_halo: {
    id: 'angel_halo',
    title: 'Angel Halo',
    description: 'Floating ring of forged sanctum gold.',
    slot: 'accessory',
    rarity: 'rare',
  },
  neon_trail: {
    id: 'neon_trail',
    title: 'Cyber Visor',
    description: 'Neon cyan shades that cast pixel afterimages.',
    slot: 'accessory',
    rarity: 'rare',
  },
  devil_horns: {
    id: 'devil_horns',
    title: 'Demon Horns',
    description: 'Curved scarlet horns forged in deep embers.',
    slot: 'accessory',
    rarity: 'rare',
  },
  crown_crest: {
    id: 'crown_crest',
    title: 'Royal Crown',
    description: 'Bejeweled 3-peak monarch crown.',
    slot: 'accessory',
    rarity: 'epic',
  },
  flame_halo: {
    id: 'flame_halo',
    title: 'Ember Orbit',
    description: 'Three crackling pixel fire wisps.',
    slot: 'accessory',
    rarity: 'epic',
  },
  wizard_hat: {
    id: 'wizard_hat',
    title: 'Arcane Hat',
    description: 'Starlit indigo mage hat with gold buckle.',
    slot: 'accessory',
    rarity: 'epic',
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
