/**
 * Bit-for-bit deterministic state hashing for SimState replay verification.
 * Uses dual 32-bit FNV-1a lanes (64-bit output, 16-char lowercase hex) with
 * exact IEEE-754 float64 bit extraction (normalizing -0 to +0).
 */

import type { SimState } from '../contracts/index.js';

const FNV_OFFSET_A = 0x811c9dc5;
const FNV_PRIME_A = 0x01000193;

const FNV_OFFSET_B = 0x9e3779b9;
const FNV_PRIME_B = 0x85ebca6b;

const floatScratch = new Float64Array(1);
const floatU32View = new Uint32Array(floatScratch.buffer);

class DualFnvHasher {
  private hA = FNV_OFFSET_A;
  private hB = FNV_OFFSET_B;

  mixUint32(v: number): void {
    const u = v >>> 0;
    this.hA = Math.imul(this.hA ^ (u & 0xff), FNV_PRIME_A) >>> 0;
    this.hA = Math.imul(this.hA ^ ((u >>> 8) & 0xff), FNV_PRIME_A) >>> 0;
    this.hA = Math.imul(this.hA ^ ((u >>> 16) & 0xff), FNV_PRIME_A) >>> 0;
    this.hA = Math.imul(this.hA ^ ((u >>> 24) & 0xff), FNV_PRIME_A) >>> 0;

    this.hB = Math.imul(this.hB ^ ((u >>> 24) & 0xff), FNV_PRIME_B) >>> 0;
    this.hB = Math.imul(this.hB ^ ((u >>> 16) & 0xff), FNV_PRIME_B) >>> 0;
    this.hB = Math.imul(this.hB ^ ((u >>> 8) & 0xff), FNV_PRIME_B) >>> 0;
    this.hB = Math.imul(this.hB ^ (u & 0xff), FNV_PRIME_B) >>> 0;
  }

  mixInt32(v: number): void {
    this.mixUint32(v | 0);
  }

  mixBool(v: boolean): void {
    this.mixUint32(v ? 1 : 0);
  }

  mixFloat64(v: number): void {
    floatScratch[0] = v === 0 ? 0 : v;
    this.mixUint32(floatU32View[0]);
    this.mixUint32(floatU32View[1]);
  }

  mixString(s: string): void {
    this.mixUint32(s.length);
    for (let i = 0; i < s.length; i++) {
      this.mixUint32(s.charCodeAt(i));
    }
  }

  digestHex(): string {
    const a = (this.hA ^ (this.hB >>> 16)) >>> 0;
    const b = (this.hB ^ (this.hA >>> 16)) >>> 0;
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
}

/**
 * Compute a deterministic 64-bit hex fingerprint of every simulation field in `state`.
 */
export function hashSimState(state: SimState): string {
  const h = new DualFnvHasher();

  h.mixInt32(state.tick);
  h.mixUint32(state.rngState);
  h.mixString(state.mode);
  h.mixString(state.trackId);
  h.mixString(state.phase);
  h.mixInt32(state.phaseTimer);

  h.mixUint32(state.grid.length);
  for (let i = 0; i < state.grid.length; i++) {
    h.mixUint32(state.grid[i]);
  }

  h.mixUint32(state.automata.length);
  for (let i = 0; i < state.automata.length; i++) {
    h.mixFloat64(state.automata[i]);
  }
  h.mixInt32(state.automataTickCounter);

  h.mixUint32(state.deck.length);
  for (let i = 0; i < state.deck.length; i++) {
    h.mixUint32(state.deck[i]);
  }

  h.mixUint32(state.nextColors[0]);
  h.mixUint32(state.nextColors[1]);
  h.mixUint32(state.nextColors[2]);
  h.mixUint32(state.nextColors[3]);

  if (state.tetrad === null) {
    h.mixBool(false);
  } else {
    h.mixBool(true);
    h.mixInt32(state.tetrad.x);
    h.mixInt32(state.tetrad.y);
    h.mixInt32(state.tetrad.prevX);
    h.mixInt32(state.tetrad.prevY);
    h.mixUint32(state.tetrad.colors[0]);
    h.mixUint32(state.tetrad.colors[1]);
    h.mixUint32(state.tetrad.colors[2]);
    h.mixUint32(state.tetrad.colors[3]);
    h.mixInt32(state.tetrad.fallTimer);
    h.mixBool(state.tetrad.slackActive);
    h.mixInt32(state.tetrad.slackTimer);
    h.mixInt32(state.tetrad.slackCount);
  }

  h.mixInt32(state.ghostY);
  h.mixBool(state.lastFallLeft);

  h.mixFloat64(state.score);
  h.mixInt32(state.cleared);
  h.mixInt32(state.level);
  h.mixInt32(state.startLevel);
  h.mixInt32(state.combo);
  h.mixInt32(state.maxCombo);
  h.mixInt32(state.totalCombos);
  h.mixInt32(state.biggestClear);
  h.mixFloat64(state.highestClearScore);
  h.mixInt32(state.perfectClears);
  h.mixInt32(state.drops);
  h.mixInt32(state.turnCleared);
  h.mixFloat64(state.turnScored);

  h.mixInt32(state.elapsedTicks);
  h.mixInt32(state.remainingTicks);
  h.mixString(state.songSection);

  h.mixFloat64(state.boardOffsetX);
  h.mixFloat64(state.boardOffsetY);
  h.mixFloat64(state.prevBoardOffsetX);
  h.mixFloat64(state.prevBoardOffsetY);

  h.mixInt32(state.dasDir);
  h.mixInt32(state.dasTimer);
  h.mixInt32(state.arrTimer);

  h.mixInt32(state.impossibleDropStep);
  h.mixInt32(state.impossibleDropTimer);

  h.mixBool(state.tutorial.enabled);
  h.mixString(state.tutorial.step);
  h.mixInt32(state.tutorial.moveCount);
  h.mixInt32(state.tutorial.spinCount);
  h.mixInt32(state.tutorial.dropCount);
  h.mixInt32(state.tutorial.matchCount);
  h.mixInt32(state.tutorial.bannerTimer);
  h.mixBool(state.tutorial.completed);

  h.mixBool(state.finished);
  h.mixBool(state.impossibleUnlockedThisRun);

  return h.digestHex();
}
