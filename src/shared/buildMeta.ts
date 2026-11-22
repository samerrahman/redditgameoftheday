export const ENFORCE_SINGLE_DAILY_RUN: boolean = false;

export const DEV_RESET_USERNAME = 'Mental_Glove6343';

const UNBUILT_PREFIX = '__DUNGEONLE_';
export const BUILD_ID = '__DUNGEONLE_BUILD_ID__';

export function isStampedBuildId(buildId: string): boolean {
  return buildId.length > 0 && !buildId.startsWith(UNBUILT_PREFIX);
}

export function isDevResetAccount(username: string | undefined | null): boolean {
  if (!username) return false;
  return username.trim().toLowerCase() === DEV_RESET_USERNAME.toLowerCase();
}
