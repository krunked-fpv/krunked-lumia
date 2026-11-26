import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_EMPTY,
  GAME_MODE_CONFIGS,
  LOGICAL_WIDTH,
  SIM_DT_MS,
  parseHexRgb01,
  type BlockColor,
  type NextBlockLocation,
  type Palette,
  type SimState,
  type SoundtestTelemetry,
  type TutorialStep,
  type UserSettings,
} from '../contracts/index.js';
import { getModeDetails } from '../data/modes.js';
import {
  cellToContainerPixel,
  computeGhostPosition,
  getImpossibleDropTimerTicks,
  getTetradCells,
  isBlockColor,
} from '../sim/index.js';
import { computeModeProgress } from '../sim/modes.js';
import { getTutorialProgress } from '../sim/tutorial.js';
import {
  DEFAULT_CONTAINER_ORIGIN_X,
  DEFAULT_CONTAINER_ORIGIN_Y,
} from '../render/ParticlesAndBg.js';
import type { WebGL2Renderer } from '../render/WebGL2Renderer.js';

export const CONTAINER_ORIGIN_X = DEFAULT_CONTAINER_ORIGIN_X; // 126
export const CONTAINER_ORIGIN_Y = DEFAULT_CONTAINER_ORIGIN_Y; // 26

const TUTORIAL_ICON_FRAME: Record<TutorialStep, number> = {
  MOVE: 0,
  SPIN: 1,
  DROP: 2,
  MATCH: 3,
  ADVANCED: 4,
  DONE: 4,
};

const TUTORIAL_SHORT_HINTS: Record<TutorialStep, [string, string]> = {
  MOVE: ['LEFT / RIGHT', 'GLIDE ON WALLS'],
  SPIN: ['SPIN CW / CCW', 'CYCLE 4 COLORS'],
  DROP: ['HARD DROP', 'LOCK + SLIDE'],
  MATCH: ['MATCH 3+ DIAG', 'OR 2X2 DIAMOND'],
  ADVANCED: ['CHAIN CLEARS', 'UP TO 4X COMBO'],
  DONE: ['FLOW WITH THE', 'HARMONIC PULSE'],
};

const TUTORIAL_TITLES: Record<TutorialStep, string> = {
  MOVE: 'MOVE',
  SPIN: 'SPIN',
  DROP: 'DROP',
  MATCH: 'MATCH',
  ADVANCED: 'ADVANCED',
  DONE: 'YOU GOT THIS!',
};

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Format milliseconds as MM:SS or MM:SS.mmm cleanly. */
export function formatHudTime(ms: number, precise: boolean): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (!precise) {
    return `${mm}:${ss}`;
  }
  const remMs = String(safeMs % 1000).padStart(3, '0');
  return `${mm}:${ss}.${remMs}`;
}

export interface HudRenderOptions {
  profileHighScore: number;
  soundtest: SoundtestTelemetry | null;
  hideHudFlanks?: boolean;
}

/**
 * Pixel-native 320x180 gameplay board and HUD renderer matching Mixolumia's exact
 * room layer stack with zero HTML overlays and strict non-overlapping flank geometry.
 */
export class HudRenderer {
  private frameFlashAlpha = 0;
  private frameFlashSlot = 3;

  reset(): void {
    this.frameFlashAlpha = 0;
    this.frameFlashSlot = 3;
  }

  /** Trigger a colored container-frame flash on clears/combos when boardColors is enabled. */
  triggerFrameFlash(colorSlot: number, intensity = 1): void {
    this.frameFlashSlot = Math.max(2, Math.min(5, colorSlot));
    this.frameFlashAlpha = Math.min(1, Math.max(this.frameFlashAlpha, intensity));
  }

  update(dtSec: number): void {
    if (this.frameFlashAlpha > 0) {
      this.frameFlashAlpha = Math.max(0, this.frameFlashAlpha - dtSec * 3.2);
    }
  }

  /**
   * Renders the full gameplay scene inside the active 320x180 WebGL2 scene pass:
   * 1. Background BGGeometry pulses
   * 2. Container fill (Palette Slot 1)
   * 3. Automata Board Ripple (block_spr frame 5)
   * 4. Settled blocks (block_spr frames 0..3 -> Palette Slots 2..5)
   * 5. Drop Preview ghost (block_spr frame 4)
   * 6. Active falling tetrad (interpolated unless native60Snap, with slack pulse)
   * 7. Crisp 1px container_spr frame (flashing on clears when boardColors enabled)
   * 8. Foreground particles & COMBO / PERFECT CLEAR banners
   * 9. Crisp 3x5 & 5x7 HUD Flanks + NEXT corner preview + Tutorial box + Soundtest bar
   */
  render(
    renderer: WebGL2Renderer,
    state: SimState,
    palette: Palette,
    settings: UserSettings,
    interpAlpha: number,
    options: HudRenderOptions,
  ): void {
    const interp = settings.render.native60Snap ? 1 : clamp01(interpAlpha);

    // Compute board position with optional interpolated spring shake
    const shakeX = settings.render.boardShake
      ? lerp(state.prevBoardOffsetX, state.boardOffsetX, interp)
      : 0;
    const shakeY = settings.render.boardShake
      ? lerp(state.prevBoardOffsetY, state.boardOffsetY, interp)
      : 0;
    const boardX = Math.round(CONTAINER_ORIGIN_X + shakeX);
    const boardY = Math.round(CONTAINER_ORIGIN_Y + shakeY);

    // 1. Background layer (BGGeometry expanding pixel diamonds)
    renderer.effects.renderBackground(renderer, palette, settings.render, interp);

    // 2. Container interior fill tinted with Palette Slot 1
    renderer.drawSpriteHex('container_fill_spr', 0, boardX, boardY, palette.colors[1], 1);

    // 3. Cellular-automata board ripple on empty playable cells
    if (settings.render.boardRipple) {
      const [bgR, bgG, bgB] = parseHexRgb01(palette.colors[1]);
      const [loR, loG, loB] = parseHexRgb01(palette.colors[2]);
      const [hiR, hiG, hiB] = parseHexRgb01(palette.colors[3]);

      for (let y = 0; y < BOARD_HEIGHT; y++) {
        const rowOff = y * BOARD_WIDTH;
        for (let x = 0; x < BOARD_WIDTH; x++) {
          const idx = rowOff + x;
          if (state.grid[idx] !== CELL_EMPTY) continue;
          const energy = state.automata[idx];
          if (energy <= 1) continue;

          const t = clamp01(energy / 100);
          const accentMix = t * 0.65;
          const targetR = lerp(loR, hiR, accentMix);
          const targetG = lerp(loG, hiG, accentMix);
          const targetB = lerp(loB, hiB, accentMix);

          const blend = 0.25 + t * 0.75;
          const r = lerp(bgR, targetR, blend);
          const g = lerp(bgG, targetG, blend);
          const b = lerp(bgB, targetB, blend);
          const alpha = 0.16 + t * 0.62;

          const { cx, cy } = cellToContainerPixel(x, y);
          renderer.drawSprite('block_spr', 5, boardX + cx, boardY + cy, r, g, b, alpha);
        }
      }
    }

    // 4. Settled blocks (exact 6-color mapping: color 1..4 -> frame 0..3 -> palette slot 2..5)
    let activeBlocks = 0;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      const rowOff = y * BOARD_WIDTH;
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const cell = state.grid[rowOff + x];
        if (!isBlockColor(cell)) continue;
        activeBlocks += 1;
        const { cx, cy } = cellToContainerPixel(x, y);
        renderer.drawSpriteHex(
          'block_spr',
          cell - 1,
          boardX + cx,
          boardY + cy,
          palette.colors[cell + 1],
          1,
        );
      }
    }

    // 5. Drop Preview ghost (when active tetrad present and opacity > 0)
    const tetrad = state.tetrad;
    if (tetrad) {
      activeBlocks += 4;

      if (!state.finished && settings.gameplay.dropPreviewOpacity > 0.001) {
        const ghost = computeGhostPosition(state.grid, tetrad.x, tetrad.y);
        if (ghost.x !== tetrad.x || ghost.y !== tetrad.y) {
          const ghostCells = getTetradCells(ghost.x, ghost.y);
          const ghostAlpha = clamp01(settings.gameplay.dropPreviewOpacity) * 0.55;
          for (let i = 0; i < 4; i++) {
            const color = tetrad.colors[i];
            const { cx, cy } = cellToContainerPixel(ghostCells[i].x, ghostCells[i].y);
            renderer.drawSpriteHex(
              'block_spr',
              4,
              boardX + cx,
              boardY + cy,
              palette.colors[color + 1],
              ghostAlpha,
            );
          }
        }
      }

      // 6. Active falling tetrad (also rendered on Endgame when Impossible preserves state.tetrad!)
      const currCells = getTetradCells(tetrad.x, tetrad.y);
      const prevCells = getTetradCells(tetrad.prevX, tetrad.prevY);
      const currAnchorPx = cellToContainerPixel(tetrad.x, tetrad.y);
      const prevAnchorPx = cellToContainerPixel(tetrad.prevX, tetrad.prevY);
      const stepDist =
        Math.abs(currAnchorPx.cx - prevAnchorPx.cx) +
        Math.abs(currAnchorPx.cy - prevAnchorPx.cy);
      const canInterp = !settings.render.native60Snap && !state.finished && stepDist > 0 && stepDist <= 16;

      let tetradAlpha = 1;
      if (tetrad.slackActive && !state.finished) {
        const pulse = settings.render.flashing
          ? 0.68 + 0.32 * Math.cos((12 - tetrad.slackTimer) * 0.85)
          : 0.85;
        tetradAlpha = clamp01(pulse);
      }

      for (let i = 0; i < 4; i++) {
        const color = tetrad.colors[i];
        const currPx = cellToContainerPixel(currCells[i].x, currCells[i].y);
        let drawCx = currPx.cx;
        let drawCy = currPx.cy;
        if (canInterp) {
          const prevPx = cellToContainerPixel(prevCells[i].x, prevCells[i].y);
          drawCx = lerp(prevPx.cx, currPx.cx, interp);
          drawCy = lerp(prevPx.cy, currPx.cy, interp);
        }
        renderer.drawSpriteHex(
          'block_spr',
          color - 1,
          boardX + drawCx,
          boardY + drawCy,
          palette.colors[color + 1],
          tetradAlpha,
        );
      }
    }

    renderer.setActiveBlockCount(activeBlocks);

    // 7. Crisp 1px diamond-hexagon container frame
    if (settings.render.boardColors && this.frameFlashAlpha > 0.01) {
      const [baseR, baseG, baseB] = parseHexRgb01(palette.colors[2]);
      const [flashR, flashG, flashB] = parseHexRgb01(
        palette.colors[this.frameFlashSlot] ?? palette.colors[3],
      );
      const t = clamp01(this.frameFlashAlpha);
      renderer.drawSprite(
        'container_spr',
        0,
        boardX,
        boardY,
        lerp(baseR, flashR, t),
        lerp(baseG, flashG, t),
        lerp(baseB, flashB, t),
        1,
      );
    } else {
      renderer.drawSpriteHex('container_spr', 0, boardX, boardY, palette.colors[2], 1);
    }

    // 8. Foreground particles & floating COMBO / PERFECT CLEAR banners
    renderer.effects.renderForeground(renderer, palette, settings.render, interp);

    // 9. Crisp 3x5 & 5x7 Pixel HUD Flanks + NEXT Preview + Tutorial + Soundtest
    if (!options.hideHudFlanks) {
      this.renderHudFlanks(renderer, state, palette, settings, options.profileHighScore);
    }

    if (settings.gameplay.soundtestEnabled && options.soundtest) {
      this.renderSoundtestBar(renderer, palette, options.soundtest);
    }
  }

  private renderHudFlanks(
    renderer: WebGL2Renderer,
    state: SimState,
    palette: Palette,
    settings: UserSettings,
    profileHighScore: number,
  ): void {
    const modeConfig = GAME_MODE_CONFIGS[state.mode];
    const modeDetails = getModeDetails(state.mode);
    const nextLoc = settings.gameplay.nextBlockLocation;

    const primaryHex = palette.colors[2];
    const accentHex = palette.colors[3];
    const boardFillHex = palette.colors[1];

    // ------------------------------------------------------------------------
    // NEXT TETRAD 2x2 DIAMOND PREVIEW (respects all 4 corner settings)
    // ------------------------------------------------------------------------
    this.renderNextPreview(renderer, state.nextColors, nextLoc, palette);

    // ------------------------------------------------------------------------
    // LEFT FLANK (x = 12..114) — dynamically shifts clear of upper_left/lower_left NEXT box
    // ------------------------------------------------------------------------
    const leftX = 12;
    const barW = 92;
    let leftY = 44;
    if (nextLoc === 'upper_left') {
      leftY = 58;
    } else if (nextLoc === 'lower_left') {
      leftY = 22;
    }

    // CLEARED counter + crisp 1px progress bar
    renderer.drawTextHex('CLEARED', leftX, leftY, primaryHex, 0.78, '3x5', 'left');
    const clearedText =
      modeConfig.targetBlocks !== null
        ? `${state.cleared}/${modeConfig.targetBlocks}`
        : `${state.cleared}`;
    renderer.drawTextHex(clearedText, leftX, leftY + 7, primaryHex, 1, '5x7', 'left');

    const clearedProgress =
      modeConfig.targetBlocks !== null
        ? clamp01(state.cleared / modeConfig.targetBlocks)
        : computeModeProgress(state);
    this.drawCrispProgressBar(
      renderer,
      leftX,
      leftY + 17,
      barW,
      2,
      clearedProgress,
      boardFillHex,
      primaryHex,
      accentHex,
    );

    // SCORE counter + thin High Score progress bar underneath
    const scoreY = leftY + 28;
    renderer.drawTextHex('SCORE', leftX, scoreY, primaryHex, 0.78, '3x5', 'left');
    const isNewBest = profileHighScore > 0 && state.score > profileHighScore;
    if (isNewBest) {
      renderer.drawTextHex('NEW BEST', leftX + barW, scoreY, accentHex, 1, '3x5', 'right');
    }
    renderer.drawTextHex(
      state.score.toLocaleString('en-US'),
      leftX,
      scoreY + 7,
      isNewBest ? accentHex : primaryHex,
      1,
      '5x7',
      'left',
    );

    const highScoreProgress =
      profileHighScore > 0
        ? clamp01(state.score / profileHighScore)
        : state.score > 0
          ? 1
          : 0;
    this.drawCrispProgressBar(
      renderer,
      leftX,
      scoreY + 17,
      barW,
      2,
      highScoreProgress,
      boardFillHex,
      primaryHex,
      accentHex,
    );

    const bestLabel = `BEST ${Math.max(profileHighScore, state.score).toLocaleString('en-US')}`;
    renderer.drawTextHex(bestLabel, leftX, scoreY + 21, primaryHex, 0.65, '3x5', 'left');

    // TIME readout (countdown in Rush, elapsed otherwise; MM:SS or MM:SS.mmm)
    const timeY = scoreY + 34;
    const timeLabel = state.mode === 'rush' ? 'TIME LEFT' : 'TIME';
    renderer.drawTextHex(timeLabel, leftX, timeY, primaryHex, 0.78, '3x5', 'left');
    const displayTicks = state.mode === 'rush' ? state.remainingTicks : state.elapsedTicks;
    const timeStr = formatHudTime(displayTicks * SIM_DT_MS, settings.gameplay.preciseTimer);
    const urgentRush = state.mode === 'rush' && state.remainingTicks <= 600; // <= 10s
    renderer.drawTextHex(
      timeStr,
      leftX,
      timeY + 7,
      urgentRush ? palette.colors[5] : primaryHex,
      1,
      '5x7',
      'left',
    );

    // ------------------------------------------------------------------------
    // RIGHT FLANK (x = 206..308) — MODE badge + LEVEL + Tutorial prompt box
    // ------------------------------------------------------------------------
    const rightX = 208;
    const rightW = 100;
    let rightY = 26;
    if (nextLoc === 'upper_right') {
      rightY = 58;
    } else if (nextLoc === 'lower_right') {
      rightY = 18;
    }

    // Mode pill + icon
    renderer.drawSpriteHex(
      'mode_icon_spr',
      modeDetails.iconIndex,
      rightX + 8,
      rightY + 8,
      palette.colors[modeDetails.accentSlot],
      1,
    );
    renderer.drawTextHex(
      modeConfig.name.toUpperCase(),
      rightX + 20,
      rightY + 1,
      accentHex,
      1,
      '5x7',
      'left',
    );

    const levelStr =
      state.mode === 'impossible'
        ? `LV ${String(state.level).padStart(2, '0')}+15`
        : `LV ${String(state.level).padStart(2, '0')}`;
    renderer.drawTextHex(levelStr, rightX + 20, rightY + 10, primaryHex, 1, '5x7', 'left');

    // Impossible forced drop pressure hairline
    if (state.mode === 'impossible' && state.phase === 'FALLING_TETRAD') {
      const maxTicks = Math.max(1, getImpossibleDropTimerTicks(state.impossibleDropStep));
      const frac = clamp01(state.impossibleDropTimer / maxTicks);
      this.drawCrispProgressBar(
        renderer,
        rightX,
        rightY + 21,
        rightW - 4,
        2,
        frac,
        boardFillHex,
        palette.colors[5],
        palette.colors[5],
      );
    }

    // Active Combo badge when chaining
    if (state.combo >= 2) {
      const comboY = rightY + 26;
      const comboSlot = state.combo >= 4 ? 5 : state.combo === 3 ? 4 : 3;
      renderer.drawRectHex(rightX, comboY, 62, 11, boardFillHex, 0.9);
      this.drawBoxOutline(renderer, rightX, comboY, 62, 11, palette.colors[comboSlot], 1);
      renderer.drawTextHex(
        `COMBO x${state.combo}`,
        rightX + 31,
        comboY + 2,
        palette.colors[comboSlot],
        1,
        '5x7',
        'center',
      );
    }

    // Active Tutorial prompt box (or brief YOU GOT THIS! celebration while bannerTimer > 0)
    const showTutorialBox =
      state.tutorial.enabled &&
      (state.tutorial.step !== 'DONE' || state.tutorial.bannerTimer > 0);
    if (showTutorialBox) {
      const tutY = nextLoc === 'lower_right' ? rightY + 40 : Math.max(rightY + 42, 98);
      this.renderTutorialBox(renderer, state, rightX, tutY, rightW, palette);
    }
  }

  private renderNextPreview(
    renderer: WebGL2Renderer,
    nextColors: readonly [BlockColor, BlockColor, BlockColor, BlockColor],
    location: NextBlockLocation,
    palette: Palette,
  ): void {
    // Dedicated corner pockets strictly clear of the 68x128 container (126..194, 26..154)
    let boxX = 208;
    let boxY = 14;
    switch (location) {
      case 'upper_left':
        boxX = 76;
        boxY = 14;
        break;
      case 'upper_right':
        boxX = 208;
        boxY = 14;
        break;
      case 'lower_left':
        boxX = 76;
        boxY = 122;
        break;
      case 'lower_right':
        boxX = 208;
        boxY = 122;
        break;
    }

    const boxW = 38;
    const boxH = 34;

    renderer.drawRectHex(boxX, boxY, boxW, boxH, palette.colors[1], 0.88);
    this.drawBoxOutline(renderer, boxX, boxY, boxW, boxH, palette.colors[2], 0.85);
    renderer.drawTextHex('NEXT', boxX + boxW * 0.5, boxY + 3, palette.colors[2], 0.85, '3x5', 'center');

    // 2x2 diamond tetrad centered inside the lower area of the card
    const cx = boxX + Math.floor(boxW * 0.5);
    const cy = boxY + 20;
    const offsets: readonly [number, number][] = [
      [0, -4], // top
      [4, 0], // right
      [0, 4], // bottom
      [-4, 0], // left
    ];

    for (let i = 0; i < 4; i++) {
      const color = nextColors[i];
      const [ox, oy] = offsets[i];
      renderer.drawSpriteHex(
        'block_spr',
        color - 1,
        cx + ox,
        cy + oy,
        palette.colors[color + 1],
        1,
      );
    }
  }

  private renderTutorialBox(
    renderer: WebGL2Renderer,
    state: SimState,
    x: number,
    y: number,
    w: number,
    palette: Palette,
  ): void {
    const step = state.tutorial.step;
    const progress = getTutorialProgress(state.tutorial);
    const h = 44;

    renderer.drawRectHex(x, y, w, h, palette.colors[1], 0.92);
    this.drawBoxOutline(renderer, x, y, w, h, palette.colors[3], 1);

    // Tutorial sprite icon (16x16) on left side of card
    const iconFrame = TUTORIAL_ICON_FRAME[step];
    renderer.drawSpriteHex('tutorial_icons', iconFrame, x + 12, y + 14, palette.colors[3], 1);

    // Step title
    const title = TUTORIAL_TITLES[step];
    const titleFont = title.length > 10 ? '3x5' : '5x7';
    renderer.drawTextHex(title, x + 24, y + 6, palette.colors[3], 1, titleFont, 'left');

    // Step counter (e.g., 1/2)
    if (progress.target > 0) {
      renderer.drawTextHex(
        `${progress.current}/${progress.target}`,
        x + w - 4,
        y + 7,
        palette.colors[2],
        0.85,
        '3x5',
        'right',
      );
    }

    // Crisp 2-line 3x5 hint
    const [line1, line2] = TUTORIAL_SHORT_HINTS[step];
    renderer.drawTextHex(line1, x + 24, y + 17, palette.colors[2], 0.95, '3x5', 'left');
    renderer.drawTextHex(line2, x + 6, y + 27, palette.colors[2], 0.85, '3x5', 'left');

    // Mini step progress bar along bottom edge
    this.drawCrispProgressBar(
      renderer,
      x + 6,
      y + h - 6,
      w - 12,
      2,
      progress.fraction,
      palette.colors[0],
      palette.colors[2],
      palette.colors[3],
    );
  }

  private renderSoundtestBar(
    renderer: WebGL2Renderer,
    palette: Palette,
    telemetry: SoundtestTelemetry,
  ): void {
    // Crisp dark strip along bottom edge (y = 167..180)
    renderer.drawRectHex(0, 167, LOGICAL_WIDTH, 13, palette.colors[0], 0.88);
    renderer.drawRectHex(0, 167, LOGICAL_WIDTH, 1, palette.colors[1], 1);

    const loopUpper = telemetry.loopName.toUpperCase();
    const nextUpper = telemetry.nextLoopName.toUpperCase();
    const bpmText = `${Math.round(telemetry.bpm)}BPM`;
    const progText = `PROG ${telemetry.progressionStep + 1}/${Math.max(1, telemetry.progressionLength)}`;
    const line = `LOOP: ${loopUpper} -> ${nextUpper} | ${bpmText} | ${progText}`;

    renderer.drawTextHex(line, LOGICAL_WIDTH * 0.5, 171, palette.colors[2], 1, '3x5', 'center');

    // Live beat progress hairline at y = 178
    const railX = 8;
    const railW = LOGICAL_WIDTH - 16;
    renderer.drawRectHex(railX, 178, railW, 1, palette.colors[1], 1);
    const fillW = Math.max(1, Math.round(railW * clamp01(telemetry.loopProgress)));
    renderer.drawRectHex(railX, 178, fillW, 1, palette.colors[3], 1);
  }

  private drawCrispProgressBar(
    renderer: WebGL2Renderer,
    x: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    trackHex: string,
    borderHex: string,
    fillHex: string,
  ): void {
    const clamped = clamp01(ratio);
    renderer.drawRectHex(x, y, w, h, trackHex, 1);
    renderer.drawRectHex(x, y + h, w, 1, borderHex, 0.35);
    const fillW = Math.round(w * clamped);
    if (fillW > 0) {
      renderer.drawRectHex(x, y, fillW, h, fillHex, 1);
    }
  }

  private drawBoxOutline(
    renderer: WebGL2Renderer,
    x: number,
    y: number,
    w: number,
    h: number,
    hex: string,
    alpha: number,
  ): void {
    renderer.drawRectHex(x, y, w, 1, hex, alpha);
    renderer.drawRectHex(x, y + h - 1, w, 1, hex, alpha);
    renderer.drawRectHex(x, y, 1, h, hex, alpha);
    renderer.drawRectHex(x + w - 1, y, 1, h, hex, alpha);
  }
}
