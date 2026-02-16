/**
 * QueryHistoryPanel
 *
 * Displays query history with favorites and search functionality.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueryHistoryEntry } from '../../../shared/types';
import { store } from '../../store';
import './QueryHistoryPanel.scss';

interface QueryHistoryPanelProps {
  buildingId: string;
  history: QueryHistoryEntry[];
  onLoadQuery: (query: string) => void;
}

export const QueryHistoryPanel: React.FC<QueryHistoryPanelProps> = ({
  buildingId,
  history,
  onLoadQuery,
}) => {
  const { t } = useTranslation(['terminal']);
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Filter history
  const filteredHistory = useMemo(() => {
    let filtered = history;

    if (showFavoritesOnly) {
      filtered = filtered.filter(h => h.favorite);
    }

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(h =>
        h.query.toLowerCase().includes(searchLower) ||
        h.database.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  }, [history, showFavoritesOnly, search]);

  // Format date
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 24 hours - show time
    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Less than 7 days - show day and time
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString([], { weekday: 'short' }) + ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Otherwise show date
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Toggle favorite
  const handleToggleFavorite = useCallback((queryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    store.toggleQueryFavorite(buildingId, queryId);
  }, [buildingId]);

  // Delete from history
  const handleDelete = useCallback((queryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    store.deleteQueryFromHistory(buildingId, queryId);
  }, [buildingId]);

  // Clear all history
  const handleClearAll = useCallback(() => {
    if (confirm(t('terminal:database.confirmClearHistory'))) {
      store.clearQueryHistory(buildingId);
    }
  }, [buildingId, t]);

  if (history.length === 0) {
    return (
      <div className="query-history query-history--empty">
        <p>{t('terminal:database.noHistory')}</p>
        <p>{t('terminal:database.queriesAppearHere')}</p>
      </div>
    );
  }

  return (
    <div className="query-history">
      {/* Toolbar */}
      <div className="query-history__toolbar">
        <input
          type="text"
          className="query-history__search"
          placeholder={t('terminal:database.searchQueries')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <label className="query-history__filter">
          <input
            type="checkbox"
            checked={showFavoritesOnly}
            onChange={(e) => setShowFavoritesOnly(e.target.checked)}
          />
          {t('terminal:database.favoritesOnly')}
        </label>

        <button
          className="query-history__clear"
          onClick={handleClearAll}
          title={t('terminal:database.clearAll')}
        >
          {t('terminal:database.clearAll')}
        </button>
      </div>

      {/* History list */}
      <div className="query-history__list">
        {filteredHistory.map(entry => (
          <div
            key={entry.id}
            className={`query-history__item ${entry.status === 'error' ? 'query-history__item--error' : ''}`}
            onClick={() => onLoadQuery(entry.query)}
          >
            <div className="query-history__item-header">
              <span className={`query-history__status ${entry.status === 'success' ? 'query-history__status--success' : 'query-history__status--error'}`}>
                {entry.status === 'success' ? '✓' : '✗'}
              </span>
              <span className="query-history__database">
                {entry.database}
              </span>
              <span className="query-history__date">
                {formatDate(entry.executedAt)}
              </span>
              <span className="query-history__duration">
                {entry.duration}ms
              </span>
              {entry.rowCount !== undefined && (
                <span className="query-history__row-count">
                  {t('terminal:database.rowCount', { count: entry.rowCount })}
                </span>
              )}
            </div>

            <div className="query-history__query">
              <code>{entry.query.length > 200 ? entry.query.substring(0, 200) + '...' : entry.query}</code>
            </div>

            {entry.error && (
              <div className="query-history__error">
                {entry.error}
              </div>
            )}

            <div className="query-history__actions">
              <button
                className={`query-history__favorite ${entry.favorite ? 'query-history__favorite--active' : ''}`}
                onClick={(e) => handleToggleFavorite(entry.id, e)}
                title={entry.favorite ? t('terminal:database.removeFromFavorites') : t('terminal:database.addToFavorites')}
              >
                {entry.favorite ? '★' : '☆'}
              </button>
              <button
                className="query-history__delete"
                onClick={(e) => handleDelete(entry.id, e)}
                title={t('terminal:database.deleteFromHistory')}
              >
                🗑
              </button>
            </div>
          </div>
        ))}

        {filteredHistory.length === 0 && (
          <div className="query-history__no-results">
            {t('terminal:database.noQueriesMatch')}
          </div>
        )}
      </div>
    </div>
  );
};
