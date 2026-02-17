/**
 * System Prompt Service
 * Manages the global custom prompt that applies to all agents
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SystemPrompt');

// Data directory location
const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const SYSTEM_PROMPT_FILE = path.join(DATA_DIR, 'system-prompt.json');

interface SystemPromptData {
  content: string;
  updatedAt: number;
  version: string;
}

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    log.log(` Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Get the current system prompt
 */
export function getSystemPrompt(): string {
  ensureDataDir();

  try {
    if (fs.existsSync(SYSTEM_PROMPT_FILE)) {
      const data: SystemPromptData = JSON.parse(fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf-8'));
      log.log(` Loaded system prompt (${data.content.length} chars)`);
      return data.content;
    }
  } catch (error: any) {
    log.error(` Failed to load system prompt: ${error.message}`);
  }

  return '';
}

/**
 * Set the system prompt
 */
export function setSystemPrompt(content: string): void {
  ensureDataDir();

  const data: SystemPromptData = {
    content: content.trim(),
    updatedAt: Date.now(),
    version: '1.0',
  };

  try {
    fs.writeFileSync(SYSTEM_PROMPT_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` Saved system prompt (${content.length} chars) to ${SYSTEM_PROMPT_FILE}`);
  } catch (error: any) {
    log.error(` Failed to save system prompt: ${error.message}`);
    throw error;
  }
}

/**
 * Clear the system prompt
 */
export function clearSystemPrompt(): void {
  ensureDataDir();

  try {
    if (fs.existsSync(SYSTEM_PROMPT_FILE)) {
      fs.unlinkSync(SYSTEM_PROMPT_FILE);
      log.log(` Cleared system prompt`);
    }
  } catch (error: any) {
    log.error(` Failed to clear system prompt: ${error.message}`);
    throw error;
  }
}

/**
 * Check if system prompt exists
 */
export function hasSystemPrompt(): boolean {
  return fs.existsSync(SYSTEM_PROMPT_FILE);
}
