/**
 * Pure 60 Hz Deterministic Simulation State Machine for Krunked Lumia.
 * ZERO DOM, ZERO Canvas/WebGL/AudioContext, ZERO Math.random().
 */

import {
  ARR_MOVE_SPEED_TICKS,
  AUTOMATA_SEED_CLEAR,
  AUTOMATA_SEED_DROP,
  AUTOMATA_TICK_INTERVAL,
  BLOCK_HIT_TICKS,
  BOARD_SHAKE_DECAY,
  CHECK_LINES_PAUSE_TICKS,
  GAME_MODE_CONFIGS,
  IMPOSSIBLE_DROP_TIMER_TICKS,
  IMPOSSIBLE_UNLOCK_SCORE,
  INTRO_PAUSE_TICKS,
  RESOLVE_STEP_TICKS,
  SLACK_DURATION_TICKS,
  SPAWN_X,
  SPAWN_Y,
  type GameModeId,
  type InputFrame,
  type SimEvent,
  type SimState,
  type SongSection,
  type TrackId,
  type TutorialStep,
} from '../contracts/index.js';
import {
  createEmptyAutomata,
  seedAutomataCells,
  stepAutomataGrid,
} from './automata.js';
import {
  clearPlayableGrid,
  countBlocksOnGrid,
  createEmptyGrid,
  stepSlideOffResolve,
} from './grid.js';
import {
  applyMatchesToGrid,
  computeMatchCentroid,
  findSimultaneousMatches,
} from './matching.js';
import { normalizeSeed } from './prng.js';
import {
  computeClearTier,
  computeComboTier,
  computeLevelForCleared,
  computeNextSongSection,
  computePerfectClearBonus,
  computeWaveScore,
  getFallSpeedTicks,
  getImpossibleDropTimerTicks,
} from './scoring.js';
import {
  canPlaceTetrad,
  canStepTetradDown,
  computeGhostPosition,
  computeGhostY,
  createShuffledDeck,
  createTetrad,
  drawTetradColors,
  lockTetradToGrid,
  spinTetradColors,
  stepTetradDown,
  tryMoveTetradLateral,
} from './tetrad.js';

const BOARD_SHAKE_EPSILON = 0.01;
const TUTORIAL_BANNER_TICKS = 120;
const TUTORIAL_DONE_BANNER_TICKS = 180;

/** Create a brand-new deterministic SimState for the given mode, track, and seed. */
export function createSimState(
  mode: GameModeId,
  trackId: TrackId,
  seed: number,
  tutorialEnabled = false,
): SimState {
  const modeConfig = GAME_MODE_CONFIGS[mode];
  const initialRng = normalizeSeed(seed);
  const bag = createShuffledDeck(initialRng);
  const deck = bag.deck;
  const firstNext = drawTetradColors(deck, bag.rngState);

  return {
    tick: 0,
    rngState: firstNext.rngState,
    mode,
    trackId,
    phase: 'INTRO_PAUSE',
    phaseTimer: INTRO_PAUSE_TICKS,

    grid: createEmptyGrid(),
    automata: createEmptyAutomata(),
    automataTickCounter: 0,

    deck,
    nextColors: firstNext.colors,
    tetrad: null,
    ghostY: SPAWN_Y,

    lastFallLeft: false,

    score: 0,
    cleared: 0,
    level: modeConfig.startLevel,
    startLevel: modeConfig.startLevel,
    combo: 0,
    maxCombo: 0,
    totalCombos: 0,
    biggestClear: 0,
    highestClearScore: 0,
    perfectClears: 0,
    drops: 0,
    turnCleared: 0,
    turnScored: 0,

    elapsedTicks: 0,
    remainingTicks: modeConfig.timeLimitTicks ?? 0,
    songSection: 'start',

    boardOffsetX: 0,
    boardOffsetY: 0,
    prevBoardOffsetX: 0,
    prevBoardOffsetY: 0,

    dasDir: 0,
    dasTimer: 0,
    arrTimer: 0,

    impossibleDropStep: 0,
    impossibleDropTimer:
      mode === 'impossible' ? getImpossibleDropTimerTicks(0) : 0,

    tutorial: {
      enabled: tutorialEnabled,
      step: tutorialEnabled ? 'MOVE' : 'DONE',
      moveCount: 0,
      spinCount: 0,
      dropCount: 0,
      matchCount: 0,
      bannerTimer: tutorialEnabled ? TUTORIAL_BANNER_TICKS : 0,
      completed: false,
    },

    finished: false,
    impossibleUnlockedThisRun: false,
  };
}

/** Decay board shake offsets by BOARD_SHAKE_DECAY (0.916), clamping < 0.01 to 0. */
export function decayBoardShake(state: SimState): void {
  state.prevBoardOffsetX = state.boardOffsetX;
  state.prevBoardOffsetY = state.boardOffsetY;

  const nextX = state.boardOffsetX * BOARD_SHAKE_DECAY;
  const nextY = state.boardOffsetY * BOARD_SHAKE_DECAY;

  state.boardOffsetX = Math.abs(nextX) < BOARD_SHAKE_EPSILON ? 0 : nextX;
  state.boardOffsetY = Math.abs(nextY) < BOARD_SHAKE_EPSILON ? 0 : nextY;
}

function advanceTutorialTo(
  state: SimState,
  nextStep: TutorialStep,
  completed: boolean,
  events: SimEvent[],
): void {
  state.tutorial.step = nextStep;
  state.tutorial.completed = completed;
  state.tutorial.bannerTimer = completed
    ? TUTORIAL_DONE_BANNER_TICKS
    : TUTORIAL_BANNER_TICKS;
  events.push({
    type: 'TUTORIAL_ADVANCE',
    step: nextStep,
    completed,
  });
}

function maybeAdvanceSongSection(state: SimState, events: SimEvent[]): void {
  const nextSection = computeNextSongSection(
    state.mode,
    state.cleared,
    state.remainingTicks,
    state.songSection,
  );
  if (nextSection !== state.songSection) {
    state.songSection = nextSection;
    events.push({ type: 'SONG_SECTION', section: nextSection });
  }
}

function setSongSectionEnd(state: SimState, events: SimEvent[]): void {
  if (state.songSection !== 'end') {
    const endSection: SongSection = 'end';
    state.songSection = endSection;
    events.push({ type: 'SONG_SECTION', section: endSection });
  }
}

function triggerVictory(state: SimState, events: SimEvent[]): void {
  state.phase = 'VICTORY';
  state.phaseTimer = 0;
  state.finished = true;
  state.tetrad = null;
  setSongSectionEnd(state, events);
  events.push({
    type: 'GAME_VICTORY',
    mode: state.mode,
    score: state.score,
    cleared: state.cleared,
    elapsedTicks: state.elapsedTicks,
  });
}

function triggerGameOver(
  state: SimState,
  spawnColors: [1 | 2 | 3 | 4, 1 | 2 | 3 | 4, 1 | 2 | 3 | 4, 1 | 2 | 3 | 4],
  events: SimEvent[],
): void {
  const modeConfig = GAME_MODE_CONFIGS[state.mode];
  state.phase = 'GAME_OVER';
  state.phaseTimer = 0;
  state.finished = true;

  if (modeConfig.showFallingOnEndgame) {
    state.tetrad = createTetrad(
      SPAWN_X,
      SPAWN_Y,
      spawnColors,
      getFallSpeedTicks(state.level),
      true,
    );
    state.ghostY = SPAWN_Y;
  } else {
    state.tetrad = null;
  }

  setSongSectionEnd(state, events);
  events.push({
    type: 'GAME_OVER',
    mode: state.mode,
    score: state.score,
    cleared: state.cleared,
    elapsedTicks: state.elapsedTicks,
  });
}

function handleNewTetrad(state: SimState, events: SimEvent[]): void {
  const modeConfig = GAME_MODE_CONFIGS[state.mode];
  const spawnColors: [1 | 2 | 3 | 4, 1 | 2 | 3 | 4, 1 | 2 | 3 | 4, 1 | 2 | 3 | 4] = [
    state.nextColors[0],
    state.nextColors[1],
    state.nextColors[2],
    state.nextColors[3],
  ];

  if (!canPlaceTetrad(state.grid, SPAWN_X, SPAWN_Y)) {
    if (modeConfig.autoClearOnTopOut) {
      const clearedIndices = clearPlayableGrid(state.grid);
      for (let i = 0; i < clearedIndices.length; i++) {
        state.automata[clearedIndices[i]] = AUTOMATA_SEED_DROP;
      }
      state.boardOffsetY += 3;
      events.push({ type: 'RELAXED_RESET' });
    } else {
      triggerGameOver(state, spawnColors, events);
      return;
    }
  }

  // Draw the upcoming preview piece from the balanced 16-block deck.
  const nextDraw = drawTetradColors(state.deck, state.rngState);
  state.rngState = nextDraw.rngState;
  state.nextColors = nextDraw.colors;

  const resting = !canStepTetradDown(state.grid, SPAWN_X, SPAWN_Y);
  state.tetrad = createTetrad(
    SPAWN_X,
    SPAWN_Y,
    spawnColors,
    getFallSpeedTicks(state.level),
    resting,
  );
  state.ghostY = computeGhostY(state.grid, SPAWN_X, SPAWN_Y);

  if (state.mode === 'impossible') {
    const derivedStep = Math.max(0, state.level - state.startLevel);
    state.impossibleDropStep = Math.min(
      IMPOSSIBLE_DROP_TIMER_TICKS.length - 1,
      Math.max(state.impossibleDropStep, derivedStep),
    );
    state.impossibleDropTimer = getImpossibleDropTimerTicks(state.impossibleDropStep);
  }

  state.phase = 'FALLING_TETRAD';
  state.phaseTimer = 0;

  events.push({
    type: 'TETRAD_SPAWN',
    x: SPAWN_X,
    y: SPAWN_Y,
    colors: [spawnColors[0], spawnColors[1], spawnColors[2], spawnColors[3]],
  });
}

function lockActiveTetrad(
  state: SimState,
  isHardDrop: boolean,
  fromY: number,
  events: SimEvent[],
): void {
  const tetrad = state.tetrad;
  if (!tetrad) return;

  const dropDistance = Math.max(0, tetrad.y - fromY);
  const lockedCells = lockTetradToGrid(state.grid, tetrad);

  if (isHardDrop) {
    state.drops += 1;
    state.boardOffsetY += Math.min(6, 2.5 + dropDistance * 0.15);
    seedAutomataCells(state.automata, state.grid, lockedCells, AUTOMATA_SEED_DROP);
    events.push({
      type: 'TETRAD_HARD_DROP',
      fromY,
      toY: tetrad.y,
      x: tetrad.x,
      colors: [
        tetrad.colors[0],
        tetrad.colors[1],
        tetrad.colors[2],
        tetrad.colors[3],
      ],
    });

    if (state.tutorial.enabled && !state.tutorial.completed) {
      state.tutorial.dropCount += 1;
      if (state.tutorial.step === 'DROP' && state.tutorial.dropCount >= 1) {
        advanceTutorialTo(state, 'MATCH', false, events);
      }
    }
  } else {
    state.boardOffsetY += 1.5;
    seedAutomataCells(state.automata, state.grid, lockedCells, AUTOMATA_SEED_DROP * 0.5);
  }

  events.push({
    type: 'TETRAD_LOCK',
    cells: lockedCells,
  });

  state.tetrad = null;
  state.phase = 'BLOCK_HIT';
  state.phaseTimer = BLOCK_HIT_TICKS;
}

function performLateralMove(
  state: SimState,
  dx: -1 | 1,
  events: SimEvent[],
): void {
  const tetrad = state.tetrad;
  if (!tetrad) return;

  const res = tryMoveTetradLateral(state.grid, tetrad.x, tetrad.y, dx);
  if (res.moved) {
    tetrad.x = res.x;
    tetrad.y = res.y;
    state.ghostY = computeGhostY(state.grid, tetrad.x, tetrad.y);
    state.boardOffsetX += dx * 0.75;

    const canFall = canStepTetradDown(state.grid, tetrad.x, tetrad.y);
    if (canFall) {
      tetrad.slackActive = false;
      tetrad.slackTimer = SLACK_DURATION_TICKS;
    } else if (!tetrad.slackActive) {
      tetrad.slackActive = true;
      tetrad.slackTimer = SLACK_DURATION_TICKS;
    }

    events.push({
      type: 'TETRAD_MOVE',
      dx,
      x: tetrad.x,
      y: tetrad.y,
      blocked: false,
    });

    if (state.tutorial.enabled && !state.tutorial.completed) {
      state.tutorial.moveCount += 1;
      if (state.tutorial.step === 'MOVE' && state.tutorial.moveCount >= 2) {
        advanceTutorialTo(state, 'SPIN', false, events);
      }
    }
  } else {
    state.boardOffsetX += dx * 1.5;
    events.push({
      type: 'TETRAD_MOVE',
      dx,
      x: tetrad.x,
      y: tetrad.y,
      blocked: true,
    });
  }
}

function resolveLateralInputDir(state: SimState, input: InputFrame): {
  dir: -1 | 0 | 1;
  freshPress: boolean;
} {
  if (input.moveLeftPressed && !input.moveRightPressed) {
    return { dir: -1, freshPress: true };
  }
  if (input.moveRightPressed && !input.moveLeftPressed) {
    return { dir: 1, freshPress: true };
  }
  if (input.moveLeftPressed && input.moveRightPressed) {
    return { dir: 0, freshPress: false };
  }
  if (input.moveLeft && !input.moveRight) {
    return { dir: -1, freshPress: false };
  }
  if (input.moveRight && !input.moveLeft) {
    return { dir: 1, freshPress: false };
  }
  if (input.moveLeft && input.moveRight) {
    return { dir: state.dasDir, freshPress: false };
  }
  return { dir: 0, freshPress: false };
}

function handleFallingTetrad(
  state: SimState,
  input: InputFrame,
  events: SimEvent[],
): void {
  const tetrad = state.tetrad;
  if (!tetrad) {
    state.phase = 'NEW_TETRAD';
    return;
  }

  const modeConfig = GAME_MODE_CONFIGS[state.mode];

  // Snapshot previous position for smooth render interpolation.
  tetrad.prevX = tetrad.x;
  tetrad.prevY = tetrad.y;

  // 1. Lateral Movement (DAS / ARR)
  const { dir, freshPress } = resolveLateralInputDir(state, input);
  const dasDelay = Math.max(
    0,
    Math.trunc(input.usingGamepad ? input.gpMoveDelay : input.kbMoveDelay),
  );
  const speedIdx = Math.max(
    0,
    Math.min(ARR_MOVE_SPEED_TICKS.length - 1, Math.trunc(input.moveSpeedIndex)),
  );
  const arrInterval = ARR_MOVE_SPEED_TICKS[speedIdx];

  if (dir === 0) {
    state.dasDir = 0;
    state.dasTimer = 0;
    state.arrTimer = 0;
  } else if (freshPress || dir !== state.dasDir) {
    state.dasDir = dir;
    state.dasTimer = dasDelay;
    state.arrTimer = arrInterval;
    performLateralMove(state, dir, events);
  } else if (state.dasTimer > 0) {
    state.dasTimer -= 1;
    if (state.dasTimer === 0) {
      performLateralMove(state, dir, events);
      state.arrTimer = arrInterval;
    }
  } else {
    state.arrTimer -= 1;
    if (state.arrTimer <= 0) {
      performLateralMove(state, dir, events);
      state.arrTimer = arrInterval;
    }
  }

  // 2. Color Spin (CW / CCW) & Slack Lock-Delay Reset
  let slackResetThisTick = false;
  let spinDir: -1 | 0 | 1 = 0;
  if (input.spinRightPressed && !input.spinLeftPressed) {
    spinDir = 1;
  } else if (input.spinLeftPressed && !input.spinRightPressed) {
    spinDir = -1;
  }

  if (spinDir !== 0) {
    tetrad.colors = spinTetradColors(tetrad.colors, spinDir);
    let slackReset = false;
    if (tetrad.slackActive && tetrad.slackCount < modeConfig.slackMax) {
      tetrad.slackTimer = SLACK_DURATION_TICKS;
      tetrad.slackCount += 1;
      slackReset = true;
      slackResetThisTick = true;
    }

    events.push({
      type: 'TETRAD_SPIN',
      dir: spinDir,
      x: tetrad.x,
      y: tetrad.y,
      slackReset,
    });

    if (state.tutorial.enabled && !state.tutorial.completed) {
      state.tutorial.spinCount += 1;
      if (state.tutorial.step === 'SPIN' && state.tutorial.spinCount >= 2) {
        advanceTutorialTo(state, 'DROP', false, events);
      }
    }
  }

  // 3. Player Hard Drop
  if (input.hardDropPressed) {
    const fromY = tetrad.y;
    const landing = computeGhostPosition(state.grid, tetrad.x, tetrad.y);
    tetrad.x = landing.x;
    tetrad.y = landing.y;
    state.ghostY = landing.y;
    lockActiveTetrad(state, true, fromY, events);
    return;
  }

  // 4. Impossible Mode Forced Drop Cadence
  if (state.mode === 'impossible') {
    state.impossibleDropTimer -= 1;
    if (state.impossibleDropTimer <= 0) {
      const fromY = tetrad.y;
      const landing = computeGhostPosition(state.grid, tetrad.x, tetrad.y);
      const dropped = landing.y > fromY || landing.x !== tetrad.x;
      tetrad.x = landing.x;
      tetrad.y = landing.y;
      state.ghostY = landing.y;
      lockActiveTetrad(state, dropped, fromY, events);
      return;
    }
  }

  // 5. Normal Gravity & Slack Lock Delay
  const canFall = canStepTetradDown(state.grid, tetrad.x, tetrad.y);
  if (!canFall) {
    if (!tetrad.slackActive) {
      tetrad.slackActive = true;
      tetrad.slackTimer = SLACK_DURATION_TICKS;
    } else if (!slackResetThisTick) {
      tetrad.slackTimer -= 1;
      if (tetrad.slackTimer <= 0) {
        lockActiveTetrad(state, false, tetrad.y, events);
        return;
      }
    }
  } else {
    tetrad.slackActive = false;
    tetrad.fallTimer -= 1;
    if (tetrad.fallTimer <= 0) {
      const step = stepTetradDown(state.grid, tetrad.x, tetrad.y);
      if (step.moved) {
        tetrad.x = step.x;
        tetrad.y = step.y;
        state.ghostY = computeGhostY(state.grid, tetrad.x, tetrad.y);
      }
      tetrad.fallTimer = getFallSpeedTicks(state.level);

      if (!canStepTetradDown(state.grid, tetrad.x, tetrad.y)) {
        tetrad.slackActive = true;
        tetrad.slackTimer = SLACK_DURATION_TICKS;
      }
    }
  }
}

function handleCheckLines(state: SimState, events: SimEvent[]): void {
  const modeConfig = GAME_MODE_CONFIGS[state.mode];
  const matches = findSimultaneousMatches(state.grid);

  if (matches.cells.length > 0) {
    const n = matches.cells.length;
    applyMatchesToGrid(state.grid, matches.cells);
    seedAutomataCells(state.automata, state.grid, matches.cells, AUTOMATA_SEED_CLEAR);

    state.combo += 1;
    if (state.combo > state.maxCombo) {
      state.maxCombo = state.combo;
    }
    if (state.combo >= 2) {
      state.totalCombos += 1;
    }

    const waveScore = computeWaveScore(n, state.level, state.combo, state.mode);
    const clearTier = computeClearTier(n);

    state.cleared += n;
    state.turnCleared += n;
    state.score += waveScore;
    state.turnScored += waveScore;
    state.boardOffsetY += Math.min(8, 2 + n * 0.35 + state.combo * 1.1);

    events.push({
      type: 'BLOCKS_CLEAR',
      cells: matches.cells,
      count: n,
      combo: state.combo,
      waveScore,
      totalScore: state.score,
      level: state.level,
      clearTier,
    });

    if (state.combo >= 2) {
      const centroid = computeMatchCentroid(matches.cells);
      events.push({
        type: 'COMBO_CHAIN',
        combo: state.combo,
        comboTier: computeComboTier(state.combo),
        x: centroid.x,
        y: centroid.y,
      });
    }

    if (countBlocksOnGrid(state.grid) === 0) {
      const bonus = computePerfectClearBonus(state.level, state.combo, state.mode);
      state.score += bonus;
      state.turnScored += bonus;
      state.perfectClears += 1;
      events.push({
        type: 'PERFECT_CLEAR',
        bonus,
        combo: state.combo,
        level: state.level,
      });
    }

    if (state.turnCleared > state.biggestClear) {
      state.biggestClear = state.turnCleared;
    }
    if (state.turnScored > state.highestClearScore) {
      state.highestClearScore = state.turnScored;
    }
    if (state.score >= IMPOSSIBLE_UNLOCK_SCORE) {
      state.impossibleUnlockedThisRun = true;
    }

    if (state.tutorial.enabled && !state.tutorial.completed) {
      state.tutorial.matchCount += 1;
      if (state.tutorial.step === 'MATCH' && state.tutorial.matchCount >= 1) {
        advanceTutorialTo(state, 'ADVANCED', false, events);
      } else if (
        state.tutorial.step === 'ADVANCED' &&
        (n >= 4 || state.combo >= 2 || state.tutorial.matchCount >= 3)
      ) {
        advanceTutorialTo(state, 'DONE', true, events);
      }
    }

    state.phase = 'BLOCK_RESOLVE';
    state.phaseTimer = CHECK_LINES_PAUSE_TICKS;
    return;
  }

  // No matches found: finalize turn, update level/section, check completion.
  state.combo = 0;
  state.turnCleared = 0;
  state.turnScored = 0;

  const newLevel = computeLevelForCleared(
    state.startLevel,
    state.cleared,
    modeConfig.levelIncreases,
  );
  if (newLevel > state.level) {
    state.level = newLevel;
    if (state.mode === 'impossible') {
      state.impossibleDropStep = Math.min(
        IMPOSSIBLE_DROP_TIMER_TICKS.length - 1,
        Math.max(0, state.level - state.startLevel),
      );
    }
    events.push({ type: 'LEVEL_UP', level: state.level });
  }

  maybeAdvanceSongSection(state, events);

  if (modeConfig.targetBlocks !== null && state.cleared >= modeConfig.targetBlocks) {
    triggerVictory(state, events);
    return;
  }

  state.phase = 'NEW_TETRAD';
  state.phaseTimer = 0;
}

/**
 * Advance simulation by exactly one deterministic 60 Hz tick.
 * Mutates `state` in place and returns the ordered list of SimEvents emitted on this tick.
 */
export function stepSim(state: SimState, input: InputFrame): SimEvent[] {
  if (state.finished || state.phase === 'VICTORY' || state.phase === 'GAME_OVER') {
    return [];
  }

  const events: SimEvent[] = [];
  const modeConfig = GAME_MODE_CONFIGS[state.mode];

  state.tick += 1;
  decayBoardShake(state);

  state.automataTickCounter += 1;
  if (state.automataTickCounter >= AUTOMATA_TICK_INTERVAL) {
    state.automataTickCounter = 0;
    stepAutomataGrid(state.automata, state.grid);
  }

  if (
    !input.moveLeft &&
    !input.moveRight &&
    !input.moveLeftPressed &&
    !input.moveRightPressed
  ) {
    state.dasDir = 0;
    state.dasTimer = 0;
    state.arrTimer = 0;
  }

  if (state.tutorial.bannerTimer > 0) {
    state.tutorial.bannerTimer -= 1;
  }

  if (state.phase === 'INTRO_PAUSE') {
    state.phaseTimer -= 1;
    if (state.phaseTimer <= 0) {
      state.phase = 'NEW_TETRAD';
      state.phaseTimer = 0;
      handleNewTetrad(state, events);
    }
    return events;
  }

  // Active gameplay tick: advance elapsed timer & Rush countdown.
  state.elapsedTicks += 1;
  if (modeConfig.timeLimitTicks !== null) {
    state.remainingTicks = Math.max(0, state.remainingTicks - 1);
    maybeAdvanceSongSection(state, events);
    if (state.remainingTicks <= 0) {
      triggerVictory(state, events);
      return events;
    }
  }

  switch (state.phase) {
    case 'NEW_TETRAD': {
      handleNewTetrad(state, events);
      break;
    }
    case 'FALLING_TETRAD': {
      handleFallingTetrad(state, input, events);
      break;
    }
    case 'BLOCK_HIT': {
      state.phaseTimer -= 1;
      if (state.phaseTimer <= 0) {
        state.phase = 'BLOCK_RESOLVE';
        state.phaseTimer = 0;
      }
      break;
    }
    case 'BLOCK_RESOLVE': {
      if (state.phaseTimer > 0) {
        state.phaseTimer -= 1;
      }
      if (state.phaseTimer <= 0) {
        const result = stepSlideOffResolve(state.grid, state.lastFallLeft);
        state.lastFallLeft = result.lastFallLeft;
        if (result.moves.length > 0) {
          events.push({ type: 'BLOCK_SLIDE', moves: result.moves });
          state.phaseTimer = RESOLVE_STEP_TICKS;
        } else {
          state.phase = 'CHECK_LINES';
          state.phaseTimer = 0;
        }
      }
      break;
    }
    case 'CHECK_LINES': {
      handleCheckLines(state, events);
      break;
    }
  }

  return events;
}
