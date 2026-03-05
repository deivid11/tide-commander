/**
 * Tool-specific rendering components for Edit, Read, TodoWrite tools
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DiffLine, EditData, TodoItem } from './types';

// ============================================================================
// Unified Diff Parser
// ============================================================================

interface UnifiedDiffLine {
  type: 'context' | 'added' | 'removed';
  content: string;
  oldNum?: number;
  newNum?: number;
}

interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: UnifiedDiffLine[];
}

/**
 * Parse standard unified diff output into structured hunks
 */
function parseUnifiedDiff(diffText: string): DiffHunk[] {
  const lines = diffText.split('\n');
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Skip diff header lines (diff --git, index, ---, +++)
    if (line.startsWith('diff --git') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ') ||
        line.startsWith('new file mode') || line.startsWith('deleted file mode') ||
        line.startsWith('old mode') || line.startsWith('new mode') ||
        line.startsWith('similarity index') || line.startsWith('rename from') ||
        line.startsWith('rename to') || line.startsWith('Binary files')) {
      continue;
    }

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@ context
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/);
    if (hunkMatch) {
      current = {
        header: hunkMatch[5]?.trim() || '',
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] ?? '1', 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] ?? '1', 10),
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith('+')) {
      current.lines.push({ type: 'added', content: line.slice(1), newNum: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'removed', content: line.slice(1), oldNum: oldLine });
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldNum: oldLine, newNum: newLine });
      oldLine++;
      newLine++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — skip
      continue;
    }
  }

  return hunks;
}

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

    if (isScrollingRef.current && isScrollingRef.current !== source) return;
    isScrollingRef.current = source;

    const sourceEl = source === 'left' ? left : right;
    const targetEl = source === 'left' ? right : left;

    targetEl.scrollTop = sourceEl.scrollTop;
    targetEl.scrollLeft = sourceEl.scrollLeft;

    requestAnimationFrame(() => {
      isScrollingRef.current = null;
    });
  }, []);

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
    const { file_path, old_string, new_string, replace_all, unified_diff } = input;

    if (!file_path) {
      return <pre className="output-input-content">{content}</pre>;
    }

    const fileName = file_path.split('/').pop() || file_path;

    // If unified_diff is available, render hunk-based view
    if (unified_diff) {
      const hunks = parseUnifiedDiff(unified_diff);
      const stats = { added: 0, removed: 0 };
      for (const hunk of hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'added') stats.added++;
          if (line.type === 'removed') stats.removed++;
        }
      }

      return (
        <div className="edit-tool-diff">
          <div className="edit-tool-header">
            <span
              className="edit-tool-file clickable"
              onClick={() => onFileClick?.(file_path, { oldString: old_string || '', newString: new_string || '', unifiedDiff: unified_diff })}
              title={t('terminal:history.openFileWithDiff', { path: file_path })}
            >
              {fileName}
            </span>
            <span className="edit-tool-path">{file_path}</span>
            <div className="edit-tool-stats">
              {stats.added > 0 && <span className="edit-stat added">+{stats.added}</span>}
              {stats.removed > 0 && <span className="edit-stat removed">-{stats.removed}</span>}
            </div>
            {replace_all && <span className="edit-tool-badge">{t('tools:diff.replaceAll')}</span>}
          </div>
          <div className="edit-tool-unified">
            {hunks.map((hunk, hunkIdx) => (
              <div key={hunkIdx} className="diff-hunk">
                <div className="diff-hunk-header">
                  <span className="diff-hunk-range">
                    @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                  </span>
                  {hunk.header && <span className="diff-hunk-context">{hunk.header}</span>}
                </div>
                {hunk.lines.map((line, lineIdx) => (
                  <div key={lineIdx} className={`diff-line diff-line-${line.type}`}>
                    <span className="diff-line-num diff-line-num-old">
                      {line.type !== 'added' ? line.oldNum : ''}
                    </span>
                    <span className="diff-line-num diff-line-num-new">
                      {line.type !== 'removed' ? line.newNum : ''}
                    </span>
                    <span className="diff-line-marker">
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    </span>
                    <span className="diff-line-content">{line.content || ' '}</span>
                  </div>
                ))}
              </div>
            ))}
            {hunks.length === 0 && (
              <div className="diff-empty">No changes detected</div>
            )}
          </div>
        </div>
      );
    }

    // Fallback: side-by-side LCS diff
    const { leftLines, rightLines, stats } = computeSideBySideDiff(old_string || '', new_string || '');

    return (
      <div className="edit-tool-diff">
        <div className="edit-tool-header">
          <span
            className="edit-tool-file clickable"
            onClick={() => onFileClick?.(file_path, { oldString: old_string || '', newString: new_string || '' })}
            title={t('terminal:history.openFileWithDiff', { path: file_path })}
          >
            {fileName}
          </span>
          <span className="edit-tool-path">{file_path}</span>
          <div className="edit-tool-stats">
            {stats.added > 0 && <span className="edit-stat added">+{stats.added}</span>}
            {stats.removed > 0 && <span className="edit-stat removed">-{stats.removed}</span>}
          </div>
          {replace_all && <span className="edit-tool-badge">{t('tools:diff.replaceAll')}</span>}
        </div>
        <div className="edit-tool-panels">
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

// ============================================================================
// AskUserQuestion Tool Input Component
// ============================================================================

interface AskQuestionOption {
  label: string;
  description?: string;
  markdown?: string;
}

interface AskQuestion {
  question: string;
  header?: string;
  options?: AskQuestionOption[];
  multiSelect?: boolean;
}

interface AskQuestionInputProps {
  content: string;
}

export function AskQuestionInput({ content }: AskQuestionInputProps) {
  const [expandedOption, setExpandedOption] = useState<number | null>(null);

  try {
    const input = JSON.parse(content);
    const questions: AskQuestion[] = input.questions;

    if (!Array.isArray(questions) || questions.length === 0) {
      return <pre className="output-input-content">{content}</pre>;
    }

    return (
      <div className="ask-question-input">
        {questions.map((q, qIdx) => (
          <div key={qIdx} className="ask-question-block">
            <div className="ask-question-header">
              {q.header && <span className="ask-question-badge">{q.header}</span>}
              <span className="ask-question-text">{q.question}</span>
              {q.multiSelect && <span className="ask-question-multi">multi</span>}
            </div>
            {q.options && q.options.length > 0 && (
              <div className="ask-question-options">
                {q.options.map((opt, oIdx) => {
                  const globalIdx = qIdx * 100 + oIdx;
                  const isExpanded = expandedOption === globalIdx;
                  return (
                    <div
                      key={oIdx}
                      className={`ask-question-option ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => setExpandedOption(isExpanded ? null : globalIdx)}
                    >
                      <div className="ask-option-row">
                        <span className="ask-option-number">{oIdx + 1}</span>
                        <span className="ask-option-label">{opt.label}</span>
                        {opt.markdown && (
                          <span className="ask-option-preview-hint">{isExpanded ? '▼' : '▶'}</span>
                        )}
                      </div>
                      {opt.description && (
                        <div className="ask-option-desc">{opt.description}</div>
                      )}
                      {opt.markdown && isExpanded && (
                        <pre className="ask-option-markdown">{opt.markdown}</pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

// ============================================================================
// ExitPlanMode Tool Input Component
// ============================================================================

interface ExitPlanModeInputProps {
  content: string;
}

export function ExitPlanModeInput({ content }: ExitPlanModeInputProps) {
  const [expanded, setExpanded] = useState(false);

  try {
    const input = JSON.parse(content);
    const plan = typeof input.plan === 'string' ? input.plan.trim() : '';

    if (!plan) {
      return <pre className="output-input-content">{content}</pre>;
    }

    const headingMatch = plan.match(/^#+\s+(.+)$/m);
    const preview = (headingMatch?.[1] || plan.split('\n').find((line: string) => line.trim().length > 0) || 'Plan ready').trim();

    return (
      <div className="plan-tool-input">
        <div className="plan-tool-header">
          <span className="plan-tool-title">🗺 Plan</span>
          <button
            type="button"
            className="plan-tool-toggle"
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? 'Collapse plan' : 'Expand plan'}
          >
            {expanded ? '▼ Hide' : '▶ Show'}
          </button>
        </div>
        {expanded ? (
          <div className="plan-tool-markdown markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {plan}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="plan-tool-collapsed-preview">{preview}</div>
        )}
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

interface UnknownToolInputProps {
  toolName: string;
  content: string;
}

interface ParsedToolSearchContent {
  selectedTools: string[];
  fallback: string | null;
  showHide: string | null;
  queryParams: Array<{ key: string; value: string }>;
}

interface ToolSearchControlTokens {
  selectedTools: string[];
  fallback: string | null;
  showHide: string | null;
}

function normalizeToolList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

function objectEntriesToParams(obj: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(obj)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
}

function extractControlTokensFromText(text: string): ToolSearchControlTokens {
  const selectMatch = text.match(/(?:^|[\s,;])select\s*:\s*([^\n;]+)/i);
  const fallbackMatch = text.match(/(?:^|[\s,;])fallback\s*:\s*([^\n;]+)/i);
  const showHideMatch = text.match(/(?:^|[\s,;])(?:show|show_hide|hide)\s*:\s*([^\n;]+)/i);

  const selectedTools = selectMatch
    ? selectMatch[1].split(',').map((value) => value.trim()).filter(Boolean)
    : [];

  return {
    selectedTools,
    fallback: fallbackMatch ? fallbackMatch[1].trim() : null,
    showHide: showHideMatch ? showHideMatch[1].trim() : null,
  };
}

function parseToolSearchFromJson(raw: Record<string, unknown>): ParsedToolSearchContent | null {
  const marker = typeof raw.tool === 'string' ? raw.tool.toLowerCase() : '';
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  const label = typeof raw.label === 'string' ? raw.label.toLowerCase() : '';

  let selectedTools = normalizeToolList(
    raw.select
    ?? raw.selected
    ?? raw.selected_tools
    ?? raw.tools
  );

  let fallbackRaw = raw.fallback ?? raw.use_fallback ?? raw.fallbackMode;
  let showHideRaw = raw.show ?? raw.show_hide ?? raw.showHidden ?? raw.hide;
  const queryRaw = raw.query_params ?? raw.query ?? raw.params ?? raw.arguments;

  // Some ToolSearch payloads pack control tokens inside strings like:
  // "select:Bash,Read,Grep,Glob fallback:true show:all"
  const searchableText = Object.values(raw)
    .filter((value) => typeof value === 'string')
    .map((value) => value as string)
    .join(' ; ');
  const extracted = extractControlTokensFromText(searchableText);
  if (selectedTools.length === 0 && extracted.selectedTools.length > 0) {
    selectedTools = extracted.selectedTools;
  }
  if (fallbackRaw === undefined && extracted.fallback !== null) {
    fallbackRaw = extracted.fallback;
  }
  if (showHideRaw === undefined && extracted.showHide !== null) {
    showHideRaw = extracted.showHide;
  }

  const isToolSearchPayload =
    marker.includes('toolsearch')
    || type.includes('toolsearch')
    || label.includes('toolsearch')
    || selectedTools.length > 0
    || queryRaw !== undefined;

  if (!isToolSearchPayload) return null;

  const queryParams = queryRaw && typeof queryRaw === 'object' && !Array.isArray(queryRaw)
    ? objectEntriesToParams(queryRaw as Record<string, unknown>)
    : [];

  return {
    selectedTools,
    fallback: fallbackRaw !== undefined ? String(fallbackRaw) : null,
    showHide: showHideRaw !== undefined ? String(showHideRaw) : null,
    queryParams,
  };
}

function parseToolSearchFromText(content: string): ParsedToolSearchContent | null {
  const extracted = extractControlTokensFromText(content);
  const queryMatch = content.match(/(?:^|\s)(?:query|params|query_params)\s*:\s*(.+)$/i);

  if (extracted.selectedTools.length === 0 && !queryMatch) return null;

  const queryParams: Array<{ key: string; value: string }> = [];
  if (queryMatch) {
    queryMatch[1]
      .split(/[;,]/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .forEach((segment) => {
        const pair = segment.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
        if (pair) {
          queryParams.push({ key: pair[1].trim(), value: pair[2].trim() });
        } else {
          queryParams.push({ key: 'query', value: segment });
        }
      });
  }

  return {
    selectedTools: extracted.selectedTools,
    fallback: extracted.fallback,
    showHide: extracted.showHide,
    queryParams,
  };
}

function parseToolSearchContent(content: string): ParsedToolSearchContent | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parseToolSearchFromJson(parsed as Record<string, unknown>);
    }
  } catch {
    // Fall through to text parser
  }

  return parseToolSearchFromText(content);
}

export function isToolSearchContent(content: string): boolean {
  return parseToolSearchContent(content) !== null;
}

interface ToolSearchInputProps {
  content: string;
  agentName?: string | null;
}

export function ToolSearchInput({ content, agentName }: ToolSearchInputProps) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseToolSearchContent(content);

  if (!parsed) {
    return <pre className="output-input-content">{content}</pre>;
  }

  const compactTools = parsed.selectedTools.length > 0
    ? parsed.selectedTools.slice(0, 4).join(', ')
    : '-';
  const hasMoreTools = parsed.selectedTools.length > 4;
  const toolSummary = hasMoreTools ? `${compactTools} +${parsed.selectedTools.length - 4}` : compactTools;

  return (
    <div className="toolsearch-input">
      <div className="toolsearch-header">
        <span className="toolsearch-badge">⚡ ToolSearch</span>
        {agentName && <span className="toolsearch-agent">{agentName}</span>}
        <span className="toolsearch-meta-pill">
          Tools: {toolSummary}
        </span>
        <span className="toolsearch-meta-pill">
          Fallback: {parsed.fallback ?? '-'}
        </span>
        <span className="toolsearch-meta-pill">
          Show/Hide: {parsed.showHide ?? '-'}
        </span>
        <button
          type="button"
          className="toolsearch-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          title={expanded ? 'Hide details' : 'Show details'}
        >
          {expanded ? '▼ Hide' : '▶ Show'}
        </button>
      </div>

      {expanded ? (
        <div className="toolsearch-query-block">
          <div className="toolsearch-tools">
            {parsed.selectedTools.length > 0 ? parsed.selectedTools.map((tool) => (
              <span key={tool} className="toolsearch-tool-chip">{tool}</span>
            )) : <span className="toolsearch-empty">No selected tools</span>}
          </div>
          <div className="toolsearch-query-title">Query Parameters</div>
          {parsed.queryParams.length > 0 ? (
            <div className="toolsearch-query-list">
              {parsed.queryParams.map((param, index) => (
                <div key={`${param.key}-${index}`} className="toolsearch-query-row">
                  <span className="toolsearch-query-key">{param.key}</span>
                  <span className="toolsearch-query-value">{param.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="toolsearch-empty">No query parameters provided</div>
          )}
        </div>
      ) : (
        <div className="toolsearch-preview">Collapsed</div>
      )}
    </div>
  );
}

export function UnknownToolInput({ toolName, content }: UnknownToolInputProps) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.length > 220 ? `${content.slice(0, 220)}...` : content;

  return (
    <div className="unknown-tool-input">
      <div className="unknown-tool-header">
        <span className="unknown-tool-badge">Fallback</span>
        <span className="unknown-tool-name">{toolName}</span>
        <button
          type="button"
          className="unknown-tool-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          title={expanded ? 'Collapse details' : 'Expand details'}
        >
          {expanded ? '▼ Hide' : '▶ Show'}
        </button>
      </div>
      {expanded ? (
        <pre className="output-input-content">{content}</pre>
      ) : (
        <pre className="unknown-tool-preview">{preview}</pre>
      )}
    </div>
  );
}
