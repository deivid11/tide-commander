import type { Area2DData } from '../Scene2D';
import type { Scene2DCamera } from '../Scene2DCamera';
import { BaseRenderer } from './BaseRenderer';

export class AreaRenderer extends BaseRenderer {
  constructor(ctx: CanvasRenderingContext2D, camera: Scene2DCamera) {
    super(ctx, camera);
  }

  drawArea(area: Area2DData, isSelected: boolean = false): void {
    this.camera.applyTransform(this.ctx);

    const { x, z } = area.position;
    const baseColor = area.color || '#4a9eff';
    const zoom = this.camera.getZoom();

    const dashOffset = (this.animationTime * 20) % 24;

    if (area.type === 'rectangle' && 'width' in area.size) {
      const { width, height } = area.size;
      const left = x - width / 2;
      const top = z - height / 2;

      this.drawRectangleArea(left, top, width, height, baseColor, zoom, dashOffset, isSelected);

      if (area.label) {
        this.drawAreaLabel(area.label, x, top, baseColor, zoom, 'top');
      }

      if (area.hasDirectories) {
        const iconSize = 0.5;
        this.drawFolderIcon(left + iconSize * 0.8, top + iconSize * 0.8, iconSize, baseColor, zoom);
      }

      if (isSelected) {
        this.drawRectangleResizeHandles(x, z, width, height, baseColor, zoom);
      }
    } else if (area.type === 'circle' && 'radius' in area.size) {
      const { radius } = area.size;

      this.drawCircleArea(x, z, radius, baseColor, zoom, dashOffset, isSelected);

      if (area.label) {
        this.drawAreaLabel(area.label, x, z - radius, baseColor, zoom, 'top');
      }

      if (area.hasDirectories) {
        const iconSize = 0.5;
        const offset = radius * 0.707; // cos(45deg) for top-left of circle
        this.drawFolderIcon(x - offset + iconSize * 0.5, z - offset + iconSize * 0.5, iconSize, baseColor, zoom);
      }

      if (isSelected) {
        this.drawCircleResizeHandles(x, z, radius, baseColor, zoom);
      }
    }

    this.camera.restoreTransform(this.ctx);
  }

  private drawRectangleArea(
    left: number,
    top: number,
    width: number,
    height: number,
    baseColor: string,
    zoom: number,
    dashOffset: number,
    isSelected: boolean = false
  ): void {
    const ctx = this.ctx;
    const cornerSize = Math.min(width, height) * 0.08;

    if (isSelected) {
      const glowPulse = 0.5 + Math.sin(this.animationTime * 3) * 0.2;
      ctx.save();
      ctx.shadowColor = this.hexToRgba(baseColor, glowPulse);
      ctx.shadowBlur = 20;
      ctx.strokeStyle = this.hexToRgba(baseColor, glowPulse * 0.8);
      ctx.lineWidth = 4 / zoom;
      ctx.beginPath();
      ctx.rect(left - 2 / zoom, top - 2 / zoom, width + 4 / zoom, height + 4 / zoom);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = this.hexToRgba(baseColor, isSelected ? 0.6 : 0.4);
    ctx.shadowBlur = isSelected ? 16 : 12;
    ctx.fillStyle = 'transparent';
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.fill();
    ctx.restore();

    const baseOpacity = isSelected ? 0.25 : 0.15;
    const gradient = ctx.createLinearGradient(left, top, left + width, top + height);
    gradient.addColorStop(0, this.hexToRgba(baseColor, baseOpacity));
    gradient.addColorStop(0.5, this.hexToRgba(baseColor, baseOpacity * 0.5));
    gradient.addColorStop(1, this.hexToRgba(baseColor, baseOpacity * 1.3));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.fill();

    const innerHighlight = ctx.createLinearGradient(left, top, left + width, top);
    innerHighlight.addColorStop(0, 'transparent');
    innerHighlight.addColorStop(0.2, this.hexToRgba(baseColor, 0.3));
    innerHighlight.addColorStop(0.8, this.hexToRgba(baseColor, 0.3));
    innerHighlight.addColorStop(1, 'transparent');

    ctx.strokeStyle = innerHighlight;
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.moveTo(left + cornerSize, top + 2 / zoom);
    ctx.lineTo(left + width - cornerSize, top + 2 / zoom);
    ctx.stroke();

    const innerShadow = ctx.createLinearGradient(left, top + height, left + width, top + height);
    innerShadow.addColorStop(0, 'transparent');
    innerShadow.addColorStop(0.2, this.hexToRgba(this.darkenColor(baseColor, 0.5), 0.4));
    innerShadow.addColorStop(0.8, this.hexToRgba(this.darkenColor(baseColor, 0.5), 0.4));
    innerShadow.addColorStop(1, 'transparent');

    ctx.strokeStyle = innerShadow;
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.moveTo(left + cornerSize, top + height - 2 / zoom);
    ctx.lineTo(left + width - cornerSize, top + height - 2 / zoom);
    ctx.stroke();

    ctx.strokeStyle = this.hexToRgba(baseColor, 0.7);
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([8 / zoom, 4 / zoom]);
    ctx.lineDashOffset = -dashOffset / zoom;

    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.strokeStyle = this.hexToRgba(baseColor, 0.9);
    ctx.lineWidth = 3 / zoom;
    ctx.lineCap = 'round';

    this.drawCornerMark(left, top, cornerSize, 'top-left');
    this.drawCornerMark(left + width, top, cornerSize, 'top-right');
    this.drawCornerMark(left, top + height, cornerSize, 'bottom-left');
    this.drawCornerMark(left + width, top + height, cornerSize, 'bottom-right');

    ctx.fillStyle = baseColor;
    const dotRadius = 3 / zoom;
    const corners = [
      { x: left, y: top },
      { x: left + width, y: top },
      { x: left, y: top + height },
      { x: left + width, y: top + height },
    ];
    for (const corner of corners) {
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCornerMark(
    x: number,
    y: number,
    size: number,
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();

    switch (position) {
      case 'top-left':
        ctx.moveTo(x, y + size);
        ctx.lineTo(x, y);
        ctx.lineTo(x + size, y);
        break;
      case 'top-right':
        ctx.moveTo(x - size, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + size);
        break;
      case 'bottom-left':
        ctx.moveTo(x, y - size);
        ctx.lineTo(x, y);
        ctx.lineTo(x + size, y);
        break;
      case 'bottom-right':
        ctx.moveTo(x - size, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - size);
        break;
    }

    ctx.stroke();
  }

  private drawCircleArea(
    cx: number,
    cy: number,
    radius: number,
    baseColor: string,
    zoom: number,
    dashOffset: number,
    isSelected: boolean = false
  ): void {
    const ctx = this.ctx;

    if (isSelected) {
      const glowPulse = 0.5 + Math.sin(this.animationTime * 3) * 0.2;
      ctx.save();
      ctx.shadowColor = this.hexToRgba(baseColor, glowPulse);
      ctx.shadowBlur = 20;
      ctx.strokeStyle = this.hexToRgba(baseColor, glowPulse * 0.8);
      ctx.lineWidth = 4 / zoom;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3 / zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = this.hexToRgba(baseColor, isSelected ? 0.6 : 0.4);
    ctx.shadowBlur = isSelected ? 16 : 12;
    ctx.fillStyle = 'transparent';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const baseOpacity = isSelected ? 0.3 : 0.2;
    const gradient = ctx.createRadialGradient(cx, cy - radius * 0.3, 0, cx, cy, radius);
    gradient.addColorStop(0, this.hexToRgba(baseColor, baseOpacity));
    gradient.addColorStop(0.6, this.hexToRgba(baseColor, baseOpacity * 0.5));
    gradient.addColorStop(1, this.hexToRgba(baseColor, baseOpacity * 0.9));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    const highlightGradient = ctx.createLinearGradient(
      cx - radius * 0.7,
      cy - radius,
      cx + radius * 0.7,
      cy - radius
    );
    highlightGradient.addColorStop(0, 'transparent');
    highlightGradient.addColorStop(0.3, this.hexToRgba(baseColor, 0.4));
    highlightGradient.addColorStop(0.7, this.hexToRgba(baseColor, 0.4));
    highlightGradient.addColorStop(1, 'transparent');

    ctx.strokeStyle = highlightGradient;
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2 / zoom, -Math.PI * 0.8, -Math.PI * 0.2);
    ctx.stroke();

    ctx.strokeStyle = this.hexToRgba(baseColor, 0.7);
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([8 / zoom, 4 / zoom]);
    ctx.lineDashOffset = -dashOffset / zoom;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);

    const dotCount = 8;
    const dotRadius = 3 / zoom;
    ctx.fillStyle = baseColor;

    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * Math.PI * 2 - Math.PI / 2;
      const dotX = cx + Math.cos(angle) * radius;
      const dotY = cy + Math.sin(angle) * radius;

      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    const cardinalDotRadius = 4.5 / zoom;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 - Math.PI / 2;
      const dotX = cx + Math.cos(angle) * radius;
      const dotY = cy + Math.sin(angle) * radius;

      ctx.beginPath();
      ctx.arc(dotX, dotY, cardinalDotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawAreaLabel(
    label: string,
    x: number,
    y: number,
    baseColor: string,
    zoom: number,
    position: 'top' | 'center'
  ): void {
    const ctx = this.ctx;
    const fontSize = 11 / zoom;
    const padding = 6 / zoom;
    const offsetY = position === 'top' ? -8 / zoom : 0;

    ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const textHeight = fontSize;

    const bgWidth = textWidth + padding * 2;
    const bgHeight = textHeight + padding;
    const bgX = x - bgWidth / 2;
    const bgY = y + offsetY - bgHeight / 2;
    const borderRadius = 4 / zoom;

    const bgGradient = ctx.createLinearGradient(bgX, bgY, bgX, bgY + bgHeight);
    bgGradient.addColorStop(0, this.hexToRgba(this.darkenColor(baseColor, 0.7), 0.9));
    bgGradient.addColorStop(1, this.hexToRgba(this.darkenColor(baseColor, 0.5), 0.9));

    ctx.fillStyle = bgGradient;
    ctx.beginPath();
    this.roundedRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
    ctx.fill();

    ctx.strokeStyle = this.hexToRgba(baseColor, 0.8);
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    this.roundedRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
    ctx.stroke();

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = this.lightenColor(baseColor, 0.3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + offsetY);

    ctx.restore();
  }

  private drawRectangleResizeHandles(
    cx: number,
    cz: number,
    width: number,
    height: number,
    _baseColor: string,
    zoom: number
  ): void {
    const handleRadius = 0.25;
    const handlePulse = 0.8 + Math.sin(this.animationTime * 4) * 0.2;

    const corners = [
      { x: cx - width / 2, z: cz - height / 2 },
      { x: cx + width / 2, z: cz - height / 2 },
      { x: cx - width / 2, z: cz + height / 2 },
      { x: cx + width / 2, z: cz + height / 2 },
    ];

    for (const corner of corners) {
      this.drawResizeHandle(corner.x, corner.z, handleRadius, '#ffffff', zoom, handlePulse);
    }

    // Edge handles (midpoints of each side) - light blue, slightly smaller
    const edges = [
      { x: cx, z: cz - height / 2 }, // north
      { x: cx, z: cz + height / 2 }, // south
      { x: cx + width / 2, z: cz },  // east
      { x: cx - width / 2, z: cz },  // west
    ];

    for (const edge of edges) {
      this.drawResizeHandle(edge.x, edge.z, handleRadius * 0.8, '#aaddff', zoom, handlePulse);
    }

    this.drawResizeHandle(cx, cz, handleRadius * 1.2, '#ffcc00', zoom, handlePulse, true);
  }

  private drawCircleResizeHandles(
    cx: number,
    cz: number,
    radius: number,
    _baseColor: string,
    zoom: number
  ): void {
    const handleRadius = 0.25;
    const handlePulse = 0.8 + Math.sin(this.animationTime * 4) * 0.2;

    this.drawResizeHandle(cx + radius, cz, handleRadius, '#ffffff', zoom, handlePulse);
    this.drawResizeHandle(cx, cz, handleRadius * 1.2, '#ffcc00', zoom, handlePulse, true);
  }

  private drawResizeHandle(
    x: number,
    z: number,
    radius: number,
    color: string,
    zoom: number,
    pulse: number,
    isMove: boolean = false
  ): void {
    const ctx = this.ctx;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.arc(x, z, radius * 1.3, 0, Math.PI * 2);
    ctx.fill();

    const gradient = ctx.createRadialGradient(
      x - radius * 0.3, z - radius * 0.3, 0,
      x, z, radius
    );
    gradient.addColorStop(0, this.lightenColor(color, 0.3));
    gradient.addColorStop(0.5, color);
    gradient.addColorStop(1, this.darkenColor(color, 0.2));

    ctx.fillStyle = gradient;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(x, z, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.arc(x, z, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (isMove) {
      const iconSize = radius * 0.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 2 / zoom;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(x - iconSize, z);
      ctx.lineTo(x + iconSize, z);
      ctx.moveTo(x, z - iconSize);
      ctx.lineTo(x, z + iconSize);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawFolderIcon(
    cx: number,
    cz: number,
    size: number,
    baseColor: string,
    zoom: number
  ): void {
    const ctx = this.ctx;
    const s = size * 0.45; // Scale factor for the icon

    ctx.save();

    // Background circle
    ctx.fillStyle = this.hexToRgba(this.darkenColor(baseColor, 0.6), 0.85);
    ctx.beginPath();
    ctx.arc(cx, cz, s * 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = this.hexToRgba(baseColor, 0.8);
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.arc(cx, cz, s * 1.1, 0, Math.PI * 2);
    ctx.stroke();

    // Draw folder shape
    const fw = s * 1.2; // folder width
    const fh = s * 0.9; // folder height
    const tabW = fw * 0.35;
    const tabH = fh * 0.2;
    const r = fh * 0.08; // corner radius

    const fx = cx - fw / 2;
    const fy = cz - fh / 2;

    // Folder body
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.moveTo(fx + r, fy + tabH);
    ctx.lineTo(fx + tabW, fy + tabH);
    ctx.lineTo(fx + tabW + tabH * 0.6, fy);
    ctx.lineTo(fx + tabW + tabW * 0.4, fy);
    // Top-left of tab
    ctx.lineTo(fx + r, fy);
    ctx.arcTo(fx, fy, fx, fy + r, r);
    // Left side to bottom
    ctx.lineTo(fx, fy + fh - r);
    ctx.arcTo(fx, fy + fh, fx + r, fy + fh, r);
    // Bottom
    ctx.lineTo(fx + fw - r, fy + fh);
    ctx.arcTo(fx + fw, fy + fh, fx + fw, fy + fh - r, r);
    // Right side to top
    ctx.lineTo(fx + fw, fy + tabH + r);
    ctx.arcTo(fx + fw, fy + tabH, fx + fw - r, fy + tabH, r);
    ctx.closePath();
    ctx.fill();

    // Highlight line on folder body
    ctx.strokeStyle = this.hexToRgba(this.lightenColor(baseColor, 0.3), 0.6);
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(fx + r, fy + tabH + fh * 0.08);
    ctx.lineTo(fx + fw - r, fy + tabH + fh * 0.08);
    ctx.stroke();

    ctx.restore();
  }

  drawAreaPreview(
    start: { x: number; z: number },
    end: { x: number; z: number },
    tool: 'rectangle' | 'circle'
  ): void {
    const zoom = this.camera.getZoom();
    const ctx = this.ctx;
    const areaColor = '#4a9eff';

    this.camera.applyTransform(ctx);

    if (tool === 'rectangle') {
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minZ = Math.min(start.z, end.z);
      const maxZ = Math.max(start.z, end.z);
      const width = maxX - minX;
      const height = maxZ - minZ;

      if (width < 0.1 && height < 0.1) {
        this.camera.restoreTransform(ctx);
        return;
      }

      ctx.fillStyle = 'rgba(74, 158, 255, 0.2)';
      ctx.fillRect(minX, minZ, width, height);

      const dashOffset = (this.animationTime * 30) % 20;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.lineDashOffset = -dashOffset / zoom;
      ctx.strokeStyle = areaColor;
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(minX, minZ, width, height);
      ctx.setLineDash([]);
    } else if (tool === 'circle') {
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const radius = Math.sqrt(dx * dx + dz * dz);

      if (radius < 0.1) {
        this.camera.restoreTransform(ctx);
        return;
      }

      ctx.fillStyle = 'rgba(74, 158, 255, 0.2)';
      ctx.beginPath();
      ctx.arc(start.x, start.z, radius, 0, Math.PI * 2);
      ctx.fill();

      const dashOffset = (this.animationTime * 30) % 20;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.lineDashOffset = -dashOffset / zoom;
      ctx.strokeStyle = areaColor;
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.arc(start.x, start.z, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    this.camera.restoreTransform(ctx);
  }
}
