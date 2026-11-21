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
  const showMenu = params.get('menu') === '1';
  const theme = getDailyTheme(utcDate);

  const adapter = new HybridDevvitAdapter();
  const session = await adapter.loadSession(utcDate);

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

  uiController = new GameUIController(
    utcDate,
    session.profile,
    session.leaderboard,
    session.subredditName,
    sim,
    adapter,
    input,
    !showMenu,
  );
}

void bootstrap();
