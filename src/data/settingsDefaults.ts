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
  type RenderSettings,
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

export function createDefaultRenderSettings(): RenderSettings {
  return {
    targetFps: 60,
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
    moveLeft: ['ArrowLeft', 'KeyA'],
    moveRight: ['ArrowRight', 'KeyD'],
    hardDrop: ['ArrowDown', 'KeyS', 'Space'],
    spinLeft: ['KeyZ', 'KeyQ', 'ShiftLeft'],
    spinRight: ['KeyX', 'KeyE', 'ArrowUp', 'KeyW'],
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    confirm: ['Enter', 'Space', 'KeyZ'],
    cancel: ['Escape', 'Backspace', 'KeyX'],
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
    spinLeft: [1, 2, 4],
    spinRight: [0, 5],
    pause: [9],
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
    packMode: 'builtin',
    photosensitivitySeen: false,
  };
}
