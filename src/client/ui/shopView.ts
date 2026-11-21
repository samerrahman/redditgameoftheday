import { getDailyShopRotation, COSMETICS } from '../../shared/shop.ts';
import type { CosmeticId, PlayerProfile } from '../../shared/types.ts';
import { GAME_META } from '../config/theme.ts';
import type { PlatformAdapter } from '../platform/adapter.ts';

export type ShopViewElements = {
  dateSub: HTMLElement;
  balance: HTMLElement;
  slotsContainer: HTMLElement;
  cosmeticsContainer: HTMLElement;
};

export type ShopViewCallbacks = {
  onProfileChange: (profile: PlayerProfile) => void;
  onNotify: (message: string) => void;
};

export function renderShopView(
  utcDate: string,
  profile: PlayerProfile,
  adapter: PlatformAdapter,
  els: ShopViewElements,
  callbacks: ShopViewCallbacks,
): void {
  els.dateSub.textContent = `Daily seed ${utcDate} · 3 rotating items · Coins are always kept`;
  els.balance.textContent = `${profile.coins} ${GAME_META.coinShort}`;

  const slots = getDailyShopRotation(utcDate, profile);
  els.slotsContainer.replaceChildren();

  for (const slot of slots) {
    const card = document.createElement('article');
    card.className = 'shop-card';

    const top = document.createElement('div');
    top.className = 'shop-card-top';

    const kicker = document.createElement('div');
    kicker.className = 'shop-card-kicker';
    const subSpan = document.createElement('span');
    subSpan.textContent = slot.subtitle;
    const lvlSpan = document.createElement('span');
    lvlSpan.textContent = slot.levelLabel ?? '';
    kicker.append(subSpan, lvlSpan);

    const title = document.createElement('h3');
    title.className = 'shop-card-title';
    title.textContent = slot.title;
    top.append(kicker, title);

    const desc = document.createElement('p');
    desc.className = 'shop-card-desc';
    desc.textContent = slot.description;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shop-buy-btn';
    const affordable = profile.coins >= slot.cost;
    if (slot.maxed) {
      btn.disabled = true;
      btn.textContent = 'Maxed / Owned';
    } else if (slot.purchased) {
      btn.disabled = true;
      btn.textContent = 'Armed for Next Run';
    } else {
      btn.disabled = !affordable;
      btn.textContent = affordable
        ? `Buy · ${slot.cost} ${GAME_META.coinShort}`
        : `Need ${slot.cost} ${GAME_META.coinShort}`;
    }

    btn.addEventListener('click', () => {
      void (async () => {
        const result = await adapter.buyShopSlot(utcDate, slot.slotIndex, profile);
        if (!result.ok) {
          callbacks.onNotify(result.reason ?? 'Cannot purchase.');
          return;
        }
        callbacks.onProfileChange(result.profile);
        renderShopView(utcDate, result.profile, adapter, els, callbacks);
        callbacks.onNotify(`Unlocked: ${slot.title}`);
      })();
    });

    card.append(top, desc, btn);
    els.slotsContainer.appendChild(card);
  }

  renderCosmeticPills(utcDate, profile, adapter, els, callbacks);
}

function renderCosmeticPills(
  utcDate: string,
  profile: PlayerProfile,
  adapter: PlatformAdapter,
  els: ShopViewElements,
  callbacks: ShopViewCallbacks,
): void {
  els.cosmeticsContainer.replaceChildren();
  for (const cosmeticId of profile.ownedCosmetics) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'cosmetic-pill';
    if (profile.equippedCosmetic === cosmeticId) {
      pill.classList.add('is-equipped');
    }
    pill.textContent = cosmeticId === 'none' ? 'Default' : COSMETICS[cosmeticId].title;
    pill.addEventListener('click', () => {
      void (async () => {
        const nextProfile = await adapter.equipCosmetic(cosmeticId as CosmeticId, profile);
        callbacks.onProfileChange(nextProfile);
        renderCosmeticPills(utcDate, nextProfile, adapter, els, callbacks);
      })();
    });
    els.cosmeticsContainer.appendChild(pill);
  }
}
