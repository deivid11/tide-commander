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

// ============================================================================
// Tmux Idle Timeout Setting
// ============================================================================

const TMUX_IDLE_TIMEOUT_FILE = path.join(DATA_DIR, 'tmux-idle-timeout-setting.json');
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface TmuxIdleTimeoutSetting {
  timeoutMs: number;
  updatedAt: number;
}

/**
 * Get the idle timeout for tmux sessions in milliseconds.
 * Sessions whose owning agent is idle (status !== 'working') and have had no
 * activity for this duration will be killed by the watchdog.
 * Defaults to 30 minutes when unset.
 */
export function getTmuxIdleTimeoutMs(): number {
  ensureDataDir();
  try {
    if (fs.existsSync(TMUX_IDLE_TIMEOUT_FILE)) {
      const data: TmuxIdleTimeoutSetting = JSON.parse(fs.readFileSync(TMUX_IDLE_TIMEOUT_FILE, 'utf-8'));
      if (typeof data.timeoutMs === 'number' && data.timeoutMs > 0) {
        return data.timeoutMs;
      }
    }
  } catch (error: any) {
    log.error(` Failed to load tmux idle timeout setting: ${error.message}`);
  }
  return DEFAULT_IDLE_TIMEOUT_MS;
}

export function setTmuxIdleTimeoutMs(timeoutMs: number): void {
  ensureDataDir();
  const data: TmuxIdleTimeoutSetting = {
    timeoutMs,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(TMUX_IDLE_TIMEOUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` Tmux idle timeout updated: ${timeoutMs}ms`);
  } catch (error: any) {
    log.error(` Failed to save tmux idle timeout setting: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Interactive (TUI) Mode Setting
// ============================================================================
//
// Experimental: when enabled, Claude agents are launched as the real
// interactive `claude` TUI inside a tmux session (no `--print`), driven by
// `tmux send-keys`, with the conversation reconstructed by tailing the session
// transcript JSONL. This is distinct from the (headless) tmux mode above, which
// still runs `claude --print` inside tmux for process persistence.

const INTERACTIVE_MODE_FILE = path.join(DATA_DIR, 'interactive-mode-setting.json');

interface InteractiveModeSetting {
  enabled: boolean;
  updatedAt: number;
}

/**
 * Check if experimental interactive-TUI mode is enabled.
 */
export function isInteractiveModeEnabled(): boolean {
  ensureDataDir();
  try {
    if (fs.existsSync(INTERACTIVE_MODE_FILE)) {
      const data: InteractiveModeSetting = JSON.parse(fs.readFileSync(INTERACTIVE_MODE_FILE, 'utf-8'));
      return data.enabled;
    }
  } catch (error: any) {
    log.error(` Failed to load interactive mode setting: ${error.message}`);
  }
  return false;
}

/**
 * Enable/disable experimental interactive-TUI mode.
 */
export function setInteractiveModeEnabled(enabled: boolean): void {
  ensureDataDir();
  const data: InteractiveModeSetting = {
    enabled,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(INTERACTIVE_MODE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` Interactive mode setting updated: enabled=${enabled}`);
  } catch (error: any) {
    log.error(` Failed to save interactive mode setting: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Codex App-Server Mode Setting
// ============================================================================
//
// Experimental: when enabled, Codex agents run through a persistent
// `codex app-server` JSON-RPC process instead of one `codex exec` process per
// turn. The app-server protocol streams word-by-word agent-message deltas
// (item/agentMessage/delta), which `codex exec --experimental-json` never
// emits, so this is the only way Codex replies can typewriter in the UI.
// Like interactive mode, the setting is read live at each launch — no server
// restart needed to switch.

const CODEX_APP_SERVER_MODE_FILE = path.join(DATA_DIR, 'codex-app-server-mode.json');

interface CodexAppServerModeSetting {
  enabled: boolean;
  updatedAt: number;
}

/**
 * Check if experimental Codex app-server (streaming) mode is enabled.
 */
export function isCodexAppServerModeEnabled(): boolean {
  ensureDataDir();
  try {
    if (fs.existsSync(CODEX_APP_SERVER_MODE_FILE)) {
      const data: CodexAppServerModeSetting = JSON.parse(fs.readFileSync(CODEX_APP_SERVER_MODE_FILE, 'utf-8'));
      return data.enabled;
    }
  } catch (error: any) {
    log.error(` Failed to load codex app-server mode setting: ${error.message}`);
  }
  // Default ON: streaming (app-server) is the default for Codex agents. An
  // explicit toggle-off is still respected (the file above wins).
  return true;
}

/**
 * Enable/disable experimental Codex app-server (streaming) mode.
 */
export function setCodexAppServerModeEnabled(enabled: boolean): void {
  ensureDataDir();
  const data: CodexAppServerModeSetting = {
    enabled,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(CODEX_APP_SERVER_MODE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` Codex app-server mode setting updated: enabled=${enabled}`);
  } catch (error: any) {
    log.error(` Failed to save codex app-server mode setting: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// OpenCode Server Mode Setting
// ============================================================================
//
// Experimental: when enabled, OpenCode agents run through a persistent, detached
// `opencode serve` HTTP server instead of one `opencode run` process per turn.
// The server streams word-by-word `message.part.delta` tokens over SSE (which
// `opencode run --format json` never emits) and survives commander restarts.
// Read live at each launch — no server restart needed to switch.

const OPENCODE_SERVER_MODE_FILE = path.join(DATA_DIR, 'opencode-server-mode.json');

interface OpencodeServerModeSetting {
  enabled: boolean;
  updatedAt: number;
}

/**
 * Check if experimental OpenCode server (streaming) mode is enabled.
 */
export function isOpencodeServerModeEnabled(): boolean {
  ensureDataDir();
  try {
    if (fs.existsSync(OPENCODE_SERVER_MODE_FILE)) {
      const data: OpencodeServerModeSetting = JSON.parse(fs.readFileSync(OPENCODE_SERVER_MODE_FILE, 'utf-8'));
      return data.enabled;
    }
  } catch (error: any) {
    log.error(` Failed to load opencode server mode setting: ${error.message}`);
  }
  // Default ON: streaming (opencode serve) is the default for OpenCode agents.
  // An explicit toggle-off is still respected (the file above wins).
  return true;
}

/**
 * Enable/disable experimental OpenCode server (streaming) mode.
 */
export function setOpencodeServerModeEnabled(enabled: boolean): void {
  ensureDataDir();
  const data: OpencodeServerModeSetting = {
    enabled,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(OPENCODE_SERVER_MODE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` OpenCode server mode setting updated: enabled=${enabled}`);
  } catch (error: any) {
    log.error(` Failed to save opencode server mode setting: ${error.message}`);
    throw error;
  }
}
