/**
 * 8x29 Staggered Diamond Board Geometry, Wall Mask & Slide-Off Gravity Resolve.
 * Pure, DOM-free deterministic TypeScript.
 */

import {
  BOARD_CELL_COUNT,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_EMPTY,
  CELL_WALL,
  type BlockColor,
  type BlockSlideMove,
  type CellValue,
} from '../contracts/index.js';

export interface RowBounds {
  left: number;
  right: number;
  width: number;
}

export interface ContainerPixel {
  cx: number;
  cy: number;
}

/** Container horizontal centerline (68px container -> center x = 34). */
export const CONTAINER_CENTER_X = 34;

/** Return inclusive playable [left, right] bounds and width for row y (0..28). */
export function getRowPlayableBounds(y: number): RowBounds {
  if (y < 0 || y >= BOARD_HEIGHT) {
    return { left: 1, right: 0, width: 0 };
  }
  if (y <= 6) {
    const left = 3 - Math.floor(y / 2);
    const right = 3 + Math.floor((y + 1) / 2);
    return { left, right, width: right - left + 1 };
  }
  if (y <= 21) {
    const right = y % 2 === 1 ? 7 : 6;
    return { left: 0, right, width: right + 1 };
  }
  const r = 28 - y;
  const left = 3 - Math.floor(r / 2);
  const right = 3 + Math.floor((r + 1) / 2);
  return { left, right, width: right - left + 1 };
}

/** True iff (x, y) is within the 8x29 array bounds. */
export function isInBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;
}

/** True iff (x, y) lies inside the playable diamond-hexagon interior (not a wall). */
export function isPlayableCell(x: number, y: number): boolean {
  if (!isInBounds(x, y)) return false;
  const { left, right } = getRowPlayableBounds(y);
  return x >= left && x <= right;
}

/** Flat index into length-232 grid/automata arrays: y * 8 + x. */
export function gridIndex(x: number, y: number): number {
  return y * BOARD_WIDTH + x;
}

/** True iff cell value is one of the 4 playable block colors (1 | 2 | 3 | 4). */
export function isBlockColor(value: CellValue): value is BlockColor {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * Staggered diagonal neighbor X-coordinate for row parity.
 * For any (x, y), moving to row y-1 or y+1 in direction `dir` (-1 = left, +1 = right):
 *   even y: dir === -1 ? x : x + 1
 *   odd  y: dir === -1 ? x - 1 : x
 */
export function getNeighborX(x: number, y: number, dir: -1 | 1): number {
  if ((y & 1) === 0) {
    return dir === -1 ? x : x + 1;
  }
  return dir === -1 ? x - 1 : x;
}

/**
 * Map grid cell (x, y) to its exact center pixel inside the 68x128 container sprite:
 *   even y: cx = 10 + x * 8
 *   odd  y: cx = 6 + x * 8
 *   cy = 5 + y * 4
 */
export function cellToContainerPixel(x: number, y: number): ContainerPixel {
  const cx = (y & 1) === 0 ? 10 + x * 8 : 6 + x * 8;
  const cy = 5 + y * 4;
  return { cx, cy };
}

/** Create a fresh 8x29 (232-cell) grid initialized with CELL_WALL and CELL_EMPTY. */
export function createEmptyGrid(): CellValue[] {
  const grid: CellValue[] = new Array<CellValue>(BOARD_CELL_COUNT);
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const { left, right } = getRowPlayableBounds(y);
    for (let x = 0; x < BOARD_WIDTH; x++) {
      grid[y * BOARD_WIDTH + x] = x >= left && x <= right ? CELL_EMPTY : CELL_WALL;
    }
  }
  return grid;
}

/** Reset all playable cells in-place to CELL_EMPTY while preserving CELL_WALL mask. */
export function clearPlayableGrid(grid: CellValue[]): number[] {
  const clearedIndices: number[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const { left, right } = getRowPlayableBounds(y);
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const idx = y * BOARD_WIDTH + x;
      if (x >= left && x <= right) {
        if (isBlockColor(grid[idx])) {
          clearedIndices.push(idx);
        }
        grid[idx] = CELL_EMPTY;
      } else {
        grid[idx] = CELL_WALL;
      }
    }
  }
  return clearedIndices;
}

/** Read a grid cell safely; out-of-bounds reads return CELL_WALL. */
export function getCell(grid: readonly CellValue[], x: number, y: number): CellValue {
  if (!isInBounds(x, y)) return CELL_WALL;
  return grid[y * BOARD_WIDTH + x];
}

/** Write a grid cell if inside playable bounds. */
export function setCell(grid: CellValue[], x: number, y: number, value: CellValue): void {
  if (!isInBounds(x, y)) return;
  grid[y * BOARD_WIDTH + x] = value;
}

/** True iff (x, y) is in-bounds and currently CELL_EMPTY. */
export function isEmptyCell(grid: readonly CellValue[], x: number, y: number): boolean {
  return isInBounds(x, y) && grid[y * BOARD_WIDTH + x] === CELL_EMPTY;
}

/** Count all settled block cells (1..4) currently on the board. */
export function countBlocksOnGrid(grid: readonly CellValue[]): number {
  let count = 0;
  for (let i = 0; i < grid.length; i++) {
    if (isBlockColor(grid[i])) {
      count += 1;
    }
  }
  return count;
}

export interface SlideResolveResult {
  moves: BlockSlideMove[];
  lastFallLeft: boolean;
}

/**
 * Execute one bottom-to-top slide-off gravity resolve sweep (`y = 28..0`).
 * Mutates `grid` in-place so upper blocks follow newly vacated cells cleanly
 * without overwriting other blocks. Alternates ambiguous symmetric splits via
 * `lastFallLeft`.
 */
export function stepSlideOffResolve(
  grid: CellValue[],
  lastFallLeft: boolean,
): SlideResolveResult {
  const moves: BlockSlideMove[] = [];
  let fallToggle = lastFallLeft;

  for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const fromIdx = y * BOARD_WIDTH + x;
      const cell = grid[fromIdx];
      if (!isBlockColor(cell)) continue;

      const lx = getNeighborX(x, y, -1);
      const rx = getNeighborX(x, y, 1);

      const lOpen = isEmptyCell(grid, lx, y + 1);
      const rOpen = isEmptyCell(grid, rx, y + 1);
      const bOpen = isEmptyCell(grid, x, y + 2);

      let toX = -1;
      let toY = -1;

      if (lOpen && rOpen && bOpen) {
        toX = x;
        toY = y + 2;
      } else if (lOpen && !rOpen) {
        toX = lx;
        toY = y + 1;
      } else if (rOpen && !lOpen) {
        toX = rx;
        toY = y + 1;
      } else if (lOpen && rOpen && !bOpen) {
        toX = fallToggle ? rx : lx;
        toY = y + 1;
        fallToggle = !fallToggle;
      }

      if (toX !== -1) {
        grid[fromIdx] = CELL_EMPTY;
        grid[toY * BOARD_WIDTH + toX] = cell;
        moves.push({
          fromX: x,
          fromY: y,
          toX,
          toY,
          color: cell,
        });
      }
    }
  }

  return { moves, lastFallLeft: fallToggle };
}
