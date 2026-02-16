/**
 * Permission request display components
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PermissionRequest } from '../../../shared/types';
import { TOOL_ICONS } from '../../utils/outputRendering';

// ============================================================================
// Permission Request Card Component (larger display)
// ============================================================================

interface PermissionRequestCardProps {
  request: PermissionRequest;
  onApprove: () => void;
  onDeny: () => void;
}

export function PermissionRequestCard({ request, onApprove, onDeny }: PermissionRequestCardProps) {
  const { t } = useTranslation(['tools']);
  const toolIcon = TOOL_ICONS[request.tool] || TOOL_ICONS.default;

  // Format tool input for display - NO TRUNCATION
  const formatToolInput = (input: Record<string, unknown>): string => {
    if (request.tool === 'Bash' && input.command) {
      return String(input.command);
    }
    if ((request.tool === 'Write' || request.tool === 'Edit' || request.tool === 'Read') && input.file_path) {
      return String(input.file_path);
    }
    if (request.tool === 'WebFetch' && input.url) {
      return String(input.url);
    }
    // Default: stringify all keys - no truncation
    const keys = Object.keys(input);
    return keys.map((k) => `${k}: ${JSON.stringify(input[k])}`).join(', ');
  };

  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const isDenied = request.status === 'denied';

  return (
    <div className={`permission-request-card ${request.status}`}>
      <div className="permission-request-header">
        <span className="permission-request-icon">{toolIcon}</span>
        <span className="permission-request-tool">{request.tool}</span>
        {isPending && <span className="permission-request-badge">{t('tools:permission.waitingForApproval')}</span>}
        {isApproved && <span className="permission-request-badge approved">{t('tools:permission.approved')}</span>}
        {isDenied && <span className="permission-request-badge denied">{t('tools:permission.denied')}</span>}
      </div>
      <div className="permission-request-details">
        <code>{formatToolInput(request.toolInput)}</code>
      </div>
      {isPending && (
        <div className="permission-request-actions">
          <button className="permission-btn permission-btn-approve" onClick={onApprove}>
            ✓ {t('tools:permission.allow')}
          </button>
          <button className="permission-btn permission-btn-deny" onClick={onDeny}>
            ✕ {t('tools:permission.deny')}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Compact Inline Permission Request (for bottom bar)
// ============================================================================

interface PermissionRequestInlineProps {
  request: PermissionRequest;
  onApprove: (remember?: boolean) => void;
  onDeny: () => void;
}

export function PermissionRequestInline({ request, onApprove, onDeny }: PermissionRequestInlineProps) {
  const { t } = useTranslation(['tools']);
  const toolIcon = TOOL_ICONS[request.tool] || TOOL_ICONS.default;

  // Format tool input for display - NO TRUNCATION
  const formatToolInputCompact = (input: Record<string, unknown>): string => {
    if (request.tool === 'Bash' && input.command) {
      return String(input.command);
    }
    if ((request.tool === 'Write' || request.tool === 'Edit' || request.tool === 'Read') && input.file_path) {
      return String(input.file_path);
    }
    if (request.tool === 'WebFetch' && input.url) {
      return String(input.url);
    }
    return request.tool;
  };

  // Get remember hint text based on tool
  const getRememberHint = (): string => {
    if (request.tool === 'Write' || request.tool === 'Edit') {
      const filePath = String(request.toolInput.file_path || '');
      const dir = filePath.split('/').slice(0, -1).join('/');
      return t('tools:permission.rememberAllowDir', { dir });
    }
    if (request.tool === 'Bash') {
      const cmd = String(request.toolInput.command || '');
      const firstWord = cmd.split(/\s+/)[0];
      return t('tools:permission.rememberAllowCmd', { cmd: firstWord });
    }
    return t('tools:permission.rememberAllowTool', { tool: request.tool });
  };

  if (request.status !== 'pending') return null;

  return (
    <div className="permission-inline">
      <span className="permission-inline-icon">{toolIcon}</span>
      <span className="permission-inline-tool">{request.tool}</span>
      <span className="permission-inline-target">{formatToolInputCompact(request.toolInput)}</span>
      <button
        className="permission-inline-btn approve-remember"
        onClick={() => onApprove(true)}
        title={getRememberHint()}
      >
        ✓+
      </button>
      <button className="permission-inline-btn approve" onClick={() => onApprove(false)} title={t('tools:permission.approveOnce')}>
        ✓
      </button>
      <button className="permission-inline-btn deny" onClick={onDeny} title={t('tools:permission.deny')}>
        ✕
      </button>
    </div>
  );
}
