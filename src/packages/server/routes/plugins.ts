import { Router, type Request, type Response } from 'express';
import { pluginManager, PluginRuntimeError } from '../plugins/index.js';
import { agentService } from '../services/index.js';
import {
  pluginShellCommandService,
  PluginShellCommandError,
} from '../services/plugin-shell-command-service.js';
import { createLogger } from '../utils/logger.js';
import type { PluginShellCommandInput } from '../../shared/plugin-types.js';

const router = Router();
const log = createLogger('PluginRoutes');

function bodyRecord(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
}

function sendPluginError(res: Response, error: unknown): void {
  if (error instanceof PluginRuntimeError || error instanceof PluginShellCommandError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  log.error('Plugin request failed:', error);
  res.status(500).json({ error: message, code: 'PLUGIN_INTERNAL_ERROR' });
}

function shellCommandInput(body: Record<string, unknown>): PluginShellCommandInput {
  return {
    name: typeof body.name === 'string' ? body.name : '',
    summary: typeof body.summary === 'string' ? body.summary : '',
    script: typeof body.script === 'string' ? body.script : '',
    ...(typeof body.cwd === 'string' ? { cwd: body.cwd } : {}),
    runAsSudo: body.runAsSudo === true,
    pty: body.pty !== false,
    enabled: body.enabled !== false,
  };
}

function assertCommandNameAvailable(name: string, currentId?: string): void {
  const normalized = `/${name.trim().replace(/^\//, '').toLowerCase()}`;
  if (['/clear', '/compact', '/context', '/cost'].includes(normalized)) {
    throw new PluginShellCommandError(`Slash command ${normalized} is reserved by Commander`, 409, 'SHELL_COMMAND_CONFLICT');
  }
  const matched = pluginManager.matchSlashCommand(normalized);
  if (matched && matched.pluginId !== 'shell-commands') {
    throw new PluginShellCommandError(
      `Slash command ${normalized} is already provided by plugin ${matched.pluginId}`,
      409,
      'SHELL_COMMAND_CONFLICT',
    );
  }
  void currentId;
}

async function syncShellCommandReservations(): Promise<void> {
  const commands = await pluginShellCommandService.list();
  pluginManager.setExternalSlashCommands(
    'shell-commands',
    commands.filter((command) => command.enabled).map((command) => command.name),
  );
}

function isSecurePasswordRequest(req: Request): boolean {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',', 1)[0]?.trim().toLowerCase();
  if (forwardedProto) return forwardedProto === 'https';
  const address = req.socket.remoteAddress ?? '';
  const loopback = address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.');
  return loopback || req.secure;
}

router.get('/shell-commands', async (_req: Request, res: Response) => {
  try {
    res.json({ commands: await pluginShellCommandService.list() });
  } catch (error) {
    sendPluginError(res, error);
  }
});

/** Agent-friendly discovery catalog. Script bodies and secrets are never included. */
router.get('/slash-commands', async (_req: Request, res: Response) => {
  try {
    const pluginCommands = pluginManager.list()
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) => (plugin.contributes?.slashCommands ?? []).map((command) => ({
        kind: 'plugin' as const,
        pluginId: plugin.id,
        name: command.name,
        aliases: command.aliases ?? [],
        summary: command.summary,
        endpoint: `/api/plugins/${encodeURIComponent(plugin.id)}/commands/${encodeURIComponent(command.name.replace(/^\//, ''))}`,
      })));
    const shellCommands = pluginManager.get('shell-commands')?.enabled === true
      ? (await pluginShellCommandService.list())
        .filter((command) => command.enabled)
        .map((command) => ({
          kind: 'shell' as const,
          pluginId: 'shell-commands',
          commandId: command.id,
          name: command.name,
          aliases: [],
          summary: command.summary,
          requiresSudo: command.runAsSudo,
          endpoint: '/api/exec',
        }))
      : [];
    res.json({ commands: [...pluginCommands, ...shellCommands] });
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.post('/shell-commands', async (req: Request, res: Response) => {
  try {
    const input = shellCommandInput(bodyRecord(req));
    assertCommandNameAvailable(input.name);
    const command = await pluginShellCommandService.create(input);
    await syncShellCommandReservations();
    res.status(201).json({ command });
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.put('/shell-commands/:id', async (req: Request, res: Response) => {
  try {
    const input = shellCommandInput(bodyRecord(req));
    assertCommandNameAvailable(input.name, String(req.params.id));
    const command = await pluginShellCommandService.update(String(req.params.id), input);
    await syncShellCommandReservations();
    res.json({ command });
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.delete('/shell-commands/:id', async (req: Request, res: Response) => {
  try {
    await pluginShellCommandService.remove(String(req.params.id));
    await syncShellCommandReservations();
    res.json({ success: true });
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.post('/shell-commands/sudo/authorize', async (req: Request, res: Response) => {
  try {
    const insecureTransport = !isSecurePasswordRequest(req);
    if (insecureTransport) {
      log.warn('Accepting sudo authorization over a non-HTTPS connection');
    }
    const body = bodyRecord(req);
    if (typeof body.challengeId !== 'string' || typeof body.password !== 'string') {
      throw new PluginShellCommandError('challengeId and password are required');
    }
    await pluginShellCommandService.authorizeSudo(body.challengeId, body.password);
    res.json({
      authorized: true,
      authorizationId: body.challengeId,
      ...(insecureTransport ? {
        warning: 'Sudo password submitted without HTTPS transport encryption',
      } : {}),
    });
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.post('/shell-commands/:id/prepare', async (req: Request, res: Response) => {
  try {
    if (pluginManager.get('shell-commands')?.enabled !== true) {
      throw new PluginShellCommandError('Command Scripts plugin is disabled', 409, 'PLUGIN_DISABLED');
    }
    const body = bodyRecord(req);
    if (typeof body.agentId !== 'string' || !agentService.getAgent(body.agentId)) {
      throw new PluginShellCommandError('Select an active agent before running this command', 400, 'SHELL_COMMAND_AGENT_REQUIRED');
    }
    const prepared = await pluginShellCommandService.prepare(
      String(req.params.id),
      body.agentId,
      typeof body.argsText === 'string' ? body.argsText : '',
    );
    res.json({ prepared });
  } catch (error) {
    sendPluginError(res, error);
  }
});

/** Catalog of builtin and installed trusted-local plugins. */
router.get('/', (_req: Request, res: Response) => {
  res.json({ plugins: pluginManager.list() });
});

/** Install and enable a plugin from an absolute local directory. */
router.post('/install', async (req: Request, res: Response) => {
  try {
    const { sourcePath } = bodyRecord(req);
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      throw new PluginRuntimeError('sourcePath is required');
    }
    const plugin = await pluginManager.install(sourcePath);
    res.status(201).json({ plugin });
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.post('/:id/enable', async (req: Request, res: Response) => {
  try {
    const plugin = await pluginManager.enable(String(req.params.id));
    res.json({ plugin });
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.post('/:id/disable', async (req: Request, res: Response) => {
  try {
    const plugin = await pluginManager.disable(String(req.params.id));
    res.json({ plugin });
  } catch (error) {
    sendPluginError(res, error);
  }
});

/**
 * Serve an external browser module through the authenticated API namespace.
 * The manager re-validates realpath containment on every read so replacing an
 * entry with a symlink cannot turn this route into an arbitrary file reader.
 */
router.get('/:id/client', async (req: Request, res: Response) => {
  try {
    const { source } = await pluginManager.readClientEntry(String(req.params.id));
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(source);
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.post('/:id/commands/:command', async (req: Request, res: Response) => {
  try {
    const body = bodyRecord(req);
    const output = await pluginManager.executeCommand(
      String(req.params.id),
      String(req.params.command),
      body,
    );
    const privatelyPublished = output.data
      && typeof output.data === 'object'
      && !Array.isArray(output.data)
      && (output.data as { kind?: unknown }).kind === 'sudo-command-requested';
    if (typeof body.agentId === 'string' && !privatelyPublished) {
      pluginManager.publishOutput(body.agentId, output);
    }
    res.json({ output });
  } catch (error) {
    sendPluginError(res, error);
  }
});

router.post('/:id/actions/:action', async (req: Request, res: Response) => {
  try {
    const body = bodyRecord(req);
    const pluginId = String(req.params.id);
    const output = await pluginManager.executeAction(pluginId, String(req.params.action), body);
    if (typeof body.agentId === 'string' && typeof body.instanceId === 'string') {
      pluginManager.publishPatch(body.agentId, pluginId, body.instanceId, output.data);
    } else if (typeof body.agentId === 'string') {
      pluginManager.publishOutput(body.agentId, output);
    }
    res.json({ output });
  } catch (error) {
    sendPluginError(res, error);
  }
});

export default router;
