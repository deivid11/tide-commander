import type { Building2DData } from '../Scene2D';
import type { Scene2DCamera } from '../Scene2DCamera';
import { BaseRenderer } from './BaseRenderer';

const STATUS_COLORS: Record<string, { color: string; glow: string; darkColor: string }> = {
  idle: { color: '#4aff9e', glow: 'rgba(74, 255, 158, 0.6)', darkColor: '#2a9a5e' },
  working: { color: '#4a9eff', glow: 'rgba(74, 158, 255, 0.6)', darkColor: '#2a5e9a' },
  waiting: { color: '#ffcc00', glow: 'rgba(255, 204, 0, 0.6)', darkColor: '#9a7a00' },
  waiting_permission: { color: '#ffcc00', glow: 'rgba(255, 204, 0, 0.6)', darkColor: '#9a7a00' },
  error: { color: '#ff4a4a', glow: 'rgba(255, 74, 74, 0.6)', darkColor: '#9a2a2a' },
  orphaned: { color: '#ff00ff', glow: 'rgba(255, 0, 255, 0.6)', darkColor: '#9a009a' },
};

const BUILDING_STYLES_CONFIG: Record<string, { color: string; darkColor: string; emoji: string }> = {
  'server-rack': { color: '#5a7a9a', darkColor: '#3a5a7a', emoji: '🖥️' },
  'desktop': { color: '#7a9a7a', darkColor: '#5a7a5a', emoji: '💻' },
  'filing-cabinet': { color: '#9a8a6a', darkColor: '#7a6a4a', emoji: '🗄️' },
  'factory': { color: '#9a6a6a', darkColor: '#7a4a4a', emoji: '🏭' },
  'satellite': { color: '#6a6a9a', darkColor: '#4a4a7a', emoji: '📡' },
  'crystal': { color: '#9a6a9a', darkColor: '#7a4a7a', emoji: '💎' },
  'tower': { color: '#6a9a9a', darkColor: '#4a7a7a', emoji: '🗼' },
  'dome': { color: '#7a7a9a', darkColor: '#5a5a7a', emoji: '🔮' },
  'pyramid': { color: '#9a9a6a', darkColor: '#7a7a4a', emoji: '🔺' },
  'command-center': { color: '#ba9a5a', darkColor: '#9a7a3a', emoji: '🏛️' },
};

export class BuildingRenderer extends BaseRenderer {
  constructor(ctx: CanvasRenderingContext2D, camera: Scene2DCamera) {
    super(ctx, camera);
  }

  drawBuilding(building: Building2DData, isSelected: boolean, isHovered: boolean = false): void {
    const { x, z } = building.position;
    const baseSize = 1.8 * building.scale;
    const styleConfig = BUILDING_STYLES_CONFIG[building.style] || BUILDING_STYLES_CONFIG['server-rack'];
    const statusConfig = STATUS_COLORS[building.status] || STATUS_COLORS.idle;

    let mainColor = styleConfig.color;
    let darkColor = styleConfig.darkColor;
    if (building.color) {
      mainColor = building.color;
      darkColor = this.darkenColor(building.color, 0.3);
    }

    this.camera.applyTransform(this.ctx);

    const shadowOffsetX = 0.08;
    const shadowOffsetY = 0.12;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.beginPath();
    this.roundedRect(
      x - baseSize / 2 + shadowOffsetX,
      z - baseSize / 2 + shadowOffsetY,
      baseSize,
      baseSize,
      0.15
    );
    this.ctx.fill();

    if (isSelected) {
      const glowPulse = 0.5 + Math.sin(this.animationTime * 4) * 0.2;
      this.ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
      this.ctx.shadowBlur = 15 / this.camera.getZoom();
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${glowPulse})`;
      this.ctx.lineWidth = 4 / this.camera.getZoom();
      this.ctx.beginPath();
      this.roundedRect(x - baseSize / 2 - 0.05, z - baseSize / 2 - 0.05, baseSize + 0.1, baseSize + 0.1, 0.2);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    }

    if (isHovered && !isSelected) {
      this.ctx.shadowColor = mainColor;
      this.ctx.shadowBlur = 10 / this.camera.getZoom();
      this.ctx.strokeStyle = `rgba(255, 255, 255, 0.4)`;
      this.ctx.lineWidth = 2 / this.camera.getZoom();
      this.ctx.beginPath();
      this.roundedRect(x - baseSize / 2, z - baseSize / 2, baseSize, baseSize, 0.15);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    }

    const gradient = this.ctx.createLinearGradient(
      x - baseSize / 2, z - baseSize / 2,
      x + baseSize / 2, z + baseSize / 2
    );
    gradient.addColorStop(0, this.lightenColor(mainColor, 0.2));
    gradient.addColorStop(0.3, mainColor);
    gradient.addColorStop(1, darkColor);

    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.roundedRect(x - baseSize / 2, z - baseSize / 2, baseSize, baseSize, 0.15);
    this.ctx.fill();

    this.ctx.strokeStyle = `rgba(255, 255, 255, 0.25)`;
    this.ctx.lineWidth = 2 / this.camera.getZoom();
    this.ctx.beginPath();
    this.ctx.moveTo(x - baseSize / 2 + 0.15, z - baseSize / 2 + 0.02);
    this.ctx.lineTo(x + baseSize / 2 - 0.15, z - baseSize / 2 + 0.02);
    this.ctx.stroke();

    this.ctx.strokeStyle = `rgba(0, 0, 0, 0.3)`;
    this.ctx.lineWidth = 2 / this.camera.getZoom();
    this.ctx.beginPath();
    this.ctx.moveTo(x - baseSize / 2 + 0.15, z + baseSize / 2 - 0.02);
    this.ctx.lineTo(x + baseSize / 2 - 0.15, z + baseSize / 2 - 0.02);
    this.ctx.stroke();

    const borderGlow = 0.6 + Math.sin(this.animationTime * 3) * 0.15;
    this.ctx.strokeStyle = this.hexToRgba(statusConfig.color, borderGlow);
    this.ctx.lineWidth = 3 / this.camera.getZoom();
    this.ctx.beginPath();
    this.roundedRect(x - baseSize / 2, z - baseSize / 2, baseSize, baseSize, 0.15);
    this.ctx.stroke();

    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    this.ctx.lineWidth = 1 / this.camera.getZoom();
    this.ctx.beginPath();
    this.roundedRect(x - baseSize / 2 - 0.02, z - baseSize / 2 - 0.02, baseSize + 0.04, baseSize + 0.04, 0.17);
    this.ctx.stroke();

    const indicatorRadius = 0.18 * building.scale;
    const indicatorX = x + baseSize / 2 - indicatorRadius - 0.1;
    const indicatorY = z - baseSize / 2 + indicatorRadius + 0.1;

    this.ctx.shadowColor = statusConfig.color;
    this.ctx.shadowBlur = 8 / this.camera.getZoom();

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.beginPath();
    this.ctx.arc(indicatorX, indicatorY, indicatorRadius + 0.03, 0, Math.PI * 2);
    this.ctx.fill();

    const indicatorGradient = this.ctx.createRadialGradient(
      indicatorX - indicatorRadius * 0.3, indicatorY - indicatorRadius * 0.3, 0,
      indicatorX, indicatorY, indicatorRadius
    );
    indicatorGradient.addColorStop(0, this.lightenColor(statusConfig.color, 0.4));
    indicatorGradient.addColorStop(1, statusConfig.color);

    this.ctx.fillStyle = indicatorGradient;
    this.ctx.beginPath();
    this.ctx.arc(indicatorX, indicatorY, indicatorRadius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.shadowBlur = 0;

    this.camera.restoreTransform(this.ctx);

    const screenPos = this.camera.worldToScreen(x, z);
    const emojiSize = Math.max(20, Math.min(40, 28 * this.camera.getZoom() * building.scale));

    this.ctx.font = `${emojiSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.fillText(styleConfig.emoji, screenPos.x + 1, screenPos.y + 1);

    this.ctx.fillText(styleConfig.emoji, screenPos.x, screenPos.y);

    const labelScreenPos = this.camera.worldToScreen(x, z + baseSize / 2 + 0.25);
    const fontSize = Math.max(10, Math.min(14, 12 * this.camera.getZoom()));

    this.ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    const nameWidth = this.ctx.measureText(building.name).width;
    const labelPadding = 6;
    const labelHeight = fontSize + 6;

    const labelBgGradient = this.ctx.createLinearGradient(
      labelScreenPos.x - nameWidth / 2 - labelPadding,
      labelScreenPos.y - labelHeight / 2,
      labelScreenPos.x - nameWidth / 2 - labelPadding,
      labelScreenPos.y + labelHeight / 2
    );
    labelBgGradient.addColorStop(0, 'rgba(30, 35, 40, 0.9)');
    labelBgGradient.addColorStop(1, 'rgba(20, 25, 30, 0.95)');

    this.ctx.fillStyle = labelBgGradient;
    this.ctx.beginPath();
    this.roundedRectScreen(
      labelScreenPos.x - nameWidth / 2 - labelPadding,
      labelScreenPos.y - labelHeight / 2,
      nameWidth + labelPadding * 2,
      labelHeight,
      4
    );
    this.ctx.fill();

    this.ctx.strokeStyle = this.hexToRgba(mainColor, 0.6);
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.roundedRectScreen(
      labelScreenPos.x - nameWidth / 2 - labelPadding,
      labelScreenPos.y - labelHeight / 2,
      nameWidth + labelPadding * 2,
      labelHeight,
      4
    );
    this.ctx.stroke();

    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(building.name, labelScreenPos.x, labelScreenPos.y);
  }

  drawBossLine(from: { x: number; z: number }, to: { x: number; z: number }): void {
    this.camera.applyTransform(this.ctx);

    this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
    this.ctx.lineWidth = 2 / this.camera.getZoom();
    this.ctx.setLineDash([4 / this.camera.getZoom(), 4 / this.camera.getZoom()]);

    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.z);
    this.ctx.lineTo(to.x, to.z);
    this.ctx.stroke();

    this.ctx.setLineDash([]);

    this.camera.restoreTransform(this.ctx);
  }
}
