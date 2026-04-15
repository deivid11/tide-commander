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

// ============================================================================
// Echo Prompt Setting
// ============================================================================

const ECHO_PROMPT_FILE = path.join(DATA_DIR, 'echo-prompt-setting.json');

interface EchoPromptSetting {
  enabled: boolean;
  updatedAt: number;
}

/**
 * Check if echo prompt is enabled
 */
export function isEchoPromptEnabled(): boolean {
  ensureDataDir();
  try {
    if (fs.existsSync(ECHO_PROMPT_FILE)) {
      const data: EchoPromptSetting = JSON.parse(fs.readFileSync(ECHO_PROMPT_FILE, 'utf-8'));
      return data.enabled;
    }
  } catch (error: any) {
    log.error(` Failed to load echo prompt setting: ${error.message}`);
  }
  return false;
}

/**
 * Set echo prompt enabled/disabled
 */
export function setEchoPromptEnabled(enabled: boolean): void {
  ensureDataDir();
  const data: EchoPromptSetting = {
    enabled,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(ECHO_PROMPT_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` Echo prompt setting updated: enabled=${enabled}`);
  } catch (error: any) {
    log.error(` Failed to save echo prompt setting: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Codex Binary Path Setting
// ============================================================================

const CODEX_BINARY_FILE = path.join(DATA_DIR, 'codex-binary-path.json');

interface CodexBinaryPathData {
  path: string;
  updatedAt: number;
}

/**
 * Get the configured codex binary path (empty string if not set)
 */
export function getCodexBinaryPath(): string {
  ensureDataDir();
  try {
    if (fs.existsSync(CODEX_BINARY_FILE)) {
      const data: CodexBinaryPathData = JSON.parse(fs.readFileSync(CODEX_BINARY_FILE, 'utf-8'));
      return data.path;
    }
  } catch (error: any) {
    log.error(` Failed to load codex binary path: ${error.message}`);
  }
  return '';
}

/**
 * Set the codex binary path
 */
export function setCodexBinaryPath(binaryPath: string): void {
  ensureDataDir();
  const trimmed = binaryPath.trim();
  if (trimmed) {
    const data: CodexBinaryPathData = {
      path: trimmed,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(CODEX_BINARY_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` Codex binary path set: ${trimmed}`);
  } else {
    // Empty means clear
    clearCodexBinaryPath();
  }
}

/**
 * Clear the codex binary path (revert to auto-detect)
 */
export function clearCodexBinaryPath(): void {
  ensureDataDir();
  try {
    if (fs.existsSync(CODEX_BINARY_FILE)) {
      fs.unlinkSync(CODEX_BINARY_FILE);
      log.log(` Codex binary path cleared (will auto-detect)`);
    }
  } catch (error: any) {
    log.error(` Failed to clear codex binary path: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Tmux Mode Setting
// ============================================================================

const TMUX_MODE_FILE = path.join(DATA_DIR, 'tmux-mode-setting.json');

interface TmuxModeSetting {
  enabled: boolean;
  updatedAt: number;
}

/**
 * Check if tmux mode is enabled
 */
export function isTmuxModeEnabled(): boolean {
  ensureDataDir();
  try {
    if (fs.existsSync(TMUX_MODE_FILE)) {
      const data: TmuxModeSetting = JSON.parse(fs.readFileSync(TMUX_MODE_FILE, 'utf-8'));
      return data.enabled;
    }
  } catch (error: any) {
    log.error(` Failed to load tmux mode setting: ${error.message}`);
  }
  return false;
}

/**
 * Set tmux mode enabled/disabled
 */
export function setTmuxModeEnabled(enabled: boolean): void {
  ensureDataDir();
  const data: TmuxModeSetting = {
    enabled,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(TMUX_MODE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` Tmux mode setting updated: enabled=${enabled}`);
  } catch (error: any) {
    log.error(` Failed to save tmux mode setting: ${error.message}`);
    throw error;
  }
}
