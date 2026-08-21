/**
 * Tests for Command Handler
 *
 * Covers: buildCustomAgentConfig, handleSendCommand (/clear, boss routing, regular routing),
 * boss command tracking, agent identity headers, expandFileMentions
 */

import { afterAll, beforeAll, describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildCustomAgentConfig,
  getLastBossCommand,
  setLastBossCommand,
  handleSendCommand,
  expandFileMentions,
} from './command-handler.js';

// Mock all service dependencies
vi.mock('../../services/index.js', () => ({
  agentService: {
    getAgent: vi.fn(),
    updateAgent: vi.fn(),
    hasPendingPropertyUpdates: vi.fn(() => false),
    buildPropertyUpdateNotification: vi.fn(),
    clearPendingPropertyUpdates: vi.fn(),
  },
  runtimeService: {
    sendCommand: vi.fn(),
    stopAgent: vi.fn(),
  },
  skillService: {
    buildSkillPromptContent: vi.fn(),
    hasPendingSkillUpdates: vi.fn(() => false),
    getSkillUpdateData: vi.fn(),
    clearPendingSkillUpdates: vi.fn(),
  },
  customClassService: {
    getClassInstructions: vi.fn(),
    getCustomClass: vi.fn(),
  },
}));

vi.mock('../../utils/index.js', () => {
  const makeLog = () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() });
  return {
    createLogger: vi.fn(() => makeLog()),
    getCommanderBaseUrl: vi.fn(() => 'http://localhost:6200'),
    generateId: vi.fn(() => 'test-id'),
    sanitizeUnicode: vi.fn((s: string) => s),
    logger: {
      server: makeLog(),
      http: makeLog(),
      ws: makeLog(),
      claude: makeLog(),
      agent: makeLog(),
      files: makeLog(),
      boss: makeLog(),
    },
  };
});

vi.mock('../../auth/index.js', () => ({
  getAuthToken: vi.fn(() => null),
}));

// Import mocked services to set return values
import { agentService, runtimeService, skillService, customClassService } from '../../services/index.js';
import { pluginManager } from '../../plugins/index.js';

describe('Command Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('boss command tracking', () => {
    it('tracks and retrieves last boss command', () => {
      setLastBossCommand('boss-1', 'deploy the app');
      expect(getLastBossCommand('boss-1')).toBe('deploy the app');
    });

    it('returns undefined for untracked boss', () => {
      expect(getLastBossCommand('boss-unknown')).toBeUndefined();
    });

    it('overwrites previous command', () => {
      setLastBossCommand('boss-1', 'first');
      setLastBossCommand('boss-1', 'second');
      expect(getLastBossCommand('boss-1')).toBe('second');
    });
  });

  describe('buildCustomAgentConfig', () => {
    it('returns undefined for boss agents', () => {
      const result = buildCustomAgentConfig('agent-1', 'boss');
      expect(result).toBeUndefined();
    });

    it('includes agent identity header', () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-1', name: 'Scout', class: 'scout', status: 'idle',
      } as any);
      vi.mocked(customClassService.getClassInstructions).mockReturnValue(undefined);
      vi.mocked(skillService.buildSkillPromptContent).mockReturnValue('');
      vi.mocked(customClassService.getCustomClass).mockReturnValue(undefined);

      const result = buildCustomAgentConfig('agent-1', 'scout');

      expect(result).toBeDefined();
      expect(result!.definition.prompt).toContain('Agent Identity');
      expect(result!.definition.prompt).toContain('agent-1');
      expect(result!.definition.prompt).toContain('Scout');
    });

    it('includes class instructions when available', () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-2', name: 'Builder', class: 'builder', status: 'idle',
      } as any);
      vi.mocked(customClassService.getClassInstructions).mockReturnValue('You are a builder agent.');
      vi.mocked(skillService.buildSkillPromptContent).mockReturnValue('');
      vi.mocked(customClassService.getCustomClass).mockReturnValue({
        id: 'builder', description: 'Builder agent class',
      } as any);

      const result = buildCustomAgentConfig('agent-2', 'builder');

      expect(result!.name).toBe('builder');
      expect(result!.definition.prompt).toContain('You are a builder agent.');
      expect(result!.definition.description).toBe('Builder agent class');
    });

    it('includes skill content when available', () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-3', name: 'Dev', class: 'developer', status: 'idle',
      } as any);
      vi.mocked(customClassService.getClassInstructions).mockReturnValue(undefined);
      vi.mocked(skillService.buildSkillPromptContent).mockReturnValue('# Skills\n- Use grep');
      vi.mocked(customClassService.getCustomClass).mockReturnValue(undefined);

      const result = buildCustomAgentConfig('agent-3', 'developer');
      expect(result!.definition.prompt).toContain('# Skills');
      expect(result!.definition.prompt).toContain('Use grep');
    });

    it('includes custom instructions when available', () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-4', name: 'Custom', class: 'default', status: 'idle',
        customInstructions: 'Always write tests first.',
      } as any);
      vi.mocked(customClassService.getClassInstructions).mockReturnValue(undefined);
      vi.mocked(skillService.buildSkillPromptContent).mockReturnValue('');
      vi.mocked(customClassService.getCustomClass).mockReturnValue(undefined);

      const result = buildCustomAgentConfig('agent-4', 'default');
      expect(result!.definition.prompt).toContain('# Custom Instructions');
      expect(result!.definition.prompt).toContain('Always write tests first.');
    });
  });

  describe('handleSendCommand', () => {
    const mockCtx = {
      broadcast: vi.fn(),
      sendActivity: vi.fn(),
    } as any;

    const mockBuildBossMessage = vi.fn(async () => ({
      message: 'boss context message',
      systemPrompt: 'boss system prompt',
    }));

    it('handles /clear command', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-1', name: 'Agent1', class: 'default', status: 'working',
      } as any);

      await handleSendCommand(mockCtx, { agentId: 'agent-1', command: '/clear' }, mockBuildBossMessage);

      expect(runtimeService.stopAgent).toHaveBeenCalledWith('agent-1');
      expect(agentService.updateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        status: 'idle',
        taskLabel: undefined,
        sessionId: undefined,
        tokensUsed: 0,
      }));
      expect(mockCtx.sendActivity).toHaveBeenCalledWith('agent-1', expect.stringContaining('cleared'));
    });

    // Intercepted commands never reach the runner, so without an explicit echo
    // the user's own command silently vanished from the conversation.
    it.each(['/clear', '/context', '/cost'])('echoes intercepted %s into the chat', async (cmd) => {
      mockCtx.broadcast.mockClear();
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-1', name: 'Agent1', class: 'default', status: 'idle', provider: 'claude',
      } as any);

      await handleSendCommand(mockCtx, { agentId: 'agent-1', command: cmd }, mockBuildBossMessage);

      expect(mockCtx.broadcast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'command_started',
        payload: expect.objectContaining({ agentId: 'agent-1', command: cmd }),
      }));
    });

    it('intercepts an enabled plugin slash command and broadcasts structured output', async () => {
      mockCtx.broadcast.mockClear();
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-1', name: 'Agent1', class: 'default', status: 'idle', provider: 'claude',
      } as any);
      const matched = {
        pluginId: 'test-plugin',
        invokedAs: '/tasks',
        command: { name: '/show-tasks', aliases: ['/tasks'], summary: 'Tasks' },
      };
      vi.spyOn(pluginManager, 'matchSlashCommand').mockReturnValueOnce(matched);
      vi.spyOn(pluginManager, 'executeSlashCommand').mockResolvedValueOnce({
        pluginId: 'test-plugin',
        rendererId: 'task-list',
        instanceId: 'output-1',
        data: { kind: 'task-list', items: [] },
      });

      await handleSendCommand(mockCtx, { agentId: 'agent-1', command: '/tasks' }, mockBuildBossMessage);

      expect(mockCtx.broadcast).toHaveBeenNthCalledWith(1, {
        type: 'command_started',
        payload: { agentId: 'agent-1', command: '/tasks' },
      });
      expect(mockCtx.broadcast).toHaveBeenNthCalledWith(2, {
        type: 'plugin_output',
        payload: {
          agentId: 'agent-1',
          output: expect.objectContaining({ pluginId: 'test-plugin', instanceId: 'output-1' }),
        },
      });
      expect(runtimeService.sendCommand).not.toHaveBeenCalled();
    });

    it('does not double-echo a command that reaches the runner', async () => {
      mockCtx.broadcast.mockClear();
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-1', name: 'Agent1', class: 'default', status: 'idle', provider: 'claude',
      } as any);

      await handleSendCommand(mockCtx, { agentId: 'agent-1', command: '/compact' }, mockBuildBossMessage);

      const echoes = mockCtx.broadcast.mock.calls
        .filter((c: any[]) => c[0]?.type === 'command_started');
      expect(echoes).toHaveLength(0);
    });

    it('returns early for unknown agent', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue(undefined as any);

      await handleSendCommand(mockCtx, { agentId: 'unknown', command: 'hello' }, mockBuildBossMessage);

      expect(runtimeService.sendCommand).not.toHaveBeenCalled();
    });

    it('routes boss agent commands through buildBossMessage', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'boss-1', name: 'Boss', class: 'boss', isBoss: true, status: 'idle',
      } as any);

      await handleSendCommand(mockCtx, { agentId: 'boss-1', command: 'deploy app' }, mockBuildBossMessage);

      expect(mockBuildBossMessage).toHaveBeenCalledWith('boss-1', 'deploy app');
      expect(runtimeService.sendCommand).toHaveBeenCalledWith('boss-1', 'boss context message', 'boss system prompt', undefined, undefined, undefined);
    });

    it('routes regular agent commands with custom config', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-1', name: 'Worker', class: 'scout', status: 'idle',
      } as any);
      vi.mocked(customClassService.getClassInstructions).mockReturnValue('Scout instructions');
      vi.mocked(skillService.buildSkillPromptContent).mockReturnValue('');
      vi.mocked(customClassService.getCustomClass).mockReturnValue(undefined);

      await handleSendCommand(mockCtx, { agentId: 'agent-1', command: 'find bugs' }, mockBuildBossMessage);

      expect(runtimeService.sendCommand).toHaveBeenCalledWith(
        'agent-1',
        'find bugs',
        undefined,
        undefined,
        expect.objectContaining({
          definition: expect.objectContaining({
            prompt: expect.stringContaining('Scout instructions'),
          }),
        }),
        undefined,
      );
    });

    it('handles codex /context command locally', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-codex', name: 'Codex', class: 'default', status: 'working',
        provider: 'codex', contextUsed: 50000, contextLimit: 200000,
      } as any);

      await handleSendCommand(mockCtx, { agentId: 'agent-codex', command: '/context' }, mockBuildBossMessage);

      expect(mockCtx.broadcast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'output',
        payload: expect.objectContaining({
          agentId: 'agent-codex',
          text: expect.stringContaining('Context'),
        }),
      }));
      expect(runtimeService.sendCommand).not.toHaveBeenCalled();
    });

    it('falls back to raw command if boss message build fails', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'boss-1', name: 'Boss', class: 'boss', isBoss: true, status: 'idle',
      } as any);
      mockBuildBossMessage.mockRejectedValueOnce(new Error('context fetch failed'));

      await handleSendCommand(mockCtx, { agentId: 'boss-1', command: 'do stuff' }, mockBuildBossMessage);

      // Should fall back to sending raw command
      expect(runtimeService.sendCommand).toHaveBeenCalledWith('boss-1', 'do stuff', undefined, undefined, undefined, undefined);
    });

    it('forwards forceInterrupt to runtimeService for regular agents', async () => {
      vi.mocked(agentService.getAgent).mockReturnValue({
        id: 'agent-1', name: 'Worker', class: 'scout', status: 'working', provider: 'grok',
      } as any);
      vi.mocked(customClassService.getClassInstructions).mockReturnValue('');
      vi.mocked(skillService.buildSkillPromptContent).mockReturnValue('');
      vi.mocked(customClassService.getCustomClass).mockReturnValue(undefined);

      await handleSendCommand(
        mockCtx,
        { agentId: 'agent-1', command: 'do it now', forceInterrupt: true },
        mockBuildBossMessage,
      );

      expect(runtimeService.sendCommand).toHaveBeenCalledWith(
        'agent-1',
        'do it now',
        undefined,
        undefined,
        expect.anything(),
        { forceInterrupt: true },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// expandFileMentions — uses real temp filesystem (no fs mock needed)
// ---------------------------------------------------------------------------

describe('expandFileMentions', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-expand-test-'));
    // Create files
    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export const greeting = "hello";');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Project\nDocs here.');
    // Create a sub-directory with files
    const subDir = path.join(tmpDir, 'src');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'index.ts'), 'export default {}');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns command unchanged when there are no mention tokens', async () => {
    const cmd = 'revisa este código y dime qué hace';
    expect(await expandFileMentions(cmd, tmpDir)).toBe(cmd);
  });

  it('expands [@file:path] by injecting file content before the user text', async () => {
    const result = await expandFileMentions('[@file:hello.ts]\nexplica el archivo', tmpDir);
    expect(result).toContain('<archivos_contexto>');
    expect(result).toContain('<archivo ruta="hello.ts">');
    expect(result).toContain('<![CDATA[');
    expect(result).toContain('export const greeting = "hello";');
    expect(result).toContain('</archivo>');
    expect(result).toContain('Petición: explica el archivo');
  });

  it('places file context before the user message', async () => {
    const result = await expandFileMentions('[@file:hello.ts]\nque hace esto?', tmpDir);
    const fileIdx = result.indexOf('<archivo ruta=');
    const textIdx = result.indexOf('Petición: que hace esto?');
    expect(fileIdx).toBeLessThan(textIdx);
  });

  it('expands multiple [@file:] tokens', async () => {
    const result = await expandFileMentions(
      '[@file:hello.ts]\n[@file:README.md]\ncompara ambos',
      tmpDir,
    );
    expect(result).toContain('<archivo ruta="hello.ts">');
    expect(result).toContain('<archivo ruta="README.md">');
    expect(result).toContain('# Project');
    expect(result).toContain('Petición: compara ambos');
  });

  it('silently drops unreadable file token rather than throwing', async () => {
    const result = await expandFileMentions('[@file:no-existe.ts]\nexplica', tmpDir);
    // Unreadable file is skipped; only the user text is returned
    expect(result).not.toContain('[@file:no-existe.ts]');
    expect(result).toContain('explica');
  });

  it('expands [@folder:path] as a structure listing without inlining file content', async () => {
    const result = await expandFileMentions('[@folder:src]\nexplora la carpeta', tmpDir);
    expect(result).toContain('<archivos_contexto>');
    // Folder mention emits a <carpeta> block with paths, NOT <archivo> blocks
    expect(result).toContain('<carpeta ruta="src">');
    expect(result).toContain('src/index.ts');
    expect(result).not.toContain('<archivo ruta="src/index.ts">');
    // The file content from inside src/ must not leak into the prompt
    expect(result).not.toContain('export default {}');
    expect(result).toContain('Petición: explora la carpeta');
  });

  it('mixes [@file:] (content) and [@folder:] (structure) in the same prompt', async () => {
    const result = await expandFileMentions(
      '[@file:hello.ts]\n[@folder:src]\ncompara',
      tmpDir,
    );
    // file mention still inlines content
    expect(result).toContain('<archivo ruta="hello.ts">');
    expect(result).toContain('export const greeting = "hello";');
    // folder mention stays structural
    expect(result).toContain('<carpeta ruta="src">');
    expect(result).toContain('src/index.ts');
    expect(result).not.toContain('<archivo ruta="src/index.ts">');
  });

  it('handles command with only a mention and no user text', async () => {
    const result = await expandFileMentions('[@file:hello.ts]', tmpDir);
    expect(result).toContain('<archivo ruta="hello.ts">');
    expect(result).toContain('export const greeting');
  });

  it('expands [@agent:id] into an <agentes_contexto> block with the agent identity', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'cy3c3i3x', name: 'Scout One', class: 'scout', status: 'idle',
      trackingStatus: 'working', cwd: '/work/scout', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:cy3c3i3x]\ncoordínate con él', tmpDir);
    expect(result).toContain('<agentes_contexto>');
    expect(result).toContain('id="cy3c3i3x"');
    expect(result).toContain('nombre="Scout One"');
    expect(result).toContain('clase="scout"');
    expect(result).toContain('estado="working"'); // trackingStatus wins over status
    expect(result).toContain('jefe="false"');
    expect(result).toContain('Petición: coordínate con él');
    // No file context block when only an agent was mentioned
    expect(result).not.toContain('<archivos_contexto>');
  });

  it('drops an [@agent:id] token for an unknown agent', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue(undefined as any);
    const result = await expandFileMentions('[@agent:ghost]\nhola', tmpDir);
    expect(result).not.toContain('<agentes_contexto>');
    expect(result).not.toContain('[@agent:ghost]');
    expect(result).toContain('hola');
  });

  it('deduplicates repeated [@agent:id] mentions of the same agent', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'Dupe', class: 'default', status: 'idle', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:a1]\n[@agent:a1]\nhola', tmpDir);
    expect(result.match(/<agente /g)?.length).toBe(1);
  });

  it('escapes quotes in agent names within the attribute', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'My "Cool" Agent', class: 'default', status: 'idle', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:a1] hey', tmpDir);
    expect(result).toContain('nombre="My &quot;Cool&quot; Agent"');
  });

  it('combines [@file:] and [@agent:] context in the same prompt', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a2', name: 'Helper', class: 'scout', status: 'idle', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@file:hello.ts]\n[@agent:a2]\nhaz ambos', tmpDir);
    expect(result).toContain('<archivos_contexto>');
    expect(result).toContain('<archivo ruta="hello.ts">');
    expect(result).toContain('<agentes_contexto>');
    expect(result).toContain('nombre="Helper"');
    expect(result).toContain('Petición: haz ambos');
  });

  it('marks a boss agent with jefe="true"', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'b1', name: 'Boss', class: 'orchestrator', status: 'idle', cwd: '/w', isBoss: true,
    } as any);
    const result = await expandFileMentions('[@agent:b1] delega', tmpDir);
    expect(result).toContain('jefe="true"');
  });

  it('falls back to status when trackingStatus is absent', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'Plain', class: 'default', status: 'idle', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:a1] hey', tmpDir);
    expect(result).toContain('estado="idle"');
  });

  it('uses estado="unknown" when neither trackingStatus nor status is set', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'Ghosty', class: 'default', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:a1] hey', tmpDir);
    expect(result).toContain('estado="unknown"');
  });

  it('escapes <, > and & in agent attributes', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'A <b> & "c"', class: 'x&y', status: 'idle', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:a1] hey', tmpDir);
    expect(result).toContain('nombre="A &lt;b&gt; &amp; &quot;c&quot;"');
    expect(result).toContain('clase="x&amp;y"');
    // No raw angle brackets leak into the attribute value
    expect(result).not.toContain('nombre="A <b>');
  });

  it('emits a block for each distinct agent (no false dedup)', async () => {
    vi.mocked(agentService.getAgent).mockImplementation(((id: string) => ({
      id, name: `Name-${id}`, class: 'scout', status: 'idle', cwd: '/w', isBoss: false,
    })) as any);
    const result = await expandFileMentions('[@agent:a1]\n[@agent:a2]\njunta', tmpDir);
    expect(result.match(/<agente /g)?.length).toBe(2);
    expect(result).toContain('id="a1"');
    expect(result).toContain('id="a2"');
  });

  it('trims whitespace inside the [@agent: id ] token before lookup', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'Trimmed', class: 'default', status: 'idle', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:  a1  ] hey', tmpDir);
    expect(agentService.getAgent).toHaveBeenCalledWith('a1');
    expect(result).toContain('id="a1"');
  });

  it('emits empty cwd attribute when the agent has no cwd', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'NoCwd', class: 'default', status: 'idle', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:a1] hey', tmpDir);
    expect(result).toContain('cwd=""');
  });

  it('includes agent coordination guidance inside <instrucciones_internas>', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'Guide', class: 'scout', status: 'idle', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@agent:a1] coordina', tmpDir);
    const start = result.indexOf('<instrucciones_internas>');
    const end = result.indexOf('</instrucciones_internas>');
    expect(start).toBeGreaterThanOrEqual(0);
    const guidance = result.slice(start, end);
    expect(guidance).toContain('<agentes_contexto>');
    expect(guidance).toContain('POST /api/agents/<id>/message');
    // The guidance clarifies tagging does not auto-message the agent
    expect(guidance).toContain('no se envió ningún mensaje');
  });

  it('combines [@folder:] structure and [@agent:] identity in one prompt', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'a1', name: 'Combo', class: 'scout', status: 'idle', cwd: '/w', isBoss: false,
    } as any);
    const result = await expandFileMentions('[@folder:src]\n[@agent:a1]\nrevisa', tmpDir);
    expect(result).toContain('<carpeta ruta="src">');
    expect(result).toContain('<agentes_contexto>');
    expect(result).toContain('nombre="Combo"');
    expect(result).toContain('Petición: revisa');
  });
});
