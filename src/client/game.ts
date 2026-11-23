import * as Phaser from 'phaser';
import { ARENA_H, ARENA_W } from '../shared/game/constants.ts';
import { GameSimulation } from '../shared/game/simulation.ts';
import { getUtcDateString } from '../shared/rng.ts';
import { getDailyTheme } from './config/theme.ts';
import { InputController } from './game/input.ts';
import { HybridDevvitAdapter } from './platform/adapter.ts';
import { DungeonScene } from './scenes/DungeonScene.ts';
import { GameUIController } from './ui/controller.ts';

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const utcDate = getUtcDateString(params.get('date'));
  // Always open on the menu; `?autostart=1` skips straight into a run (handy for testing).
  const autoStart = params.get('autostart') === '1';
  const theme = getDailyTheme(utcDate);

  const adapter = new HybridDevvitAdapter();
  const session = await adapter.loadSession(utcDate);

  // Phaser bakes text into textures, so make sure the pixel font is ready first.
  try {
    await Promise.all([
      document.fonts.load('16px "Pixelify Sans"'),
      document.fonts.load('700 16px "Pixelify Sans"'),
    ]);
  } catch {
    // Fall back to system fonts if the font can't load.
  }

  const sim = new GameSimulation(utcDate, session.profile);

  let input: InputController | null = null;
  let uiController: GameUIController | null = null;

  const scene = new DungeonScene({
    sim,
    theme,
    getInput: () => input,
    onHudSync: () => {
      uiController?.syncHud();
    },
  });

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#120d14',
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: ARENA_W,
      height: ARENA_H,
    },
    scene: [scene],
  });

  const touchActionBtn = document.getElementById('touch-action-btn');
  input = new InputController(
    game.canvas,
    touchActionBtn,
    (clientX, clientY) => scene.screenToArena(clientX, clientY),
    () => {
      uiController?.showTouchButton();
    },
  );

  // Local-only developer helpers (never on Reddit): window.dungeonleDev.floor(3)
  // jumps to floor 3; ?floor=3 does the same when a run starts.
  const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const devFloor = Number(params.get('floor') ?? '');
  if (isLocalDev) {
    const jump = (floor: number): string => {
      if (sim.state.phase !== 'playing') return 'Start a run first, then call floor(n).';
      sim.debugJumpToFloor(floor);
      return `Jumped to floor ${sim.state.floor}`;
    };
    Object.assign(window, { dungeonleDev: { floor: jump } });

    // HUD button: skip to the next floor (keeps HP and relics).
    const pauseBtn = document.getElementById('hud-pause-btn');
    if (pauseBtn?.parentElement) {
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'hud-btn hud-dev-skip';
      skipBtn.textContent = 'Skip floor ⏭';
      skipBtn.title = 'Dev only: jump to the next floor';
      skipBtn.tabIndex = -1;
      // Don't take focus, or Space (attack) would press the button again.
      skipBtn.addEventListener('mousedown', (e) => e.preventDefault());
      skipBtn.addEventListener('click', () => {
        jump(sim.state.floor + 1);
        skipBtn.blur();
      });
      pauseBtn.parentElement.insertBefore(skipBtn, pauseBtn);
    }
    if (Number.isFinite(devFloor) && devFloor > 1) {
      const waitForRun = window.setInterval(() => {
        if (sim.state.phase === 'playing') {
          window.clearInterval(waitForRun);
          jump(devFloor);
        }
      }, 100);
    }
  }

  uiController = new GameUIController(
    utcDate,
    session.profile,
    session.leaderboard,
    session.subredditName,
    sim,
    adapter,
    input,
    autoStart,
  );
}

void bootstrap();
