import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type {
  CosmeticEquipRequest,
  CosmeticEquipResponse,
  ProfileResponse,
  RunCompleteRequest,
  RunCompleteResponse,
  ShareCommentRequest,
  ShareCommentResponse,
  ShopPurchaseRequest,
  ShopPurchaseResponse,
  SubscribeResponse,
} from '../../shared/api.ts';
import {
  BUILD_ID,
  ENFORCE_SINGLE_DAILY_RUN,
  isDevResetAccount,
  isStampedBuildId,
} from '../../shared/buildMeta.ts';
import {
  applyRunToProfile,
  clearDailyRun,
  createDefaultProfile,
  hasCompletedDailyRun,
  normalizeProfile,
} from '../../shared/profile.ts';
import { getUtcDateString } from '../../shared/rng.ts';
import { getDailyShopRotation, purchaseShopSlot } from '../../shared/shop.ts';
import type {
  DailyLeaderboardEntry,
  PlayerProfile,
} from '../../shared/types.ts';

type ErrorResponse = {
  status: 'error';
  message: string;
};

const PROFILE_KEY_PREFIX = 'dungeonle:profile:';
const LB_KEY_PREFIX = 'dungeonle:lb:';
const LBMETA_KEY_PREFIX = 'dungeonle:lbmeta:';
const DEV_RESET_KEY_PREFIX = 'dungeonle:devreset:';

async function loadUserProfile(userId: string | undefined): Promise<PlayerProfile> {
  if (!userId) return createDefaultProfile();
  const raw = await redis.get(`${PROFILE_KEY_PREFIX}${userId}`);
  if (!raw) return createDefaultProfile();
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
    return normalizeProfile(parsed);
  } catch {
    return createDefaultProfile();
  }
}

async function saveUserProfile(userId: string, profile: PlayerProfile): Promise<void> {
  await redis.set(`${PROFILE_KEY_PREFIX}${userId}`, JSON.stringify(profile));
}

async function loadDailyLeaderboard(utcDate: string): Promise<DailyLeaderboardEntry[]> {
  const lbKey = `${LB_KEY_PREFIX}${utcDate}`;
  const metaKey = `${LBMETA_KEY_PREFIX}${utcDate}`;
  const rows = await redis.zRange(lbKey, 0, 4, { by: 'rank', reverse: true });
  if (rows.length === 0) return [];

  const members = rows.map((r) => r.member);
  const rawEntries = await redis.hMGet(metaKey, members);
  const entries: DailyLeaderboardEntry[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const raw = rawEntries[i];
    if (!row || !raw) continue;
    try {
      const parsed = JSON.parse(raw) as DailyLeaderboardEntry;
      entries.push(parsed);
    } catch {
      entries.push({
        player: row.member,
        roomReached: 1,
        elapsedSec: 0,
        extracted: false,
        score: Math.round(row.score),
      });
    }
  }
  return entries;
}

function computeLeaderboardScore(entry: DailyLeaderboardEntry): number {
  const extractTier = entry.extracted ? 1 : 0;
  return (
    entry.roomReached * 1_000_000_000 +
    extractTier * 100_000_000 +
    Math.min(99_999, Math.max(0, entry.score)) * 1000 +
    Math.max(0, 999 - Math.floor(entry.elapsedSec))
  );
}

export const api = new Hono();

api.get('/profile', async (c) => {
  const utcDate = getUtcDateString(c.req.query('date'));
  const rawClientBuild = c.req.query('build') ?? '';
  const clientBuild = /^[a-zA-Z0-9_-]{1,64}$/.test(rawClientBuild) ? rawClientBuild : '';
  const { userId, subredditName } = context;

  try {
    const [loadedProfile, username] = await Promise.all([
      loadUserProfile(userId),
      userId ? reddit.getCurrentUsername() : Promise.resolve(undefined),
    ]);

    let profile = loadedProfile;
    if (ENFORCE_SINGLE_DAILY_RUN && userId && isDevResetAccount(username)) {
      const stampParts: string[] = [];
      if (isStampedBuildId(BUILD_ID)) {
        stampParts.push(BUILD_ID);
      }
      if (clientBuild && isStampedBuildId(clientBuild)) {
        stampParts.push(clientBuild);
      }
      const activeBuildStamp = stampParts.join(':');
      if (activeBuildStamp.length > 0) {
        const resetKey = `${DEV_RESET_KEY_PREFIX}${userId}:${utcDate}`;
        const prevStamp = await redis.get(resetKey);
        if (prevStamp !== activeBuildStamp) {
          const cleared = clearDailyRun(profile, utcDate);
          const lbKey = `${LB_KEY_PREFIX}${utcDate}`;
          const metaKey = `${LBMETA_KEY_PREFIX}${utcDate}`;
          await Promise.all([
            saveUserProfile(userId, cleared),
            redis.zRem(lbKey, [userId]),
            redis.hDel(metaKey, [userId]),
            redis.set(resetKey, activeBuildStamp),
          ]);
          profile = cleared;
        }
      }
    }

    const leaderboard = await loadDailyLeaderboard(utcDate);

    return c.json<ProfileResponse>({
      profile,
      leaderboard,
      username: username ?? 'anonymous',
      subredditName: subredditName ?? 'dungeonle',
      authenticated: Boolean(userId),
    });
  } catch (error) {
    console.error('Failed to load profile:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to load profile' }, 500);
  }
});

api.post('/shop/purchase', async (c) => {
  const { userId } = context;
  if (!userId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Sign in required' }, 401);
  }

  try {
    const body = await c.req.json<ShopPurchaseRequest>();
    const utcDate = getUtcDateString(body.utcDate);
    const profile = await loadUserProfile(userId);
    const rotation = getDailyShopRotation(utcDate, profile);
    const slot = rotation[body.slotIndex];
    if (!slot) {
      return c.json<ShopPurchaseResponse>(
        { ok: false, profile, reason: 'Invalid shop slot.' },
        400,
      );
    }

    const result = purchaseShopSlot(profile, slot);
    if (!result.ok) {
      return c.json<ShopPurchaseResponse>(result, 200);
    }

    await saveUserProfile(userId, result.profile);
    return c.json<ShopPurchaseResponse>(result, 200);
  } catch (error) {
    console.error('Shop purchase failed:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Shop purchase failed' }, 500);
  }
});

api.post('/profile/cosmetic', async (c) => {
  const { userId } = context;
  if (!userId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Sign in required' }, 401);
  }

  try {
    const body = await c.req.json<CosmeticEquipRequest>();
    const profile = await loadUserProfile(userId);
    if (!profile.ownedCosmetics.includes(body.cosmeticId)) {
      return c.json<ErrorResponse>({ status: 'error', message: 'Cosmetic not owned' }, 400);
    }
    const updated: PlayerProfile = {
      ...profile,
      equippedCosmetic: body.cosmeticId,
    };
    await saveUserProfile(userId, updated);
    return c.json<CosmeticEquipResponse>({ profile: updated }, 200);
  } catch (error) {
    console.error('Cosmetic equip failed:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Cosmetic equip failed' }, 500);
  }
});

api.post('/run/complete', async (c) => {
  const { userId } = context;

  try {
    const body = await c.req.json<RunCompleteRequest>();
    const summary = body.summary;
    const utcDate = getUtcDateString(summary.utcDate);

    if (!userId) {
      const leaderboard = await loadDailyLeaderboard(utcDate);
      return c.json<RunCompleteResponse>({
        profile: applyRunToProfile(createDefaultProfile(), summary),
        leaderboard,
      });
    }

    const [profile, username] = await Promise.all([
      loadUserProfile(userId),
      reddit.getCurrentUsername(),
    ]);
    if (ENFORCE_SINGLE_DAILY_RUN && hasCompletedDailyRun(profile, utcDate)) {
      const leaderboard = await loadDailyLeaderboard(utcDate);
      return c.json<RunCompleteResponse>({ profile, leaderboard });
    }
    const updated = applyRunToProfile(profile, summary);
    await saveUserProfile(userId, updated);

    const displayUser = username ? `u/${username}` : 'Redditor';
    const entry: DailyLeaderboardEntry = {
      player: displayUser,
      roomReached: summary.roomReached,
      progressPct: summary.progressPct,
      elapsedSec: summary.elapsedSec,
      extracted: summary.outcome === 'extracted',
      score: summary.score,
    };
    const composite = computeLeaderboardScore(entry);
    const lbKey = `${LB_KEY_PREFIX}${utcDate}`;
    const metaKey = `${LBMETA_KEY_PREFIX}${utcDate}`;

    const prevScore = await redis.zScore(lbKey, userId);
    if (prevScore === undefined || composite > prevScore) {
      await Promise.all([
        redis.zAdd(lbKey, { member: userId, score: composite }),
        redis.hSet(metaKey, { [userId]: JSON.stringify(entry) }),
      ]);
    }

    const leaderboard = await loadDailyLeaderboard(utcDate);
    return c.json<RunCompleteResponse>({ profile: updated, leaderboard });
  } catch (error) {
    console.error('Run complete failed:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to save run' }, 500);
  }
});

api.post('/share-comment', async (c) => {
  const { postId, userId } = context;
  if (!userId || !postId) {
    return c.json<ShareCommentResponse>(
      {
        ok: false,
        method: 'clipboard',
        message: 'Sign in inside Reddit to post comments directly.',
      },
      401,
    );
  }

  try {
    const body = await c.req.json<ShareCommentRequest>();
    await reddit.submitComment({
      id: postId,
      text: body.markdown,
      runAs: 'USER',
    });
    return c.json<ShareCommentResponse>({
      ok: true,
      method: 'reddit',
      message: 'Posted run summary to post comments!',
    });
  } catch (error) {
    console.error('Submit comment failed:', error);
    return c.json<ShareCommentResponse>(
      {
        ok: false,
        method: 'clipboard',
        message: 'Could not post comment automatically.',
      },
      400,
    );
  }
});

api.post('/subscribe', async (c) => {
  const { userId } = context;
  if (!userId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Sign in required' }, 401);
  }

  try {
    await reddit.subscribeToCurrentSubreddit();
    const profile = await loadUserProfile(userId);
    const updated: PlayerProfile = { ...profile, subscribed: true };
    await saveUserProfile(userId, updated);
    return c.json<SubscribeResponse>({ subscribed: true });
  } catch (error) {
    console.error('Subscribe failed:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Subscribe failed' }, 500);
  }
});
