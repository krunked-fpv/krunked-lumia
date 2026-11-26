import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  isLightPaletteBg,
  parseHexRgb01,
  type Palette,
  type PaletteColors,
} from '../contracts/index.js';
import {
  BUILTIN_PALETTES,
  decodePaletteShareEntry,
  encodePaletteShareCode,
  normalizeHexColor,
} from '../data/palettes.js';
import { cellToContainerPixel } from '../sim/grid.js';
import type { UiInputState } from '../input/InputManager.js';
import type { WebGL2Renderer } from '../render/WebGL2Renderer.js';

export type ColorEditorRenderer = Pick<
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

export interface Rgb255 {
  r: number;
  g: number;
  b: number;
}

export interface HsvColor {
  /** Hue in degrees [0, 360). */
  h: number;
  /** Saturation in percent [0, 100]. */
  s: number;
  /** Value / brightness in percent [0, 100]. */
  v: number;
}

export type ColorEditorView = 'LIST' | 'TEMPLATE' | 'EDIT';
export type ColorSliderMode = 'HSV' | 'RGB';
export type ColorEditorModal = 'NONE' | 'NAME' | 'DELETE_CONFIRM' | 'UNSAVED_CONFIRM';

export interface ColorEditorCallbacks {
  onSavePalette: (input: { id?: string; name: string; colors: PaletteColors }) => Palette | null;
  onDeletePalette: (paletteId: string) => boolean;
  onApplyPalette: (paletteId: string) => void;
  onClose: () => void;
  onPlayMenuMove?: () => void;
  onPlayMenuSelect?: () => void;
  onPlayMenuBack?: () => void;
  onPlayMenuFail?: () => void;
  onCopyToClipboard?: (text: string) => boolean | Promise<boolean>;
  onRequestImportCode?: () => string | null;
}

// ============================================================================
// PURE COLOR MATH & PALETTE SLOT HELPERS
// ============================================================================

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Parse `#rrggbb` or `rrggbb` into 0..255 integer RGB channels. */
export function hexToRgb255(hex: string): Rgb255 {
  const norm = normalizeHexColor(hex) ?? '#000000';
  const num = Number.parseInt(norm.slice(1), 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/** Encode 0..255 RGB channels into strict lowercase `#rrggbb`. */
export function rgb255ToHex(r: number, g: number, b: number): string {
  const cr = Math.round(clamp(r, 0, 255));
  const cg = Math.round(clamp(g, 0, 255));
  const cb = Math.round(clamp(b, 0, 255));
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(cr)}${toHex(cg)}${toHex(cb)}`;
}

/** Convert 0..255 RGB channels to HSV (`h` in [0, 360), `s` in [0, 100], `v` in [0, 100]). */
export function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d > 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / d) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / d + 2);
    } else {
      h = 60 * ((rn - gn) / d + 4);
    }
    if (h < 0) h += 360;
    if (h >= 360) h -= 360;
  }

  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, v };
}

/** Convert HSV (`h` in degrees, `s` in [0, 100], `v` in [0, 100]) to 0..255 integer RGB. */
export function hsvToRgb(h: number, s: number, v: number): Rgb255 {
  const hh = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
  const ss = clamp(s, 0, 100) / 100;
  const vv = clamp(v, 0, 100) / 100;

  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hh < 60) {
    r1 = c;
    g1 = x;
  } else if (hh < 120) {
    r1 = x;
    g1 = c;
  } else if (hh < 180) {
    g1 = c;
    b1 = x;
  } else if (hh < 240) {
    g1 = x;
    b1 = c;
  } else if (hh < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: Math.round(clamp((r1 + m) * 255, 0, 255)),
    g: Math.round(clamp((g1 + m) * 255, 0, 255)),
    b: Math.round(clamp((b1 + m) * 255, 0, 255)),
  };
}

/**
 * Pure immutable swap of two palette color slots (0..5).
 * Always returns a fresh 6-element PaletteColors tuple without mutating the source array.
 */
export function swapPaletteSlots(
  colors: readonly string[],
  indexA: number,
  indexB: number,
): PaletteColors {
  const copy: [string, string, string, string, string, string] = [
    colors[0] ?? '#000000',
    colors[1] ?? '#1d2b53',
    colors[2] ?? '#fff7f2',
    colors[3] ?? '#ffec27',
    colors[4] ?? '#29adff',
    colors[5] ?? '#ff004d',
  ];
  if (
    Number.isInteger(indexA) &&
    Number.isInteger(indexB) &&
    indexA >= 0 &&
    indexA < 6 &&
    indexB >= 0 &&
    indexB < 6 &&
    indexA !== indexB
  ) {
    const tmp = copy[indexA];
    copy[indexA] = copy[indexB];
    copy[indexB] = tmp;
  }
  return copy;
}

// ============================================================================
// LAYOUT & PIXEL-NATIVE HELPERS
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
  renderer: ColorEditorRenderer,
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

function clonePalette(p: Palette): Palette {
  return {
    id: p.id,
    name: p.name,
    ...(p.author ? { author: p.author } : {}),
    colors: [...p.colors] as PaletteColors,
    isCustom: Boolean(p.isCustom),
  };
}

function samePaletteColors(a: readonly string[], b: readonly string[]): boolean {
  for (let i = 0; i < 6; i++) {
    if ((a[i] ?? '').toLowerCase() !== (b[i] ?? '').toLowerCase()) return false;
  }
  return true;
}

const SLOT_SHORT_LABELS = ['0:BG', '1:BRD', '2:EMP', '3:FIL', '4:HOL', '5:TGT'] as const;

const FEATURED_TEMPLATE_IDS = [
  'pico_dark',
  'pico_light',
  'caprese',
  'calm',
  'ultraviolet',
] as const;

type ActionId =
  | 'SWAP'
  | 'COPY'
  | 'PASTE'
  | 'SHARE'
  | 'IMPORT'
  | 'SAVE'
  | 'SAVE_COPY'
  | 'DELETE'
  | 'APPLY'
  | 'CLOSE';

interface ActionButtonDef {
  id: ActionId;
  label: string;
  rect: HitRect;
}

const ACTION_ROW_1: readonly ActionButtonDef[] = [
  { id: 'SWAP', label: 'SWAP', rect: { x: 6, y: 128, w: 38, h: 13 } },
  { id: 'COPY', label: 'COPY', rect: { x: 47, y: 128, w: 38, h: 13 } },
  { id: 'PASTE', label: 'PASTE', rect: { x: 88, y: 128, w: 40, h: 13 } },
  { id: 'SHARE', label: 'SHARE', rect: { x: 131, y: 128, w: 42, h: 13 } },
  { id: 'IMPORT', label: 'IMPORT', rect: { x: 176, y: 128, w: 42, h: 13 } },
];

const ACTION_ROW_2: readonly ActionButtonDef[] = [
  { id: 'SAVE', label: 'SAVE', rect: { x: 6, y: 144, w: 36, h: 13 } },
  { id: 'SAVE_COPY', label: 'SAVE COPY', rect: { x: 45, y: 144, w: 46, h: 13 } },
  { id: 'DELETE', label: 'DELETE', rect: { x: 94, y: 144, w: 40, h: 13 } },
  { id: 'APPLY', label: 'APPLY', rect: { x: 137, y: 144, w: 38, h: 13 } },
  { id: 'CLOSE', label: 'CLOSE', rect: { x: 178, y: 144, w: 40, h: 13 } },
];

// Crisp on-screen pixel keyboard rows for inline palette renaming (ZERO DOM overlays)
const OSK_ROWS: readonly (readonly string[])[] = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
  ['U', 'V', 'W', 'X', 'Y', 'Z', '0', '1', '2', '3'],
  ['4', '5', '6', '7', '8', '9', '-', '_', 'SPC', 'DEL'],
  ['CLR', 'CANCEL', 'OK'],
];

const MAX_PALETTE_NAME_LEN = 20;

// Sample settled blocks + falling tetrad for the safe 68x128 mini-board preview
const PREVIEW_SETTLED_BLOCKS: readonly { x: number; y: number; color: 1 | 2 | 3 | 4 }[] = [
  // Bottom V-funnel diamond cluster demonstrating all 4 shapes + colors
  { x: 3, y: 28, color: 1 },
  { x: 3, y: 27, color: 2 },
  { x: 4, y: 27, color: 3 },
  { x: 2, y: 26, color: 4 },
  { x: 3, y: 26, color: 2 },
  { x: 4, y: 26, color: 1 },
  { x: 2, y: 25, color: 3 },
  { x: 3, y: 25, color: 4 },
  { x: 4, y: 25, color: 2 },
  { x: 5, y: 25, color: 1 },
  { x: 1, y: 24, color: 1 },
  { x: 2, y: 24, color: 4 },
  { x: 3, y: 24, color: 3 },
  { x: 4, y: 24, color: 3 },
  { x: 5, y: 24, color: 4 },
  { x: 2, y: 23, color: 1 },
  { x: 3, y: 23, color: 2 },
  { x: 4, y: 23, color: 4 },
  { x: 5, y: 23, color: 2 },
  { x: 1, y: 22, color: 3 },
  { x: 2, y: 22, color: 2 },
  { x: 3, y: 22, color: 1 },
  { x: 4, y: 22, color: 4 },
  { x: 2, y: 21, color: 4 },
  { x: 3, y: 21, color: 3 },
  { x: 4, y: 21, color: 1 },
];

// Active sample falling 2x2 diamond tetrad (4 distinct shapes/colors)
const PREVIEW_FALLING_TETRAD: readonly { x: number; y: number; color: 1 | 2 | 3 | 4 }[] = [
  { x: 3, y: 10, color: 1 },
  { x: 4, y: 11, color: 2 },
  { x: 3, y: 12, color: 3 },
  { x: 3, y: 11, color: 4 },
];

// Sample ghost drop preview directly underneath
const PREVIEW_GHOST_TETRAD: readonly { x: number; y: number; color: 1 | 2 | 3 | 4 }[] = [
  { x: 3, y: 18, color: 1 },
  { x: 4, y: 19, color: 2 },
  { x: 3, y: 20, color: 3 },
  { x: 3, y: 19, color: 4 },
];

// Sample automata ripple cells across upper/mid interior
const PREVIEW_RIPPLE_CELLS: readonly { x: number; y: number; phase: number }[] = [
  { x: 2, y: 14, phase: 0.0 },
  { x: 3, y: 15, phase: 0.2 },
  { x: 4, y: 15, phase: 0.4 },
  { x: 5, y: 14, phase: 0.6 },
  { x: 1, y: 16, phase: 0.8 },
  { x: 5, y: 17, phase: 0.3 },
  { x: 2, y: 18, phase: 0.5 },
  { x: 5, y: 19, phase: 0.7 },
];

type EditFocusZone =
  | 'HEADER'
  | 'SWATCHES'
  | 'SLIDER_MODE'
  | 'SLIDER_0'
  | 'SLIDER_1'
  | 'SLIDER_2'
  | 'ACTIONS_1'
  | 'ACTIONS_2';

const EDIT_ZONES: readonly EditFocusZone[] = [
  'HEADER',
  'SWATCHES',
  'SLIDER_MODE',
  'SLIDER_0',
  'SLIDER_1',
  'SLIDER_2',
  'ACTIONS_1',
  'ACTIONS_2',
];

const BACK_BTN_RECT: HitRect = { x: 6, y: 4, w: 34, h: 11 };
const LIST_NEW_BTN_RECT: HitRect = { x: 8, y: 20, w: 122, h: 12 };
const LIST_IMPORT_BTN_RECT: HitRect = { x: 134, y: 20, w: 82, h: 12 };
const NAME_PILL_RECT: HitRect = { x: 44, y: 4, w: 120, h: 11 };
const HSV_TAB_RECT: HitRect = { x: 6, y: 60, w: 30, h: 11 };
const RGB_TAB_RECT: HitRect = { x: 38, y: 60, w: 30, h: 11 };

/**
 * Full Pixel-Native 320x180 6-Color Palette Editor (`LIST`, `TEMPLATE`, `EDIT`).
 * Renders a live 68x128 Mini-Board Safe Preview inside a contained panel so browsing and
 * editing light palettes never flashes or blinds the outer screen.
 */
export class ColorEditorScreen {
  private animTime = 0;
  private view: ColorEditorView = 'LIST';

  private palettes: Palette[] = [];
  private activeGamePaletteId = 'pico_dark';

  // LIST & TEMPLATE navigation
  private listIdx = 0; // -2 = CREATE NEW, -1 = IMPORT, 0..N-1 = palette row
  private listScrollTop = 0;
  private templateIdx = 0;
  private templateScrollTop = 0;

  // EDIT working state
  private workingId: string | undefined = undefined;
  private workingIsCustom = false;
  private workingName = 'My Palette';
  private workingColors: PaletteColors = ['#000000', '#1d2b53', '#fff7f2', '#ffec27', '#29adff', '#ff004d'];
  private baselineName = 'My Palette';
  private baselineColors: PaletteColors = ['#000000', '#1d2b53', '#fff7f2', '#ffec27', '#29adff', '#ff004d'];
  private dirty = false;

  // Swatch & slider editing state
  private selectedSlot = 0;
  private sliderMode: ColorSliderMode = 'HSV';
  private cachedHsv: HsvColor = { h: 0, s: 0, v: 0 };
  private swapSourceSlot: number | null = null;
  private copiedHex: string | null = null;
  private draggingSlider: number | null = null;
  private holdRepeatTimer = 0;

  // Focus cursor in EDIT view
  private editZoneIdx = 1; // default on SWATCHES
  private headerCol = 1; // 0 = < LIST, 1 = NAME
  private actionRow1Idx = 0;
  private actionRow2Idx = 0;

  // Modals (NAME OSK, DELETE_CONFIRM, UNSAVED_CONFIRM)
  private modal: ColorEditorModal = 'NONE';
  private modalBtnIdx = 0;
  private unsavedTarget: 'LIST' | 'CLOSE' = 'CLOSE';

  // Inline pixel name editor state
  private nameBuffer = '';
  private oskRow = 4;
  private oskCol = 2; // 'OK'
  private keyListenerAttached = false;

  // Toast & share state
  private toastText = '';
  private toastTimer = 0;
  private lastShareCode: string | null = null;

  onEnter(allPalettes: readonly Palette[], activePaletteId: string): void {
    this.detachTextKeyListener();
    this.palettes =
      allPalettes.length > 0
        ? allPalettes.map(clonePalette)
        : BUILTIN_PALETTES.map(clonePalette);
    this.activeGamePaletteId = activePaletteId;
    this.view = 'LIST';
    this.modal = 'NONE';
    this.swapSourceSlot = null;
    this.draggingSlider = null;
    this.toastText = '';
    this.toastTimer = 0;

    const activeIdx = this.palettes.findIndex((p) => p.id === activePaletteId);
    this.listIdx = activeIdx >= 0 ? activeIdx : 0;
    this.listScrollTop = Math.max(0, Math.min(Math.max(0, this.palettes.length - 8), this.listIdx - 3));
    this.templateIdx = 0;
    this.templateScrollTop = 0;
    this.loadPaletteIntoWorking(this.palettes[this.listIdx] ?? this.palettes[0]);
  }

  dispose(): void {
    this.detachTextKeyListener();
  }

  // ==========================================================================
  // PUBLIC INSPECTORS & PROGRAMMATIC HELPERS
  // ==========================================================================

  getView(): ColorEditorView {
    return this.view;
  }

  getWorkingPalette(): Palette {
    return {
      id: this.workingId ?? 'unsaved_custom',
      name: this.workingName,
      colors: [...this.workingColors] as PaletteColors,
      isCustom: this.workingIsCustom,
    };
  }

  isDirty(): boolean {
    return this.dirty;
  }

  getSelectedSlot(): number {
    return this.selectedSlot;
  }

  getSliderMode(): ColorSliderMode {
    return this.sliderMode;
  }

  setSliderMode(mode: ColorSliderMode): void {
    this.sliderMode = mode;
    this.syncCachedHsvFromSlot();
  }

  isSwapMode(): boolean {
    return this.swapSourceSlot !== null;
  }

  getSwapSourceSlot(): number | null {
    return this.swapSourceSlot;
  }

  getCopiedHex(): string | null {
    return this.copiedHex;
  }

  getActiveModal(): ColorEditorModal {
    return this.modal;
  }

  getLastShareCode(): string | null {
    return this.lastShareCode;
  }

  getToastText(): string {
    return this.toastTimer > 0 ? this.toastText : '';
  }

  showToast(text: string, durationSec = 2.4): void {
    this.toastText = text;
    this.toastTimer = durationSec;
  }

  openPaletteForEdit(paletteId: string): boolean {
    const found = this.palettes.find((p) => p.id === paletteId);
    if (!found) return false;
    this.loadPaletteIntoWorking(found);
    this.view = 'EDIT';
    this.modal = 'NONE';
    this.swapSourceSlot = null;
    this.editZoneIdx = 1;
    return true;
  }

  startNewFromTemplate(templateId: string, name = 'My Palette'): void {
    const source =
      this.palettes.find((p) => p.id === templateId) ??
      BUILTIN_PALETTES.find((p) => p.id === templateId) ??
      BUILTIN_PALETTES[0];
    this.workingId = undefined;
    this.workingIsCustom = true;
    this.workingName = name.trim().slice(0, MAX_PALETTE_NAME_LEN) || 'My Palette';
    this.workingColors = [...source.colors] as PaletteColors;
    this.baselineName = '';
    this.baselineColors = ['#000000', '#000000', '#000000', '#000000', '#000000', '#000000'];
    this.dirty = true;
    this.selectedSlot = 0;
    this.swapSourceSlot = null;
    this.syncCachedHsvFromSlot();
    this.view = 'EDIT';
    this.modal = 'NONE';
    this.editZoneIdx = 1;
  }

  selectSlot(slot: number): void {
    const next = Math.max(0, Math.min(5, Math.floor(slot)));
    if (this.swapSourceSlot !== null) {
      if (next !== this.swapSourceSlot) {
        this.triggerSwap(this.swapSourceSlot, next);
      }
      this.swapSourceSlot = null;
      this.selectedSlot = next;
      this.syncCachedHsvFromSlot();
      return;
    }
    this.selectedSlot = next;
    this.syncCachedHsvFromSlot();
  }

  setSlotHex(slot: number, hex: string): void {
    const idx = Math.max(0, Math.min(5, Math.floor(slot)));
    const norm = normalizeHexColor(hex);
    if (!norm) return;
    if (this.workingColors[idx] !== norm) {
      const next = [...this.workingColors] as PaletteColors;
      next[idx] = norm;
      this.workingColors = next;
      this.recomputeDirty();
    }
    if (idx === this.selectedSlot) {
      this.syncCachedHsvFromSlot();
    }
  }

  setSlotHsv(slot: number, h: number, s: number, v: number): void {
    const idx = Math.max(0, Math.min(5, Math.floor(slot)));
    const hh = ((h % 360) + 360) % 360;
    const ss = clamp(s, 0, 100);
    const vv = clamp(v, 0, 100);
    if (idx === this.selectedSlot) {
      this.cachedHsv = { h: hh, s: ss, v: vv };
    }
    const rgb = hsvToRgb(hh, ss, vv);
    const hex = rgb255ToHex(rgb.r, rgb.g, rgb.b);
    if (this.workingColors[idx] !== hex) {
      const next = [...this.workingColors] as PaletteColors;
      next[idx] = hex;
      this.workingColors = next;
      this.recomputeDirty();
    }
  }

  setSlotRgb(slot: number, r: number, g: number, b: number): void {
    const idx = Math.max(0, Math.min(5, Math.floor(slot)));
    const hex = rgb255ToHex(r, g, b);
    if (this.workingColors[idx] !== hex) {
      const next = [...this.workingColors] as PaletteColors;
      next[idx] = hex;
      this.workingColors = next;
      this.recomputeDirty();
    }
    if (idx === this.selectedSlot) {
      this.syncCachedHsvFromSlot();
    }
  }

  setWorkingName(name: string): void {
    const clean = name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_PALETTE_NAME_LEN);
    if (!clean) return;
    if (this.workingName !== clean) {
      this.workingName = clean;
      this.recomputeDirty();
    }
  }

  beginSwapMode(): void {
    if (this.swapSourceSlot !== null) {
      this.swapSourceSlot = null;
      this.showToast('SWAP CANCELLED', 1.4);
      return;
    }
    this.swapSourceSlot = this.selectedSlot;
    this.showToast(`SWAP: PICK SLOT FOR ${SLOT_SHORT_LABELS[this.selectedSlot]}`, 2.5);
  }

  triggerSwap(slotA: number, slotB: number): void {
    const swapped = swapPaletteSlots(this.workingColors, slotA, slotB);
    this.workingColors = swapped;
    this.swapSourceSlot = null;
    this.syncCachedHsvFromSlot();
    this.recomputeDirty();
    this.showToast(`SWAPPED ${SLOT_SHORT_LABELS[slotA]} <-> ${SLOT_SHORT_LABELS[slotB]}`, 1.8);
  }

  copySelectedSwatch(): string {
    const hex = this.workingColors[this.selectedSlot];
    this.copiedHex = hex;
    this.showToast(`COPIED ${hex.toUpperCase()}`, 1.8);
    return hex;
  }

  pasteToSelectedSwatch(): boolean {
    if (!this.copiedHex) {
      this.showToast('COPY A SWATCH FIRST', 1.6);
      return false;
    }
    this.setSlotHex(this.selectedSlot, this.copiedHex);
    this.showToast(`PASTED ${this.copiedHex.toUpperCase()}`, 1.8);
    return true;
  }

  triggerSave(callbacks: ColorEditorCallbacks, asCopy = false): Palette | null {
    const isUpdatingExistingCustom = !asCopy && this.workingIsCustom && Boolean(this.workingId);
    let saveName = this.workingName.trim() || 'My Palette';
    const unchangedBuiltinName =
      !this.workingIsCustom && saveName.toLowerCase() === this.baselineName.toLowerCase();
    if ((asCopy || unchangedBuiltinName) && !saveName.toLowerCase().endsWith('copy')) {
      saveName = `${saveName.slice(0, MAX_PALETTE_NAME_LEN - 5)} Copy`.trim();
    }

    const saved = callbacks.onSavePalette({
      ...(isUpdatingExistingCustom ? { id: this.workingId } : {}),
      name: saveName,
      colors: [...this.workingColors] as PaletteColors,
    });

    if (!saved) {
      callbacks.onPlayMenuFail?.();
      this.showToast('SAVE FAILED', 2.0);
      return null;
    }

    this.upsertLocalPalette(saved);
    this.loadPaletteIntoWorking(saved);
    callbacks.onPlayMenuSelect?.();
    this.showToast(asCopy ? 'SAVED PALETTE COPY' : 'PALETTE SAVED', 2.0);
    return saved;
  }

  triggerShare(callbacks: ColorEditorCallbacks): string {
    const code = encodePaletteShareCode(this.getWorkingPalette(), true);
    this.lastShareCode = code;
    if (callbacks.onCopyToClipboard) {
      void Promise.resolve(callbacks.onCopyToClipboard(code)).catch(() => {});
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(code).catch(() => {});
    }
    callbacks.onPlayMenuSelect?.();
    this.showToast(`SHARE: ${code}`, 3.5);
    return code;
  }

  importShareCode(code: string, callbacks?: ColorEditorCallbacks): boolean {
    const decoded = decodePaletteShareEntry(code);
    if (!decoded) {
      callbacks?.onPlayMenuFail?.();
      this.showToast('INVALID SHARE CODE', 2.2);
      return false;
    }

    if (this.view === 'EDIT') {
      this.workingColors = [...decoded.colors] as PaletteColors;
      if (decoded.name) {
        this.workingName = decoded.name.slice(0, MAX_PALETTE_NAME_LEN);
      }
      this.syncCachedHsvFromSlot();
      this.recomputeDirty();
    } else {
      this.workingId = undefined;
      this.workingIsCustom = true;
      this.workingName = (decoded.name ?? 'Imported Palette').slice(0, MAX_PALETTE_NAME_LEN);
      this.workingColors = [...decoded.colors] as PaletteColors;
      this.baselineName = '';
      this.baselineColors = ['#000000', '#000000', '#000000', '#000000', '#000000', '#000000'];
      this.dirty = true;
      this.selectedSlot = 0;
      this.swapSourceSlot = null;
      this.syncCachedHsvFromSlot();
      this.view = 'EDIT';
      this.editZoneIdx = 1;
    }

    callbacks?.onPlayMenuSelect?.();
    this.showToast('PALETTE IMPORTED', 2.2);
    return true;
  }

  triggerApply(callbacks: ColorEditorCallbacks): boolean {
    let targetId = this.workingId;
    if (!targetId || this.dirty) {
      const saved = this.triggerSave(callbacks, !this.workingIsCustom);
      if (!saved) return false;
      targetId = saved.id;
    }
    this.activeGamePaletteId = targetId;
    callbacks.onApplyPalette(targetId);
    callbacks.onPlayMenuSelect?.();
    this.showToast('PALETTE APPLIED', 2.0);
    return true;
  }

  requestClose(target: 'LIST' | 'CLOSE', callbacks: ColorEditorCallbacks): void {
    if (this.view === 'EDIT' && this.dirty) {
      this.unsavedTarget = target;
      this.modal = 'UNSAVED_CONFIRM';
      this.modalBtnIdx = 0;
      callbacks.onPlayMenuMove?.();
      return;
    }
    this.swapSourceSlot = null;
    this.draggingSlider = null;
    if (target === 'LIST') {
      this.view = 'LIST';
      callbacks.onPlayMenuBack?.();
    } else {
      this.detachTextKeyListener();
      callbacks.onPlayMenuBack?.();
      callbacks.onClose();
    }
  }

  /** Direct character injection helper (used by physical keyboard listener & tests). */
  typeNameChar(ch: string): void {
    if (this.modal !== 'NAME') return;
    if (ch.length !== 1) return;
    if (!/^[a-zA-Z0-9 _\-!.]$/.test(ch)) return;
    if (this.nameBuffer.length < MAX_PALETTE_NAME_LEN) {
      this.nameBuffer += ch;
    }
  }

  backspaceNameChar(): void {
    if (this.modal !== 'NAME') return;
    if (this.nameBuffer.length > 0) {
      this.nameBuffer = this.nameBuffer.slice(0, -1);
    }
  }

  // ==========================================================================
  // UPDATE LOOP (KEYBOARD + GAMEPAD + MOUSE HOVER / CLICK / DRAG)
  // ==========================================================================

  update(dtSec: number, uiInput: UiInputState, callbacks: ColorEditorCallbacks): void {
    const dt = Math.max(0, Math.min(dtSec, 0.1));
    this.animTime += dt;
    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - dt);
    }

    if (this.modal !== 'NONE') {
      this.updateModal(uiInput, callbacks);
      return;
    }

    if (!uiInput.mouseDown) {
      this.draggingSlider = null;
    }

    switch (this.view) {
      case 'LIST':
        this.updateListView(uiInput, callbacks);
        break;
      case 'TEMPLATE':
        this.updateTemplateView(uiInput, callbacks);
        break;
      case 'EDIT':
        this.updateEditView(dt, uiInput, callbacks);
        break;
    }
  }

  private getTemplatePalettes(): Palette[] {
    const featured: Palette[] = [];
    const featuredSet = new Set<string>();
    for (const id of FEATURED_TEMPLATE_IDS) {
      const found =
        this.palettes.find((p) => p.id === id) ?? BUILTIN_PALETTES.find((p) => p.id === id);
      if (found && !featuredSet.has(found.id)) {
        featured.push(found);
        featuredSet.add(found.id);
      }
    }
    for (const p of this.palettes) {
      if (!featuredSet.has(p.id)) {
        featured.push(p);
      }
    }
    return featured;
  }

  private updateListView(input: UiInputState, cb: ColorEditorCallbacks): void {
    if (input.cancel) {
      this.detachTextKeyListener();
      cb.onPlayMenuBack?.();
      cb.onClose();
      return;
    }

    const total = this.palettes.length;
    const maxVisible = 8;

    if (input.up) {
      if (this.listIdx > -2) {
        this.listIdx -= 1;
      } else {
        this.listIdx = total - 1;
      }
      this.keepListScrollInView(maxVisible);
      cb.onPlayMenuMove?.();
    } else if (input.down) {
      if (this.listIdx < total - 1) {
        this.listIdx += 1;
      } else {
        this.listIdx = -2;
      }
      this.keepListScrollInView(maxVisible);
      cb.onPlayMenuMove?.();
    } else if (input.left && this.listIdx === -1) {
      this.listIdx = -2;
      cb.onPlayMenuMove?.();
    } else if (input.right && this.listIdx === -2) {
      this.listIdx = -1;
      cb.onPlayMenuMove?.();
    }

    if (input.mouseInBounds) {
      if (input.mouseClicked && hitTest(input.mouseX, input.mouseY, BACK_BTN_RECT)) {
        this.detachTextKeyListener();
        cb.onPlayMenuBack?.();
        cb.onClose();
        return;
      }
      if (hitTest(input.mouseX, input.mouseY, LIST_NEW_BTN_RECT)) {
        if (input.mouseMoved && this.listIdx !== -2) {
          this.listIdx = -2;
          cb.onPlayMenuMove?.();
        }
        if (input.mouseClicked) {
          this.listIdx = -2;
          this.enterTemplateView(cb);
          return;
        }
      }
      if (hitTest(input.mouseX, input.mouseY, LIST_IMPORT_BTN_RECT)) {
        if (input.mouseMoved && this.listIdx !== -1) {
          this.listIdx = -1;
          cb.onPlayMenuMove?.();
        }
        if (input.mouseClicked) {
          this.listIdx = -1;
          this.promptAndImport(cb);
          return;
        }
      }

      const visibleEnd = Math.min(total, this.listScrollTop + maxVisible);
      for (let i = this.listScrollTop; i < visibleEnd; i++) {
        const slot = i - this.listScrollTop;
        const rowRect: HitRect = { x: 8, y: 36 + slot * 16, w: 208, h: 14 };
        if (hitTest(input.mouseX, input.mouseY, rowRect)) {
          if (input.mouseMoved && this.listIdx !== i) {
            this.listIdx = i;
            cb.onPlayMenuMove?.();
          }
          if (input.mouseClicked) {
            this.listIdx = i;
            cb.onPlayMenuSelect?.();
            this.openPaletteForEdit(this.palettes[i].id);
            return;
          }
        }
      }
    }

    if (input.confirm) {
      if (this.listIdx === -2) {
        this.enterTemplateView(cb);
      } else if (this.listIdx === -1) {
        this.promptAndImport(cb);
      } else if (this.listIdx >= 0 && this.listIdx < total) {
        cb.onPlayMenuSelect?.();
        this.openPaletteForEdit(this.palettes[this.listIdx].id);
      }
    }
  }

  private enterTemplateView(cb: ColorEditorCallbacks): void {
    this.view = 'TEMPLATE';
    this.templateIdx = 0;
    this.templateScrollTop = 0;
    cb.onPlayMenuSelect?.();
  }

  private updateTemplateView(input: UiInputState, cb: ColorEditorCallbacks): void {
    if (input.cancel) {
      this.view = 'LIST';
      cb.onPlayMenuBack?.();
      return;
    }

    const templates = this.getTemplatePalettes();
    const total = templates.length;
    const maxVisible = 8;

    if (input.up) {
      this.templateIdx = (this.templateIdx - 1 + total) % total;
      this.keepTemplateScrollInView(maxVisible);
      cb.onPlayMenuMove?.();
    } else if (input.down) {
      this.templateIdx = (this.templateIdx + 1) % total;
      this.keepTemplateScrollInView(maxVisible);
      cb.onPlayMenuMove?.();
    }

    if (input.mouseInBounds) {
      if (input.mouseClicked && hitTest(input.mouseX, input.mouseY, BACK_BTN_RECT)) {
        this.view = 'LIST';
        cb.onPlayMenuBack?.();
        return;
      }
      const visibleEnd = Math.min(total, this.templateScrollTop + maxVisible);
      for (let i = this.templateScrollTop; i < visibleEnd; i++) {
        const slot = i - this.templateScrollTop;
        const rowRect: HitRect = { x: 8, y: 34 + slot * 16, w: 208, h: 14 };
        if (hitTest(input.mouseX, input.mouseY, rowRect)) {
          if (input.mouseMoved && this.templateIdx !== i) {
            this.templateIdx = i;
            cb.onPlayMenuMove?.();
          }
          if (input.mouseClicked) {
            this.templateIdx = i;
            cb.onPlayMenuSelect?.();
            this.startNewFromTemplate(templates[i].id, 'My Palette');
            return;
          }
        }
      }
    }

    if (input.confirm && templates[this.templateIdx]) {
      cb.onPlayMenuSelect?.();
      this.startNewFromTemplate(templates[this.templateIdx].id, 'My Palette');
    }
  }

  private updateEditView(dt: number, input: UiInputState, cb: ColorEditorCallbacks): void {
    if (input.cancel) {
      if (this.swapSourceSlot !== null) {
        this.swapSourceSlot = null;
        cb.onPlayMenuBack?.();
        this.showToast('SWAP CANCELLED', 1.4);
        return;
      }
      this.requestClose('LIST', cb);
      return;
    }

    // Active mouse slider drag takes priority so scrubbing is buttery smooth
    if (this.draggingSlider !== null && input.mouseDown && input.mouseInBounds) {
      const ratio = clamp((input.mouseX - 34) / 150, 0, 1);
      this.applySliderRatio(this.draggingSlider, ratio);
      return;
    }

    // Mouse interactions across all EDIT zones
    if (input.mouseInBounds) {
      if (input.mouseClicked) {
        if (hitTest(input.mouseX, input.mouseY, BACK_BTN_RECT)) {
          this.requestClose('LIST', cb);
          return;
        }
        if (hitTest(input.mouseX, input.mouseY, NAME_PILL_RECT)) {
          this.editZoneIdx = 0;
          this.headerCol = 1;
          this.openNameModal(cb);
          return;
        }
        // 6 Swatches
        for (let s = 0; s < 6; s++) {
          const rect = this.getSwatchRect(s);
          if (hitTest(input.mouseX, input.mouseY, rect)) {
            this.editZoneIdx = 1;
            const wasSwap = this.swapSourceSlot !== null;
            this.selectSlot(s);
            if (wasSwap) {
              cb.onPlayMenuSelect?.();
            } else {
              cb.onPlayMenuMove?.();
            }
            return;
          }
        }
        // HSV / RGB tabs
        if (hitTest(input.mouseX, input.mouseY, HSV_TAB_RECT)) {
          this.editZoneIdx = 2;
          if (this.sliderMode !== 'HSV') {
            this.setSliderMode('HSV');
            cb.onPlayMenuMove?.();
          }
          return;
        }
        if (hitTest(input.mouseX, input.mouseY, RGB_TAB_RECT)) {
          this.editZoneIdx = 2;
          if (this.sliderMode !== 'RGB') {
            this.setSliderMode('RGB');
            cb.onPlayMenuMove?.();
          }
          return;
        }
        // 3 Sliders
        for (let i = 0; i < 3; i++) {
          const trackHit: HitRect = { x: 30, y: 74 + i * 17, w: 158, h: 15 };
          if (hitTest(input.mouseX, input.mouseY, trackHit)) {
            this.editZoneIdx = 3 + i;
            this.draggingSlider = i;
            const ratio = clamp((input.mouseX - 34) / 150, 0, 1);
            this.applySliderRatio(i, ratio);
            cb.onPlayMenuMove?.();
            return;
          }
        }
        // Action Row 1
        for (let i = 0; i < ACTION_ROW_1.length; i++) {
          if (hitTest(input.mouseX, input.mouseY, ACTION_ROW_1[i].rect)) {
            this.editZoneIdx = 6;
            this.actionRow1Idx = i;
            this.activateAction(ACTION_ROW_1[i].id, cb);
            return;
          }
        }
        // Action Row 2
        for (let i = 0; i < ACTION_ROW_2.length; i++) {
          if (hitTest(input.mouseX, input.mouseY, ACTION_ROW_2[i].rect)) {
            this.editZoneIdx = 7;
            this.actionRow2Idx = i;
            this.activateAction(ACTION_ROW_2[i].id, cb);
            return;
          }
        }
      } else if (input.mouseMoved) {
        // Subtle hover focus sync for action buttons
        for (let i = 0; i < ACTION_ROW_1.length; i++) {
          if (hitTest(input.mouseX, input.mouseY, ACTION_ROW_1[i].rect)) {
            this.editZoneIdx = 6;
            this.actionRow1Idx = i;
          }
        }
        for (let i = 0; i < ACTION_ROW_2.length; i++) {
          if (hitTest(input.mouseX, input.mouseY, ACTION_ROW_2[i].rect)) {
            this.editZoneIdx = 7;
            this.actionRow2Idx = i;
          }
        }
      }
    }

    // Keyboard & Gamepad zone navigation
    if (input.up) {
      this.editZoneIdx = (this.editZoneIdx - 1 + EDIT_ZONES.length) % EDIT_ZONES.length;
      cb.onPlayMenuMove?.();
      return;
    }
    if (input.down) {
      this.editZoneIdx = (this.editZoneIdx + 1) % EDIT_ZONES.length;
      cb.onPlayMenuMove?.();
      return;
    }

    const zone = EDIT_ZONES[this.editZoneIdx];
    switch (zone) {
      case 'HEADER':
        if (input.left || input.right) {
          this.headerCol = this.headerCol === 0 ? 1 : 0;
          cb.onPlayMenuMove?.();
        } else if (input.confirm) {
          if (this.headerCol === 0) {
            this.requestClose('LIST', cb);
          } else {
            this.openNameModal(cb);
          }
        }
        break;

      case 'SWATCHES':
        if (input.left) {
          this.selectedSlot = (this.selectedSlot + 5) % 6;
          this.syncCachedHsvFromSlot();
          cb.onPlayMenuMove?.();
        } else if (input.right) {
          this.selectedSlot = (this.selectedSlot + 1) % 6;
          this.syncCachedHsvFromSlot();
          cb.onPlayMenuMove?.();
        } else if (input.confirm) {
          if (this.swapSourceSlot !== null) {
            if (this.swapSourceSlot !== this.selectedSlot) {
              this.triggerSwap(this.swapSourceSlot, this.selectedSlot);
              cb.onPlayMenuSelect?.();
            } else {
              this.swapSourceSlot = null;
              cb.onPlayMenuBack?.();
            }
          } else {
            this.editZoneIdx = 3; // jump directly into first slider
            cb.onPlayMenuSelect?.();
          }
        }
        break;

      case 'SLIDER_MODE':
        if (input.left || input.right || input.confirm) {
          this.setSliderMode(this.sliderMode === 'HSV' ? 'RGB' : 'HSV');
          cb.onPlayMenuMove?.();
        }
        break;

      case 'SLIDER_0':
      case 'SLIDER_1':
      case 'SLIDER_2': {
        const sliderIdx = zone === 'SLIDER_0' ? 0 : zone === 'SLIDER_1' ? 1 : 2;
        if (input.left) {
          this.nudgeSlider(sliderIdx, -1);
          this.holdRepeatTimer = 0.24;
          cb.onPlayMenuMove?.();
        } else if (input.right) {
          this.nudgeSlider(sliderIdx, 1);
          this.holdRepeatTimer = 0.24;
          cb.onPlayMenuMove?.();
        } else if (input.leftHeld || input.rightHeld) {
          this.holdRepeatTimer -= dt;
          if (this.holdRepeatTimer <= 0) {
            this.holdRepeatTimer = 0.045;
            this.nudgeSlider(sliderIdx, input.rightHeld ? 1 : -1);
          }
        } else {
          this.holdRepeatTimer = 0;
        }
        break;
      }

      case 'ACTIONS_1':
        if (input.left) {
          this.actionRow1Idx = (this.actionRow1Idx - 1 + ACTION_ROW_1.length) % ACTION_ROW_1.length;
          cb.onPlayMenuMove?.();
        } else if (input.right) {
          this.actionRow1Idx = (this.actionRow1Idx + 1) % ACTION_ROW_1.length;
          cb.onPlayMenuMove?.();
        } else if (input.confirm) {
          this.activateAction(ACTION_ROW_1[this.actionRow1Idx].id, cb);
        }
        break;

      case 'ACTIONS_2':
        if (input.left) {
          this.actionRow2Idx = (this.actionRow2Idx - 1 + ACTION_ROW_2.length) % ACTION_ROW_2.length;
          cb.onPlayMenuMove?.();
        } else if (input.right) {
          this.actionRow2Idx = (this.actionRow2Idx + 1) % ACTION_ROW_2.length;
          cb.onPlayMenuMove?.();
        } else if (input.confirm) {
          this.activateAction(ACTION_ROW_2[this.actionRow2Idx].id, cb);
        }
        break;
    }
  }

  private activateAction(action: ActionId, cb: ColorEditorCallbacks): void {
    switch (action) {
      case 'SWAP':
        this.beginSwapMode();
        this.editZoneIdx = 1; // move focus directly to swatches to pick target
        cb.onPlayMenuSelect?.();
        break;
      case 'COPY':
        this.copySelectedSwatch();
        cb.onPlayMenuSelect?.();
        break;
      case 'PASTE':
        if (this.pasteToSelectedSwatch()) {
          cb.onPlayMenuSelect?.();
        } else {
          cb.onPlayMenuFail?.();
        }
        break;
      case 'SHARE':
        this.triggerShare(cb);
        break;
      case 'IMPORT':
        this.promptAndImport(cb);
        break;
      case 'SAVE':
        this.triggerSave(cb, false);
        break;
      case 'SAVE_COPY':
        this.triggerSave(cb, true);
        break;
      case 'DELETE':
        if (!this.workingIsCustom || !this.workingId) {
          cb.onPlayMenuFail?.();
          this.showToast('BUILT-IN CANNOT DELETE', 2.0);
        } else {
          this.modal = 'DELETE_CONFIRM';
          this.modalBtnIdx = 1; // default safely to CANCEL
          cb.onPlayMenuMove?.();
        }
        break;
      case 'APPLY':
        this.triggerApply(cb);
        break;
      case 'CLOSE':
        this.requestClose('CLOSE', cb);
        break;
    }
  }

  private promptAndImport(cb: ColorEditorCallbacks): void {
    let raw: string | null = null;
    if (cb.onRequestImportCode) {
      raw = cb.onRequestImportCode();
    } else if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      raw = window.prompt('Paste 36-hex palette share code (optional Name:hex):', '');
    }
    if (raw === null || raw.trim() === '') {
      return;
    }
    this.importShareCode(raw, cb);
  }

  // ==========================================================================
  // MODALS: PIXEL NAME EDITOR, DELETE CONFIRM, UNSAVED CHANGES CONFIRM
  // ==========================================================================

  private openNameModal(cb: ColorEditorCallbacks): void {
    this.modal = 'NAME';
    this.nameBuffer = this.workingName;
    this.oskRow = 4;
    this.oskCol = 2; // focused on OK
    this.attachTextKeyListener();
    cb.onPlayMenuSelect?.();
  }

  private closeNameModal(): void {
    this.detachTextKeyListener();
    this.modal = 'NONE';
  }

  private updateModal(input: UiInputState, cb: ColorEditorCallbacks): void {
    if (this.modal === 'NAME') {
      this.updateNameModal(input, cb);
      return;
    }

    if (this.modal === 'DELETE_CONFIRM') {
      if (input.cancel) {
        this.modal = 'NONE';
        cb.onPlayMenuBack?.();
        return;
      }
      if (input.left || input.right) {
        this.modalBtnIdx = this.modalBtnIdx === 0 ? 1 : 0;
        cb.onPlayMenuMove?.();
      }
      const btn0: HitRect = { x: 84, y: 102, w: 68, h: 14 };
      const btn1: HitRect = { x: 168, y: 102, w: 68, h: 14 };
      if (input.mouseInBounds) {
        if (hitTest(input.mouseX, input.mouseY, btn0)) {
          if (input.mouseMoved) this.modalBtnIdx = 0;
          if (input.mouseClicked) {
            this.confirmDelete(cb);
            return;
          }
        } else if (hitTest(input.mouseX, input.mouseY, btn1)) {
          if (input.mouseMoved) this.modalBtnIdx = 1;
          if (input.mouseClicked) {
            this.modal = 'NONE';
            cb.onPlayMenuBack?.();
            return;
          }
        }
      }
      if (input.confirm) {
        if (this.modalBtnIdx === 0) {
          this.confirmDelete(cb);
        } else {
          this.modal = 'NONE';
          cb.onPlayMenuBack?.();
        }
      }
      return;
    }

    if (this.modal === 'UNSAVED_CONFIRM') {
      if (input.cancel) {
        this.modal = 'NONE';
        cb.onPlayMenuBack?.();
        return;
      }
      if (input.left) {
        this.modalBtnIdx = (this.modalBtnIdx + 2) % 3;
        cb.onPlayMenuMove?.();
      } else if (input.right) {
        this.modalBtnIdx = (this.modalBtnIdx + 1) % 3;
        cb.onPlayMenuMove?.();
      }
      const btns: HitRect[] = [
        { x: 56, y: 102, w: 66, h: 14 }, // SAVE
        { x: 127, y: 102, w: 66, h: 14 }, // DISCARD
        { x: 198, y: 102, w: 66, h: 14 }, // CANCEL
      ];
      if (input.mouseInBounds) {
        for (let i = 0; i < btns.length; i++) {
          if (hitTest(input.mouseX, input.mouseY, btns[i])) {
            if (input.mouseMoved) this.modalBtnIdx = i;
            if (input.mouseClicked) {
              this.executeUnsavedChoice(i, cb);
              return;
            }
          }
        }
      }
      if (input.confirm) {
        this.executeUnsavedChoice(this.modalBtnIdx, cb);
      }
    }
  }

  private confirmDelete(cb: ColorEditorCallbacks): void {
    const id = this.workingId;
    this.modal = 'NONE';
    if (!id) return;
    const ok = callbacksDeleteSafe(id, cb);
    if (ok) {
      this.palettes = this.palettes.filter((p) => p.id !== id);
      if (this.listIdx >= this.palettes.length) {
        this.listIdx = Math.max(0, this.palettes.length - 1);
      }
      this.dirty = false;
      this.view = 'LIST';
      cb.onPlayMenuSelect?.();
      this.showToast('PALETTE DELETED', 2.0);
    } else {
      cb.onPlayMenuFail?.();
      this.showToast('DELETE FAILED', 2.0);
    }
  }

  private executeUnsavedChoice(choiceIdx: number, cb: ColorEditorCallbacks): void {
    this.modal = 'NONE';
    if (choiceIdx === 0) {
      // Save & continue
      const saved = this.triggerSave(cb, false);
      if (!saved) return;
      this.finishPendingExit(cb);
    } else if (choiceIdx === 1) {
      // Discard
      this.dirty = false;
      this.finishPendingExit(cb);
    } else {
      // Keep editing
      cb.onPlayMenuBack?.();
    }
  }

  private finishPendingExit(cb: ColorEditorCallbacks): void {
    this.swapSourceSlot = null;
    this.draggingSlider = null;
    if (this.unsavedTarget === 'LIST') {
      this.view = 'LIST';
      cb.onPlayMenuBack?.();
    } else {
      this.detachTextKeyListener();
      cb.onPlayMenuBack?.();
      cb.onClose();
    }
  }

  private updateNameModal(input: UiInputState, cb: ColorEditorCallbacks): void {
    if (input.cancel) {
      this.closeNameModal();
      cb.onPlayMenuBack?.();
      return;
    }

    if (input.up) {
      this.oskRow = (this.oskRow - 1 + OSK_ROWS.length) % OSK_ROWS.length;
      this.oskCol = Math.min(this.oskCol, OSK_ROWS[this.oskRow].length - 1);
      cb.onPlayMenuMove?.();
    } else if (input.down) {
      this.oskRow = (this.oskRow + 1) % OSK_ROWS.length;
      this.oskCol = Math.min(this.oskCol, OSK_ROWS[this.oskRow].length - 1);
      cb.onPlayMenuMove?.();
    } else if (input.left) {
      const rowLen = OSK_ROWS[this.oskRow].length;
      this.oskCol = (this.oskCol - 1 + rowLen) % rowLen;
      cb.onPlayMenuMove?.();
    } else if (input.right) {
      const rowLen = OSK_ROWS[this.oskRow].length;
      this.oskCol = (this.oskCol + 1) % rowLen;
      cb.onPlayMenuMove?.();
    }

    if (input.mouseInBounds) {
      for (let r = 0; r < OSK_ROWS.length; r++) {
        const row = OSK_ROWS[r];
        for (let c = 0; c < row.length; c++) {
          const rect = this.getOskKeyRect(r, c);
          if (hitTest(input.mouseX, input.mouseY, rect)) {
            if (input.mouseMoved) {
              this.oskRow = r;
              this.oskCol = c;
            }
            if (input.mouseClicked) {
              this.oskRow = r;
              this.oskCol = c;
              this.activateOskKey(row[c], cb);
              return;
            }
          }
        }
      }
    }

    if (input.confirm) {
      this.activateOskKey(OSK_ROWS[this.oskRow][this.oskCol], cb);
    }
  }

  private activateOskKey(key: string, cb: ColorEditorCallbacks): void {
    if (key === 'OK') {
      const clean = this.nameBuffer.trim();
      if (!clean) {
        cb.onPlayMenuFail?.();
        return;
      }
      this.setWorkingName(clean);
      this.closeNameModal();
      cb.onPlayMenuSelect?.();
      return;
    }
    if (key === 'CANCEL') {
      this.closeNameModal();
      cb.onPlayMenuBack?.();
      return;
    }
    if (key === 'CLR') {
      this.nameBuffer = '';
      cb.onPlayMenuMove?.();
      return;
    }
    if (key === 'DEL') {
      this.backspaceNameChar();
      cb.onPlayMenuMove?.();
      return;
    }
    if (key === 'SPC') {
      this.typeNameChar(' ');
      cb.onPlayMenuMove?.();
      return;
    }
    this.typeNameChar(key);
    cb.onPlayMenuMove?.();
  }

  private getOskKeyRect(row: number, col: number): HitRect {
    const startY = 66;
    if (row < 4) {
      return { x: 40 + col * 24, y: startY + row * 15, w: 22, h: 13 };
    }
    // Bottom control row: CLR, CANCEL, OK
    const widths = [64, 78, 86];
    const xs = [40, 108, 190];
    return { x: xs[col] ?? 40, y: startY + 4 * 15 + 3, w: widths[col] ?? 64, h: 14 };
  }

  private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
    if (this.modal !== 'NAME') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.backspaceNameChar();
      return;
    }
    if (e.key.length === 1 && /^[a-zA-Z0-9 _\-!.]$/.test(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.typeNameChar(e.key);
      // Keep OSK focus on OK so typing + pressing Enter saves immediately
      this.oskRow = 4;
      this.oskCol = 2;
    }
  };

  private attachTextKeyListener(): void {
    if (this.keyListenerAttached || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onWindowKeyDown, { capture: true });
    this.keyListenerAttached = true;
  }

  private detachTextKeyListener(): void {
    if (!this.keyListenerAttached || typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onWindowKeyDown, { capture: true });
    this.keyListenerAttached = false;
  }

  // ==========================================================================
  // INTERNAL STATE SYNC HELPERS
  // ==========================================================================

  private loadPaletteIntoWorking(palette: Palette): void {
    this.workingId = palette.id;
    this.workingIsCustom = Boolean(palette.isCustom);
    this.workingName = palette.name;
    this.workingColors = [...palette.colors] as PaletteColors;
    this.baselineName = palette.name;
    this.baselineColors = [...palette.colors] as PaletteColors;
    this.dirty = false;
    this.syncCachedHsvFromSlot();
  }

  private upsertLocalPalette(saved: Palette): void {
    const idx = this.palettes.findIndex((p) => p.id === saved.id);
    if (idx >= 0) {
      this.palettes[idx] = clonePalette(saved);
    } else {
      this.palettes.push(clonePalette(saved));
    }
  }

  private recomputeDirty(): void {
    if (!this.workingId) {
      this.dirty = true;
      return;
    }
    this.dirty =
      this.workingName !== this.baselineName ||
      !samePaletteColors(this.workingColors, this.baselineColors);
  }

  private syncCachedHsvFromSlot(): void {
    const rgb = hexToRgb255(this.workingColors[this.selectedSlot]);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    // Preserve hue if color is achromatic (black/white/gray) so sliders stay smooth
    if (hsv.s === 0 || hsv.v === 0) {
      this.cachedHsv = { h: this.cachedHsv.h, s: hsv.s, v: hsv.v };
    } else {
      this.cachedHsv = hsv;
    }
  }

  private applySliderRatio(sliderIdx: number, ratio: number): void {
    const t = clamp(ratio, 0, 1);
    if (this.sliderMode === 'HSV') {
      const { h, s, v } = this.cachedHsv;
      if (sliderIdx === 0) {
        this.setSlotHsv(this.selectedSlot, Math.round(t * 359), s, v);
      } else if (sliderIdx === 1) {
        this.setSlotHsv(this.selectedSlot, h, Math.round(t * 100), v);
      } else {
        this.setSlotHsv(this.selectedSlot, h, s, Math.round(t * 100));
      }
    } else {
      const rgb = hexToRgb255(this.workingColors[this.selectedSlot]);
      const val = Math.round(t * 255);
      if (sliderIdx === 0) {
        this.setSlotRgb(this.selectedSlot, val, rgb.g, rgb.b);
      } else if (sliderIdx === 1) {
        this.setSlotRgb(this.selectedSlot, rgb.r, val, rgb.b);
      } else {
        this.setSlotRgb(this.selectedSlot, rgb.r, rgb.g, val);
      }
    }
  }

  private nudgeSlider(sliderIdx: number, dir: -1 | 1): void {
    if (this.sliderMode === 'HSV') {
      const { h, s, v } = this.cachedHsv;
      if (sliderIdx === 0) {
        this.setSlotHsv(this.selectedSlot, ((Math.round(h) + dir * 5) % 360 + 360) % 360, s, v);
      } else if (sliderIdx === 1) {
        this.setSlotHsv(this.selectedSlot, h, clamp(Math.round(s) + dir * 2, 0, 100), v);
      } else {
        this.setSlotHsv(this.selectedSlot, h, s, clamp(Math.round(v) + dir * 2, 0, 100));
      }
    } else {
      const rgb = hexToRgb255(this.workingColors[this.selectedSlot]);
      const step = dir * 4;
      if (sliderIdx === 0) {
        this.setSlotRgb(this.selectedSlot, clamp(rgb.r + step, 0, 255), rgb.g, rgb.b);
      } else if (sliderIdx === 1) {
        this.setSlotRgb(this.selectedSlot, rgb.r, clamp(rgb.g + step, 0, 255), rgb.b);
      } else {
        this.setSlotRgb(this.selectedSlot, rgb.r, rgb.g, clamp(rgb.b + step, 0, 255));
      }
    }
  }

  private keepListScrollInView(maxVisible: number): void {
    if (this.listIdx < 0) return;
    if (this.listIdx < this.listScrollTop) {
      this.listScrollTop = this.listIdx;
    } else if (this.listIdx >= this.listScrollTop + maxVisible) {
      this.listScrollTop = this.listIdx - maxVisible + 1;
    }
  }

  private keepTemplateScrollInView(maxVisible: number): void {
    if (this.templateIdx < this.templateScrollTop) {
      this.templateScrollTop = this.templateIdx;
    } else if (this.templateIdx >= this.templateScrollTop + maxVisible) {
      this.templateScrollTop = this.templateIdx - maxVisible + 1;
    }
  }

  private getSwatchRect(slot: number): HitRect {
    return { x: 6 + slot * 36, y: 19, w: 34, h: 36 };
  }

  // ==========================================================================
  // PIXEL-NATIVE 320x180 RENDERING
  // ==========================================================================

  render(renderer: ColorEditorRenderer, activeBgPalette: Palette): void {
    this.renderAmbientDiamonds(renderer, activeBgPalette);

    switch (this.view) {
      case 'LIST':
        this.renderListView(renderer, activeBgPalette);
        break;
      case 'TEMPLATE':
        this.renderTemplateView(renderer, activeBgPalette);
        break;
      case 'EDIT':
        this.renderEditView(renderer, activeBgPalette);
        break;
    }

    if (this.modal !== 'NONE') {
      this.renderModal(renderer, activeBgPalette);
    }

    if (this.toastTimer > 0 && this.toastText) {
      const alpha = Math.min(1, this.toastTimer * 2);
      const display = this.toastText.length > 68 ? `${this.toastText.slice(0, 65)}...` : this.toastText;
      const w = Math.min(308, display.length * 4 + 14);
      const x = Math.round((LOGICAL_WIDTH - w) * 0.5);
      drawBox(
        renderer,
        x,
        162,
        w,
        13,
        activeBgPalette.colors[1],
        activeBgPalette.colors[3],
        0.96 * alpha,
        alpha,
      );
      renderer.drawTextHex(display, LOGICAL_WIDTH * 0.5, 166, activeBgPalette.colors[3], alpha, '3x5', 'center');
    }
  }

  private renderAmbientDiamonds(renderer: ColorEditorRenderer, bg: Palette): void {
    const cx = LOGICAL_WIDTH * 0.5;
    const cy = LOGICAL_HEIGHT * 0.5;
    for (let i = 0; i < 3; i++) {
      const phase = ((this.animTime * 0.1 + i / 3) % 1 + 1) % 1;
      const radius = 18 + phase * 165;
      const alpha = Math.sin(phase * Math.PI) * 0.16;
      if (alpha <= 0.01) continue;
      const [r, g, b] = parseHexRgb01(bg.colors[2 + (i % 4)]);
      renderer.drawDiamondOutline(cx, cy, radius, r, g, b, alpha);
    }
  }

  private renderBackBtn(renderer: ColorEditorRenderer, bg: Palette, label: string, focused = false): void {
    drawBox(
      renderer,
      BACK_BTN_RECT.x,
      BACK_BTN_RECT.y,
      BACK_BTN_RECT.w,
      BACK_BTN_RECT.h,
      bg.colors[1],
      focused ? bg.colors[3] : bg.colors[2],
      0.9,
      focused ? 1 : 0.7,
    );
    renderer.drawTextHex(
      label,
      BACK_BTN_RECT.x + BACK_BTN_RECT.w * 0.5,
      BACK_BTN_RECT.y + 3,
      focused ? bg.colors[3] : bg.colors[2],
      1,
      '3x5',
      'center',
    );
  }

  /**
   * Contained Live 68x128 Mini-Board Safe Preview Panel (x=224..314, y=18..170).
   * Renders the preview palette's own BG (0), board fill (1), container border (2),
   * 4 distinct 6x6 diamond shapes (slots 2..5), ghost preview, automata ripple, and sample text
   * WITHOUT altering the outer editor screen background!
   */
  private renderSafeMiniBoardPreview(
    renderer: ColorEditorRenderer,
    previewPalette: Palette,
    outerBg: Palette,
  ): void {
    const px = 224;
    const py = 18;
    const pw = 90;
    const ph = 152;

    renderer.drawTextHex('LIVE PREVIEW', px + pw * 0.5, 7, outerBg.colors[2], 0.8, '3x5', 'center');

    // Outer frame in safe active palette, interior filled with preview palette's Slot 0 BG
    drawBox(renderer, px, py, pw, ph, previewPalette.colors[0], outerBg.colors[2], 1, 0.9);

    // Exact native 68x128 diamond container centered inside preview panel
    const bx = px + 11; // 235
    const by = py + 3; // 21

    // 1. Container interior fill (Slot 1)
    renderer.drawSpriteHex('container_fill_spr', 0, bx, by, previewPalette.colors[1], 1);

    // 2. Sample board ripple cells (block_spr frame 5)
    const [loR, loG, loB] = parseHexRgb01(previewPalette.colors[2]);
    const [hiR, hiG, hiB] = parseHexRgb01(previewPalette.colors[3]);
    for (let i = 0; i < PREVIEW_RIPPLE_CELLS.length; i++) {
      const cell = PREVIEW_RIPPLE_CELLS[i];
      const wave = 0.5 + 0.5 * Math.sin(this.animTime * 3.2 + cell.phase * Math.PI * 2);
      const { cx, cy } = cellToContainerPixel(cell.x, cell.y);
      const r = loR + (hiR - loR) * wave;
      const g = loG + (hiG - loG) * wave;
      const b = loB + (hiB - loB) * wave;
      renderer.drawSprite('block_spr', 5, bx + cx, by + cy, r, g, b, 0.25 + wave * 0.45);
    }

    // 3. Settled diamond blocks (all 4 shapes: frames 0..3 -> slots 2..5)
    for (let i = 0; i < PREVIEW_SETTLED_BLOCKS.length; i++) {
      const blk = PREVIEW_SETTLED_BLOCKS[i];
      const { cx, cy } = cellToContainerPixel(blk.x, blk.y);
      renderer.drawSpriteHex(
        'block_spr',
        blk.color - 1,
        bx + cx,
        by + cy,
        previewPalette.colors[blk.color + 1],
        1,
      );
    }

    // 4. Ghost preview (frame 4)
    for (let i = 0; i < PREVIEW_GHOST_TETRAD.length; i++) {
      const blk = PREVIEW_GHOST_TETRAD[i];
      const { cx, cy } = cellToContainerPixel(blk.x, blk.y);
      renderer.drawSpriteHex(
        'block_spr',
        4,
        bx + cx,
        by + cy,
        previewPalette.colors[blk.color + 1],
        0.45,
      );
    }

    // 5. Falling 2x2 diamond tetrad
    for (let i = 0; i < PREVIEW_FALLING_TETRAD.length; i++) {
      const blk = PREVIEW_FALLING_TETRAD[i];
      const { cx, cy } = cellToContainerPixel(blk.x, blk.y);
      renderer.drawSpriteHex(
        'block_spr',
        blk.color - 1,
        bx + cx,
        by + cy,
        previewPalette.colors[blk.color + 1],
        1,
      );
    }

    // 6. Crisp 1px container border (Slot 2)
    renderer.drawSpriteHex('container_spr', 0, bx, by, previewPalette.colors[2], 1);

    // 7. Sample HUD text rendered in preview palette's Slot 2 (primary) & Slot 3 (accent)
    const isLight = isLightPaletteBg(previewPalette.colors[0]);
    renderer.drawTextHex('12,400', px + 5, py + 134, previewPalette.colors[2], 1, '3x5', 'left');
    renderer.drawTextHex('x4', px + pw - 5, py + 134, previewPalette.colors[3], 1, '3x5', 'right');
    renderer.drawTextHex(
      isLight ? 'LIGHT DARKEN' : 'DARK BLOOM',
      px + pw * 0.5,
      py + 143,
      previewPalette.colors[2],
      0.88,
      '3x5',
      'center',
    );
  }

  private renderListView(renderer: ColorEditorRenderer, bg: Palette): void {
    this.renderBackBtn(renderer, bg, '< BACK');
    renderer.drawTextHex('COLOR EDITOR', 114, 7, bg.colors[3], 1, '5x7', 'center');
    renderer.drawTextHex(`${this.palettes.length} PALETTES`, 216, 8, bg.colors[2], 0.72, '3x5', 'right');

    // Action buttons: CREATE NEW PALETTE & IMPORT
    const newFocused = this.listIdx === -2;
    drawBox(
      renderer,
      LIST_NEW_BTN_RECT.x,
      LIST_NEW_BTN_RECT.y,
      LIST_NEW_BTN_RECT.w,
      LIST_NEW_BTN_RECT.h,
      bg.colors[1],
      newFocused ? bg.colors[3] : bg.colors[2],
      newFocused ? 0.96 : 0.72,
      newFocused ? 1 : 0.55,
    );
    renderer.drawTextHex(
      '+ CREATE NEW PALETTE',
      LIST_NEW_BTN_RECT.x + LIST_NEW_BTN_RECT.w * 0.5,
      LIST_NEW_BTN_RECT.y + 4,
      newFocused ? bg.colors[3] : bg.colors[2],
      1,
      '3x5',
      'center',
    );

    const impFocused = this.listIdx === -1;
    drawBox(
      renderer,
      LIST_IMPORT_BTN_RECT.x,
      LIST_IMPORT_BTN_RECT.y,
      LIST_IMPORT_BTN_RECT.w,
      LIST_IMPORT_BTN_RECT.h,
      bg.colors[1],
      impFocused ? bg.colors[3] : bg.colors[2],
      impFocused ? 0.96 : 0.72,
      impFocused ? 1 : 0.55,
    );
    renderer.drawTextHex(
      'IMPORT HEX CODE',
      LIST_IMPORT_BTN_RECT.x + LIST_IMPORT_BTN_RECT.w * 0.5,
      LIST_IMPORT_BTN_RECT.y + 4,
      impFocused ? bg.colors[3] : bg.colors[2],
      1,
      '3x5',
      'center',
    );

    // Palette rows
    const maxVisible = 8;
    const visibleEnd = Math.min(this.palettes.length, this.listScrollTop + maxVisible);
    for (let i = this.listScrollTop; i < visibleEnd; i++) {
      const p = this.palettes[i];
      const slot = i - this.listScrollTop;
      const y = 36 + slot * 16;
      const selected = i === this.listIdx;
      const isActive = p.id === this.activeGamePaletteId;

      drawBox(
        renderer,
        8,
        y,
        208,
        14,
        bg.colors[1],
        selected ? bg.colors[3] : bg.colors[2],
        selected ? 0.94 : 0.42,
        selected ? 1 : 0.3,
      );

      if (selected) {
        renderer.drawSpriteHex('arrow_spr', 0, 14, y + 7, bg.colors[3], 1);
      }

      const prefix = isActive ? '*' : '';
      const rawName = `${prefix}${p.name.toUpperCase()}`;
      const label = rawName.length > 22 ? `${rawName.slice(0, 21)}.` : rawName;
      renderer.drawTextHex(
        label,
        20,
        y + 5,
        selected ? bg.colors[3] : bg.colors[2],
        1,
        '3x5',
        'left',
      );

      if (p.isCustom) {
        renderer.drawTextHex('CUSTOM', 150, y + 5, bg.colors[4], 0.9, '3x5', 'right');
      }

      // 6 mini color swatches on right side of row
      for (let c = 0; c < 6; c++) {
        renderer.drawRectHex(156 + c * 9, y + 3, 8, 8, p.colors[c], 1);
      }
    }

    // Scrollbar
    if (this.palettes.length > maxVisible) {
      const trackX = 219;
      const trackY = 36;
      const trackH = maxVisible * 16 - 2;
      renderer.drawRectHex(trackX, trackY, 2, trackH, bg.colors[1], 0.9);
      const thumbH = Math.max(10, Math.round((maxVisible / this.palettes.length) * trackH));
      const maxScroll = Math.max(1, this.palettes.length - maxVisible);
      const thumbY = trackY + Math.round((this.listScrollTop / maxScroll) * (trackH - thumbH));
      renderer.drawRectHex(trackX, thumbY, 2, thumbH, bg.colors[3], 1);
    }

    // Safe Preview of highlighted palette
    const previewPal =
      this.listIdx >= 0 && this.listIdx < this.palettes.length
        ? this.palettes[this.listIdx]
        : this.palettes.find((p) => p.id === this.activeGamePaletteId) ?? this.palettes[0] ?? bg;
    this.renderSafeMiniBoardPreview(renderer, previewPal, bg);

    renderer.drawTextHex(
      'UP/DN: SELECT  ENTER: EDIT  ESC: BACK',
      112,
      169,
      bg.colors[2],
      0.68,
      '3x5',
      'center',
    );
  }

  private renderTemplateView(renderer: ColorEditorRenderer, bg: Palette): void {
    this.renderBackBtn(renderer, bg, '< LIST');
    renderer.drawTextHex('PICK TEMPLATE', 114, 7, bg.colors[3], 1, '5x7', 'center');
    renderer.drawTextHex(
      'FORK ANY PALETTE INTO A NEW CUSTOM THEME',
      112,
      22,
      bg.colors[2],
      0.8,
      '3x5',
      'center',
    );

    const templates = this.getTemplatePalettes();
    const maxVisible = 8;
    const visibleEnd = Math.min(templates.length, this.templateScrollTop + maxVisible);

    for (let i = this.templateScrollTop; i < visibleEnd; i++) {
      const p = templates[i];
      const slot = i - this.templateScrollTop;
      const y = 34 + slot * 16;
      const selected = i === this.templateIdx;
      const isStarter = i < FEATURED_TEMPLATE_IDS.length;

      drawBox(
        renderer,
        8,
        y,
        208,
        14,
        bg.colors[1],
        selected ? bg.colors[3] : bg.colors[2],
        selected ? 0.94 : 0.42,
        selected ? 1 : 0.3,
      );

      if (selected) {
        renderer.drawSpriteHex('arrow_spr', 0, 14, y + 7, bg.colors[3], 1);
      }

      const name = p.name.toUpperCase();
      renderer.drawTextHex(
        name.length > 20 ? `${name.slice(0, 19)}.` : name,
        20,
        y + 5,
        selected ? bg.colors[3] : bg.colors[2],
        1,
        '3x5',
        'left',
      );

      if (isStarter) {
        renderer.drawTextHex('STARTER', 150, y + 5, bg.colors[3], 0.85, '3x5', 'right');
      }

      for (let c = 0; c < 6; c++) {
        renderer.drawRectHex(156 + c * 9, y + 3, 8, 8, p.colors[c], 1);
      }
    }

    if (templates.length > maxVisible) {
      const trackX = 219;
      const trackY = 34;
      const trackH = maxVisible * 16 - 2;
      renderer.drawRectHex(trackX, trackY, 2, trackH, bg.colors[1], 0.9);
      const thumbH = Math.max(10, Math.round((maxVisible / templates.length) * trackH));
      const maxScroll = Math.max(1, templates.length - maxVisible);
      const thumbY = trackY + Math.round((this.templateScrollTop / maxScroll) * (trackH - thumbH));
      renderer.drawRectHex(trackX, thumbY, 2, thumbH, bg.colors[3], 1);
    }

    const previewPal = templates[this.templateIdx] ?? templates[0] ?? bg;
    this.renderSafeMiniBoardPreview(renderer, previewPal, bg);

    renderer.drawTextHex(
      'ENTER / CLICK: FORK AS "MY PALETTE"',
      112,
      169,
      bg.colors[2],
      0.68,
      '3x5',
      'center',
    );
  }

  private renderEditView(renderer: ColorEditorRenderer, bg: Palette): void {
    const zone = EDIT_ZONES[this.editZoneIdx];

    // 1. Header bar: < LIST | Editable Palette Name | Light/Dark Luminance Badge
    this.renderBackBtn(renderer, bg, '< LIST', zone === 'HEADER' && this.headerCol === 0);

    const nameFocused = zone === 'HEADER' && this.headerCol === 1;
    drawBox(
      renderer,
      NAME_PILL_RECT.x,
      NAME_PILL_RECT.y,
      NAME_PILL_RECT.w,
      NAME_PILL_RECT.h,
      bg.colors[1],
      nameFocused ? bg.colors[3] : bg.colors[2],
      0.92,
      nameFocused ? 1 : 0.55,
    );
    const dirtyMark = this.dirty ? '*' : '';
    const displayName = `${this.workingName.toUpperCase()}${dirtyMark}`;
    const trimmedName = displayName.length > 26 ? `${displayName.slice(0, 25)}.` : displayName;
    renderer.drawTextHex(
      trimmedName,
      NAME_PILL_RECT.x + 4,
      NAME_PILL_RECT.y + 3,
      nameFocused ? bg.colors[3] : bg.colors[2],
      1,
      '3x5',
      'left',
    );
    renderer.drawTextHex(
      'EDT',
      NAME_PILL_RECT.x + NAME_PILL_RECT.w - 3,
      NAME_PILL_RECT.y + 3,
      bg.colors[3],
      0.75,
      '3x5',
      'right',
    );

    const light = isLightPaletteBg(this.workingColors[0]);
    drawBox(renderer, 167, 4, 53, 11, bg.colors[1], light ? bg.colors[4] : bg.colors[3], 0.9, 0.85);
    renderer.drawTextHex(
      light ? 'LIGHT DARKEN' : 'DARK BLOOM',
      193,
      7,
      light ? bg.colors[4] : bg.colors[3],
      1,
      '3x5',
      'center',
    );

    // 2. Six Interactive Color Swatches (0:BG .. 5:TGT)
    for (let s = 0; s < 6; s++) {
      const rect = this.getSwatchRect(s);
      const isSelected = s === this.selectedSlot;
      const isSwapSource = s === this.swapSourceSlot;
      const swatchFocused = zone === 'SWATCHES' && isSelected;

      const borderColor = isSwapSource
        ? bg.colors[5]
        : swatchFocused || isSelected
          ? bg.colors[3]
          : bg.colors[2];
      drawBox(
        renderer,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        bg.colors[1],
        borderColor,
        isSelected ? 0.96 : 0.65,
        isSelected || isSwapSource ? 1 : 0.45,
      );

      renderer.drawTextHex(
        SLOT_SHORT_LABELS[s],
        rect.x + rect.w * 0.5,
        rect.y + 2,
        isSwapSource ? bg.colors[5] : isSelected ? bg.colors[3] : bg.colors[2],
        1,
        '3x5',
        'center',
      );

      // Actual swatch color chip
      renderer.drawRectHex(rect.x + 3, rect.y + 9, rect.w - 6, 16, this.workingColors[s], 1);

      // Mini 6x6 diamond icon overlay on block slots 2..5
      if (s >= 2) {
        renderer.drawSpriteHex(
          'block_spr',
          s - 2,
          rect.x + rect.w * 0.5,
          rect.y + 17,
          this.workingColors[0],
          0.85,
        );
      }

      // Hex value underneath
      renderer.drawTextHex(
        this.workingColors[s].toUpperCase(),
        rect.x + rect.w * 0.5,
        rect.y + 28,
        bg.colors[2],
        isSelected ? 1 : 0.78,
        '3x5',
        'center',
      );
    }

    // 3. Slider Mode Tabs (HSV / RGB) + Status / Clipboard Swatch
    const modeFocused = zone === 'SLIDER_MODE';
    const hsvActive = this.sliderMode === 'HSV';
    drawBox(
      renderer,
      HSV_TAB_RECT.x,
      HSV_TAB_RECT.y,
      HSV_TAB_RECT.w,
      HSV_TAB_RECT.h,
      bg.colors[1],
      hsvActive ? bg.colors[3] : bg.colors[2],
      hsvActive ? 0.96 : 0.45,
      hsvActive || modeFocused ? 1 : 0.4,
    );
    renderer.drawTextHex(
      'HSV',
      HSV_TAB_RECT.x + HSV_TAB_RECT.w * 0.5,
      HSV_TAB_RECT.y + 3,
      hsvActive ? bg.colors[3] : bg.colors[2],
      1,
      '3x5',
      'center',
    );

    const rgbActive = this.sliderMode === 'RGB';
    drawBox(
      renderer,
      RGB_TAB_RECT.x,
      RGB_TAB_RECT.y,
      RGB_TAB_RECT.w,
      RGB_TAB_RECT.h,
      bg.colors[1],
      rgbActive ? bg.colors[3] : bg.colors[2],
      rgbActive ? 0.96 : 0.45,
      rgbActive || modeFocused ? 1 : 0.4,
    );
    renderer.drawTextHex(
      'RGB',
      RGB_TAB_RECT.x + RGB_TAB_RECT.w * 0.5,
      RGB_TAB_RECT.y + 3,
      rgbActive ? bg.colors[3] : bg.colors[2],
      1,
      '3x5',
      'center',
    );

    if (this.swapSourceSlot !== null) {
      renderer.drawTextHex(
        `SWAP MODE: PICK SLOT FOR ${SLOT_SHORT_LABELS[this.swapSourceSlot]}`,
        73,
        63,
        bg.colors[5],
        1,
        '3x5',
        'left',
      );
    } else {
      const slotInfo = `${SLOT_SHORT_LABELS[this.selectedSlot]}  ${this.workingColors[this.selectedSlot].toUpperCase()}`;
      renderer.drawTextHex(slotInfo, 74, 63, bg.colors[2], 0.92, '3x5', 'left');
    }

    if (this.copiedHex) {
      renderer.drawTextHex('CLIP', 180, 63, bg.colors[2], 0.72, '3x5', 'right');
      drawBox(renderer, 184, 61, 34, 9, this.copiedHex, bg.colors[2], 1, 0.8);
    }

    // 4. Three Crisp Pixel Sliders (HUE/SAT/VAL or R/G/B)
    this.renderSliders(renderer, bg, zone);

    // 5. Bottom Action Bar (2 rows x 5 crisp buttons)
    this.renderActionRow(renderer, bg, ACTION_ROW_1, zone === 'ACTIONS_1', this.actionRow1Idx);
    this.renderActionRow(renderer, bg, ACTION_ROW_2, zone === 'ACTIONS_2', this.actionRow2Idx);

    // 6. Right Safe Preview Panel (Live 68x128 Mini-Board)
    this.renderSafeMiniBoardPreview(renderer, this.getWorkingPalette(), bg);

    // Subtle navigation legend
    renderer.drawTextHex(
      'ARROWS / MOUSE DRAG TO TUNE   ESC: BACK',
      112,
      164,
      bg.colors[2],
      0.62,
      '3x5',
      'center',
    );
  }

  private renderSliders(renderer: ColorEditorRenderer, bg: Palette, zone: EditFocusZone): void {
    const rgb = hexToRgb255(this.workingColors[this.selectedSlot]);
    const hsv = this.cachedHsv;

    const defs =
      this.sliderMode === 'HSV'
        ? [
            { label: 'HUE', ratio: hsv.h / 360, valueText: `${Math.round(hsv.h)}D` },
            { label: 'SAT', ratio: hsv.s / 100, valueText: `${Math.round(hsv.s)}%` },
            { label: 'VAL', ratio: hsv.v / 100, valueText: `${Math.round(hsv.v)}%` },
          ]
        : [
            { label: 'R', ratio: rgb.r / 255, valueText: String(rgb.r) },
            { label: 'G', ratio: rgb.g / 255, valueText: String(rgb.g) },
            { label: 'B', ratio: rgb.b / 255, valueText: String(rgb.b) },
          ];

    const trackX = 34;
    const trackW = 150;
    const segments = 15;
    const segW = trackW / segments; // 10px crisp pixel blocks

    for (let i = 0; i < 3; i++) {
      const y = 75 + i * 17;
      const focused =
        (i === 0 && zone === 'SLIDER_0') ||
        (i === 1 && zone === 'SLIDER_1') ||
        (i === 2 && zone === 'SLIDER_2');

      drawBox(
        renderer,
        6,
        y,
        212,
        14,
        bg.colors[1],
        focused ? bg.colors[3] : bg.colors[2],
        focused ? 0.9 : 0.45,
        focused ? 1 : 0.3,
      );

      renderer.drawTextHex(
        defs[i].label,
        10,
        y + 5,
        focused ? bg.colors[3] : bg.colors[2],
        1,
        '3x5',
        'left',
      );

      // Segmented crisp pixel color ramp preview along the track
      for (let seg = 0; seg < segments; seg++) {
        const sample = (seg + 0.5) / segments;
        let segHex: string;
        if (this.sliderMode === 'HSV') {
          if (i === 0) {
            const c = hsvToRgb(sample * 360, Math.max(40, hsv.s), Math.max(40, hsv.v));
            segHex = rgb255ToHex(c.r, c.g, c.b);
          } else if (i === 1) {
            const c = hsvToRgb(hsv.h, sample * 100, Math.max(30, hsv.v));
            segHex = rgb255ToHex(c.r, c.g, c.b);
          } else {
            const c = hsvToRgb(hsv.h, hsv.s, sample * 100);
            segHex = rgb255ToHex(c.r, c.g, c.b);
          }
        } else {
          if (i === 0) segHex = rgb255ToHex(sample * 255, rgb.g, rgb.b);
          else if (i === 1) segHex = rgb255ToHex(rgb.r, sample * 255, rgb.b);
          else segHex = rgb255ToHex(rgb.r, rgb.g, sample * 255);
        }
        renderer.drawRectHex(trackX + seg * segW, y + 4, segW, 6, segHex, 1);
      }

      // Track border + crisp pixel thumb
      drawBox(renderer, trackX - 1, y + 3, trackW + 2, 8, bg.colors[0], bg.colors[2], 0, 0.7);
      const thumbX = trackX + Math.round(clamp(defs[i].ratio, 0, 1) * (trackW - 1));
      renderer.drawRectHex(thumbX - 2, y + 2, 5, 10, bg.colors[0], 1);
      renderer.drawRectHex(thumbX - 1, y + 3, 3, 8, focused ? bg.colors[3] : bg.colors[2], 1);

      renderer.drawTextHex(
        defs[i].valueText,
        214,
        y + 5,
        focused ? bg.colors[3] : bg.colors[2],
        1,
        '3x5',
        'right',
      );
    }
  }

  private renderActionRow(
    renderer: ColorEditorRenderer,
    bg: Palette,
    buttons: readonly ActionButtonDef[],
    rowFocused: boolean,
    focusedIdx: number,
  ): void {
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const selected = rowFocused && i === focusedIdx;
      const isDisabled =
        (btn.id === 'DELETE' && (!this.workingIsCustom || !this.workingId)) ||
        (btn.id === 'PASTE' && !this.copiedHex);
      const isSwapActive = btn.id === 'SWAP' && this.swapSourceSlot !== null;

      const borderHex = isSwapActive
        ? bg.colors[5]
        : selected
          ? bg.colors[3]
          : bg.colors[2];
      const textHex = isSwapActive
        ? bg.colors[5]
        : selected
          ? bg.colors[3]
          : bg.colors[2];

      drawBox(
        renderer,
        btn.rect.x,
        btn.rect.y,
        btn.rect.w,
        btn.rect.h,
        bg.colors[1],
        borderHex,
        selected || isSwapActive ? 0.96 : 0.65,
        isDisabled ? 0.25 : selected || isSwapActive ? 1 : 0.55,
      );
      renderer.drawTextHex(
        btn.label,
        btn.rect.x + btn.rect.w * 0.5,
        btn.rect.y + 4,
        textHex,
        isDisabled ? 0.4 : 1,
        '3x5',
        'center',
      );
    }
  }

  private renderModal(renderer: ColorEditorRenderer, bg: Palette): void {
    renderer.drawRectHex(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, bg.colors[0], 0.78);

    if (this.modal === 'NAME') {
      drawBox(renderer, 30, 18, 260, 134, bg.colors[1], bg.colors[3], 0.98, 1);
      renderer.drawTextHex('RENAME PALETTE', 160, 26, bg.colors[3], 1, '5x7', 'center');

      // Live text field box
      drawBox(renderer, 42, 40, 236, 18, bg.colors[0], bg.colors[3], 1, 1);
      const blink = Math.floor(this.animTime * 2.5) % 2 === 0 ? '_' : '';
      renderer.drawTextHex(
        `${this.nameBuffer.toUpperCase()}${blink}`,
        48,
        46,
        bg.colors[2],
        1,
        '5x7',
        'left',
      );
      renderer.drawTextHex(
        `${this.nameBuffer.length}/${MAX_PALETTE_NAME_LEN}`,
        274,
        47,
        bg.colors[2],
        0.65,
        '3x5',
        'right',
      );

      // Crisp pixel on-screen keyboard
      for (let r = 0; r < OSK_ROWS.length; r++) {
        const row = OSK_ROWS[r];
        for (let c = 0; c < row.length; c++) {
          const key = row[c];
          const rect = this.getOskKeyRect(r, c);
          const focused = r === this.oskRow && c === this.oskCol;
          drawBox(
            renderer,
            rect.x,
            rect.y,
            rect.w,
            rect.h,
            bg.colors[0],
            focused ? bg.colors[3] : bg.colors[2],
            focused ? 1 : 0.65,
            focused ? 1 : 0.45,
          );
          renderer.drawTextHex(
            key,
            rect.x + rect.w * 0.5,
            rect.y + 4,
            focused ? bg.colors[3] : bg.colors[2],
            1,
            '3x5',
            'center',
          );
        }
      }
      return;
    }

    if (this.modal === 'DELETE_CONFIRM') {
      drawBox(renderer, 58, 52, 204, 74, bg.colors[1], bg.colors[5], 0.98, 1);
      renderer.drawTextHex('DELETE PALETTE?', 160, 62, bg.colors[5], 1, '5x7', 'center');
      renderer.drawTextHex(
        `"${this.workingName.toUpperCase()}"`,
        160,
        76,
        bg.colors[2],
        1,
        '3x5',
        'center',
      );
      renderer.drawTextHex('THIS CANNOT BE UNDONE', 160, 86, bg.colors[2], 0.72, '3x5', 'center');

      const btns: { label: string; rect: HitRect; danger: boolean }[] = [
        { label: 'DELETE', rect: { x: 84, y: 102, w: 68, h: 14 }, danger: true },
        { label: 'CANCEL', rect: { x: 168, y: 102, w: 68, h: 14 }, danger: false },
      ];
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        const sel = i === this.modalBtnIdx;
        const accent = b.danger ? bg.colors[5] : bg.colors[3];
        drawBox(renderer, b.rect.x, b.rect.y, b.rect.w, b.rect.h, bg.colors[0], sel ? accent : bg.colors[2], 0.95, sel ? 1 : 0.45);
        renderer.drawTextHex(b.label, b.rect.x + b.rect.w * 0.5, b.rect.y + 4, sel ? accent : bg.colors[2], 1, '3x5', 'center');
      }
      return;
    }

    if (this.modal === 'UNSAVED_CONFIRM') {
      drawBox(renderer, 46, 52, 228, 74, bg.colors[1], bg.colors[3], 0.98, 1);
      renderer.drawTextHex('UNSAVED CHANGES', 160, 62, bg.colors[3], 1, '5x7', 'center');
      renderer.drawTextHex(
        'SAVE EDITS BEFORE LEAVING?',
        160,
        78,
        bg.colors[2],
        0.9,
        '3x5',
        'center',
      );

      const btns: { label: string; rect: HitRect }[] = [
        { label: 'SAVE', rect: { x: 56, y: 102, w: 66, h: 14 } },
        { label: 'DISCARD', rect: { x: 127, y: 102, w: 66, h: 14 } },
        { label: 'CANCEL', rect: { x: 198, y: 102, w: 66, h: 14 } },
      ];
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        const sel = i === this.modalBtnIdx;
        const accent = i === 1 ? bg.colors[5] : bg.colors[3];
        drawBox(renderer, b.rect.x, b.rect.y, b.rect.w, b.rect.h, bg.colors[0], sel ? accent : bg.colors[2], 0.95, sel ? 1 : 0.45);
        renderer.drawTextHex(b.label, b.rect.x + b.rect.w * 0.5, b.rect.y + 4, sel ? accent : bg.colors[2], 1, '3x5', 'center');
      }
    }
  }
}

function callbacksDeleteSafe(id: string, cb: ColorEditorCallbacks): boolean {
  try {
    return cb.onDeletePalette(id);
  } catch {
    return false;
  }
}
