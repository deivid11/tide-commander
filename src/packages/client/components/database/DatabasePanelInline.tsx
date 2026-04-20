/**
 * DatabasePanelInline
 *
 * Compact database panel designed for the guake bottom split area.
 * Uses dropdowns instead of a sidebar, single-line toolbar, and inline results.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Building } from '../../../shared/types';
import { store, useDatabaseState, useQueryResults, useExecutingQuery } from '../../store';
import { ResultsTable } from './ResultsTable';
import { splitQueries, getQueryAtCursor } from './QueryEditor';
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import { Icon } from '../Icon';
import './DatabasePanelInline.scss';

interface DatabasePanelInlineProps {
  building: Building;
}

const getStorageKey = (buildingId: string) => `db-panel-${buildingId}`;

export const DatabasePanelInline: React.FC<DatabasePanelInlineProps> = ({ building }) => {
  const dbState = useDatabaseState(building.id);
  const queryResults = useQueryResults(building.id);
  const isExecuting = useExecutingQuery(building.id);

  const connections = building.database?.connections ?? [];
  const [query, setQuery] = useState('');
  const [initialized, setInitialized] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  // SQL syntax highlighting via Prism
  const highlightedCode = useMemo(() => {
    if (!query) return '';
    try {
      return Prism.highlight(query, Prism.languages.sql, 'sql');
    } catch {
      return query;
    }
  }, [query]);

  // Sync scroll between textarea and highlight overlay
  const handleScroll = useCallback(() => {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const activeConnectionId = dbState.activeConnectionId
    ?? building.database?.activeConnectionId
    ?? connections[0]?.id;
  const activeDatabase = dbState.activeDatabase
    ?? building.database?.activeDatabase;
  const activeConnection = connections.find(c => c.id === activeConnectionId);

  // Databases and tables from store
  const databases: string[] = activeConnectionId ? (dbState.databases?.get(activeConnectionId) ?? []) : [];
  const tableInfos = (activeConnectionId && activeDatabase)
    ? (dbState.tables?.get(`${activeConnectionId}:${activeDatabase}`) ?? [])
    : [];

  // Initialize on mount
  useEffect(() => {
    if (!initialized && connections.length > 0) {
      // Try to restore from stored state
      try {
        const stored = localStorage.getItem(getStorageKey(building.id));
        if (stored) {
          const state = JSON.parse(stored);
          if (state.connectionId && connections.some(c => c.id === state.connectionId)) {
            store.setActiveConnection(building.id, state.connectionId);
            store.listDatabases(building.id, state.connectionId);
            if (state.database) {
              store.setActiveDatabase(building.id, state.database);
              store.listTables(building.id, state.connectionId, state.database);
            }
            if (state.lastQuery) setQuery(state.lastQuery);
          }
        }
      } catch { /* ignore */ }

      // If no stored state, just list databases for first connection
      if (!dbState.activeConnectionId && connections[0]) {
        store.setActiveConnection(building.id, connections[0].id);
        store.listDatabases(building.id, connections[0].id);
      }
      setInitialized(true);
    }
  }, [building.id, connections, initialized, dbState.activeConnectionId]);

  // Save query and active connection/database to localStorage (merge with existing state)
  useEffect(() => {
    if (!initialized) return;
    try {
      const key = getStorageKey(building.id);
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.lastQuery = query;
      if (activeConnectionId) existing.connectionId = activeConnectionId;
      if (activeDatabase) existing.database = activeDatabase;
      localStorage.setItem(key, JSON.stringify(existing));
    } catch { /* ignore */ }
  }, [building.id, query, activeConnectionId, activeDatabase, initialized]);

  const handleConnectionChange = useCallback((connectionId: string) => {
    store.setActiveConnection(building.id, connectionId);
    store.listDatabases(building.id, connectionId);
  }, [building.id]);

  const handleDatabaseChange = useCallback((database: string) => {
    if (activeConnectionId) {
      store.setActiveDatabase(building.id, database);
      store.listTables(building.id, activeConnectionId, database);
    }
  }, [building.id, activeConnectionId]);

  const handleExecute = useCallback(() => {
    if (!activeConnectionId || !activeDatabase || !query.trim() || isExecuting) return;

    const cursorPos = textareaRef.current?.selectionStart ?? 0;
    const stmts = splitQueries(query);

    if (stmts.length <= 1) {
      store.executeQuery(building.id, activeConnectionId, activeDatabase, query.trim());
    } else {
      // Try cursor-based execution first
      const stmt = getQueryAtCursor(query, cursorPos);
      if (stmt) {
        store.executeQuery(building.id, activeConnectionId, activeDatabase, stmt);
      } else {
        store.executeQuery(building.id, activeConnectionId, activeDatabase, query.trim());
      }
    }
  }, [building.id, activeConnectionId, activeDatabase, query, isExecuting]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
  }, [handleExecute]);

  const handleTableClick = useCallback((tableName: string) => {
    const sql = `SELECT * FROM ${tableName} LIMIT 100`;
    setQuery(sql);
    if (activeConnectionId && activeDatabase) {
      store.executeQuery(building.id, activeConnectionId, activeDatabase, sql);
    }
  }, [building.id, activeConnectionId, activeDatabase]);

  const currentResult = queryResults[0];

  if (connections.length === 0) {
    return (
      <div className="db-inline">
        <div className="db-inline__empty"><Icon name="plug" size={14} /> No connections configured</div>
      </div>
    );
  }

  return (
    <div className="db-inline">
      {/* Toolbar row */}
      <div className="db-inline__toolbar">
        {/* Connection selector */}
        {connections.length > 1 && (
          <select
            className="db-inline__select"
            value={activeConnectionId ?? ''}
            onChange={(e) => handleConnectionChange(e.target.value)}
            title="Connection"
          >
            {connections.map(c => (
              <option key={c.id} value={c.id}>
                {c.engine === 'mysql' ? '🐬' : '🐘'} {c.name}
              </option>
            ))}
          </select>
        )}
        {connections.length === 1 && activeConnection && (
          <span className="db-inline__connection-badge" title={`${activeConnection.host}:${activeConnection.port}`}>
            {activeConnection.engine === 'mysql' ? '🐬' : '🐘'} {activeConnection.name}
          </span>
        )}

        {/* Database selector */}
        <select
          className="db-inline__select"
          value={activeDatabase ?? ''}
          onChange={(e) => handleDatabaseChange(e.target.value)}
          title="Database"
        >
          <option value="">Select database...</option>
          {databases.map(db => (
            <option key={db} value={db}>{db}</option>
          ))}
        </select>

        {/* Tables dropdown */}
        {tableInfos.length > 0 && (
          <select
            className="db-inline__select db-inline__select--tables"
            value=""
            onChange={(e) => { if (e.target.value) handleTableClick(e.target.value); }}
            title="Quick query table"
          >
            <option value="">Tables ({tableInfos.length})</option>
            {tableInfos.map(t => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        )}

        {/* Run button */}
        <button
          className="db-inline__run"
          onClick={handleExecute}
          disabled={isExecuting || !activeDatabase || !query.trim()}
          title="Execute (Ctrl+Enter)"
        >
          <Icon name={isExecuting ? 'hourglass' : 'play'} size={14} />
        </button>
      </div>

      {/* Query input with syntax highlighting */}
      <div className="db-inline__editor">
        <pre
          ref={highlightRef}
          className="db-inline__highlight"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightedCode + '\n' }}
        />
        <textarea
          ref={textareaRef}
          className="db-inline__textarea"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          placeholder="SELECT * FROM ..."
          spellCheck={false}
          rows={2}
        />
      </div>

      {/* Results */}
      <div className="db-inline__results">
        {currentResult ? (
          <ResultsTable
            result={currentResult}
            buildingId={building.id}
            building={building}
          />
        ) : (
          <div className="db-inline__empty">
            {activeDatabase ? 'Run a query or select a table above' : 'Select a database to get started'}
          </div>
        )}
      </div>
    </div>
  );
};
