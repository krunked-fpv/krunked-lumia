/**
 * Krunked Lumia — Local Retail Asset Extractor CLI (`npm run extract`)
 *
 * STRICT IP FIREWALL:
 * - Reads the local Steam Mixolumia installation STRICTLY READ-ONLY.
 *   NEVER writes, modifies, or creates any file inside the retail Steam folder.
 * - Writes extracted outputs ONLY into gitignored `.lumia-assets/` (never committed,
 *   never bundled into `dist/`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import type { CustomPackManifest } from '../src/contracts/index.js';
import { parseDataWin } from '../src/assets/customPackLoader.js';
import { encodeRgbaToPng } from '../src/assets/qoiDecoder.js';
import { parsePalettesIni } from '../src/data/palettes.js';

export const DEFAULT_RETAIL_SOURCE_DIR =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Mixolumia';

export interface ExtractionSummary {
  sourceDir: string;
  outputDir: string;
  atlasWidth: number;
  atlasHeight: number;
  atlasPngBytes: number;
  spriteCount: number;
  tpagCount: number;
  paletteCount: number;
  trackCount: number;
  menuAudioCount: number;
  trackAudioCount: number;
  hasLocalization: boolean;
  blockSprFrames: number;
  containerSprSize: string;
  manifestPath: string;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFileReadOnlySource(srcFile: string, dstFile: string): void {
  ensureDir(path.dirname(dstFile));
  fs.copyFileSync(srcFile, dstFile);
}

function assertNotWritingToSource(sourceDir: string, outputDir: string): void {
  const normSrc = path.resolve(sourceDir).toLowerCase();
  const normOut = path.resolve(outputDir).toLowerCase();
  if (normOut === normSrc || normOut.startsWith(`${normSrc}${path.sep}`)) {
    throw new Error(
      `IP FIREWALL VIOLATION: outputDir (${outputDir}) cannot be inside read-only sourceDir (${sourceDir})`,
    );
  }
}

/**
 * Extracts retail Mixolumia assets (strictly read-only) into `.lumia-assets/`.
 */
export function extractRetailAssets(
  sourceDir = DEFAULT_RETAIL_SOURCE_DIR,
  outputDir?: string,
): ExtractionSummary {
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(thisFile), '..');
  const resolvedOutDir = path.resolve(outputDir ?? path.join(repoRoot, '.lumia-assets'));
  const resolvedSrcDir = path.resolve(sourceDir);

  assertNotWritingToSource(resolvedSrcDir, resolvedOutDir);

  const dataWinPath = path.join(resolvedSrcDir, 'data.win');
  if (!fs.existsSync(dataWinPath)) {
    throw new Error(
      `Retail data.win not found at "${dataWinPath}". Provide --source <dir> or set MIXOLUMIA_DIR.`,
    );
  }

  ensureDir(resolvedOutDir);

  // 1. Parse data.win & decode 2zoq texture (pure TS BZip2 + GM-QOI)
  const dataWinBytes = fs.readFileSync(dataWinPath);
  const parsed = parseDataWin(dataWinBytes);

  const blockSpr = parsed.sprites['block_spr'];
  const containerSpr = parsed.sprites['container_spr'];
  if (!blockSpr || blockSpr.frames.length < 6) {
    throw new Error('Extracted data.win missing expected 6-frame block_spr');
  }
  if (!containerSpr || containerSpr.frames.length < 1) {
    throw new Error('Extracted data.win missing expected container_spr');
  }

  // 2. Write lossless zlib-compressed atlas.png + sprites.json
  const atlasPng = encodeRgbaToPng(
    parsed.atlasPixels,
    parsed.atlasWidth,
    parsed.atlasHeight,
    (rawScanlines) => new Uint8Array(zlib.deflateSync(rawScanlines, { level: 9 })),
  );
  fs.writeFileSync(path.join(resolvedOutDir, 'atlas.png'), atlasPng);
  fs.writeFileSync(
    path.join(resolvedOutDir, 'sprites.json'),
    JSON.stringify(parsed.sprites, null, 2),
    'utf8',
  );

  const dataDir = path.join(resolvedSrcDir, 'data');

  // 3. Copy data/palettes.ini & count retail palettes
  const srcPalettes = path.join(dataDir, 'palettes.ini');
  let paletteCount = 0;
  if (fs.existsSync(srcPalettes)) {
    copyFileReadOnlySource(srcPalettes, path.join(resolvedOutDir, 'palettes.ini'));
    const iniText = fs.readFileSync(srcPalettes, 'utf8');
    paletteCount = parsePalettesIni(iniText).length;
  }

  // 4. Copy data/tracklist.json
  const srcTracklist = path.join(dataDir, 'tracklist.json');
  if (fs.existsSync(srcTracklist)) {
    copyFileReadOnlySource(srcTracklist, path.join(resolvedOutDir, 'tracklist.json'));
  }

  // 5. Copy data/localization/en_us.csv
  const srcLoc = path.join(dataDir, 'localization', 'en_us.csv');
  let localizationFile: string | null = null;
  if (fs.existsSync(srcLoc)) {
    localizationFile = 'localization/en_us.csv';
    copyFileReadOnlySource(srcLoc, path.join(resolvedOutDir, 'localization', 'en_us.csv'));
  }

  // 6. Copy data/audio/*.ogg
  const srcAudioDir = path.join(dataDir, 'audio');
  const menuAudioFiles: string[] = [];
  if (fs.existsSync(srcAudioDir)) {
    const entries = fs
      .readdirSync(srcAudioDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(ogg|wav)$/i.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const rel = `audio/${entry.name}`;
      copyFileReadOnlySource(
        path.join(srcAudioDir, entry.name),
        path.join(resolvedOutDir, 'audio', entry.name),
      );
      menuAudioFiles.push(rel);
    }
  }

  // 7. Copy data/music/*/{data.json,cover.png,*.ogg}
  const srcMusicDir = path.join(dataDir, 'music');
  const tracks: CustomPackManifest['tracks'] = {};
  let trackAudioCount = 0;

  if (fs.existsSync(srcMusicDir)) {
    const trackDirs = fs
      .readdirSync(srcMusicDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dirEntry of trackDirs) {
      const slug = dirEntry.name;
      const srcTrackDir = path.join(srcMusicDir, slug);
      const dstTrackDir = path.join(resolvedOutDir, 'music', slug);
      const files = fs
        .readdirSync(srcTrackDir, { withFileTypes: true })
        .filter((f) => f.isFile())
        .sort((a, b) => a.name.localeCompare(b.name));

      let dataFile = `music/${slug}/data.json`;
      let coverFile: string | null = null;
      const audioFiles: string[] = [];

      for (const fileEntry of files) {
        const name = fileEntry.name;
        const lower = name.toLowerCase();
        if (lower === 'data.json') {
          dataFile = `music/${slug}/${name}`;
          copyFileReadOnlySource(path.join(srcTrackDir, name), path.join(dstTrackDir, name));
        } else if (lower === 'cover.png') {
          coverFile = `music/${slug}/${name}`;
          copyFileReadOnlySource(path.join(srcTrackDir, name), path.join(dstTrackDir, name));
        } else if (/\.(ogg|wav)$/i.test(lower)) {
          const rel = `music/${slug}/${name}`;
          copyFileReadOnlySource(path.join(srcTrackDir, name), path.join(dstTrackDir, name));
          audioFiles.push(rel);
          trackAudioCount += 1;
        }
      }

      tracks[slug] = {
        dataFile,
        coverFile,
        audioFiles,
      };
    }
  }

  // 8. Write manifest.json matching CustomPackManifest
  const manifest: CustomPackManifest = {
    version: 1,
    source: 'steam-extracted',
    extractedAt: new Date().toISOString(),
    atlasWidth: parsed.atlasWidth,
    atlasHeight: parsed.atlasHeight,
    atlasFile: 'atlas.png',
    sprites: parsed.sprites,
    paletteCount,
    palettesFile: 'palettes.ini',
    tracklistFile: 'tracklist.json',
    tracks,
    menuAudioFiles,
    localizationFile,
  };

  const manifestPath = path.join(resolvedOutDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    sourceDir: resolvedSrcDir,
    outputDir: resolvedOutDir,
    atlasWidth: parsed.atlasWidth,
    atlasHeight: parsed.atlasHeight,
    atlasPngBytes: atlasPng.byteLength,
    spriteCount: parsed.spriteCount,
    tpagCount: parsed.tpagCount,
    paletteCount,
    trackCount: Object.keys(tracks).length,
    menuAudioCount: menuAudioFiles.length,
    trackAudioCount,
    hasLocalization: localizationFile !== null,
    blockSprFrames: blockSpr.frames.length,
    containerSprSize: `${containerSpr.width}x${containerSpr.height}`,
    manifestPath,
  };
}

function parseCliArgs(argv: readonly string[]): { sourceDir: string; outputDir?: string } {
  let sourceDir = process.env.MIXOLUMIA_DIR || DEFAULT_RETAIL_SOURCE_DIR;
  let outputDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source' && argv[i + 1]) {
      sourceDir = argv[++i];
    } else if (arg === '--out' && argv[i + 1]) {
      outputDir = argv[++i];
    }
  }
  return { sourceDir, outputDir };
}

function isExecutedDirectly(): boolean {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isExecutedDirectly()) {
  try {
    const { sourceDir, outputDir } = parseCliArgs(process.argv.slice(2));
    const summary = extractRetailAssets(sourceDir, outputDir);
    console.log('=== Krunked Lumia Retail Asset Extraction Complete ===');
    console.log(`Source (READ-ONLY): ${summary.sourceDir}`);
    console.log(`Output (gitignored): ${summary.outputDir}`);
    console.log(
      `Atlas: ${summary.atlasWidth}x${summary.atlasHeight} RGBA PNG (${(summary.atlasPngBytes / 1024).toFixed(1)} KB)`,
    );
    console.log(
      `Sprites: ${summary.spriteCount} (TPAG: ${summary.tpagCount}) | block_spr: ${summary.blockSprFrames} frames | container_spr: ${summary.containerSprSize}`,
    );
    console.log(`Palettes: ${summary.paletteCount}`);
    console.log(`Tracks: ${summary.trackCount}`);
    console.log(
      `Audio: ${summary.menuAudioCount} menu .ogg + ${summary.trackAudioCount} track .ogg (${summary.menuAudioCount + summary.trackAudioCount} total)`,
    );
    console.log(`Localization: ${summary.hasLocalization ? 'en_us.csv' : 'none'}`);
    console.log(`Manifest: ${summary.manifestPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[extract-assets] ERROR: ${message}`);
    process.exitCode = 1;
  }
}
