import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  parseHexRgb01,
  type Palette,
  type PlayerProfile,
} from '../contracts/index.js';
import type { UiInputState } from '../input/InputManager.js';
import type { WebGL2Renderer } from '../render/WebGL2Renderer.js';

export type ProfilesRenderer = Pick<
  WebGL2Renderer,
  | 'drawSprite'
  | 'drawSpriteHex'
  | 'drawRect'
  | 'drawRectHex'
  | 'drawLine'
  | 'drawDiamondOutline'
  | 'drawText'
  | 'drawTextHex'
>;

export type ProfileNameEntry = string | { id: string; name: string };
export type ProfilesModalMode = 'NONE' | 'CREATE_NAME' | 'EDIT_NAME' | 'DELETE_CONFIRM';

export interface ProfilesScreenCallbacks {
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name: string) => PlayerProfile | null;
  onRenameProfile: (profileId: string, newName: string) => PlayerProfile | null;
  onDeleteProfile: (profileId: string) => boolean;
  onClose: () => void;
  onPlayMenuMove?: () => void;
  onPlayMenuSelect?: () => void;
  onPlayMenuBack?: () => void;
  onPlayMenuFail?: () => void;
}

export const PROFILE_TOO_SIMILAR_ERROR = 'TOO SIMILAR TO EXISTING PLAYER NAME';
const MAX_PROFILE_NAME_LEN = 18;

// ============================================================================
// PURE PROFILE NAME SIMILARITY CHECK
// ============================================================================

function canonicalizeProfileName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks whether `candidate` duplicates or is visually/canonically too similar
 * to an existing player name (ignoring case, spacing, underscores, hyphens, and punctuation,
 * while keeping distinct numbered names like "Player 1" and "Player 2" cleanly separate).
 *
 * Accepts either plain `string[]` or `{ id, name }[]` entries; pass `excludeId` when
 * renaming an existing profile so it does not collide with itself.
 */
export function isProfileNameTooSimilar(
  candidate: string,
  existingNames: readonly ProfileNameEntry[],
  excludeId?: string,
): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return false;
  }
  const candLower = trimmed.toLowerCase();
  const candCanon = canonicalizeProfileName(trimmed);

  for (let i = 0; i < existingNames.length; i++) {
    const entry = existingNames[i];
    let existingName: string;
    if (typeof entry === 'string') {
      if (excludeId !== undefined && entry === excludeId) {
        continue;
      }
      existingName = entry;
    } else {
      if (excludeId !== undefined && entry.id === excludeId) {
        continue;
      }
      existingName = entry.name;
    }

    const existTrim = existingName.trim();
    if (!existTrim) continue;
    if (candLower === existTrim.toLowerCase()) {
      return true;
    }
    const existCanon = canonicalizeProfileName(existTrim);
    if (candCanon.length > 0 && candCanon === existCanon) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// LAYOUT & PIXEL-NATIVE HELPERS
// ============================================================================

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hitTest(mx: number, my: number, rect: HitRect): boolean {
  return mx >= rect.x && mx < rect.x + rect.w && my >= rect.y && my < rect.y + rect.h;
}

function drawBox(
  renderer: ProfilesRenderer,
  x: number,
  y: number,
  w: number,
  h: number,
  fillHex: string,
  borderHex: string,
  fillAlpha = 0.94,
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

function cloneProfile(p: PlayerProfile): PlayerProfile {
  return {
    ...p,
    highScores: { ...p.highScores },
    stats: { ...p.stats },
    unlockedModes: [...p.unlockedModes],
    unlockedTracks: [...p.unlockedTracks],
  };
}

const BACK_BTN_RECT: HitRect = { x: 8, y: 5, w: 34, h: 11 };
const ACTION_SELECT_RECT: HitRect = { x: 180, y: 112, w: 60, h: 13 };
const ACTION_EDIT_RECT: HitRect = { x: 244, y: 112, w: 62, h: 13 };
const ACTION_DELETE_RECT: HitRect = { x: 180, y: 129, w: 126, h: 13 };
const ACTION_CREATE_CARD_RECT: HitRect = { x: 184, y: 118, w: 118, h: 16 };

const VISIBLE_LIST_ROWS = 6;

const OSK_ROWS: readonly (readonly string[])[] = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
  ['U', 'V', 'W', 'X', 'Y', 'Z', '0', '1', '2', '3'],
  ['4', '5', '6', '7', '8', '9', '-', '_', 'SPC', 'DEL'],
  ['CLR', 'CANCEL', 'OK'],
];

type FocusArea = 'LIST' | 'ACTIONS';

/**
 * Full Pixel-Native 320x180 Multi-Profile Management Screen.
 * Supports selecting profiles, creating NEW PLAYER with inline crisp pixel text entry +
 * duplicate/too-similar validation, EDIT NAME, and DELETE PROFILE with confirmation modal.
 */
export class ProfilesScreen {
  private animTime = 0;
  private profiles: PlayerProfile[] = [];
  private activeProfileId = '';

  // List index: 0..profiles.length-1 = existing profiles, profiles.length = NEW PLAYER row
  private listIdx = 0;
  private scrollTop = 0;
  private focusArea: FocusArea = 'LIST';
  private actionIdx = 0; // 0 = SELECT, 1 = EDIT NAME, 2 = DELETE PROFILE

  // Modals
  private modal: ProfilesModalMode = 'NONE';
  private modalTargetProfileId: string | null = null;
  private nameBuffer = '';
  private nameError = '';
  private oskRow = 4;
  private oskCol = 2; // OK
  private deleteBtnIdx = 1; // default safely on CANCEL
  private keyListenerAttached = false;

  private toastText = '';
  private toastTimer = 0;

  onEnter(profiles: readonly PlayerProfile[], activeProfileId: string): void {
    this.detachTextKeyListener();
    this.profiles = profiles.map(cloneProfile);
    this.activeProfileId = activeProfileId;
    this.modal = 'NONE';
    this.modalTargetProfileId = null;
    this.nameBuffer = '';
    this.nameError = '';
    this.focusArea = 'LIST';
    this.actionIdx = 0;
    this.toastText = '';
    this.toastTimer = 0;

    const idx = this.profiles.findIndex((p) => p.id === activeProfileId);
    this.listIdx = idx >= 0 ? idx : 0;
    this.keepScrollInView();
  }

  dispose(): void {
    this.detachTextKeyListener();
  }

  // ==========================================================================
  // PUBLIC INSPECTORS & PROGRAMMATIC HELPERS
  // ==========================================================================

  getProfiles(): readonly PlayerProfile[] {
    return this.profiles;
  }

  getActiveProfileId(): string {
    return this.activeProfileId;
  }

  getSelectedProfile(): PlayerProfile | null {
    if (this.listIdx >= 0 && this.listIdx < this.profiles.length) {
      return this.profiles[this.listIdx];
    }
    return null;
  }

  isNewPlayerRowSelected(): boolean {
    return this.listIdx === this.profiles.length;
  }

  getActiveModal(): ProfilesModalMode {
    return this.modal;
  }

  getNameBuffer(): string {
    return this.nameBuffer;
  }

  getNameError(): string {
    return this.nameError;
  }

  getToastText(): string {
    return this.toastTimer > 0 ? this.toastText : '';
  }

  canDeleteSelectedProfile(): boolean {
    return this.profiles.length > 1 && this.getSelectedProfile() !== null;
  }

  showToast(text: string, durationSec = 2.2): void {
    this.toastText = text;
    this.toastTimer = durationSec;
  }

  openNewPlayerModal(callbacks?: ProfilesScreenCallbacks): void {
    this.modal = 'CREATE_NAME';
    this.modalTargetProfileId = null;
    this.nameBuffer = '';
    this.nameError = '';
    this.oskRow = 4;
    this.oskCol = 2;
    this.attachTextKeyListener();
    callbacks?.onPlayMenuSelect?.();
  }

  openEditNameModal(profileId: string, callbacks?: ProfilesScreenCallbacks): boolean {
    const target = this.profiles.find((p) => p.id === profileId);
    if (!target) return false;
    this.modal = 'EDIT_NAME';
    this.modalTargetProfileId = target.id;
    this.nameBuffer = target.name;
    this.nameError = '';
    this.oskRow = 4;
    this.oskCol = 2;
    this.attachTextKeyListener();
    callbacks?.onPlayMenuSelect?.();
    return true;
  }

  openDeleteConfirmModal(profileId: string, callbacks?: ProfilesScreenCallbacks): boolean {
    if (this.profiles.length <= 1) {
      callbacks?.onPlayMenuFail?.();
      this.showToast('CANNOT DELETE LAST PROFILE', 2.0);
      return false;
    }
    const target = this.profiles.find((p) => p.id === profileId);
    if (!target) return false;
    this.modal = 'DELETE_CONFIRM';
    this.modalTargetProfileId = target.id;
    this.deleteBtnIdx = 1; // CANCEL by default
    callbacks?.onPlayMenuMove?.();
    return true;
  }

  typeNameChar(ch: string): void {
    if (this.modal !== 'CREATE_NAME' && this.modal !== 'EDIT_NAME') return;
    if (ch.length !== 1) return;
    if (!/^[a-zA-Z0-9 _\-!.]$/.test(ch)) return;
    if (this.nameBuffer.length < MAX_PROFILE_NAME_LEN) {
      this.nameBuffer += ch;
      this.refreshNameValidation();
    }
  }

  backspaceNameChar(): void {
    if (this.modal !== 'CREATE_NAME' && this.modal !== 'EDIT_NAME') return;
    if (this.nameBuffer.length > 0) {
      this.nameBuffer = this.nameBuffer.slice(0, -1);
      this.refreshNameValidation();
    }
  }

  setNameBuffer(value: string): void {
    this.nameBuffer = value.slice(0, MAX_PROFILE_NAME_LEN);
    this.refreshNameValidation();
  }

  submitNameModal(callbacks: ProfilesScreenCallbacks): boolean {
    if (this.modal !== 'CREATE_NAME' && this.modal !== 'EDIT_NAME') return false;
    const trimmed = this.nameBuffer.trim();
    if (!trimmed || canonicalizeProfileName(trimmed).length === 0) {
      this.nameError = 'ENTER A VALID PLAYER NAME';
      callbacks.onPlayMenuFail?.();
      return false;
    }

    const excludeId = this.modal === 'EDIT_NAME' ? (this.modalTargetProfileId ?? undefined) : undefined;
    if (isProfileNameTooSimilar(trimmed, this.profiles, excludeId)) {
      this.nameError = PROFILE_TOO_SIMILAR_ERROR;
      callbacks.onPlayMenuFail?.();
      return false;
    }

    if (this.modal === 'CREATE_NAME') {
      const created = callbacks.onCreateProfile(trimmed);
      if (!created) {
        callbacks.onPlayMenuFail?.();
        return false;
      }
      this.profiles.push(cloneProfile(created));
      this.activeProfileId = created.id;
      this.listIdx = this.profiles.length - 1;
      this.keepScrollInView();
      this.closeModal();
      callbacks.onPlayMenuSelect?.();
      this.showToast(`CREATED ${created.name.toUpperCase()}`, 2.0);
      return true;
    }

    if (this.modal === 'EDIT_NAME' && this.modalTargetProfileId) {
      const renamed = callbacks.onRenameProfile(this.modalTargetProfileId, trimmed);
      if (!renamed) {
        callbacks.onPlayMenuFail?.();
        return false;
      }
      const idx = this.profiles.findIndex((p) => p.id === renamed.id);
      if (idx >= 0) {
        this.profiles[idx] = cloneProfile(renamed);
      }
      this.closeModal();
      callbacks.onPlayMenuSelect?.();
      this.showToast(`RENAMED TO ${renamed.name.toUpperCase()}`, 2.0);
      return true;
    }

    return false;
  }

  confirmDeleteModal(callbacks: ProfilesScreenCallbacks): boolean {
    if (this.modal !== 'DELETE_CONFIRM' || !this.modalTargetProfileId) return false;
    if (this.profiles.length <= 1) {
      this.closeModal();
      callbacks.onPlayMenuFail?.();
      this.showToast('CANNOT DELETE LAST PROFILE', 2.0);
      return false;
    }

    const targetId = this.modalTargetProfileId;
    const deleted = callbacks.onDeleteProfile(targetId);
    this.closeModal();
    if (!deleted) {
      callbacks.onPlayMenuFail?.();
      this.showToast('DELETE FAILED', 2.0);
      return false;
    }

    this.profiles = this.profiles.filter((p) => p.id !== targetId);
    if (this.activeProfileId === targetId && this.profiles.length > 0) {
      this.activeProfileId = this.profiles[0].id;
    }
    if (this.listIdx >= this.profiles.length) {
      this.listIdx = Math.max(0, this.profiles.length - 1);
    }
    this.keepScrollInView();
    this.focusArea = 'LIST';
    callbacks.onPlayMenuSelect?.();
    this.showToast('PROFILE DELETED', 2.0);
    return true;
  }

  // ==========================================================================
  // UPDATE LOOP (KEYBOARD + GAMEPAD + MOUSE)
  // ==========================================================================

  update(dtSec: number, uiInput: UiInputState, callbacks: ProfilesScreenCallbacks): void {
    const dt = Math.max(0, Math.min(dtSec, 0.1));
    this.animTime += dt;
    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - dt);
    }

    if (this.modal !== 'NONE') {
      this.updateModal(uiInput, callbacks);
      return;
    }

    if (uiInput.cancel) {
      if (this.focusArea === 'ACTIONS') {
        this.focusArea = 'LIST';
        callbacks.onPlayMenuBack?.();
        return;
      }
      this.detachTextKeyListener();
      callbacks.onPlayMenuBack?.();
      callbacks.onClose();
      return;
    }

    const totalRows = this.profiles.length + 1; // profiles + NEW PLAYER row

    // Mouse interactions
    if (uiInput.mouseInBounds) {
      if (uiInput.mouseClicked && hitTest(uiInput.mouseX, uiInput.mouseY, BACK_BTN_RECT)) {
        this.detachTextKeyListener();
        callbacks.onPlayMenuBack?.();
        callbacks.onClose();
        return;
      }

      // Left column list rows
      const visibleEnd = Math.min(totalRows, this.scrollTop + VISIBLE_LIST_ROWS);
      for (let i = this.scrollTop; i < visibleEnd; i++) {
        const slot = i - this.scrollTop;
        const rowRect: HitRect = { x: 8, y: 26 + slot * 20, w: 156, h: 18 };
        if (hitTest(uiInput.mouseX, uiInput.mouseY, rowRect)) {
          if (uiInput.mouseMoved && (this.focusArea !== 'LIST' || this.listIdx !== i)) {
            this.focusArea = 'LIST';
            this.listIdx = i;
            callbacks.onPlayMenuMove?.();
          }
          if (uiInput.mouseClicked) {
            this.listIdx = i;
            if (i === this.profiles.length) {
              this.openNewPlayerModal(callbacks);
            } else {
              const p = this.profiles[i];
              this.selectProfileById(p.id, callbacks);
            }
            return;
          }
        }
      }

      // Right details card action buttons
      const selectedProfile = this.getSelectedProfile();
      if (selectedProfile) {
        if (hitTest(uiInput.mouseX, uiInput.mouseY, ACTION_SELECT_RECT)) {
          if (uiInput.mouseMoved) {
            this.focusArea = 'ACTIONS';
            this.actionIdx = 0;
          }
          if (uiInput.mouseClicked) {
            this.selectProfileById(selectedProfile.id, callbacks);
            return;
          }
        } else if (hitTest(uiInput.mouseX, uiInput.mouseY, ACTION_EDIT_RECT)) {
          if (uiInput.mouseMoved) {
            this.focusArea = 'ACTIONS';
            this.actionIdx = 1;
          }
          if (uiInput.mouseClicked) {
            this.openEditNameModal(selectedProfile.id, callbacks);
            return;
          }
        } else if (hitTest(uiInput.mouseX, uiInput.mouseY, ACTION_DELETE_RECT)) {
          if (uiInput.mouseMoved) {
            this.focusArea = 'ACTIONS';
            this.actionIdx = 2;
          }
          if (uiInput.mouseClicked) {
            this.openDeleteConfirmModal(selectedProfile.id, callbacks);
            return;
          }
        }
      } else if (hitTest(uiInput.mouseX, uiInput.mouseY, ACTION_CREATE_CARD_RECT)) {
        if (uiInput.mouseClicked) {
          this.openNewPlayerModal(callbacks);
          return;
        }
      }
    }

    // Keyboard & Gamepad navigation
    if (this.focusArea === 'LIST') {
      if (uiInput.up) {
        this.listIdx = (this.listIdx - 1 + totalRows) % totalRows;
        this.keepScrollInView();
        callbacks.onPlayMenuMove?.();
      } else if (uiInput.down) {
        this.listIdx = (this.listIdx + 1) % totalRows;
        this.keepScrollInView();
        callbacks.onPlayMenuMove?.();
      } else if (uiInput.right && this.getSelectedProfile() !== null) {
        this.focusArea = 'ACTIONS';
        this.actionIdx = 0;
        callbacks.onPlayMenuMove?.();
      } else if (uiInput.confirm) {
        if (this.isNewPlayerRowSelected()) {
          this.openNewPlayerModal(callbacks);
        } else {
          const p = this.getSelectedProfile();
          if (p) {
            this.selectProfileById(p.id, callbacks);
          }
        }
      }
      return;
    }

    // ACTIONS focus area on right profile card
    const target = this.getSelectedProfile();
    if (!target) {
      this.focusArea = 'LIST';
      return;
    }

    if (uiInput.left) {
      if (this.actionIdx === 1) {
        this.actionIdx = 0;
      } else {
        this.focusArea = 'LIST';
      }
      callbacks.onPlayMenuMove?.();
    } else if (uiInput.right) {
      if (this.actionIdx === 0) {
        this.actionIdx = 1;
        callbacks.onPlayMenuMove?.();
      }
    } else if (uiInput.down) {
      this.actionIdx = this.actionIdx < 2 ? 2 : 0;
      callbacks.onPlayMenuMove?.();
    } else if (uiInput.up) {
      this.actionIdx = this.actionIdx === 2 ? 0 : 2;
      callbacks.onPlayMenuMove?.();
    } else if (uiInput.confirm) {
      if (this.actionIdx === 0) {
        this.selectProfileById(target.id, callbacks);
      } else if (this.actionIdx === 1) {
        this.openEditNameModal(target.id, callbacks);
      } else {
        this.openDeleteConfirmModal(target.id, callbacks);
      }
    }
  }

  private selectProfileById(profileId: string, callbacks: ProfilesScreenCallbacks): void {
    this.activeProfileId = profileId;
    callbacks.onSelectProfile(profileId);
    callbacks.onPlayMenuSelect?.();
    const found = this.profiles.find((p) => p.id === profileId);
    if (found) {
      this.showToast(`ACTIVE: ${found.name.toUpperCase()}`, 1.8);
    }
  }

  // ==========================================================================
  // MODAL UPDATES (PIXEL TEXT ENTRY & DELETE CONFIRMATION)
  // ==========================================================================

  private closeModal(): void {
    this.detachTextKeyListener();
    this.modal = 'NONE';
    this.modalTargetProfileId = null;
    this.nameError = '';
  }

  private refreshNameValidation(): void {
    const trimmed = this.nameBuffer.trim();
    if (!trimmed) {
      this.nameError = '';
      return;
    }
    const excludeId = this.modal === 'EDIT_NAME' ? (this.modalTargetProfileId ?? undefined) : undefined;
    this.nameError = isProfileNameTooSimilar(trimmed, this.profiles, excludeId)
      ? PROFILE_TOO_SIMILAR_ERROR
      : '';
  }

  private updateModal(input: UiInputState, cb: ProfilesScreenCallbacks): void {
    if (this.modal === 'DELETE_CONFIRM') {
      if (input.cancel) {
        this.closeModal();
        cb.onPlayMenuBack?.();
        return;
      }
      if (input.left || input.right) {
        this.deleteBtnIdx = this.deleteBtnIdx === 0 ? 1 : 0;
        cb.onPlayMenuMove?.();
      }
      const delRect: HitRect = { x: 84, y: 102, w: 68, h: 14 };
      const canRect: HitRect = { x: 168, y: 102, w: 68, h: 14 };
      if (input.mouseInBounds) {
        if (hitTest(input.mouseX, input.mouseY, delRect)) {
          if (input.mouseMoved) this.deleteBtnIdx = 0;
          if (input.mouseClicked) {
            this.confirmDeleteModal(cb);
            return;
          }
        } else if (hitTest(input.mouseX, input.mouseY, canRect)) {
          if (input.mouseMoved) this.deleteBtnIdx = 1;
          if (input.mouseClicked) {
            this.closeModal();
            cb.onPlayMenuBack?.();
            return;
          }
        }
      }
      if (input.confirm) {
        if (this.deleteBtnIdx === 0) {
          this.confirmDeleteModal(cb);
        } else {
          this.closeModal();
          cb.onPlayMenuBack?.();
        }
      }
      return;
    }

    // CREATE_NAME or EDIT_NAME pixel keyboard modal
    if (input.cancel) {
      this.closeModal();
      cb.onPlayMenuBack?.();
      return;
    }

    if (input.up) {
      this.oskRow = (this.oskRow - 1 + OSK_ROWS.length) % OSK_ROWS.length;
      this.oskCol = Math.min(this.oskCol, OSK_ROWS[this.oskRow].length - 1);
      cb.onPlayMenuMove?.();
    } else if (input.down) {
      this.oskRow = (this.oskRow + 1) % OSK_ROWS.length;
      this.oskCol = Math.min(this.oskCol, OSK_ROWS[this.oskRow].length - 1);
      cb.onPlayMenuMove?.();
    } else if (input.left) {
      const len = OSK_ROWS[this.oskRow].length;
      this.oskCol = (this.oskCol - 1 + len) % len;
      cb.onPlayMenuMove?.();
    } else if (input.right) {
      const len = OSK_ROWS[this.oskRow].length;
      this.oskCol = (this.oskCol + 1) % len;
      cb.onPlayMenuMove?.();
    }

    if (input.mouseInBounds) {
      for (let r = 0; r < OSK_ROWS.length; r++) {
        const row = OSK_ROWS[r];
        for (let c = 0; c < row.length; c++) {
          const rect = this.getOskKeyRect(r, c);
          if (hitTest(input.mouseX, input.mouseY, rect)) {
            if (input.mouseMoved) {
              this.oskRow = r;
              this.oskCol = c;
            }
            if (input.mouseClicked) {
              this.oskRow = r;
              this.oskCol = c;
              this.activateOskKey(row[c], cb);
              return;
            }
          }
        }
      }
    }

    if (input.confirm) {
      this.activateOskKey(OSK_ROWS[this.oskRow][this.oskCol], cb);
    }
  }

  private activateOskKey(key: string, cb: ProfilesScreenCallbacks): void {
    if (key === 'OK') {
      this.submitNameModal(cb);
      return;
    }
    if (key === 'CANCEL') {
      this.closeModal();
      cb.onPlayMenuBack?.();
      return;
    }
    if (key === 'CLR') {
      this.nameBuffer = '';
      this.nameError = '';
      cb.onPlayMenuMove?.();
      return;
    }
    if (key === 'DEL') {
      this.backspaceNameChar();
      cb.onPlayMenuMove?.();
      return;
    }
    if (key === 'SPC') {
      this.typeNameChar(' ');
      cb.onPlayMenuMove?.();
      return;
    }
    this.typeNameChar(key);
    cb.onPlayMenuMove?.();
  }

  private getOskKeyRect(row: number, col: number): HitRect {
    const startY = 74;
    if (row < 4) {
      return { x: 40 + col * 24, y: startY + row * 15, w: 22, h: 13 };
    }
    const widths = [64, 78, 86];
    const xs = [40, 108, 190];
    return { x: xs[col] ?? 40, y: startY + 4 * 15 + 3, w: widths[col] ?? 64, h: 14 };
  }

  private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
    if (this.modal !== 'CREATE_NAME' && this.modal !== 'EDIT_NAME') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.backspaceNameChar();
      return;
    }
    if (e.key.length === 1 && /^[a-zA-Z0-9 _\-!.]$/.test(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.typeNameChar(e.key);
      this.oskRow = 4;
      this.oskCol = 2; // focus OK so typing + Enter confirms cleanly
    }
  };

  private attachTextKeyListener(): void {
    if (this.keyListenerAttached || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onWindowKeyDown, { capture: true });
    this.keyListenerAttached = true;
  }

  private detachTextKeyListener(): void {
    if (!this.keyListenerAttached || typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onWindowKeyDown, { capture: true });
    this.keyListenerAttached = false;
  }

  private keepScrollInView(): void {
    if (this.listIdx < this.scrollTop) {
      this.scrollTop = this.listIdx;
    } else if (this.listIdx >= this.scrollTop + VISIBLE_LIST_ROWS) {
      this.scrollTop = this.listIdx - VISIBLE_LIST_ROWS + 1;
    }
  }

  // ==========================================================================
  // PIXEL-NATIVE 320x180 RENDERING
  // ==========================================================================

  render(renderer: ProfilesRenderer, palette: Palette): void {
    // Subtle ambient pixel diamonds
    const cx = LOGICAL_WIDTH * 0.5;
    const cy = LOGICAL_HEIGHT * 0.5;
    for (let i = 0; i < 3; i++) {
      const phase = ((this.animTime * 0.1 + i / 3) % 1 + 1) % 1;
      const radius = 18 + phase * 165;
      const alpha = Math.sin(phase * Math.PI) * 0.16;
      if (alpha <= 0.01) continue;
      const [r, g, b] = parseHexRgb01(palette.colors[2 + (i % 4)]);
      renderer.drawDiamondOutline(cx, cy, radius, r, g, b, alpha);
    }

    // Top bar
    drawBox(
      renderer,
      BACK_BTN_RECT.x,
      BACK_BTN_RECT.y,
      BACK_BTN_RECT.w,
      BACK_BTN_RECT.h,
      palette.colors[1],
      palette.colors[2],
      0.88,
      0.7,
    );
    renderer.drawTextHex('< BACK', BACK_BTN_RECT.x + 17, BACK_BTN_RECT.y + 3, palette.colors[2], 1, '3x5', 'center');
    renderer.drawTextHex('PLAYER PROFILES', 160, 7, palette.colors[3], 1, '5x7', 'center');
    renderer.drawTextHex(
      `${this.profiles.length} ${this.profiles.length === 1 ? 'PROFILE' : 'PROFILES'}`,
      312,
      8,
      palette.colors[2],
      0.75,
      '3x5',
      'right',
    );

    // Left column: Profile list + NEW PLAYER row
    const totalRows = this.profiles.length + 1;
    const visibleEnd = Math.min(totalRows, this.scrollTop + VISIBLE_LIST_ROWS);

    for (let i = this.scrollTop; i < visibleEnd; i++) {
      const slot = i - this.scrollTop;
      const y = 26 + slot * 20;
      const selected = i === this.listIdx;
      const listFocused = selected && this.focusArea === 'LIST';

      if (i === this.profiles.length) {
        // NEW PLAYER button row
        drawBox(
          renderer,
          8,
          y,
          156,
          18,
          palette.colors[1],
          listFocused ? palette.colors[3] : palette.colors[4],
          selected ? 0.94 : 0.5,
          selected ? 1 : 0.65,
        );
        renderer.drawTextHex(
          '+ NEW PLAYER',
          86,
          y + 6,
          listFocused ? palette.colors[3] : palette.colors[4],
          1,
          '5x7',
          'center',
        );
        continue;
      }

      const p = this.profiles[i];
      const isActive = p.id === this.activeProfileId;

      drawBox(
        renderer,
        8,
        y,
        156,
        18,
        palette.colors[1],
        listFocused ? palette.colors[3] : selected ? palette.colors[3] : palette.colors[2],
        selected ? 0.94 : 0.45,
        listFocused ? 1 : selected ? 0.85 : 0.35,
      );

      if (selected) {
        renderer.drawSpriteHex('arrow_spr', 0, 14, y + 9, palette.colors[3], 1);
      }

      const nameUpper = p.name.toUpperCase();
      const dispName = nameUpper.length > 15 ? `${nameUpper.slice(0, 14)}.` : nameUpper;
      renderer.drawTextHex(
        dispName,
        21,
        y + 3,
        selected ? palette.colors[3] : palette.colors[2],
        1,
        '5x7',
        'left',
      );

      if (isActive) {
        renderer.drawTextHex('ACTIVE', 159, y + 4, palette.colors[3], 1, '3x5', 'right');
      } else if (p.impossibleUnlocked) {
        renderer.drawSpriteHex('block_spr', 3, 156, y + 6, palette.colors[5], 1);
      }

      renderer.drawTextHex(
        `G:${p.stats.gamesPlayed}  CLR:${p.stats.blocksCleared}`,
        21,
        y + 12,
        palette.colors[2],
        0.72,
        '3x5',
        'left',
      );
    }

    // List scrollbar
    if (totalRows > VISIBLE_LIST_ROWS) {
      const trackX = 167;
      const trackY = 26;
      const trackH = VISIBLE_LIST_ROWS * 20 - 2;
      renderer.drawRectHex(trackX, trackY, 2, trackH, palette.colors[1], 0.9);
      const thumbH = Math.max(12, Math.round((VISIBLE_LIST_ROWS / totalRows) * trackH));
      const maxScroll = Math.max(1, totalRows - VISIBLE_LIST_ROWS);
      const thumbY = trackY + Math.round((this.scrollTop / maxScroll) * (trackH - thumbH));
      renderer.drawRectHex(trackX, thumbY, 2, thumbH, palette.colors[3], 1);
    }

    // Right column: Selected profile details or NEW PLAYER callout
    this.renderProfileDetailsCard(renderer, palette);

    // Bottom hint bar
    renderer.drawTextHex(
      'ENTER: SELECT  RIGHT: MANAGE PROFILE  ESC: BACK',
      160,
      166,
      palette.colors[2],
      0.68,
      '3x5',
      'center',
    );

    if (this.modal !== 'NONE') {
      this.renderModal(renderer, palette);
    }

    if (this.toastTimer > 0 && this.toastText) {
      const alpha = Math.min(1, this.toastTimer * 2);
      const w = Math.min(280, this.toastText.length * 4 + 16);
      const x = Math.round((LOGICAL_WIDTH - w) * 0.5);
      drawBox(renderer, x, 151, w, 13, palette.colors[1], palette.colors[3], 0.96 * alpha, alpha);
      renderer.drawTextHex(this.toastText, 160, 155, palette.colors[3], alpha, '3x5', 'center');
    }
  }

  private renderProfileDetailsCard(renderer: ProfilesRenderer, palette: Palette): void {
    const cardX = 174;
    const cardY = 26;
    const cardW = 138;
    const cardH = 122;
    const selected = this.getSelectedProfile();

    drawBox(
      renderer,
      cardX,
      cardY,
      cardW,
      cardH,
      palette.colors[1],
      this.focusArea === 'ACTIONS' ? palette.colors[3] : palette.colors[2],
      0.94,
      this.focusArea === 'ACTIONS' ? 1 : 0.7,
    );

    if (!selected) {
      // NEW PLAYER card preview
      const centerX = cardX + cardW * 0.5;
      renderer.drawSpriteHex('logo_diamond_spr', 0, centerX, cardY + 30, palette.colors[4], 1);
      renderer.drawTextHex('NEW PLAYER', centerX, cardY + 52, palette.colors[3], 1, '5x7', 'center');
      renderer.drawTextHex('TRACK SEPARATE SCORES,', centerX, cardY + 68, palette.colors[2], 0.85, '3x5', 'center');
      renderer.drawTextHex('STATS, AND SPEEDRUNS', centerX, cardY + 77, palette.colors[2], 0.85, '3x5', 'center');
      drawBox(
        renderer,
        ACTION_CREATE_CARD_RECT.x,
        ACTION_CREATE_CARD_RECT.y,
        ACTION_CREATE_CARD_RECT.w,
        ACTION_CREATE_CARD_RECT.h,
        palette.colors[0],
        palette.colors[3],
        0.95,
        1,
      );
      renderer.drawTextHex(
        '+ CREATE PROFILE',
        ACTION_CREATE_CARD_RECT.x + ACTION_CREATE_CARD_RECT.w * 0.5,
        ACTION_CREATE_CARD_RECT.y + 5,
        palette.colors[3],
        1,
        '3x5',
        'center',
      );
      return;
    }

    const isActive = selected.id === this.activeProfileId;
    const upperName = selected.name.toUpperCase();
    const trimName = upperName.length > 18 ? `${upperName.slice(0, 17)}.` : upperName;

    renderer.drawTextHex(trimName, cardX + 7, cardY + 7, palette.colors[3], 1, '5x7', 'left');
    renderer.drawTextHex(
      isActive ? 'ACTIVE PROFILE' : 'TAP SELECT TO SWITCH',
      cardX + 7,
      cardY + 17,
      isActive ? palette.colors[3] : palette.colors[2],
      isActive ? 1 : 0.7,
      '3x5',
      'left',
    );

    // Impossible unlock badge
    if (selected.impossibleUnlocked) {
      drawBox(renderer, cardX + 6, cardY + 26, cardW - 12, 12, palette.colors[0], palette.colors[5], 0.95, 1);
      renderer.drawSpriteHex('block_spr', 3, cardX + 14, cardY + 32, palette.colors[5], 1);
      renderer.drawTextHex('IMPOSSIBLE UNLOCKED', cardX + 22, cardY + 30, palette.colors[5], 1, '3x5', 'left');
    } else {
      drawBox(renderer, cardX + 6, cardY + 26, cardW - 12, 12, palette.colors[0], palette.colors[2], 0.5, 0.35);
      renderer.drawSpriteHex('lock_spr', 0, cardX + 14, cardY + 32, palette.colors[2], 0.55, 0.7, 0.7);
      renderer.drawTextHex('IMPOSSIBLE LOCKED', cardX + 24, cardY + 30, palette.colors[2], 0.6, '3x5', 'left');
    }

    // Key stats: Games Played, Blocks Cleared, Marathon Best, Max Combo
    const statRows: [string, string][] = [
      ['GAMES PLAYED', selected.stats.gamesPlayed.toLocaleString('en-US')],
      ['BLOCKS CLEARED', selected.stats.blocksCleared.toLocaleString('en-US')],
      ['MARATHON BEST', (selected.highScores.marathon ?? 0).toLocaleString('en-US')],
      ['LONGEST COMBO', selected.stats.longestCombo > 0 ? `x${selected.stats.longestCombo}` : '--'],
    ];

    for (let i = 0; i < statRows.length; i++) {
      const ry = cardY + 45 + i * 10;
      renderer.drawTextHex(statRows[i][0], cardX + 7, ry, palette.colors[2], 0.8, '3x5', 'left');
      renderer.drawTextHex(statRows[i][1], cardX + cardW - 7, ry, palette.colors[3], 1, '3x5', 'right');
    }

    // Action buttons: SELECT | EDIT NAME | DELETE PROFILE
    const actFocused = this.focusArea === 'ACTIONS';
    const selBtnFocused = actFocused && this.actionIdx === 0;
    const editBtnFocused = actFocused && this.actionIdx === 1;
    const delBtnFocused = actFocused && this.actionIdx === 2;
    const deleteDisabled = this.profiles.length <= 1;

    drawBox(
      renderer,
      ACTION_SELECT_RECT.x,
      ACTION_SELECT_RECT.y,
      ACTION_SELECT_RECT.w,
      ACTION_SELECT_RECT.h,
      palette.colors[0],
      selBtnFocused ? palette.colors[3] : palette.colors[2],
      selBtnFocused ? 0.96 : 0.7,
      selBtnFocused ? 1 : 0.55,
    );
    renderer.drawTextHex(
      isActive ? 'ACTIVE' : 'SELECT',
      ACTION_SELECT_RECT.x + ACTION_SELECT_RECT.w * 0.5,
      ACTION_SELECT_RECT.y + 4,
      selBtnFocused || isActive ? palette.colors[3] : palette.colors[2],
      1,
      '3x5',
      'center',
    );

    drawBox(
      renderer,
      ACTION_EDIT_RECT.x,
      ACTION_EDIT_RECT.y,
      ACTION_EDIT_RECT.w,
      ACTION_EDIT_RECT.h,
      palette.colors[0],
      editBtnFocused ? palette.colors[3] : palette.colors[2],
      editBtnFocused ? 0.96 : 0.7,
      editBtnFocused ? 1 : 0.55,
    );
    renderer.drawTextHex(
      'EDIT NAME',
      ACTION_EDIT_RECT.x + ACTION_EDIT_RECT.w * 0.5,
      ACTION_EDIT_RECT.y + 4,
      editBtnFocused ? palette.colors[3] : palette.colors[2],
      1,
      '3x5',
      'center',
    );

    drawBox(
      renderer,
      ACTION_DELETE_RECT.x,
      ACTION_DELETE_RECT.y,
      ACTION_DELETE_RECT.w,
      ACTION_DELETE_RECT.h,
      palette.colors[0],
      deleteDisabled ? palette.colors[2] : delBtnFocused ? palette.colors[5] : palette.colors[2],
      delBtnFocused && !deleteDisabled ? 0.96 : 0.65,
      deleteDisabled ? 0.25 : delBtnFocused ? 1 : 0.55,
    );
    renderer.drawTextHex(
      'DELETE PROFILE',
      ACTION_DELETE_RECT.x + ACTION_DELETE_RECT.w * 0.5,
      ACTION_DELETE_RECT.y + 4,
      deleteDisabled ? palette.colors[2] : delBtnFocused ? palette.colors[5] : palette.colors[2],
      deleteDisabled ? 0.35 : 1,
      '3x5',
      'center',
    );
  }

  private renderModal(renderer: ProfilesRenderer, palette: Palette): void {
    renderer.drawRectHex(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, palette.colors[0], 0.78);

    if (this.modal === 'DELETE_CONFIRM') {
      const target = this.profiles.find((p) => p.id === this.modalTargetProfileId);
      const targetName = target ? target.name.toUpperCase() : 'PROFILE';

      drawBox(renderer, 54, 50, 212, 76, palette.colors[1], palette.colors[5], 0.98, 1);
      renderer.drawTextHex('DELETE PROFILE?', 160, 60, palette.colors[5], 1, '5x7', 'center');
      renderer.drawTextHex(`"${targetName}"`, 160, 74, palette.colors[2], 1, '3x5', 'center');
      renderer.drawTextHex(
        'ALL SCORES & STATS WILL BE LOST',
        160,
        85,
        palette.colors[2],
        0.75,
        '3x5',
        'center',
      );

      const btns: { label: string; rect: HitRect; danger: boolean }[] = [
        { label: 'DELETE', rect: { x: 84, y: 102, w: 68, h: 14 }, danger: true },
        { label: 'CANCEL', rect: { x: 168, y: 102, w: 68, h: 14 }, danger: false },
      ];
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        const sel = i === this.deleteBtnIdx;
        const accent = b.danger ? palette.colors[5] : palette.colors[3];
        drawBox(
          renderer,
          b.rect.x,
          b.rect.y,
          b.rect.w,
          b.rect.h,
          palette.colors[0],
          sel ? accent : palette.colors[2],
          0.95,
          sel ? 1 : 0.45,
        );
        renderer.drawTextHex(
          b.label,
          b.rect.x + b.rect.w * 0.5,
          b.rect.y + 4,
          sel ? accent : palette.colors[2],
          1,
          '3x5',
          'center',
        );
      }
      return;
    }

    // CREATE_NAME or EDIT_NAME pixel keyboard modal
    drawBox(renderer, 28, 14, 264, 146, palette.colors[1], palette.colors[3], 0.98, 1);
    const title = this.modal === 'CREATE_NAME' ? 'NEW PLAYER' : 'EDIT PLAYER NAME';
    renderer.drawTextHex(title, 160, 22, palette.colors[3], 1, '5x7', 'center');

    // Live crisp pixel text field
    const hasErr = this.nameError.length > 0;
    drawBox(
      renderer,
      40,
      36,
      240,
      18,
      palette.colors[0],
      hasErr ? palette.colors[5] : palette.colors[3],
      1,
      1,
    );
    const blink = Math.floor(this.animTime * 2.5) % 2 === 0 ? '_' : '';
    renderer.drawTextHex(
      `${this.nameBuffer.toUpperCase()}${blink}`,
      46,
      42,
      palette.colors[2],
      1,
      '5x7',
      'left',
    );
    renderer.drawTextHex(
      `${this.nameBuffer.length}/${MAX_PROFILE_NAME_LEN}`,
      276,
      43,
      palette.colors[2],
      0.65,
      '3x5',
      'right',
    );

    // Inline duplicate/too-similar validation banner
    if (hasErr) {
      renderer.drawTextHex(this.nameError, 160, 59, palette.colors[5], 1, '3x5', 'center');
    } else {
      renderer.drawTextHex(
        'TYPE ON KEYBOARD OR USE PIXEL PAD',
        160,
        59,
        palette.colors[2],
        0.7,
        '3x5',
        'center',
      );
    }

    // On-screen pixel keyboard
    for (let r = 0; r < OSK_ROWS.length; r++) {
      const row = OSK_ROWS[r];
      for (let c = 0; c < row.length; c++) {
        const key = row[c];
        const rect = this.getOskKeyRect(r, c);
        const focused = r === this.oskRow && c === this.oskCol;
        const isOkBlocked = key === 'OK' && (hasErr || this.nameBuffer.trim().length === 0);
        const borderHex = isOkBlocked
          ? palette.colors[5]
          : focused
            ? palette.colors[3]
            : palette.colors[2];
        drawBox(
          renderer,
          rect.x,
          rect.y,
          rect.w,
          rect.h,
          palette.colors[0],
          borderHex,
          focused ? 1 : 0.65,
          isOkBlocked ? 0.45 : focused ? 1 : 0.45,
        );
        renderer.drawTextHex(
          key,
          rect.x + rect.w * 0.5,
          rect.y + 4,
          isOkBlocked ? palette.colors[5] : focused ? palette.colors[3] : palette.colors[2],
          isOkBlocked ? 0.55 : 1,
          '3x5',
          'center',
        );
      }
    }
  }
}
