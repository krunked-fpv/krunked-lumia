import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  parseHexRgb01,
  type ActionVerb,
  type GamepadBindings,
  type KeyboardBindings,
  type Palette,
  type UserSettings,
} from '../contracts/index.js';
import {
  createDefaultGamepadBindings,
  createDefaultKeyboardBindings,
} from '../data/settingsDefaults.js';
import type { InputCaptureResult, InputManager, UiInputState } from '../input/InputManager.js';
import type { WebGL2Renderer } from '../render/WebGL2Renderer.js';

export type ControlsRemapRenderer = Pick<
  WebGL2Renderer,
  | 'drawSprite'
  | 'drawSpriteHex'
  | 'drawRect'
  | 'drawRectHex'
  | 'drawLine'
  | 'drawDiamondOutline'
  | 'drawText'
  | 'drawTextHex'
>;

export type ControlsDeviceTab = 'KEYBOARD' | 'CONTROLLER';

export const GAMEPLAY_ACTION_VERBS: readonly ActionVerb[] = [
  'moveLeft',
  'moveRight',
  'hardDrop',
  'spinLeft',
  'spinRight',
  'pause',
] as const;

export const MENU_ACTION_VERBS: readonly ActionVerb[] = [
  'up',
  'down',
  'left',
  'right',
  'confirm',
  'cancel',
] as const;

export const REMAPPABLE_VERBS: readonly ActionVerb[] = [
  ...GAMEPLAY_ACTION_VERBS,
  ...MENU_ACTION_VERBS,
] as const;

const VERB_DISPLAY_LABELS: Record<ActionVerb, string> = {
  moveLeft: 'MOVE LEFT',
  moveRight: 'MOVE RIGHT',
  hardDrop: 'HARD DROP',
  spinLeft: 'SPIN CCW',
  spinRight: 'SPIN CW',
  pause: 'PAUSE',
  up: 'MENU UP',
  down: 'MENU DOWN',
  left: 'MENU LEFT',
  right: 'MENU RIGHT',
  confirm: 'CONFIRM',
  cancel: 'CANCEL',
};

const GAMEPLAY_VERB_SET = new Set<ActionVerb>(GAMEPLAY_ACTION_VERBS);

export interface BindingConflict<T extends string | number = string | number> {
  group: 'gameplay' | 'menu';
  input: T;
  verbs: ActionVerb[];
}

export interface BindingConflictResult<T extends string | number = string | number> {
  hasGameplayConflicts: boolean;
  hasMenuConflicts: boolean;
  hasConflicts: boolean;
  conflictingVerbs: Set<ActionVerb>;
  gameplayConflictingVerbs: Set<ActionVerb>;
  menuConflictingVerbs: Set<ActionVerb>;
  conflicts: BindingConflict<T>[];
}

export interface ControlsRemapCallbacks {
  onApply: (bindings: { keyboard: KeyboardBindings; gamepad: GamepadBindings }) => void;
  onClose: () => void;
  onPlayMenuMove?: () => void;
  onPlayMenuSelect?: () => void;
  onPlayMenuBack?: () => void;
  onPlayMenuFail?: () => void;
}

// ============================================================================
// PURE CONFLICT DETECTION & HUMAN-READABLE KEY / BUTTON FORMATTING
// ============================================================================

/**
 * Detects duplicate key/button bindings WITHIN the gameplay action group
 * (`moveLeft`, `moveRight`, `hardDrop`, `spinLeft`, `spinRight`, `pause`) and
 * WITHIN the menu action group (`up`, `down`, `left`, `right`, `confirm`, `cancel`),
 * while cleanly permitting shared inputs across gameplay and menu verbs!
 */
export function detectBindingConflicts<T extends string | number>(
  bindings: Record<ActionVerb, readonly T[]>,
): BindingConflictResult<T> {
  const conflicts: BindingConflict<T>[] = [];
  const conflictingVerbs = new Set<ActionVerb>();
  const gameplayConflictingVerbs = new Set<ActionVerb>();
  const menuConflictingVerbs = new Set<ActionVerb>();

  const inspectGroup = (group: 'gameplay' | 'menu', verbs: readonly ActionVerb[]): void => {
    const inputMap = new Map<T, ActionVerb[]>();
    for (const verb of verbs) {
      const list = bindings[verb] ?? [];
      const seenInVerb = new Set<T>();
      for (const item of list) {
        if (seenInVerb.has(item)) continue;
        seenInVerb.add(item);
        const existing = inputMap.get(item);
        if (existing) {
          existing.push(verb);
        } else {
          inputMap.set(item, [verb]);
        }
      }
    }

    for (const [input, matchedVerbs] of inputMap.entries()) {
      if (matchedVerbs.length > 1) {
        conflicts.push({ group, input, verbs: [...matchedVerbs] });
        for (const v of matchedVerbs) {
          conflictingVerbs.add(v);
          if (group === 'gameplay') {
            gameplayConflictingVerbs.add(v);
          } else {
            menuConflictingVerbs.add(v);
          }
        }
      }
    }
  };

  inspectGroup('gameplay', GAMEPLAY_ACTION_VERBS);
  inspectGroup('menu', MENU_ACTION_VERBS);

  return {
    hasGameplayConflicts: gameplayConflictingVerbs.size > 0,
    hasMenuConflicts: menuConflictingVerbs.size > 0,
    hasConflicts: conflictingVerbs.size > 0,
    conflictingVerbs,
    gameplayConflictingVerbs,
    menuConflictingVerbs,
    conflicts,
  };
}

const KEY_CODE_LABELS: Readonly<Record<string, string>> = {
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  Space: 'SPACE',
  Enter: 'ENTER',
  NumpadEnter: 'NUM ENT',
  Escape: 'ESC',
  Backspace: 'BKSP',
  Tab: 'TAB',
  ShiftLeft: 'LSHIFT',
  ShiftRight: 'RSHIFT',
  ControlLeft: 'LCTRL',
  ControlRight: 'RCTRL',
  AltLeft: 'LALT',
  AltRight: 'RALT',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Delete: 'DEL',
  Insert: 'INS',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PGUP',
  PageDown: 'PGDN',
};

/** Format a browser `KeyboardEvent.code` into a crisp human-readable pixel label. */
export function formatKeyCode(code: string): string {
  if (Object.prototype.hasOwnProperty.call(KEY_CODE_LABELS, code)) {
    return KEY_CODE_LABELS[code];
  }
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (code.startsWith('Numpad')) {
    return `NUM ${code.slice(6).toUpperCase()}`;
  }
  return code.toUpperCase();
}

/** Format a gamepad button index into a crisp human-readable label (e.g. `GP B0`). */
export function formatGamepadButton(button: number): string {
  return `GP B${Math.max(0, Math.floor(button))}`;
}

export function formatKeyboardBindingList(codes: readonly string[]): string {
  if (codes.length === 0) return '--';
  return codes.map(formatKeyCode).join(' / ');
}

export function formatGamepadBindingList(buttons: readonly number[]): string {
  if (buttons.length === 0) return '--';
  return buttons.map(formatGamepadButton).join(' / ');
}

// ============================================================================
// LAYOUT & INTERNAL HELPERS
// ============================================================================

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hitTest(mx: number, my: number, rect: HitRect): boolean {
  return mx >= rect.x && mx < rect.x + rect.w && my >= rect.y && my < rect.y + rect.h;
}

function drawBox(
  renderer: ControlsRemapRenderer,
  x: number,
  y: number,
  w: number,
  h: number,
  fillHex: string,
  borderHex: string,
  fillAlpha = 0.94,
  borderAlpha = 1,
): void {
  if (fillAlpha > 0) {
    renderer.drawRectHex(x, y, w, h, fillHex, fillAlpha);
  }
  if (borderAlpha > 0) {
    renderer.drawRectHex(x, y, w, 1, borderHex, borderAlpha);
    renderer.drawRectHex(x, y + h - 1, w, 1, borderHex, borderAlpha);
    renderer.drawRectHex(x, y, 1, h, borderHex, borderAlpha);
    renderer.drawRectHex(x + w - 1, y, 1, h, borderHex, borderAlpha);
  }
}

function cloneKeyboardBindings(kb: KeyboardBindings): KeyboardBindings {
  const out = {} as KeyboardBindings;
  for (const verb of REMAPPABLE_VERBS) {
    out[verb] = [...(kb[verb] ?? [])];
  }
  return out;
}

function cloneGamepadBindings(gp: GamepadBindings): GamepadBindings {
  const out = {} as GamepadBindings;
  for (const verb of REMAPPABLE_VERBS) {
    out[verb] = [...(gp[verb] ?? [])];
  }
  return out;
}

const BACK_BTN_RECT: HitRect = { x: 8, y: 5, w: 34, h: 11 };
const TAB_KB_RECT: HitRect = { x: 24, y: 19, w: 132, h: 12 };
const TAB_GP_RECT: HitRect = { x: 164, y: 19, w: 132, h: 12 };
const FOOTER_APPLY_RECT: HitRect = { x: 52, y: 156, w: 68, h: 14 };
const FOOTER_RESET_RECT: HitRect = { x: 126, y: 156, w: 68, h: 14 };
const FOOTER_BACK_RECT: HitRect = { x: 200, y: 156, w: 68, h: 14 };

type FocusRegion = 'TABS' | 'LIST' | 'FOOTER';
const VISIBLE_ROWS = 7;

/**
 * Full Pixel-Native 320x180 Controls Remapping Screen (`MAP KEYBOARD` / `MAP CONTROLLER`).
 * Live conflict detection highlights conflicting gameplay bindings in Slot 5 crimson with
 * `*RESOLVE CONFLICTS` notice and blocks Apply until resolved.
 */
export class ControlsRemapScreen {
  private animTime = 0;
  private activeTab: ControlsDeviceTab = 'KEYBOARD';
  private focusRegion: FocusRegion = 'LIST';
  private verbIdx = 0;
  private scrollTop = 0;
  private footerIdx = 0; // 0 = APPLY, 1 = RESET, 2 = BACK

  private workingKeyboard: KeyboardBindings = createDefaultKeyboardBindings();
  private workingGamepad: GamepadBindings = createDefaultGamepadBindings();

  private capturingVerb: ActionVerb | null = null;
  private toastText = '';
  private toastTimer = 0;

  onEnter(settings: UserSettings): void {
    this.workingKeyboard = cloneKeyboardBindings(settings.keyboard);
    this.workingGamepad = cloneGamepadBindings(settings.gamepad);
    this.activeTab = 'KEYBOARD';
    this.focusRegion = 'LIST';
    this.verbIdx = 0;
    this.scrollTop = 0;
    this.footerIdx = 0;
    this.capturingVerb = null;
    this.toastText = '';
    this.toastTimer = 0;
  }

  // ==========================================================================
  // PUBLIC INSPECTORS & PROGRAMMATIC HELPERS
  // ==========================================================================

  getActiveTab(): ControlsDeviceTab {
    return this.activeTab;
  }

  setActiveTab(tab: ControlsDeviceTab, inputManager?: InputManager): void {
    if (this.capturingVerb !== null) {
      this.capturingVerb = null;
      inputManager?.cancelCapture();
    }
    this.activeTab = tab;
  }

  getWorkingKeyboard(): KeyboardBindings {
    return cloneKeyboardBindings(this.workingKeyboard);
  }

  getWorkingGamepad(): GamepadBindings {
    return cloneGamepadBindings(this.workingGamepad);
  }

  getCapturingVerb(): ActionVerb | null {
    return this.capturingVerb;
  }

  getKeyboardConflicts(): BindingConflictResult<string> {
    return detectBindingConflicts(this.workingKeyboard);
  }

  getGamepadConflicts(): BindingConflictResult<number> {
    return detectBindingConflicts(this.workingGamepad);
  }

  getActiveConflicts(): BindingConflictResult<string | number> {
    return this.activeTab === 'KEYBOARD'
      ? (this.getKeyboardConflicts() as BindingConflictResult<string | number>)
      : (this.getGamepadConflicts() as BindingConflictResult<string | number>);
  }

  hasBlockingConflicts(): boolean {
    return (
      this.getKeyboardConflicts().hasGameplayConflicts ||
      this.getGamepadConflicts().hasGameplayConflicts
    );
  }

  getToastText(): string {
    return this.toastTimer > 0 ? this.toastText : '';
  }

  showToast(text: string, durationSec = 2.2): void {
    this.toastText = text;
    this.toastTimer = durationSec;
  }

  beginCaptureForVerb(
    verb: ActionVerb,
    inputManager: InputManager,
    callbacks?: ControlsRemapCallbacks,
  ): void {
    this.capturingVerb = verb;
    const armCapture = (): void => {
      inputManager.startCapture((res: InputCaptureResult) => {
        this.handleCaptureResult(verb, res, inputManager, callbacks, armCapture);
      });
    };
    armCapture();
  }

  resetActiveTabDefaults(callbacks?: ControlsRemapCallbacks): void {
    if (this.activeTab === 'KEYBOARD') {
      this.workingKeyboard = createDefaultKeyboardBindings();
      this.showToast('KEYBOARD DEFAULTS RESTORED');
    } else {
      this.workingGamepad = createDefaultGamepadBindings();
      this.showToast('CONTROLLER DEFAULTS RESTORED');
    }
    callbacks?.onPlayMenuSelect?.();
  }

  applyBindings(callbacks: ControlsRemapCallbacks): boolean {
    if (this.hasBlockingConflicts()) {
      callbacks.onPlayMenuFail?.();
      this.showToast('*RESOLVE CONFLICTS BEFORE APPLYING', 2.4);
      return false;
    }
    callbacks.onApply({
      keyboard: cloneKeyboardBindings(this.workingKeyboard),
      gamepad: cloneGamepadBindings(this.workingGamepad),
    });
    callbacks.onPlayMenuSelect?.();
    this.showToast('CONTROLS UPDATED', 2.2);
    return true;
  }

  // ==========================================================================
  // CAPTURE HANDLER
  // ==========================================================================

  private handleCaptureResult(
    verb: ActionVerb,
    res: InputCaptureResult,
    _inputManager: InputManager,
    callbacks: ControlsRemapCallbacks | undefined,
    rearm: () => void,
  ): void {
    if (this.capturingVerb !== verb) {
      return;
    }

    if (this.activeTab === 'KEYBOARD') {
      if (res.type === 'keyboard') {
        if (res.code === 'F9') {
          this.capturingVerb = null;
          callbacks?.onPlayMenuBack?.();
          this.showToast('REMAP CANCELLED', 1.4);
          return;
        }
        if (res.code === 'Escape' && verb !== 'pause' && verb !== 'cancel') {
          this.capturingVerb = null;
          callbacks?.onPlayMenuBack?.();
          this.showToast('REMAP CANCELLED', 1.4);
          return;
        }
        this.workingKeyboard[verb] = [res.code];
        this.capturingVerb = null;
        callbacks?.onPlayMenuSelect?.();
        const conflict = this.getKeyboardConflicts();
        if (conflict.gameplayConflictingVerbs.has(verb)) {
          this.showToast('*RESOLVE CONFLICTS', 2.0);
        } else {
          this.showToast(`${VERB_DISPLAY_LABELS[verb]} -> ${formatKeyCode(res.code)}`, 1.6);
        }
        return;
      }
      // Wrong device pressed while mapping keyboard: keep listening cleanly
      this.showToast('PRESS A KEYBOARD KEY', 1.5);
      rearm();
      return;
    }

    // CONTROLLER tab
    if (res.type === 'gamepad') {
      this.workingGamepad[verb] = [res.button];
      this.capturingVerb = null;
      callbacks?.onPlayMenuSelect?.();
      const conflict = this.getGamepadConflicts();
      if (conflict.gameplayConflictingVerbs.has(verb)) {
        this.showToast('*RESOLVE CONFLICTS', 2.0);
      } else {
        this.showToast(`${VERB_DISPLAY_LABELS[verb]} -> ${formatGamepadButton(res.button)}`, 1.6);
      }
      return;
    }

    if (res.type === 'keyboard' && res.code === 'Escape') {
      this.capturingVerb = null;
      callbacks?.onPlayMenuBack?.();
      this.showToast('REMAP CANCELLED', 1.4);
      return;
    }

    this.showToast('PRESS A GAMEPAD BUTTON (ESC TO CANCEL)', 1.5);
    rearm();
  }

  // ==========================================================================
  // UPDATE LOOP (KEYBOARD + GAMEPAD + MOUSE)
  // ==========================================================================

  update(
    dtSec: number,
    uiInput: UiInputState,
    inputManager: InputManager,
    callbacks: ControlsRemapCallbacks,
  ): void {
    const dt = Math.max(0, Math.min(dtSec, 0.1));
    this.animTime += dt;
    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - dt);
    }

    // While live capture is active, freeze normal navigation (allow clicking BACK to abort)
    if (this.capturingVerb !== null) {
      if (!inputManager.isCapturing()) {
        this.capturingVerb = null;
      }
      return;
    }

    if (uiInput.cancel) {
      inputManager.cancelCapture();
      callbacks.onPlayMenuBack?.();
      callbacks.onClose();
      return;
    }

    // Touch swipe & mouse wheel scrolling over the 12-verb list
    const maxScroll = Math.max(0, REMAPPABLE_VERBS.length - VISIBLE_ROWS);
    if (uiInput.scrollDelta && Math.abs(uiInput.scrollDelta) >= 8 && maxScroll > 0) {
      const steps = Math.sign(uiInput.scrollDelta) * Math.max(1, Math.round(Math.abs(uiInput.scrollDelta) / 15));
      this.scrollTop = Math.max(0, Math.min(maxScroll, this.scrollTop + steps));
    }

    // Mouse / Touch interactions
    if (uiInput.mouseInBounds) {
      if (maxScroll > 0 && (uiInput.mouseClicked || uiInput.mouseDown)) {
        const scrollHit: HitRect = { x: 306, y: 33, w: 12, h: VISIBLE_ROWS * 15 + 4 };
        if (hitTest(uiInput.mouseX, uiInput.mouseY, scrollHit)) {
          const frac = Math.max(0, Math.min(1, (uiInput.mouseY - 35) / Math.max(1, VISIBLE_ROWS * 15 - 2)));
          this.scrollTop = Math.round(frac * maxScroll);
          return;
        }
      }

      if (uiInput.mouseClicked) {
        if (hitTest(uiInput.mouseX, uiInput.mouseY, BACK_BTN_RECT)) {
          inputManager.cancelCapture();
          callbacks.onPlayMenuBack?.();
          callbacks.onClose();
          return;
        }
        if (hitTest(uiInput.mouseX, uiInput.mouseY, TAB_KB_RECT)) {
          if (this.activeTab !== 'KEYBOARD') {
            this.setActiveTab('KEYBOARD', inputManager);
            callbacks.onPlayMenuMove?.();
          }
          this.focusRegion = 'TABS';
          return;
        }
        if (hitTest(uiInput.mouseX, uiInput.mouseY, TAB_GP_RECT)) {
          if (this.activeTab !== 'CONTROLLER') {
            this.setActiveTab('CONTROLLER', inputManager);
            callbacks.onPlayMenuMove?.();
          }
          this.focusRegion = 'TABS';
          return;
        }
        if (hitTest(uiInput.mouseX, uiInput.mouseY, FOOTER_APPLY_RECT)) {
          this.focusRegion = 'FOOTER';
          this.footerIdx = 0;
          this.applyBindings(callbacks);
          return;
        }
        if (hitTest(uiInput.mouseX, uiInput.mouseY, FOOTER_RESET_RECT)) {
          this.focusRegion = 'FOOTER';
          this.footerIdx = 1;
          this.resetActiveTabDefaults(callbacks);
          return;
        }
        if (hitTest(uiInput.mouseX, uiInput.mouseY, FOOTER_BACK_RECT)) {
          this.focusRegion = 'FOOTER';
          this.footerIdx = 2;
          inputManager.cancelCapture();
          callbacks.onPlayMenuBack?.();
          callbacks.onClose();
          return;
        }
      }

      const visibleEnd = Math.min(REMAPPABLE_VERBS.length, this.scrollTop + VISIBLE_ROWS);
      for (let i = this.scrollTop; i < visibleEnd; i++) {
        const slot = i - this.scrollTop;
        const rowRect: HitRect = { x: 12, y: 35 + slot * 15, w: 294, h: 13 };
        if (hitTest(uiInput.mouseX, uiInput.mouseY, rowRect)) {
          if (uiInput.mouseMoved && (this.focusRegion !== 'LIST' || this.verbIdx !== i)) {
            this.focusRegion = 'LIST';
            this.verbIdx = i;
            callbacks.onPlayMenuMove?.();
          }
          if (uiInput.mouseClicked) {
            this.focusRegion = 'LIST';
            this.verbIdx = i;
            callbacks.onPlayMenuSelect?.();
            this.beginCaptureForVerb(REMAPPABLE_VERBS[i], inputManager, callbacks);
            return;
          }
        }
      }

      if (uiInput.mouseMoved) {
        if (hitTest(uiInput.mouseX, uiInput.mouseY, FOOTER_APPLY_RECT)) {
          this.focusRegion = 'FOOTER';
          this.footerIdx = 0;
        } else if (hitTest(uiInput.mouseX, uiInput.mouseY, FOOTER_RESET_RECT)) {
          this.focusRegion = 'FOOTER';
          this.footerIdx = 1;
        } else if (hitTest(uiInput.mouseX, uiInput.mouseY, FOOTER_BACK_RECT)) {
          this.focusRegion = 'FOOTER';
          this.footerIdx = 2;
        }
      }
    }

    // Keyboard & Gamepad navigation
    if (this.focusRegion === 'TABS') {
      if (uiInput.left || uiInput.right) {
        this.setActiveTab(this.activeTab === 'KEYBOARD' ? 'CONTROLLER' : 'KEYBOARD', inputManager);
        callbacks.onPlayMenuMove?.();
      } else if (uiInput.down || uiInput.confirm) {
        this.focusRegion = 'LIST';
        callbacks.onPlayMenuMove?.();
      } else if (uiInput.up) {
        this.focusRegion = 'FOOTER';
        callbacks.onPlayMenuMove?.();
      }
      return;
    }

    if (this.focusRegion === 'LIST') {
      if (uiInput.up) {
        if (this.verbIdx <= 0) {
          this.focusRegion = 'TABS';
        } else {
          this.verbIdx -= 1;
          this.keepScrollInView();
        }
        callbacks.onPlayMenuMove?.();
      } else if (uiInput.down) {
        if (this.verbIdx >= REMAPPABLE_VERBS.length - 1) {
          this.focusRegion = 'FOOTER';
        } else {
          this.verbIdx += 1;
          this.keepScrollInView();
        }
        callbacks.onPlayMenuMove?.();
      } else if (uiInput.left || uiInput.right) {
        this.setActiveTab(this.activeTab === 'KEYBOARD' ? 'CONTROLLER' : 'KEYBOARD', inputManager);
        callbacks.onPlayMenuMove?.();
      } else if (uiInput.confirm) {
        callbacks.onPlayMenuSelect?.();
        this.beginCaptureForVerb(REMAPPABLE_VERBS[this.verbIdx], inputManager, callbacks);
      }
      return;
    }

    // FOOTER region
    if (uiInput.up) {
      this.focusRegion = 'LIST';
      this.verbIdx = REMAPPABLE_VERBS.length - 1;
      this.keepScrollInView();
      callbacks.onPlayMenuMove?.();
    } else if (uiInput.down) {
      this.focusRegion = 'TABS';
      callbacks.onPlayMenuMove?.();
    } else if (uiInput.left) {
      this.footerIdx = (this.footerIdx + 2) % 3;
      callbacks.onPlayMenuMove?.();
    } else if (uiInput.right) {
      this.footerIdx = (this.footerIdx + 1) % 3;
      callbacks.onPlayMenuMove?.();
    } else if (uiInput.confirm) {
      if (this.footerIdx === 0) {
        this.applyBindings(callbacks);
      } else if (this.footerIdx === 1) {
        this.resetActiveTabDefaults(callbacks);
      } else {
        inputManager.cancelCapture();
        callbacks.onPlayMenuBack?.();
        callbacks.onClose();
      }
    }
  }

  private keepScrollInView(): void {
    if (this.verbIdx < this.scrollTop) {
      this.scrollTop = this.verbIdx;
    } else if (this.verbIdx >= this.scrollTop + VISIBLE_ROWS) {
      this.scrollTop = this.verbIdx - VISIBLE_ROWS + 1;
    }
  }

  // ==========================================================================
  // PIXEL-NATIVE 320x180 RENDERING
  // ==========================================================================

  render(renderer: ControlsRemapRenderer, palette: Palette): void {
    // Subtle expanding pixel diamonds
    const cx = LOGICAL_WIDTH * 0.5;
    const cy = LOGICAL_HEIGHT * 0.5;
    for (let i = 0; i < 3; i++) {
      const phase = ((this.animTime * 0.1 + i / 3) % 1 + 1) % 1;
      const radius = 18 + phase * 165;
      const alpha = Math.sin(phase * Math.PI) * 0.16;
      if (alpha <= 0.01) continue;
      const [r, g, b] = parseHexRgb01(palette.colors[2 + (i % 4)]);
      renderer.drawDiamondOutline(cx, cy, radius, r, g, b, alpha);
    }

    // Header
    drawBox(
      renderer,
      BACK_BTN_RECT.x,
      BACK_BTN_RECT.y,
      BACK_BTN_RECT.w,
      BACK_BTN_RECT.h,
      palette.colors[1],
      palette.colors[2],
      0.88,
      0.7,
    );
    renderer.drawTextHex('< BACK', BACK_BTN_RECT.x + 17, BACK_BTN_RECT.y + 3, palette.colors[2], 1, '3x5', 'center');
    renderer.drawTextHex('CONTROLS REMAP', 160, 7, palette.colors[3], 1, '5x7', 'center');

    const kbConflicts = this.getKeyboardConflicts();
    const gpConflicts = this.getGamepadConflicts();
    const activeConflicts = this.activeTab === 'KEYBOARD' ? kbConflicts : gpConflicts;

    // Device Tabs: MAP KEYBOARD / MAP CONTROLLER
    this.renderDeviceTab(
      renderer,
      palette,
      TAB_KB_RECT,
      'MAP KEYBOARD',
      this.activeTab === 'KEYBOARD',
      this.focusRegion === 'TABS' && this.activeTab === 'KEYBOARD',
      kbConflicts.hasGameplayConflicts,
    );
    this.renderDeviceTab(
      renderer,
      palette,
      TAB_GP_RECT,
      'MAP CONTROLLER',
      this.activeTab === 'CONTROLLER',
      this.focusRegion === 'TABS' && this.activeTab === 'CONTROLLER',
      gpConflicts.hasGameplayConflicts,
    );

    // Verb Rows
    const visibleEnd = Math.min(REMAPPABLE_VERBS.length, this.scrollTop + VISIBLE_ROWS);
    for (let i = this.scrollTop; i < visibleEnd; i++) {
      const verb = REMAPPABLE_VERBS[i];
      const slot = i - this.scrollTop;
      const y = 35 + slot * 15;
      const selected = this.focusRegion === 'LIST' && i === this.verbIdx;
      const isCapturing = this.capturingVerb === verb;
      const isGameplay = GAMEPLAY_VERB_SET.has(verb);
      const isConflict = activeConflicts.gameplayConflictingVerbs.has(verb);

      const borderHex = isConflict
        ? palette.colors[5]
        : isCapturing || selected
          ? palette.colors[3]
          : palette.colors[2];
      drawBox(
        renderer,
        12,
        y,
        294,
        13,
        palette.colors[1],
        borderHex,
        isCapturing || selected ? 0.96 : 0.45,
        isConflict || isCapturing || selected ? 1 : 0.3,
      );

      if (selected || isCapturing) {
        renderer.drawSpriteHex(
          'arrow_spr',
          0,
          18,
          y + 6,
          isConflict ? palette.colors[5] : palette.colors[3],
          1,
        );
      }

      // Group pill [GAME] or [MENU]
      renderer.drawTextHex(
        isGameplay ? 'GAME' : 'MENU',
        25,
        y + 4,
        isConflict ? palette.colors[5] : isGameplay ? palette.colors[4] : palette.colors[2],
        isConflict ? 1 : 0.72,
        '3x5',
        'left',
      );

      // Action verb label
      renderer.drawTextHex(
        VERB_DISPLAY_LABELS[verb],
        48,
        y + 4,
        isConflict ? palette.colors[5] : selected ? palette.colors[3] : palette.colors[2],
        1,
        '3x5',
        'left',
      );

      // Binding readout or live capture prompt
      if (isCapturing) {
        const pulse = 0.65 + 0.35 * Math.sin(this.animTime * 8);
        renderer.drawTextHex(
          '(PRESS BUTTON TO REMAP)',
          301,
          y + 4,
          palette.colors[3],
          pulse,
          '3x5',
          'right',
        );
      } else {
        const bindingText =
          this.activeTab === 'KEYBOARD'
            ? formatKeyboardBindingList(this.workingKeyboard[verb])
            : formatGamepadBindingList(this.workingGamepad[verb]);
        const prefix = isConflict ? '! ' : '';
        renderer.drawTextHex(
          `${prefix}${bindingText}`,
          301,
          y + 4,
          isConflict ? palette.colors[5] : selected ? palette.colors[3] : palette.colors[2],
          1,
          '3x5',
          'right',
        );
      }
    }

    // Scrollbar
    if (REMAPPABLE_VERBS.length > VISIBLE_ROWS) {
      const trackX = 309;
      const trackY = 35;
      const trackH = VISIBLE_ROWS * 15 - 2;
      renderer.drawRectHex(trackX, trackY, 2, trackH, palette.colors[1], 0.9);
      const thumbH = Math.max(12, Math.round((VISIBLE_ROWS / REMAPPABLE_VERBS.length) * trackH));
      const maxScroll = Math.max(1, REMAPPABLE_VERBS.length - VISIBLE_ROWS);
      const thumbY = trackY + Math.round((this.scrollTop / maxScroll) * (trackH - thumbH));
      renderer.drawRectHex(trackX, thumbY, 2, thumbH, palette.colors[3], 1);
    }

    // Conflict Notice / Status Strip (y = 143..152)
    const anyBlocking = this.hasBlockingConflicts();
    if (anyBlocking) {
      drawBox(renderer, 12, 141, 296, 11, palette.colors[1], palette.colors[5], 0.92, 1);
      renderer.drawTextHex(
        '*RESOLVE CONFLICTS  (DUPLICATE GAMEPLAY BINDINGS)',
        160,
        144,
        palette.colors[5],
        1,
        '3x5',
        'center',
      );
    } else if (this.capturingVerb !== null) {
      renderer.drawTextHex(
        '(PRESS BUTTON TO REMAP)   ESC: CANCEL',
        160,
        144,
        palette.colors[3],
        1,
        '3x5',
        'center',
      );
    } else {
      const hint =
        this.activeTab === 'CONTROLLER'
          ? 'XBOX: A=B0 B=B1 X=B2 Y=B3 LB/LT=B4/6 RB/RT=B5/7 MENU=B9'
          : 'ENTER / CLICK VERB TO REMAP   SHARED MENU + GAME KEYS ALLOWED';
      renderer.drawTextHex(
        hint,
        160,
        144,
        palette.colors[2],
        0.78,
        '3x5',
        'center',
      );
    }

    // Footer Actions: APPLY, RESET, BACK
    this.renderFooterBtn(
      renderer,
      palette,
      FOOTER_APPLY_RECT,
      'APPLY',
      this.focusRegion === 'FOOTER' && this.footerIdx === 0,
      anyBlocking,
    );
    this.renderFooterBtn(
      renderer,
      palette,
      FOOTER_RESET_RECT,
      'RESET',
      this.focusRegion === 'FOOTER' && this.footerIdx === 1,
      false,
    );
    this.renderFooterBtn(
      renderer,
      palette,
      FOOTER_BACK_RECT,
      'BACK',
      this.focusRegion === 'FOOTER' && this.footerIdx === 2,
      false,
    );

    // Toast notification banner
    if (this.toastTimer > 0 && this.toastText) {
      const alpha = Math.min(1, this.toastTimer * 2);
      const w = Math.min(280, this.toastText.length * 4 + 16);
      const x = Math.round((LOGICAL_WIDTH - w) * 0.5);
      const isErr = this.toastText.startsWith('*');
      const accent = isErr ? palette.colors[5] : palette.colors[3];
      drawBox(renderer, x, 138, w, 13, palette.colors[1], accent, 0.96 * alpha, alpha);
      renderer.drawTextHex(this.toastText, 160, 142, accent, alpha, '3x5', 'center');
    }
  }

  private renderDeviceTab(
    renderer: ControlsRemapRenderer,
    palette: Palette,
    rect: HitRect,
    label: string,
    active: boolean,
    focused: boolean,
    hasConflict: boolean,
  ): void {
    const borderHex = hasConflict
      ? palette.colors[5]
      : active || focused
        ? palette.colors[3]
        : palette.colors[2];
    drawBox(
      renderer,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      palette.colors[1],
      borderHex,
      active ? 0.96 : 0.45,
      focused || active || hasConflict ? 1 : 0.4,
    );
    const displayLabel = hasConflict ? `! ${label}` : label;
    renderer.drawTextHex(
      displayLabel,
      rect.x + rect.w * 0.5,
      rect.y + 4,
      hasConflict ? palette.colors[5] : active ? palette.colors[3] : palette.colors[2],
      active || hasConflict ? 1 : 0.78,
      '3x5',
      'center',
    );
  }

  private renderFooterBtn(
    renderer: ControlsRemapRenderer,
    palette: Palette,
    rect: HitRect,
    label: string,
    selected: boolean,
    disabled: boolean,
  ): void {
    const borderHex = disabled
      ? palette.colors[5]
      : selected
        ? palette.colors[3]
        : palette.colors[2];
    drawBox(
      renderer,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      palette.colors[1],
      borderHex,
      selected ? 0.96 : 0.65,
      disabled ? 0.45 : selected ? 1 : 0.55,
    );
    renderer.drawTextHex(
      label,
      rect.x + rect.w * 0.5,
      rect.y + 4,
      disabled ? palette.colors[5] : selected ? palette.colors[3] : palette.colors[2],
      disabled ? 0.55 : 1,
      '5x7',
      'center',
    );
  }
}
