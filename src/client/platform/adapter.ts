import { showToast } from '@devvit/web/client';
import type {
  ProfileResponse,
  RunCompleteResponse,
  ShareCommentResponse,
  ShopActionRequest,
  ShopActionResponse,
  SubscribeResponse,
} from '../../shared/api.ts';
import { BUILD_ID, ENFORCE_SINGLE_DAILY_RUN, isStampedBuildId } from '../../shared/buildMeta.ts';
import {
  applyRunToProfile,
  clearDailyRun,
  compareLeaderboardEntries,
  createDefaultProfile,
  hasCompletedDailyRun,
  normalizeProfile,
  toLeaderboardEntry,
} from '../../shared/profile.ts';
import { applyShopAction } from '../../shared/shop.ts';
import type { DailyLeaderboardEntry, PlayerProfile, RunSummary } from '../../shared/types.ts';

export type LoadedSession = {
  profile: PlayerProfile;
  leaderboard: DailyLeaderboardEntry[];
  username: string;
  subredditName: string;
  authenticated: boolean;
};

export type PlatformAdapter = {
  loadSession: (utcDate: string) => Promise<LoadedSession>;
  shopAction: (req: ShopActionRequest, currentProfile: PlayerProfile) => Promise<ShopActionResponse>;
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

  async shopAction(
    req: ShopActionRequest,
    currentProfile: PlayerProfile,
  ): Promise<ShopActionResponse> {
    const result = applyShopAction(currentProfile, req, Math.random);
    if (result.ok) {
      const payload = this.readPayload();
      payload.profile = result.profile;
      this.writePayload(payload);
    }
    return result;
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
    const entry = toLeaderboardEntry('You (Local)', summary);
    const sorted = [...existing, entry].sort(compareLeaderboardEntries).slice(0, 5);

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

  async shopAction(
    req: ShopActionRequest,
    currentProfile: PlayerProfile,
  ): Promise<ShopActionResponse> {
    if (this.serverAvailable && this.authenticated) {
      const remote = await fetchJson<ShopActionResponse>('/api/shop/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (remote) {
        return { ...remote, profile: normalizeProfile(remote.profile) };
      }
    }
    return await this.local.shopAction(req, currentProfile);
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
