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
  agentService: {
    getAgent: vi.fn(),
    archiveCurrentSession: vi.fn(),
    updateAgent: vi.fn(),
    sanitizeModelForProvider: vi.fn((provider: string, model: unknown) =>
      provider === 'claude' && typeof model === 'string' && ['sonnet', 'haiku', 'opus'].includes(model) ? model : undefined),
    sanitizeCodexModel: vi.fn((model: unknown) => (typeof model === 'string' && model.trim() ? model.trim() : undefined)),
    sanitizeGrokModel: vi.fn((model: unknown) => (typeof model === 'string' && model.trim() ? model.trim() : undefined)),
    sanitizeOpencodeModel: vi.fn((model: unknown) => (typeof model === 'string' && model.trim() ? model.trim() : undefined)),
    sanitizePiModel: vi.fn((model: unknown) => (typeof model === 'string' && model.trim() ? model.trim() : undefined)),
  },
  runtimeService: {
    sendCommand: vi.fn(),
    stopAgent: vi.fn(),
    collapseAgentContext: vi.fn(),
    isAgentRunning: vi.fn(() => false),
  },
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
  detectSessionProvider: vi.fn(() => null),
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

vi.mock('../services/grok-usage-service.js', () => ({
  buildGrokUsageSnapshot: vi.fn(() => ({})),
}));

vi.mock('../services/backup-service.js', () => ({
  getBackupStatus: vi.fn(() => ({ enabled: false })),
  setBackupEnabled: vi.fn(),
}));

import { agentService, runtimeService } from '../services/index.js';
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

describe('POST /api/agents/:id/convert-runtime — harness migration', () => {
  const nativeAgent = {
    ...makeAgent(),
    provider: 'claude',
    sessionId: 'native-session-id',
  };

  it('stops an idle resident runtime without treating it as an active task (legacy /convert-to-pi alias)', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue(nativeAgent as any);
    vi.mocked(runtimeService.isAgentRunning).mockReturnValue(true);
    vi.mocked(agentService.updateAgent).mockReturnValue({
      ...nativeAgent,
      provider: 'pi',
      sessionId: undefined,
    } as any);

    const res = await fetch(`${baseUrl}/api/agents/agent-1/convert-to-pi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'fresh' }),
    });

    expect(res.status).toBe(200);
    expect(runtimeService.stopAgent).toHaveBeenCalledWith('agent-1');
    expect(agentService.updateAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ provider: 'pi' }),
      false,
    );
  });

  it('still requires confirmation when the agent status has an active task', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({ ...nativeAgent, status: 'working' } as any);
    vi.mocked(runtimeService.isAgentRunning).mockReturnValue(true);

    const res = await fetch(`${baseUrl}/api/agents/agent-1/convert-runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProvider: 'codex', mode: 'fresh' }),
    });

    expect(res.status).toBe(409);
    expect(runtimeService.stopAgent).not.toHaveBeenCalled();
  });

  it('migrates Claude → Codex fresh, carrying the Codex model/config and archiving the source', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue(nativeAgent as any);
    vi.mocked(runtimeService.isAgentRunning).mockReturnValue(false);
    vi.mocked(agentService.updateAgent).mockImplementation((_id, updates) => ({ ...nativeAgent, ...updates }) as any);

    const res = await fetch(`${baseUrl}/api/agents/agent-1/convert-runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetProvider: 'codex',
        mode: 'fresh',
        model: 'gpt-5.6-luna',
        codexConfig: { fullAuto: true, sandbox: 'workspace-write' },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transfer).toMatchObject({
      sourceProvider: 'claude',
      targetProvider: 'codex',
      mode: 'fresh',
      sourceSessionId: 'native-session-id',
      contextLimit: 258_400,
    });
    expect(agentService.archiveCurrentSession).toHaveBeenCalledWith('agent-1');
    expect(agentService.updateAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        provider: 'codex',
        sessionId: undefined,
        codexModel: 'gpt-5.6-luna',
        codexConfig: { fullAuto: true, sandbox: 'workspace-write' },
        piModelProvider: undefined,
      }),
      false,
    );
  });

  it('migrates Pi → Claude fresh and applies the Claude model context window', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({ ...nativeAgent, provider: 'pi', piModel: 'anthropic/claude-sonnet-5', piModelProvider: 'anthropic' } as any);
    vi.mocked(agentService.updateAgent).mockImplementation((_id, updates) => ({ ...nativeAgent, ...updates }) as any);

    const res = await fetch(`${baseUrl}/api/agents/agent-1/convert-runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProvider: 'claude', mode: 'fresh', model: 'sonnet', effort: 'high' }),
    });

    expect(res.status).toBe(200);
    expect(agentService.updateAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ provider: 'claude', model: 'sonnet', effort: 'high', contextLimit: 200_000, piModelProvider: undefined }),
      false,
    );
  });

  it('rejects an unknown Claude model for the target', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({ ...nativeAgent, provider: 'grok' } as any);
    const res = await fetch(`${baseUrl}/api/agents/agent-1/convert-runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProvider: 'claude', mode: 'fresh', model: 'not-a-model' }),
    });
    expect(res.status).toBe(400);
    expect(agentService.updateAgent).not.toHaveBeenCalled();
  });

  it('refuses to import into OpenCode (no writable session store) but allows a fresh start', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue(nativeAgent as any);
    vi.mocked(agentService.updateAgent).mockImplementation((_id, updates) => ({ ...nativeAgent, ...updates }) as any);

    const importRes = await fetch(`${baseUrl}/api/agents/agent-1/convert-runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProvider: 'opencode', mode: 'smart' }),
    });
    expect(importRes.status).toBe(422);
    expect((await importRes.json()).code).toBe('target-unsupported');
    expect(agentService.updateAgent).not.toHaveBeenCalled();

    const freshRes = await fetch(`${baseUrl}/api/agents/agent-1/convert-runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProvider: 'opencode', mode: 'fresh', model: 'minimax/MiniMax-M1-80k' }),
    });
    expect(freshRes.status).toBe(200);
    expect(agentService.updateAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ provider: 'opencode', opencodeModel: 'minimax/MiniMax-M1-80k' }),
      false,
    );
  });

  it('rejects converting to the runtime the agent already uses and unknown targets', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue(nativeAgent as any);
    const same = await fetch(`${baseUrl}/api/agents/agent-1/convert-runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProvider: 'claude', mode: 'fresh' }),
    });
    expect(same.status).toBe(400);
    const unknown = await fetch(`${baseUrl}/api/agents/agent-1/convert-runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProvider: 'cursor', mode: 'fresh' }),
    });
    expect(unknown.status).toBe(400);
  });

  it('blocks a cross-runtime PATCH while the agent holds a session', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue(nativeAgent as any);
    const res = await fetch(`${baseUrl}/api/agents/agent-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'grok' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('use-convert-runtime');
    expect(agentService.updateAgent).not.toHaveBeenCalled();
  });
});

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

    it('ranks shallow exact-name matches above deeper namesakes', async () => {
      // Build a scenario with a deep "src" directory under an alphabetically
      // earlier sibling — the kind of layout that hid the root-level src/
      // before MAX_RESULTS was lifted from inside the walk.
      const deepRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-files-deep-'));
      try {
        fs.mkdirSync(path.join(deepRoot, 'src'));
        fs.writeFileSync(path.join(deepRoot, 'src', 'app.ts'), '');
        fs.mkdirSync(path.join(deepRoot, 'android'));
        fs.mkdirSync(path.join(deepRoot, 'android', 'app'));
        fs.mkdirSync(path.join(deepRoot, 'android', 'app', 'src'));
        fs.writeFileSync(path.join(deepRoot, 'android', 'app', 'src', 'main.java'), '');

        vi.mocked(agentService.getAgent).mockReturnValue(makeAgent(deepRoot) as any);
        const res = await fetch(`${baseUrl}/api/agents/agent-1/files?q=src`);
        const { files } = await res.json();
        const rootIdx = files.findIndex((f: any) => f.path === 'src');
        const deepIdx = files.findIndex((f: any) => f.path === 'android/app/src');
        expect(rootIdx).toBeGreaterThanOrEqual(0);
        expect(deepIdx).toBeGreaterThanOrEqual(0);
        expect(rootIdx).toBeLessThan(deepIdx);
      } finally {
        fs.rmSync(deepRoot, { recursive: true, force: true });
      }
    });
  });
});
