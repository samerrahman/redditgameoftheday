import { STARTER_RELIC_IDS } from './relics.ts';
import { createDailyStream, pickDailyRotation } from './rng.ts';
import type {
  DailyModifier,
  DailyModifierId,
  DailyRule,
  DailyRuleId,
  HazardType,
  PlayerProfile,
  RelicId,
  WeaponId,
} from './types.ts';
import { WEAPONS } from './weapons.ts';

export const DAILY_MODIFIERS: Record<DailyModifierId, DailyModifier> = {
  glass_cannon: {
    id: 'glass_cannon',
    banner: 'Everyone Deals Double Damage',
    description: 'You and enemies deal 2x damage.',
    playerDamageMult: 2,
    enemyDamageMult: 2,
    frictionMult: 1,
    attackCdMult: 1,
    attackDamageMult: 1,
    enemySpeedMult: 1,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: false,
  },
  slippery_floors: {
    id: 'slippery_floors',
    banner: 'Slippery Floors',
    description: 'You slide further when you move.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 0.24,
    attackCdMult: 1,
    attackDamageMult: 1,
    enemySpeedMult: 1,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: false,
  },
  heavy_blade: {
    id: 'heavy_blade',
    banner: 'Stronger but Slower Attacks',
    description: '+45% damage, 35% slower attacks.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 1,
    attackCdMult: 1.35,
    attackDamageMult: 1.45,
    enemySpeedMult: 1,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: false,
  },
  volatile_foes: {
    id: 'volatile_foes',
    banner: 'Enemies Explode on Death',
    description: 'Step away from enemies you kill.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 1,
    attackCdMult: 1,
    attackDamageMult: 1,
    enemySpeedMult: 1,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: true,
  },
  quick_blades: {
    id: 'quick_blades',
    banner: 'Faster Attacks, Faster Enemies',
    description: 'You attack 25% faster, enemies move 15% faster.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 1,
    attackCdMult: 0.75,
    attackDamageMult: 1,
    enemySpeedMult: 1.15,
    enemyHpMult: 1,
    coinDropMult: 1,
    deathBlast: false,
  },
  golden_fever: {
    id: 'golden_fever',
    banner: 'More Coins, Tougher Enemies',
    description: 'Enemies drop +50% coins and have +15% health.',
    playerDamageMult: 1,
    enemyDamageMult: 1,
    frictionMult: 1,
    attackCdMult: 1,
    attackDamageMult: 1,
    enemySpeedMult: 1,
    enemyHpMult: 1.15,
    coinDropMult: 1.5,
    deathBlast: false,
  },
};

const MODIFIER_LIST = Object.values(DAILY_MODIFIERS).filter(
  (m) => m.id !== 'slippery_floors',
);
const HAZARD_TYPES: readonly HazardType[] = ['spikes', 'barrels', 'currents'];

export function getDailyModifier(utcDate: string): DailyModifier {
  return pickDailyRotation(utcDate, 'meta', MODIFIER_LIST);
}

export function getDailyHazard(utcDate: string): HazardType {
  const rng = createDailyStream(utcDate, 'hazard');
  return rng.pick(HAZARD_TYPES);
}

export const DAILY_RULES: Record<DailyRuleId, DailyRule> = {
  open_armory: {
    id: 'open_armory',
    label: 'Any Weapon',
    description: 'Bring any weapon you own.',
    weaponMode: 'any',
  },
  melee_only: {
    id: 'melee_only',
    label: 'Melee Weapons Only',
    description: 'Staffs swap to your best melee weapon today.',
    weaponMode: 'melee_only',
  },
  ranged_only: {
    id: 'ranged_only',
    label: 'Staffs Only',
    description: 'Everyone uses a staff today (Scatter Staff loaned free).',
    weaponMode: 'ranged_only',
  },
  trial_dagger: {
    id: 'trial_dagger',
    label: 'Everyone Uses Twin Daggers',
    description: 'Everyone wields Twin Daggers today (loaned free).',
    weaponMode: 'locked',
    forcedWeapon: 'dagger',
  },
  trial_hammer: {
    id: 'trial_hammer',
    label: 'Everyone Uses the War Hammer',
    description: 'Everyone swings the War Hammer today (loaned free).',
    weaponMode: 'locked',
    forcedWeapon: 'hammer',
  },
  trial_scatter: {
    id: 'trial_scatter',
    label: 'Everyone Uses the Scatter Staff',
    description: 'Everyone blasts with Scatter Staff today (loaned free).',
    weaponMode: 'locked',
    forcedWeapon: 'scatter_staff',
  },
  trial_lance: {
    id: 'trial_lance',
    label: 'Everyone Uses the Arcane Lance',
    description: 'Everyone snipes with Arcane Lance today (loaned free).',
    weaponMode: 'locked',
    forcedWeapon: 'arcane_lance',
  },
  starter_relic: {
    id: 'starter_relic',
    label: 'Free Starting Relic',
    description: 'Any weapon, plus a free relic on Floor 1.',
    weaponMode: 'any',
    grantStarterRelic: true,
  },
  crate_bonanza: {
    id: 'crate_bonanza',
    label: 'A Chest in Every Room',
    description: 'Any weapon, and every room has a real treasure chest.',
    weaponMode: 'any',
    extraCrates: 2,
  },
};

const DAILY_RULE_WEIGHTED_POOL: readonly DailyRule[] = [
  DAILY_RULES.open_armory,
  DAILY_RULES.melee_only,
  DAILY_RULES.ranged_only,
  DAILY_RULES.trial_dagger,
  DAILY_RULES.trial_hammer,
  DAILY_RULES.trial_scatter,
  DAILY_RULES.trial_lance,
  DAILY_RULES.crate_bonanza,
];

export function getDailyRule(utcDate: string): DailyRule {
  return pickDailyRotation(utcDate, 'daily-rule', DAILY_RULE_WEIGHTED_POOL);
}

export function isWeaponAllowedByRule(rule: DailyRule, weaponId: WeaponId): boolean {
  if (rule.weaponMode === 'locked') {
    return rule.forcedWeapon === weaponId;
  }
  if (rule.weaponMode === 'melee_only') {
    return WEAPONS[weaponId].style === 'melee';
  }
  if (rule.weaponMode === 'ranged_only') {
    return WEAPONS[weaponId].style === 'ranged';
  }
  return true;
}

export function resolveDailyWeapon(
  utcDate: string,
  profile: PlayerProfile,
): { weaponId: WeaponId; overridden: boolean; rule: DailyRule } {
  const rule = getDailyRule(utcDate);
  if (rule.weaponMode === 'locked' && rule.forcedWeapon) {
    return {
      weaponId: rule.forcedWeapon,
      overridden: profile.equippedWeapon !== rule.forcedWeapon,
      rule,
    };
  }
  if (rule.weaponMode === 'melee_only') {
    if (WEAPONS[profile.equippedWeapon].style === 'melee') {
      return { weaponId: profile.equippedWeapon, overridden: false, rule };
    }
    const ownedMelee = profile.ownedWeapons.find((id) => WEAPONS[id].style === 'melee');
    return { weaponId: ownedMelee ?? 'longsword', overridden: true, rule };
  }
  if (rule.weaponMode === 'ranged_only') {
    if (WEAPONS[profile.equippedWeapon].style === 'ranged') {
      return { weaponId: profile.equippedWeapon, overridden: false, rule };
    }
    const ownedRanged = profile.ownedWeapons.find((id) => WEAPONS[id].style === 'ranged');
    return { weaponId: ownedRanged ?? 'scatter_staff', overridden: true, rule };
  }
  return { weaponId: profile.equippedWeapon, overridden: false, rule };
}

export function getDailyStarterRelic(utcDate: string): RelicId {
  const candidates = STARTER_RELIC_IDS.filter((id) => id !== 'concussion');
  const pool = candidates.length > 0 ? candidates : STARTER_RELIC_IDS;
  return createDailyStream(utcDate, 'starter-relic').pick(pool);
}
