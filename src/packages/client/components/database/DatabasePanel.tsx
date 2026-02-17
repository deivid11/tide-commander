/**
 * DatabasePanel
 *
 * Main panel for database building type - includes query editor, results view,
 * connection management, and query history.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Building } from '../../../shared/types';
import { store, useDatabaseState, useQueryResults, useQueryHistory, useExecutingQuery } from '../../store';
import { DatabaseSidebar } from './DatabaseSidebar';
import { QueryEditor } from './QueryEditor';
import { ResultsTable } from './ResultsTable';
import { QueryHistoryPanel } from './QueryHistoryPanel';
import { DatabaseTabs, type DatabaseTab } from './DatabaseTabs';
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
  openTabs?: Array<{ connectionId: string; database: string }>;
  activeTabId?: string;
  // Per-database queries: key is "connectionId:database", general is for no-db context
  queries?: Record<string, string>;
  generalQuery?: string;
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
  const { t } = useTranslation(['terminal', 'common']);
  const dbState = useDatabaseState(building.id);
  const queryResults = useQueryResults(building.id);
  const queryHistory = useQueryHistory(building.id);
  const isExecuting = useExecutingQuery(building.id);

  // Load stored state on mount
  const storedState = useRef(loadStoredState(building.id));
  const panelRef = useRef<HTMLDivElement>(null);

  // Get current connection and database
  const connections = building.database?.connections ?? [];

  // Helper to generate tab ID
  const generateTabId = (connectionId: string, database: string) => `${connectionId}:${database}`;

  // Helper to get query for a tab
  const getQueryForTab = (tabId: string | null) => {
    if (!tabId) return storedState.current.generalQuery ?? '';
    const stored = storedState.current.queries ?? {};
    return stored[tabId] ?? '';
  };

  const [activeTab, setActiveTab] = useState<'results' | 'history'>('results');
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Tab management
  const [openTabs, setOpenTabs] = useState<DatabaseTab[]>(() => {
    const stored = storedState.current.openTabs ?? [];
    return stored.map(tab => ({
      id: `${tab.connectionId}:${tab.database}`,
      connectionId: tab.connectionId,
      connectionName: connections.find(c => c.id === tab.connectionId)?.name ?? tab.connectionId,
      database: tab.database,
    }));
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(storedState.current.activeTabId ?? null);

  // Per-database query storage: key is tabId, value is query text
  const [queries, setQueries] = useState<Record<string, string>>(() => {
    const stored = storedState.current.queries ?? {};
    const _generalQuery = storedState.current.generalQuery ?? '';
    return stored;
  });

  // Current query based on active tab
  const [query, setQueryText] = useState(getQueryForTab(activeTabId));

  // Wrapper for setQuery that also updates queries map
  const setQuery = useCallback((value: string | ((prev: string) => string)) => {
    setQueryText(prev => {
      const newQuery = typeof value === 'function' ? value(prev) : value;

      // Update the queries map
      setQueries(prevQueries => {
        const updated = { ...prevQueries };
        if (activeTabId) {
          updated[activeTabId] = newQuery;
        }
        return updated;
      });

      return newQuery;
    });
  }, [activeTabId]);

  // Use stored state for initial values, then fall back to defaults
  const activeConnectionId = dbState.activeConnectionId
    ?? storedState.current.connectionId
    ?? building.database?.activeConnectionId
    ?? connections[0]?.id;
  const activeDatabase = dbState.activeDatabase
    ?? storedState.current.database
    ?? building.database?.activeDatabase;
  const activeConnection = connections.find(c => c.id === activeConnectionId);

  // Tab handlers
  const handleOpenTab = useCallback((connectionId: string, database: string) => {
    const tabId = generateTabId(connectionId, database);
    const connectionName = connections.find(c => c.id === connectionId)?.name ?? connectionId;

    setOpenTabs(prev => {
      // Check if tab already exists
      if (prev.some(t => t.id === tabId)) {
        return prev;
      }
      // Add new tab
      const newTab: DatabaseTab = {
        id: tabId,
        connectionId,
        connectionName,
        database,
      };
      return [...prev, newTab];
    });

    // Switch to the tab and load its query
    setActiveTabId(tabId);
    setQueryText(queries[tabId] ?? '');
    store.setActiveConnection(building.id, connectionId);
    store.setActiveDatabase(building.id, database);
  }, [building.id, connections, queries]);

  const handleCloseTab = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.filter(t => t.id !== tabId));

    // If closing active tab, switch to another
    if (activeTabId === tabId) {
      setOpenTabs(prev => {
        if (prev.length > 0) {
          const nextTab = prev[0];
          setActiveTabId(nextTab.id);
          setQueryText(queries[nextTab.id] ?? '');
          store.setActiveConnection(building.id, nextTab.connectionId);
          store.setActiveDatabase(building.id, nextTab.database);
        } else {
          setActiveTabId(null);
          setQueryText('');
        }
        return prev;
      });
    }
  }, [activeTabId, building.id, queries]);

  const handleSelectTab = useCallback((tab: DatabaseTab) => {
    setActiveTabId(tab.id);
    setQueryText(queries[tab.id] ?? '');
    store.setActiveConnection(building.id, tab.connectionId);
    store.setActiveDatabase(building.id, tab.database);
  }, [building.id, queries]);

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

  // Handle Escape key to close the panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Save connection/database, queries, and tabs to localStorage when they change
  useEffect(() => {
    if (initialized && activeConnectionId) {
      saveStoredState(building.id, {
        connectionId: activeConnectionId,
        database: activeDatabase,
        lastQuery: query, // For backwards compatibility
        queries,
        generalQuery: '',
        openTabs: openTabs.map(t => ({
          connectionId: t.connectionId,
          database: t.database,
        })),
        activeTabId: activeTabId ?? undefined,
      });
    }
  }, [building.id, activeConnectionId, activeDatabase, query, initialized, openTabs, activeTabId, queries]);

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
    if (activeConnectionId) {
      // Open or switch to tab for this database
      handleOpenTab(activeConnectionId, database);
      store.listTables(building.id, activeConnectionId, database);
    }
  }, [building.id, activeConnectionId, handleOpenTab]);

  // Current result
  const currentResult = queryResults[selectedResultIndex];

  // If no connections configured, show setup message
  if (connections.length === 0) {
    return (
      <div className="database-panel" ref={panelRef}>
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
            <h3>{t('terminal:database.noConnections')}</h3>
            <p>{t('terminal:database.noConnectionsDesc')}</p>
            <p>{t('terminal:database.toGetStarted')}</p>
            <ol>
              <li>{t('terminal:database.step1Close')}</li>
              <li>{t('terminal:database.step2Settings')}</li>
              <li>{t('terminal:database.step3AddConnection')}</li>
              <li>{t('terminal:database.step4Reopen')}</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="database-panel" ref={panelRef}>
      <div className="database-panel__header">
        <div className="database-panel__title">
          <span className="database-panel__icon">
            {activeConnection?.engine === 'mysql' ? '🐬' : '🐘'}
          </span>
          <span className="database-panel__name">{building.name}</span>
          {activeConnection && (
            <span className="database-panel__connection-info">
              {activeConnection.name} / {activeDatabase || t('terminal:database.noDatabaseSelected')}
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
          onSelectTableQuery={(tableName) => {
            const sql = `SELECT * FROM ${tableName}`;
            setQuery(sql);
            if (activeConnectionId && activeDatabase) {
              store.executeQuery(building.id, activeConnectionId, activeDatabase, sql);
            }
          }}
        />

        {/* Main Content */}
        <div className="database-panel__main">
          {/* Database Tabs */}
          {openTabs.length > 0 && (
            <DatabaseTabs
              tabs={openTabs}
              activeTabId={activeTabId}
              onTabClick={handleSelectTab}
              onTabClose={handleCloseTab}
            />
          )}

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
              {t('terminal:database.results')}
              {queryResults.length > 0 && (
                <span className="database-panel__tab-badge">{queryResults.length}</span>
              )}
            </button>
            <button
              className={`database-panel__tab ${activeTab === 'history' ? 'database-panel__tab--active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              {t('terminal:database.history')}
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
                  &larr; {t('terminal:database.older')}
                </button>
                <span>
                  {selectedResultIndex + 1} / {queryResults.length}
                </span>
                <button
                  disabled={selectedResultIndex <= 0}
                  onClick={() => setSelectedResultIndex(i => i - 1)}
                >
                  {t('terminal:database.newer')} &rarr;
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
                  building={building}
                />
              ) : (
                <div className="database-panel__empty">
                  <p>{t('terminal:database.noResultsYet')}</p>
                  <p>{t('terminal:database.selectDbAndRun')}</p>
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
