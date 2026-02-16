import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useToolExecutions, useFileChanges, ToolExecution, FileChange } from '../store';
import { FileViewerModal } from './FileViewerModal';
import { STORAGE_KEYS, getStorageBoolean, setStorageBoolean } from '../utils/storage';

interface ToolHistoryProps {
  agentIds: string[];
}

export function ToolHistory({ agentIds }: ToolHistoryProps) {
  const { t } = useTranslation(['terminal']);
  const allToolExecutions = useToolExecutions();
  const allFileChanges = useFileChanges();
  const [selectedFile, setSelectedFile] = useState<{ path: string; action: FileChange['action'] } | null>(null);
  const [expandedToolIndex, setExpandedToolIndex] = useState<number | null>(null);
  const [toolsCollapsed, setToolsCollapsed] = useState(() => getStorageBoolean(STORAGE_KEYS.TOOLS_COLLAPSED));
  const [filesCollapsed, setFilesCollapsed] = useState(() => getStorageBoolean(STORAGE_KEYS.FILES_COLLAPSED));

  const handleToolsToggle = () => {
    const newValue = !toolsCollapsed;
    setToolsCollapsed(newValue);
    setStorageBoolean(STORAGE_KEYS.TOOLS_COLLAPSED, newValue);
  };

  const handleFilesToggle = () => {
    const newValue = !filesCollapsed;
    setFilesCollapsed(newValue);
    setStorageBoolean(STORAGE_KEYS.FILES_COLLAPSED, newValue);
  };

  // Filter by selected agents - memoized
  const agentIdSet = useMemo(() => new Set(agentIds), [agentIds]);
  const toolExecutions = useMemo(
    () => allToolExecutions.filter(t => agentIdSet.has(t.agentId)),
    [allToolExecutions, agentIdSet]
  );
  const fileChanges = useMemo(
    () => allFileChanges.filter(f => agentIdSet.has(f.agentId)),
    [allFileChanges, agentIdSet]
  );

  // Show agent names when multiple agents selected
  const showAgentName = agentIds.length > 1;

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const formatPath = (filePath: string) => {
    const parts = filePath.split('/');
    if (parts.length > 2) {
      return '.../' + parts.slice(-2).join('/');
    }
    return filePath;
  };

  const getActionIcon = (action: FileChange['action']) => {
    switch (action) {
      case 'created': return '+';
      case 'modified': return '~';
      case 'deleted': return '-';
      case 'read': return '>';
    }
  };

  const getActionColor = (action: FileChange['action']) => {
    switch (action) {
      case 'created': return 'var(--accent-green)';
      case 'modified': return 'var(--accent-orange)';
      case 'deleted': return 'var(--accent-red)';
      case 'read': return 'var(--text-secondary)';
    }
  };

  const getToolIcon = (toolName: string) => {
    if (toolName === 'Read') return '📖';
    if (toolName === 'Write') return '📝';
    if (toolName === 'Edit') return '✏️';
    if (toolName === 'Bash') return '💻';
    if (toolName === 'Grep') return '🔍';
    if (toolName === 'Glob') return '📁';
    if (toolName === 'Task') return '🤖';
    if (toolName === 'WebFetch') return '🌐';
    if (toolName === 'WebSearch') return '🔎';
    return '🔧';
  };

  const handleFileClick = (filePath: string, action: FileChange['action']) => {
    setSelectedFile({ path: filePath, action });
  };

  return (
    <>
      <div className="tool-history-stacked">
        {/* Tools Section */}
        <div className={`tool-history-panel ${toolsCollapsed ? 'collapsed' : ''}`}>
          <div
            className="tool-history-panel-header"
            onClick={handleToolsToggle}
          >
            <span className="tool-history-panel-toggle">{toolsCollapsed ? '▶' : '▼'}</span>
            {t('terminal:toolHistory.tools')} ({toolExecutions.length})
          </div>
          {!toolsCollapsed && (
            <div className="tool-history-panel-content">
              {toolExecutions.length === 0 ? (
                <div className="tool-history-empty">{t('terminal:toolHistory.noToolsYet')}</div>
              ) : (
                <div className="tool-history-list">
                  {toolExecutions.slice(0, 50).map((exec, index) => (
                    <ToolExecutionItem
                      key={index}
                      execution={exec}
                      formatTime={formatTime}
                      formatPath={formatPath}
                      getToolIcon={getToolIcon}
                      showAgentName={showAgentName}
                      isExpanded={expandedToolIndex === index}
                      onToggle={() => setExpandedToolIndex(expandedToolIndex === index ? null : index)}
                      onViewFile={(path) => setSelectedFile({ path, action: 'modified' })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Files Section */}
        <div className={`tool-history-panel ${filesCollapsed ? 'collapsed' : ''}`}>
          <div
            className="tool-history-panel-header"
            onClick={handleFilesToggle}
          >
            <span className="tool-history-panel-toggle">{filesCollapsed ? '▶' : '▼'}</span>
            {t('terminal:toolHistory.filesSection')} ({fileChanges.length})
          </div>
          {!filesCollapsed && (
            <div className="tool-history-panel-content">
              {fileChanges.length === 0 ? (
                <div className="tool-history-empty">{t('terminal:toolHistory.noFileChangesYet')}</div>
              ) : (
                <div className="tool-history-list">
                  {fileChanges.slice(0, 50).map((change, index) => (
                    <FileChangeItem
                      key={index}
                      change={change}
                      formatTime={formatTime}
                      formatPath={formatPath}
                      getActionIcon={getActionIcon}
                      getActionColor={getActionColor}
                      onClick={() => handleFileClick(change.filePath, change.action)}
                      showAgentName={showAgentName}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <FileViewerModal
        isOpen={selectedFile !== null}
        onClose={() => setSelectedFile(null)}
        filePath={selectedFile?.path || ''}
        action={selectedFile?.action || 'read'}
      />
    </>
  );
}

interface ToolExecutionItemProps {
  execution: ToolExecution;
  formatTime: (ts: number) => string;
  formatPath: (path: string) => string;
  getToolIcon: (name: string) => string;
  showAgentName: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onViewFile: (path: string) => void;
}

function formatToolInput(toolName: string, input?: Record<string, unknown>): string | null {
  if (!input) return null;

  switch (toolName) {
    case 'WebSearch':
      return input.query as string || null;
    case 'WebFetch':
      const url = input.url as string;
      if (url && url.length > 50) {
        return url.slice(0, 47) + '...';
      }
      return url || null;
    case 'Read':
    case 'Write':
    case 'Edit':
      const filePath = (input.file_path || input.path) as string;
      if (!filePath) return null;
      // Show just filename for long paths
      if (filePath.length > 40) {
        const parts = filePath.split('/');
        return '.../' + parts.slice(-2).join('/');
      }
      return filePath;
    case 'Bash':
      const cmd = input.command as string;
      if (!cmd) return null;
      return cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd;
    case 'Grep':
      return input.pattern ? `"${input.pattern}"` : null;
    case 'Glob':
      return input.pattern as string || null;
    case 'Task':
      const desc = input.description as string;
      return desc ? (desc.length > 40 ? desc.slice(0, 37) + '...' : desc) : null;
    case 'TodoWrite':
      const todos = input.todos as unknown[];
      return todos?.length ? `${todos.length} item${todos.length > 1 ? 's' : ''}` : null;
    default:
      // Try to find any meaningful string parameter
      for (const [, value] of Object.entries(input)) {
        if (typeof value === 'string' && value.length > 0 && value.length < 80) {
          return value.length > 50 ? value.slice(0, 47) + '...' : value;
        }
      }
      return null;
  }
}

function ToolExecutionItem({ execution, formatTime, formatPath: _formatPath, getToolIcon, showAgentName, isExpanded, onToggle, onViewFile }: ToolExecutionItemProps) {
  const { t } = useTranslation(['terminal']);
  const inputDisplay = formatToolInput(execution.toolName, execution.toolInput);
  const hasDetails = execution.toolInput && Object.keys(execution.toolInput).length > 0;

  // Get file path for Write/Edit tools
  const filePath = execution.toolInput
    ? (execution.toolInput.file_path || execution.toolInput.path) as string | undefined
    : undefined;
  const isFileOperation = ['Write', 'Edit', 'Read'].includes(execution.toolName) && filePath;

  return (
    <div className={`tool-history-item tool-compact ${isExpanded ? 'expanded' : ''} ${hasDetails ? 'clickable' : ''}`}>
      <div className="tool-row" onClick={hasDetails ? onToggle : undefined} title={execution.toolName}>
        <span className="tool-expand-icon">{hasDetails ? (isExpanded ? '▼' : '▶') : ' '}</span>
        <span className="tool-icon" title={execution.toolName}>{getToolIcon(execution.toolName)}</span>
        <div className="tool-input-inline" title={inputDisplay || execution.toolName}>
          {inputDisplay || execution.toolName}
        </div>
        {showAgentName && <span className="tool-agent-compact">{execution.agentName}</span>}
        <span className="tool-time">{formatTime(execution.timestamp)}</span>
      </div>
      {isExpanded && execution.toolInput && (
        <div className="tool-expanded-details">
          <div className="tool-expanded-header">
            <span className="tool-expanded-name">{execution.toolName}</span>
            {isFileOperation && (
              <button
                className="tool-view-file-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewFile(filePath!);
                }}
              >
                {t('terminal:toolHistory.viewFile')}
              </button>
            )}
          </div>
          <pre className="tool-input-json">
            {formatExpandedInput(execution.toolName, execution.toolInput)}
          </pre>
        </div>
      )}
    </div>
  );
}

function formatExpandedInput(toolName: string, input: Record<string, unknown>): string {
  // For Write tool, show content with syntax highlighting hint
  if (toolName === 'Write' && input.content) {
    const content = input.content as string;
    const filePath = (input.file_path || input.path) as string;
    const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n\n... (truncated)' : content;
    return `file: ${filePath}\n\n${truncated}`;
  }

  // For Edit tool, show the changes
  if (toolName === 'Edit') {
    const lines: string[] = [];
    if (input.file_path) lines.push(`file: ${input.file_path}`);
    if (input.old_string) {
      const old = input.old_string as string;
      lines.push(`\n- old:\n${old.slice(0, 500)}${old.length > 500 ? '...' : ''}`);
    }
    if (input.new_string) {
      const newStr = input.new_string as string;
      lines.push(`\n+ new:\n${newStr.slice(0, 500)}${newStr.length > 500 ? '...' : ''}`);
    }
    return lines.join('\n');
  }

  // For Bash, show full command
  if (toolName === 'Bash' && input.command) {
    return input.command as string;
  }

  // For TodoWrite, format nicely
  if (toolName === 'TodoWrite' && input.todos) {
    const todos = input.todos as Array<{ content: string; status: string }>;
    return todos.map((t, _i) => {
      const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '→' : '○';
      return `${icon} ${t.content}`;
    }).join('\n');
  }

  // Default: show JSON
  return JSON.stringify(input, null, 2);
}

interface FileChangeItemProps {
  change: FileChange;
  formatTime: (ts: number) => string;
  formatPath: (path: string) => string;
  getActionIcon: (action: FileChange['action']) => string;
  getActionColor: (action: FileChange['action']) => string;
  onClick: () => void;
  showAgentName: boolean;
}

function FileChangeItem({ change, formatTime, formatPath, getActionIcon, getActionColor, onClick, showAgentName }: FileChangeItemProps) {
  return (
    <div className="tool-history-item file-change clickable" onClick={onClick}>
      <span className="file-action" style={{ color: getActionColor(change.action) }}>
        {getActionIcon(change.action)}
      </span>
      <span className="file-path" title={change.filePath}>
        {formatPath(change.filePath)}
      </span>
      {showAgentName && <span className="tool-agent-compact">{change.agentName}</span>}
      <span className="tool-time">{formatTime(change.timestamp)}</span>
    </div>
  );
}
