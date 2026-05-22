/**
 * Tool-specific rendering components for Edit, Read, TodoWrite tools
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '../Icon';
import { TaskListView } from '../shared/TaskListView';
import { store } from '../../store';
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
          <Icon name="file-text" size={12} /> {fileName}
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
  try {
    const input = JSON.parse(content);
    const todos: TodoItem[] = input.todos;

    if (!Array.isArray(todos) || todos.length === 0) {
      return <pre className="output-input-content">{content}</pre>;
    }

    return <TaskListView todos={todos} />;
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
  /** Optional map of question text → user's picked answer label(s). When provided,
   *  the matching option is highlighted green. Used by history rendering to fold
   *  the tool_result back into the question block. */
  answers?: Record<string, string>;
  /** When set, render an interactive UI (clickable options, free-text input,
   *  Submit/Decline buttons) instead of the static display. Used live when a
   *  matching agent-prompt is pending. */
  pendingPromptId?: string;
}

function normalizePickedLabels(raw: string | undefined): string[] {
  if (!raw) return [];
  // multiSelect answers come as ", "-joined or array-stringified.
  return raw.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
}

export function AskQuestionInput({ content, answers, pendingPromptId }: AskQuestionInputProps) {
  const [expandedOption, setExpandedOption] = useState<number | null>(null);

  // Interactive state — only used when pendingPromptId is set
  const [picks, setPicks] = useState<Record<string, string | string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  try {
    const input = JSON.parse(content);
    const questions: AskQuestion[] = input.questions;

    if (!Array.isArray(questions) || questions.length === 0) {
      return <pre className="output-input-content">{content}</pre>;
    }

    const interactive = Boolean(pendingPromptId);

    // For interactive mode, treat the local `picks` state as the source of
    // truth for which option is highlighted. After the user submits, the
    // prompt resolves and `interactive` flips to false — but we want the
    // picks to STAY visible until the server-side tool_result enrichment
    // catches up. So local `picks` take precedence over `answers` whenever
    // the user has actually touched them.
    const localPicksFor = (q: AskQuestion): string[] | null => {
      const a = picks[q.question];
      if (a === undefined) return null;
      return Array.isArray(a) ? a : [a];
    };
    const isAnsweredQ = (q: AskQuestion): boolean => {
      const local = localPicksFor(q);
      if (local !== null) return local.length > 0;
      return normalizePickedLabels(answers?.[q.question]).length > 0;
    };
    const pickedLabelsFor = (q: AskQuestion): string[] => {
      const local = localPicksFor(q);
      if (local !== null) return local;
      return normalizePickedLabels(answers?.[q.question]);
    };

    function pickOption(q: AskQuestion, label: string) {
      setPicks((prev) => {
        const next = { ...prev };
        if (q.multiSelect) {
          const cur = Array.isArray(prev[q.question]) ? (prev[q.question] as string[]) : [];
          next[q.question] = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
        } else {
          next[q.question] = label;
        }
        return next;
      });
    }
    function applyFreeText(q: AskQuestion) {
      const text = freeText[q.question]?.trim();
      if (!text) return;
      setPicks((prev) => ({ ...prev, [q.question]: text }));
    }
    async function submit() {
      if (!pendingPromptId) return;
      setSubmitting(true);
      await store.respondToAgentPrompt(pendingPromptId, true, { answers: picks });
      store.resolveAgentPromptLocal(pendingPromptId, true);
    }
    async function decline() {
      if (!pendingPromptId) return;
      setSubmitting(true);
      await store.respondToAgentPrompt(pendingPromptId, false, { reason: 'User declined to answer' });
      store.resolveAgentPromptLocal(pendingPromptId, false);
    }

    const answeredCount = questions.filter(isAnsweredQ).length;
    const allAnswered = answeredCount === questions.length;

    return (
      <div className={`ask-question-input ${interactive ? 'is-interactive' : ''}`} data-pending-prompt-id={pendingPromptId || ''}>
        {interactive && (
          <div className="ask-question-pending-banner">
            Awaiting your answer{pendingPromptId ? ` · ${pendingPromptId.slice(-6)}` : ''}
          </div>
        )}
        {questions.map((q, qIdx) => {
          const pickedLabels = pickedLabelsFor(q);
          const isAnswered = pickedLabels.length > 0;
          return (
            <div key={qIdx} className={`ask-question-block ${isAnswered ? 'answered' : ''}`}>
              <div className="ask-question-header">
                {q.header && <span className="ask-question-badge">{q.header}</span>}
                <span className="ask-question-text">{q.question}</span>
                {q.multiSelect && <span className="ask-question-multi">multi</span>}
                {isAnswered && !interactive && <span className="ask-question-answered-tag">answered</span>}
              </div>
              {q.options && q.options.length > 0 && (
                <div className="ask-question-options">
                  {q.options.map((opt, oIdx) => {
                    const globalIdx = qIdx * 100 + oIdx;
                    const isExpanded = expandedOption === globalIdx;
                    const isPicked = pickedLabels.includes(opt.label);
                    return (
                      <div
                        key={oIdx}
                        className={`ask-question-option ${isExpanded ? 'expanded' : ''} ${isPicked ? 'picked' : ''}`}
                        onClick={() => {
                          if (interactive) {
                            if (!submitting) pickOption(q, opt.label);
                          } else {
                            setExpandedOption(isExpanded ? null : globalIdx);
                          }
                        }}
                      >
                        <div className="ask-option-row">
                          <span className="ask-option-number">{oIdx + 1}</span>
                          <span className="ask-option-label">{opt.label}</span>
                          {isPicked && <span className="ask-option-pick-mark" aria-label="user picked">✓</span>}
                          {opt.markdown && !interactive && (
                            <span className="ask-option-preview-hint"><Icon name={isExpanded ? 'caret-down' : 'caret-right'} size={10} /></span>
                          )}
                        </div>
                        {opt.description && (
                          <div className="ask-option-desc">{opt.description}</div>
                        )}
                        {opt.markdown && isExpanded && !interactive && (
                          <pre className="ask-option-markdown">{opt.markdown}</pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Always surface the picked answer(s) in history mode so a
                  free-text "Other" answer is visible — option highlighting
                  alone misses anything that didn't match a listed label. */}
              {isAnswered && !interactive && pickedLabels.length > 0 && (
                <div className="ask-question-picked">
                  <span className="ask-question-picked-label">
                    {q.multiSelect || pickedLabels.length > 1 ? 'Your answers' : 'Your answer'}
                  </span>
                  {pickedLabels.map((label, i) => {
                    const matchesOption = q.options?.some((o) => o.label === label) ?? false;
                    return (
                      <span
                        key={i}
                        className={`ask-question-picked-value ${matchesOption ? '' : 'ask-question-picked-value--custom'}`}
                        title={matchesOption ? `Selected option: ${label}` : `Custom answer: ${label}`}
                      >
                        <span className="ask-question-picked-text">{label}</span>
                        {!matchesOption && (
                          <span className="ask-question-picked-custom-tag">custom</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              {interactive && (
                <div className="ask-question-freetext">
                  <input
                    type="text"
                    placeholder="Or type your own answer…"
                    value={freeText[q.question] ?? ''}
                    onChange={(e) => setFreeText((p) => ({ ...p, [q.question]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyFreeText(q); } }}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => applyFreeText(q)}
                    disabled={submitting || !(freeText[q.question] ?? '').trim()}
                  >
                    Use
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {interactive && (
          <div className="ask-question-actions">
            <span className={`ask-question-progress ${allAnswered ? 'complete' : ''}`}>
              {allAnswered
                ? 'All questions answered'
                : `${answeredCount} of ${questions.length} answered`}
            </span>
            <button className="ask-question-btn deny" onClick={decline} disabled={submitting}>
              <Icon name="close" size={12} /> Decline
            </button>
            <button
              className="ask-question-btn approve"
              onClick={submit}
              disabled={submitting || !allAnswered}
              title={allAnswered ? 'Submit answers' : `${questions.length - answeredCount} unanswered`}
            >
              <Icon name="check" size={12} /> Submit answers
            </button>
          </div>
        )}
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

// ============================================================================
// AskUserQuestion Tool Result — render the user's picked answers
// ============================================================================
// The CLI returns a textual summary like:
//   Your questions have been answered: "Q1"="A1", "Q2"="A2[, A3]". You can ...
// We parse the Q=A pairs and render each as a "Q → A" row so the user can see
// what THEY picked (history was just dumping the raw string).

interface AskQuestionResultProps {
  content: string;
}

export function AskQuestionResult({ content }: AskQuestionResultProps) {
  // Match all "Quoted question"="Quoted answer" pairs.
  // Answers may include escaped quotes/commas; we use a lazy match until the
  // next `"=` or end of the answer-list segment.
  const pairs: Array<{ q: string; a: string }> = [];
  const re = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    pairs.push({ q: m[1] ?? '', a: m[2] ?? '' });
  }
  if (pairs.length === 0) {
    return <pre className="output-result-content">{content}</pre>;
  }
  return (
    <div className="ask-question-result">
      <div className="ask-question-result-header">
        <Icon name="check" size={12} />
        <span>Your answers</span>
      </div>
      <ul className="ask-question-result-list">
        {pairs.map((p, i) => (
          <li key={i} className="ask-question-result-row">
            <span className="ask-question-result-q">{p.q}</span>
            <span className="ask-question-result-arrow">→</span>
            <span className="ask-question-result-a">{p.a}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// ExitPlanMode Tool Input Component
// ============================================================================

interface ExitPlanModeInputProps {
  content: string;
  /** When set, render Approve/Reject buttons that POST the user's decision to
   *  the matching agent-prompt (same id). Used live to fold the interactive
   *  bottom panel into this inline chip. */
  pendingPromptId?: string;
  /** When provided, an "Open in modal" button appears next to the Show/Hide
   *  toggle so the user can read long plans with full viewport space. */
  onViewMarkdown?: (markdown: string) => void;
}

export function ExitPlanModeInput({ content, pendingPromptId, onViewMarkdown }: ExitPlanModeInputProps) {
  const interactive = Boolean(pendingPromptId);
  // Auto-expand when the plan is awaiting interactive approval so the user
  // can read it without an extra click.
  const [expanded, setExpanded] = useState(interactive);
  const [submitting, setSubmitting] = useState(false);

  try {
    const input = JSON.parse(content);
    const plan = typeof input.plan === 'string' ? input.plan.trim() : '';

    if (!plan) {
      return <pre className="output-input-content">{content}</pre>;
    }

    const headingMatch = plan.match(/^#+\s+(.+)$/m);
    const preview = (headingMatch?.[1] || plan.split('\n').find((line: string) => line.trim().length > 0) || 'Plan ready').trim();

    async function approve() {
      if (!pendingPromptId) return;
      setSubmitting(true);
      await store.respondToAgentPrompt(pendingPromptId, true);
      store.resolveAgentPromptLocal(pendingPromptId, true);
    }
    async function reject() {
      if (!pendingPromptId) return;
      setSubmitting(true);
      await store.respondToAgentPrompt(pendingPromptId, false, { reason: 'User rejected the plan' });
      store.resolveAgentPromptLocal(pendingPromptId, false);
    }

    return (
      <div className={`plan-tool-input ${interactive ? 'is-interactive' : ''}`}>
        <div className="plan-tool-header">
          <span className="plan-tool-title"><Icon name="map" size={13} /> Plan{interactive && ' — awaiting approval'}</span>
          <button
            type="button"
            className="plan-tool-toggle"
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? 'Collapse plan' : 'Expand plan'}
          >
            <Icon name={expanded ? 'caret-down' : 'caret-right'} size={10} /> {expanded ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            className="plan-tool-toggle plan-tool-modal-btn"
            onClick={(e) => {
              e.stopPropagation();
              // Prefer the prop-drilled handler when available, but always
              // also fire a global custom event so the modal opens even if
              // the parent chain didn't plumb onViewMarkdown through.
              if (onViewMarkdown) onViewMarkdown(plan);
              try {
                window.dispatchEvent(new CustomEvent('tide:viewMarkdown', { detail: { content: plan } }));
              } catch { /* environments without CustomEvent */ }
            }}
            title="Open plan in modal"
          >
            <Icon name="fullscreen" size={11} /> Open
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
        {interactive && (
          <div className="plan-tool-actions">
            <button className="ask-question-btn deny" onClick={reject} disabled={submitting}>
              <Icon name="close" size={12} /> Reject
            </button>
            <button className="ask-question-btn approve" onClick={approve} disabled={submitting}>
              <Icon name="check" size={12} /> Approve plan
            </button>
          </div>
        )}
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

function extractTaskTitle(item: unknown): string | null {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    const candidate = o.description ?? o.title ?? o.name ?? o.prompt ?? o.content;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

interface TaskCreateInputProps {
  content: string;
}

export function TaskCreateInput({ content }: TaskCreateInputProps) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const trimmed = content.trim();
    if (!trimmed) return null;
    return (
      <div className="task-tool-input">
        <div className="task-tool-row task-tool-row-create">
          <span className="task-tool-status-icon">☐</span>
          <span className="task-tool-content">{trimmed}</span>
        </div>
      </div>
    );
  }

  const items: unknown[] = (() => {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      if (Array.isArray(o.tasks)) return o.tasks;
      if (Array.isArray(o.todos)) return o.todos;
      return [parsed];
    }
    if (typeof parsed === 'string') return [parsed];
    return [];
  })();

  const titles = items
    .map(extractTaskTitle)
    .filter((title): title is string => typeof title === 'string');

  if (titles.length === 0) {
    return <pre className="output-input-content">{content}</pre>;
  }

  return (
    <div className="task-tool-input">
      {titles.map((title, idx) => (
        <div key={idx} className="task-tool-row task-tool-row-create">
          <span className="task-tool-status-icon">☐</span>
          <span className="task-tool-content">{title}</span>
        </div>
      ))}
    </div>
  );
}

function taskStatusIcon(status: string): string {
  switch (status) {
    case 'pending': return '☐';
    case 'in_progress': return '►';
    case 'completed': return '✓';
    case 'cancelled': return '⊘';
    default: return '•';
  }
}

interface TaskUpdateInputProps {
  content: string;
  /** Optional task subject from the matching TaskCreate. When provided, the
   *  chip shows the task name instead of a generic "status: …" string. */
  subject?: string;
}

export function TaskUpdateInput({ content, subject }: TaskUpdateInputProps) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return <pre className="output-input-content">{content}</pre>;
  }

  const o = parsed as Record<string, unknown>;
  const rawTaskId = o.taskId ?? o.task_id ?? o.id;
  const taskId = (typeof rawTaskId === 'string' || typeof rawTaskId === 'number') ? String(rawTaskId) : null;
  const status = typeof o.status === 'string' ? o.status : '';
  const description = typeof o.description === 'string'
    ? o.description
    : (typeof o.title === 'string' ? o.title : '');

  const failed = description ? /\bfail(ed|ure|s)?\b/i.test(description) : false;
  const statusClass = failed ? 'failed' : (status ? status.replace(/\s+/g, '_') : 'unknown');
  // Prefer the looked-up task subject when available so each row reads like
  // "✓ Wire Tailwind + Vitest config" instead of "✓ status: completed".
  const trimmedDescription = description.trim();
  const subjectFromEnrichment = subject?.trim();
  const displayText = subjectFromEnrichment
    || trimmedDescription
    || (status ? `status: ${status}` : '(no description)');

  return (
    <div className="task-tool-input">
      <div className={`task-tool-row task-tool-row-update task-tool-row-${statusClass}`}>
        <span className="task-tool-status-icon">{taskStatusIcon(status)}</span>
        {taskId && <span className="task-tool-id">#{taskId}</span>}
        <span className="task-tool-content">{displayText}</span>
        {subjectFromEnrichment && trimmedDescription && trimmedDescription !== subjectFromEnrichment && (
          <span className="task-tool-note">— {trimmedDescription}</span>
        )}
      </div>
    </div>
  );
}

import type { BashMemoryKind, BashMemoryCommandInfo, BashMemoryResponseInfo } from '../../utils/outputRendering';

interface MemoryOpInputProps {
  info: BashMemoryCommandInfo;
  response?: BashMemoryResponseInfo;
}

function memoryKindIcon(kind: BashMemoryKind): string {
  switch (kind) {
    case 'read':  return '🧠';
    case 'save':  return '💾';
    case 'clear': return '🗑️';
  }
}

function memoryKindLabel(kind: BashMemoryKind, failed: boolean): string {
  if (failed) {
    switch (kind) {
      case 'read':  return 'Failed reading memory';
      case 'save':  return 'Failed saving memory';
      case 'clear': return 'Failed clearing memory';
    }
  }
  switch (kind) {
    case 'read':  return 'Reading memory';
    case 'save':  return 'Saved memory';
    case 'clear': return 'Cleared memory';
  }
}

export function MemoryOpInput({ info, response }: MemoryOpInputProps) {
  const failed = response?.failed ?? false;
  const length = info.kind === 'save' ? (response?.length ?? info.bodyLength) : undefined;
  const shortId = info.agentId.length > 8 ? info.agentId.slice(0, 8) : info.agentId;
  const stateClass = failed ? 'failed' : info.kind;

  return (
    <span className={`memory-op-inline memory-op-${stateClass}`} title={info.commandBody}>
      <span className="memory-op-icon" aria-hidden>{memoryKindIcon(info.kind)}</span>
      <span className="memory-op-label">{memoryKindLabel(info.kind, failed)}</span>
      <span className="memory-op-sep">·</span>
      <span className="memory-op-agent">agent {shortId}</span>
      {typeof length === 'number' && (
        <>
          <span className="memory-op-sep">·</span>
          <span className="memory-op-length">{length.toLocaleString()} chars</span>
        </>
      )}
      {failed && (
        <>
          <span className="memory-op-sep">·</span>
          <span className="memory-op-error">error</span>
        </>
      )}
    </span>
  );
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

export function ToolSearchInput({ content }: ToolSearchInputProps) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseToolSearchContent(content);

  if (!parsed) {
    return <pre className="output-input-content">{content}</pre>;
  }

  const visibleTools = parsed.selectedTools.slice(0, 4);
  const extraToolCount = parsed.selectedTools.length - visibleTools.length;
  const hasQueryParams = parsed.queryParams.length > 0;
  const fallback = parsed.fallback && parsed.fallback !== '-' ? parsed.fallback : null;
  const showHide = parsed.showHide && parsed.showHide !== '-' ? parsed.showHide : null;

  return (
    <div className="toolsearch-input">
      <div className="toolsearch-header">
        {visibleTools.length > 0 && (
          <span className="toolsearch-tools-inline">
            {visibleTools.map((tool) => (
              <span key={tool} className="toolsearch-tool-chip">{tool}</span>
            ))}
            {extraToolCount > 0 && (
              <span className="toolsearch-tool-chip toolsearch-tool-chip--more">+{extraToolCount}</span>
            )}
          </span>
        )}
        {fallback && (
          <span className="toolsearch-meta-pill">Fallback: {fallback}</span>
        )}
        {showHide && (
          <span className="toolsearch-meta-pill">Show: {showHide}</span>
        )}
        {hasQueryParams && (
          <button
            type="button"
            className="toolsearch-toggle"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? 'Hide query parameters' : 'Show query parameters'}
            title={expanded ? 'Hide query parameters' : 'Show query parameters'}
          >
            <Icon name={expanded ? 'caret-down' : 'caret-right'} size={10} />
            <span className="toolsearch-toggle-label">
              {expanded ? 'Hide' : `${parsed.queryParams.length} param${parsed.queryParams.length === 1 ? '' : 's'}`}
            </span>
          </button>
        )}
      </div>

      {expanded && hasQueryParams && (
        <div className="toolsearch-query-block">
          <div className="toolsearch-query-list">
            {parsed.queryParams.map((param, index) => (
              <div key={`${param.key}-${index}`} className="toolsearch-query-row">
                <span className="toolsearch-query-key">{param.key}</span>
                <span className="toolsearch-query-value">{param.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function UnknownToolInput({ toolName: _toolName, content }: UnknownToolInputProps) {
  const [expanded, setExpanded] = useState(false);

  // Don't render if content is empty or just '{}'
  if (!content || content.trim() === '{}') return null;

  const preview = content.length > 220 ? `${content.slice(0, 220)}...` : content;

  return (
    <div className="unknown-tool-input">
      <div className="unknown-tool-header">
        <button
          type="button"
          className="unknown-tool-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          title={expanded ? 'Collapse details' : 'Expand details'}
        >
          <Icon name={expanded ? 'caret-down' : 'caret-right'} size={10} /> {expanded ? 'Hide' : 'Show'}
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
