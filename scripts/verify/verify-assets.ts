/**
 * Krunked Lumia — Gate A: Asset, Oracle, Taste & IP Hygiene Verification
 * Executed via: `npm run verify:assets`
 *
 * Clean-room CI safe: passes both when `.lumia-assets/` is absent AND when present locally.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_TRACK_IDS,
  ARR_MOVE_SPEED_TICKS,
  AUTOMATA_DECAY,
  BLOCKS_PER_LEVEL,
  BLOOM_BASE_INTENSITY,
  BLOOM_BLUR_SIGMA,
  BLOOM_BLUR_STEPS,
  BLOOM_LUMA_WEIGHTS,
  BOARD_HEIGHT,
  BOARD_SHAKE_DECAY,
  BOARD_WIDTH,
  CONTAINER_HEIGHT,
  CONTAINER_WIDTH,
  FALL_SPEED_TICKS,
  GAME_MODE_CONFIGS,
  GAME_MODE_ORDER,
  IMPOSSIBLE_DROP_TIMER_TICKS,
  IMPOSSIBLE_LEVEL_BONUS,
  IMPOSSIBLE_UNLOCK_SCORE,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MARATHON_TARGET_BLOCKS,
  MAX_COMBO_MULTIPLIER,
  MODE_COUNT,
  PALETTE_COUNT,
  PERFECT_CLEAR_BASE_BONUS,
  RUSH_DURATION_MS,
  RUSH_DURATION_TICKS,
  SIM_HZ,
  SLACK_DURATION_TICKS,
  SLACK_MAX_IMPOSSIBLE,
  SLACK_MAX_STANDARD,
  TRACK_COUNT,
  isLightPaletteBg,
  type CustomPackManifest,
  type SpriteAssetEntry,
  type SpriteFrameRect,
} from '../../src/contracts/index.js';
import {
  BUILTIN_ATLAS_HEIGHT,
  BUILTIN_ATLAS_WIDTH,
  TRACK_COVER_SIZE,
  generateAllTrackCovers,
  generateBuiltinAtlas,
} from '../../src/assets/proceduralArt.js';
import { SYNTH_PACKS } from '../../src/audio/synthPacks.js';
import { EN_US_STRINGS } from '../../src/data/localization.js';
import { MODE_LIST, MODE_METADATA } from '../../src/data/modes.js';
import {
  BUILTIN_PALETTES,
  HEX_COLOR_RE,
  isValidPaletteColors,
  parsePalettesIni,
} from '../../src/data/palettes.js';
import { TRACK_CATALOG, TRACK_LIST } from '../../src/data/tracks.js';
import { SHADER_NAMES } from '../../src/render/shaders.js';
import {
  computeComboMultiplier,
  computeLevelForCleared,
  computePerfectClearBonus,
  getFallSpeedTicks,
  getImpossibleDropTimerTicks,
} from '../../src/sim/index.js';
import { TUTORIAL_PROMPTS } from '../../src/sim/tutorial.js';

const ROOT_DIR = process.cwd();
const ASSETS_DIR = path.join(ROOT_DIR, '.lumia-assets');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const EXPECTED_SHADER_NAMES = [
  'bloom_filter_luminance_shd',
  'blur_2_pass_gauss_lerp_shd',
  'blend_darken_shd',
  'color_threshold_shd',
] as const;

const FORBIDDEN_BRAND_STRINGS = [
  'mixolumia',
  'davemakes',
  'game maker studio',
  'patreon',
  'steam_api',
] as const;

interface CheckFailure {
  section: string;
  message: string;
}

class GateReporter {
  passed = 0;
  readonly failures: CheckFailure[] = [];

  check(section: string, condition: boolean, message: string): void {
    if (condition) {
      this.passed += 1;
    } else {
      this.failures.push({ section, message });
      console.error(`  [FAIL] [${section}] ${message}`);
    }
  }

  equal<T>(section: string, actual: T, expected: T, label: string): void {
    const ok = Object.is(actual, expected);
    this.check(
      section,
      ok,
      ok ? label : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }

  deepEqual<T>(section: string, actual: T, expected: T, label: string): void {
    const aJson = JSON.stringify(actual);
    const eJson = JSON.stringify(expected);
    const ok = aJson === eJson;
    this.check(section, ok, ok ? label : `${label}: expected ${eJson}, got ${aJson}`);
  }
}

function countOpaqueWhitePixels(
  pixels: Uint8Array,
  atlasWidth: number,
  rect: SpriteFrameRect,
): { opaqueCount: number; nonWhiteCount: number } {
  let opaqueCount = 0;
  let nonWhiteCount = 0;
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const idx = ((rect.y + dy) * atlasWidth + (rect.x + dx)) * 4;
      const a = pixels[idx + 3];
      if (a > 0) {
        opaqueCount += 1;
        if (pixels[idx] !== 255 || pixels[idx + 1] !== 255 || pixels[idx + 2] !== 255) {
          nonWhiteCount += 1;
        }
      }
    }
  }
  return { opaqueCount, nonWhiteCount };
}

function readFrameMask(pixels: Uint8Array, atlasWidth: number, rect: SpriteFrameRect): string {
  let out = '';
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const idx = ((rect.y + dy) * atlasWidth + (rect.x + dx)) * 4;
      out += pixels[idx + 3] > 0 ? '#' : '.';
    }
  }
  return out;
}

/**
 * Strip TypeScript/JavaScript comments (`// ...` and `/* ... *\/`) while preserving
 * string and template literals and newline positions for accurate line reporting.
 */
function stripTsCommentsPreservingLines(source: string): string {
  let out = '';
  let i = 0;
  const len = source.length;
  let mode: 'code' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment' = 'code';

  while (i < len) {
    const ch = source[i];
    const next = i + 1 < len ? source[i + 1] : '';

    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'lineComment';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'blockComment';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === "'") {
        mode = 'single';
      } else if (ch === '"') {
        mode = 'double';
      } else if (ch === '`') {
        mode = 'template';
      }
      out += ch;
      i += 1;
      continue;
    }

    if (mode === 'lineComment') {
      if (ch === '\n' || ch === '\r') {
        mode = 'code';
        out += ch;
      } else {
        out += ' ';
      }
      i += 1;
      continue;
    }

    if (mode === 'blockComment') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += ch === '\n' || ch === '\r' ? ch : ' ';
      i += 1;
      continue;
    }

    // String / template modes
    if (ch === '\\' && i + 1 < len) {
      out += ch + next;
      i += 2;
      continue;
    }
    if (
      (mode === 'single' && ch === "'") ||
      (mode === 'double' && ch === '"') ||
      (mode === 'template' && ch === '`')
    ) {
      mode = 'code';
    }
    out += ch;
    i += 1;
  }

  return out;
}

function stripHtmlCommentsPreservingLines(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\r\n]/g, ' '));
}

function walkFilesRecursive(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) {
    return results;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFilesRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

// ============================================================================
// CHECK A: Built-In Krunked Asset Integrity
// ============================================================================

function runAssetIntegrityChecks(rep: GateReporter): {
  spriteCount: number;
  coverCount: number;
  paletteCount: number;
  darkPalettes: number;
  lightPalettes: number;
  locKeys: number;
} {
  const sec = 'A.Assets';
  const atlas = generateBuiltinAtlas();

  rep.equal(sec, atlas.width, BUILTIN_ATLAS_WIDTH, 'Built-in atlas width === 512');
  rep.equal(sec, atlas.height, BUILTIN_ATLAS_HEIGHT, 'Built-in atlas height === 512');
  rep.equal(
    sec,
    atlas.pixels.length,
    atlas.width * atlas.height * 4,
    'Built-in atlas RGBA buffer size matches dimensions',
  );

  // block_spr (6 frames, 6x6, exact pixel counts: Frame 0 = 12, Frame 1 = 24, Frame 2 = 20, Frame 3 = 16)
  const blockSpr = atlas.sprites['block_spr'];
  rep.check(sec, blockSpr !== undefined, 'block_spr exists in built-in atlas');
  if (blockSpr) {
    rep.equal(sec, blockSpr.width, 6, 'block_spr width === 6');
    rep.equal(sec, blockSpr.height, 6, 'block_spr height === 6');
    rep.equal(sec, blockSpr.frames.length, 6, 'block_spr has 6 frames');

    const expectedExactCounts = [12, 24, 20, 16];
    const masks = new Set<string>();
    for (let i = 0; i < blockSpr.frames.length; i++) {
      const stats = countOpaqueWhitePixels(atlas.pixels, atlas.width, blockSpr.frames[i]);
      rep.equal(sec, stats.nonWhiteCount, 0, `block_spr frame ${i} uses pure monochrome white pixels`);
      if (i < expectedExactCounts.length) {
        rep.equal(
          sec,
          stats.opaqueCount,
          expectedExactCounts[i],
          `block_spr frame ${i} exact pixel count`,
        );
        masks.add(readFrameMask(atlas.pixels, atlas.width, blockSpr.frames[i]));
      } else {
        rep.check(sec, stats.opaqueCount > 0, `block_spr frame ${i} is non-empty`);
      }
    }
    rep.equal(sec, masks.size, 4, 'block_spr frames 0..3 have 4 visually distinct 1-bit silhouettes');
  }

  // container_spr & container_fill_spr (68x128, disjoint)
  const containerSpr = atlas.sprites['container_spr'];
  const containerFillSpr = atlas.sprites['container_fill_spr'];
  rep.check(sec, containerSpr !== undefined, 'container_spr exists');
  rep.check(sec, containerFillSpr !== undefined, 'container_fill_spr exists');
  if (containerSpr && containerFillSpr) {
    rep.equal(sec, containerSpr.width, CONTAINER_WIDTH, 'container_spr width === 68');
    rep.equal(sec, containerSpr.height, CONTAINER_HEIGHT, 'container_spr height === 128');
    rep.equal(sec, containerFillSpr.width, CONTAINER_WIDTH, 'container_fill_spr width === 68');
    rep.equal(sec, containerFillSpr.height, CONTAINER_HEIGHT, 'container_fill_spr height === 128');

    const borderStats = countOpaqueWhitePixels(atlas.pixels, atlas.width, containerSpr.frames[0]);
    const fillStats = countOpaqueWhitePixels(atlas.pixels, atlas.width, containerFillSpr.frames[0]);
    rep.check(sec, borderStats.opaqueCount > 250, 'container_spr border has crisp perimeter pixels');
    rep.check(sec, fillStats.opaqueCount > 4000, 'container_fill_spr has solid interior mask pixels');

    let overlapPixels = 0;
    const cRect = containerSpr.frames[0];
    const fRect = containerFillSpr.frames[0];
    for (let y = 0; y < CONTAINER_HEIGHT; y++) {
      for (let x = 0; x < CONTAINER_WIDTH; x++) {
        const cA = atlas.pixels[((cRect.y + y) * atlas.width + (cRect.x + x)) * 4 + 3];
        const fA = atlas.pixels[((fRect.y + y) * atlas.width + (fRect.x + x)) * 4 + 3];
        if (cA > 0 && fA > 0) overlapPixels += 1;
      }
    }
    rep.equal(sec, overlapPixels, 0, 'container_spr and container_fill_spr are strictly disjoint');
  }

  // Required auxiliary sprites
  const requiredSprites: Array<{ name: string; minFrames: number; exactFrames?: number }> = [
    { name: 'pixel_spr', minFrames: 1 },
    { name: 'bg_diamond_spr', minFrames: 1 },
    { name: 'mode_icon_spr', minFrames: 6, exactFrames: 6 },
    { name: 'tutorial_icons', minFrames: 5, exactFrames: 5 },
  ];
  for (const spec of requiredSprites) {
    const entry = atlas.sprites[spec.name];
    rep.check(sec, entry !== undefined, `Sprite '${spec.name}' exists`);
    if (entry) {
      if (spec.exactFrames !== undefined) {
        rep.equal(
          sec,
          entry.frames.length,
          spec.exactFrames,
          `Sprite '${spec.name}' has exact ${spec.exactFrames} frames`,
        );
      } else {
        rep.check(
          sec,
          entry.frames.length >= spec.minFrames,
          `Sprite '${spec.name}' has >= ${spec.minFrames} frame(s)`,
        );
      }
      let allNonEmpty = true;
      for (const frame of entry.frames) {
        const st = countOpaqueWhitePixels(atlas.pixels, atlas.width, frame);
        if (st.opaqueCount === 0 || st.nonWhiteCount > 0) {
          allNonEmpty = false;
        }
      }
      rep.check(sec, allNonEmpty, `Sprite '${spec.name}' frames are non-empty monochrome white`);
    }
  }

  // Baked 5x7 & 3x5 bitmap fonts covering full ASCII 32..126
  for (const fontId of ['5x7', '3x5'] as const) {
    const font = atlas.fonts[fontId];
    rep.check(sec, font !== undefined, `Baked bitmap font '${fontId}' exists`);
    if (font) {
      let missingCodes = 0;
      let emptyVisibleGlyphs = 0;
      let outOfBoundsGlyphs = 0;
      for (let code = 32; code <= 126; code++) {
        const rect = font.glyphs[code];
        if (!rect) {
          missingCodes += 1;
          continue;
        }
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > atlas.width || rect.y + rect.h > atlas.height) {
          outOfBoundsGlyphs += 1;
          continue;
        }
        if (code !== 32) {
          const st = countOpaqueWhitePixels(atlas.pixels, atlas.width, rect);
          if (st.opaqueCount === 0) {
            emptyVisibleGlyphs += 1;
          }
        }
      }
      rep.equal(sec, missingCodes, 0, `Bitmap font '${fontId}' covers all ASCII 32..126`);
      rep.equal(sec, outOfBoundsGlyphs, 0, `Bitmap font '${fontId}' glyphs stay in atlas bounds`);
      rep.equal(sec, emptyVisibleGlyphs, 0, `Bitmap font '${fontId}' printable glyphs 33..126 are non-empty`);
    }
  }

  // All 8 96x96 monochrome album covers
  const covers = generateAllTrackCovers();
  const coverHashes = new Set<number>();
  for (const trackId of ALL_TRACK_IDS) {
    const buf = covers[trackId];
    rep.check(sec, buf instanceof Uint8Array, `Track cover '${trackId}' is Uint8Array`);
    rep.equal(
      sec,
      buf.length,
      TRACK_COVER_SIZE * TRACK_COVER_SIZE * 4,
      `Track cover '${trackId}' is 96x96 RGBA`,
    );
    let lit = 0;
    let unlit = 0;
    let invalidPx = 0;
    let fnv = 0x811c9dc5;
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const a = buf[i + 3];
      if (a !== 255 || r !== g || g !== b || (r !== 0 && r !== 255)) {
        invalidPx += 1;
      } else if (r === 255) {
        lit += 1;
      } else {
        unlit += 1;
      }
      fnv = Math.imul(fnv ^ r, 0x01000193) >>> 0;
    }
    rep.equal(sec, invalidPx, 0, `Track cover '${trackId}' is pure 1-bit monochrome RGBA`);
    rep.check(sec, lit > 200 && unlit > 200, `Track cover '${trackId}' has balanced foreground/background pixels`);
    coverHashes.add(fnv);
  }
  rep.equal(sec, coverHashes.size, ALL_TRACK_IDS.length, 'All 8 track covers are visually distinct');

  // 63 Built-in Palettes
  rep.equal(sec, BUILTIN_PALETTES.length, PALETTE_COUNT, 'BUILTIN_PALETTES.length === 63');
  const palIds = new Set<string>();
  let invalidPaletteCount = 0;
  let darkPalettes = 0;
  let lightPalettes = 0;
  for (const pal of BUILTIN_PALETTES) {
    palIds.add(pal.id);
    if (!isValidPaletteColors(pal.colors) || !pal.colors.every((c) => HEX_COLOR_RE.test(c))) {
      invalidPaletteCount += 1;
    }
    if (isLightPaletteBg(pal.colors[0])) {
      lightPalettes += 1;
    } else {
      darkPalettes += 1;
    }
  }
  rep.equal(sec, palIds.size, 63, 'All 63 built-in palette IDs are unique');
  rep.equal(sec, invalidPaletteCount, 0, 'All 63 palettes have 6 valid #rrggbb hex slots');
  const picoDark = BUILTIN_PALETTES.find((p) => p.id === 'pico_dark');
  const picoLight = BUILTIN_PALETTES.find((p) => p.id === 'pico_light');
  rep.check(sec, picoDark !== undefined && !isLightPaletteBg(picoDark.colors[0]), 'Includes dark pico_dark palette');
  rep.check(sec, picoLight !== undefined && isLightPaletteBg(picoLight.colors[0]), 'Includes light pico_light palette');
  rep.check(sec, darkPalettes > 0 && lightPalettes > 0, 'Includes both dark and light palettes');

  // All 6 modes, all 8 tracks in ALL_TRACK_IDS & SYNTH_PACKS & TRACK_CATALOG, localization non-empty
  rep.equal(sec, GAME_MODE_ORDER.length, MODE_COUNT, 'GAME_MODE_ORDER has 6 modes');
  rep.deepEqual(
    sec,
    [...GAME_MODE_ORDER],
    ['marathon', 'endless', 'intense', 'relaxed', 'rush', 'impossible'],
    'GAME_MODE_ORDER contains exact 6 modes',
  );
  for (const modeId of GAME_MODE_ORDER) {
    rep.check(
      sec,
      GAME_MODE_CONFIGS[modeId]?.id === modeId && MODE_METADATA[modeId]?.id === modeId,
      `Mode '${modeId}' exists in GAME_MODE_CONFIGS and MODE_METADATA`,
    );
  }

  rep.equal(sec, ALL_TRACK_IDS.length, TRACK_COUNT, 'ALL_TRACK_IDS has 8 tracks');
  for (const trackId of ALL_TRACK_IDS) {
    rep.check(sec, SYNTH_PACKS[trackId]?.id === trackId, `Track '${trackId}' exists in SYNTH_PACKS`);
    rep.check(sec, TRACK_CATALOG[trackId]?.id === trackId, `Track '${trackId}' exists in TRACK_CATALOG`);
  }

  const locEntries = Object.entries(EN_US_STRINGS);
  rep.check(sec, locEntries.length > 0, 'EN_US_STRINGS is non-empty');
  const emptyLocKeys = locEntries.filter(([, val]) => typeof val !== 'string' || val.trim().length === 0);
  rep.equal(sec, emptyLocKeys.length, 0, 'All localization keys have non-empty strings');

  return {
    spriteCount: Object.keys(atlas.sprites).length,
    coverCount: ALL_TRACK_IDS.length,
    paletteCount: BUILTIN_PALETTES.length,
    darkPalettes,
    lightPalettes,
    locKeys: locEntries.length,
  };
}

// ============================================================================
// CHECK B: Oracle Parity & Optional Local `.lumia-assets/` Verification
// ============================================================================

interface OracleWrapped<T> {
  value: T;
  provenance?: string;
  source?: string;
}

interface OracleFile {
  schemaVersion: number;
  constants: Record<string, OracleWrapped<unknown>>;
}

function unwrapOracle<T>(oracle: OracleFile, key: string): T | undefined {
  const entry = oracle.constants?.[key];
  if (!entry || typeof entry !== 'object') return undefined;
  return entry.value as T;
}

function runOracleParityChecks(rep: GateReporter): {
  oraclePresent: boolean;
  manifestPresent: boolean;
  oracleChecks: number;
} {
  const sec = 'B.Oracle';
  const startPassed = rep.passed;

  // Always verify core contract & sim constant invariants even in clean-room CI
  rep.equal(sec, SIM_HZ, 60, 'Contract SIM_HZ === 60');
  rep.equal(sec, LOGICAL_WIDTH, 320, 'Contract LOGICAL_WIDTH === 320');
  rep.equal(sec, LOGICAL_HEIGHT, 180, 'Contract LOGICAL_HEIGHT === 180');
  rep.equal(sec, CONTAINER_WIDTH, 68, 'Contract CONTAINER_WIDTH === 68');
  rep.equal(sec, CONTAINER_HEIGHT, 128, 'Contract CONTAINER_HEIGHT === 128');
  rep.equal(sec, BOARD_WIDTH, 8, 'Contract BOARD_WIDTH === 8');
  rep.equal(sec, BOARD_HEIGHT, 29, 'Contract BOARD_HEIGHT === 29');
  rep.equal(sec, FALL_SPEED_TICKS.length, 16, 'FALL_SPEED_TICKS has 16 levels');
  rep.equal(sec, IMPOSSIBLE_DROP_TIMER_TICKS.length, 17, 'IMPOSSIBLE_DROP_TIMER_TICKS has 17 steps');
  rep.equal(sec, ARR_MOVE_SPEED_TICKS.length, 6, 'ARR_MOVE_SPEED_TICKS has 6 speeds');
  rep.equal(sec, SLACK_DURATION_TICKS, 12, 'SLACK_DURATION_TICKS === 12');
  rep.equal(sec, SLACK_MAX_STANDARD, 10, 'SLACK_MAX_STANDARD === 10');
  rep.equal(sec, SLACK_MAX_IMPOSSIBLE, 4, 'SLACK_MAX_IMPOSSIBLE === 4');
  rep.equal(sec, BLOCKS_PER_LEVEL, 30, 'BLOCKS_PER_LEVEL === 30');
  rep.equal(sec, MARATHON_TARGET_BLOCKS, 450, 'MARATHON_TARGET_BLOCKS === 450');
  rep.equal(sec, RUSH_DURATION_MS, 120_000, 'RUSH_DURATION_MS === 120000');
  rep.equal(sec, RUSH_DURATION_TICKS, 7200, 'RUSH_DURATION_TICKS === 7200');
  rep.equal(sec, IMPOSSIBLE_UNLOCK_SCORE, 4_000_000, 'IMPOSSIBLE_UNLOCK_SCORE === 4000000');
  rep.equal(sec, IMPOSSIBLE_LEVEL_BONUS, 15, 'IMPOSSIBLE_LEVEL_BONUS === 15');
  rep.equal(sec, MAX_COMBO_MULTIPLIER, 4, 'MAX_COMBO_MULTIPLIER === 4');
  rep.equal(sec, PERFECT_CLEAR_BASE_BONUS, 10_000, 'PERFECT_CLEAR_BASE_BONUS === 10000');
  rep.equal(sec, BOARD_SHAKE_DECAY, 0.916, 'BOARD_SHAKE_DECAY === 0.916');
  rep.equal(sec, AUTOMATA_DECAY, 0.75, 'AUTOMATA_DECAY === 0.75');
  rep.equal(sec, BLOOM_BASE_INTENSITY, 0.15, 'BLOOM_BASE_INTENSITY === 0.15');
  rep.deepEqual(sec, [...BLOOM_LUMA_WEIGHTS], [0.229, 0.587, 0.114], 'BLOOM_LUMA_WEIGHTS === [0.229, 0.587, 0.114]');
  rep.equal(sec, BLOOM_BLUR_STEPS, 3, 'BLOOM_BLUR_STEPS === 3');
  rep.equal(sec, BLOOM_BLUR_SIGMA, 0.5, 'BLOOM_BLUR_SIGMA === 0.5');
  rep.deepEqual(sec, Object.values(SHADER_NAMES), [...EXPECTED_SHADER_NAMES], 'SHADER_NAMES matches all 4 shaders');

  // Sim formula alignment checks
  rep.equal(sec, computeLevelForCleared(0, BLOCKS_PER_LEVEL, true), 1, 'Sim level-up matches BLOCKS_PER_LEVEL');
  rep.equal(sec, computeComboMultiplier(9), MAX_COMBO_MULTIPLIER, 'Sim combo cap matches MAX_COMBO_MULTIPLIER');
  rep.equal(sec, computePerfectClearBonus(0, 1, 'marathon'), PERFECT_CLEAR_BASE_BONUS, 'Sim PC bonus matches PERFECT_CLEAR_BASE_BONUS');
  rep.deepEqual(
    sec,
    FALL_SPEED_TICKS.map((_, idx) => getFallSpeedTicks(idx)),
    [...FALL_SPEED_TICKS],
    'Sim getFallSpeedTicks matches FALL_SPEED_TICKS[0..15]',
  );
  rep.deepEqual(
    sec,
    IMPOSSIBLE_DROP_TIMER_TICKS.map((_, idx) => getImpossibleDropTimerTicks(idx)),
    [...IMPOSSIBLE_DROP_TIMER_TICKS],
    'Sim getImpossibleDropTimerTicks matches IMPOSSIBLE_DROP_TIMER_TICKS[0..16]',
  );

  // Optional local `.lumia-assets/oracle.json` parity check
  const oraclePath = path.join(ASSETS_DIR, 'oracle.json');
  const oraclePresent = fs.existsSync(oraclePath);
  if (oraclePresent) {
    const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleFile;
    rep.equal(sec, unwrapOracle<number>(oracle, 'simHz'), SIM_HZ, 'oracle.simHz === SIM_HZ (60)');
    rep.deepEqual(
      sec,
      unwrapOracle<{ width: number; height: number }>(oracle, 'logicalViewport'),
      { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT },
      'oracle.logicalViewport === 320x180',
    );
    rep.deepEqual(
      sec,
      unwrapOracle<{ width: number; height: number }>(oracle, 'containerDimensions'),
      { width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT },
      'oracle.containerDimensions === 68x128',
    );
    rep.deepEqual(
      sec,
      unwrapOracle<{ width: number; height: number }>(oracle, 'boardDimensions'),
      { width: BOARD_WIDTH, height: BOARD_HEIGHT },
      'oracle.boardDimensions === 8x29',
    );
    rep.deepEqual(
      sec,
      unwrapOracle<number[]>(oracle, 'fallSpeedTicks'),
      [...FALL_SPEED_TICKS],
      'oracle.fallSpeedTicks === FALL_SPEED_TICKS (16 levels)',
    );
    rep.deepEqual(
      sec,
      unwrapOracle<number[]>(oracle, 'impossibleDropTimerTicks'),
      [...IMPOSSIBLE_DROP_TIMER_TICKS],
      'oracle.impossibleDropTimerTicks === IMPOSSIBLE_DROP_TIMER_TICKS (17 steps)',
    );
    rep.deepEqual(
      sec,
      unwrapOracle<number[]>(oracle, 'arrMoveSpeedTicks'),
      [...ARR_MOVE_SPEED_TICKS],
      'oracle.arrMoveSpeedTicks === ARR_MOVE_SPEED_TICKS (6 presets)',
    );
    rep.equal(sec, unwrapOracle<number>(oracle, 'slackDurationTicks'), SLACK_DURATION_TICKS, 'oracle.slackDurationTicks === 12');
    rep.equal(sec, unwrapOracle<number>(oracle, 'slackMaxStandard'), SLACK_MAX_STANDARD, 'oracle.slackMaxStandard === 10');
    rep.equal(sec, unwrapOracle<number>(oracle, 'slackMaxImpossible'), SLACK_MAX_IMPOSSIBLE, 'oracle.slackMaxImpossible === 4');
    rep.equal(sec, unwrapOracle<number>(oracle, 'blocksPerLevel'), BLOCKS_PER_LEVEL, 'oracle.blocksPerLevel === 30');
    rep.equal(sec, unwrapOracle<number>(oracle, 'marathonTargetBlocks'), MARATHON_TARGET_BLOCKS, 'oracle.marathonTargetBlocks === 450');
    rep.equal(sec, unwrapOracle<number>(oracle, 'rushDurationMs'), RUSH_DURATION_MS, 'oracle.rushDurationMs === 120000');
    rep.equal(sec, unwrapOracle<number>(oracle, 'impossibleUnlockScore'), IMPOSSIBLE_UNLOCK_SCORE, 'oracle.impossibleUnlockScore === 4000000');
    rep.equal(sec, unwrapOracle<number>(oracle, 'impossibleLevelBonus'), IMPOSSIBLE_LEVEL_BONUS, 'oracle.impossibleLevelBonus === 15');
    rep.equal(sec, unwrapOracle<number>(oracle, 'maxComboMultiplier'), MAX_COMBO_MULTIPLIER, 'oracle.maxComboMultiplier === 4');
    rep.equal(sec, unwrapOracle<number>(oracle, 'perfectClearBaseBonus'), PERFECT_CLEAR_BASE_BONUS, 'oracle.perfectClearBaseBonus === 10000');
    rep.equal(sec, unwrapOracle<number>(oracle, 'boardShakeDecay'), BOARD_SHAKE_DECAY, 'oracle.boardShakeDecay === 0.916');
    rep.equal(sec, unwrapOracle<number>(oracle, 'automataDecay'), AUTOMATA_DECAY, 'oracle.automataDecay === 0.75');
    rep.equal(sec, unwrapOracle<number>(oracle, 'bloomBaseIntensity'), BLOOM_BASE_INTENSITY, 'oracle.bloomBaseIntensity === 0.15');
    rep.deepEqual(
      sec,
      unwrapOracle<number[]>(oracle, 'bloomLumaWeights'),
      [...BLOOM_LUMA_WEIGHTS],
      'oracle.bloomLumaWeights === [0.229, 0.587, 0.114]',
    );
    rep.equal(sec, unwrapOracle<number>(oracle, 'bloomBlurSteps'), BLOOM_BLUR_STEPS, 'oracle.bloomBlurSteps === 3');
    rep.equal(sec, unwrapOracle<number>(oracle, 'bloomBlurSigma'), BLOOM_BLUR_SIGMA, 'oracle.bloomBlurSigma === 0.5');
    rep.deepEqual(sec, unwrapOracle<string[]>(oracle, 'modes'), [...GAME_MODE_ORDER], 'oracle.modes === GAME_MODE_ORDER (6 modes)');
    rep.equal(sec, unwrapOracle<number>(oracle, 'modeCount'), MODE_COUNT, 'oracle.modeCount === 6');
    rep.equal(sec, unwrapOracle<number>(oracle, 'paletteCount'), BUILTIN_PALETTES.length, 'oracle.paletteCount === 63');
    rep.equal(sec, unwrapOracle<number>(oracle, 'trackCount'), ALL_TRACK_IDS.length, 'oracle.trackCount === 8');
    rep.deepEqual(sec, unwrapOracle<string[]>(oracle, 'allTrackIds'), [...ALL_TRACK_IDS], 'oracle.allTrackIds === ALL_TRACK_IDS (8 tracks)');
    rep.deepEqual(
      sec,
      unwrapOracle<string[]>(oracle, 'shaders'),
      Object.values(SHADER_NAMES),
      'oracle.shaders === all 4 SHADER_NAMES',
    );
  }

  // Optional local `.lumia-assets/manifest.json` verification
  const manifestPath = path.join(ASSETS_DIR, 'manifest.json');
  const manifestPresent = fs.existsSync(manifestPath);
  if (manifestPresent) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CustomPackManifest;

    // 1. Atlas PNG exists on disk and has PNG header signature
    const atlasPath = path.resolve(ASSETS_DIR, manifest.atlasFile || 'atlas.png');
    rep.check(sec, fs.existsSync(atlasPath), `Manifest atlas PNG exists (${manifest.atlasFile})`);
    if (fs.existsSync(atlasPath)) {
      const hdr = fs.readFileSync(atlasPath).subarray(0, 8);
      const isPng =
        hdr.length === 8 &&
        hdr[0] === 0x89 &&
        hdr[1] === 0x50 &&
        hdr[2] === 0x4e &&
        hdr[3] === 0x47;
      rep.check(sec, isPng, 'Manifest atlas file has valid PNG magic header');
    }

    // 2. sprites.json contains block_spr & container_spr
    const spritesJsonPath = path.join(ASSETS_DIR, 'sprites.json');
    rep.check(sec, fs.existsSync(spritesJsonPath), '.lumia-assets/sprites.json exists');
    if (fs.existsSync(spritesJsonPath)) {
      const parsedSprites = JSON.parse(fs.readFileSync(spritesJsonPath, 'utf8')) as
        | Record<string, SpriteAssetEntry>
        | { sprites?: Record<string, SpriteAssetEntry> };
      const spriteMap: Record<string, SpriteAssetEntry> =
        'sprites' in parsedSprites &&
        parsedSprites.sprites &&
        typeof parsedSprites.sprites === 'object' &&
        !('frames' in parsedSprites.sprites)
          ? (parsedSprites.sprites as Record<string, SpriteAssetEntry>)
          : (parsedSprites as Record<string, SpriteAssetEntry>);
      rep.check(sec, Boolean(spriteMap['block_spr']), 'sprites.json contains block_spr');
      rep.check(sec, Boolean(spriteMap['container_spr']), 'sprites.json contains container_spr');
    }

    // 3. palettes.ini parses cleanly to 63 palettes
    const palettesIniPath = path.resolve(ASSETS_DIR, manifest.palettesFile || 'palettes.ini');
    rep.check(sec, fs.existsSync(palettesIniPath), `palettes.ini exists (${manifest.palettesFile})`);
    if (fs.existsSync(palettesIniPath)) {
      const parsedPalettes = parsePalettesIni(fs.readFileSync(palettesIniPath, 'utf8'));
      rep.equal(sec, parsedPalettes.length, PALETTE_COUNT, 'Extracted palettes.ini parses to 63 palettes');
    }

    // 4. All 8 track folders exist
    for (const trackId of ALL_TRACK_IDS) {
      const trackEntry = manifest.tracks?.[trackId];
      rep.check(sec, Boolean(trackEntry), `manifest.tracks contains '${trackId}'`);
      if (trackEntry && trackEntry.dataFile) {
        const dataPath = path.resolve(ASSETS_DIR, trackEntry.dataFile);
        const folderPath = path.dirname(dataPath);
        rep.check(
          sec,
          fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory(),
          `Track folder exists for '${trackId}'`,
        );
        rep.check(sec, fs.existsSync(dataPath), `Track data.json exists for '${trackId}'`);
      } else {
        const fallbackA = path.join(ASSETS_DIR, 'music', trackId);
        const fallbackB = path.join(ASSETS_DIR, 'data', 'music', trackId);
        rep.check(
          sec,
          fs.existsSync(fallbackA) || fs.existsSync(fallbackB),
          `Track folder exists on disk for '${trackId}'`,
        );
      }
    }
  }

  return {
    oraclePresent,
    manifestPresent,
    oracleChecks: rep.passed - startPassed,
  };
}

// ============================================================================
// CHECK C: TASTE_NOTES Enforcement ("keep the art style.") & Brand Hygiene
// ============================================================================

function runTasteAndBrandChecks(rep: GateReporter): { scannedUiDataFiles: number } {
  const sec = 'C.Taste';

  rep.check(sec, LOGICAL_WIDTH === 320 && LOGICAL_HEIGHT === 180, 'LOGICAL_WIDTH === 320 && LOGICAL_HEIGHT === 180');

  // Shaders enforcement
  const shadersPath = path.join(ROOT_DIR, 'src', 'render', 'shaders.ts');
  const shadersSrc = fs.readFileSync(shadersPath, 'utf8');
  rep.check(sec, shadersSrc.includes('0.229'), 'shaders.ts contains luminance weight 0.229');
  rep.check(sec, shadersSrc.includes('0.587'), 'shaders.ts contains luminance weight 0.587');
  rep.check(sec, shadersSrc.includes('0.114'), 'shaders.ts contains luminance weight 0.114');
  rep.check(sec, shadersSrc.includes('blur_steps'), 'shaders.ts contains blur_steps');
  rep.check(
    sec,
    shadersSrc.includes('blend_darken') &&
      shadersSrc.includes('u_isLight') &&
      (shadersSrc.includes('1.0 - bloom') || shadersSrc.includes('darkened')),
    'shaders.ts contains blend_darken & light-palette darken formula',
  );
  rep.check(
    sec,
    shadersSrc.includes('color_threshold') && /intensity\s*>\s*0\.5/.test(shadersSrc),
    'shaders.ts contains color_threshold > 0.5 mapping',
  );

  // WebGL2Renderer GL_NEAREST enforcement
  const rendererPath = path.join(ROOT_DIR, 'src', 'render', 'WebGL2Renderer.ts');
  const rendererSrc = fs.readFileSync(rendererPath, 'utf8');
  rep.check(
    sec,
    /sceneTarget\s*=\s*createRenderTarget\([^)]*gl\.NEAREST\s*\)/.test(rendererSrc),
    'WebGL2Renderer.ts uses gl.NEAREST for 320x180 scene presentation target',
  );
  rep.check(
    sec,
    /builtinAtlasTex\s*=\s*createTexture2D\([\s\S]*?gl\.NEAREST[\s\S]*?\)/.test(rendererSrc),
    'WebGL2Renderer.ts uses gl.NEAREST for atlas texture',
  );

  // index.html pixelated enforcement
  const indexHtmlPath = path.join(ROOT_DIR, 'index.html');
  const indexHtmlSrc = fs.readFileSync(indexHtmlPath, 'utf8');
  rep.check(sec, indexHtmlSrc.includes('image-rendering: pixelated'), 'index.html contains image-rendering: pixelated');

  // Case-insensitive third-party branding scan on user-facing UI/data files
  const uiDir = path.join(ROOT_DIR, 'src', 'ui');
  const uiFiles = fs.existsSync(uiDir)
    ? fs
        .readdirSync(uiDir)
        .filter((name) => name.endsWith('.ts'))
        .sort()
        .map((name) => path.join(uiDir, name))
    : [];

  const targetFiles = [
    path.join(ROOT_DIR, 'src', 'data', 'localization.ts'),
    path.join(ROOT_DIR, 'src', 'data', 'palettes.ts'),
    path.join(ROOT_DIR, 'src', 'data', 'tracks.ts'),
    ...uiFiles,
    indexHtmlPath,
  ];

  for (const filePath of targetFiles) {
    const rel = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
    const raw = fs.readFileSync(filePath, 'utf8');
    const scannable = filePath.endsWith('.html')
      ? stripHtmlCommentsPreservingLines(raw)
      : stripTsCommentsPreservingLines(raw);
    const lines = scannable.split(/\r?\n/);

    const leaks: string[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const lowerLine = lines[idx].toLowerCase();
      for (const forbidden of FORBIDDEN_BRAND_STRINGS) {
        if (lowerLine.includes(forbidden)) {
          leaks.push(`${rel}:${idx + 1} matched "${forbidden}"`);
        }
      }
    }
    rep.check(
      sec,
      leaks.length === 0,
      leaks.length === 0
        ? `Zero leaked branding strings in ${rel}`
        : `Leaked branding string(s) found: ${leaks.join('; ')}`,
    );
  }

  // Runtime user-facing catalog values check (localization, palettes, tracks, modes, tutorial)
  const runtimeStrings: string[] = [
    ...Object.values(EN_US_STRINGS),
    ...BUILTIN_PALETTES.flatMap((p) => [p.id, p.name, p.author ?? '']),
    ...TRACK_LIST.flatMap((tr) => [tr.id, tr.title, tr.subtitle, tr.artist, tr.description]),
    ...MODE_LIST.flatMap((m) => [m.name, m.description, m.badge, m.goalSummary, m.unlockDescription]),
    ...Object.values(TUTORIAL_PROMPTS).flatMap((p) => [p.title, p.hint]),
  ];
  const runtimeLeaks: string[] = [];
  for (const text of runtimeStrings) {
    const lower = text.toLowerCase();
    for (const forbidden of FORBIDDEN_BRAND_STRINGS) {
      if (lower.includes(forbidden)) {
        runtimeLeaks.push(`"${text}" matched "${forbidden}"`);
      }
    }
  }
  rep.check(
    sec,
    runtimeLeaks.length === 0,
    runtimeLeaks.length === 0
      ? 'Zero leaked branding strings in runtime UI/data catalogs'
      : `Leaked branding in runtime catalogs: ${runtimeLeaks.join('; ')}`,
  );

  return { scannedUiDataFiles: targetFiles.length };
}

// ============================================================================
// CHECK D: IP Firewall (Git Tracked Files & Optional `dist/` Bundle)
// ============================================================================

function runIpFirewallChecks(rep: GateReporter): {
  gitChecked: boolean;
  trackedFiles: number;
  distChecked: boolean;
  distFiles: number;
} {
  const sec = 'D.IPFirewall';

  let gitChecked = false;
  let trackedFiles = 0;

  if (fs.existsSync(path.join(ROOT_DIR, '.git'))) {
    gitChecked = true;
    const stdout = execFileSync('git', ['ls-files'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    });
    const files = stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter((line) => line.length > 0);
    trackedFiles = files.length;

    const violations: string[] = [];
    for (const file of files) {
      const lower = file.toLowerCase();
      const base = path.posix.basename(lower);

      if (lower.startsWith('.lumia-assets/') || lower.includes('/.lumia-assets/')) {
        violations.push(`${file} (.lumia-assets/ tracked)`);
      } else if (base === 'data.win') {
        violations.push(`${file} (data.win tracked)`);
      } else if (base === 'mixolumia.exe') {
        violations.push(`${file} (Mixolumia.exe tracked)`);
      } else if (base === 'palettes.ini') {
        violations.push(`${file} (palettes.ini tracked)`);
      } else if (lower.endsWith('.ogg') || lower.endsWith('.wav')) {
        violations.push(`${file} (raw audio tracked)`);
      } else if (lower.endsWith('.md') && file !== 'README.md') {
        violations.push(`${file} (non-README markdown tracked)`);
      }
    }

    rep.check(
      sec,
      violations.length === 0,
      violations.length === 0
        ? `Git IP firewall clean across ${trackedFiles} tracked files`
        : `Git IP firewall violations: ${violations.join(', ')}`,
    );
  }

  let distChecked = false;
  let distFiles = 0;
  if (fs.existsSync(DIST_DIR) && fs.statSync(DIST_DIR).isDirectory()) {
    distChecked = true;
    const walked = walkFilesRecursive(DIST_DIR);
    distFiles = walked.length;
    const distViolations: string[] = [];

    for (const absPath of walked) {
      const rel = path.relative(DIST_DIR, absPath).replace(/\\/g, '/');
      const lower = rel.toLowerCase();
      const base = path.posix.basename(lower);
      const segments = lower.split('/');

      if (segments.includes('.lumia-assets')) {
        distViolations.push(`${rel} (.lumia-assets in dist/)`);
      } else if (
        lower.endsWith('.ogg') ||
        lower.endsWith('.wav') ||
        lower.endsWith('.win') ||
        lower.endsWith('.exe') ||
        base === 'palettes.ini'
      ) {
        distViolations.push(`${rel} (forbidden retail/audio artifact in dist/)`);
      }
    }

    rep.check(
      sec,
      distViolations.length === 0,
      distViolations.length === 0
        ? `dist/ IP firewall clean across ${distFiles} bundled files`
        : `dist/ IP firewall violations: ${distViolations.join(', ')}`,
    );
  }

  return { gitChecked, trackedFiles, distChecked, distFiles };
}

// ============================================================================
// MAIN ENTRY
// ============================================================================

function main(): void {
  const startMs = Date.now();
  const rep = new GateReporter();

  const assetsSummary = runAssetIntegrityChecks(rep);
  const oracleSummary = runOracleParityChecks(rep);
  const tasteSummary = runTasteAndBrandChecks(rep);
  const firewallSummary = runIpFirewallChecks(rep);

  const elapsedMs = Date.now() - startMs;

  console.log('======================================================================');
  console.log('Krunked Lumia — Gate A: Asset, Oracle, Taste & IP Hygiene Verification');
  console.log('======================================================================');
  console.log(
    `[A.Assets]     sprites=${assetsSummary.spriteCount} | covers=${assetsSummary.coverCount} | ` +
      `palettes=${assetsSummary.paletteCount} (dark=${assetsSummary.darkPalettes}, light=${assetsSummary.lightPalettes}) | ` +
      `locKeys=${assetsSummary.locKeys}`,
  );
  console.log(
    `[B.Oracle]     oracle.json=${oracleSummary.oraclePresent ? 'VERIFIED' : 'absent (clean-room CI)'} | ` +
      `manifest.json=${oracleSummary.manifestPresent ? 'VERIFIED' : 'absent (clean-room CI)'} | ` +
      `checks=${oracleSummary.oracleChecks}`,
  );
  console.log(
    `[C.Taste]      viewport=${LOGICAL_WIDTH}x${LOGICAL_HEIGHT} | shaders=4 | GL_NEAREST+pixelated=OK | ` +
      `brandScanFiles=${tasteSummary.scannedUiDataFiles}`,
  );
  console.log(
    `[D.IPFirewall] git=${firewallSummary.gitChecked ? `${firewallSummary.trackedFiles} tracked (CLEAN)` : 'skipped'} | ` +
      `dist=${firewallSummary.distChecked ? `${firewallSummary.distFiles} bundled (CLEAN)` : 'absent (clean-room)'}`,
  );
  console.log('----------------------------------------------------------------------');

  if (rep.failures.length > 0) {
    console.error(
      `GATE A FAILED: ${rep.failures.length} failure(s), ${rep.passed} check(s) passed (${elapsedMs}ms).`,
    );
    process.exit(1);
  }

  console.log(`GATE A PASSED (${rep.passed} checks passed, 0 failures, ${elapsedMs}ms)`);
}

main();
