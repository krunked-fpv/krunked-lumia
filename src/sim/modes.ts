/**
 * Krunked Lumia — Pure Mode Progression, Song Section & Unlock Helpers
 * 100% pure, DOM-free simulation helpers.
 */

import {
  BLOCKS_PER_LEVEL,
  GAME_MODE_CONFIGS,
  IMPOSSIBLE_UNLOCK_SCORE,
  type GameModeConfig,
  type GameModeId,
  type PlayerProfile,
  type SimState,
  type SongSection,
} from '../contracts/index.js';

export function getModeConfig(mode: GameModeId): GameModeConfig {
  return GAME_MODE_CONFIGS[mode];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Computes normalized [0..1] progress through the active mode's primary arc.
 * - Timed modes (Rush): based on elapsed time over `timeLimitTicks`.
 * - Block-goal & open modes: based on `cleared` over `targetBlocks ?? progressGoalBlocks`.
 */
export function computeModeProgress(
  state: Pick<SimState, 'mode' | 'cleared' | 'elapsedTicks' | 'remainingTicks'>,
): number {
  const config = GAME_MODE_CONFIGS[state.mode];
  if (config.timeLimitTicks !== null && config.timeLimitTicks > 0) {
    const elapsed = config.timeLimitTicks - Math.max(0, state.remainingTicks);
    return clamp01(elapsed / config.timeLimitTicks);
  }
  const goal = config.targetBlocks ?? config.progressGoalBlocks;
  if (goal <= 0) return 0;
  return clamp01(state.cleared / goal);
}

/**
 * Computes the target harmonic song section (`start` -> `middle` -> `outro` -> `end`)
 * for the current simulation state.
 */
export function computeTargetSongSection(
  state: Pick<SimState, 'mode' | 'cleared' | 'remainingTicks' | 'phase' | 'finished'>,
): SongSection {
  if (state.finished || state.phase === 'VICTORY' || state.phase === 'GAME_OVER') {
    return 'end';
  }

  const config = GAME_MODE_CONFIGS[state.mode];

  if (config.timeLimitTicks !== null && config.timeLimitTicks > 0) {
    const elapsedRatio = clamp01(
      (config.timeLimitTicks - Math.max(0, state.remainingTicks)) / config.timeLimitTicks,
    );
    if (elapsedRatio >= 2 / 3 || state.cleared >= config.outroSectionBlocks) {
      return 'outro';
    }
    if (elapsedRatio >= 1 / 3 || state.cleared >= config.middleSectionBlocks) {
      return 'middle';
    }
    return 'start';
  }

  if (state.cleared >= config.outroSectionBlocks) {
    return 'outro';
  }
  if (state.cleared >= config.middleSectionBlocks) {
    return 'middle';
  }
  return 'start';
}

/**
 * Computes current level from cleared block count according to mode rules.
 */
export function computeLevelForCleared(mode: GameModeId, cleared: number): number {
  const config = GAME_MODE_CONFIGS[mode];
  if (!config.levelIncreases) {
    return config.startLevel;
  }
  return config.startLevel + Math.floor(Math.max(0, cleared) / BLOCKS_PER_LEVEL);
}

/**
 * Returns true if a single profile's high scores reach the 4,000,000 Impossible threshold.
 */
export function hasProfileReachedImpossibleScore(
  profile: Pick<PlayerProfile, 'highScores'>,
): boolean {
  for (const score of Object.values(profile.highScores)) {
    if (typeof score === 'number' && Number.isFinite(score) && score >= IMPOSSIBLE_UNLOCK_SCORE) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if ANY profile in the roster has unlocked Impossible mode
 * (either via existing flag or achieving >= 4,000,000 in any mode).
 */
export function checkImpossibleUnlock(
  profiles: readonly Pick<PlayerProfile, 'highScores' | 'impossibleUnlocked'>[],
): boolean {
  for (const profile of profiles) {
    if (profile.impossibleUnlocked || hasProfileReachedImpossibleScore(profile)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether the given game mode is unlocked for the provided profile.
 */
export function isModeUnlocked(
  mode: GameModeId,
  profile: Pick<PlayerProfile, 'unlockedModes' | 'impossibleUnlocked' | 'highScores'>,
): boolean {
  if (mode === 'impossible') {
    return (
      profile.impossibleUnlocked ||
      profile.unlockedModes.includes('impossible') ||
      hasProfileReachedImpossibleScore(profile)
    );
  }
  return profile.unlockedModes.includes(mode);
}
