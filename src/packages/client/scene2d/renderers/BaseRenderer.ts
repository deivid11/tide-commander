import type { Scene2DCamera } from '../Scene2DCamera';

// Shared hexToRgba cache across all renderers (keyed by "hex|alpha" -> rgba string)
const rgbaCache = new Map<string, string>();
const RGBA_CACHE_MAX = 512;

// Shared darken/lighten cache
const colorTransformCache = new Map<string, string>();
const COLOR_CACHE_MAX = 256;

export class BaseRenderer {
  protected ctx: CanvasRenderingContext2D;
  protected camera: Scene2DCamera;
  protected animationTime = 0;

  constructor(ctx: CanvasRenderingContext2D, camera: Scene2DCamera) {
    this.ctx = ctx;
    this.camera = camera;
  }

  setAnimationTime(time: number): void {
    this.animationTime = time;
  }

  protected roundedRect(x: number, y: number, width: number, height: number, radius: number): void {
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.arcTo(x + width, y, x + width, y + radius, radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.arcTo(x, y + height, x, y + height - radius, radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.arcTo(x, y, x + radius, y, radius);
  }

  protected roundedRectScreen(x: number, y: number, width: number, height: number, radius: number): void {
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.arcTo(x + width, y, x + width, y + radius, radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.arcTo(x, y + height, x, y + height - radius, radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.arcTo(x, y, x + radius, y, radius);
  }

  protected numberToHex(num: number): string {
    return `#${num.toString(16).padStart(6, '0')}`;
  }

  protected hexToRgba(hex: string, alpha: number): string {
    // Quantize alpha to 2 decimal places to improve cache hit rate
    const quantizedAlpha = Math.round(alpha * 100) / 100;
    const key = `${hex}|${quantizedAlpha}`;
    let result = rgbaCache.get(key);
    if (result) return result;

    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    result = `rgba(${r}, ${g}, ${b}, ${quantizedAlpha})`;

    if (rgbaCache.size >= RGBA_CACHE_MAX) rgbaCache.clear();
    rgbaCache.set(key, result);
    return result;
  }

  protected lightenColor(hex: string, factor: number): string {
    const key = `L|${hex}|${factor}`;
    let result = colorTransformCache.get(key);
    if (result) return result;

    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const newR = Math.min(255, Math.floor(r + (255 - r) * factor));
    const newG = Math.min(255, Math.floor(g + (255 - g) * factor));
    const newB = Math.min(255, Math.floor(b + (255 - b) * factor));

    result = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    if (colorTransformCache.size >= COLOR_CACHE_MAX) colorTransformCache.clear();
    colorTransformCache.set(key, result);
    return result;
  }

  protected darkenColor(hex: string, factor: number): string {
    const key = `D|${hex}|${factor}`;
    let result = colorTransformCache.get(key);
    if (result) return result;

    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const newR = Math.max(0, Math.floor(r * (1 - factor)));
    const newG = Math.max(0, Math.floor(g * (1 - factor)));
    const newB = Math.max(0, Math.floor(b * (1 - factor)));

    result = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    if (colorTransformCache.size >= COLOR_CACHE_MAX) colorTransformCache.clear();
    colorTransformCache.set(key, result);
    return result;
  }

  protected formatIdleTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }

  protected easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  protected easeInCubic(t: number): number {
    return t * t * t;
  }
}
