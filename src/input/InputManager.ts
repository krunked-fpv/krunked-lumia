import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type ActionVerb,
  type InputFrame,
  type UserSettings,
} from '../contracts/index.js';
import {
  BOARD_ZOOM_FACTOR,
  computeLetterboxRect,
  type ViewportTransform,
} from '../render/WebGL2Renderer.js';

export type InputCaptureResult =
  | { type: 'keyboard'; code: string }
  | { type: 'gamepad'; button: number };

export type InputCaptureCallback = (result: InputCaptureResult) => void;

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

const STICK_DEADZONE = 0.45;
const GP_DPAD_UP = 12;
const GP_DPAD_DOWN = 13;
const GP_DPAD_LEFT = 14;
const GP_DPAD_RIGHT = 15;

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
  hardDrop: [13],
  spinLeft: [2, 4],
  spinRight: [0, 5],
  pause: [9],
};

/**
 * Maps browser client pointer coordinates into exact logical 320x180 pixels,
 * accounting for aspect-ratio letterboxing, 90-degree CW Tate rotation, and Board Zoom.
 */
export function mapClientToLogical(
  clientX: number,
  clientY: number,
  canvasRect: ClientRectLike,
  transform: ViewportTransform,
): { x: number; y: number; inBounds: boolean } {
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

  const x = u * LOGICAL_WIDTH;
  const y = (1 - v) * LOGICAL_HEIGHT;
  const inBounds = inViewport && x >= 0 && x <= LOGICAL_WIDTH && y >= 0 && y <= LOGICAL_HEIGHT;
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

/**
 * Unified Keyboard, Mouse (logical 320x180 mapped), and Gamepad Input Manager.
 * Separates UI edge latches from 60 Hz Simulation edge latches so neither steals presses
 * at 30/60/120 FPS, and supports live key/gamepad capture for Controls Remapping.
 */
export class InputManager {
  private canvas: HTMLCanvasElement | null = null;
  private viewportProvider: (() => ViewportTransform) | null = null;
  private attached = false;

  // Keyboard state
  private readonly heldKeys = new Set<string>();
  private readonly uiPressedKeys = new Set<string>();
  private readonly simPressedKeys = new Set<string>();

  // Gamepad state
  private readonly heldGpButtons = new Set<number>();
  private readonly prevUiGpButtons = new Set<number>();
  private readonly prevSimGpButtons = new Set<number>();

  // Mouse state in logical 320x180 coordinates
  private mouseX = LOGICAL_WIDTH * 0.5;
  private mouseY = LOGICAL_HEIGHT * 0.5;
  private mouseInBounds = false;
  private mouseDown = false;
  private mouseClicked = false;
  private mouseMoved = false;

  private usingGamepad = false;
  private captureCallback: InputCaptureCallback | null = null;

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
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
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
    }
    window.removeEventListener('pointerup', this.onPointerUp);
    this.attached = false;
  }

  dispose(): void {
    this.detach();
    this.captureCallback = null;
  }

  clearEdges(): void {
    this.uiPressedKeys.clear();
    this.simPressedKeys.clear();
    this.mouseClicked = false;
    this.mouseMoved = false;
    this.prevUiGpButtons.clear();
    this.prevSimGpButtons.clear();
    for (const btn of this.heldGpButtons) {
      this.prevUiGpButtons.add(btn);
      this.prevSimGpButtons.add(btn);
    }
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
    } else {
      this.heldKeys.delete(code);
    }
  }

  /** Test/debug helper to inject logical 320x180 pointer state directly. */
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
    this.usingGamepad = false;
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
    };
  }

  private updateMouseFromPointerEvent(e: PointerEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const transform = this.getEffectiveViewportTransform(rect);
    const mapped = mapClientToLogical(e.clientX, e.clientY, rect, transform);
    this.mouseX = mapped.x;
    this.mouseY = mapped.y;
    this.mouseInBounds = mapped.inBounds;
    this.mouseMoved = true;
    this.usingGamepad = false;
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
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.updateMouseFromPointerEvent(e);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.updateMouseFromPointerEvent(e);
    this.mouseDown = true;
    if (this.mouseInBounds && !this.captureCallback) {
      this.mouseClicked = true;
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.mouseDown = false;
  };

  private readGamepadState(): void {
    this.heldGpButtons.clear();
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return;
    }
    const pads = navigator.getGamepads();
    if (!pads) return;

    for (let p = 0; p < pads.length; p++) {
      const pad = pads[p];
      if (!pad || !pad.connected) continue;

      for (let b = 0; b < pad.buttons.length; b++) {
        const btn = pad.buttons[b];
        if (btn && (btn.pressed || btn.value > 0.5)) {
          this.heldGpButtons.add(b);
        }
      }

      // Map left analog stick cleanly onto standard D-pad virtual indices
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (ax < -STICK_DEADZONE) this.heldGpButtons.add(GP_DPAD_LEFT);
      if (ax > STICK_DEADZONE) this.heldGpButtons.add(GP_DPAD_RIGHT);
      if (ay < -STICK_DEADZONE) this.heldGpButtons.add(GP_DPAD_UP);
      if (ay > STICK_DEADZONE) this.heldGpButtons.add(GP_DPAD_DOWN);
      break;
    }

    if (this.heldGpButtons.size > 0) {
      this.usingGamepad = true;
    }

    // Check live capture mode for newly pressed gamepad button
    if (this.captureCallback) {
      for (const btn of this.heldGpButtons) {
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

  private anyKeyIn(codes: readonly string[], set: ReadonlySet<string>): boolean {
    for (let i = 0; i < codes.length; i++) {
      if (set.has(codes[i])) return true;
    }
    return false;
  }

  private anyGpHeld(buttons: readonly number[]): boolean {
    for (let i = 0; i < buttons.length; i++) {
      if (this.heldGpButtons.has(buttons[i])) return true;
    }
    return false;
  }

  private anyGpEdge(buttons: readonly number[], prevSet: ReadonlySet<number>): boolean {
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      if (this.heldGpButtons.has(b) && !prevSet.has(b)) return true;
    }
    return false;
  }

  isActionHeld(verb: ActionVerb, settings?: UserSettings): boolean {
    const kb = settings?.keyboard[verb] ?? FALLBACK_KB[verb];
    const gp = settings?.gamepad[verb] ?? FALLBACK_GP[verb];
    return this.anyKeyIn(kb, this.heldKeys) || this.anyGpHeld(gp);
  }

  /**
   * Edge-triggered UI input polling for menus, settings, palette editor, and pause checks.
   */
  pollUiInput(settings?: UserSettings): UiInputState {
    this.readGamepadState();

    if (this.captureCallback) {
      this.uiPressedKeys.clear();
      this.mouseClicked = false;
      this.mouseMoved = false;
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
      };
    }

    const edge = (verb: ActionVerb): boolean => {
      const kbCodes = settings?.keyboard[verb] ?? FALLBACK_KB[verb];
      const gpBtns = settings?.gamepad[verb] ?? FALLBACK_GP[verb];
      return (
        this.anyKeyIn(kbCodes, this.uiPressedKeys) ||
        this.anyGpEdge(gpBtns, this.prevUiGpButtons)
      );
    };

    const state: UiInputState = {
      up: edge('up'),
      down: edge('down'),
      left: edge('left'),
      right: edge('right'),
      confirm: edge('confirm'),
      cancel: edge('cancel'),
      pause: edge('pause'),
      upHeld: this.isActionHeld('up', settings),
      downHeld: this.isActionHeld('down', settings),
      leftHeld: this.isActionHeld('left', settings),
      rightHeld: this.isActionHeld('right', settings),
      mousePos: { x: this.mouseX, y: this.mouseY },
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      mouseInBounds: this.mouseInBounds,
      mouseDown: this.mouseDown,
      mouseClicked: this.mouseClicked,
      mouseMoved: this.mouseMoved,
      usingGamepad: this.usingGamepad,
    };

    // Consume UI edge latches
    this.uiPressedKeys.clear();
    this.mouseClicked = false;
    this.mouseMoved = false;
    this.prevUiGpButtons.clear();
    for (const btn of this.heldGpButtons) {
      this.prevUiGpButtons.add(btn);
    }

    return state;
  }

  /**
   * Produces an exact deterministic InputFrame for one 60 Hz simulation step.
   */
  pollSimInputFrame(settings: UserSettings): InputFrame {
    this.readGamepadState();

    if (this.captureCallback) {
      this.simPressedKeys.clear();
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
      this.anyGpEdge(gp[verb] ?? [], this.prevSimGpButtons);

    const frame: InputFrame = {
      moveLeft: this.isActionHeld('moveLeft', settings),
      moveRight: this.isActionHeld('moveRight', settings),
      moveLeftPressed: edge('moveLeft'),
      moveRightPressed: edge('moveRight'),
      spinLeftPressed: edge('spinLeft'),
      spinRightPressed: edge('spinRight'),
      hardDropPressed: edge('hardDrop'),
      usingGamepad: this.usingGamepad,
      moveSpeedIndex: settings.gameplay.moveSpeedIndex,
      kbMoveDelay: settings.gameplay.kbMoveDelay,
      gpMoveDelay: settings.gameplay.gpMoveDelay,
    };

    // Consume Sim edge latches
    this.simPressedKeys.clear();
    this.prevSimGpButtons.clear();
    for (const btn of this.heldGpButtons) {
      this.prevSimGpButtons.add(btn);
    }

    return frame;
  }

  /**
   * Optional tactile gamepad haptic rumble (safely no-ops when unsupported or disabled).
   */
  triggerRumble(intensity: number, durationMs: number, enabled = true): void {
    if (!enabled || intensity <= 0 || durationMs <= 0) {
      return;
    }
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return;
    }
    try {
      const pads = navigator.getGamepads();
      if (!pads) return;
      const clamped = Math.max(0, Math.min(1, intensity));
      for (let p = 0; p < pads.length; p++) {
        const pad = pads[p] as
          | (Gamepad & {
              vibrationActuator?: {
                playEffect?: (
                  type: string,
                  params: {
                    duration: number;
                    strongMagnitude: number;
                    weakMagnitude: number;
                  },
                ) => Promise<unknown>;
              };
            })
          | null;
        if (!pad || !pad.connected || !pad.vibrationActuator?.playEffect) continue;
        void pad.vibrationActuator.playEffect('dual-rumble', {
          duration: Math.round(durationMs),
          strongMagnitude: clamped,
          weakMagnitude: clamped * 0.6,
        });
        break;
      }
    } catch {
      // Ignore browser haptic errors cleanly
    }
  }
}
