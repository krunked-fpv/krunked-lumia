/**
 * Cellular Automata Board Ripple Diffusion.
 * Diffuses energy [0..100] across the 4 staggered diagonal neighbors every
 * AUTOMATA_TICK_INTERVAL ticks with AUTOMATA_DECAY (0.75) decay.
 */

import {
  AUTOMATA_DECAY,
  BOARD_CELL_COUNT,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_WALL,
  type CellValue,
  type GridCellBlock,
} from '../contracts/index.js';
import { getNeighborX, gridIndex, isInBounds } from './grid.js';

const AUTOMATA_CLAMP_EPSILON = 0.5;
const AUTOMATA_MAX_ENERGY = 100;

/** Create a zeroed length-232 automata energy array. */
export function createEmptyAutomata(): number[] {
  return new Array<number>(BOARD_CELL_COUNT).fill(0);
}

/** Seed energy at a single playable grid cell, clamped to [0..100]. */
export function seedAutomataCell(
  automata: number[],
  grid: readonly CellValue[],
  x: number,
  y: number,
  energy: number,
): void {
  if (!isInBounds(x, y)) return;
  const idx = gridIndex(x, y);
  if (grid[idx] === CELL_WALL) return;
  const clamped = Math.max(0, Math.min(AUTOMATA_MAX_ENERGY, energy));
  if (clamped > automata[idx]) {
    automata[idx] = clamped;
  }
}

/** Seed energy across a batch of grid cell coordinates. */
export function seedAutomataCells(
  automata: number[],
  grid: readonly CellValue[],
  cells: ReadonlyArray<Pick<GridCellBlock, 'x' | 'y'>>,
  energy: number,
): void {
  for (let i = 0; i < cells.length; i++) {
    seedAutomataCell(automata, grid, cells[i].x, cells[i].y, energy);
  }
}

/**
 * Perform one deterministic diffusion pass across the 4 staggered diagonal neighbors:
 *   upper-left  (lx, y - 1)
 *   upper-right (rx, y - 1)
 *   lower-left  (lx, y + 1)
 *   lower-right (rx, y + 1)
 * Walls always remain 0; values below AUTOMATA_CLAMP_EPSILON snap cleanly to 0.
 */
export function stepAutomataGrid(
  automata: number[],
  grid: readonly CellValue[],
): void {
  const next = new Array<number>(BOARD_CELL_COUNT).fill(0);

  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const idx = y * BOARD_WIDTH + x;
      if (grid[idx] === CELL_WALL) {
        next[idx] = 0;
        continue;
      }

      const lx = getNeighborX(x, y, -1);
      const rx = getNeighborX(x, y, 1);

      let sum = 0;
      if (isInBounds(lx, y - 1) && grid[(y - 1) * BOARD_WIDTH + lx] !== CELL_WALL) {
        sum += automata[(y - 1) * BOARD_WIDTH + lx];
      }
      if (isInBounds(rx, y - 1) && grid[(y - 1) * BOARD_WIDTH + rx] !== CELL_WALL) {
        sum += automata[(y - 1) * BOARD_WIDTH + rx];
      }
      if (isInBounds(lx, y + 1) && grid[(y + 1) * BOARD_WIDTH + lx] !== CELL_WALL) {
        sum += automata[(y + 1) * BOARD_WIDTH + lx];
      }
      if (isInBounds(rx, y + 1) && grid[(y + 1) * BOARD_WIDTH + rx] !== CELL_WALL) {
        sum += automata[(y + 1) * BOARD_WIDTH + rx];
      }

      const avgNeighbors = sum * 0.25;
      const selfCarry = automata[idx] * 0.5;
      const value = Math.max(selfCarry, avgNeighbors) * AUTOMATA_DECAY;
      next[idx] = value < AUTOMATA_CLAMP_EPSILON ? 0 : Math.min(AUTOMATA_MAX_ENERGY, value);
    }
  }

  for (let i = 0; i < BOARD_CELL_COUNT; i++) {
    automata[i] = next[i];
  }
}
