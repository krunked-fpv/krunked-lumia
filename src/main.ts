import { GameApp } from './app/GameApp.js';
import { PackManager } from './assets/packManager.js';

type DirectoryInputElement = HTMLInputElement & { webkitdirectory?: boolean };

function createHiddenPackDirectoryInput(
  onFilesSelected: (files: FileList) => void,
): HTMLInputElement {
  const input = document.createElement('input') as DirectoryInputElement;
  input.type = 'file';
  input.multiple = true;
  input.webkitdirectory = true;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.display = 'none';

  input.addEventListener('change', () => {
    const files = input.files;
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
    input.value = '';
  });

  document.body.appendChild(input);
  return input;
}

function bootstrap(): void {
  let canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);
  }

  try {
    const app = new GameApp(canvas);
    const packManager = new PackManager();

    const focusCanvas = (): void => {
      if (!canvas) return;
      if (!canvas.hasAttribute('tabindex')) {
        canvas.setAttribute('tabindex', '-1');
      }
      canvas.focus({ preventScroll: true });
    };

    const packFileInput = createHiddenPackDirectoryInput((files) => {
      void (async () => {
        const result = await packManager.loadFromFileList(files);
        if (result.ok) {
          const applied = await app.setPackMode('custom', { silent: true });
          app.getAudioEngine().menu.playSelect();
          app.showToast(
            applied ? result.message.toUpperCase() : 'CUSTOM PACK LOADED',
            2.5,
          );
        } else {
          app.getAudioEngine().menu.playFail();
          app.showToast(result.message.toUpperCase(), 2.5);
        }
        focusCanvas();
      })();
    });

    app.registerCustomPackCallbacks({
      isCustomPackAvailable: () => packManager.isCustomPackAvailable(),
      getCustomPackStatusLabel: () => packManager.getStatusLabel(),
      getCustomPalettes: () => packManager.getCustomPalettes(),
      onApplyPackMode: async (mode) =>
        packManager.applyPackMode(mode, app.getRenderer(), app.getAudioEngine()),
      onRequestLoadCustomPack: () => {
        packFileInput.value = '';
        packFileInput.click();
      },
    });

    app.start();

    // Auto-detect IndexedDB cached pack or Vite dev-server /__lumia_assets__/manifest.json cleanly
    void (async () => {
      try {
        await packManager.init();
        const savedMode = app.getSaveManager().getSettings().packMode;
        if (savedMode === 'custom' && packManager.isCustomPackAvailable()) {
          await app.setPackMode('custom', { silent: true });
        } else if (savedMode === 'custom') {
          await app.setPackMode('builtin', { silent: true });
        }
      } catch {
        // Stay cleanly on Built-In art & harmonic synthesis if detection fails
      }
    })();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback = document.createElement('div');
    fallback.style.cssText = [
      'position:fixed',
      'inset:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:#000',
      'color:#fff7f2',
      'font-family:monospace',
      'padding:24px',
      'text-align:center',
    ].join(';');
    fallback.textContent = `Krunked Lumia requires WebGL2: ${message}`;
    document.body.appendChild(fallback);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
