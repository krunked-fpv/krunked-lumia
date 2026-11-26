import { describe, expect, it, vi } from 'vitest';
import type {
  GamepadBindings,
  KeyboardBindings,
  Palette,
  PaletteColors,
  PlayerProfile,
} from '../src/contracts/index.js';
import { BUILTIN_PALETTES, decodePaletteShareCode, encodePaletteShareCode } from '../src/data/palettes.js';
import {
  createDefaultGamepadBindings,
  createDefaultKeyboardBindings,
  createDefaultUserSettings,
} from '../src/data/settingsDefaults.js';
import { createDefaultProfile } from '../src/app/SaveManager.js';
import { InputManager, type UiInputState } from '../src/input/InputManager.js';
import {
  ColorEditorScreen,
  hexToRgb255,
  hsvToRgb,
  rgb255ToHex,
  rgbToHsv,
  swapPaletteSlots,
  type ColorEditorCallbacks,
  type ColorEditorRenderer,
} from '../src/ui/ColorEditorScreen.js';
import {
  ControlsRemapScreen,
  detectBindingConflicts,
  formatGamepadButton,
  formatKeyCode,
  type ControlsRemapCallbacks,
} from '../src/ui/ControlsRemapScreen.js';
import {
  PROFILE_TOO_SIMILAR_ERROR,
  ProfilesScreen,
  isProfileNameTooSimilar,
  type ProfilesScreenCallbacks,
} from '../src/ui/ProfilesScreen.js';

function makeUiInput(overrides: Partial<UiInputState> = {}): UiInputState {
  const mx = overrides.mouseX ?? overrides.mousePos?.x ?? 0;
  const my = overrides.mouseY ?? overrides.mousePos?.y ?? 0;
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
    mousePos: { x: mx, y: my },
    mouseX: mx,
    mouseY: my,
    mouseInBounds: false,
    mouseDown: false,
    mouseClicked: false,
    mouseMoved: false,
    usingGamepad: false,
    ...overrides,
  };
}

interface RecordedRenderOps {
  sprites: Array<{ name: string; frame: number; hex?: string }>;
  rects: Array<{ x: number; y: number; w: number; h: number; hex?: string }>;
  texts: Array<{ text: string; hex?: string }>;
  diamonds: number;
  lines: number;
}

function createMockRenderer(): { renderer: ColorEditorRenderer; ops: RecordedRenderOps } {
  const ops: RecordedRenderOps = {
    sprites: [],
    rects: [],
    texts: [],
    diamonds: 0,
    lines: 0,
  };
  const renderer: ColorEditorRenderer = {
    drawSprite(name, frameIndex) {
      ops.sprites.push({ name, frame: frameIndex });
    },
    drawSpriteHex(name, frameIndex, _x, _y, hexColor) {
      ops.sprites.push({ name, frame: frameIndex, hex: hexColor });
    },
    drawRect(x, y, w, h) {
      ops.rects.push({ x, y, w, h });
    },
    drawRectHex(x, y, w, h, hexColor) {
      ops.rects.push({ x, y, w, h, hex: hexColor });
    },
    drawLine() {
      ops.lines += 1;
    },
    drawDiamondOutline() {
      ops.diamonds += 1;
    },
    drawText(text) {
      ops.texts.push({ text });
    },
    drawTextHex(text, _x, _y, hexColor) {
      ops.texts.push({ text, hex: hexColor });
    },
  };
  return { renderer, ops };
}

// ============================================================================
// 1. PURE COLOR HELPERS (RGB <-> HSV, HEX <-> RGB255, SWAP SLOTS)
// ============================================================================

describe('ColorEditor pure color helpers', () => {
  it('converts hexToRgb255 and rgb255ToHex accurately with clamping and normalization', () => {
    expect(hexToRgb255('#ff004d')).toEqual({ r: 255, g: 0, b: 77 });
    expect(hexToRgb255('29ADFF')).toEqual({ r: 41, g: 173, b: 255 });
    expect(hexToRgb255('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb255('invalid')).toEqual({ r: 0, g: 0, b: 0 });

    expect(rgb255ToHex(255, 0, 77)).toBe('#ff004d');
    expect(rgb255ToHex(41, 173, 255)).toBe('#29adff');
    expect(rgb255ToHex(-10, 300, 127.6)).toBe('#00ff80');
  });

  it('round-trips RGB <-> HSV cleanly across primaries, grays, all 63 built-in palettes, and sampled RGB cube', () => {
    // Pure corners & neutrals
    const anchors: Array<[number, number, number]> = [
      [0, 0, 0],
      [255, 255, 255],
      [128, 128, 128],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [0, 255, 255],
      [255, 0, 255],
    ];
    for (const [r, g, b] of anchors) {
      const hsv = rgbToHsv(r, g, b);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(back).toEqual({ r, g, b });
    }

    // Verify primary hue angles explicitly
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 100, v: 100 });
    expect(rgbToHsv(0, 255, 0)).toEqual({ h: 120, s: 100, v: 100 });
    expect(rgbToHsv(0, 0, 255)).toEqual({ h: 240, s: 100, v: 100 });
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });

    // Every single color across all 63 built-in palettes (378 exact colors)
    for (const palette of BUILTIN_PALETTES) {
      for (const hex of palette.colors) {
        const rgb = hexToRgb255(hex);
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
        expect(rgb255ToHex(back.r, back.g, back.b)).toBe(hex);
      }
    }

    // Dense 3D RGB cube sample (step 17 => 16^3 = 4096 colors)
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const hsv = rgbToHsv(r, g, b);
          const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
          expect(back).toEqual({ r, g, b });
        }
      }
    }
  });

  it('swaps palette slots immutably and handles edge indices cleanly', () => {
    const original: PaletteColors = [
      '#000000',
      '#1d2b53',
      '#fff7f2',
      '#ffec27',
      '#29adff',
      '#ff004d',
    ];
    const snapshot = [...original];

    const swapped = swapPaletteSlots(original, 2, 5);
    expect(swapped).not.toBe(original);
    expect(original).toEqual(snapshot); // strict immutability
    expect(swapped).toEqual([
      '#000000',
      '#1d2b53',
      '#ff004d',
      '#ffec27',
      '#29adff',
      '#fff7f2',
    ]);

    // Same index or out-of-bounds returns fresh copy unchanged
    const sameIdx = swapPaletteSlots(original, 3, 3);
    expect(sameIdx).not.toBe(original);
    expect(sameIdx).toEqual(original);

    const outOfBounds = swapPaletteSlots(original, -1, 9);
    expect(outOfBounds).toEqual(original);
  });
});

// ============================================================================
// 2. COLOR EDITOR SCREEN FLOWS (TEMPLATE, DIRTY, SWAP, COPY, SAVE, SHARE, IMPORT)
// ============================================================================

describe('ColorEditorScreen workflows and rendering', () => {
  function setupColorEditor() {
    let customSeq = 1;
    const savedPalettes: Palette[] = [];
    const deletedIds: string[] = [];
    const appliedIds: string[] = [];
    const copiedTexts: string[] = [];
    let closedCount = 0;
    let nextImportCode: string | null = null;

    const callbacks: ColorEditorCallbacks = {
      onSavePalette: (input) => {
        if (input.id) {
          const existing = savedPalettes.find((p) => p.id === input.id);
          if (existing) {
            existing.name = input.name;
            existing.colors = [...input.colors] as PaletteColors;
            return { ...existing, colors: [...existing.colors] as PaletteColors };
          }
        }
        const created: Palette = {
          id: `custom_${customSeq++}`,
          name: input.name,
          colors: [...input.colors] as PaletteColors,
          isCustom: true,
        };
        savedPalettes.push(created);
        return { ...created, colors: [...created.colors] as PaletteColors };
      },
      onDeletePalette: (id) => {
        deletedIds.push(id);
        const idx = savedPalettes.findIndex((p) => p.id === id);
        if (idx >= 0) savedPalettes.splice(idx, 1);
        return true;
      },
      onApplyPalette: (id) => {
        appliedIds.push(id);
      },
      onClose: () => {
        closedCount += 1;
      },
      onCopyToClipboard: (text) => {
        copiedTexts.push(text);
        return true;
      },
      onRequestImportCode: () => nextImportCode,
    };

    const screen = new ColorEditorScreen();
    screen.onEnter(BUILTIN_PALETTES, 'pico_dark');
    return {
      screen,
      callbacks,
      savedPalettes,
      deletedIds,
      appliedIds,
      copiedTexts,
      getClosedCount: () => closedCount,
      setImportCode: (code: string | null) => {
        nextImportCode = code;
      },
    };
  }

  it('tracks dirty state across template fork, color edits, save, save copy, and unsaved close confirmation', () => {
    const { screen, callbacks, savedPalettes, appliedIds, getClosedCount } = setupColorEditor();
    expect(screen.getView()).toBe('LIST');

    // Fork starter template Pico Light -> starts EDIT view with dirty=true and name "My Palette"
    screen.startNewFromTemplate('pico_light');
    expect(screen.getView()).toBe('EDIT');
    expect(screen.isDirty()).toBe(true);
    expect(screen.getWorkingPalette().name).toBe('My Palette');
    expect(screen.getWorkingPalette().colors).toEqual(BUILTIN_PALETTES[1].colors);

    // Edit slot 3 via RGB & slot 4 via HSV
    screen.setSlotRgb(3, 16, 200, 120);
    expect(screen.getWorkingPalette().colors[3]).toBe('#10c878');
    screen.setSlotHsv(4, 210, 80, 90);
    expect(screen.isDirty()).toBe(true);

    // Save custom palette -> clears dirty flag & assigns custom id
    const saved = screen.triggerSave(callbacks, false);
    expect(saved).not.toBeNull();
    expect(saved?.id).toBe('custom_1');
    expect(saved?.name).toBe('My Palette');
    expect(screen.isDirty()).toBe(false);
    expect(savedPalettes.length).toBe(1);

    // Modify slot -> becomes dirty; revert back to saved value -> dirty clears!
    const prevHex = screen.getWorkingPalette().colors[2];
    screen.setSlotHex(2, '#123456');
    expect(screen.isDirty()).toBe(true);
    screen.setSlotHex(2, prevHex);
    expect(screen.isDirty()).toBe(false);

    // Save Copy -> creates a second custom palette cleanly
    const copied = screen.triggerSave(callbacks, true);
    expect(copied?.id).toBe('custom_2');
    expect(copied?.name).toBe('My Palette Copy');
    expect(savedPalettes.length).toBe(2);

    // Apply calls onApplyPalette with current custom id
    expect(screen.triggerApply(callbacks)).toBe(true);
    expect(appliedIds).toEqual(['custom_2']);

    // Edit again and request CLOSE -> opens UNSAVED_CONFIRM modal instead of closing immediately
    screen.setSlotHex(5, '#abcdef');
    expect(screen.isDirty()).toBe(true);
    screen.requestClose('CLOSE', callbacks);
    expect(screen.getActiveModal()).toBe('UNSAVED_CONFIRM');
    expect(getClosedCount()).toBe(0);

    // Choose DISCARD (button index 1) via right + confirm -> closes cleanly
    screen.update(0.016, makeUiInput({ right: true }), callbacks);
    screen.update(0.016, makeUiInput({ confirm: true }), callbacks);
    expect(screen.getActiveModal()).toBe('NONE');
    expect(getClosedCount()).toBe(1);
  });

  it('supports Swatch Swap mode, Copy/Paste swatch, inline name edit, Delete modal, Share & Import flows', () => {
    const { screen, callbacks, copiedTexts, deletedIds, setImportCode } = setupColorEditor();

    // Open Pico Dark for edit
    expect(screen.openPaletteForEdit('pico_dark')).toBe(true);
    expect(screen.isDirty()).toBe(false);

    // Swatch Swap mode: select slot 2 -> beginSwapMode -> select slot 5
    screen.selectSlot(2);
    const c2Before = screen.getWorkingPalette().colors[2];
    const c5Before = screen.getWorkingPalette().colors[5];
    screen.beginSwapMode();
    expect(screen.isSwapMode()).toBe(true);
    screen.selectSlot(5);
    expect(screen.isSwapMode()).toBe(false);
    expect(screen.getWorkingPalette().colors[2]).toBe(c5Before);
    expect(screen.getWorkingPalette().colors[5]).toBe(c2Before);
    expect(screen.isDirty()).toBe(true);

    // Copy & Paste swatch
    screen.selectSlot(3);
    const copiedHex = screen.copySelectedSwatch();
    expect(copiedHex).toBe('#ffec27');
    expect(screen.getCopiedHex()).toBe('#ffec27');
    screen.selectSlot(1);
    expect(screen.pasteToSelectedSwatch()).toBe(true);
    expect(screen.getWorkingPalette().colors[1]).toBe('#ffec27');

    // Share code encodes cleanly and copies to clipboard + toast
    const shareCode = screen.triggerShare(callbacks);
    expect(copiedTexts).toEqual([shareCode]);
    expect(screen.getLastShareCode()).toBe(shareCode);
    expect(decodePaletteShareCode(shareCode)).toEqual(screen.getWorkingPalette().colors);
    expect(screen.getToastText()).toContain('SHARE:');

    // Import valid share code updates working palette colors & name
    const capreseCode = encodePaletteShareCode(BUILTIN_PALETTES[2], true);
    expect(screen.importShareCode(capreseCode, callbacks)).toBe(true);
    expect(screen.getWorkingPalette().colors).toEqual(BUILTIN_PALETTES[2].colors);
    expect(screen.getWorkingPalette().name).toBe('Caprese');
    expect(screen.getToastText()).toBe('PALETTE IMPORTED');

    // Invalid share code rejected without mutating palette
    const beforeInvalid = [...screen.getWorkingPalette().colors];
    expect(screen.importShareCode('not-a-valid-hex-code', callbacks)).toBe(false);
    expect(screen.getWorkingPalette().colors).toEqual(beforeInvalid);
    expect(screen.getToastText()).toBe('INVALID SHARE CODE');

    // Save custom palette, then click DELETE button -> opens DELETE_CONFIRM modal -> confirm deletes
    const savedCustom = screen.triggerSave(callbacks, true);
    expect(savedCustom).not.toBeNull();
    // Click DELETE button (rect x=94, y=144, w=40, h=13)
    screen.update(
      0.016,
      makeUiInput({ mouseX: 110, mouseY: 150, mouseInBounds: true, mouseClicked: true }),
      callbacks,
    );
    expect(screen.getActiveModal()).toBe('DELETE_CONFIRM');
    // Confirm delete (click DELETE button at x=84..152, y=102..116)
    screen.update(
      0.016,
      makeUiInput({ mouseX: 110, mouseY: 108, mouseInBounds: true, mouseClicked: true }),
      callbacks,
    );
    expect(deletedIds).toEqual([savedCustom!.id]);
    expect(screen.getView()).toBe('LIST');

    // Import directly from LIST view via onRequestImportCode opens EDIT view with imported theme
    setImportCode(encodePaletteShareCode(BUILTIN_PALETTES[4], true));
    screen.update(
      0.016,
      makeUiInput({ mouseX: 160, mouseY: 25, mouseInBounds: true, mouseClicked: true }),
      callbacks,
    );
    expect(screen.getView()).toBe('EDIT');
    expect(screen.getWorkingPalette().colors).toEqual(BUILTIN_PALETTES[4].colors);
    expect(screen.getWorkingPalette().name).toBe('Ultraviolet');
  });

  it('renders LIST, TEMPLATE, and EDIT views with Safe 68x128 Mini-Board Preview and LIGHT DARKEN badge without DOM', () => {
    const { screen } = setupColorEditor();
    const darkBg = BUILTIN_PALETTES[0];

    // Render LIST view
    const mockList = createMockRenderer();
    screen.render(mockList.renderer, darkBg);
    expect(mockList.ops.sprites.some((s) => s.name === 'container_fill_spr')).toBe(true);
    expect(mockList.ops.sprites.some((s) => s.name === 'container_spr')).toBe(true);

    // Open light palette (Pico Light) in EDIT view while outer screen stays Pico Dark!
    screen.openPaletteForEdit('pico_light');
    const mockEdit = createMockRenderer();
    screen.render(mockEdit.renderer, darkBg);

    // Verify contained mini-board renders all 4 distinct block shapes (frames 0..3) + ripple (frame 5)
    const blockFrames = new Set(
      mockEdit.ops.sprites.filter((s) => s.name === 'block_spr').map((s) => s.frame),
    );
    expect(blockFrames.has(0)).toBe(true);
    expect(blockFrames.has(1)).toBe(true);
    expect(blockFrames.has(2)).toBe(true);
    expect(blockFrames.has(3)).toBe(true);
    expect(blockFrames.has(5)).toBe(true);

    // Verify LIGHT DARKEN luminance badge and all 6 slot labels rendered
    const allText = mockEdit.ops.texts.map((t) => t.text);
    expect(allText).toContain('LIGHT DARKEN');
    expect(allText).toContain('0:BG');
    expect(allText).toContain('1:BRD');
    expect(allText).toContain('2:EMP');
    expect(allText).toContain('3:FIL');
    expect(allText).toContain('4:HOL');
    expect(allText).toContain('5:TGT');
  });
});

// ============================================================================
// 3. CONTROLS REMAP SCREEN & CONFLICT DETECTION
// ============================================================================

describe('ControlsRemapScreen & detectBindingConflicts', () => {
  it('permits shared menu + gameplay bindings on defaults and catches duplicate gameplay bindings', () => {
    const defaultKb = createDefaultKeyboardBindings();
    const defaultGp = createDefaultGamepadBindings();

    // Defaults share ArrowLeft (moveLeft/left), Space (hardDrop/confirm), Escape (pause/cancel), GP B0, GP B14...
    // All MUST pass with ZERO conflicts!
    const kbRes = detectBindingConflicts(defaultKb);
    expect(kbRes.hasGameplayConflicts).toBe(false);
    expect(kbRes.hasMenuConflicts).toBe(false);
    expect(kbRes.hasConflicts).toBe(false);
    expect(kbRes.conflicts).toEqual([]);

    const gpRes = detectBindingConflicts(defaultGp);
    expect(gpRes.hasGameplayConflicts).toBe(false);
    expect(gpRes.hasMenuConflicts).toBe(false);
    expect(gpRes.hasConflicts).toBe(false);

    // Duplicate gameplay binding on keyboard -> caught!
    const badKb: KeyboardBindings = {
      ...defaultKb,
      moveLeft: ['KeyZ'], // collides with spinLeft!
    };
    const badKbRes = detectBindingConflicts(badKb);
    expect(badKbRes.hasGameplayConflicts).toBe(true);
    expect(badKbRes.gameplayConflictingVerbs.has('moveLeft')).toBe(true);
    expect(badKbRes.gameplayConflictingVerbs.has('spinLeft')).toBe(true);
    expect(badKbRes.gameplayConflictingVerbs.has('confirm')).toBe(false); // menu verb NOT flagged!
    expect(badKbRes.conflicts).toEqual([
      { group: 'gameplay', input: 'KeyZ', verbs: ['moveLeft', 'spinLeft'] },
    ]);

    // Duplicate gameplay binding on gamepad -> caught!
    const badGp: GamepadBindings = {
      ...defaultGp,
      hardDrop: [0], // collides with spinRight!
    };
    const badGpRes = detectBindingConflicts(badGp);
    expect(badGpRes.hasGameplayConflicts).toBe(true);
    expect(badGpRes.gameplayConflictingVerbs.has('hardDrop')).toBe(true);
    expect(badGpRes.gameplayConflictingVerbs.has('spinRight')).toBe(true);

    // Menu-only conflict reported separately without flagging gameplay conflicts
    const badMenu: KeyboardBindings = {
      ...defaultKb,
      up: ['ArrowDown'], // collides with menu down
    };
    const badMenuRes = detectBindingConflicts(badMenu);
    expect(badMenuRes.hasGameplayConflicts).toBe(false);
    expect(badMenuRes.hasMenuConflicts).toBe(true);
    expect(badMenuRes.menuConflictingVerbs.has('up')).toBe(true);
    expect(badMenuRes.menuConflictingVerbs.has('down')).toBe(true);
  });

  it('formats human-readable keyboard and gamepad labels cleanly', () => {
    expect(formatKeyCode('ArrowLeft')).toBe('LEFT');
    expect(formatKeyCode('KeyZ')).toBe('Z');
    expect(formatKeyCode('Space')).toBe('SPACE');
    expect(formatKeyCode('Escape')).toBe('ESC');
    expect(formatGamepadButton(0)).toBe('GP B0');
    expect(formatGamepadButton(14)).toBe('GP B14');
  });

  it('captures remapped keys via InputManager, blocks Apply on conflict, resets defaults, and persists on Apply', () => {
    const settings = createDefaultUserSettings();
    const screen = new ControlsRemapScreen();
    const inputManager = new InputManager();
    const applied: Array<{ keyboard: KeyboardBindings; gamepad: GamepadBindings }> = [];
    const onClose = vi.fn();

    const callbacks: ControlsRemapCallbacks = {
      onApply: (bindings) => applied.push(bindings),
      onClose,
    };

    screen.onEnter(settings);
    expect(screen.getActiveTab()).toBe('KEYBOARD');

    // Select first verb (moveLeft) via confirm -> arms InputManager capture!
    screen.update(0.016, makeUiInput({ confirm: true }), inputManager, callbacks);
    expect(screen.getCapturingVerb()).toBe('moveLeft');
    expect(inputManager.isCapturing()).toBe(true);

    // Verify rendering shows (PRESS BUTTON TO REMAP)
    const capRender = createMockRenderer();
    screen.render(capRender.renderer, BUILTIN_PALETTES[0]);
    expect(capRender.ops.texts.some((t) => t.text === '(PRESS BUTTON TO REMAP)')).toBe(true);

    // Inject conflicting key KeyZ (already bound to spinLeft) -> creates gameplay conflict!
    inputManager.injectKey('KeyZ', true);
    expect(screen.getCapturingVerb()).toBeNull();
    expect(screen.getWorkingKeyboard().moveLeft).toEqual(['KeyZ']);
    expect(screen.hasBlockingConflicts()).toBe(true);

    // Verify conflict notice renders in Slot 5 crimson
    const conflictRender = createMockRenderer();
    screen.render(conflictRender.renderer, BUILTIN_PALETTES[0]);
    expect(
      conflictRender.ops.texts.some(
        (t) => t.text.includes('*RESOLVE CONFLICTS') && t.hex === BUILTIN_PALETTES[0].colors[5],
      ),
    ).toBe(true);

    // APPLY must be blocked while gameplay conflict exists
    expect(screen.applyBindings(callbacks)).toBe(false);
    expect(applied.length).toBe(0);

    // Remap moveLeft to clean non-conflicting key KeyJ
    screen.beginCaptureForVerb('moveLeft', inputManager, callbacks);
    inputManager.injectKey('KeyJ', true);
    expect(screen.hasBlockingConflicts()).toBe(false);

    // APPLY now succeeds and displays CONTROLS UPDATED toast
    expect(screen.applyBindings(callbacks)).toBe(true);
    expect(applied.length).toBe(1);
    expect(applied[0].keyboard.moveLeft).toEqual(['KeyJ']);
    expect(screen.getToastText()).toBe('CONTROLS UPDATED');

    // RESET restores defaults cleanly
    screen.resetActiveTabDefaults(callbacks);
    expect(screen.getWorkingKeyboard()).toEqual(createDefaultKeyboardBindings());

    // Switch to CONTROLLER tab and verify rendering
    screen.setActiveTab('CONTROLLER', inputManager);
    expect(screen.getActiveTab()).toBe('CONTROLLER');
    const gpRender = createMockRenderer();
    screen.render(gpRender.renderer, BUILTIN_PALETTES[0]);
    expect(gpRender.ops.texts.some((t) => t.text.includes('GP B14'))).toBe(true);
  });
});

// ============================================================================
// 4. PROFILES SCREEN & NAME SIMILARITY VALIDATION
// ============================================================================

describe('ProfilesScreen & isProfileNameTooSimilar', () => {
  it('detects duplicate / too-similar names across case, spacing, and punctuation while permitting distinct names & self-rename', () => {
    const names = ['Player 1', 'Elena', 'Neo-Flux'];

    // Too similar (duplicates / whitespace / punctuation / casing variants)
    expect(isProfileNameTooSimilar('Player 1', names)).toBe(true);
    expect(isProfileNameTooSimilar('player 1', names)).toBe(true);
    expect(isProfileNameTooSimilar('player1', names)).toBe(true);
    expect(isProfileNameTooSimilar('PLAYER_1', names)).toBe(true);
    expect(isProfileNameTooSimilar('  Player-1! ', names)).toBe(true);
    expect(isProfileNameTooSimilar('ELENA', names)).toBe(true);
    expect(isProfileNameTooSimilar('neo flux', names)).toBe(true);

    // Distinct names MUST be allowed
    expect(isProfileNameTooSimilar('Player 2', names)).toBe(false);
    expect(isProfileNameTooSimilar('Sora', names)).toBe(false);
    expect(isProfileNameTooSimilar('   ', names)).toBe(false);

    // Object list with excludeId allows renaming self while still catching collision with others
    const entries = [
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Sora' },
    ];
    expect(isProfileNameTooSimilar('PLAYER 1', entries, 'p1')).toBe(false);
    expect(isProfileNameTooSimilar('player_1', entries, 'p1')).toBe(false);
    expect(isProfileNameTooSimilar('SORA', entries, 'p1')).toBe(true);
  });

  it('supports profile selection, NEW PLAYER creation with validation, EDIT NAME, and safe DELETE PROFILE flow', () => {
    const p1 = createDefaultProfile('Player 1', 'profile_1');
    p1.stats.gamesPlayed = 14;
    p1.stats.blocksCleared = 1280;
    p1.highScores.marathon = 4_250_000;
    p1.impossibleUnlocked = true;

    const store: PlayerProfile[] = [p1];
    let activeId = p1.id;
    let nextId = 2;

    const callbacks: ProfilesScreenCallbacks = {
      onSelectProfile: (id) => {
        activeId = id;
      },
      onCreateProfile: (name) => {
        const created = createDefaultProfile(name, `profile_${nextId++}`);
        store.push(created);
        activeId = created.id;
        return created;
      },
      onRenameProfile: (id, newName) => {
        const target = store.find((p) => p.id === id);
        if (!target) return null;
        target.name = newName;
        return target;
      },
      onDeleteProfile: (id) => {
        if (store.length <= 1) return false;
        const idx = store.findIndex((p) => p.id === id);
        if (idx === -1) return false;
        store.splice(idx, 1);
        if (activeId === id) activeId = store[0].id;
        return true;
      },
      onClose: vi.fn(),
    };

    const screen = new ProfilesScreen();
    screen.onEnter(store, activeId);

    // Cannot delete when only 1 profile exists
    expect(screen.canDeleteSelectedProfile()).toBe(false);
    expect(screen.openDeleteConfirmModal('profile_1', callbacks)).toBe(false);
    expect(screen.getActiveModal()).toBe('NONE');

    // Open NEW PLAYER modal and attempt too-similar name ("player_1") -> blocked with exact error!
    screen.openNewPlayerModal(callbacks);
    expect(screen.getActiveModal()).toBe('CREATE_NAME');
    screen.setNameBuffer('player_1');
    expect(screen.submitNameModal(callbacks)).toBe(false);
    expect(screen.getNameError()).toBe(PROFILE_TOO_SIMILAR_ERROR);
    expect(store.length).toBe(1);

    // Type valid new name ("Elena") -> creates profile and activates it
    screen.setNameBuffer('Elena');
    expect(screen.submitNameModal(callbacks)).toBe(true);
    expect(screen.getActiveModal()).toBe('NONE');
    expect(store.length).toBe(2);
    expect(activeId).toBe('profile_2');
    expect(screen.getProfiles().length).toBe(2);

    // EDIT NAME on Elena: colliding with Player 1 fails; changing to "ELENA K" succeeds
    expect(screen.openEditNameModal('profile_2', callbacks)).toBe(true);
    screen.setNameBuffer('PLAYER 1');
    expect(screen.submitNameModal(callbacks)).toBe(false);
    expect(screen.getNameError()).toBe(PROFILE_TOO_SIMILAR_ERROR);

    screen.setNameBuffer('ELENA K');
    expect(screen.submitNameModal(callbacks)).toBe(true);
    expect(store[1].name).toBe('ELENA K');

    // DELETE PROFILE now enabled with 2 profiles -> requires confirmation modal
    expect(screen.canDeleteSelectedProfile()).toBe(true);
    expect(screen.openDeleteConfirmModal('profile_2', callbacks)).toBe(true);
    expect(screen.getActiveModal()).toBe('DELETE_CONFIRM');
    expect(screen.confirmDeleteModal(callbacks)).toBe(true);
    expect(store.length).toBe(1);
    expect(screen.getProfiles().length).toBe(1);
    expect(screen.getActiveProfileId()).toBe('profile_1');

    // Render verifies telemetry (games played, blocks cleared, Marathon best, Impossible unlocked badge)
    const mock = createMockRenderer();
    screen.render(mock.renderer, BUILTIN_PALETTES[0]);
    const texts = mock.ops.texts.map((t) => t.text);
    expect(texts).toContain('PLAYER PROFILES');
    expect(texts).toContain('IMPOSSIBLE UNLOCKED');
    expect(texts).toContain('14');
    expect(texts).toContain('1,280');
    expect(texts).toContain('4,250,000');
  });
});
