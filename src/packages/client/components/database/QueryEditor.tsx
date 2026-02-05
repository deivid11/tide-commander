/**
 * QueryEditor
 *
 * SQL query editor with syntax highlighting and execution controls.
 */

import React, { useRef, useCallback, KeyboardEvent, useMemo, useEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import './QueryEditor.scss';

interface QueryEditorProps {
  query: string;
  onChange: (query: string) => void;
  onExecute: () => void;
  isExecuting: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

export const QueryEditor: React.FC<QueryEditorProps> = ({
  query,
  onChange,
  onExecute,
  isExecuting,
  disabled,
  autoFocus = true,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

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
  }, []);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter to execute
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!disabled && !isExecuting) {
        onExecute();
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
      }, 0);
    }
  }, [query, onChange, onExecute, disabled, isExecuting]);

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

  return (
    <div className="query-editor">
      <div className="query-editor__toolbar">
        <button
          className="query-editor__execute"
          onClick={onExecute}
          disabled={disabled || isExecuting || !query.trim()}
          title="Execute query (Ctrl+Enter)"
        >
          {isExecuting ? (
            <>
              <span className="query-editor__spinner" />
              Running...
            </>
          ) : (
            <>
              <span className="query-editor__play-icon">▶</span>
              Run Query
            </>
          )}
        </button>

        <div className="query-editor__hint">
          Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to execute
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
        <div className="query-editor__editor">
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
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            placeholder={disabled ? 'Select a database to start querying...' : 'Enter your SQL query here...'}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>
    </div>
  );
};
