/**
 * TerminalModals - Modal components for the terminal panel
 *
 * Includes: ImageModal, BashModal, ContextConfirmModal
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import {
  store,
  useContextModalAgentId,
  useFileViewerPath,
  useFileViewerEditData,
  useFileViewerSearchRoot,
  useAgents,
  useAgentSkills,
  useCustomAgentClass,
} from '../../store';
import { ContextViewModal } from '../ContextViewModal';
import { FileViewerModal } from '../FileViewerModal';
import { AgentResponseModal } from './AgentResponseModal';
import { ansiToHtml } from '../../utils/ansiToHtml';
import { highlightCode } from '../FileExplorerPanel/syntaxHighlighting';
import type { Agent } from '../../../shared/types';
import { useModalClose } from '../../hooks';
import { ModalPortal } from '../shared/ModalPortal';
import { fetchAgentInjectedPrompt } from '../../api/agent-prompt';
import { Icon } from '../Icon';

// Image modal props
export interface ImageModalProps {
  url: string;
  name: string;
  onClose: () => void;
}

export function ImageModal({ url, name, onClose }: ImageModalProps) {
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  return (
    <ModalPortal>
      <div className="image-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="image-modal">
          <div className="image-modal-header">
            <span className="image-modal-title">{name}</span>
            <button className="image-modal-close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="image-modal-content">
            <img src={url} alt={name} />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// JSON Viewer component for bash modal output

function escapeJsonString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

interface JsonNodeProps {
  value: unknown;
  keyName?: string;
  depth: number;
  isLast: boolean;
}

function JsonNode({ value, keyName, depth, isLast }: JsonNodeProps) {
  const [collapsed, setCollapsed] = React.useState(depth >= 2);

  const renderKey = () =>
    keyName !== undefined ? (
      <>
        <span className="json-key">&quot;{keyName}&quot;</span>
        <span className="json-punctuation">: </span>
      </>
    ) : null;

  const comma = !isLast ? <span className="json-punctuation">,</span> : null;
  const indent = depth * 16;

  if (value === null) {
    return (
      <div className="json-line" style={{ paddingLeft: indent }}>
        {renderKey()}<span className="json-null">null</span>{comma}
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div className="json-line" style={{ paddingLeft: indent }}>
        {renderKey()}<span className="json-boolean">{value ? 'true' : 'false'}</span>{comma}
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="json-line" style={{ paddingLeft: indent }}>
        {renderKey()}<span className="json-number">{value}</span>{comma}
      </div>
    );
  }

  if (typeof value === 'string') {
    return (
      <div className="json-line" style={{ paddingLeft: indent }}>
        {renderKey()}<span className="json-string">&quot;{escapeJsonString(value)}&quot;</span>{comma}
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="json-line" style={{ paddingLeft: indent }}>
          {renderKey()}<span className="json-punctuation">[]</span>{comma}
        </div>
      );
    }
    return (
      <div className="json-node">
        <div className="json-line json-collapsible" style={{ paddingLeft: indent }} onClick={() => setCollapsed(!collapsed)}>
          <span className="json-toggle">{collapsed ? '▶' : '▼'}</span>
          {renderKey()}<span className="json-punctuation">[</span>
          {collapsed && (
            <>
              <span className="json-collapsed-hint">{value.length} item{value.length !== 1 ? 's' : ''}</span>
              <span className="json-punctuation">]</span>{comma}
            </>
          )}
        </div>
        {!collapsed && (
          <>
            {value.map((item, i) => (
              <JsonNode key={i} value={item} depth={depth + 1} isLast={i === value.length - 1} />
            ))}
            <div className="json-line" style={{ paddingLeft: indent }}>
              <span className="json-punctuation">]</span>{comma}
            </div>
          </>
        )}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <div className="json-line" style={{ paddingLeft: indent }}>
          {renderKey()}<span className="json-punctuation">{'{}'}</span>{comma}
        </div>
      );
    }
    return (
      <div className="json-node">
        <div className="json-line json-collapsible" style={{ paddingLeft: indent }} onClick={() => setCollapsed(!collapsed)}>
          <span className="json-toggle">{collapsed ? '▶' : '▼'}</span>
          {renderKey()}<span className="json-punctuation">{'{'}</span>
          {collapsed && (
            <>
              <span className="json-collapsed-hint">{entries.length} key{entries.length !== 1 ? 's' : ''}</span>
              <span className="json-punctuation">{'}'}</span>{comma}
            </>
          )}
        </div>
        {!collapsed && (
          <>
            {entries.map(([k, v], i) => (
              <JsonNode key={k} value={v} keyName={k} depth={depth + 1} isLast={i === entries.length - 1} />
            ))}
            <div className="json-line" style={{ paddingLeft: indent }}>
              <span className="json-punctuation">{'}'}</span>{comma}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="json-line" style={{ paddingLeft: indent }}>
      {renderKey()}<span className="json-string">{String(value)}</span>{comma}
    </div>
  );
}

interface JsonViewerProps {
  data: unknown;
}

function JsonViewer({ data }: JsonViewerProps) {
  return (
    <div className="json-viewer">
      <JsonNode value={data} depth={0} isLast={true} />
    </div>
  );
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[mGKHFJA-Za-z]/g, '');
}

function tryParseJson(text: string): { ok: true; data: unknown } | { ok: false } {
  const trimmed = stripAnsi(text.trim());
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return { ok: false };
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

// Bash output modal props
export interface BashModalState {
  command: string;
  output: string;
  isLive?: boolean;
}

export interface BashModalProps {
  state: BashModalState;
  onClose: () => void;
}

export function BashModal({ state, onClose }: BashModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  const jsonResult = React.useMemo(() => {
    if (state.isLive) return { ok: false as const };
    return tryParseJson(state.output);
  }, [state.output, state.isLive]);

  return (
    <ModalPortal>
      <div className="bash-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="bash-modal">
          <div className="bash-modal-header">
            <span className="bash-modal-icon">$</span>
            <span className="bash-modal-title">{t('terminal:modals.terminalOutput')}</span>
            {jsonResult.ok && <span className="bash-modal-json-badge">JSON</span>}
            <button className="bash-modal-close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="bash-modal-command">
            <pre dangerouslySetInnerHTML={{ __html: highlightCode(state.command, 'bash') }} />
          </div>
          <div className={`bash-modal-content ${state.isLive ? 'is-loading' : ''} ${jsonResult.ok ? 'is-json' : ''}`}>
            {jsonResult.ok ? (
              <JsonViewer data={jsonResult.data} />
            ) : (
              <pre className="exec-task-inline-output bash-modal-ansi-output">
                {state.output.split('\n').map((line, idx) => (
                  <div key={idx} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
                ))}
              </pre>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// Context action confirmation modal
export interface ContextConfirmModalProps {
  action: 'collapse' | 'clear' | 'clear-subordinates';
  selectedAgentId: string | null;
  subordinateCount?: number;
  onClose: () => void;
  onClearHistory: () => void;
}

export function ContextConfirmModal({ action, selectedAgentId, subordinateCount, onClose, onClearHistory }: ContextConfirmModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  const handleConfirm = () => {
    if (selectedAgentId) {
      if (action === 'collapse') {
        store.collapseContext(selectedAgentId);
      } else if (action === 'clear-subordinates') {
        store.clearAllSubordinatesContext(selectedAgentId);
      } else {
        store.clearContext(selectedAgentId);
        onClearHistory();
      }
    }
    onClose();
  };

  const getTitle = () => {
    if (action === 'collapse') return t('terminal:modals.collapseContext');
    if (action === 'clear-subordinates') return t('terminal:modals.clearAllSubordinatesContext');
    return t('terminal:modals.clearContext');
  };

  return (
    <ModalPortal>
      <div className="modal-overlay visible guake-context-confirm-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="modal confirm-modal guake-context-confirm-modal">
          <div className="modal-header">{getTitle()}</div>
          <div className="modal-body confirm-modal-body">
            {action === 'collapse' ? (
              <>
                <p>{t('terminal:modals.collapseConfirm')}</p>
                <p className="confirm-modal-note">
                  {t('terminal:modals.collapseNote')}
                </p>
              </>
            ) : action === 'clear-subordinates' ? (
              <>
                <p>{t('terminal:modals.clearSubordinatesConfirm', { count: subordinateCount })}</p>
                <p className="confirm-modal-note">
                  {t('terminal:modals.clearSubordinatesNote')}
                </p>
              </>
            ) : (
              <>
                <p>{t('terminal:modals.clearConfirm')}</p>
                <p className="confirm-modal-note">
                  {t('terminal:modals.clearNote')}
                </p>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              {t('common:buttons.cancel')}
            </button>
            <button
              className={`btn ${action === 'clear' || action === 'clear-subordinates' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleConfirm}
              autoFocus
            >
              {action === 'collapse' ? t('common:buttons.collapse') : action === 'clear-subordinates' ? t('terminal:modals.clearAll') : t('terminal:modals.clearContext')}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// Context view modal wrapper
export function ContextModalFromGuake() {
  const contextModalAgentId = useContextModalAgentId();
  const agents = useAgents();
  const agent = contextModalAgentId ? agents.get(contextModalAgentId) : null;

  if (!agent) return null;

  return (
    <ContextViewModal
      agent={agent}
      isOpen={!!contextModalAgentId}
      onClose={() => store.closeContextModal()}
      onRefresh={() => {
        if (contextModalAgentId) {
          store.refreshAgentContext(contextModalAgentId);
        }
      }}
    />
  );
}

// File viewer modal wrapper
export function FileViewerFromGuake() {
  const fileViewerPath = useFileViewerPath();
  const editData = useFileViewerEditData();
  const searchRoot = useFileViewerSearchRoot();

  if (!fileViewerPath) return null;

  return (
    <FileViewerModal
      isOpen={!!fileViewerPath}
      onClose={() => store.clearFileViewerPath()}
      filePath={fileViewerPath}
      action={editData ? 'modified' : 'read'}
      editData={editData || undefined}
      searchRoot={searchRoot || undefined}
    />
  );
}

// Agent response modal wrapper
export interface AgentResponseModalWrapperProps {
  agent: Agent | null;
  content: string | null;
  onClose: () => void;
}

export function AgentResponseModalWrapper({ agent, content, onClose }: AgentResponseModalWrapperProps) {
  if (!agent) return null;

  return (
    <AgentResponseModal
      agent={agent}
      content={content || ''}
      isOpen={!!content}
      onClose={onClose}
    />
  );
}

export interface AgentInfoModalProps {
  agent: Agent | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return 'N/A';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return 'N/A';
  }
}

interface InjectedPromptSectionProps {
  agentId: string;
}

function InjectedPromptSection({ agentId }: InjectedPromptSectionProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [expanded, setExpanded] = React.useState(false);
  const [prompt, setPrompt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAgentInjectedPrompt(agentId);
      setPrompt(result);
    } catch (err: any) {
      setError(err?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && prompt === null && !loading) {
      void load();
    }
  };

  const handleRefresh = () => {
    void load();
  };

  const handleCopy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied; ignore silently
    }
  };

  const lengthLabel = React.useMemo(() => {
    if (prompt === null) return null;
    const chars = prompt.length;
    // Rough token estimate (~4 chars per token is the standard heuristic)
    const tokens = Math.max(1, Math.round(chars / 4));
    return t('terminal:agentInfo.injectedPromptLength', {
      chars: chars.toLocaleString(),
      tokens: tokens.toLocaleString(),
    });
  }, [prompt, t]);

  return (
    <section className="agent-info-section agent-info-injected-prompt">
      <div className="agent-info-injected-prompt-header">
        <h4>{t('terminal:agentInfo.injectedPrompt')}</h4>
        <div className="agent-info-injected-prompt-actions">
          {expanded && prompt !== null && lengthLabel && (
            <span className="agent-info-injected-prompt-length" title={lengthLabel}>
              {lengthLabel}
            </span>
          )}
          {expanded && prompt !== null && (
            <>
              <button
                type="button"
                className="agent-info-injected-prompt-btn"
                onClick={handleCopy}
                disabled={loading}
                title={t('terminal:agentInfo.injectedPromptCopy')}
              >
                {copied ? t('terminal:agentInfo.injectedPromptCopied') : t('terminal:agentInfo.injectedPromptCopy')}
              </button>
              <button
                type="button"
                className="agent-info-injected-prompt-btn"
                onClick={handleRefresh}
                disabled={loading}
                title={t('terminal:agentInfo.injectedPromptRefresh')}
              >
                {t('terminal:agentInfo.injectedPromptRefresh')}
              </button>
            </>
          )}
          <button
            type="button"
            className="agent-info-injected-prompt-btn agent-info-injected-prompt-toggle"
            onClick={handleToggle}
            aria-expanded={expanded}
          >
            {expanded ? t('terminal:agentInfo.injectedPromptHide') : t('terminal:agentInfo.injectedPromptShow')}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="agent-info-injected-prompt-body">
          {loading && (
            <div className="agent-info-injected-prompt-status">
              {t('terminal:agentInfo.injectedPromptLoading')}
            </div>
          )}
          {!loading && error && (
            <div className="agent-info-injected-prompt-status error">
              {t('terminal:agentInfo.injectedPromptError', { error })}
            </div>
          )}
          {!loading && !error && prompt !== null && (
            <div className="agent-info-injected-prompt-content markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{prompt}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AgentInfoModal({ agent, isOpen, onClose }: AgentInfoModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  const skills = useAgentSkills(agent?.id || null);
  const customClass = useCustomAgentClass(agent?.class || null);

  if (!isOpen || !agent) return null;

  const model = agent.provider === 'codex'
    ? (agent.codexModel || 'gpt-5.3-codex')
    : agent.provider === 'opencode'
    ? ((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k')
    : (agent.model || 'sonnet');

  const classInstructions = customClass?.instructions?.trim() || '';
  const agentInstructions = agent.customInstructions?.trim() || '';
  const hasClassInstructions = classInstructions.length > 0;
  const hasAgentInstructions = agentInstructions.length > 0;
  const hasCustomPrompt = hasClassInstructions || hasAgentInstructions;
  const showCombinedPrompt = hasClassInstructions && hasAgentInstructions;
  const combinedPrompt = [classInstructions, agentInstructions].filter(Boolean).join('\n\n');

  const contextWindow = Math.max(1, agent.contextStats?.contextWindow || agent.contextLimit || 200000);
  const usedTokens = agent.contextStats?.totalTokens || agent.contextUsed || 0;
  const usedPercent = agent.contextStats?.usedPercent || Math.round((usedTokens / contextWindow) * 100);

  return (
    <ModalPortal>
      <div className="agent-info-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="agent-info-modal">
          <div className="agent-info-modal-header">
            <div className="agent-info-modal-title">
              <span className="icon"><Icon name="info" size={14} /></span>
              <span>{t('terminal:agentInfo.title', { name: agent.name })}</span>
            </div>
            <button className="agent-info-modal-close" onClick={onClose}>×</button>
          </div>

          <div className="agent-info-modal-body">
            <section className="agent-info-section">
              <h4>{t('terminal:agentInfo.runtime')}</h4>
              <div className="agent-info-grid">
                <div className="agent-info-item">
                  <span>{t('terminal:agentInfo.backend')}</span>
                  <strong>
                    <img
                      src={agent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : agent.provider === 'opencode' ? `${import.meta.env.BASE_URL}assets/opencode.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
                      alt={agent.provider}
                      className="agent-info-provider-icon"
                      title={agent.provider === 'codex' ? 'Codex Agent' : agent.provider === 'opencode' ? 'OpenCode Agent' : 'Claude Agent'}
                    />
                    {agent.provider === 'codex' ? 'Codex' : agent.provider === 'opencode' ? 'OpenCode' : 'Claude'}
                  </strong>
                </div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.model')}</span><strong>{model}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.status')}</span><strong>{agent.status}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.class')}</span><strong>{agent.class}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.permission')}</span><strong>{agent.permissionMode}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.session')}</span><strong>{agent.sessionId || t('terminal:agentInfo.notStarted')}</strong></div>
              </div>
            </section>

            <section className="agent-info-section">
              <h4>{t('terminal:agentInfo.promptAndInstructions')}</h4>
              <div className="agent-info-prompts">
                {showCombinedPrompt && (
                  <div className="agent-info-prompt-block">
                    <span>{t('terminal:agentInfo.customPrompt')}</span>
                    <pre>{combinedPrompt}</pre>
                  </div>
                )}
                {!hasCustomPrompt && (
                  <div className="agent-info-prompt-block">
                    <span>{t('terminal:agentInfo.customPrompt')}</span>
                    <strong className="warn">{t('terminal:agentInfo.notConfigured')}</strong>
                  </div>
                )}
                <div className="agent-info-prompt-block">
                  <span>{t('terminal:agentInfo.classPrompt')}</span>
                  {hasClassInstructions ? (
                    <pre>{classInstructions}</pre>
                  ) : (
                    <strong>{t('terminal:agentInfo.none')}</strong>
                  )}
                </div>
                <div className="agent-info-prompt-block">
                  <span>{t('terminal:agentInfo.agentPrompt')}</span>
                  {hasAgentInstructions ? (
                    <pre>{agentInstructions}</pre>
                  ) : (
                    <strong>{t('terminal:agentInfo.none')}</strong>
                  )}
                </div>
              </div>
            </section>

            <section className="agent-info-section">
              <h4>{t('terminal:agentInfo.skills', { count: skills.length })}</h4>
              {skills.length === 0 ? (
                <div className="agent-info-empty">{t('terminal:agentInfo.noSkills')}</div>
              ) : (
                <div className="agent-info-skills">
                  {skills.map((skill) => (
                    <div key={skill.id} className="agent-info-skill">
                      <div className="agent-info-skill-name">{skill.name}</div>
                      <div className="agent-info-skill-desc">{skill.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <InjectedPromptSection agentId={agent.id} />

            <section className="agent-info-section">
              <h4>{t('terminal:agentInfo.diagnostics')}</h4>
              <div className="agent-info-grid">
                <div className="agent-info-item"><span>{t('terminal:agentInfo.context')}</span><strong>{usedTokens.toLocaleString()} / {contextWindow.toLocaleString()} ({usedPercent}%)</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.tasksSent')}</span><strong>{agent.taskCount}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.workingDir')}</span><strong>{agent.cwd}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.lastActivity')}</span><strong>{formatDateTime(agent.lastActivity)}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.created')}</span><strong>{formatDateTime(agent.createdAt)}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.detached')}</span><strong>{agent.isDetached ? t('terminal:agentInfo.yes') : t('terminal:agentInfo.no')}</strong></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
