import 'dotenv/config';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Port configuration - can be overridden via environment variables
const SERVER_PORT = process.env.PORT || 6200;
const VITE_PORT = process.env.VITE_PORT || 5173;
const VITE_HOST = process.env.LISTEN_ALL_INTERFACES ? '::' : '127.0.0.1';

export default defineConfig({
  plugins: [react()],
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
  server: {
    host: VITE_HOST,
    port: Number(VITE_PORT),
    // Disable bfcache in dev mode to prevent memory leaks on reload
    // This is especially important for Brave browser which aggressively caches pages
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
    hmr: {
      overlay: false, // Reduces memory overhead from error overlay
    },
    watch: {
      usePolling: false, // Use native file watching (less CPU/RAM than polling)
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    },
  },
  optimizeDeps: {
    // Pre-bundle heavy dependencies to reduce dev server memory usage
    include: ['react', 'react-dom', 'three', 'zustand'],
    // Exclude large deps that don't need pre-bundling
    exclude: [],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false, // Disable source maps in prod for smaller output
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'src/packages/landing/index.html'),
      },
      output: {
        // Manual chunk splitting to reduce initial bundle size
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-three': ['three'],
        },
      },
    },
  },
});
