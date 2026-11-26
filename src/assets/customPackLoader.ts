/**
 * Krunked Lumia — GameMaker `data.win` Parser & Browser Custom Pack Loader
 *
 * Works in BOTH Node and Browser environments — ZERO Node-only imports!
 * - `parseDataWin(...)` parses GameMaker IFF `FORM` chunks (`GEN8`, `SPRT`, `TPAG`, `FONT`,
 *   `SHDR`, `STRG`, `TXTR`), decodes `TXTR[0]` via `decode2zoqTexture`, and resolves all
 *   sprite frame rectangles (`block_spr`, `container_spr`, and all 97 retail sprites).
 * - `loadCustomPackFromBrowserFiles(...)` accepts either a raw retail Mixolumia folder
 *   (`data.win` + `data/...`) OR an extracted `.lumia-assets/` folder (`manifest.json` +
 *   `atlas.png` + `...`) and produces a unified `LoadedCustomPack` ready for IndexedDB
 *   caching and live hot-swapping into `WebGL2Renderer` and `HarmonicAudioEngine`.
 */

import {
  ALL_TRACK_IDS,
  type CustomPackManifest,
  type Palette,
  type SpriteAssetEntry,
  type SpriteFrameRect,
  type TrackId,
} from '../contracts/index.js';
import { parseLenientJson } from '../audio/customAudioLoader.js';
import { parsePalettesIni } from '../data/palettes.js';
import {
  decode2zoqTexture,
  decodeGmQoi,
  type DecodedImage,
} from './qoiDecoder.js';

export interface ParsedDataWin {
  atlasWidth: number;
  atlasHeight: number;
  atlasPixels: Uint8Array;
  sprites: Record<string, SpriteAssetEntry>;
  spriteCount: number;
  tpagCount: number;
  shaderNames: string[];
  fontNames: string[];
  gameName: string;
}

export interface TracklistJson {
  standard: string[];
  rush: string[];
}

export interface LoadedCustomPack {
  source: 'local-url' | 'browser-uploaded' | 'idb-cache';
  manifest: CustomPackManifest;
  atlasWidth: number;
  atlasHeight: number;
  atlasPixels: Uint8Array;
  sprites: Record<string, SpriteAssetEntry>;
  palettes: Palette[];
  palettesIniText: string | null;
  tracklist: TracklistJson | null;
  covers: Partial<Record<TrackId, DecodedImage>>;
  coverPngBytes: Partial<Record<TrackId, ArrayBuffer>>;
  audioFiles: Map<string, ArrayBuffer>;
  localizationCsv: string | null;
}

interface IffChunk {
  name: string;
  offset: number; // start of chunk payload (after 8-byte name+size header)
  size: number;
}

const UTF8_DECODER = new TextDecoder('utf-8');
const TRACK_ID_SET: ReadonlySet<string> = new Set<string>(ALL_TRACK_IDS);

function isTrackId(slug: string): slug is TrackId {
  return TRACK_ID_SET.has(slug);
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, offset + length);
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function readCString(bytes: Uint8Array, offset: number): string {
  if (offset <= 0 || offset >= bytes.length) return '';
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) {
    end++;
  }
  return UTF8_DECODER.decode(bytes.subarray(offset, end));
}

function parseTpagRect(view: DataView, ptr: number): SpriteFrameRect {
  return {
    x: view.getUint16(ptr, true),
    y: view.getUint16(ptr + 2, true),
    w: view.getUint16(ptr + 4, true),
    h: view.getUint16(ptr + 6, true),
    targetX: view.getUint16(ptr + 8, true),
    targetY: view.getUint16(ptr + 10, true),
    targetW: view.getUint16(ptr + 12, true),
    targetH: view.getUint16(ptr + 14, true),
    boundW: view.getUint16(ptr + 16, true),
    boundH: view.getUint16(ptr + 18, true),
  };
}

function findTxtrBlobOffset(
  bytes: Uint8Array,
  view: DataView,
  entryPtr: number,
  txtrStart: number,
  txtrEnd: number,
): { offset: number; format: '2zoq' | 'fioq' } | null {
  // GMS 2.0.6+ stores [scaled, generatedMips, blobOffset] (+8);
  // GMS 2022.3+ may store blobOffset at +12; GMS1 stores [scaled, blobOffset] (+4).
  const fieldOffsets = [8, 12, 4, 16];
  for (const fieldOff of fieldOffsets) {
    if (entryPtr + fieldOff + 4 > bytes.length) continue;
    const candidate = view.getUint32(entryPtr + fieldOff, true);
    if (candidate >= txtrStart && candidate + 12 <= txtrEnd) {
      const magic = readAscii(bytes, candidate, 4);
      if (magic === '2zoq' || magic === 'fioq') {
        return { offset: candidate, format: magic };
      }
    }
  }
  return null;
}

function parseNamedChunkEntries(
  bytes: Uint8Array,
  view: DataView,
  chunk: IffChunk | undefined,
): string[] {
  if (!chunk || chunk.size < 4) return [];
  const count = view.getUint32(chunk.offset, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const ptrOff = chunk.offset + 4 + i * 4;
    if (ptrOff + 4 > bytes.length) break;
    const entryPtr = view.getUint32(ptrOff, true);
    if (entryPtr + 4 > bytes.length) continue;
    const namePtr = view.getUint32(entryPtr, true);
    const name = readCString(bytes, namePtr);
    if (name) names.push(name);
  }
  return names;
}

/**
 * Parses a GameMaker Studio `data.win` IFF `FORM` archive in pure TypeScript.
 * Decodes `TXTR[0]` (`2zoq` or `fioq`), resolves every `TPAG` entry, and extracts
 * all `SPRT` entries (`block_spr`, `container_spr`, and all retail sprites).
 */
export function parseDataWin(buffer: ArrayBuffer | Uint8Array): ParsedDataWin {
  const bytes = toUint8Array(buffer);
  if (bytes.length < 16) {
    throw new Error('data.win buffer too short');
  }
  if (readAscii(bytes, 0, 4) !== 'FORM') {
    throw new Error('Invalid data.win header (expected IFF "FORM")');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formSize = view.getUint32(4, true);
  const formEnd = Math.min(bytes.length, 8 + formSize);

  const chunks = new Map<string, IffChunk>();
  let cursor = 8;
  while (cursor + 8 <= formEnd) {
    const name = readAscii(bytes, cursor, 4);
    const size = view.getUint32(cursor + 4, true);
    const payloadOffset = cursor + 8;
    chunks.set(name, { name, offset: payloadOffset, size });
    cursor = payloadOffset + size;
  }

  // 1. GEN8 metadata
  let gameName = '';
  const gen8 = chunks.get('GEN8');
  if (gen8 && gen8.size >= 44) {
    const namePtr = view.getUint32(gen8.offset + 40, true);
    gameName = readCString(bytes, namePtr);
  }

  // 2. TXTR[0] texture page decode
  const txtr = chunks.get('TXTR');
  if (!txtr || txtr.size < 8) {
    throw new Error('data.win missing TXTR chunk');
  }
  const txtrEnd = Math.min(bytes.length, txtr.offset + txtr.size);
  const txCount = view.getUint32(txtr.offset, true);
  if (txCount < 1) {
    throw new Error('data.win TXTR chunk contains zero textures');
  }

  const tx0Ptr = view.getUint32(txtr.offset + 4, true);
  const blobInfo = findTxtrBlobOffset(bytes, view, tx0Ptr, txtr.offset, txtrEnd);
  if (!blobInfo) {
    throw new Error('Could not locate 2zoq or fioq texture payload in TXTR[0]');
  }

  let blobEnd = txtrEnd;
  if (txCount > 1) {
    const tx1Ptr = view.getUint32(txtr.offset + 8, true);
    const nextBlob = findTxtrBlobOffset(bytes, view, tx1Ptr, txtr.offset, txtrEnd);
    if (nextBlob && nextBlob.offset > blobInfo.offset) {
      blobEnd = nextBlob.offset;
    }
  }

  const txBlob = bytes.subarray(blobInfo.offset, blobEnd);
  const decodedAtlas =
    blobInfo.format === '2zoq' ? decode2zoqTexture(txBlob) : decodeGmQoi(txBlob);

  // 3. TPAG table (10 uint16LE rect fields = 20 bytes + 2-byte texturePageId)
  const tpag = chunks.get('TPAG');
  if (!tpag || tpag.size < 4) {
    throw new Error('data.win missing TPAG chunk');
  }
  const tpagCount = view.getUint32(tpag.offset, true);
  const tpagByPtr = new Map<number, SpriteFrameRect>();
  for (let i = 0; i < tpagCount; i++) {
    const ptr = view.getUint32(tpag.offset + 4 + i * 4, true);
    if (ptr > 0 && ptr + 20 <= bytes.length) {
      tpagByPtr.set(ptr, parseTpagRect(view, ptr));
    }
  }

  // 4. SPRT table (all retail sprites)
  const sprt = chunks.get('SPRT');
  if (!sprt || sprt.size < 4) {
    throw new Error('data.win missing SPRT chunk');
  }
  const sprtCount = view.getUint32(sprt.offset, true);
  const sprites: Record<string, SpriteAssetEntry> = {};

  for (let i = 0; i < sprtCount; i++) {
    const p = view.getUint32(sprt.offset + 4 + i * 4, true);
    if (p === 0 || p + 60 > bytes.length) continue;

    const namePtr = view.getUint32(p, true);
    const name = readCString(bytes, namePtr);
    if (!name) continue;

    const width = view.getUint32(p + 4, true);
    const height = view.getUint32(p + 8, true);
    const originX = view.getInt32(p + 48, true);
    const originY = view.getInt32(p + 52, true);

    let pos = p + 56;
    const marker = view.getInt32(pos, true);
    if (marker === -1) {
      // GMS 2.x extended sprite header
      const sVersion = view.getUint32(pos + 4, true);
      pos += 20; // marker(-1), sVersion, spriteType, playbackSpeed, playbackSpeedType
      if (sVersion >= 2) pos += 4; // sequenceOffset
      if (sVersion >= 3) pos += 4; // nineSliceOffset
    }

    if (pos + 4 > bytes.length) continue;
    const frameCount = view.getUint32(pos, true);
    const frames: SpriteFrameRect[] = [];
    for (let f = 0; f < frameCount; f++) {
      const fPtrOff = pos + 4 + f * 4;
      if (fPtrOff + 4 > bytes.length) break;
      const tpagPtr = view.getUint32(fPtrOff, true);
      if (tpagPtr === 0) continue;
      const cached = tpagByPtr.get(tpagPtr);
      if (cached) {
        frames.push({ ...cached });
      } else if (tpagPtr + 20 <= bytes.length) {
        frames.push(parseTpagRect(view, tpagPtr));
      }
    }

    sprites[name] = {
      name,
      width,
      height,
      originX,
      originY,
      frames,
    };
  }

  // 5. SHDR & FONT names
  const shaderNames = parseNamedChunkEntries(bytes, view, chunks.get('SHDR'));
  const fontNames = parseNamedChunkEntries(bytes, view, chunks.get('FONT'));

  return {
    atlasWidth: decodedAtlas.width,
    atlasHeight: decodedAtlas.height,
    atlasPixels: decodedAtlas.pixels,
    sprites,
    spriteCount: Object.keys(sprites).length,
    tpagCount,
    shaderNames,
    fontNames,
    gameName,
  };
}

// ============================================================================
// BROWSER PNG DECODING HELPER (Zero Node-only deps, safe in headless)
// ============================================================================

/**
 * Decodes PNG bytes into raw RGBA8888 pixels using browser Canvas/ImageBitmap APIs.
 * Returns `null` cleanly in headless Node environments where browser image decoding isn't present.
 */
export async function decodePngBytesToRgba(
  pngBytes: ArrayBuffer | Uint8Array,
): Promise<DecodedImage | null> {
  if (typeof Blob === 'undefined') {
    return null;
  }

  const copy = new Uint8Array(pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes));
  const blob = new Blob([copy], { type: 'image/png' });

  // Fast path: createImageBitmap + OffscreenCanvas or HTMLCanvasElement
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(blob);
      const width = bitmap.width;
      const height = bitmap.height;

      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          const imageData = ctx.getImageData(0, 0, width, height);
          return {
            width,
            height,
            pixels: new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength).slice(),
          };
        }
      }

      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          const imageData = ctx.getImageData(0, 0, width, height);
          return {
            width,
            height,
            pixels: new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength).slice(),
          };
        }
      }
    } catch {
      return null;
    } finally {
      bitmap?.close();
    }
  }

  // Fallback path: Image element + URL.createObjectURL
  if (typeof Image !== 'undefined' && typeof document !== 'undefined' && typeof URL !== 'undefined') {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Failed to decode PNG image'));
        el.src = url;
      });
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      return {
        width,
        height,
        pixels: new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength).slice(),
      };
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return null;
}

// ============================================================================
// BROWSER FOLDER / FILELIST CUSTOM PACK LOADER
// ============================================================================

interface NormalizedFileEntry {
  relPath: string; // normalized lowercase forward-slash path relative to pack root
  originalPath: string;
  file: File;
}

function getRawRelativePath(file: File): string {
  const withRel = file as File & { webkitRelativePath?: string };
  const raw =
    typeof withRel.webkitRelativePath === 'string' && withRel.webkitRelativePath.length > 0
      ? withRel.webkitRelativePath
      : file.name;
  return raw.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Normalizes a directory upload's relative paths so BOTH:
 * - Raw retail directory (`Mixolumia/data.win`, `Mixolumia/data/palettes.ini`, `Mixolumia/data/music/...`)
 * - Extracted `.lumia-assets/` directory (`.lumia-assets/manifest.json`, `.lumia-assets/atlas.png`, `.lumia-assets/music/...`)
 * resolve to identical canonical paths (`data.win`, `atlas.png`, `palettes.ini`, `music/<slug>/...`, `audio/...`).
 */
function normalizeUploadedFiles(files: FileList | File[]): NormalizedFileEntry[] {
  const arr = Array.from(files);
  const rawPaths = arr.map(getRawRelativePath);

  // If every file shares a single top-level directory (standard webkitdirectory upload), strip it
  let sharedPrefix = '';
  if (rawPaths.length > 0 && rawPaths.every((p) => p.includes('/'))) {
    const firstRoot = rawPaths[0].slice(0, rawPaths[0].indexOf('/') + 1);
    if (firstRoot.length > 1 && rawPaths.every((p) => p.startsWith(firstRoot))) {
      sharedPrefix = firstRoot;
    }
  }

  return arr.map((file, idx) => {
    let rel = rawPaths[idx];
    if (sharedPrefix && rel.startsWith(sharedPrefix)) {
      rel = rel.slice(sharedPrefix.length);
    }
    const lower = rel.toLowerCase();
    // Collapse retail `data/` prefix into canonical pack-root layout
    const canonical = lower.startsWith('data/') ? lower.slice(5) : lower;
    return {
      relPath: canonical,
      originalPath: rel,
      file,
    };
  });
}

function parseTracklistSafely(rawText: string): TracklistJson | null {
  try {
    const parsed = parseLenientJson<Record<string, unknown>>(rawText);
    const standard = Array.isArray(parsed.standard)
      ? parsed.standard.filter((v): v is string => typeof v === 'string')
      : [];
    const rush = Array.isArray(parsed.rush)
      ? parsed.rush.filter((v): v is string => typeof v === 'string')
      : [];
    return { standard, rush };
  } catch {
    return null;
  }
}

/**
 * Loads a complete custom pack from a browser directory selection (`<input webkitdirectory>` or File[]).
 * Supports BOTH:
 * 1. Raw retail Mixolumia folder (`data.win` + `data/palettes.ini` + `data/music/...` + `data/audio/...`)
 * 2. Pre-extracted `.lumia-assets/` folder (`manifest.json` + `atlas.png` + `sprites.json` + ...)
 */
export async function loadCustomPackFromBrowserFiles(
  files: FileList | File[],
): Promise<LoadedCustomPack> {
  const entries = normalizeUploadedFiles(files);
  if (entries.length === 0) {
    throw new Error('No files selected');
  }

  const byPath = new Map<string, NormalizedFileEntry>();
  for (const entry of entries) {
    byPath.set(entry.relPath, entry);
  }

  // 1. Decode sprite atlas + sprite metadata (prefer live in-browser data.win decode if present!)
  let atlasWidth = 0;
  let atlasHeight = 0;
  let atlasPixels: Uint8Array = new Uint8Array(0);
  let sprites: Record<string, SpriteAssetEntry> = {};

  const existingManifestEntry = byPath.get('manifest.json');
  let existingManifest: CustomPackManifest | null = null;
  if (existingManifestEntry) {
    try {
      const txt = await existingManifestEntry.file.text();
      existingManifest = parseLenientJson<CustomPackManifest>(txt);
      if (existingManifest?.sprites) {
        sprites = existingManifest.sprites;
      }
      if (existingManifest?.atlasWidth && existingManifest?.atlasHeight) {
        atlasWidth = existingManifest.atlasWidth;
        atlasHeight = existingManifest.atlasHeight;
      }
    } catch {
      existingManifest = null;
    }
  }

  const spritesJsonEntry = byPath.get('sprites.json');
  if (spritesJsonEntry && Object.keys(sprites).length === 0) {
    try {
      const txt = await spritesJsonEntry.file.text();
      sprites = parseLenientJson<Record<string, SpriteAssetEntry>>(txt);
    } catch {
      // Ignore malformed sprites.json if data.win is also present
    }
  }

  const dataWinEntry = byPath.get('data.win');
  if (dataWinEntry) {
    const buf = await dataWinEntry.file.arrayBuffer();
    const parsed = parseDataWin(buf);
    atlasWidth = parsed.atlasWidth;
    atlasHeight = parsed.atlasHeight;
    atlasPixels = parsed.atlasPixels;
    sprites = parsed.sprites;
  } else {
    const atlasFileName = existingManifest?.atlasFile?.toLowerCase() ?? 'atlas.png';
    const atlasPngEntry = byPath.get(atlasFileName) ?? byPath.get('atlas.png');
    if (atlasPngEntry) {
      const pngBuf = await atlasPngEntry.file.arrayBuffer();
      const decoded = await decodePngBytesToRgba(pngBuf);
      if (decoded) {
        atlasWidth = decoded.width;
        atlasHeight = decoded.height;
        atlasPixels = decoded.pixels;
      } else if (existingManifest) {
        atlasWidth = existingManifest.atlasWidth;
        atlasHeight = existingManifest.atlasHeight;
      }
    }
  }

  // 2. Parse palettes.ini
  let palettes: Palette[] = [];
  let palettesIniText: string | null = null;
  const palettesEntry = byPath.get('palettes.ini');
  if (palettesEntry) {
    palettesIniText = await palettesEntry.file.text();
    palettes = parsePalettesIni(palettesIniText);
  }

  // 3. Parse tracklist.json
  let tracklist: TracklistJson | null = null;
  const tracklistEntry = byPath.get('tracklist.json');
  if (tracklistEntry) {
    tracklist = parseTracklistSafely(await tracklistEntry.file.text());
  }

  // 4. Localization CSV
  let localizationCsv: string | null = null;
  let localizationFile: string | null = null;
  const locEntry =
    byPath.get('localization/en_us.csv') ??
    entries.find((e) => e.relPath.startsWith('localization/') && e.relPath.endsWith('.csv'));
  if (locEntry) {
    localizationCsv = await locEntry.file.text();
    localizationFile = locEntry.relPath;
  }

  // 5. Menu audio `.ogg` files + per-track `data.json`, `cover.png`, and `.ogg` files
  const audioFiles = new Map<string, ArrayBuffer>();
  const menuAudioFiles: string[] = [];
  const covers: Partial<Record<TrackId, DecodedImage>> = {};
  const coverPngBytes: Partial<Record<TrackId, ArrayBuffer>> = {};
  const manifestTracks: CustomPackManifest['tracks'] = {};

  const ensureTrackRecord = (slug: string) => {
    if (!manifestTracks[slug]) {
      manifestTracks[slug] = {
        dataFile: `music/${slug}/data.json`,
        coverFile: null,
        audioFiles: [],
      };
    }
    return manifestTracks[slug];
  };

  for (const entry of entries) {
    const p = entry.relPath;

    // Menu audio under audio/*.ogg
    if (p.startsWith('audio/') && /\.(ogg|wav)$/i.test(p)) {
      const buf = await entry.file.arrayBuffer();
      audioFiles.set(p, buf);
      menuAudioFiles.push(p);
      continue;
    }

    // Track assets under music/<slug>/...
    const musicMatch = p.match(/^music\/([^/]+)\/(.+)$/);
    if (musicMatch) {
      const slug = musicMatch[1];
      const subFile = musicMatch[2];
      const rec = ensureTrackRecord(slug);

      if (subFile === 'data.json') {
        const buf = await entry.file.arrayBuffer();
        audioFiles.set(p, buf);
        rec.dataFile = p;
      } else if (subFile === 'cover.png') {
        const buf = await entry.file.arrayBuffer();
        rec.coverFile = p;
        if (isTrackId(slug)) {
          coverPngBytes[slug] = buf;
          const decodedCover = await decodePngBytesToRgba(buf);
          if (decodedCover) {
            covers[slug] = decodedCover;
          }
        }
      } else if (/\.(ogg|wav)$/i.test(subFile)) {
        const buf = await entry.file.arrayBuffer();
        audioFiles.set(p, buf);
        rec.audioFiles.push(p);
      }
    }
  }

  menuAudioFiles.sort();
  for (const rec of Object.values(manifestTracks)) {
    rec.audioFiles.sort();
  }

  const hasAnyAsset =
    atlasPixels.length > 0 ||
    Object.keys(sprites).length > 0 ||
    palettes.length > 0 ||
    audioFiles.size > 0;

  if (!hasAnyAsset) {
    throw new Error(
      'No compatible pack assets found (expected data.win or manifest.json / palettes.ini / music/)',
    );
  }

  const manifest: CustomPackManifest = {
    version: 1,
    source: 'browser-uploaded',
    extractedAt: new Date().toISOString(),
    atlasWidth,
    atlasHeight,
    atlasFile: 'atlas.png',
    sprites,
    paletteCount: palettes.length,
    palettesFile: 'palettes.ini',
    tracklistFile: 'tracklist.json',
    tracks: manifestTracks,
    menuAudioFiles,
    localizationFile,
  };

  return {
    source: 'browser-uploaded',
    manifest,
    atlasWidth,
    atlasHeight,
    atlasPixels,
    sprites,
    palettes,
    palettesIniText,
    tracklist,
    covers,
    coverPngBytes,
    audioFiles,
    localizationCsv,
  };
}
