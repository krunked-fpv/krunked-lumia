/**
 * Krunked Lumia — Musical Track Catalog & Pool Resolution
 * Declarative metadata for all 8 beat-locked harmonic tracks.
 */

import {
  ALL_TRACK_IDS,
  GAME_MODE_CONFIGS,
  RUSH_TRACK_POOL,
  STANDARD_TRACK_POOL,
  TRACK_COUNT,
  type GameModeId,
  type TrackId,
} from '../contracts/index.js';

export { ALL_TRACK_IDS, RUSH_TRACK_POOL, STANDARD_TRACK_POOL, TRACK_COUNT };
export type { TrackId };

export type TrackPoolKind = 'standard' | 'rush' | 'both';

export interface TrackMeta {
  id: TrackId;
  title: string;
  subtitle: string;
  artist: string;
  bpm: number;
  bpmLabel: string;
  pool: TrackPoolKind;
  coverPatternId: TrackId;
  defaultUnlocked: boolean;
  description: string;
}

export const TRACK_CATALOG: Readonly<Record<TrackId, TrackMeta>> = {
  tessellation: {
    id: 'tessellation',
    title: 'Tessellation',
    subtitle: 'Geometric Synth-Pop',
    artist: 'Krunked Synth Collective',
    bpm: 140,
    bpmLabel: '140 BPM',
    pool: 'standard',
    coverPatternId: 'tessellation',
    defaultUnlocked: true,
    description: 'Bright interlocking arpeggios and crisp four-on-the-floor pulse.',
  },
  summer_shower: {
    id: 'summer_shower',
    title: 'Summer Shower',
    subtitle: 'Warm Raindrop Keys',
    artist: 'Milo Vance',
    bpm: 90,
    bpmLabel: '90 BPM',
    pool: 'standard',
    coverPatternId: 'summer_shower',
    defaultUnlocked: true,
    description: 'Sunlit electric piano chords and gentle plucked droplets.',
  },
  dissolve: {
    id: 'dissolve',
    title: 'Dissolve',
    subtitle: 'Shimmer Deep House',
    artist: 'Sable Circuit',
    bpm: 124,
    bpmLabel: '124 BPM',
    pool: 'standard',
    coverPatternId: 'dissolve',
    defaultUnlocked: true,
    description: 'Floating minor-seventh pads over hypnotic marimba percussion.',
  },
  quasar: {
    id: 'quasar',
    title: 'Quasar',
    subtitle: 'Cosmic Glass Downtempo',
    artist: 'Helios Meridian',
    bpm: 85,
    bpmLabel: '85 BPM',
    pool: 'standard',
    coverPatternId: 'quasar',
    defaultUnlocked: true,
    description: 'Deep orbital sub-bass paired with crystalline bell harmonics.',
  },
  corefault: {
    id: 'corefault',
    title: 'Corefault',
    subtitle: 'FM Electro Telemetry',
    artist: 'Vex & Volt',
    bpm: 114,
    bpmLabel: '114 BPM',
    pool: 'standard',
    coverPatternId: 'corefault',
    defaultUnlocked: true,
    description: 'Crunchy FM basslines and fractured arcade percussion.',
  },
  minimum: {
    id: 'minimum',
    title: 'Minimum',
    subtitle: 'Tranquil Ambient Pulse',
    artist: 'Krunked Synth Collective',
    bpm: 60,
    bpmLabel: '60 BPM',
    pool: 'both',
    coverPatternId: 'minimum',
    defaultUnlocked: true,
    description: 'Ultra-minimal pure sine chords and tactile wooden clicks.',
  },
  rush: {
    id: 'rush',
    title: 'Rush',
    subtitle: 'Multi-Tempo Sprint',
    artist: 'Krunked Synth Collective',
    bpm: 120,
    bpmLabel: '120 BPM Multi',
    pool: 'rush',
    coverPatternId: 'rush',
    defaultUnlocked: true,
    description: 'Escalating two-minute harmonic sprint shifting through thirteen tempos.',
  },
  hazard: {
    id: 'hazard',
    title: 'Hazard',
    subtitle: 'High-Octane Breakbeat',
    artist: 'Nova Overdrive',
    bpm: 180,
    bpmLabel: '180 BPM',
    pool: 'rush',
    coverPatternId: 'hazard',
    defaultUnlocked: true,
    description: 'Relentless 180 BPM arcade leads built for peak-speed chains.',
  },
};

export const TRACK_LIST: readonly TrackMeta[] = ALL_TRACK_IDS.map((id) => TRACK_CATALOG[id]);

export function getTrackMeta(id: TrackId): TrackMeta {
  return TRACK_CATALOG[id] ?? TRACK_CATALOG.tessellation;
}

export function getTracksForMode(mode: GameModeId): TrackMeta[] {
  const pool = GAME_MODE_CONFIGS[mode].trackPool;
  const ids = pool === 'rush' ? RUSH_TRACK_POOL : STANDARD_TRACK_POOL;
  return ids.map((id) => TRACK_CATALOG[id]);
}

export function isTrackValidForMode(trackId: TrackId, mode: GameModeId): boolean {
  const pool = GAME_MODE_CONFIGS[mode].trackPool;
  return pool === 'rush'
    ? RUSH_TRACK_POOL.includes(trackId)
    : STANDARD_TRACK_POOL.includes(trackId);
}
