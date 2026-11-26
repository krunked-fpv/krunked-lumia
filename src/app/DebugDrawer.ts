import {
  GAME_MODE_ORDER,
  TARGET_FPS_OPTIONS,
  type DebugBridge,
  type GameModeId,
  type PackMode,
  type SongSection,
  type TargetFps,
} from '../contracts/index.js';

const SECTIONS: readonly SongSection[] = ['start', 'middle', 'outro', 'end'] as const;

/**
 * Compact F9 Developer Diagnostics Drawer.
 * Hidden by default (`display: none`) so gameplay renders 100% cleanly inside the
 * 320x180 WebGL2 framebuffer with zero HTML overlays.
 */
export class DebugDrawer {
  private readonly bridge: DebugBridge;
  private root: HTMLDivElement | null = null;
  private telemetryEl: HTMLPreElement | null = null;
  private packToggleBtn: HTMLButtonElement | null = null;
  private open = false;
  private lastRefreshMs = 0;

  constructor(bridge: DebugBridge) {
    this.bridge = bridge;
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(nextOpen: boolean): void {
    this.open = nextOpen;
    if (this.open) {
      this.ensureMounted();
      if (this.root) {
        this.root.style.display = 'flex';
      }
      this.refresh(performance.now(), true);
    } else if (this.root) {
      this.root.style.display = 'none';
      this.returnFocusToGame();
    }
  }

  private returnFocusToGame(): void {
    if (typeof document === 'undefined') return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const canvas = document.getElementById('game-canvas');
    if (canvas instanceof HTMLElement) {
      if (!canvas.hasAttribute('tabindex')) {
        canvas.setAttribute('tabindex', '-1');
      }
      canvas.focus({ preventScroll: true });
    }
  }

  toggle(): boolean {
    this.setOpen(!this.open);
    return this.open;
  }

  refresh(nowMs: number, force = false): void {
    if (!this.open || !this.telemetryEl) return;
    if (!force && nowMs - this.lastRefreshMs < 100) return;
    this.lastRefreshMs = nowMs;

    const s = this.bridge.getState();
    const sim = s.sim;
    const st = s.soundtest;

    const lines = [
      `SCREEN:   ${s.screen}  |  PACK: ${s.packMode}${s.customPackAvailable ? ' (custom ready)' : ''}`,
      `FPS:      ${s.fps.toFixed(1)} / ${s.targetFps}  |  SIM: ${s.simHz}Hz  |  SNAP60: ${s.settings.render.native60Snap ? 'ON' : 'OFF'}`,
      `PALETTE:  ${s.paletteName} (${s.paletteId}) [${s.isLightPalette ? 'LIGHT' : 'DARK'}]`,
      `ENTITIES: particles=${s.entityCounts.particles}  bgGeo=${s.entityCounts.bgGeometry}  blocks=${s.entityCounts.activeBlocks}`,
      `HASH:     ${s.stateHash}`,
      sim
        ? `SIM:      ${sim.mode} | ${sim.phase} | t=${sim.tick} | lv=${sim.level} | clr=${sim.cleared} | drp=${sim.drops} | score=${sim.score} | combo=${sim.combo} | sec=${sim.songSection}`
        : `SIM:      (idle)`,
      st
        ? `AUDIO:    ${st.trackId} | ${st.loopName}->${st.nextLoopName} | ${Math.round(st.bpm)}BPM | prog=${st.progressionStep + 1}/${st.progressionLength}`
        : `AUDIO:    (menu)`,
      `FLAGS:    tate=${s.settings.render.tateRotate ? 'ON' : 'OFF'} zoom=${s.settings.render.boardZoom ? 'ON' : 'OFF'} soundtest=${s.settings.gameplay.soundtestEnabled ? 'ON' : 'OFF'} imp=${s.profile.impossibleUnlocked ? 'UNLOCKED' : 'LOCKED'}`,
    ];
    this.telemetryEl.textContent = lines.join('\n');

    if (this.packToggleBtn) {
      this.packToggleBtn.textContent =
        s.packMode === 'custom' ? 'TOGGLE PACK: USE BUILTIN' : 'TOGGLE PACK: USE CUSTOM';
    }
  }

  dispose(): void {
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
    this.telemetryEl = null;
    this.packToggleBtn = null;
  }

  private ensureMounted(): void {
    if (this.root || typeof document === 'undefined') return;

    const root = document.createElement('div');
    root.id = 'krunked-debug-drawer';
    root.style.cssText = [
      'position: fixed',
      'top: 8px',
      'right: 8px',
      'width: 340px',
      'max-height: calc(100vh - 16px)',
      'overflow-y: auto',
      'z-index: 9999',
      'display: none',
      'flex-direction: column',
      'gap: 8px',
      'padding: 10px',
      'background: rgba(8, 10, 18, 0.92)',
      'color: #e8f0ff',
      'border: 1px solid #ffec27',
      'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      'font-size: 11px',
      'line-height: 1.35',
      'box-sizing: border-box',
      'box-shadow: 0 6px 24px rgba(0,0,0,0.65)',
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.18);padding-bottom:6px;';
    const title = document.createElement('strong');
    title.textContent = 'KRUNKED LUMIA DEV DRAWER (F9)';
    title.style.color = '#ffec27';
    const closeBtn = this.makeButton('CLOSE', () => this.setOpen(false));
    header.append(title, closeBtn);
    root.appendChild(header);

    // Live telemetry readout
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;padding:6px;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.12);white-space:pre-wrap;word-break:break-word;font-size:10px;';
    root.appendChild(pre);
    this.telemetryEl = pre;

    // Pack Toggle & QA Screen Shortcuts
    const packToggleBtn = this.makeButton('TOGGLE PACK: USE CUSTOM', () => {
      const current = this.bridge.getState().packMode;
      const next: PackMode = current === 'custom' ? 'builtin' : 'custom';
      void this.bridge.setPackMode(next).then(() => {
        this.refresh(performance.now(), true);
      });
    });
    this.packToggleBtn = packToggleBtn;

    root.appendChild(
      this.makeSection('PACK & SCREENS', [
        packToggleBtn,
        this.makeButton('SETTINGS', () => {
          this.bridge.setScreen('SETTINGS');
          this.refresh(performance.now(), true);
        }),
        this.makeButton('COLOR EDITOR', () => {
          this.bridge.setScreen('COLOR_EDITOR');
          this.refresh(performance.now(), true);
        }),
        this.makeButton('PROFILES', () => {
          this.bridge.setScreen('PROFILES');
          this.refresh(performance.now(), true);
        }),
        this.makeButton('TITLE', () => {
          this.bridge.setScreen('TITLE');
          this.refresh(performance.now(), true);
        }),
      ]),
    );

    // Start Mode buttons
    root.appendChild(
      this.makeSection(
        'START MODE',
        GAME_MODE_ORDER.map((m: GameModeId) =>
          this.makeButton(m.toUpperCase(), () => {
            this.bridge.startGame(m);
            this.refresh(performance.now(), true);
          }),
        ),
      ),
    );

    // Level & Cleared Warps
    root.appendChild(
      this.makeSection('WARP LEVEL / CLEARED', [
        ...[0, 5, 10, 15].map((lv) =>
          this.makeButton(`LV ${lv}`, () => {
            this.bridge.warpLevel(lv);
            this.refresh(performance.now(), true);
          }),
        ),
        ...[140, 290, 440].map((clr) =>
          this.makeButton(`CLR ${clr}`, () => {
            this.bridge.warpCleared(clr);
            this.refresh(performance.now(), true);
          }),
        ),
      ]),
    );

    // Song Section Warps
    root.appendChild(
      this.makeSection(
        'WARP SONG SECTION',
        SECTIONS.map((sec) =>
          this.makeButton(sec.toUpperCase(), () => {
            this.bridge.warpSection(sec);
            this.refresh(performance.now(), true);
          }),
        ),
      ),
    );

    // Combat / Gameplay Triggers
    root.appendChild(
      this.makeSection('TRIGGERS & UNLOCKS', [
        this.makeButton('FORCE PERFECT CLEAR', () => {
          this.bridge.forcePerfectClear();
          this.refresh(performance.now(), true);
        }),
        this.makeButton('FORCE 4X COMBO', () => {
          this.bridge.forceCombo4x();
          this.refresh(performance.now(), true);
        }),
        this.makeButton('TOGGLE IMPOSSIBLE', () => {
          this.bridge.toggleImpossibleUnlock();
          this.refresh(performance.now(), true);
        }),
        this.makeButton('TOGGLE SOUNDTEST', () => {
          this.bridge.toggleSoundtest();
          this.refresh(performance.now(), true);
        }),
      ]),
    );

    // Palettes
    root.appendChild(
      this.makeSection('PALETTE QUICK SWITCH', [
        this.makeButton('PICO DARK', () => {
          this.bridge.setPalette('pico_dark');
          this.refresh(performance.now(), true);
        }),
        this.makeButton('PICO LIGHT', () => {
          this.bridge.setPalette('pico_light');
          this.refresh(performance.now(), true);
        }),
        this.makeButton('CAPRESE', () => {
          this.bridge.setPalette('caprese');
          this.refresh(performance.now(), true);
        }),
        this.makeButton('ULTRAVIOLET', () => {
          this.bridge.setPalette('ultraviolet');
          this.refresh(performance.now(), true);
        }),
      ]),
    );

    // Display & Timing
    root.appendChild(
      this.makeSection('DISPLAY & SAVE', [
        ...TARGET_FPS_OPTIONS.map((fps: TargetFps) =>
          this.makeButton(`${fps} FPS`, () => {
            this.bridge.setTargetFps(fps);
            this.refresh(performance.now(), true);
          }),
        ),
        this.makeButton('TOGGLE TATE 90', () => {
          this.bridge.toggleTate();
          this.refresh(performance.now(), true);
        }),
        this.makeButton('TOGGLE ZOOM', () => {
          this.bridge.toggleBoardZoom();
          this.refresh(performance.now(), true);
        }),
        this.makeButton('RESET SAVE', () => {
          this.bridge.resetSave();
          this.refresh(performance.now(), true);
        }),
      ]),
    );

    document.body.appendChild(root);
    this.root = root;
  }

  private makeSection(heading: string, buttons: HTMLButtonElement[]): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const label = document.createElement('div');
    label.textContent = heading;
    label.style.cssText = 'font-size:10px;opacity:0.75;letter-spacing:0.06em;';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    for (const btn of buttons) {
      grid.appendChild(btn);
    }
    wrap.append(label, grid);
    return wrap;
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = [
      'padding: 3px 6px',
      'background: #1d2b53',
      'color: #fff7f2',
      'border: 1px solid rgba(255,247,242,0.35)',
      'font-family: inherit',
      'font-size: 10px',
      'cursor: pointer',
    ].join(';');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.blur();
      onClick();
      this.returnFocusToGame();
    });
    return btn;
  }
}
