import type {
  CosmeticId,
  DailyLeaderboardEntry,
  PlayerProfile,
  RunSummary,
} from './types.ts';

export type ProfileResponse = {
  profile: PlayerProfile;
  leaderboard: DailyLeaderboardEntry[];
  username: string;
  subredditName: string;
  authenticated: boolean;
};

export type { ShopAction as ShopActionRequest } from './shop.ts';

export type ShopActionResponse = {
  ok: boolean;
  profile: PlayerProfile;
  reason?: string | undefined;
  cosmeticId?: CosmeticId | undefined;
  duplicate?: boolean | undefined;
};

export type RunCompleteRequest = {
  summary: RunSummary;
};

export type RunCompleteResponse = {
  profile: PlayerProfile;
  leaderboard: DailyLeaderboardEntry[];
};

export type ShareCommentRequest = {
  markdown: string;
};

export type ShareCommentResponse = {
  ok: boolean;
  method: 'reddit' | 'clipboard';
  message: string;
};

export type SubscribeResponse = {
  subscribed: boolean;
};
