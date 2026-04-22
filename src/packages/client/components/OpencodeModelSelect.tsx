/**
 * OpencodeModelSelect
 * Searchable combobox for picking an opencode model. The list is fetched from
 * the local `opencode` CLI via /api/agents/opencode/models. Users can also
 * type a custom value (e.g., a private model id) that is not in the list.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchOpencodeModels } from '../api/opencode';
import { Icon } from './Icon';
import '../styles/components/opencode-model-select.scss';

interface OpencodeModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Distinct id helps when multiple selects render on the same page. */
  inputId?: string;
}

export function OpencodeModelSelect({
  value,
  onChange,
  placeholder = 'provider/model (e.g., opencode/gpt-5-nano)',
  inputId,
}: OpencodeModelSelectProps) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const loadModels = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetchOpencodeModels(refresh);
      setModels(res.models);
    } catch (err: any) {
      setError(err?.message || 'Failed to load models');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadModels(false);
  }, [loadModels]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, query]);

  // Keep highlight in range when filter changes
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(`li[data-idx="${highlight}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const commit = useCallback((v: string) => {
    onChange(v);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }, [onChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlight]) {
        commit(filtered[highlight]);
      } else if (query.trim()) {
        commit(query.trim());
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const displayValue = open ? query : value;

  return (
    <div className="opencode-model-select" ref={wrapperRef}>
      <div className="opencode-model-select__field">
        <span className="opencode-model-select__icon" aria-hidden>
          <Icon name="search" size={14} />
        </span>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          className="opencode-model-select__input"
          value={displayValue}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="opencode-model-select__refresh"
          onClick={(e) => {
            e.preventDefault();
            loadModels(true);
          }}
          title="Refresh models from opencode CLI"
          disabled={refreshing}
        >
          <span className={refreshing ? 'spin' : ''}>
            <Icon name="refresh" size={14} />
          </span>
        </button>
      </div>

      {open && (
        <div className="opencode-model-select__dropdown">
          {loading && (
            <div className="opencode-model-select__status">Loading models…</div>
          )}
          {error && !loading && (
            <div className="opencode-model-select__status opencode-model-select__status--error">
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="opencode-model-select__status">
              {query.trim()
                ? <>No matches. Press Enter to use <code>{query.trim()}</code></>
                : 'No models returned by opencode CLI'}
            </div>
          )}
          {!loading && filtered.length > 0 && (
            <ul className="opencode-model-select__list" ref={listRef} role="listbox">
              {filtered.map((m, idx) => {
                const [provider, ...rest] = m.split('/');
                const modelName = rest.join('/');
                const isSelected = m === value;
                const isActive = idx === highlight;
                return (
                  <li
                    key={m}
                    data-idx={idx}
                    role="option"
                    aria-selected={isSelected}
                    className={[
                      'opencode-model-select__option',
                      isActive ? 'is-active' : '',
                      isSelected ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseEnter={() => setHighlight(idx)}
                    onMouseDown={(e) => {
                      // mousedown so it fires before input blur
                      e.preventDefault();
                      commit(m);
                    }}
                  >
                    <span className="opencode-model-select__provider">{provider}/</span>
                    <span className="opencode-model-select__model">{modelName}</span>
                    {isSelected && (
                      <span className="opencode-model-select__check" aria-hidden>
                        <Icon name="check" size={12} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="opencode-model-select__footer">
            <span>
              {models.length > 0
                ? `${filtered.length} of ${models.length}`
                : ''}
            </span>
            <span className="opencode-model-select__hint">
              ↑↓ navigate · Enter select · Esc close
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
