import {
  ALL_TRACK_IDS,
  BLOOM_BASE_INTENSITY,
  isLightPaletteBg,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  parseHexRgb01,
  type Palette,
  type RenderSettings,
  type SpriteAssetEntry,
  type TrackId,
} from '../contracts/index.js';
import {
  drawPixelText,
  type BakedFontAtlas,
  type BitmapFontId,
  type TextAlign,
} from '../assets/bitmapFont.js';
import {
  generateAllTrackCovers,
  generateBuiltinAtlas,
  TRACK_COVER_SIZE,
} from '../assets/proceduralArt.js';
import {
  BLEND_DARKEN_FRAG_SRC,
  BLOOM_FILTER_LUMINANCE_FRAG_SRC,
  BLUR_2_PASS_GAUSS_LERP_FRAG_SRC,
  COLOR_THRESHOLD_FRAG_SRC,
  COLOR_THRESHOLD_VERT_SRC,
  compileProgram,
  FULLSCREEN_VERT_SRC,
  PRESENT_VERT_SRC,
} from './shaders.js';
import { SpriteBatch } from './SpriteBatch.js';
import { ParticlesAndBg, type ParticleRenderTarget } from './ParticlesAndBg.js';

export const BOARD_ZOOM_FACTOR = 1.25;

export interface ViewportTransform {
  canvasCssWidth: number;
  canvasCssHeight: number;
  viewX: number; // CSS px left edge of letterboxed logical viewport
  viewY: number; // CSS px top edge of letterboxed logical viewport
  viewW: number; // CSS px width of letterboxed logical viewport
  viewH: number; // CSS px height of letterboxed logical viewport
  tateRotate: boolean;
  boardZoom: boolean;
}

interface RenderTarget {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

function createTexture2D(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  pixels: Uint8Array | null,
  filter: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error('Failed to create WebGL2 texture');
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  filter: number,
): RenderTarget {
  const texture = createTexture2D(gl, width, height, null, filter);
  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(texture);
    throw new Error('Failed to create WebGL2 framebuffer');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    throw new Error(`Incomplete WebGL2 framebuffer (status=0x${status.toString(16)})`);
  }
  return { fbo, texture, width, height };
}

/**
 * Computes centered aspect-preserving letterbox rect inside a container of size (W, H).
 * Normal mode preserves 320:180 (16:9); Tate 90-degree rotated mode preserves 180:320 (9:16).
 */
export function computeLetterboxRect(
  containerW: number,
  containerH: number,
  tateRotate: boolean,
): { x: number; y: number; w: number; h: number } {
  const safeW = Math.max(1, containerW);
  const safeH = Math.max(1, containerH);
  const targetAspect = tateRotate
    ? LOGICAL_HEIGHT / LOGICAL_WIDTH
    : LOGICAL_WIDTH / LOGICAL_HEIGHT;
  const containerAspect = safeW / safeH;

  let w: number;
  let h: number;
  if (containerAspect >= targetAspect) {
    h = safeH;
    w = h * targetAspect;
  } else {
    w = safeW;
    h = w / targetAspect;
  }
  const x = (safeW - w) * 0.5;
  const y = (safeH - h) * 0.5;
  return { x, y, w, h };
}

/**
 * Crisp 320x180 WebGL2 renderer implementing Mixolumia's exact 4-shader pipeline:
 * 1. Native 320x180 GL_NEAREST scene framebuffer
 * 2. bloom_filter_luminance_shd (0.229, 0.587, 0.114 dark luminance / light inverted ink)
 * 3. blur_2_pass_gauss_lerp_shd (horizontal + vertical separable bilinear Gaussian blur)
 * 4. blend_darken_shd (dark additive bloom / light multiplicative ink-darken + Tate + BoardZoom)
 * Plus color_threshold_shd for 96x96 monochrome album covers!
 */
export class WebGL2Renderer implements ParticleRenderTarget {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly batch: SpriteBatch;
  readonly effects: ParticlesAndBg;

  private readonly sceneTarget: RenderTarget;
  private readonly bloomExtractTarget: RenderTarget;
  private readonly blurHTarget: RenderTarget;
  private readonly blurVTarget: RenderTarget;

  private readonly fullscreenVao: WebGLVertexArrayObject;
  private readonly bloomExtractProgram: WebGLProgram;
  private readonly blurProgram: WebGLProgram;
  private readonly presentProgram: WebGLProgram;
  private readonly colorThresholdProgram: WebGLProgram;

  // Uniform locations
  private readonly bloomLocs: {
    tex: WebGLUniformLocation | null;
    threshold: WebGLUniformLocation | null;
    range: WebGLUniformLocation | null;
    isLight: WebGLUniformLocation | null;
  };
  private readonly blurLocs: {
    tex: WebGLUniformLocation | null;
    texelStep: WebGLUniformLocation | null;
  };
  private readonly presentLocs: {
    baseTex: WebGLUniformLocation | null;
    bloomTex: WebGLUniformLocation | null;
    bloomIntensity: WebGLUniformLocation | null;
    isLight: WebGLUniformLocation | null;
    tateRotate: WebGLUniformLocation | null;
    boardZoom: WebGLUniformLocation | null;
    flashColor: WebGLUniformLocation | null;
  };
  private readonly thresholdLocs: {
    resolution: WebGLUniformLocation | null;
    rect: WebGLUniformLocation | null;
    tex: WebGLUniformLocation | null;
    col1: WebGLUniformLocation | null;
    col2: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
  };

  // Built-in & custom atlases
  private readonly builtinAtlasTex: WebGLTexture;
  private readonly builtinAtlasWidth: number;
  private readonly builtinAtlasHeight: number;
  private readonly builtinSprites: Record<string, SpriteAssetEntry>;
  private readonly builtinFonts: Record<BitmapFontId, BakedFontAtlas>;

  private customAtlasTex: WebGLTexture | null = null;
  private customAtlasWidth = 0;
  private customAtlasHeight = 0;
  private customSprites: Record<string, SpriteAssetEntry> | null = null;

  // 96x96 track cover textures
  private readonly trackCoverTextures: Record<TrackId, WebGLTexture>;

  // Dynamic post-process state
  private bloomActual = BLOOM_BASE_INTENSITY;
  private boardFlashAlpha = 0;
  private boardFlashSlot = 3;
  private activeBlockCount = 0;

  // Canvas & letterbox tracking
  private cssWidth = LOGICAL_WIDTH;
  private cssHeight = LOGICAL_HEIGHT;
  private dpr = 1;
  private lastTateRotate = false;
  private lastBoardZoom = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.style.imageRendering = 'pixelated';

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 context unavailable on this browser/device');
    }
    this.gl = gl;

    // Empty VAO for gl_VertexID fullscreen/quad passes
    const emptyVao = gl.createVertexArray();
    if (!emptyVao) {
      throw new Error('Failed to create WebGL2 fullscreen VAO');
    }
    this.fullscreenVao = emptyVao;

    // Create 320x180 FBO chain (scene GL_NEAREST, bloom/blur GL_LINEAR)
    this.sceneTarget = createRenderTarget(gl, LOGICAL_WIDTH, LOGICAL_HEIGHT, gl.NEAREST);
    this.bloomExtractTarget = createRenderTarget(gl, LOGICAL_WIDTH, LOGICAL_HEIGHT, gl.LINEAR);
    this.blurHTarget = createRenderTarget(gl, LOGICAL_WIDTH, LOGICAL_HEIGHT, gl.LINEAR);
    this.blurVTarget = createRenderTarget(gl, LOGICAL_WIDTH, LOGICAL_HEIGHT, gl.LINEAR);

    // Compile all 4 post/effect shader programs
    this.bloomExtractProgram = compileProgram(gl, FULLSCREEN_VERT_SRC, BLOOM_FILTER_LUMINANCE_FRAG_SRC);
    this.blurProgram = compileProgram(gl, FULLSCREEN_VERT_SRC, BLUR_2_PASS_GAUSS_LERP_FRAG_SRC);
    this.presentProgram = compileProgram(gl, PRESENT_VERT_SRC, BLEND_DARKEN_FRAG_SRC);
    this.colorThresholdProgram = compileProgram(
      gl,
      COLOR_THRESHOLD_VERT_SRC,
      COLOR_THRESHOLD_FRAG_SRC,
    );

    this.bloomLocs = {
      tex: gl.getUniformLocation(this.bloomExtractProgram, 'u_tex'),
      threshold: gl.getUniformLocation(this.bloomExtractProgram, 'u_threshold'),
      range: gl.getUniformLocation(this.bloomExtractProgram, 'u_range'),
      isLight: gl.getUniformLocation(this.bloomExtractProgram, 'u_isLight'),
    };
    this.blurLocs = {
      tex: gl.getUniformLocation(this.blurProgram, 'u_tex'),
      texelStep: gl.getUniformLocation(this.blurProgram, 'u_texelStep'),
    };
    this.presentLocs = {
      baseTex: gl.getUniformLocation(this.presentProgram, 'u_baseTex'),
      bloomTex: gl.getUniformLocation(this.presentProgram, 'u_bloomTex'),
      bloomIntensity: gl.getUniformLocation(this.presentProgram, 'u_bloomIntensity'),
      isLight: gl.getUniformLocation(this.presentProgram, 'u_isLight'),
      tateRotate: gl.getUniformLocation(this.presentProgram, 'u_tateRotate'),
      boardZoom: gl.getUniformLocation(this.presentProgram, 'u_boardZoom'),
      flashColor: gl.getUniformLocation(this.presentProgram, 'u_flashColor'),
    };
    this.thresholdLocs = {
      resolution: gl.getUniformLocation(this.colorThresholdProgram, 'u_resolution'),
      rect: gl.getUniformLocation(this.colorThresholdProgram, 'u_rect'),
      tex: gl.getUniformLocation(this.colorThresholdProgram, 'u_tex'),
      col1: gl.getUniformLocation(this.colorThresholdProgram, 'u_col1'),
      col2: gl.getUniformLocation(this.colorThresholdProgram, 'u_col2'),
      alpha: gl.getUniformLocation(this.colorThresholdProgram, 'u_alpha'),
    };

    // Generate & upload Built-In Krunked procedural pixel atlas + baked fonts
    const builtin = generateBuiltinAtlas();
    this.builtinAtlasWidth = builtin.width;
    this.builtinAtlasHeight = builtin.height;
    this.builtinSprites = builtin.sprites;
    this.builtinFonts = builtin.fonts;
    this.builtinAtlasTex = createTexture2D(
      gl,
      builtin.width,
      builtin.height,
      builtin.pixels,
      gl.NEAREST,
    );

    // Initialize zero-alloc SpriteBatch and pooled particle/BG system
    this.batch = new SpriteBatch(gl);
    const pixelEntry = builtin.sprites['pixel_spr'];
    if (pixelEntry && pixelEntry.frames[0]) {
      this.batch.setSolidPixelSource(
        this.builtinAtlasTex,
        this.builtinAtlasWidth,
        this.builtinAtlasHeight,
        pixelEntry.frames[0],
      );
    }
    this.batch.setBakedFonts(this.builtinFonts);
    this.effects = new ParticlesAndBg();

    // Generate & upload all 8 crisp 96x96 monochrome track cover textures
    const builtinCovers = generateAllTrackCovers();
    const coverTexMap = {} as Record<TrackId, WebGLTexture>;
    for (const trackId of ALL_TRACK_IDS) {
      coverTexMap[trackId] = createTexture2D(
        gl,
        TRACK_COVER_SIZE,
        TRACK_COVER_SIZE,
        builtinCovers[trackId],
        gl.NEAREST,
      );
    }
    this.trackCoverTextures = coverTexMap;

    // Initial sizing
    const rect = canvas.getBoundingClientRect();
    const initW = rect.width > 0 ? rect.width : canvas.width || LOGICAL_WIDTH;
    const initH = rect.height > 0 ? rect.height : canvas.height || LOGICAL_HEIGHT;
    const initDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.resize(initW, initH, initDpr);
  }

  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = Math.max(1, dpr);
    const pixelW = Math.max(1, Math.round(this.cssWidth * this.dpr));
    const pixelH = Math.max(1, Math.round(this.cssHeight * this.dpr));
    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
    }
  }

  getViewportTransform(): ViewportTransform {
    const rect = computeLetterboxRect(this.cssWidth, this.cssHeight, this.lastTateRotate);
    return {
      canvasCssWidth: this.cssWidth,
      canvasCssHeight: this.cssHeight,
      viewX: rect.x,
      viewY: rect.y,
      viewW: rect.w,
      viewH: rect.h,
      tateRotate: this.lastTateRotate,
      boardZoom: this.lastBoardZoom,
    };
  }

  beginScene(palette: Palette): void {
    const gl = this.gl;
    const [bgR, bgG, bgB] = parseHexRgb01(palette.colors[0]);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.fbo);
    gl.viewport(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(bgR, bgG, bgB, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.batch.begin(LOGICAL_WIDTH, LOGICAL_HEIGHT);
  }

  drawSprite(
    name: string,
    frameIndex: number,
    x: number,
    y: number,
    r = 1,
    g = 1,
    b = 1,
    a = 1,
    scaleX = 1,
    scaleY = 1,
  ): void {
    let entry: SpriteAssetEntry | undefined;
    let useCustom = false;
    if (this.customSprites && this.customAtlasTex && this.customSprites[name]) {
      entry = this.customSprites[name];
      useCustom = true;
    } else {
      entry = this.builtinSprites[name];
    }
    if (!entry || entry.frames.length === 0) {
      return;
    }
    const safeIdx = ((frameIndex % entry.frames.length) + entry.frames.length) % entry.frames.length;
    const frame = entry.frames[safeIdx];

    if (useCustom && this.customAtlasTex) {
      this.batch.setTexture(this.customAtlasTex, this.customAtlasWidth, this.customAtlasHeight);
    } else {
      this.batch.setTexture(this.builtinAtlasTex, this.builtinAtlasWidth, this.builtinAtlasHeight);
    }

    this.batch.drawSpriteFrame(frame, entry.originX, entry.originY, x, y, r, g, b, a, scaleX, scaleY);
  }

  drawSpriteHex(
    name: string,
    frameIndex: number,
    x: number,
    y: number,
    hexColor: string,
    alpha = 1,
    scaleX = 1,
    scaleY = 1,
  ): void {
    const [r, g, b] = parseHexRgb01(hexColor);
    this.drawSprite(name, frameIndex, x, y, r, g, b, alpha, scaleX, scaleY);
  }

  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a = 1,
  ): void {
    this.batch.drawRect(x, y, w, h, r, g, b, a);
  }

  drawRectHex(
    x: number,
    y: number,
    w: number,
    h: number,
    hexColor: string,
    alpha = 1,
  ): void {
    const [r, g, b] = parseHexRgb01(hexColor);
    this.batch.drawRect(x, y, w, h, r, g, b, alpha);
  }

  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    g: number,
    b: number,
    a = 1,
    thickness = 1,
  ): void {
    this.batch.drawLine(x0, y0, x1, y1, r, g, b, a, thickness);
  }

  drawDiamondOutline(
    cx: number,
    cy: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    a = 1,
  ): void {
    this.batch.drawDiamondOutline(cx, cy, radius, r, g, b, a);
  }

  drawText(
    text: string,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a = 1,
    font: BitmapFontId = '5x7',
    align: TextAlign = 'left',
    scale = 1,
  ): void {
    // Always bind the built-in font atlas so bitmap text stays crisp even in Custom Pack mode
    this.batch.setTexture(this.builtinAtlasTex, this.builtinAtlasWidth, this.builtinAtlasHeight);
    drawPixelText(this.batch, text, x, y, r, g, b, a, font, align, scale, this.builtinFonts);
  }

  drawTextHex(
    text: string,
    x: number,
    y: number,
    hexColor: string,
    alpha = 1,
    font: BitmapFontId = '5x7',
    align: TextAlign = 'left',
    scale = 1,
  ): void {
    const [r, g, b] = parseHexRgb01(hexColor);
    this.drawText(text, x, y, r, g, b, alpha, font, align, scale);
  }

  /**
   * Draws a 96x96 monochrome track album cover directly into the 320x180 scene framebuffer
   * using the `color_threshold_shd` shader (`intensity > 0.5 ? col2 : col1`).
   */
  drawThresholdCover(
    trackId: TrackId,
    x: number,
    y: number,
    w: number,
    h: number,
    col1: string | [number, number, number],
    col2: string | [number, number, number],
    alpha = 1,
  ): void {
    const coverTex = this.trackCoverTextures[trackId];
    if (!coverTex || alpha <= 0) {
      return;
    }
    // Preserve strict draw order by flushing queued batch quads first
    this.batch.flush();

    const gl = this.gl;
    const [r1, g1, b1] = typeof col1 === 'string' ? parseHexRgb01(col1) : col1;
    const [r2, g2, b2] = typeof col2 === 'string' ? parseHexRgb01(col2) : col2;

    gl.useProgram(this.colorThresholdProgram);
    gl.uniform2f(this.thresholdLocs.resolution, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    gl.uniform4f(
      this.thresholdLocs.rect,
      Math.round(x),
      Math.round(y),
      Math.round(w),
      Math.round(h),
    );
    gl.uniform3f(this.thresholdLocs.col1, r1, g1, b1);
    gl.uniform3f(this.thresholdLocs.col2, r2, g2, b2);
    gl.uniform1f(this.thresholdLocs.alpha, alpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.uniform1i(this.thresholdLocs.tex, 0);

    gl.bindVertexArray(this.fullscreenVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Ends the 320x180 scene pass, executes luminance bloom extraction + 2-pass separable
   * bilinear Gaussian blur, and composites/presents via dark additive or light blend_darken
   * onto the display canvas with crisp GL_NEAREST upscaling, Tate rotation, and Board Zoom.
   */
  endSceneAndPresent(palette: Palette, settings: RenderSettings, dtSec: number): void {
    const gl = this.gl;
    this.batch.end();

    const dt = Math.max(0, Math.min(dtSec, 0.25));
    // Exponential bloom decay back toward Mixolumia's 0.15 base intensity
    this.bloomActual =
      BLOOM_BASE_INTENSITY + (this.bloomActual - BLOOM_BASE_INTENSITY) * Math.exp(-dt * 7.5);
    if (Math.abs(this.bloomActual - BLOOM_BASE_INTENSITY) < 0.0005) {
      this.bloomActual = BLOOM_BASE_INTENSITY;
    }
    this.boardFlashAlpha = Math.max(0, this.boardFlashAlpha - dt * 3.8);

    const isLight = isLightPaletteBg(palette.colors[0]);
    const bloomIntensity = Math.max(0, settings.bloomAmount) * this.bloomActual;

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.fullscreenVao);

    if (bloomIntensity > 0.0005) {
      // Pass 1: bloom_filter_luminance_shd (320x180)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomExtractTarget.fbo);
      gl.viewport(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      gl.useProgram(this.bloomExtractProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
      gl.uniform1i(this.bloomLocs.tex, 0);
      gl.uniform1f(this.bloomLocs.threshold, isLight ? 0.2 : 0.28);
      gl.uniform1f(this.bloomLocs.range, 0.45);
      gl.uniform1f(this.bloomLocs.isLight, isLight ? 1.0 : 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 2: blur_2_pass_gauss_lerp_shd horizontal (1/320, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurHTarget.fbo);
      gl.viewport(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      gl.useProgram(this.blurProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomExtractTarget.texture);
      gl.uniform1i(this.blurLocs.tex, 0);
      gl.uniform2f(this.blurLocs.texelStep, 1 / LOGICAL_WIDTH, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 3: blur_2_pass_gauss_lerp_shd vertical (0, 1/180)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurVTarget.fbo);
      gl.viewport(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.blurHTarget.texture);
      gl.uniform1i(this.blurLocs.tex, 0);
      gl.uniform2f(this.blurLocs.texelStep, 0, 1 / LOGICAL_HEIGHT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Pass 4: Present composite (blend_darken / dark additive) to default canvas framebuffer
    this.lastTateRotate = settings.tateRotate;
    this.lastBoardZoom = settings.boardZoom;

    const [bgR, bgG, bgB] = parseHexRgb01(palette.colors[0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(bgR, bgG, bgB, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const vp = computeLetterboxRect(this.canvas.width, this.canvas.height, settings.tateRotate);
    gl.viewport(Math.round(vp.x), Math.round(vp.y), Math.round(vp.w), Math.round(vp.h));

    gl.useProgram(this.presentProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.uniform1i(this.presentLocs.baseTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.blurVTarget.texture);
    gl.uniform1i(this.presentLocs.bloomTex, 1);

    gl.uniform1f(this.presentLocs.bloomIntensity, bloomIntensity);
    gl.uniform1f(this.presentLocs.isLight, isLight ? 1.0 : 0.0);
    gl.uniform1f(this.presentLocs.tateRotate, settings.tateRotate ? 1.0 : 0.0);
    gl.uniform1f(this.presentLocs.boardZoom, settings.boardZoom ? BOARD_ZOOM_FACTOR : 1.0);

    if (settings.flashing && this.boardFlashAlpha > 0.001) {
      const [fr, fg, fb] = parseHexRgb01(palette.colors[this.boardFlashSlot] ?? palette.colors[3]);
      gl.uniform4f(this.presentLocs.flashColor, fr, fg, fb, this.boardFlashAlpha * 0.22);
    } else {
      gl.uniform4f(this.presentLocs.flashColor, 0, 0, 0, 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  triggerBloomPulse(amount: number): void {
    if (amount <= 0) return;
    this.bloomActual = Math.min(1.25, this.bloomActual + amount);
  }

  triggerBoardFlash(colorSlot: number, intensity = 0.6): void {
    this.boardFlashSlot = Math.max(0, Math.min(5, colorSlot));
    this.boardFlashAlpha = Math.min(1, Math.max(this.boardFlashAlpha, intensity));
  }

  getBloomActual(): number {
    return this.bloomActual;
  }

  setCustomAtlas(
    rgbaPixels: Uint8Array,
    width: number,
    height: number,
    sprites: Record<string, SpriteAssetEntry>,
  ): void {
    const gl = this.gl;
    if (this.customAtlasTex) {
      gl.deleteTexture(this.customAtlasTex);
      this.customAtlasTex = null;
    }
    this.customAtlasTex = createTexture2D(gl, width, height, rgbaPixels, gl.NEAREST);
    this.customAtlasWidth = width;
    this.customAtlasHeight = height;
    this.customSprites = sprites;
  }

  resetBuiltinAtlas(): void {
    if (this.customAtlasTex) {
      this.gl.deleteTexture(this.customAtlasTex);
      this.customAtlasTex = null;
    }
    this.customAtlasWidth = 0;
    this.customAtlasHeight = 0;
    this.customSprites = null;
  }

  setCustomCover(trackId: TrackId, rgbaPixels: Uint8Array, width: number, height: number): void {
    const gl = this.gl;
    const prev = this.trackCoverTextures[trackId];
    if (prev) {
      gl.deleteTexture(prev);
    }
    this.trackCoverTextures[trackId] = createTexture2D(gl, width, height, rgbaPixels, gl.NEAREST);
  }

  resetBuiltinCovers(): void {
    const gl = this.gl;
    const builtinCovers = generateAllTrackCovers();
    for (const trackId of ALL_TRACK_IDS) {
      const prev = this.trackCoverTextures[trackId];
      if (prev) {
        gl.deleteTexture(prev);
      }
      this.trackCoverTextures[trackId] = createTexture2D(
        gl,
        TRACK_COVER_SIZE,
        TRACK_COVER_SIZE,
        builtinCovers[trackId],
        gl.NEAREST,
      );
    }
  }

  getSpriteEntry(name: string): SpriteAssetEntry | undefined {
    if (this.customSprites && this.customSprites[name]) {
      return this.customSprites[name];
    }
    return this.builtinSprites[name];
  }

  setActiveBlockCount(count: number): void {
    this.activeBlockCount = Math.max(0, count);
  }

  getEntityCounts(): { particles: number; bgGeometry: number; activeBlocks: number } {
    const counts = this.effects.getCounts();
    return {
      particles: counts.particles,
      bgGeometry: counts.bgGeometry,
      activeBlocks: this.activeBlockCount,
    };
  }

  dispose(): void {
    const gl = this.gl;
    this.batch.dispose();
    gl.deleteVertexArray(this.fullscreenVao);
    gl.deleteProgram(this.bloomExtractProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.presentProgram);
    gl.deleteProgram(this.colorThresholdProgram);

    const targets = [
      this.sceneTarget,
      this.bloomExtractTarget,
      this.blurHTarget,
      this.blurVTarget,
    ];
    for (const t of targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.texture);
    }

    gl.deleteTexture(this.builtinAtlasTex);
    if (this.customAtlasTex) {
      gl.deleteTexture(this.customAtlasTex);
      this.customAtlasTex = null;
    }
    for (const trackId of ALL_TRACK_IDS) {
      const tex = this.trackCoverTextures[trackId];
      if (tex) {
        gl.deleteTexture(tex);
      }
    }
  }
}
