/**
 * Battlefield Environment
 *
 * Creates and manages the battlefield environment with day/night cycle.
 */

import * as THREE from 'three';

// Import from decomposed modules
import type { FloorStyle, TimeConfig, GalacticState } from './types';
import { generateFloorTexture } from './floorTextures';
import { createGalacticElements, removeGalacticElements, updateGalacticAnimation } from './galacticFloor';
import { getTimeConfig } from './timeConfig';
import { createSun, createMoon, createStars, createClouds, updateClouds, setCloudOpacity, type CloudState } from './celestial';
import { createTerrainElements, createGrass } from './terrain';

// Re-export types for backwards compatibility
export type { FloorStyle } from './types';

/**
 * Creates and manages the battlefield environment with day/night cycle.
 */
export class Battlefield {
  private scene: THREE.Scene;
  private ground: THREE.Mesh | null = null;
  private gridHelper: THREE.GridHelper | null = null;

  // Time-based elements
  private sun: THREE.Sprite | null = null;
  private moon: THREE.Sprite | null = null;
  private stars: THREE.Points | null = null;
  private ambientLight: THREE.AmbientLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private mainLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private lampLights: THREE.PointLight[] = [];
  private windowMaterials: THREE.MeshStandardMaterial[] = [];

  // Terrain elements (for show/hide) - now using instanced meshes
  private trees: THREE.Group | null = null;
  private bushes: THREE.InstancedMesh | null = null;
  private house: THREE.Group | null = null;
  private lamps: THREE.Group | null = null;
  private grass: THREE.Mesh | null = null;
  private baseFogDensity = 0.01;
  private brightness = 1; // Brightness multiplier (0.2 = dark, 1 = normal, 2 = bright)
  private skyColorOverride: string | null = null; // null = use time-based sky color
  private currentFloorStyle: FloorStyle = 'concrete';

  // Galactic floor state
  private galacticState: GalacticState | null = null;

  // Cloud state
  private cloudState: CloudState | null = null;
  private cloudsVisible = true;

  // Debug: override time for testing (set to null to use real time)
  private debugHourOverride: number | null = null;

  // Reusable Color instance for applyTimeConfig to prevent allocations
  private tempColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set grid visibility.
   */
  setGridVisible(visible: boolean): void {
    if (this.gridHelper) {
      this.gridHelper.visible = visible;
    }
  }

  /**
   * Create the complete battlefield environment.
   */
  create(): void {
    this.createGround();
    this.grass = createGrass(this.scene);
    this.createGrid();
    // this.createLogo(); // Logo commented out

    // Create celestial bodies
    this.sun = createSun();
    this.scene.add(this.sun);
    this.moon = createMoon();
    this.scene.add(this.moon);
    this.stars = createStars();
    this.scene.add(this.stars);

    // Create clouds
    this.cloudState = createClouds();
    this.scene.add(this.cloudState.group);

    // Create terrain elements
    const terrain = createTerrainElements(this.scene);
    this.trees = terrain.trees;
    this.bushes = terrain.bushes;
    this.house = terrain.house;
    this.lamps = terrain.lamps;
    this.lampLights = terrain.lampLights;
    this.windowMaterials = terrain.windowMaterials;

    this.createLighting();
    this.createFog();

    // Apply initial time-based settings
    this.updateTimeOfDay();
  }

  /**
   * Update the environment based on current time of day.
   * Call this periodically or when time changes.
   */
  updateTimeOfDay(): void {
    const config = getTimeConfig(this.getCurrentHour());
    this.applyTimeConfig(config);
  }

  /**
   * Get the current hour (0-24) based on local timezone.
   */
  private getCurrentHour(): number {
    // Debug override for testing
    if (this.debugHourOverride !== null) {
      return this.debugHourOverride;
    }
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }

  /**
   * Set a debug time override for testing (null to use real time).
   */
  setDebugTime(hour: number | null): void {
    this.debugHourOverride = hour;
    this.updateTimeOfDay();
    console.log(`[Battlefield] Time set to: ${hour !== null ? `${hour}:00` : 'real time'}`);
  }

  /**
   * Set time mode for the environment.
   * @param mode - 'auto' for real time, or 'day'/'night'/'dawn'/'dusk' for fixed time
   */
  setTimeMode(mode: string): void {
    const modeToHour: Record<string, number | null> = {
      'auto': null,
      'day': 12,
      'night': 23,
      'dawn': 6,
      'dusk': 19.5,
    };
    const hour = modeToHour[mode] ?? null;
    this.debugHourOverride = hour;
    this.updateTimeOfDay();
    console.log(`[Battlefield] Time mode set to: ${mode} (${hour !== null ? `${hour}:00` : 'real time'})`);
  }

  /**
   * Set terrain configuration (show/hide elements, fog density, brightness, sky color).
   */
  setTerrainConfig(config: {
    showTrees: boolean;
    showBushes: boolean;
    showHouse: boolean;
    showLamps: boolean;
    showGrass: boolean;
    showClouds?: boolean;
    fogDensity: number;
    brightness?: number;
    skyColor?: string | null;
  }): void {
    // Toggle trees (instanced group)
    if (this.trees) {
      this.trees.visible = config.showTrees;
    }

    // Toggle bushes (instanced mesh)
    if (this.bushes) {
      this.bushes.visible = config.showBushes;
    }

    // Toggle house
    if (this.house) {
      this.house.visible = config.showHouse;
    }

    // Toggle lamps (instanced group) and their lights
    if (this.lamps) {
      this.lamps.visible = config.showLamps;
    }
    this.lampLights.forEach(light => { light.visible = config.showLamps; });

    // Toggle grass
    if (this.grass) {
      this.grass.visible = config.showGrass;
    }

    // Toggle clouds
    if (config.showClouds !== undefined) {
      this.cloudsVisible = config.showClouds;
      if (this.cloudState) {
        this.cloudState.group.visible = config.showClouds;
      }
    }

    // Update fog density (0 = off, 1 = normal, 2 = heavy)
    this.baseFogDensity = config.fogDensity * 0.008;

    // Update brightness (0.2 = dark, 1 = normal, 2 = bright)
    if (config.brightness !== undefined) {
      this.brightness = config.brightness;
    }

    // Update sky color override (null = use time-based color)
    if (config.skyColor !== undefined) {
      this.skyColorOverride = config.skyColor;
    }

    this.updateTimeOfDay(); // Re-apply time config which uses fog density, brightness, and sky color
  }

  /**
   * Set the floor texture style.
   */
  setFloorStyle(style: FloorStyle, force = false): void {
    if (this.currentFloorStyle === style && !force) return;
    const previousStyle = this.currentFloorStyle;
    this.currentFloorStyle = style;

    if (typeof window !== 'undefined' && (window as any).__TIDE_MEMORY_DEBUG__) {
      console.log(`[Battlefield] Memory: Switching floor from ${previousStyle} to ${style}`);
    }

    // Clean up galactic elements if switching away from galactic
    if (previousStyle === 'galactic') {
      removeGalacticElements(this.scene, this.galacticState, this.disposeMaterial.bind(this));
      this.galacticState = null;
      // Show ground again
      if (this.ground) {
        this.ground.visible = true;
      }
    }

    if (this.ground) {
      const material = this.ground.material as THREE.MeshStandardMaterial;

      // Special handling for galactic - HIDE the floor and show galaxy elements
      if (style === 'galactic') {
        console.log('[Battlefield] Creating galactic floor...');

        // Hide the regular ground completely
        this.ground.visible = false;

        // Create the galactic visuals
        this.galacticState = createGalacticElements(this.scene);

        console.log('[Battlefield] Galactic elements created');
      } else {
        // Show ground for non-galactic styles
        this.ground.visible = true;

        // Regular floor styles
        material.transparent = false;
        material.opacity = 1;
        material.side = THREE.FrontSide;
        material.depthWrite = true;
        this.ground!.renderOrder = 0;

        // CRITICAL: Dispose old texture BEFORE replacing to prevent memory leak
        const oldTexture = material.map;

        // Handle 'none' style - match the grass terrain
        if (style === 'none') {
          material.map = null;
          material.color.setHex(0x2d5a27); // Same as grass
          material.roughness = 0.9;
          material.metalness = 0;
          material.emissive.setHex(0x000000);
          material.emissiveIntensity = 0;
          material.needsUpdate = true;
        } else {
          const texture = generateFloorTexture(style);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Pokemon stadium should not repeat - single arena covering the floor
          texture.repeat.set(style === 'pokemon-stadium' ? 1 : 6, style === 'pokemon-stadium' ? 1 : 6);
          material.map = texture;
          material.needsUpdate = true;
        }

        // Dispose old texture AFTER setting the new one
        if (oldTexture) {
          oldTexture.dispose();
          if (typeof window !== 'undefined' && (window as any).__TIDE_MEMORY_DEBUG__) {
            console.log('[Battlefield] Memory: Disposed old floor texture');
          }
        }

        // Adjust material properties based on style
        switch (style) {
          case 'none':
            // Already handled above
            break;
          case 'metal':
            material.color.setHex(0x888899);
            material.roughness = 0.4;
            material.metalness = 0.8;
            material.emissive.setHex(0x000000);
            material.emissiveIntensity = 0;
            break;
          case 'hex':
            material.color.setHex(0x446688);
            material.roughness = 0.6;
            material.metalness = 0.4;
            material.emissive.setHex(0x112233);
            material.emissiveIntensity = 0.2;
            break;
          case 'circuit':
            material.color.setHex(0x224433);
            material.roughness = 0.7;
            material.metalness = 0.3;
            material.emissive.setHex(0x003322);
            material.emissiveIntensity = 0.4;
            break;
          case 'pokemon-stadium':
            material.color.setHex(0xaaaaaa); // Darken the texture slightly
            material.roughness = 1.0; // Fully matte, no reflections
            material.metalness = 0;
            material.emissive.setHex(0x000000);
            material.emissiveIntensity = 0;
            break;
          default: // concrete
            material.color.setHex(0x555555);
            material.roughness = 0.8;
            material.metalness = 0.1;
            material.emissive.setHex(0x000000);
            material.emissiveIntensity = 0;
        }
      }
    }
    console.log(`[Battlefield] Floor style set to: ${style}`);
  }

  /**
   * Update galactic floor animation (call from render loop).
   */
  updateGalacticAnimation(deltaTime: number): void {
    if (this.currentFloorStyle !== 'galactic' || !this.galacticState) return;
    updateGalacticAnimation(this.galacticState, deltaTime);
  }

  /**
   * Update cloud animation (call from render loop).
   */
  updateCloudAnimation(deltaTime: number): void {
    if (!this.cloudState || !this.cloudsVisible) return;
    updateClouds(this.cloudState, deltaTime);
  }

  /**
   * Helper to dispose a material and its textures.
   */
  private disposeMaterial(material: THREE.Material): void {
    if (material instanceof THREE.MeshBasicMaterial ||
        material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.SpriteMaterial) {
      material.map?.dispose();
    }
    material.dispose();
  }

  private applyTimeConfig(config: TimeConfig): void {
    // Update sky color - use override if set, otherwise use time-based color
    const skyColor = this.skyColorOverride
      ? parseInt(this.skyColorOverride.replace('#', ''), 16)
      : config.skyColor;

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(skyColor);
    } else {
      this.scene.background = this.tempColor.setHex(skyColor).clone();
    }

    // Update fog
    if (this.scene.fog instanceof THREE.FogExp2) {
      // If custom sky color is set, adjust fog color to match
      const fogColor = this.skyColorOverride
        ? parseInt(this.skyColorOverride.replace('#', ''), 16)
        : config.fogColor;
      this.scene.fog.color.setHex(fogColor);
      // Apply fog density with user's fog multiplier
      const fogMultiplier = this.baseFogDensity > 0 ? this.baseFogDensity / 0.008 : 0;
      this.scene.fog.density = config.fogDensity * fogMultiplier;
    }

    // Update sun
    if (this.sun) {
      this.sun.position.copy(config.sunPosition);
      this.sun.material.opacity = config.sunOpacity;
      this.sun.visible = config.sunOpacity > 0.01;
    }

    // Update moon
    if (this.moon) {
      this.moon.position.copy(config.moonPosition);
      this.moon.material.opacity = config.moonOpacity;
      this.moon.visible = config.moonOpacity > 0.01;
    }

    // Update stars
    if (this.stars) {
      (this.stars.material as THREE.PointsMaterial).opacity = config.starsOpacity;
      this.stars.visible = config.starsOpacity > 0.01;
    }

    // Update ambient light (apply brightness multiplier)
    if (this.ambientLight) {
      this.ambientLight.color.setHex(config.ambientColor);
      this.ambientLight.intensity = config.ambientIntensity * this.brightness;
    }

    // Update hemisphere light (apply brightness multiplier)
    if (this.hemiLight) {
      this.hemiLight.color.setHex(config.hemiSkyColor);
      this.hemiLight.groundColor.setHex(config.hemiGroundColor);
      this.hemiLight.intensity = config.hemiIntensity * this.brightness;
    }

    // Update main light (sun/moon light) (apply brightness multiplier)
    if (this.mainLight) {
      this.mainLight.color.setHex(config.mainLightColor);
      this.mainLight.intensity = config.mainLightIntensity * this.brightness;
      // Position main light based on which celestial body is visible
      if (config.sunOpacity > config.moonOpacity) {
        this.mainLight.position.copy(config.sunPosition);
      } else {
        this.mainLight.position.copy(config.moonPosition);
      }
    }

    // Update street lamp lights
    this.lampLights.forEach(light => {
      light.intensity = config.lampIntensity;
    });

    // Update window emissive
    this.windowMaterials.forEach(mat => {
      mat.emissiveIntensity = config.windowEmissive;
    });

    // Update cloud opacity based on time of day
    // Clouds are most visible during day, less at dawn/dusk, barely at night
    if (this.cloudState && this.cloudsVisible) {
      let cloudOpacity: number;
      switch (config.phase) {
        case 'day':
          cloudOpacity = 1.0;
          break;
        case 'dawn':
        case 'dusk':
          cloudOpacity = 0.7;
          break;
        case 'night':
          cloudOpacity = 0.2;
          break;
        default:
          cloudOpacity = 1.0;
      }
      setCloudOpacity(this.cloudState, cloudOpacity);
    }
  }

  /**
   * Get the ground mesh for raycasting.
   */
  getGround(): THREE.Mesh | null {
    return this.ground;
  }

  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(30, 30);

    // Generate programmatic texture
    const floorTexture = generateFloorTexture(this.currentFloorStyle);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(this.currentFloorStyle === 'galactic' ? 1 : 6, this.currentFloorStyle === 'galactic' ? 1 : 6);

    const material = new THREE.MeshStandardMaterial({
      map: floorTexture,
      color: 0x555555,
      roughness: 0.8,
      metalness: 0.1,
    });

    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';

    this.scene.add(this.ground);
  }

  private createGrid(): void {
    this.gridHelper = new THREE.GridHelper(30, 30, 0x2a2a3a, 0x1a1a2a);
    this.gridHelper.position.y = 0.01;
    this.scene.add(this.gridHelper);
  }

  private createLogo(): void {
    const textureLoader = new THREE.TextureLoader();
    const logoTexture = textureLoader.load('/assets/textures/logo-blanco.png');

    // Use aspect ratio close to the actual logo (it's wider than tall)
    const logoWidth = 10;
    const logoHeight = 4;

    const geometry = new THREE.PlaneGeometry(logoWidth, logoHeight);
    const material = new THREE.MeshBasicMaterial({
      map: logoTexture,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const logo = new THREE.Mesh(geometry, material);
    logo.rotation.x = -Math.PI / 2;
    logo.position.set(0, 0.02, 0);
    logo.name = 'tideLogo';

    this.scene.add(logo);
  }

  private createFog(): void {
    // Fog will be configured by time of day
    this.scene.fog = new THREE.FogExp2(0x0a1a2a, 0.01);
    this.scene.background = new THREE.Color(0x0a1a2a); // Dark blue
  }

  private createLighting(): void {
    // Ambient light - increased base intensity
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    // Hemisphere light - brighter for better model illumination
    this.hemiLight = new THREE.HemisphereLight(0xffffee, 0x556677, 0.7);
    this.hemiLight.position.set(0, 20, 0);
    this.scene.add(this.hemiLight);

    // Main directional light (sun/moon)
    this.mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.mainLight.position.set(30, 50, -30);
    this.mainLight.castShadow = true;
    this.mainLight.shadow.mapSize.width = 2048;
    this.mainLight.shadow.mapSize.height = 2048;
    this.mainLight.shadow.camera.near = 0.5;
    this.mainLight.shadow.camera.far = 150;
    this.mainLight.shadow.camera.left = -35;
    this.mainLight.shadow.camera.right = 35;
    this.mainLight.shadow.camera.top = 35;
    this.mainLight.shadow.camera.bottom = -35;
    this.scene.add(this.mainLight);

    // Fill light - increased intensity for better shadow fill
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.fillLight.position.set(-10, 15, 10);
    this.scene.add(this.fillLight);

    // Back/rim light for model definition and highlights
    const backLight = new THREE.DirectionalLight(0xaaccff, 0.5);
    backLight.position.set(0, 20, 30);
    this.scene.add(backLight);
  }

  /**
   * Dispose all battlefield resources.
   */
  dispose(): void {
    // Dispose galactic elements
    removeGalacticElements(this.scene, this.galacticState, this.disposeMaterial.bind(this));
    this.galacticState = null;

    // Dispose logo (created in createLogo)
    const logo = this.scene.getObjectByName('tideLogo') as THREE.Mesh | undefined;
    if (logo) {
      logo.geometry?.dispose();
      this.disposeMaterial(logo.material as THREE.Material);
      this.scene.remove(logo);
    }

    // Dispose ground
    if (this.ground) {
      this.ground.geometry.dispose();
      this.disposeMaterial(this.ground.material as THREE.Material);
      this.scene.remove(this.ground);
    }

    // Dispose grid
    if (this.gridHelper) {
      this.gridHelper.geometry.dispose();
      if (this.gridHelper.material instanceof THREE.Material) {
        this.gridHelper.material.dispose();
      }
      this.scene.remove(this.gridHelper);
    }

    // Dispose grass
    if (this.grass) {
      this.grass.geometry.dispose();
      this.disposeMaterial(this.grass.material as THREE.Material);
      this.scene.remove(this.grass);
    }

    // Dispose sun
    if (this.sun) {
      this.disposeMaterial(this.sun.material);
      this.scene.remove(this.sun);
    }

    // Dispose moon
    if (this.moon) {
      this.disposeMaterial(this.moon.material);
      this.scene.remove(this.moon);
    }

    // Dispose stars
    if (this.stars) {
      this.stars.geometry.dispose();
      (this.stars.material as THREE.Material).dispose();
      this.scene.remove(this.stars);
    }

    // Dispose trees (instanced group)
    if (this.trees) {
      this.disposeGroup(this.trees);
      this.scene.remove(this.trees);
      this.trees = null;
    }

    // Dispose bushes (instanced mesh)
    if (this.bushes) {
      this.bushes.geometry.dispose();
      (this.bushes.material as THREE.Material).dispose();
      this.scene.remove(this.bushes);
      this.bushes = null;
    }

    // Dispose house
    if (this.house) {
      this.disposeGroup(this.house);
      this.scene.remove(this.house);
      this.house = null;
    }

    // Dispose lamps (instanced group)
    if (this.lamps) {
      this.disposeGroup(this.lamps);
      this.scene.remove(this.lamps);
      this.lamps = null;
    }

    // Dispose lamp lights
    for (const light of this.lampLights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.lampLights = [];

    // Dispose window materials
    this.windowMaterials = [];

    // Dispose lights
    if (this.ambientLight) this.scene.remove(this.ambientLight);
    if (this.hemiLight) this.scene.remove(this.hemiLight);
    if (this.mainLight) {
      this.mainLight.shadow.map?.dispose();
      this.scene.remove(this.mainLight);
    }
    if (this.fillLight) this.scene.remove(this.fillLight);
  }

  /**
   * Helper to dispose all resources in a group.
   */
  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (child.material instanceof THREE.Material) {
          this.disposeMaterial(child.material);
        } else if (Array.isArray(child.material)) {
          child.material.forEach(mat => this.disposeMaterial(mat));
        }
      }
    });
  }
}
