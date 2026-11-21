import { RELICS } from './relics.ts';
import type { RelicId, RunSummary } from './types.ts';

export function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatShareComment(
  summary: RunSummary,
  dungeonName: string,
  modifierBanner: string,
  coinLabel: string,
  streak = 1,
): string {
  const statusBadge =
    summary.outcome === 'extracted'
      ? summary.roomReached > (summary.totalRooms ?? 5)
        ? 'EXTRACTED (ENDLESS)'
        : 'CLEARED & EXTRACTED'
      : `DIED IN ROOM ${summary.roomReached}`;

  const pct = summary.progressPct ?? 0;

  const relicEntries = (Object.keys(summary.relics) as RelicId[])
    .filter((id) => (summary.relics[id] ?? 0) > 0)
    .map((id) => {
      const level = summary.relics[id] ?? 0;
      const def = RELICS[id];
      return `${def.emoji} ${def.shortTag}${level > 1 ? ` x${level}` : ''}`;
    });

  const relicLine = relicEntries.length > 0 ? relicEntries.join(' · ') : 'No Relics';

  return [
    `**DUNGEONLE ${summary.utcDate}** — *${dungeonName}*`,
    `> **${statusBadge}** | ${pct}% Progress | Room ${summary.roomReached} | ${formatDuration(summary.elapsedSec)} | ${Math.round(summary.damageTaken)} DMG Taken`,
    `> Modifier: *${modifierBanner}*`,
    `> Build: ${relicLine}`,
    `> +${summary.coinsEarned} ${coinLabel} | Streak: ${streak}🔥`,
  ].join('\n');
}
