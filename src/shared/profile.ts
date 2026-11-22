import { ENFORCE_SINGLE_DAILY_RUN } from './buildMeta.ts';
import { STARTER_RELIC_IDS } from './relics.ts';
import type { PlayerProfile, RunSummary } from './types.ts';

export function createDefaultProfile(): PlayerProfile {
  return {
    coins: 0,
    upgrades: {
      vitality: 0,
      reroll: 0,
      magnet: 0,
      shield: 0,
    },
    unlockedRelics: [...STARTER_RELIC_IDS],
    ownedCosmetics: ['none'],
    equippedCosmetic: 'none',
    pendingConsumable: null,
    streak: 0,
    lastPlayedDate: null,
    totalRuns: 0,
    totalClears: 0,
    subscribed: false,
    dailyBest: {},
  };
}

export function normalizeProfile(raw: Partial<PlayerProfile> | null | undefined): PlayerProfile {
  const def = createDefaultProfile();
  if (!raw) return def;
  return {
    ...def,
    ...raw,
    upgrades: { ...def.upgrades, ...(raw.upgrades ?? {}) },
    unlockedRelics:
      Array.isArray(raw.unlockedRelics) && raw.unlockedRelics.length > 0
        ? raw.unlockedRelics
        : def.unlockedRelics,
    ownedCosmetics:
      Array.isArray(raw.ownedCosmetics) && raw.ownedCosmetics.length > 0
        ? raw.ownedCosmetics
        : def.ownedCosmetics,
    dailyBest: raw.dailyBest ?? {},
  };
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
    roomReached: record.highestRoom,
    progressPct: record.bestProgressPct ?? (record.extracted ? 100 : 0),
    elapsedSec: record.bestClearTimeSec ?? 0,
    coinsEarned: 0,
    damageTaken: 0,
    enemiesKilled: 0,
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
    highestRoom: Math.max(prevBest?.highestRoom ?? 0, summary.roomReached),
    bestProgressPct: Math.max(prevBest?.bestProgressPct ?? 0, summary.progressPct ?? 0),
    bestClearTimeSec: nextBestClearTime,
    bestScore: Math.max(prevBest?.bestScore ?? 0, summary.score),
    extracted: Boolean(prevBest?.extracted || summary.outcome === 'extracted'),
    summary: { ...summary, relics: { ...summary.relics } },
  };

  return {
    ...profile,
    coins: profile.coins + summary.coinsEarned,
    pendingConsumable: null,
    streak: nextStreak,
    lastPlayedDate: summary.utcDate,
    totalRuns: profile.totalRuns + 1,
    totalClears: profile.totalClears + (summary.bossDefeated ? 1 : 0),
    dailyBest: {
      ...profile.dailyBest,
      [summary.utcDate]: nextBest,
    },
  };
}
