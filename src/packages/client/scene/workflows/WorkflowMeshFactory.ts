/**
 * Workflow Mesh Factory
 *
 * Creates 3D meshes for each WorkflowStyle and provides animation updates.
 * Five visual styles: flowchart, circuit-board, constellation, helix, clockwork.
 */

import * as THREE from 'three';
import type { WorkflowDefinition, WorkflowStyle, WorkflowModelStatus } from '../../../shared/workflow-types';
import type { WorkflowMeshData } from './types';
import { WORKFLOW_STATUS_COLORS, WORKFLOW_STYLE_PALETTES } from './types';
import { createLabel } from '../buildings/labelUtils';

// ─── Helper: create status light + glow ───

function addStatusLight(group: THREE.Group, status: WorkflowModelStatus, y: number): THREE.Mesh {
  const color = WORKFLOW_STATUS_COLORS[status];

  const lightGeom = new THREE.SphereGeometry(0.12, 16, 16);
  const lightMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const light = new THREE.Mesh(lightGeom, lightMat);
  light.position.set(0, y, 0);
  light.name = 'statusLight';
  group.add(light);

  const glowGeom = new THREE.SphereGeometry(0.2, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 });
  const glow = new THREE.Mesh(glowGeom, glowMat);
  glow.position.set(0, y, 0);
  glow.name = 'statusGlow';
  group.add(glow);

  return light;
}

// ─── Helper: hex color or palette ───

function getBaseColor(def: WorkflowDefinition): THREE.Color {
  if (def.color) return new THREE.Color(def.color);
  const palette = WORKFLOW_STYLE_PALETTES[def.style || 'flowchart'];
  return new THREE.Color(palette.primary);
}

function getAccentColor(def: WorkflowDefinition): THREE.Color {
  const palette = WORKFLOW_STYLE_PALETTES[def.style || 'flowchart'];
  return new THREE.Color(palette.accent);
}

// ═════════════════════════════════════════
// Style 1: Flowchart — connected nodes in a ring
// ═════════════════════════════════════════

function createFlowchartMesh(def: WorkflowDefinition, status: WorkflowModelStatus): WorkflowMeshData {
  const group = new THREE.Group();
  group.userData.workflowId = def.id;
  group.userData.isWorkflow = true;

  const baseColor = getBaseColor(def);
  const accent = getAccentColor(def);
  const nodeCount = Math.min(def.states.length, 8);

  // Base platform
  const baseGeom = new THREE.CylinderGeometry(1.3, 1.4, 0.1, 32);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, metalness: 0.6, roughness: 0.4 });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.05;
  base.receiveShadow = true;
  group.add(base);

  // Nodes in a ring
  const radius = 0.8;
  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / nodeCount) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const nodeGeom = new THREE.BoxGeometry(0.22, 0.15, 0.22);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.3,
      roughness: 0.7,
      emissive: accent,
      emissiveIntensity: 0.15,
    });
    const node = new THREE.Mesh(nodeGeom, nodeMat);
    node.position.set(x, 0.55, z);
    node.castShadow = true;
    node.name = `node_${i}`;
    if (i === 0) node.name = 'buildingBody';
    group.add(node);

    // Connection line to next node
    if (i < nodeCount - 1) {
      const nextAngle = ((i + 1) / nodeCount) * Math.PI * 2;
      const nx = Math.cos(nextAngle) * radius;
      const nz = Math.sin(nextAngle) * radius;
      const points = [new THREE.Vector3(x, 0.55, z), new THREE.Vector3(nx, 0.55, nz)];
      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({ color: accent.getHex(), transparent: true, opacity: 0.6 });
      const line = new THREE.Line(lineGeom, lineMat);
      line.name = `conn_${i}`;
      group.add(line);
    }
  }

  // Central hub sphere
  const hubGeom = new THREE.SphereGeometry(0.18, 16, 16);
  const hubMat = new THREE.MeshBasicMaterial({ color: accent.getHex(), transparent: true, opacity: 0.5 });
  const hub = new THREE.Mesh(hubGeom, hubMat);
  hub.position.y = 0.55;
  hub.name = 'hub';
  group.add(hub);

  const statusLight = addStatusLight(group, status, 1.1);

  const label = createLabel(def.name);
  label.position.set(0, 1.5, 0);
  label.name = 'workflowLabel';
  group.add(label);

  group.position.set(def.position?.x || 0, 0, def.position?.z || 0);
  return { group, statusLight, label };
}

function updateFlowchartIdle(meshData: WorkflowMeshData, animTime: number): void {
  const hub = meshData.group.getObjectByName('hub') as THREE.Mesh;
  if (hub && hub.material instanceof THREE.MeshBasicMaterial) {
    hub.material.opacity = 0.3 + Math.sin(animTime * 0.8) * 0.15;
  }
}

function updateFlowchartRunning(meshData: WorkflowMeshData, animTime: number, nodeCount: number): void {
  // Pulse nodes sequentially
  for (let i = 0; i < nodeCount; i++) {
    const node = meshData.group.getObjectByName(i === 0 ? 'buildingBody' : `node_${i}`) as THREE.Mesh;
    if (node && node.material instanceof THREE.MeshStandardMaterial) {
      const phase = (animTime * 2 + i * 0.5) % (Math.PI * 2);
      node.material.emissiveIntensity = 0.15 + Math.sin(phase) * 0.25;
    }
  }
  const hub = meshData.group.getObjectByName('hub') as THREE.Mesh;
  if (hub) hub.rotation.y += 0.02;
}

// ═════════════════════════════════════════
// Style 2: Circuit Board — PCB traces with glowing paths
// ═════════════════════════════════════════

function createCircuitBoardMesh(def: WorkflowDefinition, status: WorkflowModelStatus): WorkflowMeshData {
  const group = new THREE.Group();
  group.userData.workflowId = def.id;
  group.userData.isWorkflow = true;

  const baseColor = getBaseColor(def);
  const accent = getAccentColor(def);

  // PCB base plate
  const pcbGeom = new THREE.BoxGeometry(2.2, 0.12, 1.6);
  const pcbMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.2,
    roughness: 0.8,
  });
  const pcb = new THREE.Mesh(pcbGeom, pcbMat);
  pcb.position.y = 0.06;
  pcb.castShadow = true;
  pcb.receiveShadow = true;
  pcb.name = 'buildingBody';
  group.add(pcb);

  // Trace lines on the board
  const traceMat = new THREE.LineBasicMaterial({ color: accent.getHex(), transparent: true, opacity: 0.7 });
  const traceCount = Math.min(def.states.length, 6);
  for (let i = 0; i < traceCount; i++) {
    const y = 0.13;
    const startX = -0.9 + (i / traceCount) * 1.8;
    const points = [
      new THREE.Vector3(startX, y, -0.6),
      new THREE.Vector3(startX, y, 0),
      new THREE.Vector3(startX + 0.3, y, 0.3),
      new THREE.Vector3(startX + 0.3, y, 0.6),
    ];
    const traceGeom = new THREE.BufferGeometry().setFromPoints(points);
    const trace = new THREE.Line(traceGeom, traceMat.clone());
    trace.name = `trace_${i}`;
    group.add(trace);

    // Chip/component at each trace endpoint
    const chipGeom = new THREE.BoxGeometry(0.15, 0.08, 0.1);
    const chipMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a,
      metalness: 0.5,
      roughness: 0.3,
      emissive: accent,
      emissiveIntensity: 0.1,
    });
    const chip = new THREE.Mesh(chipGeom, chipMat);
    chip.position.set(startX + 0.3, 0.16, 0.6);
    chip.name = `chip_${i}`;
    group.add(chip);
  }

  // Data flow indicator (moving sphere)
  const flowGeom = new THREE.SphereGeometry(0.06, 8, 8);
  const flowMat = new THREE.MeshBasicMaterial({ color: accent.getHex(), transparent: true, opacity: 0.8 });
  const flow = new THREE.Mesh(flowGeom, flowMat);
  flow.position.set(-0.9, 0.18, -0.6);
  flow.name = 'dataFlow';
  group.add(flow);

  const statusLight = addStatusLight(group, status, 0.7);

  const label = createLabel(def.name);
  label.position.set(0, 1.1, 0);
  label.name = 'workflowLabel';
  group.add(label);

  group.position.set(def.position?.x || 0, 0, def.position?.z || 0);
  return { group, statusLight, label };
}

function updateCircuitBoardIdle(meshData: WorkflowMeshData, animTime: number, traceCount: number): void {
  for (let i = 0; i < traceCount; i++) {
    const chip = meshData.group.getObjectByName(`chip_${i}`) as THREE.Mesh;
    if (chip && chip.material instanceof THREE.MeshStandardMaterial) {
      chip.material.emissiveIntensity = 0.05 + Math.sin(animTime * 0.5 + i * 0.4) * 0.05;
    }
  }
}

function updateCircuitBoardRunning(meshData: WorkflowMeshData, animTime: number, traceCount: number): void {
  // Animate data flow sphere along first trace
  const flow = meshData.group.getObjectByName('dataFlow') as THREE.Mesh;
  if (flow) {
    const t = ((animTime * 0.8) % 1);
    flow.position.x = -0.9 + t * 1.8;
    flow.position.z = -0.6 + t * 1.2;
  }
  for (let i = 0; i < traceCount; i++) {
    const chip = meshData.group.getObjectByName(`chip_${i}`) as THREE.Mesh;
    if (chip && chip.material instanceof THREE.MeshStandardMaterial) {
      chip.material.emissiveIntensity = 0.1 + Math.sin(animTime * 3 + i * 0.8) * 0.2;
    }
  }
}

// ═════════════════════════════════════════
// Style 3: Constellation — star map with connected points
// ═════════════════════════════════════════

function createConstellationMesh(def: WorkflowDefinition, status: WorkflowModelStatus): WorkflowMeshData {
  const group = new THREE.Group();
  group.userData.workflowId = def.id;
  group.userData.isWorkflow = true;

  const accent = getAccentColor(def);

  // Invisible base for positioning
  const baseGeom = new THREE.CylinderGeometry(1.2, 1.3, 0.05, 32);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.7, roughness: 0.3 });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.025;
  base.receiveShadow = true;
  base.name = 'buildingBody';
  group.add(base);

  // Stars (glowing spheres at pseudo-random positions)
  const starCount = Math.min(def.states.length, 8);
  const stars: THREE.Vector3[] = [];
  for (let i = 0; i < starCount; i++) {
    const angle = (i / starCount) * Math.PI * 2 + (i * 0.3);
    const r = 0.4 + (i % 3) * 0.25;
    const y = 0.4 + (i % 2) * 0.4;
    const pos = new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
    stars.push(pos);

    const starGeom = new THREE.SphereGeometry(0.08, 12, 12);
    const starMat = new THREE.MeshBasicMaterial({ color: accent.getHex(), transparent: true, opacity: 0.9 });
    const star = new THREE.Mesh(starGeom, starMat);
    star.position.copy(pos);
    star.name = `star_${i}`;
    group.add(star);
  }

  // Connect adjacent stars with faint lines
  const lineMat = new THREE.LineBasicMaterial({ color: accent.getHex(), transparent: true, opacity: 0.25 });
  for (let i = 0; i < stars.length - 1; i++) {
    const pts = [stars[i], stars[i + 1]];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(lineGeom, lineMat.clone());
    line.name = `link_${i}`;
    group.add(line);
  }

  const statusLight = addStatusLight(group, status, 1.2);

  const label = createLabel(def.name);
  label.position.set(0, 1.6, 0);
  label.name = 'workflowLabel';
  group.add(label);

  group.position.set(def.position?.x || 0, 0, def.position?.z || 0);
  return { group, statusLight, label };
}

function updateConstellationIdle(meshData: WorkflowMeshData, animTime: number, starCount: number): void {
  for (let i = 0; i < starCount; i++) {
    const star = meshData.group.getObjectByName(`star_${i}`) as THREE.Mesh;
    if (star && star.material instanceof THREE.MeshBasicMaterial) {
      star.material.opacity = 0.5 + Math.sin(animTime * 0.4 + i * 1.1) * 0.3;
    }
  }
}

function updateConstellationRunning(meshData: WorkflowMeshData, animTime: number, starCount: number): void {
  for (let i = 0; i < starCount; i++) {
    const star = meshData.group.getObjectByName(`star_${i}`) as THREE.Mesh;
    if (star && star.material instanceof THREE.MeshBasicMaterial) {
      star.material.opacity = 0.6 + Math.sin(animTime * 2.5 + i * 0.7) * 0.35;
      // Slight vertical bob
      star.position.y += Math.sin(animTime * 1.5 + i) * 0.001;
    }
  }
}

// ═════════════════════════════════════════
// Style 4: Helix — DNA-like double spiral
// ═════════════════════════════════════════

function createHelixMesh(def: WorkflowDefinition, status: WorkflowModelStatus): WorkflowMeshData {
  const group = new THREE.Group();
  group.userData.workflowId = def.id;
  group.userData.isWorkflow = true;

  const baseColor = getBaseColor(def);
  const accent = getAccentColor(def);

  // Base platform
  const baseGeom = new THREE.CylinderGeometry(0.8, 0.9, 0.1, 24);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, metalness: 0.6, roughness: 0.4 });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.05;
  base.receiveShadow = true;
  group.add(base);

  // Double helix strands
  const helixGroup = new THREE.Group();
  helixGroup.name = 'helixGroup';
  const segments = 24;
  const height = 1.6;
  const radius = 0.4;

  for (let strand = 0; strand < 2; strand++) {
    const offset = strand * Math.PI;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * Math.PI * 4 + offset;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        0.2 + t * height,
        Math.sin(angle) * radius,
      ));
    }
    const tubePoints = points;
    const curve = new THREE.CatmullRomCurve3(tubePoints);
    const tubeGeom = new THREE.TubeGeometry(curve, segments, 0.04, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: strand === 0 ? baseColor : accent,
      metalness: 0.3,
      roughness: 0.6,
      emissive: strand === 0 ? baseColor : accent,
      emissiveIntensity: 0.1,
    });
    const tube = new THREE.Mesh(tubeGeom, tubeMat);
    tube.castShadow = true;
    tube.name = strand === 0 ? 'buildingBody' : `strand_${strand}`;
    helixGroup.add(tube);
  }

  // Cross-rungs between strands
  const rungCount = Math.min(def.states.length, 8);
  for (let i = 0; i < rungCount; i++) {
    const t = (i + 0.5) / rungCount;
    const angle1 = t * Math.PI * 4;
    const angle2 = angle1 + Math.PI;
    const y = 0.2 + t * height;
    const p1 = new THREE.Vector3(Math.cos(angle1) * radius, y, Math.sin(angle1) * radius);
    const p2 = new THREE.Vector3(Math.cos(angle2) * radius, y, Math.sin(angle2) * radius);

    const rungGeom = new THREE.CylinderGeometry(0.02, 0.02, p1.distanceTo(p2), 6);
    const rungMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    const rung = new THREE.Mesh(rungGeom, rungMat);
    rung.position.copy(p1.clone().add(p2).multiplyScalar(0.5));
    rung.lookAt(p2);
    rung.rotateX(Math.PI / 2);
    rung.name = `rung_${i}`;
    helixGroup.add(rung);
  }

  group.add(helixGroup);

  const statusLight = addStatusLight(group, status, height + 0.5);

  const label = createLabel(def.name);
  label.position.set(0, height + 0.9, 0);
  label.name = 'workflowLabel';
  group.add(label);

  group.position.set(def.position?.x || 0, 0, def.position?.z || 0);
  return { group, statusLight, label };
}

function updateHelixIdle(meshData: WorkflowMeshData, _animTime: number, deltaTime: number): void {
  const helixGroup = meshData.group.getObjectByName('helixGroup');
  if (helixGroup) {
    helixGroup.rotation.y += deltaTime * 0.15;
  }
}

function updateHelixRunning(meshData: WorkflowMeshData, animTime: number, deltaTime: number, rungCount: number): void {
  const helixGroup = meshData.group.getObjectByName('helixGroup');
  if (helixGroup) {
    helixGroup.rotation.y += deltaTime * 0.6;
  }
  for (let i = 0; i < rungCount; i++) {
    const rung = meshData.group.getObjectByName(`rung_${i}`) as THREE.Mesh;
    if (rung && rung.material instanceof THREE.MeshBasicMaterial) {
      rung.material.opacity = 0.2 + Math.sin(animTime * 3 + i * 0.8) * 0.3;
    }
  }
}

// ═════════════════════════════════════════
// Style 5: Clockwork — mechanical gears and cogs
// ═════════════════════════════════════════

function createClockworkMesh(def: WorkflowDefinition, status: WorkflowModelStatus): WorkflowMeshData {
  const group = new THREE.Group();
  group.userData.workflowId = def.id;
  group.userData.isWorkflow = true;

  const baseColor = getBaseColor(def);
  const accent = getAccentColor(def);

  // Base plate
  const baseGeom = new THREE.CylinderGeometry(1.3, 1.4, 0.12, 32);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a3a2a, metalness: 0.7, roughness: 0.3 });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.06;
  base.receiveShadow = true;
  group.add(base);

  // Main gear (large torus with teeth simulated by ring segments)
  const mainGearGeom = new THREE.TorusGeometry(0.7, 0.08, 8, 24);
  const mainGearMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.8,
    roughness: 0.2,
  });
  const mainGear = new THREE.Mesh(mainGearGeom, mainGearMat);
  mainGear.position.y = 0.5;
  mainGear.rotation.x = Math.PI / 2;
  mainGear.castShadow = true;
  mainGear.name = 'buildingBody';
  group.add(mainGear);

  // Gear teeth (small boxes around the main gear)
  const teethGroup = new THREE.Group();
  teethGroup.name = 'mainGearTeeth';
  const toothCount = 16;
  for (let i = 0; i < toothCount; i++) {
    const angle = (i / toothCount) * Math.PI * 2;
    const toothGeom = new THREE.BoxGeometry(0.06, 0.06, 0.18);
    const toothMat = new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.8, roughness: 0.2 });
    const tooth = new THREE.Mesh(toothGeom, toothMat);
    tooth.position.set(Math.cos(angle) * 0.78, 0.5, Math.sin(angle) * 0.78);
    tooth.lookAt(new THREE.Vector3(0, 0.5, 0));
    teethGroup.add(tooth);
  }
  group.add(teethGroup);

  // Secondary gear (smaller, offset)
  const secGearGeom = new THREE.TorusGeometry(0.35, 0.06, 8, 16);
  const secGearMat = new THREE.MeshStandardMaterial({
    color: accent,
    metalness: 0.7,
    roughness: 0.3,
    emissive: accent,
    emissiveIntensity: 0.1,
  });
  const secGear = new THREE.Mesh(secGearGeom, secGearMat);
  secGear.position.set(0.85, 0.5, 0.4);
  secGear.rotation.x = Math.PI / 2;
  secGear.name = 'secGear';
  group.add(secGear);

  // Center axle
  const axleGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12);
  const axleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.1 });
  const axle = new THREE.Mesh(axleGeom, axleMat);
  axle.position.y = 0.4;
  group.add(axle);

  const statusLight = addStatusLight(group, status, 1.0);

  const label = createLabel(def.name);
  label.position.set(0, 1.4, 0);
  label.name = 'workflowLabel';
  group.add(label);

  group.position.set(def.position?.x || 0, 0, def.position?.z || 0);
  return { group, statusLight, label };
}

function updateClockworkIdle(meshData: WorkflowMeshData, _animTime: number, deltaTime: number): void {
  const teeth = meshData.group.getObjectByName('mainGearTeeth');
  if (teeth) teeth.rotation.y += deltaTime * 0.1;
  const secGear = meshData.group.getObjectByName('secGear') as THREE.Mesh;
  if (secGear) secGear.rotation.z -= deltaTime * 0.15;
}

function updateClockworkRunning(meshData: WorkflowMeshData, _animTime: number, deltaTime: number): void {
  const teeth = meshData.group.getObjectByName('mainGearTeeth');
  if (teeth) teeth.rotation.y += deltaTime * 0.5;
  const secGear = meshData.group.getObjectByName('secGear') as THREE.Mesh;
  if (secGear) secGear.rotation.z -= deltaTime * 0.75;
}

// ═════════════════════════════════════════
// Public API — dispatchers
// ═════════════════════════════════════════

/**
 * Create a workflow 3D mesh based on its style.
 */
export function createWorkflowMesh(def: WorkflowDefinition, status: WorkflowModelStatus): WorkflowMeshData {
  const style: WorkflowStyle = def.style || 'flowchart';
  switch (style) {
    case 'circuit-board':
      return createCircuitBoardMesh(def, status);
    case 'constellation':
      return createConstellationMesh(def, status);
    case 'helix':
      return createHelixMesh(def, status);
    case 'clockwork':
      return createClockworkMesh(def, status);
    case 'flowchart':
    default:
      return createFlowchartMesh(def, status);
  }
}

/**
 * Update idle animations (always running regardless of status).
 */
export function updateWorkflowIdleAnimations(
  meshData: WorkflowMeshData,
  def: WorkflowDefinition,
  animTime: number,
  deltaTime: number
): void {
  const style: WorkflowStyle = def.style || 'flowchart';
  const stateCount = Math.min(def.states.length, 8);

  switch (style) {
    case 'flowchart':
      updateFlowchartIdle(meshData, animTime);
      break;
    case 'circuit-board':
      updateCircuitBoardIdle(meshData, animTime, stateCount);
      break;
    case 'constellation':
      updateConstellationIdle(meshData, animTime, stateCount);
      break;
    case 'helix':
      updateHelixIdle(meshData, animTime, deltaTime);
      break;
    case 'clockwork':
      updateClockworkIdle(meshData, animTime, deltaTime);
      break;
  }
}

/**
 * Update running animations.
 */
export function updateWorkflowRunningAnimations(
  meshData: WorkflowMeshData,
  def: WorkflowDefinition,
  animTime: number,
  deltaTime: number
): void {
  const style: WorkflowStyle = def.style || 'flowchart';
  const stateCount = Math.min(def.states.length, 8);

  // Status glow pulse
  const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
  const pulse = Math.sin(animTime * 3) * 0.2 + 0.8;
  if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
    statusGlow.material.opacity = 0.3 * pulse;
  }

  switch (style) {
    case 'flowchart':
      updateFlowchartRunning(meshData, animTime, stateCount);
      break;
    case 'circuit-board':
      updateCircuitBoardRunning(meshData, animTime, stateCount);
      break;
    case 'constellation':
      updateConstellationRunning(meshData, animTime, stateCount);
      break;
    case 'helix':
      updateHelixRunning(meshData, animTime, deltaTime, stateCount);
      break;
    case 'clockwork':
      updateClockworkRunning(meshData, animTime, deltaTime);
      break;
  }
}

/**
 * Update error animations (red pulsing).
 */
export function updateWorkflowErrorAnimations(
  meshData: WorkflowMeshData,
  animTime: number
): void {
  const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
  const pulse = Math.sin(animTime * 2) * 0.5 + 0.5;
  if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
    statusGlow.material.opacity = 0.4 * pulse;
  }
}
