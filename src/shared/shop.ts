import { RELICS, UNLOCKABLE_RELIC_IDS } from './relics.ts';
import { createDailyStream } from './rng.ts';
import type {
  ConsumableId,
  CosmeticId,
  PlayerProfile,
  RelicId,
  ShopRotation,
  ShopSlot,
  UpgradeId,
} from './types.ts';

export type UpgradeDef = {
  id: UpgradeId;
  title: string;
  description: string;
  maxLevel: number;
  costs: readonly number[];
};

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  vitality: {
    id: 'vitality',
    title: 'Vitality Plating',
    description: '+10 Max HP per level at run start.',
    maxLevel: 5,
    costs: [40, 75, 120, 180, 260],
  },
  reroll: {
    id: 'reroll',
    title: 'Relic Reroll',
    description: '+1 Relic Pedestal reroll charge per run.',
    maxLevel: 3,
    costs: [55, 110, 190],
  },
  magnet: {
    id: 'magnet',
    title: 'Karma Magnet',
    description: '+15% coin magnet pull & +10% coin gain.',
    maxLevel: 5,
    costs: [35, 65, 105, 155, 220],
  },
  shield: {
    id: 'shield',
    title: 'Aegis Ward',
    description: '+1 hit-absorbing Shield Charge per run.',
    maxLevel: 3,
    costs: [65, 130, 220],
  },
};

export type ConsumableDef = {
  id: ConsumableId;
  title: string;
  description: string;
  cost: number;
};

export const CONSUMABLES: Record<ConsumableId, ConsumableDef> = {
  bonus_relic: {
    id: 'bonus_relic',
    title: 'Starter Relic Cache',
    description: 'Begin next run with 1 random unlocked relic.',
    cost: 60,
  },
  shield_tonic: {
    id: 'shield_tonic',
    title: 'Ironclad Tonic',
    description: 'Begin next run with +2 Shield Charges.',
    cost: 45,
  },
  fury_charm: {
    id: 'fury_charm',
    title: 'Overdrive Sigil',
    description: 'Begin next run with +15% all damage dealt.',
    cost: 50,
  },
};

export type CosmeticDef = {
  id: Exclude<CosmeticId, 'none'>;
  title: string;
  description: string;
  cost: number;
};

export const COSMETICS: Record<Exclude<CosmeticId, 'none'>, CosmeticDef> = {
  neon_trail: {
    id: 'neon_trail',
    title: 'Neon Slipstream',
    description: 'Cyan-amber afterimage ribbon while moving.',
    cost: 80,
  },
  crown_crest: {
    id: 'crown_crest',
    title: 'Thread Crown',
    description: 'Golden 3-peak crest worn atop your runner.',
    cost: 100,
  },
  snoo_antenna: {
    id: 'snoo_antenna',
    title: 'Antenna Beacon',
    description: 'Bobbing glowing orb antenna silhouette accessory.',
    cost: 110,
  },
  flame_halo: {
    id: 'flame_halo',
    title: 'Ember Halo',
    description: 'Orbiting spark ring around your character.',
    cost: 120,
  },
};

const UPGRADE_KEYS: readonly UpgradeId[] = ['vitality', 'reroll', 'magnet', 'shield'];
const CONSUMABLE_KEYS: readonly ConsumableId[] = ['bonus_relic', 'shield_tonic', 'fury_charm'];
const COSMETIC_KEYS: readonly Exclude<CosmeticId, 'none'>[] = [
  'neon_trail',
  'crown_crest',
  'snoo_antenna',
  'flame_halo',
];

function isUpgradeId(id: string): id is UpgradeId {
  return id === 'vitality' || id === 'reroll' || id === 'magnet' || id === 'shield';
}

function isRelicId(id: string): id is RelicId {
  return id in RELICS;
}

function isConsumableId(id: string): id is ConsumableId {
  return id === 'bonus_relic' || id === 'shield_tonic' || id === 'fury_charm';
}

function isCosmeticId(id: string): id is Exclude<CosmeticId, 'none'> {
  return (
    id === 'neon_trail' ||
    id === 'crown_crest' ||
    id === 'snoo_antenna' ||
    id === 'flame_halo'
  );
}

export function getDailyShopRotation(utcDate: string, profile: PlayerProfile): ShopRotation {
  const rng = createDailyStream(utcDate, 'shop');

  const pickedUpgradeId = rng.pick(UPGRADE_KEYS);
  const upgradeDef = UPGRADES[pickedUpgradeId];
  const currentLevel = profile.upgrades[pickedUpgradeId];
  const upgradeMaxed = currentLevel >= upgradeDef.maxLevel;
  const upgradeCost = upgradeMaxed ? 0 : (upgradeDef.costs[currentLevel] ?? 0);

  const slot1: ShopSlot = {
    slotIndex: 0,
    kind: 'upgrade',
    itemId: upgradeDef.id,
    title: upgradeDef.title,
    subtitle: 'Permanent Upgrade',
    description: upgradeDef.description,
    cost: upgradeCost,
    purchased: upgradeMaxed,
    maxed: upgradeMaxed,
    levelLabel: `Lv ${currentLevel}/${upgradeDef.maxLevel}`,
  };

  const lockedRelics = UNLOCKABLE_RELIC_IDS.filter((id) => !profile.unlockedRelics.includes(id));
  const dailyRelicPool = lockedRelics.length > 0 ? lockedRelics : UNLOCKABLE_RELIC_IDS;
  const pickedRelicId = rng.pick(dailyRelicPool);
  const relicDef = RELICS[pickedRelicId];
  const relicAlreadyUnlocked = profile.unlockedRelics.includes(pickedRelicId);

  let slot2: ShopSlot;
  if (!relicAlreadyUnlocked) {
    slot2 = {
      slotIndex: 1,
      kind: 'relic',
      itemId: relicDef.id,
      title: `${relicDef.emoji} ${relicDef.name}`,
      subtitle: 'Unlockable Relic',
      description: `Adds ${relicDef.name} to daily drafts: ${relicDef.summary(1)}.`,
      cost: 95,
      purchased: false,
      maxed: false,
      levelLabel: relicDef.category === 'blade' ? 'Blade Relic' : 'Arcane Relic',
    };
  } else if (lockedRelics.length === 0) {
    const bonusActive = profile.pendingConsumable === 'bonus_relic';
    slot2 = {
      slotIndex: 1,
      kind: 'consumable',
      itemId: 'bonus_relic',
      title: 'Mastery Relic Draft',
      subtitle: 'All Relics Unlocked',
      description: 'Start your next run with 1 random relic immediately.',
      cost: 50,
      purchased: bonusActive,
      maxed: false,
      levelLabel: bonusActive ? 'Armed' : 'Next Run',
    };
  } else {
    slot2 = {
      slotIndex: 1,
      kind: 'relic',
      itemId: relicDef.id,
      title: `${relicDef.emoji} ${relicDef.name}`,
      subtitle: 'Unlocked Relic',
      description: `Already added to your daily draft pool: ${relicDef.summary(1)}.`,
      cost: 0,
      purchased: true,
      maxed: true,
      levelLabel: 'Unlocked',
    };
  }

  const offerCosmetic = rng.next() < 0.45;
  let slot3: ShopSlot;
  if (offerCosmetic) {
    const unownedCosmetics = COSMETIC_KEYS.filter((id) => !profile.ownedCosmetics.includes(id));
    if (unownedCosmetics.length > 0) {
      const cosmeticId = rng.pick(unownedCosmetics);
      const cosmetic = COSMETICS[cosmeticId];
      slot3 = {
        slotIndex: 2,
        kind: 'cosmetic',
        itemId: cosmetic.id,
        title: cosmetic.title,
        subtitle: 'Runner Cosmetic',
        description: cosmetic.description,
        cost: cosmetic.cost,
        purchased: false,
        maxed: false,
        levelLabel: 'Style',
      };
    } else {
      const fallbackCosmetic = COSMETICS[rng.pick(COSMETIC_KEYS)];
      slot3 = {
        slotIndex: 2,
        kind: 'cosmetic',
        itemId: fallbackCosmetic.id,
        title: fallbackCosmetic.title,
        subtitle: 'Runner Cosmetic',
        description: fallbackCosmetic.description,
        cost: 0,
        purchased: true,
        maxed: true,
        levelLabel: 'Owned',
      };
    }
  } else {
    const consumableId = rng.pick(CONSUMABLE_KEYS);
    const consumable = CONSUMABLES[consumableId];
    const alreadyPending = profile.pendingConsumable === consumableId;
    slot3 = {
      slotIndex: 2,
      kind: 'consumable',
      itemId: consumable.id,
      title: consumable.title,
      subtitle: 'Next-Run Boost',
      description: consumable.description,
      cost: consumable.cost,
      purchased: alreadyPending,
      maxed: false,
      levelLabel: alreadyPending ? 'Armed' : '1 Run',
    };
  }

  return [slot1, slot2, slot3];
}

export function purchaseShopSlot(
  profile: PlayerProfile,
  slot: ShopSlot,
): { ok: boolean; profile: PlayerProfile; reason?: string | undefined } {
  if (slot.purchased || slot.maxed) {
    return { ok: false, profile, reason: 'Already owned or maxed.' };
  }
  if (profile.coins < slot.cost) {
    return { ok: false, profile, reason: 'Not enough coins.' };
  }

  const next: PlayerProfile = {
    ...profile,
    coins: profile.coins - slot.cost,
    upgrades: { ...profile.upgrades },
    unlockedRelics: [...profile.unlockedRelics],
    ownedCosmetics: [...profile.ownedCosmetics],
    dailyBest: { ...profile.dailyBest },
  };

  if (slot.kind === 'upgrade' && isUpgradeId(slot.itemId)) {
    const def = UPGRADES[slot.itemId];
    const current = next.upgrades[slot.itemId];
    if (current >= def.maxLevel) {
      return { ok: false, profile, reason: 'Upgrade already maxed.' };
    }
    next.upgrades[slot.itemId] = current + 1;
    return { ok: true, profile: next };
  }

  if (slot.kind === 'relic' && isRelicId(slot.itemId)) {
    if (!next.unlockedRelics.includes(slot.itemId)) {
      next.unlockedRelics.push(slot.itemId);
    }
    return { ok: true, profile: next };
  }

  if (slot.kind === 'consumable' && isConsumableId(slot.itemId)) {
    if (next.pendingConsumable !== null) {
      return {
        ok: false,
        profile,
        reason: 'A next-run boost is already armed for your next run.',
      };
    }
    next.pendingConsumable = slot.itemId;
    return { ok: true, profile: next };
  }

  if (slot.kind === 'cosmetic' && isCosmeticId(slot.itemId)) {
    if (!next.ownedCosmetics.includes(slot.itemId)) {
      next.ownedCosmetics.push(slot.itemId);
    }
    next.equippedCosmetic = slot.itemId;
    return { ok: true, profile: next };
  }

  return { ok: false, profile, reason: 'Invalid shop item.' };
}
