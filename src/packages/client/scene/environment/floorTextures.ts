/**
 * Floor Texture Generators
 *
 * Procedural texture generation for different floor styles.
 */

import * as THREE from 'three';
import type { FloorStyle } from './types';

/**
 * Generate a floor texture programmatically.
 */
export function generateFloorTexture(style: FloorStyle): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 512;

  switch (style) {
    case 'galactic':
      drawGalacticTexture(ctx, canvas.width, canvas.height);
      break;
    case 'metal':
      drawMetalTexture(ctx, canvas.width, canvas.height);
      break;
    case 'hex':
      drawHexTexture(ctx, canvas.width, canvas.height);
      break;
    case 'circuit':
      drawCircuitTexture(ctx, canvas.width, canvas.height);
      break;
    default:
      drawConcreteTexture(ctx, canvas.width, canvas.height);
  }

  return new THREE.CanvasTexture(canvas);
}

/**
 * Draw concrete floor texture.
 */
export function drawConcreteTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Base color
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(0, 0, w, h);

  // Add noise/grain
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const brightness = 60 + Math.random() * 40;
    ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.3)`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Add cracks
  ctx.strokeStyle = 'rgba(30, 30, 30, 0.4)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    let x = Math.random() * w;
    let y = Math.random() * h;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += (Math.random() - 0.5) * 100;
      y += (Math.random() - 0.5) * 100;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * Draw galactic/space floor texture.
 */
export function drawGalacticTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Deep space background
  const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 1.5);
  gradient.addColorStop(0, '#1a0a30');
  gradient.addColorStop(0.5, '#0d0520');
  gradient.addColorStop(1, '#050210');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Nebula clouds
  for (let i = 0; i < 3; i++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    const radius = 100 + Math.random() * 150;
    const colors = ['#ff00ff', '#00ffff', '#ff6600', '#6600ff', '#00ff66'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const nebula = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    nebula.addColorStop(0, color.replace('ff', '66') + '40');
    nebula.addColorStop(0.5, color + '20');
    nebula.addColorStop(1, 'transparent');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, w, h);
  }

  // Stars
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const size = Math.random() * 2;
    const brightness = 150 + Math.random() * 105;

    // Star glow
    if (Math.random() > 0.8) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
      glow.addColorStop(0, `rgba(${brightness}, ${brightness}, 255, 0.8)`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(x - size * 4, y - size * 4, size * 8, size * 8);
    }

    ctx.fillStyle = `rgba(${brightness}, ${brightness}, 255, 1)`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Galaxy spiral hints
  ctx.strokeStyle = 'rgba(100, 50, 150, 0.15)';
  ctx.lineWidth = 20;
  ctx.beginPath();
  for (let angle = 0; angle < Math.PI * 4; angle += 0.1) {
    const r = 20 + angle * 30;
    const x = w / 2 + Math.cos(angle) * r;
    const y = h / 2 + Math.sin(angle) * r;
    if (angle === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Draw brushed metal floor texture.
 */
export function drawMetalTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Base metal
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, 0, w, h);

  // Brushed metal effect
  for (let i = 0; i < 200; i++) {
    const y = Math.random() * h;
    const brightness = 50 + Math.random() * 30;
    ctx.strokeStyle = `rgba(${brightness + 20}, ${brightness + 20}, ${brightness + 30}, 0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y + (Math.random() - 0.5) * 4);
    ctx.stroke();
  }

  // Grid lines
  ctx.strokeStyle = 'rgba(20, 20, 25, 0.8)';
  ctx.lineWidth = 3;
  const gridSize = w / 4;

  for (let x = 0; x <= w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (let y = 0; y <= h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Rivets/bolts at intersections
  ctx.fillStyle = '#555566';
  for (let x = 0; x <= w; x += gridSize) {
    for (let y = 0; y <= h; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Highlight
      ctx.fillStyle = '#666677';
      ctx.beginPath();
      ctx.arc(x - 2, y - 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#555566';
    }
  }
}

/**
 * Draw hexagonal grid floor texture.
 */
export function drawHexTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Dark base
  ctx.fillStyle = '#1a2530';
  ctx.fillRect(0, 0, w, h);

  const hexRadius = 30;
  const hexHeight = hexRadius * Math.sqrt(3);

  // Draw hexagon grid
  for (let row = -1; row < h / hexHeight + 1; row++) {
    for (let col = -1; col < w / (hexRadius * 1.5) + 1; col++) {
      const x = col * hexRadius * 1.5;
      const y = row * hexHeight + (col % 2 === 0 ? 0 : hexHeight / 2);

      // Hex fill with slight variation
      const brightness = 30 + Math.random() * 20;
      ctx.fillStyle = `rgb(${brightness}, ${brightness + 20}, ${brightness + 40})`;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i + Math.PI / 6;
        const hx = x + Math.cos(angle) * (hexRadius - 2);
        const hy = y + Math.sin(angle) * (hexRadius - 2);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fill();

      // Hex border (glowing edge)
      ctx.strokeStyle = 'rgba(80, 150, 200, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner glow for some hexes
      if (Math.random() > 0.85) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, hexRadius);
        glow.addColorStop(0, 'rgba(100, 200, 255, 0.3)');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fill();
      }
    }
  }
}

/**
 * Draw circuit board floor texture.
 */
export function drawCircuitTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // PCB green background
  ctx.fillStyle = '#0a1a0f';
  ctx.fillRect(0, 0, w, h);

  // Circuit traces
  ctx.strokeStyle = '#00ff66';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00ff66';
  ctx.shadowBlur = 4;

  // Horizontal traces
  for (let y = 20; y < h; y += 40) {
    ctx.beginPath();
    let x = 0;
    ctx.moveTo(x, y);
    while (x < w) {
      const segLength = 20 + Math.random() * 60;
      x += segLength;
      ctx.lineTo(x, y);

      // Random vertical jog
      if (Math.random() > 0.7 && x < w - 40) {
        const jogY = y + (Math.random() > 0.5 ? 20 : -20);
        ctx.lineTo(x, jogY);
        ctx.lineTo(x + 20, jogY);
        x += 20;
      }
    }
    ctx.stroke();
  }

  // Vertical traces
  for (let x = 20; x < w; x += 40) {
    if (Math.random() > 0.5) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      let y = 0;
      while (y < h) {
        const segLength = 20 + Math.random() * 60;
        y += segLength;
        ctx.lineTo(x, y);

        if (Math.random() > 0.7 && y < h - 40) {
          const jogX = x + (Math.random() > 0.5 ? 20 : -20);
          ctx.lineTo(jogX, y);
          ctx.lineTo(jogX, y + 20);
          y += 20;
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
  }

  ctx.shadowBlur = 0;

  // IC chips
  ctx.fillStyle = '#111';
  for (let i = 0; i < 6; i++) {
    const cx = 50 + Math.random() * (w - 100);
    const cy = 50 + Math.random() * (h - 100);
    const chipW = 30 + Math.random() * 40;
    const chipH = 20 + Math.random() * 30;

    ctx.fillRect(cx - chipW / 2, cy - chipH / 2, chipW, chipH);

    // Chip pins
    ctx.fillStyle = '#888';
    for (let p = 0; p < chipW; p += 8) {
      ctx.fillRect(cx - chipW / 2 + p, cy - chipH / 2 - 4, 4, 4);
      ctx.fillRect(cx - chipW / 2 + p, cy + chipH / 2, 4, 4);
    }
    ctx.fillStyle = '#111';
  }

  // Solder pads
  ctx.fillStyle = '#997700';
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
