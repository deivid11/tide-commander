/**
 * Custom Agent Class Service
 * Manages user-defined agent classes with associated default skills
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadCustomAgentClasses, saveCustomAgentClasses } from '../data/index.js';
import type { CustomAgentClass } from '../../shared/types.js';
import { createLogger, generateSlug } from '../utils/index.js';

const log = createLogger('CustomClassService');

// In-memory store
let customClasses: Map<string, CustomAgentClass> = new Map();

// Event emitter for broadcasting changes
export const customClassEvents = new EventEmitter();

// Directory for storing instruction markdown files
const INSTRUCTIONS_DIR = path.join(os.homedir(), '.tide-commander', 'class-instructions');

// Directory for storing custom model files
const CUSTOM_MODELS_DIR = path.join(os.homedir(), '.tide-commander', 'custom-models');

/**
 * Ensure the instructions directory exists
 */
function ensureInstructionsDir(): void {
  if (!fs.existsSync(INSTRUCTIONS_DIR)) {
    fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
    log.log(`Created instructions directory: ${INSTRUCTIONS_DIR}`);
  }
}

/**
 * Ensure the custom models directory exists
 */
function ensureCustomModelsDir(): void {
  if (!fs.existsSync(CUSTOM_MODELS_DIR)) {
    fs.mkdirSync(CUSTOM_MODELS_DIR, { recursive: true });
    log.log(`Created custom models directory: ${CUSTOM_MODELS_DIR}`);
  }
}

/**
 * Get the file path for a class's custom model
 */
function getCustomModelFilePath(classId: string): string {
  return path.join(CUSTOM_MODELS_DIR, `${classId}.glb`);
}

/**
 * Save a custom model file to disk
 * @param classId The class ID
 * @param modelData Buffer containing the GLB file data
 * @returns The relative path to the saved model
 */
export function saveCustomModel(classId: string, modelData: Buffer): string {
  ensureCustomModelsDir();
  const filePath = getCustomModelFilePath(classId);
  fs.writeFileSync(filePath, modelData);
  log.log(`Saved custom model for class ${classId} to ${filePath} (${modelData.length} bytes)`);
  return `${classId}.glb`;
}

/**
 * Delete custom model file for a class
 */
function deleteCustomModelFile(classId: string): void {
  const filePath = getCustomModelFilePath(classId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    log.log(`Deleted custom model file for class ${classId}`);
  }
}

/**
 * Check if a custom model exists for a class
 */
export function hasCustomModel(classId: string): boolean {
  return fs.existsSync(getCustomModelFilePath(classId));
}

/**
 * Get the full path to a custom model file
 * Returns undefined if the model doesn't exist
 */
export function getCustomModelPath(classId: string): string | undefined {
  const filePath = getCustomModelFilePath(classId);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return undefined;
}

/**
 * Get the custom models directory path (for serving files)
 */
export function getCustomModelsDirectory(): string {
  ensureCustomModelsDir();
  return CUSTOM_MODELS_DIR;
}

/**
 * Get the file path for a class's instruction markdown
 */
function getInstructionsFilePath(classId: string): string {
  return path.join(INSTRUCTIONS_DIR, `${classId}.md`);
}

/**
 * Save instructions to a markdown file on disk
 */
function saveInstructionsFile(classId: string, instructions: string | undefined): void {
  ensureInstructionsDir();
  const filePath = getInstructionsFilePath(classId);

  if (instructions && instructions.trim()) {
    fs.writeFileSync(filePath, instructions, 'utf-8');
    log.log(`Saved instructions for class ${classId} to ${filePath} (${instructions.length} chars)`);
  } else {
    // Remove file if instructions are empty
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log.log(`Removed instructions file for class ${classId}`);
    }
  }
}

/**
 * Delete instructions file for a class
 */
function deleteInstructionsFile(classId: string): void {
  const filePath = getInstructionsFilePath(classId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    log.log(`Deleted instructions file for class ${classId}`);
  }
}

/**
 * Initialize the custom class service - load from disk
 */
export function initCustomClasses(): void {
  ensureInstructionsDir();
  ensureCustomModelsDir();
  const loaded = loadCustomAgentClasses();
  customClasses = new Map(loaded.map(c => [c.id, c]));
  log.log(`Initialized with ${customClasses.size} custom agent classes`);

  // Sync instructions files with stored data
  for (const customClass of customClasses.values()) {
    if (customClass.instructions) {
      saveInstructionsFile(customClass.id, customClass.instructions);
    }
  }
}

/**
 * Persist custom classes to disk
 */
function persistClasses(): void {
  saveCustomAgentClasses(Array.from(customClasses.values()));
}

/**
 * Get all custom agent classes
 */
export function getAllCustomClasses(): CustomAgentClass[] {
  return Array.from(customClasses.values());
}

/**
 * Get a custom agent class by ID
 */
export function getCustomClass(id: string): CustomAgentClass | undefined {
  return customClasses.get(id);
}

/**
 * Create a new custom agent class
 */
export function createCustomClass(
  data: Omit<CustomAgentClass, 'id' | 'createdAt' | 'updatedAt'>
): CustomAgentClass {
  const now = Date.now();
  const id = generateSlug(data.name) || `class-${now}`;

  // Ensure unique ID
  let uniqueId = id;
  let counter = 1;
  while (customClasses.has(uniqueId)) {
    uniqueId = `${id}-${counter++}`;
  }

  const customClass: CustomAgentClass = {
    ...data,
    id: uniqueId,
    createdAt: now,
    updatedAt: now,
  };

  customClasses.set(uniqueId, customClass);
  persistClasses();

  // Save instructions to disk as markdown file
  if (customClass.instructions) {
    saveInstructionsFile(uniqueId, customClass.instructions);
  }

  log.log(`Created custom class: ${customClass.name} (${uniqueId})`);
  customClassEvents.emit('created', customClass);

  return customClass;
}

/**
 * Update a custom agent class
 */
export function updateCustomClass(
  id: string,
  updates: Partial<CustomAgentClass>
): CustomAgentClass | null {
  const existing = customClasses.get(id);
  if (!existing) {
    log.warn(`Custom class not found: ${id}`);
    return null;
  }

  const updated: CustomAgentClass = {
    ...existing,
    ...updates,
    id, // Prevent ID changes
    createdAt: existing.createdAt, // Preserve creation time
    updatedAt: Date.now(),
  };

  customClasses.set(id, updated);
  persistClasses();

  // Update instructions file on disk
  saveInstructionsFile(id, updated.instructions);

  log.log(`Updated custom class: ${updated.name} (${id})`);
  customClassEvents.emit('updated', updated);

  return updated;
}

/**
 * Delete a custom agent class
 */
export function deleteCustomClass(id: string): boolean {
  if (!customClasses.has(id)) {
    log.warn(`Custom class not found: ${id}`);
    return false;
  }

  customClasses.delete(id);
  persistClasses();

  // Delete instructions file
  deleteInstructionsFile(id);

  // Delete custom model file if exists
  deleteCustomModelFile(id);

  log.log(`Deleted custom class: ${id}`);
  customClassEvents.emit('deleted', id);

  return true;
}

/**
 * Check if a class ID is a custom class
 */
export function isCustomClass(classId: string): boolean {
  return customClasses.has(classId);
}

/**
 * Get the visual model file for a custom agent class
 * Returns the model file (e.g., 'character-male-a.glb') or undefined if not a custom class
 */
export function getClassModelFile(classId: string): string | undefined {
  const customClass = customClasses.get(classId);
  if (customClass) {
    return customClass.model || 'character-male-a.glb';
  }
  return undefined;
}

/**
 * Get class info (works for both custom and built-in)
 */
export function getClassInfo(classId: string): { icon: string; color: string; description: string } | null {
  const customClass = customClasses.get(classId);
  if (customClass) {
    return {
      icon: customClass.icon,
      color: customClass.color,
      description: customClass.description,
    };
  }
  return null; // Built-in classes handled elsewhere
}

/**
 * Get default skill IDs for a custom class
 */
export function getClassDefaultSkillIds(classId: string): string[] {
  const customClass = customClasses.get(classId);
  return customClass?.defaultSkillIds || [];
}

/**
 * Get instructions (CLAUDE.md content) for a custom class
 * Returns undefined if class doesn't exist or has no instructions
 */
export function getClassInstructions(classId: string): string | undefined {
  const customClass = customClasses.get(classId);
  return customClass?.instructions;
}

/**
 * Get the path to the instructions markdown file for a class
 * Returns undefined if class doesn't exist or has no instructions
 */
export function getClassInstructionsPath(classId: string): string | undefined {
  const customClass = customClasses.get(classId);
  if (customClass?.instructions) {
    return getInstructionsFilePath(classId);
  }
  return undefined;
}

/**
 * Build a custom agent definition for the --agents flag
 * Returns undefined if class doesn't have instructions
 */
export function buildCustomAgentConfig(classId: string): { name: string; definition: { description: string; prompt: string } } | undefined {
  const customClass = customClasses.get(classId);
  if (!customClass?.instructions) {
    return undefined;
  }

  return {
    name: classId,
    definition: {
      description: customClass.description || `Custom agent class: ${customClass.name}`,
      prompt: customClass.instructions,
    },
  };
}

// Export as a service object for consistency
export const customClassService = {
  initCustomClasses,
  getAllCustomClasses,
  getCustomClass,
  createCustomClass,
  updateCustomClass,
  deleteCustomClass,
  isCustomClass,
  getClassModelFile,
  getClassInfo,
  getClassDefaultSkillIds,
  getClassInstructions,
  getClassInstructionsPath,
  buildCustomAgentConfig,
  // Custom model functions
  saveCustomModel,
  hasCustomModel,
  getCustomModelPath,
  getCustomModelsDirectory,
};
