import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

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

export default defineConfig({
  plugins: [
    crossOriginResourcePolicy(),
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
