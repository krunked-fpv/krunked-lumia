import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_EMPTY,
  CONTAINER_HEIGHT,
  CONTAINER_WIDTH,
  GAME_MODE_CONFIGS,
  LOGICAL_WIDTH,
  PORTRAIT_LOGICAL_HEIGHT,
  PORTRAIT_LOGICAL_WIDTH,
  SIM_DT_MS,
  isLightPaletteBg,
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
import type { InputDeviceKind } from '../input/InputManager.js';
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
  PORTRAIT_CONTAINER_ORIGIN_X,
  PORTRAIT_CONTAINER_ORIGIN_Y,
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

const TUTORIAL_SHORT_HINTS_KB: Record<TutorialStep, [string, string]> = {
  MOVE: ['LEFT / RIGHT', 'GLIDE ON WALLS'],
  SPIN: ['SPIN CW / CCW', 'CYCLE 4 COLORS'],
  DROP: ['HARD DROP', 'LOCK + SLIDE'],
  MATCH: ['MATCH 3+ DIAG', 'OR 2X2 DIAMOND'],
  ADVANCED: ['CHAIN CLEARS', 'UP TO 4X COMBO'],
  DONE: ['FLOW WITH THE', 'HARMONIC PULSE'],
};

const TUTORIAL_SHORT_HINTS_TOUCH: Record<TutorialStep, [string, string]> = {
  MOVE: ['DRAG STICK L/R', 'GLIDE ON WALLS'],
  SPIN: ['TAP CCW / CW', 'CYCLE 4 COLORS'],
  DROP: ['TAP DROP / DN', 'LOCK + SLIDE'],
  MATCH: ['MATCH 3+ DIAG', 'OR 2X2 DIAMOND'],
  ADVANCED: ['CHAIN CLEARS', 'UP TO 4X COMBO'],
  DONE: ['FLOW WITH THE', 'HARMONIC PULSE'],
};

const TUTORIAL_SHORT_HINTS_GP: Record<TutorialStep, [string, string]> = {
  MOVE: ['STICK / D-PAD', 'GLIDE ON WALLS'],
  SPIN: ['A/B OR LB/RB', 'CYCLE 4 COLORS'],
  DROP: ['Y / D-DOWN', 'LOCK + SLIDE'],
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
  portrait?: boolean;
  touchOverlayVisible?: boolean;
  beatPhase?: number; // 0..1 harmonic beat position
  inputKind?: InputDeviceKind;
}

/**
 * Pixel-native gameplay board & HUD renderer supporting both canonical 320x180
 * landscape and crisp 180x320 mobile portrait layouts with harmonic beat juice.
 */
export class HudRenderer {
  private frameFlashAlpha = 0;
  private frameFlashSlot = 3;
  private animTime = 0;

  reset(): void {
    this.frameFlashAlpha = 0;
    this.frameFlashSlot = 3;
    this.animTime = 0;
  }

  /** Trigger a colored container-frame flash on clears/combos when boardColors is enabled. */
  triggerFrameFlash(colorSlot: number, intensity = 1): void {
    this.frameFlashSlot = Math.max(2, Math.min(5, colorSlot));
    this.frameFlashAlpha = Math.min(1, Math.max(this.frameFlashAlpha, intensity));
  }

  update(dtSec: number): void {
    const dt = Math.max(0, Math.min(dtSec, 0.1));
    this.animTime += dt;
    if (this.frameFlashAlpha > 0) {
      this.frameFlashAlpha = Math.max(0, this.frameFlashAlpha - dt * 3.2);
    }
  }

  render(
    renderer: WebGL2Renderer,
    state: SimState,
    palette: Palette,
    settings: UserSettings,
    interpAlpha: number,
    options: HudRenderOptions,
  ): void {
    const interp = settings.render.native60Snap ? 1 : clamp01(interpAlpha);
    const portrait = Boolean(options.portrait);
    const touchVisible = Boolean(options.touchOverlayVisible);
    const beatPhase = options.beatPhase ?? 0;
    const beatKick = settings.render.flashing ? Math.pow(clamp01(1 - beatPhase), 3) : 0;

    const baseOriginX = portrait ? PORTRAIT_CONTAINER_ORIGIN_X : CONTAINER_ORIGIN_X;
    const baseOriginY = portrait ? PORTRAIT_CONTAINER_ORIGIN_Y : CONTAINER_ORIGIN_Y;

    // Compute board position with optional interpolated spring shake
    const shakeX = settings.render.boardShake
      ? lerp(state.prevBoardOffsetX, state.boardOffsetX, interp)
      : 0;
    const shakeY = settings.render.boardShake
      ? lerp(state.prevBoardOffsetY, state.boardOffsetY, interp)
      : 0;
    const boardX = Math.round(baseOriginX + shakeX);
    const boardY = Math.round(baseOriginY + shakeY);

    // 1. Background layer (BGGeometry expanding pixel diamonds + subtle beat-synced aura)
    if (settings.render.bgShapes) {
      const bcx = boardX + CONTAINER_WIDTH * 0.5;
      const bcy = boardY + CONTAINER_HEIGHT * 0.5;
      const [ar, ag, ab] = parseHexRgb01(palette.colors[state.combo >= 2 ? 3 : 2]);
      const auraR = 68 + beatKick * 7;
      renderer.drawDiamondOutline(bcx, bcy, auraR, ar, ag, ab, 0.1 + beatKick * 0.14);
      if (state.combo >= 2) {
        const [cr, cg, cb] = parseHexRgb01(palette.colors[state.combo >= 4 ? 5 : 4]);
        renderer.drawDiamondOutline(bcx, bcy, auraR + 10, cr, cg, cb, 0.14 + beatKick * 0.16);
      }
    }
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
          const ghostAlpha = clamp01(settings.gameplay.dropPreviewOpacity) * 0.58;
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

    // 7. Crisp 1px diamond-hexagon container frame (harmonic beat tint + clear flash!)
    if (settings.render.boardColors && (this.frameFlashAlpha > 0.01 || beatKick > 0.12)) {
      const [baseR, baseG, baseB] = parseHexRgb01(palette.colors[2]);
      const flashSlot = this.frameFlashAlpha > 0.01 ? this.frameFlashSlot : 3;
      const [flashR, flashG, flashB] = parseHexRgb01(
        palette.colors[flashSlot] ?? palette.colors[3],
      );
      const t = clamp01(Math.max(this.frameFlashAlpha, beatKick * 0.28));
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
      // Beat-reactive corner glints at container apex & bottom tip
      if (beatKick > 0.45 && settings.render.flashing) {
        const glintHex = palette.colors[state.combo >= 2 ? 3 : 4];
        renderer.drawRectHex(boardX + 33, boardY - 2, 2, 1, glintHex, beatKick * 0.85);
        renderer.drawRectHex(boardX + 33, boardY + CONTAINER_HEIGHT + 1, 2, 1, glintHex, beatKick * 0.85);
      }
    } else {
      renderer.drawSpriteHex('container_spr', 0, boardX, boardY, palette.colors[2], 1);
    }

    // 8. Foreground particles & floating COMBO / PERFECT CLEAR banners
    renderer.effects.renderForeground(renderer, palette, settings.render, interp);

    // 9. Crisp Pixel HUD (Portrait 180x320 or Landscape 320x180)
    if (!options.hideHudFlanks) {
      if (portrait) {
        this.renderPortraitHud(
          renderer,
          state,
          palette,
          settings,
          options.profileHighScore,
          options.inputKind ?? 'touch',
        );
      } else {
        this.renderLandscapeHud(
          renderer,
          state,
          palette,
          settings,
          options.profileHighScore,
          touchVisible,
          options.inputKind ?? 'keyboard',
        );
      }
    }

    if (settings.gameplay.soundtestEnabled && options.soundtest) {
      this.renderSoundtestBar(renderer, palette, options.soundtest, portrait);
    }
  }

  private getTutorialHints(inputKind: InputDeviceKind): Record<TutorialStep, [string, string]> {
    if (inputKind === 'touch') return TUTORIAL_SHORT_HINTS_TOUCH;
    if (inputKind === 'gamepad') return TUTORIAL_SHORT_HINTS_GP;
    return TUTORIAL_SHORT_HINTS_KB;
  }

  private renderPortraitHud(
    renderer: WebGL2Renderer,
    state: SimState,
    palette: Palette,
    settings: UserSettings,
    profileHighScore: number,
    inputKind: InputDeviceKind,
  ): void {
    const modeConfig = GAME_MODE_CONFIGS[state.mode];
    const primaryHex = palette.colors[2];
    const accentHex = palette.colors[3];
    const boardFillHex = palette.colors[1];

    // Top HUD panel strip (y = 3..49) strictly clear of Pause button at (154, 5, 20x20)
    const lx = 6;
    const lw = 102;

    // Row 1 (y=4): Mode name + Level
    const levelStr =
      state.mode === 'impossible'
        ? `LV${String(state.level).padStart(2, '0')}+15`
        : `LV ${String(state.level).padStart(2, '0')}`;
    renderer.drawTextHex(modeConfig.name.toUpperCase(), lx, 5, accentHex, 1, '3x5', 'left');
    renderer.drawTextHex(levelStr, lx + lw, 5, primaryHex, 0.95, '3x5', 'right');

    // Row 2 (y=13..29): Score + New Best + High Score progress bar
    const isNewBest = profileHighScore > 0 && state.score > profileHighScore;
    renderer.drawTextHex('SCORE', lx, 13, primaryHex, 0.72, '3x5', 'left');
    if (isNewBest) {
      renderer.drawTextHex('NEW BEST', lx + lw, 13, accentHex, 1, '3x5', 'right');
    } else {
      renderer.drawTextHex(
        `HI ${Math.max(profileHighScore, state.score).toLocaleString('en-US')}`,
        lx + lw,
        13,
        primaryHex,
        0.62,
        '3x5',
        'right',
      );
    }
    renderer.drawTextHex(
      state.score.toLocaleString('en-US'),
      lx,
      20,
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
    this.drawCrispProgressBar(renderer, lx, 29, lw, 2, highScoreProgress, boardFillHex, primaryHex, accentHex);

    // Row 3 (y=35..46): Cleared + Time + Cleared progress bar
    const clearedText =
      modeConfig.targetBlocks !== null
        ? `CLR ${state.cleared}/${modeConfig.targetBlocks}`
        : `CLR ${state.cleared}`;
    renderer.drawTextHex(clearedText, lx, 35, primaryHex, 0.95, '3x5', 'left');

    const displayTicks = state.mode === 'rush' ? state.remainingTicks : state.elapsedTicks;
    const timeStr = formatHudTime(displayTicks * SIM_DT_MS, settings.gameplay.preciseTimer);
    const urgentRush = state.mode === 'rush' && state.remainingTicks <= 600;
    renderer.drawTextHex(
      timeStr,
      lx + lw,
      35,
      urgentRush ? palette.colors[5] : primaryHex,
      1,
      '3x5',
      'right',
    );
    const clearedProgress =
      modeConfig.targetBlocks !== null
        ? clamp01(state.cleared / modeConfig.targetBlocks)
        : computeModeProgress(state);
    this.drawCrispProgressBar(renderer, lx, 43, lw, 2, clearedProgress, boardFillHex, primaryHex, accentHex);

    // Top-right NEXT preview card (x = 114..150, y = 5..39), leaving (154, 5, 20x20) for [||] Pause!
    this.renderNextCardAt(renderer, state.nextColors, 114, 5, 36, 34, palette);

    // Impossible forced drop pressure hairline
    if (state.mode === 'impossible' && state.phase === 'FALLING_TETRAD') {
      const maxTicks = Math.max(1, getImpossibleDropTimerTicks(state.impossibleDropStep));
      const frac = clamp01(state.impossibleDropTimer / maxTicks);
      this.drawCrispProgressBar(
        renderer,
        114,
        43,
        60,
        2,
        frac,
        boardFillHex,
        palette.colors[5],
        palette.colors[5],
      );
    }

    // Active Combo badge on right open flank beside the diamond board!
    if (state.combo >= 2) {
      const comboSlot = state.combo >= 4 ? 5 : state.combo === 3 ? 4 : 3;
      const cx = 128;
      const cy = 62;
      renderer.drawRectHex(cx, cy, 46, 18, boardFillHex, 0.92);
      this.drawBoxOutline(renderer, cx, cy, 46, 18, palette.colors[comboSlot], 1);
      renderer.drawTextHex('COMBO', cx + 23, cy + 3, palette.colors[2], 0.85, '3x5', 'center');
      renderer.drawTextHex(`x${state.combo}`, cx + 23, cy + 9, palette.colors[comboSlot], 1, '5x7', 'center');
    }

    // Compact horizontal Tutorial prompt strip below board (y = 186..206) when active
    const showTutorialBox =
      state.tutorial.enabled &&
      (state.tutorial.step !== 'DONE' || state.tutorial.bannerTimer > 0);
    if (showTutorialBox) {
      this.renderPortraitTutorialStrip(renderer, state, 6, 186, PORTRAIT_LOGICAL_WIDTH - 12, palette, inputKind);
    }
  }

  private renderLandscapeHud(
    renderer: WebGL2Renderer,
    state: SimState,
    palette: Palette,
    settings: UserSettings,
    profileHighScore: number,
    touchVisible: boolean,
    inputKind: InputDeviceKind,
  ): void {
    const modeConfig = GAME_MODE_CONFIGS[state.mode];
    const modeDetails = getModeDetails(state.mode);
    // Keep NEXT in upper pockets when landscape touch controls occupy lower flanks
    let nextLoc = settings.gameplay.nextBlockLocation;
    if (touchVisible) {
      if (nextLoc === 'lower_left') nextLoc = 'upper_left';
      if (nextLoc === 'lower_right') nextLoc = 'upper_right';
    }

    const primaryHex = palette.colors[2];
    const accentHex = palette.colors[3];
    const boardFillHex = palette.colors[1];

    // NEXT TETRAD 2x2 DIAMOND PREVIEW
    this.renderNextPreview(renderer, state.nextColors, nextLoc, palette, touchVisible);

    // LEFT FLANK (x = 12..114)
    const leftX = 12;
    const barW = touchVisible ? 96 : 92;
    let leftY = 44;
    if (touchVisible) {
      leftY = nextLoc === 'upper_left' ? 42 : 8;
    } else if (nextLoc === 'upper_left') {
      leftY = 58;
    } else if (nextLoc === 'lower_left') {
      leftY = 22;
    }

    const blockStep = touchVisible ? 23 : 28;
    const timeStep = touchVisible ? 26 : 34;

    // CLEARED counter + crisp progress bar
    renderer.drawTextHex('CLEARED', leftX, leftY, primaryHex, 0.78, '3x5', 'left');
    const clearedText =
      modeConfig.targetBlocks !== null
        ? `${state.cleared}/${modeConfig.targetBlocks}`
        : `${state.cleared}`;
    renderer.drawTextHex(clearedText, leftX, leftY + 6, primaryHex, 1, '5x7', 'left');

    const clearedProgress =
      modeConfig.targetBlocks !== null
        ? clamp01(state.cleared / modeConfig.targetBlocks)
        : computeModeProgress(state);
    this.drawCrispProgressBar(
      renderer,
      leftX,
      leftY + (touchVisible ? 15 : 17),
      barW,
      2,
      clearedProgress,
      boardFillHex,
      primaryHex,
      accentHex,
    );

    // SCORE counter + thin High Score progress bar
    const scoreY = leftY + blockStep;
    renderer.drawTextHex('SCORE', leftX, scoreY, primaryHex, 0.78, '3x5', 'left');
    const isNewBest = profileHighScore > 0 && state.score > profileHighScore;
    if (isNewBest) {
      renderer.drawTextHex('NEW BEST', leftX + barW, scoreY, accentHex, 1, '3x5', 'right');
    }
    renderer.drawTextHex(
      state.score.toLocaleString('en-US'),
      leftX,
      scoreY + 6,
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
      scoreY + (touchVisible ? 15 : 17),
      barW,
      2,
      highScoreProgress,
      boardFillHex,
      primaryHex,
      accentHex,
    );

    if (!touchVisible) {
      const bestLabel = `BEST ${Math.max(profileHighScore, state.score).toLocaleString('en-US')}`;
      renderer.drawTextHex(bestLabel, leftX, scoreY + 21, primaryHex, 0.65, '3x5', 'left');
    }

    // TIME readout
    const timeY = scoreY + timeStep;
    const timeLabel = state.mode === 'rush' ? 'TIME LEFT' : 'TIME';
    renderer.drawTextHex(timeLabel, leftX, timeY, primaryHex, 0.78, '3x5', 'left');
    const displayTicks = state.mode === 'rush' ? state.remainingTicks : state.elapsedTicks;
    const timeStr = formatHudTime(displayTicks * SIM_DT_MS, settings.gameplay.preciseTimer);
    const urgentRush = state.mode === 'rush' && state.remainingTicks <= 600;
    renderer.drawTextHex(
      timeStr,
      leftX,
      timeY + 6,
      urgentRush ? palette.colors[5] : primaryHex,
      1,
      '5x7',
      'left',
    );

    // RIGHT FLANK (x = 208..308)
    const rightX = 208;
    const rightW = touchVisible ? 84 : 100;
    let rightY = 26;
    if (touchVisible) {
      rightY = nextLoc === 'upper_right' ? 44 : 10;
    } else if (nextLoc === 'upper_right') {
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

    // Active Combo badge with rhythmic corner pulse chevrons when chaining
    if (state.combo >= 2) {
      const comboY = rightY + 26;
      const comboSlot = state.combo >= 4 ? 5 : state.combo === 3 ? 4 : 3;
      const pulse = 0.72 + 0.28 * Math.sin(this.animTime * 10);
      renderer.drawRectHex(rightX, comboY, 62, 11, boardFillHex, 0.9);
      this.drawBoxOutline(renderer, rightX, comboY, 62, 11, palette.colors[comboSlot], pulse);
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

    // Active Tutorial prompt box (stays above touch buttons when touchVisible)
    const showTutorialBox =
      state.tutorial.enabled &&
      (state.tutorial.step !== 'DONE' || state.tutorial.bannerTimer > 0);
    if (showTutorialBox && !touchVisible) {
      const tutY = nextLoc === 'lower_right' ? rightY + 40 : Math.max(rightY + 42, 98);
      this.renderTutorialBox(renderer, state, rightX, tutY, rightW, palette, inputKind);
    } else if (showTutorialBox && touchVisible) {
      this.renderPortraitTutorialStrip(renderer, state, 204, 62, 108, palette, inputKind);
    }
  }

  private renderNextPreview(
    renderer: WebGL2Renderer,
    nextColors: readonly [BlockColor, BlockColor, BlockColor, BlockColor],
    location: NextBlockLocation,
    palette: Palette,
    compact = false,
  ): void {
    let boxX = 208;
    let boxY = compact ? 6 : 14;
    switch (location) {
      case 'upper_left':
        boxX = 76;
        boxY = compact ? 6 : 14;
        break;
      case 'upper_right':
        boxX = 208;
        boxY = compact ? 6 : 14;
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
    this.renderNextCardAt(renderer, nextColors, boxX, boxY, 38, 34, palette);
  }

  private renderNextCardAt(
    renderer: WebGL2Renderer,
    nextColors: readonly [BlockColor, BlockColor, BlockColor, BlockColor],
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
    palette: Palette,
  ): void {
    renderer.drawRectHex(boxX, boxY, boxW, boxH, palette.colors[1], 0.88);
    this.drawBoxOutline(renderer, boxX, boxY, boxW, boxH, palette.colors[2], 0.85);
    renderer.drawTextHex('NEXT', boxX + boxW * 0.5, boxY + 3, palette.colors[2], 0.85, '3x5', 'center');

    const cx = boxX + Math.floor(boxW * 0.5);
    const cy = boxY + 20;
    const offsets: readonly [number, number][] = [
      [0, -4],
      [4, 0],
      [0, 4],
      [-4, 0],
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
    inputKind: InputDeviceKind,
  ): void {
    const step = state.tutorial.step;
    const progress = getTutorialProgress(state.tutorial);
    const h = 44;

    renderer.drawRectHex(x, y, w, h, palette.colors[1], 0.92);
    this.drawBoxOutline(renderer, x, y, w, h, palette.colors[3], 1);

    const iconFrame = TUTORIAL_ICON_FRAME[step];
    renderer.drawSpriteHex('tutorial_icons', iconFrame, x + 12, y + 14, palette.colors[3], 1);

    const title = TUTORIAL_TITLES[step];
    const titleFont = title.length > 10 ? '3x5' : '5x7';
    const titleColor = isLightPaletteBg(palette.colors[0]) ? palette.colors[2] : palette.colors[3];
    renderer.drawTextHex(title, x + 24, y + 6, titleColor, 1, titleFont, 'left');

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

    const [line1, line2] = this.getTutorialHints(inputKind)[step];
    renderer.drawTextHex(line1, x + 24, y + 17, palette.colors[2], 0.95, '3x5', 'left');
    renderer.drawTextHex(line2, x + 6, y + 27, palette.colors[2], 0.85, '3x5', 'left');

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

  private renderPortraitTutorialStrip(
    renderer: WebGL2Renderer,
    state: SimState,
    x: number,
    y: number,
    w: number,
    palette: Palette,
    inputKind: InputDeviceKind,
  ): void {
    const step = state.tutorial.step;
    const progress = getTutorialProgress(state.tutorial);
    const h = 19;

    renderer.drawRectHex(x, y, w, h, palette.colors[1], 0.88);
    this.drawBoxOutline(renderer, x, y, w, h, palette.colors[3], 0.9);

    const title = TUTORIAL_TITLES[step];
    const [line1] = this.getTutorialHints(inputKind)[step];
    const titleColor = isLightPaletteBg(palette.colors[0]) ? palette.colors[2] : palette.colors[3];
    renderer.drawTextHex(`${title}: ${line1}`, x + 5, y + 4, titleColor, 1, '3x5', 'left');
    if (progress.target > 0) {
      renderer.drawTextHex(
        `${progress.current}/${progress.target}`,
        x + w - 4,
        y + 4,
        palette.colors[2],
        0.85,
        '3x5',
        'right',
      );
    }

    this.drawCrispProgressBar(
      renderer,
      x + 5,
      y + h - 5,
      w - 10,
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
    portrait: boolean,
  ): void {
    const logicalW = portrait ? PORTRAIT_LOGICAL_WIDTH : LOGICAL_WIDTH;
    const barY = portrait ? PORTRAIT_LOGICAL_HEIGHT - 13 : 167;

    renderer.drawRectHex(0, barY, logicalW, 13, palette.colors[0], 0.88);
    renderer.drawRectHex(0, barY, logicalW, 1, palette.colors[1], 1);

    const loopUpper = telemetry.loopName.toUpperCase();
    const nextUpper = telemetry.nextLoopName.toUpperCase();
    const bpmText = `${Math.round(telemetry.bpm)}BPM`;
    const progText = `P${telemetry.progressionStep + 1}/${Math.max(1, telemetry.progressionLength)}`;
    const line = portrait
      ? `${loopUpper}->${nextUpper} ${bpmText} ${progText}`
      : `LOOP: ${loopUpper} -> ${nextUpper} | ${bpmText} | PROG ${telemetry.progressionStep + 1}/${Math.max(1, telemetry.progressionLength)}`;

    renderer.drawTextHex(line, logicalW * 0.5, barY + 4, palette.colors[2], 1, '3x5', 'center');

    const railX = 6;
    const railW = logicalW - 12;
    renderer.drawRectHex(railX, barY + 11, railW, 1, palette.colors[1], 1);
    const fillW = Math.max(1, Math.round(railW * clamp01(telemetry.loopProgress)));
    renderer.drawRectHex(railX, barY + 11, fillW, 1, palette.colors[3], 1);
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
