import { context } from '@devvit/web/client';
import { getUtcDateString } from '../../shared/rng.ts';

const UTC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves the UTC date that belongs to the current post:
 * 1. Explicit `?date=YYYY-MM-DD` override (local debugging)
 * 2. `context.postData.utcDate` stamped when the Reddit post was created
 * 3. Server lookup of the post's Reddit creation date for older posts without `postData`
 * 4. Current UTC date fallback
 */
export async function resolvePostUtcDate(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const queryDate = params.get('date');
  if (queryDate && UTC_DATE_RE.test(queryDate)) {
    return getUtcDateString(queryDate);
  }

  const rawPostDate = (context as { postData?: Record<string, unknown> } | undefined)?.postData
    ?.utcDate;
  if (typeof rawPostDate === 'string' && UTC_DATE_RE.test(rawPostDate)) {
    return getUtcDateString(rawPostDate);
  }

  const postId = (context as { postId?: string } | undefined)?.postId;
  if (postId) {
    try {
      const res = await fetch('/api/post-date');
      if (res.ok) {
        const body = (await res.json()) as { utcDate?: unknown };
        if (typeof body.utcDate === 'string' && UTC_DATE_RE.test(body.utcDate)) {
          return getUtcDateString(body.utcDate);
        }
      }
    } catch {
      // Fall back to today's UTC date below.
    }
  }

  return getUtcDateString();
}
