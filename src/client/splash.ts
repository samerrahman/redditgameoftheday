import { requestExpandedMode } from '@devvit/web/client';
import { ENFORCE_SINGLE_DAILY_RUN } from '../shared/buildMeta.ts';
import { getDailyModifier } from '../shared/modifiers.ts';
import { hasCompletedDailyRun } from '../shared/profile.ts';
import { formatTimeUntilNextUtcDay, getUtcDateString } from '../shared/rng.ts';
import { GAME_META, getDailyTheme } from './config/theme.ts';
import { HybridDevvitAdapter } from './platform/adapter.ts';

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

async function initSplash(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const utcDate = getUtcDateString(params.get('date'));
  const theme = getDailyTheme(utcDate);
  const modifier = getDailyModifier(utcDate);

  setText('splash-date', utcDate);
  setText('splash-dungeon', theme.name);
  setText('splash-modifier', modifier.banner);

  const playButton = document.getElementById('play-button');
  if (playButton) {
    playButton.addEventListener('click', (event) => {
      try {
        requestExpandedMode(event, 'game');
      } catch {
        // Standalone non-Devvit fallback ignored
      }
    });
  }

  const shopButton = document.getElementById('splash-shop-btn');
  if (shopButton) {
    shopButton.addEventListener('click', (event) => {
      try {
        requestExpandedMode(event, 'shop');
      } catch {
        // Standalone non-Devvit fallback ignored
      }
    });
  }

  const adapter = new HybridDevvitAdapter();
  const session = await adapter.loadSession(utcDate);
  const best = session.profile.dailyBest[utcDate];

  setText('splash-streak', `${session.profile.streak}🔥`);
  setText('splash-coins', session.profile.bestFloor > 0 ? `F${session.profile.bestFloor}` : '—');
  setText('splash-shop-coins', `${session.profile.coins} ${GAME_META.coinShort}`);
  setText('splash-best', best ? `F${best.bestFloor ?? 1}` : '—');

  if (ENFORCE_SINGLE_DAILY_RUN && hasCompletedDailyRun(session.profile, utcDate)) {
    setText('play-button-label', 'VIEW RESULTS');
    playButton?.classList.add('is-completed');
    const dailyNote = document.getElementById('splash-daily-note');
    if (dailyNote) {
      dailyNote.hidden = false;
      const updateCountdown = (): void => {
        dailyNote.textContent = `Daily complete · Next dungeon in ${formatTimeUntilNextUtcDay()}`;
      };
      updateCountdown();
      window.setInterval(updateCountdown, 1000);
    }
  }
}

void initSplash();
