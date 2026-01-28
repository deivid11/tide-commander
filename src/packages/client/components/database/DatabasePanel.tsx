/**
 * DatabasePanel
 *
 * Main panel for database building type - includes query editor, results view,
 * connection management, and query history.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { Building, DatabaseConnection, QueryResult } from '../../../shared/types';
import { store, useDatabaseState, useQueryResults, useQueryHistory, useExecutingQuery } from '../../store';
import { DatabaseSidebar } from './DatabaseSidebar';
import { QueryEditor } from './QueryEditor';
import { ResultsTable } from './ResultsTable';
import { QueryHistoryPanel } from './QueryHistoryPanel';
import './DatabasePanel.scss';

interface DatabasePanelProps {
  building: Building;
  onClose: () => void;
}

// LocalStorage keys
const getStorageKey = (buildingId: string) => `db-panel-${buildingId}`;

interface StoredDbState {
  connectionId?: string;
  database?: string;
  lastQuery?: string;
}

function loadStoredState(buildingId: string): StoredDbState {
  try {
    const stored = localStorage.getItem(getStorageKey(buildingId));
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveStoredState(buildingId: string, state: StoredDbState): void {
  try {
    localStorage.setItem(getStorageKey(buildingId), JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

export const DatabasePanel: React.FC<DatabasePanelProps> = ({ building, onClose }) => {
  const dbState = useDatabaseState(building.id);
  const queryResults = useQueryResults(building.id);
  const queryHistory = useQueryHistory(building.id);
  const isExecuting = useExecutingQuery(building.id);

  // Load stored state on mount
  const storedState = useRef(loadStoredState(building.id));

  const [query, setQuery] = useState(storedState.current.lastQuery ?? '');
  const [activeTab, setActiveTab] = useState<'results' | 'history'>('results');
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Get current connection and database
  const connections = building.database?.connections ?? [];

  // Use stored state for initial values, then fall back to defaults
  const activeConnectionId = dbState.activeConnectionId
    ?? storedState.current.connectionId
    ?? building.database?.activeConnectionId
    ?? connections[0]?.id;
  const activeDatabase = dbState.activeDatabase
    ?? storedState.current.database
    ?? building.database?.activeDatabase;
  const activeConnection = connections.find(c => c.id === activeConnectionId);

  // Initialize connection/database from stored state on mount
  useEffect(() => {
    if (!initialized && connections.length > 0) {
      const stored = storedState.current;

      // Set active connection from storage if valid
      if (stored.connectionId && connections.some(c => c.id === stored.connectionId)) {
        store.setActiveConnection(building.id, stored.connectionId);
        store.listDatabases(building.id, stored.connectionId);

        // Set active database from storage
        if (stored.database) {
          store.setActiveDatabase(building.id, stored.database);
          store.listTables(building.id, stored.connectionId, stored.database);
        }
      }

      setInitialized(true);
    }
  }, [building.id, connections, initialized]);

  // Load query history on mount
  useEffect(() => {
    store.requestQueryHistory(building.id);
  }, [building.id]);

  // Save connection/database to localStorage when they change
  useEffect(() => {
    if (initialized && activeConnectionId) {
      saveStoredState(building.id, {
        connectionId: activeConnectionId,
        database: activeDatabase,
        lastQuery: query,
      });
    }
  }, [building.id, activeConnectionId, activeDatabase, query, initialized]);

  // Execute query handler
  const handleExecuteQuery = useCallback(() => {
    if (!activeConnectionId || !activeDatabase || !query.trim() || isExecuting) return;

    store.executeQuery(building.id, activeConnectionId, activeDatabase, query.trim());
  }, [building.id, activeConnectionId, activeDatabase, query, isExecuting]);

  // Load query from history
  const handleLoadFromHistory = useCallback((historyQuery: string) => {
    setQuery(historyQuery);
    setActiveTab('results');
  }, []);

  // Connection change handler
  const handleConnectionChange = useCallback((connectionId: string) => {
    store.setActiveConnection(building.id, connectionId);
    // List databases for the new connection
    store.listDatabases(building.id, connectionId);
  }, [building.id]);

  // Database change handler
  const handleDatabaseChange = useCallback((database: string) => {
    store.setActiveDatabase(building.id, database);
    // List tables for the new database
    if (activeConnectionId) {
      store.listTables(building.id, activeConnectionId, database);
    }
  }, [building.id, activeConnectionId]);

  // Current result
  const currentResult = queryResults[selectedResultIndex];

  // If no connections configured, show setup message
  if (connections.length === 0) {
    return (
      <div className="database-panel">
        <div className="database-panel__header">
          <div className="database-panel__title">
            <span className="database-panel__icon">🗄️</span>
            <span className="database-panel__name">{building.name}</span>
          </div>
          <button className="database-panel__close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="database-panel__body">
          <div className="database-panel__no-connections">
            <div className="database-panel__no-connections-icon">🔌</div>
            <h3>No Database Connections</h3>
            <p>This building doesn't have any database connections configured yet.</p>
            <p>To get started:</p>
            <ol>
              <li>Close this panel</li>
              <li>Click on the building and select <strong>Settings</strong></li>
              <li>Add a database connection (MySQL or PostgreSQL)</li>
              <li>Save and open this panel again</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="database-panel">
      <div className="database-panel__header">
        <div className="database-panel__title">
          <span className="database-panel__icon">
            {activeConnection?.engine === 'mysql' ? '🐬' : '🐘'}
          </span>
          <span className="database-panel__name">{building.name}</span>
          {activeConnection && (
            <span className="database-panel__connection-info">
              {activeConnection.name} / {activeDatabase || 'No database selected'}
            </span>
          )}
        </div>
        <button className="database-panel__close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="database-panel__body">
        {/* Sidebar - Connection & Table Browser */}
        <DatabaseSidebar
          building={building}
          connections={connections}
          activeConnectionId={activeConnectionId}
          activeDatabase={activeDatabase}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onConnectionChange={handleConnectionChange}
          onDatabaseChange={handleDatabaseChange}
          onInsertTable={(tableName) => setQuery(prev => prev + ` ${tableName}`)}
        />

        {/* Main Content */}
        <div className="database-panel__main">
          {/* Query Editor */}
          <QueryEditor
            query={query}
            onChange={setQuery}
            onExecute={handleExecuteQuery}
            isExecuting={isExecuting}
            disabled={!activeConnectionId || !activeDatabase}
          />

          {/* Results/History Tabs */}
          <div className="database-panel__tabs">
            <button
              className={`database-panel__tab ${activeTab === 'results' ? 'database-panel__tab--active' : ''}`}
              onClick={() => setActiveTab('results')}
            >
              Results
              {queryResults.length > 0 && (
                <span className="database-panel__tab-badge">{queryResults.length}</span>
              )}
            </button>
            <button
              className={`database-panel__tab ${activeTab === 'history' ? 'database-panel__tab--active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              History
              {queryHistory.length > 0 && (
                <span className="database-panel__tab-badge">{queryHistory.length}</span>
              )}
            </button>

            {/* Result Navigation */}
            {activeTab === 'results' && queryResults.length > 1 && (
              <div className="database-panel__result-nav">
                <button
                  disabled={selectedResultIndex >= queryResults.length - 1}
                  onClick={() => setSelectedResultIndex(i => i + 1)}
                >
                  &larr; Older
                </button>
                <span>
                  {selectedResultIndex + 1} / {queryResults.length}
                </span>
                <button
                  disabled={selectedResultIndex <= 0}
                  onClick={() => setSelectedResultIndex(i => i - 1)}
                >
                  Newer &rarr;
                </button>
              </div>
            )}
          </div>

          {/* Tab Content */}
          <div className="database-panel__tab-content">
            {activeTab === 'results' ? (
              currentResult ? (
                <ResultsTable
                  result={currentResult}
                  buildingId={building.id}
                />
              ) : (
                <div className="database-panel__empty">
                  <p>No query results yet.</p>
                  <p>Select a database and run a query to see results.</p>
                </div>
              )
            ) : (
              <QueryHistoryPanel
                buildingId={building.id}
                history={queryHistory}
                onLoadQuery={handleLoadFromHistory}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
