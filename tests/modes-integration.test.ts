import { describe, expect, it } from 'vitest';
import {
  FALL_SPEED_TICKS,
  IMPOSSIBLE_DROP_TIMER_TICKS,
  IMPOSSIBLE_LEVEL_BONUS,
  IMPOSSIBLE_UNLOCK_SCORE,
  INTRO_PAUSE_TICKS,
  MARATHON_TARGET_BLOCKS,
  RUSH_DURATION_MS,
  RUSH_DURATION_TICKS,
  SLACK_DURATION_TICKS,
  SLACK_MAX_IMPOSSIBLE,
  SPAWN_Y,
  createEmptyInputFrame,
  type BlockColor,
  type InputFrame,
  type SimEvent,
  type SimState,
  type SongSection,
  type TutorialStep,
} from '../src/contracts/index.js';
import { MemoryStorage, SAVE_STORAGE_KEY, SaveManager } from '../src/app/SaveManager.js';
import {
  countBlocksOnGrid,
  createSimState,
  setCell,
  stepSim,
} from '../src/sim/index.js';
import { isModeUnlocked } from '../src/sim/modes.js';
import {
  TUTORIAL_STEP_ORDER,
  getTutorialProgress,
  getTutorialPrompt,
} from '../src/sim/tutorial.js';

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

function stepUntilReadyOrFinished(state: SimState, maxTicks = 200): SimEvent[] {
  const events: SimEvent[] = [];
  const empty = createEmptyInputFrame();
  for (let i = 0; i < maxTicks && state.phase !== 'FALLING_TETRAD' && !state.finished; i++) {
    events.push(...stepSim(state, empty));
  }
  return events;
}

/**
 * Helper: drive a clean deterministic diamond clear of 4 identical blocks at spawn
 * and step until the next tetrad spawns or the mode finishes.
 */
function dropMatchingDiamond(state: SimState, color: BlockColor): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.phase === 'INTRO_PAUSE') {
    events.push(...advancePastIntro(state));
  }
  if (!state.tetrad || state.finished) {
    return events;
  }
  state.tetrad.colors = [color, color, color, color];
  events.push(...stepSim(state, inputWith({ hardDropPressed: true })));
  events.push(...stepUntilReadyOrFinished(state, 200));
  return events;
}

describe('Modes, Tutorial & SaveManager End-to-End Integration', () => {
  it('progresses tutorial cleanly through MOVE -> SPIN -> DROP -> MATCH -> ADVANCED -> DONE and persists completion', () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    expect(save.getActiveProfile().tutorialCompleted).toBe(false);

    const state = createSimState('marathon', 'tessellation', 1001, true);
    expect(state.tutorial.enabled).toBe(true);
    expect(state.tutorial.step).toBe('MOVE');
    expect(TUTORIAL_STEP_ORDER).toEqual(['MOVE', 'SPIN', 'DROP', 'MATCH', 'ADVANCED', 'DONE']);
    expect(getTutorialPrompt('MOVE').targetCount).toBe(2);

    advancePastIntro(state);

    const advances: Array<{ step: TutorialStep; completed: boolean }> = [];
    const recordAdvances = (evs: SimEvent[]) => {
      for (const e of evs) {
        if (e.type === 'TUTORIAL_ADVANCE') {
          advances.push({ step: e.step, completed: e.completed });
        }
      }
    };

    // 1. MOVE -> SPIN (2 lateral moves)
    recordAdvances(stepSim(state, inputWith({ moveRight: true, moveRightPressed: true })));
    expect(state.tutorial.step).toBe('MOVE');
    expect(getTutorialProgress(state.tutorial).current).toBe(1);

    recordAdvances(stepSim(state, inputWith({ moveLeft: true, moveLeftPressed: true })));
    expect(state.tutorial.step).toBe('SPIN');

    // 2. SPIN -> DROP (2 spins)
    recordAdvances(stepSim(state, inputWith({ spinRightPressed: true })));
    expect(state.tutorial.step).toBe('SPIN');
    expect(getTutorialProgress(state.tutorial).current).toBe(1);

    recordAdvances(stepSim(state, inputWith({ spinLeftPressed: true })));
    expect(state.tutorial.step).toBe('DROP');

    // 3. DROP -> MATCH -> ADVANCED (hard drop a 4-block matching diamond)
    state.tetrad!.colors = [1, 1, 1, 1];
    recordAdvances(stepSim(state, inputWith({ hardDropPressed: true })));
    expect(state.tutorial.step).toBe('MATCH');

    recordAdvances(stepUntilReadyOrFinished(state, 150));
    expect(state.tutorial.step).toBe('ADVANCED');
    expect(state.tutorial.completed).toBe(false);

    // 4. ADVANCED -> DONE (clear a 4+ block diamond / cascade)
    recordAdvances(dropMatchingDiamond(state, 2));
    expect(state.tutorial.step).toBe('DONE');
    expect(state.tutorial.completed).toBe(true);
    expect(getTutorialProgress(state.tutorial).fraction).toBe(1);

    expect(advances).toEqual([
      { step: 'SPIN', completed: false },
      { step: 'DROP', completed: false },
      { step: 'MATCH', completed: false },
      { step: 'ADVANCED', completed: false },
      { step: 'DONE', completed: true },
    ]);

    // Recording the run into SaveManager persists tutorialCompleted across reload
    save.recordRunResult(state);
    expect(save.getActiveProfile().tutorialCompleted).toBe(true);

    const reloaded = new SaveManager(storage);
    expect(reloaded.getActiveProfile().tutorialCompleted).toBe(true);
  });

  it('completes Marathon, Intense (startLevel=15), and Impossible (startLevel=15, +15 bonus, slackMax=4, endgame piece) at 450 blocks and records into SaveManager', () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);

    // ---- 1. MARATHON ----
    const marathon = createSimState('marathon', 'tessellation', 2001);
    expect(marathon.level).toBe(0);
    const marathonSections: SongSection[] = [marathon.songSection];
    const marathonLevelUps: number[] = [];

    advancePastIntro(marathon);
    let colorCycle: BlockColor = 1;
    while (!marathon.finished) {
      const evs = dropMatchingDiamond(marathon, colorCycle);
      colorCycle = ((colorCycle % 4) + 1) as BlockColor;
      for (const e of evs) {
        if (e.type === 'SONG_SECTION') marathonSections.push(e.section);
        if (e.type === 'LEVEL_UP') marathonLevelUps.push(e.level);
      }
      expect(marathon.tick).toBeLessThan(10_000);
    }

    expect(marathon.phase).toBe('VICTORY');
    expect(marathon.finished).toBe(true);
    expect(marathon.cleared).toBeGreaterThanOrEqual(MARATHON_TARGET_BLOCKS);
    expect(marathon.level).toBe(15);
    expect(marathonLevelUps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(marathonSections).toEqual(['start', 'middle', 'outro', 'end']);

    const marathonOutcome = save.recordRunResult(marathon);
    expect(marathonOutcome.isNewHighScore).toBe(true);
    expect(marathonOutcome.fastestTimeBeaten).toBe(true);
    expect(save.getActiveProfile().stats.marathonsCompleted).toBe(1);
    expect(save.getActiveProfile().stats.fastestMarathonMs).toBe(marathonOutcome.elapsedMs);
    expect(save.getActiveProfile().highScores.marathon).toBe(marathon.score);

    // ---- 2. INTENSE (startLevel=15, 1-tick gravity) ----
    const intense = createSimState('intense', 'corefault', 2002);
    expect(intense.level).toBe(15);
    expect(intense.startLevel).toBe(15);
    advancePastIntro(intense);
    expect(intense.tetrad!.fallTimer).toBe(FALL_SPEED_TICKS[15]);
    expect(FALL_SPEED_TICKS[15]).toBe(1);

    // Clear 450 blocks in Intense cleanly
    while (!intense.finished) {
      dropMatchingDiamond(intense, 2);
      expect(intense.tick).toBeLessThan(10_000);
    }
    expect(intense.phase).toBe('VICTORY');
    expect(intense.cleared).toBeGreaterThanOrEqual(MARATHON_TARGET_BLOCKS);
    expect(intense.level).toBe(30); // 15 + floor(452 / 30) = 30
    expect(intense.score).toBeGreaterThan(marathon.score);

    const intenseOutcome = save.recordRunResult(intense);
    expect(intenseOutcome.fastestTimeBeaten).toBe(true);
    expect(save.getActiveProfile().stats.intenseMarathonsCompleted).toBe(1);
    expect(save.getActiveProfile().stats.fastestIntenseMarathonMs).toBe(intenseOutcome.elapsedMs);
    expect(save.getActiveProfile().highScores.intense).toBe(intense.score);

    // ---- 3. IMPOSSIBLE (startLevel=15, +15 score bonus, slackMax=4, 450 VICTORY + endgame piece preserved) ----
    const impossible = createSimState('impossible', 'hazard', 2003);
    expect(impossible.level).toBe(15);
    expect(impossible.startLevel).toBe(15);
    expect(impossible.impossibleDropTimer).toBe(IMPOSSIBLE_DROP_TIMER_TICKS[0]);
    advancePastIntro(impossible);

    // Verify slackMax = 4 directly in-sim
    impossible.tetrad!.x = 3;
    impossible.tetrad!.y = 26;
    impossible.tetrad!.slackActive = true;
    impossible.tetrad!.slackTimer = SLACK_DURATION_TICKS;
    impossible.tetrad!.slackCount = 0;
    impossible.impossibleDropTimer = 50;

    for (let s = 0; s < SLACK_MAX_IMPOSSIBLE; s++) {
      stepSim(impossible, createEmptyInputFrame());
      const evs = stepSim(impossible, inputWith({ spinRightPressed: true }));
      const spin = evs.find((e) => e.type === 'TETRAD_SPIN');
      expect(spin && spin.type === 'TETRAD_SPIN' && spin.slackReset).toBe(true);
    }
    const fifthSpinEvents = stepSim(impossible, inputWith({ spinRightPressed: true }));
    const fifthSpin = fifthSpinEvents.find((e) => e.type === 'TETRAD_SPIN');
    expect(fifthSpin && fifthSpin.type === 'TETRAD_SPIN' && fifthSpin.slackReset).toBe(false);
    expect(impossible.tetrad!.slackCount).toBe(4);

    // Verify +15 score bonus on the very first 4-block Perfect Clear at level 15:
    // effLevel = 15 + 15 = 30 -> wave = 16 * 100 * 31 = 49,600; PC = 10,000 * 31 = 310,000 -> 359,600
    impossible.tetrad!.colors = [3, 3, 3, 3];
    stepSim(impossible, inputWith({ hardDropPressed: true }));
    stepUntilReadyOrFinished(impossible, 150);
    const expectedFirstClearScore =
      4 * 4 * 100 * (15 + IMPOSSIBLE_LEVEL_BONUS + 1) +
      10_000 * (15 + IMPOSSIBLE_LEVEL_BONUS + 1);
    expect(impossible.score).toBe(expectedFirstClearScore);

    // Finish all 450 blocks for Impossible VICTORY
    while (!impossible.finished) {
      dropMatchingDiamond(impossible, 3);
      expect(impossible.tick).toBeLessThan(10_000);
    }
    expect(impossible.phase).toBe('VICTORY');
    expect(impossible.cleared).toBeGreaterThanOrEqual(MARATHON_TARGET_BLOCKS);

    const impossibleOutcome = save.recordRunResult(impossible);
    expect(impossibleOutcome.fastestTimeBeaten).toBe(true);
    expect(save.getActiveProfile().stats.impossibleMarathonsCompleted).toBe(1);
    expect(save.getActiveProfile().stats.fastestImpossibleMarathonMs).toBe(
      impossibleOutcome.elapsedMs,
    );
    expect(save.getActiveProfile().highScores.impossible).toBe(impossible.score);

    // Separate Impossible top-out check: endgame falling tetrad MUST be preserved (showFallingOnEndgame = true)
    const impTopOut = createSimState('impossible', 'hazard', 2004);
    advancePastIntro(impTopOut);
    setCell(impTopOut.grid, 3, 0, 1);
    impTopOut.tetrad = null;
    impTopOut.phase = 'NEW_TETRAD';
    const overEvs = stepSim(impTopOut, createEmptyInputFrame());
    expect(impTopOut.phase).toBe('GAME_OVER');
    expect(impTopOut.finished).toBe(true);
    expect(impTopOut.tetrad).not.toBeNull();
    expect(overEvs.some((e) => e.type === 'GAME_OVER' && e.mode === 'impossible')).toBe(true);

    // Verify all 3 speedrun records persisted cleanly in storage
    const reloaded = new SaveManager(storage);
    const profile = reloaded.getActiveProfile();
    expect(profile.stats.marathonsCompleted).toBe(1);
    expect(profile.stats.intenseMarathonsCompleted).toBe(1);
    expect(profile.stats.impossibleMarathonsCompleted).toBe(1);
    expect(profile.stats.gamesPlayed).toBe(3);
  });

  it('expires Rush 120s (7200 ticks) cleanly into VICTORY and records full stats into SaveManager', () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);

    const rush = createSimState('rush', 'rush', 3001);
    expect(rush.remainingTicks).toBe(RUSH_DURATION_TICKS);

    // Intro pause does not consume the 2-minute Rush countdown
    advancePastIntro(rush);
    expect(rush.remainingTicks).toBe(RUSH_DURATION_TICKS);
    expect(rush.elapsedTicks).toBe(0);

    const sections: SongSection[] = [rush.songSection];
    let sawVictoryEvent = false;

    for (let t = 0; t < RUSH_DURATION_TICKS; t++) {
      let frame = createEmptyInputFrame();
      // Periodically hard-drop a clean matching diamond to accumulate real score/clears without topping out
      if (rush.phase === 'FALLING_TETRAD' && rush.tetrad && rush.tetrad.y === SPAWN_Y) {
        if (t % 120 === 0) {
          rush.tetrad.colors = [4, 4, 4, 4];
          frame = inputWith({ hardDropPressed: true });
        } else {
          rush.tetrad.colors = [1, 1, 1, 1];
        }
      }
      const evs = stepSim(rush, frame);
      for (const e of evs) {
        if (e.type === 'SONG_SECTION') sections.push(e.section);
        if (e.type === 'GAME_VICTORY') sawVictoryEvent = true;
      }
    }

    expect(rush.remainingTicks).toBe(0);
    expect(rush.elapsedTicks).toBe(RUSH_DURATION_TICKS);
    expect(rush.phase).toBe('VICTORY');
    expect(rush.finished).toBe(true);
    expect(sawVictoryEvent).toBe(true);
    expect(sections).toEqual(['start', 'middle', 'outro', 'end']);
    expect(rush.cleared).toBeGreaterThan(0);
    expect(rush.score).toBeGreaterThan(0);

    const outcome = save.recordRunResult(rush);
    expect(outcome.isNewHighScore).toBe(true);
    expect(outcome.elapsedMs).toBe(RUSH_DURATION_MS);

    const reloaded = new SaveManager(storage);
    const p = reloaded.getActiveProfile();
    expect(p.highScores.rush).toBe(rush.score);
    expect(p.stats.gamesPlayed).toBe(1);
    expect(p.stats.blocksCleared).toBe(rush.cleared);
    expect(p.stats.timePlayedMs).toBe(RUSH_DURATION_MS);
  });

  it('auto-clears Relaxed board on top-out via RELAXED_RESET without GAME_OVER and keeps level locked at 0', () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);

    const relaxed = createSimState('relaxed', 'minimum', 4001);
    advancePastIntro(relaxed);

    // Clear 64 blocks (past 2 level thresholds) — level must remain strictly 0!
    for (let i = 0; i < 16; i++) {
      dropMatchingDiamond(relaxed, ((i % 4) + 1) as BlockColor);
    }
    expect(relaxed.cleared).toBe(64);
    expect(relaxed.level).toBe(0);

    // Stack mismatched tetrads straight up until the board fills and triggers RELAXED_RESET naturally
    let relaxedResetCount = 0;
    const mismatchPattern: [BlockColor, BlockColor, BlockColor, BlockColor] = [1, 2, 3, 4];

    for (let t = 0; t < 2500 && relaxedResetCount === 0; t++) {
      let frame = createEmptyInputFrame();
      if (relaxed.phase === 'FALLING_TETRAD' && relaxed.tetrad) {
        // Assign alternating mismatched colors so pieces build up cleanly to spawn
        const shift = relaxed.drops % 4;
        relaxed.tetrad.colors = [
          mismatchPattern[shift % 4],
          mismatchPattern[(shift + 1) % 4],
          mismatchPattern[(shift + 2) % 4],
          mismatchPattern[(shift + 3) % 4],
        ];
        frame = inputWith({ hardDropPressed: true });
      }
      const evs = stepSim(relaxed, frame);
      for (const e of evs) {
        if (e.type === 'RELAXED_RESET') {
          relaxedResetCount += 1;
        }
        expect(e.type).not.toBe('GAME_OVER');
      }
      expect(relaxed.phase).not.toBe('GAME_OVER');
      expect(relaxed.finished).toBe(false);
    }

    expect(relaxedResetCount).toBe(1);
    expect(relaxed.phase).toBe('FALLING_TETRAD');
    expect(relaxed.tetrad).not.toBeNull();
    expect(countBlocksOnGrid(relaxed.grid)).toBe(0);
    expect(relaxed.level).toBe(0);

    // Recording Relaxed session updates stats without falsely counting as marathon completion
    save.recordRunResult(relaxed);
    const profile = save.getActiveProfile();
    expect(profile.highScores.relaxed).toBe(relaxed.score);
    expect(profile.stats.marathonsCompleted).toBe(0);
    expect(profile.stats.blocksCleared).toBe(relaxed.cleared);
  });

  it('unlocks Impossible mode across profiles via SaveManager.recordRunResult() upon crossing 4,000,000 points', () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    const p1 = save.getActiveProfile();
    const p2 = save.createProfile('Second Pilot');

    expect(isModeUnlocked('impossible', p1)).toBe(false);
    expect(isModeUnlocked('impossible', p2)).toBe(false);

    // Run 1: Real simulation ending just below 4,000,000 -> Impossible stays locked
    const subThreshold = createSimState('endless', 'tessellation', 5001);
    advancePastIntro(subThreshold);
    subThreshold.score = IMPOSSIBLE_UNLOCK_SCORE - 50_000;
    dropMatchingDiamond(subThreshold, 1); // +11,600 -> 3,961,600 (< 4,000,000)
    expect(subThreshold.score).toBeLessThan(IMPOSSIBLE_UNLOCK_SCORE);
    expect(subThreshold.impossibleUnlockedThisRun).toBe(false);

    const outcomeSub = save.recordRunResult(subThreshold);
    expect(outcomeSub.impossibleNewlyUnlocked).toBe(false);
    expect(isModeUnlocked('impossible', save.getActiveProfile())).toBe(false);

    // Run 2: Real simulation crossing 4,000,000 on an actual clear -> unlocks Impossible globally
    const crossing = createSimState('intense', 'corefault', 5002);
    advancePastIntro(crossing);
    crossing.score = IMPOSSIBLE_UNLOCK_SCORE - 10_000;
    dropMatchingDiamond(crossing, 2); // level 15 clear + PC = 25,600 + 160,000 -> > 4,000,000!
    expect(crossing.score).toBeGreaterThanOrEqual(IMPOSSIBLE_UNLOCK_SCORE);
    expect(crossing.impossibleUnlockedThisRun).toBe(true);

    const outcomeUnlock = save.recordRunResult(crossing);
    expect(outcomeUnlock.impossibleNewlyUnlocked).toBe(true);
    expect(save.getProfiles().every((p) => p.impossibleUnlocked)).toBe(true);
    expect(save.getProfiles().every((p) => p.unlockedModes.includes('impossible'))).toBe(true);
    expect(isModeUnlocked('impossible', save.getActiveProfile())).toBe(true);

    // Run 3: Subsequent 4M+ run is idempotent (`impossibleNewlyUnlocked: false`)
    const outcomeRepeat = save.recordRunResult(crossing);
    expect(outcomeRepeat.impossibleNewlyUnlocked).toBe(false);

    // Reload from raw persisted JSON under SAVE_STORAGE_KEY and confirm unlock sticks
    expect(storage.getItem(SAVE_STORAGE_KEY)).not.toBeNull();
    const reloaded = new SaveManager(storage);
    expect(reloaded.getActiveProfile().highScores.intense).toBe(crossing.score);
    expect(reloaded.getProfiles().every((p) => p.impossibleUnlocked)).toBe(true);
    expect(reloaded.getProfiles().every((p) => p.unlockedModes.includes('impossible'))).toBe(true);
    expect(reloaded.getProfiles().every((p) => isModeUnlocked('impossible', p))).toBe(true);
  });
});
