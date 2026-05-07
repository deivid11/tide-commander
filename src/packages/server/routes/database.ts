/**
 * Database Routes
 * REST API endpoints for exploring database buildings.
 *
 * Mirrors the WebSocket database handler operations (test/list/schema/query)
 * over plain HTTP so curl-based agent skills can use them.
 */

import { Router, Request, Response } from 'express';
import { databaseService, buildingService } from '../services/index.js';
import { createLogger } from '../utils/logger.js';
import type { Building, DatabaseConnection } from '../../shared/types.js';

const log = createLogger('DatabaseRoutes');
const router = Router();

const MAX_QUERY_LIMIT = 10000;
const DEFAULT_QUERY_LIMIT = 1000;

function getDatabaseBuilding(buildingId: string): Building | null {
  const building = buildingService.getBuilding(buildingId);
  if (!building || building.type !== 'database' || !building.database) {
    return null;
  }
  return building;
}

function getConnection(buildingId: string, connectionId: string): DatabaseConnection | null {
  const building = getDatabaseBuilding(buildingId);
  if (!building) return null;
  return building.database!.connections.find(c => c.id === connectionId) || null;
}

function redactConnection(c: DatabaseConnection): Omit<DatabaseConnection, 'password' | 'ssh' | 'sslConfig'> & {
  hasPassword: boolean;
  ssh?: { enabled: boolean; host: string; port: number; username: string };
} {
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
      ? { enabled: c.ssh.enabled, host: c.ssh.host, port: c.ssh.port, username: c.ssh.username }
      : undefined,
  };
}

// GET /api/database/buildings - list all database buildings (redacted)
router.get('/buildings', (_req: Request, res: Response) => {
  const buildings = buildingService.getBuildings()
    .filter(b => b.type === 'database' && b.database)
    .map(b => ({
      id: b.id,
      name: b.name,
      activeConnectionId: b.database!.activeConnectionId,
      activeDatabase: b.database!.activeDatabase,
      connections: b.database!.connections.map(redactConnection),
    }));
  res.json({ buildings });
});

// GET /api/database/buildings/:buildingId - one database building (redacted)
router.get('/buildings/:buildingId', (req: Request, res: Response) => {
  const building = getDatabaseBuilding(String(req.params.buildingId));
  if (!building) {
    res.status(404).json({ error: 'Database building not found' });
    return;
  }
  res.json({
    id: building.id,
    name: building.name,
    activeConnectionId: building.database!.activeConnectionId,
    activeDatabase: building.database!.activeDatabase,
    connections: building.database!.connections.map(redactConnection),
  });
});

// POST /api/database/buildings/:buildingId/connections/:connectionId/test
router.post('/buildings/:buildingId/connections/:connectionId/test', async (req: Request, res: Response) => {
  const buildingId = String(req.params.buildingId);
  const connectionId = String(req.params.connectionId);
  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }
  try {
    const result = await databaseService.testConnection(connection);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`testConnection failed for ${buildingId}/${connectionId}:`, message);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/database/buildings/:buildingId/connections/:connectionId/databases
router.get('/buildings/:buildingId/connections/:connectionId/databases', async (req: Request, res: Response) => {
  const buildingId = String(req.params.buildingId);
  const connectionId = String(req.params.connectionId);
  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }
  try {
    const databases = await databaseService.listDatabases(connection);
    res.json({ databases });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`listDatabases failed for ${buildingId}/${connectionId}:`, message);
    res.status(500).json({ error: message });
  }
});

// GET /api/database/buildings/:buildingId/connections/:connectionId/databases/:database/tables
router.get('/buildings/:buildingId/connections/:connectionId/databases/:database/tables', async (req: Request, res: Response) => {
  const buildingId = String(req.params.buildingId);
  const connectionId = String(req.params.connectionId);
  const database = String(req.params.database);
  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }
  try {
    const tables = await databaseService.listTables(connection, database);
    res.json({ database, tables });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`listTables failed for ${buildingId}/${connectionId}/${database}:`, message);
    res.status(500).json({ error: message });
  }
});

// GET /api/database/buildings/:buildingId/connections/:connectionId/databases/:database/tables/:table/columns
// Lean variant of /schema — returns only the column list (no indexes / foreign keys).
router.get('/buildings/:buildingId/connections/:connectionId/databases/:database/tables/:table/columns', async (req: Request, res: Response) => {
  const buildingId = String(req.params.buildingId);
  const connectionId = String(req.params.connectionId);
  const database = String(req.params.database);
  const table = String(req.params.table);
  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }
  try {
    const { columns } = await databaseService.getTableSchema(connection, database, table);
    res.json({ database, table, columns });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`describe (columns) failed for ${buildingId}/${connectionId}/${database}/${table}:`, message);
    res.status(500).json({ error: message });
  }
});

// GET /api/database/buildings/:buildingId/connections/:connectionId/databases/:database/tables/:table/schema
router.get('/buildings/:buildingId/connections/:connectionId/databases/:database/tables/:table/schema', async (req: Request, res: Response) => {
  const buildingId = String(req.params.buildingId);
  const connectionId = String(req.params.connectionId);
  const database = String(req.params.database);
  const table = String(req.params.table);
  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }
  try {
    const schema = await databaseService.getTableSchema(connection, database, table);
    res.json({ database, table, ...schema });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`getTableSchema failed for ${buildingId}/${connectionId}/${database}/${table}:`, message);
    res.status(500).json({ error: message });
  }
});

// POST /api/database/buildings/:buildingId/connections/:connectionId/query
// Body: { database: string, query: string, limit?: number, recordHistory?: boolean }
router.post('/buildings/:buildingId/connections/:connectionId/query', async (req: Request, res: Response) => {
  const buildingId = String(req.params.buildingId);
  const connectionId = String(req.params.connectionId);
  const { database, query, limit, recordHistory } = req.body ?? {};

  if (typeof database !== 'string' || !database) {
    res.status(400).json({ error: 'Body field "database" is required' });
    return;
  }
  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'Body field "query" is required' });
    return;
  }

  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

  const effectiveLimit = Math.min(
    Math.max(1, Number.isFinite(limit) ? Number(limit) : DEFAULT_QUERY_LIMIT),
    MAX_QUERY_LIMIT,
  );

  try {
    const result = await databaseService.executeQuery(connection, database, query, effectiveLimit);
    if (recordHistory && result.status === 'success') {
      databaseService.addToHistory(buildingId, result);
    }
    const status = result.status === 'success' ? 200 : 400;
    res.status(status).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`executeQuery failed for ${buildingId}/${connectionId}:`, message);
    res.status(500).json({ status: 'error', error: message });
  }
});

// GET /api/database/buildings/:buildingId/history?limit=100
router.get('/buildings/:buildingId/history', (req: Request, res: Response) => {
  const buildingId = String(req.params.buildingId);
  const building = getDatabaseBuilding(buildingId);
  if (!building) {
    res.status(404).json({ error: 'Database building not found' });
    return;
  }
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
  const history = databaseService.getHistory(buildingId, limit);
  res.json({ history });
});

export default router;
