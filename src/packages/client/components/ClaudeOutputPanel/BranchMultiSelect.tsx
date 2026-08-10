/**
 * Multi-select for git branches.
 *
 * A native <select multiple> is unusable here: repos carry hundreds of refs,
 * ctrl-clicking to combine them is hostile, and the control can't be themed.
 * This is a popover with checkboxes, its own filter box, and local/remote
 * grouping — picking three branches is three clicks.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';

export interface BranchOption {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

interface BranchMultiSelectProps {
  branches: BranchOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function BranchMultiSelect({ branches, selected, onChange }: BranchMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Swallow Escape so it closes the popover instead of the whole modal.
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const { local, remote } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (b: BranchOption) => !q || b.name.toLowerCase().includes(q);
    return {
      local: branches.filter((b) => !b.isRemote && match(b)),
      remote: branches.filter((b) => b.isRemote && match(b)),
    };
  }, [branches, query]);

  const toggle = (name: string) => {
    onChange(selected.includes(name)
      ? selected.filter((b) => b !== name)
      : [...selected, name]);
  };

  const label = selected.length === 0
    ? 'All branches'
    : selected.length === 1
      ? selected[0]
      : `${selected.length} branches`;

  const renderGroup = (title: string, list: BranchOption[]) => {
    if (list.length === 0) return null;
    return (
      <>
        <div className="branch-select-group">{title}</div>
        {list.map((b) => (
          <label key={`${b.isRemote ? 'r' : 'l'}:${b.name}`} className="branch-select-item">
            <input
              type="checkbox"
              checked={selected.includes(b.name)}
              onChange={() => toggle(b.name)}
            />
            <span className="branch-select-name" title={b.name}>{b.name}</span>
            {b.isCurrent && <span className="branch-select-current">current</span>}
          </label>
        ))}
      </>
    );
  };

  return (
    <div className="branch-select" ref={rootRef}>
      <button
        type="button"
        className={`branch-select-trigger ${selected.length > 0 ? 'has-selection' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={selected.length > 0 ? selected.join(', ') : 'All branches'}
      >
        <Icon name="git-branch" size={12} />
        <span className="branch-select-label">{label}</span>
        <Icon name={open ? 'caret-up' : 'caret-down'} size={10} />
      </button>

      {open && (
        <div className="branch-select-popover">
          <input
            className="branch-select-search"
            type="text"
            placeholder="Filter branches…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />

          {selected.length > 0 && (
            <button className="branch-select-clear" onClick={() => onChange([])}>
              Clear selection ({selected.length})
            </button>
          )}

          <div className="branch-select-list">
            {local.length === 0 && remote.length === 0 && (
              <div className="branch-select-empty">No branches match.</div>
            )}
            {renderGroup('Local', local)}
            {renderGroup('Remote', remote)}
          </div>
        </div>
      )}
    </div>
  );
}
