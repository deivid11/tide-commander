/**
 * AgentPromptCard
 *
 * Renders an inline UI in the Guake terminal pane for an interactive prompt
 * forwarded by the MCP permission-prompt server:
 *   - AskUserQuestion: list each question with selectable options + free-text
 *   - ExitPlanMode: render the plan markdown with Approve / Reject buttons
 *
 * Submitting forwards the answer to the server via store.respondToAgentPrompt;
 * the server resolves the MCP-side HTTP wait and the agent gets the user's
 * decision back as the tool's result.
 */

import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentPrompt } from '../../../shared/types';
import { store } from '../../store';
import { Icon } from '../Icon';

interface Question {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface AgentPromptCardProps {
  prompt: AgentPrompt;
}

export function AgentPromptCard({ prompt }: AgentPromptCardProps) {
  if (prompt.tool === 'AskUserQuestion') {
    return <AskUserQuestionCard prompt={prompt} />;
  }
  if (prompt.tool === 'ExitPlanMode') {
    return <ExitPlanModeCard prompt={prompt} />;
  }
  return null;
}

// ─── AskUserQuestion ────────────────────────────────────────────────────────

function AskUserQuestionCard({ prompt }: { prompt: AgentPrompt }) {
  const questions = useMemo<Question[]>(() => {
    const raw = (prompt.input?.questions as Question[] | undefined) ?? [];
    return Array.isArray(raw) ? raw : [];
  }, [prompt]);

  // answers keyed by question text. For multiSelect we store an array.
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const isAnswered = (q: Question): boolean => {
    const a = answers[q.question];
    return Array.isArray(a) ? a.length > 0 : Boolean(a);
  };
  const answeredCount = questions.filter(isAnswered).length;
  const allAnswered = answeredCount === questions.length;

  function pickOption(q: Question, label: string) {
    setAnswers((prev) => {
      const next = { ...prev };
      if (q.multiSelect) {
        const current = Array.isArray(prev[q.question]) ? (prev[q.question] as string[]) : [];
        next[q.question] = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
      } else {
        next[q.question] = label;
      }
      return next;
    });
  }

  function applyFreeText(q: Question) {
    const text = freeText[q.question]?.trim();
    if (!text) return;
    setAnswers((prev) => ({ ...prev, [q.question]: text }));
  }

  async function submit() {
    setSubmitting(true);
    await store.respondToAgentPrompt(prompt.id, true, { answers });
    // Optimistically dismiss; the server-side WS broadcast will also remove
    // this prompt from the map, but we don't want the UI to look frozen
    // while the round-trip completes.
    store.resolveAgentPromptLocal(prompt.id, true);
  }

  async function decline() {
    setSubmitting(true);
    await store.respondToAgentPrompt(prompt.id, false, { reason: 'User declined to answer' });
    store.resolveAgentPromptLocal(prompt.id, false);
  }

  return (
    <div className="agent-prompt-card askuserquestion">
      <div className="agent-prompt-header">
        <Icon name="question" size={14} />
        <span className="agent-prompt-title">Agent is asking</span>
        <span className="agent-prompt-badge">{questions.length} question{questions.length === 1 ? '' : 's'}</span>
      </div>
      <div className="agent-prompt-questions">
        {questions.map((q, idx) => {
          const selected = answers[q.question];
          const answered = isAnswered(q);
          return (
            <div key={`${q.question}-${idx}`} className={`agent-prompt-question ${answered ? 'answered' : ''}`}>
              <div className="agent-prompt-question-header">
                {q.header && <span className="agent-prompt-question-tag">{q.header}</span>}
                <span className="agent-prompt-question-text">{q.question}</span>
                {q.multiSelect && <span className="agent-prompt-multi">(multi)</span>}
                {answered && <span className="agent-prompt-answered-mark">✓</span>}
              </div>
              <div className="agent-prompt-options">
                {q.options.map((opt) => {
                  const isSelected = Array.isArray(selected)
                    ? selected.includes(opt.label)
                    : selected === opt.label;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      className={`agent-prompt-option ${isSelected ? 'selected' : ''}`}
                      onClick={() => pickOption(q, opt.label)}
                      disabled={submitting}
                    >
                      <span className="agent-prompt-option-label">{opt.label}</span>
                      {opt.description && <span className="agent-prompt-option-desc">{opt.description}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="agent-prompt-freetext">
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
            </div>
          );
        })}
      </div>
      <div className="agent-prompt-actions">
        <span className={`agent-prompt-progress ${allAnswered ? 'complete' : ''}`}>
          {allAnswered
            ? 'All questions answered'
            : `${answeredCount} of ${questions.length} answered — pick the missing ones to submit`}
        </span>
        <button className="agent-prompt-btn deny" onClick={decline} disabled={submitting}>
          <Icon name="close" size={12} /> Decline
        </button>
        <button
          className="agent-prompt-btn approve"
          onClick={submit}
          disabled={submitting || !allAnswered}
          title={allAnswered ? 'Submit answers' : `${questions.length - answeredCount} unanswered`}
        >
          <Icon name="check" size={12} /> Submit answers
        </button>
      </div>
    </div>
  );
}

// ─── ExitPlanMode ───────────────────────────────────────────────────────────

function ExitPlanModeCard({ prompt }: { prompt: AgentPrompt }) {
  const plan = typeof prompt.input?.plan === 'string' ? (prompt.input.plan as string) : '';
  const [expanded, setExpanded] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function approve() {
    setSubmitting(true);
    await store.respondToAgentPrompt(prompt.id, true);
    store.resolveAgentPromptLocal(prompt.id, true);
  }
  async function reject() {
    setSubmitting(true);
    await store.respondToAgentPrompt(prompt.id, false, { reason: 'User rejected the plan' });
    store.resolveAgentPromptLocal(prompt.id, false);
  }

  return (
    <div className="agent-prompt-card exitplanmode">
      <div className="agent-prompt-header">
        <Icon name="map" size={14} />
        <span className="agent-prompt-title">Plan ready — approve to exit plan mode</span>
        <button className="agent-prompt-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Hide plan' : 'Show plan'}
        </button>
      </div>
      {expanded && plan && (
        <div className="agent-prompt-plan markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
        </div>
      )}
      <div className="agent-prompt-actions">
        <button className="agent-prompt-btn deny" onClick={reject} disabled={submitting}>
          <Icon name="close" size={12} /> Reject
        </button>
        <button className="agent-prompt-btn approve" onClick={approve} disabled={submitting}>
          <Icon name="check" size={12} /> Approve plan
        </button>
      </div>
    </div>
  );
}
