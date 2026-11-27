/**
 * Krunked Lumia — Default User Settings & Control Bindings
 */

import {
  DEFAULT_GP_MOVE_DELAY,
  DEFAULT_KB_MOVE_DELAY,
  DEFAULT_MOVE_SPEED_INDEX,
  type ActionVerb,
  type AudioSettings,
  type GamepadBindings,
  type GameplaySettings,
  type KeyboardBindings,
  type NextBlockLocation,
  type PortraitMode,
  type RenderSettings,
  type TouchControlsMode,
  type UserSettings,
} from '../contracts/index.js';

export const ACTION_VERBS: readonly ActionVerb[] = [
  'up',
  'down',
  'left',
  'right',
  'confirm',
  'cancel',
  'moveLeft',
  'moveRight',
  'hardDrop',
  'spinLeft',
  'spinRight',
  'pause',
] as const;

export const NEXT_BLOCK_LOCATIONS: readonly NextBlockLocation[] = [
  'upper_left',
  'upper_right',
  'lower_left',
  'lower_right',
] as const;

export const PORTRAIT_MODES: readonly PortraitMode[] = ['auto', 'on', 'off'] as const;
export const TOUCH_CONTROLS_MODES: readonly TouchControlsMode[] = ['auto', 'on', 'off'] as const;
export const DEFAULT_TOUCH_OPACITY = 0.55;

export function createDefaultRenderSettings(): RenderSettings {
  return {
    targetFps: 120,
    native60Snap: false,
    bloomAmount: 1.0,
    boardShake: true,
    boardRipple: true,
    particles: true,
    flashing: true,
    bgShapes: true,
    boardColors: true,
    boardZoom: false,
    tateRotate: false,
    portraitMode: 'auto',
  };
}

export function createDefaultGameplaySettings(): GameplaySettings {
  return {
    dropPreviewOpacity: 0.5,
    nextBlockLocation: 'upper_left',
    preciseTimer: false,
    moveSpeedIndex: DEFAULT_MOVE_SPEED_INDEX,
    kbMoveDelay: DEFAULT_KB_MOVE_DELAY,
    gpMoveDelay: DEFAULT_GP_MOVE_DELAY,
    gamepadRumble: true,
    tutorialEnabled: true,
    soundtestEnabled: false,
    touchControlsMode: 'auto',
    touchOpacity: DEFAULT_TOUCH_OPACITY,
  };
}

export function createDefaultAudioSettings(): AudioSettings {
  return {
    masterVolume: 0.8,
    muted: false,
  };
}

export function createDefaultKeyboardBindings(): KeyboardBindings {
  return {
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
}

export function createDefaultGamepadBindings(): GamepadBindings {
  return {
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
}

export function createDefaultUserSettings(): UserSettings {
  return {
    paletteId: 'pico_dark',
    render: createDefaultRenderSettings(),
    gameplay: createDefaultGameplaySettings(),
    audio: createDefaultAudioSettings(),
    keyboard: createDefaultKeyboardBindings(),
    gamepad: createDefaultGamepadBindings(),
    gamepadCustomized: false,
    packMode: 'builtin',
    photosensitivitySeen: false,
  };
}
