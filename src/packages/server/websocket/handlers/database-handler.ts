/**
 * Database Handler
 * Handles database connection and query operations via WebSocket
 */

import { databaseService, buildingService } from '../../services/index.js';
import { createLogger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';
import type { DatabaseConnection } from '../../../shared/types.js';

const log = createLogger('DatabaseHandler');

/**
 * Get connection from building by connection ID
 */
function getConnection(buildingId: string, connectionId: string): DatabaseConnection | null {
  const building = buildingService.getBuilding(buildingId);
  if (!building || building.type !== 'database' || !building.database) {
    return null;
  }
  return building.database.connections.find(c => c.id === connectionId) || null;
}

/**
 * Handle test_database_connection message
 */
export async function handleTestDatabaseConnection(
  ctx: HandlerContext,
  payload: { buildingId: string; connectionId: string }
): Promise<void> {
  const { buildingId, connectionId } = payload;

  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    ctx.sendToClient({
      type: 'database_connection_result',
      payload: {
        buildingId,
        connectionId,
        success: false,
        error: 'Connection not found',
      },
    });
    return;
  }

  log.log(`Testing connection: ${connection.name} (${connection.engine})`);

  const result = await databaseService.testConnection(connection);

  ctx.sendToClient({
    type: 'database_connection_result',
    payload: {
      buildingId,
      connectionId,
      success: result.success,
      error: result.error,
      serverVersion: result.serverVersion,
    },
  });
}

/**
 * Handle list_databases message
 */
export async function handleListDatabases(
  ctx: HandlerContext,
  payload: { buildingId: string; connectionId: string }
): Promise<void> {
  const { buildingId, connectionId } = payload;

  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    ctx.sendError('Connection not found');
    return;
  }

  log.log(`Listing databases for connection: ${connection.name}`);

  try {
    const databases = await databaseService.listDatabases(connection);

    ctx.sendToClient({
      type: 'databases_list',
      payload: {
        buildingId,
        connectionId,
        databases,
      },
    });
  } catch (error) {
    ctx.sendError(`Failed to list databases: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handle list_tables message
 */
export async function handleListTables(
  ctx: HandlerContext,
  payload: { buildingId: string; connectionId: string; database: string }
): Promise<void> {
  const { buildingId, connectionId, database } = payload;

  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    ctx.sendError('Connection not found');
    return;
  }

  log.log(`Listing tables for database: ${database}`);

  try {
    const tables = await databaseService.listTables(connection, database);

    ctx.sendToClient({
      type: 'tables_list',
      payload: {
        buildingId,
        connectionId,
        database,
        tables,
      },
    });
  } catch (error) {
    ctx.sendError(`Failed to list tables: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handle get_table_schema message
 */
export async function handleGetTableSchema(
  ctx: HandlerContext,
  payload: { buildingId: string; connectionId: string; database: string; table: string }
): Promise<void> {
  const { buildingId, connectionId, database, table } = payload;

  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    ctx.sendError('Connection not found');
    return;
  }

  log.log(`Getting schema for table: ${database}.${table}`);

  try {
    const schema = await databaseService.getTableSchema(connection, database, table);

    ctx.sendToClient({
      type: 'table_schema',
      payload: {
        buildingId,
        connectionId,
        database,
        table,
        columns: schema.columns,
        indexes: schema.indexes,
        foreignKeys: schema.foreignKeys,
      },
    });
  } catch (error) {
    ctx.sendError(`Failed to get table schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handle execute_query message
 */
export async function handleExecuteQuery(
  ctx: HandlerContext,
  payload: { buildingId: string; connectionId: string; database: string; query: string; limit?: number; silent?: boolean; requestId?: string }
): Promise<void> {
  const { buildingId, connectionId, database, query, limit = 1000, silent = false, requestId } = payload;

  const connection = getConnection(buildingId, connectionId);
  if (!connection) {
    ctx.sendError('Connection not found');
    return;
  }

  const isSilent = silent === true;
  log.log(`Executing query on ${connection.name}/${database}: ${query.substring(0, 100)}...${isSilent ? ' (SILENT MODE)' : ''}`);

  try {
    const result = await databaseService.executeQuery(connection, database, query, limit);
    const metric = result.affectedRows ?? result.rowCount ?? 0;
    const metricLabel = result.affectedRows !== undefined ? 'affectedRows' : 'rowCount';
    const isSuccess = result.status === 'success';
    log.log(
      `Query execution complete status=${result.status} duration=${result.duration}ms ${metricLabel}=${metric}${isSilent ? ' (result not sent to UI)' : ''}`
    );

    // Always add to history (even for silent queries)
    databaseService.addToHistory(buildingId, result);

    // If silent mode, don't send result back to UI
    if (isSilent) {
      if (!isSuccess) {
        log.warn(`Silent execution failed: ${result.error ?? 'Unknown error'}`);
      }
      ctx.sendToClient({
        type: 'silent_query_result',
        payload: {
          buildingId,
          query,
          requestId,
          success: isSuccess,
          affectedRows: isSuccess ? result.affectedRows : undefined,
          error: !isSuccess ? (result.error ?? 'Unknown error') : undefined,
        },
      });
      log.log(`Silent execution completed - sent silent_query_result status=${isSuccess ? 'success' : 'error'}`);
      return;
    }

    // Send result
    ctx.sendToClient({
      type: 'query_result',
      payload: {
        buildingId,
        result,
      },
    });

    // Send updated history
    const history = databaseService.getHistory(buildingId);
    ctx.sendToClient({
      type: 'query_history_update',
      payload: {
        buildingId,
        history,
      },
    });
  } catch (error) {
    log.error(`Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    if (isSilent) {
      ctx.sendToClient({
        type: 'silent_query_result',
        payload: {
          buildingId,
          query,
          requestId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    } else {
      ctx.sendError(`Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Handle request_query_history message
 */
export function handleRequestQueryHistory(
  ctx: HandlerContext,
  payload: { buildingId: string; limit?: number }
): void {
  const { buildingId, limit = 100 } = payload;

  const history = databaseService.getHistory(buildingId, limit);

  ctx.sendToClient({
    type: 'query_history_update',
    payload: {
      buildingId,
      history,
    },
  });
}

/**
 * Handle toggle_query_favorite message
 */
export function handleToggleQueryFavorite(
  ctx: HandlerContext,
  payload: { buildingId: string; queryId: string }
): void {
  const { buildingId, queryId } = payload;

  databaseService.toggleFavorite(buildingId, queryId);

  // Send updated history
  const history = databaseService.getHistory(buildingId);
  ctx.sendToClient({
    type: 'query_history_update',
    payload: {
      buildingId,
      history,
    },
  });
}

/**
 * Handle delete_query_history message
 */
export function handleDeleteQueryHistory(
  ctx: HandlerContext,
  payload: { buildingId: string; queryId: string }
): void {
  const { buildingId, queryId } = payload;

  databaseService.deleteFromHistory(buildingId, queryId);

  // Send updated history
  const history = databaseService.getHistory(buildingId);
  ctx.sendToClient({
    type: 'query_history_update',
    payload: {
      buildingId,
      history,
    },
  });
}

/**
 * Handle clear_query_history message
 */
export function handleClearQueryHistory(
  ctx: HandlerContext,
  payload: { buildingId: string }
): void {
  const { buildingId } = payload;

  databaseService.clearHistory(buildingId);

  ctx.sendToClient({
    type: 'query_history_update',
    payload: {
      buildingId,
      history: [],
    },
  });
}
