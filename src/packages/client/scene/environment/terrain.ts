/**
 * Terrain Elements
 *
 * Trees, bushes, house, and street lamps for the battlefield environment.
 */

import * as THREE from 'three';

/**
 * Result of creating terrain elements.
 */
export interface TerrainElements {
  trees: THREE.Group[];
  bushes: THREE.Group[];
  house: THREE.Group;
  lamps: THREE.Group[];
  lampLights: THREE.PointLight[];
  windowMaterials: THREE.MeshStandardMaterial[];
}

/**
 * Create all terrain elements.
 */
export function createTerrainElements(scene: THREE.Scene): TerrainElements {
  const trees = createTrees(scene);
  const bushes = createBushes(scene);
  const { house, windowMaterials } = createHouse(scene);
  const { lamps, lampLights } = createStreetLamps(scene);

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
 * Create trees around the battlefield.
 */
function createTrees(scene: THREE.Scene): THREE.Group[] {
  const trees: THREE.Group[] = [];
  const treePositions = [
    { x: -20, z: -18 },
    { x: -22, z: -8 },
    { x: -20, z: 5 },
    { x: 18, z: -20 },
    { x: 22, z: -5 },
    { x: 20, z: 10 },
    { x: -8, z: -22 },
    { x: 5, z: -20 },
    // Removed trees at z >= 18 - were blocking visibility in background
  ];

  treePositions.forEach((pos, i) => {
    const tree = createTree(1 + Math.random() * 0.5);
    tree.position.set(pos.x, 0, pos.z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.name = `tree_${i}`;
    trees.push(tree);
    scene.add(tree);
  });

  return trees;
}

/**
 * Create a single tree.
 */
function createTree(scale: number): THREE.Group {
  const tree = new THREE.Group();

  // Trunk
  const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a3728,
    roughness: 0.9,
  });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.position.y = 1.5;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  // Foliage layers (cute round style)
  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d5a27,
    roughness: 0.8,
  });

  // Bottom layer
  const foliage1 = new THREE.Mesh(
    new THREE.SphereGeometry(2, 8, 6),
    foliageMaterial
  );
  foliage1.position.y = 4;
  foliage1.scale.y = 0.8;
  foliage1.castShadow = true;
  tree.add(foliage1);

  // Top layer
  const foliage2 = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 8, 6),
    foliageMaterial
  );
  foliage2.position.y = 5.5;
  foliage2.castShadow = true;
  tree.add(foliage2);

  tree.scale.setScalar(scale);
  return tree;
}

/**
 * Create bushes around the battlefield.
 */
function createBushes(scene: THREE.Scene): THREE.Group[] {
  const bushes: THREE.Group[] = [];
  const bushPositions = [
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
    // Near house
    { x: -25, z: 8 },
    { x: -28, z: 12 },
  ];

  const bushMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d6a37,
    roughness: 0.85,
  });

  bushPositions.forEach((pos, i) => {
    const bushGroup = new THREE.Group();

    // Create 2-3 spheres for each bush
    const numSpheres = 2 + Math.floor(Math.random() * 2);
    for (let j = 0; j < numSpheres; j++) {
      const size = 0.6 + Math.random() * 0.4;
      const bushGeometry = new THREE.SphereGeometry(size, 8, 6);
      const bush = new THREE.Mesh(bushGeometry, bushMaterial);
      bush.position.set(
        (Math.random() - 0.5) * 0.8,
        size * 0.7,
        (Math.random() - 0.5) * 0.8
      );
      bush.scale.y = 0.7 + Math.random() * 0.2;
      bush.castShadow = true;
      bush.receiveShadow = true;
      bushGroup.add(bush);
    }

    bushGroup.position.set(pos.x, 0, pos.z);
    bushGroup.name = `bush_${i}`;
    bushes.push(bushGroup);
    scene.add(bushGroup);
  });

  return bushes;
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
 * Create street lamps around the battlefield.
 */
function createStreetLamps(scene: THREE.Scene): { lamps: THREE.Group[]; lampLights: THREE.PointLight[] } {
  const lamps: THREE.Group[] = [];
  const lampLights: THREE.PointLight[] = [];

  const lampPositions = [
    { x: -16, z: -16 },
    { x: 16, z: -16 },
    { x: -16, z: 16 },
    { x: 16, z: 16 },
  ];

  lampPositions.forEach((pos, i) => {
    const lamp = createStreetLamp();
    lamp.position.set(pos.x, 0, pos.z);
    lamp.name = `streetLamp_${i}`;
    lamps.push(lamp);
    scene.add(lamp);

    // Add point light for each lamp (intensity controlled by time)
    const light = new THREE.PointLight(0xffaa55, 1.5, 15);
    light.position.set(pos.x, 5, pos.z);
    light.castShadow = true;
    light.shadow.mapSize.width = 512;
    light.shadow.mapSize.height = 512;
    lampLights.push(light);
    scene.add(light);
  });

  return { lamps, lampLights };
}

/**
 * Create a single street lamp.
 */
function createStreetLamp(): THREE.Group {
  const lamp = new THREE.Group();

  // Pole
  const poleGeometry = new THREE.CylinderGeometry(0.1, 0.15, 5, 8);
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.5,
    metalness: 0.5,
  });
  const pole = new THREE.Mesh(poleGeometry, poleMaterial);
  pole.position.y = 2.5;
  pole.castShadow = true;
  lamp.add(pole);

  // Arm
  const armGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
  const arm = new THREE.Mesh(armGeometry, poleMaterial);
  arm.position.set(0.4, 4.8, 0);
  arm.rotation.z = Math.PI / 2;
  lamp.add(arm);

  // Lamp housing
  const housingGeometry = new THREE.CylinderGeometry(0.4, 0.3, 0.6, 8);
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 0.6,
  });
  const housing = new THREE.Mesh(housingGeometry, housingMaterial);
  housing.position.set(0.8, 4.8, 0);
  lamp.add(housing);

  // Light bulb (glowing)
  const bulbGeometry = new THREE.SphereGeometry(0.25, 16, 16);
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xffeeaa,
    emissive: 0xffaa44,
    emissiveIntensity: 2,
    roughness: 0.2,
  });
  const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
  bulb.position.set(0.8, 4.5, 0);
  lamp.add(bulb);

  return lamp;
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
