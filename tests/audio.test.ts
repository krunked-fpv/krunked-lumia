import { describe, expect, it } from 'vitest';
import {
  ALL_TRACK_IDS,
  type SimEvent,
  type SongSection,
  type TrackId,
} from '../src/contracts/index.js';
import {
  HarmonicAudioEngine,
  MENU_LOOP_GAIN,
  MENU_SFX_IDS,
  MenuAudioController,
  RUSH_BPM_SEQUENCE,
  RUSH_LOOP_CHAIN,
  SYNTH_PACKS,
  computeLoopDurationSec,
  computeProgressionSliceIndex,
  getSoundpackManifest,
  loadCustomAudioPackFromBuffers,
  loadCustomTrackFromBuffers,
  midiToFreq,
  parseLenientJson,
  parseTrackDataJson,
  resolveAudioBuffer,
  resolveChordForGroup,
  resolveLoopPattern,
  stripTrailingCommas,
} from '../src/audio/index.js';

describe('Synth Packs & Manifests', () => {
  const expectedBaseBpms: Record<TrackId, number> = {
    tessellation: 140,
    summer_shower: 90,
    dissolve: 124,
    quasar: 85,
    corefault: 114,
    minimum: 60,
    rush: 120,
    hazard: 180,
  };

  it('defines all 8 tracks with valid manifests, BPMs, loops, progressions, and chord voicings', () => {
    expect(Object.keys(SYNTH_PACKS).sort()).toEqual([...ALL_TRACK_IDS].sort());

    const requiredSections: SongSection[] = ['start', 'middle', 'outro', 'end'];

    for (const trackId of ALL_TRACK_IDS) {
      const pack = SYNTH_PACKS[trackId];
      const manifest = getSoundpackManifest(trackId);

      expect(pack).toBeDefined();
      expect(manifest).toBe(pack.manifest);
      expect(manifest.id).toBe(trackId);
      expect(manifest.baseBpm).toBe(expectedBaseBpms[trackId]);
      expect(manifest.title.length).toBeGreaterThan(0);
      expect(manifest.author.length).toBeGreaterThan(0);

      // IP hygiene: no leaked third-party/retail branding in built-in pack metadata
      expect(`${manifest.title} ${manifest.author}`.toLowerCase()).not.toContain('mixolumia');

      // Required section loops must exist
      for (const sec of requiredSections) {
        const loopDef = manifest.loops[sec];
        expect(loopDef, `${trackId} missing loop "${sec}"`).toBeDefined();
        expect(loopDef.bpm ?? manifest.baseBpm).toBeGreaterThan(0);
        expect(loopDef.length ?? 0).toBeGreaterThan(0);
        expect(loopDef.progression).toBeDefined();
        expect(manifest.progressions[loopDef.progression!]).toBeDefined();
      }

      // Every loop must reference valid progressions, next targets, and 16-step patterns
      for (const [loopName, loopDef] of Object.entries(manifest.loops)) {
        expect(loopDef.bpm ?? manifest.baseBpm).toBeGreaterThan(0);
        expect(loopDef.length ?? 0).toBeGreaterThan(0);
        if (loopDef.next) {
          expect(manifest.loops[loopDef.next], `${trackId}.${loopName} bad next`).toBeDefined();
        }
        if (loopDef.progression) {
          const prog = manifest.progressions[loopDef.progression];
          expect(prog.length).toBeGreaterThanOrEqual(4);
          for (const slice of prog) {
            expect(slice).toHaveLength(4);
            const [dropG, moveG, clearG, comboG] = slice;
            expect(manifest.drop_groups[dropG]).toBeDefined();
            expect(manifest.move_groups[moveG]?.length).toBeGreaterThan(0);
            expect(manifest.clear_groups[clearG]?.length).toBe(3);
            expect(manifest.combo_groups[comboG]?.length).toBe(3);

            const chord = resolveChordForGroup(pack, moveG);
            expect(chord.bassMidi).toBeGreaterThanOrEqual(24);
            expect(chord.padMidis.length).toBeGreaterThanOrEqual(3);
            expect(chord.arpMidis.length).toBeGreaterThanOrEqual(4);
            expect(chord.moveMidis.length).toBeGreaterThanOrEqual(4);
            expect(chord.clearTiers).toHaveLength(3);
            expect(chord.comboTiers).toHaveLength(3);
          }
        }

        const pattern = resolveLoopPattern(pack, loopName, 'start');
        expect(pattern.pad).toHaveLength(16);
        expect(pattern.bass).toHaveLength(16);
        expect(pattern.bassOffsets).toHaveLength(16);
        expect(pattern.arp).toHaveLength(16);
        expect(pattern.kick).toHaveLength(16);
        expect(pattern.snare).toHaveLength(16);
        expect(pattern.hat).toHaveLength(16);
        expect(pattern.perc).toHaveLength(16);
      }
    }
  });

  it('computes exact MIDI-to-Hz frequency conversion', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 5);
    expect(midiToFreq(60)).toBeCloseTo(261.625565, 4);
    expect(midiToFreq(81)).toBeCloseTo(880, 5);
  });
});

describe('Beat-to-Progression Slice Indexing & Rush Multi-Tempo Sequence', () => {
  it('computes exact slice indices with clean wraparound across loop boundaries', () => {
    const bpm = 140;
    const lengthBeats = 16;
    const loopLenSec = computeLoopDurationSec(bpm, lengthBeats);
    expect(loopLenSec).toBeCloseTo((60 / 140) * 16, 10);

    // 4-chord progression
    expect(computeProgressionSliceIndex(0, bpm, lengthBeats, 4)).toBe(0);
    expect(computeProgressionSliceIndex(loopLenSec * 0.249, bpm, lengthBeats, 4)).toBe(0);
    expect(computeProgressionSliceIndex(loopLenSec * 0.25, bpm, lengthBeats, 4)).toBe(1);
    expect(computeProgressionSliceIndex(loopLenSec * 0.5, bpm, lengthBeats, 4)).toBe(2);
    expect(computeProgressionSliceIndex(loopLenSec * 0.75, bpm, lengthBeats, 4)).toBe(3);
    expect(computeProgressionSliceIndex(loopLenSec * 0.999, bpm, lengthBeats, 4)).toBe(3);

    // Exact wraparound at 1x, 2x, and multi-loop offsets
    expect(computeProgressionSliceIndex(loopLenSec, bpm, lengthBeats, 4)).toBe(0);
    expect(computeProgressionSliceIndex(loopLenSec * 1.25, bpm, lengthBeats, 4)).toBe(1);
    expect(computeProgressionSliceIndex(loopLenSec * 2.5, bpm, lengthBeats, 4)).toBe(2);
    expect(computeProgressionSliceIndex(loopLenSec * 3.75, bpm, lengthBeats, 4)).toBe(3);

    // Negative safety wrap
    expect(computeProgressionSliceIndex(-loopLenSec * 0.1, bpm, lengthBeats, 4)).toBe(3);
  });

  it('follows the exact 13-stage multi-tempo Rush BPM arc in manifest and live engine', () => {
    const rushManifest = getSoundpackManifest('rush');
    const visitedLoops: string[] = [];
    const visitedBpms: number[] = [];

    let cursor = 'start';
    for (let i = 0; i < RUSH_BPM_SEQUENCE.length; i++) {
      const def = rushManifest.loops[cursor];
      expect(def).toBeDefined();
      visitedLoops.push(cursor);
      visitedBpms.push(def.bpm ?? rushManifest.baseBpm);
      cursor = def.next!;
    }

    expect(visitedLoops).toEqual([...RUSH_LOOP_CHAIN]);
    expect(visitedBpms).toEqual([...RUSH_BPM_SEQUENCE]);
    expect(cursor).toBe('end'); // terminal loop sustains on `end`

    // Now verify stepping HarmonicAudioEngine across all 13 Rush loops
    const engine = new HarmonicAudioEngine();
    engine.startTrack('rush');

    const engineBpms: number[] = [];
    for (let i = 0; i < RUSH_BPM_SEQUENCE.length; i++) {
      const telemetry = engine.getSoundtestTelemetry();
      engineBpms.push(telemetry.bpm);
      const loopDef = rushManifest.loops[telemetry.loopName];
      const dur = computeLoopDurationSec(telemetry.bpm, loopDef.length ?? 16);
      engine.update(dur + 0.001);
    }

    expect(engineBpms).toEqual([...RUSH_BPM_SEQUENCE]);
    expect(engine.getSoundtestTelemetry().loopName).toBe('end');
    engine.dispose();
  });
});

describe('Section Transition Queueing (start -> middle -> outro -> end)', () => {
  it('queues section transitions cleanly on exact loop boundaries without mid-bar cuts', () => {
    const engine = new HarmonicAudioEngine();
    engine.startTrack('tessellation');

    const manifest = getSoundpackManifest('tessellation');
    const loopLenSec = computeLoopDurationSec(140, manifest.loops.start.length ?? 16);

    // Advance partway into `start` (slice 1)
    engine.update(loopLenSec * 0.3);
    let tel = engine.getSoundtestTelemetry();
    expect(tel.loopName).toBe('start');
    expect(tel.section).toBe('start');
    expect(tel.progressionStep).toBe(1);
    expect(tel.nextLoopName).toBe('start');

    // Queue `middle` mid-loop — must stay on `start` until boundary!
    engine.advanceSection('middle');
    tel = engine.getSoundtestTelemetry();
    expect(tel.loopName).toBe('start');
    expect(tel.nextLoopName).toBe('middle');
    expect(engine.getQueuedSection()).toBe('middle');

    // Still inside `start` just before boundary
    engine.update(loopLenSec * 0.65);
    expect(engine.getSoundtestTelemetry().loopName).toBe('start');
    expect(engine.getSoundtestTelemetry().progressionStep).toBe(3);

    // Cross loop boundary -> transitions cleanly to `middle`!
    engine.update(loopLenSec * 0.1);
    tel = engine.getSoundtestTelemetry();
    expect(tel.loopName).toBe('middle');
    expect(tel.section).toBe('middle');
    expect(tel.nextLoopName).toBe('middle');
    expect(engine.getQueuedSection()).toBeNull();

    // Queue `outro` via SimEvent SONG_SECTION
    engine.processSimEvents([{ type: 'SONG_SECTION', section: 'outro' }]);
    expect(engine.getSoundtestTelemetry().loopName).toBe('middle');
    expect(engine.getSoundtestTelemetry().nextLoopName).toBe('outro');

    engine.update(loopLenSec);
    tel = engine.getSoundtestTelemetry();
    expect(tel.loopName).toBe('outro');
    expect(tel.section).toBe('outro');

    // Queue `end` via SONG_SECTION
    engine.processSimEvents([{ type: 'SONG_SECTION', section: 'end' }]);
    expect(engine.getSoundtestTelemetry().nextLoopName).toBe('end');

    engine.update(loopLenSec);
    tel = engine.getSoundtestTelemetry();
    expect(tel.loopName).toBe('end');
    expect(tel.section).toBe('end');
    expect(tel.nextLoopName).toBe('end');

    engine.dispose();
  });
});

describe('Lenient JSON Parser & Custom Audio Pack Loader', () => {
  it('strips trailing commas safely while preserving commas inside string literals', () => {
    const trickyJson = `\uFEFF{
      // retail comment
      "title": "Rush, [fast,] {wow,}",
      "bpm": 120,
      "items": [1, 2, 3,],
      "nested": {
        "a": [
          ["x", "y",],
        ],
      },
    }`;

    const cleaned = stripTrailingCommas(trickyJson);
    const parsed = parseLenientJson<{
      title: string;
      bpm: number;
      items: number[];
      nested: { a: string[][] };
    }>(trickyJson);

    expect(cleaned).not.toContain('retail comment');
    expect(parsed.title).toBe('Rush, [fast,] {wow,}');
    expect(parsed.bpm).toBe(120);
    expect(parsed.items).toEqual([1, 2, 3]);
    expect(parsed.nested.a).toEqual([['x', 'y']]);
  });

  it('parses retail rush/data.json syntax with trailing commas and numeric slice keys', () => {
    const retailRushJson = `{
      "title": "Rush Custom",
      "author": "Test Pack",
      "bpm": 120,
      "length": 16,
      "gain": {
        "master": 0.95,
        "loop": 0.7,
        "drop": 0.85,
        "move": 0.65,
        "clear": 0.9,
        "combo": 1.0,
      },
      "drop_groups": {
        "0": "drop_0.ogg",
      },
      "move_groups": {
        "0": ["move_0.ogg", "move_1.ogg",],
      },
      "clear_groups": {
        "0": ["clear_0.ogg", "clear_1.ogg", "clear_2.ogg",],
      },
      "combo_groups": {
        "0": ["combo_0.ogg", "combo_1.ogg", "combo_2.ogg",],
      },
      "progressions": {
        "main": [
          [0, 0, 0, 0,],
          ["0", "0", "0", "0",],
        ],
      },
      "loops": {
        "start": {
          "audio": "rush_120.ogg",
          "bpm": 120,
          "length": 16,
          "progression": "main",
          "next": "rush_127",
        },
        "rush_127": {
          "audio": "rush_127.ogg",
          "bpm": 127,
          "length": 16,
          "progression": "main",
          "next": "rush_123_7",
        },
        "rush_123_7": {
          "audio": "rush_123_7.ogg",
          "bpm": 123.7,
          "length": 16,
          "progression": "main",
          "next": "end",
        },
        "end": {
          "audio": "rush_end.ogg",
          "bpm": 120,
          "length": 16,
          "progression": "main",
          "next": "end",
        },
      },
    }`;

    const manifest = parseTrackDataJson(retailRushJson, 'rush');
    expect(manifest.id).toBe('rush');
    expect(manifest.title).toBe('Rush Custom');
    expect(manifest.baseBpm).toBe(120);
    expect(manifest.loops.start.bpm).toBe(120);
    expect(manifest.loops.rush_127.bpm).toBe(127);
    expect(manifest.loops.rush_123_7.bpm).toBe(123.7);
    expect(manifest.progressions.main).toEqual([
      ['0', '0', '0', '0'],
      ['0', '0', '0', '0'],
    ]);
    expect(manifest.drop_groups['0']).toBe('drop_0.ogg');
    expect(manifest.move_groups['0']).toEqual(['move_0.ogg', 'move_1.ogg']);
  });

  it('gracefully falls back per file when custom .ogg buffers are missing or fail decode', async () => {
    const encoder = new TextEncoder();
    const trackJson = `{
      "title": "Partial Custom Pack",
      "bpm": 140,
      "drop_groups": { "d": "drop.ogg", },
      "move_groups": { "m": ["move_ok.ogg", "move_corrupt.ogg",], },
      "clear_groups": { "cl": ["clear_missing.ogg",], },
      "combo_groups": { "co": ["combo_missing.ogg",], },
      "progressions": { "p": [["d", "m", "cl", "co",],], },
      "loops": {
        "start": { "audio": "start.ogg", "bpm": 140, "length": 16, "progression": "p", "next": "start", },
      },
    }`;

    const files = new Map<string, ArrayBuffer>([
      ['music/tessellation/data.json', encoder.encode(trackJson).buffer],
      ['music/tessellation/start.ogg', new Uint8Array([1, 2, 3, 4]).buffer],
      ['music/tessellation/move_ok.ogg', new Uint8Array([5, 6, 7, 8]).buffer],
      ['music/tessellation/move_corrupt.ogg', new Uint8Array([99, 99]).buffer],
      ['audio/menu_move.ogg', new Uint8Array([1, 2, 3, 4]).buffer],
    ]);

    // Mock BaseAudioContext where 2-byte buffer rejects decode, 4-byte succeeds
    const fakeBuffer = { duration: 1.5 } as unknown as AudioBuffer;
    const mockCtx = {
      decodeAudioData: async (buf: ArrayBuffer): Promise<AudioBuffer> => {
        if (buf.byteLength === 2) {
          throw new Error('Corrupt ogg stream');
        }
        return fakeBuffer;
      },
    } as unknown as BaseAudioContext;

    const loadedTrack = await loadCustomTrackFromBuffers(mockCtx, 'tessellation', files);
    expect(loadedTrack).not.toBeNull();
    expect(resolveAudioBuffer(loadedTrack!.buffers, 'start.ogg')).toBe(fakeBuffer);
    expect(resolveAudioBuffer(loadedTrack!.buffers, 'move_ok')).toBe(fakeBuffer);
    expect(resolveAudioBuffer(loadedTrack!.buffers, 'move_corrupt.ogg')).toBeNull();
    expect(resolveAudioBuffer(loadedTrack!.buffers, 'clear_missing.ogg')).toBeNull();
    expect(loadedTrack!.missingFiles).toContain('move_corrupt.ogg');
    expect(loadedTrack!.missingFiles).toContain('clear_missing.ogg');
    expect(loadedTrack!.missingFiles).toContain('drop.ogg');

    const pack = await loadCustomAudioPackFromBuffers(mockCtx, files);
    expect(pack.source).toBe('memory');
    expect(pack.tracks.tessellation).toBeDefined();
    expect(resolveAudioBuffer(pack.menuBuffers, 'menu_move')).toBe(fakeBuffer);
    expect(pack.missingMenuFiles).toContain('menu_back.ogg');

    // Headless null context also succeeds cleanly without throwing
    const headlessPack = await loadCustomAudioPackFromBuffers(null, files);
    expect(headlessPack.tracks.tessellation?.manifest.title).toBe('Partial Custom Pack');
    expect(headlessPack.tracks.tessellation?.buffers.size).toBe(0);
  });
});

describe('Menu Audio & Headless HarmonicAudioEngine Operation', () => {
  it('cycles menu_select_0..4 and operates safely without AudioContext', () => {
    const menu = new MenuAudioController({
      getContext: () => null,
      getDestination: () => null,
    });

    expect(MENU_LOOP_GAIN).toBe(0.5);
    expect(MENU_SFX_IDS).toContain('menu_move');
    expect(MENU_SFX_IDS).toContain('fail_sfx');
    expect(MENU_SFX_IDS).toContain('tutorial_sfx_start');
    expect(MENU_SFX_IDS).toContain('tutorial_sfx_trigger');
    expect(MENU_SFX_IDS).toContain('tutorial_sfx_off');

    const cycle = [
      menu.playSelect(),
      menu.playSelect(),
      menu.playSelect(),
      menu.playSelect(),
      menu.playSelect(),
      menu.playSelect(),
    ];
    expect(cycle).toEqual([
      'menu_select_0',
      'menu_select_1',
      'menu_select_2',
      'menu_select_3',
      'menu_select_4',
      'menu_select_0',
    ]);

    menu.playMove();
    menu.playBack();
    menu.playFail();
    menu.playTutorialStart();
    menu.playTutorialTrigger();
    menu.playTutorialOff();

    menu.startMenuLoop();
    expect(menu.isMenuLoopPlaying()).toBe(true);
    menu.update(1.5);
    expect(menu.getLoopElapsed()).toBeGreaterThan(0);
    menu.stopMenuLoop();
    expect(menu.isMenuLoopPlaying()).toBe(false);
    menu.dispose();
  });

  it('runs HarmonicAudioEngine safely in headless Node across all tracks and SimEvents', async () => {
    const engine = new HarmonicAudioEngine(0.8, false);
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.getAudioContext()).toBeNull();

    engine.setMasterVolume(1.5);
    expect(engine.getMasterVolume()).toBe(1);
    engine.setMasterVolume(-0.5);
    expect(engine.getMasterVolume()).toBe(0);
    engine.setMasterVolume(0.75);
    expect(engine.getMasterVolume()).toBe(0.75);

    engine.setMuted(true);
    expect(engine.isMuted()).toBe(true);
    engine.setMuted(false);
    expect(engine.isMuted()).toBe(false);

    engine.startMenuMusic();
    expect(engine.menu.isMenuLoopPlaying()).toBe(true);
    engine.update(0.5);
    engine.stopMenuMusic();
    expect(engine.menu.isMenuLoopPlaying()).toBe(false);

    const allSimEvents: SimEvent[] = [
      { type: 'TETRAD_SPAWN', x: 3, y: 0, colors: [1, 2, 3, 4] },
      { type: 'TETRAD_MOVE', dx: 1, x: 4, y: 1, blocked: false },
      { type: 'TETRAD_MOVE', dx: 1, x: 4, y: 1, blocked: true },
      { type: 'TETRAD_SPIN', dir: 1, x: 4, y: 1, slackReset: false },
      { type: 'TETRAD_HARD_DROP', fromY: 1, toY: 22, x: 4, colors: [1, 2, 3, 4] },
      { type: 'TETRAD_LOCK', cells: [{ x: 4, y: 22, color: 1 }] },
      { type: 'BLOCK_SLIDE', moves: [{ fromX: 4, fromY: 22, toX: 4, toY: 24, color: 1 }] },
      {
        type: 'BLOCKS_CLEAR',
        cells: [{ x: 3, y: 24, color: 1 }],
        count: 4,
        combo: 1,
        waveScore: 1600,
        totalScore: 1600,
        level: 0,
        clearTier: 0,
      },
      {
        type: 'BLOCKS_CLEAR',
        cells: [{ x: 3, y: 24, color: 2 }],
        count: 8,
        combo: 2,
        waveScore: 12800,
        totalScore: 14400,
        level: 0,
        clearTier: 2,
      },
      { type: 'COMBO_CHAIN', combo: 2, comboTier: 0, x: 3, y: 24 },
      { type: 'COMBO_CHAIN', combo: 4, comboTier: 2, x: 3, y: 24 },
      { type: 'PERFECT_CLEAR', bonus: 40000, combo: 4, level: 1 },
      { type: 'LEVEL_UP', level: 1 },
      { type: 'TUTORIAL_ADVANCE', step: 'SPIN', completed: false },
      { type: 'TUTORIAL_ADVANCE', step: 'DONE', completed: true },
      { type: 'RELAXED_RESET' },
      { type: 'SONG_SECTION', section: 'middle' },
      { type: 'GAME_VICTORY', mode: 'marathon', score: 500000, cleared: 450, elapsedTicks: 3600 },
      { type: 'GAME_OVER', mode: 'endless', score: 120000, cleared: 100, elapsedTicks: 1800 },
    ];

    for (const trackId of ALL_TRACK_IDS) {
      engine.startTrack(trackId);
      expect(engine.isPlaying()).toBe(true);
      engine.update(0.75);
      engine.processSimEvents(allSimEvents);

      const telemetry = engine.getSoundtestTelemetry();
      expect(telemetry.trackId).toBe(trackId);
      expect(telemetry.packMode).toBe('builtin');
      expect(telemetry.bpm).toBeGreaterThan(0);
      expect(telemetry.loopProgress).toBeGreaterThanOrEqual(0);
      expect(telemetry.loopProgress).toBeLessThan(1);
      expect(telemetry.progressionLength).toBeGreaterThan(0);
      expect(telemetry.activeGroups).toHaveLength(4);
    }

    // Switching pack modes safely without custom pack loaded falls back cleanly
    engine.setPackMode('custom', null);
    expect(engine.getPackMode()).toBe('custom');
    engine.startTrack('tessellation');
    engine.update(1.0);
    engine.processSimEvents([{ type: 'TETRAD_MOVE', dx: -1, x: 2, y: 1, blocked: false }]);
    expect(engine.getSoundtestTelemetry().packMode).toBe('custom');

    engine.setPackMode('builtin');
    expect(engine.getPackMode()).toBe('builtin');

    engine.stop();
    expect(engine.isPlaying()).toBe(false);
    engine.dispose();
  });

  it('synthesizes procedural audio nodes and plays custom .ogg buffers with a mock AudioContext', async () => {
    let createdOscillators = 0;
    let createdBufferSources = 0;
    const makeParam = () => ({
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
      setTargetAtTime: () => {},
      cancelScheduledValues: () => {},
    });

    class MockAudioContext {
      public currentTime = 0;
      public sampleRate = 44100;
      public state: AudioContextState = 'running';
      public destination = {};
      public resume = async () => {
        this.state = 'running';
      };
      public close = async () => {
        this.state = 'closed';
      };
      public createGain = () => ({ gain: makeParam(), connect: () => {}, disconnect: () => {}, context: this });
      public createDynamicsCompressor = () => ({
        threshold: makeParam(),
        knee: makeParam(),
        ratio: makeParam(),
        attack: makeParam(),
        release: makeParam(),
        connect: () => {},
        disconnect: () => {},
      });
      public createBiquadFilter = () => ({
        type: 'lowpass',
        frequency: makeParam(),
        Q: makeParam(),
        connect: () => {},
        disconnect: () => {},
      });
      public createOscillator = () => {
        createdOscillators += 1;
        return {
          type: 'sine',
          frequency: makeParam(),
          detune: makeParam(),
          connect: () => {},
          start: () => {},
          stop: () => {},
        };
      };
      public createBufferSource = () => {
        createdBufferSources += 1;
        return {
          buffer: null,
          loop: false,
          connect: () => {},
          disconnect: () => {},
          start: () => {},
          stop: () => {},
        };
      };
      public createBuffer = (_ch: number, len: number, sr: number) => ({
        duration: len / sr,
        getChannelData: () => new Float32Array(len),
      });
    }

    const g = globalThis as unknown as { AudioContext?: unknown };
    const prevAudioCtx = g.AudioContext;
    g.AudioContext = MockAudioContext;

    try {
      const engine = new HarmonicAudioEngine(0.8, false);
      await engine.unlock();
      expect(engine.getAudioContext()).not.toBeNull();

      engine.startTrack('tessellation');
      engine.triggerMove(0.8);
      engine.triggerDrop(1.0);
      engine.triggerClear(2, 1.0);
      engine.triggerCombo(2, 4, 1.0);
      engine.triggerPerfectClear();
      expect(createdOscillators).toBeGreaterThan(10);

      // Verify custom pack mode uses AudioBufferSourceNode when buffer exists and falls back silently when missing
      const fakeBuf = { duration: 4.0 } as unknown as AudioBuffer;
      const customPack = {
        source: 'memory' as const,
        tracks: {
          tessellation: {
            trackId: 'tessellation' as const,
            manifest: {
              ...getSoundpackManifest('tessellation'),
              drop_groups: { drop_cmaj9: 'drop.ogg' },
              loops: {
                ...getSoundpackManifest('tessellation').loops,
                start: {
                  ...getSoundpackManifest('tessellation').loops.start,
                  audio: 'start.ogg',
                },
              },
            },
            buffers: new Map<string, AudioBuffer>([
              ['start.ogg', fakeBuf],
              ['drop.ogg', fakeBuf],
            ]),
            missingFiles: ['move_missing.ogg'],
          },
        },
        menuBuffers: new Map<string, AudioBuffer>(),
        missingMenuFiles: [],
      };

      const beforeBufs = createdBufferSources;
      engine.setPackMode('custom', customPack);
      engine.triggerDrop(1.0); // uses custom drop.ogg buffer
      engine.triggerMove(0.8); // falls back silently to procedural synth!
      expect(createdBufferSources).toBeGreaterThan(beforeBufs);

      engine.startMenuMusic();
      engine.menu.playSelect();
      engine.stopMenuMusic();
      engine.dispose();
    } finally {
      if (prevAudioCtx === undefined) {
        delete g.AudioContext;
      } else {
        g.AudioContext = prevAudioCtx;
      }
    }
  });
});
