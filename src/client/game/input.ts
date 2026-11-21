import { ARENA_H, ARENA_W } from '../../shared/game/constants.ts';
import type { InputFrame } from '../../shared/types.ts';

export type TouchJoystickVisual = {
  active: boolean;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
  maxRadius: number;
};

export type ArenaMapper = (clientX: number, clientY: number) => { x: number; y: number };

export class InputController {
  private readonly keys = new Set<string>();
  private spaceDown = false;
  private mouseDown = false;
  private touchButtonDown = false;

  private prevCombinedDown = false;
  private pendingPress = false;
  private pendingRelease = false;

  private aimX = ARENA_W / 2;
  private aimY = ARENA_H / 2;
  private mouseUsed = false;

  private joyPointerId: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyKnobX = 0;
  private joyKnobY = 0;
  private joyMoveX = 0;
  private joyMoveY = 0;
  private readonly joyMaxRadius = 54;
  private readonly joyDeadzone = 9;

  private actionTouchPointerId: number | null = null;
  private hasTouchActivity = false;

  private activePlaying = false;
  private modalOpen = false;
  private readonly onTouchDetected?: (() => void) | undefined;

  private readonly canvas: HTMLCanvasElement;
  private readonly touchActionBtn: HTMLElement | null;
  private readonly screenToArena: ArenaMapper;

  constructor(
    canvas: HTMLCanvasElement,
    touchActionBtn: HTMLElement | null,
    screenToArena: ArenaMapper,
    onTouchDetected?: () => void,
  ) {
    this.canvas = canvas;
    this.touchActionBtn = touchActionBtn;
    this.screenToArena = screenToArena;
    this.onTouchDetected = onTouchDetected;
    this.attach();
  }

  public setGameActive(playing: boolean, modalOpen: boolean): void {
    this.activePlaying = playing;
    this.modalOpen = modalOpen;
    if (!playing || modalOpen) {
      this.resetAll();
    }
  }

  public hasUsedTouch(): boolean {
    return this.hasTouchActivity;
  }

  public getTouchJoystickVisual(): TouchJoystickVisual {
    return {
      active: this.joyPointerId !== null,
      originX: this.joyOriginX,
      originY: this.joyOriginY,
      knobX: this.joyKnobX,
      knobY: this.joyKnobY,
      maxRadius: this.joyMaxRadius,
    };
  }

  public consumeTickInput(): InputFrame {
    let moveX = 0;
    let moveY = 0;

    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveY -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveY += 1;

    if (moveX !== 0 || moveY !== 0) {
      const len = Math.hypot(moveX, moveY);
      moveX /= len;
      moveY /= len;
    } else if (this.joyPointerId !== null) {
      moveX = this.joyMoveX;
      moveY = this.joyMoveY;
    }

    const actionDown = this.isActionDown();
    const actionJustPressed = this.pendingPress;
    const actionJustReleased = this.pendingRelease;
    this.pendingPress = false;
    this.pendingRelease = false;

    const hasPointerAim =
      this.mouseDown || (this.mouseUsed && !this.spaceDown && !this.hasTouchActivity);

    return {
      moveX,
      moveY,
      aimX: this.aimX,
      aimY: this.aimY,
      hasPointerAim,
      actionDown,
      actionJustPressed,
      actionJustReleased,
    };
  }

  public resetAll(): void {
    this.keys.clear();
    this.spaceDown = false;
    this.mouseDown = false;
    this.touchButtonDown = false;
    this.prevCombinedDown = false;
    this.pendingPress = false;
    this.pendingRelease = false;
    this.joyPointerId = null;
    this.joyMoveX = 0;
    this.joyMoveY = 0;
    this.actionTouchPointerId = null;
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.canvas.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerUp);
    if (this.touchActionBtn) {
      this.touchActionBtn.removeEventListener('pointerdown', this.handleActionBtnDown);
      this.touchActionBtn.removeEventListener('pointerup', this.handleActionBtnUp);
      this.touchActionBtn.removeEventListener('pointercancel', this.handleActionBtnUp);
    }
  }

  private attach(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.canvas.addEventListener('pointerdown', this.handleCanvasPointerDown);
    window.addEventListener('pointermove', this.handleWindowPointerMove);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerUp);
    if (this.touchActionBtn) {
      this.touchActionBtn.addEventListener('pointerdown', this.handleActionBtnDown);
      this.touchActionBtn.addEventListener('pointerup', this.handleActionBtnUp);
      this.touchActionBtn.addEventListener('pointercancel', this.handleActionBtnUp);
    }
  }

  private isActionDown(): boolean {
    return this.spaceDown || this.mouseDown || this.touchButtonDown;
  }

  private syncActionEdges(): void {
    const down = this.isActionDown();
    if (down && !this.prevCombinedDown) {
      this.pendingPress = true;
    } else if (!down && this.prevCombinedDown) {
      this.pendingRelease = true;
    }
    this.prevCombinedDown = down;
  }

  private markTouchUsed(): void {
    if (!this.hasTouchActivity) {
      this.hasTouchActivity = true;
      this.onTouchDetected?.();
    }
  }

  private updateMouseAim(clientX: number, clientY: number): void {
    const mapped = this.screenToArena(clientX, clientY);
    this.aimX = Math.max(0, Math.min(ARENA_W, mapped.x));
    this.aimY = Math.max(0, Math.min(ARENA_H, mapped.y));
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.activePlaying || this.modalOpen) return;
    const code = e.code;
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }
    if (code === 'Space') {
      if (!e.repeat) {
        this.mouseUsed = false;
        this.spaceDown = true;
        this.syncActionEdges();
      }
      return;
    }
    this.keys.add(code);
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    if (code === 'Space') {
      this.spaceDown = false;
      this.syncActionEdges();
      return;
    }
    this.keys.delete(code);
  };

  private readonly handleCanvasPointerDown = (e: PointerEvent): void => {
    if (!this.activePlaying || this.modalOpen) return;
    if (e.pointerType === 'touch') {
      this.markTouchUsed();
      if (this.joyPointerId === null) {
        this.joyPointerId = e.pointerId;
        this.joyOriginX = e.clientX;
        this.joyOriginY = e.clientY;
        this.joyKnobX = e.clientX;
        this.joyKnobY = e.clientY;
        this.joyMoveX = 0;
        this.joyMoveY = 0;
      }
      return;
    }

    if (e.button === 0) {
      this.mouseUsed = true;
      this.updateMouseAim(e.clientX, e.clientY);
      this.mouseDown = true;
      this.syncActionEdges();
    }
  };

  private readonly handleWindowPointerMove = (e: PointerEvent): void => {
    if (!this.activePlaying || this.modalOpen) return;
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.joyPointerId) {
        const dx = e.clientX - this.joyOriginX;
        const dy = e.clientY - this.joyOriginY;
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, this.joyMaxRadius);
        const angle = dist > 0 ? Math.atan2(dy, dx) : 0;
        this.joyKnobX = this.joyOriginX + Math.cos(angle) * clamped;
        this.joyKnobY = this.joyOriginY + Math.sin(angle) * clamped;
        if (dist <= this.joyDeadzone) {
          this.joyMoveX = 0;
          this.joyMoveY = 0;
        } else {
          const strength = Math.min(
            1,
            (dist - this.joyDeadzone) / (this.joyMaxRadius - this.joyDeadzone),
          );
          this.joyMoveX = Math.cos(angle) * strength;
          this.joyMoveY = Math.sin(angle) * strength;
        }
      }
      return;
    }

    if (e.pointerType === 'mouse') {
      this.mouseUsed = true;
      this.updateMouseAim(e.clientX, e.clientY);
    }
  };

  private readonly handleWindowPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.joyPointerId) {
        this.joyPointerId = null;
        this.joyMoveX = 0;
        this.joyMoveY = 0;
      }
      if (e.pointerId === this.actionTouchPointerId) {
        this.actionTouchPointerId = null;
        this.touchButtonDown = false;
        this.syncActionEdges();
      }
      return;
    }

    if (e.button === 0 || this.mouseDown) {
      this.mouseDown = false;
      this.syncActionEdges();
    }
  };

  private readonly handleActionBtnDown = (e: PointerEvent): void => {
    if (!this.activePlaying || this.modalOpen) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.pointerType === 'touch') {
      this.markTouchUsed();
    }
    this.actionTouchPointerId = e.pointerId;
    try {
      this.touchActionBtn?.setPointerCapture(e.pointerId);
    } catch {
      // Safe fallback
    }
    this.touchButtonDown = true;
    this.syncActionEdges();
  };

  private readonly handleActionBtnUp = (e: PointerEvent): void => {
    if (e.pointerId === this.actionTouchPointerId || this.touchButtonDown) {
      e.preventDefault();
      this.actionTouchPointerId = null;
      this.touchButtonDown = false;
      this.syncActionEdges();
    }
  };

  private readonly handleBlur = (): void => {
    this.resetAll();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.resetAll();
    }
  };
}
