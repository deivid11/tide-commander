/**
 * Boss context and delegation display components
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BOSS_CONTEXT_START, BOSS_CONTEXT_END } from '../../../shared/types';
import { store } from '../../store';
import { createMarkdownComponents, markdownComponents as defaultMarkdownComponents } from './MarkdownComponents';
import type { ParsedBossContent, ParsedDelegation, ParsedBossResponse, ParsedInjectedInstructions, ParsedWorkPlanResponse, WorkPlan, WorkPlanPhase, WorkPlanTask, EditData } from './types';
import { AgentIcon } from '../AgentIcon';
import { useAgent, useAgentTaskProgress } from '../../store/selectors';
import { AgentProgressIndicator } from './AgentProgressIndicator';

const PREVIEW_CHAR_LIMIT = 400;

/**
 * Trim a markdown source string to ~N chars on a word boundary and append an ellipsis.
 * If the source is already within the limit, returns it unchanged and `truncated = false`.
 */
function truncateMarkdownPreview(source: string, limit: number): { text: string; truncated: boolean } {
  if (source.length <= limit) return { text: source, truncated: false };
  const hardSlice = source.slice(0, limit);
  const lastBoundary = Math.max(
    hardSlice.lastIndexOf(' '),
    hardSlice.lastIndexOf('\n'),
  );
  const cut = lastBoundary > limit * 0.7 ? hardSlice.slice(0, lastBoundary) : hardSlice;
  return { text: `${cut.trimEnd()}…`, truncated: true };
}

// ============================================================================
// Boss Context Parsing
// ============================================================================

/**
 * Parse boss context from content
 */
export function parseBossContext(content: string): ParsedBossContent {
  // Boss context is ONLY valid when it starts at the very beginning of the content
  // This prevents false matches when the delimiters appear as literal text in the message
  const trimmedContent = content.trimStart();

  if (!trimmedContent.startsWith(BOSS_CONTEXT_START)) {
    return { hasContext: false, context: null, userMessage: content };
  }

  // IMPORTANT: Use lastIndexOf because the boss context itself may contain the delimiters
  // as literal text (e.g., when a task description mentions "<<<BOSS_CONTEXT_START>>>")
  const endIdx = trimmedContent.lastIndexOf(BOSS_CONTEXT_END);

  if (endIdx === -1) {
    return { hasContext: false, context: null, userMessage: content };
  }

  const context = trimmedContent.slice(BOSS_CONTEXT_START.length, endIdx).trim();
  const userMessage = trimmedContent.slice(endIdx + BOSS_CONTEXT_END.length).trim();

  return { hasContext: true, context, userMessage };
}

// ============================================================================
// Injected Instructions Parsing (Codex prompt wrappers)
// ============================================================================

/**
 * Parse Codex-injected instruction preamble from a user message.
 * The codex backend composes prompts as:
 *   Follow all instructions below for this task.
 *   ...
 *   ## User Request
 *   <actual user text>
 */
export function parseInjectedInstructions(content: string): ParsedInjectedInstructions {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const followMarker = 'Follow all instructions below for this task.';
  const userRequestHeader = '## User Request';
  const userRequestHeaderIndex = normalized.lastIndexOf(userRequestHeader);

  // Primary path: split by explicit "## User Request" marker.
  // Use lastIndexOf because injected blocks can contain nested markdown headings.
  if (userRequestHeaderIndex !== -1) {
    const headerWithPreamble = normalized.slice(0, userRequestHeaderIndex).trim();
    const userMessage = normalized
      .slice(userRequestHeaderIndex + userRequestHeader.length)
      .trim();

    if (userMessage) {
      return {
        hasInstructions: headerWithPreamble.length > 0,
        instructions: headerWithPreamble.length > 0 ? headerWithPreamble : null,
        userMessage,
      };
    }
  }

  // Fallback path: remove known injected wrappers that sometimes appear
  // without the explicit "## User Request" section.
  let remaining = normalized;
  const strippedChunks: string[] = [];
  const wrapperPatterns = [
    /^(?:You)?# AGENTS\.md instructions[^\n]*\n[\s\S]*?<\/INSTRUCTIONS>\s*/i,
    /^(?:You)?<environment_context>\s*[\s\S]*?<\/environment_context>\s*/i,
    /^(?:You)?Follow all instructions below for this task\.\s*/i,
  ];

  let didStrip = false;
  let keepStripping = true;

  while (keepStripping) {
    keepStripping = false;
    for (const pattern of wrapperPatterns) {
      const match = remaining.match(pattern);
      if (match) {
        strippedChunks.push(match[0].trim());
        remaining = remaining.slice(match[0].length).trimStart();
        didStrip = true;
        keepStripping = true;
        break;
      }
    }
  }

  if (didStrip && remaining) {
    return {
      hasInstructions: true,
      instructions: strippedChunks.join('\n\n'),
      userMessage: remaining.trim(),
    };
  }

  // Keep previous strict check as final compatibility guard.
  if (!normalized.includes(followMarker)) {
    return { hasInstructions: false, instructions: null, userMessage: content };
  }

  return {
    hasInstructions: false,
    instructions: null,
    userMessage: content,
  };
}

// ============================================================================
// Delegated Task Message Parsing
// ============================================================================

export interface ParsedDelegatedTask {
  isDelegatedTask: boolean;
  bossName: string;
  bossId: string;
  taskCommand: string;
}

/**
 * Parse [DELEGATED TASK from boss "Name" (id)] messages sent to subordinates
 */
export function parseDelegatedTaskMessage(content: string): ParsedDelegatedTask {
  const match = content.match(/^\[DELEGATED TASK from boss "([^"]+)" \(([^)]+)\)\]\s*\n\n([\s\S]*?)\n\n---\nThis task was delegated by your boss agent\./);
  if (!match) {
    return { isDelegatedTask: false, bossName: '', bossId: '', taskCommand: '' };
  }
  return {
    isDelegatedTask: true,
    bossName: match[1],
    bossId: match[2],
    taskCommand: match[3].trim(),
  };
}

// ============================================================================
// Task Report Message Parsing
// ============================================================================

export interface ParsedTaskReport {
  isTaskReport: boolean;
  agentName: string;
  agentId: string;
  status: 'COMPLETED' | 'FAILED' | string;
  originalTask: string;
  summary: string;
}

/**
 * Parse [TASK REPORT from AgentName (id)] messages sent to boss
 */
export function parseTaskReportMessage(content: string): ParsedTaskReport {
  const match = content.match(/^\[TASK REPORT from ([^(]+?)\s*\(([^)]+)\)\]\s*\n\nStatus:\s*(\w+)\nOriginal task:\s*([\s\S]*?)\n(?:\nSummary:\s*([\s\S]*?))?\n\nYou may review/);
  if (!match) {
    return { isTaskReport: false, agentName: '', agentId: '', status: '', originalTask: '', summary: '' };
  }
  return {
    isTaskReport: true,
    agentName: match[1].trim(),
    agentId: match[2].trim(),
    status: match[3].trim(),
    originalTask: match[4].trim(),
    summary: (match[5] || '').trim(),
  };
}

// ============================================================================
// Subagent Notification Parsing (Codex collab notifications)
// ============================================================================

export interface ParsedSubagentNotification {
  hasNotification: boolean;
  agentId: string;
  status: Record<string, string>;  // e.g. { errored: "message" } or { completed: "message" }
  contentWithoutNotification: string;
}

/**
 * Parse <subagent_notification> tags from Codex collab messages.
 * These appear in user messages when a subagent reports status.
 */
export function parseSubagentNotification(content: string): ParsedSubagentNotification {
  const match = content.match(/<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>/);
  if (!match) {
    return { hasNotification: false, agentId: '', status: {}, contentWithoutNotification: content };
  }

  try {
    const parsed = JSON.parse(match[1].trim());
    const agentId = parsed.agent_id || '';
    const status: Record<string, string> = {};
    if (parsed.status && typeof parsed.status === 'object') {
      for (const [key, val] of Object.entries(parsed.status)) {
        status[key] = typeof val === 'string' ? val : JSON.stringify(val);
      }
    }

    const contentWithout = content.replace(/<subagent_notification>\s*[\s\S]*?<\/subagent_notification>\s*/g, '').trim();

    return { hasNotification: true, agentId, status, contentWithoutNotification: contentWithout };
  } catch {
    return { hasNotification: false, agentId: '', status: {}, contentWithoutNotification: content };
  }
}

// ============================================================================
// Delegation Block Parsing
// ============================================================================

/**
 * Parse ```delegation block from assistant response
 */
export function parseDelegationBlock(content: string): ParsedBossResponse {
  // Match ```delegation\n[...]\n``` or ```delegation\n{...}\n``` block
  const delegationMatch = content.match(/```delegation\s*\n([\s\S]*?)\n```/);

  if (!delegationMatch) {
    return { hasDelegation: false, delegations: [], contentWithoutBlock: content };
  }

  try {
    const parsed = JSON.parse(delegationMatch[1].trim());

    // Support both array and single object format
    const delegationArray = Array.isArray(parsed) ? parsed : [parsed];

    const delegations: ParsedDelegation[] = delegationArray.map((delegationJson) => ({
      selectedAgentId: delegationJson.selectedAgentId || '',
      selectedAgentName: delegationJson.selectedAgentName || 'Unknown',
      taskCommand: delegationJson.taskCommand || '',
      reasoning: delegationJson.reasoning || '',
      alternativeAgents: delegationJson.alternativeAgents || [],
      confidence: delegationJson.confidence || 'medium',
    }));

    // Remove the delegation block from the content
    const contentWithoutBlock = content.replace(/```delegation\s*\n[\s\S]*?\n```/, '').trim();

    return { hasDelegation: true, delegations, contentWithoutBlock };
  } catch {
    // Failed to parse JSON, return as-is
    return { hasDelegation: false, delegations: [], contentWithoutBlock: content };
  }
}

// ============================================================================
// Work Plan Block Parsing
// ============================================================================

/**
 * Parse ```work-plan block from assistant response
 */
export function parseWorkPlanBlock(content: string): ParsedWorkPlanResponse {
  // Match ```work-plan\n{...}\n``` block
  const workPlanMatch = content.match(/```work-plan\s*\n([\s\S]*?)\n```/);

  if (!workPlanMatch) {
    return { hasWorkPlan: false, workPlan: null, contentWithoutBlock: content };
  }

  try {
    const parsed = JSON.parse(workPlanMatch[1].trim());

    const workPlan: WorkPlan = {
      name: parsed.name || 'Unnamed Plan',
      description: parsed.description || '',
      phases: (parsed.phases || []).map((phase: WorkPlanPhase) => ({
        id: phase.id || '',
        name: phase.name || '',
        execution: phase.execution || 'sequential',
        dependsOn: phase.dependsOn || [],
        tasks: (phase.tasks || []).map((task: WorkPlanTask) => ({
          id: task.id || '',
          description: task.description || '',
          suggestedClass: task.suggestedClass || 'builder',
          assignToAgent: task.assignToAgent || null,
          assignToAgentName: task.assignToAgentName || null,
          priority: task.priority || 'medium',
          blockedBy: task.blockedBy || [],
        })),
      })),
    };

    // Remove the work-plan block from the content
    const contentWithoutBlock = content.replace(/```work-plan\s*\n[\s\S]*?\n```/, '').trim();

    return { hasWorkPlan: true, workPlan, contentWithoutBlock };
  } catch {
    // Failed to parse JSON, return as-is
    return { hasWorkPlan: false, workPlan: null, contentWithoutBlock: content };
  }
}

// ============================================================================
// Boss Context Component
// ============================================================================

interface BossContextProps {
  context: string;
  defaultCollapsed?: boolean;
  onFileClick?: (path: string) => void;
}

export function BossContext({ context, defaultCollapsed = true, onFileClick }: BossContextProps) {
  const { t } = useTranslation(['tools']);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const markdownComponents = createMarkdownComponents({ onFileClick });

  return (
    <div className={`boss-context ${collapsed ? 'collapsed' : 'expanded'}`}>
      <div className="boss-context-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="boss-context-icon">👑</span>
        <span className="boss-context-label">
          {t('tools:bossContext.teamContext')}
        </span>
        <span className="boss-context-toggle">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="boss-context-content markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {context}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

interface InjectedInstructionsBlockProps {
  content: string;
  defaultCollapsed?: boolean;
  onFileClick?: (path: string) => void;
}

export function InjectedInstructionsBlock({ content, defaultCollapsed = true, onFileClick }: InjectedInstructionsBlockProps) {
  const { t } = useTranslation(['tools']);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const markdownComponents = createMarkdownComponents({ onFileClick });

  return (
    <div className={`injected-instructions ${collapsed ? 'collapsed' : 'expanded'}`}>
      <div className="injected-instructions-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="injected-instructions-icon">⚙️</span>
        <span className="injected-instructions-label">{t('tools:bossContext.injectedInstructions')}</span>
        <span className="injected-instructions-toggle">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="injected-instructions-content markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Delegation Block Component
// ============================================================================

interface DelegationBlockProps {
  delegation: ParsedDelegation;
  bossId?: string | null;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
}

export function DelegationBlock({ delegation, bossId, onFileClick, onBashClick }: DelegationBlockProps) {
  const { t } = useTranslation(['tools']);
  const targetAgent = useAgent(delegation.selectedAgentId);
  const taskProgressMap = useAgentTaskProgress(bossId ?? null);
  const matchingProgress = taskProgressMap.get(delegation.selectedAgentId);
  const confidenceColors: Record<string, string> = {
    high: '#22c55e', // green
    medium: '#f59e0b', // amber
    low: '#ef4444', // red
  };

  const confidenceEmoji: Record<string, string> = {
    high: '✅',
    medium: '⚠️',
    low: '❓',
  };

  const taskPreview = delegation.taskCommand
    ? truncateMarkdownPreview(delegation.taskCommand, PREVIEW_CHAR_LIMIT)
    : null;
  const taskTruncated = taskPreview?.truncated ?? false;
  const hasReasoning = Boolean(delegation.reasoning && delegation.reasoning.trim());
  const hasAlternatives = delegation.alternativeAgents.length > 0;
  const canExpand = taskTruncated || hasReasoning || hasAlternatives;

  const [isExpanded, setIsExpanded] = useState(false);

  const toggle = (e: React.MouseEvent) => {
    if (!canExpand) return;
    e.stopPropagation();
    setIsExpanded(v => !v);
  };

  const taskBody = taskPreview && taskTruncated && !isExpanded
    ? taskPreview.text
    : delegation.taskCommand;
  const stateClass = !canExpand ? 'no-toggle' : isExpanded ? 'expanded' : 'compact';

  return (
    <div
      className={`delegation-block ${stateClass}`}
      onClick={canExpand ? toggle : undefined}
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
    >
      <div className="delegation-header">
        <span className="delegation-icon">📨</span>
        <span className="delegation-title">{t('tools:delegation.taskDelegated')}</span>
        <span className="delegation-confidence" style={{ color: confidenceColors[delegation.confidence] }}>
          {confidenceEmoji[delegation.confidence]} {delegation.confidence}
        </span>
        {canExpand && (
          <span className="delegation-toggle" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
      </div>
      <div className="delegation-details">
        <div className="delegation-target">
          <span className="delegation-label">{t('tools:delegation.to')}</span>
          {targetAgent && (
            <AgentIcon
              agent={targetAgent}
              size={20}
              className="delegation-agent-icon"
            />
          )}
          <span
            className="delegation-agent-name clickable-agent-name"
            onClick={(e) => {
              e.stopPropagation();
              store.selectAgent(delegation.selectedAgentId);
              store.setTerminalOpen(true);
            }}
          >{delegation.selectedAgentName}</span>
        </div>
        {delegation.taskCommand && (
          <div className="delegation-task-command">
            <span className="delegation-label">{t('tools:delegation.task')}</span>
            <div className={`delegated-task-message-command markdown-content${isExpanded ? ' is-expanded' : ''}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={defaultMarkdownComponents}>
                {taskBody}
              </ReactMarkdown>
            </div>
          </div>
        )}
        {isExpanded && hasReasoning && (
          <div className="delegation-reasoning">
            <span className="delegation-label">{t('tools:delegation.why')}</span>
            <div className="delegated-task-message-command markdown-content is-expanded">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={defaultMarkdownComponents}>
                {delegation.reasoning}
              </ReactMarkdown>
            </div>
          </div>
        )}
        {isExpanded && hasAlternatives && (
          <div className="delegation-alternatives">
            <span className="delegation-label">{t('tools:delegation.alternatives')}</span>
            <span className="delegation-alt-list">
              {delegation.alternativeAgents.map((alt, i) => (
                <span key={alt.id || i} className="delegation-alt-agent">
                  {alt.name}
                  {alt.reason ? ` (${alt.reason})` : ''}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
      {matchingProgress && (
        <div
          className="delegation-subordinate-progress"
          onClick={(e) => e.stopPropagation()}
        >
          <AgentProgressIndicator
            progress={matchingProgress}
            defaultExpanded={matchingProgress.status === 'working'}
            onAgentClick={(clickedAgentId) => {
              store.selectAgent(clickedAgentId);
              store.setTerminalOpen(true);
            }}
            onDismiss={bossId ? (subordinateId) => store.clearAgentTaskProgress(bossId, subordinateId) : undefined}
            onFileClick={onFileClick}
            onBashClick={onBashClick}
          />
        </div>
      )}
      <div className="delegation-footer">
        <span className="delegation-auto-forward">↗️ {t('tools:delegation.autoForwarding', { name: delegation.selectedAgentName })}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Delegated Task Header (shown when an agent receives a task from a boss)
// ============================================================================

interface DelegatedTaskHeaderProps {
  bossName: string;
  taskCommand: string;
}

export function DelegatedTaskHeader({ bossName, taskCommand }: DelegatedTaskHeaderProps) {
  const { t } = useTranslation(['tools']);
  const [isExpanded, setIsExpanded] = useState(false);

  // Truncate long task commands for compact view
  const truncatedCommand = taskCommand.length > 60 ? taskCommand.slice(0, 60) + '...' : taskCommand;

  return (
    <div className={`delegated-task-header ${isExpanded ? 'expanded' : 'compact'}`}>
      <div className="delegated-task-badge" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="delegated-task-icon">👑</span>
        <span className="delegated-task-label">
          {t('tools:delegation.via')} <strong>{bossName}</strong>
        </span>
        <span className="delegated-task-toggle">{isExpanded ? '▼' : '▶'}</span>
      </div>
      {isExpanded && (
        <div className="delegated-task-command markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={defaultMarkdownComponents}>
            {taskCommand}
          </ReactMarkdown>
        </div>
      )}
      {!isExpanded && <div className="delegated-task-preview">{truncatedCommand}</div>}
    </div>
  );
}

// ============================================================================
// Delegated Task Message Component (shown on subordinate terminal)
// ============================================================================

interface DelegatedTaskMessageProps {
  bossName: string;
  bossId: string;
  taskCommand: string;
}

export function DelegatedTaskMessage({ bossName, bossId, taskCommand }: DelegatedTaskMessageProps) {
  const bossAgent = useAgent(bossId);
  const preview = truncateMarkdownPreview(taskCommand, PREVIEW_CHAR_LIMIT);
  const isTruncated = preview.truncated;
  const [isExpanded, setIsExpanded] = useState(false);

  const toggle = (e: React.MouseEvent) => {
    if (!isTruncated) return;
    e.stopPropagation();
    setIsExpanded(v => !v);
  };

  const bodyText = isTruncated && !isExpanded ? preview.text : taskCommand;
  const stateClass = !isTruncated
    ? 'no-toggle'
    : isExpanded
      ? 'expanded'
      : 'compact';

  return (
    <div
      className={`delegated-task-message ${stateClass}`}
      onClick={isTruncated ? toggle : undefined}
      role={isTruncated ? 'button' : undefined}
      tabIndex={isTruncated ? 0 : undefined}
    >
      <div className="delegated-task-message-badge">
        <span className="delegated-task-message-icon" aria-hidden="true">📨</span>
        <span className="delegated-task-message-chip">Task Delegated</span>
        <span className="delegated-task-message-label">
          <span className="delegated-task-message-from">from</span>
          {bossAgent && (
            <AgentIcon
              agent={bossAgent}
              size={14}
              className="delegated-task-message-agent-icon"
            />
          )}
          <strong
            className="clickable-agent-name"
            onClick={(e) => {
              e.stopPropagation();
              store.selectAgent(bossId);
              store.setTerminalOpen(true);
            }}
          >{bossName}</strong>
        </span>
        <span className="delegated-task-message-id" title={bossId}>{bossId.slice(0, 8)}</span>
        {isTruncated && (
          <span className="delegated-task-message-toggle" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
      </div>
      <div className={`delegated-task-message-command markdown-content${isExpanded ? ' is-expanded' : ''}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={defaultMarkdownComponents}>
          {bodyText}
        </ReactMarkdown>
      </div>
    </div>
  );
}

// ============================================================================
// Task Report Component (shown on boss terminal)
// ============================================================================

interface TaskReportHeaderProps {
  agentName: string;
  agentId: string;
  status: string;
  summary: string;
}

export function TaskReportHeader({ agentName, agentId, status, summary }: TaskReportHeaderProps) {
  const isCompleted = status === 'COMPLETED';
  const reporterAgent = useAgent(agentId);

  const summaryPreview = summary ? truncateMarkdownPreview(summary, PREVIEW_CHAR_LIMIT) : null;
  const summaryTruncated = summaryPreview?.truncated ?? false;
  const canExpand = summaryTruncated;
  const [isExpanded, setIsExpanded] = useState(false);

  const toggle = (e: React.MouseEvent) => {
    if (!canExpand) return;
    e.stopPropagation();
    setIsExpanded(v => !v);
  };

  const summaryBody = summaryPreview && summaryTruncated && !isExpanded
    ? summaryPreview.text
    : summary;
  const stateClass = !canExpand
    ? 'no-toggle'
    : isExpanded
      ? 'expanded'
      : 'compact';

  return (
    <div
      className={`task-report-header ${stateClass} status-${isCompleted ? 'completed' : 'failed'}`}
      onClick={canExpand ? toggle : undefined}
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
    >
      <div className="task-report-badge">
        <span className="task-report-icon">{isCompleted ? '✅' : '❌'}</span>
        <span className="task-report-label">
          {reporterAgent && (
            <AgentIcon
              agent={reporterAgent}
              size={14}
              className="task-report-agent-icon"
            />
          )}
          <strong
            className="clickable-agent-name"
            onClick={(e) => {
              e.stopPropagation();
              store.selectAgent(agentId);
              store.setTerminalOpen(true);
            }}
          >{agentName}</strong> — Task {isCompleted ? 'Completed' : 'Failed'}
        </span>
        <span className="task-report-id">{agentId.slice(0, 8)}</span>
        {canExpand && (
          <span className="task-report-toggle" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
      </div>
      {summary && (
        <div className={`task-report-summary markdown-content${isExpanded ? ' is-expanded' : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={defaultMarkdownComponents}>
            {summaryBody}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Subagent Notification Component (Codex collab)
// ============================================================================

interface SubagentNotificationDisplayProps {
  agentId: string;
  status: Record<string, string>;
}

export function SubagentNotificationDisplay({ agentId, status }: SubagentNotificationDisplayProps) {
  const statusEntries = Object.entries(status);
  const isError = statusEntries.some(([key]) => key === 'errored' || key === 'error' || key === 'failed');
  const isCompleted = statusEntries.some(([key]) => key === 'completed');
  const shortAgentId = agentId.slice(-12);

  // Extract a clean error message (strip URLs and repetitive prefix)
  const statusMessage = statusEntries.map(([, val]) => val).join('; ');
  const cleanMessage = statusMessage
    .replace(/Visit https?:\/\/[^\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className={`subagent-notification ${isError ? 'subagent-notification--error' : isCompleted ? 'subagent-notification--completed' : 'subagent-notification--info'}`}>
      <span className="subagent-notification__icon">
        {isError ? '⚠' : isCompleted ? '✓' : '🧬'}
      </span>
      <span className="subagent-notification__label">Subagent</span>
      <span className="subagent-notification__id">{shortAgentId}</span>
      <span className="subagent-notification__status">
        {statusEntries.map(([key]) => key).join(', ')}
      </span>
      {cleanMessage && (
        <span className="subagent-notification__message" title={statusMessage}>{cleanMessage}</span>
      )}
    </div>
  );
}

// ============================================================================
// Work Plan Block Component
// ============================================================================

interface WorkPlanBlockProps {
  workPlan: WorkPlan;
}

const _priorityColors: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

const priorityEmoji: Record<string, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

export function WorkPlanBlock({ workPlan }: WorkPlanBlockProps) {
  const { t } = useTranslation(['tools']);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(workPlan.phases.map(p => p.id)));

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  };

  const totalTasks = workPlan.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);

  return (
    <div className="work-plan-block">
      <div className="work-plan-header">
        <span className="work-plan-icon">📋</span>
        <span className="work-plan-title">{workPlan.name}</span>
        <span className="work-plan-stats">
          {t('tools:workPlan.phases', { count: workPlan.phases.length })} · {t('tools:workPlan.tasks', { count: totalTasks })}
        </span>
      </div>

      {workPlan.description && (
        <div className="work-plan-description">{workPlan.description}</div>
      )}

      <div className="work-plan-phases">
        {workPlan.phases.map((phase, phaseIndex) => (
          <div key={phase.id} className={`work-plan-phase ${expandedPhases.has(phase.id) ? 'expanded' : 'collapsed'}`}>
            <div className="work-plan-phase-header" onClick={() => togglePhase(phase.id)}>
              <span className="work-plan-phase-number">{phaseIndex + 1}</span>
              <span className="work-plan-phase-name">{phase.name}</span>
              <span className={`work-plan-phase-execution ${phase.execution}`}>
                {phase.execution === 'parallel' ? `⚡ ${t('tools:workPlan.parallel')}` : `→ ${t('tools:workPlan.sequential')}`}
              </span>
              {phase.dependsOn.length > 0 && (
                <span className="work-plan-phase-depends">
                  {t('tools:workPlan.dependsOn')} {phase.dependsOn.join(', ')}
                </span>
              )}
              <span className="work-plan-phase-toggle">
                {expandedPhases.has(phase.id) ? '▼' : '▶'}
              </span>
            </div>

            {expandedPhases.has(phase.id) && (
              <div className="work-plan-tasks">
                {phase.tasks.map((task) => (
                  <div key={task.id} className={`work-plan-task priority-${task.priority}`}>
                    <div className="work-plan-task-header">
                      <span className="work-plan-task-id">{task.id}</span>
                      <span className="work-plan-task-priority" title={`Priority: ${task.priority}`}>
                        {priorityEmoji[task.priority]}
                      </span>
                      <span className="work-plan-task-class" title={`Suggested: ${task.suggestedClass}`}>
                        <AgentIcon classId={task.suggestedClass} size={14} /> {task.suggestedClass}
                      </span>
                    </div>
                    <div className="work-plan-task-description">{task.description}</div>
                    <div className="work-plan-task-assignment">
                      <span className="work-plan-task-assignment-label">{t('tools:workPlan.assignedTo')}</span>
                      <span className={`work-plan-task-agent ${task.assignToAgentName ? 'assigned' : 'auto'}`}>
                        {task.assignToAgentName || t('tools:workPlan.autoAssign')}
                      </span>
                    </div>
                    {task.blockedBy.length > 0 && (
                      <div className="work-plan-task-blocked">
                        ⏳ {t('tools:workPlan.blockedBy')} {task.blockedBy.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="work-plan-footer">
        <span className="work-plan-approval-hint">
          💡 {t('tools:workPlan.reviewHint')}
        </span>
      </div>
    </div>
  );
}
