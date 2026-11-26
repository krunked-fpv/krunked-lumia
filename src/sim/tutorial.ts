/**
 * Krunked Lumia — Pure Tutorial Prompt Definitions & Step Helpers
 * 100% pure, DOM-free definitions for MOVE -> SPIN -> DROP -> MATCH -> ADVANCED -> DONE.
 */

import type { TutorialState, TutorialStep } from '../contracts/index.js';

export type TutorialIconKey = 'move' | 'spin' | 'drop' | 'match' | 'advanced' | 'done';

export interface TutorialPrompt {
  step: TutorialStep;
  title: string;
  hint: string;
  iconKey: TutorialIconKey;
  targetCount: number;
  locTitleKey: string;
  locHintKey: string;
}

export const TUTORIAL_STEP_ORDER: readonly TutorialStep[] = [
  'MOVE',
  'SPIN',
  'DROP',
  'MATCH',
  'ADVANCED',
  'DONE',
] as const;

export const TUTORIAL_PROMPTS: Readonly<Record<TutorialStep, TutorialPrompt>> = {
  MOVE: {
    step: 'MOVE',
    title: 'SLIDE',
    hint: 'Move LEFT / RIGHT to glide along the 45° diamond walls.',
    iconKey: 'move',
    targetCount: 2,
    locTitleKey: 'tutorial.move.title',
    locHintKey: 'tutorial.move.hint',
  },
  SPIN: {
    step: 'SPIN',
    title: 'SPIN',
    hint: 'Press SPIN CW or CCW to cycle the 4 diamond colors.',
    iconKey: 'spin',
    targetCount: 2,
    locTitleKey: 'tutorial.spin.title',
    locHintKey: 'tutorial.spin.hint',
  },
  DROP: {
    step: 'DROP',
    title: 'DROP',
    hint: 'Press HARD DROP to lock the tetrad and trigger slide-off gravity.',
    iconKey: 'drop',
    targetCount: 1,
    locTitleKey: 'tutorial.drop.title',
    locHintKey: 'tutorial.drop.hint',
  },
  MATCH: {
    step: 'MATCH',
    title: 'MATCH',
    hint: 'Line up 3+ diagonally or form a 2x2 diamond of matching color.',
    iconKey: 'match',
    targetCount: 1,
    locTitleKey: 'tutorial.match.title',
    locHintKey: 'tutorial.match.hint',
  },
  ADVANCED: {
    step: 'ADVANCED',
    title: 'CHAIN',
    hint: 'Let blocks slide into valleys after a clear to build combos up to 4x!',
    iconKey: 'advanced',
    targetCount: 1,
    locTitleKey: 'tutorial.advanced.title',
    locHintKey: 'tutorial.advanced.hint',
  },
  DONE: {
    step: 'DONE',
    title: 'READY!',
    hint: 'Tutorial complete — flow with the harmonic pulse.',
    iconKey: 'done',
    targetCount: 0,
    locTitleKey: 'tutorial.done.title',
    locHintKey: 'tutorial.done.hint',
  },
};

export function getTutorialPrompt(step: TutorialStep): TutorialPrompt {
  return TUTORIAL_PROMPTS[step];
}

export function getNextTutorialStep(step: TutorialStep): TutorialStep {
  const index = TUTORIAL_STEP_ORDER.indexOf(step);
  if (index < 0 || index >= TUTORIAL_STEP_ORDER.length - 1) {
    return 'DONE';
  }
  return TUTORIAL_STEP_ORDER[index + 1];
}

export function createInitialTutorialState(enabled: boolean): TutorialState {
  return {
    enabled,
    step: enabled ? 'MOVE' : 'DONE',
    moveCount: 0,
    spinCount: 0,
    dropCount: 0,
    matchCount: 0,
    bannerTimer: enabled ? 180 : 0,
    completed: !enabled,
  };
}

export interface TutorialProgressView {
  prompt: TutorialPrompt;
  current: number;
  target: number;
  fraction: number;
}

export function getTutorialProgress(tutorial: TutorialState): TutorialProgressView {
  const prompt = getTutorialPrompt(tutorial.step);
  let current = 0;

  switch (tutorial.step) {
    case 'MOVE':
      current = tutorial.moveCount;
      break;
    case 'SPIN':
      current = tutorial.spinCount;
      break;
    case 'DROP':
      current = tutorial.dropCount;
      break;
    case 'MATCH':
      current = tutorial.matchCount;
      break;
    case 'ADVANCED':
      current = tutorial.completed ? prompt.targetCount : Math.max(0, tutorial.matchCount - 1);
      break;
    case 'DONE':
      current = 0;
      break;
  }

  const target = prompt.targetCount;
  const clampedCurrent = target > 0 ? Math.min(current, target) : 0;
  const fraction = target > 0 ? clampedCurrent / target : 1;

  return {
    prompt,
    current: clampedCurrent,
    target,
    fraction,
  };
}
