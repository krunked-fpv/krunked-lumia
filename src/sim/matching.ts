/**
 * Frozen-Grid Simultaneous Diamond & Diagonal Matcher.
 * Evaluates all 3 match shapes simultaneously against an unmodified snapshot of `grid`:
 *   1. 2x2 diamond: (x,y), (lx,y+1), (rx,y+1), (x,y+2)
 *   2. Diagonal `\` 3+: (lx,y-1), (x,y), (rx,y+1)
 *   3. Diagonal `/` 3+: (rx,y-1), (x,y), (lx,y+1)
 */

import {
  BOARD_CELL_COUNT,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_EMPTY,
  SPAWN_X,
  type CellValue,
  type GridCellBlock,
} from '../contracts/index.js';
import {
  cellToContainerPixel,
  getCell,
  getNeighborX,
  gridIndex,
  isBlockColor,
} from './grid.js';

export interface MatchResult {
  cells: GridCellBlock[];
  clearMask: Uint8Array;
  diamondCount: number;
  diagDownRightCount: number;
  diagDownLeftCount: number;
}

/** Scan frozen `grid` and mark all simultaneous diamond and 3+ diagonal matches. */
export function findSimultaneousMatches(grid: readonly CellValue[]): MatchResult {
  const clearMask = new Uint8Array(BOARD_CELL_COUNT);
  let diamondCount = 0;
  let diagDownRightCount = 0;
  let diagDownLeftCount = 0;

  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const c = grid[y * BOARD_WIDTH + x];
      if (!isBlockColor(c)) continue;

      const lx = getNeighborX(x, y, -1);
      const rx = getNeighborX(x, y, 1);

      // 1. 2x2 diamond anchored at top (x, y)
      if (
        getCell(grid, lx, y + 1) === c &&
        getCell(grid, rx, y + 1) === c &&
        getCell(grid, x, y + 2) === c
      ) {
        clearMask[gridIndex(x, y)] = 1;
        clearMask[gridIndex(lx, y + 1)] = 1;
        clearMask[gridIndex(rx, y + 1)] = 1;
        clearMask[gridIndex(x, y + 2)] = 1;
        diamondCount += 1;
      }

      // 2. Diagonal `\` 3+ centered at (x, y)
      if (getCell(grid, lx, y - 1) === c && getCell(grid, rx, y + 1) === c) {
        clearMask[gridIndex(lx, y - 1)] = 1;
        clearMask[gridIndex(x, y)] = 1;
        clearMask[gridIndex(rx, y + 1)] = 1;
        diagDownRightCount += 1;
      }

      // 3. Diagonal `/` 3+ centered at (x, y)
      if (getCell(grid, rx, y - 1) === c && getCell(grid, lx, y + 1) === c) {
        clearMask[gridIndex(rx, y - 1)] = 1;
        clearMask[gridIndex(x, y)] = 1;
        clearMask[gridIndex(lx, y + 1)] = 1;
        diagDownLeftCount += 1;
      }
    }
  }

  const cells: GridCellBlock[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const idx = y * BOARD_WIDTH + x;
      if (clearMask[idx] === 1) {
        const val = grid[idx];
        if (isBlockColor(val)) {
          cells.push({ x, y, color: val });
        }
      }
    }
  }

  return {
    cells,
    clearMask,
    diamondCount,
    diagDownRightCount,
    diagDownLeftCount,
  };
}

/** Clear all matched cells in `grid` back to CELL_EMPTY. */
export function applyMatchesToGrid(
  grid: CellValue[],
  cells: readonly GridCellBlock[],
): void {
  for (let i = 0; i < cells.length; i++) {
    grid[gridIndex(cells[i].x, cells[i].y)] = CELL_EMPTY;
  }
}

/**
 * Pick the cleared cell closest to the geometric centroid of `cells`
 * (used as the anchor grid coordinate for COMBO_CHAIN banner events).
 */
export function computeMatchCentroid(
  cells: readonly GridCellBlock[],
): { x: number; y: number } {
  if (cells.length === 0) {
    return { x: SPAWN_X, y: 14 };
  }
  let sumCx = 0;
  let sumCy = 0;
  for (let i = 0; i < cells.length; i++) {
    const p = cellToContainerPixel(cells[i].x, cells[i].y);
    sumCx += p.cx;
    sumCy += p.cy;
  }
  const avgCx = sumCx / cells.length;
  const avgCy = sumCy / cells.length;

  let best = cells[0];
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cells.length; i++) {
    const p = cellToContainerPixel(cells[i].x, cells[i].y);
    const dx = p.cx - avgCx;
    const dy = p.cy - avgCy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = cells[i];
    }
  }
  return { x: best.x, y: best.y };
}
