/**
 * Krunked Lumia — Single Source of Truth Contracts & Extracted Constants
 * Every module in src/sim, src/data, src/render, src/audio, src/assets, src/input, src/ui, src/app
 * imports shared contracts from this file.
 */

// ============================================================================
// 1. ENGINE, VIEWPORT & TIMING CONSTANTS [extracted]
// ============================================================================

export const BRAND_NAME = 'Krunked Lumia';
export const BRAND_SLUG = 'krunked-lumia';
export const SAVE_STORAGE_KEY = 'krunked_lumia_save_v1';
export const CUSTOM_PACK_DB_NAME = 'krunked_lumia_packs_v1';

export const LOGICAL_WIDTH = 320;
export const LOGICAL_HEIGHT = 180;

export const CONTAINER_WIDTH = 68;
export const CONTAINER_HEIGHT = 128;

export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 29;
export const BOARD_CELL_COUNT = BOARD_WIDTH * BOARD_HEIGHT; // 232

export const SIM_HZ = 60;
export const SIM_DT = 1 / 60;
export const SIM_DT_MS = 1000 / 60;

export const TARGET_FPS_OPTIONS = [30, 60, 120] as const;
export type TargetFps = (typeof TARGET_FPS_OPTIONS)[number];

export const ROOM_LAYER_ORDER = [
  'Background',
  'BackgroundParticles',
  'Instances',
  'Blocks',
  'ForegroundParticles',
  'UI',
  'Transitions',
  'Notifications',
] as const;

// ============================================================================
// 2. BOARD CELL ENCODING & PHYSICS CONSTANTS [extracted]
// ============================================================================

export const CELL_WALL = 0 as const;
export const CELL_BLOCK_EMPTY = 1 as const; // Slot 2: hollow 6x6 diamond
export const CELL_BLOCK_FILLED = 2 as const; // Slot 3: solid 6x6 diamond
export const CELL_BLOCK_HOLE = 3 as const; // Slot 4: 6x6 ring w/ 2x2 center hole
export const CELL_BLOCK_TARGET = 4 as const; // Slot 5: 6x6 outline w/ 2x2 inner dot
export const CELL_EMPTY = 5 as const; // Playable empty cell

export type BlockColor = 1 | 2 | 3 | 4;
export type CellValue = 0 | 1 | 2 | 3 | 4 | 5;

export const SPAWN_X = 3;
export const SPAWN_Y = 0;

/** 16-level normal gravity table in 60 Hz ticks [extracted]. */
export const FALL_SPEED_TICKS: readonly number[] = [
  60, 50, 45, 40, 35, 30, 25, 20, 15, 10, 8, 6, 4, 3, 2, 1,
] as const;

/** 17-step Impossible drop/resolve timer curve in 60 Hz ticks [extracted]. */
export const IMPOSSIBLE_DROP_TIMER_TICKS: readonly number[] = [
  50, 45, 40, 36, 34, 32, 30, 28, 26, 24, 22, 21, 20, 18, 15, 14, 13,
] as const;

/** 6 ARR horizontal movement presets in 60 Hz ticks [extracted]. */
export const ARR_MOVE_SPEED_TICKS: readonly number[] = [8, 6, 5, 4, 3, 2] as const;
export const ARR_MOVE_SPEED_NAMES = [
  'Precise',
  'Leisurely',
  'Sticky',
  'Standard',
  'Slick',
  'Reckless',
] as const;
export type MoveSpeedName = (typeof ARR_MOVE_SPEED_NAMES)[number];

export const DEFAULT_MOVE_SPEED_INDEX = 3; // Standard (4 ticks)
export const DEFAULT_KB_MOVE_DELAY = 8; // ticks
export const DEFAULT_GP_MOVE_DELAY = 10; // ticks

export const SLACK_DURATION_TICKS = 12; // 0.20 s
export const SLACK_MAX_STANDARD = 10;
export const SLACK_MAX_IMPOSSIBLE = 4;

export const INTRO_PAUSE_TICKS = 36; // 0.60 s crisp lead-in
export const BLOCK_HIT_TICKS = 6; // 0.10 s lock flash before slide-off
export const RESOLVE_STEP_TICKS = 3; // 20 Hz crisp cascading settle cadence
export const CHECK_LINES_PAUSE_TICKS = 10; // brief rhythmic beat on clear before next resolve

export const BLOCKS_PER_LEVEL = 30;
export const MARATHON_TARGET_BLOCKS = 450;
export const RUSH_DURATION_MS = 120_000;
export const RUSH_DURATION_TICKS = 7200; // 120 s * 60 Hz
export const IMPOSSIBLE_UNLOCK_SCORE = 4_000_000;
export const IMPOSSIBLE_LEVEL_BONUS = 15;
export const MAX_COMBO_MULTIPLIER = 4;
export const PERFECT_CLEAR_BASE_BONUS = 10_000;

// ============================================================================
// 3. VISUAL / SHADER / JUICE CONSTANTS [extracted]
// ============================================================================

export const BOARD_SHAKE_DECAY = 0.916;
export const AUTOMATA_DECAY = 0.75;
export const AUTOMATA_SEED_CLEAR = 100;
export const AUTOMATA_SEED_DROP = 45;
export const AUTOMATA_TICK_INTERVAL = 3;

export const BLOOM_BASE_INTENSITY = 0.15;
export const BLOOM_LUMA_WEIGHTS = [0.229, 0.587, 0.114] as const;
export const BLOOM_BLUR_STEPS = 3.0;
export const BLOOM_BLUR_SIGMA = 0.5;
export const LIGHT_PALETTE_LUMA_THRESHOLD = 128;

export const PALETTE_COUNT = 63;
export const TRACK_COUNT = 8;
export const MODE_COUNT = 6;

// ============================================================================
// 4. MODES, TRACKS & PALETTES
// ============================================================================

export type GameModeId =
  | 'marathon'
  | 'endless'
  | 'intense'
  | 'relaxed'
  | 'rush'
  | 'impossible';

export const GAME_MODE_ORDER: readonly GameModeId[] = [
  'marathon',
  'endless',
  'intense',
  'relaxed',
  'rush',
  'impossible',
] as const;

export interface GameModeConfig {
  id: GameModeId;
  name: string;
  description: string;
  startLevel: number;
  targetBlocks: number | null; // 450 for marathon/intense/impossible, null otherwise
  timeLimitTicks: number | null; // 7200 for rush
  levelIncreases: boolean;
  autoClearOnTopOut: boolean;
  slackMax: number;
  levelScoreBonus: number;
  trackPool: 'standard' | 'rush';
  middleSectionBlocks: number;
  outroSectionBlocks: number;
  progressGoalBlocks: number;
  secretUnlockScore: number | null;
  showFallingOnEndgame: boolean;
}

export type TrackId =
  | 'tessellation'
  | 'summer_shower'
  | 'dissolve'
  | 'quasar'
  | 'corefault'
  | 'minimum'
  | 'rush'
  | 'hazard';

export const STANDARD_TRACK_POOL: readonly TrackId[] = [
  'tessellation',
  'summer_shower',
  'dissolve',
  'quasar',
  'corefault',
  'minimum',
] as const;

export const RUSH_TRACK_POOL: readonly TrackId[] = [
  'rush',
  'hazard',
  'minimum',
] as const;

export const ALL_TRACK_IDS: readonly TrackId[] = [
  'tessellation',
  'summer_shower',
  'dissolve',
  'quasar',
  'corefault',
  'minimum',
  'rush',
  'hazard',
] as const;

export type SongSection = 'start' | 'middle' | 'outro' | 'end';

/**
 * 6-Color Indexed Palette Architecture [extracted]:
 * [0] Background
 * [1] Game Board Interior
 * [2] Empty Block (1) & Primary UI Text
 * [3] Filled Block (2) & Selected UI Text / Accent
 * [4] Hole Block (3)
 * [5] Target Block (4)
 */
export type PaletteColors = [string, string, string, string, string, string];

export interface Palette {
  id: string;
  name: string;
  author?: string;
  colors: PaletteColors;
  isCustom?: boolean;
}

// ============================================================================
// 5. SIMULATION STATE, INPUT & EVENTS (PURE DOM-FREE SIM CONTRACT)
// ============================================================================

export type SimPhase =
  | 'INTRO_PAUSE'
  | 'NEW_TETRAD'
  | 'FALLING_TETRAD'
  | 'BLOCK_HIT'
  | 'BLOCK_RESOLVE'
  | 'CHECK_LINES'
  | 'VICTORY'
  | 'GAME_OVER';

/**
 * Active 2x2 diamond tetrad.
 * `colors` order: [top, right, bottom, left].
 *   CW spin  (spinRight): top->right->bottom->left->top => [left, top, right, bottom]
 *   CCW spin (spinLeft):  top->left->bottom->right->top => [right, bottom, left, top]
 */
export interface TetradState {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  colors: [BlockColor, BlockColor, BlockColor, BlockColor];
  fallTimer: number;
  slackActive: boolean;
  slackTimer: number;
  slackCount: number;
}

export type TutorialStep = 'MOVE' | 'SPIN' | 'DROP' | 'MATCH' | 'ADVANCED' | 'DONE';

export interface TutorialState {
  enabled: boolean;
  step: TutorialStep;
  moveCount: number;
  spinCount: number;
  dropCount: number;
  matchCount: number;
  bannerTimer: number;
  completed: boolean;
}

export interface SimState {
  tick: number;
  rngState: number;
  mode: GameModeId;
  trackId: TrackId;
  phase: SimPhase;
  phaseTimer: number;

  /** Length 232 (BOARD_WIDTH * BOARD_HEIGHT), indexed as y * BOARD_WIDTH + x. */
  grid: CellValue[];
  /** Length 232 ripple energy [0..100], indexed as y * BOARD_WIDTH + x. */
  automata: number[];
  automataTickCounter: number;

  deck: BlockColor[];
  nextColors: [BlockColor, BlockColor, BlockColor, BlockColor];
  tetrad: TetradState | null;
  ghostY: number;

  lastFallLeft: boolean;

  score: number;
  cleared: number;
  level: number;
  startLevel: number;
  combo: number;
  maxCombo: number;
  totalCombos: number;
  biggestClear: number;
  highestClearScore: number;
  perfectClears: number;
  drops: number;
  turnCleared: number;
  turnScored: number;

  elapsedTicks: number;
  remainingTicks: number;
  songSection: SongSection;

  boardOffsetX: number;
  boardOffsetY: number;
  prevBoardOffsetX: number;
  prevBoardOffsetY: number;

  dasDir: -1 | 0 | 1;
  dasTimer: number;
  arrTimer: number;

  impossibleDropStep: number;
  impossibleDropTimer: number;

  tutorial: TutorialState;

  finished: boolean;
  impossibleUnlockedThisRun: boolean;
}

export interface InputFrame {
  moveLeft: boolean;
  moveRight: boolean;
  moveLeftPressed: boolean;
  moveRightPressed: boolean;
  spinLeftPressed: boolean;
  spinRightPressed: boolean;
  hardDropPressed: boolean;
  usingGamepad: boolean;
  moveSpeedIndex: number;
  kbMoveDelay: number;
  gpMoveDelay: number;
}

export interface GridCellBlock {
  x: number;
  y: number;
  color: BlockColor;
}

export interface BlockSlideMove {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: BlockColor;
}

export type SimEvent =
  | {
      type: 'TETRAD_SPAWN';
      x: number;
      y: number;
      colors: [BlockColor, BlockColor, BlockColor, BlockColor];
    }
  | {
      type: 'TETRAD_MOVE';
      dx: -1 | 1;
      x: number;
      y: number;
      blocked: boolean;
    }
  | {
      type: 'TETRAD_SPIN';
      dir: -1 | 1;
      x: number;
      y: number;
      slackReset: boolean;
    }
  | {
      type: 'TETRAD_HARD_DROP';
      fromY: number;
      toY: number;
      x: number;
      colors: [BlockColor, BlockColor, BlockColor, BlockColor];
    }
  | {
      type: 'TETRAD_LOCK';
      cells: GridCellBlock[];
    }
  | {
      type: 'BLOCK_SLIDE';
      moves: BlockSlideMove[];
    }
  | {
      type: 'BLOCKS_CLEAR';
      cells: GridCellBlock[];
      count: number;
      combo: number;
      waveScore: number;
      totalScore: number;
      level: number;
      clearTier: 0 | 1 | 2;
    }
  | {
      type: 'COMBO_CHAIN';
      combo: number;
      comboTier: 0 | 1 | 2;
      x: number;
      y: number;
    }
  | {
      type: 'PERFECT_CLEAR';
      bonus: number;
      combo: number;
      level: number;
    }
  | {
      type: 'LEVEL_UP';
      level: number;
    }
  | {
      type: 'SONG_SECTION';
      section: SongSection;
    }
  | {
      type: 'RELAXED_RESET';
    }
  | {
      type: 'TUTORIAL_ADVANCE';
      step: TutorialStep;
      completed: boolean;
    }
  | {
      type: 'GAME_VICTORY';
      mode: GameModeId;
      score: number;
      cleared: number;
      elapsedTicks: number;
    }
  | {
      type: 'GAME_OVER';
      mode: GameModeId;
      score: number;
      cleared: number;
      elapsedTicks: number;
    };

// ============================================================================
// 6. AUDIO & HARMONIC SOUNDPACK CONTRACTS
// ============================================================================

export type ProgressionSlice = [string, string, string, string]; // [dropGroup, moveGroup, clearGroup, comboGroup]

export interface SoundpackLoopDef {
  audio: string;
  bpm?: number;
  length?: number; // in beats
  progression?: string;
  next?: string;
}

export interface SoundpackGainConfig {
  master: number;
  drop: number;
  move: number;
  clear: number;
  combo: number;
  loop: number;
}

export interface SoundpackManifest {
  id: TrackId;
  title: string;
  author: string;
  mode: 'standard' | 'rush' | 'both';
  baseBpm: number;
  gain: SoundpackGainConfig;
  drop_groups: Record<string, string | string[]>;
  move_groups: Record<string, string[]>;
  clear_groups: Record<string, string[]>;
  combo_groups: Record<string, string[]>;
  progressions: Record<string, ProgressionSlice[]>;
  loops: Record<string, SoundpackLoopDef>;
}

export interface SoundtestTelemetry {
  trackId: TrackId;
  packMode: PackMode;
  loopName: string;
  nextLoopName: string;
  section: SongSection;
  bpm: number;
  loopProgress: number; // 0..1
  beatIndex: number;
  progressionName: string;
  progressionStep: number;
  progressionLength: number;
  activeGroups: ProgressionSlice;
}

// ============================================================================
// 7. SETTINGS, INPUT BINDINGS, PROFILES & PERSISTENCE
// ============================================================================

export type NextBlockLocation =
  | 'upper_left'
  | 'upper_right'
  | 'lower_left'
  | 'lower_right';

export type PackMode = 'builtin' | 'custom';

export type ActionVerb =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'cancel'
  | 'moveLeft'
  | 'moveRight'
  | 'hardDrop'
  | 'spinLeft'
  | 'spinRight'
  | 'pause';

export type KeyboardBindings = Record<ActionVerb, string[]>;
export type GamepadBindings = Record<ActionVerb, number[]>;

export interface RenderSettings {
  targetFps: TargetFps;
  native60Snap: boolean;
  bloomAmount: number; // 0..1 (scales base bloom_intensity 0.15)
  boardShake: boolean;
  boardRipple: boolean;
  particles: boolean;
  flashing: boolean;
  bgShapes: boolean;
  boardColors: boolean;
  boardZoom: boolean;
  tateRotate: boolean;
}

export interface GameplaySettings {
  dropPreviewOpacity: number; // 0..1
  nextBlockLocation: NextBlockLocation;
  preciseTimer: boolean;
  moveSpeedIndex: number; // 0..5
  kbMoveDelay: number; // 0..15 ticks
  gpMoveDelay: number; // 0..15 ticks
  gamepadRumble: boolean;
  tutorialEnabled: boolean;
  soundtestEnabled: boolean;
}

export interface AudioSettings {
  masterVolume: number; // 0..1
  muted: boolean;
}

export interface UserSettings {
  paletteId: string;
  render: RenderSettings;
  gameplay: GameplaySettings;
  audio: AudioSettings;
  keyboard: KeyboardBindings;
  gamepad: GamepadBindings;
  packMode: PackMode;
  photosensitivitySeen: boolean;
}

export interface ProfileStats {
  gamesPlayed: number;
  marathonsCompleted: number;
  intenseMarathonsCompleted: number;
  impossibleMarathonsCompleted: number;
  fastestMarathonMs: number | null;
  fastestIntenseMarathonMs: number | null;
  fastestImpossibleMarathonMs: number | null;
  longestEndlessMs: number;
  totalCombos: number;
  longestCombo: number;
  biggestClear: number;
  highestClearScore: number;
  pointsScored: number;
  blocksCleared: number;
  perfectClears: number;
  drops: number;
  timePlayedMs: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  highScores: Record<GameModeId, number>;
  stats: ProfileStats;
  unlockedModes: GameModeId[];
  unlockedTracks: TrackId[];
  impossibleUnlocked: boolean;
  tutorialCompleted: boolean;
}

export interface SaveData {
  version: 1;
  activeProfileId: string;
  profiles: PlayerProfile[];
  customPalettes: Palette[];
  settings: UserSettings;
  lastMode: GameModeId;
  lastTrack: TrackId;
}

// ============================================================================
// 8. CUSTOM PACK & ASSET ATLAS CONTRACTS
// ============================================================================

export interface SpriteFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
  boundW: number;
  boundH: number;
}

export interface SpriteAssetEntry {
  name: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  frames: SpriteFrameRect[];
}

export interface CustomPackManifest {
  version: 1;
  source: 'steam-extracted' | 'browser-uploaded';
  extractedAt: string;
  atlasWidth: number;
  atlasHeight: number;
  atlasFile: string;
  sprites: Record<string, SpriteAssetEntry>;
  paletteCount: number;
  palettesFile: string;
  tracklistFile: string;
  tracks: Record<
    string,
    {
      dataFile: string;
      coverFile: string | null;
      audioFiles: string[];
    }
  >;
  menuAudioFiles: string[];
  localizationFile: string | null;
}

// ============================================================================
// 9. APP SCREENS & DEBUG BRIDGE (window.__KRUNKED_DEBUG__)
// ============================================================================

export type AppScreen =
  | 'PHOTOSENSITIVITY'
  | 'TITLE'
  | 'MODE_SELECT'
  | 'TRACK_SELECT'
  | 'PLAYING'
  | 'PAUSED'
  | 'ENDGAME'
  | 'SETTINGS'
  | 'COLOR_EDITOR'
  | 'SCORES_STATS'
  | 'CREDITS'
  | 'PROFILES';

export interface DebugBridge {
  getState: () => {
    screen: AppScreen;
    packMode: PackMode;
    customPackAvailable: boolean;
    paletteId: string;
    paletteName: string;
    isLightPalette: boolean;
    fps: number;
    targetFps: TargetFps;
    simHz: number;
    stateHash: string;
    entityCounts: {
      particles: number;
      bgGeometry: number;
      activeBlocks: number;
    };
    sim: SimState | null;
    soundtest: SoundtestTelemetry | null;
    settings: UserSettings;
    profile: PlayerProfile;
  };
  setScreen: (screen: AppScreen) => void;
  startGame: (mode: GameModeId, trackId?: TrackId, seed?: number) => void;
  stepTicks: (ticks: number, input?: Partial<InputFrame>) => string;
  setPalette: (paletteId: string) => void;
  setTargetFps: (fps: TargetFps) => void;
  setPackMode: (mode: PackMode) => Promise<boolean>;
  warpLevel: (level: number) => void;
  warpCleared: (cleared: number) => void;
  warpSection: (section: SongSection) => void;
  forcePerfectClear: () => void;
  forceCombo4x: () => void;
  toggleImpossibleUnlock: (unlocked?: boolean) => void;
  toggleSoundtest: (enabled?: boolean) => void;
  toggleTate: (enabled?: boolean) => void;
  toggleBoardZoom: (enabled?: boolean) => void;
  toggleDrawer: (open?: boolean) => void;
  resetSave: () => void;
}

declare global {
  interface Window {
    __KRUNKED_DEBUG__?: DebugBridge;
  }
}
