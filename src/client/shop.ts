import { exitExpandedMode } from '@devvit/web/client';
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
    balance: getEl('shop-balance'),
    gems: getEl('shop-gems'),
    body: getEl('shop-body'),
  };

  renderShopView(profile, adapter, els, {
    onProfileChange: (nextProfile: PlayerProfile) => {
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

}

void initStandaloneShop();
