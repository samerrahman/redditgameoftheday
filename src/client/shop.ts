import { exitExpandedMode, requestExpandedMode } from '@devvit/web/client';
import { ENFORCE_SINGLE_DAILY_RUN } from '../shared/buildMeta.ts';
import { hasCompletedDailyRun } from '../shared/profile.ts';
import { getUtcDateString } from '../shared/rng.ts';
import type { PlayerProfile } from '../shared/types.ts';
import { HybridDevvitAdapter } from './platform/adapter.ts';
import { renderShopView } from './ui/shopView.ts';

function getEl(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing DOM element #${id}`);
  return node;
}

function getButton(id: string): HTMLButtonElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLButtonElement)) {
    throw new Error(`Missing HTMLButtonElement #${id}`);
  }
  return node;
}

async function initStandaloneShop(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const utcDate = getUtcDateString(params.get('date'));
  const adapter = new HybridDevvitAdapter();
  const session = await adapter.loadSession(utcDate);

  let profile: PlayerProfile = session.profile;
  const toastEl = getEl('toast');
  let toastTimer: number | null = null;

  const showToast = (message: string): void => {
    adapter.notify(message);
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
    }, 2600);
  };

  const els = {
    dateSub: getEl('shop-date-sub'),
    balance: getEl('shop-balance'),
    slotsContainer: getEl('shop-slots'),
    cosmeticsContainer: getEl('shop-cosmetics'),
  };

  renderShopView(utcDate, profile, adapter, els, {
    onProfileChange: (nextProfile) => {
      profile = nextProfile;
    },
    onNotify: showToast,
  });

  const backBtn = getButton('shop-back-btn');
  backBtn.addEventListener('click', (event) => {
    try {
      exitExpandedMode(event);
    } catch {
      if (window.history.length > 1) {
        window.history.back();
      }
    }
  });

  const playBtn = getButton('shop-play-btn');
  if (ENFORCE_SINGLE_DAILY_RUN && hasCompletedDailyRun(profile, utcDate)) {
    playBtn.classList.add('is-completed');
    const playLabel = document.getElementById('shop-play-label');
    if (playLabel) {
      playLabel.textContent = 'VIEW RESULTS';
    }
  }
  playBtn.addEventListener('click', (event) => {
    try {
      requestExpandedMode(event, 'game');
    } catch {
      // Standalone non-Devvit fallback ignored
    }
  });
}

void initStandaloneShop();
