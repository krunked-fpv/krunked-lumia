import {
  CONTAINER_HEIGHT,
  CONTAINER_WIDTH,
  parseHexRgb01,
  type Palette,
  type RenderSettings,
  type SimEvent,
} from '../contracts/index.js';
import type { BitmapFontId, TextAlign } from '../assets/bitmapFont.js';

export const MAX_PARTICLES = 512;
export const MAX_BG_GEOMETRY = 48;
export const MAX_BANNERS = 16;

export const DEFAULT_CONTAINER_ORIGIN_X = 126; // (320 - 68) / 2
export const DEFAULT_CONTAINER_ORIGIN_Y = 26; // (180 - 128) / 2

export interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  age: number;
  maxAge: number;
  size: number;
  colorSlot: number; // 0..5
  spawnSeq: number;
}

export interface BgGeometrySlot {
  active: boolean;
  cx: number;
  cy: number;
  startRadius: number;
  endRadius: number;
  radius: number;
  prevRadius: number;
  age: number;
  maxAge: number;
  peakAlpha: number;
  colorSlot: number; // 0..5
  doubleRing: boolean;
  spawnSeq: number;
}

export interface FloatingBannerSlot {
  active: boolean;
  text: string;
  x: number;
  y: number;
  prevY: number;
  vy: number;
  age: number;
  maxAge: number;
  colorSlot: number; // 0..5
  font: BitmapFontId;
  spawnSeq: number;
}

export interface ParticleRenderTarget {
  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void;
  drawDiamondOutline(
    cx: number,
    cy: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void;
  drawText(
    text: string,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
    font?: BitmapFontId,
    align?: TextAlign,
    scale?: number,
  ): void;
}

export interface SimEventFxFeedback {
  bloomPulse: number;
  flashSlot: number | null;
  flashIntensity: number;
}

/**
 * Maps an 8x29 staggered board grid coordinate into 320x180 logical screen pixels.
 */
export function cellToScreenPixel(
  cellX: number,
  cellY: number,
  containerOriginX = DEFAULT_CONTAINER_ORIGIN_X,
  containerOriginY = DEFAULT_CONTAINER_ORIGIN_Y,
): { x: number; y: number } {
  const cx = (cellY % 2 === 0 ? 10 : 6) + cellX * 8;
  const cy = 5 + cellY * 4;
  return {
    x: containerOriginX + cx,
    y: containerOriginY + cy,
  };
}

/**
 * Mixolumia BGGeometry alpha ease curve:
 * crisp fade-in over first 12% of life, followed by smooth quadratic ease-out to 0.
 */
export function computeBgDiamondAlpha(normalizedAge: number, peakAlpha: number): number {
  if (normalizedAge <= 0 || normalizedAge >= 1) {
    return 0;
  }
  const fadeInEnd = 0.12;
  if (normalizedAge < fadeInEnd) {
    return (normalizedAge / fadeInEnd) * peakAlpha;
  }
  const u = (normalizedAge - fadeInEnd) / (1 - fadeInEnd);
  return (1 - u) * (1 - u) * peakAlpha;
}

function createEmptyParticle(): ParticleSlot {
  return {
    active: false,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    gravity: 0.04,
    drag: 0.95,
    age: 0,
    maxAge: 30,
    size: 2,
    colorSlot: 2,
    spawnSeq: 0,
  };
}

function createEmptyBgGeometry(): BgGeometrySlot {
  return {
    active: false,
    cx: 160,
    cy: 90,
    startRadius: 16,
    endRadius: 140,
    radius: 16,
    prevRadius: 16,
    age: 0,
    maxAge: 60,
    peakAlpha: 0.45,
    colorSlot: 2,
    doubleRing: false,
    spawnSeq: 0,
  };
}

function createEmptyBanner(): FloatingBannerSlot {
  return {
    active: false,
    text: '',
    x: 160,
    y: 90,
    prevY: 90,
    vy: -0.35,
    age: 0,
    maxAge: 48,
    colorSlot: 3,
    font: '3x5',
    spawnSeq: 0,
  };
}

/**
 * Fixed-capacity pooled particle, BGGeometry expanding diamond, and floating banner engine.
 * Enforces strict zero-growth pools:
 * - 512 pixel particles
 * - 48 BGGeometry expanding diamonds
 * - 16 floating pixel banners
 */
export class ParticlesAndBg {
  private readonly particlePool: ParticleSlot[];
  private readonly bgPool: BgGeometrySlot[];
  private readonly bannerPool: FloatingBannerSlot[];

  private activeParticles = 0;
  private activeBgShapes = 0;
  private activeBanners = 0;
  private spawnCounter = 1;
  private rngState = 0x9e3779b9;

  constructor() {
    this.particlePool = new Array<ParticleSlot>(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particlePool[i] = createEmptyParticle();
    }

    this.bgPool = new Array<BgGeometrySlot>(MAX_BG_GEOMETRY);
    for (let i = 0; i < MAX_BG_GEOMETRY; i++) {
      this.bgPool[i] = createEmptyBgGeometry();
    }

    this.bannerPool = new Array<FloatingBannerSlot>(MAX_BANNERS);
    for (let i = 0; i < MAX_BANNERS; i++) {
      this.bannerPool[i] = createEmptyBanner();
    }
  }

  private nextRand(): number {
    let x = this.rngState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x;
    return ((x >>> 0) & 0x00ffffff) / 0x01000000;
  }

  reset(): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particlePool[i].active = false;
    }
    for (let i = 0; i < MAX_BG_GEOMETRY; i++) {
      this.bgPool[i].active = false;
    }
    for (let i = 0; i < MAX_BANNERS; i++) {
      this.bannerPool[i].active = false;
    }
    this.activeParticles = 0;
    this.activeBgShapes = 0;
    this.activeBanners = 0;
  }

  private acquireParticleSlot(): ParticleSlot {
    let oldestIdx = 0;
    let oldestSeq = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const slot = this.particlePool[i];
      if (!slot.active) {
        this.activeParticles++;
        return slot;
      }
      if (slot.spawnSeq < oldestSeq) {
        oldestSeq = slot.spawnSeq;
        oldestIdx = i;
      }
    }
    return this.particlePool[oldestIdx];
  }

  private acquireBgSlot(): BgGeometrySlot {
    let oldestIdx = 0;
    let oldestSeq = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < MAX_BG_GEOMETRY; i++) {
      const slot = this.bgPool[i];
      if (!slot.active) {
        this.activeBgShapes++;
        return slot;
      }
      if (slot.spawnSeq < oldestSeq) {
        oldestSeq = slot.spawnSeq;
        oldestIdx = i;
      }
    }
    return this.bgPool[oldestIdx];
  }

  private acquireBannerSlot(): FloatingBannerSlot {
    let oldestIdx = 0;
    let oldestSeq = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < MAX_BANNERS; i++) {
      const slot = this.bannerPool[i];
      if (!slot.active) {
        this.activeBanners++;
        return slot;
      }
      if (slot.spawnSeq < oldestSeq) {
        oldestSeq = slot.spawnSeq;
        oldestIdx = i;
      }
    }
    return this.bannerPool[oldestIdx];
  }

  spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    colorSlot: number,
    maxAge = 28,
    size = 2,
    gravity = 0.04,
    drag = 0.94,
  ): void {
    const slot = this.acquireParticleSlot();
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.prevX = x;
    slot.prevY = y;
    slot.vx = vx;
    slot.vy = vy;
    slot.gravity = gravity;
    slot.drag = drag;
    slot.age = 0;
    slot.maxAge = Math.max(1, maxAge);
    slot.size = size;
    slot.colorSlot = Math.max(0, Math.min(5, colorSlot));
    slot.spawnSeq = this.spawnCounter++;
  }

  spawnBgDiamond(
    cx: number,
    cy: number,
    startRadius: number,
    endRadius: number,
    colorSlot: number,
    maxAge = 60,
    peakAlpha = 0.42,
    doubleRing = false,
  ): void {
    const slot = this.acquireBgSlot();
    slot.active = true;
    slot.cx = cx;
    slot.cy = cy;
    slot.startRadius = startRadius;
    slot.endRadius = endRadius;
    slot.radius = startRadius;
    slot.prevRadius = startRadius;
    slot.age = 0;
    slot.maxAge = Math.max(1, maxAge);
    slot.peakAlpha = peakAlpha;
    slot.colorSlot = Math.max(0, Math.min(5, colorSlot));
    slot.doubleRing = doubleRing;
    slot.spawnSeq = this.spawnCounter++;
  }

  spawnBanner(
    text: string,
    x: number,
    y: number,
    colorSlot = 3,
    font: BitmapFontId = '3x5',
    maxAge = 54,
    vy = -0.32,
  ): void {
    const slot = this.acquireBannerSlot();
    slot.active = true;
    slot.text = text;
    slot.x = x;
    slot.y = y;
    slot.prevY = y;
    slot.vy = vy;
    slot.age = 0;
    slot.maxAge = Math.max(1, maxAge);
    slot.colorSlot = Math.max(0, Math.min(5, colorSlot));
    slot.font = font;
    slot.spawnSeq = this.spawnCounter++;
  }

  /**
   * Consumes deterministic SimEvent[] emitted during a 60 Hz sim tick, spawning crisp
   * pixel particles, BGGeometry waves, and floating score/combo banners, and returning
   * recommended bloom pulse & flash feedback for the WebGL2Renderer.
   */
  consumeSimEvents(
    events: readonly SimEvent[],
    containerOriginX = DEFAULT_CONTAINER_ORIGIN_X,
    containerOriginY = DEFAULT_CONTAINER_ORIGIN_Y,
  ): SimEventFxFeedback {
    const boardCenterX = containerOriginX + CONTAINER_WIDTH * 0.5;
    const boardCenterY = containerOriginY + CONTAINER_HEIGHT * 0.5;
    let bloomPulse = 0;
    let flashSlot: number | null = null;
    let flashIntensity = 0;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'TETRAD_HARD_DROP': {
          const dropDist = Math.max(1, ev.toY - ev.fromY);
          const steps = Math.min(12, Math.max(3, Math.floor(dropDist / 2)));
          for (let s = 0; s < steps; s++) {
            const frac = s / steps;
            const sy = ev.fromY + frac * dropDist;
            const pos = cellToScreenPixel(ev.x, Math.round(sy), containerOriginX, containerOriginY);
            const color = ev.colors[s & 3];
            this.spawnParticle(
              pos.x + (this.nextRand() - 0.5) * 8,
              pos.y,
              (this.nextRand() - 0.5) * 0.5,
              -0.25 - this.nextRand() * 0.35,
              color + 1,
              14 + Math.floor(this.nextRand() * 8),
              1,
              0.01,
              0.92,
            );
          }
          bloomPulse = Math.max(bloomPulse, 0.05);
          break;
        }

        case 'TETRAD_LOCK': {
          for (let c = 0; c < ev.cells.length; c++) {
            const cell = ev.cells[c];
            const pos = cellToScreenPixel(cell.x, cell.y, containerOriginX, containerOriginY);
            for (let k = 0; k < 2; k++) {
              const angle = this.nextRand() * Math.PI * 2;
              const speed = 0.4 + this.nextRand() * 0.8;
              this.spawnParticle(
                pos.x,
                pos.y,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed - 0.25,
                cell.color + 1,
                16 + Math.floor(this.nextRand() * 10),
                1,
                0.03,
                0.92,
              );
            }
          }
          break;
        }

        case 'BLOCKS_CLEAR': {
          let sumX = 0;
          let sumY = 0;
          const perCell = ev.clearTier >= 2 ? 7 : ev.clearTier === 1 ? 6 : 5;
          for (let c = 0; c < ev.cells.length; c++) {
            const cell = ev.cells[c];
            const pos = cellToScreenPixel(cell.x, cell.y, containerOriginX, containerOriginY);
            sumX += pos.x;
            sumY += pos.y;
            for (let k = 0; k < perCell; k++) {
              const angle = (k / perCell) * Math.PI * 2 + this.nextRand() * 0.6;
              const speed = 0.75 + this.nextRand() * 1.65;
              this.spawnParticle(
                pos.x + (this.nextRand() - 0.5) * 3,
                pos.y + (this.nextRand() - 0.5) * 3,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed - 0.4,
                cell.color + 1,
                22 + Math.floor(this.nextRand() * 18),
                k % 3 === 0 ? 2 : 1,
                0.045,
                0.94,
              );
            }
          }

          const avgX = ev.cells.length > 0 ? sumX / ev.cells.length : boardCenterX;
          const avgY = ev.cells.length > 0 ? sumY / ev.cells.length : boardCenterY;
          const leadSlot = ev.cells.length > 0 ? ev.cells[0].color + 1 : 3;

          this.spawnBgDiamond(
            boardCenterX,
            boardCenterY,
            24,
            120 + ev.clearTier * 30,
            leadSlot,
            52 + ev.clearTier * 10,
            0.34 + ev.clearTier * 0.08,
            ev.clearTier >= 1,
          );

          this.spawnBanner(`+${ev.waveScore}`, avgX, Math.max(16, avgY - 4), 2, '3x5', 46, -0.35);

          const clearPulse = 0.14 + ev.clearTier * 0.1 + Math.min(ev.combo, 4) * 0.05;
          bloomPulse = Math.max(bloomPulse, clearPulse);
          if (ev.clearTier >= 1 || ev.combo >= 2) {
            flashSlot = leadSlot;
            flashIntensity = Math.max(flashIntensity, 0.35 + ev.clearTier * 0.15);
          }
          break;
        }

        case 'COMBO_CHAIN': {
          const pos = cellToScreenPixel(ev.x, ev.y, containerOriginX, containerOriginY);
          const slot = ev.combo >= 4 ? 5 : ev.combo === 3 ? 4 : 3;
          this.spawnBanner(
            `COMBO x${ev.combo}`,
            Math.max(40, Math.min(280, pos.x)),
            Math.max(20, pos.y - 12),
            slot,
            '5x7',
            58,
            -0.28,
          );
          this.spawnBgDiamond(
            boardCenterX,
            boardCenterY,
            18,
            150 + ev.comboTier * 20,
            slot,
            64,
            0.46,
            true,
          );
          bloomPulse = Math.max(bloomPulse, 0.2 + ev.comboTier * 0.1);
          flashSlot = slot;
          flashIntensity = Math.max(flashIntensity, 0.45);
          break;
        }

        case 'PERFECT_CLEAR': {
          for (let k = 0; k < 64; k++) {
            const angle = (k / 64) * Math.PI * 2;
            const speed = 1.0 + this.nextRand() * 2.2;
            this.spawnParticle(
              boardCenterX,
              boardCenterY,
              Math.cos(angle) * speed,
              Math.sin(angle) * speed - 0.3,
              2 + (k % 4),
              36 + Math.floor(this.nextRand() * 24),
              2,
              0.03,
              0.96,
            );
          }
          this.spawnBgDiamond(boardCenterX, boardCenterY, 10, 175, 3, 76, 0.55, true);
          this.spawnBgDiamond(boardCenterX, boardCenterY, 26, 195, 5, 88, 0.45, false);
          this.spawnBgDiamond(boardCenterX, boardCenterY, 42, 210, 4, 96, 0.35, false);
          this.spawnBanner('PERFECT CLEAR', boardCenterX, boardCenterY - 12, 3, '5x7', 78, -0.2);
          this.spawnBanner(`+${ev.bonus}`, boardCenterX, boardCenterY + 2, 2, '3x5', 74, -0.18);
          bloomPulse = Math.max(bloomPulse, 0.55);
          flashSlot = 3;
          flashIntensity = Math.max(flashIntensity, 0.85);
          break;
        }

        case 'LEVEL_UP': {
          this.spawnBgDiamond(boardCenterX, boardCenterY, 30, 165, 3, 66, 0.4, true);
          this.spawnBanner(
            `LEVEL ${ev.level + 1}`,
            boardCenterX,
            containerOriginY + 18,
            3,
            '5x7',
            64,
            -0.22,
          );
          bloomPulse = Math.max(bloomPulse, 0.2);
          break;
        }

        case 'RELAXED_RESET': {
          this.spawnBgDiamond(boardCenterX, boardCenterY, 14, 160, 4, 68, 0.42, true);
          this.spawnBanner('BOARD CLEAR', boardCenterX, boardCenterY, 4, '5x7', 66, -0.22);
          bloomPulse = Math.max(bloomPulse, 0.24);
          break;
        }

        case 'GAME_VICTORY': {
          for (let k = 0; k < 48; k++) {
            const angle = (k / 48) * Math.PI * 2;
            const speed = 0.8 + this.nextRand() * 2.0;
            this.spawnParticle(
              boardCenterX,
              boardCenterY,
              Math.cos(angle) * speed,
              Math.sin(angle) * speed - 0.5,
              2 + (k % 4),
              40 + Math.floor(this.nextRand() * 24),
              2,
              0.035,
              0.96,
            );
          }
          this.spawnBgDiamond(boardCenterX, boardCenterY, 14, 190, 3, 84, 0.5, true);
          bloomPulse = Math.max(bloomPulse, 0.45);
          flashSlot = 3;
          flashIntensity = Math.max(flashIntensity, 0.65);
          break;
        }

        case 'GAME_OVER': {
          for (let k = 0; k < 24; k++) {
            const angle = this.nextRand() * Math.PI * 2;
            const speed = 0.5 + this.nextRand() * 1.4;
            this.spawnParticle(
              boardCenterX + (this.nextRand() - 0.5) * 40,
              boardCenterY + (this.nextRand() - 0.5) * 60,
              Math.cos(angle) * speed,
              Math.sin(angle) * speed,
              5,
              28 + Math.floor(this.nextRand() * 18),
              2,
              0.05,
              0.95,
            );
          }
          this.spawnBgDiamond(boardCenterX, boardCenterY, 20, 140, 5, 60, 0.35, false);
          bloomPulse = Math.max(bloomPulse, 0.18);
          break;
        }

        default:
          break;
      }
    }

    return { bloomPulse, flashSlot, flashIntensity };
  }

  /**
   * Advances all pooled particles, BGGeometry shapes, and banners by `dtTicks` (1.0 = one 60 Hz step).
   */
  update(dtTicks = 1): void {
    const dt = Math.max(0, dtTicks);

    // 1. Update particles
    let pCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particlePool[i];
      if (!p.active) continue;
      p.prevX = p.x;
      p.prevY = p.y;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        continue;
      }
      const dragPow = dt === 1 ? p.drag : Math.pow(p.drag, dt);
      p.vx *= dragPow;
      p.vy = p.vy * dragPow + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      pCount++;
    }
    this.activeParticles = pCount;

    // 2. Update BGGeometry expanding diamonds
    let bgCount = 0;
    for (let i = 0; i < MAX_BG_GEOMETRY; i++) {
      const g = this.bgPool[i];
      if (!g.active) continue;
      g.prevRadius = g.radius;
      g.age += dt;
      if (g.age >= g.maxAge) {
        g.active = false;
        continue;
      }
      const t = g.age / g.maxAge;
      const easeOut = 1 - (1 - t) * (1 - t);
      g.radius = g.startRadius + (g.endRadius - g.startRadius) * easeOut;
      bgCount++;
    }
    this.activeBgShapes = bgCount;

    // 3. Update floating banners
    let bCount = 0;
    for (let i = 0; i < MAX_BANNERS; i++) {
      const b = this.bannerPool[i];
      if (!b.active) continue;
      b.prevY = b.y;
      b.age += dt;
      if (b.age >= b.maxAge) {
        b.active = false;
        continue;
      }
      b.y += b.vy * dt;
      bCount++;
    }
    this.activeBanners = bCount;
  }

  /**
   * Renders BGGeometry expanding pixel diamonds on the BackgroundParticles layer.
   */
  renderBackground(
    target: ParticleRenderTarget,
    palette: Palette,
    settings: RenderSettings,
    interpAlpha = 1,
  ): void {
    if (!settings.bgShapes) {
      return;
    }
    const alphaT = Math.max(0, Math.min(1, interpAlpha));
    for (let i = 0; i < MAX_BG_GEOMETRY; i++) {
      const g = this.bgPool[i];
      if (!g.active) continue;
      const t = Math.min(1, g.age / g.maxAge);
      const a = computeBgDiamondAlpha(t, g.peakAlpha);
      if (a <= 0.005) continue;
      const r = g.prevRadius + (g.radius - g.prevRadius) * alphaT;
      const [cr, cg, cb] = parseHexRgb01(palette.colors[g.colorSlot] ?? palette.colors[2]);
      target.drawDiamondOutline(g.cx, g.cy, r, cr, cg, cb, a);
      if (g.doubleRing && r > 8) {
        target.drawDiamondOutline(g.cx, g.cy, r - 5, cr, cg, cb, a * 0.6);
      }
    }
  }

  /**
   * Renders foreground pixel particles and floating score/combo banners.
   */
  renderForeground(
    target: ParticleRenderTarget,
    palette: Palette,
    settings: RenderSettings,
    interpAlpha = 1,
  ): void {
    const alphaT = Math.max(0, Math.min(1, interpAlpha));

    if (settings.particles) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = this.particlePool[i];
        if (!p.active) continue;
        const lifeLeft = 1 - p.age / p.maxAge;
        if (lifeLeft <= 0) continue;
        const drawX = p.prevX + (p.x - p.prevX) * alphaT;
        const drawY = p.prevY + (p.y - p.prevY) * alphaT;
        const [cr, cg, cb] = parseHexRgb01(palette.colors[p.colorSlot] ?? palette.colors[2]);
        target.drawRect(drawX, drawY, p.size, p.size, cr, cg, cb, Math.min(1, lifeLeft * 1.4));
      }
    }

    for (let i = 0; i < MAX_BANNERS; i++) {
      const b = this.bannerPool[i];
      if (!b.active) continue;
      const t = b.age / b.maxAge;
      const alpha = t < 0.7 ? 1 : Math.max(0, (1 - t) / 0.3);
      if (alpha <= 0.01) continue;
      const drawY = b.prevY + (b.y - b.prevY) * alphaT;
      const [cr, cg, cb] = parseHexRgb01(palette.colors[b.colorSlot] ?? palette.colors[3]);
      target.drawText(b.text, b.x, drawY, cr, cg, cb, alpha, b.font, 'center', 1);
    }
  }

  getCounts(): { particles: number; bgGeometry: number; banners: number } {
    return {
      particles: this.activeParticles,
      bgGeometry: this.activeBgShapes,
      banners: this.activeBanners,
    };
  }

  getCapacities(): { particles: number; bgGeometry: number; banners: number } {
    return {
      particles: this.particlePool.length,
      bgGeometry: this.bgPool.length,
      banners: this.bannerPool.length,
    };
  }
}
