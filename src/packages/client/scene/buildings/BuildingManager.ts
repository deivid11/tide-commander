import * as THREE from 'three';
import type { Building, BuildingStatus, BuildingStyle } from '../../../shared/types';
import { store } from '../../store';

/**
 * Building mesh data structure
 */
export interface BuildingMeshData {
  group: THREE.Group;
  statusLight: THREE.Mesh;
  label: THREE.Sprite;
}

/**
 * Status colors for building lights
 */
const STATUS_COLORS: Record<BuildingStatus, number> = {
  running: 0x4aff9e,   // Green
  stopped: 0x888888,   // Gray
  error: 0xff4a4a,     // Red
  unknown: 0xffaa00,   // Orange
  starting: 0x4a9eff,  // Blue
  stopping: 0xffaa00,  // Orange
};

/**
 * Color palettes for each building style - vibrant and distinct
 */
const STYLE_PALETTES: Record<BuildingStyle, {
  primary: number;
  secondary: number;
  accent: number;
  glow: number;
}> = {
  'server-rack': {
    primary: 0x4a5568,    // Slate gray
    secondary: 0x2d3748,  // Dark slate
    accent: 0x4a9eff,     // Blue
    glow: 0x4aff9e,       // Green
  },
  'tower': {
    primary: 0x5a67d8,    // Indigo
    secondary: 0x4c51bf,  // Dark indigo
    accent: 0x9f7aea,     // Purple
    glow: 0x4a9eff,       // Blue
  },
  'dome': {
    primary: 0x38b2ac,    // Teal
    secondary: 0x319795,  // Dark teal
    accent: 0x4fd1c5,     // Light teal
    glow: 0x4aff9e,       // Green
  },
  'pyramid': {
    primary: 0xd69e2e,    // Gold
    secondary: 0xb7791f,  // Dark gold
    accent: 0xecc94b,     // Yellow
    glow: 0xffaa00,       // Orange
  },
  'desktop': {
    primary: 0x718096,    // Gray blue
    secondary: 0x4a5568,  // Slate
    accent: 0x63b3ed,     // Light blue
    glow: 0x4aff9e,       // Green
  },
  'filing-cabinet': {
    primary: 0x68d391,    // Green
    secondary: 0x48bb78,  // Dark green
    accent: 0x9ae6b4,     // Light green
    glow: 0x4aff9e,       // Green
  },
  'satellite': {
    primary: 0x805ad5,    // Purple
    secondary: 0x6b46c1,  // Dark purple
    accent: 0xb794f4,     // Light purple
    glow: 0x4a9eff,       // Blue
  },
  'crystal': {
    primary: 0xed64a6,    // Pink
    secondary: 0xd53f8c,  // Dark pink
    accent: 0xf687b3,     // Light pink
    glow: 0x9f7aea,       // Purple
  },
  'factory': {
    primary: 0xed8936,    // Orange
    secondary: 0xdd6b20,  // Dark orange
    accent: 0xf6ad55,     // Light orange
    glow: 0xffaa00,       // Yellow-orange
  },
};

/**
 * Manages buildings on the battlefield.
 */
export class BuildingManager {
  private scene: THREE.Scene;
  private buildingMeshes = new Map<string, BuildingMeshData>();
  private selectedBuildingIds = new Set<string>();

  // Animation state
  private animationTime = 0;

  // Callbacks
  private onBuildingClick: ((buildingId: string) => void) | null = null;
  private onBuildingDoubleClick: ((buildingId: string) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set click callback
   */
  setOnBuildingClick(callback: (buildingId: string) => void): void {
    this.onBuildingClick = callback;
  }

  /**
   * Set double-click callback
   */
  setOnBuildingDoubleClick(callback: (buildingId: string) => void): void {
    this.onBuildingDoubleClick = callback;
  }

  /**
   * Create a server building mesh using basic geometry.
   * Looks like a small server rack/tower.
   */
  private createServerBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x2a2a3a);
    const accentColor = new THREE.Color(0x4a9eff);

    // Main tower body (server rack)
    const towerGeom = new THREE.BoxGeometry(1.2, 2.5, 0.8);
    const towerMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.7,
      roughness: 0.3,
    });
    const tower = new THREE.Mesh(towerGeom, towerMat);
    tower.position.y = 1.25;
    tower.castShadow = true;
    tower.receiveShadow = true;
    tower.name = 'buildingBody';
    group.add(tower);

    // Server slots (horizontal lines)
    for (let i = 0; i < 5; i++) {
      const slotGeom = new THREE.BoxGeometry(1.1, 0.02, 0.75);
      const slotMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2a,
        metalness: 0.5,
        roughness: 0.5,
      });
      const slot = new THREE.Mesh(slotGeom, slotMat);
      slot.position.set(0, 0.5 + i * 0.45, 0.03);
      group.add(slot);
    }

    // Front panel LEDs (small lights per slot)
    for (let i = 0; i < 5; i++) {
      const ledGeom = new THREE.BoxGeometry(0.08, 0.08, 0.05);
      const ledMat = new THREE.MeshBasicMaterial({
        color: 0x4aff9e,
        transparent: true,
        opacity: 0.9,
      });
      const led = new THREE.Mesh(ledGeom, ledMat);
      led.position.set(-0.45, 0.5 + i * 0.45, 0.43);
      led.name = `led_${i}`;
      group.add(led);

      // Activity LED (blinks when running)
      const activityLed = new THREE.Mesh(ledGeom.clone(), ledMat.clone());
      activityLed.position.set(-0.3, 0.5 + i * 0.45, 0.43);
      activityLed.name = `activityLed_${i}`;
      group.add(activityLed);
    }

    // Top vent/grill
    const ventGeom = new THREE.BoxGeometry(1.0, 0.1, 0.6);
    const ventMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2a,
      metalness: 0.3,
      roughness: 0.7,
    });
    const vent = new THREE.Mesh(ventGeom, ventMat);
    vent.position.set(0, 2.55, 0);
    group.add(vent);

    // Main status light on top
    const statusLightGeom = new THREE.SphereGeometry(0.15, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(0, 2.75, 0);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status light glow (larger transparent sphere)
    const glowGeom = new THREE.SphereGeometry(0.25, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(0, 2.75, 0);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base platform
    const baseGeom = new THREE.BoxGeometry(1.5, 0.1, 1.1);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a,
      metalness: 0.5,
      roughness: 0.5,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.05;
    base.receiveShadow = true;
    group.add(base);

    // Name label
    const label = this.createLabel(building.name);
    label.position.set(0, 3.2, 0);
    label.name = 'buildingLabel';
    group.add(label);

    // Set position
    group.position.set(building.position.x, 0, building.position.z);

    return {
      group,
      statusLight,
      label,
    };
  }

  /**
   * Create a Control Tower building.
   * Tall tower with rotating antenna on top.
   */
  private createTowerBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x2a3a4a);

    // Main tower body (octagonal)
    const towerGeom = new THREE.CylinderGeometry(0.5, 0.7, 3, 8);
    const towerMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.6,
      roughness: 0.4,
    });
    const tower = new THREE.Mesh(towerGeom, towerMat);
    tower.position.y = 1.5;
    tower.castShadow = true;
    tower.receiveShadow = true;
    tower.name = 'buildingBody';
    group.add(tower);

    // Window bands
    for (let i = 0; i < 4; i++) {
      const bandGeom = new THREE.CylinderGeometry(0.52 - i * 0.03, 0.62 - i * 0.03, 0.1, 8);
      const bandMat = new THREE.MeshBasicMaterial({
        color: 0x4a9eff,
        transparent: true,
        opacity: 0.7,
      });
      const band = new THREE.Mesh(bandGeom, bandMat);
      band.position.y = 0.7 + i * 0.6;
      band.name = `windowBand_${i}`;
      group.add(band);
    }

    // Top platform
    const platformGeom = new THREE.CylinderGeometry(0.6, 0.5, 0.2, 8);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a,
      metalness: 0.7,
      roughness: 0.3,
    });
    const platform = new THREE.Mesh(platformGeom, platformMat);
    platform.position.y = 3.1;
    group.add(platform);

    // Antenna base
    const antennaBaseGeom = new THREE.CylinderGeometry(0.15, 0.2, 0.3, 6);
    const antennaBaseMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a5a,
      metalness: 0.8,
      roughness: 0.2,
    });
    const antennaBase = new THREE.Mesh(antennaBaseGeom, antennaBaseMat);
    antennaBase.position.y = 3.35;
    group.add(antennaBase);

    // Rotating antenna (will be animated)
    const antennaGroup = new THREE.Group();
    antennaGroup.position.y = 3.6;
    antennaGroup.name = 'antenna';

    const antennaGeom = new THREE.BoxGeometry(0.05, 0.6, 0.05);
    const antennaMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a7a,
      metalness: 0.9,
      roughness: 0.1,
    });
    const antenna = new THREE.Mesh(antennaGeom, antennaMat);
    antenna.position.y = 0.3;
    antennaGroup.add(antenna);

    // Antenna dishes
    const dishGeom = new THREE.ConeGeometry(0.15, 0.1, 8);
    for (let i = 0; i < 2; i++) {
      const dish = new THREE.Mesh(dishGeom, antennaMat);
      dish.rotation.x = Math.PI / 2;
      dish.position.set(i === 0 ? 0.2 : -0.2, 0.4, 0);
      dish.rotation.z = i === 0 ? Math.PI / 2 : -Math.PI / 2;
      antennaGroup.add(dish);
    }

    group.add(antennaGroup);

    // Status light
    const statusLightGeom = new THREE.SphereGeometry(0.12, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(0, 4.3, 0);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status glow
    const glowGeom = new THREE.SphereGeometry(0.2, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(0, 4.3, 0);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base
    const baseGeom = new THREE.CylinderGeometry(0.9, 1.0, 0.15, 8);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a,
      metalness: 0.5,
      roughness: 0.5,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.075;
    base.receiveShadow = true;
    group.add(base);

    // Name label
    const label = this.createLabel(building.name);
    label.position.set(0, 4.7, 0);
    label.name = 'buildingLabel';
    group.add(label);

    group.position.set(building.position.x, 0, building.position.z);

    return { group, statusLight, label };
  }

  /**
   * Create a Data Dome building.
   * Futuristic dome with energy ring.
   */
  private createDomeBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x2a2a4a);

    // Main dome
    const domeGeom = new THREE.SphereGeometry(1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.4,
      roughness: 0.6,
      transparent: true,
      opacity: 0.9,
    });
    const dome = new THREE.Mesh(domeGeom, domeMat);
    dome.position.y = 0.15;
    dome.castShadow = true;
    dome.receiveShadow = true;
    dome.name = 'buildingBody';
    group.add(dome);

    // Inner dome (glowing core)
    const innerDomeGeom = new THREE.SphereGeometry(0.8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const innerDomeMat = new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.3,
    });
    const innerDome = new THREE.Mesh(innerDomeGeom, innerDomeMat);
    innerDome.position.y = 0.15;
    innerDome.name = 'innerDome';
    group.add(innerDome);

    // Energy ring (rotating torus)
    const ringGeom = new THREE.TorusGeometry(1.0, 0.05, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4aff9e,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.y = 0.6;
    ring.rotation.x = Math.PI / 2;
    ring.name = 'energyRing';
    group.add(ring);

    // Second ring (counter-rotating)
    const ring2 = new THREE.Mesh(ringGeom.clone(), ringMat.clone());
    ring2.position.y = 0.8;
    ring2.rotation.x = Math.PI / 3;
    ring2.name = 'energyRing2';
    group.add(ring2);

    // Vertical energy beams
    for (let i = 0; i < 4; i++) {
      const beamGeom = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x4a9eff,
        transparent: true,
        opacity: 0.6,
      });
      const beam = new THREE.Mesh(beamGeom, beamMat);
      const angle = (i / 4) * Math.PI * 2;
      beam.position.set(Math.cos(angle) * 0.5, 0.75, Math.sin(angle) * 0.5);
      beam.name = `beam_${i}`;
      group.add(beam);
    }

    // Status light on top
    const statusLightGeom = new THREE.SphereGeometry(0.15, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(0, 1.4, 0);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status glow
    const glowGeom = new THREE.SphereGeometry(0.25, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(0, 1.4, 0);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base platform
    const baseGeom = new THREE.CylinderGeometry(1.4, 1.5, 0.15, 32);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a,
      metalness: 0.6,
      roughness: 0.4,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.075;
    base.receiveShadow = true;
    group.add(base);

    // Name label
    const label = this.createLabel(building.name);
    label.position.set(0, 1.9, 0);
    label.name = 'buildingLabel';
    group.add(label);

    group.position.set(building.position.x, 0, building.position.z);

    return { group, statusLight, label };
  }

  /**
   * Create a Power Pyramid building.
   * Egyptian-style pyramid with glowing core.
   */
  private createPyramidBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x3a3a2a);

    // Main pyramid
    const pyramidGeom = new THREE.ConeGeometry(1.3, 2.5, 4);
    const pyramidMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.3,
      roughness: 0.7,
    });
    const pyramid = new THREE.Mesh(pyramidGeom, pyramidMat);
    pyramid.position.y = 1.25;
    pyramid.rotation.y = Math.PI / 4; // Rotate 45 degrees for diamond orientation
    pyramid.castShadow = true;
    pyramid.receiveShadow = true;
    pyramid.name = 'buildingBody';
    group.add(pyramid);

    // Glowing core (smaller inner pyramid)
    const coreGeom = new THREE.ConeGeometry(0.6, 1.2, 4);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.6,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    core.position.y = 0.8;
    core.rotation.y = Math.PI / 4;
    core.name = 'pyramidCore';
    group.add(core);

    // Energy lines on edges
    const edgePositions = [
      { x: 0.9, z: 0 },
      { x: -0.9, z: 0 },
      { x: 0, z: 0.9 },
      { x: 0, z: -0.9 },
    ];
    for (let i = 0; i < 4; i++) {
      const lineGeom = new THREE.CylinderGeometry(0.02, 0.02, 2.7, 8);
      const lineMat = new THREE.MeshBasicMaterial({
        color: 0x4aff9e,
        transparent: true,
        opacity: 0.7,
      });
      const line = new THREE.Mesh(lineGeom, lineMat);
      const pos = edgePositions[i];
      line.position.set(pos.x * 0.5, 1.25, pos.z * 0.5);
      // Tilt lines to follow pyramid edge
      const tiltAngle = Math.atan2(1.25, 0.65);
      if (i < 2) {
        line.rotation.z = i === 0 ? -tiltAngle : tiltAngle;
      } else {
        line.rotation.x = i === 2 ? tiltAngle : -tiltAngle;
      }
      line.name = `edgeLine_${i}`;
      group.add(line);
    }

    // Floating eye/orb at apex
    const eyeGeom = new THREE.SphereGeometry(0.15, 16, 16);
    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.9,
    });
    const eye = new THREE.Mesh(eyeGeom, eyeMat);
    eye.position.y = 2.7;
    eye.name = 'pyramidEye';
    group.add(eye);

    // Eye glow
    const eyeGlowGeom = new THREE.SphereGeometry(0.25, 16, 16);
    const eyeGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.3,
    });
    const eyeGlow = new THREE.Mesh(eyeGlowGeom, eyeGlowMat);
    eyeGlow.position.y = 2.7;
    eyeGlow.name = 'pyramidEyeGlow';
    group.add(eyeGlow);

    // Status light (separate from eye, below pyramid)
    const statusLightGeom = new THREE.SphereGeometry(0.12, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(1.2, 0.3, 0);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status glow
    const glowGeom = new THREE.SphereGeometry(0.2, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(1.2, 0.3, 0);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base platform (stone slab)
    const baseGeom = new THREE.BoxGeometry(2.8, 0.15, 2.8);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a3a,
      metalness: 0.2,
      roughness: 0.8,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.075;
    base.receiveShadow = true;
    group.add(base);

    // Name label
    const label = this.createLabel(building.name);
    label.position.set(0, 3.2, 0);
    label.name = 'buildingLabel';
    group.add(label);

    group.position.set(building.position.x, 0, building.position.z);

    return { group, statusLight, label };
  }

  /**
   * Create a Desktop PC building.
   * Retro computer with monitor and keyboard.
   */
  private createDesktopBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const palette = STYLE_PALETTES['desktop'];
    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

    // Monitor body
    const monitorGeom = new THREE.BoxGeometry(1.4, 1.0, 0.15);
    const monitorMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.4,
      roughness: 0.6,
    });
    const monitor = new THREE.Mesh(monitorGeom, monitorMat);
    monitor.position.set(0, 1.4, 0);
    monitor.castShadow = true;
    monitor.name = 'buildingBody';
    group.add(monitor);

    // Monitor screen (glowing when running)
    const screenGeom = new THREE.BoxGeometry(1.2, 0.8, 0.02);
    const screenMat = new THREE.MeshBasicMaterial({
      color: 0x0a1628,
      transparent: true,
      opacity: 0.95,
    });
    const screen = new THREE.Mesh(screenGeom, screenMat);
    screen.position.set(0, 1.4, 0.09);
    screen.name = 'screen';
    group.add(screen);

    // Screen content lines (code-like)
    for (let i = 0; i < 6; i++) {
      const lineGeom = new THREE.BoxGeometry(0.8 - (i % 3) * 0.2, 0.05, 0.01);
      const lineMat = new THREE.MeshBasicMaterial({
        color: palette.glow,
        transparent: true,
        opacity: 0.9,
      });
      const line = new THREE.Mesh(lineGeom, lineMat);
      line.position.set(-0.1 + (i % 2) * 0.1, 1.65 - i * 0.1, 0.1);
      line.name = `codeLine_${i}`;
      group.add(line);
    }

    // Monitor stand
    const standGeom = new THREE.BoxGeometry(0.15, 0.6, 0.15);
    const standMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.5,
      roughness: 0.5,
    });
    const stand = new THREE.Mesh(standGeom, standMat);
    stand.position.set(0, 0.6, 0);
    group.add(stand);

    // Monitor base
    const monitorBaseGeom = new THREE.BoxGeometry(0.6, 0.08, 0.4);
    const monitorBase = new THREE.Mesh(monitorBaseGeom, standMat);
    monitorBase.position.set(0, 0.25, 0);
    group.add(monitorBase);

    // Keyboard
    const keyboardGeom = new THREE.BoxGeometry(1.0, 0.08, 0.35);
    const keyboardMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.3,
      roughness: 0.7,
    });
    const keyboard = new THREE.Mesh(keyboardGeom, keyboardMat);
    keyboard.position.set(0, 0.2, 0.6);
    keyboard.rotation.x = -0.1;
    group.add(keyboard);

    // Keyboard keys (rows)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 10; col++) {
        const keyGeom = new THREE.BoxGeometry(0.07, 0.03, 0.07);
        const keyMat = new THREE.MeshStandardMaterial({
          color: palette.accent,
          metalness: 0.2,
          roughness: 0.8,
        });
        const key = new THREE.Mesh(keyGeom, keyMat);
        key.position.set(-0.38 + col * 0.085, 0.25, 0.45 + row * 0.1);
        group.add(key);
      }
    }

    // CPU tower (on side)
    const cpuGeom = new THREE.BoxGeometry(0.4, 0.9, 0.8);
    const cpuMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.4,
      roughness: 0.6,
    });
    const cpu = new THREE.Mesh(cpuGeom, cpuMat);
    cpu.position.set(-1.1, 0.55, 0);
    cpu.castShadow = true;
    group.add(cpu);

    // CPU LED
    const cpuLedGeom = new THREE.BoxGeometry(0.05, 0.05, 0.02);
    const cpuLedMat = new THREE.MeshBasicMaterial({
      color: 0x4aff9e,
      transparent: true,
      opacity: 0.9,
    });
    const cpuLed = new THREE.Mesh(cpuLedGeom, cpuLedMat);
    cpuLed.position.set(-0.88, 0.7, 0.3);
    cpuLed.name = 'cpuLed';
    group.add(cpuLed);

    // Status light
    const statusLightGeom = new THREE.SphereGeometry(0.1, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(0.6, 1.85, 0.1);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status glow
    const glowGeom = new THREE.SphereGeometry(0.18, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(0.6, 1.85, 0.1);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base
    const baseGeom = new THREE.BoxGeometry(2.6, 0.1, 1.4);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a,
      metalness: 0.5,
      roughness: 0.5,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.05;
    base.receiveShadow = true;
    group.add(base);

    // Label
    const label = this.createLabel(building.name);
    label.position.set(0, 2.3, 0);
    label.name = 'buildingLabel';
    group.add(label);

    group.position.set(building.position.x, 0, building.position.z);

    return { group, statusLight, label };
  }

  /**
   * Create a Filing Cabinet building.
   * Office cabinet with sliding drawers.
   */
  private createFilingCabinetBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const palette = STYLE_PALETTES['filing-cabinet'];
    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

    // Main cabinet body
    const cabinetGeom = new THREE.BoxGeometry(1.0, 2.4, 0.8);
    const cabinetMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.5,
      roughness: 0.5,
    });
    const cabinet = new THREE.Mesh(cabinetGeom, cabinetMat);
    cabinet.position.y = 1.2;
    cabinet.castShadow = true;
    cabinet.name = 'buildingBody';
    group.add(cabinet);

    // Drawers (4 of them)
    for (let i = 0; i < 4; i++) {
      const drawerGeom = new THREE.BoxGeometry(0.9, 0.5, 0.05);
      const drawerMat = new THREE.MeshStandardMaterial({
        color: palette.secondary,
        metalness: 0.4,
        roughness: 0.6,
      });
      const drawer = new THREE.Mesh(drawerGeom, drawerMat);
      drawer.position.set(0, 0.35 + i * 0.55, 0.4);
      drawer.name = `drawer_${i}`;
      group.add(drawer);

      // Drawer handle
      const handleGeom = new THREE.BoxGeometry(0.3, 0.06, 0.05);
      const handleMat = new THREE.MeshStandardMaterial({
        color: palette.accent,
        metalness: 0.7,
        roughness: 0.3,
      });
      const handle = new THREE.Mesh(handleGeom, handleMat);
      handle.position.set(0, 0.35 + i * 0.55, 0.47);
      handle.name = `handle_${i}`;
      group.add(handle);

      // Drawer label slot
      const labelSlotGeom = new THREE.BoxGeometry(0.4, 0.15, 0.02);
      const labelSlotMat = new THREE.MeshBasicMaterial({
        color: 0xffffee,
      });
      const labelSlot = new THREE.Mesh(labelSlotGeom, labelSlotMat);
      labelSlot.position.set(0, 0.45 + i * 0.55, 0.44);
      group.add(labelSlot);
    }

    // Filing indicator lights
    for (let i = 0; i < 4; i++) {
      const indicatorGeom = new THREE.BoxGeometry(0.06, 0.06, 0.02);
      const indicatorMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? palette.glow : palette.accent,
        transparent: true,
        opacity: 0.9,
      });
      const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
      indicator.position.set(-0.38, 0.35 + i * 0.55, 0.42);
      indicator.name = `indicator_${i}`;
      group.add(indicator);
    }

    // Status light on top
    const statusLightGeom = new THREE.SphereGeometry(0.12, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(0, 2.55, 0);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status glow
    const glowGeom = new THREE.SphereGeometry(0.2, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(0, 2.55, 0);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base
    const baseGeom = new THREE.BoxGeometry(1.3, 0.1, 1.1);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a,
      metalness: 0.5,
      roughness: 0.5,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.05;
    base.receiveShadow = true;
    group.add(base);

    // Label
    const label = this.createLabel(building.name);
    label.position.set(0, 3.0, 0);
    label.name = 'buildingLabel';
    group.add(label);

    group.position.set(building.position.x, 0, building.position.z);

    return { group, statusLight, label };
  }

  /**
   * Create a Satellite Dish building.
   * Communication dish with rotating receiver.
   */
  private createSatelliteBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const palette = STYLE_PALETTES['satellite'];
    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

    // Support pole
    const poleGeom = new THREE.CylinderGeometry(0.1, 0.15, 2.0, 8);
    const poleMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.6,
      roughness: 0.4,
    });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.y = 1.0;
    pole.castShadow = true;
    group.add(pole);

    // Dish mount
    const mountGeom = new THREE.BoxGeometry(0.3, 0.2, 0.3);
    const mount = new THREE.Mesh(mountGeom, poleMat);
    mount.position.y = 2.1;
    group.add(mount);

    // Rotating dish group
    const dishGroup = new THREE.Group();
    dishGroup.position.y = 2.3;
    dishGroup.name = 'dishGroup';

    // Main dish (parabolic-ish using sphere segment)
    const dishGeom = new THREE.SphereGeometry(1.0, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
    const dishMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.5,
      roughness: 0.5,
      side: THREE.DoubleSide,
    });
    const dish = new THREE.Mesh(dishGeom, dishMat);
    dish.rotation.x = Math.PI / 2 + 0.3;
    dish.name = 'buildingBody';
    dishGroup.add(dish);

    // Dish inner surface (different color)
    const innerDishGeom = new THREE.SphereGeometry(0.95, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
    const innerDishMat = new THREE.MeshStandardMaterial({
      color: palette.accent,
      metalness: 0.3,
      roughness: 0.7,
      side: THREE.BackSide,
    });
    const innerDish = new THREE.Mesh(innerDishGeom, innerDishMat);
    innerDish.rotation.x = Math.PI / 2 + 0.3;
    dishGroup.add(innerDish);

    // Receiver arm
    const armGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8);
    const armMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.6,
      roughness: 0.4,
    });
    const arm = new THREE.Mesh(armGeom, armMat);
    arm.position.set(0, 0.1, 0.5);
    arm.rotation.x = -0.6;
    dishGroup.add(arm);

    // Receiver head
    const receiverGeom = new THREE.ConeGeometry(0.1, 0.2, 8);
    const receiverMat = new THREE.MeshStandardMaterial({
      color: palette.accent,
      metalness: 0.4,
      roughness: 0.6,
    });
    const receiver = new THREE.Mesh(receiverGeom, receiverMat);
    receiver.position.set(0, 0.5, 0.85);
    receiver.rotation.x = Math.PI / 2 - 0.6;
    dishGroup.add(receiver);

    // Signal indicator (pulsing when running)
    const signalGeom = new THREE.SphereGeometry(0.08, 16, 16);
    const signalMat = new THREE.MeshBasicMaterial({
      color: palette.glow,
      transparent: true,
      opacity: 0.9,
    });
    const signal = new THREE.Mesh(signalGeom, signalMat);
    signal.position.set(0, 0.55, 0.92);
    signal.name = 'signal';
    dishGroup.add(signal);

    group.add(dishGroup);

    // Signal waves (concentric rings)
    for (let i = 0; i < 3; i++) {
      const waveGeom = new THREE.RingGeometry(0.2 + i * 0.15, 0.22 + i * 0.15, 16);
      const waveMat = new THREE.MeshBasicMaterial({
        color: palette.glow,
        transparent: true,
        opacity: 0.6 - i * 0.15,
        side: THREE.DoubleSide,
      });
      const wave = new THREE.Mesh(waveGeom, waveMat);
      wave.position.set(0, 2.85 + i * 0.1, 0.92 + i * 0.1);
      wave.rotation.x = -0.6;
      wave.name = `wave_${i}`;
      group.add(wave);
    }

    // Status light
    const statusLightGeom = new THREE.SphereGeometry(0.1, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(0, 0.3, 0.5);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status glow
    const glowGeom = new THREE.SphereGeometry(0.18, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(0, 0.3, 0.5);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base
    const baseGeom = new THREE.CylinderGeometry(0.6, 0.7, 0.15, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.5,
      roughness: 0.5,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.075;
    base.receiveShadow = true;
    group.add(base);

    // Label
    const label = this.createLabel(building.name);
    label.position.set(0, 3.8, 0);
    label.name = 'buildingLabel';
    group.add(label);

    group.position.set(building.position.x, 0, building.position.z);

    return { group, statusLight, label };
  }

  /**
   * Create a Data Crystal building.
   * Floating crystal with energy particles.
   */
  private createCrystalBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const palette = STYLE_PALETTES['crystal'];
    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

    // Main crystal (octahedron)
    const crystalGeom = new THREE.OctahedronGeometry(0.8);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.3,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
    });
    const crystal = new THREE.Mesh(crystalGeom, crystalMat);
    crystal.position.y = 1.8;
    crystal.castShadow = true;
    crystal.name = 'buildingBody';
    group.add(crystal);

    // Inner glow
    const innerGeom = new THREE.OctahedronGeometry(0.5);
    const innerMat = new THREE.MeshBasicMaterial({
      color: palette.glow,
      transparent: true,
      opacity: 0.6,
    });
    const inner = new THREE.Mesh(innerGeom, innerMat);
    inner.position.y = 1.8;
    inner.name = 'crystalInner';
    group.add(inner);

    // Orbiting particles
    for (let i = 0; i < 6; i++) {
      const particleGeom = new THREE.SphereGeometry(0.06, 8, 8);
      const particleMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? palette.accent : palette.glow,
        transparent: true,
        opacity: 0.9,
      });
      const particle = new THREE.Mesh(particleGeom, particleMat);
      const angle = (i / 6) * Math.PI * 2;
      particle.position.set(Math.cos(angle) * 1.2, 1.8 + Math.sin(angle * 2) * 0.3, Math.sin(angle) * 1.2);
      particle.name = `particle_${i}`;
      group.add(particle);
    }

    // Energy field (wireframe sphere)
    const fieldGeom = new THREE.IcosahedronGeometry(1.3, 1);
    const fieldMat = new THREE.MeshBasicMaterial({
      color: palette.accent,
      wireframe: true,
      transparent: true,
      opacity: 0.4,
    });
    const field = new THREE.Mesh(fieldGeom, fieldMat);
    field.position.y = 1.8;
    field.name = 'energyField';
    group.add(field);

    // Pedestal base
    const pedestalGeom = new THREE.CylinderGeometry(0.3, 0.5, 0.8, 6);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.5,
      roughness: 0.5,
    });
    const pedestal = new THREE.Mesh(pedestalGeom, pedestalMat);
    pedestal.position.y = 0.4;
    group.add(pedestal);

    // Energy beam from pedestal to crystal
    const beamGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: palette.glow,
      transparent: true,
      opacity: 0.7,
    });
    const beam = new THREE.Mesh(beamGeom, beamMat);
    beam.position.y = 1.25;
    beam.name = 'energyBeam';
    group.add(beam);

    // Status light
    const statusLightGeom = new THREE.SphereGeometry(0.1, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(0.7, 0.5, 0);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status glow
    const glowGeom = new THREE.SphereGeometry(0.18, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(0.7, 0.5, 0);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base platform
    const baseGeom = new THREE.CylinderGeometry(0.8, 0.9, 0.1, 6);
    const baseMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.6,
      roughness: 0.4,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.05;
    base.receiveShadow = true;
    group.add(base);

    // Label
    const label = this.createLabel(building.name);
    label.position.set(0, 3.0, 0);
    label.name = 'buildingLabel';
    group.add(label);

    group.position.set(building.position.x, 0, building.position.z);

    return { group, statusLight, label };
  }

  /**
   * Create a Mini Factory building.
   * Industrial building with smoking chimney.
   */
  private createFactoryBuildingMesh(building: Building): BuildingMeshData {
    const group = new THREE.Group();
    group.userData.buildingId = building.id;
    group.userData.isBuilding = true;

    const palette = STYLE_PALETTES['factory'];
    const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

    // Main building body
    const bodyGeom = new THREE.BoxGeometry(1.8, 1.2, 1.2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.4,
      roughness: 0.6,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.set(0, 0.6, 0);
    body.castShadow = true;
    body.name = 'buildingBody';
    group.add(body);

    // Roof (slanted)
    const roofGeom = new THREE.BoxGeometry(2.0, 0.15, 1.4);
    const roofMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.5,
      roughness: 0.5,
    });
    const roof = new THREE.Mesh(roofGeom, roofMat);
    roof.position.set(0, 1.25, 0);
    roof.rotation.z = 0.05;
    group.add(roof);

    // Chimney
    const chimneyGeom = new THREE.CylinderGeometry(0.15, 0.18, 1.2, 8);
    const chimneyMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.5,
      roughness: 0.5,
    });
    const chimney = new THREE.Mesh(chimneyGeom, chimneyMat);
    chimney.position.set(0.5, 1.8, 0.3);
    group.add(chimney);

    // Chimney top ring
    const ringGeom = new THREE.TorusGeometry(0.17, 0.03, 8, 16);
    const ring = new THREE.Mesh(ringGeom, chimneyMat);
    ring.position.set(0.5, 2.4, 0.3);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Smoke particles (spheres that will animate)
    for (let i = 0; i < 4; i++) {
      const smokeGeom = new THREE.SphereGeometry(0.08 + i * 0.03, 8, 8);
      const smokeMat = new THREE.MeshBasicMaterial({
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.7 - i * 0.12,
      });
      const smoke = new THREE.Mesh(smokeGeom, smokeMat);
      smoke.position.set(0.5, 2.5 + i * 0.25, 0.3);
      smoke.name = `smoke_${i}`;
      group.add(smoke);
    }

    // Windows
    for (let i = 0; i < 3; i++) {
      const windowGeom = new THREE.BoxGeometry(0.25, 0.35, 0.05);
      const windowMat = new THREE.MeshBasicMaterial({
        color: palette.glow,
        transparent: true,
        opacity: 0.9,
      });
      const window = new THREE.Mesh(windowGeom, windowMat);
      window.position.set(-0.6 + i * 0.5, 0.7, 0.63);
      window.name = `window_${i}`;
      group.add(window);
    }

    // Door
    const doorGeom = new THREE.BoxGeometry(0.4, 0.6, 0.05);
    const doorMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.4,
      roughness: 0.6,
    });
    const door = new THREE.Mesh(doorGeom, doorMat);
    door.position.set(0.6, 0.35, 0.63);
    group.add(door);

    // Conveyor belt (side)
    const conveyorGeom = new THREE.BoxGeometry(0.3, 0.1, 1.6);
    const conveyorMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.6,
      roughness: 0.4,
    });
    const conveyor = new THREE.Mesh(conveyorGeom, conveyorMat);
    conveyor.position.set(-1.0, 0.25, 0);
    group.add(conveyor);

    // Conveyor items (small boxes)
    for (let i = 0; i < 3; i++) {
      const itemGeom = new THREE.BoxGeometry(0.15, 0.15, 0.15);
      const itemMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? palette.accent : palette.glow,
      });
      const item = new THREE.Mesh(itemGeom, itemMat);
      item.position.set(-1.0, 0.38, -0.5 + i * 0.4);
      item.name = `conveyorItem_${i}`;
      group.add(item);
    }

    // Gears (decorative)
    const gearGeom = new THREE.TorusGeometry(0.2, 0.05, 6, 8);
    const gearMat = new THREE.MeshStandardMaterial({
      color: palette.accent,
      metalness: 0.6,
      roughness: 0.4,
    });
    const gear1 = new THREE.Mesh(gearGeom, gearMat);
    gear1.position.set(-0.8, 0.9, 0.63);
    gear1.name = 'gear1';
    group.add(gear1);

    const gear2 = new THREE.Mesh(gearGeom.clone(), gearMat.clone());
    gear2.position.set(-0.5, 1.05, 0.63);
    gear2.name = 'gear2';
    group.add(gear2);

    // Status light
    const statusLightGeom = new THREE.SphereGeometry(0.12, 16, 16);
    const statusLightMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.95,
    });
    const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
    statusLight.position.set(0.85, 1.0, 0.65);
    statusLight.name = 'statusLight';
    group.add(statusLight);

    // Status glow
    const glowGeom = new THREE.SphereGeometry(0.2, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[building.status],
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.set(0.85, 1.0, 0.65);
    glow.name = 'statusGlow';
    group.add(glow);

    // Base
    const baseGeom = new THREE.BoxGeometry(2.4, 0.1, 1.8);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      metalness: 0.4,
      roughness: 0.6,
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 0.05;
    base.receiveShadow = true;
    group.add(base);

    // Label
    const label = this.createLabel(building.name);
    label.position.set(0, 2.9, 0);
    label.name = 'buildingLabel';
    group.add(label);

    group.position.set(building.position.x, 0, building.position.z);

    return { group, statusLight, label };
  }

  /**
   * Create a text label sprite.
   */
  private createLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;

    const fontSize = 24;
    const padding = 20;
    const canvasHeight = 64;

    // Set initial canvas size for accurate text measurement
    canvas.width = 1024;
    canvas.height = canvasHeight;
    context.font = `bold ${fontSize}px Arial`;
    const measuredWidth = context.measureText(text).width;

    // Resize canvas to fit text (with minimum width)
    const minCanvasWidth = 256;
    canvas.width = Math.max(minCanvasWidth, measuredWidth + padding * 2);

    // Clear canvas and reset context after resize
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `bold ${fontSize}px Arial`;

    // Background
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 8);
    context.fill();

    // Text
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    // Scale must match canvas aspect ratio to avoid distortion
    // Original: 256x64 canvas = 2x0.5 sprite (both 4:1 ratio)
    const sprite = new THREE.Sprite(material);
    const baseHeight = 0.5;
    const widthScale = 2 * (canvas.width / 256);
    sprite.scale.set(widthScale, baseHeight, 1);

    return sprite;
  }

  /**
   * Update label text
   */
  private updateLabel(meshData: BuildingMeshData, text: string): void {
    const oldLabel = meshData.label;
    const newLabel = this.createLabel(text);
    newLabel.position.copy(oldLabel.position);
    newLabel.name = 'buildingLabel';

    meshData.group.remove(oldLabel);
    if (oldLabel.material instanceof THREE.SpriteMaterial) {
      if (oldLabel.material.map) oldLabel.material.map.dispose();
      oldLabel.material.dispose();
    }

    meshData.group.add(newLabel);
    meshData.label = newLabel;
  }

  /**
   * Add a building to the scene.
   */
  addBuilding(building: Building): void {
    // Remove existing if present
    this.removeBuilding(building.id);

    // Create mesh based on building style
    const meshData = this.createBuildingMesh(building);

    this.scene.add(meshData.group);
    this.buildingMeshes.set(building.id, meshData);
  }

  /**
   * Create the appropriate mesh based on building style.
   */
  private createBuildingMesh(building: Building): BuildingMeshData {
    const style = building.style || 'server-rack';

    switch (style) {
      case 'tower':
        return this.createTowerBuildingMesh(building);
      case 'dome':
        return this.createDomeBuildingMesh(building);
      case 'pyramid':
        return this.createPyramidBuildingMesh(building);
      case 'desktop':
        return this.createDesktopBuildingMesh(building);
      case 'filing-cabinet':
        return this.createFilingCabinetBuildingMesh(building);
      case 'satellite':
        return this.createSatelliteBuildingMesh(building);
      case 'crystal':
        return this.createCrystalBuildingMesh(building);
      case 'factory':
        return this.createFactoryBuildingMesh(building);
      case 'server-rack':
      default:
        return this.createServerBuildingMesh(building);
    }
  }

  /**
   * Remove a building from the scene.
   */
  removeBuilding(buildingId: string): void {
    const meshData = this.buildingMeshes.get(buildingId);
    if (meshData) {
      this.scene.remove(meshData.group);
      this.disposeGroup(meshData.group);
      this.buildingMeshes.delete(buildingId);
    }
  }

  /**
   * Update building position directly (for dragging).
   * Does not update the store, just the visual.
   */
  setBuildingPosition(buildingId: string, pos: { x: number; z: number }): void {
    const meshData = this.buildingMeshes.get(buildingId);
    if (meshData) {
      meshData.group.position.set(pos.x, 0, pos.z);
    }
  }

  /**
   * Update a building's visuals.
   */
  updateBuilding(building: Building): void {
    const meshData = this.buildingMeshes.get(building.id);
    if (!meshData) {
      this.addBuilding(building);
      return;
    }

    // Update position
    meshData.group.position.set(building.position.x, 0, building.position.z);

    // Update status light color
    const statusColor = STATUS_COLORS[building.status];
    const statusLight = meshData.group.getObjectByName('statusLight') as THREE.Mesh;
    if (statusLight && statusLight.material instanceof THREE.MeshBasicMaterial) {
      statusLight.material.color.setHex(statusColor);
    }

    const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
    if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
      statusGlow.material.color.setHex(statusColor);
    }

    // Update label if name changed
    const currentLabel = meshData.label;
    const canvas = (currentLabel.material as THREE.SpriteMaterial).map?.image as HTMLCanvasElement;
    if (canvas) {
      // Simple check - just update if needed
      this.updateLabel(meshData, building.name);
    }
  }

  /**
   * Highlight a building (when selected).
   */
  highlightBuilding(buildingId: string | null): void {
    // Remove highlight from all previously selected buildings
    for (const prevId of this.selectedBuildingIds) {
      const prevMeshData = this.buildingMeshes.get(prevId);
      if (prevMeshData) {
        const body = prevMeshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x000000);
        }
      }
    }

    this.selectedBuildingIds.clear();

    // Add highlight to new selection
    if (buildingId) {
      this.selectedBuildingIds.add(buildingId);
      const meshData = this.buildingMeshes.get(buildingId);
      if (meshData) {
        const body = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x222244);
        }
      }
    }
  }

  /**
   * Highlight multiple buildings (for drag selection).
   */
  highlightBuildings(buildingIds: string[]): void {
    // Remove highlight from all previously selected buildings
    for (const prevId of this.selectedBuildingIds) {
      const prevMeshData = this.buildingMeshes.get(prevId);
      if (prevMeshData) {
        const body = prevMeshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x000000);
        }
      }
    }

    this.selectedBuildingIds.clear();

    // Add highlight to all new selections
    for (const buildingId of buildingIds) {
      this.selectedBuildingIds.add(buildingId);
      const meshData = this.buildingMeshes.get(buildingId);
      if (meshData) {
        const body = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x222244);
        }
      }
    }
  }

  /**
   * Get building mesh data for screen position calculation.
   */
  getBuildingMeshData(): Map<string, BuildingMeshData> {
    return this.buildingMeshes;
  }

  /**
   * Get hitbox dimensions for a building style.
   */
  private getHitboxForStyle(style: BuildingStyle): { halfWidth: number; halfDepth: number } {
    switch (style) {
      case 'desktop':
        return { halfWidth: 1.4, halfDepth: 1.4 }; // 2.8 x 2.8 base
      case 'filing-cabinet':
        return { halfWidth: 1.3, halfDepth: 0.7 }; // 2.6 x 1.4 base
      case 'factory':
        return { halfWidth: 1.0, halfDepth: 0.7 }; // 2.0 x 1.4 roof
      case 'satellite':
        return { halfWidth: 0.65, halfDepth: 0.55 }; // 1.3 x 1.1 base
      case 'crystal':
        return { halfWidth: 0.8, halfDepth: 0.8 }; // Crystal floats, generous hitbox
      case 'tower':
        return { halfWidth: 0.6, halfDepth: 0.4 }; // 1.2 x 0.8 tower
      case 'dome':
        return { halfWidth: 0.8, halfDepth: 0.8 }; // Dome shape
      case 'pyramid':
        return { halfWidth: 0.75, halfDepth: 0.75 }; // Pyramid shape
      case 'server-rack':
      default:
        return { halfWidth: 0.75, halfDepth: 0.55 }; // 1.5 x 1.1 base
    }
  }

  /**
   * Get building at a world position (for click detection).
   */
  getBuildingAtPosition(pos: { x: number; z: number }): Building | null {
    const state = store.getState();

    for (const building of state.buildings.values()) {
      const hitbox = this.getHitboxForStyle(building.style);
      const dx = Math.abs(pos.x - building.position.x);
      const dz = Math.abs(pos.z - building.position.z);

      if (dx <= hitbox.halfWidth && dz <= hitbox.halfDepth) {
        return building;
      }
    }

    return null;
  }

  /**
   * Get all building meshes for raycasting.
   */
  getBuildingMeshes(): THREE.Group[] {
    return Array.from(this.buildingMeshes.values()).map(m => m.group);
  }

  /**
   * Sync buildings from store.
   */
  syncFromStore(): void {
    const state = store.getState();

    // Remove meshes for deleted buildings
    for (const buildingId of this.buildingMeshes.keys()) {
      if (!state.buildings.has(buildingId)) {
        this.removeBuilding(buildingId);
      }
    }

    // Add/update meshes for existing buildings
    for (const building of state.buildings.values()) {
      if (this.buildingMeshes.has(building.id)) {
        this.updateBuilding(building);
      } else {
        this.addBuilding(building);
      }
    }
  }

  /**
   * Update animations (call in render loop).
   */
  update(deltaTime: number): void {
    this.animationTime += deltaTime;

    const state = store.getState();

    for (const [buildingId, meshData] of this.buildingMeshes) {
      const building = state.buildings.get(buildingId);
      if (!building) continue;

      const style = building.style || 'server-rack';

      // ===== IDLE ANIMATIONS (always run, regardless of status) =====
      // Subtle breathing/hover effect on main body
      const buildingBody = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
      const idleHover = Math.sin(this.animationTime * 0.8) * 0.02;

      switch (style) {
        case 'server-rack':
          // LEDs blink on/off randomly when idle (standby mode)
          for (let i = 0; i < 5; i++) {
            const led = meshData.group.getObjectByName(`led_${i}`) as THREE.Mesh;
            if (led && led.material instanceof THREE.MeshBasicMaterial) {
              // Occasional random blink
              const blinkPhase = Math.sin(this.animationTime * 0.8 + i * 1.2);
              led.material.opacity = blinkPhase > 0.3 ? 0.6 : 0.15;
            }
            const activityLed = meshData.group.getObjectByName(`activityLed_${i}`) as THREE.Mesh;
            if (activityLed && activityLed.material instanceof THREE.MeshBasicMaterial) {
              // Activity LEDs mostly off, occasional flicker
              activityLed.material.opacity = Math.random() > 0.97 ? 0.5 : 0.1;
            }
          }
          break;

        case 'desktop':
          // Subtle monitor tilt
          if (buildingBody) {
            buildingBody.rotation.y = Math.sin(this.animationTime * 0.3) * 0.01;
          }
          // Dim screen lines when idle
          for (let i = 0; i < 6; i++) {
            const codeLine = meshData.group.getObjectByName(`codeLine_${i}`) as THREE.Mesh;
            if (codeLine && codeLine.material instanceof THREE.MeshBasicMaterial) {
              codeLine.material.opacity = 0.3 + Math.sin(this.animationTime * 0.4 + i * 0.2) * 0.1;
            }
          }
          break;

        case 'filing-cabinet':
          // Gentle sway
          meshData.group.rotation.y = Math.sin(this.animationTime * 0.5) * 0.005;
          // Dim indicator lights when idle
          for (let i = 0; i < 4; i++) {
            const indicator = meshData.group.getObjectByName(`indicator_${i}`) as THREE.Mesh;
            if (indicator && indicator.material instanceof THREE.MeshBasicMaterial) {
              indicator.material.opacity = 0.3 + Math.sin(this.animationTime * 0.6 + i * 0.4) * 0.15;
            }
          }
          break;

        case 'satellite':
          // Slow dish scan even when idle
          const idleDishGroup = meshData.group.getObjectByName('dishGroup');
          if (idleDishGroup) {
            idleDishGroup.rotation.y += deltaTime * 0.1;
          }
          // Dim signal waves when idle
          for (let i = 0; i < 3; i++) {
            const wave = meshData.group.getObjectByName(`wave_${i}`) as THREE.Mesh;
            if (wave && wave.material instanceof THREE.MeshBasicMaterial) {
              wave.material.opacity = 0.15 + Math.sin(this.animationTime * 0.5 + i * 0.3) * 0.1;
            }
          }
          break;

        case 'crystal':
          // Crystal always floats and rotates slowly
          if (buildingBody) {
            buildingBody.rotation.y += deltaTime * 0.2;
            buildingBody.position.y = 1.8 + Math.sin(this.animationTime * 0.8) * 0.05;
          }
          const idleCrystalInner = meshData.group.getObjectByName('crystalInner') as THREE.Mesh;
          if (idleCrystalInner) {
            idleCrystalInner.rotation.y -= deltaTime * 0.3;
            idleCrystalInner.position.y = 1.8 + Math.sin(this.animationTime * 0.8) * 0.05;
            if (idleCrystalInner.material instanceof THREE.MeshBasicMaterial) {
              idleCrystalInner.material.opacity = 0.25 + Math.sin(this.animationTime * 0.6) * 0.15;
            }
          }
          const idleEnergyField = meshData.group.getObjectByName('energyField') as THREE.Mesh;
          if (idleEnergyField) {
            idleEnergyField.rotation.y += deltaTime * 0.1;
            idleEnergyField.position.y = 1.8 + Math.sin(this.animationTime * 0.8) * 0.05;
            if (idleEnergyField.material instanceof THREE.MeshBasicMaterial) {
              idleEnergyField.material.opacity = 0.15 + Math.sin(this.animationTime * 0.5) * 0.1;
            }
          }
          // Particles orbit slowly even when idle
          for (let i = 0; i < 6; i++) {
            const particle = meshData.group.getObjectByName(`particle_${i}`) as THREE.Mesh;
            if (particle) {
              const angle = (i / 6) * Math.PI * 2 + this.animationTime * 0.3;
              particle.position.x = Math.cos(angle) * 1.2;
              particle.position.z = Math.sin(angle) * 1.2;
              particle.position.y = 1.8 + Math.sin(this.animationTime * 0.8) * 0.05 + Math.sin(angle * 2) * 0.2;
            }
          }
          // Energy beam dim pulse
          const idleEnergyBeam = meshData.group.getObjectByName('energyBeam') as THREE.Mesh;
          if (idleEnergyBeam && idleEnergyBeam.material instanceof THREE.MeshBasicMaterial) {
            idleEnergyBeam.material.opacity = 0.2 + Math.sin(this.animationTime * 0.7) * 0.15;
          }
          break;

        case 'factory':
          // Gears always turn slowly
          const idleGear1 = meshData.group.getObjectByName('gear1') as THREE.Mesh;
          const idleGear2 = meshData.group.getObjectByName('gear2') as THREE.Mesh;
          if (idleGear1) idleGear1.rotation.z += deltaTime * 0.3;
          if (idleGear2) idleGear2.rotation.z -= deltaTime * 0.4;
          // Dim windows breathe when idle
          for (let i = 0; i < 3; i++) {
            const win = meshData.group.getObjectByName(`window_${i}`) as THREE.Mesh;
            if (win && win.material instanceof THREE.MeshBasicMaterial) {
              win.material.opacity = 0.3 + Math.sin(this.animationTime * 0.4 + i * 0.5) * 0.15;
            }
          }
          // Conveyor items slide slowly
          for (let i = 0; i < 3; i++) {
            const item = meshData.group.getObjectByName(`conveyorItem_${i}`) as THREE.Mesh;
            if (item) {
              item.position.z = ((item.position.z + deltaTime * 0.05 + 0.5) % 1.2) - 0.5;
            }
          }
          // Slow smoke rising when idle (less dense)
          for (let i = 0; i < 4; i++) {
            const smoke = meshData.group.getObjectByName(`smoke_${i}`) as THREE.Mesh;
            if (smoke) {
              const baseY = 2.5 + i * 0.25;
              const rise = (this.animationTime * 0.15 + i * 0.3) % 1.5;
              smoke.position.y = baseY + rise;
              smoke.position.x = 0.5 + Math.sin(this.animationTime * 0.3 + i) * 0.05;
              if (smoke.material instanceof THREE.MeshBasicMaterial) {
                smoke.material.opacity = Math.max(0, (0.25 - i * 0.05) * (1 - rise / 1.5));
              }
            }
          }
          break;

        case 'tower':
          // Antenna slowly rotates
          const idleAntenna = meshData.group.getObjectByName('antenna');
          if (idleAntenna) {
            idleAntenna.rotation.y += deltaTime * 0.3;
          }
          // Dim window bands breathe
          for (let i = 0; i < 4; i++) {
            const band = meshData.group.getObjectByName(`windowBand_${i}`) as THREE.Mesh;
            if (band && band.material instanceof THREE.MeshBasicMaterial) {
              band.material.opacity = 0.3 + Math.sin(this.animationTime * 0.5 + i * 0.4) * 0.15;
            }
          }
          break;

        case 'dome':
          // Rings slowly rotate
          const idleRing1 = meshData.group.getObjectByName('energyRing') as THREE.Mesh;
          const idleRing2 = meshData.group.getObjectByName('energyRing2') as THREE.Mesh;
          if (idleRing1) idleRing1.rotation.z += deltaTime * 0.2;
          if (idleRing2) idleRing2.rotation.z -= deltaTime * 0.15;
          // Inner dome dim pulse
          const idleInnerDome = meshData.group.getObjectByName('innerDome') as THREE.Mesh;
          if (idleInnerDome && idleInnerDome.material instanceof THREE.MeshBasicMaterial) {
            idleInnerDome.material.opacity = 0.15 + Math.sin(this.animationTime * 0.6) * 0.1;
          }
          // Beams dim pulse
          for (let i = 0; i < 4; i++) {
            const beam = meshData.group.getObjectByName(`beam_${i}`) as THREE.Mesh;
            if (beam && beam.material instanceof THREE.MeshBasicMaterial) {
              beam.material.opacity = 0.2 + Math.sin(this.animationTime * 0.5 + i * 0.3) * 0.1;
            }
          }
          break;

        case 'pyramid':
          // Eye gently floats
          const idleEye = meshData.group.getObjectByName('pyramidEye') as THREE.Mesh;
          const idleEyeGlow = meshData.group.getObjectByName('pyramidEyeGlow') as THREE.Mesh;
          if (idleEye) {
            idleEye.position.y = 2.7 + Math.sin(this.animationTime * 0.5) * 0.03;
            if (idleEye.material instanceof THREE.MeshBasicMaterial) {
              idleEye.material.opacity = 0.4 + Math.sin(this.animationTime * 0.7) * 0.2;
            }
          }
          if (idleEyeGlow) {
            idleEyeGlow.position.y = 2.7 + Math.sin(this.animationTime * 0.5) * 0.03;
            if (idleEyeGlow.material instanceof THREE.MeshBasicMaterial) {
              idleEyeGlow.material.opacity = 0.15 + Math.sin(this.animationTime * 0.7) * 0.1;
            }
          }
          // Core dim pulse
          const idleCore = meshData.group.getObjectByName('pyramidCore') as THREE.Mesh;
          if (idleCore && idleCore.material instanceof THREE.MeshBasicMaterial) {
            idleCore.material.opacity = 0.2 + Math.sin(this.animationTime * 0.5) * 0.1;
          }
          break;
      }

      // Common status glow animation
      const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;

      if (building.status === 'running') {
        const pulse = Math.sin(this.animationTime * 3) * 0.2 + 0.8;
        if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
          statusGlow.material.opacity = 0.3 * pulse;
        }

        // Style-specific running animations
        switch (style) {
          case 'server-rack':
            // Blink activity LEDs randomly
            for (let i = 0; i < 5; i++) {
              const activityLed = meshData.group.getObjectByName(`activityLed_${i}`) as THREE.Mesh;
              if (activityLed && activityLed.material instanceof THREE.MeshBasicMaterial) {
                const shouldBlink = Math.random() > 0.95;
                if (shouldBlink) {
                  activityLed.material.opacity = activityLed.material.opacity > 0.5 ? 0.2 : 0.9;
                }
              }
            }
            break;

          case 'tower':
            // Rotate antenna
            const antenna = meshData.group.getObjectByName('antenna');
            if (antenna) {
              antenna.rotation.y += deltaTime * 2;
            }
            // Pulse window bands
            for (let i = 0; i < 4; i++) {
              const band = meshData.group.getObjectByName(`windowBand_${i}`) as THREE.Mesh;
              if (band && band.material instanceof THREE.MeshBasicMaterial) {
                const bandPulse = Math.sin(this.animationTime * 4 + i * 0.5) * 0.3 + 0.7;
                band.material.opacity = bandPulse;
              }
            }
            break;

          case 'dome':
            // Rotate energy rings
            const ring1 = meshData.group.getObjectByName('energyRing') as THREE.Mesh;
            const ring2 = meshData.group.getObjectByName('energyRing2') as THREE.Mesh;
            if (ring1) ring1.rotation.z += deltaTime * 1.5;
            if (ring2) ring2.rotation.z -= deltaTime * 1.2;
            // Pulse inner dome
            const innerDome = meshData.group.getObjectByName('innerDome') as THREE.Mesh;
            if (innerDome && innerDome.material instanceof THREE.MeshBasicMaterial) {
              innerDome.material.opacity = 0.2 + Math.sin(this.animationTime * 2) * 0.15;
            }
            // Pulse beams
            for (let i = 0; i < 4; i++) {
              const beam = meshData.group.getObjectByName(`beam_${i}`) as THREE.Mesh;
              if (beam && beam.material instanceof THREE.MeshBasicMaterial) {
                const beamPulse = Math.sin(this.animationTime * 5 + i * 1.5) * 0.3 + 0.6;
                beam.material.opacity = beamPulse;
              }
            }
            break;

          case 'pyramid':
            // Pulse core
            const core = meshData.group.getObjectByName('pyramidCore') as THREE.Mesh;
            if (core && core.material instanceof THREE.MeshBasicMaterial) {
              core.material.opacity = 0.4 + Math.sin(this.animationTime * 2) * 0.2;
            }
            // Pulse eye
            const eye = meshData.group.getObjectByName('pyramidEye') as THREE.Mesh;
            const eyeGlow = meshData.group.getObjectByName('pyramidEyeGlow') as THREE.Mesh;
            if (eye && eye.material instanceof THREE.MeshBasicMaterial) {
              eye.material.opacity = 0.7 + Math.sin(this.animationTime * 3) * 0.3;
            }
            if (eyeGlow && eyeGlow.material instanceof THREE.MeshBasicMaterial) {
              eyeGlow.material.opacity = 0.2 + Math.sin(this.animationTime * 3) * 0.15;
            }
            // Float eye up and down
            if (eye) {
              eye.position.y = 2.7 + Math.sin(this.animationTime * 1.5) * 0.1;
            }
            if (eyeGlow) {
              eyeGlow.position.y = 2.7 + Math.sin(this.animationTime * 1.5) * 0.1;
            }
            break;

          case 'desktop':
            // Flicker code lines on screen
            for (let i = 0; i < 6; i++) {
              const codeLine = meshData.group.getObjectByName(`codeLine_${i}`) as THREE.Mesh;
              if (codeLine && codeLine.material instanceof THREE.MeshBasicMaterial) {
                const flicker = Math.random() > 0.98 ? 0.4 : 0.8;
                codeLine.material.opacity = flicker;
              }
            }
            // Blink CPU LED
            const cpuLed = meshData.group.getObjectByName('cpuLed') as THREE.Mesh;
            if (cpuLed && cpuLed.material instanceof THREE.MeshBasicMaterial) {
              const ledBlink = Math.sin(this.animationTime * 6) > 0 ? 0.9 : 0.3;
              cpuLed.material.opacity = ledBlink;
            }
            break;

          case 'filing-cabinet':
            // Pulse indicator lights
            for (let i = 0; i < 4; i++) {
              const indicator = meshData.group.getObjectByName(`indicator_${i}`) as THREE.Mesh;
              if (indicator && indicator.material instanceof THREE.MeshBasicMaterial) {
                const indicatorPulse = Math.sin(this.animationTime * 3 + i * 0.8) * 0.3 + 0.7;
                indicator.material.opacity = indicatorPulse;
              }
            }
            // Slightly animate drawer handles (subtle vibration when running)
            for (let i = 0; i < 4; i++) {
              const handle = meshData.group.getObjectByName(`handle_${i}`) as THREE.Mesh;
              if (handle) {
                handle.position.z = 0.47 + Math.sin(this.animationTime * 8 + i) * 0.005;
              }
            }
            break;

          case 'satellite':
            // Rotate dish
            const dishGroup = meshData.group.getObjectByName('dishGroup');
            if (dishGroup) {
              dishGroup.rotation.y += deltaTime * 0.5;
            }
            // Pulse signal
            const signal = meshData.group.getObjectByName('signal') as THREE.Mesh;
            if (signal && signal.material instanceof THREE.MeshBasicMaterial) {
              signal.material.opacity = 0.6 + Math.sin(this.animationTime * 8) * 0.4;
            }
            // Animate signal waves
            for (let i = 0; i < 3; i++) {
              const wave = meshData.group.getObjectByName(`wave_${i}`) as THREE.Mesh;
              if (wave && wave.material instanceof THREE.MeshBasicMaterial) {
                const waveScale = 1 + Math.sin(this.animationTime * 4 + i) * 0.1;
                wave.scale.set(waveScale, waveScale, 1);
                wave.material.opacity = (0.5 - i * 0.15) * (0.5 + Math.sin(this.animationTime * 4 + i) * 0.5);
              }
            }
            break;

          case 'crystal':
            // Rotate crystal and inner glow
            const crystal = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
            const crystalInner = meshData.group.getObjectByName('crystalInner') as THREE.Mesh;
            const energyField = meshData.group.getObjectByName('energyField') as THREE.Mesh;
            if (crystal) {
              crystal.rotation.y += deltaTime * 0.8;
              crystal.position.y = 1.8 + Math.sin(this.animationTime * 1.5) * 0.1;
            }
            if (crystalInner) {
              crystalInner.rotation.y -= deltaTime * 1.2;
              crystalInner.position.y = 1.8 + Math.sin(this.animationTime * 1.5) * 0.1;
              if (crystalInner.material instanceof THREE.MeshBasicMaterial) {
                crystalInner.material.opacity = 0.4 + Math.sin(this.animationTime * 3) * 0.2;
              }
            }
            if (energyField) {
              energyField.rotation.y += deltaTime * 0.3;
              energyField.rotation.x += deltaTime * 0.2;
              energyField.position.y = 1.8 + Math.sin(this.animationTime * 1.5) * 0.1;
            }
            // Orbit particles around crystal
            for (let i = 0; i < 6; i++) {
              const particle = meshData.group.getObjectByName(`particle_${i}`) as THREE.Mesh;
              if (particle) {
                const angle = (i / 6) * Math.PI * 2 + this.animationTime * 1.5;
                const radius = 1.2 + Math.sin(this.animationTime * 2 + i) * 0.1;
                particle.position.x = Math.cos(angle) * radius;
                particle.position.z = Math.sin(angle) * radius;
                particle.position.y = 1.8 + Math.sin(this.animationTime * 1.5) * 0.1 + Math.sin(angle * 2) * 0.3;
              }
            }
            // Pulse energy beam
            const energyBeam = meshData.group.getObjectByName('energyBeam') as THREE.Mesh;
            if (energyBeam && energyBeam.material instanceof THREE.MeshBasicMaterial) {
              energyBeam.material.opacity = 0.4 + Math.sin(this.animationTime * 4) * 0.3;
            }
            break;

          case 'factory':
            // Animate smoke rising
            for (let i = 0; i < 4; i++) {
              const smoke = meshData.group.getObjectByName(`smoke_${i}`) as THREE.Mesh;
              if (smoke) {
                // Smoke rises and drifts
                const baseY = 2.5 + i * 0.25;
                const rise = (this.animationTime * 0.5 + i * 0.3) % 1.5;
                smoke.position.y = baseY + rise;
                smoke.position.x = 0.5 + Math.sin(this.animationTime + i) * 0.1;
                // Fade out as it rises
                if (smoke.material instanceof THREE.MeshBasicMaterial) {
                  smoke.material.opacity = Math.max(0, (0.6 - i * 0.12) * (1 - rise / 1.5));
                }
                // Reset when too high
                if (rise > 1.4) {
                  smoke.position.y = baseY;
                }
              }
            }
            // Rotate gears
            const gear1 = meshData.group.getObjectByName('gear1') as THREE.Mesh;
            const gear2 = meshData.group.getObjectByName('gear2') as THREE.Mesh;
            if (gear1) gear1.rotation.z += deltaTime * 2;
            if (gear2) gear2.rotation.z -= deltaTime * 2.5;
            // Move conveyor items
            for (let i = 0; i < 3; i++) {
              const item = meshData.group.getObjectByName(`conveyorItem_${i}`) as THREE.Mesh;
              if (item) {
                item.position.z = ((item.position.z + deltaTime * 0.3 + 0.5) % 1.2) - 0.5;
              }
            }
            // Flicker windows
            for (let i = 0; i < 3; i++) {
              const win = meshData.group.getObjectByName(`window_${i}`) as THREE.Mesh;
              if (win && win.material instanceof THREE.MeshBasicMaterial) {
                const flicker = Math.random() > 0.99 ? 0.5 : 0.8;
                win.material.opacity = flicker;
              }
            }
            break;
        }
      } else if (building.status === 'starting' || building.status === 'stopping') {
        // Fast pulse when starting/stopping
        const pulse = Math.sin(this.animationTime * 8) * 0.5 + 0.5;
        if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
          statusGlow.material.opacity = 0.5 * pulse;
        }
      } else if (building.status === 'error') {
        // Slow pulse when error
        const pulse = Math.sin(this.animationTime * 2) * 0.5 + 0.5;
        if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
          statusGlow.material.opacity = 0.4 * pulse;
        }
      }
    }
  }

  /**
   * Dispose of a group and its children.
   */
  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        const mat = child.material as THREE.SpriteMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    });
  }

  /**
   * Cleanup.
   */
  dispose(): void {
    for (const buildingId of this.buildingMeshes.keys()) {
      this.removeBuilding(buildingId);
    }
  }
}
