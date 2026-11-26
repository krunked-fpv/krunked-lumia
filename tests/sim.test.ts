import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARR_MOVE_SPEED_TICKS,
  AUTOMATA_SEED_CLEAR,
  AUTOMATA_SEED_DROP,
  AUTOMATA_TICK_INTERVAL,
  BLOCK_HIT_TICKS,
  BOARD_CELL_COUNT,
  BOARD_HEIGHT,
  BOARD_SHAKE_DECAY,
  BOARD_WIDTH,
  CELL_EMPTY,
  CELL_WALL,
  FALL_SPEED_TICKS,
  IMPOSSIBLE_DROP_TIMER_TICKS,
  IMPOSSIBLE_LEVEL_BONUS,
  IMPOSSIBLE_UNLOCK_SCORE,
  INTRO_PAUSE_TICKS,
  MARATHON_TARGET_BLOCKS,
  PERFECT_CLEAR_BASE_BONUS,
  RESOLVE_STEP_TICKS,
  RUSH_DURATION_TICKS,
  SLACK_DURATION_TICKS,
  SLACK_MAX_IMPOSSIBLE,
  SLACK_MAX_STANDARD,
  SPAWN_X,
  SPAWN_Y,
  createEmptyInputFrame,
  type BlockColor,
  type InputFrame,
  type SimEvent,
  type SimState,
} from '../src/contracts/index.js';
import {
  CONTAINER_CENTER_X,
  canPlaceTetrad,
  cellToContainerPixel,
  clearPlayableGrid,
  computeGhostPosition,
  computePerfectClearBonus,
  computeWaveScore,
  countBlocksOnGrid,
  createEmptyGrid,
  createShuffledDeck,
  createSimState,
  drawTetradColors,
  findSimultaneousMatches,
  getCell,
  getNeighborX,
  getRowPlayableBounds,
  getTetradCells,
  gridIndex,
  hashSimState,
  isPlayableCell,
  nextRngUint32,
  normalizeSeed,
  seedAutomataCell,
  setCell,
  spinTetradColors,
  stepAutomataGrid,
  stepSim,
  stepSlideOffResolve,
  stepTetradDown,
  tryMoveTetradLateral,
} from '../src/sim/index.js';

function inputWith(overrides: Partial<InputFrame>): InputFrame {
  return { ...createEmptyInputFrame(), ...overrides };
}

function advancePastIntro(state: SimState): SimEvent[] {
  const events: SimEvent[] = [];
  const empty = createEmptyInputFrame();
  for (let i = 0; i < INTRO_PAUSE_TICKS; i++) {
    events.push(...stepSim(state, empty));
  }
  return events;
}

function stepUntilPhase(
  state: SimState,
  targetPhase: SimState['phase'],
  maxTicks = 300,
): SimEvent[] {
  const allEvents: SimEvent[] = [];
  const empty = createEmptyInputFrame();
  for (let i = 0; i < maxTicks && state.phase !== targetPhase && !state.finished; i++) {
    allEvents.push(...stepSim(state, empty));
  }
  return allEvents;
}

describe('Krunked Lumia Deterministic 60Hz Diamond Simulation', () => {
  describe('1. Wall Mask & Diamond Grid Geometry', () => {
    it('enforces exact 8x29 playable wall mask widths [1..7, 8/7.., 7..1]', () => {
      const expectedWidths = [
        1, 2, 3, 4, 5, 6, 7, // y = 0..6
        8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8, // y = 7..21
        7, 6, 5, 4, 3, 2, 1, // y = 22..28
      ];
      expect(expectedWidths).toHaveLength(BOARD_HEIGHT);

      const grid = createEmptyGrid();
      expect(grid).toHaveLength(BOARD_CELL_COUNT);
      expect(BOARD_CELL_COUNT).toBe(232);

      let playableTotal = 0;
      for (let y = 0; y < BOARD_HEIGHT; y++) {
        const bounds = getRowPlayableBounds(y);
        expect(bounds.width).toBe(expectedWidths[y]);

        let rowPlayable = 0;
        for (let x = 0; x < BOARD_WIDTH; x++) {
          const playable = isPlayableCell(x, y);
          const cell = getCell(grid, x, y);
          if (playable) {
            expect(cell).toBe(CELL_EMPTY);
            rowPlayable += 1;
            playableTotal += 1;
          } else {
            expect(cell).toBe(CELL_WALL);
          }
        }
        expect(rowPlayable).toBe(expectedWidths[y]);
      }

      expect(playableTotal).toBe(169);
    });

    it('satisfies exact getNeighborX and cellToContainerPixel diagonal symmetry', () => {
      // Top and bottom apexes both sit squarely on container centerline cx = 34.
      expect(cellToContainerPixel(3, 0)).toEqual({ cx: 34, cy: 5 });
      expect(cellToContainerPixel(3, 28)).toEqual({ cx: 34, cy: 117 });

      // Every playable row's left & right edges are mirror-symmetric around cx = 34.
      for (let y = 0; y < BOARD_HEIGHT; y++) {
        const { left, right } = getRowPlayableBounds(y);
        const leftPx = cellToContainerPixel(left, y);
        const rightPx = cellToContainerPixel(right, y);
        expect((leftPx.cx + rightPx.cx) / 2).toBe(CONTAINER_CENTER_X);
      }

      // For every cell (x, y), its 4 diagonal neighbors sit at exact (+/-4, +/-4) px.
      for (let y = 1; y < BOARD_HEIGHT - 1; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
          const c = cellToContainerPixel(x, y);
          const lx = getNeighborX(x, y, -1);
          const rx = getNeighborX(x, y, 1);

          expect(cellToContainerPixel(lx, y - 1)).toEqual({ cx: c.cx - 4, cy: c.cy - 4 });
          expect(cellToContainerPixel(rx, y - 1)).toEqual({ cx: c.cx + 4, cy: c.cy - 4 });
          expect(cellToContainerPixel(lx, y + 1)).toEqual({ cx: c.cx - 4, cy: c.cy + 4 });
          expect(cellToContainerPixel(rx, y + 1)).toEqual({ cx: c.cx + 4, cy: c.cy + 4 });
        }
      }
    });
  });

  describe('2. Deterministic PRNG & Balanced 16-Block Deck', () => {
    it('generates identical PRNG streams for identical seeds and balanced 16-block bags', () => {
      let s1 = normalizeSeed(123456);
      let s2 = normalizeSeed(123456);
      for (let i = 0; i < 64; i++) {
        const a = nextRngUint32(s1);
        const b = nextRngUint32(s2);
        expect(a.value).toBe(b.value);
        s1 = a.nextState;
        s2 = b.nextState;
      }

      const bag = createShuffledDeck(normalizeSeed(98765));
      expect(bag.deck).toHaveLength(16);
      const counts = [0, 0, 0, 0, 0];
      for (const c of bag.deck) counts[c] += 1;
      expect(counts.slice(1)).toEqual([4, 4, 4, 4]);

      // Across 4 consecutive bags (16 tetrads = 64 blocks), every 4-tetrad window is balanced.
      const deck: BlockColor[] = [];
      let rng = normalizeSeed(42);
      for (let bagIdx = 0; bagIdx < 4; bagIdx++) {
        const bagCounts = [0, 0, 0, 0, 0];
        for (let p = 0; p < 4; p++) {
          const draw = drawTetradColors(deck, rng);
          rng = draw.rngState;
          for (const c of draw.colors) bagCounts[c] += 1;
        }
        expect(bagCounts.slice(1)).toEqual([4, 4, 4, 4]);
      }
    });
  });

  describe('3. Tetrad Spin, Lateral Movement, Wall Sliding & DAS/ARR', () => {
    it('rotates tetrad colors CW and CCW cleanly', () => {
      const start: [BlockColor, BlockColor, BlockColor, BlockColor] = [1, 2, 3, 4];
      const cw = spinTetradColors(start, 1);
      expect(cw).toEqual([4, 1, 2, 3]);
      expect(spinTetradColors(cw, -1)).toEqual(start);

      const ccw = spinTetradColors(start, -1);
      expect(ccw).toEqual([2, 3, 4, 1]);
      expect(spinTetradColors(ccw, 1)).toEqual(start);

      let cur = start;
      for (let i = 0; i < 4; i++) cur = spinTetradColors(cur, 1);
      expect(cur).toEqual(start);
    });

    it('moves laterally with parity zigzag and never enters walls or occupied cells', () => {
      const grid = createEmptyGrid();
      expect(canPlaceTetrad(grid, SPAWN_X, SPAWN_Y)).toBe(true);
      expect(getTetradCells(3, 0)).toEqual([
        { x: 3, y: 0 },
        { x: 4, y: 1 },
        { x: 3, y: 2 },
        { x: 3, y: 1 },
      ]);

      // Mid-board horizontal zig-zag from even y=10 -> odd y=11 -> even y=10.
      const r1 = tryMoveTetradLateral(grid, 3, 10, 1);
      expect(r1).toEqual({ moved: true, x: 4, y: 11 });
      const r2 = tryMoveTetradLateral(grid, r1.x, r1.y, 1);
      expect(r2).toEqual({ moved: true, x: 4, y: 10 });

      // Blocked cleanly against left wall (0, 10) and right wall (6, 10).
      expect(tryMoveTetradLateral(grid, 0, 10, -1).moved).toBe(false);
      expect(tryMoveTetradLateral(grid, 6, 10, 1).moved).toBe(false);

      // Blocked by an adjacent settled block.
      setCell(grid, 4, 11, 1);
      setCell(grid, 4, 9, 1);
      setCell(grid, 4, 10, 1);
      expect(tryMoveTetradLateral(grid, 3, 10, 1).moved).toBe(false);
    });

    it('slides down both bottom V-funnel walls into apex (3, 26) only when blocked by walls', () => {
      const grid = createEmptyGrid();

      // Left wall slide from (0, 20) -> (1,21) -> (1,22) -> (2,23) -> (2,24) -> (3,25) -> (3,26)
      let pos = { x: 0, y: 20 };
      const leftPath: Array<[number, number]> = [];
      while (true) {
        const step = stepTetradDown(grid, pos.x, pos.y);
        if (!step.moved) break;
        expect(step.slid).toBe(true);
        pos = { x: step.x, y: step.y };
        leftPath.push([pos.x, pos.y]);
      }
      expect(leftPath).toEqual([
        [1, 21],
        [1, 22],
        [2, 23],
        [2, 24],
        [3, 25],
        [3, 26],
      ]);

      // Right wall slide from (6, 20) mirrors symmetrically into (3, 26).
      pos = { x: 6, y: 20 };
      const rightPath: Array<[number, number]> = [];
      while (true) {
        const step = stepTetradDown(grid, pos.x, pos.y);
        if (!step.moved) break;
        expect(step.slid).toBe(true);
        pos = { x: step.x, y: step.y };
        rightPath.push([pos.x, pos.y]);
      }
      expect(rightPath).toEqual([
        [6, 21],
        [5, 22],
        [5, 23],
        [4, 24],
        [4, 25],
        [3, 26],
      ]);

      // Ghost position matches exact V-funnel landing spot.
      expect(computeGhostPosition(grid, 0, 10)).toEqual({ x: 3, y: 26 });
      expect(computeGhostPosition(grid, 6, 10)).toEqual({ x: 3, y: 26 });

      // Settled block beneath prevents V-funnel wall slide.
      setCell(grid, 1, 23, 2);
      const blockedStep = stepTetradDown(grid, 0, 20);
      expect(blockedStep.moved).toBe(false);
    });

    it('enforces DAS (keyboard vs gamepad) and ARR timing presets', () => {
      const state = createSimState('marathon', 'tessellation', 101);
      advancePastIntro(state);
      // Place tetrad mid-board where multiple right moves fit cleanly.
      state.tetrad!.x = 0;
      state.tetrad!.y = 10;

      const kbDelay = 6;
      const speedIdx = 4; // ARR = 3 ticks
      const expectedArr = ARR_MOVE_SPEED_TICKS[speedIdx];
      expect(expectedArr).toBe(3);

      const moveTicks: number[] = [];
      for (let t = 0; t < 16; t++) {
        const events = stepSim(
          state,
          inputWith({
            moveRight: true,
            moveRightPressed: t === 0,
            usingGamepad: false,
            kbMoveDelay: kbDelay,
            gpMoveDelay: 12,
            moveSpeedIndex: speedIdx,
          }),
        );
        if (events.some((e) => e.type === 'TETRAD_MOVE')) {
          moveTicks.push(t);
        }
      }
      // Immediate press at t=0, DAS fires at t=6, ARR repeats at t=9, t=12, t=15.
      expect(moveTicks).toEqual([0, 6, 9, 12, 15]);
    });
  });

  describe('4. Slack Lock-Delay (10 Standard vs 4 Impossible)', () => {
    it('allows 10 spin resets in standard modes and rejects the 11th', () => {
      const state = createSimState('marathon', 'tessellation', 77);
      advancePastIntro(state);

      // Move tetrad directly to bottom apex (3, 26) so it rests immediately.
      state.tetrad!.x = 3;
      state.tetrad!.y = 26;
      state.tetrad!.slackActive = true;
      state.tetrad!.slackTimer = SLACK_DURATION_TICKS;
      state.tetrad!.slackCount = 0;

      for (let s = 0; s < SLACK_MAX_STANDARD; s++) {
        // Let 6 ticks elapse so slackTimer drops below 12.
        for (let i = 0; i < 6; i++) {
          stepSim(state, createEmptyInputFrame());
        }
        expect(state.phase).toBe('FALLING_TETRAD');
        expect(state.tetrad!.slackTimer).toBe(SLACK_DURATION_TICKS - 6);

        const spinEvents = stepSim(state, inputWith({ spinRightPressed: true }));
        const spinEv = spinEvents.find((e) => e.type === 'TETRAD_SPIN');
        expect(spinEv).toBeDefined();
        expect(spinEv && spinEv.type === 'TETRAD_SPIN' && spinEv.slackReset).toBe(true);
        expect(state.tetrad!.slackTimer).toBe(SLACK_DURATION_TICKS);
        expect(state.tetrad!.slackCount).toBe(s + 1);
      }

      // 11th spin must NOT reset slackTimer.
      for (let i = 0; i < 5; i++) {
        stepSim(state, createEmptyInputFrame());
      }
      const before = state.tetrad!.slackTimer;
      const failSpinEvents = stepSim(state, inputWith({ spinLeftPressed: true }));
      const failSpin = failSpinEvents.find((e) => e.type === 'TETRAD_SPIN');
      expect(failSpin && failSpin.type === 'TETRAD_SPIN' && failSpin.slackReset).toBe(false);
      expect(state.tetrad!.slackTimer).toBe(before - 1);

      // Remaining ticks lock the tetrad into BLOCK_HIT.
      let locked = false;
      for (let i = 0; i < SLACK_DURATION_TICKS; i++) {
        const evs = stepSim(state, createEmptyInputFrame());
        if (evs.some((e) => e.type === 'TETRAD_LOCK')) {
          locked = true;
          break;
        }
      }
      expect(locked).toBe(true);
      expect(state.phase).toBe('BLOCK_HIT');
    });

    it('caps spin slack resets at 4 in Impossible mode', () => {
      const state = createSimState('impossible', 'tessellation', 88);
      advancePastIntro(state);

      state.tetrad!.x = 3;
      state.tetrad!.y = 26;
      state.tetrad!.slackActive = true;
      state.tetrad!.slackTimer = SLACK_DURATION_TICKS;
      state.tetrad!.slackCount = 0;
      // Keep impossibleDropTimer generous during this isolated slackMax check.
      state.impossibleDropTimer = 50;

      for (let s = 0; s < SLACK_MAX_IMPOSSIBLE; s++) {
        stepSim(state, createEmptyInputFrame());
        const evs = stepSim(state, inputWith({ spinRightPressed: true }));
        const spin = evs.find((e) => e.type === 'TETRAD_SPIN');
        expect(spin && spin.type === 'TETRAD_SPIN' && spin.slackReset).toBe(true);
      }

      // 5th spin must emit slackReset: false.
      const fifth = stepSim(state, inputWith({ spinRightPressed: true }));
      const fifthSpin = fifth.find((e) => e.type === 'TETRAD_SPIN');
      expect(fifthSpin && fifthSpin.type === 'TETRAD_SPIN' && fifthSpin.slackReset).toBe(false);
      expect(state.tetrad!.slackCount).toBe(SLACK_MAX_IMPOSSIBLE);
    });
  });

  describe('5. Slide-Off Gravity Resolve & Alternating lastFallLeft', () => {
    it('drops straight, slides diagonally, and alternates symmetric splits via lastFallLeft', () => {
      // 1. Straight drop when lOpen && rOpen && bOpen.
      const grid1 = createEmptyGrid();
      setCell(grid1, 3, 10, 1);
      const r1 = stepSlideOffResolve(grid1, false);
      expect(r1.moves).toEqual([{ fromX: 3, fromY: 10, toX: 3, toY: 12, color: 1 }]);
      expect(getCell(grid1, 3, 12)).toBe(1);

      // 2. Ambiguous split (lOpen && rOpen && !bOpen) alternates left -> right -> left.
      const grid2 = createEmptyGrid();
      setCell(grid2, 3, 28, 2); // bottom apex occupied
      setCell(grid2, 3, 26, 1); // perched directly above (3,28) with (3,27) & (4,27) empty

      const split1 = stepSlideOffResolve(grid2, false);
      expect(split1.moves).toEqual([{ fromX: 3, fromY: 26, toX: 3, toY: 27, color: 1 }]);
      expect(split1.lastFallLeft).toBe(true);

      // Set up second symmetric split higher up at (3, 24) above occupied (3, 26)
      const grid3 = createEmptyGrid();
      setCell(grid3, 3, 28, 2);
      setCell(grid3, 3, 27, 2);
      setCell(grid3, 4, 27, 2);
      setCell(grid3, 3, 26, 2);
      setCell(grid3, 3, 24, 3); // (3,25) and (4,25) empty, (3,26) occupied

      const split2 = stepSlideOffResolve(grid3, split1.lastFallLeft);
      expect(split2.moves).toEqual([{ fromX: 3, fromY: 24, toX: 4, toY: 25, color: 3 }]);
      expect(split2.lastFallLeft).toBe(false);
    });

    it('steps BLOCK_RESOLVE every RESOLVE_STEP_TICKS (3) ticks then enters CHECK_LINES', () => {
      const state = createSimState('marathon', 'tessellation', 12);
      advancePastIntro(state);
      // Place a single floating block at (3, 22) above empty bottom funnel.
      setCell(state.grid, 3, 22, 1);
      state.tetrad = null;
      state.phase = 'BLOCK_HIT';
      state.phaseTimer = BLOCK_HIT_TICKS;

      const slideTicks: number[] = [];
      for (let t = 0; t < 40; t++) {
        const evs = stepSim(state, createEmptyInputFrame());
        if (evs.some((e) => e.type === 'BLOCK_SLIDE')) {
          slideTicks.push(state.tick);
        }
        if ((state.phase as string) === 'NEW_TETRAD') break;
      }

      // Block falls (3,22)->(3,24)->(3,26)->(3,28): 3 moves spaced strictly by RESOLVE_STEP_TICKS (3).
      expect(slideTicks).toHaveLength(3);
      expect(slideTicks[1] - slideTicks[0]).toBe(RESOLVE_STEP_TICKS);
      expect(slideTicks[2] - slideTicks[1]).toBe(RESOLVE_STEP_TICKS);
      expect(getCell(state.grid, 3, 28)).toBe(1);
    });
  });

  describe('6. Simultaneous Matching (2x2 Diamond, 3+ Diagonals, X-Cross & Cascades)', () => {
    it('detects 2x2 diamond, diagonal \\ 3+, diagonal / 3+, and simultaneous X-cross without double-counting', () => {
      // 2x2 diamond at (3, 26)
      const gDiamond = createEmptyGrid();
      setCell(gDiamond, 3, 26, 2);
      setCell(gDiamond, 3, 27, 2);
      setCell(gDiamond, 4, 27, 2);
      setCell(gDiamond, 3, 28, 2);
      const mDiamond = findSimultaneousMatches(gDiamond);
      expect(mDiamond.diamondCount).toBe(1);
      expect(mDiamond.cells).toHaveLength(4);

      // Diagonal `\` of length 4: (2,10) -> (3,11) -> (3,12) -> (4,13)
      const gBackslash = createEmptyGrid();
      setCell(gBackslash, 2, 10, 3);
      setCell(gBackslash, 3, 11, 3);
      setCell(gBackslash, 3, 12, 3);
      setCell(gBackslash, 4, 13, 3);
      const mBackslash = findSimultaneousMatches(gBackslash);
      expect(mBackslash.diagDownRightCount).toBe(2);
      expect(mBackslash.cells).toHaveLength(4);

      // Diagonal `/` of length 3: (4,10) -> (4,11) -> (3,12)
      const gSlash = createEmptyGrid();
      setCell(gSlash, 4, 10, 4);
      setCell(gSlash, 4, 11, 4);
      setCell(gSlash, 3, 12, 4);
      const mSlash = findSimultaneousMatches(gSlash);
      expect(mSlash.diagDownLeftCount).toBe(1);
      expect(mSlash.cells).toHaveLength(3);

      // Simultaneous X-cross centered at (3, 12) + separate color-1 2x2 diamond at (3, 26)
      const gCross = createEmptyGrid();
      // Center (3,12), UL (3,11), DR (4,13), UR (4,11), DL (3,13) -> 5 unique cells of color 2
      setCell(gCross, 3, 12, 2);
      setCell(gCross, 3, 11, 2);
      setCell(gCross, 4, 13, 2);
      setCell(gCross, 4, 11, 2);
      setCell(gCross, 3, 13, 2);
      // Separate diamond of color 1 at bottom
      setCell(gCross, 3, 26, 1);
      setCell(gCross, 3, 27, 1);
      setCell(gCross, 4, 27, 1);
      setCell(gCross, 3, 28, 1);

      const mCross = findSimultaneousMatches(gCross);
      expect(mCross.diagDownRightCount).toBe(1);
      expect(mCross.diagDownLeftCount).toBe(1);
      expect(mCross.diamondCount).toBe(1);
      expect(mCross.cells).toHaveLength(9);
    });

    it('scores wave formula, caps combo multiplier at 4x, and awards Perfect Clear bonus', () => {
      // Direct formula checks
      expect(computeWaveScore(4, 0, 1, 'marathon')).toBe(4 * 4 * 100 * 1 * 1);
      expect(computeWaveScore(4, 0, 4, 'marathon')).toBe(4 * 4 * 100 * 1 * 4);
      expect(computeWaveScore(4, 0, 5, 'marathon')).toBe(4 * 4 * 100 * 1 * 4); // 4x cap!
      expect(computeWaveScore(4, 15, 2, 'impossible')).toBe(
        4 * 4 * 100 * (15 + IMPOSSIBLE_LEVEL_BONUS + 1) * 2,
      );
      expect(computePerfectClearBonus(2, 3, 'marathon')).toBe(
        PERFECT_CLEAR_BASE_BONUS * 3 * 3,
      );
      expect(computePerfectClearBonus(2, 6, 'marathon')).toBe(
        PERFECT_CLEAR_BASE_BONUS * 3 * 4,
      );

      // End-to-end Perfect Clear via stepSim: drop a single all-color-1 tetrad on empty board.
      const state = createSimState('marathon', 'tessellation', 303);
      advancePastIntro(state);
      state.tetrad!.colors = [1, 1, 1, 1];

      const events: SimEvent[] = [];
      events.push(...stepSim(state, inputWith({ hardDropPressed: true })));
      events.push(...stepUntilPhase(state, 'FALLING_TETRAD', 100));

      const clearEv = events.find((e) => e.type === 'BLOCKS_CLEAR');
      const pcEv = events.find((e) => e.type === 'PERFECT_CLEAR');
      expect(clearEv).toBeDefined();
      expect(pcEv).toBeDefined();

      // 4 blocks cleared at level 0, combo 1: wave = 1600, perfect clear = 10000 -> total 11600.
      expect(state.cleared).toBe(4);
      expect(state.perfectClears).toBe(1);
      expect(state.score).toBe(1600 + 10000);
      expect(countBlocksOnGrid(state.grid)).toBe(0);
    });

    it('chains a multi-wave cascade and caps combo multiplier at 4x on 5th wave', () => {
      const state = createSimState('marathon', 'tessellation', 505);
      advancePastIntro(state);
      state.tetrad = null;

      // Exact 2-wave vertical cascade + Perfect Clear:
      // Bottom 3 color-2 blocks wait for (3, 26) to complete their 2x2 diamond.
      setCell(state.grid, 3, 28, 2);
      setCell(state.grid, 3, 27, 2);
      setCell(state.grid, 4, 27, 2);
      // Wave 1: 2x2 diamond of color 1 directly above at (3,24),(3,25),(4,25),(3,26).
      setCell(state.grid, 3, 24, 1);
      setCell(state.grid, 3, 25, 1);
      setCell(state.grid, 4, 25, 1);
      setCell(state.grid, 3, 26, 1);
      // Top capstone color-2 block at (3,22) falls straight down into (3,26) after Wave 1 clears!
      setCell(state.grid, 3, 22, 2);

      state.phase = 'CHECK_LINES';
      const events = stepUntilPhase(state, 'FALLING_TETRAD', 200);

      const clears = events.filter((e) => e.type === 'BLOCKS_CLEAR');
      const combos = events.filter((e) => e.type === 'COMBO_CHAIN');
      const pcs = events.filter((e) => e.type === 'PERFECT_CLEAR');

      expect(clears).toHaveLength(2);
      expect(combos).toHaveLength(1);
      expect(pcs).toHaveLength(1);
      expect(state.maxCombo).toBe(2);
      expect(state.cleared).toBe(8);
      // Wave 1: 4*4*100*1*1 = 1600
      // Wave 2: 4*4*100*1*2 = 3200 + Perfect Clear 10000*1*2 = 20000 -> total 24800
      expect(state.score).toBe(1600 + 3200 + 20000);

      // Verify 4x combo cap end-to-end inside stepSim on a 5th consecutive combo wave.
      const capState = createSimState('marathon', 'tessellation', 506);
      advancePastIntro(capState);
      capState.tetrad = null;
      capState.combo = 4; // Next wave will be combo = 5, multiplier must stay capped at 4!
      setCell(capState.grid, 3, 26, 3);
      setCell(capState.grid, 3, 27, 3);
      setCell(capState.grid, 4, 27, 3);
      setCell(capState.grid, 3, 28, 3);
      setCell(capState.grid, 2, 26, 4); // Prevent Perfect Clear so waveScore is isolated.
      capState.phase = 'CHECK_LINES';

      const capEvents = stepSim(capState, createEmptyInputFrame());
      const fifthWave = capEvents.find((e) => e.type === 'BLOCKS_CLEAR');
      expect(fifthWave && fifthWave.type === 'BLOCKS_CLEAR' && fifthWave.combo).toBe(5);
      expect(fifthWave && fifthWave.type === 'BLOCKS_CLEAR' && fifthWave.waveScore).toBe(
        4 * 4 * 100 * 1 * 4,
      );
      const comboEv = capEvents.find((e) => e.type === 'COMBO_CHAIN');
      expect(comboEv && comboEv.type === 'COMBO_CHAIN' && comboEv.comboTier).toBe(2);
    });
  });

  describe('7. Level-Up, Song Sections & All 6 Game Modes', () => {
    it('levels up every 30 blocks, fires SONG_SECTION, and finishes Marathon at 450 blocks', () => {
      const state = createSimState('marathon', 'tessellation', 11);
      advancePastIntro(state);

      // Set cleared = 26 and clear a 4-block diamond -> hits 30 -> Level 1!
      state.cleared = 26;
      state.tetrad!.colors = [1, 1, 1, 1];
      let evs = stepSim(state, inputWith({ hardDropPressed: true }));
      evs.push(...stepUntilPhase(state, 'FALLING_TETRAD', 100));

      expect(state.cleared).toBe(30);
      expect(state.level).toBe(1);
      expect(evs.some((e) => e.type === 'LEVEL_UP' && e.level === 1)).toBe(true);

      // Crossing 150 -> middle song section; crossing 300 -> outro song section.
      state.cleared = 146;
      state.tetrad!.colors = [2, 2, 2, 2];
      evs = stepSim(state, inputWith({ hardDropPressed: true }));
      evs.push(...stepUntilPhase(state, 'FALLING_TETRAD', 100));
      expect(state.songSection).toBe('middle');
      expect(evs.some((e) => e.type === 'SONG_SECTION' && e.section === 'middle')).toBe(true);

      state.cleared = 296;
      state.tetrad!.colors = [3, 3, 3, 3];
      evs = stepSim(state, inputWith({ hardDropPressed: true }));
      evs.push(...stepUntilPhase(state, 'FALLING_TETRAD', 100));
      expect(state.songSection).toBe('outro');
      expect(evs.some((e) => e.type === 'SONG_SECTION' && e.section === 'outro')).toBe(true);

      // Crossing 450 finishes Marathon with VICTORY.
      state.cleared = MARATHON_TARGET_BLOCKS - 4;
      state.tetrad!.colors = [4, 4, 4, 4];
      evs = stepSim(state, inputWith({ hardDropPressed: true }));
      evs.push(...stepUntilPhase(state, 'VICTORY', 100));

      expect(state.phase).toBe('VICTORY');
      expect(state.finished).toBe(true);
      expect(state.songSection).toBe('end');
      expect(evs.some((e) => e.type === 'GAME_VICTORY' && e.mode === 'marathon')).toBe(true);
    });

    it('keeps Endless going past 450 blocks and ends cleanly on top-out', () => {
      const state = createSimState('endless', 'dissolve', 22);
      advancePastIntro(state);
      state.cleared = 448;
      state.tetrad!.colors = [1, 1, 1, 1];
      stepSim(state, inputWith({ hardDropPressed: true }));
      stepUntilPhase(state, 'FALLING_TETRAD', 100);

      expect(state.cleared).toBe(452);
      expect(state.finished).toBe(false);
      expect(state.phase).toBe('FALLING_TETRAD');

      // Block spawn cell (3, 0) and trigger NEW_TETRAD -> GAME_OVER with tetrad = null.
      setCell(state.grid, 3, 0, 2);
      state.tetrad = null;
      state.phase = 'NEW_TETRAD';
      const evs = stepSim(state, createEmptyInputFrame());
      expect(state.phase).toBe('GAME_OVER');
      expect(state.finished).toBe(true);
      expect(state.tetrad).toBeNull();
      expect(evs.some((e) => e.type === 'GAME_OVER' && e.mode === 'endless')).toBe(true);
    });

    it('starts Intense at level 15 (1-tick gravity) and finishes at 450 blocks', () => {
      const state = createSimState('intense', 'corefault', 33);
      expect(state.level).toBe(15);
      expect(state.startLevel).toBe(15);
      advancePastIntro(state);
      expect(state.tetrad!.fallTimer).toBe(FALL_SPEED_TICKS[15]);
      expect(FALL_SPEED_TICKS[15]).toBe(1);

      state.cleared = MARATHON_TARGET_BLOCKS - 4;
      state.tetrad!.colors = [1, 1, 1, 1];
      stepSim(state, inputWith({ hardDropPressed: true }));
      stepUntilPhase(state, 'VICTORY', 100);
      expect(state.phase).toBe('VICTORY');
      expect(state.finished).toBe(true);
    });

    it('keeps Relaxed at level 0 and auto-clears grid on top-out with RELAXED_RESET', () => {
      const state = createSimState('relaxed', 'minimum', 44);
      advancePastIntro(state);
      state.cleared = 56;
      state.tetrad!.colors = [1, 1, 1, 1];
      stepSim(state, inputWith({ hardDropPressed: true }));
      stepUntilPhase(state, 'FALLING_TETRAD', 100);
      expect(state.cleared).toBe(60);
      expect(state.level).toBe(0); // level never increases in Relaxed!

      // Fill spawn area to force top-out -> should emit RELAXED_RESET and continue playing!
      setCell(state.grid, 3, 0, 1);
      setCell(state.grid, 3, 1, 2);
      setCell(state.grid, 4, 1, 3);
      setCell(state.grid, 3, 2, 4);
      state.tetrad = null;
      state.phase = 'NEW_TETRAD';

      const evs = stepSim(state, createEmptyInputFrame());
      expect(evs.some((e) => e.type === 'RELAXED_RESET')).toBe(true);
      expect(evs.some((e) => e.type === 'TETRAD_SPAWN')).toBe(true);
      expect(state.phase).toBe('FALLING_TETRAD');
      expect(state.finished).toBe(false);
      expect(state.tetrad).not.toBeNull();
      expect(countBlocksOnGrid(state.grid)).toBe(0);
    });

    it('counts down Rush 2-minute timer only after INTRO_PAUSE and finishes with VICTORY', () => {
      const state = createSimState('rush', 'rush', 55);
      expect(state.remainingTicks).toBe(RUSH_DURATION_TICKS);

      advancePastIntro(state);
      expect(state.remainingTicks).toBe(RUSH_DURATION_TICKS);
      expect(state.elapsedTicks).toBe(0);

      // Step 2400 active ticks -> enters middle section.
      for (let i = 0; i < 2400; i++) {
        // Keep board clean by avoiding top-out during passive timer check.
        if (state.tetrad && state.tetrad.y === SPAWN_Y) {
          state.tetrad.colors = [1, 1, 1, 1];
        }
        stepSim(state, createEmptyInputFrame());
      }
      expect(state.remainingTicks).toBe(RUSH_DURATION_TICKS - 2400);
      expect(state.songSection).toBe('middle');

      // Fast-forward near end of Rush timer and step final ticks to VICTORY.
      state.remainingTicks = 3;
      let victoryEvent: SimEvent | undefined;
      for (let i = 0; i < 5; i++) {
        const evs = stepSim(state, createEmptyInputFrame());
        const found = evs.find((e) => e.type === 'GAME_VICTORY');
        if (found) victoryEvent = found;
      }
      expect(state.remainingTicks).toBe(0);
      expect(state.phase).toBe('VICTORY');
      expect(state.finished).toBe(true);
      expect(victoryEvent).toBeDefined();
      expect(stepSim(state, createEmptyInputFrame())).toEqual([]);
    });

    it('applies Impossible +15 level bonus, forced drop timer, 4M unlock flag, and endgame falling piece', () => {
      const state = createSimState('impossible', 'hazard', 66);
      expect(state.level).toBe(15);
      expect(state.impossibleDropTimer).toBe(IMPOSSIBLE_DROP_TIMER_TICKS[0]);
      advancePastIntro(state);

      // Clear a 4-block diamond at level 15 -> effLevel = 30 -> wave = 16 * 100 * 31 = 49600, PC = 310000
      state.tetrad!.colors = [1, 1, 1, 1];
      stepSim(state, inputWith({ hardDropPressed: true }));
      stepUntilPhase(state, 'FALLING_TETRAD', 100);
      expect(state.score).toBe(49600 + 310000);

      // Verify forced drop cadence locks piece when impossibleDropTimer expires.
      const prevDrops = state.drops;
      state.impossibleDropTimer = 1;
      const forceEvents = stepSim(state, createEmptyInputFrame());
      expect(forceEvents.some((e) => e.type === 'TETRAD_LOCK')).toBe(true);
      expect(state.phase).toBe('BLOCK_HIT');
      expect(state.drops).toBe(prevDrops + 1);

      // Verify 4,000,000 impossibleUnlockedThisRun flag flips cleanly.
      stepUntilPhase(state, 'FALLING_TETRAD', 100);
      clearPlayableGrid(state.grid);
      state.score = IMPOSSIBLE_UNLOCK_SCORE - 100;
      state.tetrad!.colors = [2, 2, 2, 2];
      stepSim(state, inputWith({ hardDropPressed: true }));
      stepUntilPhase(state, 'FALLING_TETRAD', 100);
      expect(state.impossibleUnlockedThisRun).toBe(true);

      // Top-out in Impossible preserves `state.tetrad` (showFallingOnEndgame = true).
      setCell(state.grid, 3, 0, 3);
      state.tetrad = null;
      state.phase = 'NEW_TETRAD';
      const overEvents = stepSim(state, createEmptyInputFrame());
      expect(state.phase).toBe('GAME_OVER');
      expect(state.finished).toBe(true);
      expect(state.tetrad).not.toBeNull();
      expect(overEvents.some((e) => e.type === 'GAME_OVER')).toBe(true);
    });
  });

  describe('8. Board Shake, Automata Ripple & Tutorial Progression', () => {
    it('decays board shake by 0.916 per tick and clamps values < 0.01 to 0', () => {
      const state = createSimState('marathon', 'tessellation', 99);
      state.boardOffsetX = 1.0;
      state.boardOffsetY = -2.0;

      stepSim(state, createEmptyInputFrame());
      expect(state.prevBoardOffsetX).toBe(1.0);
      expect(state.prevBoardOffsetY).toBe(-2.0);
      expect(state.boardOffsetX).toBeCloseTo(BOARD_SHAKE_DECAY, 10);
      expect(state.boardOffsetY).toBeCloseTo(-2.0 * BOARD_SHAKE_DECAY, 10);

      for (let i = 0; i < 120; i++) {
        stepSim(state, createEmptyInputFrame());
      }
      expect(state.boardOffsetX).toBe(0);
      expect(state.boardOffsetY).toBe(0);
    });

    it('diffuses automata ripple across 4 diagonal neighbors and seeds on drop/clear', () => {
      const grid = createEmptyGrid();
      const automata = new Array<number>(BOARD_CELL_COUNT).fill(0);
      seedAutomataCell(automata, grid, 3, 14, AUTOMATA_SEED_CLEAR);
      expect(automata[gridIndex(3, 14)]).toBe(100);

      stepAutomataGrid(automata, grid);
      const lx = getNeighborX(3, 14, -1);
      const rx = getNeighborX(3, 14, 1);

      expect(automata[gridIndex(lx, 13)]).toBeCloseTo(18.75, 6);
      expect(automata[gridIndex(rx, 13)]).toBeCloseTo(18.75, 6);
      expect(automata[gridIndex(lx, 15)]).toBeCloseTo(18.75, 6);
      expect(automata[gridIndex(rx, 15)]).toBeCloseTo(18.75, 6);
      // Wall cells always stay 0.
      expect(automata[gridIndex(0, 0)]).toBe(0);

      // Verify simulation triggers automata on hard drop (45) and clear (100) every AUTOMATA_TICK_INTERVAL ticks.
      const state = createSimState('marathon', 'tessellation', 123);
      advancePastIntro(state);
      state.tetrad!.colors = [1, 1, 1, 1];
      stepSim(state, inputWith({ hardDropPressed: true }));
      expect(state.automata[gridIndex(3, 28)]).toBe(AUTOMATA_SEED_DROP);

      let sawClearSeed = false;
      for (let i = 0; i < 30; i++) {
        const evs = stepSim(state, createEmptyInputFrame());
        if (evs.some((e) => e.type === 'BLOCKS_CLEAR')) {
          expect(state.automata[gridIndex(3, 28)]).toBe(AUTOMATA_SEED_CLEAR);
          sawClearSeed = true;
          break;
        }
      }
      expect(sawClearSeed).toBe(true);
      expect(AUTOMATA_TICK_INTERVAL).toBe(3);
    });

    it('advances tutorial through MOVE -> SPIN -> DROP -> MATCH -> ADVANCED -> DONE', () => {
      const state = createSimState('marathon', 'tessellation', 202, true);
      expect(state.tutorial.enabled).toBe(true);
      expect(state.tutorial.step).toBe('MOVE');

      advancePastIntro(state);
      const stepsSeen: string[] = [];
      const capture = (evs: SimEvent[]) => {
        for (const e of evs) {
          if (e.type === 'TUTORIAL_ADVANCE') {
            stepsSeen.push(e.step);
          }
        }
      };

      // MOVE -> SPIN (2 valid moves)
      capture(stepSim(state, inputWith({ moveRightPressed: true, moveRight: true })));
      capture(stepSim(state, inputWith({ moveLeftPressed: true, moveLeft: true })));
      expect(state.tutorial.step).toBe('SPIN');

      // SPIN -> DROP (2 spins)
      capture(stepSim(state, inputWith({ spinRightPressed: true })));
      capture(stepSim(state, inputWith({ spinLeftPressed: true })));
      expect(state.tutorial.step).toBe('DROP');

      // DROP -> MATCH (hard drop a 4-color-same diamond -> triggers DROP then MATCH on clear!)
      state.tetrad!.colors = [1, 1, 1, 1];
      capture(stepSim(state, inputWith({ hardDropPressed: true })));
      expect(state.tutorial.step).toBe('MATCH');

      capture(stepUntilPhase(state, 'FALLING_TETRAD', 100));
      expect(state.tutorial.step).toBe('ADVANCED');

      // ADVANCED -> DONE (clear a 4-block diamond)
      state.tetrad!.colors = [2, 2, 2, 2];
      capture(stepSim(state, inputWith({ hardDropPressed: true })));
      capture(stepUntilPhase(state, 'FALLING_TETRAD', 100));
      expect(state.tutorial.step).toBe('DONE');
      expect(state.tutorial.completed).toBe(true);
      expect(stepsSeen).toEqual(['SPIN', 'DROP', 'MATCH', 'ADVANCED', 'DONE']);
    });
  });

  describe('9. Bit-for-Bit Determinism & Pure DOM-Free Verification', () => {
    it('replays 600 ticks of scripted inputs with bit-for-bit identical hashSimState on every tick', () => {
      const runReplay = (seed: number) => {
        const state = createSimState('marathon', 'tessellation', seed);
        const hashes: string[] = [hashSimState(state)];
        const eventLog: SimEvent[] = [];

        for (let t = 0; t < 600; t++) {
          const frame = inputWith({
            moveLeftPressed: t % 23 === 5,
            moveLeft: t % 23 >= 5 && t % 23 <= 7,
            moveRightPressed: t % 29 === 11,
            moveRight: t % 29 >= 11 && t % 29 <= 13,
            spinRightPressed: t % 17 === 3,
            spinLeftPressed: t % 31 === 9,
            hardDropPressed: t % 43 === 40,
          });
          const evs = stepSim(state, frame);
          eventLog.push(...evs);
          hashes.push(hashSimState(state));
        }
        return { state, hashes, eventLog };
      };

      const runA = runReplay(0x1337beef);
      const runB = runReplay(0x1337beef);
      const runDiffSeed = runReplay(0xdeadcafe);

      expect(runA.hashes).toEqual(runB.hashes);
      expect(runA.eventLog).toEqual(runB.eventLog);
      expect(runA.hashes[runA.hashes.length - 1]).toMatch(/^[0-9a-f]{16}$/);
      expect(runA.hashes[runA.hashes.length - 1]).not.toBe(
        runDiffSeed.hashes[runDiffSeed.hashes.length - 1],
      );
    });

    it('keeps every src/sim/*.ts module 100% pure and free of DOM/Canvas/WebGL/Audio/Math.random', () => {
      const simDir = path.resolve(process.cwd(), 'src', 'sim');
      const files = fs.readdirSync(simDir).filter((f) => f.endsWith('.ts'));
      expect(files.length).toBeGreaterThanOrEqual(9);

      const forbidden = [
        /\bwindow\b/,
        /\bdocument\b/,
        /\bHTMLCanvasElement\b/,
        /\bWebGL/,
        /\bAudioContext\b/,
        /\bMath\.random\b/,
      ];

      for (const file of files) {
        const source = fs.readFileSync(path.join(simDir, file), 'utf8');
        // Strip single-line and block comments before checking code identifiers.
        const codeOnly = source
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        for (const pattern of forbidden) {
          expect(codeOnly, `${file} must not reference ${pattern}`).not.toMatch(pattern);
        }
      }
    });
  });
});
