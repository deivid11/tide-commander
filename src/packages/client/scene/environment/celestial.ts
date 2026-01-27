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
 * Cloud system state for animation
 */
export interface CloudState {
  group: THREE.Group;
  clouds: THREE.Mesh[];
  time: number;
}

/**
 * Create a fluffy cloud mesh using multiple spheres
 */
function createCloudMesh(scale: number = 1): THREE.Group {
  const cloud = new THREE.Group();

  // Cloud material - soft, translucent white
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
  });

  // Create multiple spheres to form a fluffy cloud shape
  const sphereGeometry = new THREE.SphereGeometry(1, 16, 12);

  // Main body spheres
  const positions = [
    { x: 0, y: 0, z: 0, scale: 1.2 },
    { x: -1.0, y: 0.1, z: 0.2, scale: 1.0 },
    { x: 1.0, y: 0.15, z: -0.1, scale: 1.1 },
    { x: -0.5, y: 0.3, z: 0.4, scale: 0.8 },
    { x: 0.6, y: 0.35, z: 0.3, scale: 0.9 },
    { x: -1.5, y: -0.1, z: 0, scale: 0.7 },
    { x: 1.5, y: -0.05, z: 0.1, scale: 0.75 },
    { x: 0, y: 0.4, z: 0, scale: 0.7 },
  ];

  positions.forEach(pos => {
    const sphere = new THREE.Mesh(sphereGeometry, cloudMaterial);
    sphere.position.set(pos.x * scale, pos.y * scale, pos.z * scale);
    sphere.scale.setScalar(pos.scale * scale);
    cloud.add(sphere);
  });

  cloud.userData.material = cloudMaterial;
  return cloud;
}

/**
 * Create the cloud system with multiple clouds at different heights and positions.
 */
export function createClouds(): CloudState {
  const group = new THREE.Group();
  group.name = 'clouds';
  const clouds: THREE.Mesh[] = [];

  // Cloud configurations: position, scale, speed multiplier
  const cloudConfigs = [
    { x: -25, y: 35, z: -20, scale: 3.5, speed: 0.8 },
    { x: 15, y: 40, z: -35, scale: 4.0, speed: 1.0 },
    { x: -40, y: 38, z: 10, scale: 3.0, speed: 0.9 },
    { x: 30, y: 42, z: 15, scale: 3.8, speed: 1.1 },
    { x: 0, y: 36, z: -45, scale: 3.2, speed: 0.85 },
    { x: -15, y: 44, z: 30, scale: 2.8, speed: 1.05 },
    { x: 45, y: 37, z: -10, scale: 3.6, speed: 0.95 },
    { x: -35, y: 41, z: -30, scale: 2.5, speed: 1.15 },
  ];

  cloudConfigs.forEach((config, index) => {
    const cloud = createCloudMesh(config.scale);
    cloud.position.set(config.x, config.y, config.z);
    cloud.userData.baseX = config.x;
    cloud.userData.speed = config.speed;
    cloud.userData.index = index;
    group.add(cloud);
    clouds.push(cloud as unknown as THREE.Mesh);
  });

  return {
    group,
    clouds,
    time: 0,
  };
}

/**
 * Update cloud animation - gentle drifting motion
 */
export function updateClouds(state: CloudState, deltaTime: number): void {
  state.time += deltaTime;

  state.clouds.forEach((cloud) => {
    const baseX = cloud.userData.baseX as number;
    const speed = cloud.userData.speed as number;
    const index = cloud.userData.index as number;

    // Gentle horizontal drift
    const driftRange = 60; // How far clouds drift
    const driftSpeed = 0.015 * speed;

    // Each cloud has a different phase offset
    const phase = index * 0.7;
    const drift = Math.sin(state.time * driftSpeed + phase) * driftRange * 0.5;

    cloud.position.x = baseX + drift;

    // Subtle vertical bobbing
    const bobSpeed = 0.3 * speed;
    const bobAmount = 0.5;
    cloud.position.y += Math.sin(state.time * bobSpeed + phase) * bobAmount * deltaTime;
  });
}

/**
 * Set cloud opacity based on time of day
 */
export function setCloudOpacity(state: CloudState, opacity: number): void {
  state.clouds.forEach((cloud) => {
    const material = cloud.userData.material as THREE.MeshStandardMaterial;
    if (material) {
      material.opacity = opacity * 0.85; // Max 85% opacity
    }
  });
}

/**
 * Dispose cloud resources
 */
export function disposeClouds(state: CloudState): void {
  state.clouds.forEach((cloud) => {
    const material = cloud.userData.material as THREE.MeshStandardMaterial;
    if (material) {
      material.dispose();
    }
  });
  state.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
    }
  });
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
