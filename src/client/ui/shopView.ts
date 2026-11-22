import type { ShopActionRequest } from '../../shared/api.ts';
import { RELICS } from '../../shared/relics.ts';
import {
  COSMETICS,
  COSMETIC_IDS,
  GACHA_DUPLICATE_COINS,
  GACHA_PULL_COST,
  RARITY_LABELS,
  RARITY_WEIGHTS,
  RELIC_UNLOCK_COST,
  getLockedRelics,
} from '../../shared/shop.ts';
import type { CosmeticSlot, PlayerProfile } from '../../shared/types.ts';
import { WEAPONS, WEAPON_IDS } from '../../shared/weapons.ts';
import { GAME_META } from '../config/theme.ts';
import type { PlatformAdapter } from '../platform/adapter.ts';

export type ShopViewElements = {
  balance: HTMLElement;
  gems: HTMLElement;
  tabs: HTMLElement;
  body: HTMLElement;
};

export type ShopViewCallbacks = {
  onProfileChange: (profile: PlayerProfile) => void;
  onNotify: (message: string) => void;
};

export type ShopTab = 'armory' | 'relics' | 'gacha';

const TAB_LABELS: Record<ShopTab, string> = {
  armory: '⚔️ Armory',
  relics: '📜 Relics',
  gacha: '💎 Gacha',
};

let activeTab: ShopTab = 'armory';
let lastPull: { title: string; rarity: string; duplicate: boolean } | null = null;

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

export function renderShopView(
  profile: PlayerProfile,
  adapter: PlatformAdapter,
  els: ShopViewElements,
  callbacks: ShopViewCallbacks,
): void {
  els.balance.textContent = `${profile.coins} ${GAME_META.coinShort}`;
  els.gems.textContent = `${profile.gems} 💎`;

  const rerender = (next: PlayerProfile): void => {
    callbacks.onProfileChange(next);
    renderShopView(next, adapter, els, callbacks);
  };

  const run = async (req: ShopActionRequest, successMsg?: (p: PlayerProfile) => string) => {
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
    rerender(result.profile);
    if (successMsg) callbacks.onNotify(successMsg(result.profile));
  };

  // Tabs
  els.tabs.replaceChildren();
  for (const tab of ['armory', 'relics', 'gacha'] as const) {
    const btn = el('button', 'shop-tab', TAB_LABELS[tab]);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(tab === activeTab));
    if (tab === activeTab) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      activeTab = tab;
      renderShopView(profile, adapter, els, callbacks);
    });
    els.tabs.appendChild(btn);
  }

  els.body.replaceChildren();
  if (activeTab === 'armory') renderArmory(profile, els.body, run);
  else if (activeTab === 'relics') renderRelics(profile, els.body, run);
  else renderGacha(profile, els.body, run);
}

type RunFn = (req: ShopActionRequest, successMsg?: (p: PlayerProfile) => string) => Promise<void>;

function renderArmory(profile: PlayerProfile, body: HTMLElement, run: RunFn): void {
  body.appendChild(
    el(
      'p',
      'shop-intro muted-copy',
      'Weapons change how you play — none is strictly better. Buy once, swap any time.',
    ),
  );
  const grid = el('div', 'shop-grid');
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    const owned = profile.ownedWeapons.includes(id);
    const equipped = profile.equippedWeapon === id;
    const card = el('article', 'shop-card weapon-card');
    if (equipped) card.classList.add('is-equipped');

    const top = el('div', 'shop-card-top');
    const kicker = el('div', 'shop-card-kicker');
    kicker.append(
      el('span', '', w.style === 'melee' ? 'Melee' : 'Ranged'),
      el('span', '', equipped ? 'Equipped' : owned ? 'Owned' : `${w.cost} ${GAME_META.coinShort}`),
    );
    top.append(kicker, el('h3', 'shop-card-title', `${w.emoji} ${w.name}`));

    const desc = el('p', 'shop-card-desc', w.tagline);
    const tradeoffs = el('ul', 'weapon-tradeoffs');
    tradeoffs.append(el('li', 'is-pro', `+ ${w.pros}`), el('li', 'is-con', `− ${w.cons}`));

    const btn = el('button', 'shop-buy-btn');
    btn.type = 'button';
    if (equipped) {
      btn.disabled = true;
      btn.textContent = 'Equipped ✓';
    } else if (owned) {
      btn.textContent = 'Equip';
      btn.addEventListener('click', () => {
        void run({ action: 'equip_weapon', weaponId: id }, () => `Equipped ${w.name}`);
      });
    } else {
      const affordable = profile.coins >= w.cost;
      btn.disabled = !affordable;
      btn.textContent = affordable
        ? `Buy · ${w.cost} ${GAME_META.coinShort}`
        : `Need ${w.cost} ${GAME_META.coinShort}`;
      btn.addEventListener('click', () => {
        void run({ action: 'buy_weapon', weaponId: id }, () => `Bought & equipped ${w.name}!`);
      });
    }
    card.append(top, desc, tradeoffs, btn);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function renderRelics(profile: PlayerProfile, body: HTMLElement, run: RunFn): void {
  body.appendChild(
    el(
      'p',
      'shop-intro muted-copy',
      'Relics are the upgrades you draft between rooms. Unlocking one adds it to the pool you can draft from.',
    ),
  );
  const locked = getLockedRelics(profile);
  const grid = el('div', 'shop-grid');
  const ids = [...profile.unlockedRelics, ...locked];
  for (const id of ids) {
    const def = RELICS[id];
    if (!def) continue;
    const unlocked = profile.unlockedRelics.includes(id);
    const card = el('article', 'shop-card relic-card');
    if (unlocked) card.classList.add('is-owned');
    const top = el('div', 'shop-card-top');
    const kicker = el('div', 'shop-card-kicker');
    kicker.append(
      el('span', '', def.category === 'blade' ? 'Blade Relic' : 'Arcane Relic'),
      el('span', '', unlocked ? (def.starter ? 'Starter' : 'Unlocked') : 'Locked'),
    );
    top.append(kicker, el('h3', 'shop-card-title', `${def.emoji} ${def.name}`));
    const desc = el('p', 'shop-card-desc', def.summary(1));
    card.append(top, desc);
    if (!unlocked) {
      const btn = el('button', 'shop-buy-btn');
      btn.type = 'button';
      const affordable = profile.coins >= RELIC_UNLOCK_COST;
      btn.disabled = !affordable;
      btn.textContent = affordable
        ? `Unlock · ${RELIC_UNLOCK_COST} ${GAME_META.coinShort}`
        : `Need ${RELIC_UNLOCK_COST} ${GAME_META.coinShort}`;
      btn.addEventListener('click', () => {
        void run({ action: 'unlock_relic', relicId: id }, () => `${def.name} added to drafts!`);
      });
      card.appendChild(btn);
    }
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function renderGacha(profile: PlayerProfile, body: HTMLElement, run: RunFn): void {
  const machine = el('section', 'gacha-machine');
  machine.append(
    el('h3', 'gacha-title', '💎 Costume Gacha'),
    el(
      'p',
      'muted-copy',
      `Gems drop rarely from monsters. ${GACHA_PULL_COST} gems = 1 pull for a random costume or accessory. Purely cosmetic. Duplicates refund ${GACHA_DUPLICATE_COINS} ${GAME_META.coinShort}.`,
    ),
  );
  const odds = el('p', 'gacha-odds mono');
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  odds.textContent = (['common', 'rare', 'epic'] as const)
    .map((r) => `${RARITY_LABELS[r]} ${Math.round((RARITY_WEIGHTS[r] / total) * 100)}%`)
    .join(' · ');
  machine.appendChild(odds);

  if (lastPull) {
    const result = el('div', `gacha-result rarity-${lastPull.rarity.toLowerCase()}`);
    result.textContent = lastPull.duplicate
      ? `${lastPull.rarity}: ${lastPull.title} (duplicate · +${GACHA_DUPLICATE_COINS} ${GAME_META.coinShort})`
      : `✨ ${lastPull.rarity}: ${lastPull.title}!`;
    machine.appendChild(result);
  }

  const pullBtn = el('button', 'primary-btn gacha-pull-btn');
  pullBtn.type = 'button';
  const canPull = profile.gems >= GACHA_PULL_COST;
  pullBtn.disabled = !canPull;
  pullBtn.textContent = canPull
    ? `PULL · ${GACHA_PULL_COST} 💎`
    : `Need ${GACHA_PULL_COST} 💎 (have ${profile.gems})`;
  pullBtn.addEventListener('click', () => {
    void run({ action: 'gacha_pull' });
  });
  machine.appendChild(pullBtn);
  body.appendChild(machine);

  const ownedCount = COSMETIC_IDS.filter((id) => profile.ownedCosmetics.includes(id)).length;
  body.appendChild(
    el('h3', 'wardrobe-title', `Wardrobe · ${ownedCount}/${COSMETIC_IDS.length} collected`),
  );
  for (const slot of ['costume', 'accessory'] as const) {
    body.appendChild(renderWardrobeRow(profile, slot, run));
  }
}

function renderWardrobeRow(profile: PlayerProfile, slot: CosmeticSlot, run: RunFn): HTMLElement {
  const row = el('section', 'cosmetics-bar');
  row.appendChild(el('span', 'cosmetics-label', slot === 'costume' ? 'Costume:' : 'Accessory:'));
  const pills = el('div', 'cosmetics-pills');
  const equipped = slot === 'costume' ? profile.equippedCostume : profile.equippedCosmetic;

  const none = el('button', 'cosmetic-pill', 'Default');
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
    const pill = el('button', `cosmetic-pill rarity-${def.rarity}`, owned ? def.title : '???');
    pill.type = 'button';
    pill.title = owned ? `${RARITY_LABELS[def.rarity]} · ${def.description}` : 'Not collected yet';
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
