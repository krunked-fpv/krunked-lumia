import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const LUMIA_ASSETS_DIR = path.resolve(__dirname, '.lumia-assets');

const MIME_MAP: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.ini': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Dev-only middleware serving locally extracted .lumia-assets/ at /__lumia_assets__/.
 * Never copies or bundles .lumia-assets/ into dist/.
 */
function localLumiaAssetsPlugin(): Plugin {
  return {
    name: 'krunked-local-lumia-assets',
    configureServer(server) {
      server.middlewares.use('/__lumia_assets__', (req, res, next) => {
        if (!fs.existsSync(LUMIA_ASSETS_DIR)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ available: false }));
          return;
        }
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const safeRel = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
        const fullPath = path.resolve(LUMIA_ASSETS_DIR, safeRel);
        if (!fullPath.startsWith(LUMIA_ASSETS_DIR)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const ext = path.extname(fullPath).toLowerCase();
          res.statusCode = 200;
          res.setHeader('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(fullPath).pipe(res);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [localLumiaAssetsPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
