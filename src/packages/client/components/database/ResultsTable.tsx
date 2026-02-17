/**
 * ResultsTable
 *
 * Displays query results in a paginated, sortable table with pretty formatting.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import DatePicker from 'react-datepicker';
import type { QueryResult, TableColumn, TableIndex, Building } from '../../../shared/types';
import { store, useDatabaseState } from '../../store';
import { ContextMenu, type ContextMenuAction } from '../ContextMenu';
import 'react-datepicker/dist/react-datepicker.css';
import './ResultsTable.scss';

interface ResultsTableProps {
  result: QueryResult;
  buildingId: string;
  building: Building;
}

interface TableSchema {
  columns: TableColumn[];
  indexes: TableIndex[];
  foreignKeys: Array<{ name: string; columns: string[]; referencedTable: string; referencedColumns: string[] }>;
}

interface EditingCell {
  rowIndex: number;
  rowKey: string;
  columnName: string;
  originalValue: unknown;
  currentValue: unknown;
  isUpdating: boolean;
  error?: string;
}

interface CellContextMenuState {
  position: { x: number; y: number };
  rowIndex: number;
  rowKey: string;
  columnName: string;
  value: unknown;
}

interface PendingUpdateState {
  requestId: string;
  query: string;
  rowKey: string;
  columnName: string;
  parsedValue: unknown;
  startedAt: number;
  originalQuery: string;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];
const DEFAULT_PAGE_SIZE = 50;

const pad2 = (value: number): string => String(value).padStart(2, '0');

const isDateTimeType = (fieldType?: string): boolean => {
  if (!fieldType) return false;
  return /(datetime|timestamp|timestamptz|datetime2|smalldatetime)/i.test(fieldType);
};

const formatDateTimeForSql = (date: Date): string => {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

const parseDateTimeValue = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(raw)) {
    const normalized = raw.replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsed = new Date(raw.replace(/Z$/, ''));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Get raw string representation of a cell value */
const getRawValue = (value: unknown): string => {
  if (value === null) return 'NULL';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

/** Convert a cell value into editable text shown in the input */
const getEditableValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** Extract table name from SELECT query */
const extractTableName = (query: string): string | null => {
  // Match: FROM `table_name`, FROM table_name, FROM schema.table_name
  // Accept aliases, trailing semicolon, or end-of-query after table name.
  const match = query.match(/FROM\s+(?:`?[\w]+`?\.)?`?([\w]+)`?(?:\s+(?:AS\s+)?\w+)?(?=\s|;|$)/i);
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
  newValue: unknown,
  includeOriginalValueCheck: boolean = true
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
    if (typeof val === 'object') {
      return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
    }
    // Escape single quotes by doubling them
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const setPart = `${escapeId(columnName)} = ${escapeValue(newValue)}`;

  const whereParts: string[] = [];
  for (const [pkCol, pkVal] of Object.entries(primaryKeys)) {
    whereParts.push(`${escapeId(pkCol)} = ${escapeValue(pkVal)}`);
  }

  // Add optimistic lock for scalar values. JSON/object comparisons can be non-portable
  // across engines and may cause 0-row updates even when PK matches.
  if (!includeOriginalValueCheck) {
    // Skip optimistic value equality check when comparisons are unreliable (e.g., datetime precision)
  } else if (originalValue === null) {
    whereParts.push(`${escapeId(columnName)} IS NULL`);
  } else if (typeof originalValue === 'object') {
    // Skip object equality guard; rely on primary key match for JSON/object edits.
  } else {
    whereParts.push(`${escapeId(columnName)} = ${escapeValue(originalValue)}`);
  }

  const whereClause = whereParts.join(' AND ');
  return `UPDATE ${escapeId(tableName)} SET ${setPart} WHERE ${whereClause}`;
};

export const ResultsTable: React.FC<ResultsTableProps> = ({ result, buildingId, building }) => {
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [executedQuery, setExecutedQuery] = useState<string | null>(null);
  const [updatedRows, setUpdatedRows] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [cellContextMenu, setCellContextMenu] = useState<CellContextMenuState | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdateState | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const resizingRef = useRef<{ column: string; startX: number; startWidth: number } | null>(null);
  const didResizeRef = useRef(false);

  const isError = result.status === 'error';
  const isEmpty = !result.rows || result.rows.length === 0;

  // Initialize table name and fetch schema when query changes
  useEffect(() => {
    const newTableName = extractTableName(result.query || '');
    setTableName(newTableName);
    setCanEdit(false);
    setTableSchema(null);
    // Clear updated rows when a new query result arrives
    setUpdatedRows(new Map());

    if (newTableName && dbState.activeConnectionId && dbState.activeDatabase) {
      // Check if schema is already cached in store before requesting
      const schemaKey = `${dbState.activeConnectionId}:${dbState.activeDatabase}:${newTableName}`;
      const cachedSchema = dbState.tableSchemas?.get?.(schemaKey);
      if (cachedSchema) {
        setTableSchema(cachedSchema);
        const pkCols = getPrimaryKeyColumns(cachedSchema);
        setCanEdit(pkCols.length > 0);
      } else {
        // Only request from server if not already cached
        store.getTableSchema(buildingId, dbState.activeConnectionId, dbState.activeDatabase, newTableName);
      }
    }
    // NOTE: dbState.tableSchemas intentionally excluded - schema arrival is handled by the effect below
  }, [result.query, result.rows, buildingId, dbState.activeConnectionId, dbState.activeDatabase]);

  // Update local schema state when schema data arrives in store
  useEffect(() => {
    if (tableName && dbState.activeConnectionId && dbState.activeDatabase) {
      const schemaKey = `${dbState.activeConnectionId}:${dbState.activeDatabase}:${tableName}`;
      const cachedSchema = dbState.tableSchemas?.get?.(schemaKey);
      if (cachedSchema) {
        setTableSchema(prev => {
          if (prev === cachedSchema) return prev; // No change
          return cachedSchema;
        });
        const pkCols = getPrimaryKeyColumns(cachedSchema);
        setCanEdit(pkCols.length > 0);
      }
    }
  }, [dbState.tableSchemas, tableName, dbState.activeConnectionId, dbState.activeDatabase]);

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
  const columnTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    (result.fields ?? []).forEach(field => {
      if (field?.name) map.set(field.name, String(field.type ?? ''));
    });
    return map;
  }, [result.fields]);
  const primaryKeyColumns = useMemo(() => getPrimaryKeyColumns(tableSchema), [tableSchema]);
  const getEditorValue = useCallback((columnName: string, value: unknown): string => {
    const columnType = columnTypeMap.get(columnName);
    if (isDateTimeType(columnType)) {
      const parsed = parseDateTimeValue(value);
      return parsed ? formatDateTimeForSql(parsed) : '';
    }
    return getEditableValue(value);
  }, [columnTypeMap]);

  const editStatusText = useMemo(() => {
    if (canEdit) return 'Editable';
    if (!dbState.activeConnectionId || !dbState.activeDatabase) {
      return 'Read-only: no active connection or database';
    }
    if (!tableName) {
      return 'Read-only: query is not a single-table SELECT';
    }
    if (!tableSchema) {
      return 'Read-only: loading table schema';
    }
    if (primaryKeyColumns.length === 0) {
      return 'Read-only: table has no primary key';
    }
    return 'Read-only: editing unavailable';
  }, [canEdit, dbState.activeConnectionId, dbState.activeDatabase, tableName, tableSchema, primaryKeyColumns.length]);

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

  // Handle cell click to start editing (single click)
  const handleCellClick = useCallback((column: string, value: unknown, rowIndex: number, rowKey: string) => {
    if (!canEdit || editingCell || pendingUpdate) return; // Don't start editing if already editing/updating
    setEditingCell({
      rowIndex,
      rowKey,
      columnName: column,
      originalValue: value,
      currentValue: getEditorValue(column, value),
      isUpdating: false,
    });
  }, [canEdit, editingCell, pendingUpdate, getEditorValue]);

  // Handle double click to show detail overlay (double click)
  const handleCellDoubleClick = useCallback((column: string, value: unknown) => {
    setCellDetail({ column, value });
  }, []);

  const executeCellUpdate = useCallback((cell: EditingCell) => {
    if (!tableName || !tableSchema || !dbState.activeConnectionId || !dbState.activeDatabase) return;

    const { rowIndex, columnName, originalValue, currentValue } = cell;
    const currentValueText = String(currentValue ?? '');

    // Don't update if value hasn't changed
    if (currentValue !== null && currentValueText === getEditorValue(columnName, originalValue)) {
      setEditingCell(null);
      return;
    }

    // Get the actual row from sorted and paginated data
    const actualRowIndex = page * pageSize + rowIndex;
    const row = sortedRows?.[actualRowIndex];
    if (!row) return;

    // Get primary key values from row
    const pkCols = primaryKeyColumns;
    if (pkCols.length === 0) {
      setEditingCell(prev => prev ? { ...prev, error: 'No primary key found' } : null);
      return;
    }

    const primaryKeys: Record<string, unknown> = {};
    for (const pkCol of pkCols) {
      primaryKeys[pkCol] = row[pkCol];
    }

    let parsedValue: unknown = currentValueText;
    const columnType = columnTypeMap.get(columnName);
    if (currentValue === null) {
      parsedValue = null;
    } else if (isDateTimeType(columnType)) {
      parsedValue = currentValueText.trim() === '' ? null : currentValueText.trim();
    } else if (typeof originalValue === 'number') {
      if (currentValueText.trim() === '') {
        parsedValue = null;
      } else {
        const parsedNumber = Number(currentValueText);
        if (Number.isNaN(parsedNumber)) {
          setEditingCell(prev => prev ? { ...prev, isUpdating: false, error: 'Invalid number value' } : null);
          return;
        }
        parsedValue = parsedNumber;
      }
    } else if (typeof originalValue === 'boolean') {
      const normalized = currentValueText.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        parsedValue = true;
      } else if (normalized === 'false' || normalized === '0') {
        parsedValue = false;
      } else {
        setEditingCell(prev => prev ? { ...prev, isUpdating: false, error: 'Invalid boolean value' } : null);
        return;
      }
    } else if (originalValue !== null && typeof originalValue === 'object') {
      try {
        parsedValue = JSON.parse(currentValueText);
      } catch {
        setEditingCell(prev => prev ? { ...prev, isUpdating: false, error: 'Invalid JSON value' } : null);
        return;
      }
    }

    setEditingCell(prev => prev ? { ...prev, isUpdating: true } : null);

    // Get the database engine from the connection
    const connection = building.database?.connections.find((c) => c.id === dbState.activeConnectionId);
    const engine = (connection?.engine as string) || 'mysql';

    const updateSql = buildUpdateSql(
      engine,
      tableName,
      columnName,
      primaryKeys,
      originalValue,
      parsedValue,
      !isDateTimeType(columnType)
    );

    // Store the executed query for display
    setExecutedQuery(updateSql);
    const rowKey = JSON.stringify(primaryKeys);
    const originalQuery = result.query?.trim() || '';
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setPendingUpdate({
      requestId,
      query: updateSql,
      rowKey,
      columnName,
      parsedValue,
      startedAt: Date.now(),
      originalQuery,
    });

    // Execute the UPDATE query silently and wait for backend acknowledgement
    store.executeSilentQuery(buildingId, dbState.activeConnectionId, dbState.activeDatabase, updateSql, requestId);
  }, [tableName, tableSchema, page, pageSize, sortedRows, primaryKeyColumns, buildingId, dbState.activeConnectionId, dbState.activeDatabase, result.query, getEditorValue, columnTypeMap]);

  // Handle backend acknowledgement for silent UPDATE queries
  useEffect(() => {
    const silentResult = dbState.lastSilentQueryResult;
    if (!pendingUpdate || !silentResult) return;
    if (silentResult.requestId && silentResult.requestId !== pendingUpdate.requestId) return;
    // Fallback for older servers that don't send requestId
    if (silentResult.timestamp < pendingUpdate.startedAt) return;

    if (!silentResult.success) {
      setToast({ message: silentResult.error || 'Update failed on backend', type: 'error' });
      setTimeout(() => setToast(null), 5000);
      setEditingCell(prev => (prev ? { ...prev, isUpdating: false, error: silentResult.error || 'Update failed on backend' } : prev));
      setPendingUpdate(null);
      return;
    }

    if (silentResult.affectedRows === 0) {
      setToast({ message: 'No rows were updated', type: 'error' });
      setTimeout(() => setToast(null), 5000);
      setEditingCell(prev => (prev ? { ...prev, isUpdating: false, error: 'No rows were updated' } : prev));
      setPendingUpdate(null);
      return;
    }

    setUpdatedRows(prev => {
      const newMap = new Map(prev);
      const updatedRow = newMap.get(pendingUpdate.rowKey) || {};
      updatedRow[pendingUpdate.columnName] = pendingUpdate.parsedValue;
      newMap.set(pendingUpdate.rowKey, updatedRow);
      return newMap;
    });

    setEditingCell(null);
    setToast({ message: 'Row updated successfully', type: 'success' });
    setTimeout(() => setToast(null), 3000);

    if (pendingUpdate.originalQuery && dbState.activeConnectionId && dbState.activeDatabase) {
      setTimeout(() => {
        store.executeQuery(buildingId, dbState.activeConnectionId!, dbState.activeDatabase!, pendingUpdate.originalQuery);
      }, 200);
    }

    setPendingUpdate(null);
  }, [pendingUpdate, dbState.lastSilentQueryResult, dbState.activeConnectionId, dbState.activeDatabase, buildingId]);

  // Safety timeout to avoid indefinite waiting if ack is lost or delayed
  useEffect(() => {
    if (!pendingUpdate) return;
    const timeoutId = window.setTimeout(() => {
      setToast({ message: 'Update timed out waiting for backend', type: 'error' });
      setTimeout(() => setToast(null), 5000);
      setEditingCell(prev => (prev ? { ...prev, isUpdating: false, error: 'Update timed out waiting for backend' } : prev));
      setPendingUpdate(null);
    }, 10000);

    return () => window.clearTimeout(timeoutId);
  }, [pendingUpdate]);

  // Save cell edit and execute UPDATE
  const handleSaveCell = useCallback(() => {
    if (!editingCell) return;
    executeCellUpdate(editingCell);
  }, [editingCell, executeCellUpdate]);

  const handleCellContextMenu = useCallback((
    e: React.MouseEvent<HTMLTableCellElement>,
    columnName: string,
    value: unknown,
    rowIndex: number,
    rowKey: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setCellContextMenu({
      position: { x: e.clientX, y: e.clientY },
      rowIndex,
      rowKey,
      columnName,
      value,
    });
  }, [editingCell, tableName, tableSchema, page, pageSize, sortedRows, primaryKeyColumns, buildingId, dbState.activeConnectionId, dbState.activeDatabase]);

  const cellContextMenuActions = useMemo<ContextMenuAction[]>(() => {
    if (!cellContextMenu) return [];
    const actionsDisabled = !canEdit || !!editingCell || !!pendingUpdate || !tableName || !tableSchema || !dbState.activeConnectionId || !dbState.activeDatabase;

    return [
      {
        id: 'editability',
        label: canEdit ? 'Cell actions' : editStatusText,
        icon: canEdit ? '▣' : 'ℹ',
        disabled: true,
        onClick: () => {},
      },
      {
        id: 'divider-1',
        label: '',
        divider: true,
        onClick: () => {},
      },
      {
        id: 'edit-cell',
        label: 'Edit Cell',
        icon: '✏️',
        disabled: actionsDisabled,
        onClick: () => {
          setEditingCell({
            rowIndex: cellContextMenu.rowIndex,
            rowKey: cellContextMenu.rowKey,
            columnName: cellContextMenu.columnName,
            originalValue: cellContextMenu.value,
            currentValue: getEditorValue(cellContextMenu.columnName, cellContextMenu.value),
            isUpdating: false,
          });
        },
      },
      {
        id: 'set-null',
        label: 'Set NULL',
        icon: '∅',
        disabled: actionsDisabled || cellContextMenu.value === null,
        onClick: () => {
          executeCellUpdate({
            rowIndex: cellContextMenu.rowIndex,
            rowKey: cellContextMenu.rowKey,
            columnName: cellContextMenu.columnName,
            originalValue: cellContextMenu.value,
            currentValue: null,
            isUpdating: false,
          });
        },
      },
    ];
  }, [cellContextMenu, canEdit, editingCell, pendingUpdate, tableName, tableSchema, dbState.activeConnectionId, dbState.activeDatabase, editStatusText, executeCellUpdate, getEditorValue]);

  // Handle keyboard in edit mode
  const handleCellKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveCell();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
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
      if (e.key === 'Escape') {
        e.stopPropagation();
        setCellDetail(null);
      }
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

  const editingCellIdentity = editingCell ? `${editingCell.rowKey}:${editingCell.columnName}` : null;

  // Focus and select input only when a new cell enters edit mode
  useEffect(() => {
    if (editInputRef.current && editingCellIdentity) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCellIdentity]);

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
          <span
            className={`results-table__edit-status ${canEdit ? 'results-table__edit-status--editable' : 'results-table__edit-status--readonly'}`}
            title={editStatusText}
          >
            {editStatusText}
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
                  // Check if this cell was updated
                  const rowKey = JSON.stringify(Object.fromEntries(
                    primaryKeyColumns.map(pkCol => [pkCol, row[pkCol]])
                  ));
                  const isEditing = editingCell?.rowKey === rowKey && editingCell?.columnName === col;
                  const updatedRowData = updatedRows.get(rowKey);
                  const displayValue = updatedRowData ? updatedRowData[col] : row[col];

                  return (
                    <td
                      key={col}
                      className={`results-table__cell ${isEditing ? 'results-table__cell--editing' : ''} ${canEdit ? 'results-table__cell--editable' : ''} ${updatedRowData && updatedRowData[col] !== row[col] ? 'results-table__cell--updated' : ''}`}
                      onClick={() => handleCellClick(col, displayValue, rowIndex, rowKey)}
                      onDoubleClick={() => handleCellDoubleClick(col, displayValue)}
                      onContextMenu={(e) => handleCellContextMenu(e, col, displayValue, rowIndex, rowKey)}
                    >
                      {isEditing ? (
                        <div className="results-table__cell-input-wrapper">
                          {isDateTimeType(columnTypeMap.get(editingCell.columnName)) ? (
                            <DatePicker
                              selected={parseDateTimeValue(editingCell.currentValue)}
                              onChange={(date: Date | null | [Date | null, Date | null]) => {
                                const selectedDate = Array.isArray(date) ? date[0] : date;
                                setEditingCell(prev =>
                                  prev
                                    ? { ...prev, currentValue: selectedDate ? formatDateTimeForSql(selectedDate) : '' }
                                    : null
                                );
                              }}
                              onCalendarClose={handleSaveCell}
                              showTimeSelect
                              showTimeInput
                              timeIntervals={1}
                              timeFormat="HH:mm:ss"
                              dateFormat="yyyy-MM-dd HH:mm:ss"
                              className="results-table__cell-input results-table__cell-input--datetime"
                              disabled={editingCell.isUpdating}
                              placeholderText="Select date and time"
                              autoFocus
                            />
                          ) : (
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
                          )}
                          {editingCell.isUpdating && (
                            <span className="results-table__cell-feedback results-table__cell-feedback--loading">⏳</span>
                          )}
                          {editingCell.error && (
                            <button
                              type="button"
                              className="results-table__cell-feedback results-table__cell-feedback--error results-table__cell-feedback-btn"
                              title={`${editingCell.error}. Click to cancel editing.`}
                              onMouseDown={(e) => {
                                // Prevent input blur from re-triggering save while cancelling.
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingCell(null);
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ) : (
                        formatValue(displayValue)
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
                        const rowKey = JSON.stringify(Object.fromEntries(
                          primaryKeyColumns.map(pkCol => [pkCol, row[pkCol]])
                        ));
                        setEditingCell({
                          rowIndex,
                          rowKey,
                          columnName: cellDetail.column,
                          originalValue: cellDetail.value,
                          currentValue: getEditorValue(cellDetail.column, cellDetail.value),
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

      {/* Toast notification */}
      {toast && (
        <div className={`results-table__toast results-table__toast--${toast.type}`}>
          {toast.message}
        </div>
      )}

      {/* Executed query log */}
      {executedQuery && (
        <div className="results-table__query-log">
          <div className="results-table__query-log-label">Executed Query:</div>
          <code className="results-table__query-log-code">{executedQuery}</code>
        </div>
      )}

      <ContextMenu
        isOpen={cellContextMenu !== null}
        position={cellContextMenu?.position ?? { x: 0, y: 0 }}
        worldPosition={{ x: 0, z: 0 }}
        actions={cellContextMenuActions}
        onClose={() => setCellContextMenu(null)}
      />
    </div>
  );
};
