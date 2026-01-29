/**
 * Boss context and delegation display components
 */

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BOSS_CONTEXT_START, BOSS_CONTEXT_END } from '../../../shared/types';
import { markdownComponents } from './MarkdownComponents';
import type { ParsedBossContent, ParsedDelegation, ParsedBossResponse, ParsedWorkPlanResponse, WorkPlan, WorkPlanPhase, WorkPlanTask } from './types';

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
}

export function BossContext({ context, defaultCollapsed = true }: BossContextProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Extract agent count from the "# YOUR TEAM (N agents)" header
  const teamMatch = context.match(/# YOUR TEAM \((\d+) agents?\)/);
  const agentCount = teamMatch ? parseInt(teamMatch[1], 10) : 0;

  return (
    <div className={`boss-context ${collapsed ? 'collapsed' : 'expanded'}`}>
      <div className="boss-context-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="boss-context-icon">👑</span>
        <span className="boss-context-label">
          Team Context ({agentCount} agent{agentCount !== 1 ? 's' : ''})
        </span>
        <span className="boss-context-toggle">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="boss-context-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {context}
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
}

export function DelegationBlock({ delegation }: DelegationBlockProps) {
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

  return (
    <div className="delegation-block">
      <div className="delegation-header">
        <span className="delegation-icon">📨</span>
        <span className="delegation-title">Task Delegated</span>
        <span className="delegation-confidence" style={{ color: confidenceColors[delegation.confidence] }}>
          {confidenceEmoji[delegation.confidence]} {delegation.confidence}
        </span>
      </div>
      <div className="delegation-details">
        <div className="delegation-target">
          <span className="delegation-label">To:</span>
          <span className="delegation-agent-name">{delegation.selectedAgentName}</span>
        </div>
        {delegation.taskCommand && (
          <div className="delegation-task-command">
            <span className="delegation-label">Task:</span>
            <span className="delegation-command-text">{delegation.taskCommand}</span>
          </div>
        )}
        {delegation.reasoning && (
          <div className="delegation-reasoning">
            <span className="delegation-label">Why:</span>
            <span className="delegation-reason-text">{delegation.reasoning}</span>
          </div>
        )}
        {delegation.alternativeAgents.length > 0 && (
          <div className="delegation-alternatives">
            <span className="delegation-label">Alternatives:</span>
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
      <div className="delegation-footer">
        <span className="delegation-auto-forward">↗️ Auto-forwarding to {delegation.selectedAgentName}...</span>
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
  const [isExpanded, setIsExpanded] = useState(false);

  // Truncate long task commands for compact view
  const truncatedCommand = taskCommand.length > 60 ? taskCommand.slice(0, 60) + '...' : taskCommand;

  return (
    <div className={`delegated-task-header ${isExpanded ? 'expanded' : 'compact'}`}>
      <div className="delegated-task-badge" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="delegated-task-icon">👑</span>
        <span className="delegated-task-label">
          via <strong>{bossName}</strong>
        </span>
        <span className="delegated-task-toggle">{isExpanded ? '▼' : '▶'}</span>
      </div>
      {isExpanded && <div className="delegated-task-command">{taskCommand}</div>}
      {!isExpanded && <div className="delegated-task-preview">{truncatedCommand}</div>}
    </div>
  );
}

// ============================================================================
// Work Plan Block Component
// ============================================================================

interface WorkPlanBlockProps {
  workPlan: WorkPlan;
}

const priorityColors: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

const priorityEmoji: Record<string, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

const classEmoji: Record<string, string> = {
  scout: '🔍',
  builder: '🔨',
  debugger: '🐛',
  architect: '📐',
  warrior: '⚔️',
  support: '🛡️',
};

export function WorkPlanBlock({ workPlan }: WorkPlanBlockProps) {
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
          {workPlan.phases.length} phases · {totalTasks} tasks
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
                {phase.execution === 'parallel' ? '⚡ parallel' : '→ sequential'}
              </span>
              {phase.dependsOn.length > 0 && (
                <span className="work-plan-phase-depends">
                  depends on: {phase.dependsOn.join(', ')}
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
                        {classEmoji[task.suggestedClass] || '👤'} {task.suggestedClass}
                      </span>
                    </div>
                    <div className="work-plan-task-description">{task.description}</div>
                    <div className="work-plan-task-assignment">
                      <span className="work-plan-task-assignment-label">Assigned to:</span>
                      <span className={`work-plan-task-agent ${task.assignToAgentName ? 'assigned' : 'auto'}`}>
                        {task.assignToAgentName || 'auto-assign (best available)'}
                      </span>
                    </div>
                    {task.blockedBy.length > 0 && (
                      <div className="work-plan-task-blocked">
                        ⏳ blocked by: {task.blockedBy.join(', ')}
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
          💡 Review this plan and reply to approve or request changes
        </span>
      </div>
    </div>
  );
}
