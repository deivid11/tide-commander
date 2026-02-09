/**
 * Context View Modal
 * Advanced view showing detailed context usage breakdown from Claude's /context command
 */

import React, { useMemo, useState } from 'react';
import type { Agent, ContextStats } from '../../shared/types';
import { useModalClose } from '../hooks';
import { ModalPortal } from './shared/ModalPortal';

interface ContextViewModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

// Format token count with K/M suffixes
function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

// Format percentage for display
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// Get color for percentage value (for used space)
function getUsedPercentColor(percent: number): string {
  if (percent >= 80) return '#ff4a4a'; // Red - critical
  if (percent >= 60) return '#ff9e4a'; // Orange - warning
  if (percent >= 40) return '#ffd700'; // Yellow - moderate
  return '#4aff9e'; // Green - healthy
}

// Category colors
const CATEGORY_COLORS = {
  systemPrompt: '#4a9eff',      // Blue
  systemTools: '#9e4aff',       // Purple
  messages: '#4aff9e',          // Green
  freeSpace: 'rgba(255,255,255,0.1)', // Transparent
  autocompactBuffer: '#ff9e4a', // Orange
};

const CATEGORY_LABELS = {
  systemPrompt: 'System Prompt',
  systemTools: 'System Tools',
  messages: 'Messages',
  freeSpace: 'Free Space',
  autocompactBuffer: 'Autocompact Buffer',
};

const CATEGORY_DESCRIPTIONS = {
  systemPrompt: 'Base instructions and persona for the agent',
  systemTools: 'Tool definitions and capabilities available',
  messages: 'Conversation history and user messages',
  freeSpace: 'Available space for more conversation',
  autocompactBuffer: 'Reserved for automatic context compaction',
};

export function ContextViewModal({ agent, isOpen, onClose, onRefresh }: ContextViewModalProps) {
  const stats = agent.contextStats;
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    if (onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      onRefresh();
      // Reset after a delay (the actual update comes via websocket)
      setTimeout(() => setIsRefreshing(false), 3000);
    }
  };

  // Calculate category order for display (excluding free space for the bar)
  const categoryOrder: (keyof ContextStats['categories'])[] = [
    'systemPrompt',
    'systemTools',
    'messages',
    'autocompactBuffer',
    'freeSpace',
  ];

  // Get categories as ordered array
  const orderedCategories = useMemo(() => {
    if (!stats) return [];
    return categoryOrder.map(key => ({
      key,
      ...stats.categories[key],
      label: CATEGORY_LABELS[key],
      description: CATEGORY_DESCRIPTIONS[key],
      color: CATEGORY_COLORS[key],
    }));
  }, [stats]);

  // Categories for the stacked bar (excluding free space)
  const barCategories = useMemo(() => {
    return orderedCategories.filter(c => c.key !== 'freeSpace');
  }, [orderedCategories]);

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="modal context-view-modal" style={{ maxWidth: '520px' }}>
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ flex: 1 }}>Context Window: {agent.name}</span>
          {onRefresh && (
            <button
              className="btn btn-primary"
              onClick={handleRefresh}
              disabled={isRefreshing || agent.status !== 'idle'}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title={agent.status !== 'idle' ? 'Agent must be idle to refresh' : 'Fetch context stats via /context command'}
            >
              <span style={{
                display: 'inline-block',
                animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              }}>
                {isRefreshing ? '⟳' : '↻'}
              </span>
              {isRefreshing ? 'Loading...' : 'Refresh'}
            </button>
          )}
        </div>

        <div className="modal-body" style={{ padding: '16px' }}>
          {!stats ? (
            <div style={{
              textAlign: 'center',
              color: 'var(--text-secondary)',
              padding: '32px',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📊</div>
              <div style={{ fontSize: '14px', marginBottom: '8px' }}>No context data available yet</div>
              <div style={{ fontSize: '12px', marginBottom: '20px', opacity: 0.7 }}>
                Click the Refresh button above to fetch detailed stats
              </div>
              {onRefresh && (
                <button
                  className="btn btn-primary"
                  onClick={handleRefresh}
                  disabled={isRefreshing || agent.status !== 'idle'}
                  style={{
                    padding: '10px 24px',
                    fontSize: '14px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{
                    display: 'inline-block',
                    animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
                  }}>
                    {isRefreshing ? '⟳' : '↻'}
                  </span>
                  {isRefreshing ? 'Fetching Stats...' : 'Fetch Context Stats'}
                </button>
              )}
              {agent.status !== 'idle' && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
                  Agent must be idle to fetch stats
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Model Info */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                padding: '8px 12px',
                background: 'var(--bg-secondary)',
                borderRadius: '6px',
              }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Model</div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{stats.model}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Context Window</div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{formatTokens(stats.contextWindow)}</div>
                </div>
              </div>

              {/* Overview Bar */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontSize: '13px',
                }}>
                  <span>Context Usage</span>
                  <span style={{ color: getUsedPercentColor(stats.usedPercent) }}>
                    {formatTokens(stats.totalTokens)} / {formatTokens(stats.contextWindow)} ({stats.usedPercent}%)
                  </span>
                </div>

                {/* Stacked Bar */}
                <div style={{
                  height: '28px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  display: 'flex',
                }}>
                  {barCategories.map((category) => (
                    category.percent > 0 && (
                      <div
                        key={category.key}
                        style={{
                          width: `${category.percent}%`,
                          background: category.color,
                          height: '100%',
                          minWidth: category.percent > 0.5 ? '2px' : '0',
                          transition: 'width 0.3s ease',
                        }}
                        title={`${category.label}: ${formatTokens(category.tokens)} (${formatPercent(category.percent)})`}
                      />
                    )
                  ))}
                </div>
              </div>

              {/* Category Breakdown */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Token Breakdown
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {orderedCategories.map((category) => (
                    <div
                      key={category.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 12px',
                        background: category.key === 'freeSpace' ? 'transparent' : 'var(--bg-secondary)',
                        borderRadius: '6px',
                        borderLeft: category.key === 'freeSpace' ? '3px dashed rgba(255,255,255,0.2)' : `3px solid ${category.color}`,
                        opacity: category.key === 'freeSpace' ? 0.7 : 1,
                      }}
                    >
                      <div style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '3px',
                        background: category.color,
                        flexShrink: 0,
                        border: category.key === 'freeSpace' ? '1px dashed rgba(255,255,255,0.3)' : 'none',
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{category.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {category.description}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>
                          {formatTokens(category.tokens)}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {formatPercent(category.percent)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Last Updated */}
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}>
                Last updated: {new Date(stats.lastUpdated).toLocaleTimeString()}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer" style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color)',
        }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
