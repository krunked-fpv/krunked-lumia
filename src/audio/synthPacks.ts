/**
 * Krunked Lumia — Procedural Harmonic Synth Packs (100% Original Web Audio Synthesis)
 *
 * Defines all 8 beat-locked harmonic tracks (`tessellation`, `summer_shower`, `dissolve`,
 * `quasar`, `corefault`, `minimum`, `rush`, `hazard`) with authentic multi-chord
 * progressions, MIDI voicings, per-section step-sequencer patterns, and tailored DSP timbres.
 * Zero copyrighted samples or third-party assets.
 */

import type {
  ProgressionSlice,
  SongSection,
  SoundpackGainConfig,
  SoundpackLoopDef,
  SoundpackManifest,
  TrackId,
} from '../contracts/index.js';

export type SynthWaveType = OscillatorType;

export interface ChordVoicing {
  id: string;
  symbol: string;
  bassMidi: number;
  padMidis: readonly number[];
  arpMidis: readonly number[];
  moveMidis: readonly number[];
  clearTiers: readonly [readonly number[], readonly number[], readonly number[]];
  comboTiers: readonly [readonly number[], readonly number[], readonly number[]];
}

export interface TrackTimbreSpec {
  bass: {
    wave: SynthWaveType;
    subMix: number;
    cutoffHz: number;
    q: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    gain: number;
  };
  pad: {
    wave: SynthWaveType;
    detuneCents: number;
    cutoffHz: number;
    attack: number;
    release: number;
    gain: number;
  };
  arp: {
    wave: SynthWaveType;
    cutoffHz: number;
    attack: number;
    decay: number;
    release: number;
    gain: number;
  };
  drums: {
    kickFreqStart: number;
    kickFreqEnd: number;
    kickDecay: number;
    kickGain: number;
    snareToneHz: number;
    snareBandHz: number;
    snareDecay: number;
    snareGain: number;
    hatHighpassHz: number;
    hatDecay: number;
    hatGain: number;
    percFreqHz: number;
    percDecay: number;
    percGain: number;
  };
  sfx: {
    dropWave: SynthWaveType;
    dropPunchHz: number;
    moveWave: SynthWaveType;
    moveFilterHz: number;
    moveDecay: number;
    clearWave: SynthWaveType;
    clearShimmerDetune: number;
    comboWave: SynthWaveType;
  };
}

export interface LoopPatternSpec {
  /** 16-step (one 4/4 bar) rhythmic accents in [0..1]. */
  pad: readonly number[];
  bass: readonly number[];
  /** Semitone offsets relative to chord bassMidi per step (length 16). */
  bassOffsets: readonly number[];
  arp: readonly number[];
  kick: readonly number[];
  snare: readonly number[];
  hat: readonly number[];
  perc: readonly number[];
  /** Optional 16th-note swing factor [0..0.18]. */
  swing: number;
  /** Energy multiplier shaping filter brightness & dynamics [0.2..1.0]. */
  energy: number;
}

export interface SynthPackSpec {
  id: TrackId;
  keySignature: string;
  rootMidi: number;
  manifest: SoundpackManifest;
  chords: Record<string, ChordVoicing>;
  /** Maps any group name (`drop_*`, `move_*`, `clear_*`, `combo_*`) back to its chord ID. */
  groupToChord: Record<string, string>;
  timbre: TrackTimbreSpec;
  loopPatterns: Record<string, LoopPatternSpec>;
}

/** Exact 13-stage multi-tempo BPM arc for the 2-minute Rush track. */
export const RUSH_BPM_SEQUENCE: readonly number[] = [
  120, 127, 132, 137, 140, 143, 107, 110, 113, 116, 123, 123.7, 120,
] as const;

export const RUSH_LOOP_CHAIN: readonly string[] = [
  'start',
  'rush_2',
  'rush_3',
  'rush_4',
  'rush_5',
  'rush_6',
  'middle',
  'rush_8',
  'rush_9',
  'rush_10',
  'outro',
  'rush_12',
  'end',
] as const;

/** Convert MIDI note number (69 = A4) to frequency in Hz. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Compute loop length in seconds from BPM and beat length. */
export function computeLoopDurationSec(bpm: number, lengthBeats: number): number {
  if (bpm <= 0 || lengthBeats <= 0) return 0;
  return (60 / bpm) * lengthBeats;
}

/**
 * Exact Mixolumia beat-to-progression slice index math:
 * `sliceIdx = Math.floor(((loopElapsed % loopLenSec) / loopLenSec) * progression.length) % progression.length`
 */
export function computeProgressionSliceIndex(
  loopElapsedSec: number,
  bpm: number,
  lengthBeats: number,
  progressionLength: number,
): number {
  if (progressionLength <= 0) return 0;
  const loopLenSec = computeLoopDurationSec(bpm, lengthBeats);
  if (loopLenSec <= 0) return 0;
  let wrapped = loopElapsedSec % loopLenSec;
  if (wrapped < 0) wrapped += loopLenSec;
  const pos = (wrapped / loopLenSec) * progressionLength;
  return Math.floor(pos + 1e-12) % progressionLength;
}

/** Helper constructing a rich, harmonically locked ChordVoicing from bass + upper notes. */
function makeChord(
  id: string,
  symbol: string,
  bassMidi: number,
  padMidis: readonly number[],
  arpMidis: readonly number[],
  moveMidis?: readonly number[],
): ChordVoicing {
  const moves = moveMidis ?? arpMidis.slice(0, 5);
  const rootHigh = padMidis[0] ?? bassMidi + 12;
  const third = padMidis[1] ?? rootHigh + 4;
  const fifth = padMidis[2] ?? rootHigh + 7;
  const seventh = padMidis[3] ?? rootHigh + 11;
  const ninth = padMidis[4] ?? rootHigh + 14;

  const clearTier0 = [rootHigh, third, fifth];
  const clearTier1 = [rootHigh, third, fifth, seventh];
  const clearTier2 = [bassMidi + 12, third, fifth, seventh, ninth, rootHigh + 12];

  const comboTier0 = [fifth + 12, seventh + 12];
  const comboTier1 = [third + 12, fifth + 12, ninth + 12];
  const comboTier2 = [rootHigh + 12, fifth + 12, seventh + 12, ninth + 12, rootHigh + 24];

  return {
    id,
    symbol,
    bassMidi,
    padMidis,
    arpMidis,
    moveMidis: moves,
    clearTiers: [clearTier0, clearTier1, clearTier2],
    comboTiers: [comboTier0, comboTier1, comboTier2],
  };
}

interface PackBuildInput {
  id: TrackId;
  title: string;
  author: string;
  mode: 'standard' | 'rush' | 'both';
  baseBpm: number;
  keySignature: string;
  rootMidi: number;
  gain?: Partial<SoundpackGainConfig>;
  chords: readonly ChordVoicing[];
  progressionsByChordIds: Record<string, readonly string[]>;
  loops: Record<string, SoundpackLoopDef>;
  timbre: TrackTimbreSpec;
  loopPatterns: Record<string, LoopPatternSpec>;
}

function buildSynthPack(input: PackBuildInput): SynthPackSpec {
  const chords: Record<string, ChordVoicing> = {};
  const drop_groups: Record<string, string | string[]> = {};
  const move_groups: Record<string, string[]> = {};
  const clear_groups: Record<string, string[]> = {};
  const combo_groups: Record<string, string[]> = {};
  const groupToChord: Record<string, string> = {};

  for (const chord of input.chords) {
    chords[chord.id] = chord;
    const dKey = `drop_${chord.id}`;
    const mKey = `move_${chord.id}`;
    const clKey = `clear_${chord.id}`;
    const coKey = `combo_${chord.id}`;

    drop_groups[dKey] = `synth:${input.id}:${dKey}`;
    move_groups[mKey] = chord.moveMidis.map((_, idx) => `synth:${input.id}:${mKey}:${idx}`);
    clear_groups[clKey] = [0, 1, 2].map((tier) => `synth:${input.id}:${clKey}:${tier}`);
    combo_groups[coKey] = [0, 1, 2].map((tier) => `synth:${input.id}:${coKey}:${tier}`);

    groupToChord[dKey] = chord.id;
    groupToChord[mKey] = chord.id;
    groupToChord[clKey] = chord.id;
    groupToChord[coKey] = chord.id;
  }

  const progressions: Record<string, ProgressionSlice[]> = {};
  for (const [progName, chordIds] of Object.entries(input.progressionsByChordIds)) {
    progressions[progName] = chordIds.map(
      (cid): ProgressionSlice => [`drop_${cid}`, `move_${cid}`, `clear_${cid}`, `combo_${cid}`],
    );
  }

  const gain: SoundpackGainConfig = {
    master: input.gain?.master ?? 0.9,
    drop: input.gain?.drop ?? 0.85,
    move: input.gain?.move ?? 0.62,
    clear: input.gain?.clear ?? 0.88,
    combo: input.gain?.combo ?? 0.92,
    loop: input.gain?.loop ?? 0.68,
  };

  const manifest: SoundpackManifest = {
    id: input.id,
    title: input.title,
    author: input.author,
    mode: input.mode,
    baseBpm: input.baseBpm,
    gain,
    drop_groups,
    move_groups,
    clear_groups,
    combo_groups,
    progressions,
    loops: input.loops,
  };

  return {
    id: input.id,
    keySignature: input.keySignature,
    rootMidi: input.rootMidi,
    manifest,
    chords,
    groupToChord,
    timbre: input.timbre,
    loopPatterns: input.loopPatterns,
  };
}

const ZERO_16: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// ============================================================================
// 1. TESSELLATION (140 BPM — Flagship Crisp Geometric Synth-Pop)
// ============================================================================
const TESSELLATION_PACK = buildSynthPack({
  id: 'tessellation',
  title: 'Tessellation',
  author: 'Krunked Synth Collective',
  mode: 'standard',
  baseBpm: 140,
  keySignature: 'C major',
  rootMidi: 60,
  gain: { master: 0.92, loop: 0.66, move: 0.62, drop: 0.85, clear: 0.88, combo: 0.92 },
  chords: [
    makeChord('cmaj9', 'Cmaj9', 36, [48, 52, 55, 59, 62], [60, 64, 67, 71, 74, 76]),
    makeChord('fmaj7', 'Fmaj7', 41, [53, 57, 60, 64, 67], [65, 69, 72, 76, 79, 81]),
    makeChord('am7', 'Am7', 45, [57, 60, 64, 67, 71], [69, 72, 76, 79, 81, 84]),
    makeChord('g6', 'G6', 43, [55, 59, 62, 64, 67], [67, 71, 74, 76, 79, 83]),
    makeChord('em7', 'Em7', 40, [52, 55, 59, 62, 67], [64, 67, 71, 74, 76, 79]),
    makeChord('gsus4', 'Gsus4', 43, [55, 60, 62, 67, 69], [67, 72, 74, 79, 81, 86]),
  ],
  progressionsByChordIds: {
    start_prog: ['cmaj9', 'fmaj7', 'am7', 'g6'],
    mid_prog: ['cmaj9', 'em7', 'fmaj7', 'g6'],
    outro_prog: ['am7', 'fmaj7', 'cmaj9', 'gsus4'],
    end_prog: ['fmaj7', 'g6', 'cmaj9', 'cmaj9'],
  },
  loops: {
    start: { audio: 'synth:tessellation:start', bpm: 140, length: 16, progression: 'start_prog', next: 'start' },
    middle: { audio: 'synth:tessellation:middle', bpm: 140, length: 16, progression: 'mid_prog', next: 'middle' },
    outro: { audio: 'synth:tessellation:outro', bpm: 140, length: 16, progression: 'outro_prog', next: 'outro' },
    end: { audio: 'synth:tessellation:end', bpm: 140, length: 16, progression: 'end_prog', next: 'end' },
  },
  timbre: {
    bass: { wave: 'sawtooth', subMix: 0.45, cutoffHz: 680, q: 1.4, attack: 0.005, decay: 0.14, sustain: 0.25, release: 0.08, gain: 0.28 },
    pad: { wave: 'triangle', detuneCents: 9, cutoffHz: 2200, attack: 0.04, release: 0.45, gain: 0.14 },
    arp: { wave: 'triangle', cutoffHz: 4200, attack: 0.004, decay: 0.12, release: 0.08, gain: 0.16 },
    drums: {
      kickFreqStart: 155, kickFreqEnd: 44, kickDecay: 0.13, kickGain: 0.44,
      snareToneHz: 210, snareBandHz: 2400, snareDecay: 0.11, snareGain: 0.22,
      hatHighpassHz: 7800, hatDecay: 0.032, hatGain: 0.13,
      percFreqHz: 1180, percDecay: 0.045, percGain: 0.1,
    },
    sfx: {
      dropWave: 'triangle', dropPunchHz: 130,
      moveWave: 'triangle', moveFilterHz: 3800, moveDecay: 0.09,
      clearWave: 'triangle', clearShimmerDetune: 10, comboWave: 'sine',
    },
  },
  loopPatterns: {
    start: {
      pad: [0.8, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.85, 0, 0, 0.5, 0, 0, 0.7, 0, 0.85, 0, 0, 0.5, 0, 0, 0.65, 0],
      bassOffsets: [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 0, 12, 0, 0, 7, 0],
      arp: [0.75, 0, 0.6, 0, 0.7, 0, 0.55, 0, 0.75, 0, 0.6, 0, 0.7, 0, 0.65, 0],
      kick: [0.8, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0],
      snare: ZERO_16,
      hat: [0, 0, 0.45, 0, 0, 0, 0.45, 0, 0, 0, 0.45, 0, 0, 0, 0.5, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0.4],
      swing: 0,
      energy: 0.58,
    },
    middle: {
      pad: [0.85, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.95, 0, 0.6, 0, 0.85, 0, 0.75, 0, 0.95, 0, 0.6, 0, 0.85, 0, 0.7, 0.5],
      bassOffsets: [0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 12, 0, 7, 0, 12, 7],
      arp: [0.85, 0.45, 0.7, 0.45, 0.8, 0.5, 0.7, 0.5, 0.85, 0.45, 0.75, 0.5, 0.8, 0.55, 0.75, 0.6],
      kick: [1.0, 0, 0, 0, 0.95, 0, 0, 0, 1.0, 0, 0, 0, 0.95, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0.35],
      hat: [0.3, 0.25, 0.75, 0.3, 0.3, 0.25, 0.75, 0.35, 0.3, 0.25, 0.75, 0.3, 0.3, 0.3, 0.8, 0.4],
      perc: [0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0.5, 0],
      swing: 0,
      energy: 0.86,
    },
    outro: {
      pad: [1.0, 0, 0, 0, 0, 0, 0.65, 0, 0.9, 0, 0, 0, 0, 0, 0.6, 0],
      bass: [1.0, 0.4, 0.7, 0.4, 0.95, 0.4, 0.8, 0.5, 1.0, 0.4, 0.75, 0.45, 0.95, 0.5, 0.85, 0.65],
      bassOffsets: [0, 0, 12, 0, 0, 7, 12, 7, 0, 0, 12, 0, 7, 12, 7, 12],
      arp: [0.95, 0.6, 0.8, 0.65, 0.9, 0.6, 0.85, 0.7, 0.95, 0.65, 0.85, 0.65, 0.9, 0.7, 0.9, 0.8],
      kick: [1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0.5, 0],
      snare: [0, 0, 0, 0, 0.95, 0, 0, 0.3, 0, 0, 0, 0, 1.0, 0, 0.3, 0.45],
      hat: [0.45, 0.35, 0.85, 0.4, 0.45, 0.35, 0.85, 0.45, 0.45, 0.35, 0.85, 0.4, 0.5, 0.4, 0.9, 0.55],
      perc: [0, 0, 0, 0.55, 0, 0, 0.45, 0, 0, 0, 0, 0.55, 0, 0.45, 0, 0.6],
      swing: 0,
      energy: 1.0,
    },
    end: {
      pad: [0.75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.6, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: ZERO_16,
      arp: [0.6, 0, 0, 0, 0.45, 0, 0, 0, 0.5, 0, 0, 0, 0.4, 0, 0, 0],
      kick: ZERO_16,
      snare: ZERO_16,
      hat: ZERO_16,
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0],
      swing: 0,
      energy: 0.35,
    },
  },
});

// ============================================================================
// 2. SUMMER SHOWER (90 BPM — Warm Lo-Fi Rhodes / Bell Chords & Rain-Drop Plucks)
// ============================================================================
const SUMMER_SHOWER_PACK = buildSynthPack({
  id: 'summer_shower',
  title: 'Summer Shower',
  author: 'Nora Lindqvist',
  mode: 'standard',
  baseBpm: 90,
  keySignature: 'F major',
  rootMidi: 65,
  gain: { master: 0.9, loop: 0.68, move: 0.6, drop: 0.82, clear: 0.86, combo: 0.9 },
  chords: [
    makeChord('fmaj9', 'Fmaj9', 41, [53, 57, 60, 64, 67], [65, 69, 72, 76, 79, 84]),
    makeChord('dm9', 'Dm9', 38, [50, 53, 57, 60, 64], [62, 65, 69, 72, 76, 81]),
    makeChord('bbmaj7', 'Bbmaj7', 46, [53, 58, 62, 65, 69], [65, 70, 74, 77, 81, 86]),
    makeChord('c9sus4', 'C9sus4', 36, [48, 53, 55, 58, 62], [60, 65, 67, 70, 74, 79]),
    makeChord('gm9', 'Gm9', 43, [55, 58, 62, 65, 69], [67, 70, 74, 77, 81, 86]),
    makeChord('am7', 'Am7', 45, [57, 60, 64, 67, 71], [69, 72, 76, 79, 83, 88]),
  ],
  progressionsByChordIds: {
    start_prog: ['fmaj9', 'dm9', 'bbmaj7', 'c9sus4'],
    mid_prog: ['gm9', 'c9sus4', 'fmaj9', 'dm9'],
    outro_prog: ['bbmaj7', 'am7', 'gm9', 'c9sus4'],
    end_prog: ['bbmaj7', 'c9sus4', 'fmaj9', 'fmaj9'],
  },
  loops: {
    start: { audio: 'synth:summer_shower:start', bpm: 90, length: 16, progression: 'start_prog', next: 'start' },
    middle: { audio: 'synth:summer_shower:middle', bpm: 90, length: 16, progression: 'mid_prog', next: 'middle' },
    outro: { audio: 'synth:summer_shower:outro', bpm: 90, length: 16, progression: 'outro_prog', next: 'outro' },
    end: { audio: 'synth:summer_shower:end', bpm: 90, length: 16, progression: 'end_prog', next: 'end' },
  },
  timbre: {
    bass: { wave: 'sine', subMix: 0.25, cutoffHz: 420, q: 0.9, attack: 0.012, decay: 0.28, sustain: 0.45, release: 0.16, gain: 0.34 },
    pad: { wave: 'sine', detuneCents: 6, cutoffHz: 1450, attack: 0.03, release: 0.65, gain: 0.19 },
    arp: { wave: 'sine', cutoffHz: 3200, attack: 0.003, decay: 0.16, release: 0.18, gain: 0.15 },
    drums: {
      kickFreqStart: 120, kickFreqEnd: 46, kickDecay: 0.16, kickGain: 0.38,
      snareToneHz: 185, snareBandHz: 1700, snareDecay: 0.13, snareGain: 0.18,
      hatHighpassHz: 6200, hatDecay: 0.04, hatGain: 0.1,
      percFreqHz: 1640, percDecay: 0.07, percGain: 0.11,
    },
    sfx: {
      dropWave: 'sine', dropPunchHz: 105,
      moveWave: 'sine', moveFilterHz: 2900, moveDecay: 0.12,
      clearWave: 'sine', clearShimmerDetune: 7, comboWave: 'sine',
    },
  },
  loopPatterns: {
    start: {
      pad: [0.85, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
      bass: [0.8, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0.7, 0, 0, 0, 0, 0],
      bassOffsets: [0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0],
      arp: [0, 0, 0.55, 0, 0, 0.45, 0, 0, 0.6, 0, 0, 0.5, 0, 0, 0.55, 0],
      kick: [0.75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0],
      hat: [0.35, 0, 0.45, 0, 0.35, 0, 0.5, 0, 0.35, 0, 0.45, 0, 0.35, 0, 0.5, 0.25],
      perc: [0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0.45, 0],
      swing: 0.11,
      energy: 0.52,
    },
    middle: {
      pad: [0.9, 0, 0, 0, 0, 0, 0.65, 0, 0, 0, 0.7, 0, 0, 0, 0.45, 0],
      bass: [0.9, 0, 0, 0.55, 0, 0, 0, 0.65, 0, 0, 0.85, 0, 0, 0, 0.6, 0],
      bassOffsets: [0, 0, 0, 5, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 12, 0],
      arp: [0.65, 0, 0.6, 0.45, 0, 0.55, 0.45, 0, 0.7, 0, 0.55, 0.5, 0, 0.6, 0.65, 0],
      kick: [0.9, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0.85, 0, 0, 0, 0, 0.45],
      snare: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0.3, 0, 0, 0.85, 0, 0, 0],
      hat: [0.45, 0.2, 0.6, 0.25, 0.45, 0.2, 0.65, 0.3, 0.45, 0.25, 0.6, 0.25, 0.45, 0.25, 0.65, 0.35],
      perc: [0, 0, 0, 0.55, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0, 0.45, 0, 0.5],
      swing: 0.12,
      energy: 0.78,
    },
    outro: {
      pad: [0.95, 0, 0, 0, 0, 0, 0.7, 0, 0.75, 0, 0, 0, 0, 0, 0.55, 0],
      bass: [0.95, 0, 0.5, 0, 0, 0.6, 0, 0.7, 0.85, 0, 0.75, 0, 0, 0.55, 0.65, 0],
      bassOffsets: [0, 0, 12, 0, 0, 7, 0, 5, 0, 0, 7, 0, 0, 12, 7, 0],
      arp: [0.75, 0.45, 0.65, 0.5, 0.6, 0.55, 0.7, 0.45, 0.75, 0.5, 0.65, 0.55, 0.65, 0.6, 0.7, 0.55],
      kick: [0.95, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0.9, 0, 0, 0, 0.5, 0],
      snare: [0, 0, 0, 0, 0.85, 0, 0, 0.3, 0, 0.35, 0, 0, 0.9, 0, 0, 0.35],
      hat: [0.5, 0.3, 0.7, 0.35, 0.5, 0.3, 0.75, 0.35, 0.5, 0.3, 0.7, 0.35, 0.55, 0.35, 0.75, 0.45],
      perc: [0, 0.45, 0, 0.55, 0, 0, 0.5, 0, 0, 0.55, 0, 0.45, 0, 0.5, 0, 0.6],
      swing: 0.12,
      energy: 0.92,
    },
    end: {
      pad: [0.75, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.55, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: ZERO_16,
      arp: [0.5, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0.4, 0, 0, 0],
      kick: ZERO_16,
      snare: ZERO_16,
      hat: ZERO_16,
      perc: [0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0, 0],
      swing: 0.08,
      energy: 0.32,
    },
  },
});

// ============================================================================
// 3. DISSOLVE (124 BPM — Ethereal Deep-House Em7 / Ab / Db Shimmer & Marimba)
// ============================================================================
const DISSOLVE_PACK = buildSynthPack({
  id: 'dissolve',
  title: 'Dissolve',
  author: 'Kairo Velas',
  mode: 'standard',
  baseBpm: 124,
  keySignature: 'E minor / Ab-Db modal',
  rootMidi: 64,
  gain: { master: 0.9, loop: 0.68, move: 0.62, drop: 0.85, clear: 0.88, combo: 0.92 },
  chords: [
    makeChord('em7', 'Em7', 40, [52, 55, 59, 62, 66], [64, 67, 71, 74, 78, 83]),
    makeChord('d6', 'D6', 38, [50, 54, 57, 59, 62], [62, 66, 69, 71, 74, 78]),
    makeChord('abmaj7', 'Abmaj7', 44, [56, 60, 63, 67, 70], [68, 72, 75, 79, 82, 87]),
    makeChord('dbmaj7', 'Dbmaj7', 37, [49, 53, 56, 60, 63], [61, 65, 68, 72, 75, 80]),
    makeChord('cmaj9', 'Cmaj9', 36, [48, 52, 55, 59, 62], [60, 64, 67, 71, 74, 79]),
    makeChord('bm7', 'Bm7', 47, [54, 59, 62, 66, 69], [66, 71, 74, 78, 81, 86]),
  ],
  progressionsByChordIds: {
    start_prog: ['em7', 'd6', 'abmaj7', 'dbmaj7'],
    mid_prog: ['em7', 'cmaj9', 'abmaj7', 'dbmaj7'],
    outro_prog: ['bm7', 'em7', 'abmaj7', 'dbmaj7'],
    end_prog: ['abmaj7', 'dbmaj7', 'em7', 'em7'],
  },
  loops: {
    start: { audio: 'synth:dissolve:start', bpm: 124, length: 16, progression: 'start_prog', next: 'start' },
    middle: { audio: 'synth:dissolve:middle', bpm: 124, length: 16, progression: 'mid_prog', next: 'middle' },
    outro: { audio: 'synth:dissolve:outro', bpm: 124, length: 16, progression: 'outro_prog', next: 'outro' },
    end: { audio: 'synth:dissolve:end', bpm: 124, length: 16, progression: 'end_prog', next: 'end' },
  },
  timbre: {
    bass: { wave: 'triangle', subMix: 0.55, cutoffHz: 480, q: 1.1, attack: 0.008, decay: 0.2, sustain: 0.35, release: 0.12, gain: 0.32 },
    pad: { wave: 'sawtooth', detuneCents: 13, cutoffHz: 1550, attack: 0.09, release: 0.75, gain: 0.12 },
    arp: { wave: 'sine', cutoffHz: 2600, attack: 0.002, decay: 0.11, release: 0.07, gain: 0.18 },
    drums: {
      kickFreqStart: 135, kickFreqEnd: 42, kickDecay: 0.15, kickGain: 0.44,
      snareToneHz: 240, snareBandHz: 2100, snareDecay: 0.09, snareGain: 0.19,
      hatHighpassHz: 8200, hatDecay: 0.055, hatGain: 0.13,
      percFreqHz: 940, percDecay: 0.05, percGain: 0.12,
    },
    sfx: {
      dropWave: 'sine', dropPunchHz: 118,
      moveWave: 'sine', moveFilterHz: 2800, moveDecay: 0.085,
      clearWave: 'triangle', clearShimmerDetune: 12, comboWave: 'sine',
    },
  },
  loopPatterns: {
    start: {
      pad: [0.8, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.75, 0, 0, 0.55, 0, 0, 0.65, 0, 0, 0, 0.7, 0, 0, 0, 0.5, 0],
      bassOffsets: [0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 12, 0],
      arp: [0.65, 0, 0, 0.6, 0, 0, 0.55, 0, 0, 0.6, 0, 0, 0.65, 0, 0.5, 0],
      kick: [0.85, 0, 0, 0, 0.85, 0, 0, 0, 0.85, 0, 0, 0, 0.85, 0, 0, 0],
      snare: ZERO_16,
      hat: [0, 0, 0.55, 0, 0, 0, 0.55, 0, 0, 0, 0.55, 0, 0, 0, 0.6, 0],
      perc: [0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0.35],
      swing: 0.05,
      energy: 0.6,
    },
    middle: {
      pad: [0.9, 0, 0, 0, 0, 0, 0.55, 0, 0.75, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.9, 0, 0, 0.7, 0, 0, 0.8, 0, 0.85, 0, 0.7, 0, 0, 0.55, 0.7, 0],
      bassOffsets: [0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 12, 0, 0, 7, 12, 0],
      arp: [0.75, 0, 0.5, 0.7, 0, 0.55, 0.65, 0, 0.75, 0, 0.55, 0.65, 0, 0.6, 0.7, 0.45],
      kick: [1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0],
      hat: [0.25, 0, 0.8, 0.3, 0.25, 0, 0.8, 0.35, 0.25, 0, 0.8, 0.3, 0.25, 0.25, 0.85, 0.35],
      perc: [0, 0, 0, 0.5, 0, 0.55, 0, 0, 0, 0, 0, 0.5, 0, 0.55, 0, 0.45],
      swing: 0.06,
      energy: 0.84,
    },
    outro: {
      pad: [1.0, 0, 0, 0, 0, 0, 0.7, 0, 0.9, 0, 0, 0, 0, 0, 0.6, 0],
      bass: [1.0, 0, 0.5, 0.75, 0, 0.5, 0.85, 0, 0.95, 0, 0.75, 0.5, 0, 0.65, 0.8, 0.5],
      bassOffsets: [0, 0, 12, 0, 0, 7, 12, 0, 0, 0, 12, 7, 0, 7, 12, 7],
      arp: [0.85, 0.45, 0.6, 0.8, 0.5, 0.65, 0.75, 0.5, 0.85, 0.5, 0.65, 0.75, 0.55, 0.7, 0.8, 0.6],
      kick: [1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0.4, 0],
      snare: [0, 0, 0, 0, 0.85, 0, 0, 0.3, 0, 0, 0, 0, 0.9, 0, 0, 0.35],
      hat: [0.35, 0.25, 0.9, 0.4, 0.35, 0.25, 0.9, 0.4, 0.35, 0.25, 0.9, 0.4, 0.4, 0.35, 0.95, 0.45],
      perc: [0, 0.4, 0, 0.6, 0, 0.6, 0, 0.4, 0, 0.4, 0, 0.6, 0, 0.6, 0.45, 0.55],
      swing: 0.06,
      energy: 0.98,
    },
    end: {
      pad: [0.8, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.55, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: ZERO_16,
      arp: [0.55, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0.4, 0, 0, 0],
      kick: ZERO_16,
      snare: ZERO_16,
      hat: ZERO_16,
      perc: ZERO_16,
      swing: 0.04,
      energy: 0.34,
    },
  },
});

// ============================================================================
// 4. QUASAR (85 BPM — Cosmic Downtempo Sub-Bass & Glass Harmonics)
// ============================================================================
const QUASAR_PACK = buildSynthPack({
  id: 'quasar',
  title: 'Quasar',
  author: 'Sora & Vance',
  mode: 'standard',
  baseBpm: 85,
  keySignature: 'D minor / Dorian',
  rootMidi: 62,
  gain: { master: 0.9, loop: 0.7, move: 0.62, drop: 0.86, clear: 0.9, combo: 0.94 },
  chords: [
    makeChord('dm9', 'Dm9', 38, [50, 53, 57, 60, 64], [62, 69, 72, 76, 81, 86]),
    makeChord('bbmaj7', 'Bbmaj7', 34, [46, 53, 57, 62, 65], [62, 65, 69, 74, 77, 81]),
    makeChord('gm11', 'Gm11', 43, [55, 58, 60, 62, 65], [67, 70, 72, 74, 77, 82]),
    makeChord('am7', 'Am7', 45, [52, 57, 60, 64, 67], [64, 69, 72, 76, 79, 84]),
    makeChord('c6', 'C6', 36, [48, 52, 55, 57, 60], [60, 64, 67, 69, 72, 76]),
    makeChord('ebmaj7', 'Ebmaj7', 39, [51, 55, 58, 62, 67], [63, 67, 70, 74, 79, 82]),
  ],
  progressionsByChordIds: {
    start_prog: ['dm9', 'bbmaj7', 'gm11', 'am7'],
    mid_prog: ['dm9', 'c6', 'bbmaj7', 'am7'],
    outro_prog: ['gm11', 'dm9', 'ebmaj7', 'am7'],
    end_prog: ['bbmaj7', 'am7', 'dm9', 'dm9'],
  },
  loops: {
    start: { audio: 'synth:quasar:start', bpm: 85, length: 16, progression: 'start_prog', next: 'start' },
    middle: { audio: 'synth:quasar:middle', bpm: 85, length: 16, progression: 'mid_prog', next: 'middle' },
    outro: { audio: 'synth:quasar:outro', bpm: 85, length: 16, progression: 'outro_prog', next: 'outro' },
    end: { audio: 'synth:quasar:end', bpm: 85, length: 16, progression: 'end_prog', next: 'end' },
  },
  timbre: {
    bass: { wave: 'sine', subMix: 0.7, cutoffHz: 320, q: 0.8, attack: 0.02, decay: 0.35, sustain: 0.55, release: 0.25, gain: 0.38 },
    pad: { wave: 'triangle', detuneCents: 14, cutoffHz: 1800, attack: 0.14, release: 0.9, gain: 0.16 },
    arp: { wave: 'sine', cutoffHz: 5200, attack: 0.004, decay: 0.26, release: 0.28, gain: 0.14 },
    drums: {
      kickFreqStart: 115, kickFreqEnd: 36, kickDecay: 0.22, kickGain: 0.46,
      snareToneHz: 165, snareBandHz: 1950, snareDecay: 0.16, snareGain: 0.18,
      hatHighpassHz: 8500, hatDecay: 0.04, hatGain: 0.1,
      percFreqHz: 2240, percDecay: 0.12, percGain: 0.1,
    },
    sfx: {
      dropWave: 'sine', dropPunchHz: 95,
      moveWave: 'sine', moveFilterHz: 4600, moveDecay: 0.15,
      clearWave: 'sine', clearShimmerDetune: 14, comboWave: 'sine',
    },
  },
  loopPatterns: {
    start: {
      pad: [0.85, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.9, 0, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: [0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0],
      arp: [0.6, 0, 0, 0.5, 0, 0, 0.55, 0, 0, 0, 0.6, 0, 0, 0.45, 0, 0],
      kick: [0.85, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0],
      hat: [0, 0, 0.35, 0, 0, 0, 0.35, 0, 0, 0, 0.35, 0, 0, 0, 0.45, 0],
      perc: [0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0],
      swing: 0.04,
      energy: 0.5,
    },
    middle: {
      pad: [0.9, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.95, 0, 0, 0, 0, 0, 0.6, 0, 0.8, 0, 0, 0, 0, 0, 0.65, 0],
      bassOffsets: [0, 0, 0, 0, 0, 0, 5, 0, 7, 0, 0, 0, 0, 0, 12, 0],
      arp: [0.7, 0, 0.5, 0.6, 0, 0.45, 0.65, 0, 0.7, 0, 0.55, 0, 0.6, 0.5, 0.65, 0],
      kick: [0.95, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0.85, 0, 0, 0, 0, 0.5],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0.35],
      hat: [0.35, 0, 0.55, 0.25, 0.35, 0, 0.55, 0.3, 0.35, 0, 0.55, 0.25, 0.35, 0.25, 0.65, 0.3],
      perc: [0, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0.5, 0.55, 0, 0, 0.45],
      swing: 0.05,
      energy: 0.78,
    },
    outro: {
      pad: [1.0, 0, 0, 0, 0, 0, 0.6, 0, 0.85, 0, 0, 0, 0, 0, 0.55, 0],
      bass: [1.0, 0, 0, 0.5, 0, 0, 0.75, 0, 0.9, 0, 0.6, 0, 0, 0, 0.75, 0],
      bassOffsets: [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 12, 0, 0, 0, 7, 0],
      arp: [0.8, 0.4, 0.65, 0.65, 0.45, 0.6, 0.75, 0.45, 0.8, 0.45, 0.65, 0.6, 0.7, 0.55, 0.75, 0.6],
      kick: [1.0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.9, 0, 0, 0, 0.6, 0],
      snare: [0, 0, 0, 0, 0.5, 0, 0, 0, 0.95, 0, 0, 0.3, 0, 0, 0, 0.45],
      hat: [0.45, 0.25, 0.65, 0.35, 0.45, 0.25, 0.7, 0.35, 0.45, 0.25, 0.65, 0.35, 0.45, 0.35, 0.75, 0.45],
      perc: [0, 0.45, 0, 0.55, 0.55, 0, 0.45, 0, 0, 0.45, 0, 0.55, 0.6, 0, 0.5, 0.5],
      swing: 0.05,
      energy: 0.94,
    },
    end: {
      pad: [0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: ZERO_16,
      arp: [0.55, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0],
      kick: ZERO_16,
      snare: ZERO_16,
      hat: ZERO_16,
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0],
      swing: 0,
      energy: 0.3,
    },
  },
});

// ============================================================================
// 5. COREFAULT (114 BPM — Crunchy Chiptune / FM Sci-Fi Electro)
// ============================================================================
const COREFAULT_PACK = buildSynthPack({
  id: 'corefault',
  title: 'Corefault',
  author: 'ByteForge DSP',
  mode: 'standard',
  baseBpm: 114,
  keySignature: 'A minor',
  rootMidi: 57,
  gain: { master: 0.88, loop: 0.64, move: 0.6, drop: 0.84, clear: 0.86, combo: 0.9 },
  chords: [
    makeChord('am7', 'Am7', 33, [45, 48, 52, 55, 59], [57, 60, 64, 67, 69, 72, 76]),
    makeChord('fmaj7', 'Fmaj7', 41, [53, 57, 60, 64, 67], [65, 69, 72, 76, 77, 81]),
    makeChord('dm9', 'Dm9', 38, [50, 53, 57, 60, 64], [62, 65, 69, 72, 74, 76]),
    makeChord('e7', 'E7', 40, [52, 56, 59, 62, 64], [64, 68, 71, 74, 76, 80]),
    makeChord('g6', 'G6', 43, [55, 59, 62, 64, 67], [67, 71, 74, 76, 79, 83]),
    makeChord('e7s9', 'E7#9', 40, [52, 56, 59, 62, 67], [64, 68, 71, 74, 79, 83]),
  ],
  progressionsByChordIds: {
    start_prog: ['am7', 'fmaj7', 'dm9', 'e7'],
    mid_prog: ['am7', 'g6', 'fmaj7', 'e7s9'],
    outro_prog: ['dm9', 'am7', 'fmaj7', 'e7s9'],
    end_prog: ['fmaj7', 'e7', 'am7', 'am7'],
  },
  loops: {
    start: { audio: 'synth:corefault:start', bpm: 114, length: 16, progression: 'start_prog', next: 'start' },
    middle: { audio: 'synth:corefault:middle', bpm: 114, length: 16, progression: 'mid_prog', next: 'middle' },
    outro: { audio: 'synth:corefault:outro', bpm: 114, length: 16, progression: 'outro_prog', next: 'outro' },
    end: { audio: 'synth:corefault:end', bpm: 114, length: 16, progression: 'end_prog', next: 'end' },
  },
  timbre: {
    bass: { wave: 'sawtooth', subMix: 0.3, cutoffHz: 960, q: 2.8, attack: 0.003, decay: 0.13, sustain: 0.25, release: 0.06, gain: 0.26 },
    pad: { wave: 'square', detuneCents: 11, cutoffHz: 1350, attack: 0.02, release: 0.35, gain: 0.09 },
    arp: { wave: 'square', cutoffHz: 3200, attack: 0.002, decay: 0.09, release: 0.05, gain: 0.13 },
    drums: {
      kickFreqStart: 175, kickFreqEnd: 46, kickDecay: 0.12, kickGain: 0.44,
      snareToneHz: 245, snareBandHz: 2800, snareDecay: 0.12, snareGain: 0.24,
      hatHighpassHz: 7200, hatDecay: 0.028, hatGain: 0.14,
      percFreqHz: 1480, percDecay: 0.038, percGain: 0.12,
    },
    sfx: {
      dropWave: 'sawtooth', dropPunchHz: 145,
      moveWave: 'square', moveFilterHz: 2600, moveDecay: 0.07,
      clearWave: 'square', clearShimmerDetune: 11, comboWave: 'triangle',
    },
  },
  loopPatterns: {
    start: {
      pad: [0.7, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.9, 0, 0.6, 0, 0, 0.75, 0, 0, 0.9, 0, 0.65, 0, 0, 0.7, 0.55, 0],
      bassOffsets: [0, 0, 12, 0, 0, 7, 0, 0, 0, 0, 12, 0, 0, 7, 10, 0],
      arp: [0.8, 0, 0.65, 0.5, 0, 0.7, 0.55, 0, 0.8, 0, 0.65, 0.55, 0, 0.7, 0.6, 0],
      kick: [0.9, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.85, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, 0],
      hat: [0.4, 0, 0.55, 0, 0.4, 0, 0.55, 0.35, 0.4, 0, 0.55, 0, 0.4, 0, 0.6, 0.35],
      perc: [0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.55, 0],
      swing: 0,
      energy: 0.66,
    },
    middle: {
      pad: [0.8, 0, 0, 0, 0, 0, 0.5, 0, 0.7, 0, 0, 0, 0, 0, 0, 0],
      bass: [1.0, 0.4, 0.7, 0, 0.85, 0.45, 0.8, 0, 1.0, 0.4, 0.75, 0.45, 0.85, 0, 0.8, 0.6],
      bassOffsets: [0, 0, 12, 0, 0, 7, 12, 0, 0, 0, 12, 7, 0, 0, 10, 12],
      arp: [0.85, 0.5, 0.75, 0.6, 0.8, 0.55, 0.75, 0.6, 0.85, 0.55, 0.75, 0.6, 0.8, 0.6, 0.8, 0.65],
      kick: [1.0, 0, 0, 0.55, 0, 0, 0.85, 0, 0, 0, 0.95, 0, 0, 0, 0.55, 0],
      snare: [0, 0, 0, 0, 0.95, 0, 0, 0.3, 0, 0, 0, 0, 0.95, 0, 0, 0.4],
      hat: [0.45, 0.3, 0.7, 0.35, 0.45, 0.3, 0.75, 0.4, 0.45, 0.3, 0.7, 0.35, 0.45, 0.35, 0.8, 0.45],
      perc: [0, 0.45, 0, 0.6, 0, 0.4, 0, 0.5, 0, 0.55, 0, 0.5, 0, 0.45, 0.6, 0],
      swing: 0,
      energy: 0.88,
    },
    outro: {
      pad: [0.9, 0, 0, 0, 0.5, 0, 0, 0, 0.85, 0, 0, 0, 0.55, 0, 0, 0],
      bass: [1.0, 0.55, 0.8, 0.5, 0.95, 0.55, 0.85, 0.6, 1.0, 0.55, 0.85, 0.55, 0.95, 0.6, 0.9, 0.7],
      bassOffsets: [0, 12, 0, 7, 0, 12, 7, 10, 0, 12, 0, 7, 12, 7, 10, 12],
      arp: [0.95, 0.65, 0.85, 0.7, 0.9, 0.7, 0.85, 0.75, 0.95, 0.7, 0.85, 0.75, 0.9, 0.75, 0.9, 0.8],
      kick: [1.0, 0, 0, 0.6, 0, 0, 0.9, 0, 0.7, 0, 1.0, 0, 0, 0, 0.65, 0],
      snare: [0, 0, 0, 0, 1.0, 0, 0, 0.4, 0, 0.35, 0, 0, 1.0, 0, 0.35, 0.5],
      hat: [0.55, 0.4, 0.8, 0.45, 0.55, 0.4, 0.85, 0.5, 0.55, 0.4, 0.8, 0.45, 0.6, 0.45, 0.9, 0.55],
      perc: [0, 0.55, 0, 0.65, 0, 0.55, 0, 0.6, 0, 0.6, 0, 0.65, 0, 0.55, 0.7, 0.5],
      swing: 0,
      energy: 1.0,
    },
    end: {
      pad: [0.65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.6, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: ZERO_16,
      arp: [0.6, 0, 0, 0, 0.45, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0],
      kick: ZERO_16,
      snare: ZERO_16,
      hat: ZERO_16,
      perc: ZERO_16,
      swing: 0,
      energy: 0.35,
    },
  },
});

// ============================================================================
// 6. MINIMUM (60 BPM — Tranquil Ultra-Minimal Ambient Sine & Wooden Clicks)
// ============================================================================
const MINIMUM_PACK = buildSynthPack({
  id: 'minimum',
  title: 'Minimum',
  author: 'Studio K-Zero',
  mode: 'both',
  baseBpm: 60,
  keySignature: 'G major pentatonic',
  rootMidi: 67,
  gain: { master: 0.88, loop: 0.58, move: 0.58, drop: 0.76, clear: 0.84, combo: 0.88 },
  chords: [
    makeChord('gmaj9', 'Gmaj9', 43, [55, 59, 62, 66, 69], [67, 71, 74, 78, 81, 86]),
    makeChord('em9', 'Em9', 40, [52, 55, 59, 62, 66], [64, 67, 71, 74, 78, 83]),
    makeChord('cmaj9', 'Cmaj9', 36, [48, 52, 55, 59, 62], [60, 64, 67, 71, 74, 79]),
    makeChord('d6', 'D6', 38, [50, 54, 57, 59, 62], [62, 66, 69, 71, 74, 81]),
    makeChord('bm7', 'Bm7', 47, [54, 59, 62, 66, 69], [66, 71, 74, 78, 81, 86]),
  ],
  progressionsByChordIds: {
    start_prog: ['gmaj9', 'em9', 'cmaj9', 'd6'],
    mid_prog: ['gmaj9', 'bm7', 'cmaj9', 'd6'],
    outro_prog: ['em9', 'cmaj9', 'gmaj9', 'd6'],
    end_prog: ['cmaj9', 'gmaj9', 'gmaj9', 'gmaj9'],
  },
  loops: {
    start: { audio: 'synth:minimum:start', bpm: 60, length: 16, progression: 'start_prog', next: 'start' },
    middle: { audio: 'synth:minimum:middle', bpm: 60, length: 16, progression: 'mid_prog', next: 'middle' },
    outro: { audio: 'synth:minimum:outro', bpm: 60, length: 16, progression: 'outro_prog', next: 'outro' },
    end: { audio: 'synth:minimum:end', bpm: 60, length: 16, progression: 'end_prog', next: 'end' },
  },
  timbre: {
    bass: { wave: 'sine', subMix: 0.2, cutoffHz: 340, q: 0.7, attack: 0.04, decay: 0.4, sustain: 0.5, release: 0.35, gain: 0.26 },
    pad: { wave: 'sine', detuneCents: 4, cutoffHz: 1400, attack: 0.18, release: 1.1, gain: 0.16 },
    arp: { wave: 'sine', cutoffHz: 2600, attack: 0.004, decay: 0.14, release: 0.22, gain: 0.12 },
    drums: {
      kickFreqStart: 95, kickFreqEnd: 46, kickDecay: 0.14, kickGain: 0.22,
      snareToneHz: 320, snareBandHz: 1400, snareDecay: 0.05, snareGain: 0.08,
      hatHighpassHz: 6000, hatDecay: 0.02, hatGain: 0.05,
      percFreqHz: 860, percDecay: 0.032, percGain: 0.16,
    },
    sfx: {
      dropWave: 'sine', dropPunchHz: 110,
      moveWave: 'sine', moveFilterHz: 2200, moveDecay: 0.08,
      clearWave: 'sine', clearShimmerDetune: 5, comboWave: 'sine',
    },
  },
  loopPatterns: {
    start: {
      pad: [0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: ZERO_16,
      arp: [0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0],
      kick: ZERO_16,
      snare: ZERO_16,
      hat: ZERO_16,
      perc: [0.5, 0, 0, 0, 0, 0, 0.35, 0, 0.45, 0, 0, 0, 0, 0, 0.3, 0],
      swing: 0,
      energy: 0.38,
    },
    middle: {
      pad: [0.78, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.75, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: [0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0],
      arp: [0.5, 0, 0, 0, 0.55, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0, 0.45, 0],
      kick: [0.55, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0],
      snare: ZERO_16,
      hat: [0, 0, 0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.25, 0],
      perc: [0.55, 0, 0, 0.35, 0, 0, 0.45, 0, 0.5, 0, 0, 0.35, 0, 0, 0.45, 0],
      swing: 0,
      energy: 0.55,
    },
    outro: {
      pad: [0.85, 0, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.8, 0, 0, 0, 0, 0, 0.45, 0, 0.6, 0, 0, 0, 0, 0, 0.4, 0],
      bassOffsets: [0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 12, 0],
      arp: [0.6, 0, 0.4, 0, 0.6, 0, 0.45, 0, 0.55, 0, 0.5, 0, 0.55, 0, 0.5, 0],
      kick: [0.65, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
      snare: ZERO_16,
      hat: [0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.35, 0],
      perc: [0.6, 0, 0, 0.4, 0, 0.35, 0.5, 0, 0.55, 0, 0, 0.4, 0, 0.35, 0.5, 0],
      swing: 0,
      energy: 0.68,
    },
    end: {
      pad: [0.65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: ZERO_16,
      arp: [0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      kick: ZERO_16,
      snare: ZERO_16,
      hat: ZERO_16,
      perc: [0.35, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      swing: 0,
      energy: 0.25,
    },
  },
});

// ============================================================================
// 7. RUSH (Multi-Tempo 2-Minute Arc: 120->127->132->137->140->143->107->110->113->116->123->123.7->120)
// ============================================================================
const RUSH_PATTERN_RISE: LoopPatternSpec = {
  pad: [0.85, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0],
  bass: [0.95, 0, 0.65, 0, 0.85, 0, 0.75, 0, 0.95, 0, 0.7, 0, 0.85, 0, 0.75, 0.5],
  bassOffsets: [0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 12, 0, 7, 0, 12, 7],
  arp: [0.8, 0.45, 0.7, 0.45, 0.8, 0.5, 0.7, 0.5, 0.85, 0.45, 0.7, 0.5, 0.8, 0.55, 0.75, 0.6],
  kick: [1.0, 0, 0, 0, 0.95, 0, 0, 0, 1.0, 0, 0, 0, 0.95, 0, 0, 0],
  snare: [0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0.35],
  hat: [0.35, 0.25, 0.75, 0.3, 0.35, 0.25, 0.75, 0.35, 0.35, 0.25, 0.75, 0.3, 0.4, 0.3, 0.8, 0.4],
  perc: [0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0.55, 0],
  swing: 0,
  energy: 0.78,
};

const RUSH_PATTERN_PEAK: LoopPatternSpec = {
  pad: [0.95, 0, 0, 0, 0, 0, 0.6, 0, 0.9, 0, 0, 0, 0, 0, 0.6, 0],
  bass: [1.0, 0.45, 0.75, 0.45, 0.95, 0.5, 0.85, 0.55, 1.0, 0.45, 0.8, 0.5, 0.95, 0.55, 0.85, 0.65],
  bassOffsets: [0, 0, 12, 0, 0, 7, 12, 7, 0, 0, 12, 0, 7, 12, 7, 12],
  arp: [0.95, 0.6, 0.85, 0.65, 0.9, 0.65, 0.85, 0.7, 0.95, 0.65, 0.85, 0.7, 0.95, 0.7, 0.9, 0.8],
  kick: [1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0.55, 0],
  snare: [0, 0, 0, 0, 0.95, 0, 0, 0.35, 0, 0, 0, 0, 1.0, 0, 0.35, 0.5],
  hat: [0.5, 0.35, 0.85, 0.45, 0.5, 0.35, 0.85, 0.45, 0.5, 0.35, 0.85, 0.45, 0.55, 0.4, 0.9, 0.55],
  perc: [0, 0.4, 0, 0.6, 0, 0.45, 0, 0.5, 0, 0.45, 0, 0.6, 0, 0.5, 0.65, 0.55],
  swing: 0,
  energy: 0.96,
};

const RUSH_PATTERN_DROP: LoopPatternSpec = {
  pad: [0.9, 0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0],
  bass: [1.0, 0, 0, 0.65, 0, 0, 0.8, 0, 0.95, 0, 0, 0.65, 0, 0.6, 0.8, 0],
  bassOffsets: [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 0, 12, 0, 7, 10, 0],
  arp: [0.8, 0, 0.65, 0.5, 0.75, 0, 0.7, 0.55, 0.85, 0, 0.7, 0.55, 0.8, 0.6, 0.75, 0.65],
  kick: [1.0, 0, 0, 0, 0, 0, 0.75, 0, 1.0, 0, 0, 0, 0, 0, 0.7, 0],
  snare: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0.4],
  hat: [0.4, 0.25, 0.7, 0.3, 0.4, 0.25, 0.75, 0.35, 0.4, 0.25, 0.7, 0.3, 0.45, 0.35, 0.8, 0.45],
  perc: [0, 0, 0.45, 0, 0, 0, 0, 0.5, 0, 0, 0.45, 0, 0, 0, 0.55, 0],
  swing: 0,
  energy: 0.85,
};

const RUSH_PATTERN_FINALE: LoopPatternSpec = {
  ...RUSH_PATTERN_PEAK,
  energy: 1.0,
};

const RUSH_PATTERN_END: LoopPatternSpec = {
  pad: [0.8, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
  bass: [0.7, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
  bassOffsets: ZERO_16,
  arp: [0.7, 0, 0, 0, 0.55, 0, 0, 0, 0.6, 0, 0, 0, 0.5, 0, 0, 0],
  kick: [0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  snare: ZERO_16,
  hat: ZERO_16,
  perc: ZERO_16,
  swing: 0,
  energy: 0.45,
};

const RUSH_PACK = buildSynthPack({
  id: 'rush',
  title: 'Rush',
  author: 'Krunked Synth Collective',
  mode: 'rush',
  baseBpm: 120,
  keySignature: 'C minor -> Eb major',
  rootMidi: 60,
  gain: { master: 0.92, loop: 0.66, move: 0.64, drop: 0.88, clear: 0.9, combo: 0.95 },
  chords: [
    makeChord('cm7', 'Cm7', 36, [48, 51, 55, 58, 62], [60, 63, 67, 70, 74, 79]),
    makeChord('abmaj7', 'Abmaj7', 44, [56, 60, 63, 67, 70], [68, 72, 75, 79, 82, 84]),
    makeChord('bb6', 'Bb6', 46, [58, 62, 65, 67, 70], [70, 74, 77, 79, 82, 86]),
    makeChord('gm7', 'Gm7', 43, [55, 58, 62, 65, 69], [67, 70, 74, 77, 81, 86]),
    makeChord('fm9', 'Fm9', 41, [53, 56, 60, 63, 67], [65, 68, 72, 75, 79, 84]),
    makeChord('ebmaj9', 'Ebmaj9', 39, [51, 55, 58, 62, 65], [63, 67, 70, 74, 77, 82]),
    makeChord('dbmaj7', 'Dbmaj7', 37, [49, 53, 56, 60, 63], [61, 65, 68, 72, 75, 80]),
    makeChord('g7sus4', 'G7sus4', 43, [55, 60, 62, 65, 67], [67, 72, 74, 77, 79, 84]),
  ],
  progressionsByChordIds: {
    rush_rise: ['cm7', 'abmaj7', 'bb6', 'gm7'],
    rush_peak: ['fm9', 'dbmaj7', 'ebmaj9', 'cm7'],
    rush_drop_build: ['abmaj7', 'bb6', 'cm7', 'ebmaj9'],
    rush_finale: ['abmaj7', 'bb6', 'cm7', 'g7sus4'],
    rush_end: ['abmaj7', 'bb6', 'cm7', 'cm7'],
  },
  loops: {
    start: { audio: 'synth:rush:start', bpm: 120, length: 16, progression: 'rush_rise', next: 'rush_2' },
    rush_2: { audio: 'synth:rush:rush_2', bpm: 127, length: 16, progression: 'rush_rise', next: 'rush_3' },
    rush_3: { audio: 'synth:rush:rush_3', bpm: 132, length: 16, progression: 'rush_rise', next: 'rush_4' },
    rush_4: { audio: 'synth:rush:rush_4', bpm: 137, length: 16, progression: 'rush_peak', next: 'rush_5' },
    rush_5: { audio: 'synth:rush:rush_5', bpm: 140, length: 16, progression: 'rush_peak', next: 'rush_6' },
    rush_6: { audio: 'synth:rush:rush_6', bpm: 143, length: 16, progression: 'rush_peak', next: 'middle' },
    middle: { audio: 'synth:rush:middle', bpm: 107, length: 16, progression: 'rush_drop_build', next: 'rush_8' },
    rush_8: { audio: 'synth:rush:rush_8', bpm: 110, length: 16, progression: 'rush_drop_build', next: 'rush_9' },
    rush_9: { audio: 'synth:rush:rush_9', bpm: 113, length: 16, progression: 'rush_drop_build', next: 'rush_10' },
    rush_10: { audio: 'synth:rush:rush_10', bpm: 116, length: 16, progression: 'rush_finale', next: 'outro' },
    outro: { audio: 'synth:rush:outro', bpm: 123, length: 32, progression: 'rush_finale', next: 'rush_12' },
    rush_12: { audio: 'synth:rush:rush_12', bpm: 123.7, length: 16, progression: 'rush_finale', next: 'end' },
    end: { audio: 'synth:rush:end', bpm: 120, length: 16, progression: 'rush_end', next: 'end' },
  },
  timbre: {
    bass: { wave: 'sawtooth', subMix: 0.45, cutoffHz: 840, q: 1.8, attack: 0.004, decay: 0.12, sustain: 0.25, release: 0.07, gain: 0.28 },
    pad: { wave: 'sawtooth', detuneCents: 12, cutoffHz: 2100, attack: 0.03, release: 0.4, gain: 0.11 },
    arp: { wave: 'sawtooth', cutoffHz: 3900, attack: 0.003, decay: 0.1, release: 0.06, gain: 0.13 },
    drums: {
      kickFreqStart: 168, kickFreqEnd: 42, kickDecay: 0.12, kickGain: 0.46,
      snareToneHz: 225, snareBandHz: 2600, snareDecay: 0.11, snareGain: 0.24,
      hatHighpassHz: 7900, hatDecay: 0.03, hatGain: 0.14,
      percFreqHz: 1320, percDecay: 0.04, percGain: 0.12,
    },
    sfx: {
      dropWave: 'triangle', dropPunchHz: 140,
      moveWave: 'triangle', moveFilterHz: 4200, moveDecay: 0.08,
      clearWave: 'sawtooth', clearShimmerDetune: 11, comboWave: 'triangle',
    },
  },
  loopPatterns: {
    start: { ...RUSH_PATTERN_RISE, energy: 0.68 },
    rush_2: { ...RUSH_PATTERN_RISE, energy: 0.74 },
    rush_3: { ...RUSH_PATTERN_RISE, energy: 0.8 },
    rush_4: { ...RUSH_PATTERN_PEAK, energy: 0.86 },
    rush_5: { ...RUSH_PATTERN_PEAK, energy: 0.92 },
    rush_6: { ...RUSH_PATTERN_PEAK, energy: 0.98 },
    middle: { ...RUSH_PATTERN_DROP, energy: 0.78 },
    rush_8: { ...RUSH_PATTERN_DROP, energy: 0.84 },
    rush_9: { ...RUSH_PATTERN_DROP, energy: 0.9 },
    rush_10: { ...RUSH_PATTERN_PEAK, energy: 0.94 },
    outro: RUSH_PATTERN_FINALE,
    rush_12: RUSH_PATTERN_FINALE,
    end: RUSH_PATTERN_END,
  },
});

// ============================================================================
// 8. HAZARD (180 BPM — High-Octane Arcade Breakbeat / Synth Lead Run)
// ============================================================================
const HAZARD_PACK = buildSynthPack({
  id: 'hazard',
  title: 'Hazard',
  author: 'Overclock Unit',
  mode: 'rush',
  baseBpm: 180,
  keySignature: 'F# minor',
  rootMidi: 66,
  gain: { master: 0.9, loop: 0.65, move: 0.62, drop: 0.88, clear: 0.88, combo: 0.94 },
  chords: [
    makeChord('fsm7', 'F#m7', 42, [54, 57, 61, 64, 68], [66, 69, 73, 76, 78, 81, 85]),
    makeChord('dmaj7', 'Dmaj7', 38, [50, 54, 57, 61, 64], [62, 66, 69, 73, 76, 81]),
    makeChord('bm7', 'Bm7', 47, [54, 59, 62, 66, 69], [66, 71, 74, 78, 81, 86]),
    makeChord('cs7', 'C#7', 37, [49, 53, 56, 59, 61], [61, 65, 68, 71, 73, 77]),
    makeChord('e6', 'E6', 40, [52, 56, 59, 61, 64], [64, 68, 71, 73, 76, 80]),
    makeChord('csm7', 'C#m7', 37, [49, 52, 56, 59, 63], [61, 64, 68, 71, 75, 80]),
  ],
  progressionsByChordIds: {
    start_prog: ['fsm7', 'dmaj7', 'bm7', 'cs7'],
    mid_prog: ['fsm7', 'e6', 'dmaj7', 'cs7'],
    outro_prog: ['bm7', 'csm7', 'dmaj7', 'e6'],
    end_prog: ['dmaj7', 'cs7', 'fsm7', 'fsm7'],
  },
  loops: {
    start: { audio: 'synth:hazard:start', bpm: 180, length: 16, progression: 'start_prog', next: 'start' },
    middle: { audio: 'synth:hazard:middle', bpm: 180, length: 16, progression: 'mid_prog', next: 'middle' },
    outro: { audio: 'synth:hazard:outro', bpm: 180, length: 16, progression: 'outro_prog', next: 'outro' },
    end: { audio: 'synth:hazard:end', bpm: 180, length: 16, progression: 'end_prog', next: 'end' },
  },
  timbre: {
    bass: { wave: 'sawtooth', subMix: 0.6, cutoffHz: 920, q: 2.2, attack: 0.003, decay: 0.11, sustain: 0.3, release: 0.05, gain: 0.28 },
    pad: { wave: 'sawtooth', detuneCents: 10, cutoffHz: 2000, attack: 0.02, release: 0.3, gain: 0.1 },
    arp: { wave: 'square', cutoffHz: 4400, attack: 0.002, decay: 0.075, release: 0.04, gain: 0.13 },
    drums: {
      kickFreqStart: 185, kickFreqEnd: 44, kickDecay: 0.1, kickGain: 0.45,
      snareToneHz: 255, snareBandHz: 3000, snareDecay: 0.095, snareGain: 0.25,
      hatHighpassHz: 8400, hatDecay: 0.024, hatGain: 0.14,
      percFreqHz: 1760, percDecay: 0.032, percGain: 0.11,
    },
    sfx: {
      dropWave: 'sawtooth', dropPunchHz: 155,
      moveWave: 'square', moveFilterHz: 3800, moveDecay: 0.06,
      clearWave: 'sawtooth', clearShimmerDetune: 12, comboWave: 'triangle',
    },
  },
  loopPatterns: {
    start: {
      pad: [0.75, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.95, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.9, 0, 0, 0, 0.65, 0],
      bassOffsets: [0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 12, 0],
      arp: [0.8, 0, 0.65, 0, 0.75, 0, 0.65, 0, 0.8, 0, 0.7, 0, 0.75, 0, 0.7, 0],
      kick: [1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0],
      hat: [0.5, 0, 0.6, 0, 0.5, 0, 0.65, 0, 0.5, 0, 0.6, 0, 0.5, 0, 0.65, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.5],
      swing: 0,
      energy: 0.72,
    },
    middle: {
      pad: [0.85, 0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0],
      bass: [1.0, 0, 0.6, 0, 0, 0, 0.8, 0, 0, 0.55, 0.95, 0, 0, 0, 0.8, 0],
      bassOffsets: [0, 0, 12, 0, 0, 0, 7, 0, 0, 5, 0, 0, 0, 0, 12, 0],
      arp: [0.9, 0.5, 0.75, 0.5, 0.85, 0.55, 0.75, 0.55, 0.9, 0.5, 0.8, 0.55, 0.85, 0.6, 0.8, 0.65],
      kick: [1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.95, 0, 0, 0.4, 0, 0.35, 0, 0, 0.95, 0, 0, 0.45],
      hat: [0.55, 0.35, 0.75, 0.4, 0.55, 0.35, 0.8, 0.45, 0.55, 0.35, 0.75, 0.4, 0.55, 0.4, 0.85, 0.45],
      perc: [0, 0, 0, 0.5, 0, 0, 0, 0.55, 0, 0, 0, 0.5, 0, 0, 0.55, 0.5],
      swing: 0,
      energy: 0.9,
    },
    outro: {
      pad: [0.95, 0, 0, 0, 0, 0, 0.6, 0, 0.9, 0, 0, 0, 0, 0, 0.6, 0],
      bass: [1.0, 0.45, 0.75, 0, 0.8, 0, 0.85, 0.5, 0.95, 0.5, 1.0, 0, 0.85, 0, 0.9, 0.6],
      bassOffsets: [0, 0, 12, 0, 7, 0, 12, 7, 0, 12, 0, 0, 7, 0, 12, 10],
      arp: [0.95, 0.65, 0.85, 0.65, 0.9, 0.65, 0.85, 0.7, 0.95, 0.7, 0.85, 0.7, 0.95, 0.75, 0.9, 0.8],
      kick: [1.0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 1.0, 0, 0, 0, 0.6, 0],
      snare: [0, 0, 0, 0, 1.0, 0, 0, 0.45, 0, 0.45, 0, 0, 1.0, 0, 0.35, 0.55],
      hat: [0.65, 0.45, 0.85, 0.5, 0.65, 0.45, 0.9, 0.55, 0.65, 0.45, 0.85, 0.5, 0.65, 0.5, 0.95, 0.6],
      perc: [0, 0.45, 0, 0.6, 0, 0.5, 0, 0.6, 0, 0.5, 0, 0.6, 0, 0.55, 0.65, 0.6],
      swing: 0,
      energy: 1.0,
    },
    end: {
      pad: [0.75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: [0.65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassOffsets: ZERO_16,
      arp: [0.65, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0],
      kick: [0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      snare: ZERO_16,
      hat: ZERO_16,
      perc: ZERO_16,
      swing: 0,
      energy: 0.4,
    },
  },
});

export const SYNTH_PACKS: Record<TrackId, SynthPackSpec> = {
  tessellation: TESSELLATION_PACK,
  summer_shower: SUMMER_SHOWER_PACK,
  dissolve: DISSOLVE_PACK,
  quasar: QUASAR_PACK,
  corefault: COREFAULT_PACK,
  minimum: MINIMUM_PACK,
  rush: RUSH_PACK,
  hazard: HAZARD_PACK,
};

/** Retrieve the normalized SoundpackManifest for any of the 8 built-in tracks. */
export function getSoundpackManifest(trackId: TrackId): SoundpackManifest {
  return SYNTH_PACKS[trackId].manifest;
}

/** Resolve the ChordVoicing associated with a group name (or fallback to first chord). */
export function resolveChordForGroup(pack: SynthPackSpec, groupName: string): ChordVoicing {
  const chordId = pack.groupToChord[groupName];
  if (chordId && pack.chords[chordId]) {
    return pack.chords[chordId];
  }
  const allChords = Object.values(pack.chords);
  return allChords[0];
}

/** Resolve the LoopPatternSpec for a loop name or section (with safe fallback). */
export function resolveLoopPattern(
  pack: SynthPackSpec,
  loopName: string,
  section: SongSection,
): LoopPatternSpec {
  return (
    pack.loopPatterns[loopName] ??
    pack.loopPatterns[section] ??
    pack.loopPatterns.start ??
    Object.values(pack.loopPatterns)[0]
  );
}
