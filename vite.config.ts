import 'dotenv/config';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import os from 'node:os';
import fs from 'node:fs';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Vite config for local Tide Commander development.
// Port configuration - can be overridden via environment variables
const SERVER_PORT = process.env.PORT || 6200;
const VITE_PORT = process.env.VITE_PORT || 5173;
const VITE_HOST = process.env.LISTEN_ALL_INTERFACES ? '::' : '127.0.0.1';
const DEV_HTTPS = process.env.DEV_HTTPS === '1';
const DEV_TLS_KEY_PATH = process.env.DEV_TLS_KEY_PATH;
const DEV_TLS_CERT_PATH = process.env.DEV_TLS_CERT_PATH;

function getDevHttpsOptions(): { key: Buffer; cert: Buffer } | undefined {
  if (!DEV_HTTPS) {
    return undefined;
  }

  if (!DEV_TLS_KEY_PATH || !DEV_TLS_CERT_PATH) {
    throw new Error('DEV_HTTPS=1 requires DEV_TLS_KEY_PATH and DEV_TLS_CERT_PATH');
  }

  const keyPath = resolveTlsPath(DEV_TLS_KEY_PATH);
  const certPath = resolveTlsPath(DEV_TLS_CERT_PATH);

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

function resolveTlsPath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return resolve(os.homedir(), filePath.slice(2));
  }
  return resolve(process.cwd(), filePath);
}

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
    allowedHosts: true,
    https: getDevHttpsOptions(),
    // Disable bfcache in dev mode to prevent memory leaks on reload
    // This is especially important for Brave browser which aggressively caches pages
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
    proxy: {
      // Proxy terminal building traffic to the backend so relative iframe URLs
      // work in dev mode (port 5173 -> backend port)
      '/api/terminal': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
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
    // Pre-bundle heavy dependencies to reduce dev server startup and page load
    include: [
      'react', 'react-dom', 'three', 'zustand',
      'prismjs',
      'react-markdown', 'remark-gfm',
      'i18next', 'react-i18next', 'i18next-http-backend', 'i18next-browser-languagedetector',
      'fuse.js',
    ],
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
