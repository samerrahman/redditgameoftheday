import type { ShopActionRequest } from '../../shared/api.ts';
import {
  COSMETICS,
  COSMETIC_IDS,
  GACHA_DUPLICATE_COINS,
  GACHA_PULL_COST,
  RARITY_LABELS,
} from '../../shared/shop.ts';
import type { CosmeticSlot, PlayerProfile } from '../../shared/types.ts';
import { WEAPONS, WEAPON_IDS } from '../../shared/weapons.ts';
import { GAME_META } from '../config/theme.ts';
import type { PlatformAdapter } from '../platform/adapter.ts';

export type ShopViewElements = {
  balance: HTMLElement;
  gems: HTMLElement;
  body: HTMLElement;
};

export type ShopViewCallbacks = {
  onProfileChange: (profile: PlayerProfile) => void;
  onNotify: (message: string) => void;
};

let lastPull: { title: string; rarity: string; duplicate: boolean } | null = null;

// The dungeon atlas is a 28-column grid of 16px tiles with 2px gutters.
const ATLAS_URL = './assets/dungeon/dungeon_atlas.png';
const ATLAS_W = 512;
const ATLAS_H = 184;
const ATLAS_COLS = 28;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A pixel-art weapon sprite cut straight from the game's atlas. */
function weaponArt(frame: string, scale: number): HTMLElement {
  const idx = Number(frame.replace('tile_', ''));
  const x = 2 + (idx % ATLAS_COLS) * 18;
  const y = 2 + Math.floor(idx / ATLAS_COLS) * 18;
  const art = el('div', 'weapon-art');
  art.setAttribute('aria-hidden', 'true');
  art.style.inlineSize = `${16 * scale}px`;
  art.style.blockSize = `${16 * scale}px`;
  art.style.backgroundImage = `url(${ATLAS_URL})`;
  art.style.backgroundSize = `${ATLAS_W * scale}px ${ATLAS_H * scale}px`;
  art.style.backgroundPosition = `-${x * scale}px -${y * scale}px`;
  return art;
}

export function renderShopView(
  profile: PlayerProfile,
  adapter: PlatformAdapter,
  els: ShopViewElements,
  callbacks: ShopViewCallbacks,
): void {
  els.balance.textContent = `${profile.coins} ${GAME_META.coinShort}`;
  els.gems.textContent = `${profile.gems} 💎`;

  const run = async (req: ShopActionRequest, successMsg?: string): Promise<void> => {
    const result = await adapter.shopAction(req, profile);
    if (!result.ok) {
      callbacks.onNotify(result.reason ?? 'Cannot do that.');
      return;
    }
    if (req.action === 'gacha_pull' && result.cosmeticId && result.cosmeticId !== 'none') {
      const def = COSMETICS[result.cosmeticId];
      lastPull = {
        title: def.title,
        rarity: RARITY_LABELS[def.rarity],
        duplicate: Boolean(result.duplicate),
      };
    }
    callbacks.onProfileChange(result.profile);
    renderShopView(result.profile, adapter, els, callbacks);
    if (successMsg) callbacks.onNotify(successMsg);
  };

  els.body.replaceChildren(renderWeapons(profile, run), renderCosmetics(profile, run));
}

type RunFn = (req: ShopActionRequest, successMsg?: string) => Promise<void>;

function renderWeapons(profile: PlayerProfile, run: RunFn): HTMLElement {
  const section = el('section', 'shop-section');
  section.appendChild(el('h3', 'shop-section-title', 'Weapons'));
  const grid = el('div', 'weapon-grid');
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    const owned = profile.ownedWeapons.includes(id);
    const equipped = profile.equippedWeapon === id;
    const card = el('article', 'weapon-card');
    if (equipped) card.classList.add('is-equipped');

    const stage = el('div', 'weapon-stage');
    stage.appendChild(weaponArt(w.sprite, 5));

    const name = el('h4', 'weapon-name', w.name);
    const tradeoffs = el('ul', 'weapon-tradeoffs');
    tradeoffs.append(el('li', 'is-pro', `+ ${w.pros}`), el('li', 'is-con', `− ${w.cons}`));

    const btn = el('button', 'shop-buy-btn');
    btn.type = 'button';
    if (equipped) {
      btn.disabled = true;
      btn.textContent = 'Equipped';
    } else if (owned) {
      btn.textContent = 'Equip';
      btn.addEventListener('click', () => {
        void run({ action: 'equip_weapon', weaponId: id });
      });
    } else {
      const affordable = profile.coins >= w.cost;
      btn.disabled = !affordable;
      btn.textContent = `${w.cost} ${GAME_META.coinShort}`;
      btn.addEventListener('click', () => {
        void run({ action: 'buy_weapon', weaponId: id }, `${w.name} equipped`);
      });
    }
    card.append(stage, name, tradeoffs, btn);
    grid.appendChild(card);
  }
  section.appendChild(grid);
  return section;
}

function renderCosmetics(profile: PlayerProfile, run: RunFn): HTMLElement {
  const section = el('section', 'shop-section');
  const ownedCount = COSMETIC_IDS.filter((id) => profile.ownedCosmetics.includes(id)).length;
  const head = el('div', 'shop-section-head');
  head.append(
    el('h3', 'shop-section-title', 'Cosmetics'),
    el('span', 'shop-section-count', `${ownedCount}/${COSMETIC_IDS.length}`),
  );
  section.appendChild(head);

  const pullRow = el('div', 'cosmetic-pull-row');
  const pullBtn = el('button', 'primary-btn gacha-pull-btn');
  pullBtn.type = 'button';
  pullBtn.disabled = profile.gems < GACHA_PULL_COST;
  pullBtn.textContent = `Pull · ${GACHA_PULL_COST} 💎`;
  pullBtn.addEventListener('click', () => {
    void run({ action: 'gacha_pull' });
  });
  pullRow.appendChild(pullBtn);
  if (lastPull) {
    const result = el('div', `gacha-result rarity-${lastPull.rarity.toLowerCase()}`);
    result.textContent = lastPull.duplicate
      ? `${lastPull.title} (dupe +${GACHA_DUPLICATE_COINS} ${GAME_META.coinShort})`
      : `${lastPull.rarity}: ${lastPull.title}`;
    pullRow.appendChild(result);
  }
  section.appendChild(pullRow);

  for (const slot of ['costume', 'accessory'] as const) {
    section.appendChild(renderWardrobeRow(profile, slot, run));
  }
  return section;
}

function renderWardrobeRow(profile: PlayerProfile, slot: CosmeticSlot, run: RunFn): HTMLElement {
  const row = el('div', 'cosmetics-bar');
  row.appendChild(el('span', 'cosmetics-label', slot === 'costume' ? 'Outfit' : 'Hat'));
  const pills = el('div', 'cosmetics-pills');
  const equipped = slot === 'costume' ? profile.equippedCostume : profile.equippedCosmetic;

  const none = el('button', 'cosmetic-pill', 'None');
  none.type = 'button';
  if (equipped === 'none') none.classList.add('is-equipped');
  none.addEventListener('click', () => {
    void run({ action: 'equip_cosmetic', cosmeticId: 'none', slot });
  });
  pills.appendChild(none);

  for (const id of COSMETIC_IDS) {
    const def = COSMETICS[id];
    if (def.slot !== slot) continue;
    const owned = profile.ownedCosmetics.includes(id);
    const pill = el('button', `cosmetic-pill rarity-${def.rarity}`, owned ? def.title : '?');
    pill.type = 'button';
    pill.title = owned ? RARITY_LABELS[def.rarity] : 'Not collected yet';
    if (!owned) {
      pill.disabled = true;
      pill.classList.add('is-locked');
    }
    if (equipped === id) pill.classList.add('is-equipped');
    pill.addEventListener('click', () => {
      void run({ action: 'equip_cosmetic', cosmeticId: id, slot });
    });
    pills.appendChild(pill);
  }
  row.appendChild(pills);
  return row;
}
