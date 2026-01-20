/**
 * Galactic Floor Effects
 *
 * Deep space floor visuals with animated particles and nebulas.
 */

import * as THREE from 'three';
import type { GalacticState } from './types';

/**
 * Create the deep space elements as the floor for galactic style.
 */
export function createGalacticElements(scene: THREE.Scene): GalacticState {
  const group = new THREE.Group();
  group.name = 'galacticFloor';

  const nebulas: THREE.Mesh[] = [];

  // Create the main galaxy texture plane (this IS the floor now)
  createGalaxyPlane(group);

  // Add star field particles
  const stars = createGalacticStarField(group);

  // Add nebula cloud effects
  createNebulaClouds(group, nebulas);

  // Add glowing portal rim around the edge
  createPortalRim(group);

  // Add floating cosmic dust particles
  createCosmicDust(group);

  scene.add(group);
  console.log('[Battlefield] Galactic group added to scene:', group);

  return {
    group,
    stars,
    nebulas,
    time: 0,
  };
}

/**
 * Create the main galaxy background plane - this replaces the floor.
 */
function createGalaxyPlane(group: THREE.Group): void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 2048;
  canvas.height = 2048;

  // Deep space background - darker at edges
  const bgGradient = ctx.createRadialGradient(1024, 1024, 0, 1024, 1024, 1024);
  bgGradient.addColorStop(0, '#2a1050');
  bgGradient.addColorStop(0.2, '#1a0a40');
  bgGradient.addColorStop(0.5, '#0d0525');
  bgGradient.addColorStop(0.8, '#060215');
  bgGradient.addColorStop(1, '#020108');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, 2048, 2048);

  // Draw spiral galaxy with 3 arms
  ctx.save();
  ctx.translate(1024, 1024);

  for (let arm = 0; arm < 3; arm++) {
    const armAngle = (arm / 3) * Math.PI * 2;
    ctx.save();
    ctx.rotate(armAngle);

    // Draw stars along spiral arm
    for (let i = 0; i < 1500; i++) {
      const distance = (i / 1500) * 800;
      const spiralAngle = distance * 0.012;
      const spread = distance * 0.15;

      const x = Math.cos(spiralAngle) * distance + (Math.random() - 0.5) * spread;
      const y = Math.sin(spiralAngle) * distance + (Math.random() - 0.5) * spread;

      const brightness = 1 - (distance / 800) * 0.6;
      const size = (1 - distance / 800) * 4 + Math.random() * 3;

      // Colors: white/yellow at core, blue/purple at edges
      const r = Math.floor(220 * brightness + 35);
      const g = Math.floor(200 * brightness + 55);
      const b = Math.floor(255);

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // Add glow to brighter stars
      if (brightness > 0.7 && Math.random() > 0.5) {
        const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
        glowGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.6)`);
        glowGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = glowGradient;
        ctx.beginPath();
        ctx.arc(x, y, size * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Bright galaxy core with multiple layers
  const coreGradient1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 200);
  coreGradient1.addColorStop(0, 'rgba(255, 255, 255, 1)');
  coreGradient1.addColorStop(0.1, 'rgba(255, 240, 220, 0.95)');
  coreGradient1.addColorStop(0.3, 'rgba(255, 200, 150, 0.7)');
  coreGradient1.addColorStop(0.6, 'rgba(200, 150, 255, 0.4)');
  coreGradient1.addColorStop(1, 'transparent');
  ctx.fillStyle = coreGradient1;
  ctx.beginPath();
  ctx.arc(0, 0, 200, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Add lots of background stars
  for (let i = 0; i < 1000; i++) {
    const x = Math.random() * 2048;
    const y = Math.random() * 2048;
    const size = 0.5 + Math.random() * 2.5;
    const brightness = 150 + Math.random() * 105;

    // Random star colors
    const colorRand = Math.random();
    let r, g, b;
    if (colorRand < 0.6) {
      r = brightness; g = brightness; b = 255; // Blue-white
    } else if (colorRand < 0.8) {
      r = 255; g = brightness; b = brightness * 0.7; // Yellow-orange
    } else {
      r = 255; g = brightness * 0.6; b = brightness; // Pink
    }

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();

    // Add glow to some stars
    if (Math.random() > 0.85) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 6);
      glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.7)`);
      glow.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.2)`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, size * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Add some nebula clouds
  const nebulaColors = ['#ff00ff', '#00ffff', '#ff6600', '#6600ff'];
  for (let i = 0; i < 8; i++) {
    const nx = 300 + Math.random() * 1448;
    const ny = 300 + Math.random() * 1448;
    const nsize = 100 + Math.random() * 200;
    const color = nebulaColors[i % nebulaColors.length];

    const nebGradient = ctx.createRadialGradient(nx, ny, 0, nx, ny, nsize);
    nebGradient.addColorStop(0, color + '40');
    nebGradient.addColorStop(0.5, color + '15');
    nebGradient.addColorStop(1, 'transparent');
    ctx.fillStyle = nebGradient;
    ctx.beginPath();
    ctx.arc(nx, ny, nsize, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Create the floor plane - same size as original ground (30x30)
  const geometry = new THREE.PlaneGeometry(30, 30);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
  });

  const galaxyPlane = new THREE.Mesh(geometry, material);
  galaxyPlane.rotation.x = -Math.PI / 2;
  galaxyPlane.position.y = 0.01; // Slightly above y=0
  galaxyPlane.name = 'galaxyPlane';
  galaxyPlane.receiveShadow = true;

  group.add(galaxyPlane);
  console.log('[Battlefield] Galaxy plane created:', galaxyPlane.position);
}

/**
 * Create animated star field particles above the galaxy.
 */
function createGalacticStarField(group: THREE.Group): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  const count = 500;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Spread in a circle matching floor size
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 14;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 0.05 + Math.random() * 0.3; // Slightly above floor
    positions[i * 3 + 2] = Math.sin(angle) * radius;

    // Colorful stars
    const colorChoice = Math.random();
    if (colorChoice < 0.4) {
      colors[i * 3] = 0.9; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1; // White-blue
    } else if (colorChoice < 0.6) {
      colors[i * 3] = 1; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 0.4; // Yellow
    } else if (colorChoice < 0.8) {
      colors[i * 3] = 1; colors[i * 3 + 1] = 0.4; colors[i * 3 + 2] = 0.8; // Pink
    } else {
      colors[i * 3] = 0.4; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1; // Cyan
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.15,
    transparent: true,
    opacity: 0.9,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const stars = new THREE.Points(geometry, material);
  stars.name = 'galacticStars';
  stars.renderOrder = 5;
  group.add(stars);

  return stars;
}

/**
 * Create colorful nebula cloud effects.
 */
function createNebulaClouds(group: THREE.Group, nebulas: THREE.Mesh[]): void {
  const nebulaColors = [0xff00ff, 0x00ffff, 0xff6600, 0x6600ff, 0x00ff66];

  for (let i = 0; i < 4; i++) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 256;

    // Soft nebula cloud
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    const texture = new THREE.CanvasTexture(canvas);
    const size = 6 + Math.random() * 6;
    const geometry = new THREE.PlaneGeometry(size, size);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: nebulaColors[i % nebulaColors.length],
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const nebula = new THREE.Mesh(geometry, material);
    nebula.rotation.x = -Math.PI / 2;
    nebula.position.set(
      (Math.random() - 0.5) * 20,
      0.03 + i * 0.01,
      (Math.random() - 0.5) * 20
    );
    nebula.name = `nebula_${i}`;
    nebula.renderOrder = 2 + i;

    nebulas.push(nebula);
    group.add(nebula);
  }
}

/**
 * Create floating cosmic dust particles.
 */
function createCosmicDust(group: THREE.Group): void {
  const geometry = new THREE.BufferGeometry();
  const count = 150;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 14;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 0.1 + Math.random() * 2; // Float above floor
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    size: 0.15,
    color: 0x8888ff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const dust = new THREE.Points(geometry, material);
  dust.name = 'cosmicDust';
  group.add(dust);
}

/**
 * Create a glowing rim around the floor portal.
 */
function createPortalRim(group: THREE.Group): void {
  const rimGeometry = new THREE.RingGeometry(14.5, 15.5, 64);
  const rimMaterial = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  rim.name = 'portalRim';
  group.add(rim);

  // Inner glow
  const innerRimGeometry = new THREE.RingGeometry(13.5, 14.5, 64);
  const innerRimMaterial = new THREE.MeshBasicMaterial({
    color: 0x8844ff,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const innerRim = new THREE.Mesh(innerRimGeometry, innerRimMaterial);
  innerRim.rotation.x = -Math.PI / 2;
  innerRim.position.y = 0.01;
  innerRim.name = 'portalInnerRim';
  group.add(innerRim);
}

/**
 * Remove galactic elements from the scene and dispose resources.
 */
export function removeGalacticElements(
  scene: THREE.Scene,
  state: GalacticState | null,
  disposeMaterial: (material: THREE.Material) => void
): void {
  if (!state) return;

  // Dispose all geometries, materials, and textures in the galactic group
  state.group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (child.material instanceof THREE.Material) {
        disposeMaterial(child.material);
      } else if (Array.isArray(child.material)) {
        child.material.forEach(mat => disposeMaterial(mat));
      }
    } else if (child instanceof THREE.Points) {
      child.geometry?.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  });

  scene.remove(state.group);
}

/**
 * Update galactic floor animation (call from render loop).
 */
export function updateGalacticAnimation(state: GalacticState, deltaTime: number): void {
  state.time += deltaTime;

  // Slowly rotate the galaxy plane
  const galaxyPlane = state.group.getObjectByName('galaxyPlane') as THREE.Mesh;
  if (galaxyPlane) {
    galaxyPlane.rotation.z = state.time * 0.02;
  }

  // Animate nebulas (slow drift and pulse)
  state.nebulas.forEach((nebula, i) => {
    nebula.rotation.z += deltaTime * 0.03 * (i % 2 === 0 ? 1 : -1);
    // Gentle drift
    nebula.position.x += Math.sin(state.time * 0.2 + i * 2) * deltaTime * 0.1;
    nebula.position.z += Math.cos(state.time * 0.15 + i * 2) * deltaTime * 0.1;
    // Keep within bounds
    if (Math.abs(nebula.position.x) > 12) nebula.position.x *= 0.9;
    if (Math.abs(nebula.position.z) > 12) nebula.position.z *= 0.9;
    const material = nebula.material as THREE.MeshBasicMaterial;
    material.opacity = 0.15 + Math.sin(state.time * 0.5 + i) * 0.1;
  });

  // Animate portal rim pulsing
  const rim = state.group.getObjectByName('portalRim') as THREE.Mesh;
  if (rim) {
    const material = rim.material as THREE.MeshBasicMaterial;
    material.opacity = 0.5 + Math.sin(state.time * 2) * 0.3;
  }

  const innerRim = state.group.getObjectByName('portalInnerRim') as THREE.Mesh;
  if (innerRim) {
    const material = innerRim.material as THREE.MeshBasicMaterial;
    material.opacity = 0.3 + Math.sin(state.time * 3 + 1) * 0.2;
  }

  // Animate cosmic dust (floating upward slowly, then resetting)
  const dust = state.group.getObjectByName('cosmicDust') as THREE.Points;
  if (dust) {
    const positions = dust.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] += deltaTime * 0.15;
      // Reset when too high
      if (positions[i + 1] > 3) {
        positions[i + 1] = 0.1;
        // Randomize x/z position on reset
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 14;
        positions[i] = Math.cos(angle) * radius;
        positions[i + 2] = Math.sin(angle) * radius;
      }
    }
    dust.geometry.attributes.position.needsUpdate = true;
  }

  // Twinkle effect for stars + gentle rotation
  if (state.stars) {
    const material = state.stars.material as THREE.PointsMaterial;
    material.opacity = 0.7 + Math.sin(state.time * 4) * 0.2;
    state.stars.rotation.y = state.time * 0.01;
  }
}
