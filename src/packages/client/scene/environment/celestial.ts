/**
 * Celestial Bodies
 *
 * Sun, moon, and star creation for the battlefield environment.
 */

import * as THREE from 'three';

/**
 * Create the sun sprite.
 */
export function createSun(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 512;

  const centerX = 256;
  const centerY = 256;

  // Outer glow - warm yellow/white
  const outerGlow = ctx.createRadialGradient(centerX, centerY, 50, centerX, centerY, 256);
  outerGlow.addColorStop(0, 'rgba(255, 255, 200, 1)');
  outerGlow.addColorStop(0.2, 'rgba(255, 240, 150, 0.8)');
  outerGlow.addColorStop(0.4, 'rgba(255, 220, 100, 0.4)');
  outerGlow.addColorStop(0.7, 'rgba(255, 200, 80, 0.1)');
  outerGlow.addColorStop(1, 'rgba(255, 180, 50, 0)');

  ctx.fillStyle = outerGlow;
  ctx.fillRect(0, 0, 512, 512);

  // Inner bright core
  const innerGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 80);
  innerGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  innerGlow.addColorStop(0.5, 'rgba(255, 255, 220, 1)');
  innerGlow.addColorStop(1, 'rgba(255, 240, 150, 0.8)');

  ctx.fillStyle = innerGlow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 80, 0, Math.PI * 2);
  ctx.fill();

  // Sun surface - bright white/yellow
  ctx.beginPath();
  ctx.arc(centerX, centerY, 60, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffee';
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const sun = new THREE.Sprite(material);
  sun.position.set(30, 50, -30);
  sun.scale.set(50, 50, 1);
  sun.name = 'sun';
  sun.visible = false; // Will be controlled by time

  return sun;
}

/**
 * Create the moon sprite.
 */
export function createMoon(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 512;

  const centerX = 256;
  const centerY = 256;

  // Outer glow - silver/blue
  const outerGlow = ctx.createRadialGradient(centerX, centerY, 60, centerX, centerY, 256);
  outerGlow.addColorStop(0, 'rgba(200, 220, 255, 1)');
  outerGlow.addColorStop(0.2, 'rgba(180, 200, 240, 0.8)');
  outerGlow.addColorStop(0.4, 'rgba(150, 180, 220, 0.5)');
  outerGlow.addColorStop(0.7, 'rgba(120, 150, 200, 0.2)');
  outerGlow.addColorStop(1, 'rgba(100, 130, 180, 0)');

  ctx.fillStyle = outerGlow;
  ctx.fillRect(0, 0, 512, 512);

  // Inner bright glow
  const innerGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 100);
  innerGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  innerGlow.addColorStop(0.5, 'rgba(230, 240, 255, 0.9)');
  innerGlow.addColorStop(1, 'rgba(200, 220, 255, 0.3)');

  ctx.fillStyle = innerGlow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 100, 0, Math.PI * 2);
  ctx.fill();

  // Moon surface - pale silver
  ctx.beginPath();
  ctx.arc(centerX, centerY, 70, 0, Math.PI * 2);
  ctx.fillStyle = '#e8eeff';
  ctx.fill();

  // Subtle crater details
  ctx.fillStyle = 'rgba(180, 190, 210, 0.6)';
  ctx.beginPath();
  ctx.arc(centerX - 25, centerY - 20, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX + 25, centerY + 15, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX - 5, centerY + 30, 10, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const moon = new THREE.Sprite(material);
  moon.position.set(-30, 35, -50);
  moon.scale.set(40, 40, 1);
  moon.name = 'moon';

  return moon;
}

/**
 * Create the star field.
 */
export function createStars(): THREE.Points {
  const starGeometry = new THREE.BufferGeometry();
  const starCount = 300;
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    // Spread stars in a dome around the scene
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.5; // Upper hemisphere only
    const radius = 80 + Math.random() * 40;

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) + 20; // Offset up
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.5,
    transparent: true,
    opacity: 0.8,
  });

  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.name = 'stars';

  return stars;
}
