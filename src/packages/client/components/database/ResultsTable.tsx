/**
 * ResultsTable
 *
 * Displays query results in a paginated, sortable table with pretty formatting.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueryResult, TableColumn, TableIndex } from '../../../shared/types';
import { store, useDatabaseState } from '../../store';
import './ResultsTable.scss';

interface ResultsTableProps {
  result: QueryResult;
  buildingId: string;
}

interface TableSchema {
  columns: TableColumn[];
  indexes: TableIndex[];
  foreignKeys: Array<{ name: string; columns: string[]; referencedTable: string; referencedColumns: string[] }>;
}

interface EditingCell {
  rowIndex: number;
  columnName: string;
  originalValue: unknown;
  currentValue: unknown;
  isUpdating: boolean;
  error?: string;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];
const DEFAULT_PAGE_SIZE = 50;

/** Get raw string representation of a cell value */
const getRawValue = (value: unknown): string => {
  if (value === null) return 'NULL';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

/** Extract table name from SELECT query */
const extractTableName = (query: string): string | null => {
  // Match: FROM `table_name`, FROM table_name, FROM schema.table_name
  const match = query.match(/FROM\s+(?:(?:`?[\w]+`?\.)?`?([\w]+)`?|\([\s\S]*?\))\s+(?:AS\s+)?(?:\w+)?/i);
  if (match?.[1]) {
    return match[1];
  }
  return null;
};

/** Get primary key columns from schema */
const getPrimaryKeyColumns = (schema: TableSchema | null): string[] => {
  if (!schema || !schema.columns) return [];
  return schema.columns
    .filter(col => col.primaryKey)
    .map(col => col.name);
};

/** Build UPDATE SQL statement with proper escaping for each database engine */
const buildUpdateSql = (
  engine: string,
  tableName: string,
  columnName: string,
  primaryKeys: Record<string, unknown>,
  originalValue: unknown,
  newValue: unknown
): string => {
  const escapeId = (id: string) => {
    if (engine === 'mysql') return `\`${id}\``;
    if (engine === 'postgres') return `"${id}"`;
    return id; // Oracle
  };

  const escapeValue = (val: unknown): string => {
    if (val === null) return 'NULL';
    if (typeof val === 'boolean') return val ? '1' : '0';
    if (typeof val === 'number') return String(val);
    // Escape single quotes by doubling them
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const setPart = `${escapeId(columnName)} = ${escapeValue(newValue)}`;

  const whereParts: string[] = [];
  for (const [pkCol, pkVal] of Object.entries(primaryKeys)) {
    whereParts.push(`${escapeId(pkCol)} = ${escapeValue(pkVal)}`);
  }

  // Add optimistic lock: check original value to detect concurrent modifications
  if (originalValue === null) {
    whereParts.push(`${escapeId(columnName)} IS NULL`);
  } else {
    whereParts.push(`${escapeId(columnName)} = ${escapeValue(originalValue)}`);
  }

  const whereClause = whereParts.join(' AND ');
  return `UPDATE ${escapeId(tableName)} SET ${setPart} WHERE ${whereClause}`;
};

export const ResultsTable: React.FC<ResultsTableProps> = ({ result, buildingId }) => {
  const { t } = useTranslation(['terminal']);
  const dbState = useDatabaseState(buildingId);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [cellDetail, setCellDetail] = useState<{ column: string; value: unknown } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [tableName, setTableName] = useState<string | null>(null);
  const [tableSchema, setTableSchema] = useState<TableSchema | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const resizingRef = useRef<{ column: string; startX: number; startWidth: number } | null>(null);
  const didResizeRef = useRef(false);

  const isError = result.status === 'error';
  const isEmpty = !result.rows || result.rows.length === 0;

  // Initialize table name and schema when query changes
  useEffect(() => {
    const newTableName = extractTableName(result.query || '');
    setTableName(newTableName);
    setCanEdit(false);
    setTableSchema(null);

    if (newTableName && dbState.activeConnectionId && dbState.activeDatabase) {
      // Request table schema from server
      store.getTableSchema(buildingId, dbState.activeConnectionId, dbState.activeDatabase, newTableName);

      // Check if schema is already in store (it might be cached)
      const schemaKey = `${dbState.activeConnectionId}:${dbState.activeDatabase}:${newTableName}`;
      const cachedSchema = dbState.tableSchemas?.get?.(schemaKey);
      if (cachedSchema) {
        setTableSchema(cachedSchema);
        const pkCols = getPrimaryKeyColumns(cachedSchema);
        setCanEdit(pkCols.length > 0);
      }
    }
  }, [result.query, buildingId, dbState.activeConnectionId, dbState.activeDatabase, dbState.tableSchemas]);

  // Sort rows (hooks must always be called in the same order)
  const sortedRows = useMemo(() => {
    if (!sortColumn || !result.rows) return result.rows;

    return [...result.rows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      // Handle nulls
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDirection === 'asc' ? -1 : 1;
      if (bVal === null) return sortDirection === 'asc' ? 1 : -1;

      // Compare values
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDirection === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [result.rows, sortColumn, sortDirection]);

  // Paginate
  const paginatedRows = useMemo(() => {
    if (!sortedRows) return [];
    const start = page * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  const totalPages = Math.ceil((sortedRows?.length ?? 0) / pageSize);

  // Get column names
  const columns = result.fields?.map(f => f.name) ?? Object.keys(result.rows?.[0] || {});

  // Handle sort (skip if resize just finished)
  const handleSort = useCallback((column: string) => {
    if (didResizeRef.current) {
      didResizeRef.current = false;
      return;
    }
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

  // Handle cell click to show detail overlay
  const handleCellClick = useCallback((column: string, value: unknown) => {
    setCellDetail({ column, value });
  }, []);

  // Save cell edit and execute UPDATE
  const handleSaveCell = useCallback(() => {
    if (!editingCell || !tableName || !tableSchema || !dbState.activeConnectionId || !dbState.activeDatabase) return;

    const { rowIndex, columnName, originalValue, currentValue } = editingCell;

    // Don't update if value hasn't changed
    if (currentValue === originalValue) {
      setEditingCell(null);
      return;
    }

    // Get the actual row from sorted and paginated data
    const actualRowIndex = page * pageSize + rowIndex;
    const row = sortedRows?.[actualRowIndex];
    if (!row) return;

    // Get primary key values from row
    const pkCols = getPrimaryKeyColumns(tableSchema);
    if (pkCols.length === 0) {
      setEditingCell(prev => prev ? { ...prev, error: 'No primary key found' } : null);
      return;
    }

    const primaryKeys: Record<string, unknown> = {};
    for (const pkCol of pkCols) {
      primaryKeys[pkCol] = row[pkCol];
    }

    setEditingCell(prev => prev ? { ...prev, isUpdating: true } : null);

    // Generate UPDATE SQL
    const engine = dbState.activeConnectionId ? 'mysql' : 'mysql';
    const updateSql = buildUpdateSql(
      engine,
      tableName,
      columnName,
      primaryKeys,
      originalValue,
      currentValue
    );

    // Execute the UPDATE query
    store.executeQuery(buildingId, dbState.activeConnectionId, dbState.activeDatabase, updateSql);

    // Clear edit state after a brief delay to show feedback
    setTimeout(() => setEditingCell(null), 500);
  }, [editingCell, tableName, tableSchema, page, pageSize, sortedRows, buildingId, dbState.activeConnectionId, dbState.activeDatabase]);

  // Handle keyboard in edit mode
  const handleCellKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveCell();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingCell(null);
    }
  }, [handleSaveCell]);

  // Column resize handlers - no state deps to avoid re-renders during drag
  const handleResizeStart = useCallback((e: React.MouseEvent, column: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest('th');
    if (!th) return;
    const startWidth = th.getBoundingClientRect().width;
    resizingRef.current = { column, startX: e.clientX, startWidth };

    const handleMouseMove = (moveE: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = moveE.clientX - resizingRef.current.startX;
      const newWidth = Math.max(50, resizingRef.current.startWidth + diff);
      setColumnWidths(prev => ({ ...prev, [resizingRef.current!.column]: newWidth }));
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      didResizeRef.current = true;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Close detail overlay on outside click or Escape
  useEffect(() => {
    if (!cellDetail) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCellDetail(null);
    };
    const handleClick = (e: MouseEvent) => {
      if (detailRef.current && !detailRef.current.contains(e.target as Node)) {
        setCellDetail(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [cellDetail]);

  // Focus and select input when editing starts
  useEffect(() => {
    if (editInputRef.current && editingCell) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Copy all results as enriched HTML table
  const handleCopyAll = useCallback(async () => {
    if (!result.rows || result.rows.length === 0) return;
    const cols = result.fields?.map(f => f.name) ?? Object.keys(result.rows[0] || {});
    const rows = sortedRows ?? result.rows;

    // Build HTML table
    const htmlParts = ['<table><thead><tr>'];
    cols.forEach(col => htmlParts.push(`<th>${col}</th>`));
    htmlParts.push('</tr></thead><tbody>');
    rows.forEach(row => {
      htmlParts.push('<tr>');
      cols.forEach(col => {
        const val = row[col];
        htmlParts.push(`<td>${val === null ? 'NULL' : typeof val === 'object' ? JSON.stringify(val) : String(val)}</td>`);
      });
      htmlParts.push('</tr>');
    });
    htmlParts.push('</tbody></table>');

    // Build plain text tab-separated table
    const textParts = [cols.join('\t')];
    rows.forEach(row => {
      textParts.push(cols.map(col => {
        const val = row[col];
        return val === null ? 'NULL' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      }).join('\t'));
    });

    try {
      const htmlBlob = new Blob([htmlParts.join('')], { type: 'text/html' });
      const textBlob = new Blob([textParts.join('\n')], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob,
        }),
      ]);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // Fallback to plain text
      await navigator.clipboard.writeText(textParts.join('\n'));
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  }, [result, sortedRows]);

  // Format cell value
  const formatValue = (value: unknown): React.ReactNode => {
    if (value === null) {
      return <span className="results-table__null">NULL</span>;
    }
    if (value === undefined) {
      return <span className="results-table__null">undefined</span>;
    }
    if (typeof value === 'boolean') {
      return <span className={`results-table__bool results-table__bool--${value}`}>{String(value)}</span>;
    }
    if (typeof value === 'number') {
      return <span className="results-table__number">{value.toLocaleString()}</span>;
    }
    if (value instanceof Date) {
      return <span className="results-table__date">{value.toISOString()}</span>;
    }
    if (typeof value === 'object') {
      return (
        <span className="results-table__json" title={JSON.stringify(value, null, 2)}>
          {JSON.stringify(value)}
        </span>
      );
    }
    const strValue = String(value);
    if (strValue.length > 100) {
      return (
        <span className="results-table__long" title={strValue}>
          {strValue.substring(0, 100)}...
        </span>
      );
    }
    return strValue;
  };

  // Early returns after all hooks
  if (isError) {
    return (
      <div className="results-table results-table--error">
        <div className="results-table__error">
          <div className="results-table__error-header">
            <span className="results-table__error-icon">&#10007;</span>
            {t('terminal:database.queryError')}
          </div>
          <div className="results-table__error-message">
            {result.error}
          </div>
          {result.errorCode && (
            <div className="results-table__error-code">
              {t('terminal:database.errorCode', { code: result.errorCode })}
            </div>
          )}
          <div className="results-table__error-query">
            <code>{result.query}</code>
          </div>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="results-table results-table--success">
        <div className="results-table__success">
          <span className="results-table__success-icon">&#10003;</span>
          {t('terminal:database.querySuccess')}
          {result.affectedRows !== undefined && (
            <span className="results-table__affected">
              {t('terminal:database.rowsAffected', { count: result.affectedRows })}
            </span>
          )}
          <span className="results-table__duration">
            {result.duration}ms
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="results-table">
      {/* Status bar */}
      <div className="results-table__status-bar">
        <div className="results-table__status-info">
          <span className="results-table__row-count">
            {t('terminal:database.rowCount', { count: result.rowCount })}
          </span>
          <span className="results-table__duration">
            {result.duration}ms
          </span>
          <button
            className={`results-table__copy-btn ${copyFeedback ? 'results-table__copy-btn--success' : ''}`}
            onClick={handleCopyAll}
            title={t('terminal:database.copyAllResults')}
          >
            {copyFeedback ? t('terminal:database.copied') : t('terminal:database.copyAll')}
          </button>
        </div>

        {/* Pagination controls */}
        <div className="results-table__pagination">
          <select
            className="results-table__page-size"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{t('terminal:database.rowsPerPage', { count: size })}</option>
            ))}
          </select>

          <button
            className="results-table__page-btn"
            disabled={page === 0}
            onClick={() => setPage(0)}
            title={t('terminal:database.firstPage')}
          >
            &laquo;
          </button>
          <button
            className="results-table__page-btn"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            title={t('terminal:database.previousPage')}
          >
            &lsaquo;
          </button>
          <span className="results-table__page-info">
            {t('terminal:database.pageInfo', { current: page + 1, total: totalPages })}
          </span>
          <button
            className="results-table__page-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            title={t('terminal:database.nextPage')}
          >
            &rsaquo;
          </button>
          <button
            className="results-table__page-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(totalPages - 1)}
            title={t('terminal:database.lastPage')}
          >
            &raquo;
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="results-table__wrapper">
        <table
          className={`results-table__table ${Object.keys(columnWidths).length > 0 ? 'results-table__table--resized' : ''}`}
        >
          <thead>
            <tr>
              <th className="results-table__row-num">#</th>
              {columns.map(col => {
                const field = result.fields?.find(f => f.name === col);
                const isSorted = sortColumn === col;

                return (
                  <th
                    key={col}
                    className={`results-table__header ${isSorted ? 'results-table__header--sorted' : ''}`}
                    onClick={() => handleSort(col)}
                    title={field?.type ? `Type: ${field.type}` : undefined}
                    style={columnWidths[col] ? { width: columnWidths[col], minWidth: columnWidths[col], maxWidth: columnWidths[col] } : undefined}
                  >
                    <span className="results-table__header-name">{col}</span>
                    {isSorted && (
                      <span className="results-table__sort-indicator">
                        {sortDirection === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                    <span
                      className="results-table__resize-handle"
                      onMouseDown={(e) => handleResizeStart(e, col)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="results-table__row">
                <td className="results-table__row-num">
                  {page * pageSize + rowIndex + 1}
                </td>
                {columns.map(col => {
                  const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnName === col;

                  return (
                    <td
                      key={col}
                      className={`results-table__cell ${isEditing ? 'results-table__cell--editing' : ''} ${canEdit ? 'results-table__cell--editable' : ''}`}
                      onClick={() => handleCellClick(col, row[col])}
                    >
                      {isEditing ? (
                        <div className="results-table__cell-input-wrapper">
                          <input
                            ref={editInputRef}
                            type="text"
                            className="results-table__cell-input"
                            value={String(editingCell.currentValue ?? '')}
                            onChange={(e) => setEditingCell(prev =>
                              prev ? { ...prev, currentValue: e.target.value } : null
                            )}
                            onBlur={handleSaveCell}
                            onKeyDown={handleCellKeyDown}
                            disabled={editingCell.isUpdating}
                            autoFocus
                          />
                          {editingCell.isUpdating && (
                            <span className="results-table__cell-feedback results-table__cell-feedback--loading">⏳</span>
                          )}
                          {editingCell.error && (
                            <span className="results-table__cell-feedback results-table__cell-feedback--error" title={editingCell.error}>✕</span>
                          )}
                        </div>
                      ) : (
                        formatValue(row[col])
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cell detail overlay */}
      {cellDetail && (
        <div className="results-table__detail-backdrop">
          <div className="results-table__detail" ref={detailRef}>
            <div className="results-table__detail-header">
              <span className="results-table__detail-column">{cellDetail.column}</span>
              <div className="results-table__detail-actions">
                {canEdit && (
                  <button
                    className="results-table__detail-edit-btn"
                    onClick={() => {
                      setCellDetail(null);
                      // Find the current row and column in paginated view
                      const row = paginatedRows.find(r =>
                        columns.some(col => r[col] === cellDetail.value && col === cellDetail.column)
                      );
                      if (row) {
                        const rowIndex = paginatedRows.indexOf(row);
                        setEditingCell({
                          rowIndex,
                          columnName: cellDetail.column,
                          originalValue: cellDetail.value,
                          currentValue: cellDetail.value,
                          isUpdating: false,
                        });
                      }
                    }}
                    title="Edit this cell"
                  >
                    ✏️
                  </button>
                )}
                <button
                  className="results-table__detail-close"
                  onClick={() => setCellDetail(null)}
                >
                  ✕
                </button>
              </div>
            </div>
            <textarea
              className="results-table__detail-textarea"
              value={getRawValue(cellDetail.value)}
              readOnly
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>
      )}
    </div>
  );
};
