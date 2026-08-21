import { Router, type Request, type Response } from 'express';
import { pluginManager, PluginRuntimeError } from '../plugins/index.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const log = createLogger('PluginRoutes');

function bodyRecord(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
}

function sendPluginError(res: Response, error: unknown): void {
  if (error instanceof PluginRuntimeError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  log.error('Plugin request failed:', error);
  res.status(500).json({ error: message, code: 'PLUGIN_INTERNAL_ERROR' });
}

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
    if (typeof body.agentId === 'string') pluginManager.publishOutput(body.agentId, output);
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
