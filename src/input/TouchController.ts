export interface TouchCircleControl {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly hitRadius: number;
}

export interface TouchRectControl {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly hitPad: number;
}

export interface TouchLayoutGeometry {
  readonly portrait: boolean;
  readonly stickZone: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly stickCenterX: number;
  readonly stickCenterY: number;
  readonly stickRadius: number;
  readonly stickDeadzoneX: number;
  readonly stickDropY: number;
  readonly spinCcw: TouchCircleControl;
  readonly spinCw: TouchCircleControl;
  readonly hardDrop: TouchRectControl;
  readonly pause: TouchRectControl;
}

export interface TouchSimState {
  readonly moveLeft: boolean;
  readonly moveRight: boolean;
  readonly moveLeftPressed: boolean;
  readonly moveRightPressed: boolean;
  readonly spinLeftPressed: boolean;
  readonly spinRightPressed: boolean;
  readonly hardDropPressed: boolean;
}

export interface TouchVisualState {
  readonly geometry: TouchLayoutGeometry;
  readonly stickActive: boolean;
  readonly stickAnchorX: number;
  readonly stickAnchorY: number;
  readonly nubOffsetX: number;
  readonly nubOffsetY: number;
  readonly stickDir: -1 | 0 | 1;
  readonly stickDropProgress: number; // 0..1 proximity into downward hard-drop cone
  readonly stickDropFired: boolean;
  readonly spinCcwHeld: boolean;
  readonly spinCwHeld: boolean;
  readonly hardDropHeld: boolean;
  readonly pauseHeld: boolean;
  readonly spinCcwPulse: number;
  readonly spinCwPulse: number;
  readonly hardDropPulse: number;
  readonly pausePulse: number;
}

type ButtonKind = 'spinCcw' | 'spinCw' | 'hardDrop' | 'pause';

const PORTRAIT_GEOMETRY: TouchLayoutGeometry = {
  portrait: true,
  stickZone: { x: 0, y: 196, w: 94, h: 124 },
  stickCenterX: 46,
  stickCenterY: 262,
  stickRadius: 26,
  stickDeadzoneX: 6,
  stickDropY: 18,
  spinCcw: { cx: 114, cy: 248, radius: 16, hitRadius: 21 },
  spinCw: { cx: 154, cy: 236, radius: 16, hitRadius: 21 },
  hardDrop: { x: 118, y: 273, w: 48, h: 26, hitPad: 5 },
  pause: { x: 154, y: 5, w: 20, h: 20, hitPad: 5 },
};

const LANDSCAPE_GEOMETRY: TouchLayoutGeometry = {
  portrait: false,
  stickZone: { x: 0, y: 92, w: 120, h: 88 },
  stickCenterX: 54,
  stickCenterY: 138,
  stickRadius: 22,
  stickDeadzoneX: 5,
  stickDropY: 15,
  spinCcw: { cx: 226, cy: 132, radius: 14, hitRadius: 18 },
  spinCw: { cx: 262, cy: 122, radius: 14, hitRadius: 18 },
  hardDrop: { x: 265, y: 143, w: 42, h: 22, hitPad: 4 },
  pause: { x: 294, y: 5, w: 20, h: 16, hitPad: 4 },
};

const STICK_DROP_CONE_RATIO = 1.55;

export function getTouchLayoutGeometry(portrait: boolean): TouchLayoutGeometry {
  return portrait ? PORTRAIT_GEOMETRY : LANDSCAPE_GEOMETRY;
}

function hitCircle(x: number, y: number, c: TouchCircleControl): boolean {
  const dx = x - c.cx;
  const dy = y - c.cy;
  return dx * dx + dy * dy <= c.hitRadius * c.hitRadius;
}

function hitRect(x: number, y: number, r: TouchRectControl): boolean {
  return (
    x >= r.x - r.hitPad &&
    x <= r.x + r.w + r.hitPad &&
    y >= r.y - r.hitPad &&
    y <= r.y + r.h + r.hitPad
  );
}

function hitZone(x: number, y: number, z: { x: number; y: number; w: number; h: number }): boolean {
  return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Pure, DOM-free multi-touch gameplay controller supporting simultaneous left translucent
 * virtual stick (move + guarded downward hard-drop cone) and right Spin CCW / Spin CW /
 * Hard Drop / Pause buttons across Portrait (180x320) and Landscape (320x180).
 */
export class TouchController {
  private stickPointerId: number | null = null;
  private stickAnchorX = PORTRAIT_GEOMETRY.stickCenterX;
  private stickAnchorY = PORTRAIT_GEOMETRY.stickCenterY;
  private stickDir: -1 | 0 | 1 = 0;
  private stickDropLatched = false;
  private stickDropProgress = 0;
  private lastPortrait = true;

  // Smooth spring visual state
  private visAnchorX = PORTRAIT_GEOMETRY.stickCenterX;
  private visAnchorY = PORTRAIT_GEOMETRY.stickCenterY;
  private visNubX = 0;
  private visNubY = 0;

  private readonly buttonPointers = new Map<number, ButtonKind>();

  // Edge latches consumed by InputManager
  private moveLeftPressed = false;
  private moveRightPressed = false;
  private spinLeftPressed = false;
  private spinRightPressed = false;
  private hardDropPressed = false;
  private pausePressed = false;

  // Press visual ripple pulses (0..1)
  private spinCcwPulse = 0;
  private spinCwPulse = 0;
  private hardDropPulse = 0;
  private pausePulse = 0;

  reset(portrait?: boolean): void {
    const p = portrait !== undefined ? portrait : this.lastPortrait;
    const geom = getTouchLayoutGeometry(p);
    this.lastPortrait = p;
    this.stickPointerId = null;
    this.stickAnchorX = geom.stickCenterX;
    this.stickAnchorY = geom.stickCenterY;
    this.visAnchorX = geom.stickCenterX;
    this.visAnchorY = geom.stickCenterY;
    this.visNubX = 0;
    this.visNubY = 0;
    this.stickDir = 0;
    this.stickDropLatched = false;
    this.stickDropProgress = 0;
    this.buttonPointers.clear();
    this.clearEdges();
  }

  clearEdges(): void {
    this.moveLeftPressed = false;
    this.moveRightPressed = false;
    this.spinLeftPressed = false;
    this.spinRightPressed = false;
    this.hardDropPressed = false;
    this.pausePressed = false;
  }

  hasActivePointers(): boolean {
    return this.stickPointerId !== null || this.buttonPointers.size > 0;
  }

  /**
   * Handles a pointer down inside gameplay logical coordinates.
   * Returns true if captured by a touch control (stick, spin, drop, or pause).
   */
  onPointerDown(pointerId: number, x: number, y: number, portrait: boolean): boolean {
    if (portrait !== this.lastPortrait) {
      this.reset(portrait);
    }
    const geom = getTouchLayoutGeometry(portrait);

    // 1. Top-right Pause button
    if (hitRect(x, y, geom.pause)) {
      this.buttonPointers.set(pointerId, 'pause');
      this.pausePressed = true;
      this.pausePulse = 1;
      return true;
    }

    // 2. Right action buttons (fire immediately on pointerdown for zero latency)
    if (hitCircle(x, y, geom.spinCcw)) {
      this.buttonPointers.set(pointerId, 'spinCcw');
      this.spinLeftPressed = true;
      this.spinCcwPulse = 1;
      return true;
    }
    if (hitCircle(x, y, geom.spinCw)) {
      this.buttonPointers.set(pointerId, 'spinCw');
      this.spinRightPressed = true;
      this.spinCwPulse = 1;
      return true;
    }
    if (hitRect(x, y, geom.hardDrop)) {
      this.buttonPointers.set(pointerId, 'hardDrop');
      this.hardDropPressed = true;
      this.hardDropPulse = 1;
      return true;
    }

    // 3. Left translucent virtual stick (floating-in-zone anchor)
    if (this.stickPointerId === null && hitZone(x, y, geom.stickZone)) {
      const margin = Math.round(geom.stickRadius * 0.72);
      const ax = clamp(x, geom.stickZone.x + margin, geom.stickZone.x + geom.stickZone.w - margin);
      const ay = clamp(y, geom.stickZone.y + margin, geom.stickZone.y + geom.stickZone.h - margin);
      this.stickPointerId = pointerId;
      this.stickAnchorX = ax;
      this.stickAnchorY = ay;
      this.visAnchorX = ax;
      this.visAnchorY = ay;
      this.stickDir = 0;
      this.stickDropLatched = false;
      this.stickDropProgress = 0;
      this.updateStickFromPointer(x, y, geom);
      return true;
    }

    return false;
  }

  onPointerMove(pointerId: number, x: number, y: number, portrait: boolean): boolean {
    if (pointerId !== this.stickPointerId) {
      return this.buttonPointers.has(pointerId);
    }
    const geom = getTouchLayoutGeometry(portrait);
    this.updateStickFromPointer(x, y, geom);
    return true;
  }

  onPointerUp(pointerId: number): boolean {
    if (pointerId === this.stickPointerId) {
      this.stickPointerId = null;
      this.stickDir = 0;
      this.stickDropLatched = false;
      this.stickDropProgress = 0;
      return true;
    }
    return this.buttonPointers.delete(pointerId);
  }

  onPointerCancel(pointerId: number): boolean {
    return this.onPointerUp(pointerId);
  }

  private updateStickFromPointer(x: number, y: number, geom: TouchLayoutGeometry): void {
    const dx = x - this.stickAnchorX;
    const dy = y - this.stickAnchorY;

    // Clamp displayed nub cleanly to stick gate radius
    const dist = Math.hypot(dx, dy);
    if (dist > geom.stickRadius && dist > 0.001) {
      const scale = geom.stickRadius / dist;
      this.visNubX = dx * scale;
      this.visNubY = dy * scale;
    } else {
      this.visNubX = dx;
      this.visNubY = dy;
    }

    // Strict downward cardinal cone for intentional stick hard-drop
    const inDropCone = dy > 0 && dy > Math.abs(dx) * STICK_DROP_CONE_RATIO;
    this.stickDropProgress = inDropCone ? clamp(dy / geom.stickDropY, 0, 1) : 0;

    if (inDropCone && dy >= geom.stickDropY) {
      if (!this.stickDropLatched) {
        this.stickDropLatched = true;
        this.hardDropPressed = true;
        this.hardDropPulse = Math.max(this.hardDropPulse, 0.85);
      }
      // Pause lateral drift while cleanly inside hard-drop pull
      this.stickDir = 0;
      return;
    }

    // Re-arm stick drop once thumb returns above half threshold
    if (dy < geom.stickDropY * 0.5) {
      this.stickDropLatched = false;
    }

    let nextDir: -1 | 0 | 1 = 0;
    if (dx <= -geom.stickDeadzoneX) {
      nextDir = -1;
    } else if (dx >= geom.stickDeadzoneX) {
      nextDir = 1;
    }

    if (nextDir !== this.stickDir) {
      if (nextDir === -1) {
        this.moveLeftPressed = true;
      } else if (nextDir === 1) {
        this.moveRightPressed = true;
      }
      this.stickDir = nextDir;
    }
  }

  updateVisuals(dtSec: number, portrait: boolean): void {
    if (portrait !== this.lastPortrait) {
      this.reset(portrait);
    }
    const geom = getTouchLayoutGeometry(portrait);
    const dt = Math.max(0, Math.min(dtSec, 0.1));
    const decay = Math.exp(-dt * 18);

    if (this.stickPointerId === null) {
      this.visNubX *= decay;
      this.visNubY *= decay;
      if (Math.abs(this.visNubX) < 0.15) this.visNubX = 0;
      if (Math.abs(this.visNubY) < 0.15) this.visNubY = 0;

      const anchorDecay = Math.exp(-dt * 10);
      this.visAnchorX = geom.stickCenterX + (this.visAnchorX - geom.stickCenterX) * anchorDecay;
      this.visAnchorY = geom.stickCenterY + (this.visAnchorY - geom.stickCenterY) * anchorDecay;
    }

    const pulseDecay = dt * 4.2;
    this.spinCcwPulse = Math.max(0, this.spinCcwPulse - pulseDecay);
    this.spinCwPulse = Math.max(0, this.spinCwPulse - pulseDecay);
    this.hardDropPulse = Math.max(0, this.hardDropPulse - pulseDecay);
    this.pausePulse = Math.max(0, this.pausePulse - pulseDecay);
  }

  consumeSimState(): TouchSimState {
    const res: TouchSimState = {
      moveLeft: this.stickDir === -1,
      moveRight: this.stickDir === 1,
      moveLeftPressed: this.moveLeftPressed,
      moveRightPressed: this.moveRightPressed,
      spinLeftPressed: this.spinLeftPressed,
      spinRightPressed: this.spinRightPressed,
      hardDropPressed: this.hardDropPressed,
    };
    this.moveLeftPressed = false;
    this.moveRightPressed = false;
    this.spinLeftPressed = false;
    this.spinRightPressed = false;
    this.hardDropPressed = false;
    return res;
  }

  consumePausePressed(): boolean {
    const p = this.pausePressed;
    this.pausePressed = false;
    return p;
  }

  private isButtonHeld(kind: ButtonKind): boolean {
    for (const v of this.buttonPointers.values()) {
      if (v === kind) return true;
    }
    return false;
  }

  getVisualState(portrait: boolean): TouchVisualState {
    const geom = getTouchLayoutGeometry(portrait);
    const active = this.stickPointerId !== null;
    return {
      geometry: geom,
      stickActive: active,
      stickAnchorX: active ? this.stickAnchorX : this.visAnchorX,
      stickAnchorY: active ? this.stickAnchorY : this.visAnchorY,
      nubOffsetX: active ? this.visNubX : this.visNubX,
      nubOffsetY: active ? this.visNubY : this.visNubY,
      stickDir: this.stickDir,
      stickDropProgress: this.stickDropProgress,
      stickDropFired: this.stickDropLatched,
      spinCcwHeld: this.isButtonHeld('spinCcw'),
      spinCwHeld: this.isButtonHeld('spinCw'),
      hardDropHeld: this.isButtonHeld('hardDrop'),
      pauseHeld: this.isButtonHeld('pause'),
      spinCcwPulse: this.spinCcwPulse,
      spinCwPulse: this.spinCwPulse,
      hardDropPulse: this.hardDropPulse,
      pausePulse: this.pausePulse,
    };
  }
}
