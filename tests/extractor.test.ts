import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomPackManifest, SpriteAssetEntry } from '../src/contracts/index.js';
import {
  decode2zoqTexture,
  decodeGmQoi,
  decompressBzip2,
  encodeGmQoi,
  encodeRgbaToPng,
} from '../src/assets/qoiDecoder.js';
import {
  loadCustomPackFromBrowserFiles,
  parseDataWin,
} from '../src/assets/customPackLoader.js';
import {
  adaptCustomSpritesForRenderer,
  PackManager,
} from '../src/assets/packManager.js';
import { HarmonicAudioEngine } from '../src/audio/HarmonicAudioEngine.js';
import { parsePalettesIni } from '../src/data/palettes.js';
import type { WebGL2Renderer } from '../src/render/WebGL2Renderer.js';
import { DEFAULT_RETAIL_SOURCE_DIR } from '../tools/extract-assets.js';

const RETAIL_DATA_WIN = path.join(DEFAULT_RETAIL_SOURCE_DIR, 'data.win');
const RETAIL_PALETTES_INI = path.join(DEFAULT_RETAIL_SOURCE_DIR, 'data', 'palettes.ini');
const HAS_RETAIL_DATA_WIN = fs.existsSync(RETAIL_DATA_WIN);

// Clean-room standard BZip2 test vectors (no retail data)
const BZIP2_VEC_1_B64 =
  'QlpoOTFBWSZTWbZDkqMAAAofgGACf+AQDAwQLivfACAAQVB6g000zSPRB6aj1DGmIwjTAAAVGZN9HnNyPy2hEZb6StpwXcWTUyqaKwGv+BNVwVYGH4u5IpwoSFshyVGA';
const BZIP2_VEC_1_EXPECTED = 'Krunked Lumia pure-TS BZip2 test vector 0123456789!';

const BZIP2_VEC_2_B64 =
  'QlpoMTFBWSZTWSvEz30AAIN+AP//////////uAAAcAAIMAC4Rg0JiaZMJkyYmCaYJppkYmJowIcwCYCZGAEYmJhMJghpiaYBVUoxGIDAjRkDABMAATaNTHKGDrOEUg7DtJJKJZ3EXgeJ5HmTCaTieUCieh6lI9j3KZUPg+T6Ps/CqViuWCyWi2XC6Xi+fpgMJiMZkMpmM5oNJqNZsNpuP43kJwOJEQwcdUH7APW4UMGmoP4u5IpwoSBXiZ76';

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function makeFakeFile(
  content: string | Uint8Array | ArrayBuffer,
  webkitRelativePath: string,
  type = 'application/octet-stream',
): File {
  const bytes =
    typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content instanceof Uint8Array
        ? content
        : new Uint8Array(content);
  const name = webkitRelativePath.split('/').pop() ?? webkitRelativePath;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], name, { type });
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    configurable: true,
  });
  return file;
}

/**
 * Builds a minimal, clean-room synthetic GameMaker IFF FORM `data.win` archive in memory
 * containing `GEN8`, `SHDR`, `FONT`, `TPAG`, `SPRT` (`block_spr` 6x6 x6 & `container_spr` 68x128),
 * `STRG`, and `TXTR` (`fioq` texture) so all parser paths are verified without Steam.
 */
function buildSyntheticDataWin(): {
  buffer: Uint8Array;
  atlasWidth: number;
  atlasHeight: number;
  expectedPixels: Uint8Array;
} {
  const atlasWidth = 128;
  const atlasHeight = 160;
  const pixels = new Uint8Array(atlasWidth * atlasHeight * 4);

  const setPx = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const off = (y * atlasWidth + x) * 4;
    pixels[off] = r;
    pixels[off + 1] = g;
    pixels[off + 2] = b;
    pixels[off + 3] = a;
  };

  // Paint a crisp 6x6 hollow diamond for block_spr frame 1 at (10, 10)
  const hollow = ['..##..', '.#..#.', '#....#', '#....#', '.#..#.', '..##..'];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      if (hollow[y][x] === '#') setPx(10 + x, 10 + y, 255, 255, 255, 255);
    }
  }
  // Paint a 68x128 container top edge at (20, 20)
  for (let x = 0; x <= 34; x++) {
    setPx(20 + x, 20, 255, 255, 255, 255);
  }

  const fioqBlob = encodeGmQoi(pixels, atlasWidth, atlasHeight);

  // Reserve a clean 64KB scratch image buffer and lay out chunks sequentially
  const buf = new Uint8Array(65536);
  const view = new DataView(buf.buffer);
  const enc = new TextEncoder();

  const writeAscii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
  };

  // String table helper inside STRG
  const stringOffsets = new Map<string, number>();

  // First lay out chunks with known fixed sizes:
  // Header: FORM (8 bytes)
  let cur = 8;

  // GEN8: 48 bytes payload (namePtr at +40)
  writeAscii(cur, 'GEN8');
  view.setUint32(cur + 4, 48, true);
  const gen8Payload = cur + 8;
  cur = gen8Payload + 48;

  // STRG: pre-allocate strings so all pointers resolve cleanly
  const strings = ['synthetic_game', 'block_spr', 'container_spr', 'bloom_filter_luminance_shd', 'main_fnt'];
  const strgChunkPos = cur;
  writeAscii(cur, 'STRG');
  const strgPayload = cur + 8;
  let strCursor = strgPayload + 4 + strings.length * 4;
  view.setUint32(strgPayload, strings.length, true);
  for (let i = 0; i < strings.length; i++) {
    const raw = enc.encode(strings[i]);
    view.setUint32(strgPayload + 4 + i * 4, strCursor, true);
    view.setUint32(strCursor, raw.length, true);
    const charStart = strCursor + 4;
    buf.set(raw, charStart);
    buf[charStart + raw.length] = 0;
    stringOffsets.set(strings[i], charStart);
    strCursor = charStart + raw.length + 1;
  }
  // Align to 4 bytes
  strCursor = (strCursor + 3) & ~3;
  view.setUint32(strgChunkPos + 4, strCursor - strgPayload, true);
  cur = strCursor;

  // Fill GEN8 gameName pointer
  view.setUint32(gen8Payload + 40, stringOffsets.get('synthetic_game')!, true);

  // SHDR: 1 shader entry
  const shdrChunkPos = cur;
  writeAscii(cur, 'SHDR');
  const shdrPayload = cur + 8;
  view.setUint32(shdrPayload, 1, true);
  const shdrEntry = shdrPayload + 8;
  view.setUint32(shdrPayload + 4, shdrEntry, true);
  view.setUint32(shdrEntry, stringOffsets.get('bloom_filter_luminance_shd')!, true);
  view.setUint32(shdrChunkPos + 4, 12, true);
  cur = shdrPayload + 12;

  // FONT: 1 font entry
  const fontChunkPos = cur;
  writeAscii(cur, 'FONT');
  const fontPayload = cur + 8;
  view.setUint32(fontPayload, 1, true);
  const fontEntry = fontPayload + 8;
  view.setUint32(fontPayload + 4, fontEntry, true);
  view.setUint32(fontEntry, stringOffsets.get('main_fnt')!, true);
  view.setUint32(fontChunkPos + 4, 12, true);
  cur = fontPayload + 12;

  // TPAG: 7 entries (6 for block_spr + 1 for container_spr), 22 bytes each
  const tpagChunkPos = cur;
  writeAscii(cur, 'TPAG');
  const tpagPayload = cur + 8;
  const tpagDefs: [number, number, number, number, number, number][] = [
    [10, 10, 6, 6, 6, 6],
    [10, 10, 6, 6, 6, 6],
    [10, 10, 6, 6, 6, 6],
    [10, 10, 6, 6, 6, 6],
    [10, 10, 6, 6, 6, 6],
    [0, 0, 1, 1, 6, 6],
    [20, 20, 68, 128, 68, 128],
  ];
  view.setUint32(tpagPayload, tpagDefs.length, true);
  const tpagPtrs: number[] = [];
  let tpagDataCur = tpagPayload + 4 + tpagDefs.length * 4;
  for (let i = 0; i < tpagDefs.length; i++) {
    tpagPtrs.push(tpagDataCur);
    view.setUint32(tpagPayload + 4 + i * 4, tpagDataCur, true);
    const [x, y, w, h, bw, bh] = tpagDefs[i];
    view.setUint16(tpagDataCur + 0, x, true);
    view.setUint16(tpagDataCur + 2, y, true);
    view.setUint16(tpagDataCur + 4, w, true);
    view.setUint16(tpagDataCur + 6, h, true);
    view.setUint16(tpagDataCur + 8, 0, true);
    view.setUint16(tpagDataCur + 10, 0, true);
    view.setUint16(tpagDataCur + 12, w, true);
    view.setUint16(tpagDataCur + 14, h, true);
    view.setUint16(tpagDataCur + 16, bw, true);
    view.setUint16(tpagDataCur + 18, bh, true);
    view.setUint16(tpagDataCur + 20, 0, true);
    tpagDataCur += 22;
  }
  tpagDataCur = (tpagDataCur + 3) & ~3;
  view.setUint32(tpagChunkPos + 4, tpagDataCur - tpagPayload, true);
  cur = tpagDataCur;

  // SPRT: 2 GMS2 v3 sprites (`block_spr` + `container_spr`)
  const sprtChunkPos = cur;
  writeAscii(cur, 'SPRT');
  const sprtPayload = cur + 8;
  view.setUint32(sprtPayload, 2, true);
  let sprCur = sprtPayload + 4 + 2 * 4;

  const writeSprite = (
    idx: number,
    name: string,
    w: number,
    h: number,
    ox: number,
    oy: number,
    frames: number[],
  ) => {
    view.setUint32(sprtPayload + 4 + idx * 4, sprCur, true);
    view.setUint32(sprCur + 0, stringOffsets.get(name)!, true);
    view.setUint32(sprCur + 4, w, true);
    view.setUint32(sprCur + 8, h, true);
    view.setInt32(sprCur + 48, ox, true);
    view.setInt32(sprCur + 52, oy, true);
    view.setInt32(sprCur + 56, -1, true); // GMS2 extended marker
    view.setUint32(sprCur + 60, 3, true); // sVersion = 3
    view.setUint32(sprCur + 84, frames.length, true);
    for (let f = 0; f < frames.length; f++) {
      view.setUint32(sprCur + 88 + f * 4, frames[f], true);
    }
    sprCur += 88 + frames.length * 4;
  };

  writeSprite(0, 'block_spr', 6, 6, 3, 3, tpagPtrs.slice(0, 6));
  writeSprite(1, 'container_spr', 68, 128, 18, 128, [tpagPtrs[6]]);
  view.setUint32(sprtChunkPos + 4, sprCur - sprtPayload, true);
  cur = sprCur;

  // TXTR: 1 texture entry pointing to fioqBlob
  const txtrChunkPos = cur;
  writeAscii(cur, 'TXTR');
  const txtrPayload = cur + 8;
  view.setUint32(txtrPayload, 1, true);
  const txEntryPtr = txtrPayload + 8;
  view.setUint32(txtrPayload + 4, txEntryPtr, true);
  const blobOffset = txEntryPtr + 16;
  view.setUint32(txEntryPtr + 0, 1, true); // scaled
  view.setUint32(txEntryPtr + 4, 0, true); // generatedMips
  view.setUint32(txEntryPtr + 8, blobOffset, true); // textureDataOffset
  buf.set(fioqBlob, blobOffset);
  const txtrEnd = blobOffset + fioqBlob.length;
  view.setUint32(txtrChunkPos + 4, txtrEnd - txtrPayload, true);
  cur = txtrEnd;

  // Finalize FORM header
  writeAscii(0, 'FORM');
  view.setUint32(4, cur - 8, true);

  return {
    buffer: buf.slice(0, cur),
    atlasWidth,
    atlasHeight,
    expectedPixels: pixels,
  };
}

function createMockRenderer(): {
  renderer: WebGL2Renderer;
  calls: {
    setCustomAtlas: Array<{ w: number; h: number; sprites: Record<string, SpriteAssetEntry> }>;
    resetBuiltinAtlas: number;
    setCustomCover: Array<{ trackId: string; w: number; h: number }>;
    resetBuiltinCovers: number;
  };
} {
  const calls = {
    setCustomAtlas: [] as Array<{ w: number; h: number; sprites: Record<string, SpriteAssetEntry> }>,
    resetBuiltinAtlas: 0,
    setCustomCover: [] as Array<{ trackId: string; w: number; h: number }>,
    resetBuiltinCovers: 0,
  };

  const renderer = {
    setCustomAtlas: (
      _pixels: Uint8Array,
      width: number,
      height: number,
      sprites: Record<string, SpriteAssetEntry>,
    ) => {
      calls.setCustomAtlas.push({ w: width, h: height, sprites });
    },
    resetBuiltinAtlas: () => {
      calls.resetBuiltinAtlas += 1;
    },
    setCustomCover: (trackId: string, _pixels: Uint8Array, width: number, height: number) => {
      calls.setCustomCover.push({ trackId, w: width, h: height });
    },
    resetBuiltinCovers: () => {
      calls.resetBuiltinCovers += 1;
    },
  } as unknown as WebGL2Renderer;

  return { renderer, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// 1. PURE-TS BZIP2, GM-QOI (`fioq`/`2zoq`), AND PNG CODEC TESTS (CLEAN-ROOM)
// ============================================================================

describe('qoiDecoder — Pure-TS BZip2, GM-QOI, and PNG codecs', () => {
  it('decompresses standard BZh9 and BZh1 streams with RLE1/RLE2/BWT & CRC verification', () => {
    const out1 = decompressBzip2(fromBase64(BZIP2_VEC_1_B64));
    expect(new TextDecoder().decode(out1)).toBe(BZIP2_VEC_1_EXPECTED);

    const out2 = decompressBzip2(fromBase64(BZIP2_VEC_2_B64));
    const expected2 = new Uint8Array(5 + 12 + 260 + 3 + 64 * 4);
    let o = 0;
    expected2.fill(0x41, o, (o += 5)); // 'AAAAA'
    expected2.fill(0x42, o, (o += 12)); // 'B' * 12
    expected2.fill(0x43, o, (o += 260)); // 'C' * 260 (exercises RLE1 max repeat > 255!)
    expected2[o++] = 0x58; // 'X'
    expected2[o++] = 0x59; // 'Y'
    expected2[o++] = 0x5a; // 'Z'
    for (let rep = 0; rep < 4; rep++) {
      for (let v = 0; v < 64; v++) expected2[o++] = v;
    }
    expect(out2).toEqual(expected2);
  });

  it('rejects invalid BZip2 magic and corrupted block CRC', () => {
    expect(() => decompressBzip2(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toThrow(
      /magic/i,
    );

    const corrupted = fromBase64(BZIP2_VEC_1_B64).slice();
    // Flip a bit in the stored block CRC byte (bytes 10..13)
    corrupted[10] ^= 0x01;
    expect(() => decompressBzip2(corrupted)).toThrow(/CRC/i);
  });

  it('roundtrips GM-QOI (fioq) losslessly across INDEX64, RUN8, RUN16, DIFF8, DIFF16, DIFF24, COLOR', () => {
    const width = 64;
    const height = 8;
    const total = width * height;
    const pixels = new Uint8Array(total * 4);

    let r = 10;
    let g = 20;
    let b = 30;
    let a = 255;

    for (let i = 0; i < total; i++) {
      if (i < 5) {
        // RUN8 (repeat initial-ish color)
        r = 10; g = 20; b = 30; a = 255;
      } else if (i < 60) {
        // RUN16 (55 repeats > 32)
        r = 255; g = 255; b = 255; a = 255;
      } else if (i < 80) {
        // DIFF8 small RGB steps (-2..+1)
        r = (r + ((i % 4) - 2)) & 0xff;
        g = (g + (((i + 1) % 4) - 2)) & 0xff;
        b = (b + (((i + 2) % 4) - 2)) & 0xff;
      } else if (i < 110) {
        // DIFF16 medium RGB steps (dr up to -12..+12, dg/db -6..+6)
        r = (r + (i % 2 === 0 ? 11 : -9)) & 0xff;
        g = (g + (i % 2 === 0 ? 5 : -4)) & 0xff;
        b = (b + (i % 2 === 0 ? -6 : 6)) & 0xff;
      } else if (i < 160) {
        // DIFF24 with alpha deltas (-12..+12)
        r = (r + 3) & 0xff;
        g = (g - 5) & 0xff;
        b = (b + 7) & 0xff;
        a = (a - 9) & 0xff;
      } else if (i < 220) {
        // COLOR large jumps + INDEX64 repeats
        const palette = [
          [0, 0, 0, 0],
          [255, 0, 77, 255],
          [41, 173, 255, 200],
          [255, 236, 39, 128],
        ];
        [r, g, b, a] = palette[i % palette.length];
      } else {
        // Trailing RUN16 to end of buffer
        r = 0; g = 0; b = 0; a = 0;
      }

      const off = i * 4;
      pixels[off] = r;
      pixels[off + 1] = g;
      pixels[off + 2] = b;
      pixels[off + 3] = a;
    }

    const encoded = encodeGmQoi(pixels, width, height);
    expect(String.fromCharCode(...encoded.subarray(0, 4))).toBe('fioq');

    const decoded = decodeGmQoi(encoded);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.pixels).toEqual(pixels);
  });

  it('validates 2zoq header errors cleanly', () => {
    expect(() => decode2zoqTexture(new Uint8Array(10))).toThrow(/too short/i);
    const bad = new Uint8Array(32);
    bad.set([0x30, 0x30, 0x30, 0x30], 0);
    expect(() => decode2zoqTexture(bad)).toThrow(/magic/i);
  });

  it('encodes valid lossless RGBA PNGs using both pure-TS stored zlib and node:zlib deflate', () => {
    const w = 8;
    const h = 6;
    const pixels = new Uint8Array(w * h * 4);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = (i * 37) & 0xff;
    }

    for (const compress of [
      undefined,
      (raw: Uint8Array) => new Uint8Array(zlib.deflateSync(raw, { level: 9 })),
    ]) {
      const png = encodeRgbaToPng(pixels, w, h, compress);
      // Verify PNG signature
      expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      // IHDR
      expect(view.getUint32(8, false)).toBe(13);
      expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
      expect(view.getUint32(16, false)).toBe(w);
      expect(view.getUint32(20, false)).toBe(h);
      expect(png[24]).toBe(8); // bit depth
      expect(png[25]).toBe(6); // RGBA

      // IDAT
      const idatLen = view.getUint32(33, false);
      expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT');
      const idatPayload = png.subarray(41, 41 + idatLen);
      const inflated = new Uint8Array(zlib.inflateSync(idatPayload));

      // Reconstruct RGBA rows from scanlines (filter byte 0 + w*4 bytes per row)
      const reconstructed = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        const rowStart = y * (w * 4 + 1);
        expect(inflated[rowStart]).toBe(0);
        reconstructed.set(inflated.subarray(rowStart + 1, rowStart + 1 + w * 4), y * w * 4);
      }
      expect(reconstructed).toEqual(pixels);

      // IEND
      const iendOff = 41 + idatLen + 4;
      expect(view.getUint32(iendOff, false)).toBe(0);
      expect(String.fromCharCode(...png.subarray(iendOff + 4, iendOff + 8))).toBe('IEND');
    }
  });
});

// ============================================================================
// 2. SYNTHETIC data.win PARSER & BROWSER PACK LOADER TESTS (CLEAN-ROOM)
// ============================================================================

describe('customPackLoader — Synthetic data.win & browser directory upload', () => {
  it('parses synthetic IFF FORM data.win with TXTR, TPAG, SPRT, SHDR, and FONT chunks', () => {
    const synth = buildSyntheticDataWin();
    const parsed = parseDataWin(synth.buffer);

    expect(parsed.gameName).toBe('synthetic_game');
    expect(parsed.atlasWidth).toBe(synth.atlasWidth);
    expect(parsed.atlasHeight).toBe(synth.atlasHeight);
    expect(parsed.atlasPixels).toEqual(synth.expectedPixels);
    expect(parsed.spriteCount).toBe(2);
    expect(parsed.tpagCount).toBe(7);
    expect(parsed.shaderNames).toEqual(['bloom_filter_luminance_shd']);
    expect(parsed.fontNames).toEqual(['main_fnt']);

    expect(parsed.sprites['block_spr'].width).toBe(6);
    expect(parsed.sprites['block_spr'].height).toBe(6);
    expect(parsed.sprites['block_spr'].frames).toHaveLength(6);
    expect(parsed.sprites['container_spr'].width).toBe(68);
    expect(parsed.sprites['container_spr'].height).toBe(128);
    expect(parsed.sprites['container_spr'].frames).toHaveLength(1);
  });

  it('loads a raw retail-layout File[] directory in-browser (decoding data.win + palettes.ini + tracklist + audio)', async () => {
    const synth = buildSyntheticDataWin();
    const ini = [
      '[0]',
      'name=Custom Dark',
      '0=000000',
      '1=1d2b53',
      '2=fff7f2',
      '3=ffec27',
      '4=29adff',
      '5=ff004d',
      '',
      '[1]',
      'name=Custom Light',
      '0=fff1e8',
      '1=f0d4d3',
      '2=1d2b53',
      '3=ffa300',
      '4=29adff',
      '5=ff004d',
    ].join('\n');

    const dummyCoverPng = encodeRgbaToPng(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
    const trackJson = JSON.stringify({
      title: 'Tessellation Custom',
      author: 'Test Author',
      bpm: 120,
      loops: { start: { audio: 'start.ogg', length: 16, progression: 'p0' } },
      progressions: { p0: [['d', 'm', 'c', 'k']] },
    });

    const files = [
      makeFakeFile(synth.buffer, 'Mixolumia/data.win'),
      makeFakeFile(ini, 'Mixolumia/data/palettes.ini'),
      makeFakeFile('{"standard":["tessellation"],"rush":["rush"]}', 'Mixolumia/data/tracklist.json'),
      makeFakeFile('language_id,en_us\nmainmenu_start,Start\n', 'Mixolumia/data/localization/en_us.csv'),
      makeFakeFile(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), 'Mixolumia/data/audio/menu_move.ogg'),
      makeFakeFile(trackJson, 'Mixolumia/data/music/tessellation/data.json'),
      makeFakeFile(dummyCoverPng, 'Mixolumia/data/music/tessellation/cover.png'),
      makeFakeFile(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), 'Mixolumia/data/music/tessellation/start.ogg'),
    ];

    const pack = await loadCustomPackFromBrowserFiles(files);
    expect(pack.manifest.version).toBe(1);
    expect(pack.manifest.source).toBe('browser-uploaded');
    expect(pack.atlasWidth).toBe(synth.atlasWidth);
    expect(pack.atlasHeight).toBe(synth.atlasHeight);
    expect(pack.sprites['block_spr'].frames).toHaveLength(6);
    expect(pack.sprites['container_spr'].width).toBe(68);
    expect(pack.palettes).toHaveLength(2);
    expect(pack.palettes[0].name).toBe('Custom Dark');
    expect(pack.tracklist?.standard).toEqual(['tessellation']);
    expect(pack.manifest.menuAudioFiles).toEqual(['audio/menu_move.ogg']);
    expect(pack.manifest.tracks['tessellation'].coverFile).toBe('music/tessellation/cover.png');
    expect(pack.manifest.tracks['tessellation'].audioFiles).toEqual(['music/tessellation/start.ogg']);
    expect(pack.coverPngBytes['tessellation']?.byteLength).toBe(dummyCoverPng.byteLength);
    expect(pack.audioFiles.has('music/tessellation/data.json')).toBe(true);
    expect(pack.audioFiles.has('music/tessellation/start.ogg')).toBe(true);
    expect(pack.localizationCsv).toContain('mainmenu_start,Start');
  });

  it('loads an extracted .lumia-assets/-layout File[] directory cleanly', async () => {
    const manifest: CustomPackManifest = {
      version: 1,
      source: 'steam-extracted',
      extractedAt: '2026-01-01T00:00:00.000Z',
      atlasWidth: 1024,
      atlasHeight: 1024,
      atlasFile: 'atlas.png',
      sprites: {
        block_spr: {
          name: 'block_spr',
          width: 6,
          height: 6,
          originX: 3,
          originY: 3,
          frames: [
            { x: 0, y: 0, w: 6, h: 6, targetX: 0, targetY: 0, targetW: 6, targetH: 6, boundW: 6, boundH: 6 },
          ],
        },
      },
      paletteCount: 1,
      palettesFile: 'palettes.ini',
      tracklistFile: 'tracklist.json',
      tracks: {},
      menuAudioFiles: [],
      localizationFile: null,
    };

    const files = [
      makeFakeFile(JSON.stringify(manifest), '.lumia-assets/manifest.json'),
      makeFakeFile('[0]\nname=Solo\n0=000000\n1=111111\n2=222222\n3=333333\n4=444444\n5=555555\n', '.lumia-assets/palettes.ini'),
    ];

    const pack = await loadCustomPackFromBrowserFiles(files);
    expect(pack.palettes).toHaveLength(1);
    expect(pack.sprites['block_spr'].width).toBe(6);
    expect(pack.atlasWidth).toBe(1024);
  });

  it('throws cleanly when given empty or unrecognized files', async () => {
    await expect(loadCustomPackFromBrowserFiles([])).rejects.toThrow(/no files/i);
    await expect(
      loadCustomPackFromBrowserFiles([makeFakeFile('hello', 'random/readme.txt')]),
    ).rejects.toThrow(/no compatible pack assets/i);
  });
});

// ============================================================================
// 3. PACK MANAGER & SPRITE ADAPTER TESTS (CLEAN-ROOM)
// ============================================================================

describe('PackManager — Discovery, hot-swap, and sprite adaptation', () => {
  it('adapts retail block_spr frame ordering and container_spr origin while preserving menu icons', () => {
    const mkFrame = (x: number, w = 6, h = 6) => ({
      x,
      y: 0,
      w,
      h,
      targetX: 0,
      targetY: 0,
      targetW: w,
      targetH: h,
      boundW: 6,
      boundH: 6,
    });

    const raw: Record<string, SpriteAssetEntry> = {
      block_spr: {
        name: 'block_spr',
        width: 6,
        height: 6,
        originX: 3,
        originY: 3,
        frames: [
          mkFrame(10), // retail 0: solid
          mkFrame(20), // retail 1: empty
          mkFrame(30), // retail 2: filled
          mkFrame(40), // retail 3: hole
          mkFrame(50), // retail 4: target
          mkFrame(60, 1, 1), // retail 5: blank 1x1
        ],
      },
      container_spr: {
        name: 'container_spr',
        width: 68,
        height: 128,
        originX: 18,
        originY: 128,
        frames: [mkFrame(100, 68, 128)],
      },
      mode_icon_spr: {
        name: 'mode_icon_spr',
        width: 32,
        height: 32,
        originX: 16,
        originY: 16,
        frames: [mkFrame(200, 32, 32)],
      },
      arrow_spr: {
        name: 'arrow_spr',
        width: 10,
        height: 20,
        originX: 0,
        originY: 10,
        frames: [mkFrame(240, 10, 20)],
      },
    };

    const adapted = adaptCustomSpritesForRenderer(raw);
    expect(adapted['block_spr'].originX).toBe(3);
    expect(adapted['block_spr'].originY).toBe(3);
    // Krunked order: [empty=20, filled=30, hole=40, target=50, guide=20, ripple=10]
    expect(adapted['block_spr'].frames.map((f) => f.x)).toEqual([20, 30, 40, 50, 20, 10]);

    expect(adapted['container_spr'].originX).toBe(0);
    expect(adapted['container_spr'].originY).toBe(0);

    expect(adapted['mode_icon_spr']).toBeUndefined();
    expect(adapted['arrow_spr']).toBeUndefined();
  });

  it('handles 404 local probe gracefully without throwing and defaults to BUILT-IN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ available: false }), { status: 404 })),
    );

    const pm = new PackManager();
    await pm.init();

    expect(pm.isCustomPackAvailable()).toBe(false);
    expect(pm.getPackMode()).toBe('builtin');
    expect(pm.getStatusLabel()).toBe('PACK: BUILT-IN');
    expect(pm.getCustomPalettes()).toEqual([]);

    const { renderer } = createMockRenderer();
    const audio = new HarmonicAudioEngine();
    expect(await pm.applyPackMode('custom', renderer, audio)).toBe(false);
    audio.dispose();
  });

  it('auto-detects mocked local dev pack, loads palettes, and hot-swaps modes cleanly', async () => {
    const manifest: CustomPackManifest = {
      version: 1,
      source: 'steam-extracted',
      extractedAt: '2026-01-01T00:00:00.000Z',
      atlasWidth: 16,
      atlasHeight: 16,
      atlasFile: 'atlas.png',
      sprites: {},
      paletteCount: 2,
      palettesFile: 'palettes.ini',
      tracklistFile: 'tracklist.json',
      tracks: {
        tessellation: {
          dataFile: 'music/tessellation/data.json',
          coverFile: null,
          audioFiles: [],
        },
      },
      menuAudioFiles: [],
      localizationFile: null,
    };

    const ini =
      '[0]\nname=Local Dark\n0=000000\n1=111111\n2=ffffff\n3=ffec27\n4=29adff\n5=ff004d\n' +
      '[1]\nname=Local Light\n0=fff1e8\n1=f0d4d3\n2=1d2b53\n3=ffa300\n4=29adff\n5=ff004d\n';

    const trackData = JSON.stringify({
      title: 'Local Tessellation',
      bpm: 124,
      loops: { start: { audio: 'start.ogg', length: 16, progression: 'p0' } },
      progressions: { p0: [['d', 'm', 'c', 'k']] },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/manifest.json')) {
          return new Response(JSON.stringify(manifest), { status: 200 });
        }
        if (url.endsWith('/palettes.ini')) {
          return new Response(ini, { status: 200 });
        }
        if (url.endsWith('/music/tessellation/data.json')) {
          return new Response(trackData, { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const pm = new PackManager();
    await pm.init();

    expect(pm.isCustomPackAvailable()).toBe(true);
    expect(pm.getCustomPalettes()).toHaveLength(2);
    expect(pm.getStatusLabel()).toBe('PACK: BUILT-IN');

    const { renderer, calls } = createMockRenderer();
    const audio = new HarmonicAudioEngine();

    const applied = await pm.applyPackMode('custom', renderer, audio);
    expect(applied).toBe(true);
    expect(pm.getPackMode()).toBe('custom');
    expect(pm.getStatusLabel()).toBe('PACK: CUSTOM (LOCAL)');
    expect(audio.getPackMode()).toBe('custom');
    expect(audio.getActiveManifest('tessellation').title).toBe('Local Tessellation');

    const restored = await pm.applyPackMode('builtin', renderer, audio);
    expect(restored).toBe(true);
    expect(pm.getPackMode()).toBe('builtin');
    expect(pm.getStatusLabel()).toBe('PACK: BUILT-IN');
    expect(calls.resetBuiltinAtlas).toBe(1);
    expect(calls.resetBuiltinCovers).toBe(1);
    expect(audio.getPackMode()).toBe('builtin');
    audio.dispose();
  });

  it('loads browser FileList pack, hot-swaps custom atlas to WebGL2Renderer, and clears cleanly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 })),
    );

    const synth = buildSyntheticDataWin();
    const files = [
      makeFakeFile(synth.buffer, 'Mixolumia/data.win'),
      makeFakeFile(
        '[0]\nname=Uploaded\n0=000000\n1=1d2b53\n2=fff7f2\n3=ffec27\n4=29adff\n5=ff004d\n',
        'Mixolumia/data/palettes.ini',
      ),
    ];

    const pm = new PackManager();
    await pm.init();
    const res = await pm.loadFromFileList(files);
    expect(res.ok).toBe(true);
    expect(pm.isCustomPackAvailable()).toBe(true);
    expect(pm.getCustomPalettes()).toHaveLength(1);

    const { renderer, calls } = createMockRenderer();
    const audio = new HarmonicAudioEngine();
    expect(await pm.applyPackMode('custom', renderer, audio)).toBe(true);
    expect(pm.getStatusLabel()).toBe('PACK: CUSTOM (IDB)');
    expect(calls.setCustomAtlas).toHaveLength(1);
    expect(calls.setCustomAtlas[0].w).toBe(synth.atlasWidth);
    expect(calls.setCustomAtlas[0].h).toBe(synth.atlasHeight);
    expect(calls.setCustomAtlas[0].sprites['container_spr'].originX).toBe(0);
    expect(calls.setCustomAtlas[0].sprites['container_spr'].originY).toBe(0);

    await pm.clearSavedCustomPack();
    expect(pm.isCustomPackAvailable()).toBe(false);
    expect(pm.getPackMode()).toBe('builtin');
    expect(pm.getStatusLabel()).toBe('PACK: BUILT-IN');
    audio.dispose();
  });
});

// ============================================================================
// 4. REAL RETAIL READ-ONLY VERIFICATION (Skipped cleanly when Steam absent)
// ============================================================================

describe.skipIf(!HAS_RETAIL_DATA_WIN)('Retail Mixolumia v1.6.1 READ-ONLY verification', () => {
  it('decodes retail data.win 2zoq texture losslessly with pixel-exact block_spr & container_spr', () => {
    const rawDataWin = fs.readFileSync(RETAIL_DATA_WIN);
    const parsed = parseDataWin(rawDataWin);

    expect(parsed.atlasWidth).toBe(1024);
    expect(parsed.atlasHeight).toBe(1024);
    expect(parsed.atlasPixels.length).toBe(1024 * 1024 * 4);
    expect(parsed.spriteCount).toBe(97);
    expect(parsed.tpagCount).toBe(352);

    // Proof of 100% lossless zero-corruption decode: every pixel in Mixolumia's monochrome atlas
    // must have R === G === B and be pure 0 or 255 (only alpha varies on antialiased glyphs)
    let nonMonoCount = 0;
    for (let i = 0; i < parsed.atlasPixels.length; i += 4) {
      const r = parsed.atlasPixels[i];
      const g = parsed.atlasPixels[i + 1];
      const b = parsed.atlasPixels[i + 2];
      if (r !== g || g !== b || (r !== 0 && r !== 255)) {
        nonMonoCount += 1;
      }
    }
    expect(nonMonoCount).toBe(0);

    // Verify block_spr (6x6, 6 frames) exact diamond silhouettes
    const blockSpr = parsed.sprites['block_spr'];
    expect(blockSpr).toBeDefined();
    expect(blockSpr.width).toBe(6);
    expect(blockSpr.height).toBe(6);
    expect(blockSpr.originX).toBe(3);
    expect(blockSpr.originY).toBe(3);
    expect(blockSpr.frames).toHaveLength(6);

    const readFrameAscii = (frameIdx: number): string[] => {
      const f = blockSpr.frames[frameIdx];
      const rows: string[] = [];
      for (let dy = 0; dy < f.h; dy++) {
        let row = '';
        for (let dx = 0; dx < f.w; dx++) {
          const off = ((f.y + dy) * parsed.atlasWidth + (f.x + dx)) * 4;
          row += parsed.atlasPixels[off + 3] > 128 ? '#' : '.';
        }
        rows.push(row);
      }
      return rows;
    };

    const SOLID_6X6 = ['..##..', '.####.', '######', '######', '.####.', '..##..'];
    const EMPTY_6X6 = ['..##..', '.#..#.', '#....#', '#....#', '.#..#.', '..##..'];
    const HOLE_6X6 = ['..##..', '.####.', '##..##', '##..##', '.####.', '..##..'];
    const TARGET_6X6 = ['..##..', '.#..#.', '#.##.#', '#.##.#', '.#..#.', '..##..'];

    expect(readFrameAscii(0)).toEqual(SOLID_6X6);
    expect(readFrameAscii(1)).toEqual(EMPTY_6X6);
    expect(readFrameAscii(2)).toEqual(SOLID_6X6);
    expect(readFrameAscii(3)).toEqual(HOLE_6X6);
    expect(readFrameAscii(4)).toEqual(TARGET_6X6);

    // Verify container_spr (68x128, 1 frame) exact diamond outline geometry
    const containerSpr = parsed.sprites['container_spr'];
    expect(containerSpr).toBeDefined();
    expect(containerSpr.width).toBe(68);
    expect(containerSpr.height).toBe(128);
    expect(containerSpr.frames).toHaveLength(1);

    const cf = containerSpr.frames[0];
    let litCount = 0;
    for (let dy = 0; dy < cf.h; dy++) {
      for (let dx = 0; dx < cf.w; dx++) {
        const off = ((cf.y + dy) * parsed.atlasWidth + (cf.x + dx)) * 4;
        if (parsed.atlasPixels[off + 3] > 128) litCount += 1;
      }
    }
    // Symmetric 68x128 diamond-hexagon frame: 2 (top apex) + 33*4 (roof) + 60*2 (walls) + 33*4 (funnel) + 2 (bottom apex) = 388
    expect(litCount).toBe(388);

    // Top apex y=0 (x=33..34 lit), vertical walls y=60 (x=0,67 lit), bottom apex y=127 (x=33..34 lit)
    for (let x = 0; x < 68; x++) {
      const topAlpha = parsed.atlasPixels[(cf.y * parsed.atlasWidth + cf.x + x) * 4 + 3];
      expect(topAlpha > 128).toBe(x === 33 || x === 34);
      const midAlpha = parsed.atlasPixels[((cf.y + 60) * parsed.atlasWidth + cf.x + x) * 4 + 3];
      expect(midAlpha > 128).toBe(x === 0 || x === 67);
      const botAlpha = parsed.atlasPixels[((cf.y + 127) * parsed.atlasWidth + cf.x + x) * 4 + 3];
      expect(botAlpha > 128).toBe(x === 33 || x === 34);
    }

    // Verify retail palettes.ini parses cleanly to 63 palettes
    const retailPalettes = parsePalettesIni(fs.readFileSync(RETAIL_PALETTES_INI, 'utf8'));
    expect(retailPalettes).toHaveLength(63);
  });
});
