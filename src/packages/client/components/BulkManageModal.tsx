/**
 * BulkManageModal - Modal for bulk agent management operations
 *
 * Provides filtering, multi-select, and bulk actions (delete, stop, clear context, move to area).
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ModalPortal } from './shared/ModalPortal';
import { Icon } from './Icon';
import { useAgentsArray, useAreas, useSkillsArray } from '../store';
import {
  bulkDeleteAgents,
  bulkStopAgents,
  bulkClearContext,
  bulkMoveToArea,
  bulkChangeModel,
  bulkAddSkills,
  bulkRemoveSkills,
  type BulkActionResult,
  type BulkAddSkillsResult,
  type BulkRemoveSkillsResult,
} from '../api/bulk-agents';
import type { Agent, DrawingArea, Skill } from '../../shared/types';
import { CLAUDE_MODELS, CODEX_MODELS, CLAUDE_EFFORTS, isDeprecatedClaudeModel, type ClaudeModel, type ClaudeEffort, type CodexModel } from '../../shared/agent-types';
import '../styles/components/bulk-manage-modal.scss';

type ModelProvider = 'claude' | 'codex';

/** Convert areas Map to array */
function areasToArray(areas: Map<string, DrawingArea>): DrawingArea[] {
  return Array.from(areas.values());
}

export interface BulkManageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type StatusFilter = 'all' | 'idle' | 'working' | 'error' | 'stopped';
type IdleTimeFilter = 'any' | '>1h' | '>6h' | '>1d' | '>3d' | '>7d' | '>30d';
type ProviderFilter = 'all' | 'claude' | 'codex' | 'opencode' | 'grok' | 'pi';
type ModelFilter = 'all' | 'fable-5-1m' | 'fable-5' | 'opus' | 'opus-5-1m' | 'opus-5' | 'opus-4-8-1m' | 'opus-4-8' | 'opus-4-7-1m' | 'opus-4-7' | 'opus-4-6' | 'sonnet' | 'haiku';

type ConfirmAction = 'delete' | 'clear-context' | 'change-model' | 'add-skill' | 'remove-skill' | null;
type SkillPickerMode = 'add' | 'remove' | null;

const IDLE_TIME_MS: Record<Exclude<IdleTimeFilter, 'any'>, number> = {
  '>1h': 60 * 60 * 1000,
  '>6h': 6 * 60 * 60 * 1000,
  '>1d': 24 * 60 * 60 * 1000,
  '>3d': 3 * 24 * 60 * 60 * 1000,
  '>7d': 7 * 24 * 60 * 60 * 1000,
  '>30d': 30 * 24 * 60 * 60 * 1000,
};

function formatIdleTime(lastActivity: number): string {
  const diff = Date.now() - lastActivity;
  if (diff < 60_000) return '<1m';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

function getAgentArea(agent: Agent, areas: DrawingArea[]): DrawingArea | null {
  for (const area of areas) {
    if (area.assignedAgentIds.includes(agent.id)) return area;
  }
  return null;
}

export function BulkManageModal({ isOpen, onClose }: BulkManageModalProps) {
  const agents = useAgentsArray();
  const areasMap = useAreas();
  const areas = areasToArray(areasMap);
  const skills = useSkillsArray();

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [idleTimeFilter, setIdleTimeFilter] = useState<IdleTimeFilter>('any');
  const [areaFilter, setAreaFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Action state
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [moveAreaId, setMoveAreaId] = useState<string>('');
  const [modelProvider, setModelProvider] = useState<ModelProvider>('claude');
  const [newClaudeModel, setNewClaudeModel] = useState<ClaudeModel>('claude-opus-4-8[1m]');
  const [newCodexModel, setNewCodexModel] = useState<CodexModel>('gpt-5.6-luna');
  // 'default' represents "leave unchanged / use default"; other values are ClaudeEffort levels
  const [newEffort, setNewEffort] = useState<ClaudeEffort | 'default'>('xHigh');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Skill picker state (multi-select)
  const [skillPickerMode, setSkillPickerMode] = useState<SkillPickerMode>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [pendingSkillIds, setPendingSkillIds] = useState<Set<string>>(new Set());

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set());
      setError(null);
      setSuccess(null);
      setConfirmAction(null);
      setSkillPickerMode(null);
      setSkillSearchQuery('');
      setPendingSkillIds(new Set());
    }
  }, [isOpen]);

  // Filter agents
  const filteredAgents = useMemo(() => {
    const now = Date.now();
    const query = searchQuery.toLowerCase().trim();

    return agents.filter(agent => {
      // Status filter
      if (statusFilter !== 'all' && agent.status !== statusFilter) return false;

      // Idle time filter
      if (idleTimeFilter !== 'any') {
        const idleMs = now - agent.lastActivity;
        if (idleMs < IDLE_TIME_MS[idleTimeFilter]) return false;
      }

      // Area filter
      if (areaFilter !== 'all') {
        const agentArea = getAgentArea(agent, areas);
        if (areaFilter === 'unassigned') {
          if (agentArea !== null) return false;
        } else {
          if (!agentArea || agentArea.id !== areaFilter) return false;
        }
      }

      // Provider filter
      if (providerFilter !== 'all' && agent.provider !== providerFilter) return false;

      // Model filter
      if (modelFilter !== 'all') {
        const agentModel = agent.model || 'sonnet';
        const matchesFilter =
          modelFilter === 'fable-5-1m' ? agentModel === 'claude-fable-5[1m]' :
          modelFilter === 'fable-5' ? agentModel === 'claude-fable-5' :
          modelFilter === 'opus-5-1m' ? agentModel === 'claude-opus-5[1m]' :
          modelFilter === 'opus-5' ? agentModel === 'claude-opus-5' :
          modelFilter === 'opus-4-8-1m' ? agentModel === 'claude-opus-4-8[1m]' :
          modelFilter === 'opus-4-8' ? agentModel === 'claude-opus-4-8' :
          modelFilter === 'opus-4-7-1m' ? agentModel === 'opus[1m]' :
          modelFilter === 'opus-4-7' ? agentModel === 'claude-opus-4-7' :
          modelFilter === 'opus-4-6' ? agentModel === 'claude-opus-4-6' :
          agentModel === modelFilter;
        if (!matchesFilter) return false;
      }

      // Text search
      if (query) {
        const nameMatch = agent.name.toLowerCase().includes(query);
        const classMatch = agent.class.toLowerCase().includes(query);
        if (!nameMatch && !classMatch) return false;
      }

      return true;
    });
  }, [agents, areas, statusFilter, idleTimeFilter, areaFilter, providerFilter, modelFilter, searchQuery]);

  // Clean up selected IDs when filtered agents change
  useEffect(() => {
    const filteredIds = new Set(filteredAgents.map(a => a.id));
    setSelectedIds(prev => {
      const next = new Set<string>();
      for (const id of prev) {
        if (filteredIds.has(id)) next.add(id);
      }
      return next.size !== prev.size ? next : prev;
    });
  }, [filteredAgents]);

  const toggleSelect = useCallback((agentId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredAgents.map(a => a.id)));
  }, [filteredAgents]);

  const selectNone = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Skills available for the picker, filtered by mode and search query.
  // - 'add': all enabled skills.
  // - 'remove': only enabled skills currently assigned directly to ≥1 selected agent.
  const pickerSkills = useMemo<Skill[]>(() => {
    if (!skillPickerMode) return [];
    const query = skillSearchQuery.toLowerCase().trim();
    let base: Skill[];
    if (skillPickerMode === 'add') {
      base = skills.filter(s => s.enabled);
    } else {
      base = skills.filter(s => {
        if (!s.enabled) return false;
        for (const agentId of selectedIds) {
          if (s.assignedAgentIds.includes(agentId)) return true;
        }
        return false;
      });
    }
    if (!query) return base;
    return base.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query) ||
      s.slug.toLowerCase().includes(query)
    );
  }, [skillPickerMode, skillSearchQuery, skills, selectedIds]);

  const pendingSkillsList = useMemo<Skill[]>(
    () => skills.filter(s => pendingSkillIds.has(s.id)),
    [pendingSkillIds, skills]
  );
  const pendingSkillsLabel = useMemo(() => {
    if (pendingSkillsList.length === 0) return '';
    if (pendingSkillsList.length === 1) return `"${pendingSkillsList[0].name}"`;
    if (pendingSkillsList.length <= 3) return pendingSkillsList.map(s => `"${s.name}"`).join(', ');
    return `${pendingSkillsList.length} skills`;
  }, [pendingSkillsList]);

  // For 'remove-skill' confirm: how many (agent, skill) pairs would actually be
  // affected, i.e. selected agents that have at least one of the pending skills
  // directly assigned. Counts each pair, so an agent with 2 pending skills
  // contributes 2.
  const removeSkillAffectedPairs = useMemo(() => {
    if (pendingSkillsList.length === 0) return 0;
    let count = 0;
    for (const agentId of selectedIds) {
      for (const skill of pendingSkillsList) {
        if (skill.assignedAgentIds.includes(agentId)) count++;
      }
    }
    return count;
  }, [pendingSkillsList, selectedIds]);

  // Map of agentId -> sorted list of enabled skill chips that apply to that
  // agent. Direct assignments are editable via Bulk Remove; wildcard ('*') and
  // class-default assignments are framework/class-level and not removable per-agent.
  type AgentSkillChip = { name: string; source: 'direct' | 'class' | 'wildcard' };
  const skillsByAgent = useMemo(() => {
    const map = new Map<string, AgentSkillChip[]>();
    for (const agent of agents) {
      const list: AgentSkillChip[] = [];
      for (const skill of skills) {
        if (!skill.enabled) continue;
        const direct = skill.assignedAgentIds.includes(agent.id);
        const wildcard = skill.assignedAgentClasses.includes('*');
        const viaClass = skill.assignedAgentClasses.includes(agent.class);
        if (direct) {
          list.push({ name: skill.name, source: 'direct' });
        } else if (wildcard) {
          list.push({ name: skill.name, source: 'wildcard' });
        } else if (viaClass) {
          list.push({ name: skill.name, source: 'class' });
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      map.set(agent.id, list);
    }
    return map;
  }, [agents, skills]);

  // IDs of selected agents whose provider matches the chosen modelProvider
  const modelProviderSelectedIds = useMemo(() => {
    const agentById = new Map(agents.map(a => [a.id, a]));
    return Array.from(selectedIds).filter(id => {
      const agent = agentById.get(id);
      return agent && (agent.provider ?? 'claude') === modelProvider;
    });
  }, [agents, selectedIds, modelProvider]);

  const handleAction = useCallback(async (action: string) => {
    setActionInProgress(true);
    setError(null);
    setSuccess(null);

    try {
      let result: BulkActionResult | undefined;
      let addResult: BulkAddSkillsResult | undefined;
      let removeResult: BulkRemoveSkillsResult | undefined;
      let verb = '';

      if (action === 'change-model') {
        const ids = modelProviderSelectedIds;
        if (ids.length === 0) {
          setActionInProgress(false);
          setConfirmAction(null);
          return;
        }
        const model = modelProvider === 'claude' ? newClaudeModel : newCodexModel;
        const effort = modelProvider === 'claude'
          ? (newEffort === 'default' ? null : newEffort)
          : undefined;
        result = await bulkChangeModel(ids, modelProvider, model, effort);
        verb = 'Changed model for';
      } else if (action === 'add-skill' || action === 'remove-skill') {
        const ids = Array.from(selectedIds);
        const skillIds = Array.from(pendingSkillIds);
        if (ids.length === 0 || skillIds.length === 0) {
          setActionInProgress(false);
          setConfirmAction(null);
          return;
        }
        if (action === 'add-skill') {
          addResult = await bulkAddSkills(ids, skillIds);
        } else {
          removeResult = await bulkRemoveSkills(ids, skillIds);
        }
      } else {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
          setActionInProgress(false);
          setConfirmAction(null);
          return;
        }
        switch (action) {
          case 'delete':
            result = await bulkDeleteAgents(ids);
            verb = 'Deleted';
            if (result.failed.length === 0) setSelectedIds(new Set());
            break;
          case 'stop':
            result = await bulkStopAgents(ids);
            verb = 'Stopped';
            break;
          case 'clear-context':
            result = await bulkClearContext(ids);
            verb = 'Cleared context for';
            break;
          case 'move-area':
            result = await bulkMoveToArea(ids, moveAreaId || null);
            verb = 'Moved';
            break;
        }
      }

      if (result) {
        if (result.failed.length > 0) {
          setSuccess(`${verb} ${result.succeeded.length} agent(s). Failed: ${result.failed.length}`);
        } else {
          setSuccess(`${verb} ${result.succeeded.length} agent(s)`);
        }
      } else if (addResult) {
        const skillCount = addResult.results.length;
        const totalAdded = addResult.results.reduce((sum, r) => sum + r.updated.length, 0);
        const totalAlready = addResult.results.reduce((sum, r) => sum + r.alreadyHad.length, 0);
        const totalFailed = addResult.results.reduce((sum, r) => sum + r.failed.length, 0);
        const alreadySuffix = totalAlready > 0 ? ` (${totalAlready} already assigned)` : '';
        const failSuffix = totalFailed > 0 ? `, ${totalFailed} failed` : '';
        setSuccess(`Added ${skillCount} skill(s): ${totalAdded} new assignment(s)${alreadySuffix}${failSuffix}`);
        setPendingSkillIds(new Set());
      } else if (removeResult) {
        const skillCount = removeResult.results.length;
        const totalRemoved = removeResult.results.reduce((sum, r) => sum + r.updated.length, 0);
        const totalMissing = removeResult.results.reduce((sum, r) => sum + r.didNotHave.length, 0);
        const totalFailed = removeResult.results.reduce((sum, r) => sum + r.failed.length, 0);
        const missingSuffix = totalMissing > 0 ? ` (${totalMissing} weren't assigned)` : '';
        const failSuffix = totalFailed > 0 ? `, ${totalFailed} failed` : '';
        setSuccess(`Removed ${skillCount} skill(s): ${totalRemoved} assignment(s) removed${missingSuffix}${failSuffix}`);
        setPendingSkillIds(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionInProgress(false);
      setConfirmAction(null);
    }
  }, [selectedIds, moveAreaId, modelProviderSelectedIds, modelProvider, newClaudeModel, newCodexModel, newEffort, pendingSkillIds]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (confirmAction) {
        setConfirmAction(null);
      } else if (skillPickerMode) {
        setSkillPickerMode(null);
        setSkillSearchQuery('');
        setPendingSkillIds(new Set());
      } else {
        onClose();
      }
    }
  }, [confirmAction, skillPickerMode, onClose]);

  const openSkillPicker = useCallback((mode: 'add' | 'remove') => {
    setSkillPickerMode(mode);
    setSkillSearchQuery('');
    setPendingSkillIds(new Set());
    setError(null);
    setSuccess(null);
  }, []);

  const closeSkillPicker = useCallback(() => {
    setSkillPickerMode(null);
    setSkillSearchQuery('');
    setPendingSkillIds(new Set());
  }, []);

  const togglePendingSkill = useCallback((skillId: string) => {
    setPendingSkillIds(prev => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }, []);

  const confirmSkillPick = useCallback(() => {
    if (!skillPickerMode || pendingSkillIds.size === 0) return;
    setConfirmAction(skillPickerMode === 'add' ? 'add-skill' : 'remove-skill');
    setSkillPickerMode(null);
    setSkillSearchQuery('');
  }, [skillPickerMode, pendingSkillIds]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={onClose}>
        <div className="bulk-manage-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
          {/* Header */}
          <div className="modal-header">
            <h2>Bulk Agent Management</h2>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              &#x2715;
            </button>
          </div>

          {/* Filters */}
          <div className="bulk-filters">
            <div className="filter-row">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                className="bulk-filter-select"
              >
                <option value="all">All Status</option>
                <option value="idle">Idle</option>
                <option value="working">Working</option>
                <option value="error">Error</option>
                <option value="stopped">Stopped</option>
              </select>

              <select
                value={idleTimeFilter}
                onChange={e => setIdleTimeFilter(e.target.value as IdleTimeFilter)}
                className="bulk-filter-select"
              >
                <option value="any">Any Idle Time</option>
                <option value=">1h">&gt; 1 hour</option>
                <option value=">6h">&gt; 6 hours</option>
                <option value=">1d">&gt; 1 day</option>
                <option value=">3d">&gt; 3 days</option>
                <option value=">7d">&gt; 7 days</option>
                <option value=">30d">&gt; 30 days</option>
              </select>

              <select
                value={areaFilter}
                onChange={e => setAreaFilter(e.target.value)}
                className="bulk-filter-select"
              >
                <option value="all">All Areas</option>
                <option value="unassigned">Unassigned</option>
                {areas.map(area => (
                  <option key={area.id} value={area.id}>{area.name}</option>
                ))}
              </select>

              <select
                value={providerFilter}
                onChange={e => setProviderFilter(e.target.value as ProviderFilter)}
                className="bulk-filter-select"
              >
                <option value="all">All Providers</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="opencode">OpenCode</option>
                <option value="grok">Grok</option>
                <option value="pi">Pi</option>
              </select>

              <select
                value={modelFilter}
                onChange={e => setModelFilter(e.target.value as ModelFilter)}
                className="bulk-filter-select"
              >
                <option value="all">All Models</option>
                <option value="fable-5-1m">Fable 5 [1M]</option>
                <option value="fable-5">Fable 5 (200K)</option>
                <option value="opus-5-1m">Opus 5 [1M]</option>
                <option value="opus-5">Opus 5 (200K)</option>
                <option value="opus-4-8-1m">Opus 4.8 [1M]</option>
                <option value="opus-4-7-1m">Opus 4.7 [1M]</option>
                <option value="opus-4-8">Opus 4.8 (200K)</option>
                <option value="opus-4-7">Opus 4.7 (200K)</option>
                <option value="opus-4-6">Opus 4.6</option>
                <option value="opus">Opus (legacy)</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>

              <input
                type="text"
                placeholder="Search name/class..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bulk-filter-search"
              />
            </div>
          </div>

          {/* Count + Select controls */}
          <div className="bulk-count-bar">
            <span className="bulk-count">
              {filteredAgents.length} matched, {selectedIds.size} selected
            </span>
            <div className="bulk-select-controls">
              <button className="bulk-link-btn" onClick={selectAll}>Select all</button>
              <button className="bulk-link-btn" onClick={selectNone}>Select none</button>
            </div>
          </div>

          {/* Alerts */}
          {error && (
            <div className="bulk-alert bulk-alert-error">
              <span className="alert-icon">!</span>
              {error}
            </div>
          )}
          {success && (
            <div className="bulk-alert bulk-alert-success">
              <span className="alert-icon">&#x2713;</span>
              {success}
            </div>
          )}

          {/* Agent list */}
          <div className="bulk-agent-list">
            {filteredAgents.length === 0 ? (
              <div className="bulk-empty">No agents match the current filters</div>
            ) : (
              <table className="bulk-table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filteredAgents.length && filteredAgents.length > 0}
                        onChange={() => selectedIds.size === filteredAgents.length ? selectNone() : selectAll()}
                      />
                    </th>
                    <th className="col-name">Name</th>
                    <th className="col-class">Class</th>
                    <th className="col-status">Status</th>
                    <th className="col-idle">Idle</th>
                    <th className="col-area">Area</th>
                    <th className="col-skills">Skills</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map(agent => {
                    const agentArea = getAgentArea(agent, areas);
                    const agentSkills = skillsByAgent.get(agent.id) ?? [];
                    return (
                      <tr
                        key={agent.id}
                        className={selectedIds.has(agent.id) ? 'selected' : ''}
                        onClick={() => toggleSelect(agent.id)}
                      >
                        <td className="col-check">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(agent.id)}
                            onChange={() => toggleSelect(agent.id)}
                            onClick={e => e.stopPropagation()}
                          />
                        </td>
                        <td className="col-name">{agent.name}</td>
                        <td className="col-class">{agent.class}</td>
                        <td className="col-status">
                          <span className={`bulk-status bulk-status-${agent.status}`}>
                            {agent.status}
                          </span>
                        </td>
                        <td className="col-idle">{formatIdleTime(agent.lastActivity)}</td>
                        <td className="col-area">
                          {agentArea ? (
                            <span className="bulk-area-badge" style={{ borderColor: agentArea.color }}>
                              {agentArea.name}
                            </span>
                          ) : (
                            <span className="bulk-area-none">--</span>
                          )}
                        </td>
                        <td className="col-skills">
                          {agentSkills.length === 0 ? (
                            <span className="bulk-area-none">--</span>
                          ) : (
                            <div className="bulk-skill-chips">
                              {agentSkills.map(chip => {
                                const readOnly = chip.source !== 'direct';
                                const tooltip =
                                  chip.source === 'wildcard'
                                    ? `${chip.name} — applied to all agents ('*' wildcard); not removable per-agent`
                                    : chip.source === 'class'
                                    ? `${chip.name} — applied to all "${agent.class}" agents via class default; not removable per-agent`
                                    : chip.name;
                                return (
                                  <span key={chip.name} className="bulk-skill-chip" title={tooltip}>
                                    {chip.name}
                                    {readOnly && (
                                      <span className="bulk-skill-chip-asterisk" aria-hidden="true">
                                        *
                                      </span>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Skill picker overlay */}
          {skillPickerMode && (
            <div className="bulk-confirm-overlay">
              <div className="bulk-confirm-box" style={{ minWidth: 480, maxWidth: 640, textAlign: 'left' }}>
                <p style={{ fontWeight: 600, marginBottom: 8 }}>
                  {skillPickerMode === 'add'
                    ? `Add skills to ${selectedIds.size} selected agent(s)`
                    : `Remove skills from ${selectedIds.size} selected agent(s)`}
                </p>
                <input
                  type="text"
                  className="bulk-filter-search"
                  placeholder="Search skills..."
                  value={skillSearchQuery}
                  onChange={e => setSkillSearchQuery(e.target.value)}
                  autoFocus
                  style={{ width: '100%', marginBottom: 8 }}
                />
                <div
                  className="bulk-count-bar"
                  style={{ padding: '4px 0', borderBottom: 'none', marginBottom: 4 }}
                >
                  <span className="bulk-count">
                    {pendingSkillIds.size} of {pickerSkills.length} selected
                  </span>
                  <div className="bulk-select-controls">
                    <button
                      type="button"
                      className="bulk-link-btn"
                      onClick={() => setPendingSkillIds(new Set(pickerSkills.map(s => s.id)))}
                      disabled={pickerSkills.length === 0}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="bulk-link-btn"
                      onClick={() => setPendingSkillIds(new Set())}
                      disabled={pendingSkillIds.size === 0}
                    >
                      Select none
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    maxHeight: 320,
                    overflowY: 'auto',
                    border: '1px solid var(--border-color, #444)',
                    borderRadius: 4,
                    padding: 4,
                    textAlign: 'left',
                  }}
                >
                  {pickerSkills.length === 0 ? (
                    <div className="bulk-empty" style={{ padding: 16 }}>
                      {skillPickerMode === 'remove'
                        ? 'None of the selected agents have a directly-assigned skill matching this filter.'
                        : 'No skills match this search.'}
                    </div>
                  ) : (
                    pickerSkills.map(skill => {
                      const checked = pendingSkillIds.has(skill.id);
                      return (
                        <label
                          key={skill.id}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            padding: '6px 8px',
                            cursor: 'pointer',
                            borderRadius: 4,
                            textAlign: 'left',
                            background: checked ? 'var(--accent-soft, #4a9eff20)' : 'transparent',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePendingSkill(skill.id)}
                            style={{ marginTop: 3 }}
                          />
                          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                            <div style={{ fontWeight: 600 }}>
                              {skill.name}
                              {skill.builtin && (
                                <span style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginLeft: 6 }}>
                                  (built-in)
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary, #aaa)' }}>
                              {skill.description}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className="bulk-confirm-actions" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={closeSkillPicker}
                    disabled={actionInProgress}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={confirmSkillPick}
                    disabled={pendingSkillIds.size === 0 || actionInProgress}
                  >
                    Continue ({pendingSkillIds.size})
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Confirmation overlay */}
          {confirmAction && (
            <div className="bulk-confirm-overlay">
              <div className="bulk-confirm-box">
                {confirmAction === 'change-model' ? (
                  <>
                    <p>
                      Change model to <strong>
                        {modelProvider === 'claude'
                          ? CLAUDE_MODELS[newClaudeModel].label
                          : CODEX_MODELS[newCodexModel].label}
                      </strong>
                      {modelProvider === 'claude' && (
                        <>
                          {' '}at <strong>
                            {newEffort === 'default' ? 'default effort' : `${CLAUDE_EFFORTS[newEffort].label} effort`}
                          </strong>
                        </>
                      )}
                      {' '}for <strong>{modelProviderSelectedIds.length}</strong> {modelProvider} agent(s)?
                    </p>
                    {selectedIds.size > modelProviderSelectedIds.length && (
                      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>
                        {selectedIds.size - modelProviderSelectedIds.length} selected agent(s) with a different provider will be skipped.
                      </p>
                    )}
                    <p style={{ color: 'var(--color-danger, #e55)', fontWeight: 600 }}>
                      <Icon name="warn" size={14} /> The current conversation/context will be CLEARED for each affected agent.
                      Their Claude sessions will be stopped and restarted on the next command
                      so the new model takes effect.
                    </p>
                  </>
                ) : confirmAction === 'add-skill' ? (
                  <p>
                    Add <strong>{pendingSkillsList.length}</strong> skill{pendingSkillsList.length === 1 ? '' : 's'} (<strong>{pendingSkillsLabel}</strong>) to <strong>{selectedIds.size}</strong> agent(s)?
                    <br />
                    <span style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>
                      Idempotent — assignments that already exist will be skipped.
                    </span>
                  </p>
                ) : confirmAction === 'remove-skill' ? (
                  <p>
                    Remove <strong>{pendingSkillsList.length}</strong> skill{pendingSkillsList.length === 1 ? '' : 's'} (<strong>{pendingSkillsLabel}</strong>) from up to <strong>{selectedIds.size}</strong> selected agent(s)?
                    <br />
                    <span style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>
                      {removeSkillAffectedPairs} direct assignment(s) will be removed. Class-default and '*' wildcard assignments are not changed.
                    </span>
                  </p>
                ) : (
                  <p>
                    {confirmAction === 'delete'
                      ? `Delete ${selectedIds.size} agent(s)? This cannot be undone.`
                      : `Clear context for ${selectedIds.size} agent(s)? This will restart their sessions.`}
                  </p>
                )}
                <div className="bulk-confirm-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setConfirmAction(null)}
                    disabled={actionInProgress}
                  >
                    Cancel
                  </button>
                  <button
                    className={`btn ${confirmAction === 'add-skill' ? 'btn-primary' : 'btn-danger'}`}
                    onClick={() => handleAction(confirmAction)}
                    disabled={
                      actionInProgress ||
                      (confirmAction === 'change-model' && modelProviderSelectedIds.length === 0) ||
                      ((confirmAction === 'add-skill' || confirmAction === 'remove-skill') && pendingSkillIds.size === 0)
                    }
                  >
                    {actionInProgress ? 'Working...' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="modal-footer bulk-footer">
            <div className="footer-buttons-left">
              <button
                className="btn btn-danger"
                disabled={selectedIds.size === 0 || actionInProgress}
                onClick={() => setConfirmAction('delete')}
              >
                Delete Selected
              </button>
              <button
                className="btn btn-secondary"
                disabled={selectedIds.size === 0 || actionInProgress}
                onClick={() => setConfirmAction('clear-context')}
              >
                Clear Context
              </button>
              <button
                className="btn btn-primary"
                disabled={selectedIds.size === 0 || actionInProgress}
                onClick={() => openSkillPicker('add')}
              >
                Add Skill
              </button>
              <button
                className="btn btn-secondary"
                disabled={selectedIds.size === 0 || actionInProgress}
                onClick={() => openSkillPicker('remove')}
              >
                Remove Skill
              </button>
            </div>

            <div className="footer-buttons-right">
              <button
                className="btn btn-secondary"
                disabled={selectedIds.size === 0 || actionInProgress}
                onClick={() => handleAction('stop')}
              >
                Stop Selected
              </button>

              <select
                value={moveAreaId}
                onChange={e => setMoveAreaId(e.target.value)}
                className="bulk-filter-select"
                disabled={selectedIds.size === 0 || actionInProgress}
              >
                <option value="">Unassign area</option>
                {areas.map(area => (
                  <option key={area.id} value={area.id}>{area.name}</option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                disabled={selectedIds.size === 0 || actionInProgress}
                onClick={() => handleAction('move-area')}
              >
                Move to Area
              </button>
            </div>
          </div>

          {/* Change Model row */}
          <div className="modal-footer bulk-footer bulk-change-model-row">
            <div className="footer-buttons-left">
              <span className="bulk-change-model-label">Change Model:</span>
              <select
                value={modelProvider}
                onChange={e => setModelProvider(e.target.value as ModelProvider)}
                className="bulk-filter-select"
                disabled={actionInProgress}
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>

              {modelProvider === 'claude' ? (
                <select
                  value={newClaudeModel}
                  onChange={e => setNewClaudeModel(e.target.value as ClaudeModel)}
                  className="bulk-filter-select"
                  disabled={actionInProgress}
                >
                  {(Object.keys(CLAUDE_MODELS) as ClaudeModel[])
                    .filter(m => !isDeprecatedClaudeModel(m) || newClaudeModel === m)
                    .map(m => (
                      <option key={m} value={m}>
                        {CLAUDE_MODELS[m].icon} {CLAUDE_MODELS[m].label}
                      </option>
                    ))}
                </select>
              ) : (
                <select
                  value={newCodexModel}
                  onChange={e => setNewCodexModel(e.target.value as CodexModel)}
                  className="bulk-filter-select"
                  disabled={actionInProgress}
                >
                  {(Object.keys(CODEX_MODELS) as CodexModel[]).map(m => (
                    <option key={m} value={m}>
                      {CODEX_MODELS[m].icon} {CODEX_MODELS[m].label}
                    </option>
                  ))}
                </select>
              )}

              {modelProvider === 'claude' && (
                <select
                  value={newEffort}
                  onChange={e => setNewEffort(e.target.value as ClaudeEffort | 'default')}
                  className="bulk-filter-select"
                  disabled={actionInProgress}
                  title="Reasoning effort level"
                >
                  <option value="default">Default effort</option>
                  {(Object.keys(CLAUDE_EFFORTS) as ClaudeEffort[]).map(level => (
                    <option key={level} value={level}>
                      {CLAUDE_EFFORTS[level].icon} {CLAUDE_EFFORTS[level].label}
                    </option>
                  ))}
                </select>
              )}

              <span className="bulk-change-model-count">
                {modelProviderSelectedIds.length} match
              </span>
            </div>
            <div className="footer-buttons-right">
              <button
                className="btn btn-primary"
                disabled={modelProviderSelectedIds.length === 0 || actionInProgress}
                onClick={() => setConfirmAction('change-model')}
              >
                Change Model
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
