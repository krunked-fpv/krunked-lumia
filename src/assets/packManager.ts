/**
 * Krunked Lumia — Custom Pack Manager (IndexedDB Persistence + Dev-Server Auto-Detect + Live Hot-Swap)
 *
 * Manages optional user-supplied custom asset & audio packs while maintaining a strict
 * Built-In default and IP firewall:
 * - Persists browser-uploaded packs in IndexedDB (`krunked_lumia_packs_v1`) across reloads.
 * - Auto-detects locally extracted dev-server packs at `/__lumia_assets__/manifest.json`
 *   cleanly without throwing on 404.
 * - Hot-swaps `WebGL2Renderer` (atlas + 96x96 track covers) and `HarmonicAudioEngine`
 *   (custom `.ogg` loops/SFX + harmonic manifests) or restores Built-In art & synthesis cleanly.
 */

import {
  ALL_TRACK_IDS,
  CUSTOM_PACK_DB_NAME,
  type CustomPackManifest,
  type PackMode,
  type Palette,
  type SpriteAssetEntry,
  type TrackId,
} from '../contracts/index.js';
import {
  loadCustomAudioPackFromBuffers,
  loadCustomAudioPackFromUrl,
  type CustomAudioPack,
} from '../audio/customAudioLoader.js';
import type { HarmonicAudioEngine } from '../audio/HarmonicAudioEngine.js';
import { parsePalettesIni } from '../data/palettes.js';
import type { WebGL2Renderer } from '../render/WebGL2Renderer.js';
import {
  decodePngBytesToRgba,
  loadCustomPackFromBrowserFiles,
  type LoadedCustomPack,
  type TracklistJson,
} from './customPackLoader.js';
import type { DecodedImage } from './qoiDecoder.js';

const IDB_STORE_NAME = 'packs';
const IDB_ACTIVE_KEY = 'active';
const IDB_VERSION = 1;

/**
 * UI sprite names whose retail dimensions/frame counts intentionally differ from Krunked's
 * 320x180 built-in UI widgets (e.g., retail `mode_icon_spr` is 32x32 vs Krunked's 16x16 rows;
 * retail `arrow_spr` is 10x20 1-frame vs Krunked's 7x7 4-frame arrows). Leaving them un-overridden
 * keeps menus razor-crisp while swapping gameplay `block_spr` and `container_spr` seamlessly.
 */
const SKIP_RENDERER_UI_OVERRIDE = new Set<string>([
  'arrow_spr',
  'checkmark_spr',
  'mode_icon_spr',
  'pixel_spr',
]);

export interface PackManagerOptions {
  localBaseUrl?: string;
  dbName?: string;
}

type PackSourceKind = 'none' | 'local' | 'idb';

interface StoredCustomPackRecord {
  version: 1;
  savedAt: string;
  manifest: CustomPackManifest;
  atlasWidth: number;
  atlasHeight: number;
  atlasPixels: ArrayBuffer;
  palettes: Palette[];
  palettesIniText: string | null;
  tracklist: TracklistJson | null;
  coverPngBytes: Record<string, ArrayBuffer>;
  audioFiles: Record<string, ArrayBuffer>;
  localizationCsv: string | null;
}

const TRACK_ID_SET: ReadonlySet<string> = new Set<string>(ALL_TRACK_IDS);

function isTrackId(slug: string): slug is TrackId {
  return TRACK_ID_SET.has(slug);
}

function joinUrl(base: string, rel: string): string {
  const cleanBase = base.replace(/\/+$/, '');
  const cleanRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${cleanBase}/${cleanRel}`;
}

/**
 * Adapts raw retail `SPRT` entries for live rendering inside `WebGL2Renderer` / `HudRenderer`:
 * - `block_spr`: retail frame order is [0:solid, 1:empty, 2:filled, 3:hole, 4:target, 5:blank(1x1)],
 *   whereas `HudRenderer` indexes [0:empty, 1:filled, 2:hole, 3:target, 4:guide, 5:ripple].
 * - `container_spr`: retail origin is `(18, 128)`, whereas `HudRenderer` draws top-left at `(boardX, boardY)`
 *   expecting `(0, 0)`.
 * - Skips incompatible UI widget sprites (`arrow_spr`, `checkmark_spr`, `mode_icon_spr`, `pixel_spr`)
 *   so built-in pixel UI widgets stay properly aligned.
 */
export function adaptCustomSpritesForRenderer(
  rawSprites: Record<string, SpriteAssetEntry>,
): Record<string, SpriteAssetEntry> {
  const adapted: Record<string, SpriteAssetEntry> = {};

  for (const [name, entry] of Object.entries(rawSprites)) {
    if (SKIP_RENDERER_UI_OVERRIDE.has(name)) {
      continue;
    }

    if (name === 'block_spr' && entry.frames.length >= 5) {
      const f = entry.frames;
      // Retail indices: f[1]=Empty, f[2]=Filled, f[3]=Hole, f[4]=Target, f[0]=Solid
      // Remap to Krunked indices: 0=Empty, 1=Filled, 2=Hole, 3=Target, 4=Guide(Empty), 5=Ripple(Solid)
      const isRetailOrder =
        f.length >= 6 && f[5].w <= 1 && f[5].h <= 1 && f[1].w === 6 && f[2].w === 6;
      adapted[name] = {
        ...entry,
        originX: 3,
        originY: 3,
        frames: isRetailOrder
          ? [f[1], f[2], f[3], f[4], f[1], f[0]]
          : [...f],
      };
      continue;
    }

    if (name === 'container_spr') {
      adapted[name] = {
        ...entry,
        originX: 0,
        originY: 0,
      };
      continue;
    }

    adapted[name] = entry;
  }

  return adapted;
}

// ============================================================================
// INDEXEDDB PERSISTENCE HELPERS (Graceful no-op when headless/unavailable)
// ============================================================================

function getIndexedDbFactory(): IDBFactory | null {
  const g = globalThis as unknown as { indexedDB?: IDBFactory };
  return typeof g.indexedDB === 'object' && g.indexedDB !== null ? g.indexedDB : null;
}

function openPackDb(dbName: string): Promise<IDBDatabase | null> {
  const idb = getIndexedDbFactory();
  if (!idb) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const req = idb.open(dbName, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readStoredPack(dbName: string): Promise<StoredCustomPackRecord | null> {
  const db = await openPackDb(dbName);
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(IDB_ACTIVE_KEY);
      req.onsuccess = () => {
        const val = req.result as StoredCustomPackRecord | undefined;
        resolve(val && val.version === 1 ? val : null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function writeStoredPack(dbName: string, record: StoredCustomPackRecord): Promise<boolean> {
  const db = await openPackDb(dbName);
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(record, IDB_ACTIVE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

async function deleteStoredPack(dbName: string): Promise<void> {
  const db = await openPackDb(dbName);
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.delete(IDB_ACTIVE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

function serializePackForIdb(pack: LoadedCustomPack): StoredCustomPackRecord {
  const atlasBuf = pack.atlasPixels.buffer.slice(
    pack.atlasPixels.byteOffset,
    pack.atlasPixels.byteOffset + pack.atlasPixels.byteLength,
  ) as ArrayBuffer;

  const coverPngBytes: Record<string, ArrayBuffer> = {};
  for (const [slug, buf] of Object.entries(pack.coverPngBytes)) {
    if (buf) coverPngBytes[slug] = buf.slice(0);
  }

  const audioFiles: Record<string, ArrayBuffer> = {};
  for (const [key, buf] of pack.audioFiles.entries()) {
    audioFiles[key] = buf.slice(0);
  }

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    manifest: pack.manifest,
    atlasWidth: pack.atlasWidth,
    atlasHeight: pack.atlasHeight,
    atlasPixels: atlasBuf,
    palettes: pack.palettes,
    palettesIniText: pack.palettesIniText,
    tracklist: pack.tracklist,
    coverPngBytes,
    audioFiles,
    localizationCsv: pack.localizationCsv,
  };
}

function deserializePackFromIdb(record: StoredCustomPackRecord): LoadedCustomPack {
  const coverPngBytes: Partial<Record<TrackId, ArrayBuffer>> = {};
  for (const [slug, buf] of Object.entries(record.coverPngBytes ?? {})) {
    if (isTrackId(slug) && buf) {
      coverPngBytes[slug] = buf;
    }
  }

  const audioFiles = new Map<string, ArrayBuffer>();
  for (const [key, buf] of Object.entries(record.audioFiles ?? {})) {
    if (buf) audioFiles.set(key, buf);
  }

  const palettes =
    Array.isArray(record.palettes) && record.palettes.length > 0
      ? record.palettes
      : record.palettesIniText
        ? parsePalettesIni(record.palettesIniText)
        : [];

  return {
    source: 'idb-cache',
    manifest: record.manifest,
    atlasWidth: record.atlasWidth,
    atlasHeight: record.atlasHeight,
    atlasPixels: new Uint8Array(record.atlasPixels),
    sprites: record.manifest.sprites ?? {},
    palettes,
    palettesIniText: record.palettesIniText ?? null,
    tracklist: record.tracklist ?? null,
    covers: {},
    coverPngBytes,
    audioFiles,
    localizationCsv: record.localizationCsv ?? null,
  };
}

// ============================================================================
// PACK MANAGER CLASS
// ============================================================================

export class PackManager {
  private readonly localBaseUrl: string;
  private readonly dbName: string;

  private packMode: PackMode = 'builtin';
  private sourceKind: PackSourceKind = 'none';

  // IDB / Browser-uploaded in-memory pack
  private uploadedPack: LoadedCustomPack | null = null;

  // Local dev-server pack metadata & lazily decoded visual assets
  private localManifest: CustomPackManifest | null = null;
  private localPalettes: Palette[] = [];
  private localAtlas: DecodedImage | null = null;
  private localCovers: Partial<Record<TrackId, DecodedImage>> = {};

  // Cached decoded Web Audio pack (keyed by AudioContext reference so unlock re-decodes cleanly)
  private cachedAudioPack: CustomAudioPack | null = null;
  private cachedAudioCtx: AudioContext | null = null;
  private cachedAudioSourceKey = '';

  constructor(options: PackManagerOptions = {}) {
    this.localBaseUrl = options.localBaseUrl ?? '/__lumia_assets__';
    this.dbName = options.dbName ?? CUSTOM_PACK_DB_NAME;
  }

  /**
   * Initializes PackManager:
   * 1. Checks IndexedDB (`krunked_lumia_packs_v1`) for a previously uploaded custom pack.
   * 2. Probes `${localBaseUrl}/manifest.json` cleanly without throwing on 404.
   */
  async init(): Promise<void> {
    // 1. Check IndexedDB cache first
    const stored = await readStoredPack(this.dbName);
    if (stored) {
      this.uploadedPack = deserializePackFromIdb(stored);
      this.sourceKind = 'idb';
    }

    // 2. Probe local dev-server extracted pack (also useful as fallback if IDB cleared)
    await this.probeLocalDevPack();

    if (this.sourceKind === 'none' && this.localManifest) {
      this.sourceKind = 'local';
    }
  }

  private async probeLocalDevPack(): Promise<boolean> {
    if (typeof fetch !== 'function') {
      return false;
    }

    try {
      const res = await fetch(joinUrl(this.localBaseUrl, 'manifest.json'));
      if (!res.ok) {
        this.localManifest = null;
        return false;
      }

      const data = (await res.json()) as Partial<CustomPackManifest> & { available?: boolean };
      if (!data || data.version !== 1 || !data.atlasFile) {
        this.localManifest = null;
        return false;
      }

      const manifest = data as CustomPackManifest;

      // If manifest omitted sprites, try sprites.json
      if (!manifest.sprites || Object.keys(manifest.sprites).length === 0) {
        try {
          const sprRes = await fetch(joinUrl(this.localBaseUrl, 'sprites.json'));
          if (sprRes.ok) {
            manifest.sprites = (await sprRes.json()) as Record<string, SpriteAssetEntry>;
          }
        } catch {
          // Ignore optional sprites.json fetch errors
        }
      }

      // Eagerly parse retail palettes.ini so getCustomPalettes() is immediately populated (63 palettes)
      if (manifest.palettesFile) {
        try {
          const palRes = await fetch(joinUrl(this.localBaseUrl, manifest.palettesFile));
          if (palRes.ok) {
            const iniText = await palRes.text();
            this.localPalettes = parsePalettesIni(iniText);
          }
        } catch {
          this.localPalettes = [];
        }
      }

      this.localManifest = manifest;
      return true;
    } catch {
      this.localManifest = null;
      return false;
    }
  }

  isCustomPackAvailable(): boolean {
    return this.sourceKind !== 'none' && (this.uploadedPack !== null || this.localManifest !== null);
  }

  getPackMode(): PackMode {
    return this.packMode;
  }

  getStatusLabel(): string {
    if (this.packMode !== 'custom') {
      return 'PACK: BUILT-IN';
    }
    if (this.sourceKind === 'local') {
      return 'PACK: CUSTOM (LOCAL)';
    }
    if (this.sourceKind === 'idb') {
      return 'PACK: CUSTOM (IDB)';
    }
    return 'PACK: BUILT-IN';
  }

  /** Returns the parsed retail palettes (63 palettes) when a custom pack is available. */
  getCustomPalettes(): Palette[] {
    if (this.sourceKind === 'idb' && this.uploadedPack) {
      return this.uploadedPack.palettes;
    }
    if (this.sourceKind === 'local') {
      return this.localPalettes;
    }
    if (this.uploadedPack) {
      return this.uploadedPack.palettes;
    }
    return this.localPalettes;
  }

  getManifest(): CustomPackManifest | null {
    if (this.sourceKind === 'idb' && this.uploadedPack) {
      return this.uploadedPack.manifest;
    }
    if (this.sourceKind === 'local') {
      return this.localManifest;
    }
    return this.uploadedPack?.manifest ?? this.localManifest ?? null;
  }

  getCustomSprites(): Record<string, SpriteAssetEntry> | null {
    const manifest = this.getManifest();
    return manifest?.sprites ?? null;
  }

  /**
   * Loads a custom pack from a browser directory picker (`FileList` or `File[]`),
   * decodes `data.win` in-browser if present, and persists it into IndexedDB.
   */
  async loadFromFileList(files: FileList | File[]): Promise<{ ok: boolean; message: string }> {
    try {
      const loaded = await loadCustomPackFromBrowserFiles(files);
      this.uploadedPack = loaded;
      this.sourceKind = 'idb';
      this.invalidateAudioCache();

      const savedToIdb = await writeStoredPack(this.dbName, serializePackForIdb(loaded));

      const spriteCount = Object.keys(loaded.sprites).length;
      const paletteCount = loaded.palettes.length;
      const trackCount = Object.keys(loaded.manifest.tracks).length;
      const audioCount = loaded.audioFiles.size;
      const suffix = savedToIdb ? ' (saved to IDB)' : ' (session memory)';

      return {
        ok: true,
        message: `Loaded custom pack: ${spriteCount} sprites, ${paletteCount} palettes, ${trackCount} tracks, ${audioCount} audio files${suffix}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Failed to load custom pack: ${msg}`,
      };
    }
  }

  /**
   * Hot-swaps `WebGL2Renderer` (custom atlas + 96x96 track covers) and `HarmonicAudioEngine`
   * (custom `.ogg` buffers & manifests) between `'builtin'` and `'custom'` modes cleanly.
   */
  async applyPackMode(
    mode: PackMode,
    renderer: WebGL2Renderer,
    audioEngine: HarmonicAudioEngine,
  ): Promise<boolean> {
    if (mode === 'builtin') {
      renderer.resetBuiltinAtlas();
      renderer.resetBuiltinCovers();
      audioEngine.setPackMode('builtin', null);
      this.packMode = 'builtin';
      return true;
    }

    if (!this.isCustomPackAvailable()) {
      return false;
    }

    if (this.sourceKind === 'idb' && this.uploadedPack) {
      await this.applyUploadedPack(this.uploadedPack, renderer, audioEngine);
      this.packMode = 'custom';
      return true;
    }

    if (this.sourceKind === 'local' && this.localManifest) {
      await this.applyLocalDevPack(this.localManifest, renderer, audioEngine);
      this.packMode = 'custom';
      return true;
    }

    return false;
  }

  private async applyUploadedPack(
    pack: LoadedCustomPack,
    renderer: WebGL2Renderer,
    audioEngine: HarmonicAudioEngine,
  ): Promise<void> {
    if (pack.atlasPixels.length > 0 && pack.atlasWidth > 0 && pack.atlasHeight > 0) {
      const adaptedSprites = adaptCustomSpritesForRenderer(pack.sprites);
      renderer.setCustomAtlas(pack.atlasPixels, pack.atlasWidth, pack.atlasHeight, adaptedSprites);
    }

    // Decode & upload any track cover PNGs
    for (const trackId of ALL_TRACK_IDS) {
      let cover = pack.covers[trackId];
      if (!cover && pack.coverPngBytes[trackId]) {
        const decoded = await decodePngBytesToRgba(pack.coverPngBytes[trackId]!);
        if (decoded) {
          pack.covers[trackId] = decoded;
          cover = decoded;
        }
      }
      if (cover) {
        renderer.setCustomCover(trackId, cover.pixels, cover.width, cover.height);
      }
    }

    // Load / cache decoded custom audio buffers
    const ctx = audioEngine.getAudioContext();
    const sourceKey = `idb:${pack.manifest.extractedAt}`;
    if (!this.cachedAudioPack || this.cachedAudioSourceKey !== sourceKey || this.cachedAudioCtx !== ctx) {
      this.cachedAudioPack = await loadCustomAudioPackFromBuffers(
        ctx,
        pack.audioFiles,
        pack.manifest,
      );
      this.cachedAudioCtx = ctx;
      this.cachedAudioSourceKey = sourceKey;
    }

    audioEngine.setPackMode('custom', this.cachedAudioPack);
  }

  private async applyLocalDevPack(
    manifest: CustomPackManifest,
    renderer: WebGL2Renderer,
    audioEngine: HarmonicAudioEngine,
  ): Promise<void> {
    // 1. Fetch & decode atlas PNG if not yet cached
    if (!this.localAtlas && typeof fetch === 'function') {
      try {
        const res = await fetch(joinUrl(this.localBaseUrl, manifest.atlasFile));
        if (res.ok) {
          const pngBuf = await res.arrayBuffer();
          this.localAtlas = await decodePngBytesToRgba(pngBuf);
        }
      } catch {
        this.localAtlas = null;
      }
    }

    if (this.localAtlas) {
      const adaptedSprites = adaptCustomSpritesForRenderer(manifest.sprites ?? {});
      renderer.setCustomAtlas(
        this.localAtlas.pixels,
        this.localAtlas.width,
        this.localAtlas.height,
        adaptedSprites,
      );
    }

    // 2. Fetch & decode track covers
    if (typeof fetch === 'function') {
      await Promise.all(
        ALL_TRACK_IDS.map(async (trackId) => {
          const trackInfo = manifest.tracks?.[trackId];
          if (!trackInfo?.coverFile) return;
          if (!this.localCovers[trackId]) {
            try {
              const res = await fetch(joinUrl(this.localBaseUrl, trackInfo.coverFile));
              if (res.ok) {
                const decoded = await decodePngBytesToRgba(await res.arrayBuffer());
                if (decoded) {
                  this.localCovers[trackId] = decoded;
                }
              }
            } catch {
              // Fall back gracefully to built-in track cover
            }
          }
          const cover = this.localCovers[trackId];
          if (cover) {
            renderer.setCustomCover(trackId, cover.pixels, cover.width, cover.height);
          }
        }),
      );
    }

    // 3. Load / cache custom audio pack from dev-server URLs
    const ctx = audioEngine.getAudioContext();
    const sourceKey = `local:${this.localBaseUrl}:${manifest.extractedAt}`;
    if (!this.cachedAudioPack || this.cachedAudioSourceKey !== sourceKey || this.cachedAudioCtx !== ctx) {
      this.cachedAudioPack = await loadCustomAudioPackFromUrl(ctx, manifest, this.localBaseUrl);
      this.cachedAudioCtx = ctx;
      this.cachedAudioSourceKey = sourceKey;
    }

    audioEngine.setPackMode('custom', this.cachedAudioPack);
  }

  /** Deletes any saved custom pack from IndexedDB and resets back to Built-In / Local fallback. */
  async clearSavedCustomPack(): Promise<void> {
    await deleteStoredPack(this.dbName);
    this.uploadedPack = null;
    this.invalidateAudioCache();
    this.packMode = 'builtin';
    this.sourceKind = this.localManifest ? 'local' : 'none';
  }

  private invalidateAudioCache(): void {
    this.cachedAudioPack = null;
    this.cachedAudioCtx = null;
    this.cachedAudioSourceKey = '';
  }
}
