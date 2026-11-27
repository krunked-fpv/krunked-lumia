import {
  GAME_MODE_CONFIGS,
  IMPOSSIBLE_DROP_TIMER_TICKS,
  SIM_DT_MS,
  SIM_HZ,
  createEmptyInputFrame,
  isLightPaletteBg,
  type AppScreen,
  type DebugBridge,
  type GameModeId,
  type InputFrame,
  type PackMode,
  type Palette,
  type SimEvent,
  type SimState,
  type SongSection,
  type TargetFps,
  type TrackId,
} from '../contracts/index.js';
import { HarmonicAudioEngine } from '../audio/HarmonicAudioEngine.js';
import { getPaletteById } from '../data/palettes.js';
import { getTracksForMode, isTrackValidForMode } from '../data/tracks.js';
import { InputManager } from '../input/InputManager.js';
import { detectControllerKind } from '../input/GamepadAdapter.js';
import {
  DEFAULT_CONTAINER_ORIGIN_X,
  DEFAULT_CONTAINER_ORIGIN_Y,
  PORTRAIT_CONTAINER_ORIGIN_X,
  PORTRAIT_CONTAINER_ORIGIN_Y,
} from '../render/ParticlesAndBg.js';
import { WebGL2Renderer } from '../render/WebGL2Renderer.js';
import {
  clearPlayableGrid,
  computeLevelForCleared,
  computeNextSongSection,
  createSimState,
  getFallSpeedTicks,
  getImpossibleDropTimerTicks,
  hashSimState,
  setCell,
  stepSim,
} from '../sim/index.js';
import { HudRenderer } from '../ui/HudRenderer.js';
import { MenuScreens, type MenuScreenCallbacks, type MenuScreenContext } from '../ui/MenuScreens.js';
import { TouchOverlayRenderer } from '../ui/TouchOverlayRenderer.js';
import { DebugDrawer } from './DebugDrawer.js';
import { SaveManager, type RunRecordOutcome, type SettingsUpdatePatch } from './SaveManager.js';

export interface CustomPackCallbacks {
  isCustomPackAvailable?: () => boolean;
  getCustomPackStatusLabel?: () => string;
  getCustomPalettes?: () => readonly Palette[];
  onApplyPackMode?: (mode: PackMode) => Promise<boolean>;
  /** Alias for onApplyPackMode retained for backward compatibility. */
  onSetPackMode?: (mode: PackMode) => Promise<boolean>;
  onRequestLoadCustomPack?: () => void;
}

const MAX_FRAME_DELTA_MS = 100;

/**
 * Top-level Krunked Lumia application orchestrator.
 * - Fixed 60 Hz deterministic simulation accumulator with 30 / 60 / 120 FPS render pacing
 * - Clean interpolation alpha (snapped to 1.0 when native60Snap is active)
 * - Drains SimEvent[] into WebGL2Renderer FX, HarmonicAudioEngine, and Gamepad Rumble
 * - Exposes window.__KRUNKED_DEBUG__ and F9 DebugDrawer
 * - Provides extensible registerCustomPackCallbacks(...) hook for Wave 2 Custom Pack manager
 */
export class GameApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGL2Renderer;
  private readonly audioEngine: HarmonicAudioEngine;
  private readonly inputManager: InputManager;
  private readonly saveManager: SaveManager;
  private readonly hudRenderer: HudRenderer;
  private readonly menuScreens: MenuScreens;
  private readonly touchOverlayRenderer: TouchOverlayRenderer;
  private readonly debugBridge: DebugBridge;
  private readonly debugDrawer: DebugDrawer;

  private lastPortraitActive = false;

  private screen: AppScreen;
  private settingsReturnScreen: AppScreen = 'TITLE';
  private simState: SimState | null = null;
  private lastRunOutcome: RunRecordOutcome | null = null;
  private selectedMode: GameModeId;
  private selectedTrack: TrackId;

  private customPackCallbacks: CustomPackCallbacks = {};
  /** Active palette ID when a Custom Pack palette (not stored in SaveManager) is selected. */
  private activePackPaletteId: string | null = null;

  // Loop & frame-pacing state
  private running = false;
  private rafId: number | null = null;
  private lastRafMs = 0;
  private simAccumulatorMs = 0;
  private timeSinceLastRenderMs = 0;
  private measuredFps = 60;
  private audioUnlocked = false;
  private anyKeyLatched = false;
  private seedCounter = 1;

  private readonly menuCallbacks: MenuScreenCallbacks;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.saveManager = new SaveManager();
    const initialData = this.saveManager.getData();
    const initialSettings = initialData.settings;

    this.renderer = new WebGL2Renderer(canvas);
    this.audioEngine = new HarmonicAudioEngine(
      initialSettings.audio.masterVolume,
      initialSettings.audio.muted,
    );
    this.inputManager = new InputManager(canvas, () => this.renderer.getViewportTransform());
    this.inputManager.setOnAudioUnlock(this.handleAudioUnlockGesture);
    this.hudRenderer = new HudRenderer();
    this.menuScreens = new MenuScreens();
    this.touchOverlayRenderer = new TouchOverlayRenderer();

    this.selectedMode = initialData.lastMode;
    this.selectedTrack = isTrackValidForMode(initialData.lastTrack, this.selectedMode)
      ? initialData.lastTrack
      : getTracksForMode(this.selectedMode)[0].id;

    this.screen = initialSettings.photosensitivitySeen ? 'TITLE' : 'PHOTOSENSITIVITY';

    this.menuCallbacks = {
      onDismissPhotosensitivity: () => {
        this.saveManager.markPhotosensitivitySeen();
        this.setScreen('TITLE');
      },
      onNavigate: (target) => {
        this.setScreen(target);
      },
      onSelectMode: (mode) => {
        this.selectedMode = mode;
        if (!isTrackValidForMode(this.selectedTrack, mode)) {
          this.selectedTrack = getTracksForMode(mode)[0].id;
        }
      },
      onSelectTrack: (trackId) => {
        this.selectedTrack = trackId;
      },
      onPreviewTrack: (trackId) => {
        this.audioEngine.startTrack(trackId);
      },
      onStartRun: (mode, trackId) => {
        this.startGame(mode, trackId);
      },
      onResumeRun: () => {
        if (this.simState && !this.simState.finished) {
          this.screen = 'PLAYING';
          this.simAccumulatorMs = 0;
          this.inputManager.clearEdges();
        }
      },
      onRestartRun: () => {
        this.startGame(this.selectedMode, this.selectedTrack);
      },
      onEndRunToTitle: () => {
        if (
          this.simState &&
          this.lastRunOutcome === null &&
          (this.simState.drops > 0 || this.simState.cleared > 0)
        ) {
          this.saveManager.recordRunResult(this.simState);
        }
        this.simState = null;
        this.lastRunOutcome = null;
        this.renderer.effects.reset();
        this.hudRenderer.reset();
        this.setScreen('TITLE');
      },
      onUpdateSettings: (patch) => {
        this.applySettingsPatch(patch);
      },
      onResetTutorialCompleted: () => {
        const profile = this.saveManager.getActiveProfile();
        profile.tutorialCompleted = false;
        this.saveManager.save();
      },
      onTogglePackMode: () => {
        const current = this.pendingPackMode ?? this.saveManager.getSettings().packMode;
        const next: PackMode = current === 'custom' ? 'builtin' : 'custom';
        void this.setPackMode(next);
      },
      onRequestLoadCustomPack: () => {
        this.customPackCallbacks.onRequestLoadCustomPack?.();
      },
      onSelectProfile: (profileId) => {
        this.saveManager.selectProfile(profileId);
      },
      onCreateProfile: (name) => this.saveManager.createProfile(name),
      onRenameProfile: (profileId, newName) => this.saveManager.renameProfile(profileId, newName),
      onDeleteProfile: (profileId) => this.saveManager.deleteProfile(profileId),
      onSaveCustomPalette: (input) => this.saveManager.saveCustomPalette(input),
      onDeleteCustomPalette: (paletteId) => {
        if (this.activePackPaletteId === paletteId) {
          this.activePackPaletteId = null;
        }
        return this.saveManager.deleteCustomPalette(paletteId);
      },
      onApplyPalette: (paletteId) => {
        this.applySettingsPatch({ paletteId });
      },
      onCopyToClipboard: async (text) => {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch {
          // Ignore clipboard permission errors cleanly
        }
        return false;
      },
      onRequestImportCode: () => {
        if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
          return window.prompt('Paste 36-hex palette share code (optional Name:hex):', '');
        }
        return null;
      },
      onApplyControlBindings: ({ keyboard, gamepad }) => {
        this.applySettingsPatch({ keyboard, gamepad, gamepadCustomized: true });
      },
      onPlayMenuMove: () => this.audioEngine.menu.playMove(),
      onPlayMenuSelect: () => {
        this.audioEngine.menu.playSelect();
      },
      onPlayMenuBack: () => this.audioEngine.menu.playBack(),
      onPlayMenuFail: () => this.audioEngine.menu.playFail(),
    };

    this.debugBridge = this.createDebugBridge();
    this.debugDrawer = new DebugDrawer(this.debugBridge);

    if (typeof window !== 'undefined') {
      window.__KRUNKED_DEBUG__ = this.debugBridge;
    }
  }

  /** Wave 2 extension hook for Custom Asset & Audio Pack integration. */
  registerCustomPackCallbacks(callbacks: CustomPackCallbacks): void {
    this.customPackCallbacks = { ...this.customPackCallbacks, ...callbacks };
  }

  getRenderer(): WebGL2Renderer {
    return this.renderer;
  }

  getAudioEngine(): HarmonicAudioEngine {
    return this.audioEngine;
  }

  getSaveManager(): SaveManager {
    return this.saveManager;
  }

  getInputManager(): InputManager {
    return this.inputManager;
  }

  getDebugBridge(): DebugBridge {
    return this.debugBridge;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.handleResize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleResize);
      window.addEventListener('orientationchange', this.handleResize);
      window.visualViewport?.addEventListener('resize', this.handleResize);
      window.addEventListener('keydown', this.handleGlobalKeyDown);
      window.addEventListener('pointerdown', this.handleAudioUnlockGesture);
      window.addEventListener('touchstart', this.handleAudioUnlockGesture, { passive: true });
      window.addEventListener('gamepadconnected', this.handleGamepadConnected);
      window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
    }

    this.menuScreens.onEnterScreen(this.screen, this.buildMenuContext());
    if (this.screen === 'TITLE') {
      this.audioEngine.startMenuMusic();
    }

    this.lastRafMs = performance.now();
    this.timeSinceLastRenderMs = 1000;
    this.rafId = requestAnimationFrame(this.onAnimationFrame);
  }

  dispose(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleResize);
      window.removeEventListener('orientationchange', this.handleResize);
      window.visualViewport?.removeEventListener('resize', this.handleResize);
      window.removeEventListener('keydown', this.handleGlobalKeyDown);
      window.removeEventListener('pointerdown', this.handleAudioUnlockGesture);
      window.removeEventListener('touchstart', this.handleAudioUnlockGesture);
      window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
      if (window.__KRUNKED_DEBUG__ === this.debugBridge) {
        delete window.__KRUNKED_DEBUG__;
      }
    }
    this.menuScreens.dispose();
    this.debugDrawer.dispose();
    this.inputManager.dispose();
    this.audioEngine.dispose();
    this.renderer.dispose();
  }

  showToast(text: string, durationSec = 2.5): void {
    this.menuScreens.showToast(text, durationSec);
  }

  // ==========================================================================
  // SCREEN & GAME LIFECYCLE
  // ==========================================================================

  private getEffectivePalettes(): Palette[] {
    const base = this.saveManager.getAllPalettes();
    if (this.saveManager.getSettings().packMode !== 'custom') {
      return base;
    }
    const packPalettes = this.customPackCallbacks.getCustomPalettes?.() ?? [];
    if (packPalettes.length === 0) {
      return base;
    }
    const seen = new Set<string>(base.map((p) => p.id));
    const merged: Palette[] = [...base];
    for (let i = 0; i < packPalettes.length; i++) {
      const pal = packPalettes[i];
      if (!seen.has(pal.id)) {
        seen.add(pal.id);
        merged.push(pal);
      }
    }
    return merged;
  }

  private getActivePalette(): Palette {
    const settings = this.saveManager.getSettings();
    const allPalettes = this.getEffectivePalettes();
    if (settings.packMode === 'custom' && this.activePackPaletteId) {
      const packPal = allPalettes.find((p) => p.id === this.activePackPaletteId);
      if (packPal) {
        return packPal;
      }
    }
    return getPaletteById(settings.paletteId, allPalettes);
  }

  private applySettingsPatch(patch: SettingsUpdatePatch): void {
    let effectivePatch: SettingsUpdatePatch = patch;
    if (patch.paletteId !== undefined) {
      const saveHasPalette = this.saveManager.getAllPalettes().some((p) => p.id === patch.paletteId);
      if (saveHasPalette) {
        this.activePackPaletteId = null;
      } else {
        const packHasPalette = this.getEffectivePalettes().some((p) => p.id === patch.paletteId);
        if (packHasPalette) {
          this.activePackPaletteId = patch.paletteId;
          const { paletteId: _ignored, ...rest } = patch;
          effectivePatch = rest;
        }
      }
    }

    const updated = this.saveManager.updateSettings(effectivePatch);
    this.audioEngine.setMasterVolume(updated.audio.masterVolume);
    this.audioEngine.setMuted(updated.audio.muted);
    if (this.simState && patch.gameplay?.tutorialEnabled !== undefined) {
      this.simState.tutorial.enabled = updated.gameplay.tutorialEnabled;
      if (!updated.gameplay.tutorialEnabled) {
        this.simState.tutorial.step = 'DONE';
      }
    }
  }

  private setScreen(next: AppScreen): void {
    const prev = this.screen;
    if (next === 'SETTINGS' && prev !== 'COLOR_EDITOR' && prev !== 'SETTINGS') {
      this.settingsReturnScreen = prev === 'PAUSED' ? 'PAUSED' : 'TITLE';
    }

    this.screen = next;
    this.inputManager.cancelCapture();
    this.menuScreens.onEnterScreen(next, this.buildMenuContext());

    // Keep music clean across screen transitions
    if (next === 'TRACK_SELECT') {
      if (!isTrackValidForMode(this.selectedTrack, this.selectedMode)) {
        this.selectedTrack = getTracksForMode(this.selectedMode)[0].id;
      }
      this.audioEngine.startTrack(this.selectedTrack);
    } else if (
      next === 'TITLE' ||
      next === 'MODE_SELECT' ||
      next === 'SCORES_STATS' ||
      next === 'CREDITS' ||
      next === 'PROFILES'
    ) {
      if (this.audioEngine.isPlaying() || !this.audioEngine.menu.isMenuLoopPlaying()) {
        this.audioEngine.startMenuMusic();
      }
    }
  }

  private startGame(mode: GameModeId, trackId?: TrackId, seed?: number): void {
    const resolvedTrack: TrackId =
      trackId && isTrackValidForMode(trackId, mode)
        ? trackId
        : isTrackValidForMode(this.selectedTrack, mode)
          ? this.selectedTrack
          : getTracksForMode(mode)[0].id;

    const settings = this.saveManager.getSettings();
    const profile = this.saveManager.getActiveProfile();
    const resolvedSeed =
      typeof seed === 'number' && Number.isFinite(seed)
        ? seed >>> 0
        : ((Date.now() ^ (this.seedCounter++ * 0x9e3779b1)) >>> 0) || 1;

    const enableTutorial = settings.gameplay.tutorialEnabled && !profile.tutorialCompleted;

    this.selectedMode = mode;
    this.selectedTrack = resolvedTrack;
    this.saveManager.setLastSelection(mode, resolvedTrack);

    this.simState = createSimState(mode, resolvedTrack, resolvedSeed, enableTutorial);
    this.lastRunOutcome = null;
    this.renderer.effects.reset();
    this.hudRenderer.reset();
    this.simAccumulatorMs = 0;
    this.screen = 'PLAYING';
    this.inputManager.clearEdges();

    this.audioEngine.startTrack(resolvedTrack);
    if (enableTutorial) {
      this.audioEngine.menu.playTutorialStart();
    }
  }

  private packSwitchSeq = 0;
  private pendingPackMode: PackMode | null = null;

  async setPackMode(mode: PackMode, options?: { silent?: boolean }): Promise<boolean> {
    const seq = ++this.packSwitchSeq;
    this.pendingPackMode = mode;
    const applyPack =
      this.customPackCallbacks.onApplyPackMode ?? this.customPackCallbacks.onSetPackMode;
    if (applyPack) {
      const ok = await applyPack(mode);
      if (seq !== this.packSwitchSeq) {
        return ok;
      }
      this.pendingPackMode = null;
      if (ok) {
        this.pendingPackMode = null;
    if (mode === 'builtin') {
          this.activePackPaletteId = null;
        }
        this.saveManager.updateSettings({ packMode: mode });
        if (!options?.silent) {
          this.menuScreens.showToast(
            mode === 'custom' ? 'CUSTOM PACK ACTIVE' : 'BUILT-IN ART ACTIVE',
            2.5,
          );
        }
      } else if (!options?.silent) {
        this.menuScreens.showToast(
          mode === 'custom' ? 'NO CUSTOM PACK LOADED' : 'PACK SWITCH FAILED',
          2.5,
        );
      }
      return ok;
    }

    this.pendingPackMode = null;
    if (mode === 'builtin') {
      this.activePackPaletteId = null;
      this.renderer.resetBuiltinAtlas();
      this.renderer.resetBuiltinCovers();
      this.audioEngine.setPackMode('builtin');
      this.saveManager.updateSettings({ packMode: 'builtin' });
      if (!options?.silent) {
        this.menuScreens.showToast('BUILT-IN ART ACTIVE', 2.5);
      }
      return true;
    }

    if (!options?.silent) {
      this.menuScreens.showToast('NO CUSTOM PACK LOADED', 2.5);
    }
    return false;
  }

  // ==========================================================================
  // FIXED 60HZ SIMULATION + SIM EVENT DRAIN
  // ==========================================================================

  private runSimTick(input: InputFrame): SimEvent[] {
    const state = this.simState;
    if (!state) return [];

    const events = stepSim(state, input);
    this.drainSimEvents(events);
    this.renderer.effects.update(1);
    return events;
  }

  private drainSimEvents(events: readonly SimEvent[]): void {
    if (events.length === 0) return;

    const settings = this.saveManager.getSettings();
    const portrait = this.computeIsPortraitGameplay();
    const originX = portrait ? PORTRAIT_CONTAINER_ORIGIN_X : DEFAULT_CONTAINER_ORIGIN_X;
    const originY = portrait ? PORTRAIT_CONTAINER_ORIGIN_Y : DEFAULT_CONTAINER_ORIGIN_Y;

    // 1. Visual effects (particles, BGGeometry waves, floating pixel banners, bloom & flash)
    const fx = this.renderer.effects.consumeSimEvents(
      events,
      originX,
      originY,
    );
    if (fx.bloomPulse > 0) {
      this.renderer.triggerBloomPulse(fx.bloomPulse);
    }
    if (fx.flashSlot !== null && fx.flashIntensity > 0) {
      this.renderer.triggerBoardFlash(fx.flashSlot, fx.flashIntensity);
    }

    // 2. Beat-locked harmonic Web Audio engine
    this.audioEngine.processSimEvents(events);

    // 3. Container border color flash, gamepad rumble & lifecycle transitions
    const rumbleEnabled = settings.gameplay.gamepadRumble;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'TETRAD_HARD_DROP':
          this.inputManager.triggerRumble(0.28, 45, rumbleEnabled);
          break;
        case 'BLOCKS_CLEAR': {
          const leadSlot = ev.cells.length > 0 ? ev.cells[0].color + 1 : 3;
          this.hudRenderer.triggerFrameFlash(leadSlot, 0.75 + ev.clearTier * 0.12);
          this.inputManager.triggerRumble(0.35 + ev.clearTier * 0.18, 70 + ev.clearTier * 25, rumbleEnabled);
          break;
        }
        case 'COMBO_CHAIN': {
          const comboSlot = ev.combo >= 4 ? 5 : ev.combo === 3 ? 4 : 3;
          this.hudRenderer.triggerFrameFlash(comboSlot, 1.0);
          this.inputManager.triggerRumble(0.55 + ev.comboTier * 0.15, 95, rumbleEnabled);
          break;
        }
        case 'PERFECT_CLEAR':
          this.hudRenderer.triggerFrameFlash(3, 1.0);
          this.inputManager.triggerRumble(0.95, 220, rumbleEnabled);
          break;
        case 'TUTORIAL_ADVANCE':
          if (ev.completed) {
            this.saveManager.markTutorialCompleted();
          }
          break;
        case 'GAME_VICTORY':
        case 'GAME_OVER':
          if (this.simState && this.screen !== 'ENDGAME') {
            this.lastRunOutcome = this.saveManager.recordRunResult(this.simState);
            this.screen = 'ENDGAME';
            this.inputManager.clearEdges();
            this.menuScreens.onEnterScreen('ENDGAME', this.buildMenuContext());
          }
          break;
        default:
          break;
      }
    }
  }

  // ==========================================================================
  // MAIN RAF LOOP (FIXED 60HZ SIM + 30/60/120 FPS FRAME PACING)
  // ==========================================================================

  private readonly onAnimationFrame = (nowMs: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.onAnimationFrame);

    const rawDtMs = Math.max(0, Math.min(MAX_FRAME_DELTA_MS, nowMs - this.lastRafMs));
    this.lastRafMs = nowMs;

    const settings = this.saveManager.getSettings();
    const dtSec = rawDtMs / 1000;

    // 1. Update audio engine clock
    this.audioEngine.update(dtSec);

    // 2. Poll UI input & run fixed-timestep 60Hz sim when PLAYING
    const portraitNow = this.computeIsPortraitGameplay();
    const touchAllowedNow = this.isTouchControlsVisible() || portraitNow;
    this.inputManager.setGameplayContext(this.screen === 'PLAYING', portraitNow, touchAllowedNow);

    if (this.screen === 'PLAYING' && this.simState) {
      const uiInput = this.inputManager.pollUiInput(settings, dtSec);
      if (uiInput.pause) {
        this.audioEngine.menu.playBack();
        this.screen = 'PAUSED';
        this.simAccumulatorMs = 0;
        this.menuScreens.onEnterScreen('PAUSED', this.buildMenuContext());
      } else {
        this.simAccumulatorMs += rawDtMs;
        let ticksThisFrame = 0;
        while (this.simAccumulatorMs >= SIM_DT_MS && ticksThisFrame < 6 && this.screen === 'PLAYING') {
          this.simAccumulatorMs -= SIM_DT_MS;
          const simInput = this.inputManager.pollSimInputFrame(settings);
          this.runSimTick(simInput);
          ticksThisFrame += 1;
        }
        this.hudRenderer.update(dtSec);
        this.inputManager.updateTouchVisuals(dtSec, portraitNow);
      }
    } else {
      this.simAccumulatorMs = 0;
      const uiInput = this.inputManager.pollUiInput(settings, dtSec);
      const ctx = this.buildMenuContext();
      this.anyKeyLatched = false;
      this.menuScreens.update(dtSec, uiInput, ctx, this.menuCallbacks, this.inputManager);

      if (this.screen === 'ENDGAME') {
        this.renderer.effects.update(rawDtMs / SIM_DT_MS);
        this.hudRenderer.update(dtSec);
      }
    }

    // 3. Target FPS frame-pacing throttle (30 / 60 / 120 FPS)
    this.timeSinceLastRenderMs += rawDtMs;
    const targetFps = settings.render.targetFps;
    const minRenderIntervalMs = targetFps >= 120 ? 0 : 1000 / targetFps - 1.5;

    if (this.timeSinceLastRenderMs >= minRenderIntervalMs) {
      const renderDtSec = this.timeSinceLastRenderMs / 1000;
      if (renderDtSec > 0.0005) {
        const instFps = Math.min(240, 1 / renderDtSec);
        this.measuredFps = this.measuredFps * 0.88 + instFps * 0.12;
      }
      this.timeSinceLastRenderMs = 0;

      const interpAlpha = settings.render.native60Snap
        ? 1.0
        : Math.max(0, Math.min(1, this.simAccumulatorMs / SIM_DT_MS));

      this.renderFrame(interpAlpha, renderDtSec);
    }

    // 4. Refresh F9 Debug Drawer telemetry if open
    this.debugDrawer.refresh(nowMs);
  };

  private lastViewportCssW = 0;
  private lastViewportCssH = 0;
  private lastViewportDpr = 0;

  private readSafeAreaInsets(): { top: number; right: number; bottom: number; left: number } {
    if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
    try {
      const style = getComputedStyle(document.documentElement);
      const parsePx = (prop: string): number => {
        const val = Number.parseFloat(style.getPropertyValue(prop));
        return Number.isFinite(val) && val > 0 ? val : 0;
      };
      return {
        top: parsePx('--sat'),
        right: parsePx('--sar'),
        bottom: parsePx('--sab'),
        left: parsePx('--sal'),
      };
    } catch {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  private computeIsPortraitGameplay(): boolean {
    const isGameplayBacked =
      (this.screen === 'PLAYING' || this.screen === 'PAUSED' || this.screen === 'ENDGAME') &&
      this.simState !== null;
    if (!isGameplayBacked) {
      return false;
    }
    const render = this.saveManager.getSettings().render;
    if (render.tateRotate) {
      return false;
    }
    const mode = render.portraitMode ?? 'auto';
    if (mode === 'on') {
      this.lastPortraitActive = true;
      return true;
    }
    if (mode === 'off') {
      this.lastPortraitActive = false;
      return false;
    }
    const cssW = this.lastViewportCssW || this.canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 320);
    const cssH = this.lastViewportCssH || this.canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 180);
    if (this.lastPortraitActive) {
      if (cssW > cssH * 1.05) {
        this.lastPortraitActive = false;
      }
    } else if (cssH > cssW * 1.05) {
      this.lastPortraitActive = true;
    }
    return this.lastPortraitActive;
  }

  private isTouchControlsVisible(): boolean {
    const mode = this.saveManager.getSettings().gameplay.touchControlsMode ?? 'auto';
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return this.inputManager.isTouchSensed();
  }

  private syncCanvasViewport(): void {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const cssW = this.canvas.clientWidth > 0 ? this.canvas.clientWidth : (vv?.width ?? window.innerWidth);
    const cssH = this.canvas.clientHeight > 0 ? this.canvas.clientHeight : (vv?.height ?? window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    if (
      cssW !== this.lastViewportCssW ||
      cssH !== this.lastViewportCssH ||
      dpr !== this.lastViewportDpr
    ) {
      this.lastViewportCssW = cssW;
      this.lastViewportCssH = cssH;
      this.lastViewportDpr = dpr;
      this.renderer.setSafeAreaInsets(this.readSafeAreaInsets());
      this.renderer.resize(cssW, cssH, dpr);
    }
  }

  private renderFrame(interpAlpha: number, dtSec: number): void {
    this.syncCanvasViewport();
    const settings = this.saveManager.getSettings();
    const palette = this.getActivePalette();
    const profile = this.saveManager.getActiveProfile();
    const portrait = this.computeIsPortraitGameplay();
    const touchOverlayVisible = this.screen === 'PLAYING' && this.isTouchControlsVisible();

    this.renderer.beginScene(palette, portrait);

    const isGameplayBacked =
      (this.screen === 'PLAYING' || this.screen === 'PAUSED' || this.screen === 'ENDGAME') &&
      this.simState !== null;

    if (isGameplayBacked && this.simState) {
      const liveTelemetry = this.audioEngine.isPlaying()
        ? this.audioEngine.getSoundtestTelemetry()
        : null;
      const soundtest = settings.gameplay.soundtestEnabled ? liveTelemetry : null;
      const beatPhase = liveTelemetry ? (liveTelemetry.loopProgress * Math.max(1, liveTelemetry.progressionLength)) % 1 : 0;

      this.hudRenderer.render(this.renderer, this.simState, palette, settings, interpAlpha, {
        profileHighScore: profile.highScores[this.simState.mode] ?? 0,
        soundtest,
        hideHudFlanks: this.screen === 'ENDGAME',
        portrait,
        touchOverlayVisible,
        beatPhase,
        inputKind: this.inputManager.getLastInputKind(),
      });

      if (this.screen === 'PLAYING' && (touchOverlayVisible || portrait)) {
        this.touchOverlayRenderer.render(
          this.renderer,
          this.inputManager.getTouchVisualState(portrait),
          palette,
          settings.gameplay.touchOpacity ?? 0.55,
          touchOverlayVisible,
        );
      }
    }

    if (this.screen !== 'PLAYING') {
      this.menuScreens.render(this.renderer, this.buildMenuContext());
    }

    // Board Zoom applies strictly during non-portrait, non-touch active PLAYING so HUD/controls never clip
    const allowBoardZoom =
      this.screen === 'PLAYING' && !portrait && !touchOverlayVisible && settings.render.boardZoom;
    const effectiveRenderSettings = { ...settings.render, boardZoom: allowBoardZoom };

    this.renderer.endSceneAndPresent(palette, effectiveRenderSettings, dtSec);
  }

  private buildMenuContext(): MenuScreenContext {
    const settings = this.saveManager.getSettings();
    const allPalettes = this.getEffectivePalettes();
    const palette = this.getActivePalette();
    const customAvailable = this.customPackCallbacks.isCustomPackAvailable?.() ?? false;
    const statusLabel =
      this.customPackCallbacks.getCustomPackStatusLabel?.() ??
      (settings.packMode === 'custom' ? 'PACK: CUSTOM' : 'PACK: BUILT-IN');

    const gpStatus = this.inputManager.getControllerStatus();
    return {
      screen: this.screen,
      palette,
      allPalettes,
      settings,
      profile: this.saveManager.getActiveProfile(),
      profiles: this.saveManager.getProfiles(),
      simState: this.simState,
      lastRunOutcome: this.lastRunOutcome,
      selectedMode: this.selectedMode,
      selectedTrack: this.selectedTrack,
      packMode: settings.packMode,
      customPackAvailable: customAvailable,
      customPackStatusLabel: statusLabel,
      hasCustomPackLoader: typeof this.customPackCallbacks.onRequestLoadCustomPack === 'function',
      settingsReturnScreen: this.settingsReturnScreen,
      anyKeyPressed: this.anyKeyLatched,
      isPortraitGameplay: this.computeIsPortraitGameplay(),
      controllerKind: gpStatus.controllerKind,
      connectedGamepads: gpStatus.connectedCount,
    };
  }

  // ==========================================================================
  // WINDOW EVENTS (RESIZE, F9 DRAWER, AUDIO UNLOCK)
  // ==========================================================================

  private readonly handleResize = (): void => {
    if (typeof window === 'undefined') return;
    const rect = this.canvas.getBoundingClientRect();
    const vv = window.visualViewport;
    const cssW = rect.width > 0 ? rect.width : (vv?.width ?? window.innerWidth);
    const cssH = rect.height > 0 ? rect.height : (vv?.height ?? window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    this.lastViewportCssW = cssW;
    this.lastViewportCssH = cssH;
    this.lastViewportDpr = dpr;
    this.renderer.setSafeAreaInsets(this.readSafeAreaInsets());
    this.renderer.resize(cssW, cssH, dpr);
  };

  private readonly handleGamepadConnected = (e: Event): void => {
    const gpEvent = e as GamepadEvent;
    const id = gpEvent.gamepad?.id ?? '';
    const kind = detectControllerKind(id);
    const label =
      kind === 'xbox'
        ? 'XBOX CONTROLLER CONNECTED'
        : kind === 'tesla'
          ? 'TESLA CONTROLLER CONNECTED'
          : kind === 'playstation'
            ? 'PLAYSTATION PAD CONNECTED'
            : kind === 'nintendo'
              ? 'NINTENDO PAD CONNECTED'
              : 'CONTROLLER CONNECTED';
    this.menuScreens.showToast(label, 2.4);
  };

  private readonly handleGamepadDisconnected = (): void => {
    this.menuScreens.showToast('CONTROLLER DISCONNECTED', 2.0);
  };

  private readonly handleAudioUnlockGesture = (): void => {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    void (async () => {
      await this.audioEngine.unlock();
      // If Custom Pack mode was activated before AudioContext existed, re-decode audio buffers now
      const applyPack =
        this.customPackCallbacks.onApplyPackMode ?? this.customPackCallbacks.onSetPackMode;
      if (
        applyPack &&
        this.saveManager.getSettings().packMode === 'custom' &&
        this.customPackCallbacks.isCustomPackAvailable?.()
      ) {
        try {
          await applyPack('custom');
        } catch {
          // Stay cleanly with procedural fallback if custom audio decode fails
        }
      }

      const onMenuScreen =
        this.screen === 'TITLE' ||
        this.screen === 'MODE_SELECT' ||
        this.screen === 'SETTINGS' ||
        this.screen === 'COLOR_EDITOR' ||
        this.screen === 'SCORES_STATS' ||
        this.screen === 'CREDITS' ||
        this.screen === 'PROFILES';
      if (onMenuScreen && !this.audioEngine.isPlaying()) {
        if (this.audioEngine.menu.isMenuLoopPlaying()) {
          this.audioEngine.stopMenuMusic();
        }
        this.audioEngine.startMenuMusic();
      }
    })();
  };

  private readonly handleGlobalKeyDown = (e: KeyboardEvent): void => {
    this.handleAudioUnlockGesture();

    if (e.code === 'F9') {
      e.preventDefault();
      this.debugDrawer.toggle();
      return;
    }

    if (this.screen === 'PHOTOSENSITIVITY' && !e.repeat) {
      this.anyKeyLatched = true;
    }
  };

  // ==========================================================================
  // DEBUG BRIDGE (window.__KRUNKED_DEBUG__)
  // ==========================================================================

  private createDebugBridge(): DebugBridge {
    return {
      getState: () => {
        const settings = this.saveManager.getSettings();
        const palette = this.getActivePalette();
        const profile = this.saveManager.getActiveProfile();
        return {
          screen: this.screen,
          packMode: settings.packMode,
          customPackAvailable: this.customPackCallbacks.isCustomPackAvailable?.() ?? false,
          paletteId: palette.id,
          paletteName: palette.name,
          isLightPalette: isLightPaletteBg(palette.colors[0]),
          fps: this.measuredFps,
          targetFps: settings.render.targetFps,
          simHz: SIM_HZ,
          stateHash: this.simState ? hashSimState(this.simState) : '0000000000000000',
          entityCounts: this.renderer.getEntityCounts(),
          sim: this.simState,
          soundtest: this.audioEngine.isPlaying() ? this.audioEngine.getSoundtestTelemetry() : null,
          settings,
          profile,
          isPortraitGameplay: this.computeIsPortraitGameplay(),
          touchControlsVisible: this.screen === 'PLAYING' && this.isTouchControlsVisible(),
          controllerKind: this.inputManager.getControllerStatus().controllerKind,
          connectedGamepads: this.inputManager.getControllerStatus().connectedCount,
        };
      },

      setScreen: (screen: AppScreen) => {
        this.setScreen(screen);
      },

      startGame: (mode: GameModeId, trackId?: TrackId, seed?: number) => {
        this.startGame(mode, trackId, seed);
      },

      stepTicks: (ticks: number, input?: Partial<InputFrame>): string => {
        if (!this.simState) {
          this.startGame(this.selectedMode, this.selectedTrack, 1337);
        }
        const state = this.simState!;
        const settings = this.saveManager.getSettings();
        const count = Math.max(0, Math.floor(ticks));
        for (let i = 0; i < count; i++) {
          const frame: InputFrame = {
            ...createEmptyInputFrame(),
            moveSpeedIndex: settings.gameplay.moveSpeedIndex,
            kbMoveDelay: settings.gameplay.kbMoveDelay,
            gpMoveDelay: settings.gameplay.gpMoveDelay,
            ...(input ?? {}),
          };
          this.runSimTick(frame);
        }
        return hashSimState(state);
      },

      setPalette: (paletteIdOrName: string) => {
        const all = this.getEffectivePalettes();
        const needle = paletteIdOrName.trim().toLowerCase();
        const found =
          all.find((p) => p.id.toLowerCase() === needle) ??
          all.find((p) => p.name.toLowerCase() === needle);
        if (found) {
          this.applySettingsPatch({ paletteId: found.id });
        }
      },

      setTargetFps: (fps: TargetFps) => {
        this.applySettingsPatch({ render: { targetFps: fps } });
      },

      setPackMode: async (mode: PackMode) => this.setPackMode(mode),

      warpLevel: (level: number) => {
        if (!this.simState) {
          this.startGame(this.selectedMode, this.selectedTrack);
        }
        const sim = this.simState!;
        const clamped = Math.max(0, Math.floor(level));
        sim.level = clamped;
        if (sim.tetrad) {
          sim.tetrad.fallTimer = Math.min(sim.tetrad.fallTimer, getFallSpeedTicks(clamped));
        }
        if (sim.mode === 'impossible') {
          sim.impossibleDropStep = Math.min(
            IMPOSSIBLE_DROP_TIMER_TICKS.length - 1,
            Math.max(0, clamped - sim.startLevel),
          );
          sim.impossibleDropTimer = getImpossibleDropTimerTicks(sim.impossibleDropStep);
        }
      },

      warpCleared: (cleared: number) => {
        if (!this.simState) {
          this.startGame(this.selectedMode, this.selectedTrack);
        }
        const sim = this.simState!;
        const cfg = GAME_MODE_CONFIGS[sim.mode];
        sim.cleared = Math.max(0, Math.floor(cleared));
        sim.level = computeLevelForCleared(sim.startLevel, sim.cleared, cfg.levelIncreases);
        const nextSec = computeNextSongSection(
          sim.mode,
          sim.cleared,
          sim.remainingTicks,
          sim.songSection,
        );
        if (nextSec !== sim.songSection) {
          sim.songSection = nextSec;
          this.audioEngine.advanceSection(nextSec);
        }
      },

      warpSection: (section: SongSection) => {
        if (!this.simState) {
          this.startGame(this.selectedMode, this.selectedTrack);
        }
        this.simState!.songSection = section;
        this.audioEngine.advanceSection(section);
      },

      forcePerfectClear: () => {
        if (!this.simState || this.screen !== 'PLAYING') {
          this.startGame(this.selectedMode, this.selectedTrack);
        }
        const sim = this.simState!;
        clearPlayableGrid(sim.grid);
        // Place a 2x2 diamond of color 2 cleanly at the bottom apex so CHECK_LINES clears 100% of blocks
        setCell(sim.grid, 3, 26, 2);
        setCell(sim.grid, 3, 27, 2);
        setCell(sim.grid, 4, 27, 2);
        setCell(sim.grid, 3, 28, 2);
        sim.tetrad = null;
        sim.phase = 'CHECK_LINES';
        sim.phaseTimer = 0;
        this.runSimTick(createEmptyInputFrame());
      },

      forceCombo4x: () => {
        if (!this.simState || this.screen !== 'PLAYING') {
          this.startGame(this.selectedMode, this.selectedTrack);
        }
        const sim = this.simState!;
        clearPlayableGrid(sim.grid);
        // 2x2 diamond of color 3 + non-matching sentinel block at (2, 26) so it triggers 4x Combo cleanly
        setCell(sim.grid, 3, 26, 3);
        setCell(sim.grid, 3, 27, 3);
        setCell(sim.grid, 4, 27, 3);
        setCell(sim.grid, 3, 28, 3);
        setCell(sim.grid, 2, 26, 1);
        sim.tetrad = null;
        sim.combo = 3;
        sim.phase = 'CHECK_LINES';
        sim.phaseTimer = 0;
        this.runSimTick(createEmptyInputFrame());
      },

      toggleImpossibleUnlock: (unlocked?: boolean) => {
        const current = this.saveManager.getActiveProfile().impossibleUnlocked;
        const next = unlocked !== undefined ? unlocked : !current;
        this.saveManager.setImpossibleUnlocked(next);
      },

      toggleSoundtest: (enabled?: boolean) => {
        const current = this.saveManager.getSettings().gameplay.soundtestEnabled;
        const next = enabled !== undefined ? enabled : !current;
        this.applySettingsPatch({ gameplay: { soundtestEnabled: next } });
      },

      toggleTate: (enabled?: boolean) => {
        const current = this.saveManager.getSettings().render.tateRotate;
        const next = enabled !== undefined ? enabled : !current;
        this.applySettingsPatch({ render: { tateRotate: next } });
      },

      toggleBoardZoom: (enabled?: boolean) => {
        const current = this.saveManager.getSettings().render.boardZoom;
        const next = enabled !== undefined ? enabled : !current;
        this.applySettingsPatch({ render: { boardZoom: next } });
      },

      toggleDrawer: (open?: boolean) => {
        if (open === undefined) {
          this.debugDrawer.toggle();
        } else {
          this.debugDrawer.setOpen(open);
        }
      },

      resetSave: () => {
        const fresh = this.saveManager.reset();
        this.activePackPaletteId = null;
        this.audioEngine.setMasterVolume(fresh.settings.audio.masterVolume);
        this.audioEngine.setMuted(fresh.settings.audio.muted);
        this.selectedMode = fresh.lastMode;
        this.selectedTrack = fresh.lastTrack;
        this.simState = null;
        this.lastRunOutcome = null;
        this.setScreen('TITLE');
      },
    };
  }
}
