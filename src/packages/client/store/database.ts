/**
 * Database Store Actions
 *
 * Handles database building state: connections, queries, results, history.
 */

import type { ClientMessage, QueryResult, QueryHistoryEntry, TableInfo, TableColumn, TableIndex, ForeignKey } from '../../shared/types';
import type { StoreState, DatabaseBuildingState } from './types';

// Default empty database state
function createEmptyDatabaseState(): DatabaseBuildingState {
  return {
    connectionStatus: new Map(),
    databases: new Map(),
    tables: new Map(),
    tableSchemas: new Map(),
    queryResults: [],
    queryHistory: [],
    executingQuery: false,
    activeConnectionId: null,
    activeDatabase: null,
    lastSilentQueryResult: null,
  };
}

export interface DatabaseActions {
  // Connection management
  testDatabaseConnection(buildingId: string, connectionId: string): void;
  setConnectionStatus(buildingId: string, connectionId: string, status: { connected: boolean; error?: string; serverVersion?: string }): void;

  // Database/Table listing
  listDatabases(buildingId: string, connectionId: string): void;
  setDatabases(buildingId: string, connectionId: string, databases: string[]): void;
  listTables(buildingId: string, connectionId: string, database: string): void;
  setTables(buildingId: string, connectionId: string, database: string, tables: TableInfo[]): void;

  // Schema
  getTableSchema(buildingId: string, connectionId: string, database: string, table: string): void;
  setTableSchema(buildingId: string, connectionId: string, database: string, table: string, schema: { columns: TableColumn[]; indexes: TableIndex[]; foreignKeys: ForeignKey[] }): void;

  // Query execution
  executeQuery(buildingId: string, connectionId: string, database: string, query: string, limit?: number): void;
  executeSilentQuery(buildingId: string, connectionId: string, database: string, query: string, requestId?: string): void;
  setSilentQueryResult(buildingId: string, result: { query: string; requestId?: string; success: boolean; affectedRows?: number; error?: string }): void;
  setQueryResult(buildingId: string, result: QueryResult): void;
  setExecutingQuery(buildingId: string, executing: boolean): void;

  // Query history
  requestQueryHistory(buildingId: string, limit?: number): void;
  setQueryHistory(buildingId: string, history: QueryHistoryEntry[]): void;
  toggleQueryFavorite(buildingId: string, queryId: string): void;
  deleteQueryFromHistory(buildingId: string, queryId: string): void;
  clearQueryHistory(buildingId: string): void;

  // Active connection/database
  setActiveConnection(buildingId: string, connectionId: string | null): void;
  setActiveDatabase(buildingId: string, database: string | null): void;

  // State accessors
  getDatabaseState(buildingId: string): DatabaseBuildingState;
  clearDatabaseState(buildingId: string): void;
}

export function createDatabaseActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): DatabaseActions {
  // Helper to ensure database state exists for a building
  const ensureDatabaseState = (buildingId: string): void => {
    const state = getState();
    if (!state.databaseState.has(buildingId)) {
      setState((s) => {
        const newDatabaseState = new Map(s.databaseState);
        newDatabaseState.set(buildingId, createEmptyDatabaseState());
        s.databaseState = newDatabaseState;
      });
    }
  };

  const actions: DatabaseActions = {
    // ========================================================================
    // Connection Management
    // ========================================================================

    testDatabaseConnection(buildingId: string, connectionId: string): void {
      getSendMessage()?.({
        type: 'test_database_connection',
        payload: { buildingId, connectionId },
      });
    },

    setConnectionStatus(buildingId: string, connectionId: string, status: { connected: boolean; error?: string; serverVersion?: string }): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newConnectionStatus = new Map(dbState.connectionStatus);
          newConnectionStatus.set(connectionId, status);
          const newDbState = { ...dbState, connectionStatus: newConnectionStatus };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    // ========================================================================
    // Database/Table Listing
    // ========================================================================

    listDatabases(buildingId: string, connectionId: string): void {
      getSendMessage()?.({
        type: 'list_databases',
        payload: { buildingId, connectionId },
      });
    },

    setDatabases(buildingId: string, connectionId: string, databases: string[]): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newDatabases = new Map(dbState.databases);
          newDatabases.set(connectionId, databases);
          const newDbState = { ...dbState, databases: newDatabases };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    listTables(buildingId: string, connectionId: string, database: string): void {
      getSendMessage()?.({
        type: 'list_tables',
        payload: { buildingId, connectionId, database },
      });
    },

    setTables(buildingId: string, connectionId: string, database: string, tables: TableInfo[]): void {
      ensureDatabaseState(buildingId);
      const key = `${connectionId}:${database}`;
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newTables = new Map(dbState.tables);
          newTables.set(key, tables);
          const newDbState = { ...dbState, tables: newTables };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    // ========================================================================
    // Schema
    // ========================================================================

    getTableSchema(buildingId: string, connectionId: string, database: string, table: string): void {
      getSendMessage()?.({
        type: 'get_table_schema',
        payload: { buildingId, connectionId, database, table },
      });
    },

    setTableSchema(buildingId: string, connectionId: string, database: string, table: string, schema: { columns: TableColumn[]; indexes: TableIndex[]; foreignKeys: ForeignKey[] }): void {
      ensureDatabaseState(buildingId);
      const key = `${connectionId}:${database}:${table}`;
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newSchemas = new Map(dbState.tableSchemas);
          newSchemas.set(key, schema);
          const newDbState = { ...dbState, tableSchemas: newSchemas };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    // ========================================================================
    // Query Execution
    // ========================================================================

    executeQuery(buildingId: string, connectionId: string, database: string, query: string, limit: number = 1000): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newDbState = { ...dbState, executingQuery: true };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();

      getSendMessage()?.({
        type: 'execute_query',
        payload: { buildingId, connectionId, database, query, limit },
      });
    },

    executeSilentQuery(buildingId: string, connectionId: string, database: string, query: string, requestId?: string): void {
      // Execute query without updating UI - no query result shown
      getSendMessage()?.({
        type: 'execute_query',
        payload: { buildingId, connectionId, database, query, limit: 0, silent: true, requestId },
      });
    },

    setSilentQueryResult(buildingId: string, result: { query: string; requestId?: string; success: boolean; affectedRows?: number; error?: string }): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newDbState = {
            ...dbState,
            lastSilentQueryResult: {
              ...result,
              timestamp: Date.now(),
            },
          };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    setQueryResult(buildingId: string, result: QueryResult): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          // Add new result to the front, keep last 20 results
          const newResults = [result, ...dbState.queryResults].slice(0, 20);
          const newDbState = { ...dbState, queryResults: newResults, executingQuery: false };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    setExecutingQuery(buildingId: string, executing: boolean): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newDbState = { ...dbState, executingQuery: executing };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    // ========================================================================
    // Query History
    // ========================================================================

    requestQueryHistory(buildingId: string, limit: number = 100): void {
      getSendMessage()?.({
        type: 'request_query_history',
        payload: { buildingId, limit },
      });
    },

    setQueryHistory(buildingId: string, history: QueryHistoryEntry[]): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newDbState = { ...dbState, queryHistory: history };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    toggleQueryFavorite(buildingId: string, queryId: string): void {
      getSendMessage()?.({
        type: 'toggle_query_favorite',
        payload: { buildingId, queryId },
      });
    },

    deleteQueryFromHistory(buildingId: string, queryId: string): void {
      getSendMessage()?.({
        type: 'delete_query_history',
        payload: { buildingId, queryId },
      });
    },

    clearQueryHistory(buildingId: string): void {
      getSendMessage()?.({
        type: 'clear_query_history',
        payload: { buildingId },
      });
    },

    // ========================================================================
    // Active Connection/Database
    // ========================================================================

    setActiveConnection(buildingId: string, connectionId: string | null): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newDbState = { ...dbState, activeConnectionId: connectionId, activeDatabase: null };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    setActiveDatabase(buildingId: string, database: string | null): void {
      ensureDatabaseState(buildingId);
      setState((state) => {
        const dbState = state.databaseState.get(buildingId);
        if (dbState) {
          const newDbState = { ...dbState, activeDatabase: database };
          const newDatabaseState = new Map(state.databaseState);
          newDatabaseState.set(buildingId, newDbState);
          state.databaseState = newDatabaseState;
        }
      });
      notify();
    },

    // ========================================================================
    // State Accessors
    // ========================================================================

    getDatabaseState(buildingId: string): DatabaseBuildingState {
      const state = getState();
      return state.databaseState.get(buildingId) || createEmptyDatabaseState();
    },

    clearDatabaseState(buildingId: string): void {
      setState((state) => {
        const newDatabaseState = new Map(state.databaseState);
        newDatabaseState.delete(buildingId);
        state.databaseState = newDatabaseState;
      });
      notify();
    },
  };

  return actions;
}
