/**
 * Krunked Lumia — Game Mode Catalog & UI Metadata
 * Re-exports canonical mode configs from src/contracts and enriches them with
 * display badges, icon frames, speedrun flags, and unlock descriptions.
 */

import {
  GAME_MODE_CONFIGS,
  GAME_MODE_ORDER,
  IMPOSSIBLE_UNLOCK_SCORE,
  MODE_COUNT,
  type GameModeConfig,
  type GameModeId,
} from '../contracts/index.js';

export { GAME_MODE_CONFIGS, GAME_MODE_ORDER, MODE_COUNT };
export type { GameModeConfig, GameModeId };

export interface ModeMetadata {
  id: GameModeId;
  iconIndex: number;
  badge: string;
  goalSummary: string;
  speedrunEligible: boolean;
  timedMode: boolean;
  isSecret: boolean;
  unlockDescription: string;
  accentSlot: 2 | 3 | 4 | 5;
}

export type ModeDetails = GameModeConfig & ModeMetadata;

export const MODE_METADATA: Readonly<Record<GameModeId, ModeMetadata>> = {
  marathon: {
    id: 'marathon',
    iconIndex: 0,
    badge: '450 BLK',
    goalSummary: 'Clear 450 blocks across rising speeds',
    speedrunEligible: true,
    timedMode: false,
    isSecret: false,
    unlockDescription: 'Available from the start',
    accentSlot: 3,
  },
  endless: {
    id: 'endless',
    iconIndex: 1,
    badge: 'ENDLESS',
    goalSummary: 'Survive and chain combos as long as you can',
    speedrunEligible: false,
    timedMode: false,
    isSecret: false,
    unlockDescription: 'Available from the start',
    accentSlot: 4,
  },
  intense: {
    id: 'intense',
    iconIndex: 2,
    badge: 'LVL 15+',
    goalSummary: 'Clear 450 blocks starting at maximum speed',
    speedrunEligible: true,
    timedMode: false,
    isSecret: false,
    unlockDescription: 'Available from the start',
    accentSlot: 5,
  },
  relaxed: {
    id: 'relaxed',
    iconIndex: 3,
    badge: 'NO FAIL',
    goalSummary: 'Steady tempo with automatic board clearing on top-out',
    speedrunEligible: false,
    timedMode: false,
    isSecret: false,
    unlockDescription: 'Available from the start',
    accentSlot: 2,
  },
  rush: {
    id: 'rush',
    iconIndex: 4,
    badge: '2:00',
    goalSummary: 'Score as high as possible before the 2-minute clock runs out',
    speedrunEligible: false,
    timedMode: true,
    isSecret: false,
    unlockDescription: 'Available from the start',
    accentSlot: 3,
  },
  impossible: {
    id: 'impossible',
    iconIndex: 5,
    badge: 'SECRET',
    goalSummary: '450 blocks with tight lock delay, shrinking drop timer, and +15 level score bonus',
    speedrunEligible: true,
    timedMode: false,
    isSecret: true,
    unlockDescription: `Score ${IMPOSSIBLE_UNLOCK_SCORE.toLocaleString('en-US')} in any mode to unlock`,
    accentSlot: 5,
  },
};

export const MODE_LIST: readonly ModeDetails[] = GAME_MODE_ORDER.map((id) => ({
  ...GAME_MODE_CONFIGS[id],
  ...MODE_METADATA[id],
}));

export function getModeMetadata(id: GameModeId): ModeMetadata {
  return MODE_METADATA[id];
}

export function getModeDetails(id: GameModeId): ModeDetails {
  return {
    ...GAME_MODE_CONFIGS[id],
    ...MODE_METADATA[id],
  };
}

export function isSpeedrunMode(id: GameModeId): boolean {
  return MODE_METADATA[id].speedrunEligible;
}
