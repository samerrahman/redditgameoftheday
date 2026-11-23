import type { GameState } from '../../shared/game/simulation.ts';

type Mix = { music: number; effects: number; muted: boolean };
type Cue =
  | 'attack'
  | 'hit'
  | 'hurt'
  | 'coin'
  | 'gem'
  | 'heal'
  | 'clear'
  | 'floor'
  | 'death'
  | 'click';
type Snapshot = {
  phase: GameState['phase'];
  floor: number;
  room: number;
  swings: number;
  damage: number;
  coins: number;
  gems: number;
  cleared: number;
  hp: number;
  kills: number;
  relics: number;
  hits: Map<number, number>;
};
const STORAGE_KEY = 'dungeonle_audio_v1';
const EIGHTH = 60 / 112 / 2;
// Original eight-bar E-minor theme; short pulse notes leave space for combat cues.
const MELODY = [
  76, 0, 79, 78, 76, 0, 71, 74, 76, 0, 83, 0, 79, 78, 74, 0, 72, 0, 76, 79, 78,
  0, 76, 0, 72, 74, 76, 0, 79, 0, 76, 74, 74, 0, 78, 81, 79, 0, 78, 0, 74, 76,
  78, 0, 81, 79, 78, 74, 75, 0, 78, 0, 83, 81, 78, 0, 75, 0, 71, 0, 75, 78, 75,
  0,
];

export class DungeonAudio {
  private context: AudioContext | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private ui: GainNode | null = null;
  private master: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private timer: number | null = null;
  private nextNote = 0;
  private step = 0;
  private voices = 0;
  private boss = false;
  private phase: GameState['phase'] = 'start';
  private previous: Snapshot | null = null;
  private readonly lastCue = new Map<Cue, number>();
  private readonly listeners = new AbortController();
  private readonly panel = document.createElement('details');
  private readonly status = document.createElement('p');
  private settings: Mix = { music: 0.55, effects: 0.75, muted: false };
  private disposed = false;

  constructor() {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? 'null'
      );
      if (saved && typeof saved === 'object') {
        if (
          'music' in saved &&
          typeof saved.music === 'number' &&
          Number.isFinite(saved.music)
        ) {
          this.settings.music = Math.max(0, Math.min(1, saved.music));
        }
        if (
          'effects' in saved &&
          typeof saved.effects === 'number' &&
          Number.isFinite(saved.effects)
        ) {
          this.settings.effects = Math.max(0, Math.min(1, saved.effects));
        }
        if ('muted' in saved && typeof saved.muted === 'boolean')
          this.settings.muted = saved.muted;
      }
    } catch {
      /* Storage is optional. */
    }
    this.mountControls();
    const signal = this.listeners.signal;
    document.addEventListener(
      'pointerdown',
      () => {
        void this.unlock();
      },
      { signal }
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (!event.repeat) void this.unlock();
      },
      { signal }
    );
    document.addEventListener(
      'click',
      (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('button, summary')
        )
          this.cue('click');
      },
      { signal }
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) void this.context?.suspend().catch(() => {});
        else if (this.context && !this.settings.muted) void this.unlock();
      },
      { signal }
    );
    window.addEventListener(
      'pagehide',
      (event) => {
        if (!event.persisted) this.destroy();
      },
      { signal }
    );
  }

  private async unlock(): Promise<void> {
    if (this.disposed || document.hidden || this.settings.muted) return;
    try {
      if (!this.context) {
        const ctx = new AudioContext();
        this.context = ctx;
        ctx.addEventListener('statechange', () => this.updateStatus());
        this.master = ctx.createGain();
        this.master.gain.value = 0.6;
        // Conservative voice levels and a compressor leave room for overlapping effects.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        this.master.connect(limiter).connect(ctx.destination);
        this.music = ctx.createGain();
        this.musicDuck = ctx.createGain();
        this.music.connect(this.musicDuck).connect(this.master);
        this.effects = ctx.createGain();
        this.effects.connect(this.master);
        this.ui = ctx.createGain();
        this.ui.connect(this.master);
        this.applyMix();
        this.nextNote = ctx.currentTime + 0.06;
        this.timer = window.setInterval(() => this.schedule(), 25);
      }
      if (this.context.state === 'suspended') await this.context.resume();
      this.updateStatus();
    } catch {
      this.status.textContent = 'Audio unavailable in this browser.';
    }
  }

  private applyMix(): void {
    const ctx = this.context;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.master?.gain.setTargetAtTime(this.settings.muted ? 0 : 0.6, t, 0.025);
    const intensity =
      this.phase === 'paused' ? 0.18 : this.phase === 'playing' ? 0.8 : 0.42;
    this.music?.gain.setTargetAtTime(
      this.settings.music ** 2 * intensity,
      t,
      0.15
    );
    this.effects?.gain.setTargetAtTime(this.settings.effects ** 2, t, 0.025);
    this.ui?.gain.setTargetAtTime(this.settings.effects ** 2 * 0.45, t, 0.025);
  }

  private tone(
    bus: GainNode | null,
    midi: number,
    time: number,
    duration: number,
    volume: number,
    wave: OscillatorType = 'square',
    endMidi = midi
  ): void {
    const ctx = this.context;
    if (!ctx || !bus || this.voices >= 48) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), time);
    if (endMidi !== midi)
      osc.frequency.exponentialRampToValueAtTime(
        440 * 2 ** ((endMidi - 69) / 12),
        time + duration
      );
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain).connect(bus);
    this.voices++;
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      this.voices--;
    };
    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  private schedule(): void {
    const ctx = this.context;
    if (
      !ctx ||
      ctx.state !== 'running' ||
      document.hidden ||
      this.settings.muted
    )
      return;
    // Never catch up a throttled tab by playing a burst of missed notes.
    if (this.nextNote < ctx.currentTime) this.nextNote = ctx.currentTime + 0.04;
    while (this.nextNote < ctx.currentTime + 0.12) {
      const i = this.step % 64;
      const root = [40, 36, 38, 35][Math.floor(i / 16)] ?? 40;
      const t = this.nextNote;
      if (i % 2 === 0)
        this.tone(this.music, root, t, EIGHTH * 1.7, 0.16, 'triangle');
      const arp = [0, 7, root === 40 ? 3 : 4, 7][i % 4] ?? 0;
      this.tone(
        this.music,
        root + 24 + arp,
        t,
        EIGHTH * 0.7,
        0.035,
        'triangle'
      );
      const note = MELODY[i] ?? 0;
      if (note) this.tone(this.music, note, t, EIGHTH * 0.75, 0.035);
      if (this.boss && this.phase === 'playing') {
        // Add a low pulse layer on the same clock so the boss mix cannot drift.
        this.tone(this.music, root + (i % 2 ? 12 : 0), t, 0.07, 0.045);
      }
      this.step++;
      this.nextNote += EIGHTH;
    }
  }

  private cue(kind: Cue): void {
    const ctx = this.context;
    if (
      !ctx ||
      ctx.state !== 'running' ||
      this.settings.muted ||
      document.hidden
    )
      return;
    const t = ctx.currentTime;
    if (t - (this.lastCue.get(kind) ?? -10) < 0.075) return;
    this.lastCue.set(kind, t);
    const variation = Math.random() * 0.7 - 0.35;
    const bus = kind === 'click' ? this.ui : this.effects;
    switch (kind) {
      case 'attack':
        this.tone(bus, 63 + variation, t, 0.07, 0.075, 'triangle', 36);
        break;
      case 'hit':
        this.tone(bus, 43 + variation, t, 0.065, 0.075, 'square', 27);
        break;
      case 'hurt':
        this.tone(bus, 48, t, 0.2, 0.13, 'sawtooth', 30);
        break;
      case 'coin':
        this.tone(bus, 88 + variation, t, 0.09, 0.065);
        break;
      case 'gem':
      case 'heal':
        [76, 83, 88].forEach((n, i) =>
          this.tone(bus, n, t + i * 0.06, 0.18, 0.065, 'triangle')
        );
        break;
      case 'clear':
      case 'floor':
        [64, 67, 71, kind === 'floor' ? 83 : 76].forEach((n, i) =>
          this.tone(bus, n, t + i * 0.09, 0.24, 0.075)
        );
        break;
      case 'death':
        [64, 59, 55, 40].forEach((n, i) =>
          this.tone(bus, n, t + i * 0.15, 0.3, 0.085, 'triangle')
        );
        break;
      case 'click':
        this.tone(bus, 76, t, 0.035, 0.06, 'triangle');
        break;
    }
    if (kind === 'hurt' || kind === 'death') {
      this.musicDuck?.gain.cancelScheduledValues(t);
      this.musicDuck?.gain.setValueAtTime(0.4, t);
      this.musicDuck?.gain.setTargetAtTime(1, t + 0.15, 0.18);
    }
  }

  sync(state: GameState): void {
    if (this.phase !== state.phase) {
      this.phase = state.phase;
      this.panel.hidden = state.phase === 'playing' || state.phase === 'dying';
      this.applyMix();
    }
    this.boss = state.roomType === 'boss' && state.roomState === 'combat';
    const relics = Object.values(state.player.relics).reduce(
      (sum, level) => sum + (level ?? 0),
      0
    );
    const prev = this.previous;
    if (prev && state.elapsedTime > 0 && state.phase !== 'start') {
      if (state.phase === 'dying' && prev.phase !== 'dying') this.cue('death');
      if (state.phase === 'playing' && prev.phase === 'playing') {
        if (state.player.swingCount > prev.swings) this.cue('attack');
        if (state.stats.damageTaken > prev.damage) this.cue('hurt');
        else if (state.player.hp > prev.hp) this.cue('heal');
        if (state.stats.gemsEarned > prev.gems || relics > prev.relics)
          this.cue('gem');
        else if (state.stats.coinsEarned > prev.coins) this.cue('coin');
        if (state.floor > prev.floor) this.cue('floor');
        else if (state.roomsClearedTotal > prev.cleared) this.cue('clear');
        if (
          state.floor === prev.floor &&
          state.currentRoomId === prev.room &&
          (state.stats.enemiesKilled > prev.kills ||
            state.enemies.some((e) => e.hp < (prev.hits.get(e.id) ?? e.hp)))
        )
          this.cue('hit');
      }
    }
    this.previous = {
      phase: state.phase,
      floor: state.floor,
      room: state.currentRoomId,
      swings: state.player.swingCount,
      damage: state.stats.damageTaken,
      coins: state.stats.coinsEarned,
      gems: state.stats.gemsEarned,
      cleared: state.roomsClearedTotal,
      hp: state.player.hp,
      kills: state.stats.enemiesKilled,
      relics,
      hits: new Map(state.enemies.map((e) => [e.id, e.hp])),
    };
  }

  private mountControls(): void {
    this.panel.className = 'audio-controls';
    this.panel.addEventListener('keydown', (event) => event.stopPropagation());
    this.panel.addEventListener('keyup', (event) => event.stopPropagation());
    const summary = document.createElement('summary');
    summary.textContent = 'Audio';
    this.panel.appendChild(summary);
    this.status.setAttribute('role', 'status');
    this.panel.appendChild(this.status);
    this.updateStatus();
    const mute = document.createElement('button');
    mute.type = 'button';
    const updateMute = () => {
      mute.textContent = this.settings.muted ? 'Unmute audio' : 'Mute audio';
      mute.setAttribute('aria-pressed', String(this.settings.muted));
    };
    updateMute();
    mute.addEventListener('click', () => {
      this.settings.muted = !this.settings.muted;
      updateMute();
      this.save();
      if (!this.settings.muted) void this.unlock();
    });
    this.panel.appendChild(mute);
    for (const key of ['music', 'effects'] as const) {
      const label = document.createElement('label');
      label.textContent = key === 'music' ? 'Music' : 'Effects';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.value = String(Math.round(this.settings[key] * 100));
      range.addEventListener('input', () => {
        this.settings[key] = Number(range.value) / 100;
        this.save();
      });
      label.appendChild(range);
      this.panel.appendChild(label);
    }
    document.body.appendChild(this.panel);
  }

  private updateStatus(): void {
    this.status.textContent = this.settings.muted
      ? 'Audio muted'
      : this.context?.state === 'running'
        ? 'Sound on'
        : 'Interact to enable sound';
  }

  private save(): void {
    this.applyMix();
    this.updateStatus();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* Optional. */
    }
  }

  destroy(): void {
    this.disposed = true;
    this.listeners.abort();
    if (this.timer !== null) window.clearInterval(this.timer);
    void this.context?.close().catch(() => {});
    this.panel.remove();
  }
}
