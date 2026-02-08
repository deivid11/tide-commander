/**
 * ResultsTable
 *
 * Displays query results in a paginated, sortable table with pretty formatting.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { QueryResult } from '../../../shared/types';
import './ResultsTable.scss';

interface ResultsTableProps {
  result: QueryResult;
  buildingId: string;
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

export const ResultsTable: React.FC<ResultsTableProps> = ({ result, buildingId: _buildingId }) => {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [cellDetail, setCellDetail] = useState<{ column: string; value: unknown } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const detailRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<{ column: string; startX: number; startWidth: number } | null>(null);
  const didResizeRef = useRef(false);

  const isError = result.status === 'error';
  const isEmpty = !result.rows || result.rows.length === 0;

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
            Query Error
          </div>
          <div className="results-table__error-message">
            {result.error}
          </div>
          {result.errorCode && (
            <div className="results-table__error-code">
              Error Code: {result.errorCode}
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
          Query executed successfully
          {result.affectedRows !== undefined && (
            <span className="results-table__affected">
              {result.affectedRows} row(s) affected
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
            {result.rowCount?.toLocaleString()} row(s)
          </span>
          <span className="results-table__duration">
            {result.duration}ms
          </span>
          <button
            className={`results-table__copy-btn ${copyFeedback ? 'results-table__copy-btn--success' : ''}`}
            onClick={handleCopyAll}
            title="Copy all results as table"
          >
            {copyFeedback ? '✓ Copied' : '⧉ Copy All'}
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
              <option key={size} value={size}>{size} rows</option>
            ))}
          </select>

          <button
            className="results-table__page-btn"
            disabled={page === 0}
            onClick={() => setPage(0)}
            title="First page"
          >
            &laquo;
          </button>
          <button
            className="results-table__page-btn"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            title="Previous page"
          >
            &lsaquo;
          </button>
          <span className="results-table__page-info">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="results-table__page-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            title="Next page"
          >
            &rsaquo;
          </button>
          <button
            className="results-table__page-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(totalPages - 1)}
            title="Last page"
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
                {columns.map(col => (
                  <td
                    key={col}
                    className="results-table__cell"
                    onClick={() => handleCellClick(col, row[col])}
                  >
                    {formatValue(row[col])}
                  </td>
                ))}
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
              <button
                className="results-table__detail-close"
                onClick={() => setCellDetail(null)}
              >
                ✕
              </button>
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
