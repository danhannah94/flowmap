// The web UI build (design.md §9). `pnpm build:ui` writes the static app to dist/ui, which `flowmap serve` serves.
// `pnpm dev:ui` runs Vite's dev server and proxies /api to a running `flowmap serve` (FLOWMAP_API, default :4870).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.FLOWMAP_API ?? 'http://127.0.0.1:4870';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: '/',
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: api, changeOrigin: false } },
  },
});
