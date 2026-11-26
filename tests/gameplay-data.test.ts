import { describe, expect, it } from 'vitest';
import {
  ALL_TRACK_IDS,
  BOARD_CELL_COUNT,
  CELL_EMPTY,
  GAME_MODE_ORDER,
  IMPOSSIBLE_UNLOCK_SCORE,
  MODE_COUNT,
  PALETTE_COUNT,
  RUSH_DURATION_TICKS,
  RUSH_TRACK_POOL,
  SAVE_STORAGE_KEY,
  STANDARD_TRACK_POOL,
  TRACK_COUNT,
  isLightPaletteBg,
  type SimState,
} from '../src/contracts/index.js';
import {
  EN_US_STRINGS,
  formatT,
  parseLocalizationCsv,
  t,
} from '../src/data/localization.js';
import {
  GAME_MODE_CONFIGS,
  MODE_LIST,
  MODE_METADATA,
  getModeDetails,
  getModeMetadata,
  isSpeedrunMode,
} from '../src/data/modes.js';
import {
  BUILTIN_PALETTES,
  HEX_COLOR_RE,
  decodePaletteShareCode,
  decodePaletteShareEntry,
  encodePaletteShareCode,
  getDefaultPalette,
  getPaletteById,
  isPaletteLight,
  isValidPaletteColors,
  normalizeHexColor,
  parsePalettesIni,
} from '../src/data/palettes.js';
import {
  ACTION_VERBS,
  createDefaultAudioSettings,
  createDefaultGamepadBindings,
  createDefaultGameplaySettings,
  createDefaultKeyboardBindings,
  createDefaultRenderSettings,
  createDefaultUserSettings,
} from '../src/data/settingsDefaults.js';
import {
  TRACK_CATALOG,
  TRACK_LIST,
  getTrackMeta,
  getTracksForMode,
  isTrackValidForMode,
} from '../src/data/tracks.js';
import {
  checkImpossibleUnlock,
  computeLevelForCleared,
  computeModeProgress,
  computeTargetSongSection,
  getModeConfig,
  isModeUnlocked,
} from '../src/sim/modes.js';
import {
  TUTORIAL_PROMPTS,
  TUTORIAL_STEP_ORDER,
  createInitialTutorialState,
  getNextTutorialStep,
  getTutorialProgress,
  getTutorialPrompt,
} from '../src/sim/tutorial.js';
import {
  MemoryStorage,
  SaveManager,
  createDefaultProfile,
  sanitizeSaveData,
} from '../src/app/SaveManager.js';

const FORBIDDEN_BRAND_PATTERNS = [
  /mixolumia/i,
  /steam/i,
  /patreon/i,
  /discord/i,
  /gamemaker/i,
  /gms2/i,
  /davemakes/i,
];

function makeMockSimState(overrides: Partial<SimState> = {}): SimState {
  const mode = overrides.mode ?? 'marathon';
  return {
    tick: 600,
    rngState: 12345,
    mode,
    trackId: overrides.trackId ?? 'tessellation',
    phase: overrides.phase ?? 'GAME_OVER',
    phaseTimer: 0,
    grid: new Array(BOARD_CELL_COUNT).fill(CELL_EMPTY),
    automata: new Array(BOARD_CELL_COUNT).fill(0),
    automataTickCounter: 0,
    deck: [1, 2, 3, 4],
    nextColors: [1, 2, 3, 4],
    tetrad: null,
    ghostY: 0,
    lastFallLeft: false,
    score: 25_000,
    cleared: 64,
    level: 2,
    startLevel: 0,
    combo: 0,
    maxCombo: 3,
    totalCombos: 7,
    biggestClear: 9,
    highestClearScore: 8100,
    perfectClears: 1,
    drops: 42,
    turnCleared: 0,
    turnScored: 0,
    elapsedTicks: 3600, // 60 seconds
    remainingTicks: mode === 'rush' ? 0 : 0,
    songSection: 'end',
    boardOffsetX: 0,
    boardOffsetY: 0,
    prevBoardOffsetX: 0,
    prevBoardOffsetY: 0,
    dasDir: 0,
    dasTimer: 0,
    arrTimer: 0,
    impossibleDropStep: 0,
    impossibleDropTimer: 50,
    tutorial: createInitialTutorialState(false),
    finished: true,
    impossibleUnlockedThisRun: false,
    ...overrides,
  };
}

describe('Palettes Catalog, INI Parser & Share Codes', () => {
  it('provides exactly 63 built-in palettes with valid 6-slot lowercase #rrggbb colors', () => {
    expect(BUILTIN_PALETTES).toHaveLength(PALETTE_COUNT);
    expect(BUILTIN_PALETTES).toHaveLength(63);

    const ids = new Set<string>();
    const names = new Set<string>();

    for (const palette of BUILTIN_PALETTES) {
      expect(ids.has(palette.id)).toBe(false);
      expect(names.has(palette.name)).toBe(false);
      ids.add(palette.id);
      names.add(palette.name);

      expect(palette.isCustom).toBe(false);
      expect(palette.colors).toHaveLength(6);
      expect(isValidPaletteColors(palette.colors)).toBe(true);
      for (const hex of palette.colors) {
        expect(hex).toMatch(HEX_COLOR_RE);
      }

      // All 4 playable block colors (slots 2..5) must be distinct within each palette
      const blockSlots = new Set(palette.colors.slice(2));
      expect(blockSlots.size).toBe(4);
    }
  });

  it('preserves exact signature palettes at indices 0..4', () => {
    expect(BUILTIN_PALETTES[0]).toMatchObject({
      id: 'pico_dark',
      name: 'Pico Dark',
      colors: ['#000000', '#1d2b53', '#fff7f2', '#ffec27', '#29adff', '#ff004d'],
    });
    expect(BUILTIN_PALETTES[1]).toMatchObject({
      id: 'pico_light',
      name: 'Pico Light',
      colors: ['#fff1e8', '#f0d4d3', '#1d2b53', '#ffa300', '#29adff', '#ff004d'],
    });
    expect(BUILTIN_PALETTES[2]).toMatchObject({
      id: 'caprese',
      name: 'Caprese',
      colors: ['#1b2b34', '#343d46', '#cdd3de', '#99c794', '#ec5f67', '#fac863'],
    });
    expect(BUILTIN_PALETTES[3]).toMatchObject({
      id: 'calm',
      name: 'Calm',
      colors: ['#fbe8cf', '#f0dcc5', '#b0a291', '#4d7167', '#019bbd', '#fe6f63'],
    });
    expect(BUILTIN_PALETTES[4]).toMatchObject({
      id: 'ultraviolet',
      name: 'Ultraviolet',
      colors: ['#0c0616', '#200346', '#cd00ff', '#5900a6', '#9b59ff', '#fcd3ff'],
    });
  });

  it('includes a strong mix of both dark and light palettes', () => {
    const lightCount = BUILTIN_PALETTES.filter((p) => isLightPaletteBg(p.colors[0])).length;
    const darkCount = BUILTIN_PALETTES.length - lightCount;

    expect(isPaletteLight(BUILTIN_PALETTES[0])).toBe(false); // pico_dark
    expect(isPaletteLight(BUILTIN_PALETTES[1])).toBe(true); // pico_light
    expect(isPaletteLight(BUILTIN_PALETTES[3])).toBe(true); // calm
    expect(darkCount).toBeGreaterThanOrEqual(25);
    expect(lightCount).toBeGreaterThanOrEqual(15);
  });

  it('resolves palettes safely via getPaletteById with pico_dark fallback', () => {
    const custom = {
      id: 'custom_neon',
      name: 'Custom Neon',
      colors: ['#000000', '#111111', '#ffffff', '#ff0000', '#00ff00', '#0000ff'] as [
        string,
        string,
        string,
        string,
        string,
        string,
      ],
      isCustom: true,
    };
    const combined = [...BUILTIN_PALETTES, custom];

    expect(getPaletteById('caprese', combined).name).toBe('Caprese');
    expect(getPaletteById('custom_neon', combined).name).toBe('Custom Neon');
    expect(getPaletteById('nonexistent_id', combined)).toEqual(getDefaultPalette());
    expect(getPaletteById('nonexistent_id', combined).id).toBe('pico_dark');
  });

  it('parses retail palettes.ini [0]..[62] handling quoted, unquoted, # prefix, uppercase, and malformed sections', () => {
    const iniSample = `
; comment line
# hash comment
[0]
name="Pico Dark"
0="#000000"
1="#1D2B53"
2="FFF7F2"
3=ffec27
4="#29ADFF"
5="ff004d"

[1]
name=Pico Light
author="Foundry"
c0=FFF1E8
c1=#F0D4D3
c2="1d2b53"
c3="#FFA300"
c4=29adff
c5=FF004D

[2]
name="Broken Missing Slots"
0="#000000"
1="#111111"

[62]
name="Terminal Final"
color0="#041108"
color1="#0c2414"
color2="#c8ffd4"
color3="#33ff66"
color4="#00cc99"
color5="#99ff33"
`;
    const parsed = parsePalettesIni(iniSample);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].name).toBe('Pico Dark');
    expect(parsed[0].colors).toEqual([
      '#000000',
      '#1d2b53',
      '#fff7f2',
      '#ffec27',
      '#29adff',
      '#ff004d',
    ]);
    expect(parsed[1].name).toBe('Pico Light');
    expect(parsed[1].author).toBe('Foundry');
    expect(parsed[1].colors).toEqual([
      '#fff1e8',
      '#f0d4d3',
      '#1d2b53',
      '#ffa300',
      '#29adff',
      '#ff004d',
    ]);
    expect(parsed[2].name).toBe('Terminal Final');
    expect(parsed[2].colors[3]).toBe('#33ff66');
  });

  it('round-trips compact 36-hex share codes and optional name: prefixes across all 63 palettes', () => {
    for (const palette of BUILTIN_PALETTES) {
      const compact = encodePaletteShareCode(palette);
      expect(compact).toMatch(/^[0-9a-f]{36}$/);
      expect(decodePaletteShareCode(compact)).toEqual(palette.colors);

      const named = encodePaletteShareCode(palette, true);
      expect(named).toBe(`${palette.name}:${compact}`);
      expect(decodePaletteShareCode(named)).toEqual(palette.colors);

      const entry = decodePaletteShareEntry(named);
      expect(entry).toEqual({ name: palette.name, colors: palette.colors });
    }

    // Tolerant parsing with uppercase, hashes, and commas
    const tolerant = decodePaletteShareCode(
      'My Theme: #000000, #1D2B53, #FFF7F2, #FFEC27, #29ADFF, #FF004D',
    );
    expect(tolerant).toEqual(BUILTIN_PALETTES[0].colors);

    // Invalid codes rejected safely
    expect(decodePaletteShareCode('')).toBeNull();
    expect(decodePaletteShareCode('not-a-palette')).toBeNull();
    expect(decodePaletteShareCode('123456')).toBeNull();
    expect(decodePaletteShareCode('zzzzzz000000111111222222333333444444')).toBeNull();
    expect(normalizeHexColor('bad')).toBeNull();
    expect(normalizeHexColor('"#AbCdEf"')).toBe('#abcdef');
  });
});

describe('Modes, Tracks & Simulation Mode Helpers', () => {
  it('exposes all 6 modes with configs and metadata', () => {
    expect(GAME_MODE_ORDER).toHaveLength(MODE_COUNT);
    expect(MODE_LIST).toHaveLength(6);

    for (const modeId of GAME_MODE_ORDER) {
      expect(GAME_MODE_CONFIGS[modeId].id).toBe(modeId);
      expect(MODE_METADATA[modeId].id).toBe(modeId);
      expect(getModeConfig(modeId)).toEqual(GAME_MODE_CONFIGS[modeId]);
      expect(getModeMetadata(modeId)).toEqual(MODE_METADATA[modeId]);
      expect(getModeDetails(modeId).badge.length).toBeGreaterThan(0);
    }

    expect(isSpeedrunMode('marathon')).toBe(true);
    expect(isSpeedrunMode('intense')).toBe(true);
    expect(isSpeedrunMode('impossible')).toBe(true);
    expect(isSpeedrunMode('endless')).toBe(false);
    expect(isSpeedrunMode('relaxed')).toBe(false);
    expect(isSpeedrunMode('rush')).toBe(false);
  });

  it('computes mode progress, level scaling, and target song sections accurately', () => {
    expect(
      computeModeProgress({
        mode: 'marathon',
        cleared: 225,
        elapsedTicks: 1000,
        remainingTicks: 0,
      }),
    ).toBeCloseTo(0.5);

    expect(
      computeModeProgress({
        mode: 'rush',
        cleared: 0,
        elapsedTicks: 3600,
        remainingTicks: RUSH_DURATION_TICKS / 2,
      }),
    ).toBeCloseTo(0.5);

    // Marathon thresholds: 150 -> middle, 300 -> outro, finished -> end
    expect(
      computeTargetSongSection({
        mode: 'marathon',
        cleared: 149,
        remainingTicks: 0,
        phase: 'FALLING_TETRAD',
        finished: false,
      }),
    ).toBe('start');
    expect(
      computeTargetSongSection({
        mode: 'marathon',
        cleared: 150,
        remainingTicks: 0,
        phase: 'FALLING_TETRAD',
        finished: false,
      }),
    ).toBe('middle');
    expect(
      computeTargetSongSection({
        mode: 'marathon',
        cleared: 300,
        remainingTicks: 0,
        phase: 'FALLING_TETRAD',
        finished: false,
      }),
    ).toBe('outro');
    expect(
      computeTargetSongSection({
        mode: 'marathon',
        cleared: 450,
        remainingTicks: 0,
        phase: 'VICTORY',
        finished: true,
      }),
    ).toBe('end');

    // Rush time progression (7200 ticks total -> 4800 remaining = 1/3 elapsed -> middle, 2400 = 2/3 -> outro)
    expect(
      computeTargetSongSection({
        mode: 'rush',
        cleared: 0,
        remainingTicks: 4800,
        phase: 'FALLING_TETRAD',
        finished: false,
      }),
    ).toBe('middle');
    expect(
      computeTargetSongSection({
        mode: 'rush',
        cleared: 0,
        remainingTicks: 2400,
        phase: 'FALLING_TETRAD',
        finished: false,
      }),
    ).toBe('outro');

    // Level scaling
    expect(computeLevelForCleared('marathon', 0)).toBe(0);
    expect(computeLevelForCleared('marathon', 60)).toBe(2);
    expect(computeLevelForCleared('intense', 30)).toBe(16);
    expect(computeLevelForCleared('relaxed', 900)).toBe(0);
  });

  it('evaluates Impossible unlock threshold (4,000,000) and mode locks accurately', () => {
    const profileA = createDefaultProfile('A', 'a');
    const profileB = createDefaultProfile('B', 'b');

    expect(isModeUnlocked('marathon', profileA)).toBe(true);
    expect(isModeUnlocked('rush', profileA)).toBe(true);
    expect(isModeUnlocked('impossible', profileA)).toBe(false);
    expect(checkImpossibleUnlock([profileA, profileB])).toBe(false);

    profileB.highScores.endless = IMPOSSIBLE_UNLOCK_SCORE - 1;
    expect(checkImpossibleUnlock([profileA, profileB])).toBe(false);

    profileB.highScores.endless = IMPOSSIBLE_UNLOCK_SCORE;
    expect(checkImpossibleUnlock([profileA, profileB])).toBe(true);
    expect(isModeUnlocked('impossible', profileB)).toBe(true);
  });

  it('exposes all 8 tracks with proper Standard (6) and Rush (3) pool mapping', () => {
    expect(ALL_TRACK_IDS).toHaveLength(TRACK_COUNT);
    expect(TRACK_LIST).toHaveLength(8);
    for (const id of ALL_TRACK_IDS) {
      const meta = getTrackMeta(id);
      expect(meta.id).toBe(id);
      expect(meta.title.length).toBeGreaterThan(0);
      expect(meta.artist.length).toBeGreaterThan(0);
      expect(meta.bpm).toBeGreaterThanOrEqual(60);
      expect(meta.bpmLabel).toContain('BPM');
      expect(TRACK_CATALOG[id]).toEqual(meta);
    }

    const standardTracks = getTracksForMode('marathon');
    expect(standardTracks.map((tr) => tr.id)).toEqual([...STANDARD_TRACK_POOL]);
    expect(standardTracks).toHaveLength(6);

    const rushTracks = getTracksForMode('rush');
    expect(rushTracks.map((tr) => tr.id)).toEqual([...RUSH_TRACK_POOL]);
    expect(rushTracks).toHaveLength(3);

    expect(isTrackValidForMode('tessellation', 'marathon')).toBe(true);
    expect(isTrackValidForMode('hazard', 'marathon')).toBe(false);
    expect(isTrackValidForMode('hazard', 'rush')).toBe(true);
    expect(isTrackValidForMode('minimum', 'rush')).toBe(true);
    expect(isTrackValidForMode('minimum', 'endless')).toBe(true);
  });
});

describe('Tutorial, Localization, Settings Defaults & Brand Hygiene', () => {
  it('defines prompts and progress for all 6 tutorial steps', () => {
    expect(TUTORIAL_STEP_ORDER).toEqual(['MOVE', 'SPIN', 'DROP', 'MATCH', 'ADVANCED', 'DONE']);
    for (const step of TUTORIAL_STEP_ORDER) {
      const prompt = getTutorialPrompt(step);
      expect(prompt).toEqual(TUTORIAL_PROMPTS[step]);
      expect(prompt.title.length).toBeGreaterThan(0);
      expect(prompt.hint.length).toBeGreaterThan(0);
      expect(prompt.iconKey.length).toBeGreaterThan(0);
      expect(t(prompt.locTitleKey)).not.toBe(prompt.locTitleKey);
      expect(t(prompt.locHintKey)).not.toBe(prompt.locHintKey);
    }

    expect(getNextTutorialStep('MOVE')).toBe('SPIN');
    expect(getNextTutorialStep('ADVANCED')).toBe('DONE');
    expect(getNextTutorialStep('DONE')).toBe('DONE');

    const tut = createInitialTutorialState(true);
    tut.moveCount = 1;
    const progress = getTutorialProgress(tut);
    expect(progress.current).toBe(1);
    expect(progress.target).toBe(2);
    expect(progress.fraction).toBeCloseTo(0.5);
  });

  it('parses localization CSV and translates with fallback and interpolation', () => {
    expect(t('app.title')).toBe('KRUNKED LUMIA');
    expect(t('unknown.key')).toBe('unknown.key');
    expect(t('app.title', { 'app.title': 'OVERRIDE' })).toBe('OVERRIDE');
    expect(formatT('greeting', { name: 'Marcus' }, { greeting: 'Hi {name}!' })).toBe('Hi Marcus!');

    const csv =
      '\uFEFFkey,en_us\r\n' +
      'menu.play,PLAY\r\n' +
      'desc.comma,"Clear 3+, chain ""combos""\nfast!"\r\n' +
      'empty_line_ignored\r\n';
    const parsed = parseLocalizationCsv(csv);
    expect(parsed).toEqual({
      'menu.play': 'PLAY',
      'desc.comma': 'Clear 3+, chain "combos"\nfast!',
    });
  });

  it('enforces ergonomic default settings and exact keyboard bindings', () => {
    const kb = createDefaultKeyboardBindings();
    expect(kb.moveLeft).toEqual(['ArrowLeft', 'KeyA']);
    expect(kb.moveRight).toEqual(['ArrowRight', 'KeyD']);
    expect(kb.hardDrop).toEqual(['ArrowDown', 'KeyS', 'Space']);
    expect(kb.spinLeft).toEqual(['KeyZ', 'KeyQ', 'ShiftLeft']);
    expect(kb.spinRight).toEqual(['KeyX', 'KeyE', 'ArrowUp', 'KeyW']);
    expect(kb.up).toEqual(['ArrowUp', 'KeyW']);
    expect(kb.down).toEqual(['ArrowDown', 'KeyS']);
    expect(kb.left).toEqual(['ArrowLeft', 'KeyA']);
    expect(kb.right).toEqual(['ArrowRight', 'KeyD']);
    expect(kb.confirm).toEqual(['Enter', 'Space', 'KeyZ']);
    expect(kb.cancel).toEqual(['Escape', 'Backspace', 'KeyX']);
    expect(kb.pause).toEqual(['Escape', 'KeyP']);

    const gp = createDefaultGamepadBindings();
    for (const verb of ACTION_VERBS) {
      expect(kb[verb].length).toBeGreaterThan(0);
      expect(gp[verb].length).toBeGreaterThan(0);
    }

    const defaults = createDefaultUserSettings();
    expect(defaults.paletteId).toBe('pico_dark');
    expect(defaults.packMode).toBe('builtin');
    expect(defaults.render).toEqual(createDefaultRenderSettings());
    expect(defaults.gameplay).toEqual(createDefaultGameplaySettings());
    expect(defaults.audio).toEqual(createDefaultAudioSettings());
  });

  it('contains ZERO leaked Mixolumia, Steam, Patreon, Discord, or GameMaker strings in user-facing copy', () => {
    const allStrings: string[] = [
      ...Object.values(EN_US_STRINGS),
      ...BUILTIN_PALETTES.flatMap((p) => [p.id, p.name, p.author ?? '']),
      ...TRACK_LIST.flatMap((tr) => [tr.id, tr.title, tr.subtitle, tr.artist, tr.description]),
      ...MODE_LIST.flatMap((m) => [m.name, m.description, m.badge, m.goalSummary, m.unlockDescription]),
      ...Object.values(TUTORIAL_PROMPTS).flatMap((p) => [p.title, p.hint]),
    ];

    for (const text of allStrings) {
      for (const pattern of FORBIDDEN_BRAND_PATTERNS) {
        expect(text, `Forbidden pattern ${pattern} matched "${text}"`).not.toMatch(pattern);
      }
    }
  });
});

describe('SaveManager Persistence, Unlocks, Custom Palettes & Corruption Recovery', () => {
  it('persists SaveData under krunked_lumia_save_v1 and reloads cleanly', () => {
    const storage = new MemoryStorage();
    const sm1 = new SaveManager(storage);

    expect(SAVE_STORAGE_KEY).toBe('krunked_lumia_save_v1');
    sm1.updateSettings({
      paletteId: 'pico_light',
      render: { targetFps: 120, bloomAmount: 0.75 },
      audio: { masterVolume: 0.5 },
    });
    sm1.setLastSelection('rush', 'hazard');
    sm1.markPhotosensitivitySeen();

    expect(storage.getItem(SAVE_STORAGE_KEY)).not.toBeNull();

    const sm2 = new SaveManager(storage);
    expect(sm2.wasRecoveredFromCorruption()).toBe(false);
    expect(sm2.getSettings().paletteId).toBe('pico_light');
    expect(sm2.getSettings().render.targetFps).toBe(120);
    expect(sm2.getSettings().render.bloomAmount).toBe(0.75);
    expect(sm2.getSettings().audio.masterVolume).toBe(0.5);
    expect(sm2.getSettings().photosensitivitySeen).toBe(true);
    expect(sm2.getData().lastMode).toBe('rush');
    expect(sm2.getData().lastTrack).toBe('hazard');
  });

  it('supports multi-profile CRUD and prevents deleting the last remaining profile', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage);

    const initial = sm.getActiveProfile();
    expect(sm.deleteProfile(initial.id)).toBe(false);

    const second = sm.createProfile('  Nova  ');
    expect(second.name).toBe('Nova');
    expect(sm.getActiveProfile().id).toBe(second.id);
    expect(sm.getProfiles()).toHaveLength(2);

    const renamed = sm.renameProfile(second.id, 'Nova Prime');
    expect(renamed?.name).toBe('Nova Prime');

    expect(sm.selectProfile(initial.id)?.id).toBe(initial.id);
    expect(sm.deleteProfile(second.id)).toBe(true);
    expect(sm.getProfiles()).toHaveLength(1);
    expect(sm.selectProfile('missing')).toBeNull();
  });

  it('records run stats, speedrun times, and flips impossibleUnlocked automatically at 4,000,000', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage);
    const second = sm.createProfile('Challenger');

    // Run 1: Marathon victory below 4M
    const outcome1 = sm.recordRunResult(
      makeMockSimState({
        mode: 'marathon',
        phase: 'VICTORY',
        score: 3_999_999,
        cleared: 450,
        elapsedTicks: 6000, // 100s
        maxCombo: 4,
        totalCombos: 12,
        perfectClears: 2,
      }),
    );
    expect(outcome1.isNewHighScore).toBe(true);
    expect(outcome1.fastestTimeBeaten).toBe(true);
    expect(outcome1.impossibleNewlyUnlocked).toBe(false);
    expect(sm.getActiveProfile().impossibleUnlocked).toBe(false);
    expect(sm.getActiveProfile().stats.marathonsCompleted).toBe(1);
    expect(sm.getActiveProfile().stats.fastestMarathonMs).toBe(100_000);

    // Run 2: Faster Marathon victory hitting 4,000,000 triggers Impossible unlock across profiles!
    const outcome2 = sm.recordRunResult(
      makeMockSimState({
        mode: 'marathon',
        phase: 'VICTORY',
        score: IMPOSSIBLE_UNLOCK_SCORE,
        cleared: 450,
        elapsedTicks: 5400, // 90s
      }),
    );
    expect(outcome2.isNewHighScore).toBe(true);
    expect(outcome2.fastestTimeBeaten).toBe(true);
    expect(outcome2.impossibleNewlyUnlocked).toBe(true);
    expect(sm.getActiveProfile().stats.fastestMarathonMs).toBe(90_000);
    expect(sm.getActiveProfile().impossibleUnlocked).toBe(true);
    expect(sm.getActiveProfile().unlockedModes).toContain('impossible');

    // Persisted & propagated to all profiles
    const reloaded = new SaveManager(storage);
    expect(reloaded.getProfiles().every((p) => p.impossibleUnlocked)).toBe(true);
    expect(reloaded.getActiveProfile().id).toBe(second.id);
    expect(reloaded.getActiveProfile().stats.gamesPlayed).toBe(2);
  });

  it('supports custom palette CRUD, protects built-ins, and resets active palette on delete', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage);

    // Rejects invalid colors
    expect(
      sm.saveCustomPalette({
        name: 'Broken',
        colors: ['#000000', 'not-hex', '#ffffff', '#111111', '#222222', '#333333'],
      }),
    ).toBeNull();

    // Creates normalized custom palette
    const saved = sm.saveCustomPalette({
      name: 'Synth Sunset',
      colors: ['#100818', '#221133', '#FFF5E1', '#FF5588', '#33DDFF', '#FFEE44'],
    });
    expect(saved).not.toBeNull();
    expect(saved!.isCustom).toBe(true);
    expect(saved!.colors[2]).toBe('#fff5e1');
    expect(sm.getAllPalettes()).toHaveLength(64);

    // Updates existing custom palette by ID
    const updated = sm.saveCustomPalette({
      id: saved!.id,
      name: 'Synth Sunset v2',
      colors: ['#100818', '#221133', '#ffffff', '#ff5588', '#33ddff', '#ffee44'],
    });
    expect(updated?.id).toBe(saved!.id);
    expect(updated?.name).toBe('Synth Sunset v2');
    expect(sm.getCustomPalettes()).toHaveLength(1);

    // Cannot delete built-in palette
    expect(sm.deleteCustomPalette('pico_dark')).toBe(false);

    // Selecting then deleting custom palette falls back to pico_dark
    sm.updateSettings({ paletteId: saved!.id });
    expect(sm.getSettings().paletteId).toBe(saved!.id);

    expect(sm.deleteCustomPalette(saved!.id)).toBe(true);
    expect(sm.getCustomPalettes()).toHaveLength(0);
    expect(sm.getSettings().paletteId).toBe('pico_dark');
  });

  it('recovers gracefully without throwing from broken JSON, wrong version, NaN stats, and invalid colors', () => {
    // 1. Corrupted JSON syntax
    const storage1 = new MemoryStorage();
    storage1.setItem(SAVE_STORAGE_KEY, '{broken json :::');
    const sm1 = new SaveManager(storage1);
    expect(sm1.wasRecoveredFromCorruption()).toBe(true);
    expect(sm1.getData().version).toBe(1);
    expect(sm1.getProfiles()).toHaveLength(1);
    expect(sm1.getSettings().paletteId).toBe('pico_dark');

    // 2. Wrong version
    const storage2 = new MemoryStorage();
    storage2.setItem(SAVE_STORAGE_KEY, JSON.stringify({ version: 99, profiles: [] }));
    const sm2 = new SaveManager(storage2);
    expect(sm2.wasRecoveredFromCorruption()).toBe(true);
    expect(sm2.getData().version).toBe(1);
    expect(sm2.getProfiles()).toHaveLength(1);

    // 3. Partial v1 JSON with NaN/negative stats, invalid palette colors, invalid settings & activeProfileId
    const brokenPartial = {
      version: 1,
      activeProfileId: 'missing_profile',
      profiles: [
        {
          id: 'p1',
          name: 'ValidPlayer',
          highScores: { marathon: 50_000, endless: -100, rush: 'oops' },
          stats: {
            gamesPlayed: Number.NaN,
            pointsScored: -500,
            blocksCleared: 120.8,
            fastestMarathonMs: -10,
            longestCombo: Infinity,
          },
          unlockedModes: ['marathon', 'invalid_mode'],
          unlockedTracks: ['tessellation', 'bogus_track'],
        },
        null,
      ],
      customPalettes: [
        {
          id: 'bad_pal',
          name: 'Bad',
          colors: ['#000000', 'INVALID', '#ffffff', '#ff0000', '#00ff00', '#0000ff'],
        },
        {
          id: 'good_pal',
          name: 'Good',
          colors: ['#000000', '#111111', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF'],
        },
      ],
      settings: {
        paletteId: 'deleted_palette',
        render: { targetFps: 999, bloomAmount: 500, tateRotate: 'yes' },
        gameplay: { moveSpeedIndex: 99, kbMoveDelay: -5, nextBlockLocation: 'center' },
        audio: { masterVolume: -1 },
        keyboard: { moveLeft: [] },
        packMode: 'invalid',
      },
      lastMode: 'bogus',
      lastTrack: 'bogus',
    };

    const { data, repaired } = sanitizeSaveData(brokenPartial);
    expect(repaired).toBe(true);
    expect(data.activeProfileId).toBe('p1');
    expect(data.profiles).toHaveLength(1);
    expect(data.profiles[0].name).toBe('ValidPlayer');
    expect(data.profiles[0].highScores.marathon).toBe(50_000);
    expect(data.profiles[0].highScores.endless).toBe(0);
    expect(data.profiles[0].stats.gamesPlayed).toBe(0);
    expect(data.profiles[0].stats.pointsScored).toBe(0);
    expect(data.profiles[0].stats.blocksCleared).toBe(120);
    expect(data.profiles[0].stats.fastestMarathonMs).toBeNull();
    expect(data.profiles[0].stats.longestCombo).toBe(0);
    expect(data.customPalettes).toHaveLength(1);
    expect(data.customPalettes[0].id).toBe('good_pal');
    expect(data.customPalettes[0].colors[2]).toBe('#ffffff');
    expect(data.settings.paletteId).toBe('pico_dark');
    expect(data.settings.render.targetFps).toBe(60);
    expect(data.settings.render.bloomAmount).toBe(1);
    expect(data.settings.render.tateRotate).toBe(false);
    expect(data.settings.gameplay.moveSpeedIndex).toBe(5);
    expect(data.settings.gameplay.kbMoveDelay).toBe(0);
    expect(data.settings.gameplay.nextBlockLocation).toBe('upper_left');
    expect(data.settings.audio.masterVolume).toBe(0);
    expect(data.settings.keyboard.moveLeft).toEqual(['ArrowLeft', 'KeyA']);
    expect(data.settings.packMode).toBe('builtin');
    expect(data.lastMode).toBe('marathon');
    expect(data.lastTrack).toBe('tessellation');

    // 4. Subtle single-field corruption (only NaN stat or out-of-range FPS) still flags repaired=true
    const storage3 = new MemoryStorage();
    const clean = new SaveManager(storage3);
    clean.save();
    const mutated = JSON.parse(storage3.getItem(SAVE_STORAGE_KEY)!) as Record<string, unknown>;
    (mutated.settings as Record<string, Record<string, unknown>>).render.targetFps = 240;
    storage3.setItem(SAVE_STORAGE_KEY, JSON.stringify(mutated));
    const recovered3 = new SaveManager(storage3);
    expect(recovered3.wasRecoveredFromCorruption()).toBe(true);
    expect(recovered3.getSettings().render.targetFps).toBe(60);
  });
});
