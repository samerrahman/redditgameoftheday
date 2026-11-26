import { reddit } from '@devvit/web/server';
import { getUtcDateString } from '../../shared/rng.ts';

export const createPost = async (dateOverride?: string) => {
  const utcDate = getUtcDateString(dateOverride);
  return await reddit.submitCustomPost({
    title: `DUNGEONLE — ${utcDate}`,
    postData: { utcDate },
  });
};
