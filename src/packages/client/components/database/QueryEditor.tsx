/**
 * QueryEditor
 *
 * SQL query editor with syntax highlighting and execution controls.
 * Supports multiple queries separated by semicolons with run-all or run-at-cursor modes.
 */

import React, { useRef, useCallback, KeyboardEvent, useMemo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import type { TableColumn, TableInfo } from '../../../shared/types';
import { Icon } from '../Icon';
import {
  buildQueryAutocomplete,
  getTextareaCaretCoordinates,
  QueryEditorAutocomplete,
  type QueryAutocompletePosition,
  type QueryAutocompleteSchema,
  type QueryAutocompleteSuggestion,
} from './QueryEditorAutocomplete';
import './QueryEditor.scss';

export type ExecuteMode = 'all' | 'cursor';

interface QueryEditorProps {
  query: string;
  onChange: (query: string) => void;
  onExecute: (mode: ExecuteMode) => void;
  isExecuting: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  tables?: TableInfo[];
  tableSchemas?: Map<string, { columns: TableColumn[] }>;
  onRequestTableSchema?: (tableName: string) => void;
}

/** Split SQL text into individual statements, respecting quotes and comments. */
export function splitQueries(text: string): Array<{ sql: string; start: number; end: number }> {
  const results: Array<{ sql: string; start: number; end: number }> = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let stmtStart = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++; // skip '/'
      }
      continue;
    }
    if (inSingleQuote) {
      if (ch === "'" && next === "'") { i++; continue; } // escaped quote
      if (ch === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"' && next === '"') { i++; continue; }
      if (ch === '"') inDoubleQuote = false;
      continue;
    }

    // Not inside any special context
    if (ch === '-' && next === '-') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === "'") { inSingleQuote = true; continue; }
    if (ch === '"') { inDoubleQuote = true; continue; }

    if (ch === ';') {
      const sql = text.slice(stmtStart, i).trim();
      if (sql) {
        results.push({ sql, start: stmtStart, end: i });
      }
      stmtStart = i + 1;
    }
  }

  // Remaining text after last semicolon
  const remaining = text.slice(stmtStart).trim();
  if (remaining) {
    results.push({ sql: remaining, start: stmtStart, end: text.length });
  }

  return results;
}

/** Get the query statement at the given cursor position. */
export function getQueryAtCursor(text: string, cursorPos: number): string | null {
  const stmts = splitQueries(text);
  if (stmts.length === 0) return null;

  for (const stmt of stmts) {
    if (cursorPos >= stmt.start && cursorPos <= stmt.end) {
      return stmt.sql;
    }
  }
  // If cursor is past all statements (e.g. trailing whitespace), return last
  return stmts[stmts.length - 1].sql;
}

export const QueryEditor: React.FC<QueryEditorProps> = ({
  query,
  onChange,
  onExecute,
  isExecuting,
  disabled,
  autoFocus = true,
  tables = [],
  tableSchemas,
  onRequestTableSchema,
}) => {
  const { t } = useTranslation(['terminal']);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const resizingRef = useRef(false);
  const schemaRequestsRef = useRef<Set<string>>(new Set());

  const LS_KEY = 'query-editor-height';
  const MIN_HEIGHT = 80;
  const MAX_HEIGHT = 800;

  const [editorHeight, setEditorHeight] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const h = Number(stored);
        if (h >= MIN_HEIGHT && h <= MAX_HEIGHT) return h;
      }
    } catch { /* ignore */ }
    return 150;
  });
  const [cursorPosition, setCursorPosition] = useState(0);
  const [caretPosition, setCaretPosition] = useState<QueryAutocompletePosition | null>(null);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] = useState(0);

  // Persist height to localStorage
  const saveHeight = useCallback((h: number) => {
    try { localStorage.setItem(LS_KEY, String(h)); } catch { /* ignore */ }
  }, []);

  // Resize drag handler
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startY = e.clientY;
    const startHeight = editorHeight;

    const onMouseMove = (moveE: MouseEvent) => {
      const delta = moveE.clientY - startY;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + delta));
      setEditorHeight(newHeight);
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Save final height
      const wrapper = textareaRef.current?.parentElement;
      if (wrapper) {
        saveHeight(wrapper.getBoundingClientRect().height);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [editorHeight, saveHeight]);

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && !disabled && textareaRef.current) {
      // Small delay to ensure the modal is fully rendered
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, disabled]);

  // Synchronize textarea scroll with highlight
  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.scrollLeft = textarea.scrollLeft;
      highlightRef.current.scrollTop = textarea.scrollTop;
    }
    setCursorPosition(textarea.selectionStart);
  }, []);

  const updateCursorState = useCallback((textarea: HTMLTextAreaElement, openAutocomplete = true) => {
    setCursorPosition(textarea.selectionStart);
    if (openAutocomplete && !disabled) {
      setAutocompleteOpen(true);
    }
  }, [disabled]);

  useEffect(() => {
    schemaRequestsRef.current.clear();
  }, [tables]);

  // Check if editor has multiple statements
  const hasMultipleQueries = useMemo(() => {
    return splitQueries(query).length > 1;
  }, [query]);

  // Highlight SQL code
  const highlightedCode = useMemo(() => {
    if (!query) return '';
    try {
      return Prism.highlight(query, Prism.languages.sql, 'sql');
    } catch {
      return query;
    }
  }, [query]);

  // Line numbers
  const lineNumbers = useMemo(() => {
    const lines = query.split('\n');
    return lines.map((_, i) => i + 1);
  }, [query]);

  /** Get cursor position from the textarea ref */
  const getCursorPos = useCallback(() => {
    return textareaRef.current?.selectionStart ?? 0;
  }, []);

  const autocompleteSchemas = useMemo(() => {
    const schemas = new Map<string, QueryAutocompleteSchema>();
    tableSchemas?.forEach((schema, tableName) => {
      schemas.set(tableName, { columns: schema.columns });
    });
    return schemas;
  }, [tableSchemas]);

  const autocomplete = useMemo(() => buildQueryAutocomplete({
    query,
    cursorPosition,
    tables,
    tableSchemas: autocompleteSchemas,
  }), [query, cursorPosition, tables, autocompleteSchemas]);

  useEffect(() => {
    setSelectedAutocompleteIndex(0);
  }, [autocomplete.suggestions]);

  useEffect(() => {
    if (disabled || !onRequestTableSchema) return;

    autocomplete.missingSchemaTables.forEach((tableName) => {
      if (schemaRequestsRef.current.has(tableName)) return;
      schemaRequestsRef.current.add(tableName);
      onRequestTableSchema(tableName);
    });
  }, [autocomplete.missingSchemaTables, disabled, onRequestTableSchema]);

  useEffect(() => {
    if (autocomplete.suggestions.length === 0 && autocomplete.missingSchemaTables.length === 0) {
      setAutocompleteOpen(false);
    }
  }, [autocomplete.missingSchemaTables.length, autocomplete.suggestions.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const editor = editorRef.current;
    if (!textarea || !editor) return;

    const coordinates = getTextareaCaretCoordinates(textarea, cursorPosition);
    const maxLeft = Math.max(8, editor.clientWidth - 280);
    const maxTop = Math.max(8, editor.clientHeight - 42);
    setCaretPosition({
      left: Math.min(Math.max(coordinates.left, 8), maxLeft),
      top: Math.min(Math.max(coordinates.top + coordinates.lineHeight + 2, 8), maxTop),
    });
  }, [query, cursorPosition, editorHeight]);

  const handleSelectAutocomplete = useCallback((suggestion: QueryAutocompleteSuggestion) => {
    const nextQuery = `${query.slice(0, suggestion.replaceStart)}${suggestion.insertText}${query.slice(suggestion.replaceEnd)}`;
    const nextCursorPosition = suggestion.replaceStart + suggestion.insertText.length;
    onChange(nextQuery);
    setAutocompleteOpen(false);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.selectionStart = nextCursorPosition;
      textarea.selectionEnd = nextCursorPosition;
      updateCursorState(textarea, false);
    });
  }, [query, onChange, updateCursorState]);

  const visibleAutocomplete = !disabled
    && autocompleteOpen
    && autocomplete.suggestions.length > 0
    && caretPosition !== null;

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Shift + Enter to execute all
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      if (!disabled && !isExecuting) {
        onExecute('all');
      }
      return;
    }

    // Ctrl/Cmd + Enter to execute at cursor
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!disabled && !isExecuting) {
        onExecute('cursor');
      }
      return;
    }

    if (visibleAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedAutocompleteIndex((prev) =>
          Math.min(prev + 1, autocomplete.suggestions.length - 1)
        );
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedAutocompleteIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const suggestion = autocomplete.suggestions[selectedAutocompleteIndex] ?? autocomplete.suggestions[0];
        if (suggestion) {
          handleSelectAutocomplete(suggestion);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setAutocompleteOpen(false);
        return;
      }
    }

    // Tab for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newValue = query.substring(0, start) + '  ' + query.substring(end);
      onChange(newValue);
      // Restore cursor position
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
        updateCursorState(target, false);
      }, 0);
    }
  }, [
    autocomplete.suggestions,
    disabled,
    handleSelectAutocomplete,
    isExecuting,
    onChange,
    onExecute,
    query,
    selectedAutocompleteIndex,
    updateCursorState,
    visibleAutocomplete,
  ]);

  return (
    <div className="query-editor">
      <div className="query-editor__toolbar">
        <div className="query-editor__buttons">
          {/* Primary: Run at Cursor (Ctrl+Enter) */}
          <button
            className="query-editor__execute"
            onClick={() => onExecute('cursor')}
            disabled={disabled || isExecuting || !query.trim()}
            title={t('terminal:database.executeShortcut')}
          >
            {isExecuting ? (
              <>
                <span className="query-editor__spinner" />
                {t('common:status.running')}
              </>
            ) : (
              <>
                <span className="query-editor__play-icon"><Icon name="play" size={12} /></span>
                {hasMultipleQueries ? t('terminal:database.runAtCursor') : t('terminal:database.runQuery')}
              </>
            )}
          </button>

          {/* Secondary: Run All (Ctrl+Shift+Enter) - only when multiple queries */}
          {hasMultipleQueries && (
            <button
              className="query-editor__execute-cursor"
              onClick={() => onExecute('all')}
              disabled={disabled || isExecuting || !query.trim()}
              title={t('terminal:database.executeCursorShortcut')}
            >
              <span className="query-editor__cursor-icon"><Icon name="caret-right" size={10} /><Icon name="caret-right" size={10} /></span>
              {t('terminal:database.runAll')}
            </button>
          )}
        </div>

        <div className="query-editor__hint">
          {hasMultipleQueries
            ? t('terminal:database.pressCtrlEnterMulti')
            : t('terminal:database.pressCtrlEnter')}
        </div>
      </div>

      <div className="query-editor__input-wrapper">
        {/* Line numbers */}
        <div className="query-editor__line-numbers">
          {lineNumbers.map((num) => (
            <span key={num}>{num}</span>
          ))}
        </div>

        {/* Editor container with highlight overlay */}
        <div ref={editorRef} className="query-editor__editor" style={{ height: editorHeight }}>
          {/* Syntax highlighted background */}
          <pre
            ref={highlightRef}
            className="query-editor__highlight"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlightedCode + '\n' }}
          />

          {/* Editable textarea (transparent) */}
          <textarea
            ref={textareaRef}
            className="query-editor__textarea"
            value={query}
            onChange={(e) => {
              onChange(e.target.value);
              updateCursorState(e.target);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={(e) => updateCursorState(e.currentTarget)}
            onClick={(e) => updateCursorState(e.currentTarget)}
            onFocus={(e) => updateCursorState(e.currentTarget)}
            onBlur={() => {
              window.setTimeout(() => setAutocompleteOpen(false), 120);
            }}
            onScroll={handleScroll}
            placeholder={disabled ? t('terminal:database.selectDbPlaceholder') : t('terminal:database.enterQueryPlaceholder')}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            data-cursor-pos={getCursorPos()}
          />
          <QueryEditorAutocomplete
            open={visibleAutocomplete}
            position={caretPosition}
            suggestions={autocomplete.suggestions}
            selectedIndex={selectedAutocompleteIndex}
            onHover={setSelectedAutocompleteIndex}
            onSelect={handleSelectAutocomplete}
          />
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="query-editor__resize-handle"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
};
