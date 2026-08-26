/**
 * Building Routes
 * REST API endpoints for building lifecycle and control.
 *
 * This is the canonical surface for agents managing buildings. The
 * underlying buildingService handles validation, ID generation,
 * credential encryption, broadcast events, and PM2/Docker/Terminal
 * reconciliation.
 *
 * Routes:
 *   GET    /api/buildings                      - List buildings (secrets redacted)
 *   GET    /api/buildings/:id                  - Get one building (secrets redacted)
 *   POST   /api/buildings                      - Create a building
 *   PATCH  /api/buildings/:id                  - Partial update
 *   DELETE /api/buildings/:id[?cleanup=false]  - Delete (default: cleanup runtime artifacts)
 *
 *   POST   /api/buildings/:id/command          - { command } start|stop|restart|healthCheck|logs|delete
 *   GET    /api/buildings/:id/logs?lines=200&service=foo - Snapshot logs (PM2/Docker/custom)
 *   POST   /api/buildings/:id/sync-status      - Force PM2/Docker status refresh
 *   POST   /api/buildings/:id/subordinates     - Assign subordinates (boss only)
 *
 *   POST   /api/buildings/boss/:id/command     - { command } start_all|stop_all|restart_all
 *
 *   GET    /api/buildings/docker/containers    - List adoptable containers + compose projects
 */

import { Router, Request, Response } from 'express';
import { buildingService } from '../services/index.js';
import * as dockerService from '../services/docker-service.js';
import * as terminalService from '../services/terminal-service.js';
import { broadcast } from '../websocket/handler.js';
import { createLogger } from '../utils/logger.js';
import type {
  Building,
  DatabaseConnection,
  ServerMessage,
} from '../../shared/types.js';
import type {
  BuildingCommand,
  BossBuildingCommand,
} from '../services/building-service.js';

const log = createLogger('BuildingRoutes');
const router = Router();

let broadcastFn: ((message: ServerMessage) => void) | null = null;

/**
 * Wire the WebSocket broadcaster. Called from the websocket handler at startup.
 * Falls back to the directly-imported broadcast() at call time if not wired,
 * which lets these routes work in tests that don't initialise the WS layer.
 */
export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

function emit(message: ServerMessage): void {
  if (broadcastFn) {
    broadcastFn(message);
  } else {
    // In production setBroadcast() is always called from the WS handler init;
    // this fallback keeps unit tests working without the full WS bootstrap.
    try {
      broadcast(message);
    } catch {
      // No WS server up — broadcast is best-effort.
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_COMMANDS: ReadonlySet<BuildingCommand> = new Set<BuildingCommand>([
  'start', 'stop', 'restart', 'healthCheck', 'logs', 'delete',
]);

const VALID_BOSS_COMMANDS: ReadonlySet<BossBuildingCommand> = new Set<BossBuildingCommand>([
  'start_all', 'stop_all', 'restart_all',
]);

function redactDatabaseConnection(c: DatabaseConnection) {
  return {
    id: c.id,
    name: c.name,
    engine: c.engine,
    host: c.host,
    port: c.port,
    username: c.username,
    database: c.database,
    filepath: c.filepath,
    ssl: c.ssl,
    hasPassword: Boolean(c.password),
    ssh: c.ssh
      ? {
          enabled: c.ssh.enabled,
          host: c.ssh.host,
          port: c.ssh.port,
          username: c.ssh.username,
          authMethod: c.ssh.authMethod,
          hasPassword: Boolean(c.ssh.password),
          hasPrivateKey: Boolean(c.ssh.privateKey || c.ssh.privateKeyPath),
        }
      : undefined,
  };
}

/**
 * Strip secret fields before returning a building over HTTP.
 * Plaintext credentials may sit in memory after the agent creates a building,
 * but they must never come back out of GET responses.
 */
function redactBuilding(building: Building) {
  const out: Record<string, unknown> = { ...building };
  if (building.database?.connections) {
    out.database = {
      ...building.database,
      connections: building.database.connections.map(redactDatabaseConnection),
    };
  }
  return out;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

// GET /api/buildings — list all buildings (redacted)
router.get('/', (_req: Request, res: Response) => {
  const buildings = buildingService.getBuildings().map(redactBuilding);
  res.json({ buildings });
});

// GET /api/buildings/docker/containers — adoptable containers + compose projects
// (Must come before /:id so the docker prefix doesn't match as an id.)
router.get('/docker/containers', async (_req: Request, res: Response) => {
  try {
    const [containers, composeProjects] = await Promise.all([
      dockerService.listAllContainers(),
      dockerService.listComposeProjects(),
    ]);
    res.json({ containers, composeProjects });
  } catch (err: any) {
    log.error('Failed to list Docker resources:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/buildings/boss/:id/command — body { command }
// Must come before /:id/command so 'boss' isn't matched as an id.
router.post('/boss/:id/command', async (req: Request<{ id: string }>, res: Response) => {
  const command = req.body?.command as BossBuildingCommand | undefined;
  if (!command || !VALID_BOSS_COMMANDS.has(command)) {
    res.status(400).json({
      error: `command must be one of: ${[...VALID_BOSS_COMMANDS].join(', ')}`,
    });
    return;
  }

  try {
    const result = await buildingService.executeBossBuildingCommand(
      req.params.id,
      command,
      emit,
    );
    res.json(result);
  } catch (err: any) {
    log.error(`Boss command failed for ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/buildings/:id — fetch one (redacted)
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const building = buildingService.getBuilding(req.params.id);
  if (!building) {
    res.status(404).json({ error: `Building not found: ${req.params.id}` });
    return;
  }
  res.json(redactBuilding(building));
});

// POST /api/buildings — create
router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await buildingService.createBuilding(req.body, emit);
    if (!result.ok) {
      res.status(result.status).json({ error: 'Validation failed', errors: result.errors });
      return;
    }
    res.status(201).json(redactBuilding(result.building));
  } catch (err: any) {
    log.error('Failed to create building:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/buildings/:id — partial update
router.patch('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const result = await buildingService.updateBuilding(req.params.id, req.body, emit);
    if (!result.ok) {
      res.status(result.status).json({
        error: result.status === 404 ? 'Not found' : 'Validation failed',
        errors: result.errors,
      });
      return;
    }
    res.json(redactBuilding(result.building));
  } catch (err: any) {
    log.error(`Failed to update building ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/buildings/:id?cleanup=false — delete (optionally skip runtime cleanup)
router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const cleanup = req.query.cleanup !== 'false';
    const result = await buildingService.deleteBuilding(req.params.id, emit, { cleanup });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ deleted: true });
  } catch (err: any) {
    log.error(`Failed to delete building ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Controls ─────────────────────────────────────────────────────────────────

// POST /api/buildings/:id/execute-slash-command — run the configured plugin
// command and return its structured output for the browser modal.
router.post('/:id/execute-slash-command', async (req: Request<{ id: string }>, res: Response) => {
  const building = buildingService.getBuilding(req.params.id);
  if (!building) {
    res.status(404).json({ error: `Building not found: ${req.params.id}` });
    return;
  }
  if (building.type !== 'slash-command' || !building.slashCommand?.command) {
    res.status(409).json({ error: 'Building is not configured as a slash command' });
    return;
  }
  try {
    const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId : '';
    const { pluginManager } = await import('../plugins/index.js');
    const output = await pluginManager.executeSlashCommand(agentId, building.slashCommand.command);
    res.json({ output });
  } catch (error) {
    const pluginError = error as { statusCode?: unknown; code?: unknown; message?: unknown };
    if (typeof pluginError.statusCode === 'number') {
      res.status(pluginError.statusCode).json({
        error: typeof pluginError.message === 'string' ? pluginError.message : 'Plugin command failed',
        ...(typeof pluginError.code === 'string' ? { code: pluginError.code } : {}),
      });
      return;
    }
    log.error(`Slash command failed for building ${building.id}:`, error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/buildings/:id/command — body { command }
router.post('/:id/command', async (req: Request<{ id: string }>, res: Response) => {
  const command = req.body?.command as BuildingCommand | undefined;
  if (!command || !VALID_COMMANDS.has(command)) {
    res.status(400).json({
      error: `command must be one of: ${[...VALID_COMMANDS].join(', ')}`,
    });
    return;
  }

  try {
    const result = await buildingService.executeCommand(req.params.id, command, emit);
    if (!result.success && result.error?.includes('not found')) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err: any) {
    log.error(`Command ${command} failed for ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/buildings/:id/logs?lines=200&service=foo — snapshot logs
router.get('/:id/logs', async (req: Request<{ id: string }>, res: Response) => {
  const lines = Number.parseInt(String(req.query.lines ?? '200'), 10);
  const service = typeof req.query.service === 'string' ? req.query.service : undefined;

  try {
    const result = await buildingService.getBuildingLogs(
      req.params.id,
      Number.isFinite(lines) && lines > 0 ? Math.min(lines, 5000) : 200,
      service,
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ source: result.source, logs: result.logs, lines: result.logs.split('\n').length });
  } catch (err: any) {
    log.error(`Logs fetch failed for ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/buildings/:id/sync-status — force PM2/Docker status refresh
router.post('/:id/sync-status', async (req: Request<{ id: string }>, res: Response) => {
  const building = buildingService.getBuilding(req.params.id);
  if (!building) {
    res.status(404).json({ error: `Building not found: ${req.params.id}` });
    return;
  }

  try {
    if (building.pm2?.enabled) {
      await buildingService.syncPM2Status(building.id, emit);
      const refreshed = buildingService.getBuilding(building.id);
      res.json({ source: 'pm2', status: refreshed?.status, pm2Status: refreshed?.pm2Status });
      return;
    }
    if (building.docker?.enabled) {
      await buildingService.syncDockerStatus(building.id, emit);
      const refreshed = buildingService.getBuilding(building.id);
      res.json({ source: 'docker', status: refreshed?.status, dockerStatus: refreshed?.dockerStatus });
      return;
    }
    if (building.terminal?.enabled) {
      const status = terminalService.getTerminalStatus(building);
      res.json({ source: 'terminal', status: status ? 'running' : 'stopped', terminalStatus: status });
      return;
    }
    res.json({ source: 'none', status: building.status });
  } catch (err: any) {
    log.error(`sync-status failed for ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/buildings/:id/subordinates — body { subordinateBuildingIds: string[] }
router.post('/:id/subordinates', async (req: Request<{ id: string }>, res: Response) => {
  const ids = req.body?.subordinateBuildingIds;
  if (!Array.isArray(ids) || ids.some((s: unknown) => typeof s !== 'string')) {
    res.status(400).json({ error: 'subordinateBuildingIds must be an array of strings' });
    return;
  }

  try {
    const result = await buildingService.assignSubordinates(req.params.id, ids, emit);
    if (!result.ok) {
      res.status(result.status).json({
        error: result.status === 404 ? 'Not found' : 'Invalid request',
        errors: result.errors,
      });
      return;
    }
    res.json(redactBuilding(result.building));
  } catch (err: any) {
    log.error(`assignSubordinates failed for ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
