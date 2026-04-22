/**
 * BulkManageModal - Modal for bulk agent management operations
 *
 * Provides filtering, multi-select, and bulk actions (delete, stop, clear context, move to area).
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ModalPortal } from './shared/ModalPortal';
import { Icon } from './Icon';
import { useAgentsArray, useAreas } from '../store';
import {
  bulkDeleteAgents,
  bulkStopAgents,
  bulkClearContext,
  bulkMoveToArea,
  bulkChangeModel,
  type BulkActionResult,
} from '../api/bulk-agents';
import type { Agent, DrawingArea } from '../../shared/types';
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
type ProviderFilter = 'all' | 'claude' | 'codex' | 'opencode';
type ModelFilter = 'all' | 'opus' | 'opus-4-7' | 'opus-4-6' | 'sonnet' | 'haiku';

type ConfirmAction = 'delete' | 'clear-context' | 'change-model' | null;

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
  const [newClaudeModel, setNewClaudeModel] = useState<ClaudeModel>('sonnet');
  const [newCodexModel, setNewCodexModel] = useState<CodexModel>('gpt-5.3-codex');
  // 'default' represents "leave unchanged / use default"; other values are ClaudeEffort levels
  const [newEffort, setNewEffort] = useState<ClaudeEffort | 'default'>('default');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set());
      setError(null);
      setSuccess(null);
      setConfirmAction(null);
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionInProgress(false);
      setConfirmAction(null);
    }
  }, [selectedIds, moveAreaId, modelProviderSelectedIds, modelProvider, newClaudeModel, newCodexModel, newEffort]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (confirmAction) {
        setConfirmAction(null);
      } else {
        onClose();
      }
    }
  }, [confirmAction, onClose]);

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
              </select>

              <select
                value={modelFilter}
                onChange={e => setModelFilter(e.target.value as ModelFilter)}
                className="bulk-filter-select"
              >
                <option value="all">All Models</option>
                <option value="opus-4-7">Opus 4.7</option>
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
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map(agent => {
                    const agentArea = getAgentArea(agent, areas);
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

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
                    className="btn btn-danger"
                    onClick={() => handleAction(confirmAction)}
                    disabled={actionInProgress || (confirmAction === 'change-model' && modelProviderSelectedIds.length === 0)}
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
