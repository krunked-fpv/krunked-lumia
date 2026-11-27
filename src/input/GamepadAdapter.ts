import type { ControllerKind } from '../contracts/index.js';

export interface GamepadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}

export interface GamepadVibrationActuatorLike {
  playEffect?: (
    type: string,
    params: {
      duration: number;
      strongMagnitude: number;
      weakMagnitude: number;
    },
  ) => Promise<unknown>;
  pulse?: (value: number, duration: number) => Promise<unknown>;
}

export interface GamepadHapticActuatorLike {
  pulse?: (value: number, duration: number) => Promise<unknown>;
}

export interface GamepadSnapshot {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: readonly GamepadButtonLike[];
  readonly axes: readonly number[];
  readonly vibrationActuator?: GamepadVibrationActuatorLike | null;
  readonly hapticActuators?: readonly GamepadHapticActuatorLike[] | null;
}

export interface GamepadPollResult {
  readonly simButtons: ReadonlySet<number>;
  readonly uiButtons: ReadonlySet<number>;
  readonly rightStickSpinLeft: boolean;
  readonly rightStickSpinRight: boolean;
  readonly anyActiveInput: boolean;
  readonly connectedCount: number;
  readonly activePadIndex: number | null;
  readonly activePadId: string | null;
  readonly controllerKind: ControllerKind | null;
}

// Canonical W3C Standard Gamepad button indices
export const GP_BTN_A = 0;
export const GP_BTN_B = 1;
export const GP_BTN_X = 2;
export const GP_BTN_Y = 3;
export const GP_BTN_LB = 4;
export const GP_BTN_RB = 5;
export const GP_BTN_LT = 6;
export const GP_BTN_RT = 7;
export const GP_BTN_VIEW = 8;
export const GP_BTN_MENU = 9;
export const GP_BTN_LS = 10;
export const GP_BTN_RS = 11;
export const GP_DPAD_UP = 12;
export const GP_DPAD_DOWN = 13;
export const GP_DPAD_LEFT = 14;
export const GP_DPAD_RIGHT = 15;
export const GP_BTN_GUIDE = 16;

const DIGITAL_THRESHOLD = 0.5;
const TRIGGER_THRESHOLD = 0.35;
const SIM_STICK_X_DEADZONE = 0.42;
const SIM_STICK_UP_DEADZONE = 0.5;
const SIM_STICK_DROP_DEADZONE = 0.72;
const SIM_STICK_DROP_CONE_RATIO = 1.45;
const UI_STICK_DEADZONE = 0.48;
const RIGHT_STICK_FLICK_ON = 0.7;
const RIGHT_STICK_FLICK_OFF = 0.3;

/**
 * Classifies a controller by its browser Gamepad.id string and optional User-Agent
 * (for Tesla in-car Chromium browsers).
 */
export function detectControllerKind(id: string, userAgent?: string): ControllerKind {
  const lowerId = (id || '').toLowerCase();
  const ua =
    userAgent !== undefined
      ? userAgent.toLowerCase()
      : typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
        ? navigator.userAgent.toLowerCase()
        : '';

  if (
    lowerId.includes('xbox') ||
    lowerId.includes('x-box') ||
    lowerId.includes('xinput') ||
    lowerId.includes('045e') ||
    lowerId.includes('microsoft')
  ) {
    return 'xbox';
  }
  if (
    lowerId.includes('dualsense') ||
    lowerId.includes('dualshock') ||
    lowerId.includes('playstation') ||
    lowerId.includes('054c') ||
    lowerId.includes('wireless controller')
  ) {
    return 'playstation';
  }
  if (
    lowerId.includes('nintendo') ||
    lowerId.includes('switch') ||
    lowerId.includes('pro controller') ||
    lowerId.includes('joy-con') ||
    lowerId.includes('057e')
  ) {
    return 'nintendo';
  }
  if (
    ua.includes('tesla/') ||
    ua.includes('qtcarbrowser') ||
    lowerId.includes('tesla')
  ) {
    return 'tesla';
  }
  return 'generic';
}

function isUsablePad(pad: GamepadSnapshot | null | undefined): pad is GamepadSnapshot {
  if (!pad || !pad.connected) {
    return false;
  }
  return (pad.buttons?.length ?? 0) > 0 || (pad.axes?.length ?? 0) > 0;
}

function decodePovHatAxis(value: number, out: Set<number>): void {
  // DirectInput / Linux POV hats report > 1.1 (commonly 3.2857) when centered/neutral
  if (!Number.isFinite(value) || value < -1.05 || value > 1.05) {
    return;
  }
  // 8 compass steps from -1.0 (Up) clockwise to +1.0 (Up-Left)
  const sector = Math.round(((value + 1) / 2) * 7);
  switch (sector) {
    case 0:
      out.add(GP_DPAD_UP);
      break;
    case 1:
      out.add(GP_DPAD_UP);
      out.add(GP_DPAD_RIGHT);
      break;
    case 2:
      out.add(GP_DPAD_RIGHT);
      break;
    case 3:
      out.add(GP_DPAD_DOWN);
      out.add(GP_DPAD_RIGHT);
      break;
    case 4:
      out.add(GP_DPAD_DOWN);
      break;
    case 5:
      out.add(GP_DPAD_DOWN);
      out.add(GP_DPAD_LEFT);
      break;
    case 6:
      out.add(GP_DPAD_LEFT);
      break;
    case 7:
      out.add(GP_DPAD_UP);
      out.add(GP_DPAD_LEFT);
      break;
    default:
      break;
  }
}

/**
 * Pure, DOM-free multi-controller normalizer for Xbox, Tesla Chromium (Linux evdev/xpad),
 * PlayStation, Nintendo, and generic W3C/HID gamepads.
 */
export class GamepadAdapter {
  private readonly simButtons = new Set<number>();
  private readonly uiButtons = new Set<number>();
  private readonly padSimScratch = new Set<number>();
  private readonly padUiScratch = new Set<number>();
  private readonly axisRestBaselines = new Map<number, number[]>();

  private activePadIndex: number | null = null;
  private activePadId: string | null = null;
  private controllerKind: ControllerKind | null = null;
  private connectedCount = 0;

  // Drift-safe right-stick quick-spin hysteresis (-1 = left latched, 0 = neutral, 1 = right latched)
  private rightStickLatched: -1 | 0 | 1 = 0;

  reset(): void {
    this.simButtons.clear();
    this.uiButtons.clear();
    this.rightStickLatched = 0;
  }

  getStatus(): {
    connectedCount: number;
    activePadIndex: number | null;
    activePadId: string | null;
    controllerKind: ControllerKind | null;
  } {
    return {
      connectedCount: this.connectedCount,
      activePadIndex: this.activePadIndex,
      activePadId: this.activePadId,
      controllerKind: this.controllerKind,
    };
  }

  poll(
    pads: readonly (GamepadSnapshot | null | undefined)[] | null | undefined,
    userAgent?: string,
  ): GamepadPollResult {
    this.simButtons.clear();
    this.uiButtons.clear();

    if (!pads || pads.length === 0) {
      this.connectedCount = 0;
      this.activePadIndex = null;
      this.activePadId = null;
      this.controllerKind = null;
      this.rightStickLatched = 0;
      return {
        simButtons: this.simButtons,
        uiButtons: this.uiButtons,
        rightStickSpinLeft: false,
        rightStickSpinRight: false,
        anyActiveInput: false,
        connectedCount: 0,
        activePadIndex: null,
        activePadId: null,
        controllerKind: null,
      };
    }

    let usableCount = 0;
    let firstUsable: GamepadSnapshot | null = null;
    let activePresent = false;
    let maxRightStickX = 0;
    let anyActiveInput = false;

    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!isUsablePad(pad)) continue;

      usableCount += 1;
      if (!firstUsable) {
        firstUsable = pad;
      }
      if (pad.index === this.activePadIndex) {
        activePresent = true;
      }

      this.padSimScratch.clear();
      this.padUiScratch.clear();

      const rx = this.readPadIntoSets(pad, this.padSimScratch, this.padUiScratch);
      if (Math.abs(rx) > Math.abs(maxRightStickX)) {
        maxRightStickX = rx;
      }

      const padHadActivity =
        this.padSimScratch.size > 0 ||
        this.padUiScratch.size > 0 ||
        Math.abs(rx) >= RIGHT_STICK_FLICK_ON;

      if (padHadActivity) {
        anyActiveInput = true;
        this.activePadIndex = pad.index;
        this.activePadId = pad.id;
        this.controllerKind = detectControllerKind(pad.id, userAgent);
        activePresent = true;
      }

      for (const b of this.padSimScratch) {
        this.simButtons.add(b);
      }
      for (const b of this.padUiScratch) {
        this.uiButtons.add(b);
      }
    }

    this.connectedCount = usableCount;
    if (usableCount === 0) {
      this.activePadIndex = null;
      this.activePadId = null;
      this.controllerKind = null;
      this.axisRestBaselines.clear();
    } else if (!activePresent && firstUsable) {
      this.activePadIndex = firstUsable.index;
      this.activePadId = firstUsable.id;
      this.controllerKind = detectControllerKind(firstUsable.id, userAgent);
    }

    // Drift-safe Right Stick Quick-Spin with hysteresis
    let rightStickSpinLeft = false;
    let rightStickSpinRight = false;
    if (maxRightStickX < -RIGHT_STICK_FLICK_ON) {
      if (this.rightStickLatched !== -1) {
        this.rightStickLatched = -1;
        rightStickSpinLeft = true;
      }
    } else if (maxRightStickX > RIGHT_STICK_FLICK_ON) {
      if (this.rightStickLatched !== 1) {
        this.rightStickLatched = 1;
        rightStickSpinRight = true;
      }
    } else if (Math.abs(maxRightStickX) < RIGHT_STICK_FLICK_OFF) {
      this.rightStickLatched = 0;
    }

    return {
      simButtons: this.simButtons,
      uiButtons: this.uiButtons,
      rightStickSpinLeft,
      rightStickSpinRight,
      anyActiveInput,
      connectedCount: this.connectedCount,
      activePadIndex: this.activePadIndex,
      activePadId: this.activePadId,
      controllerKind: this.controllerKind,
    };
  }

  private readPadIntoSets(
    pad: GamepadSnapshot,
    simOut: Set<number>,
    uiOut: Set<number>,
  ): number {
    const isStandard = pad.mapping === 'standard';
    const buttons = pad.buttons ?? [];
    const axes = pad.axes ?? [];

    // 1. Buttons
    if (isStandard) {
      for (let b = 0; b < buttons.length; b++) {
        const btn = buttons[b];
        if (!btn) continue;
        const threshold = b === GP_BTN_LT || b === GP_BTN_RT ? TRIGGER_THRESHOLD : DIGITAL_THRESHOLD;
        if (btn.pressed || btn.value > threshold) {
          simOut.add(b);
          uiOut.add(b);
        }
      }
    } else {
      // Non-standard HID (Linux xpad / Tesla Chromium / DirectInput)
      const isLinuxXpadStyle = buttons.length >= 8 && buttons.length <= 11;
      for (let b = 0; b < buttons.length; b++) {
        const btn = buttons[b];
        if (!btn) continue;
        if (!(btn.pressed || btn.value > DIGITAL_THRESHOLD)) continue;

        if (isLinuxXpadStyle) {
          // Linux xpad raw indices: 0=A, 1=B, 2=X, 3=Y, 4=LB, 5=RB, 6=Back/View, 7=Start/Menu, 8=Guide, 9=LS, 10=RS
          if (b === 6) {
            simOut.add(GP_BTN_VIEW);
            uiOut.add(GP_BTN_VIEW);
          } else if (b === 7) {
            simOut.add(GP_BTN_MENU);
            uiOut.add(GP_BTN_MENU);
          } else if (b === 8) {
            simOut.add(GP_BTN_GUIDE);
            uiOut.add(GP_BTN_GUIDE);
          } else if (b === 9) {
            simOut.add(GP_BTN_LS);
            uiOut.add(GP_BTN_LS);
          } else if (b === 10) {
            simOut.add(GP_BTN_RS);
            uiOut.add(GP_BTN_RS);
          } else {
            simOut.add(b);
            uiOut.add(b);
          }
        } else {
          simOut.add(b);
          uiOut.add(b);
        }
      }

      // Track resting axis baseline on first sighting so resting -1 triggers never false-fire
      let baseline = this.axisRestBaselines.get(pad.index);
      if (!baseline || baseline.length !== axes.length) {
        baseline = Array.from(axes, (v) => (Number.isFinite(v) ? v : 0));
        this.axisRestBaselines.set(pad.index, baseline);
      }

      // Axis-based LT/RT triggers on Linux xpad (axes[2] and axes[5] resting near -1.0)
      if (axes.length >= 6) {
        if (baseline[2] < -0.75 && axes[2] > -0.25) {
          simOut.add(GP_BTN_LT);
          uiOut.add(GP_BTN_LT);
        }
        if (baseline[5] < -0.75 && axes[5] > -0.25) {
          simOut.add(GP_BTN_RT);
          uiOut.add(GP_BTN_RT);
        }
      }

      // Hat-switch D-pad axes:
      // 1) Dual-axis hat on axes[6], axes[7] (xpad/Linux standard)
      if (axes.length >= 8) {
        const hx = axes[6] ?? 0;
        const hy = axes[7] ?? 0;
        if (hx < -0.5) {
          simOut.add(GP_DPAD_LEFT);
          uiOut.add(GP_DPAD_LEFT);
        } else if (hx > 0.5) {
          simOut.add(GP_DPAD_RIGHT);
          uiOut.add(GP_DPAD_RIGHT);
        }
        if (hy < -0.5) {
          simOut.add(GP_DPAD_UP);
          uiOut.add(GP_DPAD_UP);
        } else if (hy > 0.5) {
          simOut.add(GP_DPAD_DOWN);
          uiOut.add(GP_DPAD_DOWN);
        }
      } else if (axes.length === 6 && baseline[4] > -0.75 && baseline[5] > -0.75) {
        // 6-axis non-standard pad where axes[4]/axes[5] are a dual-axis D-pad hat
        const hx = axes[4] ?? 0;
        const hy = axes[5] ?? 0;
        if (hx < -0.5) {
          simOut.add(GP_DPAD_LEFT);
          uiOut.add(GP_DPAD_LEFT);
        } else if (hx > 0.5) {
          simOut.add(GP_DPAD_RIGHT);
          uiOut.add(GP_DPAD_RIGHT);
        }
        if (hy < -0.5) {
          simOut.add(GP_DPAD_UP);
          uiOut.add(GP_DPAD_UP);
        } else if (hy > 0.5) {
          simOut.add(GP_DPAD_DOWN);
          uiOut.add(GP_DPAD_DOWN);
        }
      }

      // 2) Single-axis 8-way DirectInput POV hat on axes[9]
      if (axes.length >= 10) {
        decodePovHatAxis(axes[9], simOut);
        decodePovHatAxis(axes[9], uiOut);
      }
    }

    // 2. Left Analog Stick (axes[0], axes[1]) with Sim cardinal-cone Hard-Drop guard
    const ax = Number.isFinite(axes[0]) ? axes[0] : 0;
    const ay = Number.isFinite(axes[1]) ? axes[1] : 0;

    // Sim stick mapping: protect lateral movement from accidental downward hard-drop!
    const inDropCone = ay > SIM_STICK_DROP_DEADZONE && Math.abs(ay) > Math.abs(ax) * SIM_STICK_DROP_CONE_RATIO;
    if (inDropCone) {
      simOut.add(GP_DPAD_DOWN);
    } else {
      if (ax < -SIM_STICK_X_DEADZONE) simOut.add(GP_DPAD_LEFT);
      else if (ax > SIM_STICK_X_DEADZONE) simOut.add(GP_DPAD_RIGHT);

      if (ay < -SIM_STICK_UP_DEADZONE && Math.abs(ay) > Math.abs(ax) * 1.15) {
        simOut.add(GP_DPAD_UP);
      }
    }

    // UI stick mapping: crisp dominant-axis navigation
    if (Math.abs(ax) >= Math.abs(ay)) {
      if (ax < -UI_STICK_DEADZONE) uiOut.add(GP_DPAD_LEFT);
      else if (ax > UI_STICK_DEADZONE) uiOut.add(GP_DPAD_RIGHT);
    } else {
      if (ay < -UI_STICK_DEADZONE) uiOut.add(GP_DPAD_UP);
      else if (ay > UI_STICK_DEADZONE) uiOut.add(GP_DPAD_DOWN);
    }

    // 3. Right Analog Stick horizontal axis for quick-spin
    let rx = 0;
    if (isStandard && axes.length >= 4) {
      rx = Number.isFinite(axes[2]) ? axes[2] : 0;
    } else if (!isStandard && axes.length >= 5) {
      const baseline = this.axisRestBaselines.get(pad.index);
      // On Linux xpad (axes[2] is LT resting at -1), Right Stick X is axes[3]
      const rIdx = baseline && baseline[2] < -0.75 ? 3 : 2;
      rx = Number.isFinite(axes[rIdx]) ? axes[rIdx] : 0;
    }

    return rx;
  }

  /**
   * Triggers tactile haptic rumble across standard W3C dual-rumble, older Chromium pulse,
   * and Safari/legacy hapticActuators APIs on the active (or first capable) gamepad.
   */
  triggerRumble(
    pads: readonly (GamepadSnapshot | null | undefined)[] | null | undefined,
    intensity: number,
    durationMs: number,
    enabled = true,
  ): boolean {
    if (!enabled || intensity <= 0 || durationMs <= 0 || !pads) {
      return false;
    }
    const clamped = Math.max(0, Math.min(1, intensity));
    const roundedMs = Math.round(durationMs);

    const tryPad = (pad: GamepadSnapshot | null | undefined): boolean => {
      if (!isUsablePad(pad)) return false;
      try {
        if (pad.vibrationActuator?.playEffect) {
          void pad.vibrationActuator.playEffect('dual-rumble', {
            duration: roundedMs,
            strongMagnitude: clamped,
            weakMagnitude: Math.round(clamped * 0.6 * 1000) / 1000,
          });
          return true;
        }
        if (pad.vibrationActuator?.pulse) {
          void pad.vibrationActuator.pulse(clamped, roundedMs);
          return true;
        }
        const firstHaptic = pad.hapticActuators?.[0];
        if (firstHaptic?.pulse) {
          void firstHaptic.pulse(clamped, roundedMs);
          return true;
        }
      } catch {
        // Ignore browser haptic errors cleanly
      }
      return false;
    };

    if (this.activePadIndex !== null) {
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.index === this.activePadIndex && tryPad(p)) {
          return true;
        }
      }
    }
    for (let i = 0; i < pads.length; i++) {
      if (tryPad(pads[i])) {
        return true;
      }
    }
    return false;
  }
}
