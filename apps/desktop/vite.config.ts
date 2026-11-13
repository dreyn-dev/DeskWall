import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// Two pages: the settings window (index.html) and the wallpaper surface (wallpaper.html).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5180,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5181 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2023',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // three.js WebGPU build is ~800 kB; it loads from disk, not the network.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        settings: resolve(import.meta.dirname, 'index.html'),
        wallpaper: resolve(import.meta.dirname, 'wallpaper.html'),
      },
    },
  },
});
