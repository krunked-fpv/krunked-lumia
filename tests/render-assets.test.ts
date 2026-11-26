import { describe, expect, it } from 'vitest';
import {
  ALL_TRACK_IDS,
  CONTAINER_HEIGHT,
  CONTAINER_WIDTH,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type Palette,
  type RenderSettings,
  type SimEvent,
  type SpriteFrameRect,
  type UserSettings,
} from '../src/contracts/index.js';
import {
  BUILTIN_ATLAS_HEIGHT,
  BUILTIN_ATLAS_WIDTH,
  generateAllTrackCovers,
  generateBuiltinAtlas,
  generateTrackCoverPixels,
  getContainerRowBounds,
  TRACK_COVER_SIZE,
} from '../src/assets/proceduralArt.js';
import {
  drawPixelText,
  FONT_3X5,
  FONT_5X7,
  measurePixelText,
  type PixelTextBatchTarget,
} from '../src/assets/bitmapFont.js';
import {
  BLEND_DARKEN_FRAG_SRC,
  BLOOM_FILTER_LUMINANCE_FRAG_SRC,
  BLUR_2_PASS_GAUSS_LERP_FRAG_SRC,
  COLOR_THRESHOLD_FRAG_SRC,
  COLOR_THRESHOLD_VERT_SRC,
  PRESENT_VERT_SRC,
  SHADER_NAMES,
  SPRITE_FRAG_SRC,
  SPRITE_VERT_SRC,
} from '../src/render/shaders.js';
import {
  computeBgDiamondAlpha,
  MAX_BANNERS,
  MAX_BG_GEOMETRY,
  MAX_PARTICLES,
  ParticlesAndBg,
  type ParticleRenderTarget,
} from '../src/render/ParticlesAndBg.js';
import {
  BOARD_ZOOM_FACTOR,
  computeLetterboxRect,
  type ViewportTransform,
} from '../src/render/WebGL2Renderer.js';
import { InputManager, mapClientToLogical } from '../src/input/InputManager.js';

function countOpaqueWhitePixels(
  pixels: Uint8Array,
  atlasWidth: number,
  rect: SpriteFrameRect,
): number {
  let count = 0;
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const idx = ((rect.y + dy) * atlasWidth + (rect.x + dx)) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];
      if (a > 0) {
        expect(r).toBe(255);
        expect(g).toBe(255);
        expect(b).toBe(255);
        count++;
      }
    }
  }
  return count;
}

function readFrameBitmask(pixels: Uint8Array, atlasWidth: number, rect: SpriteFrameRect): string {
  let out = '';
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const idx = ((rect.y + dy) * atlasWidth + (rect.x + dx)) * 4;
      out += pixels[idx + 3] > 0 ? '#' : '.';
    }
  }
  return out;
}

function makeTestPalette(light = false): Palette {
  return light
    ? {
        id: 'pico_light',
        name: 'Pico Light',
        colors: ['#fff1e8', '#f0d4d3', '#1d2b53', '#ffa300', '#29adff', '#ff004d'],
      }
    : {
        id: 'pico_dark',
        name: 'Pico Dark',
        colors: ['#000000', '#1d2b53', '#fff7f2', '#ffec27', '#29adff', '#ff004d'],
      };
}

function makeTestRenderSettings(): RenderSettings {
  return {
    targetFps: 60,
    native60Snap: false,
    bloomAmount: 1,
    boardShake: true,
    boardRipple: true,
    particles: true,
    flashing: true,
    bgShapes: true,
    boardColors: true,
    boardZoom: false,
    tateRotate: false,
  };
}

function makeTestUserSettings(): UserSettings {
  return {
    paletteId: 'pico_dark',
    render: makeTestRenderSettings(),
    gameplay: {
      dropPreviewOpacity: 0.5,
      nextBlockLocation: 'upper_right',
      preciseTimer: false,
      moveSpeedIndex: 3,
      kbMoveDelay: 8,
      gpMoveDelay: 10,
      gamepadRumble: true,
      tutorialEnabled: false,
      soundtestEnabled: false,
    },
    audio: { masterVolume: 0.8, muted: false },
    keyboard: {
      up: ['ArrowUp', 'KeyW'],
      down: ['ArrowDown', 'KeyS'],
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
      confirm: ['Enter', 'Space', 'KeyZ'],
      cancel: ['Escape', 'Backspace', 'KeyX'],
      moveLeft: ['ArrowLeft', 'KeyA'],
      moveRight: ['ArrowRight', 'KeyD'],
      hardDrop: ['ArrowDown', 'KeyS', 'Space'],
      spinLeft: ['KeyZ', 'KeyQ'],
      spinRight: ['KeyX', 'KeyE', 'ArrowUp'],
      pause: ['Escape', 'KeyP'],
    },
    gamepad: {
      up: [12],
      down: [13],
      left: [14],
      right: [15],
      confirm: [0],
      cancel: [1],
      moveLeft: [14],
      moveRight: [15],
      hardDrop: [13],
      spinLeft: [2],
      spinRight: [0],
      pause: [9],
    },
    packMode: 'builtin',
    photosensitivitySeen: true,
  };
}

describe('Procedural Built-In Pixel Art Atlas', () => {
  const atlas = generateBuiltinAtlas();

  it('generates exact 512x512 RGBA Uint8Array atlas without DOM', () => {
    expect(atlas.width).toBe(BUILTIN_ATLAS_WIDTH);
    expect(atlas.height).toBe(BUILTIN_ATLAS_HEIGHT);
    expect(atlas.pixels).toBeInstanceOf(Uint8Array);
    expect(atlas.pixels.length).toBe(BUILTIN_ATLAS_WIDTH * BUILTIN_ATLAS_HEIGHT * 4);
  });

  it('generates all 6 block_spr 6x6 monochrome diamond frames with exact pixel counts (12, 24, 20, 16)', () => {
    const block = atlas.sprites['block_spr'];
    expect(block).toBeDefined();
    expect(block.width).toBe(6);
    expect(block.height).toBe(6);
    expect(block.frames.length).toBe(6);

    const counts = block.frames.map((frame) =>
      countOpaqueWhitePixels(atlas.pixels, atlas.width, frame),
    );
    expect(counts[0]).toBe(12); // Empty block: 1px hollow diamond outline
    expect(counts[1]).toBe(24); // Filled block: solid 6x6 diamond
    expect(counts[2]).toBe(20); // Hole block: thick ring with 2x2 center cutout
    expect(counts[3]).toBe(16); // Target block: 1px outline + 2x2 bullseye dot
    expect(counts[4]).toBe(8); // Guide/Ghost corner dots
    expect(counts[5]).toBe(12); // Automata 4x4 interior diamond

    // Verify all 4 primary block shapes are visually distinct in 1-bit monochrome
    const masks = block.frames
      .slice(0, 4)
      .map((f) => readFrameBitmask(atlas.pixels, atlas.width, f));
    expect(new Set(masks).size).toBe(4);
  });

  it('generates exact 68x128 container_spr border and disjoint container_fill_spr mask', () => {
    const container = atlas.sprites['container_spr'];
    const fill = atlas.sprites['container_fill_spr'];
    expect(container).toBeDefined();
    expect(fill).toBeDefined();
    expect(container.width).toBe(CONTAINER_WIDTH);
    expect(container.height).toBe(CONTAINER_HEIGHT);
    expect(fill.width).toBe(CONTAINER_WIDTH);
    expect(fill.height).toBe(CONTAINER_HEIGHT);

    const borderPx = countOpaqueWhitePixels(atlas.pixels, atlas.width, container.frames[0]);
    const fillPx = countOpaqueWhitePixels(atlas.pixels, atlas.width, fill.frames[0]);
    expect(borderPx).toBeGreaterThan(250);
    expect(fillPx).toBeGreaterThan(4000);

    // Check top hairline & bottom V apex
    expect(getContainerRowBounds(33)).toEqual({ left: 0, right: 67 });
    expect(getContainerRowBounds(94)).toEqual({ left: 0, right: 67 });
    expect(getContainerRowBounds(127)).toEqual({ left: 33, right: 34 });

    // Border and interior fill must never overlap
    const cRect = container.frames[0];
    const fRect = fill.frames[0];
    for (let y = 0; y < CONTAINER_HEIGHT; y++) {
      for (let x = 0; x < CONTAINER_WIDTH; x++) {
        const cA = atlas.pixels[((cRect.y + y) * atlas.width + (cRect.x + x)) * 4 + 3];
        const fA = atlas.pixels[((fRect.y + y) * atlas.width + (fRect.x + x)) * 4 + 3];
        expect(cA > 0 && fA > 0).toBe(false);
      }
    }
  });

  it('generates all UI, icon, and background sprites with non-empty crisp white pixels', () => {
    const required: Array<[string, number, number, number]> = [
      ['pixel_spr', 1, 2, 2],
      ['bg_diamond_spr', 2, 32, 32],
      ['mode_icon_spr', 6, 16, 16],
      ['tutorial_icons', 5, 16, 16],
      ['arrow_spr', 4, 7, 7],
      ['checkmark_spr', 2, 9, 9],
      ['lock_spr', 2, 10, 12],
    ];
    for (const [name, expectedFrames, w, h] of required) {
      const entry = atlas.sprites[name];
      expect(entry, `missing sprite ${name}`).toBeDefined();
      expect(entry.frames.length).toBe(expectedFrames);
      expect(entry.width).toBe(w);
      expect(entry.height).toBe(h);
      for (const frame of entry.frames) {
        expect(countOpaqueWhitePixels(atlas.pixels, atlas.width, frame)).toBeGreaterThan(0);
      }
    }
  });

  it('generates all 8 distinct 96x96 monochrome RGBA track covers cleanly', () => {
    const covers = generateAllTrackCovers();
    const signatures = new Set<string>();

    for (const trackId of ALL_TRACK_IDS) {
      const buf = covers[trackId];
      expect(buf).toBeInstanceOf(Uint8Array);
      expect(buf.length).toBe(TRACK_COVER_SIZE * TRACK_COVER_SIZE * 4);

      let whiteCount = 0;
      let blackCount = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i];
        const g = buf[i + 1];
        const b = buf[i + 2];
        const a = buf[i + 3];
        expect(a).toBe(255);
        expect(r === g && g === b).toBe(true);
        expect(r === 0 || r === 255).toBe(true);
        if (r === 255) whiteCount++;
        else blackCount++;
      }
      expect(whiteCount).toBeGreaterThan(200);
      expect(blackCount).toBeGreaterThan(200);

      // Deterministic regeneration & uniqueness across all 8 tracks
      const again = generateTrackCoverPixels(trackId);
      expect(again).toEqual(buf);
      let hash = 2166136261;
      for (let i = 0; i < buf.length; i += 4) {
        hash = Math.imul(hash ^ buf[i], 16777619);
      }
      signatures.add(`${hash >>> 0}`);
    }
    expect(signatures.size).toBe(ALL_TRACK_IDS.length);
  });
});

describe('Pixel Bitmap Fonts (5x7 & 3x5)', () => {
  const atlas = generateBuiltinAtlas();

  it('covers full printable ASCII 32..126 in both FONT_5X7 and FONT_3X5', () => {
    for (let code = 32; code <= 126; code++) {
      expect(FONT_5X7[code], `FONT_5X7 missing code ${code}`).toBeDefined();
      expect(FONT_5X7[code].length).toBe(7);
      expect(FONT_3X5[code], `FONT_3X5 missing code ${code}`).toBeDefined();
      expect(FONT_3X5[code].length).toBe(5);

      const rect5 = atlas.fonts['5x7'].glyphs[code];
      const rect3 = atlas.fonts['3x5'].glyphs[code];
      expect(rect5).toBeDefined();
      expect(rect3).toBeDefined();
      if (code !== 32) {
        expect(countOpaqueWhitePixels(atlas.pixels, atlas.width, rect5)).toBeGreaterThan(0);
        expect(countOpaqueWhitePixels(atlas.pixels, atlas.width, rect3)).toBeGreaterThan(0);
      }
    }
  });

  it('measures single-line and multi-line text accurately and emits aligned quads', () => {
    expect(measurePixelText('', '5x7')).toEqual({ width: 0, height: 0 });
    expect(measurePixelText('A', '5x7')).toEqual({ width: 5, height: 7 });
    expect(measurePixelText('KRUNKED', '5x7')).toEqual({ width: 6 * 6 + 5, height: 7 });
    expect(measurePixelText('LINE1\nLINE2', '3x5')).toEqual({ width: 4 * 4 + 3, height: 12 });

    const emitted: Array<{ dstX: number; dstY: number; dstW: number; dstH: number }> = [];
    const mockBatch: PixelTextBatchTarget = {
      drawAtlasRect(_sx, _sy, _sw, _sh, dstX, dstY, dstW, dstH) {
        emitted.push({ dstX, dstY, dstW, dstH });
      },
      getBakedFonts: () => atlas.fonts,
    };

    drawPixelText(mockBatch, 'HI!', 160, 20, 1, 1, 1, 1, '5x7', 'center');
    expect(emitted.length).toBe(3);
    // Width of 'HI!' in 5x7 = 2*6 + 5 = 17 => centered at 160 starts at round(151.5) = 152
    expect(emitted[0].dstX).toBe(152);
    expect(emitted[0].dstY).toBe(20);
    expect(emitted[1].dstX).toBe(158);
    expect(emitted[2].dstX).toBe(164);
  });
});

describe('WebGL2 GLSL ES 3.00 Shader Sources', () => {
  it('uses GLSL ES 3.00 and preserves exact Mixolumia bloom, blur, blend_darken, and color_threshold formulas', () => {
    const allShaders = [
      SPRITE_VERT_SRC,
      SPRITE_FRAG_SRC,
      PRESENT_VERT_SRC,
      BLOOM_FILTER_LUMINANCE_FRAG_SRC,
      BLUR_2_PASS_GAUSS_LERP_FRAG_SRC,
      BLEND_DARKEN_FRAG_SRC,
      COLOR_THRESHOLD_VERT_SRC,
      COLOR_THRESHOLD_FRAG_SRC,
    ];
    for (const src of allShaders) {
      expect(src.startsWith('#version 300 es')).toBe(true);
    }

    expect(SHADER_NAMES.bloomFilter).toBe('bloom_filter_luminance_shd');
    expect(SHADER_NAMES.blurGauss).toBe('blur_2_pass_gauss_lerp_shd');
    expect(SHADER_NAMES.blendDarken).toBe('blend_darken_shd');
    expect(SHADER_NAMES.colorThreshold).toBe('color_threshold_shd');

    // Exact extracted luminance weights (0.229, 0.587, 0.114) and light palette branch
    expect(BLOOM_FILTER_LUMINANCE_FRAG_SRC).toContain('vec3(0.229, 0.587, 0.114)');
    expect(BLOOM_FILTER_LUMINANCE_FRAG_SRC).toContain('smoothstep(u_threshold, u_threshold + u_range');
    expect(BLOOM_FILTER_LUMINANCE_FRAG_SRC).toContain('u_isLight');

    // Exact extracted Gaussian blur constants (3.0, 0.5)
    expect(BLUR_2_PASS_GAUSS_LERP_FRAG_SRC).toContain('blur_steps = 3.0');
    expect(BLUR_2_PASS_GAUSS_LERP_FRAG_SRC).toContain('sigma = 0.5');
    expect(BLUR_2_PASS_GAUSS_LERP_FRAG_SRC).toContain('u_texelStep');

    // Exact dark additive / light multiplicative blend_darken composite
    expect(BLEND_DARKEN_FRAG_SRC).toContain('blend_darken');
    expect(BLEND_DARKEN_FRAG_SRC).toContain('u_isLight');
    expect(BLEND_DARKEN_FRAG_SRC).toContain('u_bloomIntensity');

    // Exact color_threshold mapping
    expect(COLOR_THRESHOLD_FRAG_SRC).toContain('color_threshold');
    expect(COLOR_THRESHOLD_FRAG_SRC).toContain('intensity > 0.5 ? u_col2 : u_col1');
  });
});

describe('ParticlesAndBg Fixed-Capacity Pools', () => {
  it('enforces strict fixed capacity (512 particles, 48 BGGeometry, 16 banners) with zero growth', () => {
    const fx = new ParticlesAndBg();
    expect(fx.getCapacities()).toEqual({
      particles: MAX_PARTICLES,
      bgGeometry: MAX_BG_GEOMETRY,
      banners: MAX_BANNERS,
    });

    // Flood every pool far beyond capacity
    for (let i = 0; i < 2000; i++) {
      fx.spawnParticle(160, 90, 0.5, -0.5, 2, 60, 2);
    }
    for (let i = 0; i < 200; i++) {
      fx.spawnBgDiamond(160, 90, 10, 140, 3, 60, 0.4, true);
    }
    for (let i = 0; i < 100; i++) {
      fx.spawnBanner(`COMBO x${i}`, 160, 80, 3);
    }

    expect(fx.getCounts()).toEqual({
      particles: MAX_PARTICLES,
      bgGeometry: MAX_BG_GEOMETRY,
      banners: MAX_BANNERS,
    });
    expect(fx.getCapacities()).toEqual({
      particles: MAX_PARTICLES,
      bgGeometry: MAX_BG_GEOMETRY,
      banners: MAX_BANNERS,
    });

    // Advance past maxAge -> all slots cleanly return to inactive
    for (let t = 0; t < 80; t++) {
      fx.update(1);
    }
    expect(fx.getCounts()).toEqual({ particles: 0, bgGeometry: 0, banners: 0 });
  });

  it('consumes SimEvents, computes smooth BGGeometry alpha ease curve, and renders without DOM', () => {
    expect(computeBgDiamondAlpha(0, 0.5)).toBe(0);
    expect(computeBgDiamondAlpha(0.12, 0.5)).toBeCloseTo(0.5, 5);
    expect(computeBgDiamondAlpha(0.56, 0.5)).toBeCloseTo(0.125, 5);
    expect(computeBgDiamondAlpha(1, 0.5)).toBe(0);

    const fx = new ParticlesAndBg();
    const events: SimEvent[] = [
      {
        type: 'BLOCKS_CLEAR',
        cells: [
          { x: 3, y: 12, color: 1 },
          { x: 4, y: 13, color: 2 },
          { x: 3, y: 14, color: 3 },
        ],
        count: 3,
        combo: 2,
        waveScore: 1800,
        totalScore: 1800,
        level: 0,
        clearTier: 1,
      },
      { type: 'COMBO_CHAIN', combo: 2, comboTier: 1, x: 3, y: 13 },
      { type: 'PERFECT_CLEAR', bonus: 20000, combo: 2, level: 0 },
    ];

    const feedback = fx.consumeSimEvents(events);
    expect(feedback.bloomPulse).toBeGreaterThan(0.4);
    expect(feedback.flashSlot).toBe(3);
    expect(fx.getCounts().particles).toBeGreaterThan(50);
    expect(fx.getCounts().bgGeometry).toBeGreaterThanOrEqual(4);
    expect(fx.getCounts().banners).toBeGreaterThanOrEqual(3);

    fx.update(1);
    let rects = 0;
    let diamonds = 0;
    let texts = 0;
    const mockTarget: ParticleRenderTarget = {
      drawRect: () => {
        rects++;
      },
      drawDiamondOutline: () => {
        diamonds++;
      },
      drawText: () => {
        texts++;
      },
    };
    const palette = makeTestPalette(false);
    const settings = makeTestRenderSettings();
    fx.renderBackground(mockTarget, palette, settings, 0.5);
    fx.renderForeground(mockTarget, palette, settings, 0.5);
    expect(diamonds).toBeGreaterThan(0);
    expect(rects).toBeGreaterThan(0);
    expect(texts).toBeGreaterThan(0);
  });
});

describe('InputManager & Logical Coordinate Mapping', () => {
  it('maps normal, letterboxed, Tate-rotated, and BoardZoom mouse coordinates into 320x180', () => {
    const rect = { left: 0, top: 0, width: 1280, height: 720 };
    const normalLb = computeLetterboxRect(1280, 720, false);
    const normalTransform: ViewportTransform = {
      canvasCssWidth: 1280,
      canvasCssHeight: 720,
      viewX: normalLb.x,
      viewY: normalLb.y,
      viewW: normalLb.w,
      viewH: normalLb.h,
      tateRotate: false,
      boardZoom: false,
    };
    const center = mapClientToLogical(640, 360, rect, normalTransform);
    expect(center.inBounds).toBe(true);
    expect(center.x).toBeCloseTo(LOGICAL_WIDTH / 2, 4);
    expect(center.y).toBeCloseTo(LOGICAL_HEIGHT / 2, 4);

    // Tate 90-degree CW: top-right of Tate viewport displays logical (0, 0)
    const tateLb = computeLetterboxRect(1280, 720, true);
    const tateTransform: ViewportTransform = {
      canvasCssWidth: 1280,
      canvasCssHeight: 720,
      viewX: tateLb.x,
      viewY: tateLb.y,
      viewW: tateLb.w,
      viewH: tateLb.h,
      tateRotate: true,
      boardZoom: false,
    };
    const topRightTate = mapClientToLogical(tateLb.x + tateLb.w, tateLb.y, rect, tateTransform);
    expect(topRightTate.inBounds).toBe(true);
    expect(topRightTate.x).toBeCloseTo(0, 4);
    expect(topRightTate.y).toBeCloseTo(0, 4);

    // Board Zoom: top-left of viewport zooms inward around center by BOARD_ZOOM_FACTOR
    const zoomTransform: ViewportTransform = { ...normalTransform, boardZoom: true };
    const zoomTopLeft = mapClientToLogical(0, 0, rect, zoomTransform);
    expect(zoomTopLeft.x).toBeCloseTo(((0 - 0.5) / BOARD_ZOOM_FACTOR + 0.5) * LOGICAL_WIDTH, 4);
    expect(zoomTopLeft.y).toBeCloseTo(((0 - 0.5) / BOARD_ZOOM_FACTOR + 0.5) * LOGICAL_HEIGHT, 4);
  });

  it('handles edge-triggered UI/Sim polling and live key capture cleanly', () => {
    const input = new InputManager();
    const settings = makeTestUserSettings();

    input.injectKey('ArrowLeft', true);
    input.injectKey('Space', true);

    const sim1 = input.pollSimInputFrame(settings);
    expect(sim1.moveLeft).toBe(true);
    expect(sim1.moveLeftPressed).toBe(true);
    expect(sim1.hardDropPressed).toBe(true);

    // Next tick while still held: held remains true, pressed edges are consumed!
    const sim2 = input.pollSimInputFrame(settings);
    expect(sim2.moveLeft).toBe(true);
    expect(sim2.moveLeftPressed).toBe(false);
    expect(sim2.hardDropPressed).toBe(false);

    // UI edges stay independent of Sim polling!
    const ui1 = input.pollUiInput(settings);
    expect(ui1.left).toBe(true);
    expect(ui1.confirm).toBe(true);
    const ui2 = input.pollUiInput(settings);
    expect(ui2.left).toBe(false);
    expect(ui2.confirm).toBe(false);

    // Live capture mode intercepts next keypress and clears capture
    let captured: string | null = null;
    input.startCapture((res) => {
      captured = res.type === 'keyboard' ? res.code : `gp:${res.button}`;
    });
    expect(input.isCapturing()).toBe(true);
    input.injectKey('KeyJ', true);
    expect(captured).toBe('KeyJ');
    expect(input.isCapturing()).toBe(false);
  });
});
