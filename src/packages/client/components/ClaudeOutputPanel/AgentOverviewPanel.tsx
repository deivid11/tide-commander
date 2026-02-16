/**
 * Agent Overview Panel
 *
 * Displays all agents grouped by area in a collapsible side panel within the Guake Terminal.
 * Shows agent status, last message, recent tool activity, and subagent information.
 * Inspired by the AgentDebugPanel layout.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAgentsArray,
  useToolExecutions,
  useSubagents,
  useAreas,
  store,
} from '../../store';
import { TOOL_ICONS, formatTimestamp } from '../../utils/outputRendering';
import { STORAGE_KEYS, getStorage, setStorage } from '../../utils/storage';
import type { Agent, Subagent, DrawingArea } from '../../../shared/types';
import type { ToolExecution, ClaudeOutput } from '../../store/types';

/** Persisted config shape for the overview panel */
interface AopConfig {
  groupByArea: boolean;
  sortMode: SortMode;
  filterMode: FilterMode;
  allExpanded: boolean; // true = expand all by default, false = collapse all
}

interface AgentOverviewPanelProps {
  activeAgentId: string;
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
}

type SortMode = 'name' | 'status' | 'recent';
type FilterMode = 'all' | 'working' | 'idle' | 'error';

const STATUS_ICONS: Record<string, string> = {
  working: '🟢',
  idle: '💤',
  waiting_input: '🟡',
  waiting_permission: '🟠',
  error: '🔴',
  stopped: '⚫',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  working: 'overview.statusLabels.working',
  idle: 'overview.statusLabels.idle',
  waiting_input: 'overview.statusLabels.waitingInput',
  waiting_permission: 'overview.statusLabels.waitingPermission',
  error: 'overview.statusLabels.error',
  stopped: 'overview.statusLabels.stopped',
};

/** Get the last non-streaming, non-tool output for an agent (the last "real" message) */
function getLastMessage(agentId: string): ClaudeOutput | null {
  const outputs = store.getState().agentOutputs.get(agentId);
  if (!outputs || outputs.length === 0) return null;
  for (let i = outputs.length - 1; i >= 0; i--) {
    const o = outputs[i];
    if (o.isStreaming) continue;
    const t = o.text;
    if (t.startsWith('Using tool:') || t.startsWith('Tool input:') || t.startsWith('Tool result:') || t.startsWith('Bash output:')) continue;
    if (t.startsWith('Tokens:') || t.startsWith('Cost:') || t.startsWith('Context:')) continue;
    if (t.trim().length === 0) continue;
    return o;
  }
  return null;
}

/** Count meaningful messages for an agent */
function getMessageCount(agentId: string): number {
  const outputs = store.getState().agentOutputs.get(agentId);
  if (!outputs) return 0;
  let count = 0;
  for (const o of outputs) {
    if (o.isStreaming) continue;
    const t = o.text;
    if (t.startsWith('Using tool:') || t.startsWith('Tool input:') || t.startsWith('Tool result:') || t.startsWith('Bash output:')) continue;
    if (t.startsWith('Tokens:') || t.startsWith('Cost:') || t.startsWith('Context:')) continue;
    if (t.trim().length === 0) continue;
    count++;
  }
  return count;
}

/** Truncate text with ellipsis */
function truncate(text: string, maxLen: number): string {
  const line = text.split('\n')[0];
  return line.length > maxLen ? line.slice(0, maxLen) + '...' : line;
}

interface AreaGroup {
  area: DrawingArea | null;
  agents: Agent[];
}

export function AgentOverviewPanel({ activeAgentId, onClose, onSelectAgent }: AgentOverviewPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const agents = useAgentsArray();
  const toolExecutions = useToolExecutions();
  const subagents = useSubagents();
  const areas = useAreas();

  // Load persisted config from localStorage
  const savedConfig = useMemo(() => getStorage<AopConfig>(STORAGE_KEYS.AOP_CONFIG, {
    groupByArea: true,
    sortMode: 'recent',
    filterMode: 'all',
    allExpanded: false,
  }), []);

  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() =>
    savedConfig.allExpanded ? new Set(agents.map(a => a.id)) : new Set([activeAgentId])
  );
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>(savedConfig.sortMode);
  const [filterMode, setFilterMode] = useState<FilterMode>(savedConfig.filterMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByArea, setGroupByArea] = useState(savedConfig.groupByArea);
  const [allExpanded, setAllExpanded] = useState(savedConfig.allExpanded);

  // Persist config changes to localStorage
  useEffect(() => {
    setStorage(STORAGE_KEYS.AOP_CONFIG, { groupByArea, sortMode, filterMode, allExpanded } as AopConfig);
  }, [groupByArea, sortMode, filterMode, allExpanded]);

  // Map agent -> area info (color + name) for badge display
  const agentAreaInfo = useMemo(() => {
    const map = new Map<string, { color: string; name: string }>();
    for (const [, area] of areas) {
      if (area.archived) continue;
      for (const agentId of area.assignedAgentIds) {
        map.set(agentId, { color: area.color, name: area.name });
      }
    }
    return map;
  }, [areas]);

  // Group tool executions by agent
  const toolsByAgent = useMemo(() => {
    const map = new Map<string, ToolExecution[]>();
    for (const exec of toolExecutions) {
      const list = map.get(exec.agentId) || [];
      list.push(exec);
      map.set(exec.agentId, list);
    }
    return map;
  }, [toolExecutions]);

  // Group subagents by parent
  const subagentsByParent = useMemo(() => {
    const map = new Map<string, Subagent[]>();
    for (const [, sub] of subagents) {
      const list = map.get(sub.parentAgentId) || [];
      list.push(sub);
      map.set(sub.parentAgentId, list);
    }
    return map;
  }, [subagents]);

  // Filter agents
  const filteredAgents = useMemo(() => {
    return agents.filter(a => {
      if (filterMode === 'working' && a.status !== 'working') return false;
      if (filterMode === 'idle' && a.status !== 'idle') return false;
      if (filterMode === 'error' && a.status !== 'error') return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return a.name.toLowerCase().includes(q) || a.id.includes(q) || (a.class || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [agents, filterMode, searchQuery]);

  // Sort agents within groups
  const sortAgents = useCallback((list: Agent[]) => {
    return [...list].sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'status') {
        const statusOrder = ['working', 'waiting_input', 'waiting_permission', 'error', 'idle', 'stopped'];
        return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
      }
      const aTime = (toolsByAgent.get(a.id) || [])[0]?.timestamp || 0;
      const bTime = (toolsByAgent.get(b.id) || [])[0]?.timestamp || 0;
      return bTime - aTime;
    });
  }, [sortMode, toolsByAgent]);

  // Build area groups (or flat list)
  const areaGroups = useMemo(() => {
    if (!groupByArea) {
      // Flat list: single group with no area
      return [{ area: null, agents: sortAgents(filteredAgents) }] as AreaGroup[];
    }

    const agentAreaMap = new Map<string, string>();
    for (const [areaId, area] of areas) {
      if (area.archived) continue;
      for (const agentId of area.assignedAgentIds) {
        agentAreaMap.set(agentId, areaId);
      }
    }

    const groups: AreaGroup[] = [];
    const usedAgentIds = new Set<string>();

    for (const [areaId, area] of areas) {
      if (area.archived) continue;
      const areaAgents = filteredAgents.filter(a => agentAreaMap.get(a.id) === areaId);
      if (areaAgents.length > 0) {
        groups.push({ area, agents: sortAgents(areaAgents) });
        areaAgents.forEach(a => usedAgentIds.add(a.id));
      }
    }

    const unassigned = filteredAgents.filter(a => !usedAgentIds.has(a.id));
    if (unassigned.length > 0) {
      groups.push({ area: null, agents: sortAgents(unassigned) });
    }

    return groups;
  }, [areas, filteredAgents, sortAgents, groupByArea]);

  // Status summary
  const statusSummary = useMemo(() => {
    const summary = { total: agents.length, working: 0, idle: 0, error: 0 };
    for (const a of agents) {
      if (a.status === 'working') summary.working++;
      else if (a.status === 'error') summary.error++;
      else if (a.status === 'idle') summary.idle++;
    }
    return summary;
  }, [agents]);

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const toggleArea = (areaKey: string) => {
    setCollapsedAreas(prev => {
      const next = new Set(prev);
      if (next.has(areaKey)) next.delete(areaKey);
      else next.add(areaKey);
      return next;
    });
  };

  const expandAll = () => { setExpandedAgents(new Set(agents.map(a => a.id))); setAllExpanded(true); };
  const collapseAll = () => { setExpandedAgents(new Set()); setAllExpanded(false); };

  return (
    <div className="agent-overview-panel">
      {/* Header */}
      <div className="aop-header">
        <div className="aop-title">
          <span className="icon">📊</span>
          {t('terminal:overview.title')}
        </div>
        <button className="close-btn" onClick={onClose} title={t('common:buttons.close')}>
          ✕
        </button>
      </div>

      {/* Stats Bar */}
      <div className="aop-stats">
        <span className="stat">{t('terminal:overview.agents', { count: statusSummary.total })}</span>
        {statusSummary.working > 0 && <span className="stat stat-working">🟢 {statusSummary.working}</span>}
        {statusSummary.idle > 0 && <span className="stat stat-idle">💤 {statusSummary.idle}</span>}
        {statusSummary.error > 0 && <span className="stat stat-error">🔴 {statusSummary.error}</span>}
        <span className="stat">{t('terminal:overview.tools', { count: toolExecutions.length })}</span>
      </div>

      {/* Controls */}
      <div className="aop-controls">
        <select
          value={filterMode}
          onChange={e => setFilterMode(e.target.value as FilterMode)}
          className="filter-select"
        >
          <option value="all">{t('terminal:overview.allStatus')}</option>
          <option value="working">{t('terminal:overview.statusLabels.working')}</option>
          <option value="idle">{t('terminal:overview.statusLabels.idle')}</option>
          <option value="error">{t('terminal:overview.statusLabels.error')}</option>
        </select>
        <select
          value={sortMode}
          onChange={e => setSortMode(e.target.value as SortMode)}
          className="filter-select"
        >
          <option value="recent">{t('terminal:overview.mostRecent')}</option>
          <option value="status">{t('terminal:overview.byStatus')}</option>
          <option value="name">{t('terminal:overview.byName')}</option>
        </select>
        <input
          type="text"
          placeholder={t('terminal:overview.searchAgents')}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      {/* Actions */}
      <div className="aop-actions">
        <button onClick={expandAll} className="action-btn" title={t('common:buttons.expand')}>
          {t('common:buttons.expand')}
        </button>
        <button onClick={collapseAll} className="action-btn" title={t('common:buttons.collapse')}>
          {t('common:buttons.collapse')}
        </button>
        <label className="aop-group-toggle" title={t('terminal:overview.areas')}>
          <input
            type="checkbox"
            checked={groupByArea}
            onChange={e => setGroupByArea(e.target.checked)}
          />
          <span className="toggle-switch" />
          <span className="toggle-label">{t('terminal:overview.areas')}</span>
        </label>
      </div>

      {/* Agent List grouped by area */}
      <div className="aop-agent-list">
        {areaGroups.length === 0 ? (
          <div className="aop-empty">
            {agents.length === 0 ? t('terminal:overview.noAgentsDeployed') : t('terminal:overview.noAgentsMatch')}
          </div>
        ) : (
          areaGroups.map(group => {
            const areaKey = group.area?.id || '__unassigned__';
            const areaName = group.area?.name || (groupByArea ? t('terminal:overview.unassigned') : '');
            const areaColor = group.area?.color || '#6272a4';
            const isCollapsed = collapsedAreas.has(areaKey);

            return (
              <div key={areaKey} className="aop-area-group">
                {/* Only show area header when grouping is on */}
                {groupByArea && (
                  <div
                    className="aop-area-header"
                    onClick={() => toggleArea(areaKey)}
                    style={{ borderLeftColor: areaColor }}
                  >
                    <span className="aop-area-expand">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="aop-area-color" style={{ background: areaColor }} />
                    <span className="aop-area-name">{areaName}</span>
                    <span className="aop-area-count">{group.agents.length}</span>
                  </div>
                )}
                {(!groupByArea || !isCollapsed) && group.agents.map(agent => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isActive={agent.id === activeAgentId}
                    isExpanded={expandedAgents.has(agent.id)}
                    toolExecs={toolsByAgent.get(agent.id) || []}
                    subagents={subagentsByParent.get(agent.id) || []}
                    areaInfo={agentAreaInfo.get(agent.id)}
                    onToggle={() => toggleAgent(agent.id)}
                    onSelect={() => onSelectAgent(agent.id)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Agent Card sub-component
// ============================================================================

interface AgentCardProps {
  agent: Agent;
  isActive: boolean;
  isExpanded: boolean;
  toolExecs: ToolExecution[];
  subagents: Subagent[];
  areaInfo?: { color: string; name: string };
  onToggle: () => void;
  onSelect: () => void;
}

/** Unified subagent entry combining live store data and tool execution history */
interface SubagentEntry {
  id: string;
  name: string;
  type: string;
  description?: string;
  status: 'working' | 'spawning' | 'completed' | 'failed' | 'unknown';
  timestamp: number;
}

function AgentCard({ agent, isActive, isExpanded, toolExecs, subagents, areaInfo, onToggle, onSelect }: AgentCardProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const statusIcon = STATUS_ICONS[agent.status] || '❓';
  const statusLabel = STATUS_LABEL_KEYS[agent.status] ? t(`terminal:${STATUS_LABEL_KEYS[agent.status]}`) : agent.status;
  const recentTools = toolExecs.slice(0, 8);
  const lastMsg = getLastMessage(agent.id);
  const msgCount = getMessageCount(agent.id);

  // Build unified subagent list: live subagents + Task tool execs not in live store
  const allSubagentEntries = useMemo((): SubagentEntry[] => {
    const entries: SubagentEntry[] = [];
    const seenNames = new Set<string>();

    // First: live subagents from the store (most accurate status)
    for (const sub of subagents) {
      entries.push({
        id: sub.id,
        name: sub.name,
        type: sub.subagentType,
        description: sub.description,
        status: sub.status,
        timestamp: sub.startedAt,
      });
      seenNames.add(sub.name);
    }

    // Second: Task tool executions that don't have a matching live subagent
    for (const exec of toolExecs) {
      if (exec.toolName !== 'Task') continue;
      const desc = (exec.toolInput?.description as string) || (exec.toolInput?.name as string) || '';
      const name = desc || (exec.toolInput?.prompt as string)?.slice(0, 40) || 'Task';
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      entries.push({
        id: `task-${exec.timestamp}`,
        name,
        type: (exec.toolInput?.subagent_type as string) || 'unknown',
        description: (exec.toolInput?.prompt as string)?.slice(0, 100),
        status: 'completed',
        timestamp: exec.timestamp,
      });
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  }, [subagents, toolExecs]);

  const activeSubagents = allSubagentEntries.filter(s => s.status === 'working' || s.status === 'spawning');

  return (
    <div className={`aop-agent-card ${isActive ? 'active' : ''} ${agent.status}`}>
      {/* Card Header - always visible */}
      <div className="aop-agent-header" onClick={onToggle}>
        <span className="aop-expand-icon">{isExpanded ? '▾' : '▸'}</span>
        <span className="aop-agent-status" title={statusLabel}>{statusIcon}</span>
        <span
          className="aop-agent-name"
          onClick={e => { e.stopPropagation(); onSelect(); }}
          title={t('terminal:overview.clickToSwitch')}
          style={areaInfo ? { background: `${areaInfo.color}22`, borderColor: `${areaInfo.color}44` } : undefined}
        >
          {agent.name}
        </span>
        {areaInfo && (
          <span
            className="aop-area-chip"
            style={{ background: `${areaInfo.color}20`, borderColor: `${areaInfo.color}40`, color: areaInfo.color }}
          >
            {areaInfo.name}
          </span>
        )}
        {msgCount > 0 && (
          <span className="aop-msg-count" title={t('terminal:overview.messages', { count: msgCount })}>
            {msgCount}
          </span>
        )}
        {agent.class && <span className="aop-agent-class">{agent.class}</span>}
        {activeSubagents.length > 0 && (
          <span className="aop-subagent-count" title={activeSubagents.map(s => `${s.name}: ${s.description || s.type}`).join('\n')}>
            ⑂{activeSubagents.length}
          </span>
        )}
        {allSubagentEntries.length > 0 && activeSubagents.length === 0 && (
          <span className="aop-subagent-count" title={t('terminal:overview.subagentsCompleted', { count: allSubagentEntries.length })} style={{ opacity: 0.5 }}>
            ⑂{allSubagentEntries.length}
          </span>
        )}
      </div>

      {/* Last message preview - always visible below header */}
      {lastMsg && (
        <div
          className={`aop-last-message ${lastMsg.isUserPrompt ? 'user' : 'assistant'}`}
          title={lastMsg.text.split('\n')[0]}
        >
          <span className="lm-prefix">{lastMsg.isUserPrompt ? '▶' : '◀'}</span>
          <span className="lm-text">{truncate(lastMsg.text, 80)}</span>
          <span className="lm-time">{formatTimestamp(lastMsg.timestamp)}</span>
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && (
        <div className="aop-agent-body">
          {/* Subagents (live + historical from tool execs) */}
          {allSubagentEntries.length > 0 && (
            <div className="aop-subagents">
              <div className="aop-section-label">{t('terminal:overview.subagents', { count: allSubagentEntries.length })}</div>
              {allSubagentEntries.map(sub => (
                <div key={sub.id} className={`aop-subagent-item ${sub.status}`}>
                  <span className="sub-icon">
                    {sub.status === 'completed' ? '✅' : sub.status === 'failed' ? '❌' : sub.status === 'unknown' ? '⬜' : '⑂'}
                  </span>
                  <span className="sub-name">{sub.name}</span>
                  <span className="sub-type">{sub.type}</span>
                  {sub.description && (
                    <span className="sub-desc" title={sub.description}>{truncate(sub.description, 50)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Recent tool activity timeline */}
          {recentTools.length > 0 && (
            <div className="aop-tool-timeline">
              <div className="aop-section-label">{t('terminal:overview.recentActivity')}</div>
              {recentTools.map((exec, i) => {
                const param = exec.toolInput
                  ? (exec.toolInput.file_path as string)
                    || (exec.toolInput.command as string)?.slice(0, 40)
                    || (exec.toolInput.pattern as string)
                    || (exec.toolInput.description as string)
                    || (exec.toolInput.prompt as string)?.slice(0, 50)
                    || ''
                  : '';
                return (
                  <div key={`${exec.timestamp}-${i}`} className="aop-timeline-entry">
                    <span className="tl-time">{formatTimestamp(exec.timestamp)}</span>
                    <span className="tl-icon">{TOOL_ICONS[exec.toolName] || TOOL_ICONS.default}</span>
                    <span className="tl-tool">{exec.toolName}</span>
                    {param && <span className="tl-param">{param}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {toolExecs.length === 0 && subagents.length === 0 && (
            <div className="aop-no-activity">{t('terminal:overview.noToolActivity')}</div>
          )}
        </div>
      )}
    </div>
  );
}
