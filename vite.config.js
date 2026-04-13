import { defineConfig } from 'vite';
import reactRefresh from '@vitejs/plugin-react-refresh';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ensureStructuredClone } from './viteStructuredCloneFallback.mjs';

ensureStructuredClone();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const target = process.env.VITE_APP_TARGET;

function pandaSuiteManifestPlugin() {
  return {
    name: 'pandasuite-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/pandasuite.json') {
          return next();
        }
        const referer = req.headers.referer || '';
        const variant = referer.includes('session.html') ? 'session' : 'auth';
        const manifestPath = path.resolve(
          __dirname,
          'src',
          'json',
          variant,
          'pandasuite.json',
        );
        res.setHeader('Content-Type', 'application/json');
        const stream = fs.createReadStream(manifestPath);
        stream.on('error', () => {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: `Manifest not found: ${variant}` }));
        });
        stream.pipe(res);
      });
    },
  };
}

function buildInput() {
  if (target === 'session')
    return { session: path.resolve(__dirname, 'session.html') };
  return { main: path.resolve(__dirname, 'index.html') };
}

export default defineConfig({
  plugins: [reactRefresh(), pandaSuiteManifestPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    rollupOptions: {
      input: buildInput(),
    },
  },
});
