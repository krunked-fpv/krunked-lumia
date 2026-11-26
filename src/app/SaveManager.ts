/**
 * Krunked Lumia — Persistence, Multi-Profile CRUD, Custom Palettes & Corruption Recovery
 * Persists SaveData under SAVE_STORAGE_KEY ('krunked_lumia_save_v1') with strict schema validation.
 */

import {
  ALL_TRACK_IDS,
  ARR_MOVE_SPEED_TICKS,
  GAME_MODE_ORDER,
  IMPOSSIBLE_UNLOCK_SCORE,
  SAVE_STORAGE_KEY,
  SIM_DT_MS,
  TARGET_FPS_OPTIONS,
  type ActionVerb,
  type GameModeId,
  type GamepadBindings,
  type KeyboardBindings,
  type NextBlockLocation,
  type PackMode,
  type Palette,
  type PaletteColors,
  type PlayerProfile,
  type ProfileStats,
  type SaveData,
  type SimState,
  type TargetFps,
  type TrackId,
  type UserSettings,
} from '../contracts/index.js';
import {
  BUILTIN_PALETTES,
  normalizePaletteColors,
} from '../data/palettes.js';
import {
  ACTION_VERBS,
  NEXT_BLOCK_LOCATIONS,
  createDefaultAudioSettings,
  createDefaultGamepadBindings,
  createDefaultGameplaySettings,
  createDefaultKeyboardBindings,
  createDefaultRenderSettings,
  createDefaultUserSettings,
} from '../data/settingsDefaults.js';
import { checkImpossibleUnlock } from '../sim/modes.js';

export { SAVE_STORAGE_KEY };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

export interface RunRecordOutcome {
  isNewHighScore: boolean;
  previousHighScore: number;
  impossibleNewlyUnlocked: boolean;
  fastestTimeBeaten: boolean;
  elapsedMs: number;
}

export interface CustomPaletteInput {
  id?: string;
  name: string;
  author?: string;
  colors: PaletteColors | readonly string[];
}

export interface SettingsUpdatePatch {
  paletteId?: string;
  render?: Partial<UserSettings['render']>;
  gameplay?: Partial<UserSettings['gameplay']>;
  audio?: Partial<UserSettings['audio']>;
  keyboard?: Partial<KeyboardBindings>;
  gamepad?: Partial<GamepadBindings>;
  packMode?: PackMode;
  photosensitivitySeen?: boolean;
}

const DEFAULT_UNLOCKED_MODES: readonly GameModeId[] = [
  'marathon',
  'endless',
  'intense',
  'relaxed',
  'rush',
] as const;

const BUILTIN_PALETTE_IDS = new Set<string>(BUILTIN_PALETTES.map((p) => p.id));
const VALID_MODE_SET = new Set<string>(GAME_MODE_ORDER);
const VALID_TRACK_SET = new Set<string>(ALL_TRACK_IDS);
const VALID_FPS_SET = new Set<number>(TARGET_FPS_OPTIONS);
const VALID_NEXT_LOC_SET = new Set<string>(NEXT_BLOCK_LOCATIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeNonNegInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function sanitizeNullableMs(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function sanitizeClampedFloat(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function sanitizeClampedInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeProfileName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const clean = raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 24);
  return clean.length > 0 ? clean : fallback;
}

export function createDefaultProfileStats(): ProfileStats {
  return {
    gamesPlayed: 0,
    marathonsCompleted: 0,
    intenseMarathonsCompleted: 0,
    impossibleMarathonsCompleted: 0,
    fastestMarathonMs: null,
    fastestIntenseMarathonMs: null,
    fastestImpossibleMarathonMs: null,
    longestEndlessMs: 0,
    totalCombos: 0,
    longestCombo: 0,
    biggestClear: 0,
    highestClearScore: 0,
    pointsScored: 0,
    blocksCleared: 0,
    perfectClears: 0,
    drops: 0,
    timePlayedMs: 0,
  };
}

export function createDefaultHighScores(): Record<GameModeId, number> {
  return {
    marathon: 0,
    endless: 0,
    intense: 0,
    relaxed: 0,
    rush: 0,
    impossible: 0,
  };
}

export function createDefaultProfile(name = 'Player 1', id = 'profile_default'): PlayerProfile {
  return {
    id,
    name: sanitizeProfileName(name, 'Player 1'),
    highScores: createDefaultHighScores(),
    stats: createDefaultProfileStats(),
    unlockedModes: [...DEFAULT_UNLOCKED_MODES],
    unlockedTracks: [...ALL_TRACK_IDS],
    impossibleUnlocked: false,
    tutorialCompleted: false,
  };
}

export function createDefaultSaveData(): SaveData {
  const defaultProfile = createDefaultProfile();
  return {
    version: 1,
    activeProfileId: defaultProfile.id,
    profiles: [defaultProfile],
    customPalettes: [],
    settings: createDefaultUserSettings(),
    lastMode: 'marathon',
    lastTrack: 'tessellation',
  };
}

function sanitizeStats(raw: unknown): ProfileStats {
  const def = createDefaultProfileStats();
  if (!isRecord(raw)) {
    return def;
  }
  return {
    gamesPlayed: sanitizeNonNegInt(raw.gamesPlayed, def.gamesPlayed),
    marathonsCompleted: sanitizeNonNegInt(raw.marathonsCompleted, def.marathonsCompleted),
    intenseMarathonsCompleted: sanitizeNonNegInt(
      raw.intenseMarathonsCompleted,
      def.intenseMarathonsCompleted,
    ),
    impossibleMarathonsCompleted: sanitizeNonNegInt(
      raw.impossibleMarathonsCompleted,
      def.impossibleMarathonsCompleted,
    ),
    fastestMarathonMs: sanitizeNullableMs(raw.fastestMarathonMs),
    fastestIntenseMarathonMs: sanitizeNullableMs(raw.fastestIntenseMarathonMs),
    fastestImpossibleMarathonMs: sanitizeNullableMs(raw.fastestImpossibleMarathonMs),
    longestEndlessMs: sanitizeNonNegInt(raw.longestEndlessMs, def.longestEndlessMs),
    totalCombos: sanitizeNonNegInt(raw.totalCombos, def.totalCombos),
    longestCombo: sanitizeNonNegInt(raw.longestCombo, def.longestCombo),
    biggestClear: sanitizeNonNegInt(raw.biggestClear, def.biggestClear),
    highestClearScore: sanitizeNonNegInt(raw.highestClearScore, def.highestClearScore),
    pointsScored: sanitizeNonNegInt(raw.pointsScored, def.pointsScored),
    blocksCleared: sanitizeNonNegInt(raw.blocksCleared, def.blocksCleared),
    perfectClears: sanitizeNonNegInt(raw.perfectClears, def.perfectClears),
    drops: sanitizeNonNegInt(raw.drops, def.drops),
    timePlayedMs: sanitizeNonNegInt(raw.timePlayedMs, def.timePlayedMs),
  };
}

function sanitizeHighScores(raw: unknown): Record<GameModeId, number> {
  const scores = createDefaultHighScores();
  if (!isRecord(raw)) {
    return scores;
  }
  for (const mode of GAME_MODE_ORDER) {
    scores[mode] = sanitizeNonNegInt(raw[mode], 0);
  }
  return scores;
}

function sanitizeProfile(raw: unknown, index: number, usedIds: Set<string>): PlayerProfile | null {
  if (!isRecord(raw)) {
    return null;
  }
  const fallbackId = index === 0 ? 'profile_default' : `profile_${index + 1}`;
  let id =
    typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id.trim().slice(0, 48) : fallbackId;
  while (usedIds.has(id)) {
    id = `${fallbackId}_${usedIds.size + 1}`;
  }
  usedIds.add(id);

  const name = sanitizeProfileName(raw.name, `Player ${index + 1}`);
  const highScores = sanitizeHighScores(raw.highScores);
  const stats = sanitizeStats(raw.stats);

  const unlockedModeSet = new Set<GameModeId>(DEFAULT_UNLOCKED_MODES);
  if (Array.isArray(raw.unlockedModes)) {
    for (const item of raw.unlockedModes) {
      if (typeof item === 'string' && VALID_MODE_SET.has(item)) {
        unlockedModeSet.add(item as GameModeId);
      }
    }
  }

  const unlockedTrackSet = new Set<TrackId>(ALL_TRACK_IDS);
  if (Array.isArray(raw.unlockedTracks)) {
    for (const item of raw.unlockedTracks) {
      if (typeof item === 'string' && VALID_TRACK_SET.has(item)) {
        unlockedTrackSet.add(item as TrackId);
      }
    }
  }

  const highScoreUnlock = Object.values(highScores).some((s) => s >= IMPOSSIBLE_UNLOCK_SCORE);
  const impossibleUnlocked =
    sanitizeBool(raw.impossibleUnlocked, false) ||
    unlockedModeSet.has('impossible') ||
    highScoreUnlock;

  if (impossibleUnlocked) {
    unlockedModeSet.add('impossible');
  }

  return {
    id,
    name,
    highScores,
    stats,
    unlockedModes: GAME_MODE_ORDER.filter((m) => unlockedModeSet.has(m)),
    unlockedTracks: ALL_TRACK_IDS.filter((t) => unlockedTrackSet.has(t)),
    impossibleUnlocked,
    tutorialCompleted: sanitizeBool(raw.tutorialCompleted, false),
  };
}

function sanitizeCustomPalettes(raw: unknown): Palette[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: Palette[] = [];
  const usedIds = new Set<string>(BUILTIN_PALETTE_IDS);

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!isRecord(entry)) {
      continue;
    }
    const colors = normalizePaletteColors(entry.colors);
    if (!colors) {
      continue;
    }
    let id =
      typeof entry.id === 'string' && entry.id.trim().length > 0
        ? entry.id.trim().slice(0, 48)
        : `custom_${i + 1}`;
    if (usedIds.has(id)) {
      id = `custom_${i + 1}_${usedIds.size}`;
    }
    usedIds.add(id);

    const name = sanitizeProfileName(entry.name, `Custom ${result.length + 1}`);
    const author =
      typeof entry.author === 'string' && entry.author.trim().length > 0
        ? entry.author.trim().slice(0, 32)
        : 'Custom';

    result.push({
      id,
      name,
      author,
      colors,
      isCustom: true,
    });
  }

  return result;
}

function sanitizeKeyboardBindings(raw: unknown): KeyboardBindings {
  const def = createDefaultKeyboardBindings();
  if (!isRecord(raw)) {
    return def;
  }
  const out = {} as KeyboardBindings;
  for (const verb of ACTION_VERBS) {
    const candidate = raw[verb];
    if (Array.isArray(candidate)) {
      const cleaned = Array.from(
        new Set(
          candidate
            .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
            .map((k) => k.trim()),
        ),
      );
      out[verb] = cleaned.length > 0 ? cleaned : [...def[verb]];
    } else {
      out[verb] = [...def[verb]];
    }
  }
  return out;
}

function sanitizeGamepadBindings(raw: unknown): GamepadBindings {
  const def = createDefaultGamepadBindings();
  if (!isRecord(raw)) {
    return def;
  }
  const out = {} as GamepadBindings;
  for (const verb of ACTION_VERBS) {
    const candidate = raw[verb];
    if (Array.isArray(candidate)) {
      const cleaned = Array.from(
        new Set(
          candidate
            .filter((b): b is number => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 31),
        ),
      );
      out[verb] = cleaned.length > 0 ? cleaned : [...def[verb]];
    } else {
      out[verb] = [...def[verb]];
    }
  }
  return out;
}

function sanitizeSettings(raw: unknown, validPaletteIds: ReadonlySet<string>): UserSettings {
  const def = createDefaultUserSettings();
  if (!isRecord(raw)) {
    return def;
  }

  const rawRender = isRecord(raw.render) ? raw.render : {};
  const defRender = createDefaultRenderSettings();
  const targetFps: TargetFps =
    typeof rawRender.targetFps === 'number' && VALID_FPS_SET.has(rawRender.targetFps)
      ? (rawRender.targetFps as TargetFps)
      : defRender.targetFps;

  const rawGameplay = isRecord(raw.gameplay) ? raw.gameplay : {};
  const defGameplay = createDefaultGameplaySettings();
  const nextBlockLocation: NextBlockLocation =
    typeof rawGameplay.nextBlockLocation === 'string' &&
    VALID_NEXT_LOC_SET.has(rawGameplay.nextBlockLocation)
      ? (rawGameplay.nextBlockLocation as NextBlockLocation)
      : defGameplay.nextBlockLocation;

  const rawAudio = isRecord(raw.audio) ? raw.audio : {};
  const defAudio = createDefaultAudioSettings();

  const paletteId =
    typeof raw.paletteId === 'string' && validPaletteIds.has(raw.paletteId)
      ? raw.paletteId
      : def.paletteId;

  const packMode: PackMode =
    raw.packMode === 'custom' || raw.packMode === 'builtin' ? raw.packMode : def.packMode;

  return {
    paletteId,
    render: {
      targetFps,
      native60Snap: sanitizeBool(rawRender.native60Snap, defRender.native60Snap),
      bloomAmount: sanitizeClampedFloat(rawRender.bloomAmount, 0, 1, defRender.bloomAmount),
      boardShake: sanitizeBool(rawRender.boardShake, defRender.boardShake),
      boardRipple: sanitizeBool(rawRender.boardRipple, defRender.boardRipple),
      particles: sanitizeBool(rawRender.particles, defRender.particles),
      flashing: sanitizeBool(rawRender.flashing, defRender.flashing),
      bgShapes: sanitizeBool(rawRender.bgShapes, defRender.bgShapes),
      boardColors: sanitizeBool(rawRender.boardColors, defRender.boardColors),
      boardZoom: sanitizeBool(rawRender.boardZoom, defRender.boardZoom),
      tateRotate: sanitizeBool(rawRender.tateRotate, defRender.tateRotate),
    },
    gameplay: {
      dropPreviewOpacity: sanitizeClampedFloat(
        rawGameplay.dropPreviewOpacity,
        0,
        1,
        defGameplay.dropPreviewOpacity,
      ),
      nextBlockLocation,
      preciseTimer: sanitizeBool(rawGameplay.preciseTimer, defGameplay.preciseTimer),
      moveSpeedIndex: sanitizeClampedInt(
        rawGameplay.moveSpeedIndex,
        0,
        ARR_MOVE_SPEED_TICKS.length - 1,
        defGameplay.moveSpeedIndex,
      ),
      kbMoveDelay: sanitizeClampedInt(rawGameplay.kbMoveDelay, 0, 15, defGameplay.kbMoveDelay),
      gpMoveDelay: sanitizeClampedInt(rawGameplay.gpMoveDelay, 0, 15, defGameplay.gpMoveDelay),
      gamepadRumble: sanitizeBool(rawGameplay.gamepadRumble, defGameplay.gamepadRumble),
      tutorialEnabled: sanitizeBool(rawGameplay.tutorialEnabled, defGameplay.tutorialEnabled),
      soundtestEnabled: sanitizeBool(rawGameplay.soundtestEnabled, defGameplay.soundtestEnabled),
    },
    audio: {
      masterVolume: sanitizeClampedFloat(rawAudio.masterVolume, 0, 1, defAudio.masterVolume),
      muted: sanitizeBool(rawAudio.muted, defAudio.muted),
    },
    keyboard: sanitizeKeyboardBindings(raw.keyboard),
    gamepad: sanitizeGamepadBindings(raw.gamepad),
    packMode,
    photosensitivitySeen: sanitizeBool(raw.photosensitivitySeen, def.photosensitivitySeen),
  };
}

/**
 * Strictly validates and repairs arbitrary parsed JSON into a guaranteed-valid SaveData object.
 * Never throws.
 */
export function sanitizeSaveData(raw: unknown): { data: SaveData; repaired: boolean } {
  if (!isRecord(raw) || raw.version !== 1) {
    return { data: createDefaultSaveData(), repaired: true };
  }

  let repaired = false;

  const customPalettes = sanitizeCustomPalettes(raw.customPalettes);
  if (!Array.isArray(raw.customPalettes) || customPalettes.length !== raw.customPalettes.length) {
    repaired = true;
  }

  const validPaletteIds = new Set<string>(BUILTIN_PALETTE_IDS);
  for (const cp of customPalettes) {
    validPaletteIds.add(cp.id);
  }

  const usedProfileIds = new Set<string>();
  const profiles: PlayerProfile[] = [];
  if (Array.isArray(raw.profiles)) {
    for (let i = 0; i < raw.profiles.length; i++) {
      const sanitized = sanitizeProfile(raw.profiles[i], i, usedProfileIds);
      if (sanitized) {
        profiles.push(sanitized);
      } else {
        repaired = true;
      }
    }
  } else {
    repaired = true;
  }

  if (profiles.length === 0) {
    profiles.push(createDefaultProfile());
    repaired = true;
  }

  // Propagate global 4,000,000 Impossible unlock across roster if any profile earned it
  if (checkImpossibleUnlock(profiles)) {
    for (const profile of profiles) {
      profile.impossibleUnlocked = true;
      if (!profile.unlockedModes.includes('impossible')) {
        profile.unlockedModes.push('impossible');
      }
    }
  }

  const activeProfileId =
    typeof raw.activeProfileId === 'string' && profiles.some((p) => p.id === raw.activeProfileId)
      ? raw.activeProfileId
      : profiles[0].id;
  if (activeProfileId !== raw.activeProfileId) {
    repaired = true;
  }

  const settings = sanitizeSettings(raw.settings, validPaletteIds);
  const lastMode: GameModeId =
    typeof raw.lastMode === 'string' && VALID_MODE_SET.has(raw.lastMode)
      ? (raw.lastMode as GameModeId)
      : 'marathon';
  const lastTrack: TrackId =
    typeof raw.lastTrack === 'string' && VALID_TRACK_SET.has(raw.lastTrack)
      ? (raw.lastTrack as TrackId)
      : 'tessellation';

  const result: SaveData = {
    version: 1,
    activeProfileId,
    profiles,
    customPalettes,
    settings,
    lastMode,
    lastTrack,
  };

  if (!repaired) {
    try {
      repaired = JSON.stringify(raw) !== JSON.stringify(result);
    } catch {
      repaired = true;
    }
  }

  return {
    data: result,
    repaired,
  };
}

function resolveDefaultStorage(): StorageLike {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      const probeKey = '__krunked_lumia_probe__';
      globalThis.localStorage.setItem(probeKey, '1');
      globalThis.localStorage.removeItem(probeKey);
      return globalThis.localStorage;
    }
  } catch {
    // Fallback to in-memory storage in restricted/headless contexts
  }
  return new MemoryStorage();
}

export class SaveManager {
  private readonly storage: StorageLike;
  private readonly storageKey: string;
  private data: SaveData;
  private recoveredFromCorruption = false;

  constructor(storage?: StorageLike, storageKey = SAVE_STORAGE_KEY) {
    this.storage = storage ?? resolveDefaultStorage();
    this.storageKey = storageKey;
    this.data = this.load();
  }

  wasRecoveredFromCorruption(): boolean {
    return this.recoveredFromCorruption;
  }

  load(): SaveData {
    this.recoveredFromCorruption = false;
    let rawText: string | null = null;
    try {
      rawText = this.storage.getItem(this.storageKey);
    } catch {
      this.recoveredFromCorruption = true;
      this.data = createDefaultSaveData();
      return this.data;
    }

    if (rawText === null || rawText.trim() === '') {
      this.data = createDefaultSaveData();
      return this.data;
    }

    try {
      const parsed: unknown = JSON.parse(rawText);
      const { data, repaired } = sanitizeSaveData(parsed);
      this.data = data;
      this.recoveredFromCorruption = repaired;
      if (repaired) {
        this.save();
      }
      return this.data;
    } catch {
      this.recoveredFromCorruption = true;
      this.data = createDefaultSaveData();
      this.save();
      return this.data;
    }
  }

  save(): void {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch {
      // Ignore storage quota or private browsing errors gracefully
    }
  }

  reset(): SaveData {
    this.data = createDefaultSaveData();
    this.recoveredFromCorruption = false;
    this.save();
    return this.data;
  }

  getData(): SaveData {
    return this.data;
  }

  getProfiles(): PlayerProfile[] {
    return this.data.profiles;
  }

  getActiveProfile(): PlayerProfile {
    const found = this.data.profiles.find((p) => p.id === this.data.activeProfileId);
    if (found) {
      return found;
    }
    this.data.activeProfileId = this.data.profiles[0].id;
    return this.data.profiles[0];
  }

  createProfile(name: string): PlayerProfile {
    const existingIds = new Set(this.data.profiles.map((p) => p.id));
    let seq = this.data.profiles.length + 1;
    let id = `profile_${seq}`;
    while (existingIds.has(id)) {
      seq++;
      id = `profile_${seq}`;
    }

    const profile = createDefaultProfile(
      sanitizeProfileName(name, `Player ${seq}`),
      id,
    );

    if (checkImpossibleUnlock(this.data.profiles)) {
      profile.impossibleUnlocked = true;
      if (!profile.unlockedModes.includes('impossible')) {
        profile.unlockedModes.push('impossible');
      }
    }

    this.data.profiles.push(profile);
    this.data.activeProfileId = profile.id;
    this.save();
    return profile;
  }

  renameProfile(profileId: string, newName: string): PlayerProfile | null {
    const profile = this.data.profiles.find((p) => p.id === profileId);
    if (!profile) {
      return null;
    }
    profile.name = sanitizeProfileName(newName, profile.name);
    this.save();
    return profile;
  }

  deleteProfile(profileId: string): boolean {
    if (this.data.profiles.length <= 1) {
      return false;
    }
    const idx = this.data.profiles.findIndex((p) => p.id === profileId);
    if (idx === -1) {
      return false;
    }
    this.data.profiles.splice(idx, 1);
    if (this.data.activeProfileId === profileId) {
      this.data.activeProfileId = this.data.profiles[0].id;
    }
    this.save();
    return true;
  }

  selectProfile(profileId: string): PlayerProfile | null {
    const profile = this.data.profiles.find((p) => p.id === profileId);
    if (!profile) {
      return null;
    }
    this.data.activeProfileId = profile.id;
    this.save();
    return profile;
  }

  getSettings(): UserSettings {
    return this.data.settings;
  }

  updateSettings(patch: SettingsUpdatePatch): UserSettings {
    const validPaletteIds = new Set<string>(BUILTIN_PALETTE_IDS);
    for (const cp of this.data.customPalettes) {
      validPaletteIds.add(cp.id);
    }

    const mergedRaw = {
      ...this.data.settings,
      ...patch,
      render: {
        ...this.data.settings.render,
        ...(patch.render ?? {}),
      },
      gameplay: {
        ...this.data.settings.gameplay,
        ...(patch.gameplay ?? {}),
      },
      audio: {
        ...this.data.settings.audio,
        ...(patch.audio ?? {}),
      },
      keyboard: {
        ...this.data.settings.keyboard,
        ...(patch.keyboard ?? {}),
      },
      gamepad: {
        ...this.data.settings.gamepad,
        ...(patch.gamepad ?? {}),
      },
    };

    this.data.settings = sanitizeSettings(mergedRaw, validPaletteIds);
    this.save();
    return this.data.settings;
  }

  setLastSelection(mode: GameModeId, trackId: TrackId): void {
    if (VALID_MODE_SET.has(mode)) {
      this.data.lastMode = mode;
    }
    if (VALID_TRACK_SET.has(trackId)) {
      this.data.lastTrack = trackId;
    }
    this.save();
  }

  markPhotosensitivitySeen(): void {
    this.data.settings.photosensitivitySeen = true;
    this.save();
  }

  markTutorialCompleted(): void {
    const profile = this.getActiveProfile();
    profile.tutorialCompleted = true;
    this.save();
  }

  /**
   * Records a completed or game-over run into the active profile, updating high scores,
   * lifetime stats, fastest speedrun times, and checking the 4,000,000 Impossible unlock.
   */
  recordRunResult(simState: SimState): RunRecordOutcome {
    const profile = this.getActiveProfile();
    const mode = simState.mode;
    const score = sanitizeNonNegInt(simState.score, 0);
    const cleared = sanitizeNonNegInt(simState.cleared, 0);
    const elapsedMs = Math.round(sanitizeNonNegInt(simState.elapsedTicks, 0) * SIM_DT_MS);

    const previousHighScore = profile.highScores[mode] ?? 0;
    const isNewHighScore = score > previousHighScore;
    if (isNewHighScore) {
      profile.highScores[mode] = score;
    }

    const stats = profile.stats;
    stats.gamesPlayed += 1;
    stats.pointsScored += score;
    stats.blocksCleared += cleared;
    stats.totalCombos += sanitizeNonNegInt(simState.totalCombos, 0);
    stats.longestCombo = Math.max(stats.longestCombo, sanitizeNonNegInt(simState.maxCombo, 0));
    stats.biggestClear = Math.max(stats.biggestClear, sanitizeNonNegInt(simState.biggestClear, 0));
    stats.highestClearScore = Math.max(
      stats.highestClearScore,
      sanitizeNonNegInt(simState.highestClearScore, 0),
    );
    stats.perfectClears += sanitizeNonNegInt(simState.perfectClears, 0);
    stats.drops += sanitizeNonNegInt(simState.drops, 0);
    stats.timePlayedMs += elapsedMs;

    if (mode === 'endless' && elapsedMs > stats.longestEndlessMs) {
      stats.longestEndlessMs = elapsedMs;
    }

    let fastestTimeBeaten = false;
    if (simState.phase === 'VICTORY') {
      if (mode === 'marathon') {
        stats.marathonsCompleted += 1;
        if (stats.fastestMarathonMs === null || elapsedMs < stats.fastestMarathonMs) {
          stats.fastestMarathonMs = elapsedMs;
          fastestTimeBeaten = true;
        }
      } else if (mode === 'intense') {
        stats.intenseMarathonsCompleted += 1;
        if (stats.fastestIntenseMarathonMs === null || elapsedMs < stats.fastestIntenseMarathonMs) {
          stats.fastestIntenseMarathonMs = elapsedMs;
          fastestTimeBeaten = true;
        }
      } else if (mode === 'impossible') {
        stats.impossibleMarathonsCompleted += 1;
        if (
          stats.fastestImpossibleMarathonMs === null ||
          elapsedMs < stats.fastestImpossibleMarathonMs
        ) {
          stats.fastestImpossibleMarathonMs = elapsedMs;
          fastestTimeBeaten = true;
        }
      }
    }

    if (simState.tutorial.completed) {
      profile.tutorialCompleted = true;
    }

    const wasImpossibleUnlocked = profile.impossibleUnlocked;
    const shouldUnlockImpossible =
      simState.impossibleUnlockedThisRun ||
      score >= IMPOSSIBLE_UNLOCK_SCORE ||
      checkImpossibleUnlock(this.data.profiles);

    let impossibleNewlyUnlocked = false;
    if (shouldUnlockImpossible) {
      for (const p of this.data.profiles) {
        p.impossibleUnlocked = true;
        if (!p.unlockedModes.includes('impossible')) {
          p.unlockedModes.push('impossible');
        }
      }
      impossibleNewlyUnlocked = !wasImpossibleUnlocked;
    }

    this.data.lastMode = simState.mode;
    this.data.lastTrack = simState.trackId;
    this.save();

    return {
      isNewHighScore,
      previousHighScore,
      impossibleNewlyUnlocked,
      fastestTimeBeaten,
      elapsedMs,
    };
  }

  setImpossibleUnlocked(unlocked: boolean): void {
    for (const profile of this.data.profiles) {
      profile.impossibleUnlocked = unlocked;
      if (unlocked) {
        if (!profile.unlockedModes.includes('impossible')) {
          profile.unlockedModes.push('impossible');
        }
      } else {
        profile.unlockedModes = profile.unlockedModes.filter((m) => m !== 'impossible');
      }
    }
    this.save();
  }

  unlockAll(profileId?: string): void {
    const targets = profileId
      ? this.data.profiles.filter((p) => p.id === profileId)
      : this.data.profiles;
    for (const profile of targets) {
      profile.unlockedModes = [...GAME_MODE_ORDER];
      profile.unlockedTracks = [...ALL_TRACK_IDS];
      profile.impossibleUnlocked = true;
    }
    this.save();
  }

  getCustomPalettes(): Palette[] {
    return this.data.customPalettes;
  }

  getAllPalettes(): Palette[] {
    return [...BUILTIN_PALETTES, ...this.data.customPalettes];
  }

  saveCustomPalette(input: CustomPaletteInput): Palette | null {
    const colors = normalizePaletteColors(input.colors);
    if (!colors) {
      return null;
    }

    const name = sanitizeProfileName(input.name, `Custom ${this.data.customPalettes.length + 1}`);
    const author =
      typeof input.author === 'string' && input.author.trim().length > 0
        ? input.author.trim().slice(0, 32)
        : 'Custom';

    const requestedId =
      typeof input.id === 'string' && input.id.trim().length > 0 ? input.id.trim().slice(0, 48) : '';

    if (requestedId && !BUILTIN_PALETTE_IDS.has(requestedId)) {
      const existingIdx = this.data.customPalettes.findIndex((p) => p.id === requestedId);
      if (existingIdx !== -1) {
        const updated: Palette = {
          id: requestedId,
          name,
          author,
          colors,
          isCustom: true,
        };
        this.data.customPalettes[existingIdx] = updated;
        this.save();
        return updated;
      }
    }

    const usedIds = new Set<string>([
      ...BUILTIN_PALETTE_IDS,
      ...this.data.customPalettes.map((p) => p.id),
    ]);

    let id =
      requestedId && !usedIds.has(requestedId)
        ? requestedId
        : `custom_${this.data.customPalettes.length + 1}`;
    let counter = 1;
    while (usedIds.has(id)) {
      id = `custom_${this.data.customPalettes.length + 1 + counter++}`;
    }

    const created: Palette = {
      id,
      name,
      author,
      colors,
      isCustom: true,
    };
    this.data.customPalettes.push(created);
    this.save();
    return created;
  }

  deleteCustomPalette(paletteId: string): boolean {
    if (BUILTIN_PALETTE_IDS.has(paletteId)) {
      return false;
    }
    const idx = this.data.customPalettes.findIndex((p) => p.id === paletteId);
    if (idx === -1) {
      return false;
    }
    this.data.customPalettes.splice(idx, 1);
    if (this.data.settings.paletteId === paletteId) {
      this.data.settings.paletteId = 'pico_dark';
    }
    this.save();
    return true;
  }

  /**
   * Reset keyboard or gamepad bindings cleanly to defaults.
   */
  resetControlBindings(device: 'keyboard' | 'gamepad' | 'both' = 'both'): UserSettings {
    if (device === 'keyboard' || device === 'both') {
      this.data.settings.keyboard = createDefaultKeyboardBindings();
    }
    if (device === 'gamepad' || device === 'both') {
      this.data.settings.gamepad = createDefaultGamepadBindings();
    }
    this.save();
    return this.data.settings;
  }

  /**
   * Rebind a single action verb safely (always keeping at least one valid binding).
   */
  setKeyboardBinding(verb: ActionVerb, keys: readonly string[]): UserSettings {
    const cleaned = Array.from(new Set(keys.map((k) => k.trim()).filter(Boolean)));
    if (cleaned.length > 0) {
      this.data.settings.keyboard[verb] = cleaned;
      this.save();
    }
    return this.data.settings;
  }
}
