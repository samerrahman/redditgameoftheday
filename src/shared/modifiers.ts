import { STARTER_RELIC_IDS } from './relics.ts';
import { createDailyStream } from './rng.ts';
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
    banner: 'Glass Cannon: 2x Damage',
    description: 'Player and enemy hits deal double damage.',
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
    banner: 'Slippery Floors: Low Friction',
    description: 'Momentum carries further across slick arena stone.',
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
    banner: 'Heavy Blade: +45% Swing Dmg',
    description: 'Swings hit 45% harder with slightly slower recovery.',
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
    banner: 'Volatile Foes: Death Blasts',
    description: 'Slain enemies detonate after a short warning pulse.',
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
    banner: 'Quick Blades: Faster Swings',
    description: 'Attack recovery is 25% faster; foes move 15% quicker.',
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
    banner: 'Golden Fever: Rich Drops',
    description: 'Enemies drop +50% coins and gain +15% health.',
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
  const rng = createDailyStream(utcDate, 'meta');
  return rng.pick(MODIFIER_LIST);
}

export function getDailyHazard(utcDate: string): HazardType {
  const rng = createDailyStream(utcDate, 'hazard');
  return rng.pick(HAZARD_TYPES);
}

export const DAILY_RULES: Record<DailyRuleId, DailyRule> = {
  open_armory: {
    id: 'open_armory',
    label: 'Open Armory',
    description: 'Bring any unlocked weapon from your shop.',
    weaponMode: 'any',
  },
  melee_only: {
    id: 'melee_only',
    label: 'Steel Only',
    description: 'Melee weapons only today (ranged loadouts swap to Longsword).',
    weaponMode: 'melee_only',
  },
  ranged_only: {
    id: 'ranged_only',
    label: 'Arcane Only',
    description: 'Staff weapons only today (Scatter Staff loaned free).',
    weaponMode: 'ranged_only',
  },
  trial_dagger: {
    id: 'trial_dagger',
    label: 'Trial: Twin Daggers',
    description: 'Everyone wields Twin Daggers today (loaned free).',
    weaponMode: 'locked',
    forcedWeapon: 'dagger',
  },
  trial_hammer: {
    id: 'trial_hammer',
    label: 'Trial: War Hammer',
    description: 'Everyone swings the War Hammer today (loaned free).',
    weaponMode: 'locked',
    forcedWeapon: 'hammer',
  },
  trial_scatter: {
    id: 'trial_scatter',
    label: 'Trial: Scatter Staff',
    description: 'Everyone blasts with Scatter Staff today (loaned free).',
    weaponMode: 'locked',
    forcedWeapon: 'scatter_staff',
  },
  trial_lance: {
    id: 'trial_lance',
    label: 'Trial: Arcane Lance',
    description: 'Everyone snipes with Arcane Lance today (loaned free).',
    weaponMode: 'locked',
    forcedWeapon: 'arcane_lance',
  },
  starter_relic: {
    id: 'starter_relic',
    label: 'Head Start',
    description: 'Open Armory plus a free daily starter relic on Floor 1.',
    weaponMode: 'any',
    grantStarterRelic: true,
  },
  crate_bonanza: {
    id: 'crate_bonanza',
    label: 'Supply Surge',
    description: 'Open Armory with extra supply crates in every room.',
    weaponMode: 'any',
    extraCrates: 2,
  },
};

const DAILY_RULE_WEIGHTED_POOL: readonly DailyRule[] = [
  DAILY_RULES.open_armory,
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
  const rng = createDailyStream(utcDate, 'daily-rule');
  return rng.pick(DAILY_RULE_WEIGHTED_POOL);
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
