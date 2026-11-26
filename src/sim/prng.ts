/**
 * Pure, deterministic 32-bit PRNG (Mulberry32) and Fisher-Yates shuffle.
 * All RNG state lives in a single uint32 (`SimState.rngState`).
 * ZERO Math.random(), ZERO DOM/global side effects.
 */

export const DEFAULT_RNG_SEED = 0x6d2b79f5;

/** Normalize any numeric seed into a non-zero uint32 state. */
export function normalizeSeed(seed: number): number {
  const normalized = (Math.trunc(seed) | 0) >>> 0;
  return normalized === 0 ? DEFAULT_RNG_SEED : normalized;
}

/** Advance Mulberry32 by one step, returning a uint32 value and next state. */
export function nextRngUint32(rngState: number): { value: number; nextState: number } {
  const nextState = ((rngState >>> 0) + 0x6d2b79f5) >>> 0;
  let t = Math.imul(nextState ^ (nextState >>> 15), 1 | nextState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = (t ^ (t >>> 14)) >>> 0;
  return { value, nextState };
}

/** Return a uniform integer in [0, maxExclusive) and next uint32 state. */
export function nextRngInt(
  rngState: number,
  maxExclusive: number,
): { value: number; nextState: number } {
  if (maxExclusive <= 1) {
    const { nextState } = nextRngUint32(rngState);
    return { value: 0, nextState };
  }
  const { value, nextState } = nextRngUint32(rngState);
  return { value: value % maxExclusive, nextState };
}

/** Return a deterministic float in [0, 1) and next uint32 state. */
export function nextRngFloat(rngState: number): { value: number; nextState: number } {
  const { value, nextState } = nextRngUint32(rngState);
  return { value: value / 0x100000000, nextState };
}

/** Deterministic in-place Fisher-Yates shuffle returning the updated uint32 state. */
export function shuffleArrayInPlace<T>(items: T[], rngState: number): number {
  let state = rngState >>> 0;
  for (let i = items.length - 1; i > 0; i--) {
    const step = nextRngInt(state, i + 1);
    state = step.nextState;
    const j = step.value;
    if (i !== j) {
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
  }
  return state;
}
