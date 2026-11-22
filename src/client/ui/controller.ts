import type {
  DungeonMapRoomView,
  GamePhase,
  GameSimulation,
} from '../../shared/game/simulation.ts';
import { ENFORCE_SINGLE_DAILY_RUN } from '../../shared/buildMeta.ts';
import { getDailyModifier } from '../../shared/modifiers.ts';
import { getDailyRunSummary, hasCompletedDailyRun } from '../../shared/profile.ts';
import { RELICS } from '../../shared/relics.ts';
import { formatTimeUntilNextUtcDay } from '../../shared/rng.ts';
import { formatDuration, formatShareComment } from '../../shared/share.ts';
import { CONSUMABLES } from '../../shared/shop.ts';
import type {
  DailyLeaderboardEntry,
  DoorDirection,
  PlayerProfile,
  RelicId,
  RoomType,
  RunSummary,
} from '../../shared/types.ts';
import { ENTITY_LABELS, GAME_META, getDailyTheme } from '../config/theme.ts';
import type { InputController } from '../game/input.ts';
import type { PlatformAdapter } from '../platform/adapter.ts';
import { renderShopView } from './shopView.ts';

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

function getOList(id: string): HTMLOListElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLOListElement)) {
    throw new Error(`Missing HTMLOListElement #${id}`);
  }
  return node;
}

function getProgress(id: string): HTMLProgressElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLProgressElement)) {
    throw new Error(`Missing HTMLProgressElement #${id}`);
  }
  return node;
}

export class GameUIController {
  private readonly sim: GameSimulation;
  private readonly adapter: PlatformAdapter;
  private readonly input: InputController;
  private readonly utcDate: string;

  private profile: PlayerProfile;
  private leaderboard: DailyLeaderboardEntry[];
  private lastSummary: RunSummary | null = null;
  private shopOpen = false;
  private shopReturnPhase: GamePhase = 'start';
  private toastTimer: number | null = null;
  private bannerTimer: number | null = null;
  private bannerHideTimer: number | null = null;
  private hpHurtTimer: number | null = null;
  private countdownTimer: number | null = null;

  private lastHpText = '';
  private lastHpVal = -1;
  private lastHpMax = -1;
  private lastRoomText = '';
  private lastShieldCount = -1;
  private lastTimerSec = -1;
  private lastCoins = -1;
  private lastRelicKey = '';
  private lastRerollVisible = false;
  private lastRerollCount = -1;
  private lastBossKey = '';
  private lastAnnouncement = '';
  private lastBannerKey = '';
  private lastMinimapKey = '';
  private lastPhase: GamePhase = 'start';

  private readonly gameContainer = getEl('game-container');
  private readonly lowHpFx = getEl('low-hp-fx');
  private readonly hud = getEl('hud');
  private readonly hudHpFrame = getEl('hud-hp-frame');
  private readonly hudHpBar = getProgress('hud-hp-bar');
  private readonly hudHpText = getEl('hud-hp-text');
  private readonly hudRoom = getEl('hud-room');
  private readonly hudMinimap = getEl('hud-minimap');
  private readonly hudShields = getEl('hud-shields');
  private readonly hudShieldsVal = getEl('hud-shields-val');
  private readonly hudBossBar = getEl('hud-boss-bar');
  private readonly hudBossName = getEl('hud-boss-name');
  private readonly hudBossFill = getEl('hud-boss-fill');
  private readonly hudRoomBanner = getEl('hud-room-banner');
  private readonly hudRoomBannerKicker = getEl('hud-room-banner-kicker');
  private readonly hudRoomBannerTitle = getEl('hud-room-banner-title');
  private readonly hudRoomBannerSub = getEl('hud-room-banner-sub');
  private readonly hudAnnouncement = getEl('hud-announcement');
  private readonly hudTimer = getEl('hud-timer');
  private readonly hudCoinsVal = getEl('hud-coins-val');
  private readonly hudRerollBtn = getButton('hud-reroll-btn');
  private readonly hudRerollCount = getEl('hud-reroll-count');
  private readonly hudShopBtn = getButton('hud-shop-btn');
  private readonly hudPauseBtn = getButton('hud-pause-btn');
  private readonly hudRelics = getEl('hud-relics');
  private readonly touchActionBtn = getButton('touch-action-btn');

  private readonly startScreen = getEl('start-screen');
  private readonly startShopBtn = getButton('start-shop-btn');
  private readonly startShopCoins = getEl('start-shop-coins');
  private readonly startDate = getEl('start-date');
  private readonly startDungeon = getEl('start-dungeon');
  private readonly startModifier = getEl('start-modifier');
  private readonly startStreak = getEl('start-streak');
  private readonly startCoins = getEl('start-coins');
  private readonly startBest = getEl('start-best');
  private readonly startBoostPill = getEl('start-boost-pill');
  private readonly playBtn = getButton('play-btn');
  private readonly playBtnLabel = getEl('play-btn-label');
  private readonly startDailyNote = getEl('start-daily-note');

  private readonly pauseScreen = getEl('pause-screen');
  private readonly pauseCopy = getEl('pause-copy');
  private readonly resumeBtn = getButton('resume-btn');
  private readonly restartBtn = getButton('restart-btn');
  private readonly pauseShopBtn = getButton('pause-shop-btn');
  private readonly quitBtn = getButton('quit-btn');

  private readonly endScreen = getEl('end-screen');
  private readonly endBadge = getEl('end-badge');
  private readonly endStreak = getEl('end-streak');
  private readonly endTitle = getEl('end-title');
  private readonly endSubtitle = getEl('end-subtitle');
  private readonly endRoom = getEl('end-room');
  private readonly endTime = getEl('end-time');
  private readonly endCoins = getEl('end-coins');
  private readonly endDamage = getEl('end-damage');
  private readonly endRelics = getEl('end-relics');
  private readonly endScore = getEl('end-score');
  private readonly endLeaderboard = getOList('end-leaderboard');
  private readonly shareBtn = getButton('share-btn');
  private readonly endSecondaryRow = getEl('end-secondary-row');
  private readonly endShopBtn = getButton('end-shop-btn');
  private readonly playAgainBtn = getButton('play-again-btn');
  private readonly endNextDaily = getEl('end-next-daily');
  private readonly subscribeLabel = getEl('subscribe-label');
  private readonly subscribeBtn = getButton('subscribe-btn');

  private readonly shopScreen = getEl('shop-screen');
  private readonly shopBackBtn = getButton('shop-back-btn');
  private readonly shopPlayBtn = getButton('shop-play-btn');
  private readonly shopDateSub = getEl('shop-date-sub');
  private readonly shopBalance = getEl('shop-balance');
  private readonly shopSlots = getEl('shop-slots');
  private readonly shopCosmetics = getEl('shop-cosmetics');
  private readonly toast = getEl('toast');

  constructor(
    utcDate: string,
    profile: PlayerProfile,
    leaderboard: DailyLeaderboardEntry[],
    subredditName: string,
    sim: GameSimulation,
    adapter: PlatformAdapter,
    input: InputController,
    startImmediately: boolean,
  ) {
    this.utcDate = utcDate;
    this.profile = profile;
    this.leaderboard = leaderboard;
    this.sim = sim;
    this.adapter = adapter;
    this.input = input;

    this.subscribeLabel.textContent = `Join r/${subredditName} for daily threads`;

    this.sim.setOnRunEnd((summary) => {
      void this.handleRunEnd(summary);
    });

    this.restartBtn.hidden = ENFORCE_SINGLE_DAILY_RUN;
    this.quitBtn.hidden = ENFORCE_SINGLE_DAILY_RUN;
    this.playAgainBtn.hidden = ENFORCE_SINGLE_DAILY_RUN;
    this.endSecondaryRow.classList.toggle('is-single', ENFORCE_SINGLE_DAILY_RUN);
    this.endNextDaily.hidden = !ENFORCE_SINGLE_DAILY_RUN;
    this.pauseCopy.textContent = ENFORCE_SINGLE_DAILY_RUN
      ? 'One run per day — resume when ready.'
      : 'Same daily seed stays active until run ends.';

    this.bindEvents();
    this.syncStartScreen();
    if (ENFORCE_SINGLE_DAILY_RUN) {
      this.updateDailyCountdown();
      this.countdownTimer = window.setInterval(() => {
        this.updateDailyCountdown();
      }, 1000);
    }

    if (this.isDailyCompleted()) {
      if (startImmediately) {
        this.showCompletedDailySummary();
      } else {
        this.syncVisibility();
      }
    } else if (startImmediately) {
      this.startRun();
    } else {
      this.syncVisibility();
    }
  }

  public syncHud(): void {
    const s = this.sim.state;
    if (s.phase !== 'playing' && s.phase !== 'dying') return;

    if (s.phase !== this.lastPhase) {
      this.syncVisibility();
    }

    const p = s.player;
    const hpText = `${Math.ceil(p.hp)}/${p.maxHp}`;
    if (hpText !== this.lastHpText) {
      this.lastHpText = hpText;
      this.hudHpText.textContent = hpText;
    }
    if (p.maxHp !== this.lastHpMax) {
      this.lastHpMax = p.maxHp;
      this.hudHpBar.max = Math.max(1, p.maxHp);
    }
    if (Math.abs(p.hp - this.lastHpVal) > 0.05) {
      if (this.lastHpVal > 0 && p.hp < this.lastHpVal) {
        this.hudHpFrame.classList.add('is-hurt');
        this.lowHpFx.classList.add('is-hurt');
        if (this.hpHurtTimer !== null) {
          window.clearTimeout(this.hpHurtTimer);
        }
        this.hpHurtTimer = window.setTimeout(() => {
          this.hudHpFrame.classList.remove('is-hurt');
          this.lowHpFx.classList.remove('is-hurt');
          this.hpHurtTimer = null;
        }, 200);
      }
      this.lastHpVal = p.hp;
      this.hudHpBar.value = Math.max(0, Math.min(p.maxHp, p.hp));
      const ratio = p.maxHp > 0 ? Math.max(0, p.hp / p.maxHp) : 1;
      const isLow = ratio <= 0.35;
      const isCritical = ratio <= 0.2;
      const strength = isLow ? Math.max(0, Math.min(1, (0.35 - ratio) / 0.35)) : 0;
      this.hudHpFrame.classList.toggle('is-low', p.maxHp > 0 && p.hp / p.maxHp <= 0.3);
      this.lowHpFx.classList.toggle('is-low', isLow);
      this.lowHpFx.classList.toggle('is-critical', isCritical);
      this.lowHpFx.style.setProperty('--low-hp-strength', strength.toFixed(2));
    }

    const roomText =
      s.roomType === 'endless'
        ? `Endless ${Math.max(1, s.roomIndex - s.totalRooms)}`
        : `${s.progressPct}% · Room ${s.roomIndex}`;
    if (roomText !== this.lastRoomText) {
      this.lastRoomText = roomText;
      this.hudRoom.textContent = roomText;
    }

    const minimapKey =
      s.roomType === 'endless'
        ? 'endless'
        : s.mapRooms
            .map((r) => `${r.id}:${r.visited ? 1 : 0}${r.cleared ? 1 : 0}${r.isCurrent ? 1 : 0}`)
            .join('|');
    if (minimapKey !== this.lastMinimapKey) {
      this.lastMinimapKey = minimapKey;
      this.renderMinimap(s.mapRooms, s.roomType === 'endless');
    }

    if (p.shields !== this.lastShieldCount) {
      this.lastShieldCount = p.shields;
      this.hudShields.hidden = p.shields <= 0;
      this.hudShieldsVal.textContent = String(p.shields);
    }

    const sec = Math.floor(s.elapsedTime);
    if (sec !== this.lastTimerSec) {
      this.lastTimerSec = sec;
      this.hudTimer.textContent = formatDuration(sec);
    }

    if (s.stats.coinsEarned !== this.lastCoins) {
      this.lastCoins = s.stats.coinsEarned;
      this.hudCoinsVal.textContent = String(s.stats.coinsEarned);
    }

    const bannerKey = `${s.currentRoomId}:${s.roomIndex}:${s.roomType}`;
    if (bannerKey !== this.lastBannerKey) {
      this.lastBannerKey = bannerKey;
      if (s.isFirstVisitToRoom) {
        const sub = s.roomType === 'boss' ? 'Daily Floor Boss' : s.modifier.banner;
        this.showRoomBanner(s.roomIndex, s.roomType, s.progressPct, s.totalRooms, sub);
      }
    }

    const rerollVisible = s.pedestals.length > 0 && p.rerollsRemaining > 0;
    if (rerollVisible !== this.lastRerollVisible || p.rerollsRemaining !== this.lastRerollCount) {
      this.lastRerollVisible = rerollVisible;
      this.lastRerollCount = p.rerollsRemaining;
      this.hudRerollBtn.hidden = !rerollVisible;
      this.hudRerollCount.textContent = String(p.rerollsRemaining);
    }

    const featuredEnemy = s.enemies.find(
      (e) => e.archetype === 'boss' || e.archetype === 'elite_charger',
    );
    const bossKey = featuredEnemy ? `${featuredEnemy.id}:${featuredEnemy.hp}` : '';
    if (bossKey !== this.lastBossKey) {
      this.lastBossKey = bossKey;
      if (featuredEnemy) {
        this.hudBossBar.hidden = false;
        this.hudBossName.textContent = ENTITY_LABELS.enemies[featuredEnemy.archetype];
        const pct = Math.max(0, Math.min(100, (featuredEnemy.hp / featuredEnemy.maxHp) * 100));
        this.hudBossFill.style.inlineSize = `${pct.toFixed(1)}%`;
      } else {
        this.hudBossBar.hidden = true;
      }
    }

    const ann = s.announcementTimer > 0 ? s.announcementText : '';
    if (ann !== this.lastAnnouncement) {
      this.lastAnnouncement = ann;
      this.hudAnnouncement.hidden = ann.length === 0;
      this.hudAnnouncement.textContent = ann;
    }

    const relicKey = (Object.keys(p.relics) as RelicId[])
      .filter((id) => (p.relics[id] ?? 0) > 0)
      .map((id) => `${id}:${p.relics[id] ?? 0}`)
      .join('|');
    if (relicKey !== this.lastRelicKey) {
      this.lastRelicKey = relicKey;
      this.renderHudRelics(p.relics);
    }

    const showTouch =
      this.input.hasUsedTouch() ||
      (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
    this.touchActionBtn.hidden = !showTouch;
  }

  public showTouchButton(): void {
    if (this.sim.state.phase === 'playing') {
      this.touchActionBtn.hidden = false;
    }
  }

  private bindEvents(): void {
    this.playBtn.addEventListener('click', () => {
      if (this.isDailyCompleted()) {
        this.showCompletedDailySummary();
      } else {
        this.startRun();
      }
    });

    this.shopPlayBtn.addEventListener('click', () => {
      this.shopOpen = false;
      if (this.isDailyCompleted()) {
        this.showCompletedDailySummary();
      } else {
        this.startRun();
      }
    });

    this.playAgainBtn.addEventListener('click', () => {
      this.startRun();
    });

    this.restartBtn.addEventListener('click', () => {
      this.startRun();
    });

    this.resumeBtn.addEventListener('click', () => {
      this.resumeRun();
    });

    this.quitBtn.addEventListener('click', () => {
      this.sim.setPhase('start');
      this.syncStartScreen();
      this.syncVisibility();
    });

    this.hudPauseBtn.addEventListener('click', () => {
      this.togglePause();
    });

    this.hudRerollBtn.addEventListener('click', () => {
      this.sim.rerollPedestals();
    });

    this.hudShopBtn.addEventListener('click', () => {
      this.openShop();
    });

    this.startShopBtn.addEventListener('click', () => {
      this.openShop();
    });

    this.pauseShopBtn.addEventListener('click', () => {
      this.openShop();
    });

    this.endShopBtn.addEventListener('click', () => {
      this.openShop();
    });

    this.shopBackBtn.addEventListener('click', () => {
      this.closeShop();
    });

    this.shareBtn.addEventListener('click', () => {
      void this.handleShare();
    });

    this.subscribeBtn.addEventListener('click', () => {
      void this.handleSubscribeToggle();
    });

    window.addEventListener('keydown', (e) => {
      if (this.shopOpen) {
        if (e.code === 'Escape') {
          e.preventDefault();
          this.closeShop();
        }
        return;
      }
      if (e.code === 'Escape') {
        if (this.sim.state.phase === 'playing' || this.sim.state.phase === 'paused') {
          e.preventDefault();
          this.togglePause();
        }
      } else if (e.code === 'KeyR' && this.sim.state.phase === 'playing') {
        if (this.sim.rerollPedestals()) {
          e.preventDefault();
        }
      }
    });
  }

  public destroy(): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    if (this.bannerHideTimer !== null) {
      window.clearTimeout(this.bannerHideTimer);
      this.bannerHideTimer = null;
    }
    if (this.hpHurtTimer !== null) {
      window.clearTimeout(this.hpHurtTimer);
      this.hpHurtTimer = null;
    }
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private isDailyCompleted(): boolean {
    return ENFORCE_SINGLE_DAILY_RUN && hasCompletedDailyRun(this.profile, this.utcDate);
  }

  private updateDailyCountdown(): void {
    const label = `Daily complete · Next dungeon in ${formatTimeUntilNextUtcDay()}`;
    this.startDailyNote.textContent = label;
    this.endNextDaily.textContent = label;
  }

  private showCompletedDailySummary(): void {
    const saved = this.lastSummary ?? getDailyRunSummary(this.profile, this.utcDate);
    if (saved) {
      this.lastSummary = saved;
      this.renderEndCard(saved, this.leaderboard);
    }
    this.updateDailyCountdown();
    this.sim.setPhase('ended');
    this.syncVisibility();
  }

  private startRun(): void {
    if (this.isDailyCompleted()) {
      this.showCompletedDailySummary();
      return;
    }
    this.shopOpen = false;
    this.lastSummary = null;
    this.lastHpText = '';
    this.lastHpVal = -1;
    this.lastHpMax = -1;
    if (this.hpHurtTimer !== null) {
      window.clearTimeout(this.hpHurtTimer);
      this.hpHurtTimer = null;
    }
    this.hud.classList.remove('is-dying');
    this.hudHpFrame.classList.remove('is-hurt', 'is-low');
    this.lowHpFx.classList.remove('is-low', 'is-critical', 'is-hurt');
    this.lowHpFx.style.setProperty('--low-hp-strength', '0');
    this.lastRoomText = '';
    this.lastRelicKey = '';
    this.lastBossKey = '';
    this.lastBannerKey = '';
    this.lastMinimapKey = '';
    this.hideRoomBanner();
    this.sim.startNewRun(this.utcDate, this.profile);
    this.syncVisibility();
    this.syncHud();
  }

  private togglePause(): void {
    if (this.sim.state.phase === 'playing') {
      this.sim.setPhase('paused');
    } else if (this.sim.state.phase === 'paused') {
      this.sim.setPhase('playing');
    }
    this.syncVisibility();
  }

  private resumeRun(): void {
    if (this.sim.state.phase === 'paused') {
      this.sim.setPhase('playing');
      this.syncVisibility();
    }
  }

  private syncVisibility(): void {
    const phase = this.sim.state.phase;
    const playing = !this.shopOpen && phase === 'playing';
    const dying = !this.shopOpen && phase === 'dying';

    this.hud.hidden = !playing && !dying;
    this.hud.classList.toggle('is-dying', dying);
    if (!playing) {
      this.hideRoomBanner();
    }
    if (!playing && !dying) {
      this.lowHpFx.classList.remove('is-low', 'is-critical', 'is-hurt');
      this.lowHpFx.style.setProperty('--low-hp-strength', '0');
    }
    this.startScreen.hidden = this.shopOpen || phase !== 'start';
    this.pauseScreen.hidden = this.shopOpen || phase !== 'paused';
    this.endScreen.hidden = this.shopOpen || phase !== 'ended';
    this.shopScreen.hidden = !this.shopOpen;

    this.lastPhase = phase;
    this.gameContainer.classList.toggle('is-playing', playing);
    this.input.setGameActive(playing, this.shopOpen);
  }

  private syncStartScreen(): void {
    const theme = getDailyTheme(this.utcDate);
    const modifier = getDailyModifier(this.utcDate);
    const best = this.profile.dailyBest[this.utcDate];

    this.startDate.textContent = this.utcDate;
    this.startDungeon.textContent = theme.name;
    this.startModifier.textContent = modifier.banner;
    this.startStreak.textContent = `${this.profile.streak}🔥`;
    this.startCoins.textContent = String(this.profile.coins);
    this.startShopCoins.textContent = `${this.profile.coins} ${GAME_META.coinShort}`;

    if (best) {
      const bestPct =
        best.bestProgressPct !== undefined ? `${best.bestProgressPct}%` : `Room ${best.highestRoom}`;
      this.startBest.textContent = best.extracted
        ? `${bestPct} · ${formatDuration(best.bestClearTimeSec ?? 0)}`
        : bestPct;
    } else {
      this.startBest.textContent = '—';
    }

    const completed = this.isDailyCompleted();
    this.playBtnLabel.textContent = completed ? 'VIEW RESULTS' : 'PLAY';
    this.playBtn.classList.toggle('is-completed', completed);
    this.startDailyNote.hidden = !completed;

    if (this.profile.pendingConsumable) {
      const def = CONSUMABLES[this.profile.pendingConsumable];
      this.startBoostPill.hidden = false;
      this.startBoostPill.textContent = `Armed Boost: ${def.title}`;
    } else {
      this.startBoostPill.hidden = true;
    }
  }

  private async handleRunEnd(summary: RunSummary): Promise<void> {
    this.lastSummary = summary;
    const res = await this.adapter.recordRun(summary, this.profile);
    this.profile = res.profile;
    this.leaderboard = res.leaderboard;
    this.renderEndCard(summary, res.leaderboard);
    if (ENFORCE_SINGLE_DAILY_RUN) {
      this.updateDailyCountdown();
    }
    this.syncStartScreen();
    this.syncVisibility();
  }

  private renderEndCard(summary: RunSummary, leaderboard: DailyLeaderboardEntry[]): void {
    const theme = getDailyTheme(summary.utcDate);
    const extracted = summary.outcome === 'extracted';
    const pct = summary.progressPct ?? 0;
    const totalRooms = summary.totalRooms ?? 5;

    this.endStreak.textContent = `${this.profile.streak}🔥`;
    if (extracted) {
      this.endBadge.hidden = false;
      this.endBadge.textContent = 'EXTRACTED';
      this.endTitle.textContent =
        summary.roomReached > totalRooms
          ? `Endless Room ${summary.roomReached - totalRooms} Extracted!`
          : pct >= 100
            ? 'Dungeon Cleared!'
            : 'Extracted!';
      this.endSubtitle.textContent = `${summary.utcDate} · ${theme.name}`;
    } else {
      this.endBadge.hidden = true;
      this.endTitle.textContent = 'You Died';
      this.endSubtitle.textContent = `Died in Room ${summary.roomReached}`;
    }

    this.endRoom.textContent = `${pct}%`;
    this.endTime.textContent = formatDuration(summary.elapsedSec);
    this.endCoins.textContent = `+${summary.coinsEarned} (${this.profile.coins} total)`;
    this.endDamage.textContent = String(summary.damageTaken);
    this.endScore.textContent = `Score: ${summary.score}`;

    this.endRelics.replaceChildren();
    const relicIds = (Object.keys(summary.relics) as RelicId[]).filter(
      (id) => (summary.relics[id] ?? 0) > 0,
    );
    if (relicIds.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'relic-badge';
      empty.textContent = 'No Relics Drafted';
      this.endRelics.appendChild(empty);
    } else {
      for (const id of relicIds) {
        const lv = summary.relics[id] ?? 0;
        const def = RELICS[id];
        const chip = document.createElement('span');
        chip.className = 'relic-badge';
        chip.textContent = `${def.emoji} ${def.name}${lv > 1 ? ` Lv ${lv}` : ''}`;
        this.endRelics.appendChild(chip);
      }
    }

    this.endLeaderboard.replaceChildren();
    if (leaderboard.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No runs recorded yet today.';
      this.endLeaderboard.appendChild(li);
    } else {
      for (const row of leaderboard) {
        const li = document.createElement('li');
        const status = row.extracted ? 'Clear' : 'Died';
        const progressText =
          row.progressPct !== undefined ? `${row.progressPct}%` : `R${row.roomReached}`;
        li.textContent = `${row.player} — ${progressText} ${status} · ${formatDuration(row.elapsedSec)} (${row.score} pts)`;
        this.endLeaderboard.appendChild(li);
      }
    }

    this.syncSubscribeButton();
  }

  private renderHudRelics(relics: Partial<Record<RelicId, number>>): void {
    this.hudRelics.replaceChildren();
    for (const id of Object.keys(relics) as RelicId[]) {
      const lv = relics[id] ?? 0;
      if (lv <= 0) continue;
      const def = RELICS[id];
      const badge = document.createElement('span');
      badge.className = 'relic-badge';
      badge.textContent = `${def.emoji} ${def.shortTag}${lv > 1 ? ` ×${lv}` : ''}`;
      this.hudRelics.appendChild(badge);
    }
  }

  private openShop(): void {
    this.shopReturnPhase = this.sim.state.phase;
    if (this.shopReturnPhase === 'playing') {
      this.sim.setPhase('paused');
    }
    this.shopOpen = true;
    this.shopBackBtn.textContent =
      this.shopReturnPhase === 'playing' ? '← Back to Run' : '← Back';
    this.shopPlayBtn.hidden =
      this.shopReturnPhase === 'playing' ||
      this.shopReturnPhase === 'paused' ||
      this.isDailyCompleted();
    this.renderShop();
    this.syncVisibility();
    this.shopScreen.scrollTop = 0;
    this.shopBackBtn.focus();
  }

  private closeShop(): void {
    if (!this.shopOpen) return;
    this.shopOpen = false;
    if (this.shopReturnPhase === 'playing' && this.sim.state.phase === 'paused') {
      this.sim.setPhase('playing');
    }
    this.syncStartScreen();
    this.syncVisibility();
  }

  private renderShop(): void {
    renderShopView(
      this.utcDate,
      this.profile,
      this.adapter,
      {
        dateSub: this.shopDateSub,
        balance: this.shopBalance,
        slotsContainer: this.shopSlots,
        cosmeticsContainer: this.shopCosmetics,
      },
      {
        onProfileChange: (nextProfile) => {
          this.profile = nextProfile;
          this.syncStartScreen();
        },
        onNotify: (msg) => {
          this.showToast(msg);
        },
      },
    );
  }

  private async handleShare(): Promise<void> {
    if (!this.lastSummary) return;
    const theme = getDailyTheme(this.lastSummary.utcDate);
    const modifier = getDailyModifier(this.lastSummary.utcDate);
    const markdown = formatShareComment(
      this.lastSummary,
      theme.name,
      modifier.banner,
      GAME_META.coinShort,
      this.profile.streak,
    );
    const res = await this.adapter.shareRunComment(markdown);
    this.showToast(res.message);
  }

  private async handleSubscribeToggle(): Promise<void> {
    const next = !this.profile.subscribed;
    const saved = await this.adapter.toggleSubscribe(next, this.profile);
    this.profile = { ...this.profile, subscribed: saved };
    this.syncSubscribeButton();
    this.showToast(
      saved
        ? `Subscribed to ${GAME_META.subredditName}!`
        : `Unsubscribed from ${GAME_META.subredditName}.`,
    );
  }

  private syncSubscribeButton(): void {
    this.subscribeBtn.classList.toggle('is-subscribed', this.profile.subscribed);
    this.subscribeBtn.textContent = this.profile.subscribed ? 'Subscribed ✓' : 'Subscribe';
  }

  private renderMinimap(mapRooms: DungeonMapRoomView[], isEndless: boolean): void {
    this.hudMinimap.replaceChildren();
    if (isEndless || mapRooms.length === 0) {
      this.hudMinimap.hidden = true;
      return;
    }

    const dirDeltas: Record<DoorDirection, { dx: number; dy: number }> = {
      north: { dx: 0, dy: -1 },
      south: { dx: 0, dy: 1 },
      east: { dx: 1, dy: 0 },
      west: { dx: -1, dy: 0 },
    };

    const byCoord = new Map<string, DungeonMapRoomView>();
    for (const r of mapRooms) {
      byCoord.set(`${r.gx},${r.gy}`, r);
    }

    const shownIds = new Set<number>();
    for (const r of mapRooms) {
      if (!r.visited) continue;
      shownIds.add(r.id);
      for (const dir of r.doors) {
        const d = dirDeltas[dir];
        const neighbor = byCoord.get(`${r.gx + d.dx},${r.gy + d.dy}`);
        if (neighbor) {
          shownIds.add(neighbor.id);
        }
      }
    }

    const shown = mapRooms.filter((r) => shownIds.has(r.id));
    if (shown.length === 0) {
      this.hudMinimap.hidden = true;
      return;
    }

    this.hudMinimap.hidden = false;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const r of shown) {
      if (r.gx < minX) minX = r.gx;
      if (r.gx > maxX) maxX = r.gx;
      if (r.gy < minY) minY = r.gy;
      if (r.gy > maxY) maxY = r.gy;
    }

    const cellW = 18;
    const cellH = 14;
    const stepX = 24;
    const stepY = 20;
    const canvas = document.createElement('div');
    canvas.className = 'mm-canvas';
    canvas.style.inlineSize = `${(maxX - minX + 1) * stepX - (stepX - cellW)}px`;
    canvas.style.blockSize = `${(maxY - minY + 1) * stepY - (stepY - cellH)}px`;

    for (const r of shown) {
      const px = (r.gx - minX) * stepX;
      const py = (r.gy - minY) * stepY;

      if (r.doors.includes('east')) {
        const eastNeighbor = byCoord.get(`${r.gx + 1},${r.gy}`);
        if (eastNeighbor && shownIds.has(eastNeighbor.id)) {
          const link = document.createElement('div');
          link.className = 'mm-link';
          link.style.left = `${px + cellW}px`;
          link.style.top = `${py + Math.floor(cellH / 2) - 1}px`;
          link.style.inlineSize = `${stepX - cellW}px`;
          link.style.blockSize = '2px';
          canvas.appendChild(link);
        }
      }

      if (r.doors.includes('south')) {
        const southNeighbor = byCoord.get(`${r.gx},${r.gy + 1}`);
        if (southNeighbor && shownIds.has(southNeighbor.id)) {
          const link = document.createElement('div');
          link.className = 'mm-link';
          link.style.left = `${px + Math.floor(cellW / 2) - 1}px`;
          link.style.top = `${py + cellH}px`;
          link.style.inlineSize = '2px';
          link.style.blockSize = `${stepY - cellH}px`;
          canvas.appendChild(link);
        }
      }

      const node = document.createElement('div');
      node.className = 'mm-node';
      if (r.isCurrent) {
        node.classList.add('is-current');
      } else if (r.cleared) {
        node.classList.add('is-cleared');
      } else if (r.isBoss) {
        node.classList.add('is-boss');
      } else if (!r.visited) {
        node.classList.add('is-unexplored');
      }
      node.style.left = `${px}px`;
      node.style.top = `${py}px`;
      node.style.inlineSize = `${cellW}px`;
      node.style.blockSize = `${cellH}px`;
      node.textContent = r.isCurrent ? '★' : r.isBoss ? '☠' : r.visited ? String(r.roomIndex) : '?';
      canvas.appendChild(node);
    }

    this.hudMinimap.appendChild(canvas);
  }

  private showRoomBanner(
    roomIndex: number,
    roomType: RoomType,
    progressPct: number,
    totalRooms: number,
    subtitle: string,
  ): void {
    this.hudRoomBannerKicker.textContent =
      roomType === 'endless'
        ? `ENDLESS ${Math.max(1, roomIndex - totalRooms)}`
        : `ROOM ${roomIndex} · ${progressPct}%`;
    this.hudRoomBannerTitle.textContent = ENTITY_LABELS.rooms[roomType];
    this.hudRoomBannerSub.textContent = subtitle;

    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    if (this.bannerHideTimer !== null) {
      window.clearTimeout(this.bannerHideTimer);
      this.bannerHideTimer = null;
    }

    this.hudRoomBanner.hidden = false;
    this.hudRoomBanner.classList.remove('is-visible');
    void this.hudRoomBanner.offsetWidth;
    this.hudRoomBanner.classList.add('is-visible');

    this.bannerTimer = window.setTimeout(() => {
      this.hudRoomBanner.classList.remove('is-visible');
      this.bannerHideTimer = window.setTimeout(() => {
        if (!this.hudRoomBanner.classList.contains('is-visible')) {
          this.hudRoomBanner.hidden = true;
        }
      }, 240);
    }, 1800);
  }

  private hideRoomBanner(): void {
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    if (this.bannerHideTimer !== null) {
      window.clearTimeout(this.bannerHideTimer);
      this.bannerHideTimer = null;
    }
    this.hudRoomBanner.classList.remove('is-visible');
    this.hudRoomBanner.hidden = true;
  }

  private showToast(message: string): void {
    this.adapter.notify(message);
    this.toast.textContent = message;
    this.toast.hidden = false;
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, 2600);
  }
}
