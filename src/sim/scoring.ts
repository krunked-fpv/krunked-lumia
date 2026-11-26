/**
 * Pure Scoring, Combo Multipliers, Perfect Clear Bonus, Level Progression,
 * Fall Curves, and Song Section Thresholds.
 */

import {
  BLOCKS_PER_LEVEL,
  FALL_SPEED_TICKS,
  GAME_MODE_CONFIGS,
  IMPOSSIBLE_DROP_TIMER_TICKS,
  MAX_COMBO_MULTIPLIER,
  PERFECT_CLEAR_BASE_BONUS,
  type GameModeId,
  type SongSection,
} from '../contracts/index.js';

/** Effective scoring level (`level + modeConfig.levelScoreBonus`, +15 in Impossible). */
export function computeEffectiveLevel(level: number, mode: GameModeId): number {
  return level + GAME_MODE_CONFIGS[mode].levelScoreBonus;
}

/** Combo multiplier capped at MAX_COMBO_MULTIPLIER (4x). */
export function computeComboMultiplier(combo: number): number {
  if (combo <= 0) return 1;
  return Math.min(combo, MAX_COMBO_MULTIPLIER);
}

/** Exact wave score formula: `n * n * 100 * (effLevel + 1) * min(combo, 4)`. */
export function computeWaveScore(
  clearedCount: number,
  level: number,
  combo: number,
  mode: GameModeId,
): number {
  if (clearedCount <= 0) return 0;
  const effLevel = computeEffectiveLevel(level, mode);
  const comboMult = computeComboMultiplier(combo);
  return clearedCount * clearedCount * 100 * (effLevel + 1) * comboMult;
}

/** Exact Perfect Clear bonus: `10000 * (effLevel + 1) * min(combo, 4)`. */
export function computePerfectClearBonus(
  level: number,
  combo: number,
  mode: GameModeId,
): number {
  const effLevel = computeEffectiveLevel(level, mode);
  const comboMult = computeComboMultiplier(combo);
  return PERFECT_CLEAR_BASE_BONUS * (effLevel + 1) * comboMult;
}

/** Audio/FX intensity tier for a clear wave (`0` = <=4, `1` = 5..7, `2` = 8+). */
export function computeClearTier(clearedCount: number): 0 | 1 | 2 {
  if (clearedCount >= 8) return 2;
  if (clearedCount >= 5) return 1;
  return 0;
}

/** Audio/FX intensity tier for combo chain (`0` = 2x, `1` = 3x, `2` = 4x+). */
export function computeComboTier(combo: number): 0 | 1 | 2 {
  if (combo >= 4) return 2;
  if (combo === 3) return 1;
  return 0;
}

/** Level calculation: `startLevel + floor(cleared / 30)` when `levelIncreases` is true. */
export function computeLevelForCleared(
  startLevel: number,
  cleared: number,
  levelIncreases: boolean,
): number {
  if (!levelIncreases) return startLevel;
  return startLevel + Math.floor(Math.max(0, cleared) / BLOCKS_PER_LEVEL);
}

/** Normal gravity interval in 60 Hz ticks from `FALL_SPEED_TICKS[min(level, 15)]`. */
export function getFallSpeedTicks(level: number): number {
  const idx = Math.max(0, Math.min(FALL_SPEED_TICKS.length - 1, Math.floor(level)));
  return FALL_SPEED_TICKS[idx];
}

/** Impossible forced-drop cadence in 60 Hz ticks from `IMPOSSIBLE_DROP_TIMER_TICKS[min(step, 16)]`. */
export function getImpossibleDropTimerTicks(step: number): number {
  const idx = Math.max(0, Math.min(IMPOSSIBLE_DROP_TIMER_TICKS.length - 1, Math.floor(step)));
  return IMPOSSIBLE_DROP_TIMER_TICKS[idx];
}

const SECTION_RANK: Record<SongSection, number> = {
  start: 0,
  middle: 1,
  outro: 2,
  end: 3,
};

/**
 * Determine the monotonic target song section (`start -> middle -> outro`) based on
 * cleared block thresholds (and elapsed time thresholds in Rush mode).
 */
export function computeNextSongSection(
  mode: GameModeId,
  cleared: number,
  remainingTicks: number,
  currentSection: SongSection,
): SongSection {
  if (currentSection === 'end') return 'end';

  const cfg = GAME_MODE_CONFIGS[mode];
  let desired: SongSection = 'start';

  if (cleared >= cfg.outroSectionBlocks) {
    desired = 'outro';
  } else if (cleared >= cfg.middleSectionBlocks) {
    desired = 'middle';
  }

  if (cfg.timeLimitTicks !== null && cfg.timeLimitTicks > 0) {
    const third = Math.floor(cfg.timeLimitTicks / 3);
    if (remainingTicks <= third) {
      desired = 'outro';
    } else if (remainingTicks <= third * 2 && SECTION_RANK[desired] < SECTION_RANK.middle) {
      desired = 'middle';
    }
  }

  return SECTION_RANK[desired] > SECTION_RANK[currentSection] ? desired : currentSection;
}
