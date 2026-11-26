import { GameApp } from './app/GameApp.js';

function bootstrap(): void {
  let canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);
  }

  try {
    const app = new GameApp(canvas);
    app.start();
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
