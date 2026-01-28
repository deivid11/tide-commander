/**
 * ResultsTable
 *
 * Displays query results in a paginated, sortable table with pretty formatting.
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { QueryResult } from '../../../shared/types';
import './ResultsTable.scss';

interface ResultsTableProps {
  result: QueryResult;
  buildingId: string;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];
const DEFAULT_PAGE_SIZE = 50;

export const ResultsTable: React.FC<ResultsTableProps> = ({ result, buildingId }) => {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Error display
  if (result.status === 'error') {
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

  // No rows (INSERT/UPDATE/DELETE result)
  if (!result.rows || result.rows.length === 0) {
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

  // Sort rows
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
  const columns = result.fields?.map(f => f.name) ?? Object.keys(result.rows[0] || {});

  // Handle sort
  const handleSort = useCallback((column: string) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

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
        <table className="results-table__table">
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
                  >
                    <span className="results-table__header-name">{col}</span>
                    {isSorted && (
                      <span className="results-table__sort-indicator">
                        {sortDirection === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
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
                  <td key={col} className="results-table__cell">
                    {formatValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
