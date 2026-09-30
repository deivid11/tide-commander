/**
 * SearchableSelect — a native-looking dropdown whose list can be filtered by
 * typing. For long option lists (areas, projects) where a plain <select> makes
 * the user scroll to find one entry.
 *
 * Keyboard: typing filters, ↑/↓ move, Enter picks, Escape closes.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  /** Options pinned above the filtered list and always shown (e.g. "All Areas"). */
  pinnedOptions?: SearchableSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}

/** Accent/case-insensitive match, so "tide" finds "Tide commander" and "telmex" finds "Télmex". */
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function SearchableSelect({
  value,
  options,
  onChange,
  pinnedOptions = [],
  placeholder = 'Search…',
  className = '',
  disabled = false,
  title,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    const matches = needle ? options.filter((option) => fold(option.label).includes(needle)) : options;
    return needle ? matches : [...pinnedOptions, ...matches];
  }, [options, pinnedOptions, query]);

  const selectedLabel = [...pinnedOptions, ...options].find((option) => option.value === value)?.label ?? '';

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pick = (option: SearchableSelectOption) => {
    onChange(option.value);
    close();
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // On open: focus the search box and start on the current value.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const current = visible.findIndex((option) => option.value === value);
    setHighlight(current === -1 ? 0 : current);
    // Only when opening — typing resets the highlight in onChange.
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.searchable-select__option.is-highlighted')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((index) => Math.min(index + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[highlight];
      if (option) pick(option);
    } else if (event.key === 'Escape') {
      // Close the dropdown only, not the modal hosting it.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div ref={rootRef} className={`searchable-select ${className}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="searchable-select__trigger"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        title={title ?? selectedLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="searchable-select__value">{selectedLabel}</span>
        <span className="searchable-select__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="searchable-select__panel" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            className="searchable-select__search"
            value={query}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
          />
          <ul ref={listRef} className="searchable-select__list" role="listbox">
            {visible.length === 0 ? (
              <li className="searchable-select__empty">No matches</li>
            ) : visible.map((option, index) => (
              <li
                key={`${option.value}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`searchable-select__option${index === highlight ? ' is-highlighted' : ''}${option.value === value ? ' is-selected' : ''}`}
                onPointerEnter={() => setHighlight(index)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
              >
                {option.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
