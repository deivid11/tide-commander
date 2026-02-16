/**
 * Tool-specific rendering components for Edit, Read, TodoWrite tools
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiffLine, EditData, TodoItem } from './types';

// ============================================================================
// Diff Computation Utilities
// ============================================================================

/**
 * Compute side-by-side diff between two strings using LCS algorithm
 */
export function computeSideBySideDiff(
  oldStr: string,
  newStr: string
): {
  leftLines: DiffLine[];
  rightLines: DiffLine[];
  stats: { added: number; removed: number };
} {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find operations
  type Op = { type: 'equal' | 'delete' | 'insert'; origIdx?: number; modIdx?: number };
  const ops: Op[] = [];
  let i = m,
    j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'equal', origIdx: i - 1, modIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', modIdx: j - 1 });
      j--;
    } else if (i > 0) {
      ops.push({ type: 'delete', origIdx: i - 1 });
      i--;
    }
  }

  ops.reverse();

  // Build lines for each side
  const leftLines: DiffLine[] = [];
  const rightLines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const op of ops) {
    if (op.type === 'equal') {
      const text = oldLines[op.origIdx!];
      leftLines.push({ num: op.origIdx! + 1, text, type: 'unchanged' });
      rightLines.push({ num: op.modIdx! + 1, text, type: 'unchanged' });
    } else if (op.type === 'delete') {
      const text = oldLines[op.origIdx!];
      leftLines.push({ num: op.origIdx! + 1, text, type: 'removed' });
      removed++;
    } else {
      const text = newLines[op.modIdx!];
      rightLines.push({ num: op.modIdx! + 1, text, type: 'added' });
      added++;
    }
  }

  return { leftLines, rightLines, stats: { added, removed } };
}

// ============================================================================
// Edit Tool Diff Component
// ============================================================================

interface EditToolDiffProps {
  content: string;
  onFileClick?: (path: string, editData?: EditData) => void;
}

export function EditToolDiff({ content, onFileClick }: EditToolDiffProps) {
  const { t } = useTranslation(['tools', 'common', 'terminal']);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef<'left' | 'right' | null>(null);

  // Synchronized scroll handler
  const handleScroll = useCallback((source: 'left' | 'right') => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    // Prevent feedback loops
    if (isScrollingRef.current && isScrollingRef.current !== source) return;
    isScrollingRef.current = source;

    const sourceEl = source === 'left' ? left : right;
    const targetEl = source === 'left' ? right : left;

    // Sync both vertical and horizontal scroll
    targetEl.scrollTop = sourceEl.scrollTop;
    targetEl.scrollLeft = sourceEl.scrollLeft;

    // Reset scroll lock after animation frame
    requestAnimationFrame(() => {
      isScrollingRef.current = null;
    });
  }, []);

  // Set up scroll listeners
  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const leftHandler = () => handleScroll('left');
    const rightHandler = () => handleScroll('right');

    left.addEventListener('scroll', leftHandler);
    right.addEventListener('scroll', rightHandler);

    return () => {
      left.removeEventListener('scroll', leftHandler);
      right.removeEventListener('scroll', rightHandler);
    };
  }, [handleScroll]);

  try {
    const input = JSON.parse(content);
    const { file_path, old_string, new_string, replace_all } = input;

    if (!file_path) {
      return <pre className="output-input-content">{content}</pre>;
    }

    const fileName = file_path.split('/').pop() || file_path;
    const { leftLines, rightLines, stats } = computeSideBySideDiff(old_string || '', new_string || '');

    return (
      <div className="edit-tool-diff">
        <div className="edit-tool-header">
          <span
            className="edit-tool-file clickable"
            onClick={() => onFileClick?.(file_path, { oldString: old_string || '', newString: new_string || '' })}
            title={t('terminal:history.openFileWithDiff', { path: file_path })}
          >
            📄 {fileName}
          </span>
          <span className="edit-tool-path">{file_path}</span>
          <div className="edit-tool-stats">
            {stats.added > 0 && <span className="edit-stat added">+{stats.added}</span>}
            {stats.removed > 0 && <span className="edit-stat removed">-{stats.removed}</span>}
          </div>
          {replace_all && <span className="edit-tool-badge">{t('tools:diff.replaceAll')}</span>}
        </div>
        <div className="edit-tool-panels">
          {/* Original (Left) */}
          <div className="edit-panel edit-panel-original">
            <div className="edit-panel-header">
              <span className="edit-panel-label">{t('tools:diff.original')}</span>
            </div>
            <div className="edit-panel-content" ref={leftRef}>
              {leftLines.map((line, idx) => (
                <div key={idx} className={`edit-line edit-line-${line.type}`}>
                  <span className="edit-line-num">{line.num}</span>
                  <span className="edit-line-content">{line.text || ' '}</span>
                </div>
              ))}
              {leftLines.length === 0 && (
                <div className="edit-line edit-line-empty">
                  <span className="edit-line-num">-</span>
                  <span className="edit-line-content edit-empty-text">{t('common:status.empty')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Modified (Right) */}
          <div className="edit-panel edit-panel-modified">
            <div className="edit-panel-header">
              <span className="edit-panel-label">{t('tools:diff.modified')}</span>
            </div>
            <div className="edit-panel-content" ref={rightRef}>
              {rightLines.map((line, idx) => (
                <div key={idx} className={`edit-line edit-line-${line.type}`}>
                  <span className="edit-line-num">{line.num}</span>
                  <span className="edit-line-content">{line.text || ' '}</span>
                </div>
              ))}
              {rightLines.length === 0 && (
                <div className="edit-line edit-line-empty">
                  <span className="edit-line-num">-</span>
                  <span className="edit-line-content edit-empty-text">{t('common:status.empty')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

// ============================================================================
// Read Tool Input Component
// ============================================================================

interface ReadToolInputProps {
  content: string;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
}

export function ReadToolInput({ content, onFileClick }: ReadToolInputProps) {
  try {
    const input = JSON.parse(content);
    const { file_path, offset, limit } = input;

    if (!file_path) {
      return <pre className="output-input-content">{content}</pre>;
    }

    const fileName = file_path.split('/').pop() || file_path;
    const hasRange = offset !== undefined && limit !== undefined;

    const handleClick = () => {
      if (hasRange) {
        // Pass highlight range for Read tool with offset/limit
        onFileClick?.(file_path, { highlightRange: { offset, limit } });
      } else {
        onFileClick?.(file_path);
      }
    };

    return (
      <div className="read-tool-input">
        <span className="read-tool-file clickable" onClick={handleClick} title={`Open ${file_path}${hasRange ? ' (with highlighted lines)' : ''}`}>
          📄 {fileName}
        </span>
        <span className="read-tool-path">{file_path}</span>
        {(offset !== undefined || limit !== undefined) && (
          <span className="read-tool-range">
            {offset !== undefined && `offset: ${offset}`}
            {offset !== undefined && limit !== undefined && ', '}
            {limit !== undefined && `limit: ${limit}`}
          </span>
        )}
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

// ============================================================================
// TodoWrite Tool Input Component
// ============================================================================

interface TodoWriteInputProps {
  content: string;
}

export function TodoWriteInput({ content }: TodoWriteInputProps) {
  const { t } = useTranslation(['tools']);
  try {
    const input = JSON.parse(content);
    const todos: TodoItem[] = input.todos;

    if (!Array.isArray(todos) || todos.length === 0) {
      return <pre className="output-input-content">{content}</pre>;
    }

    // Count by status
    const counts = {
      completed: todos.filter((t) => t.status === 'completed').length,
      in_progress: todos.filter((t) => t.status === 'in_progress').length,
      pending: todos.filter((t) => t.status === 'pending').length,
    };

    return (
      <div className="todo-tool-input">
        <div className="todo-tool-header">
          <span className="todo-tool-title">📋 {t('tools:todoList.title')}</span>
          <div className="todo-tool-stats">
            {counts.completed > 0 && <span className="todo-stat completed">✓ {counts.completed}</span>}
            {counts.in_progress > 0 && <span className="todo-stat in-progress">► {counts.in_progress}</span>}
            {counts.pending > 0 && <span className="todo-stat pending">○ {counts.pending}</span>}
          </div>
        </div>
        <div className="todo-tool-list">
          {todos.map((todo, idx) => (
            <div key={idx} className={`todo-item todo-${todo.status}`}>
              <span className="todo-status-icon">
                {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '►' : '○'}
              </span>
              <span className="todo-content">{todo.content}</span>
            </div>
          ))}
        </div>
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}
