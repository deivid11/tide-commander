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
      // CodeMirror: pre-bundle ALL entry points used by the file viewer/editor
      // (EmbeddedEditor.tsx + cm-languages.ts) at startup. If these are left to
      // lazy discovery, opening the editor triggers a mid-session dependency
      // re-optimization + page reload, which can leave two copies of
      // @codemirror/state loaded and break instanceof checks
      // ("Unrecognized extension value in extension set"). Listing them here
      // forces a single, consistent optimized bundle.
      '@codemirror/state', '@codemirror/view', '@codemirror/commands',
      '@codemirror/language', '@codemirror/autocomplete', '@codemirror/search',
      '@codemirror/theme-one-dark',
      '@codemirror/lang-javascript', '@codemirror/lang-python', '@codemirror/lang-html',
      '@codemirror/lang-css', '@codemirror/lang-json', '@codemirror/lang-markdown',
      '@codemirror/lang-sql', '@codemirror/lang-rust', '@codemirror/lang-cpp',
      '@codemirror/lang-java', '@codemirror/lang-php', '@codemirror/lang-xml',
      '@codemirror/lang-yaml',
      '@codemirror/legacy-modes/mode/clike', '@codemirror/legacy-modes/mode/ruby',
      '@codemirror/legacy-modes/mode/swift', '@codemirror/legacy-modes/mode/shell',
      '@codemirror/legacy-modes/mode/toml', '@codemirror/legacy-modes/mode/go',
      '@codemirror/legacy-modes/mode/groovy', '@codemirror/legacy-modes/mode/lua',
      '@codemirror/legacy-modes/mode/perl', '@codemirror/legacy-modes/mode/r',
      '@codemirror/legacy-modes/mode/haskell', '@codemirror/legacy-modes/mode/clojure',
      '@codemirror/legacy-modes/mode/erlang', '@codemirror/legacy-modes/mode/dockerfile',
      '@codemirror/legacy-modes/mode/diff', '@codemirror/legacy-modes/mode/powershell',
      '@codemirror/legacy-modes/mode/nginx', '@codemirror/legacy-modes/mode/d',
      '@codemirror/legacy-modes/mode/elm', '@codemirror/legacy-modes/mode/julia',
      '@codemirror/legacy-modes/mode/mllike', '@codemirror/legacy-modes/mode/vb',
      '@codemirror/legacy-modes/mode/properties', '@codemirror/legacy-modes/mode/cmake',
      '@codemirror/legacy-modes/mode/pascal', '@codemirror/legacy-modes/mode/cobol',
      '@codemirror/legacy-modes/mode/fortran', '@codemirror/legacy-modes/mode/tcl',
      '@codemirror/legacy-modes/mode/sass', '@codemirror/legacy-modes/mode/stylus',
      '@codemirror/legacy-modes/mode/wast', '@codemirror/legacy-modes/mode/stex',
      '@codemirror/legacy-modes/mode/protobuf', '@codemirror/legacy-modes/mode/gas',
      '@codemirror/legacy-modes/mode/verilog', '@codemirror/legacy-modes/mode/vhdl',
      '@codemirror/legacy-modes/mode/crystal',
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
