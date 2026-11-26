import type { SpriteFrameRect } from '../contracts/index.js';
import type { BakedFontAtlas, BitmapFontId, PixelTextBatchTarget } from '../assets/bitmapFont.js';
import { compileProgram, SPRITE_FRAG_SRC, SPRITE_VERT_SRC } from './shaders.js';

export const MAX_QUADS = 8192;
const FLOATS_PER_VERTEX = 8; // x, y, u, v, r, g, b, a
const VERTICES_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;
const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * VERTICES_PER_QUAD; // 32

/**
 * Zero-allocation pre-allocated WebGL2 sprite, rect, and crisp pixel-line batcher.
 * Supports up to MAX_QUADS = 8192 per flush with automatic flush on overflow or texture switch.
 */
export class SpriteBatch implements PixelTextBatchTarget {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  private readonly uResolution: WebGLUniformLocation | null;
  private readonly uTex: WebGLUniformLocation | null;

  private readonly vertexData: Float32Array;
  private quadCount = 0;
  private drawCallCount = 0;
  private active = false;

  private logicalWidth = 320;
  private logicalHeight = 180;

  private activeTexture: WebGLTexture | null = null;
  private activeTexWidth = 1;
  private activeTexHeight = 1;
  private invTexW = 1;
  private invTexH = 1;

  private solidTexture: WebGLTexture | null = null;
  private solidTexWidth = 1;
  private solidTexHeight = 1;
  private solidU0 = 0;
  private solidV0 = 0;
  private solidU1 = 1;
  private solidV1 = 1;

  private bakedFonts: Record<BitmapFontId, BakedFontAtlas> | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, SPRITE_VERT_SRC, SPRITE_FRAG_SRC);
    this.uResolution = gl.getUniformLocation(this.program, 'u_resolution');
    this.uTex = gl.getUniformLocation(this.program, 'u_tex');

    // Pre-allocate vertex and index storage once (zero runtime GC)
    this.vertexData = new Float32Array(MAX_QUADS * FLOATS_PER_QUAD);
    const indexData = new Uint16Array(MAX_QUADS * INDICES_PER_QUAD);
    for (let i = 0; i < MAX_QUADS; i++) {
      const vOff = i * VERTICES_PER_QUAD;
      const iOff = i * INDICES_PER_QUAD;
      indexData[iOff] = vOff;
      indexData[iOff + 1] = vOff + 1;
      indexData[iOff + 2] = vOff + 2;
      indexData[iOff + 3] = vOff;
      indexData[iOff + 4] = vOff + 2;
      indexData[iOff + 5] = vOff + 3;
    }

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (!vao || !vbo || !ibo) {
      throw new Error('Failed to create WebGL2 buffers for SpriteBatch');
    }
    this.vao = vao;
    this.vbo = vbo;
    this.ibo = ibo;

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    // location 0: a_pos (vec2)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    // location 1: a_uv (vec2)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    // location 2: a_color (vec4)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /**
   * Configures the solid white pixel region used for drawRect / drawLine / drawDiamondOutline.
   */
  setSolidPixelSource(
    texture: WebGLTexture,
    texWidth: number,
    texHeight: number,
    pixelRect: SpriteFrameRect,
  ): void {
    this.solidTexture = texture;
    this.solidTexWidth = texWidth;
    this.solidTexHeight = texHeight;
    // Sample strictly inside the solid white square to prevent edge bleed
    const cx = (pixelRect.x + pixelRect.w * 0.5) / texWidth;
    const cy = (pixelRect.y + pixelRect.h * 0.5) / texHeight;
    this.solidU0 = cx;
    this.solidV0 = cy;
    this.solidU1 = cx;
    this.solidV1 = cy;
  }

  setBakedFonts(fonts: Record<BitmapFontId, BakedFontAtlas> | null): void {
    this.bakedFonts = fonts;
  }

  getBakedFonts(): Record<BitmapFontId, BakedFontAtlas> | null {
    return this.bakedFonts;
  }

  begin(logicalWidth: number, logicalHeight: number): void {
    this.logicalWidth = logicalWidth;
    this.logicalHeight = logicalHeight;
    this.quadCount = 0;
    this.drawCallCount = 0;
    this.active = true;
  }

  setTexture(texture: WebGLTexture, texWidth: number, texHeight: number): void {
    if (this.activeTexture !== texture) {
      if (this.quadCount > 0) {
        this.flush();
      }
      this.activeTexture = texture;
      this.activeTexWidth = texWidth;
      this.activeTexHeight = texHeight;
      this.invTexW = 1 / texWidth;
      this.invTexH = 1 / texHeight;
    } else if (this.activeTexWidth !== texWidth || this.activeTexHeight !== texHeight) {
      this.activeTexWidth = texWidth;
      this.activeTexHeight = texHeight;
      this.invTexW = 1 / texWidth;
      this.invTexH = 1 / texHeight;
    }
  }

  drawQuad(
    x: number,
    y: number,
    w: number,
    h: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    if (!this.active || w === 0 || h === 0 || a <= 0) {
      return;
    }
    if (this.quadCount >= MAX_QUADS) {
      this.flush();
    }

    const x2 = x + w;
    const y2 = y + h;
    const data = this.vertexData;
    let o = this.quadCount * FLOATS_PER_QUAD;

    // Top-left
    data[o++] = x;
    data[o++] = y;
    data[o++] = u0;
    data[o++] = v0;
    data[o++] = r;
    data[o++] = g;
    data[o++] = b;
    data[o++] = a;

    // Top-right
    data[o++] = x2;
    data[o++] = y;
    data[o++] = u1;
    data[o++] = v0;
    data[o++] = r;
    data[o++] = g;
    data[o++] = b;
    data[o++] = a;

    // Bottom-right
    data[o++] = x2;
    data[o++] = y2;
    data[o++] = u1;
    data[o++] = v1;
    data[o++] = r;
    data[o++] = g;
    data[o++] = b;
    data[o++] = a;

    // Bottom-left
    data[o++] = x;
    data[o++] = y2;
    data[o++] = u0;
    data[o++] = v1;
    data[o++] = r;
    data[o++] = g;
    data[o++] = b;
    data[o++] = a;

    this.quadCount++;
  }

  drawAtlasRect(
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    dstX: number,
    dstY: number,
    dstW: number,
    dstH: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    const u0 = srcX * this.invTexW;
    const v0 = srcY * this.invTexH;
    const u1 = (srcX + srcW) * this.invTexW;
    const v1 = (srcY + srcH) * this.invTexH;
    this.drawQuad(dstX, dstY, dstW, dstH, u0, v0, u1, v1, r, g, b, a);
  }

  drawSpriteFrame(
    frame: SpriteFrameRect,
    originX: number,
    originY: number,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
    scaleX = 1,
    scaleY = 1,
  ): void {
    const dstX = Math.round(x + (frame.targetX - originX) * scaleX);
    const dstY = Math.round(y + (frame.targetY - originY) * scaleY);
    const dstW = frame.targetW * scaleX;
    const dstH = frame.targetH * scaleY;
    this.drawAtlasRect(frame.x, frame.y, frame.w, frame.h, dstX, dstY, dstW, dstH, r, g, b, a);
  }

  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    if (!this.solidTexture) {
      return;
    }
    if (this.activeTexture !== this.solidTexture) {
      this.setTexture(this.solidTexture, this.solidTexWidth, this.solidTexHeight);
    }
    this.drawQuad(
      Math.round(x),
      Math.round(y),
      Math.round(w),
      Math.round(h),
      this.solidU0,
      this.solidV0,
      this.solidU1,
      this.solidV1,
      r,
      g,
      b,
      a,
    );
  }

  /**
   * Draws a 100% pixel-crisp line (zero anti-aliasing): axis-aligned fast path or integer Bresenham.
   */
  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    thickness = 1,
  ): void {
    if (!this.solidTexture || a <= 0) {
      return;
    }
    if (this.activeTexture !== this.solidTexture) {
      this.setTexture(this.solidTexture, this.solidTexWidth, this.solidTexHeight);
    }
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const t = Math.max(1, Math.round(thickness));

    if (iy0 === iy1) {
      const left = Math.min(ix0, ix1);
      const width = Math.abs(ix1 - ix0) + 1;
      this.drawQuad(left, iy0, width, t, this.solidU0, this.solidV0, this.solidU1, this.solidV1, r, g, b, a);
      return;
    }
    if (ix0 === ix1) {
      const top = Math.min(iy0, iy1);
      const height = Math.abs(iy1 - iy0) + 1;
      this.drawQuad(ix0, top, t, height, this.solidU0, this.solidV0, this.solidU1, this.solidV1, r, g, b, a);
      return;
    }

    const dx = Math.abs(ix1 - ix0);
    const dy = -Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx + dy;

    while (true) {
      this.drawQuad(ix0, iy0, t, t, this.solidU0, this.solidV0, this.solidU1, this.solidV1, r, g, b, a);
      if (ix0 === ix1 && iy0 === iy1) {
        break;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ix0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  /**
   * Draws a razor-sharp 1px pixel-diamond outline centered at (cx, cy) with integer radius R.
   */
  drawDiamondOutline(
    cx: number,
    cy: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    const ir = Math.round(radius);
    if (ir < 1 || a <= 0 || !this.solidTexture) {
      return;
    }
    if (this.activeTexture !== this.solidTexture) {
      this.setTexture(this.solidTexture, this.solidTexWidth, this.solidTexHeight);
    }
    const icx = Math.round(cx);
    const icy = Math.round(cy);
    const u0 = this.solidU0;
    const v0 = this.solidV0;
    const u1 = this.solidU1;
    const v1 = this.solidV1;

    // Top and bottom vertices
    this.drawQuad(icx, icy - ir, 1, 1, u0, v0, u1, v1, r, g, b, a);
    this.drawQuad(icx, icy + ir, 1, 1, u0, v0, u1, v1, r, g, b, a);
    // Left and right vertices
    this.drawQuad(icx - ir, icy, 1, 1, u0, v0, u1, v1, r, g, b, a);
    this.drawQuad(icx + ir, icy, 1, 1, u0, v0, u1, v1, r, g, b, a);

    // Four 45-degree diagonal edges
    for (let i = 1; i < ir; i++) {
      const inv = ir - i;
      this.drawQuad(icx + i, icy - inv, 1, 1, u0, v0, u1, v1, r, g, b, a);
      this.drawQuad(icx + i, icy + inv, 1, 1, u0, v0, u1, v1, r, g, b, a);
      this.drawQuad(icx - i, icy - inv, 1, 1, u0, v0, u1, v1, r, g, b, a);
      this.drawQuad(icx - i, icy + inv, 1, 1, u0, v0, u1, v1, r, g, b, a);
    }
  }

  flush(): void {
    if (this.quadCount === 0 || !this.activeTexture) {
      this.quadCount = 0;
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, this.logicalWidth, this.logicalHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.activeTexture);
    gl.uniform1i(this.uTex, 0);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    // Upload only the active slice via subarray (zero copy allocation; typed array view)
    const floatCount = this.quadCount * FLOATS_PER_QUAD;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, floatCount));
    gl.drawElements(gl.TRIANGLES, this.quadCount * INDICES_PER_QUAD, gl.UNSIGNED_SHORT, 0);

    gl.bindVertexArray(null);
    this.quadCount = 0;
    this.drawCallCount++;
  }

  end(): void {
    this.flush();
    this.active = false;
  }

  getDrawCallCount(): number {
    return this.drawCallCount;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
