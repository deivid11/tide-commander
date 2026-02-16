import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, copyFileSync } from 'fs';

export default defineConfig({
  root: resolve(__dirname, 'src/packages/landing'),
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist-landing'),
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'copy-landing-assets',
      closeBundle() {
        cpSync(
          resolve(__dirname, 'public/assets/landing'),
          resolve(__dirname, 'dist-landing/assets/landing'),
          { recursive: true },
        );
        // Copy robots.txt and sitemap.xml to root
        copyFileSync(
          resolve(__dirname, 'public/assets/landing/robots.txt'),
          resolve(__dirname, 'dist-landing/robots.txt'),
        );
        copyFileSync(
          resolve(__dirname, 'public/assets/landing/sitemap.xml'),
          resolve(__dirname, 'dist-landing/sitemap.xml'),
        );
      },
    },
  ],
});
