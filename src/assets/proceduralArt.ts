import {
  ALL_TRACK_IDS,
  CONTAINER_HEIGHT,
  CONTAINER_WIDTH,
  type SpriteAssetEntry,
  type SpriteFrameRect,
  type TrackId,
} from '../contracts/index.js';
import {
  bakeFontsIntoAtlas,
  type BakedFontAtlas,
  type BitmapFontId,
} from './bitmapFont.js';

export const BUILTIN_ATLAS_WIDTH = 512;
export const BUILTIN_ATLAS_HEIGHT = 512;
export const TRACK_COVER_SIZE = 96;

export interface BuiltinAtlasResult {
  width: number;
  height: number;
  pixels: Uint8Array;
  sprites: Record<string, SpriteAssetEntry>;
  fonts: Record<BitmapFontId, BakedFontAtlas>;
}

/** Helper canvas for pure Uint8Array monochrome pixel drawing (zero DOM). */
class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number, height: number, pixels?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.pixels = pixels ?? new Uint8Array(width * height * 4);
  }

  setWhite(x: number, y: number, alpha = 255): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) {
      return;
    }
    const idx = (iy * this.width + ix) * 4;
    this.pixels[idx] = 255;
    this.pixels[idx + 1] = 255;
    this.pixels[idx + 2] = 255;
    this.pixels[idx + 3] = alpha;
  }

  clearPixel(x: number, y: number): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) {
      return;
    }
    const idx = (iy * this.width + ix) * 4;
    this.pixels[idx] = 0;
    this.pixels[idx + 1] = 0;
    this.pixels[idx + 2] = 0;
    this.pixels[idx + 3] = 0;
  }

  fillRect(x: number, y: number, w: number, h: number, alpha = 255): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.setWhite(x + dx, y + dy, alpha);
      }
    }
  }

  drawPattern(ox: number, oy: number, rows: readonly string[]): void {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '#' || ch === 'X' || ch === '1') {
          this.setWhite(ox + x, oy + y, 255);
        }
      }
    }
  }
}

class ShelfPacker {
  private cursorX = 2;
  private cursorY = 2;
  private rowHeight = 0;
  private readonly pad = 2;

  constructor(
    private readonly atlasWidth: number,
    private readonly atlasHeight: number,
  ) {}

  alloc(w: number, h: number): SpriteFrameRect {
    if (this.cursorX + w + this.pad > this.atlasWidth) {
      this.cursorX = this.pad;
      this.cursorY += this.rowHeight + this.pad;
      this.rowHeight = 0;
    }
    if (this.cursorY + h + this.pad > this.atlasHeight) {
      throw new Error(`Built-in atlas overflow allocating ${w}x${h}`);
    }
    const rect: SpriteFrameRect = {
      x: this.cursorX,
      y: this.cursorY,
      w,
      h,
      targetX: 0,
      targetY: 0,
      targetW: w,
      targetH: h,
      boundW: w,
      boundH: h,
    };
    this.cursorX += w + this.pad;
    if (h > this.rowHeight) {
      this.rowHeight = h;
    }
    return rect;
  }

  getNextRowY(): number {
    return this.cursorY + this.rowHeight + this.pad * 2;
  }
}

/**
 * Exact 6x6 monochrome pixel-diamond block frames:
 * - Frame 0 (Empty Block, color 1): 12px hollow 1px diamond outline
 * - Frame 1 (Filled Block, color 2): 24px completely solid diamond
 * - Frame 2 (Hole Block, color 3): 20px chunky diamond ring with 2x2 center cutout
 * - Frame 3 (Target Block, color 4): 16px diamond outline with 2x2 bullseye dot
 * - Frame 4 (Guide/Ghost): 8px corner-dotted outline for Drop Preview
 * - Frame 5 (Automata): 12px inner 4x4 diamond for board ripple glow
 */
const BLOCK_FRAMES_6X6: readonly (readonly string[])[] = [
  // Frame 0: Empty Block (12 px)
  ['..##..', '.#..#.', '#....#', '#....#', '.#..#.', '..##..'],
  // Frame 1: Filled Block (24 px)
  ['..##..', '.####.', '######', '######', '.####.', '..##..'],
  // Frame 2: Hole Block (20 px — 2x2 center cutout at (2,2)-(3,3))
  ['..##..', '.####.', '##..##', '##..##', '.####.', '..##..'],
  // Frame 3: Target Block (16 px — outline + 2x2 center bullseye)
  ['..##..', '.#..#.', '#.##.#', '#.##.#', '.#..#.', '..##..'],
  // Frame 4: Guide/Ghost Drop Preview (8 px — crisp corner dots)
  ['..##..', '......', '#....#', '#....#', '......', '..##..'],
  // Frame 5: Automata Cell Ripple (12 px — soft inner 4x4 diamond)
  ['......', '..##..', '.####.', '.####.', '..##..', '......'],
];

/**
 * 6 crisp 16x16 pixel mode icons matching GAME_MODE_ORDER:
 * [0] marathon, [1] endless, [2] intense, [3] relaxed, [4] rush, [5] impossible
 */
const MODE_ICONS_16X16: readonly (readonly string[])[] = [
  // 0: Marathon — milestone flag + diamond base
  [
    '.......##.......',
    '......####......',
    '.....##..##.....',
    '....##.##.##....',
    '...##..##..##...',
    '..##...##...##..',
    '.##..######..##.',
    '##.....##.....##',
    '##.....##.....##',
    '.##....##....##.',
    '..##........##..',
    '...##......##...',
    '....##.##.##....',
    '.....######.....',
    '......####......',
    '.......##.......',
  ],
  // 1: Endless — crisp pixel infinity loop
  [
    '................',
    '................',
    '................',
    '..####....####..',
    '.##..##..##..##.',
    '##....####....##',
    '##.....##.....##',
    '##.....##.....##',
    '##.....##.....##',
    '##....####....##',
    '.##..##..##..##.',
    '..####....####..',
    '................',
    '................',
    '................',
    '................',
  ],
  // 2: Intense — triple high-energy upward chevrons
  [
    '.......##.......',
    '......####......',
    '.....##..##.....',
    '....##....##....',
    '...##..##..##...',
    '..##..####..##..',
    '.....##..##.....',
    '....##....##....',
    '...##..##..##...',
    '..##..####..##..',
    '.##..##..##..##.',
    '....##....##....',
    '...##......##...',
    '..##........##..',
    '.##..........##.',
    '................',
  ],
  // 3: Relaxed — serene centered diamond + gentle ripple waves
  [
    '.......##.......',
    '......#..#......',
    '.....#....#.....',
    '....#..##..#....',
    '...#..#..#..#...',
    '....#..##..#....',
    '.....#....#.....',
    '......#..#......',
    '.......##.......',
    '................',
    '.###....###.....',
    '....####...####.',
    '................',
    '..###....###....',
    '.....####...###.',
    '................',
  ],
  // 4: Rush — crisp pixel hourglass
  [
    '..############..',
    '..############..',
    '...##......##...',
    '...##.####.##...',
    '....##.##.##....',
    '.....##..##.....',
    '......####......',
    '.......##.......',
    '.......##.......',
    '......####......',
    '.....##..##.....',
    '....##.##.##....',
    '...##.####.##...',
    '...##########...',
    '..############..',
    '..############..',
  ],
  // 5: Impossible — jagged warning diamond + exclamation core
  [
    '.......##.......',
    '......####......',
    '.....##..##.....',
    '....##.##.##....',
    '...##..##..##...',
    '..##...##...##..',
    '.##....##....##.',
    '##.....##.....##',
    '##.....##.....##',
    '.##..........##.',
    '..##...##...##..',
    '...##..##..##...',
    '....##....##....',
    '.....##..##.....',
    '......####......',
    '.......##.......',
  ],
];

/**
 * 5 crisp 16x16 tutorial icons:
 * [0] Move, [1] Spin, [2] Drop, [3] Match 3/4, [4] Advanced Clear
 */
const TUTORIAL_ICONS_16X16: readonly (readonly string[])[] = [
  // 0: Move — left/right arrows flanking a diamond
  [
    '................',
    '................',
    '................',
    '.......##.......',
    '..#...####...#..',
    '.##..##..##..##.',
    '####.##..##.####',
    '####.##..##.####',
    '.##..##..##..##.',
    '..#...####...#..',
    '.......##.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  // 1: Spin — circular rotation arrows around 2x2 diamond
  [
    '.....######.....',
    '...###....###...',
    '..##........##..',
    '.##....##....###',
    '.#....####...##.',
    '.....##..##.....',
    '....##.##.##....',
    '....##.##.##....',
    '.....##..##.....',
    '.##...####....#.',
    '###....##....##.',
    '..##........##..',
    '...###....###...',
    '.....######.....',
    '................',
    '................',
  ],
  // 2: Drop — downward hard-drop arrow + ground bar
  [
    '.......##.......',
    '......####......',
    '.......##.......',
    '......####......',
    '......####......',
    '......####......',
    '....########....',
    '.....######.....',
    '......####......',
    '.......##.......',
    '................',
    '................',
    '.##############.',
    '.##############.',
    '................',
    '................',
  ],
  // 3: Match 3/4 — diagonal triple diamonds highlighted
  [
    '..##............',
    '.####...........',
    '######..........',
    '.####...........',
    '..##...##.......',
    '......####......',
    '.....######.....',
    '......####......',
    '.......##...##..',
    '...........####.',
    '..........######',
    '...........####.',
    '............##..',
    '................',
    '................',
    '................',
  ],
  // 4: Advanced clear — glowing cascade chain burst
  [
    '.......##.......',
    '......#..#......',
    '.......##.......',
    '...##......##...',
    '..####....####..',
    '...##..##..##...',
    '......####......',
    '.....######.....',
    '......####......',
    '...##..##..##...',
    '..####....####..',
    '...##......##...',
    '.......##.......',
    '......#..#......',
    '.......##.......',
    '................',
  ],
];

const ARROW_FRAMES_7X7: readonly (readonly string[])[] = [
  // 0: Right
  ['..#....', '..##...', '..###..', '..####.', '..###..', '..##...', '..#....'],
  // 1: Left
  ['....#..', '...##..', '..###..', '.####..', '..###..', '...##..', '....#..'],
  // 2: Up
  ['.......', '...#...', '..###..', '.#####.', '#######', '.......', '.......'],
  // 3: Down
  ['.......', '.......', '#######', '.#####.', '..###..', '...#...', '.......'],
];

const CHECKMARK_FRAMES_9X9: readonly (readonly string[])[] = [
  // 0: Crisp checkmark
  [
    '.........',
    '.......#.',
    '......##.',
    '.....##..',
    '.#..##...',
    '.####....',
    '..##.....',
    '.........',
    '.........',
  ],
  // 1: Empty crisp checkbox
  [
    '#########',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#########',
  ],
];

const LOCK_FRAMES_10X12: readonly (readonly string[])[] = [
  // 0: Locked padlock
  [
    '...####...',
    '..##..##..',
    '..#....#..',
    '..#....#..',
    '..#....#..',
    '.########.',
    '.########.',
    '.###..###.',
    '.###..###.',
    '.####.###.',
    '.########.',
    '.########.',
  ],
  // 1: Unlocked padlock
  [
    '...####...',
    '..##..##..',
    '..#....#..',
    '.......#..',
    '.......#..',
    '.########.',
    '.########.',
    '.###..###.',
    '.###..###.',
    '.####.###.',
    '.########.',
    '.########.',
  ],
];

/**
 * Compute horizontal span [leftX, rightX] of the 68x128 diamond-hexagon container border at row y (0..127).
 * - y = 0: top HUD hairline (x = 0..34) with roof apex at x = 33..34
 * - y = 1..33: 45-degree roof widening from (32, 35) to (0, 67)
 * - y = 33..94: vertical walls at x = 0 and x = 67
 * - y = 95..127: 45-degree V-funnel narrowing back to apex (33, 34)
 */
export function getContainerRowBounds(y: number): { left: number; right: number } {
  if (y <= 0) {
    return { left: 33, right: 34 };
  }
  if (y <= 33) {
    return { left: 33 - y, right: 34 + y };
  }
  if (y <= 94) {
    return { left: 0, right: CONTAINER_WIDTH - 1 };
  }
  const d = y - 94; // 1..33 for y = 95..127
  return { left: d, right: CONTAINER_WIDTH - 1 - d };
}

function drawContainerFrame(canvas: PixelCanvas, ox: number, oy: number): void {
  // Top HUD hairline y = 0, x = 0..34 (includes roof apex x = 33..34)
  for (let x = 0; x <= 34; x++) {
    canvas.setWhite(ox + x, oy);
  }
  // 45-degree roof y = 1..33, vertical walls y = 33..94, bottom V-funnel y = 95..127
  for (let y = 1; y < CONTAINER_HEIGHT; y++) {
    const { left, right } = getContainerRowBounds(y);
    canvas.setWhite(ox + left, oy + y);
    canvas.setWhite(ox + right, oy + y);
  }
}

function drawContainerFill(canvas: PixelCanvas, ox: number, oy: number): void {
  for (let y = 1; y < CONTAINER_HEIGHT - 1; y++) {
    const { left, right } = getContainerRowBounds(y);
    for (let x = left + 1; x <= right - 1; x++) {
      canvas.setWhite(ox + x, oy + y);
    }
  }
}

function drawBgDiamond32(canvas: PixelCanvas, ox: number, oy: number, doubleRing: boolean): void {
  for (let y = 0; y < 32; y++) {
    const d = y < 16 ? y : 31 - y;
    const lx = 15 - d;
    const rx = 16 + d;
    canvas.setWhite(ox + lx, oy + y);
    canvas.setWhite(ox + rx, oy + y);
    if (doubleRing && d >= 3) {
      const ilx = 15 - (d - 3);
      const irx = 16 + (d - 3);
      canvas.setWhite(ox + ilx, oy + y);
      canvas.setWhite(ox + irx, oy + y);
    }
  }
}

function drawLogoDiamond24(canvas: PixelCanvas, ox: number, oy: number): void {
  for (let y = 0; y < 24; y++) {
    const d = y < 12 ? y : 23 - y;
    const lx = 11 - d;
    const rx = 12 + d;
    canvas.setWhite(ox + lx, oy + y);
    canvas.setWhite(ox + rx, oy + y);
    if (d >= 4) {
      const ilx = 11 - (d - 4);
      const irx = 12 + (d - 4);
      canvas.setWhite(ox + ilx, oy + y);
      canvas.setWhite(ox + irx, oy + y);
    }
    if (d >= 9) {
      for (let x = 11 - (d - 9); x <= 12 + (d - 9); x++) {
        canvas.setWhite(ox + x, oy + y);
      }
    }
  }
}

/**
 * Generates the complete Built-In Krunked RGBA pixel atlas (512x512, pure Uint8Array, zero DOM)
 * containing all crisp pixel-diamond sprites AND baked 5x7 & 3x5 bitmap fonts.
 */
export function generateBuiltinAtlas(): BuiltinAtlasResult {
  const canvas = new PixelCanvas(BUILTIN_ATLAS_WIDTH, BUILTIN_ATLAS_HEIGHT);
  const packer = new ShelfPacker(BUILTIN_ATLAS_WIDTH, BUILTIN_ATLAS_HEIGHT);
  const sprites: Record<string, SpriteAssetEntry> = {};

  // 1. pixel_spr (2x2 solid white square)
  {
    const rect = packer.alloc(2, 2);
    canvas.fillRect(rect.x, rect.y, 2, 2);
    sprites['pixel_spr'] = {
      name: 'pixel_spr',
      width: 2,
      height: 2,
      originX: 0,
      originY: 0,
      frames: [rect],
    };
  }

  // 2. block_spr (6 frames, each crisp 6x6 monochrome diamond, centered at origin 3,3)
  {
    const frames: SpriteFrameRect[] = [];
    for (let i = 0; i < BLOCK_FRAMES_6X6.length; i++) {
      const rect = packer.alloc(6, 6);
      canvas.drawPattern(rect.x, rect.y, BLOCK_FRAMES_6X6[i]);
      frames.push(rect);
    }
    sprites['block_spr'] = {
      name: 'block_spr',
      width: 6,
      height: 6,
      originX: 3,
      originY: 3,
      frames,
    };
  }

  // 3. arrow_spr (4 frames, 7x7)
  {
    const frames: SpriteFrameRect[] = [];
    for (let i = 0; i < ARROW_FRAMES_7X7.length; i++) {
      const rect = packer.alloc(7, 7);
      canvas.drawPattern(rect.x, rect.y, ARROW_FRAMES_7X7[i]);
      frames.push(rect);
    }
    sprites['arrow_spr'] = {
      name: 'arrow_spr',
      width: 7,
      height: 7,
      originX: 3,
      originY: 3,
      frames,
    };
  }

  // 4. checkmark_spr (2 frames, 9x9)
  {
    const frames: SpriteFrameRect[] = [];
    for (let i = 0; i < CHECKMARK_FRAMES_9X9.length; i++) {
      const rect = packer.alloc(9, 9);
      canvas.drawPattern(rect.x, rect.y, CHECKMARK_FRAMES_9X9[i]);
      frames.push(rect);
    }
    sprites['checkmark_spr'] = {
      name: 'checkmark_spr',
      width: 9,
      height: 9,
      originX: 4,
      originY: 4,
      frames,
    };
  }

  // 5. lock_spr (2 frames, 10x12)
  {
    const frames: SpriteFrameRect[] = [];
    for (let i = 0; i < LOCK_FRAMES_10X12.length; i++) {
      const rect = packer.alloc(10, 12);
      canvas.drawPattern(rect.x, rect.y, LOCK_FRAMES_10X12[i]);
      frames.push(rect);
    }
    sprites['lock_spr'] = {
      name: 'lock_spr',
      width: 10,
      height: 12,
      originX: 5,
      originY: 6,
      frames,
    };
  }

  // 6. mode_icon_spr (6 frames, 16x16)
  {
    const frames: SpriteFrameRect[] = [];
    for (let i = 0; i < MODE_ICONS_16X16.length; i++) {
      const rect = packer.alloc(16, 16);
      canvas.drawPattern(rect.x, rect.y, MODE_ICONS_16X16[i]);
      frames.push(rect);
    }
    sprites['mode_icon_spr'] = {
      name: 'mode_icon_spr',
      width: 16,
      height: 16,
      originX: 8,
      originY: 8,
      frames,
    };
  }

  // 7. tutorial_icons (5 frames, 16x16)
  {
    const frames: SpriteFrameRect[] = [];
    for (let i = 0; i < TUTORIAL_ICONS_16X16.length; i++) {
      const rect = packer.alloc(16, 16);
      canvas.drawPattern(rect.x, rect.y, TUTORIAL_ICONS_16X16[i]);
      frames.push(rect);
    }
    sprites['tutorial_icons'] = {
      name: 'tutorial_icons',
      width: 16,
      height: 16,
      originX: 8,
      originY: 8,
      frames,
    };
  }

  // 8. logo_diamond_spr (1 frame, 24x24)
  {
    const rect = packer.alloc(24, 24);
    drawLogoDiamond24(canvas, rect.x, rect.y);
    sprites['logo_diamond_spr'] = {
      name: 'logo_diamond_spr',
      width: 24,
      height: 24,
      originX: 12,
      originY: 12,
      frames: [rect],
    };
  }

  // 9. bg_diamond_spr (2 frames, 32x32 crisp 1px diamond outlines)
  {
    const rectSingle = packer.alloc(32, 32);
    drawBgDiamond32(canvas, rectSingle.x, rectSingle.y, false);
    const rectDouble = packer.alloc(32, 32);
    drawBgDiamond32(canvas, rectDouble.x, rectDouble.y, true);
    sprites['bg_diamond_spr'] = {
      name: 'bg_diamond_spr',
      width: 32,
      height: 32,
      originX: 16,
      originY: 16,
      frames: [rectSingle, rectDouble],
    };
  }

  // 10. container_spr (68x128 crisp 1px diamond-hexagon frame)
  {
    const rect = packer.alloc(CONTAINER_WIDTH, CONTAINER_HEIGHT);
    drawContainerFrame(canvas, rect.x, rect.y);
    sprites['container_spr'] = {
      name: 'container_spr',
      width: CONTAINER_WIDTH,
      height: CONTAINER_HEIGHT,
      originX: 0,
      originY: 0,
      frames: [rect],
    };
  }

  // 11. container_fill_spr (68x128 solid interior mask for Slot 1 board fill)
  {
    const rect = packer.alloc(CONTAINER_WIDTH, CONTAINER_HEIGHT);
    drawContainerFill(canvas, rect.x, rect.y);
    sprites['container_fill_spr'] = {
      name: 'container_fill_spr',
      width: CONTAINER_WIDTH,
      height: CONTAINER_HEIGHT,
      originX: 0,
      originY: 0,
      frames: [rect],
    };
  }

  // 12. Bake crisp 5x7 & 3x5 ASCII bitmap fonts into the lower shelf of the same atlas
  const { fonts } = bakeFontsIntoAtlas(
    canvas.pixels,
    BUILTIN_ATLAS_WIDTH,
    BUILTIN_ATLAS_HEIGHT,
    packer.getNextRowY(),
  );

  return {
    width: BUILTIN_ATLAS_WIDTH,
    height: BUILTIN_ATLAS_HEIGHT,
    pixels: canvas.pixels,
    sprites,
    fonts,
  };
}

// ============================================================================
// 96x96 MONOCHROME PIXEL-ART ALBUM COVERS (rendered via color_threshold_shd)
// ============================================================================

const BAYER_4X4: readonly number[] = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

function setCoverPixel(buf: Uint8Array, x: number, y: number, lit: boolean): void {
  const idx = (y * TRACK_COVER_SIZE + x) * 4;
  const v = lit ? 255 : 0;
  buf[idx] = v;
  buf[idx + 1] = v;
  buf[idx + 2] = v;
  buf[idx + 3] = 255;
}

/**
 * Generates a crisp 96x96 RGBA monochrome (0 or 255) pixel-art album cover for any of the 8 tracks,
 * designed to be colorized cleanly via the `color_threshold` shader (`intensity > 0.5 ? u_col2 : u_col1`).
 */
export function generateTrackCoverPixels(trackId: TrackId): Uint8Array {
  const size = TRACK_COVER_SIZE;
  const buf = new Uint8Array(size * size * 4);
  const cx = 47.5;
  const cy = 47.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let lit = false;
      const dx = x - cx;
      const dy = y - cy;
      const manhattan = Math.abs(dx) + Math.abs(dy);
      const dist = Math.hypot(dx, dy);

      // Clean 2px outer frame on every cover
      const onBorder = x === 1 || x === size - 2 || y === 1 || y === size - 2;
      const outsideFrame = x === 0 || x === size - 1 || y === 0 || y === size - 1;
      if (outsideFrame) {
        setCoverPixel(buf, x, y, false);
        continue;
      }
      if (onBorder) {
        setCoverPixel(buf, x, y, true);
        continue;
      }

      switch (trackId) {
        case 'tessellation': {
          // Interlocking crisp diamond tessellation tiles with alternating hollow/solid/ring patterns
          const cell = 16;
          const u = ((x + y) % cell + cell) % cell;
          const v = ((x - y) % cell + cell) % cell;
          const tileA = Math.floor((x + y) / cell);
          const tileB = Math.floor((x - y) / cell);
          const parity = ((tileA + tileB) % 3 + 3) % 3;
          const edge = u === 0 || v === 0 || u === cell - 1 || v === cell - 1;
          const inner = u >= 5 && u <= 10 && v >= 5 && v <= 10;
          if (parity === 0) {
            lit = edge || inner;
          } else if (parity === 1) {
            lit = edge;
          } else {
            lit = !edge && !inner && (u >= 3 && u <= 12 && v >= 3 && v <= 12);
          }
          break;
        }
        case 'summer_shower': {
          // Diagonal 45-degree rain streaks falling into concentric diamond water ripples
          const rippleCenterY = 66;
          const rippleDist = Math.abs(x - cx) + Math.abs(y - rippleCenterY) * 1.6;
          if (y >= 54) {
            const band = Math.floor(rippleDist) % 10;
            lit = band === 0 || band === 1 || (y === 54 && (x & 3) < 2);
          } else {
            const diag = ((x + y) % 12 + 12) % 12;
            const seg = ((y - x) % 18 + 18) % 18;
            lit = (diag === 0 || diag === 1) && seg < 7;
            // Subtle raindrop diamond highlights
            if (Math.abs(x - 24) + Math.abs(y - 24) <= 4) lit = true;
            if (Math.abs(x - 68) + Math.abs(y - 18) <= 3) lit = true;
            if (Math.abs(x - 48) + Math.abs(y - 38) <= 5) {
              lit = Math.abs(x - 48) + Math.abs(y - 38) >= 3;
            }
          }
          break;
        }
        case 'dissolve': {
          // Concentric stepped diamond waves dissolving via 4x4 Bayer ordered dither
          const wave = Math.sin(manhattan * 0.24) * 0.5 + 0.5;
          const fade = Math.max(0, 1 - manhattan / 66);
          const threshold = BAYER_4X4[(y & 3) * 4 + (x & 3)] / 16;
          lit = wave * 0.65 + fade * 0.45 > threshold;
          break;
        }
        case 'quasar': {
          // Radiant 8-point quasar star burst with orbiting diamond ring & starfield
          const axisCross = Math.abs(dx) <= 1.5 || Math.abs(dy) <= 1.5;
          const diagCross = Math.abs(Math.abs(dx) - Math.abs(dy)) <= 1.2 && dist < 34;
          const core = manhattan <= 10;
          const coreCut = manhattan <= 4;
          const orbit = Math.abs(manhattan - 28) <= 1.2 || Math.abs(manhattan - 42) <= 1.0;
          const starHash = ((x * 73 + y * 151) ^ (x * 19)) & 255;
          const star = dist > 30 && starHash === 7;
          lit = (core && !coreCut) || axisCross || diagCross || orbit || star;
          break;
        }
        case 'corefault': {
          // Glitch circuit traces, 45-degree bus lines, and horizontal slice offsets
          const glitchShift = y >= 32 && y <= 46 ? 7 : y >= 62 && y <= 70 ? -5 : 0;
          const gx = (x + glitchShift + size) % size;
          const grid = gx % 16 === 0 || y % 16 === 0;
          const node =
            Math.abs((gx % 16) - 8) + Math.abs((y % 16) - 8) <= 3 &&
            ((Math.floor(gx / 16) + Math.floor(y / 16)) & 1) === 0;
          const bus = Math.abs(gx - y) <= 1 || Math.abs(gx + y - 95) <= 1;
          const cutout = Math.abs(gx - 48) < 12 && Math.abs(y - 48) < 12;
          const innerChip = Math.abs(gx - 48) + Math.abs(y - 48) <= 9;
          lit = cutout ? innerChip && (gx % 3 !== 0 || y % 3 !== 0) : grid || node || bus;
          break;
        }
        case 'minimum': {
          // Ultra-minimalist zen diamond outline with crisp 2x2 center dot and corner ticks
          const outerDiamond = Math.abs(manhattan - 26) <= 1.0;
          const innerDot = Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5;
          const cornerTicks =
            (x >= 8 && x <= 14 && y === 8) ||
            (y >= 8 && y <= 14 && x === 8) ||
            (x >= 81 && x <= 87 && y === 87) ||
            (y >= 81 && y <= 87 && x === 87);
          lit = outerDiamond || innerDot || cornerTicks;
          break;
        }
        case 'rush': {
          // Stacked high-velocity upward chevrons with crisp side speed streaks
          const chev = ((y + Math.abs(Math.round(dx))) % 14 + 14) % 14;
          const inLane = Math.abs(dx) <= 32;
          const speedLine = !inLane && (x % 4 === 0) && ((y + x * 3) % 12 < 5);
          lit = (inLane && chev < 5) || speedLine;
          break;
        }
        case 'hazard': {
          // Bold diagonal warning stripes framing a crisp centered diamond exclamation emblem
          const inEmblem = manhattan <= 25;
          if (inEmblem) {
            const border = manhattan >= 21;
            const bar = Math.abs(dx) <= 2.5 && dy >= -12 && dy <= 2;
            const dot = Math.abs(dx) <= 2.5 && dy >= 7 && dy <= 12;
            lit = border || bar || dot;
          } else {
            const stripe = (((x + y) % 16) + 16) % 16;
            lit = stripe < 8;
          }
          break;
        }
      }

      setCoverPixel(buf, x, y, lit);
    }
  }

  return buf;
}

export function generateAllTrackCovers(): Record<TrackId, Uint8Array> {
  const covers = {} as Record<TrackId, Uint8Array>;
  for (const trackId of ALL_TRACK_IDS) {
    covers[trackId] = generateTrackCoverPixels(trackId);
  }
  return covers;
}
