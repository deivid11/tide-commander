import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, copyFileSync, existsSync } from 'fs';

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
        // Copy the static app build into dist-landing/app/ (built by vite.app-static.config.ts)
        const appDist = resolve(__dirname, 'dist-app');
        if (existsSync(appDist)) {
          cpSync(appDist, resolve(__dirname, 'dist-landing/app'), { recursive: true });
          console.log('Copied app build to dist-landing/app/');
        }
      },
    },
  ],
});
