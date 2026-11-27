import { describe, expect, it, vi } from 'vitest';
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PORTRAIT_LOGICAL_HEIGHT,
  PORTRAIT_LOGICAL_WIDTH,
  SAVE_STORAGE_KEY,
} from '../src/contracts/index.js';
import { MemoryStorage, SaveManager, sanitizeSaveData } from '../src/app/SaveManager.js';
import { createDefaultUserSettings } from '../src/data/settingsDefaults.js';
import {
  GamepadAdapter,
  detectControllerKind,
  type GamepadSnapshot,
} from '../src/input/GamepadAdapter.js';
import {
  TouchController,
  getTouchLayoutGeometry,
} from '../src/input/TouchController.js';
import { InputManager, mapClientToLogical } from '../src/input/InputManager.js';
import { computeLetterboxRect, type ViewportTransform } from '../src/render/WebGL2Renderer.js';
import { ParticlesAndBg } from '../src/render/ParticlesAndBg.js';

function makePad(overrides: Partial<GamepadSnapshot> = {}): GamepadSnapshot {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  return {
    index: 0,
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    connected: true,
    mapping: 'standard',
    buttons,
    axes: [0, 0, 0, 0],
    ...overrides,
  };
}

function pressBtn(pad: GamepadSnapshot, index: number, value = 1): GamepadSnapshot {
  const buttons = pad.buttons.map((b, i) =>
    i === index ? { pressed: value >= 0.5, value } : { ...b },
  );
  return { ...pad, buttons };
}

describe('SaveManager Legacy Gamepad Migration & Portrait/Touch Settings', () => {
  it('auto-upgrades untouched legacy v1 gamepad defaults to include LT/RT/View while keeping version 1', () => {
    const legacySave = {
      version: 1,
      activeProfileId: 'profile_default',
      profiles: [{ id: 'profile_default', name: 'Player 1' }],
      customPalettes: [],
      settings: {
        paletteId: 'pico_dark',
        render: { targetFps: 120 },
        gameplay: { moveSpeedIndex: 3 },
        audio: { masterVolume: 0.8, muted: false },
        gamepad: {
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
        },
        packMode: 'builtin',
        photosensitivitySeen: true,
      },
      lastMode: 'marathon',
      lastTrack: 'tessellation',
    };

    const { data } = sanitizeSaveData(legacySave);
    expect(data.version).toBe(1);
    expect(data.settings.gamepad.spinLeft).toEqual([1, 2, 4, 6]);
    expect(data.settings.gamepad.spinRight).toEqual([0, 5, 7]);
    expect(data.settings.gamepad.pause).toEqual([9, 8]);
    expect(data.settings.render.portraitMode).toBe('auto');
    expect(data.settings.gameplay.touchControlsMode).toBe('auto');
    expect(data.settings.gameplay.touchOpacity).toBeCloseTo(0.55, 4);
  });

  it('preserves user-customized gamepad bindings without re-migrating on reload', () => {
    const storage = new MemoryStorage();
    const sm1 = new SaveManager(storage);
    sm1.updateSettings({
      gamepad: { spinLeft: [1, 2, 4], spinRight: [0, 5], pause: [9] },
      gamepadCustomized: true,
      render: { portraitMode: 'on' },
      gameplay: { touchControlsMode: 'on', touchOpacity: 0.8 },
    });

    const sm2 = new SaveManager(storage);
    expect(sm2.wasRecoveredFromCorruption()).toBe(false);
    expect(sm2.getSettings().gamepadCustomized).toBe(true);
    expect(sm2.getSettings().gamepad.spinLeft).toEqual([1, 2, 4]);
    expect(sm2.getSettings().gamepad.spinRight).toEqual([0, 5]);
    expect(sm2.getSettings().gamepad.pause).toEqual([9]);
    expect(sm2.getSettings().render.portraitMode).toBe('on');
    expect(sm2.getSettings().gameplay.touchControlsMode).toBe('on');
    expect(sm2.getSettings().gameplay.touchOpacity).toBeCloseTo(0.8, 4);
    expect(storage.getItem(SAVE_STORAGE_KEY)).not.toBeNull();
  });
});

describe('GamepadAdapter — Xbox, Tesla & Multi-Slot HID Normalization', () => {
  it('identifies Xbox, Tesla, PlayStation, Nintendo, and Generic controller kinds accurately', () => {
    expect(detectControllerKind('Xbox Wireless Controller (Vendor: 045e)')).toBe('xbox');
    expect(detectControllerKind('XInput Standard Gamepad')).toBe('xbox');
    expect(detectControllerKind('DualSense Wireless Controller (054c)')).toBe('playstation');
    expect(detectControllerKind('Nintendo Switch Pro Controller (057e)')).toBe('nintendo');
    expect(detectControllerKind('8BitDo SN30 Pro', 'Mozilla/5.0 Tesla/2026.2 QtCarBrowser')).toBe('tesla');
    expect(detectControllerKind('8BitDo SN30 Pro')).toBe('generic');
  });

  it('aggregates across multiple slots and ignores ghost/empty slot 0 ahead of active Xbox slot 1', () => {
    const adapter = new GamepadAdapter();
    const ghostPad: GamepadSnapshot = {
      index: 0,
      id: 'Tesla Virtual HID Device',
      connected: true,
      mapping: '',
      buttons: [],
      axes: [],
    };
    const xboxPad = pressBtn(makePad({ index: 1 }), 0, 1);

    const frame = adapter.poll([ghostPad, xboxPad]);
    expect(frame.connectedCount).toBe(1);
    expect(frame.activePadIndex).toBe(1);
    expect(frame.controllerKind).toBe('xbox');
    expect(frame.simButtons.has(0)).toBe(true);
    expect(frame.uiButtons.has(0)).toBe(true);
  });

  it('applies analog trigger thresholds and left-stick cardinal-cone guard to stop accidental hard drops', () => {
    const adapter = new GamepadAdapter();

    // Horizontal left steer with slight downward thumb drift (ax=-0.82, ay=0.48)
    const driftingSteer = makePad({ axes: [-0.82, 0.48, 0, 0] });
    const f1 = adapter.poll([driftingSteer]);
    expect(f1.simButtons.has(14)).toBe(true); // Move Left
    expect(f1.simButtons.has(13)).toBe(false); // MUST NOT hard drop!

    // Deliberate straight-down flick (ax=0.05, ay=0.85) triggers hard drop cleanly
    const hardDown = makePad({ axes: [0.05, 0.85, 0, 0] });
    const f2 = adapter.poll([hardDown]);
    expect(f2.simButtons.has(13)).toBe(true);
    expect(f2.simButtons.has(14)).toBe(false);
    expect(f2.simButtons.has(15)).toBe(false);

    // Analog triggers LT (6) and RT (7) activate past 0.35 threshold
    const triggers = pressBtn(pressBtn(makePad(), 6, 0.45), 7, 0.5);
    const f3 = adapter.poll([triggers]);
    expect(f3.simButtons.has(6)).toBe(true);
    expect(f3.simButtons.has(7)).toBe(true);
  });

  it('normalizes non-standard Linux/Tesla HID hat-switch axes, POV hats, axis triggers, and raw Start/Select', () => {
    const adapter = new GamepadAdapter();

    // 1. Linux xpad non-standard: 11 buttons (Select=6, Start=7), 8 axes (LT=2, RT=5 resting -1, Hat=6,7)
    const xpadIdle: GamepadSnapshot = {
      index: 0,
      id: 'Microsoft X-Box One pad (Linux evdev)',
      connected: true,
      mapping: '',
      buttons: Array.from({ length: 11 }, () => ({ pressed: false, value: 0 })),
      axes: [0, 0, -1, 0, 0, -1, 0, 0],
    };
    // First poll calibrates resting -1 triggers -> must NOT false-trigger LT/RT!
    const idleRes = adapter.poll([xpadIdle]);
    expect(idleRes.simButtons.has(6)).toBe(false);
    expect(idleRes.simButtons.has(7)).toBe(false);

    // Now press Hat Left (axes[6]=-1), Start (button 7 -> canonical 9), and pull RT (axes[5]=0.6 -> canonical 7)
    const xpadActive: GamepadSnapshot = {
      ...xpadIdle,
      buttons: xpadIdle.buttons.map((b, i) => (i === 7 ? { pressed: true, value: 1 } : b)),
      axes: [0, 0, -1, 0, 0, 0.6, -1, 0],
    };
    const activeRes = adapter.poll([xpadActive]);
    expect(activeRes.simButtons.has(14)).toBe(true); // D-Left from hat axis 6
    expect(activeRes.simButtons.has(9)).toBe(true); // Menu/Start from raw button 7
    expect(activeRes.simButtons.has(7)).toBe(true); // RT from axis 5
    expect(activeRes.simButtons.has(6)).toBe(false); // LT still at rest

    // 2. Single-axis DirectInput POV hat on axes[9] (left ≈ 0.7143, neutral ≈ 3.2857)
    const povNeutral: GamepadSnapshot = {
      index: 1,
      id: 'USB Generic Gamepad',
      connected: true,
      mapping: '',
      buttons: Array.from({ length: 12 }, () => ({ pressed: false, value: 0 })),
      axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3.2857],
    };
    expect(adapter.poll([povNeutral]).simButtons.size).toBe(0);

    const povRight: GamepadSnapshot = {
      ...povNeutral,
      axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.4286],
    };
    expect(adapter.poll([povRight]).simButtons.has(15)).toBe(true);
  });

  it('provides drift-safe Right Stick quick-spin with hysteresis re-arming', () => {
    const adapter = new GamepadAdapter();

    // Mild stick drift below 0.70 triggers nothing
    expect(adapter.poll([makePad({ axes: [0, 0, 0.35, 0] })]).rightStickSpinRight).toBe(false);

    // Flick right past 0.70 fires once
    expect(adapter.poll([makePad({ axes: [0, 0, 0.8, 0] })]).rightStickSpinRight).toBe(true);
    // Holding right does not re-fire
    expect(adapter.poll([makePad({ axes: [0, 0, 0.85, 0] })]).rightStickSpinRight).toBe(false);
    // Slight retreat to 0.45 still latched (must drop below 0.30)
    expect(adapter.poll([makePad({ axes: [0, 0, 0.45, 0] })]).rightStickSpinRight).toBe(false);
    // Return to neutral re-arms
    expect(adapter.poll([makePad({ axes: [0, 0, 0.1, 0] })]).rightStickSpinRight).toBe(false);
    expect(adapter.poll([makePad({ axes: [0, 0, -0.82, 0] })]).rightStickSpinLeft).toBe(true);
  });

  it('triggers dual-rumble and falls back cleanly to hapticActuators.pulse', () => {
    const playEffect = vi.fn(() => Promise.resolve());
    const pulse = vi.fn(() => Promise.resolve());
    const adapter = new GamepadAdapter();

    const xbox = makePad({
      index: 0,
      vibrationActuator: { playEffect },
    });
    adapter.poll([xbox]);
    adapter.triggerRumble([xbox], 0.6, 80, true);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 80,
      strongMagnitude: 0.6,
      weakMagnitude: 0.36,
    });

    const safariPad = makePad({
      index: 1,
      hapticActuators: [{ pulse }],
    });
    adapter.poll([safariPad]);
    adapter.triggerRumble([safariPad], 0.5, 60, true);
    expect(pulse).toHaveBeenCalledWith(0.5, 60);
  });
});

describe('TouchController — Portrait & Landscape Translucent Stick + Multi-Touch', () => {
  it('supports left translucent virtual stick steering, strict downward hard-drop cone, and simultaneous spin', () => {
    const touch = new TouchController();
    const geom = getTouchLayoutGeometry(true); // Portrait 180x320

    // Touch down in left stick zone -> anchors stick near finger
    touch.onPointerDown(1, geom.stickCenterX, geom.stickCenterY, true);
    // Drag left with slight downward drift (dx=-16, dy=6) -> moveLeft ON, hardDrop OFF!
    touch.onPointerMove(1, geom.stickCenterX - 16, geom.stickCenterY + 6, true);
    let sim = touch.consumeSimState();
    expect(sim.moveLeft).toBe(true);
    expect(sim.moveLeftPressed).toBe(true);
    expect(sim.hardDropPressed).toBe(false);

    // While STILL holding left stick (pointer 1), tap CCW (pointer 2) and CW (pointer 3) simultaneously!
    touch.onPointerDown(2, geom.spinCcw.cx, geom.spinCcw.cy, true);
    sim = touch.consumeSimState();
    expect(sim.moveLeft).toBe(true);
    expect(sim.moveLeftPressed).toBe(false);
    expect(sim.spinLeftPressed).toBe(true);

    touch.onPointerUp(2);
    touch.onPointerDown(3, geom.spinCw.cx, geom.spinCw.cy, true);
    sim = touch.consumeSimState();
    expect(sim.moveLeft).toBe(true);
    expect(sim.spinRightPressed).toBe(true);
    touch.onPointerUp(3);

    // Pull stick straight down past hard-drop cone (dx=1, dy=24) -> fires single-shot hardDrop!
    touch.onPointerMove(1, geom.stickCenterX + 1, geom.stickCenterY + 24, true);
    sim = touch.consumeSimState();
    expect(sim.hardDropPressed).toBe(true);

    // Continuing to hold stick down must NOT re-fire hardDrop on next tick!
    touch.onPointerMove(1, geom.stickCenterX + 1, geom.stickCenterY + 26, true);
    sim = touch.consumeSimState();
    expect(sim.hardDropPressed).toBe(false);

    // pointercancel clears all virtual holds cleanly
    touch.onPointerCancel(1);
    sim = touch.consumeSimState();
    expect(sim.moveLeft).toBe(false);
    expect(sim.moveRight).toBe(false);
    expect(touch.getVisualState(true).stickActive).toBe(false);
  });

  it('triggers dedicated DROP and PAUSE buttons cleanly in both portrait and landscape layouts', () => {
    const touch = new TouchController();
    for (const portrait of [true, false]) {
      const geom = getTouchLayoutGeometry(portrait);

      touch.onPointerDown(10, geom.hardDrop.x + geom.hardDrop.w * 0.5, geom.hardDrop.y + geom.hardDrop.h * 0.5, portrait);
      expect(touch.consumeSimState().hardDropPressed).toBe(true);
      touch.onPointerUp(10);

      touch.onPointerDown(11, geom.pause.x + geom.pause.w * 0.5, geom.pause.y + geom.pause.h * 0.5, portrait);
      expect(touch.consumePausePressed()).toBe(true);
      expect(touch.consumePausePressed()).toBe(false);
      touch.onPointerUp(11);
    }
  });
});

describe('InputManager — Portrait Mapping, Menu Repeat & Touch Tap/Scroll', () => {
  it('maps client coordinates accurately into portrait 180x320 logical space', () => {
    const rect = { left: 0, top: 0, width: 390, height: 844 };
    const lb = computeLetterboxRect(390, 844, false, PORTRAIT_LOGICAL_WIDTH, PORTRAIT_LOGICAL_HEIGHT);
    const transform: ViewportTransform = {
      canvasCssWidth: 390,
      canvasCssHeight: 844,
      viewX: lb.x,
      viewY: lb.y,
      viewW: lb.w,
      viewH: lb.h,
      tateRotate: false,
      boardZoom: false,
      logicalWidth: PORTRAIT_LOGICAL_WIDTH,
      logicalHeight: PORTRAIT_LOGICAL_HEIGHT,
    };

    const center = mapClientToLogical(195, 422, rect, transform);
    expect(center.inBounds).toBe(true);
    expect(center.x).toBeCloseTo(PORTRAIT_LOGICAL_WIDTH / 2, 3);
    expect(center.y).toBeCloseTo(PORTRAIT_LOGICAL_HEIGHT / 2, 3);

    // Default landscape 320x180 still works without optional fields
    const lbLand = computeLetterboxRect(1280, 720, false);
    const landCenter = mapClientToLogical(640, 360, { left: 0, top: 0, width: 1280, height: 720 }, {
      canvasCssWidth: 1280,
      canvasCssHeight: 720,
      viewX: lbLand.x,
      viewY: lbLand.y,
      viewW: lbLand.w,
      viewH: lbLand.h,
      tateRotate: false,
      boardZoom: false,
    });
    expect(landCenter.x).toBeCloseTo(LOGICAL_WIDTH / 2, 3);
    expect(landCenter.y).toBeCloseTo(LOGICAL_HEIGHT / 2, 3);
  });

  it('auto-repeats held menu directions after 280ms delay at 95ms intervals', () => {
    const input = new InputManager();
    const settings = createDefaultUserSettings();

    input.injectKey('ArrowDown', true);
    expect(input.pollUiInput(settings, 0.016).down).toBe(true); // initial press
    expect(input.pollUiInput(settings, 0.15).down).toBe(false); // still inside 280ms delay
    expect(input.pollUiInput(settings, 0.15).down).toBe(true); // crosses 280ms -> first repeat!
    expect(input.pollUiInput(settings, 0.05).down).toBe(false);
    expect(input.pollUiInput(settings, 0.06).down).toBe(true); // crosses 95ms repeat interval!

    input.injectKey('ArrowDown', false);
    expect(input.pollUiInput(settings, 0.2).down).toBe(false);
  });

  it('disambiguates touch menu tap vs vertical swipe scroll without firing accidental clicks', () => {
    const input = new InputManager();
    const settings = createDefaultUserSettings();

    // Vertical swipe (>8 logical px) produces scrollDelta and suppresses mouseClicked
    input.injectTouchMenuPointer(1, 'down', 160, 80);
    input.injectTouchMenuPointer(1, 'move', 160, 56); // dragged up 24px
    const mid = input.pollUiInput(settings, 0.016);
    expect(mid.scrollDelta).toBeGreaterThan(0);
    expect(mid.mouseClicked).toBe(false);

    input.injectTouchMenuPointer(1, 'up', 160, 56);
    const upAfterSwipe = input.pollUiInput(settings, 0.016);
    expect(upAfterSwipe.mouseClicked).toBe(false);

    // Clean short tap (<8 logical px) fires mouseClicked on release
    input.injectTouchMenuPointer(2, 'down', 160, 80);
    expect(input.pollUiInput(settings, 0.016).mouseClicked).toBe(false);
    input.injectTouchMenuPointer(2, 'up', 162, 81);
    const upAfterTap = input.pollUiInput(settings, 0.016);
    expect(upAfterTap.mouseClicked).toBe(true);
    expect(upAfterTap.isTouchPointer).toBe(true);
  });
});

describe('ParticlesAndBg — Elevated 6-Color Pixel Juice Within Fixed Pools', () => {
  it('emits spin orbital sparks, hard-drop comet streaks, slide shimmer, and shadow banners within fixed capacities', () => {
    const fx = new ParticlesAndBg();
    const spinFb = fx.consumeSimEvents([
      { type: 'TETRAD_SPIN', dir: 1, x: 3, y: 10, slackReset: false },
    ]);
    expect(spinFb.bloomPulse).toBeGreaterThan(0);
    expect(fx.getCounts().particles).toBeGreaterThanOrEqual(4);

    const dropFb = fx.consumeSimEvents([
      { type: 'TETRAD_HARD_DROP', fromY: 2, toY: 22, x: 3, colors: [1, 2, 3, 4] },
    ]);
    expect(dropFb.bloomPulse).toBeGreaterThanOrEqual(0.06);
    expect(fx.getCounts().bgGeometry).toBeGreaterThanOrEqual(1);

    const beforeSlide = fx.getCounts().particles;
    fx.consumeSimEvents([
      {
        type: 'BLOCK_SLIDE',
        moves: [{ fromX: 3, fromY: 14, toX: 3, toY: 16, color: 2 }],
      },
    ]);
    expect(fx.getCounts().particles).toBeGreaterThan(beforeSlide);
    expect(fx.getCapacities()).toEqual({ particles: 512, bgGeometry: 48, banners: 16 });
  });
});
