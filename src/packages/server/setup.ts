#!/usr/bin/env tsx
/**
 * Tide Commander - Setup Script
 * Run with: npm run setup
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TIDE_HOOKS_DIR = path.join(os.homedir(), '.tide-commander', 'hooks');
const CLAUDE_SETTINGS_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_SETTINGS_DIR, 'settings.json');

console.log('🌊 Tide Commander - Setup');
console.log('='.repeat(40));

// Check for dependencies
console.log('\nChecking dependencies...');

// Check jq (for hook script)
try {
  execSync('which jq', { stdio: 'pipe' });
  console.log('✓ jq is installed');
} catch {
  console.error('✗ jq is not installed');
  console.error('  Install with: sudo apt install jq (or brew install jq)');
  process.exit(1);
}

// Check Claude Code
try {
  execSync('which claude', { stdio: 'pipe' });
  console.log('✓ Claude Code CLI is installed');
} catch {
  console.error('✗ Claude Code CLI is not installed');
  console.error('  Install from: https://github.com/anthropics/claude-code');
  process.exit(1);
}

// Create directories
console.log('\nSetting up directories...');

fs.mkdirSync(TIDE_HOOKS_DIR, { recursive: true });
console.log(`✓ Created ${TIDE_HOOKS_DIR}`);

fs.mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true });
console.log(`✓ Created ${CLAUDE_SETTINGS_DIR}`);

// Copy hook script
console.log('\nInstalling hooks...');

const hookScriptSource = path.join(process.cwd(), 'hooks', 'tide-hook.sh');
const hookScriptDest = path.join(TIDE_HOOKS_DIR, 'tide-hook.sh');

if (fs.existsSync(hookScriptSource)) {
  fs.copyFileSync(hookScriptSource, hookScriptDest);
  fs.chmodSync(hookScriptDest, '755');
  console.log(`✓ Installed hook script to ${hookScriptDest}`);
} else {
  console.error(`✗ Hook script not found at ${hookScriptSource}`);
  process.exit(1);
}

// Update Claude settings
console.log('\nConfiguring Claude Code...');

interface ClaudeSettings {
  hooks?: Record<string, string>;
  [key: string]: unknown;
}

let settings: ClaudeSettings = {};

if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
  // Backup existing settings
  const backupFile = `${CLAUDE_SETTINGS_FILE}.backup`;
  fs.copyFileSync(CLAUDE_SETTINGS_FILE, backupFile);
  console.log(`✓ Backed up settings to ${backupFile}`);

  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
  } catch {
    console.warn('  Warning: Could not parse existing settings, starting fresh');
  }
}

// Add hooks
settings.hooks = {
  ...settings.hooks,
  PreToolUse: hookScriptDest,
  PostToolUse: hookScriptDest,
  Stop: hookScriptDest,
  UserPromptSubmit: hookScriptDest,
};

fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2));
console.log(`✓ Updated ${CLAUDE_SETTINGS_FILE}`);

// Done
console.log('\n' + '='.repeat(40));
console.log('🎉 Setup complete!\n');
console.log('To start Tide Commander:');
console.log('  npm run dev\n');
console.log('Then open http://localhost:5173 in your browser (or your configured VITE_PORT)');
