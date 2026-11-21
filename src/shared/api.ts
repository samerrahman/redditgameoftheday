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

export type ShopPurchaseRequest = {
  utcDate: string;
  slotIndex: 0 | 1 | 2;
};

export type ShopPurchaseResponse = {
  ok: boolean;
  profile: PlayerProfile;
  reason?: string | undefined;
};

export type CosmeticEquipRequest = {
  cosmeticId: CosmeticId;
};

export type CosmeticEquipResponse = {
  profile: PlayerProfile;
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
