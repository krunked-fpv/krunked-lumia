/**
 * 2x2 Diamond Tetrad Mechanics:
 * - Balanced 16-block shuffled deck (4 of each color 1..4)
 * - CW/CCW color rotation
 * - Parity-aware lateral movement
 * - Downward gravity + bottom V-funnel wall sliding
 * - Ghost projection and grid locking
 */

import {
  BOARD_HEIGHT,
  CELL_WALL,
  SLACK_DURATION_TICKS,
  type BlockColor,
  type CellValue,
  type GridCellBlock,
  type TetradState,
} from '../contracts/index.js';
import {
  CONTAINER_CENTER_X,
  cellToContainerPixel,
  getCell,
  getNeighborX,
  isBlockColor,
  isEmptyCell,
  isPlayableCell,
  setCell,
} from './grid.js';
import { shuffleArrayInPlace } from './prng.js';

export type TetradColors = [BlockColor, BlockColor, BlockColor, BlockColor];

export interface GridPoint {
  x: number;
  y: number;
}

export interface TetradMoveResult {
  moved: boolean;
  x: number;
  y: number;
}

export interface TetradDownStepResult {
  moved: boolean;
  x: number;
  y: number;
  slid: boolean;
}

/** Generate a freshly shuffled balanced 16-block deck (4 of each color 1..4). */
export function createShuffledDeck(rngState: number): { deck: BlockColor[]; rngState: number } {
  const deck: BlockColor[] = [
    1, 1, 1, 1,
    2, 2, 2, 2,
    3, 3, 3, 3,
    4, 4, 4, 4,
  ];
  const nextRngState = shuffleArrayInPlace(deck, rngState);
  return { deck, rngState: nextRngState };
}

/**
 * Draw 4 colors for the next tetrad from `deck`, refilling with a fresh shuffled
 * balanced 16-block bag whenever fewer than 4 colors remain.
 */
export function drawTetradColors(
  deck: BlockColor[],
  rngState: number,
): { colors: TetradColors; rngState: number } {
  let state = rngState;
  while (deck.length < 4) {
    const bag = createShuffledDeck(state);
    state = bag.rngState;
    for (let i = 0; i < bag.deck.length; i++) {
      deck.push(bag.deck[i]);
    }
  }
  const drawn = deck.splice(0, 4);
  return {
    colors: [drawn[0], drawn[1], drawn[2], drawn[3]],
    rngState: state,
  };
}

/**
 * Return the 4 grid coordinates of a 2x2 diamond tetrad anchored at `(tx, ty)`.
 * Order matches `TetradState.colors`: [top, right, bottom, left].
 */
export function getTetradCells(
  tx: number,
  ty: number,
): [GridPoint, GridPoint, GridPoint, GridPoint] {
  return [
    { x: tx, y: ty }, // top
    { x: getNeighborX(tx, ty, 1), y: ty + 1 }, // right
    { x: tx, y: ty + 2 }, // bottom
    { x: getNeighborX(tx, ty, -1), y: ty + 1 }, // left
  ];
}

/** Return the 4 colored cells of a tetrad as GridCellBlock objects. */
export function getTetradBlocks(
  tx: number,
  ty: number,
  colors: readonly [BlockColor, BlockColor, BlockColor, BlockColor],
): GridCellBlock[] {
  const coords = getTetradCells(tx, ty);
  return [
    { x: coords[0].x, y: coords[0].y, color: colors[0] },
    { x: coords[1].x, y: coords[1].y, color: colors[1] },
    { x: coords[2].x, y: coords[2].y, color: colors[2] },
    { x: coords[3].x, y: coords[3].y, color: colors[3] },
  ];
}

/** True iff all 4 cells of a tetrad at `(tx, ty)` are playable and CELL_EMPTY. */
export function canPlaceTetrad(grid: readonly CellValue[], tx: number, ty: number): boolean {
  const cells = getTetradCells(tx, ty);
  for (let i = 0; i < 4; i++) {
    if (!isEmptyCell(grid, cells[i].x, cells[i].y)) {
      return false;
    }
  }
  return true;
}

/**
 * Rotate tetrad colors:
 * - CW  (`dir === 1`, spinRight): [top, right, bottom, left] -> [left, top, right, bottom]
 * - CCW (`dir === -1`, spinLeft): [top, right, bottom, left] -> [right, bottom, left, top]
 */
export function spinTetradColors(
  colors: readonly [BlockColor, BlockColor, BlockColor, BlockColor],
  dir: -1 | 1,
): TetradColors {
  if (dir === 1) {
    return [colors[3], colors[0], colors[1], colors[2]];
  }
  return [colors[1], colors[2], colors[3], colors[0]];
}

/**
 * Attempt parity-aware lateral movement in direction `dx` (-1 left, +1 right):
 * - Even `ty`: try `(nx, ty + 1)`, else `(nx, ty - 1)`, else `(tx + dx, ty)`.
 * - Odd  `ty`: try `(nx, ty - 1)`, else `(nx, ty + 1)`, else `(tx + dx, ty)`.
 */
export function tryMoveTetradLateral(
  grid: readonly CellValue[],
  tx: number,
  ty: number,
  dx: -1 | 1,
): TetradMoveResult {
  const nx = getNeighborX(tx, ty, dx);
  const candidates: ReadonlyArray<[number, number]> =
    (ty & 1) === 0
      ? [
          [nx, ty + 1],
          [nx, ty - 1],
          [tx + dx, ty],
        ]
      : [
          [nx, ty - 1],
          [nx, ty + 1],
          [tx + dx, ty],
        ];

  for (let i = 0; i < candidates.length; i++) {
    const [cx, cy] = candidates[i];
    if (canPlaceTetrad(grid, cx, cy)) {
      return { moved: true, x: cx, y: cy };
    }
  }
  return { moved: false, x: tx, y: ty };
}

/**
 * Attempt one downward gravity step:
 * 1. Try straight down `(tx, ty + 2)`.
 * 2. If blocked ONLY by `CELL_WALL` (zero settled blocks 1..4 in target cells),
 *    attempt an inward 1-step diagonal V-funnel slide toward the container centerline.
 */
export function stepTetradDown(
  grid: readonly CellValue[],
  tx: number,
  ty: number,
): TetradDownStepResult {
  const downCells = getTetradCells(tx, ty + 2);
  let blockedByWall = false;
  let blockedByBlock = false;

  for (let i = 0; i < 4; i++) {
    const val = getCell(grid, downCells[i].x, downCells[i].y);
    if (val === CELL_WALL) {
      blockedByWall = true;
    } else if (isBlockColor(val)) {
      blockedByBlock = true;
    }
  }

  if (!blockedByWall && !blockedByBlock) {
    return { moved: true, x: tx, y: ty + 2, slid: false };
  }

  if (blockedByWall && !blockedByBlock) {
    const { cx } = cellToContainerPixel(tx, ty);
    if (cx !== CONTAINER_CENTER_X) {
      const inwardDir: -1 | 1 = cx < CONTAINER_CENTER_X ? 1 : -1;
      const slideX = getNeighborX(tx, ty, inwardDir);
      const slideY = ty + 1;
      if (canPlaceTetrad(grid, slideX, slideY)) {
        return { moved: true, x: slideX, y: slideY, slid: true };
      }
    }
  }

  return { moved: false, x: tx, y: ty, slid: false };
}

/** True iff the tetrad at `(tx, ty)` can advance downward (straight or via V-funnel wall slide). */
export function canStepTetradDown(grid: readonly CellValue[], tx: number, ty: number): boolean {
  return stepTetradDown(grid, tx, ty).moved;
}

/** Project landing coordinates using the exact downward step & V-funnel slide rules. */
export function computeGhostPosition(
  grid: readonly CellValue[],
  tx: number,
  ty: number,
): GridPoint {
  let x = tx;
  let y = ty;
  const maxSteps = BOARD_HEIGHT * 2;
  for (let step = 0; step < maxSteps; step++) {
    const next = stepTetradDown(grid, x, y);
    if (!next.moved) break;
    x = next.x;
    y = next.y;
  }
  return { x, y };
}

/** Project ghost landing Y-coordinate for `SimState.ghostY`. */
export function computeGhostY(grid: readonly CellValue[], tx: number, ty: number): number {
  return computeGhostPosition(grid, tx, ty).y;
}

/** Lock the active tetrad's 4 cells into `grid` and return the locked cell list. */
export function lockTetradToGrid(grid: CellValue[], tetrad: TetradState): GridCellBlock[] {
  const blocks = getTetradBlocks(tetrad.x, tetrad.y, tetrad.colors);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (isPlayableCell(b.x, b.y)) {
      setCell(grid, b.x, b.y, b.color);
    }
  }
  return blocks;
}

/** Construct a fresh TetradState anchored at `(x, y)`. */
export function createTetrad(
  x: number,
  y: number,
  colors: TetradColors,
  fallTimer: number,
  resting: boolean,
): TetradState {
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    colors: [colors[0], colors[1], colors[2], colors[3]],
    fallTimer,
    slackActive: resting,
    slackTimer: SLACK_DURATION_TICKS,
    slackCount: 0,
  };
}
