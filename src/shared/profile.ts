import { ENFORCE_SINGLE_DAILY_RUN } from './buildMeta.ts';
import { STARTER_RELIC_IDS } from './relics.ts';
import { getCosmeticSlot, isCosmeticId } from './shop.ts';
import type { DailyLeaderboardEntry, PlayerProfile, RunSummary } from './types.ts';
import { isWeaponId } from './weapons.ts';

export function createDefaultProfile(): PlayerProfile {
  return {
    coins: 0,
    gems: 0,
    ownedWeapons: ['longsword'],
    equippedWeapon: 'longsword',
    unlockedRelics: [...STARTER_RELIC_IDS],
    ownedCosmetics: ['none'],
    equippedCosmetic: 'none',
    equippedCostume: 'none',
    streak: 0,
    lastPlayedDate: null,
    totalRuns: 0,
    totalClears: 0,
    bestFloor: 0,
    tutorialDismissed: false,
    subscribed: false,
    dailyBest: {},
  };
}

export function normalizeProfile(raw: Partial<PlayerProfile> | null | undefined): PlayerProfile {
  const def = createDefaultProfile();
  if (!raw) return def;
  const ownedWeapons = Array.isArray(raw.ownedWeapons)
    ? raw.ownedWeapons.filter((id) => isWeaponId(id))
    : [];
  if (!ownedWeapons.includes('longsword')) ownedWeapons.unshift('longsword');
  const ownedCosmetics = Array.isArray(raw.ownedCosmetics)
    ? raw.ownedCosmetics.filter((id) => id === 'none' || isCosmeticId(id))
    : [];
  if (!ownedCosmetics.includes('none')) ownedCosmetics.unshift('none');
  const equippedWeapon =
    raw.equippedWeapon && ownedWeapons.includes(raw.equippedWeapon)
      ? raw.equippedWeapon
      : 'longsword';
  const equippedCosmetic =
    raw.equippedCosmetic &&
    ownedCosmetics.includes(raw.equippedCosmetic) &&
    getCosmeticSlot(raw.equippedCosmetic) === 'accessory'
      ? raw.equippedCosmetic
      : 'none';
  const equippedCostume =
    raw.equippedCostume &&
    ownedCosmetics.includes(raw.equippedCostume) &&
    getCosmeticSlot(raw.equippedCostume) === 'costume'
      ? raw.equippedCostume
      : 'none';
  return {
    coins: typeof raw.coins === 'number' ? Math.max(0, raw.coins) : def.coins,
    gems: typeof raw.gems === 'number' ? Math.max(0, raw.gems) : def.gems,
    ownedWeapons,
    equippedWeapon,
    unlockedRelics:
      Array.isArray(raw.unlockedRelics) && raw.unlockedRelics.length > 0
        ? raw.unlockedRelics
        : def.unlockedRelics,
    ownedCosmetics,
    equippedCosmetic,
    equippedCostume,
    streak: typeof raw.streak === 'number' ? raw.streak : def.streak,
    lastPlayedDate: raw.lastPlayedDate ?? null,
    totalRuns: typeof raw.totalRuns === 'number' ? raw.totalRuns : 0,
    totalClears: typeof raw.totalClears === 'number' ? raw.totalClears : 0,
    bestFloor: typeof raw.bestFloor === 'number' ? raw.bestFloor : 0,
    tutorialDismissed: Boolean(raw.tutorialDismissed),
    subscribed: Boolean(raw.subscribed),
    dailyBest: raw.dailyBest ?? {},
  };
}

// ---------------------------------------------------------------------------
// Player titles — earned from the deepest floor ever reached
// ---------------------------------------------------------------------------

export type PlayerTitle = { title: string; minFloor: number };

export const PLAYER_TITLES: readonly PlayerTitle[] = [
  { title: 'Fresh Recruit', minFloor: 0 },
  { title: 'Dungeon Delver', minFloor: 2 },
  { title: 'Crypt Raider', minFloor: 3 },
  { title: 'Depth Stalker', minFloor: 5 },
  { title: 'Abyss Walker', minFloor: 7 },
  { title: 'Dungeon Legend', minFloor: 10 },
];

export function getPlayerTitle(bestFloor: number): {
  title: string;
  next: PlayerTitle | null;
} {
  let current = PLAYER_TITLES[0]!;
  let next: PlayerTitle | null = null;
  for (const t of PLAYER_TITLES) {
    if (bestFloor >= t.minFloor) {
      current = t;
    } else {
      next = t;
      break;
    }
  }
  return { title: current.title, next };
}

// ---------------------------------------------------------------------------
// Leaderboard ordering — deepest floor, then most rooms cleared, then fastest
// ---------------------------------------------------------------------------

export function compareLeaderboardEntries(
  a: DailyLeaderboardEntry,
  b: DailyLeaderboardEntry,
): number {
  const fa = a.floorReached ?? 1;
  const fb = b.floorReached ?? 1;
  if (fa !== fb) return fb - fa;
  const ra = a.roomsCleared ?? 0;
  const rb = b.roomsCleared ?? 0;
  if (ra !== rb) return rb - ra;
  return a.elapsedSec - b.elapsedSec;
}

function utcDayDiff(prevDate: string, nextDate: string): number {
  const a = Date.parse(`${prevDate}T00:00:00Z`);
  const b = Date.parse(`${nextDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 999;
  return Math.round((b - a) / 86_400_000);
}

export function hasCompletedDailyRun(profile: PlayerProfile, utcDate: string): boolean {
  return Boolean(profile.dailyBest[utcDate]);
}

export function clearDailyRun(profile: PlayerProfile, utcDate: string): PlayerProfile {
  if (!hasCompletedDailyRun(profile, utcDate)) {
    return profile;
  }
  const nextDailyBest = { ...profile.dailyBest };
  delete nextDailyBest[utcDate];
  return {
    ...profile,
    dailyBest: nextDailyBest,
  };
}

export function getDailyRunSummary(profile: PlayerProfile, utcDate: string): RunSummary | null {
  const record = profile.dailyBest[utcDate];
  if (!record) return null;
  if (record.summary) return record.summary;
  return {
    utcDate: record.utcDate,
    outcome: record.extracted ? 'extracted' : 'defeated',
    bossDefeated: record.extracted,
    floorReached: record.bestFloor ?? 1,
    roomsCleared: record.highestRoom,
    floorsCleared: Math.max(0, (record.bestFloor ?? 1) - 1),
    roomReached: record.highestRoom,
    progressPct: record.bestProgressPct ?? (record.extracted ? 100 : 0),
    elapsedSec: record.bestClearTimeSec ?? 0,
    coinsEarned: 0,
    gemsEarned: 0,
    damageTaken: 0,
    enemiesKilled: 0,
    weapon: 'longsword',
    relics: {},
    score: record.bestScore,
  };
}

export function applyRunToProfile(
  profile: PlayerProfile,
  summary: RunSummary,
  options?: { enforceSingleDailyRun?: boolean },
): PlayerProfile {
  const enforceSingle = options?.enforceSingleDailyRun ?? ENFORCE_SINGLE_DAILY_RUN;
  if (enforceSingle && hasCompletedDailyRun(profile, summary.utcDate)) {
    return profile;
  }

  let nextStreak = profile.streak;
  if (!profile.lastPlayedDate) {
    nextStreak = 1;
  } else {
    const diff = utcDayDiff(profile.lastPlayedDate, summary.utcDate);
    if (diff === 1) {
      nextStreak = Math.max(1, profile.streak) + 1;
    } else if (diff === 0) {
      nextStreak = Math.max(1, profile.streak);
    } else if (diff > 1) {
      nextStreak = 1;
    }
  }

  const prevBest = profile.dailyBest[summary.utcDate];
  const nextBestClearTime = summary.bossDefeated
    ? prevBest?.bestClearTimeSec !== null && prevBest?.bestClearTimeSec !== undefined
      ? Math.min(prevBest.bestClearTimeSec, summary.elapsedSec)
      : summary.elapsedSec
    : (prevBest?.bestClearTimeSec ?? null);

  const nextBest = {
    utcDate: summary.utcDate,
    highestRoom: Math.max(prevBest?.highestRoom ?? 0, summary.roomsCleared),
    bestFloor: Math.max(prevBest?.bestFloor ?? 0, summary.floorReached),
    bestProgressPct: Math.max(prevBest?.bestProgressPct ?? 0, summary.progressPct ?? 0),
    bestClearTimeSec: nextBestClearTime,
    bestScore: Math.max(prevBest?.bestScore ?? 0, summary.score),
    extracted: Boolean(prevBest?.extracted || summary.outcome === 'extracted'),
    summary: { ...summary, relics: { ...summary.relics } },
  };

  return {
    ...profile,
    coins: profile.coins + summary.coinsEarned,
    gems: profile.gems + (summary.gemsEarned ?? 0),
    bestFloor: Math.max(profile.bestFloor, summary.floorReached),
    streak: nextStreak,
    lastPlayedDate: summary.utcDate,
    totalRuns: profile.totalRuns + 1,
    totalClears: profile.totalClears + (summary.floorsCleared ?? 0),
    dailyBest: {
      ...profile.dailyBest,
      [summary.utcDate]: nextBest,
    },
  };
}

export function toLeaderboardEntry(player: string, summary: RunSummary): DailyLeaderboardEntry {
  return {
    player,
    floorReached: summary.floorReached ?? 1,
    roomsCleared: summary.roomsCleared ?? 0,
    roomReached: summary.roomReached,
    progressPct: summary.progressPct,
    elapsedSec: summary.elapsedSec,
    extracted: summary.outcome === 'extracted',
    score: summary.score,
  };
}
