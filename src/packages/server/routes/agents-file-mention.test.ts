/**
 * Tests for GET /api/agents/:id/files — file/folder listing for @ mention autocomplete
 *
 * Uses a real temp directory as the agent cwd to validate the filesystem walk,
 * filtering, sorting, and exclusion of ignored directories.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Mock every module that agents.ts imports so the router can be loaded without
// real service instances or external binaries.
// ---------------------------------------------------------------------------

vi.mock('../services/index.js', () => ({
  agentService: { getAgent: vi.fn() },
  runtimeService: { sendCommand: vi.fn(), stopAgent: vi.fn(), collapseAgentContext: vi.fn() },
  bossMessageService: { buildBossMessage: vi.fn() },
  skillService: { buildSkillPromptContent: vi.fn(), hasPendingSkillUpdates: vi.fn(() => false), getSkillUpdateData: vi.fn(), clearPendingSkillUpdates: vi.fn() },
}));

vi.mock('../data/index.js', () => ({
  getClaudeProjectDir: vi.fn(() => '/tmp'),
  loadAreas: vi.fn(() => []),
  saveAreas: vi.fn(),
  loadBuildings: vi.fn(() => []),
}));

vi.mock('../claude/session-loader.js', () => ({
  loadSession: vi.fn(async () => []),
  listSessions: vi.fn(async () => []),
  searchSession: vi.fn(async () => ({ results: [] })),
}));

vi.mock('../services/custom-class-service.js', () => ({
  getAllCustomClasses: vi.fn(() => []),
  getCustomClass: vi.fn(),
  getClassInstructions: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() })),
}));

vi.mock('../utils/log-context.js', () => ({
  withAgentContext: vi.fn((_id: string, fn: () => unknown) => fn()),
}));

vi.mock('../utils/string.js', () => ({
  truncateOrEmpty: vi.fn((s: string) => s ?? ''),
}));

vi.mock('../websocket/handlers/command-handler.js', () => ({
  buildCustomAgentConfig: vi.fn(),
  expandFileMentions: vi.fn(async (cmd: string) => cmd),
}));

vi.mock('../websocket/handlers/boss-response-handler.js', () => ({
  clearDelegation: vi.fn(),
  getBossForSubordinate: vi.fn(),
}));

vi.mock('../opencode/backend.js', () => ({
  OpencodeBackend: class { listSessions = vi.fn(async () => []); },
}));

vi.mock('../services/system-prompt-service.js', () => ({
  getSystemPrompt: vi.fn(() => null),
  setSystemPrompt: vi.fn(),
  clearSystemPrompt: vi.fn(),
  isEchoPromptEnabled: vi.fn(() => false),
  setEchoPromptEnabled: vi.fn(),
  getCodexBinaryPath: vi.fn(() => null),
  setCodexBinaryPath: vi.fn(),
  isTmuxModeEnabled: vi.fn(() => false),
  setTmuxModeEnabled: vi.fn(),
  isInteractiveModeEnabled: vi.fn(() => false),
  setInteractiveModeEnabled: vi.fn(),
}));

vi.mock('../services/agent-terminal-service.js', () => ({
  startAgentTerminal: vi.fn(),
  stopAgentTerminal: vi.fn(),
}));

vi.mock('../services/claude-usage-service.js', () => ({
  buildClaudeUsageByAgentSummary: vi.fn(() => []),
  buildClaudeUsageByDaySummary: vi.fn(() => []),
  buildClaudeUsageSnapshot: vi.fn(() => ({})),
}));

vi.mock('../services/backup-service.js', () => ({
  getBackupStatus: vi.fn(() => ({ enabled: false })),
  setBackupEnabled: vi.fn(),
}));

import { agentService } from '../services/index.js';
import agentsRouter from './agents.js';

// ---------------------------------------------------------------------------
// Test fixtures — real temp directory used as agent cwd
// ---------------------------------------------------------------------------

let tmpDir: string;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Build a small directory tree for the tests
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-files-route-'));
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), '');
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'utils.ts'), '');
  fs.mkdirSync(path.join(tmpDir, 'src', 'routes'));
  fs.writeFileSync(path.join(tmpDir, 'src', 'routes', 'agents.ts'), '');
  // Ignored directories — should never appear in results
  fs.mkdirSync(path.join(tmpDir, 'node_modules'));
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'lodash.js'), '');
  fs.mkdirSync(path.join(tmpDir, '.git'));
  fs.writeFileSync(path.join(tmpDir, '.git', 'HEAD'), '');
  fs.mkdirSync(path.join(tmpDir, 'dist'));
  fs.writeFileSync(path.join(tmpDir, 'dist', 'bundle.js'), '');

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/agents', agentsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeAgent(cwd = tmpDir) {
  return { id: 'agent-1', name: 'Scout', class: 'scout', cwd, status: 'idle' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/agents/:id/files — @ mention file listing', () => {
  describe('agent not found', () => {
    it('returns 404 when agent does not exist', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(undefined as any);
      const res = await fetch(`${baseUrl}/api/agents/unknown-id/files`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });
  });

  describe('returns file list from agent cwd', () => {
    it('returns 200 with files array', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.files).toBeDefined();
      expect(Array.isArray(body.files)).toBe(true);
    });

    it('each entry has path, name and type fields', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files`);
      const { files } = await res.json();
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(f).toHaveProperty('path');
        expect(f).toHaveProperty('name');
        expect(f).toHaveProperty('type');
        expect(['file', 'dir']).toContain(f.type);
      }
    });

    it('directories appear before files in the results', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files`);
      const { files } = await res.json();
      const firstNonDir = files.findIndex((f: any) => f.type === 'file');
      const lastDir = files.map((f: any) => f.type).lastIndexOf('dir');
      if (firstNonDir !== -1 && lastDir !== -1) {
        expect(lastDir).toBeLessThan(firstNonDir);
      }
    });
  });

  describe('ignores system directories', () => {
    it('does not include node_modules entries', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files`);
      const { files } = await res.json();
      const paths: string[] = files.map((f: any) => f.path);
      expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    });

    it('does not include .git entries', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files`);
      const { files } = await res.json();
      const paths: string[] = files.map((f: any) => f.path);
      expect(paths.some((p) => p.includes('.git'))).toBe(false);
    });

    it('does not include dist entries', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files`);
      const { files } = await res.json();
      const paths: string[] = files.map((f: any) => f.path);
      expect(paths.some((p) => p.includes('dist'))).toBe(false);
    });
  });

  describe('query parameter filtering', () => {
    it('filters results by filename when q is provided', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files?q=utils`);
      expect(res.status).toBe(200);
      const { files } = await res.json();
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((f: any) => f.path.toLowerCase().includes('utils'))).toBe(true);
    });

    it('returns empty array when query matches nothing', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files?q=xxxxxxnotexist`);
      expect(res.status).toBe(200);
      const { files } = await res.json();
      expect(files).toHaveLength(0);
    });

    it('returns all files when q is empty string', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      const resAll = await fetch(`${baseUrl}/api/agents/agent-1/files`);
      const resEmpty = await fetch(`${baseUrl}/api/agents/agent-1/files?q=`);
      const all = (await resAll.json()).files;
      const empty = (await resEmpty.json()).files;
      expect(all.length).toBe(empty.length);
    });

    it('matches on partial path segments, not just filename', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(makeAgent() as any);
      // "routes" is a directory — querying for it should return that dir and its children
      const res = await fetch(`${baseUrl}/api/agents/agent-1/files?q=routes`);
      const { files } = await res.json();
      expect(files.some((f: any) => f.path.includes('routes'))).toBe(true);
    });
  });
});
