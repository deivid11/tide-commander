/**
 * DashboardView - Metrics and status overview mode
 *
 * Displays agent status cards, building overview, and key metrics.
 * Used when viewMode === 'dashboard'.
 */

import React, { useState, useMemo } from 'react';
import { useAgents, useBuildings, useSelectedAgentIds } from '../../store/selectors';
import type { Agent, Building } from '../../../shared/types';
import './DashboardView.scss';

interface DashboardViewProps {
  onSelectAgent?: (agentId: string) => void;
  onFocusAgent?: (agentId: string) => void;
  onKillAgent?: (agentId: string) => void;
  onSelectBuilding?: (buildingId: string) => void;
}

type StatusColor = 'healthy' | 'working' | 'error' | 'unknown';

function getStatusColor(status: string): StatusColor {
  switch (status) {
    case 'idle':
    case 'running':
      return 'healthy';
    case 'working':
    case 'waiting':
    case 'waiting_permission':
      return 'working';
    case 'error':
    case 'offline':
    case 'orphaned':
      return 'error';
    default:
      return 'unknown';
  }
}

function getClassIcon(agentClass: string): string {
  switch (agentClass) {
    case 'boss': return '👑';
    case 'scout': return '🔍';
    case 'builder': return '🔨';
    case 'debugger': return '🐛';
    default: return '🤖';
  }
}

function getBuildingIcon(type: string): string {
  switch (type) {
    case 'server': return '🖥️';
    case 'boss': return '🏰';
    case 'database': return '🗄️';
    case 'folder': return '📁';
    default: return '🏢';
  }
}

export function DashboardView({
  onSelectAgent,
  onFocusAgent,
  onKillAgent,
  onSelectBuilding,
}: DashboardViewProps) {
  const agents = useAgents();
  const buildings = useBuildings();
  const selectedAgentIds = useSelectedAgentIds();

  const [filter, setFilter] = useState<'all' | 'working' | 'error'>('all');

  const agentArray = useMemo(() => {
    const arr = Array.from(agents.values());
    if (filter === 'all') return arr;
    if (filter === 'working') return arr.filter(a => a.status === 'working' || a.status === 'waiting' || a.status === 'waiting_permission');
    if (filter === 'error') return arr.filter(a => a.status === 'error' || a.status === 'offline' || a.status === 'orphaned');
    return arr;
  }, [agents, filter]);

  const buildingArray = useMemo(() => Array.from(buildings.values()), [buildings]);

  // Metrics
  const metrics = useMemo(() => {
    const all = Array.from(agents.values());
    return {
      total: all.length,
      working: all.filter(a => a.status === 'working' || a.status === 'waiting' || a.status === 'waiting_permission').length,
      idle: all.filter(a => a.status === 'idle').length,
      error: all.filter(a => a.status === 'error' || a.status === 'offline' || a.status === 'orphaned').length,
      buildings: buildingArray.length,
    };
  }, [agents, buildingArray]);

  return (
    <div className="dashboard-view">
      {/* Metrics Bar */}
      <div className="dashboard-view__metrics">
        <div className="dashboard-view__metric">
          <span className="dashboard-view__metric-value">{metrics.total}</span>
          <span className="dashboard-view__metric-label">Agents</span>
        </div>
        <div className="dashboard-view__metric dashboard-view__metric--working">
          <span className="dashboard-view__metric-value">{metrics.working}</span>
          <span className="dashboard-view__metric-label">Working</span>
        </div>
        <div className="dashboard-view__metric dashboard-view__metric--idle">
          <span className="dashboard-view__metric-value">{metrics.idle}</span>
          <span className="dashboard-view__metric-label">Idle</span>
        </div>
        <div className="dashboard-view__metric dashboard-view__metric--error">
          <span className="dashboard-view__metric-value">{metrics.error}</span>
          <span className="dashboard-view__metric-label">Errors</span>
        </div>
        <div className="dashboard-view__metric">
          <span className="dashboard-view__metric-value">{metrics.buildings}</span>
          <span className="dashboard-view__metric-label">Buildings</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="dashboard-view__filters">
        <button
          className={`dashboard-view__filter-btn ${filter === 'all' ? 'dashboard-view__filter-btn--active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({metrics.total})
        </button>
        <button
          className={`dashboard-view__filter-btn ${filter === 'working' ? 'dashboard-view__filter-btn--active' : ''}`}
          onClick={() => setFilter('working')}
        >
          Working ({metrics.working})
        </button>
        <button
          className={`dashboard-view__filter-btn ${filter === 'error' ? 'dashboard-view__filter-btn--active' : ''}`}
          onClick={() => setFilter('error')}
        >
          Errors ({metrics.error})
        </button>
      </div>

      {/* Agent Cards Grid */}
      <div className="dashboard-view__section">
        <h3 className="dashboard-view__section-title">Agents</h3>
        {agentArray.length === 0 ? (
          <div className="dashboard-view__empty">
            {filter === 'all' ? 'No agents spawned yet' : `No ${filter} agents`}
          </div>
        ) : (
          <div className="dashboard-view__grid">
            {agentArray.map(agent => {
              const color = getStatusColor(agent.status);
              const isSelected = selectedAgentIds.has(agent.id);
              return (
                <div
                  key={agent.id}
                  className={`dashboard-view__card dashboard-view__card--${color} ${isSelected ? 'dashboard-view__card--selected' : ''}`}
                  onClick={() => onSelectAgent?.(agent.id)}
                >
                  <div className="dashboard-view__card-header">
                    <span className="dashboard-view__card-icon">{getClassIcon(agent.class)}</span>
                    <span className="dashboard-view__card-name">{agent.name}</span>
                    <span className={`dashboard-view__card-dot dashboard-view__card-dot--${color}`} />
                  </div>
                  <div className="dashboard-view__card-body">
                    <span className="dashboard-view__card-status">{agent.status}</span>
                    <span className="dashboard-view__card-class">{agent.class}</span>
                  </div>
                  <div className="dashboard-view__card-actions">
                    {onFocusAgent && (
                      <button
                        className="dashboard-view__card-action"
                        onClick={(e) => { e.stopPropagation(); onFocusAgent(agent.id); }}
                        title="Focus in 3D view"
                      >
                        🎯
                      </button>
                    )}
                    {onKillAgent && (
                      <button
                        className="dashboard-view__card-action dashboard-view__card-action--danger"
                        onClick={(e) => { e.stopPropagation(); onKillAgent(agent.id); }}
                        title="Kill agent"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Buildings Section */}
      {buildingArray.length > 0 && (
        <div className="dashboard-view__section">
          <h3 className="dashboard-view__section-title">Buildings</h3>
          <div className="dashboard-view__grid">
            {buildingArray.map(building => (
              <div
                key={building.id}
                className="dashboard-view__card dashboard-view__card--building"
                onClick={() => onSelectBuilding?.(building.id)}
              >
                <div className="dashboard-view__card-header">
                  <span className="dashboard-view__card-icon">{getBuildingIcon(building.type)}</span>
                  <span className="dashboard-view__card-name">{building.name}</span>
                </div>
                <div className="dashboard-view__card-body">
                  <span className="dashboard-view__card-status">{building.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
