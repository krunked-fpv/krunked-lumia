import {
  ARR_MOVE_SPEED_NAMES,
  ARR_MOVE_SPEED_TICKS,
  GAME_MODE_CONFIGS,
  GAME_MODE_ORDER,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PORTRAIT_LOGICAL_HEIGHT,
  PORTRAIT_LOGICAL_WIDTH,
  SIM_DT_MS,
  TARGET_FPS_OPTIONS,
  parseHexRgb01,
  type AppScreen,
  type ControllerKind,
  type GameModeId,
  type GamepadBindings,
  type KeyboardBindings,
  type NextBlockLocation,
  type PackMode,
  type Palette,
  type PaletteColors,
  type PlayerProfile,
  type PortraitMode,
  type SimState,
  type TargetFps,
  type TouchControlsMode,
  type TrackId,
  type UserSettings,
} from '../contracts/index.js';
import { t } from '../data/localization.js';
import { MODE_LIST } from '../data/modes.js';
import { isPaletteLight } from '../data/palettes.js';
import {
  DEFAULT_TOUCH_OPACITY,
  NEXT_BLOCK_LOCATIONS,
  PORTRAIT_MODES,
  TOUCH_CONTROLS_MODES,
} from '../data/settingsDefaults.js';
import { getTrackMeta, getTracksForMode } from '../data/tracks.js';
import { isModeUnlocked } from '../sim/modes.js';
import { InputManager, type UiInputState } from '../input/InputManager.js';
import type { RunRecordOutcome, SettingsUpdatePatch } from '../app/SaveManager.js';
import type { WebGL2Renderer } from '../render/WebGL2Renderer.js';
import { ColorEditorScreen, type ColorEditorCallbacks } from './ColorEditorScreen.js';
import {
  ControlsRemapScreen,
  type ControlsDeviceTab,
  type ControlsRemapCallbacks,
} from './ControlsRemapScreen.js';
import { formatHudTime } from './HudRenderer.js';
import { ProfilesScreen, type ProfilesScreenCallbacks } from './ProfilesScreen.js';

export type SettingsTabId = 'COLORS' | 'GAMEPLAY' | 'EFFECTS' | 'CONTROLS' | 'DISPLAY' | 'AUDIO';

const SETTINGS_TABS: readonly SettingsTabId[] = [
  'COLORS',
  'GAMEPLAY',
  'EFFECTS',
  'CONTROLS',
  'DISPLAY',
  'AUDIO',
] as const;

const NEXT_LOC_LABELS: Record<NextBlockLocation, string> = {
  upper_left: 'UPPER LEFT',
  upper_right: 'UPPER RIGHT',
  lower_left: 'LOWER LEFT',
  lower_right: 'LOWER RIGHT',
};

const PALETTE_SLOT_NAMES = ['BG', 'BOARD', 'BLK 1', 'BLK 2', 'BLK 3', 'BLK 4'] as const;

export interface MenuScreenContext {
  screen: AppScreen;
  palette: Palette;
  allPalettes: readonly Palette[];
  settings: UserSettings;
  profile: PlayerProfile;
  profiles: readonly PlayerProfile[];
  simState: SimState | null;
  lastRunOutcome: RunRecordOutcome | null;
  selectedMode: GameModeId;
  selectedTrack: TrackId;
  packMode: PackMode;
  customPackAvailable: boolean;
  customPackStatusLabel: string;
  hasCustomPackLoader: boolean;
  settingsReturnScreen: AppScreen;
  anyKeyPressed: boolean;
  isPortraitGameplay?: boolean;
  controllerKind?: ControllerKind | null;
  connectedGamepads?: number;
}

export interface MenuScreenCallbacks {
  onDismissPhotosensitivity: () => void;
  onNavigate: (screen: AppScreen) => void;
  onSelectMode: (mode: GameModeId) => void;
  onSelectTrack: (trackId: TrackId) => void;
  onPreviewTrack: (trackId: TrackId) => void;
  onStartRun: (mode: GameModeId, trackId: TrackId) => void;
  onResumeRun: () => void;
  onRestartRun: () => void;
  onEndRunToTitle: () => void;
  onUpdateSettings: (patch: SettingsUpdatePatch) => void;
  onResetTutorialCompleted: () => void;
  onTogglePackMode: () => void;
  onRequestLoadCustomPack: () => void;
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name: string) => PlayerProfile | null;
  onRenameProfile: (profileId: string, newName: string) => PlayerProfile | null;
  onDeleteProfile: (profileId: string) => boolean;
  onSaveCustomPalette: (input: { id?: string; name: string; colors: PaletteColors }) => Palette | null;
  onDeleteCustomPalette: (paletteId: string) => boolean;
  onApplyPalette: (paletteId: string) => void;
  onCopyToClipboard: (text: string) => boolean | Promise<boolean>;
  onRequestImportCode: () => string | null;
  onApplyControlBindings: (bindings: { keyboard: KeyboardBindings; gamepad: GamepadBindings }) => void;
  onPlayMenuMove: () => void;
  onPlayMenuSelect: () => void;
  onPlayMenuBack: () => void;
  onPlayMenuFail: () => void;
}

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hitTest(mx: number, my: number, rect: HitRect): boolean {
  return mx >= rect.x && mx < rect.x + rect.w && my >= rect.y && my < rect.y + rect.h;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawBox(
  renderer: WebGL2Renderer,
  x: number,
  y: number,
  w: number,
  h: number,
  fillHex: string,
  borderHex: string,
  fillAlpha = 0.92,
  borderAlpha = 1,
): void {
  if (fillAlpha > 0) {
    renderer.drawRectHex(x, y, w, h, fillHex, fillAlpha);
  }
  if (borderAlpha > 0) {
    renderer.drawRectHex(x, y, w, 1, borderHex, borderAlpha);
    renderer.drawRectHex(x, y + h - 1, w, 1, borderHex, borderAlpha);
    renderer.drawRectHex(x, y, 1, h, borderHex, borderAlpha);
    renderer.drawRectHex(x + w - 1, y, 1, h, borderHex, borderAlpha);
  }
}

interface SettingRowDef {
  id: string;
  label: string;
  valueText: string;
  desc: string;
  kind: 'toggle' | 'cycle' | 'slider' | 'action';
  sliderRatio?: number;
  adjust?: (dir: -1 | 1) => void;
  activate: () => void;
  setRatio?: (ratio: number) => void;
}

const BACK_BTN_RECT: HitRect = { x: 8, y: 7, w: 34, h: 11 };
const COLORS_EDITOR_BTN_RECT: HitRect = { x: 14, y: 128, w: 292, h: 15 };

const NOOP_MENU_CALLBACKS: MenuScreenCallbacks = {
  onDismissPhotosensitivity: () => {},
  onNavigate: () => {},
  onSelectMode: () => {},
  onSelectTrack: () => {},
  onPreviewTrack: () => {},
  onStartRun: () => {},
  onResumeRun: () => {},
  onRestartRun: () => {},
  onEndRunToTitle: () => {},
  onUpdateSettings: () => {},
  onResetTutorialCompleted: () => {},
  onTogglePackMode: () => {},
  onRequestLoadCustomPack: () => {},
  onSelectProfile: () => {},
  onCreateProfile: () => null,
  onRenameProfile: () => null,
  onDeleteProfile: () => false,
  onSaveCustomPalette: () => null,
  onDeleteCustomPalette: () => false,
  onApplyPalette: () => {},
  onCopyToClipboard: () => false,
  onRequestImportCode: () => null,
  onApplyControlBindings: () => {},
  onPlayMenuMove: () => {},
  onPlayMenuSelect: () => {},
  onPlayMenuBack: () => {},
  onPlayMenuFail: () => {},
};

/**
 * 100% Pixel-Native 320x180 Menu System rendered through WebGL2Renderer.
 * Full simultaneous Keyboard, Gamepad, and Mouse hover/click support across all screens.
 */
export class MenuScreens {
  private animTime = 0;

  private readonly colorEditor = new ColorEditorScreen();
  private readonly controlsRemap = new ControlsRemapScreen();
  private readonly profilesScreen = new ProfilesScreen();
  private fallbackInputManager: InputManager | null = null;

  private titleIdx = 0;
  private titleProfileHovered = false;
  private titlePackBadgeHovered = false;
  private modeIdx = 0;
  private trackIdx = 0;
  private pauseIdx = 0;
  private endgameIdx = 0;

  private settingsTabIdx = 0;
  private settingsRowIdx = 0; // -1 = tab bar focused, 0..N-1 = row focused
  private settingsScrollTop = 0;
  private draggingSettingsRowId: string | null = null;
  private controlsRemapOpen = false;

  private lockShakeTimer = 0;
  private toastText = '';
  private toastTimer = 0;

  dispose(): void {
    this.colorEditor.dispose();
    this.profilesScreen.dispose();
    this.controlsRemapOpen = false;
    if (this.fallbackInputManager) {
      this.fallbackInputManager.dispose();
      this.fallbackInputManager = null;
    }
  }

  isControlsRemapOpen(): boolean {
    return this.controlsRemapOpen;
  }

  showToast(text: string, durationSec = 2.5): void {
    this.toastText = text;
    this.toastTimer = durationSec;
  }

  private getFallbackInputManager(): InputManager {
    if (!this.fallbackInputManager) {
      this.fallbackInputManager = new InputManager();
    }
    return this.fallbackInputManager;
  }

  onEnterScreen(screen: AppScreen, ctx: MenuScreenContext): void {
    if (screen !== 'COLOR_EDITOR') {
      this.colorEditor.dispose();
    }
    if (screen !== 'PROFILES') {
      this.profilesScreen.dispose();
    }
    if (screen !== 'SETTINGS') {
      this.controlsRemapOpen = false;
    }

    switch (screen) {
      case 'TITLE':
        this.titleIdx = 0;
        this.titleProfileHovered = false;
        this.titlePackBadgeHovered = false;
        break;
      case 'MODE_SELECT': {
        const idx = GAME_MODE_ORDER.indexOf(ctx.selectedMode);
        this.modeIdx = idx >= 0 ? idx : 0;
        break;
      }
      case 'TRACK_SELECT': {
        const tracks = getTracksForMode(ctx.selectedMode);
        const idx = tracks.findIndex((tr) => tr.id === ctx.selectedTrack);
        this.trackIdx = idx >= 0 ? idx : 0;
        break;
      }
      case 'PAUSED':
        this.pauseIdx = 0;
        break;
      case 'ENDGAME':
        this.endgameIdx = 0;
        break;
      case 'SETTINGS':
        this.controlsRemapOpen = false;
        this.settingsRowIdx = 0;
        this.settingsScrollTop = 0;
        break;
      case 'COLOR_EDITOR':
        this.colorEditor.onEnter(ctx.allPalettes, ctx.palette.id);
        break;
      case 'PROFILES':
        this.profilesScreen.onEnter(ctx.profiles, ctx.profile.id);
        break;
      default:
        break;
    }
  }

  update(
    dtSec: number,
    input: UiInputState,
    ctx: MenuScreenContext,
    cb: MenuScreenCallbacks,
    inputManager?: InputManager,
  ): void {
    this.animTime += Math.max(0, Math.min(dtSec, 0.1));
    if (this.lockShakeTimer > 0) {
      this.lockShakeTimer = Math.max(0, this.lockShakeTimer - dtSec);
    }
    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - dtSec);
    }

    switch (ctx.screen) {
      case 'PHOTOSENSITIVITY':
        this.updatePhotosensitivity(input, ctx, cb);
        break;
      case 'TITLE':
        this.updateTitle(input, ctx, cb);
        break;
      case 'MODE_SELECT':
        this.updateModeSelect(input, ctx, cb);
        break;
      case 'TRACK_SELECT':
        this.updateTrackSelect(input, ctx, cb);
        break;
      case 'PAUSED':
        this.updatePaused(input, ctx, cb);
        break;
      case 'ENDGAME':
        this.updateEndgame(input, ctx, cb);
        break;
      case 'SETTINGS':
        this.updateSettings(dtSec, input, ctx, cb, inputManager);
        break;
      case 'SCORES_STATS':
      case 'CREDITS':
        this.updateSimpleBackScreen(input, cb, 'TITLE');
        break;
      case 'COLOR_EDITOR':
        this.colorEditor.update(dtSec, input, this.buildColorEditorCallbacks(cb));
        break;
      case 'PROFILES':
        this.profilesScreen.update(dtSec, input, this.buildProfilesCallbacks(cb));
        break;
      default:
        break;
    }
  }

  render(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    switch (ctx.screen) {
      case 'PHOTOSENSITIVITY':
        this.renderPhotosensitivity(renderer, ctx);
        break;
      case 'TITLE':
        this.renderTitle(renderer, ctx);
        break;
      case 'MODE_SELECT':
        this.renderModeSelect(renderer, ctx);
        break;
      case 'TRACK_SELECT':
        this.renderTrackSelect(renderer, ctx);
        break;
      case 'PAUSED':
        this.renderPaused(renderer, ctx);
        break;
      case 'ENDGAME':
        this.renderEndgame(renderer, ctx);
        break;
      case 'SETTINGS':
        this.renderSettings(renderer, ctx);
        break;
      case 'SCORES_STATS':
        this.renderScoresStats(renderer, ctx);
        break;
      case 'CREDITS':
        this.renderCredits(renderer, ctx);
        break;
      case 'COLOR_EDITOR':
        this.colorEditor.render(renderer, ctx.palette);
        break;
      case 'PROFILES':
        this.profilesScreen.render(renderer, ctx.palette);
        break;
      default:
        break;
    }

    if (this.toastTimer > 0 && this.toastText) {
      const logicalW =
        ctx.isPortraitGameplay && (ctx.screen === 'PAUSED' || ctx.screen === 'ENDGAME')
          ? PORTRAIT_LOGICAL_WIDTH
          : LOGICAL_WIDTH;
      const toastY =
        ctx.isPortraitGameplay && (ctx.screen === 'PAUSED' || ctx.screen === 'ENDGAME')
          ? PORTRAIT_LOGICAL_HEIGHT - 22
          : 150;
      const alpha = Math.min(1, this.toastTimer * 2);
      const maxChars = logicalW <= 180 ? 38 : 70;
      const display =
        this.toastText.length > maxChars ? `${this.toastText.slice(0, maxChars - 3)}...` : this.toastText;
      const w = Math.min(logicalW - 12, display.length * 4 + 14);
      const x = Math.round((logicalW - w) * 0.5);
      drawBox(renderer, x, toastY, w, 12, ctx.palette.colors[1], ctx.palette.colors[3], 0.96 * alpha, alpha);
      renderer.drawTextHex(display, logicalW * 0.5, toastY + 4, ctx.palette.colors[3], alpha, '3x5', 'center');
    }
  }

  // ==========================================================================
  // AMBIENT PIXEL-DIAMOND MENU BACKGROUND
  // ==========================================================================

  private renderAmbientMenuBg(renderer: WebGL2Renderer, ctx: MenuScreenContext, density = 4): void {
    if (!ctx.settings.render.bgShapes) return;
    const tSec = this.animTime;
    const cx = LOGICAL_WIDTH * 0.5;
    const cy = LOGICAL_HEIGHT * 0.5;

    for (let i = 0; i < density; i++) {
      const phase = ((tSec * 0.14 + i / density) % 1 + 1) % 1;
      const radius = 14 + phase * 175;
      const alpha = Math.sin(phase * Math.PI) * 0.24;
      if (alpha <= 0.01) continue;
      const slot = 2 + (i % 4);
      const [r, g, b] = parseHexRgb01(ctx.palette.colors[slot]);
      renderer.drawDiamondOutline(cx, cy, radius, r, g, b, alpha);
    }
  }

  private renderBackButton(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    drawBox(
      renderer,
      BACK_BTN_RECT.x,
      BACK_BTN_RECT.y,
      BACK_BTN_RECT.w,
      BACK_BTN_RECT.h,
      ctx.palette.colors[1],
      ctx.palette.colors[2],
      0.85,
      0.7,
    );
    renderer.drawTextHex('< BACK', BACK_BTN_RECT.x + 17, BACK_BTN_RECT.y + 3, ctx.palette.colors[2], 1, '3x5', 'center');
  }

  // ==========================================================================
  // 1. PHOTOSENSITIVITY SCREEN
  // ==========================================================================

  private updatePhotosensitivity(
    input: UiInputState,
    ctx: MenuScreenContext,
    cb: MenuScreenCallbacks,
  ): void {
    if (
      ctx.anyKeyPressed ||
      input.anyGamepadPressed ||
      input.confirm ||
      input.cancel ||
      input.up ||
      input.down ||
      input.left ||
      input.right ||
      input.pause ||
      input.mouseClicked
    ) {
      cb.onPlayMenuSelect();
      cb.onDismissPhotosensitivity();
    }
  }

  private renderPhotosensitivity(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    this.renderAmbientMenuBg(renderer, ctx, 2);

    const cardX = 32;
    const cardY = 24;
    const cardW = 256;
    const cardH = 132;

    drawBox(renderer, cardX, cardY, cardW, cardH, ctx.palette.colors[1], ctx.palette.colors[3], 0.94, 1);

    // Diamond emblem at top
    renderer.drawSpriteHex('logo_diamond_spr', 0, 160, cardY + 20, ctx.palette.colors[3], 1);

    renderer.drawTextHex(
      t('photosensitivity.title'),
      160,
      cardY + 38,
      ctx.palette.colors[3],
      1,
      '5x7',
      'center',
    );

    const lines = wrapText(t('photosensitivity.body'), 54);
    for (let i = 0; i < lines.length; i++) {
      renderer.drawTextHex(
        lines[i],
        160,
        cardY + 56 + i * 9,
        ctx.palette.colors[2],
        0.95,
        '3x5',
        'center',
      );
    }

    const pulse = ctx.settings.render.flashing
      ? 0.55 + 0.45 * Math.sin(this.animTime * 4.5)
      : 1;
    renderer.drawTextHex(
      t('photosensitivity.hint'),
      160,
      cardY + cardH - 18,
      ctx.palette.colors[3],
      pulse,
      '3x5',
      'center',
    );
  }

  // ==========================================================================
  // 2. TITLE SCREEN
  // ==========================================================================

  private getTitleItems(ctx: MenuScreenContext): { id: string; label: string; kind: 'main' | 'pack' }[] {
    const items: { id: string; label: string; kind: 'main' | 'pack' }[] = [
      { id: 'start', label: 'START', kind: 'main' },
      { id: 'settings', label: 'SETTINGS', kind: 'main' },
      { id: 'scores', label: 'SCORES + STATS', kind: 'main' },
      { id: 'profiles', label: 'PROFILES', kind: 'main' },
      { id: 'credits', label: 'CREDITS', kind: 'main' },
    ];
    if (ctx.customPackAvailable) {
      items.push({
        id: 'pack_toggle',
        label: ctx.packMode === 'custom' ? 'USE BUILT-IN ART' : 'USE CUSTOM PACK',
        kind: 'pack',
      });
    }
    if (ctx.hasCustomPackLoader) {
      items.push({
        id: 'pack_load',
        label: 'LOAD CUSTOM PACK',
        kind: 'pack',
      });
    }
    return items;
  }

  private getTitleItemRect(
    index: number,
    items: readonly { id: string; label: string; kind: 'main' | 'pack' }[],
  ): HitRect {
    const item = items[index];
    if (!item || item.kind === 'main') {
      return { x: 92, y: 64 + index * 13, w: 136, h: 12 };
    }
    const firstPackIdx = items.findIndex((it) => it.kind === 'pack');
    const packCount = items.length - firstPackIdx;
    const packPos = index - firstPackIdx;
    if (packCount >= 2) {
      return packPos === 0
        ? { x: 54, y: 134, w: 102, h: 13 }
        : { x: 164, y: 134, w: 102, h: 13 };
    }
    return { x: 104, y: 134, w: 112, h: 13 };
  }

  private getTitleProfileBadgeRect(): HitRect {
    return { x: 8, y: 164, w: 90, h: 11 };
  }

  private getTitlePackBadgeRect(): HitRect {
    return { x: 220, y: 164, w: 92, h: 11 };
  }

  private updateTitle(input: UiInputState, ctx: MenuScreenContext, cb: MenuScreenCallbacks): void {
    const items = this.getTitleItems(ctx);
    if (this.titleIdx >= items.length) this.titleIdx = 0;

    if (input.up) {
      this.titleIdx = (this.titleIdx - 1 + items.length) % items.length;
      cb.onPlayMenuMove();
    } else if (input.down) {
      this.titleIdx = (this.titleIdx + 1) % items.length;
      cb.onPlayMenuMove();
    } else if (input.left || input.right) {
      const firstPackIdx = items.findIndex((it) => it.kind === 'pack');
      if (firstPackIdx >= 0 && items.length - firstPackIdx >= 2 && this.titleIdx >= firstPackIdx) {
        this.titleIdx = this.titleIdx === firstPackIdx ? firstPackIdx + 1 : firstPackIdx;
        cb.onPlayMenuMove();
      }
    }

    if (input.mouseInBounds) {
      for (let i = 0; i < items.length; i++) {
        if (hitTest(input.mouseX, input.mouseY, this.getTitleItemRect(i, items))) {
          if (input.mouseMoved && this.titleIdx !== i) {
            this.titleIdx = i;
            cb.onPlayMenuMove();
          }
          if (input.mouseClicked) {
            this.titleIdx = i;
            this.activateTitleItem(items[i].id, ctx, cb);
            return;
          }
        }
      }

      const overProfile = hitTest(input.mouseX, input.mouseY, this.getTitleProfileBadgeRect());
      if (input.mouseMoved && overProfile !== this.titleProfileHovered) {
        this.titleProfileHovered = overProfile;
        if (overProfile) cb.onPlayMenuMove();
      }
      if (input.mouseClicked && overProfile) {
        cb.onPlayMenuSelect();
        cb.onNavigate('PROFILES');
        return;
      }

      const overPackBadge = hitTest(input.mouseX, input.mouseY, this.getTitlePackBadgeRect());
      if (input.mouseMoved && overPackBadge !== this.titlePackBadgeHovered) {
        this.titlePackBadgeHovered = overPackBadge;
        if (overPackBadge) cb.onPlayMenuMove();
      }
      if (input.mouseClicked && overPackBadge) {
        this.handlePackBadgeAction(ctx, cb);
        return;
      }
    } else {
      this.titleProfileHovered = false;
      this.titlePackBadgeHovered = false;
    }

    if (input.confirm) {
      this.activateTitleItem(items[this.titleIdx].id, ctx, cb);
    }
  }

  private handlePackBadgeAction(ctx: MenuScreenContext, cb: MenuScreenCallbacks): void {
    if (ctx.customPackAvailable) {
      cb.onPlayMenuSelect();
      cb.onTogglePackMode();
    } else if (ctx.hasCustomPackLoader) {
      cb.onPlayMenuSelect();
      cb.onRequestLoadCustomPack();
    } else {
      cb.onPlayMenuMove();
      this.showToast('BUILT-IN ART ACTIVE', 2.5);
    }
  }

  private handlePackRowAction(ctx: MenuScreenContext, cb: MenuScreenCallbacks): void {
    if (ctx.customPackAvailable) {
      cb.onTogglePackMode();
    } else if (ctx.hasCustomPackLoader) {
      cb.onRequestLoadCustomPack();
    } else {
      this.showToast('BUILT-IN ART ACTIVE', 2.5);
    }
  }

  private activateTitleItem(id: string, ctx: MenuScreenContext, cb: MenuScreenCallbacks): void {
    switch (id) {
      case 'start':
        cb.onPlayMenuSelect();
        cb.onNavigate('MODE_SELECT');
        break;
      case 'settings':
        cb.onPlayMenuSelect();
        cb.onNavigate('SETTINGS');
        break;
      case 'scores':
        cb.onPlayMenuSelect();
        cb.onNavigate('SCORES_STATS');
        break;
      case 'profiles':
        cb.onPlayMenuSelect();
        cb.onNavigate('PROFILES');
        break;
      case 'credits':
        cb.onPlayMenuSelect();
        cb.onNavigate('CREDITS');
        break;
      case 'pack_toggle':
        cb.onPlayMenuSelect();
        cb.onTogglePackMode();
        break;
      case 'pack_load':
        cb.onPlayMenuSelect();
        if (ctx.hasCustomPackLoader) {
          cb.onRequestLoadCustomPack();
        } else {
          this.showToast('BUILT-IN ART ACTIVE', 2.5);
        }
        break;
    }
  }

  private renderTitle(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    this.renderAmbientMenuBg(renderer, ctx, 5);

    // Floating decorative 4-color diamond satellites around the logo emblem
    const emblemX = 160;
    const emblemY = 21;
    renderer.drawSpriteHex('logo_diamond_spr', 0, emblemX, emblemY, ctx.palette.colors[3], 1);

    const bob = Math.sin(this.animTime * 2.2) * 2.2;
    renderer.drawSpriteHex('block_spr', 0, emblemX - 24, emblemY - 3 + bob, ctx.palette.colors[2], 0.9);
    renderer.drawSpriteHex('block_spr', 1, emblemX + 24, emblemY - 3 - bob, ctx.palette.colors[3], 0.9);
    renderer.drawSpriteHex('block_spr', 2, emblemX - 34, emblemY + 5 - bob, ctx.palette.colors[4], 0.85);
    renderer.drawSpriteHex('block_spr', 3, emblemX + 34, emblemY + 5 + bob, ctx.palette.colors[5], 0.85);

    // Iconic pixel title (2x 5x7 = razor sharp pixel art)
    renderer.drawTextHex('KRUNKED LUMIA', 161, 36, ctx.palette.colors[1], 1, '5x7', 'center', 2);
    renderer.drawTextHex('KRUNKED LUMIA', 160, 35, ctx.palette.colors[2], 1, '5x7', 'center', 2);

    // Tagline
    renderer.drawTextHex(
      t('app.tagline'),
      160,
      53,
      ctx.palette.colors[3],
      0.9,
      '3x5',
      'center',
    );

    // Menu Items + Pack Controls
    const items = this.getTitleItems(ctx);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rect = this.getTitleItemRect(i, items);
      const selected = i === this.titleIdx;

      if (item.kind === 'main') {
        if (selected) {
          drawBox(renderer, rect.x, rect.y, rect.w, rect.h, ctx.palette.colors[1], ctx.palette.colors[3], 0.92, 1);
          renderer.drawSpriteHex('arrow_spr', 0, rect.x + 8, rect.y + 6, ctx.palette.colors[3], 1);
          renderer.drawSpriteHex('arrow_spr', 1, rect.x + rect.w - 8, rect.y + 6, ctx.palette.colors[3], 1);
        }
        renderer.drawTextHex(
          item.label,
          160,
          rect.y + 3,
          selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
          selected ? 1 : 0.88,
          '5x7',
          'center',
        );
      } else {
        const isActiveToggle = item.id === 'pack_toggle' && ctx.packMode === 'custom';
        const borderHex = selected
          ? ctx.palette.colors[3]
          : isActiveToggle
            ? ctx.palette.colors[4]
            : ctx.palette.colors[2];
        drawBox(
          renderer,
          rect.x,
          rect.y,
          rect.w,
          rect.h,
          ctx.palette.colors[1],
          borderHex,
          selected ? 0.95 : 0.72,
          selected ? 1 : 0.65,
        );
        if (selected) {
          renderer.drawSpriteHex('arrow_spr', 0, rect.x + 6, rect.y + 6, ctx.palette.colors[3], 1);
        }
        renderer.drawTextHex(
          item.label,
          rect.x + rect.w * 0.5 + (selected ? 3 : 0),
          rect.y + 4,
          selected ? ctx.palette.colors[3] : isActiveToggle ? ctx.palette.colors[4] : ctx.palette.colors[2],
          1,
          '3x5',
          'center',
        );
      }
    }

    // Bottom status bar: Clickable Profile pill (left) + Palette (center) + Pack status pill (right)
    const profileRect = this.getTitleProfileBadgeRect();
    drawBox(
      renderer,
      profileRect.x,
      profileRect.y,
      profileRect.w,
      profileRect.h,
      ctx.palette.colors[1],
      this.titleProfileHovered ? ctx.palette.colors[3] : ctx.palette.colors[2],
      this.titleProfileHovered ? 0.94 : 0.82,
      this.titleProfileHovered ? 1 : 0.65,
    );
    const rawProf = ctx.profile.name.toUpperCase();
    const profLabel = rawProf.length > 18 ? `${rawProf.slice(0, 17)}.` : rawProf;
    renderer.drawTextHex(
      profLabel,
      profileRect.x + profileRect.w * 0.5,
      profileRect.y + 3,
      this.titleProfileHovered ? ctx.palette.colors[3] : ctx.palette.colors[2],
      1,
      '3x5',
      'center',
    );

    const rawPal = ctx.palette.name.toUpperCase();
    const palLabel = rawPal.length > 24 ? `${rawPal.slice(0, 23)}.` : rawPal;
    renderer.drawTextHex(
      palLabel,
      159,
      167,
      ctx.palette.colors[2],
      0.72,
      '3x5',
      'center',
    );

    const packRect = this.getTitlePackBadgeRect();
    const packBorder =
      this.titlePackBadgeHovered || ctx.packMode === 'custom'
        ? ctx.palette.colors[3]
        : ctx.palette.colors[2];
    drawBox(
      renderer,
      packRect.x,
      packRect.y,
      packRect.w,
      packRect.h,
      ctx.palette.colors[1],
      packBorder,
      this.titlePackBadgeHovered ? 0.95 : 0.88,
      this.titlePackBadgeHovered || ctx.packMode === 'custom' ? 1 : 0.75,
    );
    renderer.drawTextHex(
      ctx.customPackStatusLabel,
      packRect.x + packRect.w * 0.5,
      packRect.y + 3,
      packBorder,
      1,
      '3x5',
      'center',
    );
  }

  // ==========================================================================
  // 3. MODE SELECT SCREEN
  // ==========================================================================

  private getModeRowRect(index: number): HitRect {
    return { x: 12, y: 26 + index * 21, w: 142, h: 19 };
  }

  private getModeConfirmBtnRect(): HitRect {
    return { x: 184, y: 132, w: 98, h: 14 };
  }

  private updateModeSelect(
    input: UiInputState,
    ctx: MenuScreenContext,
    cb: MenuScreenCallbacks,
  ): void {
    const count = MODE_LIST.length;

    if (input.cancel) {
      cb.onPlayMenuBack();
      cb.onNavigate('TITLE');
      return;
    }

    if (input.up) {
      this.modeIdx = (this.modeIdx - 1 + count) % count;
      cb.onSelectMode(MODE_LIST[this.modeIdx].id);
      cb.onPlayMenuMove();
    } else if (input.down) {
      this.modeIdx = (this.modeIdx + 1) % count;
      cb.onSelectMode(MODE_LIST[this.modeIdx].id);
      cb.onPlayMenuMove();
    }

    if (input.mouseInBounds) {
      if (input.mouseClicked && hitTest(input.mouseX, input.mouseY, BACK_BTN_RECT)) {
        cb.onPlayMenuBack();
        cb.onNavigate('TITLE');
        return;
      }

      for (let i = 0; i < count; i++) {
        if (hitTest(input.mouseX, input.mouseY, this.getModeRowRect(i))) {
          if (input.mouseMoved && this.modeIdx !== i) {
            this.modeIdx = i;
            cb.onSelectMode(MODE_LIST[i].id);
            cb.onPlayMenuMove();
          }
          if (input.mouseClicked) {
            if (input.isTouchPointer && this.modeIdx !== i) {
              this.modeIdx = i;
              cb.onSelectMode(MODE_LIST[i].id);
              cb.onPlayMenuMove();
              return;
            }
            this.modeIdx = i;
            cb.onSelectMode(MODE_LIST[i].id);
            this.confirmMode(MODE_LIST[i].id, ctx, cb);
            return;
          }
        }
      }

      if (input.mouseClicked && hitTest(input.mouseX, input.mouseY, this.getModeConfirmBtnRect())) {
        this.confirmMode(MODE_LIST[this.modeIdx].id, ctx, cb);
        return;
      }
    }

    if (input.confirm) {
      this.confirmMode(MODE_LIST[this.modeIdx].id, ctx, cb);
    }
  }

  private confirmMode(mode: GameModeId, ctx: MenuScreenContext, cb: MenuScreenCallbacks): void {
    if (!isModeUnlocked(mode, ctx.profile)) {
      this.lockShakeTimer = 0.4;
      cb.onPlayMenuFail();
      return;
    }
    cb.onPlayMenuSelect();
    cb.onSelectMode(mode);
    cb.onNavigate('TRACK_SELECT');
  }

  private renderModeSelect(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    this.renderAmbientMenuBg(renderer, ctx, 3);
    this.renderBackButton(renderer, ctx);

    renderer.drawTextHex('SELECT MODE', 160, 9, ctx.palette.colors[3], 1, '5x7', 'center');

    // Left column: all 6 modes
    for (let i = 0; i < MODE_LIST.length; i++) {
      const mode = MODE_LIST[i];
      const rect = this.getModeRowRect(i);
      const selected = i === this.modeIdx;
      const unlocked = isModeUnlocked(mode.id, ctx.profile);

      drawBox(
        renderer,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        ctx.palette.colors[1],
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        selected ? 0.94 : 0.45,
        selected ? 1 : 0.35,
      );

      if (unlocked) {
        renderer.drawSpriteHex(
          'mode_icon_spr',
          mode.iconIndex,
          rect.x + 12,
          rect.y + 9,
          selected ? ctx.palette.colors[mode.accentSlot] : ctx.palette.colors[2],
          selected ? 1 : 0.8,
        );
      } else {
        renderer.drawSpriteHex('lock_spr', 0, rect.x + 12, rect.y + 9, ctx.palette.colors[5], 0.9);
      }

      renderer.drawTextHex(
        mode.name.toUpperCase(),
        rect.x + 24,
        rect.y + 3,
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        unlocked ? 1 : 0.65,
        '5x7',
        'left',
      );

      const badgeText = unlocked ? mode.badge : 'LOCKED';
      renderer.drawTextHex(
        badgeText,
        rect.x + rect.w - 5,
        rect.y + 4,
        unlocked ? ctx.palette.colors[2] : ctx.palette.colors[5],
        0.85,
        '3x5',
        'right',
      );

      const hs = ctx.profile.highScores[mode.id] ?? 0;
      const subText = unlocked ? `BEST ${hs.toLocaleString('en-US')}` : '4,000,000 PTS';
      renderer.drawTextHex(
        subText,
        rect.x + 24,
        rect.y + 12,
        ctx.palette.colors[2],
        0.72,
        '3x5',
        'left',
      );
    }

    // Right column: selected mode details card
    const activeMode = MODE_LIST[this.modeIdx] ?? MODE_LIST[0];
    const unlocked = isModeUnlocked(activeMode.id, ctx.profile);
    const cardX = 162;
    const cardY = 26;
    const cardW = 146;
    const cardH = 126;

    const shakeOffset =
      this.lockShakeTimer > 0 ? Math.round(Math.sin(this.lockShakeTimer * 48) * 2) : 0;

    drawBox(
      renderer,
      cardX + shakeOffset,
      cardY,
      cardW,
      cardH,
      ctx.palette.colors[1],
      unlocked ? ctx.palette.colors[3] : ctx.palette.colors[5],
      0.92,
      1,
    );

    const centerX = cardX + shakeOffset + Math.floor(cardW * 0.5);

    if (unlocked) {
      renderer.drawSpriteHex(
        'mode_icon_spr',
        activeMode.iconIndex,
        centerX,
        cardY + 24,
        ctx.palette.colors[activeMode.accentSlot],
        1,
        2,
        2,
      );
    } else {
      renderer.drawSpriteHex('lock_spr', 0, centerX, cardY + 24, ctx.palette.colors[5], 1, 2, 2);
    }

    renderer.drawTextHex(
      activeMode.name.toUpperCase(),
      centerX,
      cardY + 46,
      unlocked ? ctx.palette.colors[3] : ctx.palette.colors[5],
      1,
      '5x7',
      'center',
    );

    const descLines = wrapText(activeMode.description.toUpperCase(), 32);
    for (let i = 0; i < Math.min(3, descLines.length); i++) {
      renderer.drawTextHex(
        descLines[i],
        centerX,
        cardY + 58 + i * 8,
        ctx.palette.colors[2],
        0.92,
        '3x5',
        'center',
      );
    }

    if (!unlocked) {
      renderer.drawTextHex(
        'LOCKED - 4,000,000 PTS',
        centerX,
        cardY + 90,
        ctx.palette.colors[5],
        1,
        '3x5',
        'center',
      );
      renderer.drawTextHex(
        'SCORE 4M IN ANY MODE',
        centerX,
        cardY + 101,
        ctx.palette.colors[2],
        0.75,
        '3x5',
        'center',
      );
    } else {
      const hs = ctx.profile.highScores[activeMode.id] ?? 0;
      renderer.drawTextHex('HIGH SCORE', centerX, cardY + 80, ctx.palette.colors[2], 0.72, '3x5', 'center');
      renderer.drawTextHex(
        hs.toLocaleString('en-US'),
        centerX,
        cardY + 88,
        ctx.palette.colors[3],
        1,
        '5x7',
        'center',
      );

      const btn = this.getModeConfirmBtnRect();
      drawBox(renderer, btn.x, btn.y, btn.w, btn.h, ctx.palette.colors[0], ctx.palette.colors[3], 0.85, 1);
      renderer.drawTextHex('SELECT TRACK >', btn.x + btn.w * 0.5, btn.y + 4, ctx.palette.colors[3], 1, '3x5', 'center');
    }

    renderer.drawTextHex(
      'ENTER / CLICK: CONTINUE   ESC: BACK',
      160,
      166,
      ctx.palette.colors[2],
      0.65,
      '3x5',
      'center',
    );
  }

  // ==========================================================================
  // 4. TRACK SELECT SCREEN (with 96x96 color_threshold album cover!)
  // ==========================================================================

  private getTrackRowRect(index: number): HitRect {
    return { x: 12, y: 28 + index * 20, w: 162, h: 18 };
  }

  private getTrackStartBtnRect(): HitRect {
    return { x: 196, y: 144, w: 98, h: 14 };
  }

  private updateTrackSelect(
    input: UiInputState,
    ctx: MenuScreenContext,
    cb: MenuScreenCallbacks,
  ): void {
    const tracks = getTracksForMode(ctx.selectedMode);
    if (tracks.length === 0) return;
    if (this.trackIdx >= tracks.length) this.trackIdx = 0;

    if (input.cancel) {
      cb.onPlayMenuBack();
      cb.onNavigate('MODE_SELECT');
      return;
    }

    if (input.up) {
      this.trackIdx = (this.trackIdx - 1 + tracks.length) % tracks.length;
      const tr = tracks[this.trackIdx];
      cb.onSelectTrack(tr.id);
      cb.onPreviewTrack(tr.id);
      cb.onPlayMenuMove();
    } else if (input.down) {
      this.trackIdx = (this.trackIdx + 1) % tracks.length;
      const tr = tracks[this.trackIdx];
      cb.onSelectTrack(tr.id);
      cb.onPreviewTrack(tr.id);
      cb.onPlayMenuMove();
    }

    if (input.mouseInBounds) {
      if (input.mouseClicked && hitTest(input.mouseX, input.mouseY, BACK_BTN_RECT)) {
        cb.onPlayMenuBack();
        cb.onNavigate('MODE_SELECT');
        return;
      }

      for (let i = 0; i < tracks.length; i++) {
        if (hitTest(input.mouseX, input.mouseY, this.getTrackRowRect(i))) {
          if (input.mouseMoved && this.trackIdx !== i) {
            this.trackIdx = i;
            cb.onSelectTrack(tracks[i].id);
            cb.onPreviewTrack(tracks[i].id);
            cb.onPlayMenuMove();
          }
          if (input.mouseClicked) {
            if (input.isTouchPointer && this.trackIdx !== i) {
              this.trackIdx = i;
              cb.onSelectTrack(tracks[i].id);
              cb.onPreviewTrack(tracks[i].id);
              cb.onPlayMenuMove();
              return;
            }
            this.trackIdx = i;
            cb.onPlayMenuSelect();
            cb.onSelectTrack(tracks[i].id);
            cb.onStartRun(ctx.selectedMode, tracks[i].id);
            return;
          }
        }
      }

      if (input.mouseClicked && hitTest(input.mouseX, input.mouseY, this.getTrackStartBtnRect())) {
        const tr = tracks[this.trackIdx];
        cb.onPlayMenuSelect();
        cb.onStartRun(ctx.selectedMode, tr.id);
        return;
      }
    }

    if (input.confirm) {
      const tr = tracks[this.trackIdx];
      cb.onPlayMenuSelect();
      cb.onStartRun(ctx.selectedMode, tr.id);
    }
  }

  private renderTrackSelect(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    this.renderAmbientMenuBg(renderer, ctx, 3);
    this.renderBackButton(renderer, ctx);

    const modeCfg = GAME_MODE_CONFIGS[ctx.selectedMode];
    renderer.drawTextHex('SELECT TRACK', 160, 9, ctx.palette.colors[3], 1, '5x7', 'center');
    renderer.drawTextHex(
      modeCfg.name.toUpperCase(),
      310,
      10,
      ctx.palette.colors[2],
      0.85,
      '3x5',
      'right',
    );

    const tracks = getTracksForMode(ctx.selectedMode);
    const activeTrack = tracks[this.trackIdx] ?? tracks[0];

    // Left column: track list
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const rect = this.getTrackRowRect(i);
      const selected = i === this.trackIdx;

      drawBox(
        renderer,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        ctx.palette.colors[1],
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        selected ? 0.94 : 0.45,
        selected ? 1 : 0.35,
      );

      if (selected) {
        renderer.drawSpriteHex('arrow_spr', 0, rect.x + 6, rect.y + 9, ctx.palette.colors[3], 1);
      }

      renderer.drawTextHex(
        track.title.toUpperCase(),
        rect.x + 13,
        rect.y + 3,
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        1,
        '5x7',
        'left',
      );
      renderer.drawTextHex(
        track.bpmLabel.toUpperCase(),
        rect.x + rect.w - 4,
        rect.y + 4,
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        0.85,
        '3x5',
        'right',
      );
      renderer.drawTextHex(
        track.subtitle.toUpperCase(),
        rect.x + 13,
        rect.y + 11,
        ctx.palette.colors[2],
        0.72,
        '3x5',
        'left',
      );
    }

    // Right column: 96x96 monochrome cover rendered via color_threshold_shd (Palette Slot 1 & Slot 2/3)
    if (activeTrack) {
      const coverX = 197;
      const coverY = 26;
      const coverSize = 96;

      drawBox(
        renderer,
        coverX - 2,
        coverY - 2,
        coverSize + 4,
        coverSize + 4,
        ctx.palette.colors[1],
        ctx.palette.colors[3],
        1,
        1,
      );
      renderer.drawThresholdCover(
        activeTrack.id,
        coverX,
        coverY,
        coverSize,
        coverSize,
        ctx.palette.colors[1],
        ctx.palette.colors[2],
        1,
      );

      const centerX = coverX + coverSize * 0.5;
      renderer.drawTextHex(
        activeTrack.artist.toUpperCase(),
        centerX,
        127,
        ctx.palette.colors[2],
        0.9,
        '3x5',
        'center',
      );
      renderer.drawTextHex(
        `${activeTrack.bpmLabel.toUpperCase()}  |  ${modeCfg.trackPool.toUpperCase()}`,
        centerX,
        135,
        ctx.palette.colors[3],
        0.95,
        '3x5',
        'center',
      );

      const btn = this.getTrackStartBtnRect();
      drawBox(renderer, btn.x, btn.y, btn.w, btn.h, ctx.palette.colors[1], ctx.palette.colors[3], 0.95, 1);
      renderer.drawTextHex('START RUN', btn.x + btn.w * 0.5, btn.y + 4, ctx.palette.colors[3], 1, '5x7', 'center');
    }

    renderer.drawTextHex(
      'LIVE HARMONIC PREVIEW   ENTER: PLAY   ESC: BACK',
      160,
      167,
      ctx.palette.colors[2],
      0.65,
      '3x5',
      'center',
    );
  }

  // ==========================================================================
  // 5. PAUSED MODAL OVER FROZEN GAMEPLAY
  // ==========================================================================

  private readonly pauseItems = [
    { id: 'resume', label: 'RESUME' },
    { id: 'restart', label: 'RESTART' },
    { id: 'settings', label: 'SETTINGS' },
    { id: 'end', label: 'END RUN' },
  ] as const;

  private getPauseItemRect(index: number, portrait = false): HitRect {
    if (portrait) {
      return { x: 32, y: 114 + index * 20, w: 116, h: 16 };
    }
    return { x: 104, y: 64 + index * 16, w: 112, h: 13 };
  }

  private updatePaused(input: UiInputState, ctx: MenuScreenContext, cb: MenuScreenCallbacks): void {
    const count = this.pauseItems.length;
    const portrait = Boolean(ctx.isPortraitGameplay);
    if (input.cancel || input.pause) {
      cb.onPlayMenuBack();
      cb.onResumeRun();
      return;
    }

    if (input.up) {
      this.pauseIdx = (this.pauseIdx - 1 + count) % count;
      cb.onPlayMenuMove();
    } else if (input.down) {
      this.pauseIdx = (this.pauseIdx + 1) % count;
      cb.onPlayMenuMove();
    }

    if (input.mouseInBounds) {
      for (let i = 0; i < count; i++) {
        if (hitTest(input.mouseX, input.mouseY, this.getPauseItemRect(i, portrait))) {
          if (input.mouseMoved && this.pauseIdx !== i) {
            this.pauseIdx = i;
            cb.onPlayMenuMove();
          }
          if (input.mouseClicked) {
            this.pauseIdx = i;
            this.activatePauseItem(this.pauseItems[i].id, cb);
            return;
          }
        }
      }
    }

    if (input.confirm) {
      this.activatePauseItem(this.pauseItems[this.pauseIdx].id, cb);
    }
  }

  private activatePauseItem(id: string, cb: MenuScreenCallbacks): void {
    switch (id) {
      case 'resume':
        cb.onPlayMenuSelect();
        cb.onResumeRun();
        break;
      case 'restart':
        cb.onPlayMenuSelect();
        cb.onRestartRun();
        break;
      case 'settings':
        cb.onPlayMenuSelect();
        cb.onNavigate('SETTINGS');
        break;
      case 'end':
        cb.onPlayMenuBack();
        cb.onEndRunToTitle();
        break;
    }
  }

  private renderPaused(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    const portrait = Boolean(ctx.isPortraitGameplay);
    const fullW = portrait ? PORTRAIT_LOGICAL_WIDTH : LOGICAL_WIDTH;
    const fullH = portrait ? PORTRAIT_LOGICAL_HEIGHT : LOGICAL_HEIGHT;
    const centerX = fullW * 0.5;
    const boxX = portrait ? 22 : 92;
    const boxY = portrait ? 82 : 36;
    const boxW = 136;
    const boxH = portrait ? 124 : 108;

    renderer.drawRectHex(0, 0, fullW, fullH, ctx.palette.colors[0], 0.72);
    drawBox(renderer, boxX, boxY, boxW, boxH, ctx.palette.colors[1], ctx.palette.colors[3], 0.96, 1);

    renderer.drawTextHex('PAUSED', centerX, boxY + 10, ctx.palette.colors[3], 1, '5x7', 'center');
    renderer.drawRectHex(boxX + 14, boxY + 21, boxW - 28, 1, ctx.palette.colors[2], 0.35);

    for (let i = 0; i < this.pauseItems.length; i++) {
      const rect = this.getPauseItemRect(i, portrait);
      const selected = i === this.pauseIdx;
      if (selected) {
        drawBox(renderer, rect.x, rect.y, rect.w, rect.h, ctx.palette.colors[0], ctx.palette.colors[3], 0.9, 1);
        renderer.drawSpriteHex('arrow_spr', 0, rect.x + 8, rect.y + Math.floor(rect.h * 0.5), ctx.palette.colors[3], 1);
      }
      renderer.drawTextHex(
        this.pauseItems[i].label,
        centerX,
        rect.y + Math.floor((rect.h - 7) * 0.5),
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        1,
        '5x7',
        'center',
      );
    }
  }

  // ==========================================================================
  // 6. ENDGAME SCREEN (leaves central board + Impossible falling tetrad visible!)
  // ==========================================================================

  private readonly endgameItems = [
    { id: 'again', label: 'PLAY AGAIN' },
    { id: 'track', label: 'CHANGE TRACK' },
    { id: 'menu', label: 'BACK TO MENU' },
  ] as const;

  private getEndgameItemRect(index: number, portrait = false): HitRect {
    if (portrait) {
      return { x: 96, y: 244 + index * 20, w: 74, h: 16 };
    }
    return { x: 204, y: 74 + index * 18, w: 106, h: 15 };
  }

  private updateEndgame(
    input: UiInputState,
    ctx: MenuScreenContext,
    cb: MenuScreenCallbacks,
  ): void {
    const count = this.endgameItems.length;
    const portrait = Boolean(ctx.isPortraitGameplay);
    if (input.cancel) {
      cb.onPlayMenuBack();
      cb.onEndRunToTitle();
      return;
    }

    if (input.up) {
      this.endgameIdx = (this.endgameIdx - 1 + count) % count;
      cb.onPlayMenuMove();
    } else if (input.down) {
      this.endgameIdx = (this.endgameIdx + 1) % count;
      cb.onPlayMenuMove();
    }

    if (input.mouseInBounds) {
      for (let i = 0; i < count; i++) {
        if (hitTest(input.mouseX, input.mouseY, this.getEndgameItemRect(i, portrait))) {
          if (input.mouseMoved && this.endgameIdx !== i) {
            this.endgameIdx = i;
            cb.onPlayMenuMove();
          }
          if (input.mouseClicked) {
            this.endgameIdx = i;
            this.activateEndgameItem(this.endgameItems[i].id, ctx, cb);
            return;
          }
        }
      }
    }

    if (input.confirm) {
      this.activateEndgameItem(this.endgameItems[this.endgameIdx].id, ctx, cb);
    }
  }

  private activateEndgameItem(id: string, ctx: MenuScreenContext, cb: MenuScreenCallbacks): void {
    switch (id) {
      case 'again':
        cb.onPlayMenuSelect();
        cb.onStartRun(ctx.selectedMode, ctx.selectedTrack);
        break;
      case 'track':
        cb.onPlayMenuSelect();
        cb.onNavigate('TRACK_SELECT');
        break;
      case 'menu':
        cb.onPlayMenuBack();
        cb.onEndRunToTitle();
        break;
    }
  }

  private renderEndgame(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    if (ctx.isPortraitGameplay) {
      this.renderPortraitEndgame(renderer, ctx);
      return;
    }
    const sim = ctx.simState;
    const outcome = ctx.lastRunOutcome;
    const isVictory = sim?.phase === 'VICTORY';

    // Subtle veil keeping the central 68x128 diamond container & Impossible tetrad clearly visible!
    renderer.drawRectHex(0, 0, 122, LOGICAL_HEIGHT, ctx.palette.colors[0], 0.72);
    renderer.drawRectHex(198, 0, 122, LOGICAL_HEIGHT, ctx.palette.colors[0], 0.72);
    renderer.drawRectHex(122, 0, 76, 22, ctx.palette.colors[0], 0.72);
    renderer.drawRectHex(122, 158, 76, 22, ctx.palette.colors[0], 0.72);

    // Top banner
    const heading = isVictory ? 'FINISH!' : 'GAME OVER';
    const headColor = isVictory ? ctx.palette.colors[3] : ctx.palette.colors[5];
    drawBox(renderer, 96, 4, 128, 16, ctx.palette.colors[1], headColor, 0.94, 1);
    renderer.drawTextHex(heading, 160, 8, headColor, 1, '5x7', 'center');

    // Left results summary panel (x = 8..118)
    const lx = 8;
    const ly = 28;
    const lw = 110;
    const lh = 128;
    drawBox(renderer, lx, ly, lw, lh, ctx.palette.colors[1], ctx.palette.colors[2], 0.94, 0.85);

    const score = sim?.score ?? 0;
    const cleared = sim?.cleared ?? 0;
    const maxCombo = sim?.maxCombo ?? 0;
    const perfects = sim?.perfectClears ?? 0;
    const elapsedMs = outcome?.elapsedMs ?? Math.round((sim?.elapsedTicks ?? 0) * SIM_DT_MS);

    renderer.drawTextHex('FINAL SCORE', lx + 6, ly + 7, ctx.palette.colors[2], 0.78, '3x5', 'left');
    if (outcome?.isNewHighScore) {
      renderer.drawTextHex('NEW BEST!', lx + lw - 6, ly + 7, ctx.palette.colors[3], 1, '3x5', 'right');
    }
    renderer.drawTextHex(
      score.toLocaleString('en-US'),
      lx + 6,
      ly + 15,
      outcome?.isNewHighScore ? ctx.palette.colors[3] : ctx.palette.colors[2],
      1,
      '5x7',
      'left',
    );

    renderer.drawRectHex(lx + 6, ly + 27, lw - 12, 1, ctx.palette.colors[2], 0.25);

    const rows: [string, string][] = [
      ['CLEARED', String(cleared)],
      ['TIME', formatHudTime(elapsedMs, ctx.settings.gameplay.preciseTimer)],
      ['MAX COMBO', maxCombo > 0 ? `x${maxCombo}` : '--'],
      ['PERFECTS', String(perfects)],
      ['LEVEL', String(sim?.level ?? 0)],
    ];

    for (let i = 0; i < rows.length; i++) {
      const ry = ly + 34 + i * 15;
      renderer.drawTextHex(rows[i][0], lx + 6, ry, ctx.palette.colors[2], 0.78, '3x5', 'left');
      renderer.drawTextHex(rows[i][1], lx + lw - 6, ry - 1, ctx.palette.colors[3], 1, '5x7', 'right');
    }

    if (outcome?.impossibleNewlyUnlocked) {
      drawBox(renderer, lx + 4, ly + lh - 17, lw - 8, 12, ctx.palette.colors[0], ctx.palette.colors[5], 0.95, 1);
      renderer.drawTextHex('IMPOSSIBLE UNLOCKED!', lx + lw * 0.5, ly + lh - 13, ctx.palette.colors[5], 1, '3x5', 'center');
    } else if (outcome?.fastestTimeBeaten) {
      renderer.drawTextHex('NEW FASTEST TIME!', lx + lw * 0.5, ly + lh - 12, ctx.palette.colors[3], 1, '3x5', 'center');
    }

    // Right actions panel (x = 200..314)
    const rx = 200;
    const ry = 28;
    const rw = 114;
    const rh = 128;
    drawBox(renderer, rx, ry, rw, rh, ctx.palette.colors[1], ctx.palette.colors[2], 0.94, 0.85);

    const modeName = GAME_MODE_CONFIGS[ctx.selectedMode].name.toUpperCase();
    const trackTitle = getTrackMeta(ctx.selectedTrack).title.toUpperCase();
    renderer.drawTextHex(modeName, rx + rw * 0.5, ry + 10, ctx.palette.colors[3], 1, '5x7', 'center');
    renderer.drawTextHex(trackTitle, rx + rw * 0.5, ry + 22, ctx.palette.colors[2], 0.82, '3x5', 'center');
    renderer.drawRectHex(rx + 8, ry + 34, rw - 16, 1, ctx.palette.colors[2], 0.25);

    for (let i = 0; i < this.endgameItems.length; i++) {
      const rect = this.getEndgameItemRect(i);
      const selected = i === this.endgameIdx;
      drawBox(
        renderer,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        ctx.palette.colors[0],
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        selected ? 0.95 : 0.45,
        selected ? 1 : 0.4,
      );
      if (selected) {
        renderer.drawSpriteHex('arrow_spr', 0, rect.x + 6, rect.y + 7, ctx.palette.colors[3], 1);
      }
      renderer.drawTextHex(
        this.endgameItems[i].label,
        rect.x + rect.w * 0.5 + 3,
        rect.y + 4,
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        1,
        '5x7',
        'center',
      );
    }
  }

  private renderPortraitEndgame(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    const sim = ctx.simState;
    const outcome = ctx.lastRunOutcome;
    const isVictory = sim?.phase === 'VICTORY';

    // Keep central 68x128 diamond board at (56, 54) 100% visible!
    renderer.drawRectHex(0, 0, PORTRAIT_LOGICAL_WIDTH, 50, ctx.palette.colors[0], 0.76);
    renderer.drawRectHex(0, 186, PORTRAIT_LOGICAL_WIDTH, PORTRAIT_LOGICAL_HEIGHT - 186, ctx.palette.colors[0], 0.78);
    renderer.drawRectHex(0, 50, 52, 136, ctx.palette.colors[0], 0.58);
    renderer.drawRectHex(128, 50, 52, 136, ctx.palette.colors[0], 0.58);

    const heading = isVictory ? 'FINISH!' : 'GAME OVER';
    const headColor = isVictory ? ctx.palette.colors[3] : ctx.palette.colors[5];
    drawBox(renderer, 26, 6, 128, 16, ctx.palette.colors[1], headColor, 0.94, 1);
    renderer.drawTextHex(heading, 90, 10, headColor, 1, '5x7', 'center');

    const modeName = GAME_MODE_CONFIGS[ctx.selectedMode].name.toUpperCase();
    const trackTitle = getTrackMeta(ctx.selectedTrack).title.toUpperCase();
    renderer.drawTextHex(`${modeName} | ${trackTitle}`, 90, 27, ctx.palette.colors[2], 0.88, '3x5', 'center');

    // Lower results & actions card (y = 188..312)
    drawBox(renderer, 6, 188, 168, 124, ctx.palette.colors[1], ctx.palette.colors[2], 0.95, 0.9);

    const score = sim?.score ?? 0;
    const cleared = sim?.cleared ?? 0;
    const maxCombo = sim?.maxCombo ?? 0;
    const perfects = sim?.perfectClears ?? 0;
    const elapsedMs = outcome?.elapsedMs ?? Math.round((sim?.elapsedTicks ?? 0) * SIM_DT_MS);

    renderer.drawTextHex('FINAL SCORE', 12, 194, ctx.palette.colors[2], 0.78, '3x5', 'left');
    if (outcome?.isNewHighScore) {
      renderer.drawTextHex('NEW BEST!', 168, 194, ctx.palette.colors[3], 1, '3x5', 'right');
    }
    renderer.drawTextHex(
      score.toLocaleString('en-US'),
      12,
      202,
      outcome?.isNewHighScore ? ctx.palette.colors[3] : ctx.palette.colors[2],
      1,
      '5x7',
      'left',
    );
    renderer.drawRectHex(12, 213, 156, 1, ctx.palette.colors[2], 0.25);

    const rows: [string, string][] = [
      ['CLEARED', String(cleared)],
      ['TIME', formatHudTime(elapsedMs, ctx.settings.gameplay.preciseTimer)],
      ['COMBO', maxCombo > 0 ? `x${maxCombo}` : '--'],
      ['PERFECTS', String(perfects)],
      ['LEVEL', String(sim?.level ?? 0)],
    ];
    for (let i = 0; i < rows.length; i++) {
      const ry = 220 + i * 14;
      renderer.drawTextHex(rows[i][0], 12, ry, ctx.palette.colors[2], 0.78, '3x5', 'left');
      renderer.drawTextHex(rows[i][1], 88, ry, ctx.palette.colors[3], 1, '3x5', 'right');
    }

    if (outcome?.impossibleNewlyUnlocked) {
      renderer.drawTextHex('IMPOSSIBLE UNLOCKED!', 90, 299, ctx.palette.colors[5], 1, '3x5', 'center');
    } else if (outcome?.fastestTimeBeaten) {
      renderer.drawTextHex('NEW FASTEST TIME!', 90, 299, ctx.palette.colors[3], 1, '3x5', 'center');
    }

    const shortLabels = ['PLAY AGAIN', 'TRACKS', 'MAIN MENU'] as const;
    for (let i = 0; i < this.endgameItems.length; i++) {
      const rect = this.getEndgameItemRect(i, true);
      const selected = i === this.endgameIdx;
      drawBox(
        renderer,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        ctx.palette.colors[0],
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        selected ? 0.95 : 0.48,
        selected ? 1 : 0.45,
      );
      renderer.drawTextHex(
        shortLabels[i],
        rect.x + rect.w * 0.5,
        rect.y + 5,
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        1,
        '3x5',
        'center',
      );
    }
  }

  // ==========================================================================
  // 7. TABBED PIXEL SETTINGS (COLORS, GAMEPLAY, EFFECTS, CONTROLS, DISPLAY, AUDIO)
  // ==========================================================================

  private getTabRect(index: number): HitRect {
    return { x: 8 + index * 51, y: 20, w: 49, h: 12 };
  }

  private openControlsRemap(tab: ControlsDeviceTab, ctx: MenuScreenContext): void {
    this.controlsRemap.onEnter(ctx.settings);
    this.controlsRemap.setActiveTab(tab);
    this.controlsRemapOpen = true;
  }

  private buildSettingsRows(
    tab: SettingsTabId,
    ctx: MenuScreenContext,
    cb: MenuScreenCallbacks,
  ): SettingRowDef[] {
    const { render, gameplay, audio } = ctx.settings;

    switch (tab) {
      case 'GAMEPLAY':
        return [
          {
            id: 'dropPreviewOpacity',
            label: 'DROP PREVIEW',
            valueText: `${Math.round(gameplay.dropPreviewOpacity * 100)}%`,
            desc: t('settings.dropPreviewOpacity.desc'),
            kind: 'slider',
            sliderRatio: gameplay.dropPreviewOpacity,
            adjust: (dir) => {
              const next = Math.max(0, Math.min(1, Math.round((gameplay.dropPreviewOpacity + dir * 0.1) * 10) / 10));
              cb.onUpdateSettings({ gameplay: { dropPreviewOpacity: next } });
            },
            activate: () => {
              const next = gameplay.dropPreviewOpacity >= 0.95 ? 0 : Math.min(1, Math.round((gameplay.dropPreviewOpacity + 0.25) * 100) / 100);
              cb.onUpdateSettings({ gameplay: { dropPreviewOpacity: next } });
            },
            setRatio: (r) => cb.onUpdateSettings({ gameplay: { dropPreviewOpacity: Math.round(r * 10) / 10 } }),
          },
          {
            id: 'nextBlockLocation',
            label: 'NEXT BLOCK',
            valueText: NEXT_LOC_LABELS[gameplay.nextBlockLocation],
            desc: t('settings.nextBlockLocation.desc'),
            kind: 'cycle',
            adjust: (dir) => {
              const idx = NEXT_BLOCK_LOCATIONS.indexOf(gameplay.nextBlockLocation);
              const next = NEXT_BLOCK_LOCATIONS[(idx + dir + NEXT_BLOCK_LOCATIONS.length) % NEXT_BLOCK_LOCATIONS.length];
              cb.onUpdateSettings({ gameplay: { nextBlockLocation: next } });
            },
            activate: () => {
              const idx = NEXT_BLOCK_LOCATIONS.indexOf(gameplay.nextBlockLocation);
              const next = NEXT_BLOCK_LOCATIONS[(idx + 1) % NEXT_BLOCK_LOCATIONS.length];
              cb.onUpdateSettings({ gameplay: { nextBlockLocation: next } });
            },
          },
          {
            id: 'preciseTimer',
            label: 'PRECISE TIMER',
            valueText: gameplay.preciseTimer ? 'ON' : 'OFF',
            desc: t('settings.preciseTimer.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ gameplay: { preciseTimer: !gameplay.preciseTimer } }),
            activate: () => cb.onUpdateSettings({ gameplay: { preciseTimer: !gameplay.preciseTimer } }),
          },
          {
            id: 'tutorialEnabled',
            label: 'TUTORIAL',
            valueText: gameplay.tutorialEnabled ? 'ON' : 'OFF',
            desc: t('settings.tutorialEnabled.desc'),
            kind: 'toggle',
            adjust: () => {
              const next = !gameplay.tutorialEnabled;
              cb.onUpdateSettings({ gameplay: { tutorialEnabled: next } });
              if (next) cb.onResetTutorialCompleted();
            },
            activate: () => {
              const next = !gameplay.tutorialEnabled;
              cb.onUpdateSettings({ gameplay: { tutorialEnabled: next } });
              if (next) cb.onResetTutorialCompleted();
            },
          },
          {
            id: 'soundtestEnabled',
            label: 'SOUNDTEST HUD',
            valueText: gameplay.soundtestEnabled ? 'ON' : 'OFF',
            desc: t('settings.soundtestEnabled.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ gameplay: { soundtestEnabled: !gameplay.soundtestEnabled } }),
            activate: () => cb.onUpdateSettings({ gameplay: { soundtestEnabled: !gameplay.soundtestEnabled } }),
          },
        ];

      case 'CONTROLS':
        return [
          {
            id: 'moveSpeedIndex',
            label: 'MOVE SPEED',
            valueText: `${ARR_MOVE_SPEED_NAMES[gameplay.moveSpeedIndex].toUpperCase()} (${ARR_MOVE_SPEED_TICKS[gameplay.moveSpeedIndex]}T)`,
            desc: t('settings.moveSpeed.desc'),
            kind: 'cycle',
            adjust: (dir) => {
              const len = ARR_MOVE_SPEED_NAMES.length;
              const next = (gameplay.moveSpeedIndex + dir + len) % len;
              cb.onUpdateSettings({ gameplay: { moveSpeedIndex: next } });
            },
            activate: () => {
              const next = (gameplay.moveSpeedIndex + 1) % ARR_MOVE_SPEED_NAMES.length;
              cb.onUpdateSettings({ gameplay: { moveSpeedIndex: next } });
            },
          },
          {
            id: 'kbMoveDelay',
            label: 'KB MOVE DELAY',
            valueText: `${gameplay.kbMoveDelay} TICKS`,
            desc: t('settings.kbMoveDelay.desc'),
            kind: 'slider',
            sliderRatio: gameplay.kbMoveDelay / 15,
            adjust: (dir) => {
              const next = Math.max(0, Math.min(15, gameplay.kbMoveDelay + dir));
              cb.onUpdateSettings({ gameplay: { kbMoveDelay: next } });
            },
            activate: () => {
              const next = (gameplay.kbMoveDelay + 1) % 16;
              cb.onUpdateSettings({ gameplay: { kbMoveDelay: next } });
            },
            setRatio: (r) => cb.onUpdateSettings({ gameplay: { kbMoveDelay: Math.round(r * 15) } }),
          },
          {
            id: 'gpMoveDelay',
            label: 'GP MOVE DELAY',
            valueText: `${gameplay.gpMoveDelay} TICKS`,
            desc: t('settings.gpMoveDelay.desc'),
            kind: 'slider',
            sliderRatio: gameplay.gpMoveDelay / 15,
            adjust: (dir) => {
              const next = Math.max(0, Math.min(15, gameplay.gpMoveDelay + dir));
              cb.onUpdateSettings({ gameplay: { gpMoveDelay: next } });
            },
            activate: () => {
              const next = (gameplay.gpMoveDelay + 1) % 16;
              cb.onUpdateSettings({ gameplay: { gpMoveDelay: next } });
            },
            setRatio: (r) => cb.onUpdateSettings({ gameplay: { gpMoveDelay: Math.round(r * 15) } }),
          },
          {
            id: 'gamepadRumble',
            label: 'CONTROLLER RUMBLE',
            valueText: gameplay.gamepadRumble ? 'ON' : 'OFF',
            desc: t('settings.gamepadRumble.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ gameplay: { gamepadRumble: !gameplay.gamepadRumble } }),
            activate: () => cb.onUpdateSettings({ gameplay: { gamepadRumble: !gameplay.gamepadRumble } }),
          },
          {
            id: 'touchControlsMode',
            label: 'TOUCH CONTROLS',
            valueText: (gameplay.touchControlsMode ?? 'auto').toUpperCase(),
            desc: t('settings.touchControlsMode.desc'),
            kind: 'cycle',
            adjust: (dir) => {
              const cur = gameplay.touchControlsMode ?? 'auto';
              const idx = TOUCH_CONTROLS_MODES.indexOf(cur);
              const next: TouchControlsMode =
                TOUCH_CONTROLS_MODES[(idx + dir + TOUCH_CONTROLS_MODES.length) % TOUCH_CONTROLS_MODES.length];
              cb.onUpdateSettings({ gameplay: { touchControlsMode: next } });
            },
            activate: () => {
              const cur = gameplay.touchControlsMode ?? 'auto';
              const idx = TOUCH_CONTROLS_MODES.indexOf(cur);
              const next: TouchControlsMode = TOUCH_CONTROLS_MODES[(idx + 1) % TOUCH_CONTROLS_MODES.length];
              cb.onUpdateSettings({ gameplay: { touchControlsMode: next } });
            },
          },
          {
            id: 'touchOpacity',
            label: 'TOUCH OPACITY',
            valueText: `${Math.round((gameplay.touchOpacity ?? DEFAULT_TOUCH_OPACITY) * 100)}%`,
            desc: t('settings.touchOpacity.desc'),
            kind: 'slider',
            sliderRatio: ((gameplay.touchOpacity ?? DEFAULT_TOUCH_OPACITY) - 0.25) / 0.7,
            adjust: (dir) => {
              const cur = gameplay.touchOpacity ?? DEFAULT_TOUCH_OPACITY;
              const next = Math.max(0.25, Math.min(0.95, Math.round((cur + dir * 0.05) * 20) / 20));
              cb.onUpdateSettings({ gameplay: { touchOpacity: next } });
            },
            activate: () => {
              const cur = gameplay.touchOpacity ?? DEFAULT_TOUCH_OPACITY;
              const next = cur >= 0.9 ? 0.35 : Math.min(0.95, Math.round((cur + 0.15) * 20) / 20);
              cb.onUpdateSettings({ gameplay: { touchOpacity: next } });
            },
            setRatio: (r) => {
              const next = Math.max(0.25, Math.min(0.95, Math.round((0.25 + r * 0.7) * 20) / 20));
              cb.onUpdateSettings({ gameplay: { touchOpacity: next } });
            },
          },
          {
            id: 'mapKeyboard',
            label: 'MAP KEYBOARD',
            valueText: 'REMAP >',
            desc: 'Customize keyboard gameplay and menu keys with live capture & conflict check.',
            kind: 'action',
            activate: () => this.openControlsRemap('KEYBOARD', ctx),
          },
          {
            id: 'mapController',
            label: 'MAP CONTROLLER',
            valueText: 'REMAP >',
            desc: 'Customize controller buttons with live capture & conflict check.',
            kind: 'action',
            activate: () => this.openControlsRemap('CONTROLLER', ctx),
          },
        ];

      case 'EFFECTS':
        return [
          {
            id: 'bloomAmount',
            label: 'BLOOM',
            valueText: `${Math.round(render.bloomAmount * 100)}%`,
            desc: t('settings.bloomAmount.desc'),
            kind: 'slider',
            sliderRatio: render.bloomAmount,
            adjust: (dir) => {
              const next = Math.max(0, Math.min(1, Math.round((render.bloomAmount + dir * 0.1) * 10) / 10));
              cb.onUpdateSettings({ render: { bloomAmount: next } });
            },
            activate: () => {
              const next = render.bloomAmount >= 0.95 ? 0 : Math.min(1, Math.round((render.bloomAmount + 0.25) * 100) / 100);
              cb.onUpdateSettings({ render: { bloomAmount: next } });
            },
            setRatio: (r) => cb.onUpdateSettings({ render: { bloomAmount: Math.round(r * 10) / 10 } }),
          },
          {
            id: 'boardShake',
            label: 'BOARD SHAKE',
            valueText: render.boardShake ? 'ON' : 'OFF',
            desc: t('settings.boardShake.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { boardShake: !render.boardShake } }),
            activate: () => cb.onUpdateSettings({ render: { boardShake: !render.boardShake } }),
          },
          {
            id: 'boardRipple',
            label: 'BOARD RIPPLE',
            valueText: render.boardRipple ? 'ON' : 'OFF',
            desc: t('settings.boardRipple.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { boardRipple: !render.boardRipple } }),
            activate: () => cb.onUpdateSettings({ render: { boardRipple: !render.boardRipple } }),
          },
          {
            id: 'particles',
            label: 'PARTICLES',
            valueText: render.particles ? 'ON' : 'OFF',
            desc: t('settings.particles.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { particles: !render.particles } }),
            activate: () => cb.onUpdateSettings({ render: { particles: !render.particles } }),
          },
          {
            id: 'flashing',
            label: 'FLASHING',
            valueText: render.flashing ? 'ON' : 'OFF',
            desc: t('settings.flashing.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { flashing: !render.flashing } }),
            activate: () => cb.onUpdateSettings({ render: { flashing: !render.flashing } }),
          },
          {
            id: 'bgShapes',
            label: 'BG SHAPES',
            valueText: render.bgShapes ? 'ON' : 'OFF',
            desc: t('settings.bgShapes.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { bgShapes: !render.bgShapes } }),
            activate: () => cb.onUpdateSettings({ render: { bgShapes: !render.bgShapes } }),
          },
          {
            id: 'boardColors',
            label: 'BOARD COLORS',
            valueText: render.boardColors ? 'ON' : 'OFF',
            desc: t('settings.boardColors.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { boardColors: !render.boardColors } }),
            activate: () => cb.onUpdateSettings({ render: { boardColors: !render.boardColors } }),
          },
        ];

      case 'DISPLAY':
        return [
          {
            id: 'targetFps',
            label: 'TARGET FPS',
            valueText: `${render.targetFps} FPS`,
            desc: t('settings.targetFps.desc'),
            kind: 'cycle',
            adjust: (dir) => {
              const idx = TARGET_FPS_OPTIONS.indexOf(render.targetFps);
              const next: TargetFps =
                TARGET_FPS_OPTIONS[(idx + dir + TARGET_FPS_OPTIONS.length) % TARGET_FPS_OPTIONS.length];
              cb.onUpdateSettings({ render: { targetFps: next } });
            },
            activate: () => {
              const idx = TARGET_FPS_OPTIONS.indexOf(render.targetFps);
              const next: TargetFps = TARGET_FPS_OPTIONS[(idx + 1) % TARGET_FPS_OPTIONS.length];
              cb.onUpdateSettings({ render: { targetFps: next } });
            },
          },
          {
            id: 'native60Snap',
            label: 'NATIVE 60HZ SNAP',
            valueText: render.native60Snap ? 'ON' : 'OFF',
            desc: t('settings.native60Snap.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { native60Snap: !render.native60Snap } }),
            activate: () => cb.onUpdateSettings({ render: { native60Snap: !render.native60Snap } }),
          },
          {
            id: 'boardZoom',
            label: 'BOARD ZOOM',
            valueText: render.boardZoom ? 'ON' : 'OFF',
            desc: t('settings.boardZoom.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { boardZoom: !render.boardZoom } }),
            activate: () => cb.onUpdateSettings({ render: { boardZoom: !render.boardZoom } }),
          },
          {
            id: 'portraitMode',
            label: 'PORTRAIT MODE',
            valueText: (render.portraitMode ?? 'auto').toUpperCase(),
            desc: t('settings.portraitMode.desc'),
            kind: 'cycle',
            adjust: (dir) => {
              const cur = render.portraitMode ?? 'auto';
              const idx = PORTRAIT_MODES.indexOf(cur);
              const next: PortraitMode =
                PORTRAIT_MODES[(idx + dir + PORTRAIT_MODES.length) % PORTRAIT_MODES.length];
              cb.onUpdateSettings({ render: { portraitMode: next } });
            },
            activate: () => {
              const cur = render.portraitMode ?? 'auto';
              const idx = PORTRAIT_MODES.indexOf(cur);
              const next: PortraitMode = PORTRAIT_MODES[(idx + 1) % PORTRAIT_MODES.length];
              cb.onUpdateSettings({ render: { portraitMode: next } });
            },
          },
          {
            id: 'tateRotate',
            label: 'TATE 90 ROTATE',
            valueText: render.tateRotate ? 'ON' : 'OFF',
            desc: t('settings.tateRotate.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ render: { tateRotate: !render.tateRotate } }),
            activate: () => cb.onUpdateSettings({ render: { tateRotate: !render.tateRotate } }),
          },
          {
            id: 'assetPack',
            label: 'ASSET PACK',
            valueText: ctx.packMode === 'custom' ? 'CUSTOM' : 'BUILT-IN',
            desc: ctx.customPackAvailable
              ? 'Switch live between Built-In procedural art and your loaded Custom Pack.'
              : 'Built-In Krunked pixel-diamond art & harmonic synths active.',
            kind: 'action',
            adjust: () => this.handlePackRowAction(ctx, cb),
            activate: () => this.handlePackRowAction(ctx, cb),
          },
        ];

      case 'AUDIO':
        return [
          {
            id: 'masterVolume',
            label: 'MASTER VOLUME',
            valueText: `${Math.round(audio.masterVolume * 100)}%`,
            desc: t('settings.masterVolume.desc'),
            kind: 'slider',
            sliderRatio: audio.masterVolume,
            adjust: (dir) => {
              const next = Math.max(0, Math.min(1, Math.round((audio.masterVolume + dir * 0.05) * 20) / 20));
              cb.onUpdateSettings({ audio: { masterVolume: next } });
            },
            activate: () => {
              const next = audio.masterVolume >= 0.95 ? 0 : Math.min(1, Math.round((audio.masterVolume + 0.2) * 20) / 20);
              cb.onUpdateSettings({ audio: { masterVolume: next } });
            },
            setRatio: (r) => cb.onUpdateSettings({ audio: { masterVolume: Math.round(r * 20) / 20 } }),
          },
          {
            id: 'muted',
            label: 'MUTE AUDIO',
            valueText: audio.muted ? 'MUTED' : 'ACTIVE',
            desc: t('settings.muted.desc'),
            kind: 'toggle',
            adjust: () => cb.onUpdateSettings({ audio: { muted: !audio.muted } }),
            activate: () => cb.onUpdateSettings({ audio: { muted: !audio.muted } }),
          },
          {
            id: 'testAudio',
            label: 'TEST HARMONIC CUE',
            valueText: 'PLAY',
            desc: 'Audition a pentatonic chime at the current master volume.',
            kind: 'action',
            adjust: () => cb.onPlayMenuSelect(),
            activate: () => {},
          },
        ];

      case 'COLORS':
      default:
        return [];
    }
  }

  private updateSettings(
    dtSec: number,
    input: UiInputState,
    ctx: MenuScreenContext,
    cb: MenuScreenCallbacks,
    inputManager?: InputManager,
  ): void {
    if (this.controlsRemapOpen) {
      const mgr = inputManager ?? this.getFallbackInputManager();
      this.controlsRemap.update(dtSec, input, mgr, this.buildControlsRemapCallbacks(cb));
      return;
    }

    if (input.cancel) {
      cb.onPlayMenuBack();
      cb.onNavigate(ctx.settingsReturnScreen);
      return;
    }

    const tab = SETTINGS_TABS[this.settingsTabIdx];

    // Mouse clicks on Back button and Tab bar
    if (input.mouseInBounds && input.mouseClicked) {
      if (hitTest(input.mouseX, input.mouseY, BACK_BTN_RECT)) {
        cb.onPlayMenuBack();
        cb.onNavigate(ctx.settingsReturnScreen);
        return;
      }
      for (let i = 0; i < SETTINGS_TABS.length; i++) {
        if (hitTest(input.mouseX, input.mouseY, this.getTabRect(i))) {
          if (this.settingsTabIdx !== i) {
            this.settingsTabIdx = i;
            this.settingsRowIdx = 0;
            this.settingsScrollTop = 0;
            cb.onPlayMenuMove();
          } else if (this.settingsRowIdx < 0) {
            this.settingsRowIdx = 0;
          }
          return;
        }
      }
    }

    // Tab bar keyboard navigation when settingsRowIdx === -1
    if (this.settingsRowIdx === -1) {
      if (input.left) {
        this.settingsTabIdx = (this.settingsTabIdx - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
        this.settingsScrollTop = 0;
        cb.onPlayMenuMove();
        return;
      }
      if (input.right) {
        this.settingsTabIdx = (this.settingsTabIdx + 1) % SETTINGS_TABS.length;
        this.settingsScrollTop = 0;
        cb.onPlayMenuMove();
        return;
      }
      if (input.down || input.confirm) {
        this.settingsRowIdx = 0;
        cb.onPlayMenuMove();
        return;
      }
    }

    if (tab === 'COLORS') {
      this.updateColorsTab(input, ctx, cb);
      return;
    }

    const rows = this.buildSettingsRows(tab, ctx, cb);
    if (rows.length === 0) return;
    if (this.settingsRowIdx >= rows.length) {
      this.settingsRowIdx = rows.length - 1;
    }

    const maxVisible = 7;
    const maxScroll = Math.max(0, rows.length - maxVisible);

    // Clear active slider drag on release
    if (!input.mouseDown) {
      this.draggingSettingsRowId = null;
    }

    // Continuous slider drag (mouse & touch!)
    if (this.draggingSettingsRowId && input.mouseDown && input.mouseInBounds) {
      const draggedRow = rows.find((r) => r.id === this.draggingSettingsRowId);
      if (draggedRow && draggedRow.kind === 'slider' && draggedRow.setRatio) {
        const ratio = Math.max(0, Math.min(1, (input.mouseX - 176) / 82));
        draggedRow.setRatio(ratio);
        return;
      }
    }

    // Touch swipe & mouse wheel scrolling
    if (input.scrollDelta && Math.abs(input.scrollDelta) >= 8 && maxScroll > 0) {
      const steps = Math.sign(input.scrollDelta) * Math.max(1, Math.round(Math.abs(input.scrollDelta) / 16));
      this.settingsScrollTop = Math.max(0, Math.min(maxScroll, this.settingsScrollTop + steps));
    }

    if (input.up) {
      if (this.settingsRowIdx <= 0) {
        this.settingsRowIdx = -1;
      } else {
        this.settingsRowIdx -= 1;
        if (this.settingsRowIdx < this.settingsScrollTop) {
          this.settingsScrollTop = this.settingsRowIdx;
        }
      }
      cb.onPlayMenuMove();
    } else if (input.down) {
      this.settingsRowIdx = Math.min(rows.length - 1, this.settingsRowIdx + 1);
      if (this.settingsRowIdx >= this.settingsScrollTop + maxVisible) {
        this.settingsScrollTop = this.settingsRowIdx - maxVisible + 1;
      }
      cb.onPlayMenuMove();
    } else if (input.left && this.settingsRowIdx >= 0) {
      const row = rows[this.settingsRowIdx];
      if (row.adjust) {
        row.adjust(-1);
        cb.onPlayMenuMove();
      }
    } else if (input.right && this.settingsRowIdx >= 0) {
      const row = rows[this.settingsRowIdx];
      if (row.adjust) {
        row.adjust(1);
        cb.onPlayMenuMove();
      }
    } else if (input.confirm && this.settingsRowIdx >= 0) {
      rows[this.settingsRowIdx].activate();
      cb.onPlayMenuSelect();
    }

    // Mouse / Touch hover, slider drag, scrollbar & click on visible settings rows
    if (input.mouseInBounds) {
      if (maxScroll > 0 && (input.mouseClicked || input.mouseDown)) {
        const trackHit: HitRect = { x: 304, y: 34, w: 14, h: maxVisible * 16 + 8 };
        if (hitTest(input.mouseX, input.mouseY, trackHit)) {
          const frac = Math.max(0, Math.min(1, (input.mouseY - 38) / Math.max(1, maxVisible * 16 - 2)));
          this.settingsScrollTop = Math.round(frac * maxScroll);
          return;
        }
      }

      const visibleEnd = Math.min(rows.length, this.settingsScrollTop + maxVisible);
      for (let idx = this.settingsScrollTop; idx < visibleEnd; idx++) {
        const slot = idx - this.settingsScrollTop;
        const rowRect: HitRect = { x: 14, y: 38 + slot * 16, w: 292, h: 14 };
        if (hitTest(input.mouseX, input.mouseY, rowRect)) {
          const row = rows[idx];
          if (input.mouseMoved && this.settingsRowIdx !== idx) {
            this.settingsRowIdx = idx;
            cb.onPlayMenuMove();
          }
          // Immediate touch/mouse grab on slider rail enables smooth dragging
          if (
            row.kind === 'slider' &&
            row.setRatio &&
            input.mouseDown &&
            input.mouseX >= 172 &&
            input.mouseX <= 262
          ) {
            this.settingsRowIdx = idx;
            this.draggingSettingsRowId = row.id;
            const ratio = Math.max(0, Math.min(1, (input.mouseX - 176) / 82));
            row.setRatio(ratio);
            return;
          }
          if (input.mouseClicked) {
            this.settingsRowIdx = idx;
            if (row.kind === 'slider' && row.setRatio && input.mouseX >= 172 && input.mouseX <= 262) {
              this.draggingSettingsRowId = row.id;
              const ratio = Math.max(0, Math.min(1, (input.mouseX - 176) / 82));
              row.setRatio(ratio);
              cb.onPlayMenuMove();
            } else if (row.adjust && input.mouseX >= 176 && input.mouseX < 210 && row.kind !== 'toggle' && row.kind !== 'action') {
              row.adjust(-1);
              cb.onPlayMenuMove();
            } else if (row.adjust && input.mouseX > 272 && row.kind !== 'toggle' && row.kind !== 'action') {
              row.adjust(1);
              cb.onPlayMenuMove();
            } else {
              row.activate();
              cb.onPlayMenuSelect();
            }
            return;
          }
        }
      }
    }
  }

  private updateColorsTab(
    input: UiInputState,
    ctx: MenuScreenContext,
    cb: MenuScreenCallbacks,
  ): void {
    const palettes = ctx.allPalettes;
    if (palettes.length === 0) return;
    if (this.settingsRowIdx > 1) this.settingsRowIdx = 1;
    const curIdx = Math.max(0, palettes.findIndex((p) => p.id === ctx.palette.id));

    const selectIdx = (nextIdx: number): void => {
      const wrapped = ((nextIdx % palettes.length) + palettes.length) % palettes.length;
      cb.onUpdateSettings({ paletteId: palettes[wrapped].id });
      cb.onPlayMenuMove();
    };

    if (input.up) {
      if (this.settingsRowIdx === 1) {
        this.settingsRowIdx = 0;
      } else {
        this.settingsRowIdx = -1;
      }
      cb.onPlayMenuMove();
      return;
    }
    if (input.down) {
      if (this.settingsRowIdx === 0) {
        this.settingsRowIdx = 1;
        cb.onPlayMenuMove();
      }
      return;
    }
    if (this.settingsRowIdx === 0) {
      if (input.left) {
        selectIdx(curIdx - 1);
        return;
      }
      if (input.right) {
        selectIdx(curIdx + 1);
        return;
      }
      if (input.confirm) {
        selectIdx(curIdx + 1);
        return;
      }
    } else if (this.settingsRowIdx === 1 && input.confirm) {
      cb.onPlayMenuSelect();
      cb.onNavigate('COLOR_EDITOR');
      return;
    }

    // Mouse controls inside COLORS tab: Prev/Next arrows, 9-palette visual ribbon, OPEN COLOR EDITOR button
    if (input.mouseInBounds) {
      if (hitTest(input.mouseX, input.mouseY, COLORS_EDITOR_BTN_RECT)) {
        if (input.mouseMoved && this.settingsRowIdx !== 1) {
          this.settingsRowIdx = 1;
          cb.onPlayMenuMove();
        }
        if (input.mouseClicked) {
          this.settingsRowIdx = 1;
          cb.onPlayMenuSelect();
          cb.onNavigate('COLOR_EDITOR');
          return;
        }
      }

      if (input.mouseClicked) {
        const prevBtn: HitRect = { x: 14, y: 37, w: 20, h: 15 };
        const nextBtn: HitRect = { x: 286, y: 37, w: 20, h: 15 };
        if (hitTest(input.mouseX, input.mouseY, prevBtn)) {
          this.settingsRowIdx = 0;
          selectIdx(curIdx - 1);
          return;
        }
        if (hitTest(input.mouseX, input.mouseY, nextBtn)) {
          this.settingsRowIdx = 0;
          selectIdx(curIdx + 1);
          return;
        }

        // Clickable 9-item quick palette ribbon around current index (y = 102..123)
        const stripStart = Math.max(0, Math.min(Math.max(0, palettes.length - 9), curIdx - 4));
        const stripCount = Math.min(9, palettes.length);
        for (let i = 0; i < stripCount; i++) {
          const pillRect: HitRect = { x: 14 + i * 33, y: 102, w: 30, h: 21 };
          if (hitTest(input.mouseX, input.mouseY, pillRect)) {
            this.settingsRowIdx = 0;
            selectIdx(stripStart + i);
            return;
          }
        }
      }
    }
  }

  private renderSettings(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    if (this.controlsRemapOpen) {
      this.controlsRemap.render(renderer, ctx.palette);
      return;
    }

    this.renderAmbientMenuBg(renderer, ctx, 2);
    this.renderBackButton(renderer, ctx);

    renderer.drawTextHex('SETTINGS', 160, 8, ctx.palette.colors[3], 1, '5x7', 'center');

    // Tab bar
    for (let i = 0; i < SETTINGS_TABS.length; i++) {
      const rect = this.getTabRect(i);
      const active = i === this.settingsTabIdx;
      const tabFocused = active && this.settingsRowIdx === -1;

      drawBox(
        renderer,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        ctx.palette.colors[1],
        tabFocused ? ctx.palette.colors[3] : active ? ctx.palette.colors[3] : ctx.palette.colors[2],
        active ? 0.96 : 0.4,
        tabFocused ? 1 : active ? 0.9 : 0.35,
      );
      renderer.drawTextHex(
        SETTINGS_TABS[i],
        rect.x + rect.w * 0.5,
        rect.y + 4,
        active ? ctx.palette.colors[3] : ctx.palette.colors[2],
        active ? 1 : 0.78,
        '3x5',
        'center',
      );
    }

    const tab = SETTINGS_TABS[this.settingsTabIdx];
    if (tab === 'COLORS') {
      this.renderColorsTab(renderer, ctx);
      return;
    }

    const rows = this.buildSettingsRows(tab, ctx, NOOP_MENU_CALLBACKS);

    const maxVisible = 7;
    const visibleEnd = Math.min(rows.length, this.settingsScrollTop + maxVisible);

    for (let idx = this.settingsScrollTop; idx < visibleEnd; idx++) {
      const row = rows[idx];
      const slot = idx - this.settingsScrollTop;
      const y = 38 + slot * 16;
      const selected = idx === this.settingsRowIdx;

      drawBox(
        renderer,
        14,
        y,
        292,
        14,
        ctx.palette.colors[1],
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        selected ? 0.92 : 0.38,
        selected ? 1 : 0.25,
      );

      if (selected) {
        renderer.drawSpriteHex('arrow_spr', 0, 20, y + 7, ctx.palette.colors[3], 1);
      }

      renderer.drawTextHex(
        row.label,
        28,
        y + 4,
        selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
        1,
        '5x7',
        'left',
      );

      if (row.kind === 'slider' && row.sliderRatio !== undefined) {
        // Crisp pixel slider rail (x = 176..258)
        renderer.drawRectHex(176, y + 6, 82, 2, ctx.palette.colors[0], 1);
        const fillW = Math.round(82 * Math.max(0, Math.min(1, row.sliderRatio)));
        if (fillW > 0) {
          renderer.drawRectHex(176, y + 6, fillW, 2, ctx.palette.colors[3], 1);
        }
        renderer.drawRectHex(176 + fillW - 1, y + 4, 3, 6, ctx.palette.colors[2], 1);
        renderer.drawTextHex(
          row.valueText,
          300,
          y + 5,
          selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
          1,
          '3x5',
          'right',
        );
      } else {
        const displayVal =
          row.kind === 'cycle' && selected ? `< ${row.valueText} >` : row.valueText;
        renderer.drawTextHex(
          displayVal,
          300,
          y + 4,
          selected ? ctx.palette.colors[3] : ctx.palette.colors[2],
          1,
          displayVal.length > 14 ? '3x5' : '5x7',
          'right',
        );
      }
    }

    // Scroll indicator + crisp pixel up/down cues if more than 7 rows
    if (rows.length > maxVisible) {
      const trackX = 309;
      const trackY = 44;
      const trackH = maxVisible * 16 - 14;
      renderer.drawSpriteHex(
        'arrow_spr',
        2,
        trackX + 1,
        39,
        this.settingsScrollTop > 0 ? ctx.palette.colors[3] : ctx.palette.colors[2],
        this.settingsScrollTop > 0 ? 1 : 0.35,
      );
      renderer.drawRectHex(trackX, trackY, 2, trackH, ctx.palette.colors[1], 0.9);
      const thumbH = Math.max(12, Math.round((maxVisible / rows.length) * trackH));
      const maxScroll = Math.max(1, rows.length - maxVisible);
      const thumbY = trackY + Math.round((this.settingsScrollTop / maxScroll) * (trackH - thumbH));
      renderer.drawRectHex(trackX, thumbY, 2, thumbH, ctx.palette.colors[3], 1);
      renderer.drawSpriteHex(
        'arrow_spr',
        3,
        trackX + 1,
        trackY + trackH + 5,
        this.settingsScrollTop < maxScroll ? ctx.palette.colors[3] : ctx.palette.colors[2],
        this.settingsScrollTop < maxScroll ? 1 : 0.35,
      );
    }

    // Description footer
    const activeRow = this.settingsRowIdx >= 0 ? rows[this.settingsRowIdx] : null;
    const desc = activeRow
      ? activeRow.desc.toUpperCase()
      : 'LEFT/RIGHT: SWITCH TAB   DOWN: EDIT OPTIONS';
    drawBox(renderer, 14, 154, 292, 20, ctx.palette.colors[1], ctx.palette.colors[2], 0.86, 0.45);
    const lines = wrapText(desc, 68);
    renderer.drawTextHex(lines[0] ?? '', 160, 158, ctx.palette.colors[2], 0.92, '3x5', 'center');
    if (lines[1]) {
      renderer.drawTextHex(lines[1], 160, 166, ctx.palette.colors[2], 0.8, '3x5', 'center');
    }
  }

  private renderColorsTab(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    const palettes = ctx.allPalettes;
    const curIdx = Math.max(0, palettes.findIndex((p) => p.id === ctx.palette.id));
    const active = ctx.palette;
    const light = isPaletteLight(active);
    const selectorFocused = this.settingsRowIdx === 0;
    const editorBtnFocused = this.settingsRowIdx === 1;

    // Palette Selector Header Bar (y = 37..52)
    const selBorder = selectorFocused ? ctx.palette.colors[3] : ctx.palette.colors[2];
    const selBorderAlpha = selectorFocused ? 1 : 0.55;
    drawBox(renderer, 14, 37, 20, 15, ctx.palette.colors[1], selBorder, 0.92, selBorderAlpha);
    renderer.drawSpriteHex('arrow_spr', 1, 24, 44, selBorder, 1);

    drawBox(renderer, 38, 37, 244, 15, ctx.palette.colors[1], selBorder, 0.94, selBorderAlpha);
    renderer.drawTextHex(
      `${String(curIdx + 1).padStart(2, '0')}/${palettes.length}  ${active.name.toUpperCase()}`,
      160,
      41,
      selectorFocused ? ctx.palette.colors[3] : ctx.palette.colors[2],
      1,
      '5x7',
      'center',
    );

    drawBox(renderer, 286, 37, 20, 15, ctx.palette.colors[1], selBorder, 0.92, selBorderAlpha);
    renderer.drawSpriteHex('arrow_spr', 0, 296, 44, selBorder, 1);

    // Light/Dark Bloom Indicator + Author/Origin Tag (y = 56)
    renderer.drawTextHex(
      light ? 'LIGHT INK BLOOM' : 'DARK LUMIA BLOOM',
      16,
      56,
      ctx.palette.colors[2],
      0.85,
      '3x5',
      'left',
    );
    const originText = active.isCustom
      ? 'CUSTOM PALETTE'
      : `BY ${(active.author ?? (active.id.startsWith('ini_') ? 'CUSTOM PACK' : 'KRUNKED')).toUpperCase()}`;
    renderer.drawTextHex(
      originText,
      304,
      56,
      ctx.palette.colors[2],
      0.75,
      '3x5',
      'right',
    );

    // 6 Color Swatches with Slot Names & Hex Codes (y = 64..98)
    for (let s = 0; s < 6; s++) {
      const sx = 14 + s * 49;
      const sy = 64;
      const sw = 46;
      const sh = 34;
      drawBox(renderer, sx, sy, sw, sh, ctx.palette.colors[1], ctx.palette.colors[2], 0.7, 0.55);
      // Color chip
      renderer.drawRectHex(sx + 3, sy + 3, sw - 6, 14, active.colors[s], 1);
      // Mini diamond icon on block slots 2..5
      if (s >= 2) {
        renderer.drawSpriteHex('block_spr', s - 2, sx + sw * 0.5, sy + 10, active.colors[0], 0.8);
      }
      renderer.drawTextHex(PALETTE_SLOT_NAMES[s], sx + sw * 0.5, sy + 19, ctx.palette.colors[2], 0.95, '3x5', 'center');
      renderer.drawTextHex(active.colors[s].toUpperCase(), sx + sw * 0.5, sy + 26, ctx.palette.colors[2], 0.72, '3x5', 'center');
    }

    // Clickable 9-palette visual swatch strip (y = 102..123)
    const stripStart = Math.max(0, Math.min(Math.max(0, palettes.length - 9), curIdx - 4));
    const stripCount = Math.min(9, palettes.length);
    for (let i = 0; i < stripCount; i++) {
      const pIdx = stripStart + i;
      const p = palettes[pIdx];
      const isCur = pIdx === curIdx;
      const px = 14 + i * 33;
      const py = 102;
      drawBox(
        renderer,
        px,
        py,
        30,
        21,
        p.colors[0],
        isCur ? ctx.palette.colors[3] : ctx.palette.colors[2],
        1,
        isCur ? 1 : 0.4,
      );
      // 6 mini stripes inside each preview chip
      for (let c = 0; c < 6; c++) {
        renderer.drawRectHex(px + 3 + c * 4, py + 3, 4, 8, p.colors[c], 1);
      }
      renderer.drawTextHex(
        String(pIdx + 1).padStart(2, '0'),
        px + 15,
        py + 13,
        isCur ? ctx.palette.colors[3] : p.colors[2],
        1,
        '3x5',
        'center',
      );
    }

    // Interactive OPEN COLOR EDITOR action row (y = 128..143)
    drawBox(
      renderer,
      COLORS_EDITOR_BTN_RECT.x,
      COLORS_EDITOR_BTN_RECT.y,
      COLORS_EDITOR_BTN_RECT.w,
      COLORS_EDITOR_BTN_RECT.h,
      ctx.palette.colors[1],
      editorBtnFocused ? ctx.palette.colors[3] : ctx.palette.colors[2],
      editorBtnFocused ? 0.96 : 0.74,
      editorBtnFocused ? 1 : 0.65,
    );
    if (editorBtnFocused) {
      renderer.drawSpriteHex(
        'arrow_spr',
        0,
        COLORS_EDITOR_BTN_RECT.x + 7,
        COLORS_EDITOR_BTN_RECT.y + 7,
        ctx.palette.colors[3],
        1,
      );
    }
    renderer.drawTextHex(
      'OPEN COLOR EDITOR',
      COLORS_EDITOR_BTN_RECT.x + 15,
      COLORS_EDITOR_BTN_RECT.y + 4,
      editorBtnFocused ? ctx.palette.colors[3] : ctx.palette.colors[2],
      1,
      '5x7',
      'left',
    );
    renderer.drawTextHex(
      'HSV / RGB / SHARE >',
      COLORS_EDITOR_BTN_RECT.x + COLORS_EDITOR_BTN_RECT.w - 6,
      COLORS_EDITOR_BTN_RECT.y + 5,
      editorBtnFocused ? ctx.palette.colors[3] : ctx.palette.colors[2],
      editorBtnFocused ? 1 : 0.8,
      '3x5',
      'right',
    );

    // Footer instruction bar (y = 148..171)
    drawBox(renderer, 14, 148, 292, 23, ctx.palette.colors[1], ctx.palette.colors[2], 0.86, 0.45);
    const hintText = editorBtnFocused
      ? 'ENTER / CLICK: LAUNCH INTERACTIVE HSV/RGB PALETTE EDITOR, SWAP, SHARE & IMPORT'
      : `LEFT/RIGHT OR CLICK SWATCH TO SWITCH ALL ${palettes.length} PALETTES   DOWN: COLOR EDITOR`;
    const hintLines = wrapText(hintText, 68);
    renderer.drawTextHex(hintLines[0] ?? '', 160, 153, ctx.palette.colors[2], 0.92, '3x5', 'center');
    if (hintLines[1]) {
      renderer.drawTextHex(hintLines[1], 160, 161, ctx.palette.colors[2], 0.8, '3x5', 'center');
    }
  }

  // ==========================================================================
  // 8. SCORES + STATS SCREEN (Real Saved Profile Telemetry)
  // ==========================================================================

  private updateSimpleBackScreen(
    input: UiInputState,
    cb: MenuScreenCallbacks,
    target: AppScreen,
  ): void {
    if (input.cancel || input.confirm) {
      cb.onPlayMenuBack();
      cb.onNavigate(target);
      return;
    }
    if (input.mouseInBounds && input.mouseClicked && hitTest(input.mouseX, input.mouseY, BACK_BTN_RECT)) {
      cb.onPlayMenuBack();
      cb.onNavigate(target);
    }
  }

  private renderScoresStats(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    this.renderAmbientMenuBg(renderer, ctx, 2);
    this.renderBackButton(renderer, ctx);

    renderer.drawTextHex('SCORES + STATS', 160, 8, ctx.palette.colors[3], 1, '5x7', 'center');
    renderer.drawTextHex(ctx.profile.name.toUpperCase(), 310, 10, ctx.palette.colors[2], 0.85, '3x5', 'right');

    const stats = ctx.profile.stats;

    // Left panel: High Scores & Speedrun Bests
    const lx = 10;
    const ly = 24;
    const lw = 146;
    const lh = 142;
    drawBox(renderer, lx, ly, lw, lh, ctx.palette.colors[1], ctx.palette.colors[2], 0.9, 0.7);
    renderer.drawTextHex('HIGH SCORES', lx + lw * 0.5, ly + 6, ctx.palette.colors[3], 1, '3x5', 'center');

    for (let i = 0; i < MODE_LIST.length; i++) {
      const m = MODE_LIST[i];
      const ry = ly + 16 + i * 13;
      const unlocked = isModeUnlocked(m.id, ctx.profile);
      renderer.drawTextHex(
        m.name.toUpperCase(),
        lx + 6,
        ry,
        unlocked ? ctx.palette.colors[2] : ctx.palette.colors[5],
        unlocked ? 0.95 : 0.7,
        '3x5',
        'left',
      );
      const val = unlocked ? (ctx.profile.highScores[m.id] ?? 0).toLocaleString('en-US') : 'LOCKED';
      renderer.drawTextHex(val, lx + lw - 6, ry, ctx.palette.colors[3], 1, '3x5', 'right');
    }

    renderer.drawRectHex(lx + 6, ly + 96, lw - 12, 1, ctx.palette.colors[2], 0.3);
    renderer.drawTextHex('SPEEDRUNS', lx + lw * 0.5, ly + 100, ctx.palette.colors[3], 1, '3x5', 'center');

    const timeRows: [string, string][] = [
      ['MARATHON', stats.fastestMarathonMs !== null ? formatHudTime(stats.fastestMarathonMs, true) : '--'],
      ['INTENSE', stats.fastestIntenseMarathonMs !== null ? formatHudTime(stats.fastestIntenseMarathonMs, true) : '--'],
      ['IMPOSSIBLE', stats.fastestImpossibleMarathonMs !== null ? formatHudTime(stats.fastestImpossibleMarathonMs, true) : '--'],
      ['LONGEST ENDLESS', stats.longestEndlessMs > 0 ? formatHudTime(stats.longestEndlessMs, false) : '--'],
    ];

    for (let i = 0; i < timeRows.length; i++) {
      const ry = ly + 109 + i * 8;
      renderer.drawTextHex(timeRows[i][0], lx + 6, ry, ctx.palette.colors[2], 0.85, '3x5', 'left');
      renderer.drawTextHex(timeRows[i][1], lx + lw - 6, ry, ctx.palette.colors[3], 1, '3x5', 'right');
    }

    // Right panel: Lifetime Stats
    const rx = 164;
    const ry = 24;
    const rw = 146;
    const rh = 142;
    drawBox(renderer, rx, ry, rw, rh, ctx.palette.colors[1], ctx.palette.colors[2], 0.9, 0.7);
    renderer.drawTextHex('LIFETIME STATS', rx + rw * 0.5, ry + 6, ctx.palette.colors[3], 1, '3x5', 'center');

    const statRows: [string, string][] = [
      ['GAMES PLAYED', stats.gamesPlayed.toLocaleString('en-US')],
      ['MARATHONS WON', stats.marathonsCompleted.toLocaleString('en-US')],
      ['INTENSE WON', stats.intenseMarathonsCompleted.toLocaleString('en-US')],
      ['IMPOSSIBLE WON', stats.impossibleMarathonsCompleted.toLocaleString('en-US')],
      ['TOTAL POINTS', stats.pointsScored.toLocaleString('en-US')],
      ['BLOCKS CLEARED', stats.blocksCleared.toLocaleString('en-US')],
      ['BIGGEST CLEAR', String(stats.biggestClear)],
      ['BEST CLEAR PTS', stats.highestClearScore.toLocaleString('en-US')],
      ['TOTAL COMBOS', stats.totalCombos.toLocaleString('en-US')],
      ['LONGEST COMBO', stats.longestCombo > 0 ? `x${stats.longestCombo}` : '0'],
      ['PERFECT CLEARS', stats.perfectClears.toLocaleString('en-US')],
      ['HARD DROPS', stats.drops.toLocaleString('en-US')],
      ['TIME PLAYED', formatHudTime(stats.timePlayedMs, false)],
    ];

    for (let i = 0; i < statRows.length; i++) {
      const rowY = ry + 16 + i * 9;
      renderer.drawTextHex(statRows[i][0], rx + 6, rowY, ctx.palette.colors[2], 0.86, '3x5', 'left');
      renderer.drawTextHex(statRows[i][1], rx + rw - 6, rowY, ctx.palette.colors[3], 1, '3x5', 'right');
    }

    renderer.drawTextHex('ESC / ENTER: RETURN TO TITLE', 160, 171, ctx.palette.colors[2], 0.65, '3x5', 'center');
  }

  // ==========================================================================
  // 9. CREDITS SCREEN (Clean Krunked Foundry Credits)
  // ==========================================================================

  private renderCredits(renderer: WebGL2Renderer, ctx: MenuScreenContext): void {
    this.renderAmbientMenuBg(renderer, ctx, 4);
    this.renderBackButton(renderer, ctx);

    renderer.drawTextHex('CREDITS', 160, 9, ctx.palette.colors[3], 1, '5x7', 'center');

    drawBox(renderer, 22, 24, 276, 136, ctx.palette.colors[1], ctx.palette.colors[3], 0.92, 0.9);
    renderer.drawSpriteHex('logo_diamond_spr', 0, 160, 42, ctx.palette.colors[3], 1);

    renderer.drawTextHex('KRUNKED LUMIA  V1.0', 160, 58, ctx.palette.colors[3], 1, '5x7', 'center');

    const blocks: [string, string][] = [
      ['CREATED BY', 'KRUNKED FOUNDRY'],
      ['ENGINE & WEBGL2 BLOOM', 'KRUNKED ENGINEERING'],
      ['HARMONIC SYNTH AUDIO', 'KRUNKED SYNTH COLLECTIVE'],
      ['PIXEL-DIAMOND ART & 63 PALETTES', 'KRUNKED DESIGN LAB'],
      ['ORIGINAL TRACK ARTISTS', 'MILO VANCE / SABLE CIRCUIT / HELIOS MERIDIAN'],
      ['', 'VEX & VOLT / NOVA OVERDRIVE'],
    ];

    let y = 66;
    for (const [role, credit] of blocks) {
      if (role) {
        renderer.drawTextHex(role, 160, y, ctx.palette.colors[2], 0.72, '3x5', 'center');
        y += 6;
      }
      renderer.drawTextHex(credit, 160, y, ctx.palette.colors[3], 1, '3x5', 'center');
      y += 7;
    }

    renderer.drawTextHex(
      t('credits.footer'),
      160,
      149,
      ctx.palette.colors[2],
      0.95,
      '3x5',
      'center',
    );
    renderer.drawTextHex('ESC / ENTER: RETURN TO TITLE', 160, 168, ctx.palette.colors[2], 0.65, '3x5', 'center');
  }

  // ==========================================================================
  // 10. FULL WAVE 2 SCREEN CALLBACK BRIDGES (COLOR EDITOR, CONTROLS, PROFILES)
  // ==========================================================================

  private buildColorEditorCallbacks(cb: MenuScreenCallbacks): ColorEditorCallbacks {
    return {
      onSavePalette: (input) => cb.onSaveCustomPalette(input),
      onDeletePalette: (paletteId) => cb.onDeleteCustomPalette(paletteId),
      onApplyPalette: (paletteId) => cb.onApplyPalette(paletteId),
      onClose: () => cb.onNavigate('SETTINGS'),
      onPlayMenuMove: cb.onPlayMenuMove,
      onPlayMenuSelect: cb.onPlayMenuSelect,
      onPlayMenuBack: cb.onPlayMenuBack,
      onPlayMenuFail: cb.onPlayMenuFail,
      onCopyToClipboard: (text) => cb.onCopyToClipboard(text),
      onRequestImportCode: () => cb.onRequestImportCode(),
    };
  }

  private buildControlsRemapCallbacks(cb: MenuScreenCallbacks): ControlsRemapCallbacks {
    return {
      onApply: (bindings) => cb.onApplyControlBindings(bindings),
      onClose: () => {
        this.controlsRemapOpen = false;
      },
      onPlayMenuMove: cb.onPlayMenuMove,
      onPlayMenuSelect: cb.onPlayMenuSelect,
      onPlayMenuBack: cb.onPlayMenuBack,
      onPlayMenuFail: cb.onPlayMenuFail,
    };
  }

  private buildProfilesCallbacks(cb: MenuScreenCallbacks): ProfilesScreenCallbacks {
    return {
      onSelectProfile: (profileId) => cb.onSelectProfile(profileId),
      onCreateProfile: (name) => cb.onCreateProfile(name),
      onRenameProfile: (profileId, newName) => cb.onRenameProfile(profileId, newName),
      onDeleteProfile: (profileId) => cb.onDeleteProfile(profileId),
      onClose: () => cb.onNavigate('TITLE'),
      onPlayMenuMove: cb.onPlayMenuMove,
      onPlayMenuSelect: cb.onPlayMenuSelect,
      onPlayMenuBack: cb.onPlayMenuBack,
      onPlayMenuFail: cb.onPlayMenuFail,
    };
  }
}
