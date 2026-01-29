/**
 * Terrain Elements
 *
 * Trees, bushes, house, and street lamps for the battlefield environment.
 * Uses InstancedMesh for trees and bushes to reduce draw calls.
 */

import * as THREE from 'three';

/**
 * Result of creating terrain elements.
 */
export interface TerrainElements {
  trees: THREE.Group; // Now a single group containing instanced meshes
  bushes: THREE.InstancedMesh;
  house: THREE.Group;
  lamps: THREE.Group; // Now a single group containing instanced meshes
  lampLights: THREE.PointLight[];
  windowMaterials: THREE.MeshStandardMaterial[];
}

/**
 * Create all terrain elements.
 */
export function createTerrainElements(scene: THREE.Scene): TerrainElements {
  const trees = createInstancedTrees(scene);
  const bushes = createInstancedBushes(scene);
  const { house, windowMaterials } = createHouse(scene);
  const { lamps, lampLights } = createInstancedStreetLamps(scene);

  return {
    trees,
    bushes,
    house,
    lamps,
    lampLights,
    windowMaterials,
  };
}

/**
 * Tree positions and scales.
 */
const TREE_DATA = [
  { x: -20, z: -18, scale: 1.2 },
  { x: -22, z: -8, scale: 1.4 },
  { x: -20, z: 5, scale: 1.1 },
  { x: 18, z: -20, scale: 1.3 },
  { x: 22, z: -5, scale: 1.0 },
  { x: 20, z: 10, scale: 1.5 },
  { x: -8, z: -22, scale: 1.25 },
  { x: 5, z: -20, scale: 1.35 },
];

/**
 * Create instanced trees - reduces 24 draw calls to 3.
 */
function createInstancedTrees(scene: THREE.Scene): THREE.Group {
  const treeGroup = new THREE.Group();
  treeGroup.name = 'trees_instanced';

  const numTrees = TREE_DATA.length;

  // Shared materials
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a3728,
    roughness: 0.9,
  });
  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d5a27,
    roughness: 0.8,
  });

  // Shared geometries
  const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
  const foliage1Geometry = new THREE.SphereGeometry(2, 8, 6);
  const foliage2Geometry = new THREE.SphereGeometry(1.5, 8, 6);

  // Create instanced meshes
  const trunkInstanced = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, numTrees);
  const foliage1Instanced = new THREE.InstancedMesh(foliage1Geometry, foliageMaterial, numTrees);
  const foliage2Instanced = new THREE.InstancedMesh(foliage2Geometry, foliageMaterial, numTrees);

  trunkInstanced.castShadow = true;
  trunkInstanced.receiveShadow = true;
  foliage1Instanced.castShadow = true;
  foliage2Instanced.castShadow = true;

  trunkInstanced.name = 'trees_trunks';
  foliage1Instanced.name = 'trees_foliage1';
  foliage2Instanced.name = 'trees_foliage2';

  // Set up instance matrices
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  TREE_DATA.forEach((tree, i) => {
    const s = tree.scale;
    const rotY = Math.random() * Math.PI * 2;

    // Trunk: positioned at y=1.5 relative to tree base
    position.set(tree.x, 1.5 * s, tree.z);
    rotation.setFromEuler(new THREE.Euler(0, rotY, 0));
    scale.set(s, s, s);
    matrix.compose(position, rotation, scale);
    trunkInstanced.setMatrixAt(i, matrix);

    // Foliage 1 (bottom layer): y=4, scaleY=0.8
    position.set(tree.x, 4 * s, tree.z);
    scale.set(s, s * 0.8, s);
    matrix.compose(position, rotation, scale);
    foliage1Instanced.setMatrixAt(i, matrix);

    // Foliage 2 (top layer): y=5.5
    position.set(tree.x, 5.5 * s, tree.z);
    scale.set(s, s, s);
    matrix.compose(position, rotation, scale);
    foliage2Instanced.setMatrixAt(i, matrix);
  });

  trunkInstanced.instanceMatrix.needsUpdate = true;
  foliage1Instanced.instanceMatrix.needsUpdate = true;
  foliage2Instanced.instanceMatrix.needsUpdate = true;

  treeGroup.add(trunkInstanced);
  treeGroup.add(foliage1Instanced);
  treeGroup.add(foliage2Instanced);

  scene.add(treeGroup);
  return treeGroup;
}

/**
 * Bush positions.
 */
const BUSH_POSITIONS = [
  { x: -17, z: -14 },
  { x: -16, z: 0 },
  { x: -17, z: 12 },
  { x: 17, z: -15 },
  { x: 16, z: 3 },
  { x: 17, z: 15 },
  { x: -12, z: -17 },
  { x: 0, z: -17 },
  { x: 12, z: -17 },
  { x: -10, z: 17 },
  { x: 3, z: 17 },
  { x: 14, z: 17 },
  { x: -25, z: 8 },
  { x: -28, z: 12 },
];

/**
 * Create instanced bushes - reduces ~35 draw calls to 1.
 * Uses a single sphere geometry with varied transforms for organic look.
 */
function createInstancedBushes(scene: THREE.Scene): THREE.InstancedMesh {
  // Pre-generate bush sphere data (2-3 spheres per bush position)
  const sphereData: Array<{ x: number; y: number; z: number; scaleX: number; scaleY: number; scaleZ: number }> = [];

  // Use seeded random for consistent results
  const seededRandom = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };

  BUSH_POSITIONS.forEach((pos, bushIdx) => {
    const numSpheres = 2 + Math.floor(seededRandom(bushIdx * 100) * 2); // 2-3 spheres
    for (let j = 0; j < numSpheres; j++) {
      const seed = bushIdx * 100 + j;
      const size = 0.6 + seededRandom(seed) * 0.4;
      const offsetX = (seededRandom(seed + 1) - 0.5) * 0.8;
      const offsetZ = (seededRandom(seed + 2) - 0.5) * 0.8;
      const scaleY = 0.7 + seededRandom(seed + 3) * 0.2;

      sphereData.push({
        x: pos.x + offsetX,
        y: size * 0.7,
        z: pos.z + offsetZ,
        scaleX: size,
        scaleY: size * scaleY,
        scaleZ: size,
      });
    }
  });

  const bushMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d6a37,
    roughness: 0.85,
  });

  const bushGeometry = new THREE.SphereGeometry(1, 8, 6); // Unit sphere, scaled per instance
  const bushInstanced = new THREE.InstancedMesh(bushGeometry, bushMaterial, sphereData.length);

  bushInstanced.castShadow = true;
  bushInstanced.receiveShadow = true;
  bushInstanced.name = 'bushes_instanced';

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  sphereData.forEach((sphere, i) => {
    position.set(sphere.x, sphere.y, sphere.z);
    rotation.identity();
    scale.set(sphere.scaleX, sphere.scaleY, sphere.scaleZ);
    matrix.compose(position, rotation, scale);
    bushInstanced.setMatrixAt(i, matrix);
  });

  bushInstanced.instanceMatrix.needsUpdate = true;

  scene.add(bushInstanced);
  return bushInstanced;
}

/**
 * Create the house.
 */
function createHouse(scene: THREE.Scene): { house: THREE.Group; windowMaterials: THREE.MeshStandardMaterial[] } {
  const house = new THREE.Group();
  const windowMaterials: THREE.MeshStandardMaterial[] = [];

  // Main body
  const bodyGeometry = new THREE.BoxGeometry(6, 4, 5);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xd4a574,
    roughness: 0.8,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 2;
  body.castShadow = true;
  body.receiveShadow = true;
  house.add(body);

  // Roof
  const roofGeometry = new THREE.ConeGeometry(5, 3, 4);
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    roughness: 0.7,
  });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  roof.position.y = 5.5;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  house.add(roof);

  // Door
  const doorGeometry = new THREE.BoxGeometry(1.2, 2, 0.1);
  const doorMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c4033,
    roughness: 0.6,
  });
  const door = new THREE.Mesh(doorGeometry, doorMaterial);
  door.position.set(0, 1, 2.55);
  house.add(door);

  // Windows (emissive at night)
  const windowGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.1);
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffaa,
    emissive: 0xffaa44,
    emissiveIntensity: 0.5,
    roughness: 0.3,
  });
  windowMaterials.push(windowMaterial);

  const window1 = new THREE.Mesh(windowGeometry, windowMaterial);
  window1.position.set(-1.5, 2.5, 2.55);
  house.add(window1);

  const window2 = new THREE.Mesh(windowGeometry, windowMaterial);
  window2.position.set(1.5, 2.5, 2.55);
  house.add(window2);

  // Chimney
  const chimneyGeometry = new THREE.BoxGeometry(0.8, 2, 0.8);
  const chimneyMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    roughness: 0.8,
  });
  const chimney = new THREE.Mesh(chimneyGeometry, chimneyMaterial);
  chimney.position.set(1.5, 6, -1);
  chimney.castShadow = true;
  house.add(chimney);

  // Position house outside work floor
  house.position.set(-25, 0, 10);
  house.rotation.y = Math.PI / 6;
  house.name = 'house';

  scene.add(house);

  return { house, windowMaterials };
}

/**
 * Street lamp positions.
 */
const LAMP_POSITIONS = [
  { x: -16, z: -16 },
  { x: 16, z: -16 },
  { x: -16, z: 16 },
  { x: 16, z: 16 },
];

/**
 * Create instanced street lamps - reduces 16 draw calls to 4.
 */
function createInstancedStreetLamps(scene: THREE.Scene): { lamps: THREE.Group; lampLights: THREE.PointLight[] } {
  const lampGroup = new THREE.Group();
  lampGroup.name = 'lamps_instanced';
  const lampLights: THREE.PointLight[] = [];

  const numLamps = LAMP_POSITIONS.length;

  // Shared materials
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.5,
    metalness: 0.5,
  });
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 0.6,
  });
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xffeeaa,
    emissive: 0xffaa44,
    emissiveIntensity: 2,
    roughness: 0.2,
  });

  // Shared geometries
  const poleGeometry = new THREE.CylinderGeometry(0.1, 0.15, 5, 8);
  const armGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
  const housingGeometry = new THREE.CylinderGeometry(0.4, 0.3, 0.6, 8);
  const bulbGeometry = new THREE.SphereGeometry(0.25, 16, 16);

  // Create instanced meshes
  const poleInstanced = new THREE.InstancedMesh(poleGeometry, poleMaterial, numLamps);
  const armInstanced = new THREE.InstancedMesh(armGeometry, poleMaterial, numLamps);
  const housingInstanced = new THREE.InstancedMesh(housingGeometry, housingMaterial, numLamps);
  const bulbInstanced = new THREE.InstancedMesh(bulbGeometry, bulbMaterial, numLamps);

  poleInstanced.castShadow = true;
  poleInstanced.name = 'lamps_poles';
  armInstanced.name = 'lamps_arms';
  housingInstanced.name = 'lamps_housings';
  bulbInstanced.name = 'lamps_bulbs';

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  LAMP_POSITIONS.forEach((pos, i) => {
    // Pole: y=2.5
    position.set(pos.x, 2.5, pos.z);
    rotation.identity();
    matrix.compose(position, rotation, scale);
    poleInstanced.setMatrixAt(i, matrix);

    // Arm: y=4.8, offset x=0.4, rotated 90 degrees on Z
    position.set(pos.x + 0.4, 4.8, pos.z);
    rotation.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    matrix.compose(position, rotation, scale);
    armInstanced.setMatrixAt(i, matrix);

    // Housing: y=4.8, offset x=0.8
    position.set(pos.x + 0.8, 4.8, pos.z);
    rotation.identity();
    matrix.compose(position, rotation, scale);
    housingInstanced.setMatrixAt(i, matrix);

    // Bulb: y=4.5, offset x=0.8
    position.set(pos.x + 0.8, 4.5, pos.z);
    matrix.compose(position, rotation, scale);
    bulbInstanced.setMatrixAt(i, matrix);

    // Point light for each lamp
    const light = new THREE.PointLight(0xffaa55, 1.5, 15);
    light.position.set(pos.x, 5, pos.z);
    light.castShadow = true;
    light.shadow.mapSize.width = 512;
    light.shadow.mapSize.height = 512;
    lampLights.push(light);
    scene.add(light);
  });

  poleInstanced.instanceMatrix.needsUpdate = true;
  armInstanced.instanceMatrix.needsUpdate = true;
  housingInstanced.instanceMatrix.needsUpdate = true;
  bulbInstanced.instanceMatrix.needsUpdate = true;

  lampGroup.add(poleInstanced);
  lampGroup.add(armInstanced);
  lampGroup.add(housingInstanced);
  lampGroup.add(bulbInstanced);

  scene.add(lampGroup);
  return { lamps: lampGroup, lampLights };
}

/**
 * Create grass area around the work floor.
 */
export function createGrass(scene: THREE.Scene): THREE.Mesh {
  const grassGeometry = new THREE.PlaneGeometry(80, 80);
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d5a27,
    roughness: 0.9,
    metalness: 0,
  });

  const grass = new THREE.Mesh(grassGeometry, grassMaterial);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  grass.name = 'grass';

  scene.add(grass);

  return grass;
}
