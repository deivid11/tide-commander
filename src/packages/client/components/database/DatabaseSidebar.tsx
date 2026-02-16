/**
 * DatabaseSidebar
 *
 * Sidebar component for database panel - shows connections, databases, and tables.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Building, DatabaseConnection } from '../../../shared/types';
import { store, useDatabaseState } from '../../store';
import './DatabaseSidebar.scss';

interface DatabaseSidebarProps {
  building: Building;
  connections: DatabaseConnection[];
  activeConnectionId: string | undefined;
  activeDatabase: string | undefined;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onConnectionChange: (connectionId: string) => void;
  onDatabaseChange: (database: string) => void;
  onInsertTable: (tableName: string) => void;
}

export const DatabaseSidebar: React.FC<DatabaseSidebarProps> = ({
  building,
  connections,
  activeConnectionId,
  activeDatabase,
  collapsed,
  onToggleCollapse,
  onConnectionChange,
  onDatabaseChange,
  onInsertTable,
}) => {
  const { t } = useTranslation(['terminal']);
  const dbState = useDatabaseState(building.id);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  // Get databases for active connection
  const databases = activeConnectionId
    ? dbState.databases.get(activeConnectionId) ?? []
    : [];

  // Get tables for active database
  const tablesKey = activeConnectionId && activeDatabase
    ? `${activeConnectionId}:${activeDatabase}`
    : '';
  const tables = tablesKey ? dbState.tables.get(tablesKey) ?? [] : [];

  // Get connection status
  const connectionStatus = activeConnectionId
    ? dbState.connectionStatus.get(activeConnectionId)
    : undefined;

  // Test connection on first load
  useEffect(() => {
    if (activeConnectionId && !connectionStatus) {
      store.testDatabaseConnection(building.id, activeConnectionId);
    }
  }, [building.id, activeConnectionId, connectionStatus]);

  // List databases when connection is ready
  useEffect(() => {
    if (activeConnectionId && connectionStatus?.connected && databases.length === 0) {
      store.listDatabases(building.id, activeConnectionId);
    }
  }, [building.id, activeConnectionId, connectionStatus?.connected, databases.length]);

  // List tables when database is selected
  useEffect(() => {
    if (activeConnectionId && activeDatabase && tables.length === 0) {
      store.listTables(building.id, activeConnectionId, activeDatabase);
    }
  }, [building.id, activeConnectionId, activeDatabase, tables.length]);

  // Toggle table expansion
  const toggleTableExpand = useCallback((tableName: string) => {
    setExpandedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
        // Fetch schema if not already cached
        if (activeConnectionId && activeDatabase) {
          const schemaKey = `${activeConnectionId}:${activeDatabase}:${tableName}`;
          if (!dbState.tableSchemas.has(schemaKey)) {
            store.getTableSchema(building.id, activeConnectionId, activeDatabase, tableName);
          }
        }
      }
      return next;
    });
  }, [building.id, activeConnectionId, activeDatabase, dbState.tableSchemas]);

  // Get schema for a table
  const getTableSchema = (tableName: string) => {
    if (!activeConnectionId || !activeDatabase) return null;
    const schemaKey = `${activeConnectionId}:${activeDatabase}:${tableName}`;
    return dbState.tableSchemas.get(schemaKey);
  };

  if (collapsed) {
    return (
      <div className="database-sidebar database-sidebar--collapsed">
        <button
          className="database-sidebar__toggle"
          onClick={onToggleCollapse}
          title={t('terminal:database.expandSidebar')}
        >
          &raquo;
        </button>
      </div>
    );
  }

  return (
    <div className="database-sidebar">
      <div className="database-sidebar__header">
        <span>{t('terminal:database.explorer')}</span>
        <button
          className="database-sidebar__toggle"
          onClick={onToggleCollapse}
          title={t('terminal:database.collapseSidebar')}
        >
          &laquo;
        </button>
      </div>

      {/* Connection Selector */}
      <div className="database-sidebar__section">
        <div className="database-sidebar__section-title">{t('terminal:database.connection')}</div>
        <select
          className="database-sidebar__select"
          value={activeConnectionId || ''}
          onChange={(e) => onConnectionChange(e.target.value)}
        >
          {connections.length === 0 ? (
            <option value="">{t('terminal:database.noConnections')}</option>
          ) : (
            connections.map(conn => (
              <option key={conn.id} value={conn.id}>
                {conn.engine === 'mysql' ? '🐬' : '🐘'} {conn.name}
              </option>
            ))
          )}
        </select>

        {/* Connection Status */}
        {connectionStatus && (
          <div className={`database-sidebar__status ${connectionStatus.connected ? 'database-sidebar__status--connected' : 'database-sidebar__status--error'}`}>
            {connectionStatus.connected ? (
              <>
                <span className="database-sidebar__status-icon">&#10003;</span>
                {t('terminal:database.connected')}
                {connectionStatus.serverVersion && (
                  <span className="database-sidebar__version">
                    ({connectionStatus.serverVersion})
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="database-sidebar__status-icon">&#10007;</span>
                {connectionStatus.error || t('terminal:database.disconnected')}
              </>
            )}
          </div>
        )}
      </div>

      {/* Database Selector */}
      {databases.length > 0 && (
        <div className="database-sidebar__section">
          <div className="database-sidebar__section-title">{t('terminal:database.databaseTitle')}</div>
          <select
            className="database-sidebar__select"
            value={activeDatabase || ''}
            onChange={(e) => onDatabaseChange(e.target.value)}
          >
            <option value="">{t('terminal:database.selectDatabase')}</option>
            {databases.map(db => (
              <option key={db} value={db}>{db}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tables List */}
      {tables.length > 0 && (
        <div className="database-sidebar__section database-sidebar__section--tables">
          <div className="database-sidebar__section-title">
            {t('terminal:database.tablesCount', { count: tables.length })}
          </div>
          <div className="database-sidebar__tables">
            {tables.map(table => {
              const isExpanded = expandedTables.has(table.name);
              const schema = isExpanded ? getTableSchema(table.name) : null;

              return (
                <div key={table.name} className="database-sidebar__table">
                  <div
                    className="database-sidebar__table-header"
                    onClick={() => toggleTableExpand(table.name)}
                  >
                    <span className="database-sidebar__table-expand">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <span className="database-sidebar__table-icon">
                      {table.type === 'view' ? '👁' : '📋'}
                    </span>
                    <span className="database-sidebar__table-name">
                      {table.name}
                    </span>
                    <button
                      className="database-sidebar__table-insert"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInsertTable(table.name);
                      }}
                      title={t('terminal:database.insertTableName')}
                    >
                      +
                    </button>
                  </div>

                  {isExpanded && schema && (
                    <div className="database-sidebar__table-columns">
                      {schema.columns.map(col => (
                        <div
                          key={col.name}
                          className="database-sidebar__column"
                          onClick={() => onInsertTable(col.name)}
                          title={`${col.type}${col.nullable ? ' NULL' : ' NOT NULL'}${col.primaryKey ? ' PK' : ''}`}
                        >
                          <span className="database-sidebar__column-icon">
                            {col.primaryKey ? '🔑' : ''}
                          </span>
                          <span className="database-sidebar__column-name">
                            {col.name}
                          </span>
                          <span className="database-sidebar__column-type">
                            {col.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
