import { showToast } from '@devvit/web/client';
import type {
  CosmeticEquipResponse,
  ProfileResponse,
  RunCompleteResponse,
  ShareCommentResponse,
  ShopPurchaseResponse,
  SubscribeResponse,
} from '../../shared/api.ts';
import {
  BUILD_ID,
  ENFORCE_SINGLE_DAILY_RUN,
  isStampedBuildId,
} from '../../shared/buildMeta.ts';
import {
  applyRunToProfile,
  clearDailyRun,
  createDefaultProfile,
  hasCompletedDailyRun,
  normalizeProfile,
} from '../../shared/profile.ts';
import { getDailyShopRotation, purchaseShopSlot } from '../../shared/shop.ts';
import type {
  CosmeticId,
  DailyLeaderboardEntry,
  PlayerProfile,
  RunSummary,
} from '../../shared/types.ts';

export type LoadedSession = {
  profile: PlayerProfile;
  leaderboard: DailyLeaderboardEntry[];
  username: string;
  subredditName: string;
  authenticated: boolean;
};

export type PlatformAdapter = {
  loadSession: (utcDate: string) => Promise<LoadedSession>;
  buyShopSlot: (
    utcDate: string,
    slotIndex: 0 | 1 | 2,
    currentProfile: PlayerProfile,
  ) => Promise<{ ok: boolean; profile: PlayerProfile; reason?: string | undefined }>;
  equipCosmetic: (
    cosmeticId: CosmeticId,
    currentProfile: PlayerProfile,
  ) => Promise<PlayerProfile>;
  recordRun: (
    summary: RunSummary,
    currentProfile: PlayerProfile,
  ) => Promise<{ profile: PlayerProfile; leaderboard: DailyLeaderboardEntry[] }>;
  shareRunComment: (
    markdown: string,
  ) => Promise<{ ok: boolean; method: 'clipboard' | 'reddit'; message: string }>;
  toggleSubscribe: (
    subscribed: boolean,
    currentProfile: PlayerProfile,
  ) => Promise<boolean>;
  notify: (message: string) => void;
};

const STORAGE_KEY = 'dungeonle_state_v1';

type StoredPayload = {
  profile: PlayerProfile;
  leaderboards: Record<string, DailyLeaderboardEntry[]>;
  lastBuildId?: string | undefined;
};

export class LocalStoragePlatformAdapter implements PlatformAdapter {
  private readonly storage: Storage | null;

  constructor(storage?: Storage | null) {
    if (storage !== undefined) {
      this.storage = storage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    } else {
      this.storage = null;
    }
  }

  private readPayload(): StoredPayload {
    const fallback: StoredPayload = {
      profile: createDefaultProfile(),
      leaderboards: {},
    };
    if (!this.storage) return fallback;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<StoredPayload>;
      return {
        profile: normalizeProfile(parsed.profile),
        leaderboards: parsed.leaderboards ?? {},
        lastBuildId: parsed.lastBuildId,
      };
    } catch {
      return fallback;
    }
  }

  private writePayload(payload: StoredPayload): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors.
    }
  }

  async loadSession(utcDate: string): Promise<LoadedSession> {
    const payload = this.readPayload();
    if (ENFORCE_SINGLE_DAILY_RUN && isStampedBuildId(BUILD_ID) && payload.lastBuildId !== BUILD_ID) {
      payload.profile = clearDailyRun(payload.profile, utcDate);
      delete payload.leaderboards[utcDate];
      payload.lastBuildId = BUILD_ID;
      this.writePayload(payload);
    }
    return {
      profile: payload.profile,
      leaderboard: payload.leaderboards[utcDate] ?? [],
      username: 'Local Player',
      subredditName: 'dungeonle',
      authenticated: false,
    };
  }

  async buyShopSlot(
    utcDate: string,
    slotIndex: 0 | 1 | 2,
    currentProfile: PlayerProfile,
  ): Promise<{ ok: boolean; profile: PlayerProfile; reason?: string | undefined }> {
    const rotation = getDailyShopRotation(utcDate, currentProfile);
    const slot = rotation[slotIndex];
    const result = purchaseShopSlot(currentProfile, slot);
    if (result.ok) {
      const payload = this.readPayload();
      payload.profile = result.profile;
      this.writePayload(payload);
    }
    return result;
  }

  async equipCosmetic(
    cosmeticId: CosmeticId,
    currentProfile: PlayerProfile,
  ): Promise<PlayerProfile> {
    const updated: PlayerProfile = {
      ...currentProfile,
      equippedCosmetic: cosmeticId,
    };
    const payload = this.readPayload();
    payload.profile = updated;
    this.writePayload(payload);
    return updated;
  }

  async recordRun(
    summary: RunSummary,
    currentProfile: PlayerProfile,
  ): Promise<{ profile: PlayerProfile; leaderboard: DailyLeaderboardEntry[] }> {
    const payload = this.readPayload();
    if (ENFORCE_SINGLE_DAILY_RUN && hasCompletedDailyRun(payload.profile, summary.utcDate)) {
      return {
        profile: payload.profile,
        leaderboard: payload.leaderboards[summary.utcDate] ?? [],
      };
    }
    const updatedProfile = applyRunToProfile(currentProfile, summary);
    payload.profile = updatedProfile;

    const existing = payload.leaderboards[summary.utcDate] ?? [];
    const entry: DailyLeaderboardEntry = {
      player: 'You (Local)',
      roomReached: summary.roomReached,
      progressPct: summary.progressPct,
      elapsedSec: summary.elapsedSec,
      extracted: summary.outcome === 'extracted',
      score: summary.score,
    };

    const sorted = [...existing, entry]
      .sort((a, b) => {
        if (a.roomReached !== b.roomReached) return b.roomReached - a.roomReached;
        if (a.extracted !== b.extracted) return a.extracted ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return a.elapsedSec - b.elapsedSec;
      })
      .slice(0, 5);

    payload.leaderboards[summary.utcDate] = sorted;
    this.writePayload(payload);
    return { profile: updatedProfile, leaderboard: sorted };
  }

  async shareRunComment(
    markdown: string,
  ): Promise<{ ok: boolean; method: 'clipboard' | 'reddit'; message: string }> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(markdown);
        return {
          ok: true,
          method: 'clipboard',
          message: 'Run summary copied to clipboard! Ready to paste in comments.',
        };
      } catch {
        // Fall through to execCommand fallback
      }
    }

    if (typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = markdown;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (copied) {
          return {
            ok: true,
            method: 'clipboard',
            message: 'Run summary copied to clipboard!',
          };
        }
      } catch {
        // Ignore fallback failure
      }
    }

    return {
      ok: false,
      method: 'clipboard',
      message: 'Clipboard unavailable — copy from the summary.',
    };
  }

  async toggleSubscribe(subscribed: boolean, currentProfile: PlayerProfile): Promise<boolean> {
    const payload = this.readPayload();
    payload.profile = { ...currentProfile, subscribed };
    this.writePayload(payload);
    return subscribed;
  }

  notify(_message: string): void {
    // Handled by DOM toast in UI controller.
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export class HybridDevvitAdapter implements PlatformAdapter {
  private readonly local = new LocalStoragePlatformAdapter();
  private serverAvailable = false;
  private authenticated = false;

  async loadSession(utcDate: string): Promise<LoadedSession> {
    const buildQuery = isStampedBuildId(BUILD_ID)
      ? `&build=${encodeURIComponent(BUILD_ID)}`
      : '';
    const remote = await fetchJson<ProfileResponse>(
      `/api/profile?date=${encodeURIComponent(utcDate)}${buildQuery}`,
    );
    if (remote) {
      this.serverAvailable = true;
      this.authenticated = remote.authenticated;
      if (remote.authenticated) {
        return {
          profile: normalizeProfile(remote.profile),
          leaderboard: remote.leaderboard,
          username: remote.username,
          subredditName: remote.subredditName,
          authenticated: true,
        };
      }
      const localSession = await this.local.loadSession(utcDate);
      return {
        ...localSession,
        leaderboard:
          remote.leaderboard.length > 0 ? remote.leaderboard : localSession.leaderboard,
        subredditName: remote.subredditName,
      };
    }

    return await this.local.loadSession(utcDate);
  }

  async buyShopSlot(
    utcDate: string,
    slotIndex: 0 | 1 | 2,
    currentProfile: PlayerProfile,
  ): Promise<{ ok: boolean; profile: PlayerProfile; reason?: string | undefined }> {
    if (this.serverAvailable && this.authenticated) {
      const remote = await fetchJson<ShopPurchaseResponse>('/api/shop/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utcDate, slotIndex }),
      });
      if (remote) {
        return {
          ok: remote.ok,
          profile: normalizeProfile(remote.profile),
          reason: remote.reason,
        };
      }
    }
    return await this.local.buyShopSlot(utcDate, slotIndex, currentProfile);
  }

  async equipCosmetic(
    cosmeticId: CosmeticId,
    currentProfile: PlayerProfile,
  ): Promise<PlayerProfile> {
    if (this.serverAvailable && this.authenticated) {
      const remote = await fetchJson<CosmeticEquipResponse>('/api/profile/cosmetic', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cosmeticId }),
      });
      if (remote) {
        return normalizeProfile(remote.profile);
      }
    }
    return await this.local.equipCosmetic(cosmeticId, currentProfile);
  }

  async recordRun(
    summary: RunSummary,
    currentProfile: PlayerProfile,
  ): Promise<{ profile: PlayerProfile; leaderboard: DailyLeaderboardEntry[] }> {
    if (this.serverAvailable && this.authenticated) {
      const remote = await fetchJson<RunCompleteResponse>('/api/run/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      if (remote) {
        return {
          profile: normalizeProfile(remote.profile),
          leaderboard: remote.leaderboard,
        };
      }
    }
    return await this.local.recordRun(summary, currentProfile);
  }

  async shareRunComment(
    markdown: string,
  ): Promise<{ ok: boolean; method: 'clipboard' | 'reddit'; message: string }> {
    if (this.serverAvailable && this.authenticated) {
      const remote = await fetchJson<ShareCommentResponse>('/api/share-comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });
      if (remote?.ok) {
        return remote;
      }
    }
    return await this.local.shareRunComment(markdown);
  }

  async toggleSubscribe(subscribed: boolean, currentProfile: PlayerProfile): Promise<boolean> {
    if (this.serverAvailable && this.authenticated && subscribed) {
      const remote = await fetchJson<SubscribeResponse>('/api/subscribe', {
        method: 'POST',
      });
      if (remote) {
        return remote.subscribed;
      }
    }
    return await this.local.toggleSubscribe(subscribed, currentProfile);
  }

  notify(message: string): void {
    if (!this.serverAvailable) return;
    try {
      showToast(message);
    } catch {
      // Outside Devvit iframe
    }
  }
}
