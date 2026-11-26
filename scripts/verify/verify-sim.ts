/**
 * Krunked Lumia — Gate B: Headless Autonomous 6-Mode Soak & FNV-1a Determinism Verification
 * Executed via: `npm run verify:sim`
 *
 * Pure Node/TypeScript headless verification (ZERO DOM, ZERO WebGL, ZERO AudioContext).
 */

import {
  BOARD_CELL_COUNT,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_EMPTY,
  CELL_WALL,
  GAME_MODE_CONFIGS,
  GAME_MODE_ORDER,
  INTRO_PAUSE_TICKS,
  MARATHON_TARGET_BLOCKS,
  RUSH_DURATION_TICKS,
  createEmptyInputFrame,
  type BlockColor,
  type CellValue,
  type GameModeId,
  type InputFrame,
  type SimEvent,
  type SimPhase,
  type SimState,
  type SongSection,
  type TrackId,
} from '../../src/contracts/index.js';
import {
  applyMatchesToGrid,
  computeGhostPosition,
  createSimState,
  findSimultaneousMatches,
  getCell,
  getFallSpeedTicks,
  getNeighborX,
  getTetradCells,
  hashSimState,
  isBlockColor,
  isPlayableCell,
  spinTetradColors,
  stepSim,
  stepSlideOffResolve,
  stepTetradDown,
  tryMoveTetradLateral,
} from '../../src/sim/index.js';

const SOAK_SEEDS: readonly number[] = [101, 202, 303] as const;

const MODE_TRACK: Record<GameModeId, TrackId> = {
  marathon: 'tessellation',
  endless: 'dissolve',
  intense: 'corefault',
  relaxed: 'minimum',
  rush: 'rush',
  impossible: 'hazard',
};

const MAX_PHASE_STALL_TICKS = 300;
const DETERMINISM_CHECKPOINT_INTERVAL = 60;

// Reusable scratch grid buffer for zero-churn bot candidate evaluation
const evalScratchGrid: CellValue[] = new Array<CellValue>(BOARD_CELL_COUNT);

function fail(message: string): never {
  console.error(`\n[GATE B FAILURE] ${message}`);
  process.exit(1);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    fail(message);
  }
}

// ============================================================================
// DETERMINISTIC INTELLIGENT DIAMOND BOT POLICY
// ============================================================================

interface CandidateMove {
  dir: -1 | 0 | 1;
  steps: number;
  x: number;
  y: number;
}

function evaluateBoardPlacement(
  baseGrid: readonly CellValue[],
  baseLastFallLeft: boolean,
  landX: number,
  landY: number,
  colors: readonly [BlockColor, BlockColor, BlockColor, BlockColor],
): number {
  for (let i = 0; i < BOARD_CELL_COUNT; i++) {
    evalScratchGrid[i] = baseGrid[i];
  }

  const cells = getTetradCells(landX, landY);
  for (let i = 0; i < 4; i++) {
    evalScratchGrid[cells[i].y * BOARD_WIDTH + cells[i].x] = colors[i];
  }

  // Run full slide-off + cascade simulation on scratch grid
  let lastFall = baseLastFallLeft;
  let totalCleared = 0;
  let waves = 0;
  for (let iter = 0; iter < 12; iter++) {
    for (let s = 0; s < 40; s++) {
      const res = stepSlideOffResolve(evalScratchGrid, lastFall);
      lastFall = res.lastFallLeft;
      if (res.moves.length === 0) break;
    }
    const matches = findSimultaneousMatches(evalScratchGrid);
    if (matches.cells.length === 0) break;
    waves += 1;
    totalCleared += matches.cells.length;
    applyMatchesToGrid(evalScratchGrid, matches.cells);
  }

  // Evaluate resulting settled board quality: color adjacency, near-matches, height & survival
  let remainingBlocks = 0;
  let minOccupiedY = BOARD_HEIGHT;
  let heightPenaltySum = 0;
  let diagAdjPairs = 0;
  let nearTriples = 0;
  let nearDiamonds = 0;

  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const rowOff = y * BOARD_WIDTH;
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const c = evalScratchGrid[rowOff + x];
      if (!isBlockColor(c)) continue;

      remainingBlocks += 1;
      if (y < minOccupiedY) minOccupiedY = y;
      const elevation = BOARD_HEIGHT - y;
      heightPenaltySum += elevation * elevation * 0.14;

      const lx = getNeighborX(x, y, -1);
      const rx = getNeighborX(x, y, 1);

      const dl = getCell(evalScratchGrid, lx, y + 1);
      const dr = getCell(evalScratchGrid, rx, y + 1);
      const bot = getCell(evalScratchGrid, x, y + 2);

      // Same-color diagonal adjacency (counted downward to avoid double counting)
      if (dl === c) {
        diagAdjPairs += 1;
        // Check if either end of this `/` pair has an empty slot for a 3-in-a-row
        const ur = getCell(evalScratchGrid, rx, y - 1);
        const dlLx = getNeighborX(lx, y + 1, -1);
        const dl2 = getCell(evalScratchGrid, dlLx, y + 2);
        if (ur === CELL_EMPTY || dl2 === CELL_EMPTY) nearTriples += 1;
      }
      if (dr === c) {
        diagAdjPairs += 1;
        // Check if either end of this `\` pair has an empty slot for a 3-in-a-row
        const ul = getCell(evalScratchGrid, lx, y - 1);
        const drRx = getNeighborX(rx, y + 1, 1);
        const dr2 = getCell(evalScratchGrid, drRx, y + 2);
        if (ul === CELL_EMPTY || dr2 === CELL_EMPTY) nearTriples += 1;
      }

      // Check 3-of-4 partial 2x2 diamond anchored at (x, y)
      let diamondMatches = 1;
      let diamondEmpties = 0;
      if (dl === c) diamondMatches += 1;
      else if (dl === CELL_EMPTY) diamondEmpties += 1;
      if (dr === c) diamondMatches += 1;
      else if (dr === CELL_EMPTY) diamondEmpties += 1;
      if (bot === c) diamondMatches += 1;
      else if (bot === CELL_EMPTY) diamondEmpties += 1;
      if (diamondMatches === 3 && diamondEmpties === 1) {
        nearDiamonds += 1;
      }
    }
  }

  let score = 0;
  score += totalCleared * 950;
  if (waves >= 2) {
    score += waves * waves * 900;
  }
  if (remainingBlocks === 0) {
    score += 12000; // Perfect clear bonus!
  }

  score += diagAdjPairs * 42;
  score += nearTriples * 28;
  score += nearDiamonds * 55;
  score -= remainingBlocks * 24;
  score -= heightPenaltySum;

  // Strong survival penalty when stack rises toward spawn zone
  if (minOccupiedY <= 12) {
    score -= (13 - minOccupiedY) * 140;
  }
  if (minOccupiedY <= 7) {
    score -= (8 - minOccupiedY) * 1200;
  }

  // Slight preference for deeper landing positions
  score += landY * 2.5;
  return score;
}

/**
 * Pure deterministic bot policy evaluating lateral trajectories & all 4 spin orientations
 * to maximize clears, cascades, diagonal color adjacency, and survival.
 */
export function chooseBotInput(state: SimState): InputFrame {
  const frame = createEmptyInputFrame();
  if (state.phase !== 'FALLING_TETRAD' || state.tetrad === null) {
    return frame;
  }

  const tetrad = state.tetrad;
  const fallInterval = getFallSpeedTicks(state.level);
  const maxAllowedTicks =
    state.mode === 'impossible' ? Math.max(1, state.impossibleDropTimer) : 12;

  const candidates: CandidateMove[] = [
    { dir: 0, steps: 0, x: tetrad.x, y: tetrad.y },
  ];

  // Explore left (-1) and right (+1) trajectories modeling end-of-tick gravity
  for (const dir of [-1, 1] as const) {
    let cx = tetrad.x;
    let cy = tetrad.y;
    let simFall = tetrad.fallTimer;
    for (let step = 1; step <= 7 && step <= maxAllowedTicks; step++) {
      const mv = tryMoveTetradLateral(state.grid, cx, cy, dir);
      if (!mv.moved) break;
      cx = mv.x;
      cy = mv.y;
      candidates.push({ dir, steps: step, x: cx, y: cy });

      simFall -= 1;
      if (simFall <= 0) {
        const down = stepTetradDown(state.grid, cx, cy);
        if (down.moved) {
          cx = down.x;
          cy = down.y;
        }
        simFall = fallInterval;
      }
    }
  }

  const spinVariants: ReadonlyArray<{
    spinSteps: -1 | 0 | 1 | 2;
    colors: [BlockColor, BlockColor, BlockColor, BlockColor];
  }> = [
    { spinSteps: 0, colors: tetrad.colors },
    { spinSteps: 1, colors: spinTetradColors(tetrad.colors, 1) },
    { spinSteps: -1, colors: spinTetradColors(tetrad.colors, -1) },
    {
      spinSteps: 2,
      colors: spinTetradColors(spinTetradColors(tetrad.colors, 1), 1),
    },
  ];

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDir: -1 | 0 | 1 = 0;
  let bestSteps = 0;
  let bestSpin: -1 | 0 | 1 | 2 = 0;

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const cand = candidates[cIdx];
    const landing = computeGhostPosition(state.grid, cand.x, cand.y);

    for (let sIdx = 0; sIdx < spinVariants.length; sIdx++) {
      const sv = spinVariants[sIdx];
      const ticksNeeded = Math.max(1, cand.steps, Math.abs(sv.spinSteps));
      if (ticksNeeded > maxAllowedTicks) {
        continue;
      }

      const value =
        evaluateBoardPlacement(
          state.grid,
          state.lastFallLeft,
          landing.x,
          landing.y,
          sv.colors,
        ) -
        ticksNeeded * 1.25;

      if (value > bestScore) {
        bestScore = value;
        bestDir = cand.dir;
        bestSteps = cand.steps;
        bestSpin = sv.spinSteps;
      }
    }
  }

  if (bestDir === -1) {
    frame.moveLeft = true;
    frame.moveLeftPressed = true;
  } else if (bestDir === 1) {
    frame.moveRight = true;
    frame.moveRightPressed = true;
  }

  if (bestSpin === 1 || bestSpin === 2) {
    frame.spinRightPressed = true;
  } else if (bestSpin === -1) {
    frame.spinLeftPressed = true;
  }

  // Because stepSim runs lateral move -> spin -> hardDrop in order on the same tick,
  // any target within <=1 lateral step and <=1 spin lands cleanly on THIS exact tick!
  if (
    (bestSteps <= 1 && Math.abs(bestSpin) <= 1) ||
    (tetrad.slackActive && tetrad.slackTimer <= 2)
  ) {
    frame.hardDropPressed = true;
  }

  return frame;
}

// ============================================================================
// PER-TICK INVARIANT VERIFIER
// ============================================================================

function hasUnsupportedBlock(grid: readonly CellValue[]): boolean {
  for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
    const rowOff = y * BOARD_WIDTH;
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const cell = grid[rowOff + x];
      if (!isBlockColor(cell)) continue;
      const lx = getNeighborX(x, y, -1);
      const rx = getNeighborX(x, y, 1);
      const lOpen = getCell(grid, lx, y + 1) === CELL_EMPTY;
      const rOpen = getCell(grid, rx, y + 1) === CELL_EMPTY;
      if (lOpen || rOpen) {
        return true;
      }
    }
  }
  return false;
}

function assertTickInvariants(state: SimState, context: string): void {
  // 1. ZERO NaN / Infinity in numeric state fields and automata[0..231]
  assert(Number.isFinite(state.score) && state.score >= 0, `${context}: invalid score=${state.score}`);
  assert(
    Number.isFinite(state.cleared) && state.cleared >= 0,
    `${context}: invalid cleared=${state.cleared}`,
  );
  assert(
    Number.isFinite(state.level) && state.level >= state.startLevel,
    `${context}: invalid level=${state.level} (start=${state.startLevel})`,
  );
  assert(
    Number.isFinite(state.boardOffsetX) && Number.isFinite(state.boardOffsetY),
    `${context}: invalid boardOffset=(${state.boardOffsetX}, ${state.boardOffsetY})`,
  );
  assert(
    state.automata.length === BOARD_CELL_COUNT,
    `${context}: automata length=${state.automata.length}`,
  );
  for (let i = 0; i < BOARD_CELL_COUNT; i++) {
    const a = state.automata[i];
    if (!Number.isFinite(a) || a < 0) {
      fail(`${context}: invalid automata[${i}]=${a}`);
    }
  }

  // 2. Wall mask invariant (non-playable === CELL_WALL, playable in 1..5)
  assert(state.grid.length === BOARD_CELL_COUNT, `${context}: grid length=${state.grid.length}`);
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const rowOff = y * BOARD_WIDTH;
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const v = state.grid[rowOff + x];
      if (!isPlayableCell(x, y)) {
        if (v !== CELL_WALL) {
          fail(`${context}: wall mask violated at (${x},${y}) value=${v}`);
        }
      } else if (v < 1 || v > 5) {
        fail(`${context}: invalid playable cell at (${x},${y}) value=${v}`);
      }
    }
  }

  // 3. Active FALLING_TETRAD invariant
  if (state.phase === 'FALLING_TETRAD') {
    assert(state.tetrad !== null, `${context}: phase=FALLING_TETRAD but tetrad is null`);
    const cells = getTetradCells(state.tetrad!.x, state.tetrad!.y);
    for (let i = 0; i < 4; i++) {
      const c = cells[i];
      if (!isPlayableCell(c.x, c.y)) {
        fail(`${context}: tetrad cell ${i} out of playable bounds at (${c.x},${c.y})`);
      }
      const gridVal = getCell(state.grid, c.x, c.y);
      if (gridVal !== CELL_EMPTY) {
        fail(`${context}: tetrad overlaps occupied cell at (${c.x},${c.y}) val=${gridVal}`);
      }
    }
    assert(
      state.ghostY >= state.tetrad!.y,
      `${context}: ghostY (${state.ghostY}) < tetrad.y (${state.tetrad!.y})`,
    );
  }

  // 4. Settled board invariant on NEW_TETRAD
  if (state.phase === 'NEW_TETRAD') {
    if (hasUnsupportedBlock(state.grid)) {
      fail(`${context}: floating unsupported block found during NEW_TETRAD`);
    }
  }
}

// ============================================================================
// HEADLESS SOAK RUNNER
// ============================================================================

interface SoakRunMetrics {
  mode: GameModeId;
  seed: number;
  ticks: number;
  elapsedTicks: number;
  remainingTicks: number;
  cleared: number;
  score: number;
  level: number;
  maxCombo: number;
  perfectClears: number;
  levelUps: number;
  sections: SongSection[];
  relaxedResets: number;
  finalPhase: SimPhase;
  finalHash: string;
}

function runAutonomousSoak(
  mode: GameModeId,
  seed: number,
  maxTicks: number,
  policy: (state: SimState) => InputFrame = chooseBotInput,
): SoakRunMetrics {
  const trackId = MODE_TRACK[mode];
  const state = createSimState(mode, trackId, seed, false);

  let lastPhase: SimPhase = state.phase;
  let phaseStallTicks = 0;
  let lastProgressSig = '';
  let levelUps = 0;
  let relaxedResets = 0;
  const sections: SongSection[] = [state.songSection];

  for (let t = 0; t < maxTicks && !state.finished; t++) {
    const input = policy(state);
    const events: SimEvent[] = stepSim(state, input);

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'LEVEL_UP') {
        levelUps += 1;
      } else if (ev.type === 'SONG_SECTION') {
        sections.push(ev.section);
      } else if (ev.type === 'RELAXED_RESET') {
        relaxedResets += 1;
      } else if (ev.type === 'TETRAD_SPAWN') {
        assert(
          !hasUnsupportedBlock(state.grid),
          `${mode}[seed=${seed}] tick=${state.tick}: floating block on TETRAD_SPAWN`,
        );
      }
    }

    assertTickInvariants(state, `${mode}[seed=${seed}] tick=${state.tick}`);

    // Deadlock check: non-terminal phase must never stall > 300 ticks without progress
    const progressSig =
      `${state.phase}|${state.drops}|${state.cleared}|${state.tetrad?.x ?? -1},${state.tetrad?.y ?? -1}`;
    if (!state.finished && state.phase === lastPhase && progressSig === lastProgressSig) {
      phaseStallTicks += 1;
      if (phaseStallTicks > MAX_PHASE_STALL_TICKS) {
        fail(
          `${mode}[seed=${seed}] tick=${state.tick}: phase deadlock in ${state.phase} for >${MAX_PHASE_STALL_TICKS} ticks`,
        );
      }
    } else {
      lastPhase = state.phase;
      lastProgressSig = progressSig;
      phaseStallTicks = 0;
    }
  }

  return {
    mode,
    seed,
    ticks: state.tick,
    elapsedTicks: state.elapsedTicks,
    remainingTicks: state.remainingTicks,
    cleared: state.cleared,
    score: state.score,
    level: state.level,
    maxCombo: state.maxCombo,
    perfectClears: state.perfectClears,
    levelUps,
    sections,
    relaxedResets,
    finalPhase: state.phase,
    finalHash: hashSimState(state),
  };
}

/**
 * Adversarial policy for Relaxed mode: immediately hard-drops every piece straight down
 * center column to rapidly force top-out and prove RELAXED_RESET survival.
 */
function forcedTopOutPolicy(state: SimState): InputFrame {
  const frame = createEmptyInputFrame();
  if (state.phase === 'FALLING_TETRAD' && state.tetrad !== null) {
    // Alternate slight left/right nudge so pieces avoid accidental 4-match clears and stack up quickly
    if (state.drops % 3 === 1) {
      frame.moveLeft = true;
      frame.moveLeftPressed = true;
    } else if (state.drops % 3 === 2) {
      frame.moveRight = true;
      frame.moveRightPressed = true;
    }
    frame.hardDropPressed = true;
  }
  return frame;
}

// ============================================================================
// BIT-FOR-BIT DETERMINISM TAPE REPLAY PROOF
// ============================================================================

interface DeterminismResult {
  mode: GameModeId;
  seed: number;
  ticks: number;
  checkpointsVerified: number;
  finalHash: string;
}

function proveBitForBitDeterminism(
  mode: GameModeId,
  seed: number,
  ticksToRecord: number,
): DeterminismResult {
  const trackId = MODE_TRACK[mode];

  // Run 1: Record full InputFrame tape & 60-tick checkpoint hashes
  const run1 = createSimState(mode, trackId, seed, false);
  const tape: InputFrame[] = [];
  const checkpoints1 = new Map<number, string>();

  for (let t = 1; t <= ticksToRecord; t++) {
    const input = chooseBotInput(run1);
    tape.push({ ...input });
    stepSim(run1, input);
    if (t % DETERMINISM_CHECKPOINT_INTERVAL === 0) {
      checkpoints1.set(t, hashSimState(run1));
    }
  }
  const finalHash1 = hashSimState(run1);

  // Run 2: Replay exact recorded tape from scratch on fresh SimState
  const run2 = createSimState(mode, trackId, seed, false);
  let checkpointsVerified = 0;

  for (let t = 1; t <= tape.length; t++) {
    stepSim(run2, tape[t - 1]);
    if (t % DETERMINISM_CHECKPOINT_INTERVAL === 0) {
      const h2 = hashSimState(run2);
      const h1 = checkpoints1.get(t);
      assert(
        h1 === h2,
        `Determinism mismatch in ${mode} (seed=${seed}) at checkpoint tick ${t}: ${h1} !== ${h2}`,
      );
      checkpointsVerified += 1;
    }
  }

  const finalHash2 = hashSimState(run2);
  assert(
    finalHash1 === finalHash2,
    `Determinism final hash mismatch in ${mode} (seed=${seed}): ${finalHash1} !== ${finalHash2}`,
  );
  assert(
    run1.score === run2.score && run1.cleared === run2.cleared && run1.phase === run2.phase,
    `Determinism state divergence in ${mode} (seed=${seed})`,
  );

  return {
    mode,
    seed,
    ticks: tape.length,
    checkpointsVerified,
    finalHash: finalHash1,
  };
}

// ============================================================================
// MAIN GATE B ORCHESTRATION
// ============================================================================

function pad(str: string, width: number, right = false): string {
  return right ? str.padStart(width) : str.padEnd(width);
}

function main(): void {
  const startMs = Date.now();
  const modeBudgets: Record<GameModeId, number> = {
    marathon: 20_000,
    endless: 5_000,
    intense: 20_000,
    relaxed: 4_000,
    rush: INTRO_PAUSE_TICKS + RUSH_DURATION_TICKS + 60,
    impossible: 20_000,
  };

  const allRuns: SoakRunMetrics[] = [];

  for (const mode of GAME_MODE_ORDER) {
    const modeRuns: SoakRunMetrics[] = [];
    for (const seed of SOAK_SEEDS) {
      const metrics = runAutonomousSoak(mode, seed, modeBudgets[mode]);
      allRuns.push(metrics);
      modeRuns.push(metrics);

      // Mode-specific strict assertions
      if (mode === 'rush') {
        assert(
          metrics.finalPhase === 'VICTORY',
          `rush[seed=${seed}] must reach VICTORY at 7200 active ticks, got ${metrics.finalPhase} (elapsed=${metrics.elapsedTicks})`,
        );
        assert(
          metrics.remainingTicks === 0,
          `rush[seed=${seed}] remainingTicks expected 0, got ${metrics.remainingTicks}`,
        );
        assert(
          metrics.elapsedTicks === RUSH_DURATION_TICKS,
          `rush[seed=${seed}] elapsedTicks expected ${RUSH_DURATION_TICKS}, got ${metrics.elapsedTicks}`,
        );
        assert(
          metrics.sections.includes('middle') &&
            metrics.sections.includes('outro') &&
            metrics.sections.includes('end'),
          `rush[seed=${seed}] must emit middle/outro/end SONG_SECTION transitions, got ${metrics.sections.join('->')}`,
        );
      } else if (mode === 'marathon' || mode === 'intense' || mode === 'impossible') {
        assert(
          metrics.finalPhase === 'VICTORY' && metrics.cleared >= MARATHON_TARGET_BLOCKS,
          `${mode}[seed=${seed}] must reach 450-clear VICTORY, got phase=${metrics.finalPhase} cleared=${metrics.cleared}`,
        );
        assert(
          metrics.levelUps >= 15,
          `${mode}[seed=${seed}] must advance >=15 levels across 450 clears, got ${metrics.levelUps}`,
        );
        assert(
          metrics.sections.includes('middle') &&
            metrics.sections.includes('outro') &&
            metrics.sections.includes('end'),
          `${mode}[seed=${seed}] must emit middle/outro/end SONG_SECTION transitions, got ${metrics.sections.join('->')}`,
        );
      } else if (mode === 'relaxed') {
        assert(
          metrics.finalPhase !== 'GAME_OVER',
          `relaxed[seed=${seed}] must never enter GAME_OVER`,
        );
        assert(
          metrics.level === GAME_MODE_CONFIGS.relaxed.startLevel,
          `relaxed[seed=${seed}] must keep level locked at 0, got ${metrics.level}`,
        );
      } else if (mode === 'endless') {
        assert(
          metrics.cleared > 0 && metrics.score > 0,
          `endless[seed=${seed}] bot must generate real clears & score`,
        );
        assert(
          metrics.levelUps >= 1,
          `endless[seed=${seed}] must advance levels during soak`,
        );
      }
    }

    // Aggregate sanity across the 3 seeds for this mode
    const totalClears = modeRuns.reduce((sum, r) => sum + r.cleared, 0);
    assert(totalClears > 0, `${mode} produced zero clears across all seeds`);
  }

  // Cross-mode scoring progression check on seed 101: Impossible (+15 bonus) > Intense (lvl 15+) > Marathon (lvl 0+)
  const mar101 = allRuns.find((r) => r.mode === 'marathon' && r.seed === 101)!;
  const int101 = allRuns.find((r) => r.mode === 'intense' && r.seed === 101)!;
  const imp101 = allRuns.find((r) => r.mode === 'impossible' && r.seed === 101)!;
  assert(
    imp101.score > int101.score && int101.score > mar101.score,
    `Expected Impossible (${imp101.score}) > Intense (${int101.score}) > Marathon (${mar101.score}) score on seed 101`,
  );

  // Adversarial Forced Top-Out Soak for Relaxed Mode (proves RELAXED_RESET with phase !== 'GAME_OVER')
  const relaxedResetRun = runAutonomousSoak('relaxed', 909, 3_000, forcedTopOutPolicy);
  assert(
    relaxedResetRun.relaxedResets >= 1,
    `Relaxed forced top-out soak must trigger >=1 RELAXED_RESET, got ${relaxedResetRun.relaxedResets}`,
  );
  assert(
    relaxedResetRun.finalPhase !== 'GAME_OVER',
    `Relaxed forced top-out must survive without GAME_OVER, got ${relaxedResetRun.finalPhase}`,
  );
  assert(
    relaxedResetRun.level === 0,
    `Relaxed forced top-out must preserve level=0, got ${relaxedResetRun.level}`,
  );

  // Bit-for-Bit Determinism Replay Proof across 4 modes (900 ticks each, 15 checkpoints each)
  const determinismRuns: DeterminismResult[] = [
    proveBitForBitDeterminism('marathon', 101, 900),
    proveBitForBitDeterminism('rush', 202, 900),
    proveBitForBitDeterminism('impossible', 303, 900),
    proveBitForBitDeterminism('endless', 101, 900),
  ];

  const elapsedMs = Date.now() - startMs;

  // Print crisp summary table
  console.log('=======================================================================================================');
  console.log('Krunked Lumia — Gate B: Headless 6-Mode Autonomous Soak & FNV-1a Determinism Summary');
  console.log('=======================================================================================================');
  console.log(
    `${pad('MODE', 12)} ${pad('SEEDS', 6, true)} ${pad('TICKS', 8, true)} ${pad('CLEARS', 8, true)} ` +
      `${pad('MAXCMB', 7, true)} ${pad('SCORE (s101)', 13, true)} ${pad('OUTCOME', 16)} ${pad('FINAL HASH (s101)', 18)}`,
  );
  console.log('-------------------------------------------------------------------------------------------------------');

  let grandTotalTicks = 0;
  let grandTotalClears = 0;
  let grandMaxCombo = 0;

  for (const mode of GAME_MODE_ORDER) {
    const group = allRuns.filter((r) => r.mode === mode);
    const ticks = group.reduce((acc, r) => acc + r.ticks, 0);
    const clears = group.reduce((acc, r) => acc + r.cleared, 0);
    const maxCombo = group.reduce((acc, r) => Math.max(acc, r.maxCombo), 0);
    const outcome =
      mode === 'marathon' || mode === 'intense' || mode === 'impossible' || mode === 'rush'
        ? `VICTORY (${group.length}/${group.length})`
        : 'SOAK OK';

    grandTotalTicks += ticks;
    grandTotalClears += clears;
    if (maxCombo > grandMaxCombo) grandMaxCombo = maxCombo;

    console.log(
      `${pad(mode, 12)} ${pad(String(group.length), 6, true)} ${pad(String(ticks), 8, true)} ` +
        `${pad(String(clears), 8, true)} ${pad(`${maxCombo}x`, 7, true)} ` +
        `${pad(group[0].score.toLocaleString('en-US'), 13, true)} ` +
        `${pad(outcome, 16)} ${pad(group[0].finalHash, 18)}`,
    );
  }

  console.log('-------------------------------------------------------------------------------------------------------');
  console.log(
    `[Relaxed Top-Out]  ticks=${relaxedResetRun.ticks} | RELAXED_RESET=${relaxedResetRun.relaxedResets} | ` +
      `phase=${relaxedResetRun.finalPhase} | level=${relaxedResetRun.level} | hash=${relaxedResetRun.finalHash}`,
  );
  console.log(
    `[Determinism 60Hz] ${determinismRuns
      .map((d) => `${d.mode}(${d.ticks}t/${d.checkpointsVerified}chk)=${d.finalHash}`)
      .join(' | ')}`,
  );
  console.log('-----------------------------------------------------------------------------------------');
  console.log(
    `GATE B PASSED (modes=6, runs=${allRuns.length + 1}, ticks=${grandTotalTicks + relaxedResetRun.ticks}, ` +
      `clears=${grandTotalClears}, maxCombo=${grandMaxCombo}x, replayModes=${determinismRuns.length}, ${elapsedMs}ms)`,
  );
}

main();
