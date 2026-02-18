/**
 * Returns the base path for static assets.
 * Uses Vite's BASE_URL which is '/' for normal builds and '/app/' for static builds.
 */
export const ASSET_BASE = import.meta.env.BASE_URL;

/**
 * Resolves a path like '/assets/foo.png' to the correct base-prefixed path.
 * In normal builds: '/assets/foo.png' (unchanged)
 * In static builds: '/app/assets/foo.png'
 */
export function assetPath(path: string): string {
  // Strip leading slash to avoid double slash
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${ASSET_BASE}${clean}`;
}
