import type { SeededRng } from './rng.ts';
import type { RelicDef, RelicId } from './types.ts';

export const RELICS: Record<RelicId, RelicDef> = {
  ember_wake: {
    id: 'ember_wake',
    name: 'Ember Wake',
    category: 'blade',
    emoji: '🔥',
    shortTag: 'Ember',
    starter: true,
    synergyImpact: true,
    summary: (lv) => `Attacks leave 2.2s fire patch (${14 + 7 * (lv - 1)} DPS)`,
  },
  arc_conduit: {
    id: 'arc_conduit',
    name: 'Arc Conduit',
    category: 'arcane',
    emoji: '⚡',
    shortTag: 'Arc',
    starter: true,
    synergyImpact: true,
    summary: (lv) => `Hits chain lightning to ${2 + (lv - 1)} foes (${18 + 8 * (lv - 1)} dmg)`,
  },
  blood_reset: {
    id: 'blood_reset',
    name: 'Blood Reset',
    category: 'blade',
    emoji: '🩸',
    shortTag: 'Reset',
    starter: true,
    synergyImpact: true,
    summary: (lv) => `Kills reset attack cooldown (+${15 * lv}% attack dmg)`,
  },
  decoy_mine: {
    id: 'decoy_mine',
    name: 'Decoy Mine',
    category: 'arcane',
    emoji: '💣',
    shortTag: 'Mine',
    starter: true,
    synergyImpact: false,
    summary: (lv) => `Every 3rd hit drops bomb (${34 + 14 * (lv - 1)} AoE dmg)`,
  },
  rift_cleave: {
    id: 'rift_cleave',
    name: 'Rift Cleave',
    category: 'blade',
    emoji: '🌙',
    shortTag: 'Rift',
    starter: true,
    synergyImpact: true,
    summary: (lv) => `Attacks fire piercing wave (${24 + 10 * (lv - 1)} dmg)`,
  },
  vortex_slam: {
    id: 'vortex_slam',
    name: 'Vortex Slam',
    category: 'arcane',
    emoji: '🌀',
    shortTag: 'Vortex',
    starter: true,
    synergyImpact: true,
    summary: (lv) => `Attacks pull nearby foes inward (${150 + 25 * (lv - 1)}px)`,
  },
  mirror_guard: {
    id: 'mirror_guard',
    name: 'Mirror Guard',
    category: 'arcane',
    emoji: '🪞',
    shortTag: 'Mirror',
    starter: true,
    synergyImpact: true,
    summary: (lv) => `Attacks reflect nearby projectiles at ${2.5 + 0.25 * (lv - 1)}x dmg`,
  },
  reaper_siphon: {
    id: 'reaper_siphon',
    name: 'Reaper Siphon',
    category: 'arcane',
    emoji: '💚',
    shortTag: 'Siphon',
    starter: true,
    synergyImpact: false,
    summary: (lv) => `Multi-hit or kill attack restores +${5 + 3 * (lv - 1)} HP`,
  },
  volt_nova: {
    id: 'volt_nova',
    name: 'Volt Nova',
    category: 'arcane',
    emoji: '✨',
    shortTag: 'Nova',
    starter: false,
    synergyImpact: true,
    summary: (lv) => `Every 3rd hit emits a shock ring (${20 + 8 * (lv - 1)} dmg)`,
  },
  shatter_quake: {
    id: 'shatter_quake',
    name: 'Shatter Quake',
    category: 'blade',
    emoji: '🪨',
    shortTag: 'Quake',
    starter: false,
    synergyImpact: true,
    summary: (lv) => `Hits trigger 0.45s aftershock (${65 + 10 * (lv - 1)}% dmg)`,
  },
  phantom_echo: {
    id: 'phantom_echo',
    name: 'Phantom Echo',
    category: 'blade',
    emoji: '👤',
    shortTag: 'Echo',
    starter: false,
    synergyImpact: true,
    summary: (lv) => `Every 2nd hit leaves shadow echo (${22 + 9 * (lv - 1)} dmg)`,
  },
  golden_cleave: {
    id: 'golden_cleave',
    name: 'Golden Cleave',
    category: 'blade',
    emoji: '🪙',
    shortTag: 'Gild',
    starter: false,
    synergyImpact: false,
    summary: (lv) => `Hits burst +${2 * lv} magnetized coins`,
  },
  concussion: {
    id: 'concussion',
    name: 'Concussion',
    category: 'blade',
    emoji: '💫',
    shortTag: 'Stun',
    starter: true,
    synergyImpact: false,
    // Very rare: roughly 1 in 8 the odds of a normal relic per draft slot.
    draftWeight: 0.12,
    summary: (lv) => `Your hits stun enemies for ${(0.3 + 0.1 * (lv - 1)).toFixed(1)}s`,
  },
};

export const ALL_RELIC_IDS = Object.keys(RELICS) as RelicId[];
export const STARTER_RELIC_IDS = ALL_RELIC_IDS.filter((id) => RELICS[id].starter);
export const UNLOCKABLE_RELIC_IDS = ALL_RELIC_IDS.filter((id) => !RELICS[id].starter);

export function draftRelics(
  rng: SeededRng,
  unlockedRelics: readonly RelicId[],
  count: number,
  filterMode?: 'synergy',
): RelicDef[] {
  const uniqueIds = Array.from(new Set(unlockedRelics));
  let pool = uniqueIds
    .map((id) => RELICS[id])
    .filter((def): def is RelicDef => def !== undefined);

  if (filterMode === 'synergy') {
    const synergyPool = pool.filter((def) => def.synergyImpact);
    if (synergyPool.length >= count) {
      pool = synergyPool;
    }
  }

  // Weighted draw without replacement so very rare relics (low draftWeight) seldom appear.
  const picked: RelicDef[] = [];
  const remaining = [...pool];
  while (picked.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, def) => sum + (def.draftWeight ?? 1), 0);
    let roll = rng.next() * total;
    let idx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i += 1) {
      roll -= remaining[i]!.draftWeight ?? 1;
      if (roll < 0) {
        idx = i;
        break;
      }
    }
    picked.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return picked;
}
