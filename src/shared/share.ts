import { RELICS } from './relics.ts';
import { WEAPONS } from './weapons.ts';
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
  const floor = summary.floorReached ?? 1;
  const statusBadge = `REACHED FLOOR ${floor}`;

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
    `> **${statusBadge}** | ${summary.floorsCleared ?? 0} bosses slain | ${summary.roomsCleared ?? 0} rooms | ${formatDuration(summary.elapsedSec)} | ${WEAPONS[summary.weapon ?? 'longsword'].emoji} ${WEAPONS[summary.weapon ?? 'longsword'].name}`,
    `> Modifier: *${modifierBanner}*`,
    `> Build: ${relicLine}`,
    `> +${summary.coinsEarned} ${coinLabel}${(summary.gemsEarned ?? 0) > 0 ? ` | +${summary.gemsEarned} 💎` : ''} | Streak: ${streak}🔥`,
  ].join('\n');
}
