/**
 * Krunked Lumia — Custom Audio Pack Loader & Lenient Retail JSON Parser
 *
 * Parses retail `data/music/<slug>/data.json` (safely stripping trailing commas and
 * comments before `JSON.parse`) and decodes `.ogg` loop & SFX buffers from either
 * local dev-server URLs (`/__lumia_assets__/...`) or in-memory `Map<string, ArrayBuffer>`
 * blobs (for browser-uploaded IndexedDB packs).
 *
 * Every fetch and `decodeAudioData` failure degrades silently per file so the engine
 * seamlessly falls back to the built-in procedural Web Audio voice without ever throwing.
 */

import {
  ALL_TRACK_IDS,
  type CustomPackManifest,
  type ProgressionSlice,
  type SoundpackGainConfig,
  type SoundpackLoopDef,
  type SoundpackManifest,
  type TrackId,
} from '../contracts/index.js';
import { getSoundpackManifest } from './synthPacks.js';

export interface CustomTrackAudioPack {
  trackId: TrackId;
  manifest: SoundpackManifest;
  /** Decoded audio buffers indexed by cue reference, basename, and extensionless key. */
  buffers: Map<string, AudioBuffer>;
  /** Filenames that were missing or failed decode (handled by procedural fallback). */
  missingFiles: string[];
}

export interface CustomAudioPack {
  source: 'url' | 'memory';
  baseUrl?: string;
  tracks: Partial<Record<TrackId, CustomTrackAudioPack>>;
  menuBuffers: Map<string, AudioBuffer>;
  missingMenuFiles: string[];
}

export const DEFAULT_MENU_AUDIO_FILES: readonly string[] = [
  'menu_move.ogg',
  'menu_select_0.ogg',
  'menu_select_1.ogg',
  'menu_select_2.ogg',
  'menu_select_3.ogg',
  'menu_select_4.ogg',
  'menu_back.ogg',
  'fail_sfx.ogg',
  'tutorial_sfx_start.ogg',
  'tutorial_sfx_trigger.ogg',
  'tutorial_sfx_off.ogg',
  'menu_loop.ogg',
] as const;

/**
 * Strip UTF-8 BOM, JSON comments (`//`, `/* ... *\/`), and trailing commas before `}` or `]`
 * while preserving quoted string literals untouched.
 */
export function stripTrailingCommas(raw: string): string {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const out: string[] = [];
  let i = 0;
  const len = text.length;
  let inString = false;
  let escaped = false;

  while (i < len) {
    const ch = text[i];

    if (inString) {
      out.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out.push(ch);
      i += 1;
      continue;
    }

    // Single-line comment
    if (ch === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        i += 1;
      }
      continue;
    }

    // Multi-line block comment
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < len && !(text[i] === '*' && text[i + 1] === '/')) {
        i += 1;
      }
      i += 2;
      continue;
    }

    // Trailing comma lookahead past whitespace & comments
    if (ch === ',') {
      let j = i + 1;
      while (j < len) {
        const next = text[j];
        if (next === ' ' || next === '\t' || next === '\n' || next === '\r') {
          j += 1;
          continue;
        }
        if (next === '/' && text[j + 1] === '/') {
          j += 2;
          while (j < len && text[j] !== '\n' && text[j] !== '\r') j += 1;
          continue;
        }
        if (next === '/' && text[j + 1] === '*') {
          j += 2;
          while (j < len && !(text[j] === '*' && text[j + 1] === '/')) j += 1;
          j += 2;
          continue;
        }
        break;
      }
      if (j < len && (text[j] === '}' || text[j] === ']')) {
        // Drop trailing comma
        i += 1;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join('');
}

/** Parse JSON safely after stripping trailing commas, BOM, and comments. */
export function parseLenientJson<T = unknown>(raw: string): T {
  const sanitized = stripTrailingCommas(raw);
  return JSON.parse(sanitized) as T;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeStringArrayMap(raw: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(val)) {
      const list = val.filter((item): item is string => typeof item === 'string' && item.length > 0);
      if (list.length > 0) result[key] = list;
    } else if (typeof val === 'string' && val.length > 0) {
      result[key] = [val];
    }
  }
  return result;
}

function normalizeDropGroupMap(raw: unknown): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === 'string' && val.length > 0) {
      result[key] = val;
    } else if (Array.isArray(val)) {
      const list = val.filter((item): item is string => typeof item === 'string' && item.length > 0);
      if (list.length > 0) result[key] = list;
    }
  }
  return result;
}

function normalizeGainConfig(raw: unknown, fallback: SoundpackGainConfig): SoundpackGainConfig {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { ...fallback, master: raw };
  }
  if (!raw || typeof raw !== 'object') {
    return { ...fallback };
  }
  const rec = raw as Record<string, unknown>;
  return {
    master: asFiniteNumber(rec.master, fallback.master),
    drop: asFiniteNumber(rec.drop, fallback.drop),
    move: asFiniteNumber(rec.move, fallback.move),
    clear: asFiniteNumber(rec.clear, fallback.clear),
    combo: asFiniteNumber(rec.combo, fallback.combo),
    loop: asFiniteNumber(rec.loop, fallback.loop),
  };
}

/**
 * Parse a retail or custom `data/music/<slug>/data.json` string into a strict
 * `SoundpackManifest`, filling any omitted defaults from the corresponding built-in pack.
 */
export function parseTrackDataJson(rawJson: string, trackId: TrackId): SoundpackManifest {
  const fallback = getSoundpackManifest(trackId);
  const parsed = parseLenientJson<Record<string, unknown>>(rawJson);

  const baseBpm = asFiniteNumber(parsed.bpm ?? parsed.baseBpm, fallback.baseBpm);
  const defaultLength = asFiniteNumber(parsed.length, 16);

  const drop_groups = normalizeDropGroupMap(parsed.drop_groups);
  const move_groups = normalizeStringArrayMap(parsed.move_groups);
  const clear_groups = normalizeStringArrayMap(parsed.clear_groups);
  const combo_groups = normalizeStringArrayMap(parsed.combo_groups);

  const progressions: Record<string, ProgressionSlice[]> = {};
  if (parsed.progressions && typeof parsed.progressions === 'object') {
    for (const [progName, slicesRaw] of Object.entries(parsed.progressions as Record<string, unknown>)) {
      if (!Array.isArray(slicesRaw)) continue;
      const slices: ProgressionSlice[] = [];
      for (const slice of slicesRaw) {
        if (Array.isArray(slice) && slice.length >= 4) {
          slices.push([
            String(slice[0]),
            String(slice[1]),
            String(slice[2]),
            String(slice[3]),
          ]);
        }
      }
      if (slices.length > 0) {
        progressions[progName] = slices;
      }
    }
  }

  const loops: Record<string, SoundpackLoopDef> = {};
  if (parsed.loops && typeof parsed.loops === 'object') {
    for (const [loopName, loopRaw] of Object.entries(parsed.loops as Record<string, unknown>)) {
      if (!loopRaw || typeof loopRaw !== 'object') continue;
      const rec = loopRaw as Record<string, unknown>;
      const audio = typeof rec.audio === 'string' ? rec.audio : `${loopName}.ogg`;
      const loopDef: SoundpackLoopDef = {
        audio,
        bpm: asFiniteNumber(rec.bpm, baseBpm),
        length: asFiniteNumber(rec.length, defaultLength),
      };
      if (rec.progression !== undefined && rec.progression !== null) {
        loopDef.progression = String(rec.progression);
      }
      if (rec.next !== undefined && rec.next !== null) {
        loopDef.next = String(rec.next);
      }
      loops[loopName] = loopDef;
    }
  }

  const title =
    typeof parsed.title === 'string' && parsed.title.trim().length > 0
      ? parsed.title.trim()
      : typeof parsed.name === 'string' && parsed.name.trim().length > 0
        ? parsed.name.trim()
        : fallback.title;

  const author =
    typeof parsed.author === 'string' && parsed.author.trim().length > 0
      ? parsed.author.trim()
      : typeof parsed.artist === 'string' && parsed.artist.trim().length > 0
        ? parsed.artist.trim()
        : fallback.author;

  const rawMode = parsed.mode;
  const mode: 'standard' | 'rush' | 'both' =
    rawMode === 'standard' || rawMode === 'rush' || rawMode === 'both' ? rawMode : fallback.mode;

  return {
    id: trackId,
    title,
    author,
    mode,
    baseBpm,
    gain: normalizeGainConfig(parsed.gain, fallback.gain),
    drop_groups: Object.keys(drop_groups).length > 0 ? drop_groups : fallback.drop_groups,
    move_groups: Object.keys(move_groups).length > 0 ? move_groups : fallback.move_groups,
    clear_groups: Object.keys(clear_groups).length > 0 ? clear_groups : fallback.clear_groups,
    combo_groups: Object.keys(combo_groups).length > 0 ? combo_groups : fallback.combo_groups,
    progressions: Object.keys(progressions).length > 0 ? progressions : fallback.progressions,
    loops: Object.keys(loops).length > 0 ? loops : fallback.loops,
  };
}

/** Collect every unique audio cue reference listed in a SoundpackManifest. */
export function collectManifestAudioRefs(manifest: SoundpackManifest): string[] {
  const refs = new Set<string>();
  for (const loop of Object.values(manifest.loops)) {
    if (loop.audio && !loop.audio.startsWith('synth:')) refs.add(loop.audio);
  }
  for (const drop of Object.values(manifest.drop_groups)) {
    const items = Array.isArray(drop) ? drop : [drop];
    for (const item of items) {
      if (item && !item.startsWith('synth:')) refs.add(item);
    }
  }
  for (const group of [manifest.move_groups, manifest.clear_groups, manifest.combo_groups]) {
    for (const items of Object.values(group)) {
      for (const item of items) {
        if (item && !item.startsWith('synth:')) refs.add(item);
      }
    }
  }
  return [...refs];
}

function normalizeAudioKey(ref: string): string {
  return ref.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function extractBasename(ref: string): string {
  const norm = normalizeAudioKey(ref);
  const slash = norm.lastIndexOf('/');
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

function stripAudioExtension(name: string): string {
  return name.replace(/\.(ogg|wav|mp3|flac|m4a)$/i, '');
}

function ensureOggFilename(ref: string): string {
  return /\.(ogg|wav|mp3|flac|m4a)$/i.test(ref) ? ref : `${ref}.ogg`;
}

/** Store a decoded AudioBuffer under multiple normalized lookup keys for reliable matching. */
export function indexDecodedBuffer(
  map: Map<string, AudioBuffer>,
  cueRef: string,
  buffer: AudioBuffer,
): void {
  const norm = normalizeAudioKey(cueRef);
  const base = extractBasename(norm);
  const stem = stripAudioExtension(base);
  map.set(cueRef, buffer);
  map.set(norm, buffer);
  map.set(base, buffer);
  map.set(stem, buffer);
  map.set(`${stem}.ogg`, buffer);
}

/** Resolve a decoded AudioBuffer by cue ref, basename, or extensionless stem. */
export function resolveAudioBuffer(
  buffers: ReadonlyMap<string, AudioBuffer> | null | undefined,
  cueRef: string | null | undefined,
): AudioBuffer | null {
  if (!buffers || !cueRef) return null;
  const direct = buffers.get(cueRef);
  if (direct) return direct;
  const norm = normalizeAudioKey(cueRef);
  const byNorm = buffers.get(norm);
  if (byNorm) return byNorm;
  const base = extractBasename(norm);
  const byBase = buffers.get(base);
  if (byBase) return byBase;
  const stem = stripAudioExtension(base);
  return buffers.get(stem) ?? buffers.get(`${stem}.ogg`) ?? null;
}

async function safeDecodeAudio(
  ctx: BaseAudioContext | null,
  rawBuffer: ArrayBuffer,
): Promise<AudioBuffer | null> {
  if (!ctx || typeof ctx.decodeAudioData !== 'function') return null;
  try {
    // Copy via slice(0) because Web Audio detaches the transferred ArrayBuffer.
    return await ctx.decodeAudioData(rawBuffer.slice(0));
  } catch {
    return null;
  }
}

async function safeFetchArrayBuffer(url: string): Promise<ArrayBuffer | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

async function safeFetchText(url: string): Promise<string | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function joinUrl(base: string, rel: string): string {
  const cleanBase = base.replace(/\/+$/, '');
  const cleanRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${cleanBase}/${cleanRel}`;
}

function buildNormalizedBlobIndex(files: ReadonlyMap<string, ArrayBuffer>): Map<string, ArrayBuffer> {
  const index = new Map<string, ArrayBuffer>();
  for (const [key, buf] of files.entries()) {
    const norm = normalizeAudioKey(key);
    index.set(key, buf);
    index.set(norm, buf);
  }
  return index;
}

function findBlobForTrackRef(
  blobIndex: ReadonlyMap<string, ArrayBuffer>,
  trackId: TrackId,
  cueRef: string,
  trackDirPrefix?: string,
): ArrayBuffer | null {
  const filename = ensureOggFilename(cueRef);
  const candidates = [
    cueRef,
    filename,
    trackDirPrefix ? `${trackDirPrefix}/${cueRef}` : '',
    trackDirPrefix ? `${trackDirPrefix}/${filename}` : '',
    `music/${trackId}/${cueRef}`,
    `music/${trackId}/${filename}`,
    `data/music/${trackId}/${cueRef}`,
    `data/music/${trackId}/${filename}`,
    `${trackId}/${cueRef}`,
    `${trackId}/${filename}`,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const norm = normalizeAudioKey(candidate);
    const hit = blobIndex.get(candidate) ?? blobIndex.get(norm);
    if (hit) return hit;
  }

  // Fallback suffix search scoped to trackId folder
  const targetBase = extractBasename(filename);
  const scopedSuffix = `/${trackId}/${targetBase}`;
  for (const [key, buf] of blobIndex.entries()) {
    const norm = normalizeAudioKey(key);
    if (norm.endsWith(scopedSuffix) || norm === `${trackId}/${targetBase}`) {
      return buf;
    }
  }
  return null;
}

/**
 * Load a single track's custom manifest and decode all referenced `.ogg` audio files
 * from a URL root (default `/__lumia_assets__`). Never throws on missing/corrupt files.
 */
export async function loadCustomTrackFromUrl(
  ctx: BaseAudioContext | null,
  trackId: TrackId,
  baseUrl = '/__lumia_assets__',
  dataFileRel?: string,
): Promise<CustomTrackAudioPack | null> {
  const relCandidates = dataFileRel
    ? [dataFileRel]
    : [`music/${trackId}/data.json`, `data/music/${trackId}/data.json`];

  let rawJson: string | null = null;
  let resolvedDataRel = relCandidates[0];
  for (const rel of relCandidates) {
    const text = await safeFetchText(joinUrl(baseUrl, rel));
    if (text !== null) {
      rawJson = text;
      resolvedDataRel = rel;
      break;
    }
  }

  if (rawJson === null) return null;

  let manifest: SoundpackManifest;
  try {
    manifest = parseTrackDataJson(rawJson, trackId);
  } catch {
    return null;
  }

  const dirSlash = resolvedDataRel.replace(/\\/g, '/').lastIndexOf('/');
  const trackDir = dirSlash >= 0 ? resolvedDataRel.slice(0, dirSlash) : `music/${trackId}`;
  const refs = collectManifestAudioRefs(manifest);
  const buffers = new Map<string, AudioBuffer>();
  const missingFiles: string[] = [];

  await Promise.all(
    refs.map(async (ref) => {
      const filename = ensureOggFilename(ref);
      const url = joinUrl(baseUrl, `${trackDir}/${filename}`);
      const arrayBuf = await safeFetchArrayBuffer(url);
      if (!arrayBuf) {
        missingFiles.push(ref);
        return;
      }
      const decoded = await safeDecodeAudio(ctx, arrayBuf);
      if (!decoded) {
        missingFiles.push(ref);
        return;
      }
      indexDecodedBuffer(buffers, ref, decoded);
    }),
  );

  return { trackId, manifest, buffers, missingFiles };
}

/**
 * Load a single track's custom manifest and decode referenced `.ogg` blobs from an
 * in-memory `Map<string, ArrayBuffer>` (IndexedDB / browser-uploaded pack).
 * Never throws on missing or undecodable entries.
 */
export async function loadCustomTrackFromBuffers(
  ctx: BaseAudioContext | null,
  trackId: TrackId,
  files: ReadonlyMap<string, ArrayBuffer>,
  dataFileKey?: string,
): Promise<CustomTrackAudioPack | null> {
  const blobIndex = buildNormalizedBlobIndex(files);
  const keyCandidates = [
    ...(dataFileKey ? [dataFileKey] : []),
    `music/${trackId}/data.json`,
    `data/music/${trackId}/data.json`,
    `${trackId}/data.json`,
  ];

  let jsonBytes: ArrayBuffer | null = null;
  let matchedKey = '';
  for (const key of keyCandidates) {
    const hit = blobIndex.get(key) ?? blobIndex.get(normalizeAudioKey(key));
    if (hit) {
      jsonBytes = hit;
      matchedKey = normalizeAudioKey(key);
      break;
    }
  }

  if (!jsonBytes) {
    const suffix = `/${trackId}/data.json`;
    for (const [key, buf] of blobIndex.entries()) {
      const norm = normalizeAudioKey(key);
      if (norm.endsWith(suffix)) {
        jsonBytes = buf;
        matchedKey = norm;
        break;
      }
    }
  }

  if (!jsonBytes) return null;

  let manifest: SoundpackManifest;
  try {
    const rawJson = new TextDecoder('utf-8').decode(new Uint8Array(jsonBytes));
    manifest = parseTrackDataJson(rawJson, trackId);
  } catch {
    return null;
  }

  const slashIdx = matchedKey.lastIndexOf('/');
  const trackDir = slashIdx >= 0 ? matchedKey.slice(0, slashIdx) : `music/${trackId}`;
  const refs = collectManifestAudioRefs(manifest);
  const buffers = new Map<string, AudioBuffer>();
  const missingFiles: string[] = [];

  await Promise.all(
    refs.map(async (ref) => {
      const bytes = findBlobForTrackRef(blobIndex, trackId, ref, trackDir);
      if (!bytes) {
        missingFiles.push(ref);
        return;
      }
      const decoded = await safeDecodeAudio(ctx, bytes);
      if (!decoded) {
        missingFiles.push(ref);
        return;
      }
      indexDecodedBuffer(buffers, ref, decoded);
    }),
  );

  return { trackId, manifest, buffers, missingFiles };
}

/** Load custom menu audio files from a URL base. Missing files are recorded silently. */
export async function loadCustomMenuAudioFromUrl(
  ctx: BaseAudioContext | null,
  baseUrl = '/__lumia_assets__',
  menuFiles: readonly string[] = DEFAULT_MENU_AUDIO_FILES,
): Promise<{ menuBuffers: Map<string, AudioBuffer>; missingMenuFiles: string[] }> {
  const menuBuffers = new Map<string, AudioBuffer>();
  const missingMenuFiles: string[] = [];

  await Promise.all(
    menuFiles.map(async (file) => {
      const candidates = file.includes('/')
        ? [file]
        : [`audio/${file}`, `menu/${file}`, `sfx/${file}`, file];
      let decoded: AudioBuffer | null = null;
      for (const rel of candidates) {
        const bytes = await safeFetchArrayBuffer(joinUrl(baseUrl, rel));
        if (!bytes) continue;
        decoded = await safeDecodeAudio(ctx, bytes);
        if (decoded) break;
      }
      if (decoded) {
        indexDecodedBuffer(menuBuffers, file, decoded);
      } else {
        missingMenuFiles.push(file);
      }
    }),
  );

  return { menuBuffers, missingMenuFiles };
}

/** Load custom menu audio files from an in-memory blob map. Missing files are recorded silently. */
export async function loadCustomMenuAudioFromBuffers(
  ctx: BaseAudioContext | null,
  files: ReadonlyMap<string, ArrayBuffer>,
  menuFiles: readonly string[] = DEFAULT_MENU_AUDIO_FILES,
): Promise<{ menuBuffers: Map<string, AudioBuffer>; missingMenuFiles: string[] }> {
  const blobIndex = buildNormalizedBlobIndex(files);
  const menuBuffers = new Map<string, AudioBuffer>();
  const missingMenuFiles: string[] = [];

  await Promise.all(
    menuFiles.map(async (file) => {
      const base = extractBasename(ensureOggFilename(file));
      let bytes: ArrayBuffer | null =
        blobIndex.get(file) ??
        blobIndex.get(normalizeAudioKey(file)) ??
        blobIndex.get(base) ??
        blobIndex.get(`audio/${base}`) ??
        blobIndex.get(`menu/${base}`) ??
        blobIndex.get(`sfx/${base}`) ??
        null;

      if (!bytes) {
        for (const [key, buf] of blobIndex.entries()) {
          const norm = normalizeAudioKey(key);
          if (norm.endsWith(`/${base}`)) {
            bytes = buf;
            break;
          }
        }
      }

      if (!bytes) {
        missingMenuFiles.push(file);
        return;
      }
      const decoded = await safeDecodeAudio(ctx, bytes);
      if (!decoded) {
        missingMenuFiles.push(file);
        return;
      }
      indexDecodedBuffer(menuBuffers, file, decoded);
    }),
  );

  return { menuBuffers, missingMenuFiles };
}

/**
 * Load an entire CustomAudioPack (menu SFX + all available tracks) from a URL root.
 * Never throws; any missing or undecodable audio file falls back cleanly to built-in synthesis.
 */
export async function loadCustomAudioPackFromUrl(
  ctx: BaseAudioContext | null,
  packManifest?: CustomPackManifest | null,
  baseUrl = '/__lumia_assets__',
): Promise<CustomAudioPack> {
  const menuFiles =
    packManifest?.menuAudioFiles && packManifest.menuAudioFiles.length > 0
      ? packManifest.menuAudioFiles
      : DEFAULT_MENU_AUDIO_FILES;

  const { menuBuffers, missingMenuFiles } = await loadCustomMenuAudioFromUrl(ctx, baseUrl, menuFiles);
  const tracks: Partial<Record<TrackId, CustomTrackAudioPack>> = {};

  await Promise.all(
    ALL_TRACK_IDS.map(async (trackId) => {
      const dataFile = packManifest?.tracks?.[trackId]?.dataFile;
      const loaded = await loadCustomTrackFromUrl(ctx, trackId, baseUrl, dataFile);
      if (loaded) {
        tracks[trackId] = loaded;
      }
    }),
  );

  return {
    source: 'url',
    baseUrl,
    tracks,
    menuBuffers,
    missingMenuFiles,
  };
}

/**
 * Load an entire CustomAudioPack from in-memory ArrayBuffer blobs (browser upload / IndexedDB).
 * Never throws; missing or undecodable entries fall back silently to built-in procedural audio.
 */
export async function loadCustomAudioPackFromBuffers(
  ctx: BaseAudioContext | null,
  files: ReadonlyMap<string, ArrayBuffer>,
  packManifest?: CustomPackManifest | null,
): Promise<CustomAudioPack> {
  const menuFiles =
    packManifest?.menuAudioFiles && packManifest.menuAudioFiles.length > 0
      ? packManifest.menuAudioFiles
      : DEFAULT_MENU_AUDIO_FILES;

  const { menuBuffers, missingMenuFiles } = await loadCustomMenuAudioFromBuffers(ctx, files, menuFiles);
  const tracks: Partial<Record<TrackId, CustomTrackAudioPack>> = {};

  await Promise.all(
    ALL_TRACK_IDS.map(async (trackId) => {
      const dataFile = packManifest?.tracks?.[trackId]?.dataFile;
      const loaded = await loadCustomTrackFromBuffers(ctx, trackId, files, dataFile);
      if (loaded) {
        tracks[trackId] = loaded;
      }
    }),
  );

  return {
    source: 'memory',
    tracks,
    menuBuffers,
    missingMenuFiles,
  };
}
