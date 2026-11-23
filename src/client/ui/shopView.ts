import type { ShopActionRequest } from '../../shared/api.ts';
import {
  COSMETICS,
  COSMETIC_IDS,
  GACHA_DUPLICATE_COINS,
  GACHA_PULL_COST,
  RARITY_LABELS,
  isCosmeticId,
} from '../../shared/shop.ts';
import type { AccessoryId, CosmeticId, CosmeticSlot, CostumeId, PlayerProfile } from '../../shared/types.ts';
import { WEAPONS, WEAPON_IDS } from '../../shared/weapons.ts';
import { GAME_META } from '../config/theme.ts';
import type { PlatformAdapter } from '../platform/adapter.ts';
import { animateHero, drawHeroStill, type HeroLook } from './heroPreview.ts';

export type ShopViewElements = {
  balance: HTMLElement;
  gems: HTMLElement;
  body: HTMLElement;
};

export type ShopViewCallbacks = {
  onProfileChange: (profile: PlayerProfile) => void;
  onNotify: (message: string) => void;
};

type ShopTab = 'weapons' | 'cosmetics';
let activeTab: ShopTab = 'weapons';
let pulling = false;

// The dungeon atlas is a 28-column grid of 16px tiles with 2px gutters.
const ATLAS_URL = './assets/dungeon/dungeon_atlas.png';
const ATLAS_W = 512;
const ATLAS_H = 236;
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

function lookOf(profile: PlayerProfile): HeroLook {
  return { costume: profile.equippedCostume, accessory: profile.equippedCosmetic };
}

function lookWith(base: HeroLook, id: AccessoryId | CostumeId): HeroLook {
  return COSMETICS[id].slot === 'costume' ? { ...base, costume: id } : { ...base, accessory: id };
}

export function renderShopView(
  profile: PlayerProfile,
  adapter: PlatformAdapter,
  els: ShopViewElements,
  callbacks: ShopViewCallbacks,
): void {
  els.balance.textContent = `${profile.coins} ${GAME_META.coinShort}`;
  els.gems.textContent = `${profile.gems}`;

  const apply = (next: PlayerProfile): void => {
    callbacks.onProfileChange(next);
    renderShopView(next, adapter, els, callbacks);
  };

  const run = async (req: ShopActionRequest, successMsg?: string): Promise<void> => {
    const result = await adapter.shopAction(req, profile);
    if (!result.ok) {
      callbacks.onNotify(result.reason ?? 'Cannot do that.');
      return;
    }
    apply(result.profile);
    if (successMsg) callbacks.onNotify(successMsg);
  };

  const pull = async (): Promise<void> => {
    if (pulling) return;
    pulling = true;
    const result = await adapter.shopAction({ action: 'gacha_pull' }, profile);
    if (!result.ok || !result.cosmeticId || result.cosmeticId === 'none') {
      pulling = false;
      callbacks.onNotify(result.reason ?? 'Pull failed.');
      return;
    }
    const won = result.cosmeticId;
    // Update balances right away, but keep the reveal on screen until dismissed.
    callbacks.onProfileChange(result.profile);
    els.gems.textContent = `${result.profile.gems}`;
    els.balance.textContent = `${result.profile.coins} ${GAME_META.coinShort}`;
    showPullReveal(els.body, won, Boolean(result.duplicate), lookOf(profile), () => {
      pulling = false;
      apply(result.profile);
    });
  };

  const tabs = el('div', 'shop-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const tab of ['weapons', 'cosmetics'] as const) {
    const btn = el('button', 'shop-tab', tab === 'weapons' ? 'Weapons' : 'Cosmetics');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(tab === activeTab));
    if (tab === activeTab) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      activeTab = tab;
      renderShopView(profile, adapter, els, callbacks);
    });
    tabs.appendChild(btn);
  }

  const panel =
    activeTab === 'weapons' ? renderWeapons(profile, run) : renderCosmetics(profile, run, pull);
  els.body.replaceChildren(tabs, panel);
}

type RunFn = (req: ShopActionRequest, successMsg?: string) => Promise<void>;

function renderWeapons(profile: PlayerProfile, run: RunFn): HTMLElement {
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
      btn.classList.add('is-equipped-btn');
      btn.textContent = 'Equipped';
    } else if (owned) {
      btn.classList.add('is-equip-btn');
      btn.textContent = 'Equip';
      btn.addEventListener('click', () => {
        void run({ action: 'equip_weapon', weaponId: id });
      });
    } else {
      btn.disabled = profile.coins < w.cost;
      btn.textContent = `Buy · ${w.cost} ${GAME_META.coinShort}`;
      btn.addEventListener('click', () => {
        void run({ action: 'buy_weapon', weaponId: id }, `${w.name} equipped`);
      });
    }
    card.append(stage, name, tradeoffs, btn);
    grid.appendChild(card);
  }
  return grid;
}

function renderCosmetics(profile: PlayerProfile, run: RunFn, pull: () => Promise<void>): HTMLElement {
  const wrap = el('div', 'cosmetics-layout');

  // Left: live character preview + pull button
  const side = el('div', 'cosmetic-preview-col');
  const canvas = el('canvas', 'hero-preview');
  canvas.width = 180;
  canvas.height = 180;
  animateHero(canvas, lookOf(profile));
  const ownedCount = COSMETIC_IDS.filter((id) => profile.ownedCosmetics.includes(id)).length;
  const pullBtn = el('button', 'primary-btn gacha-pull-btn pixel-stat');
  pullBtn.type = 'button';
  pullBtn.disabled = profile.gems < GACHA_PULL_COST;
  pullBtn.textContent = `Pull · ${GACHA_PULL_COST}`;
  const gemIcon = el('img', 'stat-icon');
  gemIcon.src = './assets/icons/gem.svg';
  gemIcon.alt = '';
  gemIcon.width = 16;
  gemIcon.height = 16;
  pullBtn.appendChild(gemIcon);
  pullBtn.setAttribute('aria-label', `Pull for ${GACHA_PULL_COST} gems`);
  pullBtn.addEventListener('click', () => {
    void pull();
  });
  side.append(canvas, pullBtn, el('span', 'shop-section-count', `${ownedCount}/${COSMETIC_IDS.length} collected`));

  // Right: wardrobe rows
  const rows = el('div', 'wardrobe-col');
  for (const slot of ['costume', 'accessory'] as const) {
    rows.appendChild(renderWardrobeRow(profile, slot, run));
  }

  wrap.append(side, rows);
  return wrap;
}

function renderWardrobeRow(profile: PlayerProfile, slot: CosmeticSlot, run: RunFn): HTMLElement {
  const row = el('div', 'wardrobe-row');
  row.appendChild(el('h4', 'wardrobe-label', slot === 'costume' ? 'Outfit' : 'Hat'));
  const grid = el('div', 'wardrobe-grid');
  const equipped: CosmeticId = slot === 'costume' ? profile.equippedCostume : profile.equippedCosmetic;
  const base = lookOf(profile);

  const makeTile = (id: CosmeticId, owned: boolean, label: string, rarityClass: string): HTMLButtonElement => {
    const tile = el('button', `wardrobe-tile ${rarityClass}`);
    tile.type = 'button';
    if (equipped === id) tile.classList.add('is-equipped');
    if (!owned) {
      tile.disabled = true;
      tile.classList.add('is-locked');
    }
    const thumb = el('canvas', 'wardrobe-thumb');
    thumb.width = 64;
    thumb.height = 64;
    if (owned) {
      const look: HeroLook = isCosmeticId(id)
        ? lookWith(base, id)
        : slot === 'costume'
          ? { ...base, costume: 'none' }
          : { ...base, accessory: 'none' };
      drawHeroStill(thumb, look);
    }
    tile.append(thumb, el('span', 'wardrobe-name', owned ? label : '?'));
    tile.addEventListener('click', () => {
      void run({ action: 'equip_cosmetic', cosmeticId: id, slot });
    });
    return tile;
  };

  grid.appendChild(makeTile('none', true, 'None', ''));
  for (const id of COSMETIC_IDS) {
    const def = COSMETICS[id];
    if (def.slot !== slot) continue;
    grid.appendChild(
      makeTile(id, profile.ownedCosmetics.includes(id), def.title, `rarity-${def.rarity}`),
    );
  }
  row.appendChild(grid);
  return row;
}

/** Slot-machine reel that spins through cosmetics, lands on the prize, then reveals it. */
function showPullReveal(
  host: HTMLElement,
  won: AccessoryId | CostumeId,
  duplicate: boolean,
  baseLook: HeroLook,
  onDone: () => void,
): void {
  const overlay = el('div', 'pull-overlay');
  const reelWindow = el('div', 'pull-reel-window');
  const reel = el('div', 'pull-reel');
  const CARD = 116; // px incl. gap; keep in sync with CSS
  const WIN_INDEX = 28;
  const cards: Array<AccessoryId | CostumeId> = [];
  for (let i = 0; i < WIN_INDEX + 4; i += 1) {
    cards.push(i === WIN_INDEX ? won : COSMETIC_IDS[Math.floor(Math.random() * COSMETIC_IDS.length)]!);
  }
  for (const id of cards) {
    const def = COSMETICS[id];
    const card = el('div', `pull-card rarity-${def.rarity}`);
    const c = el('canvas', 'pull-card-hero');
    c.width = 72;
    c.height = 72;
    drawHeroStill(c, lookWith(baseLook, id));
    card.append(c, el('span', 'pull-card-name', def.title));
    reel.appendChild(card);
  }
  reelWindow.append(reel, el('div', 'pull-marker'));
  overlay.appendChild(reelWindow);
  host.appendChild(overlay);

  // Start offset so the winning card ends centred in the window.
  requestAnimationFrame(() => {
    const winW = reelWindow.clientWidth;
    const jitter = (Math.random() - 0.5) * (CARD * 0.5);
    const target = WIN_INDEX * CARD + CARD / 2 - winW / 2 + jitter;
    reel.style.transform = 'translateX(0px)';
    requestAnimationFrame(() => {
      reel.style.transition = 'transform 2.6s cubic-bezier(0.12, 0.8, 0.18, 1)';
      reel.style.transform = `translateX(-${target}px)`;
    });
  });

  reel.addEventListener(
    'transitionend',
    () => {
      const def = COSMETICS[won];
      const reveal = el('div', `pull-reveal rarity-${def.rarity}`);
      const big = el('canvas', 'hero-preview');
      big.width = 180;
      big.height = 180;
      animateHero(big, lookWith(baseLook, won));
      const ok = el('button', 'primary-btn', 'Nice!');
      ok.type = 'button';
      ok.addEventListener('click', () => {
        overlay.remove();
        onDone();
      });
      reveal.append(
        el('span', 'pull-rarity', RARITY_LABELS[def.rarity]),
        big,
        el('strong', 'pull-title', def.title),
        el(
          'span',
          'pull-sub',
          duplicate ? `Duplicate · +${GACHA_DUPLICATE_COINS} ${GAME_META.coinShort}` : 'New! Equipped',
        ),
        ok,
      );
      reelWindow.classList.add('is-done');
      overlay.appendChild(reveal);
      ok.focus();
    },
    { once: true },
  );
}
