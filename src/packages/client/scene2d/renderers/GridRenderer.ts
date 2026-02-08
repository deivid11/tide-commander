import type { Scene2DCamera } from '../Scene2DCamera';
import { BaseRenderer } from './BaseRenderer';

export class GridRenderer extends BaseRenderer {
  constructor(ctx: CanvasRenderingContext2D, camera: Scene2DCamera) {
    super(ctx, camera);
  }

  drawGround(_size: number): void {
    const { width, height } = this.camera.getViewportSize();

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY) * 1.2;

    const gradient = this.ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, maxRadius
    );

    gradient.addColorStop(0, '#1a1f2e');
    gradient.addColorStop(0.5, '#141820');
    gradient.addColorStop(1, '#0a0c12');

    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
  }

  drawGrid(size: number, spacing: number): void {
    const bounds = this.camera.getVisibleBounds();
    const zoom = this.camera.getZoom();

    let actualSpacing = spacing;
    if (zoom < 20) actualSpacing = spacing * 2;
    if (zoom < 12) actualSpacing = spacing * 4;

    const startX = Math.floor(bounds.minX / actualSpacing) * actualSpacing;
    const endX = Math.ceil(bounds.maxX / actualSpacing) * actualSpacing;
    const startZ = Math.floor(bounds.minZ / actualSpacing) * actualSpacing;
    const endZ = Math.ceil(bounds.maxZ / actualSpacing) * actualSpacing;

    this.camera.applyTransform(this.ctx);

    const fadeRadius = size * 0.4;
    const fadeStart = fadeRadius * 0.5;

    const lineWidth = 1 / zoom;

    for (let x = startX; x <= endX; x += actualSpacing) {
      const distFromOrigin = Math.abs(x);
      let alpha = this.calculateGridAlpha(distFromOrigin, fadeStart, fadeRadius);

      const isMajor = Math.abs(x) % (actualSpacing * 5) < 0.001;
      alpha *= isMajor ? 0.12 : 0.05;

      if (alpha > 0.005) {
        this.ctx.strokeStyle = `rgba(100, 140, 180, ${alpha})`;
        this.ctx.lineWidth = isMajor ? lineWidth * 1.5 : lineWidth;
        this.ctx.beginPath();
        this.ctx.moveTo(x, bounds.minZ);
        this.ctx.lineTo(x, bounds.maxZ);
        this.ctx.stroke();
      }
    }

    for (let z = startZ; z <= endZ; z += actualSpacing) {
      const distFromOrigin = Math.abs(z);
      let alpha = this.calculateGridAlpha(distFromOrigin, fadeStart, fadeRadius);

      const isMajor = Math.abs(z) % (actualSpacing * 5) < 0.001;
      alpha *= isMajor ? 0.12 : 0.05;

      if (alpha > 0.005) {
        this.ctx.strokeStyle = `rgba(100, 140, 180, ${alpha})`;
        this.ctx.lineWidth = isMajor ? lineWidth * 1.5 : lineWidth;
        this.ctx.beginPath();
        this.ctx.moveTo(bounds.minX, z);
        this.ctx.lineTo(bounds.maxX, z);
        this.ctx.stroke();
      }
    }

    this.camera.restoreTransform(this.ctx);

    this.drawOriginMarker();

    if (zoom > 15) {
      this.drawCoordinateLabels(actualSpacing, fadeStart, fadeRadius);
    }
  }

  private calculateGridAlpha(distance: number, fadeStart: number, fadeEnd: number): number {
    if (distance <= fadeStart) return 1;
    if (distance >= fadeEnd) return 0;
    const t = (distance - fadeStart) / (fadeEnd - fadeStart);
    return 1 - (t * t);
  }

  private drawOriginMarker(): void {
    const screenOrigin = this.camera.worldToScreen(0, 0);
    const { x, y } = screenOrigin;

    const ringRadius = 12;

    const glowGradient = this.ctx.createRadialGradient(x, y, 0, x, y, ringRadius * 2);
    glowGradient.addColorStop(0, 'rgba(74, 158, 255, 0.15)');
    glowGradient.addColorStop(1, 'rgba(74, 158, 255, 0)');
    this.ctx.fillStyle = glowGradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, ringRadius * 2, 0, Math.PI * 2);
    this.ctx.fill();

    const lineLength = 20;
    const gap = 6;
    this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.4)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    this.ctx.moveTo(x - lineLength, y);
    this.ctx.lineTo(x - gap, y);
    this.ctx.moveTo(x + gap, y);
    this.ctx.lineTo(x + lineLength, y);
    this.ctx.moveTo(x, y - lineLength);
    this.ctx.lineTo(x, y - gap);
    this.ctx.moveTo(x, y + gap);
    this.ctx.lineTo(x, y + lineLength);
    this.ctx.stroke();

    this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.5)';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.fillStyle = 'rgba(74, 158, 255, 0.8)';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 2, 0, Math.PI * 2);
    this.ctx.fill();

    const tickLength = 3;
    this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.6)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - ringRadius);
    this.ctx.lineTo(x, y - ringRadius + tickLength);
    this.ctx.moveTo(x, y + ringRadius);
    this.ctx.lineTo(x, y + ringRadius - tickLength);
    this.ctx.moveTo(x - ringRadius, y);
    this.ctx.lineTo(x - ringRadius + tickLength, y);
    this.ctx.moveTo(x + ringRadius, y);
    this.ctx.lineTo(x + ringRadius - tickLength, y);
    this.ctx.stroke();
  }

  private drawCoordinateLabels(spacing: number, fadeStart: number, fadeEnd: number): void {
    const bounds = this.camera.getVisibleBounds();

    const labelInterval = spacing * 5;
    const startX = Math.floor(bounds.minX / labelInterval) * labelInterval;
    const endX = Math.ceil(bounds.maxX / labelInterval) * labelInterval;
    const startZ = Math.floor(bounds.minZ / labelInterval) * labelInterval;
    const endZ = Math.ceil(bounds.maxZ / labelInterval) * labelInterval;

    this.ctx.font = '10px "SF Mono", "Monaco", "Consolas", monospace';
    this.ctx.textBaseline = 'middle';

    for (let x = startX; x <= endX; x += labelInterval) {
      if (Math.abs(x) < 0.001) continue;

      const distFromOrigin = Math.abs(x);
      const alpha = this.calculateGridAlpha(distFromOrigin, fadeStart, fadeEnd) * 0.4;

      if (alpha > 0.02) {
        const screenPos = this.camera.worldToScreen(x, 0);
        this.ctx.fillStyle = `rgba(100, 140, 180, ${alpha})`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(x.toString(), screenPos.x, screenPos.y + 16);
      }
    }

    for (let z = startZ; z <= endZ; z += labelInterval) {
      if (Math.abs(z) < 0.001) continue;

      const distFromOrigin = Math.abs(z);
      const alpha = this.calculateGridAlpha(distFromOrigin, fadeStart, fadeEnd) * 0.4;

      if (alpha > 0.02) {
        const screenPos = this.camera.worldToScreen(0, z);
        this.ctx.fillStyle = `rgba(100, 140, 180, ${alpha})`;
        this.ctx.textAlign = 'left';
        this.ctx.fillText(z.toString(), screenPos.x + 16, screenPos.y);
      }
    }
  }
}
