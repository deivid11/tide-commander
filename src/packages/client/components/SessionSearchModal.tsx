/**
 * SessionSearchModal — global, cross-project session finder.
 *
 * Lists every Claude session under ~/.claude/projects/, supports full-text
 * search across all of them, lets the user preview the messages of a chosen
 * session, then attaches it onto any agent (defaulting to the currently
 * selected one). The attach goes through the existing `restore_session`
 * WebSocket flow with an optional `cwd` for cross-project restore.
 */

import React, { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ModalPortal } from './shared/ModalPortal';
import { Icon } from './Icon';
import { AgentIcon } from './AgentIcon';
import type { Agent } from '../../shared/types';
import { store, useStore } from '../store';
import {
  fetchGlobalSessions,
  searchGlobalSessions,
  previewGlobalSession,
  type GlobalSessionRow,
  type GlobalSessionMatch,
  type SessionPreviewMessage,
} from '../api/sessions';
import '../styles/components/session-search-modal.scss';

export interface SessionSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-selected target agent. Defaults to the user's currently selected agent. */
  initialAgentId?: string;
}

interface ResultRow {
  sessionId: string;
  projectPath: string;
  projectDir: string;
  lastModified: string;
  firstPrompt: string;
  // search-only fields
  totalMatches?: number;
  snippet?: string;
}

function formatDate(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortenSessionId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

const MAX_PREVIEW_MESSAGES = 500;
const TOOL_INPUT_MAX_CHARS = 1200;
const TOOL_RESULT_MAX_CHARS = 2000;
const MESSAGE_MAX_CHARS = 4000;

function formatToolInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n… (${text.length - max} more chars)`;
}

interface HighlightSegment {
  type: 'text' | 'match';
  text: string;
  matchIdx?: number;
}

/**
 * Splits `text` at every case-insensitive occurrence of `query`, returning
 * alternating text/match segments. Each match segment carries a globally-unique
 * `matchIdx` produced by the caller via the `nextIdx` getter so the surrounding
 * navigator can map indexes to DOM refs.
 */
function splitForHighlight(text: string, query: string, getNextIdx: () => number): HighlightSegment[] {
  if (!query) return [{ type: 'text', text }];
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const out: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const found = lower.indexOf(ql, cursor);
    if (found < 0) {
      out.push({ type: 'text', text: text.slice(cursor) });
      break;
    }
    if (found > cursor) {
      out.push({ type: 'text', text: text.slice(cursor, found) });
    }
    out.push({ type: 'match', text: text.slice(found, found + query.length), matchIdx: getNextIdx() });
    cursor = found + query.length;
  }
  return out;
}

export const SessionSearchModal = memo(function SessionSearchModal({
  isOpen,
  onClose,
  initialAgentId,
}: SessionSearchModalProps) {
  const state = useStore();
  const agents = useMemo(
    () => Array.from(state.agents.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [state.agents]
  );
  const defaultSelectedAgentId = useMemo(() => {
    if (initialAgentId && state.agents.has(initialAgentId)) return initialAgentId;
    const ids = Array.from(state.selectedAgentIds);
    if (ids.length > 0 && state.agents.has(ids[0])) return ids[0];
    return agents[0]?.id ?? '';
  }, [initialAgentId, state.agents, state.selectedAgentIds, agents]);

  const [targetAgentId, setTargetAgentId] = useState(defaultSelectedAgentId);
  const [query, setQuery] = useState('');
  const [cwdFilter, setCwdFilter] = useState('');
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // `${cwd}::${sessionId}`
  const [previewMessages, setPreviewMessages] = useState<SessionPreviewMessage[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchRefs = useRef<HTMLElement[]>([]);
  const previewMessagesRef = useRef<HTMLDivElement | null>(null);

  const targetAgent = state.agents.get(targetAgentId);
  const selectedRow = useMemo(
    () => results.find((r) => `${r.projectPath}::${r.sessionId}` === selectedKey) || null,
    [results, selectedKey]
  );

  // Map sessionId -> agent currently using that session, so each result row
  // can show "Attached to <agent>". Only one agent has any given session as
  // current at a time, so a one-to-one map is fine.
  const sessionToAgent = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of state.agents.values()) {
      if (a.sessionId) map.set(a.sessionId, a);
    }
    return map;
  }, [state.agents]);

  // Reset agent target when modal reopens
  useEffect(() => {
    if (isOpen) {
      setTargetAgentId(defaultSelectedAgentId);
      setRestoreSuccess(null);
    }
  }, [isOpen, defaultSelectedAgentId]);

  const runFetch = useCallback(async () => {
    setError(null);
    setLoading(true);
    setRestoreSuccess(null);
    try {
      if (query.trim()) {
        const matches = await searchGlobalSessions(query, {
          limit: 200,
          cwdFilter: cwdFilter.trim() || undefined,
        });
        setResults(
          matches.map((m: GlobalSessionMatch) => ({
            sessionId: m.sessionId,
            projectPath: m.projectPath,
            projectDir: m.projectDir,
            lastModified: m.lastModified,
            firstPrompt: m.firstPrompt,
            totalMatches: m.totalMatches,
            snippet: m.snippet,
          }))
        );
      } else {
        const rows = await fetchGlobalSessions({ limit: 300 });
        const filtered = cwdFilter.trim()
          ? rows.filter((r) => r.projectPath.toLowerCase().includes(cwdFilter.trim().toLowerCase()))
          : rows;
        setResults(
          filtered.map((r: GlobalSessionRow) => ({
            sessionId: r.sessionId,
            projectPath: r.projectPath,
            projectDir: r.projectDir,
            lastModified: r.lastModified,
            firstPrompt: r.firstPrompt,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, cwdFilter]);

  // Initial load + debounced refetch on query/cwdFilter change
  useEffect(() => {
    if (!isOpen) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => { void runFetch(); }, query || cwdFilter ? 250 : 0);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [isOpen, runFetch, query, cwdFilter]);

  // Load preview when selected row changes
  useEffect(() => {
    if (!selectedRow || !selectedRow.projectPath) {
      setPreviewMessages([]);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewMessages([]);
    setCurrentMatchIdx(0);
    previewGlobalSession(selectedRow.projectPath, selectedRow.sessionId, MAX_PREVIEW_MESSAGES)
      .then((data) => {
        if (cancelled) return;
        setPreviewMessages(data.messages);
      })
      .catch(() => { if (!cancelled) setPreviewMessages([]); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRow]);

  // Reset match cursor when query changes
  useEffect(() => {
    setCurrentMatchIdx(0);
  }, [query, previewMessages]);

  // Scroll the active match into view + apply 'current' class
  useLayoutEffect(() => {
    const els = matchRefs.current;
    els.forEach((el, i) => {
      if (!el) return;
      el.classList.toggle('current', i === currentMatchIdx);
    });
    const el = els[currentMatchIdx];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentMatchIdx, previewMessages, query]);

  // Count matches synchronously so the navigator can show "n/m" as soon as the
  // user types — without waiting for the child's ref array to populate.
  const totalMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    let count = 0;
    for (const m of previewMessages) {
      let text = m.content || '';
      if (m.type === 'tool_use') {
        const args = formatToolInput(m.toolInput);
        if (args) text = args;
      }
      const lower = text.toLowerCase();
      let idx = 0;
      while ((idx = lower.indexOf(q, idx)) !== -1) {
        count++;
        idx += q.length;
      }
    }
    return count;
  }, [previewMessages, query]);

  const goPrev = useCallback(() => {
    if (totalMatches === 0) return;
    setCurrentMatchIdx((i) => (i - 1 + totalMatches) % totalMatches);
  }, [totalMatches]);
  const goNext = useCallback(() => {
    if (totalMatches === 0) return;
    setCurrentMatchIdx((i) => (i + 1) % totalMatches);
  }, [totalMatches]);

  const handleRestore = useCallback(() => {
    if (!selectedRow || !targetAgent) return;
    const needsCwdSwap = selectedRow.projectPath && selectedRow.projectPath !== targetAgent.cwd;
    store.restoreSession(
      targetAgent.id,
      selectedRow.sessionId,
      needsCwdSwap ? selectedRow.projectPath : undefined
    );
    setRestoreSuccess(
      needsCwdSwap
        ? `Restored on ${targetAgent.name} (cwd → ${selectedRow.projectPath})`
        : `Restored on ${targetAgent.name}`
    );
  }, [selectedRow, targetAgent]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if ((e.key === 'F3' || (e.key === 'g' && (e.ctrlKey || e.metaKey))) && totalMatches > 0) {
      e.preventDefault();
      if (e.shiftKey) {
        goPrev();
      } else {
        goNext();
      }
    }
  };

  if (!isOpen) return null;

  const cwdMismatch =
    selectedRow && targetAgent && selectedRow.projectPath && selectedRow.projectPath !== targetAgent.cwd;

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onClick={onClose}>
        <div className="session-finder-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
          <div className="modal-header">
            <h2>
              <Icon name="search" size={14} /> Session Finder
            </h2>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="session-finder-toolbar">
            <div className="session-finder-search-row">
              <div className="session-finder-input-wrap">
                <Icon name="search" size={12} />
                <input
                  className="session-finder-input"
                  type="text"
                  placeholder="Search across ALL sessions (text, tool args, prompts)…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
                {query && (
                  <button className="session-finder-clear" onClick={() => setQuery('')} aria-label="Clear">
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
              <div className="session-finder-input-wrap session-finder-cwd-wrap">
                <input
                  className="session-finder-input"
                  type="text"
                  placeholder="Filter by project path… (e.g. /home/riven/d/pagamento)"
                  value={cwdFilter}
                  onChange={(e) => setCwdFilter(e.target.value)}
                />
                {cwdFilter && (
                  <button className="session-finder-clear" onClick={() => setCwdFilter('')} aria-label="Clear">
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            </div>
            <div className="session-finder-target-row">
              <label className="session-finder-target-label">Restore to:</label>
              <AgentPicker
                agents={agents}
                value={targetAgentId}
                onChange={setTargetAgentId}
              />
            </div>
          </div>

          <div className="session-finder-body">
            <div className="session-finder-list">
              {loading && (
                <div className="session-finder-loading"><div className="spinner" /> Loading…</div>
              )}
              {error && (
                <div className="session-finder-error"><Icon name="warn" size={12} /> {error}</div>
              )}
              {!loading && !error && results.length === 0 && (
                <div className="session-finder-empty">
                  {query ? 'No matches.' : 'No sessions found.'}
                </div>
              )}
              {!loading && results.map((row) => {
                const key = `${row.projectPath}::${row.sessionId}`;
                const isSelected = key === selectedKey;
                const attachedAgent = sessionToAgent.get(row.sessionId);
                return (
                  <button
                    key={key}
                    className={`session-finder-result ${isSelected ? 'active' : ''} ${attachedAgent ? 'attached' : ''}`}
                    onClick={() => setSelectedKey(key)}
                    type="button"
                  >
                    <div className="session-finder-result-top">
                      <span className="session-finder-result-cwd" title={row.projectPath || row.projectDir}>
                        {row.projectPath || `(unrecoverable cwd) ${row.projectDir}`}
                      </span>
                      <span className="session-finder-result-date">{formatDate(row.lastModified)}</span>
                    </div>
                    <div className="session-finder-result-mid">
                      <code className="session-finder-result-id">{shortenSessionId(row.sessionId)}</code>
                      {row.totalMatches !== undefined && (
                        <span className="session-finder-result-hits">{row.totalMatches} hits</span>
                      )}
                      {attachedAgent && (
                        <span
                          className="session-finder-result-attached"
                          title={`Currently attached to ${attachedAgent.name}`}
                        >
                          <AgentIcon agent={attachedAgent} size={12} />
                          <span>{attachedAgent.name}</span>
                        </span>
                      )}
                    </div>
                    {row.snippet ? (
                      <div className="session-finder-result-snippet">{row.snippet}</div>
                    ) : (
                      row.firstPrompt && <div className="session-finder-result-snippet muted">{row.firstPrompt}</div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="session-finder-preview">
              {!selectedRow && (
                <div className="session-finder-preview-empty">
                  <Icon name="info" size={16} />
                  <span>Select a session to preview its conversation</span>
                </div>
              )}
              {selectedRow && (
                <>
                  <div className="session-finder-preview-header">
                    <div className="session-finder-preview-title" title={selectedRow.projectPath}>
                      {selectedRow.projectPath || selectedRow.projectDir}
                    </div>
                    {sessionToAgent.get(selectedRow.sessionId) && (() => {
                      const att = sessionToAgent.get(selectedRow.sessionId)!;
                      return (
                        <span className="session-finder-result-attached" title={`Currently attached to ${att.name}`}>
                          <AgentIcon agent={att} size={12} />
                          <span>{att.name}</span>
                        </span>
                      );
                    })()}
                    {query && (
                      <div className="session-finder-match-nav" role="group" aria-label="Match navigator">
                        <button
                          className="session-finder-match-btn"
                          onClick={goPrev}
                          disabled={totalMatches === 0}
                          aria-label="Previous match"
                          title="Previous match (Shift+F3)"
                        >
                          <Icon name="arrow-up" size={11} />
                        </button>
                        <span className="session-finder-match-count">
                          {totalMatches === 0 ? '0/0' : `${currentMatchIdx + 1}/${totalMatches}`}
                        </span>
                        <button
                          className="session-finder-match-btn"
                          onClick={goNext}
                          disabled={totalMatches === 0}
                          aria-label="Next match"
                          title="Next match (F3)"
                        >
                          <Icon name="arrow-down" size={11} />
                        </button>
                      </div>
                    )}
                    <code className="session-finder-preview-id">{selectedRow.sessionId}</code>
                  </div>
                  {previewLoading ? (
                    <div className="session-finder-loading"><div className="spinner" /> Loading messages…</div>
                  ) : previewMessages.length === 0 ? (
                    <div className="session-finder-preview-empty">No messages found.</div>
                  ) : (
                    <PreviewMessages
                      messages={previewMessages}
                      query={query}
                      matchRefs={matchRefs}
                      messagesContainerRef={previewMessagesRef}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="modal-footer session-finder-footer">
            <div className="session-finder-footer-info">
              {results.length > 0 && (
                <span>{results.length} session{results.length === 1 ? '' : 's'}</span>
              )}
              {restoreSuccess && (
                <span className="session-finder-restore-success">
                  <Icon name="check" size={12} /> {restoreSuccess}
                </span>
              )}
              {cwdMismatch && (
                <span className="session-finder-cwd-warn" title="Restoring will switch the agent's working directory">
                  <Icon name="warn" size={12} /> cwd will change
                </span>
              )}
            </div>
            <div className="session-finder-footer-actions">
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
              <button
                className="btn btn-primary"
                onClick={handleRestore}
                disabled={!selectedRow || !targetAgent}
              >
                Restore{targetAgent ? ` to ${targetAgent.name}` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
});

// ============================================================================
// AgentPicker — searchable combobox with agent icons
// ============================================================================

interface AgentPickerProps {
  agents: Agent[];
  value: string;
  onChange: (id: string) => void;
}

const AgentPicker = memo(function AgentPicker({ agents, value, onChange }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = agents.find((a) => a.id === value);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(f) || (a.cwd ?? '').toLowerCase().includes(f)
    );
  }, [agents, filter]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Auto-focus the search input on open
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setFilter('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setFilter('');
      return;
    }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      handleSelect(filtered[0].id);
    }
  };

  return (
    <div className="agent-picker" ref={rootRef}>
      <button
        type="button"
        className="agent-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selected ? (
          <>
            <AgentIcon agent={selected} size={16} />
            <span className="agent-picker-name">{selected.name}</span>
            <span className="agent-picker-cwd">{selected.cwd}</span>
          </>
        ) : (
          <span className="agent-picker-empty-label">Select an agent…</span>
        )}
        <Icon name={open ? 'caret-up' : 'caret-down'} size={10} />
      </button>
      {open && (
        <div className="agent-picker-dropdown" role="listbox">
          <div className="agent-picker-search">
            <Icon name="search" size={11} />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search agents by name or path…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            {filter && (
              <button
                type="button"
                className="agent-picker-clear"
                onClick={() => { setFilter(''); inputRef.current?.focus(); }}
                aria-label="Clear filter"
              >
                <Icon name="close" size={10} />
              </button>
            )}
          </div>
          <div className="agent-picker-list">
            {filtered.length === 0 ? (
              <div className="agent-picker-no-match">No agents match "{filter}"</div>
            ) : (
              filtered.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`agent-picker-item ${a.id === value ? 'active' : ''}`}
                  onClick={() => handleSelect(a.id)}
                  role="option"
                  aria-selected={a.id === value}
                >
                  <AgentIcon agent={a} size={18} />
                  <div className="agent-picker-item-info">
                    <span className="agent-picker-item-name">{a.name}</span>
                    <span className="agent-picker-item-cwd">{a.cwd}</span>
                  </div>
                  {a.id === value && <Icon name="check" size={12} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ============================================================================
// PreviewMessages — full conversation with match highlighting
// ============================================================================

interface PreviewMessagesProps {
  messages: SessionPreviewMessage[];
  query: string;
  matchRefs: React.MutableRefObject<HTMLElement[]>;
  messagesContainerRef: React.MutableRefObject<HTMLDivElement | null>;
}

const PreviewMessages = memo(function PreviewMessages({
  messages,
  query,
  matchRefs,
  messagesContainerRef,
}: PreviewMessagesProps) {
  // Build the complete render tree once per (messages, query) change. We
  // accumulate match refs in a fresh array and assign it on render so the
  // surrounding nav can scroll to the right element.
  const trimmedQuery = query.trim();
  const collected: HTMLElement[] = [];
  let runningMatchIdx = 0;
  const getNextIdx = () => runningMatchIdx++;

  const assignRef = (idx: number) => (el: HTMLElement | null) => {
    if (el) collected[idx] = el;
  };

  const renderText = (text: string) => {
    if (!trimmedQuery) {
      return <>{text}</>;
    }
    const segments = splitForHighlight(text, trimmedQuery, getNextIdx);
    return (
      <>
        {segments.map((seg, i) =>
          seg.type === 'match' && seg.matchIdx !== undefined ? (
            <mark
              key={i}
              ref={assignRef(seg.matchIdx)}
              className="session-finder-mark"
              data-match-idx={seg.matchIdx}
            >
              {seg.text}
            </mark>
          ) : (
            <Fragment key={i}>{seg.text}</Fragment>
          )
        )}
      </>
    );
  };

  // After render, swap the parent ref to the freshly built array so the
  // navigator picks up the new DOM elements.
  useLayoutEffect(() => {
    matchRefs.current = collected;
    // Hint to React-DOM that we changed an external ref — no state update needed.
  });

  return (
    <div className="session-finder-preview-messages" ref={messagesContainerRef}>
      {messages.map((m, i) => {
        if (m.type === 'tool_use') {
          const args = formatToolInput(m.toolInput) || m.content;
          const clipped = clip(args, TOOL_INPUT_MAX_CHARS);
          return (
            <div key={i} className="session-finder-msg tool-use">
              <div className="session-finder-msg-role">
                <span className="session-finder-msg-tool">{m.toolName || 'Tool'}</span>
                <span className="session-finder-msg-tool-tag">tool_use</span>
              </div>
              {clipped && <pre className="session-finder-msg-text mono">{renderText(clipped)}</pre>}
            </div>
          );
        }
        if (m.type === 'tool_result') {
          const clipped = clip(m.content || '(no output)', TOOL_RESULT_MAX_CHARS);
          return (
            <div key={i} className="session-finder-msg tool-result">
              <div className="session-finder-msg-role">
                <span className="session-finder-msg-tool">{m.toolName || 'Result'}</span>
                <span className="session-finder-msg-tool-tag muted">tool_result</span>
              </div>
              <pre className="session-finder-msg-text mono">{renderText(clipped)}</pre>
            </div>
          );
        }
        const clipped = clip(m.content || '', MESSAGE_MAX_CHARS);
        return (
          <div key={i} className={`session-finder-msg ${m.type}`}>
            <div className="session-finder-msg-role">
              {m.type === 'user' ? 'YOU' : 'AGENT'}
            </div>
            <div className="session-finder-msg-text">{renderText(clipped)}</div>
          </div>
        );
      })}
    </div>
  );
});
