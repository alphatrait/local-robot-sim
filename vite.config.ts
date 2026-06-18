import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const simulationsDir = resolve(projectRoot, 'simulations');

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Ensures wasm/js assets embed correctly under COEP require-corp. */
function crossOriginResourcePolicy(): Plugin {
  return {
    name: 'cross-origin-resource-policy',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        next();
      });
    },
  };
}

function serveSimulations(): Plugin {
  return {
    name: 'serve-simulations',
    configureServer(server) {
      server.middlewares.use('/simulations', (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(req.url.replace(/^\//, '').split('?')[0]);
        const filePath = resolve(simulationsDir, relativePath);

        if (!filePath.startsWith(simulationsDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next();
          return;
        }

        const ext = filePath.split('.').pop() ?? '';
        const contentTypes: Record<string, string> = {
          yaml: 'text/yaml; charset=utf-8',
          urdf: 'application/xml; charset=utf-8',
          py: 'text/plain; charset=utf-8',
        };
        res.setHeader('Content-Type', contentTypes[ext] ?? 'text/plain; charset=utf-8');
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    crossOriginResourcePolicy(),
    serveSimulations(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/pyodide/*',
          dest: 'pyodide',
        },
        {
          src: 'examples.yaml',
          dest: '.',
        },
        {
          src: 'simulations/**/*',
          dest: 'simulations',
        },
      ],
    }),
  ],
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat', 'pyodide'],
  },
  assetsInclude: ['**/*.wasm'],
});
