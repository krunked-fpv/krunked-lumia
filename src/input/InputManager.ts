import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type ActionVerb,
  type ControllerKind,
  type InputFrame,
  type UserSettings,
} from '../contracts/index.js';
import {
  BOARD_ZOOM_FACTOR,
  computeLetterboxRect,
  type ViewportTransform,
} from '../render/WebGL2Renderer.js';
import {
  GamepadAdapter,
  type GamepadPollResult,
  type GamepadSnapshot,
} from './GamepadAdapter.js';
import { TouchController, type TouchVisualState } from './TouchController.js';

export type InputCaptureResult =
  | { type: 'keyboard'; code: string }
  | { type: 'gamepad'; button: number };

export type InputCaptureCallback = (result: InputCaptureResult) => void;
export type InputDeviceKind = 'keyboard' | 'mouse' | 'touch' | 'gamepad';

export interface UiInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
  pause: boolean;
  upHeld: boolean;
  downHeld: boolean;
  leftHeld: boolean;
  rightHeld: boolean;
  mousePos: { x: number; y: number };
  mouseX: number;
  mouseY: number;
  mouseInBounds: boolean;
  mouseDown: boolean;
  mouseClicked: boolean;
  mouseMoved: boolean;
  usingGamepad: boolean;
  isTouchPointer?: boolean;
  scrollDelta?: number;
  anyGamepadPressed?: boolean;
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PREVENT_SCROLL_CODES = new Set<string>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

const MENU_REPEAT_DELAY_SEC = 0.28;
const MENU_REPEAT_RATE_SEC = 0.095;
const TOUCH_MENU_SCROLL_THRESHOLD_PX = 8;

const FALLBACK_KB: Record<ActionVerb, readonly string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'Space', 'KeyZ'],
  cancel: ['Escape', 'Backspace', 'KeyX'],
  moveLeft: ['ArrowLeft', 'KeyA'],
  moveRight: ['ArrowRight', 'KeyD'],
  hardDrop: ['ArrowDown', 'KeyS', 'Space'],
  spinLeft: ['KeyZ', 'KeyQ', 'ShiftLeft'],
  spinRight: ['KeyX', 'KeyE', 'ArrowUp', 'KeyW'],
  pause: ['Escape', 'KeyP'],
};

const FALLBACK_GP: Record<ActionVerb, readonly number[]> = {
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  confirm: [0],
  cancel: [1],
  moveLeft: [14],
  moveRight: [15],
  hardDrop: [13, 3],
  spinLeft: [1, 2, 4, 6],
  spinRight: [0, 5, 7],
  pause: [9, 8],
};

/**
 * Maps browser client pointer coordinates into exact logical pixels (320x180 landscape or
 * 180x320 portrait), accounting for aspect-ratio letterboxing, 90-degree CW Tate rotation,
 * and Board Zoom.
 */
export function mapClientToLogical(
  clientX: number,
  clientY: number,
  canvasRect: ClientRectLike,
  transform: ViewportTransform,
): { x: number; y: number; inBounds: boolean } {
  const logicalW = transform.logicalWidth ?? LOGICAL_WIDTH;
  const logicalH = transform.logicalHeight ?? LOGICAL_HEIGHT;

  const localX = clientX - canvasRect.left;
  const localY = clientY - canvasRect.top;
  const viewW = Math.max(1, transform.viewW);
  const viewH = Math.max(1, transform.viewH);

  const nx = (localX - transform.viewX) / viewW;
  const ny = (localY - transform.viewY) / viewH;
  const inViewport = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;

  // Convert CSS top-down normalized [0..1] to OpenGL bottom-up quad UV
  const qx = nx;
  const qy = 1 - ny;

  // Match PRESENT_VERT_SRC UV transform: Tate 90-deg CW first, then Board Zoom around (0.5, 0.5)
  let u = transform.tateRotate ? 1 - qy : qx;
  let v = transform.tateRotate ? qx : qy;

  if (transform.boardZoom) {
    u = (u - 0.5) / BOARD_ZOOM_FACTOR + 0.5;
    v = (v - 0.5) / BOARD_ZOOM_FACTOR + 0.5;
  }

  const x = u * logicalW;
  const y = (1 - v) * logicalH;
  const inBounds = inViewport && x >= 0 && x <= logicalW && y >= 0 && y <= logicalH;
  return { x, y, inBounds };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined') {
    return false;
  }
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

type RepeatDir = 'up' | 'down' | 'left' | 'right';

/**
 * Unified Keyboard, Mouse, Multi-Touch (Virtual Stick + Buttons + Menu Swipe/Drag),
 * and Full Xbox/Tesla/W3C Gamepad Input Manager.
 */
export class InputManager {
  private canvas: HTMLCanvasElement | null = null;
  private viewportProvider: (() => ViewportTransform) | null = null;
  private attached = false;

  private readonly gamepadAdapter = new GamepadAdapter();
  private readonly touchController = new TouchController();

  // Keyboard state
  private readonly heldKeys = new Set<string>();
  private readonly uiPressedKeys = new Set<string>();
  private readonly simPressedKeys = new Set<string>();

  // Gamepad state (separate UI & Sim canonical button sets)
  private readonly heldUiGpButtons = new Set<number>();
  private readonly heldSimGpButtons = new Set<number>();
  private readonly prevUiGpButtons = new Set<number>();
  private readonly prevSimGpButtons = new Set<number>();
  private gpRightStickSpinLeft = false;
  private gpRightStickSpinRight = false;
  private gpAnyNewButtonPressed = false;
  private lastGamepadPoll: GamepadPollResult | null = null;

  // Pointer / Mouse / Menu-Touch state in logical coordinates
  private mouseX = LOGICAL_WIDTH * 0.5;
  private mouseY = LOGICAL_HEIGHT * 0.5;
  private mouseInBounds = false;
  private mouseDown = false;
  private mouseClicked = false;
  private mouseMoved = false;
  private isTouchPointer = false;
  private scrollDelta = 0;

  // Menu touch tap-vs-scroll gesture tracker
  private menuTouchPointerId: number | null = null;
  private menuTouchStartX = 0;
  private menuTouchStartY = 0;
  private menuTouchLastY = 0;
  private menuTouchDraggingScroll = false;
  private menuTouchDraggingHorizontal = false;
  private menuTouchInBounds = false;

  // Gameplay touch routing mode
  private gameplayActive = false;
  private gameplayPortrait = false;
  private touchControlsAllowed = true;

  // Active device sensing
  private usingGamepad = false;
  private touchSensed = false;
  private lastInputKind: InputDeviceKind = 'keyboard';
  private captureCallback: InputCaptureCallback | null = null;
  private onAudioUnlockCallback: (() => void) | null = null;

  // Menu directional auto-repeat timers
  private readonly repeatTimers: Record<RepeatDir, { held: boolean; elapsed: number; repeating: boolean }> = {
    up: { held: false, elapsed: 0, repeating: false },
    down: { held: false, elapsed: 0, repeating: false },
    left: { held: false, elapsed: 0, repeating: false },
    right: { held: false, elapsed: 0, repeating: false },
  };

  constructor(
    canvas?: HTMLCanvasElement | null,
    viewportProvider?: () => ViewportTransform,
  ) {
    if (viewportProvider) {
      this.viewportProvider = viewportProvider;
    }
    if (canvas) {
      this.attach(canvas, viewportProvider);
    }
  }

  setViewportTransformProvider(provider: () => ViewportTransform): void {
    this.viewportProvider = provider;
  }

  setOnAudioUnlock(callback: (() => void) | null): void {
    this.onAudioUnlockCallback = callback;
  }

  setGameplayContext(active: boolean, portrait: boolean, touchControlsAllowed = true): void {
    const layoutChanged = this.gameplayPortrait !== portrait || this.gameplayActive !== active;
    this.gameplayActive = active;
    this.gameplayPortrait = portrait;
    this.touchControlsAllowed = touchControlsAllowed;
    if (layoutChanged) {
      this.touchController.reset(portrait);
      this.resetMenuTouchGesture();
    }
  }

  isTouchSensed(): boolean {
    return this.touchSensed;
  }

  getLastInputKind(): InputDeviceKind {
    return this.lastInputKind;
  }

  getTouchVisualState(portrait: boolean): TouchVisualState {
    return this.touchController.getVisualState(portrait);
  }

  updateTouchVisuals(dtSec: number, portrait: boolean): void {
    this.touchController.updateVisuals(dtSec, portrait);
  }

  getControllerStatus(): {
    connectedCount: number;
    activePadIndex: number | null;
    activePadId: string | null;
    controllerKind: ControllerKind | null;
  } {
    return this.gamepadAdapter.getStatus();
  }

  attach(canvas: HTMLCanvasElement, viewportProvider?: () => ViewportTransform): void {
    if (this.attached) {
      this.detach();
    }
    this.canvas = canvas;
    if (viewportProvider) {
      this.viewportProvider = viewportProvider;
    }
    if (typeof window === 'undefined') {
      return;
    }
    // Coarse-pointer heuristic (mobile phones/tablets) primes touch sensing immediately
    if (
      typeof window.matchMedia === 'function' &&
      (window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0)
    ) {
      this.touchSensed = true;
      this.lastInputKind = 'touch';
    }

    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('lostpointercapture', this.onPointerCancel);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached || typeof window === 'undefined') {
      this.attached = false;
      return;
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    if (this.canvas) {
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
      this.canvas.removeEventListener('lostpointercapture', this.onPointerCancel);
      this.canvas.removeEventListener('wheel', this.onWheel);
    }
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.attached = false;
  }

  dispose(): void {
    this.detach();
    this.captureCallback = null;
    this.onAudioUnlockCallback = null;
    this.touchController.reset();
    this.gamepadAdapter.reset();
  }

  clearEdges(): void {
    this.uiPressedKeys.clear();
    this.simPressedKeys.clear();
    this.mouseClicked = false;
    this.mouseMoved = false;
    this.scrollDelta = 0;
    this.gpRightStickSpinLeft = false;
    this.gpRightStickSpinRight = false;
    this.gpAnyNewButtonPressed = false;
    this.touchController.clearEdges();
    this.prevUiGpButtons.clear();
    this.prevSimGpButtons.clear();
    for (const btn of this.heldUiGpButtons) {
      this.prevUiGpButtons.add(btn);
    }
    for (const btn of this.heldSimGpButtons) {
      this.prevSimGpButtons.add(btn);
    }
    this.resetRepeatTimers();
  }

  private resetRepeatTimers(): void {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      this.repeatTimers[dir].held = false;
      this.repeatTimers[dir].elapsed = 0;
      this.repeatTimers[dir].repeating = false;
    }
  }

  private resetMenuTouchGesture(): void {
    this.menuTouchPointerId = null;
    this.menuTouchDraggingScroll = false;
    this.menuTouchDraggingHorizontal = false;
    this.menuTouchInBounds = false;
    this.mouseDown = false;
  }

  startCapture(callback: InputCaptureCallback): void {
    this.captureCallback = callback;
    this.clearEdges();
  }

  cancelCapture(): void {
    this.captureCallback = null;
    this.clearEdges();
  }

  isCapturing(): boolean {
    return this.captureCallback !== null;
  }

  /** Test/debug helper to inject a synthetic keyboard event cleanly without a DOM. */
  injectKey(code: string, down: boolean): void {
    if (down) {
      if (this.captureCallback) {
        const cb = this.captureCallback;
        this.captureCallback = null;
        this.clearEdges();
        cb({ type: 'keyboard', code });
        return;
      }
      if (!this.heldKeys.has(code)) {
        this.uiPressedKeys.add(code);
        this.simPressedKeys.add(code);
      }
      this.heldKeys.add(code);
      this.usingGamepad = false;
      this.touchSensed = false;
      this.lastInputKind = 'keyboard';
    } else {
      this.heldKeys.delete(code);
    }
  }

  /** Test/debug helper to inject logical pointer state directly. */
  injectMouse(logicalX: number, logicalY: number, down = false, clicked = false): void {
    this.mouseX = logicalX;
    this.mouseY = logicalY;
    this.mouseInBounds =
      logicalX >= 0 && logicalX <= LOGICAL_WIDTH && logicalY >= 0 && logicalY <= LOGICAL_HEIGHT;
    this.mouseDown = down;
    if (clicked) {
      this.mouseClicked = true;
    }
    this.mouseMoved = true;
    this.isTouchPointer = false;
    this.usingGamepad = false;
    this.lastInputKind = 'mouse';
  }

  /** Test/debug helper to drive menu touch tap-vs-scroll disambiguation without DOM. */
  injectTouchMenuPointer(
    pointerId: number,
    phase: 'down' | 'move' | 'up' | 'cancel',
    logicalX: number,
    logicalY: number,
  ): void {
    this.touchSensed = true;
    this.isTouchPointer = true;
    this.usingGamepad = false;
    this.lastInputKind = 'touch';
    const inBounds =
      logicalX >= 0 && logicalX <= LOGICAL_WIDTH && logicalY >= 0 && logicalY <= LOGICAL_HEIGHT;
    this.handleMenuTouchPhase(pointerId, phase, logicalX, logicalY, inBounds);
  }

  /** Test/debug helper to inject gameplay touch events directly into TouchController. */
  injectTouchGameplayPointer(
    pointerId: number,
    phase: 'down' | 'move' | 'up' | 'cancel',
    logicalX: number,
    logicalY: number,
    portrait: boolean,
  ): boolean {
    this.touchSensed = true;
    this.isTouchPointer = true;
    this.usingGamepad = false;
    this.lastInputKind = 'touch';
    if (phase === 'down') return this.touchController.onPointerDown(pointerId, logicalX, logicalY, portrait);
    if (phase === 'move') return this.touchController.onPointerMove(pointerId, logicalX, logicalY, portrait);
    if (phase === 'cancel') return this.touchController.onPointerCancel(pointerId);
    return this.touchController.onPointerUp(pointerId);
  }

  private getEffectiveViewportTransform(canvasRect: ClientRectLike): ViewportTransform {
    if (this.viewportProvider) {
      return this.viewportProvider();
    }
    const lb = computeLetterboxRect(canvasRect.width, canvasRect.height, false);
    return {
      canvasCssWidth: canvasRect.width,
      canvasCssHeight: canvasRect.height,
      viewX: lb.x,
      viewY: lb.y,
      viewW: lb.w,
      viewH: lb.h,
      tateRotate: false,
      boardZoom: false,
      logicalWidth: LOGICAL_WIDTH,
      logicalHeight: LOGICAL_HEIGHT,
    };
  }

  private mapPointerEvent(e: PointerEvent): { x: number; y: number; inBounds: boolean } {
    if (!this.canvas) {
      return { x: this.mouseX, y: this.mouseY, inBounds: false };
    }
    const rect = this.canvas.getBoundingClientRect();
    const transform = this.getEffectiveViewportTransform(rect);
    return mapClientToLogical(e.clientX, e.clientY, rect, transform);
  }

  private handleMenuTouchPhase(
    pointerId: number,
    phase: 'down' | 'move' | 'up' | 'cancel',
    x: number,
    y: number,
    inBounds: boolean,
  ): void {
    if (phase === 'down') {
      if (this.menuTouchPointerId !== null) return;
      this.menuTouchPointerId = pointerId;
      this.menuTouchStartX = x;
      this.menuTouchStartY = y;
      this.menuTouchLastY = y;
      this.menuTouchDraggingScroll = false;
      this.menuTouchDraggingHorizontal = false;
      this.menuTouchInBounds = inBounds;
      this.mouseX = x;
      this.mouseY = y;
      this.mouseInBounds = inBounds;
      this.mouseDown = true;
      this.mouseMoved = true;
      return;
    }

    if (pointerId !== this.menuTouchPointerId) return;

    if (phase === 'move') {
      this.mouseX = x;
      this.mouseY = y;
      this.mouseInBounds = inBounds;
      this.mouseMoved = true;

      const totalDx = x - this.menuTouchStartX;
      const totalDy = y - this.menuTouchStartY;

      if (!this.menuTouchDraggingScroll && !this.menuTouchDraggingHorizontal) {
        if (Math.abs(totalDy) >= TOUCH_MENU_SCROLL_THRESHOLD_PX && Math.abs(totalDy) > Math.abs(totalDx) * 1.15) {
          this.menuTouchDraggingScroll = true;
          this.mouseDown = false; // Yield slider drag once vertical swipe is committed
          this.scrollDelta += -(y - this.menuTouchStartY);
          this.menuTouchLastY = y;
          return;
        }
        if (Math.abs(totalDx) >= TOUCH_MENU_SCROLL_THRESHOLD_PX && Math.abs(totalDx) > Math.abs(totalDy) * 1.2) {
          this.menuTouchDraggingHorizontal = true;
        }
      }

      if (this.menuTouchDraggingScroll) {
        this.scrollDelta += -(y - this.menuTouchLastY);
        this.menuTouchLastY = y;
      }
      return;
    }

    if (phase === 'up') {
      this.mouseX = x;
      this.mouseY = y;
      this.mouseInBounds = inBounds;
      const totalDist = Math.hypot(x - this.menuTouchStartX, y - this.menuTouchStartY);
      const shouldClick =
        !this.menuTouchDraggingScroll &&
        !this.menuTouchDraggingHorizontal &&
        totalDist < TOUCH_MENU_SCROLL_THRESHOLD_PX &&
        (inBounds || this.menuTouchInBounds) &&
        !this.captureCallback;

      this.mouseDown = false;
      this.menuTouchPointerId = null;
      this.menuTouchDraggingScroll = false;
      this.menuTouchDraggingHorizontal = false;
      if (shouldClick) {
        this.mouseClicked = true;
      }
      return;
    }

    // cancel
    this.resetMenuTouchGesture();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isEditableTarget(e.target)) {
      return;
    }
    if (PREVENT_SCROLL_CODES.has(e.code)) {
      e.preventDefault();
    }
    if (this.captureCallback) {
      e.preventDefault();
      if (!e.repeat) {
        const cb = this.captureCallback;
        this.captureCallback = null;
        this.clearEdges();
        cb({ type: 'keyboard', code: e.code });
      }
      return;
    }
    if (!e.repeat) {
      this.uiPressedKeys.add(e.code);
      this.simPressedKeys.add(e.code);
    }
    this.heldKeys.add(e.code);
    this.usingGamepad = false;
    this.touchSensed = false;
    this.lastInputKind = 'keyboard';
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.heldKeys.clear();
    this.uiPressedKeys.clear();
    this.simPressedKeys.clear();
    this.mouseDown = false;
    this.mouseClicked = false;
    this.scrollDelta = 0;
    this.touchController.reset(this.gameplayPortrait);
    this.resetMenuTouchGesture();
    this.resetRepeatTimers();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.gameplayActive) return;
    e.preventDefault();
    // Normalize wheel delta into roughly pixel-equivalent scroll steps
    const step = Math.sign(e.deltaY) * Math.min(48, Math.max(12, Math.abs(e.deltaY) * 0.4));
    this.scrollDelta += step;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const mapped = this.mapPointerEvent(e);
    if (e.pointerType === 'touch') {
      this.touchSensed = true;
      this.isTouchPointer = true;
      this.usingGamepad = false;
      this.lastInputKind = 'touch';
      if (this.gameplayActive && this.touchControlsAllowed) {
        this.touchController.onPointerMove(e.pointerId, mapped.x, mapped.y, this.gameplayPortrait);
        return;
      }
      this.handleMenuTouchPhase(e.pointerId, 'move', mapped.x, mapped.y, mapped.inBounds);
      return;
    }

    if (this.gameplayActive && this.touchController.hasActivePointers()) {
      this.touchController.onPointerMove(e.pointerId, mapped.x, mapped.y, this.gameplayPortrait);
    }

    this.mouseX = mapped.x;
    this.mouseY = mapped.y;
    this.mouseInBounds = mapped.inBounds;
    this.mouseMoved = true;
    this.isTouchPointer = false;
    this.usingGamepad = false;
    this.lastInputKind = 'mouse';
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    const mapped = this.mapPointerEvent(e);

    if (e.pointerType === 'touch') {
      this.touchSensed = true;
      this.isTouchPointer = true;
      this.usingGamepad = false;
      this.lastInputKind = 'touch';
      this.onAudioUnlockCallback?.();

      if (this.gameplayActive && this.touchControlsAllowed) {
        try {
          this.canvas?.setPointerCapture(e.pointerId);
        } catch {
          // Pointer capture optional
        }
        this.touchController.onPointerDown(e.pointerId, mapped.x, mapped.y, this.gameplayPortrait);
        return;
      }

      this.handleMenuTouchPhase(e.pointerId, 'down', mapped.x, mapped.y, mapped.inBounds);
      return;
    }

    if (e.button !== 0) return;

    this.mouseX = mapped.x;
    this.mouseY = mapped.y;
    this.mouseInBounds = mapped.inBounds;
    this.mouseMoved = true;
    this.isTouchPointer = false;
    this.usingGamepad = false;
    this.lastInputKind = 'mouse';

    // Allow desktop mouse clicks on the on-screen Pause button (or forced Touch Controls: ON)
    if (this.gameplayActive && this.touchControlsAllowed) {
      const captured = this.touchController.onPointerDown(
        e.pointerId,
        mapped.x,
        mapped.y,
        this.gameplayPortrait,
      );
      if (captured) {
        return;
      }
    }

    this.mouseDown = true;
    if (this.mouseInBounds && !this.captureCallback) {
      this.mouseClicked = true;
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (this.touchController.onPointerUp(e.pointerId)) {
        return;
      }
      const mapped = this.mapPointerEvent(e);
      this.handleMenuTouchPhase(e.pointerId, 'up', mapped.x, mapped.y, mapped.inBounds);
      return;
    }

    if (e.button !== 0) return;
    this.touchController.onPointerUp(e.pointerId);
    this.mouseDown = false;
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.touchController.onPointerCancel(e.pointerId);
    if (e.pointerType === 'touch') {
      this.handleMenuTouchPhase(e.pointerId, 'cancel', this.mouseX, this.mouseY, false);
    } else {
      this.mouseDown = false;
    }
  };

  private readNativeGamepads(): readonly (GamepadSnapshot | null)[] {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return [];
    }
    try {
      const pads = navigator.getGamepads();
      if (!pads) return [];
      return Array.from(pads) as readonly (GamepadSnapshot | null)[];
    } catch {
      return [];
    }
  }

  private readGamepadState(overridePads?: readonly (GamepadSnapshot | null)[]): void {
    const pads = overridePads ?? this.readNativeGamepads();
    const res = this.gamepadAdapter.poll(pads);
    this.lastGamepadPoll = res;

    this.heldUiGpButtons.clear();
    this.heldSimGpButtons.clear();
    for (const b of res.uiButtons) {
      this.heldUiGpButtons.add(b);
    }
    for (const b of res.simButtons) {
      this.heldSimGpButtons.add(b);
    }

    if (res.rightStickSpinLeft) this.gpRightStickSpinLeft = true;
    if (res.rightStickSpinRight) this.gpRightStickSpinRight = true;

    let newlyPressed = false;
    for (const b of this.heldUiGpButtons) {
      if (!this.prevUiGpButtons.has(b)) {
        newlyPressed = true;
        break;
      }
    }
    if (newlyPressed) {
      this.gpAnyNewButtonPressed = true;
      this.onAudioUnlockCallback?.();
    }

    if (res.anyActiveInput) {
      this.usingGamepad = true;
      this.touchSensed = false;
      this.lastInputKind = 'gamepad';
    }

    // Check live capture mode for newly pressed gamepad button
    if (this.captureCallback) {
      for (const btn of this.heldUiGpButtons) {
        if (!this.prevUiGpButtons.has(btn)) {
          const cb = this.captureCallback;
          this.captureCallback = null;
          this.clearEdges();
          cb({ type: 'gamepad', button: btn });
          return;
        }
      }
    }
  }

  /** Test/debug helper to poll synthetic GamepadSnapshots directly into InputManager. */
  injectGamepadSnapshots(pads: readonly (GamepadSnapshot | null)[]): GamepadPollResult | null {
    this.readGamepadState(pads);
    return this.lastGamepadPoll;
  }

  private anyKeyIn(codes: readonly string[], set: ReadonlySet<string>): boolean {
    for (let i = 0; i < codes.length; i++) {
      if (set.has(codes[i])) return true;
    }
    return false;
  }

  private anyGpHeld(buttons: readonly number[], set: ReadonlySet<number>): boolean {
    for (let i = 0; i < buttons.length; i++) {
      if (set.has(buttons[i])) return true;
    }
    return false;
  }

  private anyGpEdge(
    buttons: readonly number[],
    heldSet: ReadonlySet<number>,
    prevSet: ReadonlySet<number>,
  ): boolean {
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      if (heldSet.has(b) && !prevSet.has(b)) return true;
    }
    return false;
  }

  isActionHeld(verb: ActionVerb, settings?: UserSettings, forSim = false): boolean {
    const kb = settings?.keyboard[verb] ?? FALLBACK_KB[verb];
    const gp = settings?.gamepad[verb] ?? FALLBACK_GP[verb];
    const gpSet = forSim ? this.heldSimGpButtons : this.heldUiGpButtons;
    return this.anyKeyIn(kb, this.heldKeys) || this.anyGpHeld(gp, gpSet);
  }

  private stepMenuRepeat(dir: RepeatDir, freshEdge: boolean, held: boolean, dtSec: number): boolean {
    const state = this.repeatTimers[dir];
    if (freshEdge) {
      state.held = true;
      state.elapsed = 0;
      state.repeating = false;
      return true;
    }
    if (!held) {
      state.held = false;
      state.elapsed = 0;
      state.repeating = false;
      return false;
    }
    if (dtSec <= 0) {
      return false;
    }
    if (!state.held) {
      state.held = true;
      state.elapsed = 0;
      state.repeating = false;
      return false;
    }
    state.elapsed += dtSec;
    const threshold = state.repeating ? MENU_REPEAT_RATE_SEC : MENU_REPEAT_DELAY_SEC;
    if (state.elapsed >= threshold) {
      state.elapsed -= threshold;
      state.repeating = true;
      return true;
    }
    return false;
  }

  /**
   * Edge-triggered UI input polling for menus, settings, palette editor, and pause checks.
   * Supports smooth menu hold-repeat when `dtSec > 0`.
   */
  pollUiInput(settings?: UserSettings, dtSec = 0): UiInputState {
    this.readGamepadState();

    if (this.captureCallback) {
      this.uiPressedKeys.clear();
      this.mouseClicked = false;
      this.mouseMoved = false;
      this.scrollDelta = 0;
      this.gpAnyNewButtonPressed = false;
      return {
        up: false,
        down: false,
        left: false,
        right: false,
        confirm: false,
        cancel: false,
        pause: false,
        upHeld: false,
        downHeld: false,
        leftHeld: false,
        rightHeld: false,
        mousePos: { x: this.mouseX, y: this.mouseY },
        mouseX: this.mouseX,
        mouseY: this.mouseY,
        mouseInBounds: this.mouseInBounds,
        mouseDown: false,
        mouseClicked: false,
        mouseMoved: false,
        usingGamepad: this.usingGamepad,
        isTouchPointer: this.isTouchPointer,
        scrollDelta: 0,
        anyGamepadPressed: false,
      };
    }

    const edge = (verb: ActionVerb): boolean => {
      const kbCodes = settings?.keyboard[verb] ?? FALLBACK_KB[verb];
      const gpBtns = settings?.gamepad[verb] ?? FALLBACK_GP[verb];
      return (
        this.anyKeyIn(kbCodes, this.uiPressedKeys) ||
        this.anyGpEdge(gpBtns, this.heldUiGpButtons, this.prevUiGpButtons)
      );
    };

    const upHeld = this.isActionHeld('up', settings, false);
    const downHeld = this.isActionHeld('down', settings, false);
    const leftHeld = this.isActionHeld('left', settings, false);
    const rightHeld = this.isActionHeld('right', settings, false);

    const up = this.stepMenuRepeat('up', edge('up'), upHeld, dtSec);
    const down = this.stepMenuRepeat('down', edge('down'), downHeld, dtSec);
    const left = this.stepMenuRepeat('left', edge('left'), leftHeld, dtSec);
    const right = this.stepMenuRepeat('right', edge('right'), rightHeld, dtSec);
    const touchPause = this.touchController.consumePausePressed();

    const state: UiInputState = {
      up,
      down,
      left,
      right,
      confirm: edge('confirm'),
      cancel: edge('cancel'),
      pause: edge('pause') || touchPause,
      upHeld,
      downHeld,
      leftHeld,
      rightHeld,
      mousePos: { x: this.mouseX, y: this.mouseY },
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      mouseInBounds: this.mouseInBounds,
      mouseDown: this.mouseDown,
      mouseClicked: this.mouseClicked,
      mouseMoved: this.mouseMoved,
      usingGamepad: this.usingGamepad,
      isTouchPointer: this.isTouchPointer,
      scrollDelta: this.scrollDelta,
      anyGamepadPressed: this.gpAnyNewButtonPressed,
    };

    // Consume UI edge latches
    this.uiPressedKeys.clear();
    this.mouseClicked = false;
    this.mouseMoved = false;
    this.scrollDelta = 0;
    this.gpAnyNewButtonPressed = false;
    this.prevUiGpButtons.clear();
    for (const btn of this.heldUiGpButtons) {
      this.prevUiGpButtons.add(btn);
    }

    return state;
  }

  /**
   * Produces an exact deterministic InputFrame for one 60 Hz simulation step,
   * merging Keyboard, Xbox/Tesla/W3C Gamepad, and Translucent Touch Stick/Buttons cleanly.
   */
  pollSimInputFrame(settings: UserSettings): InputFrame {
    this.readGamepadState();

    if (this.captureCallback) {
      this.simPressedKeys.clear();
      this.gpRightStickSpinLeft = false;
      this.gpRightStickSpinRight = false;
      this.touchController.clearEdges();
      return {
        moveLeft: false,
        moveRight: false,
        moveLeftPressed: false,
        moveRightPressed: false,
        spinLeftPressed: false,
        spinRightPressed: false,
        hardDropPressed: false,
        usingGamepad: this.usingGamepad,
        moveSpeedIndex: settings.gameplay.moveSpeedIndex,
        kbMoveDelay: settings.gameplay.kbMoveDelay,
        gpMoveDelay: settings.gameplay.gpMoveDelay,
      };
    }

    const kb = settings.keyboard;
    const gp = settings.gamepad;
    const edge = (verb: ActionVerb): boolean =>
      this.anyKeyIn(kb[verb] ?? [], this.simPressedKeys) ||
      this.anyGpEdge(gp[verb] ?? [], this.heldSimGpButtons, this.prevSimGpButtons);

    const touch = this.touchController.consumeSimState();

    const frame: InputFrame = {
      moveLeft: this.isActionHeld('moveLeft', settings, true) || touch.moveLeft,
      moveRight: this.isActionHeld('moveRight', settings, true) || touch.moveRight,
      moveLeftPressed: edge('moveLeft') || touch.moveLeftPressed,
      moveRightPressed: edge('moveRight') || touch.moveRightPressed,
      spinLeftPressed: edge('spinLeft') || this.gpRightStickSpinLeft || touch.spinLeftPressed,
      spinRightPressed: edge('spinRight') || this.gpRightStickSpinRight || touch.spinRightPressed,
      hardDropPressed: edge('hardDrop') || touch.hardDropPressed,
      usingGamepad: this.usingGamepad,
      moveSpeedIndex: settings.gameplay.moveSpeedIndex,
      kbMoveDelay: settings.gameplay.kbMoveDelay,
      gpMoveDelay: settings.gameplay.gpMoveDelay,
    };

    // Consume Sim edge latches
    this.simPressedKeys.clear();
    this.gpRightStickSpinLeft = false;
    this.gpRightStickSpinRight = false;
    this.prevSimGpButtons.clear();
    for (const btn of this.heldSimGpButtons) {
      this.prevSimGpButtons.add(btn);
    }

    return frame;
  }

  /**
   * Tactile gamepad haptic rumble (Xbox/Tesla/PlayStation/Safari) + mobile touch vibration.
   */
  triggerRumble(intensity: number, durationMs: number, enabled = true): void {
    if (!enabled || intensity <= 0 || durationMs <= 0) {
      return;
    }

    const rumbledPad = this.gamepadAdapter.triggerRumble(
      this.readNativeGamepads(),
      intensity,
      durationMs,
      enabled,
    );

    if (
      !rumbledPad &&
      this.touchSensed &&
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      try {
        const ms = Math.max(8, Math.min(80, Math.round(durationMs * 0.45 * Math.min(1, intensity + 0.35))));
        navigator.vibrate(ms);
      } catch {
        // Ignore mobile vibrate permission errors cleanly
      }
    }
  }
}
