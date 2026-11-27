import { parseHexRgb01, type Palette } from '../contracts/index.js';
import type { TouchCircleControl, TouchRectControl, TouchVisualState } from '../input/TouchController.js';
import type { WebGL2Renderer } from '../render/WebGL2Renderer.js';

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function drawOctagonFill(
  renderer: WebGL2Renderer,
  cx: number,
  cy: number,
  radius: number,
  hex: string,
  alpha: number,
): void {
  const r = Math.max(2, Math.round(radius));
  const cut = Math.max(2, Math.round(r * 0.42));
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  for (let dy = -r; dy <= r; dy++) {
    const absY = Math.abs(dy);
    const halfW = absY <= r - cut ? r : Math.max(0, r - (absY - (r - cut)));
    if (halfW > 0) {
      renderer.drawRectHex(ix - halfW, iy + dy, halfW * 2 + 1, 1, hex, alpha);
    }
  }
}

function drawOctagonBorder(
  renderer: WebGL2Renderer,
  cx: number,
  cy: number,
  radius: number,
  hex: string,
  alpha: number,
): void {
  const r = Math.max(2, Math.round(radius));
  const cut = Math.max(2, Math.round(r * 0.42));
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  for (let dy = -r; dy <= r; dy++) {
    const absY = Math.abs(dy);
    const halfW = absY <= r - cut ? r : Math.max(0, r - (absY - (r - cut)));
    if (absY === r) {
      renderer.drawRectHex(ix - halfW, iy + dy, halfW * 2 + 1, 1, hex, alpha);
    } else if (halfW > 0) {
      renderer.drawRectHex(ix - halfW, iy + dy, 1, 1, hex, alpha);
      renderer.drawRectHex(ix + halfW, iy + dy, 1, 1, hex, alpha);
    }
  }
}

function drawBeveledBox(
  renderer: WebGL2Renderer,
  x: number,
  y: number,
  w: number,
  h: number,
  fillHex: string,
  borderHex: string,
  fillAlpha: number,
  borderAlpha: number,
): void {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(w);
  const rh = Math.round(h);
  // Crisp 2px pixel-beveled rectangle matching diamond geometry
  renderer.drawRectHex(rx + 2, ry + 1, rw - 4, rh - 2, fillHex, fillAlpha);
  renderer.drawRectHex(rx + 1, ry + 2, rw - 2, rh - 4, fillHex, fillAlpha);

  // Crisp 1px beveled border
  renderer.drawRectHex(rx + 2, ry, rw - 4, 1, borderHex, borderAlpha);
  renderer.drawRectHex(rx + 2, ry + rh - 1, rw - 4, 1, borderHex, borderAlpha);
  renderer.drawRectHex(rx, ry + 2, 1, rh - 4, borderHex, borderAlpha);
  renderer.drawRectHex(rx + rw - 1, ry + 2, 1, rh - 4, borderHex, borderAlpha);
  // 4 beveled corner pixels
  renderer.drawRectHex(rx + 1, ry + 1, 1, 1, borderHex, borderAlpha);
  renderer.drawRectHex(rx + rw - 2, ry + 1, 1, 1, borderHex, borderAlpha);
  renderer.drawRectHex(rx + 1, ry + rh - 2, 1, 1, borderHex, borderAlpha);
  renderer.drawRectHex(rx + rw - 2, ry + rh - 2, 1, 1, borderHex, borderAlpha);
}

/**
 * Renders crisp 6-color pixel-native translucent virtual stick, Spin CCW/CW, Hard Drop,
 * and Pause controls right inside the WebGL2 scene FBO so they stay razor-sharp and
 * inherit the dark/light Gaussian bloom shader.
 */
export class TouchOverlayRenderer {
  render(
    renderer: WebGL2Renderer,
    visual: TouchVisualState,
    palette: Palette,
    opacitySetting = 0.55,
    showFullControls = true,
  ): void {
    const baseOp = Math.max(0.25, Math.min(0.95, opacitySetting));
    const geom = visual.geometry;

    // Always render the crisp top-right Pause button when visible
    this.renderPauseButton(renderer, geom.pause, visual.pauseHeld, visual.pausePulse, palette, baseOp);

    if (!showFullControls) {
      return;
    }

    this.renderVirtualStick(renderer, visual, palette, baseOp);
    this.renderSpinButton(
      renderer,
      geom.spinCcw,
      0,
      'CCW',
      visual.spinCcwHeld,
      visual.spinCcwPulse,
      palette,
      palette.colors[4],
      baseOp,
    );
    this.renderSpinButton(
      renderer,
      geom.spinCw,
      1,
      'CW',
      visual.spinCwHeld,
      visual.spinCwPulse,
      palette,
      palette.colors[3],
      baseOp,
    );
    this.renderDropButton(
      renderer,
      geom.hardDrop,
      visual.hardDropHeld,
      visual.hardDropPulse,
      palette,
      baseOp,
    );
  }

  private renderVirtualStick(
    renderer: WebGL2Renderer,
    visual: TouchVisualState,
    palette: Palette,
    baseOp: number,
  ): void {
    const geom = visual.geometry;
    const ax = Math.round(visual.stickAnchorX);
    const ay = Math.round(visual.stickAnchorY);
    const r = geom.stickRadius;

    const fillAlpha = (visual.stickActive ? 0.36 : 0.22) * (baseOp / 0.55);
    const borderAlpha = Math.min(0.95, (visual.stickActive ? 0.85 : 0.48) * (baseOp / 0.55));
    const ringHex =
      visual.stickDropFired || visual.stickDropProgress > 0.65
        ? palette.colors[5]
        : visual.stickActive
          ? palette.colors[3]
          : palette.colors[2];

    // Translucent pixel octagon gate + inner cross-diamond accent
    drawOctagonFill(renderer, ax, ay, r, palette.colors[1], clamp01(fillAlpha));
    drawOctagonBorder(renderer, ax, ay, r, ringHex, clamp01(borderAlpha));

    const [ir, ig, ib] = parseHexRgb01(ringHex);
    renderer.drawDiamondOutline(ax, ay, Math.round(r * 0.58), ir, ig, ib, clamp01(borderAlpha * 0.45));

    // Directional left/right chevrons + bottom drop-cone indicator
    const leftAlpha = visual.stickDir === -1 ? 0.96 : clamp01(borderAlpha * 0.6);
    const rightAlpha = visual.stickDir === 1 ? 0.96 : clamp01(borderAlpha * 0.6);
    const downAlpha =
      visual.stickDropProgress > 0.15
        ? Math.min(1, 0.5 + visual.stickDropProgress * 0.5)
        : clamp01(borderAlpha * 0.45);

    renderer.drawSpriteHex(
      'arrow_spr',
      1,
      ax - r + 7,
      ay,
      visual.stickDir === -1 ? palette.colors[3] : palette.colors[2],
      leftAlpha,
    );
    renderer.drawSpriteHex(
      'arrow_spr',
      0,
      ax + r - 7,
      ay,
      visual.stickDir === 1 ? palette.colors[3] : palette.colors[2],
      rightAlpha,
    );
    renderer.drawSpriteHex(
      'arrow_spr',
      3,
      ax,
      ay + r - 6,
      visual.stickDropProgress > 0.35 ? palette.colors[5] : palette.colors[2],
      downAlpha,
    );

    // Subtle tether pixels from center to active thumb nub
    const nx = Math.round(ax + visual.nubOffsetX);
    const ny = Math.round(ay + visual.nubOffsetY);
    if (visual.stickActive && Math.hypot(visual.nubOffsetX, visual.nubOffsetY) > 4) {
      const midX = Math.round((ax + nx) * 0.5);
      const midY = Math.round((ay + ny) * 0.5);
      renderer.drawRectHex(midX - 1, midY - 1, 2, 2, ringHex, 0.55);
    }

    // Glowing translucent pixel diamond thumb nub
    const nubR = geom.portrait ? 9 : 8;
    const nubHex =
      visual.stickDropFired || visual.stickDropProgress > 0.65
        ? palette.colors[5]
        : visual.stickActive
          ? palette.colors[3]
          : palette.colors[2];
    const nubFillAlpha = clamp01((visual.stickActive ? 0.72 : 0.44) * (baseOp / 0.55));
    const nubBorderAlpha = clamp01((visual.stickActive ? 0.98 : 0.75) * (baseOp / 0.55));

    drawOctagonFill(renderer, nx, ny, nubR, palette.colors[0], nubFillAlpha * 0.85);
    drawOctagonFill(renderer, nx, ny, nubR - 2, nubHex, nubFillAlpha);
    drawOctagonBorder(renderer, nx, ny, nubR, nubHex, nubBorderAlpha);
    // Center diamond jewel inside the nub
    renderer.drawSpriteHex('block_spr', visual.stickActive ? 1 : 0, nx, ny, palette.colors[2], nubBorderAlpha);
  }

  private renderSpinButton(
    renderer: WebGL2Renderer,
    btn: TouchCircleControl,
    iconFrame: number,
    label: string,
    held: boolean,
    pulse: number,
    palette: Palette,
    activeHex: string,
    baseOp: number,
  ): void {
    const scale = baseOp / 0.55;
    const fillAlpha = clamp01((held ? 0.52 : 0.24) * scale);
    const borderAlpha = clamp01((held ? 0.96 : 0.55) * scale);
    const borderHex = held ? activeHex : palette.colors[2];

    if (pulse > 0.02) {
      const [pr, pg, pb] = parseHexRgb01(activeHex);
      renderer.drawDiamondOutline(
        btn.cx,
        btn.cy,
        btn.radius + 2 + (1 - pulse) * 10,
        pr,
        pg,
        pb,
        pulse * 0.8,
      );
    }

    drawOctagonFill(renderer, btn.cx, btn.cy, btn.radius, held ? activeHex : palette.colors[1], fillAlpha);
    drawOctagonBorder(renderer, btn.cx, btn.cy, btn.radius, borderHex, borderAlpha);
    renderer.drawSpriteHex(
      'touch_icons_spr',
      iconFrame,
      btn.cx,
      btn.cy - 2,
      held ? palette.colors[2] : activeHex,
      clamp01((held ? 1 : 0.82) * scale),
    );
    renderer.drawTextHex(
      label,
      btn.cx,
      btn.cy + btn.radius - 7,
      held ? palette.colors[2] : borderHex,
      clamp01((held ? 0.98 : 0.72) * scale),
      '3x5',
      'center',
    );
  }

  private renderDropButton(
    renderer: WebGL2Renderer,
    btn: TouchRectControl,
    held: boolean,
    pulse: number,
    palette: Palette,
    baseOp: number,
  ): void {
    const scale = baseOp / 0.55;
    const cx = btn.x + btn.w * 0.5;
    const cy = btn.y + btn.h * 0.5;
    const activeHex = palette.colors[5];
    const borderHex = held ? activeHex : palette.colors[2];
    const fillAlpha = clamp01((held ? 0.52 : 0.25) * scale);
    const borderAlpha = clamp01((held ? 0.98 : 0.58) * scale);

    if (pulse > 0.02) {
      const [pr, pg, pb] = parseHexRgb01(activeHex);
      renderer.drawDiamondOutline(cx, cy, 16 + (1 - pulse) * 12, pr, pg, pb, pulse * 0.82);
    }

    drawBeveledBox(
      renderer,
      btn.x,
      btn.y,
      btn.w,
      btn.h,
      held ? activeHex : palette.colors[1],
      borderHex,
      fillAlpha,
      borderAlpha,
    );
    renderer.drawSpriteHex(
      'touch_icons_spr',
      2,
      btn.x + 11,
      cy,
      held ? palette.colors[2] : activeHex,
      clamp01((held ? 1 : 0.86) * scale),
    );
    renderer.drawTextHex(
      'DROP',
      btn.x + 21,
      Math.round(cy - 2),
      held ? palette.colors[2] : borderHex,
      clamp01((held ? 1 : 0.85) * scale),
      '3x5',
      'left',
    );
  }

  private renderPauseButton(
    renderer: WebGL2Renderer,
    btn: TouchRectControl,
    held: boolean,
    pulse: number,
    palette: Palette,
    baseOp: number,
  ): void {
    const scale = baseOp / 0.55;
    const cx = btn.x + btn.w * 0.5;
    const cy = btn.y + btn.h * 0.5;
    const borderHex = held ? palette.colors[3] : palette.colors[2];
    const fillAlpha = clamp01((held ? 0.7 : 0.42) * scale);
    const borderAlpha = clamp01((held ? 1 : 0.72) * scale);

    if (pulse > 0.02) {
      const [pr, pg, pb] = parseHexRgb01(palette.colors[3]);
      renderer.drawDiamondOutline(cx, cy, 10 + (1 - pulse) * 8, pr, pg, pb, pulse * 0.7);
    }

    drawBeveledBox(
      renderer,
      btn.x,
      btn.y,
      btn.w,
      btn.h,
      palette.colors[1],
      borderHex,
      fillAlpha,
      borderAlpha,
    );
    renderer.drawSpriteHex(
      'touch_icons_spr',
      3,
      cx,
      cy,
      held ? palette.colors[3] : palette.colors[2],
      clamp01((held ? 1 : 0.9) * scale),
    );
  }
}
