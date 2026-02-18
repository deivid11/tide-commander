/**
 * Vite config for building the app as a static site at /app/ path.
 * Used when deploying to tidecommander.com/app (no backend server).
 * The app shows a "not connected" overlay where users can set a backend URL.
 */
import 'dotenv/config';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

const SERVER_PORT = process.env.PORT || 6200;

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __SERVER_PORT__: JSON.stringify(Number(SERVER_PORT)),
  },
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/packages/client'),
      '@shared': resolve(__dirname, 'src/packages/shared'),
      '@server': resolve(__dirname, 'src/packages/server'),
    },
  },
  build: {
    outDir: 'dist-app',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-three': ['three'],
        },
      },
    },
  },
});
