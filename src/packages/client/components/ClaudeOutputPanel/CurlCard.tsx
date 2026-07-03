import React, { memo, useCallback, useId, useMemo, useState } from 'react';
import { detectAgentFetch, detectAgentMessage, detectBrowserAction, type BrowserAction, type ParsedCurl } from './curlParser';
import { useAgent } from '../../store/selectors';
import { store, useViewMode } from '../../store';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';

const AGENT_MESSAGE_COLLAPSE_LINE_THRESHOLD = 5;
const AGENT_MESSAGE_COLLAPSE_CHAR_THRESHOLD = 280;

interface CurlCardProps {
  parsed: ParsedCurl;
  rawCommand?: string;
}

function formatJsonWithHighlight(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    (_match, key, str, kw, num) => {
      if (key) return `<span class="curl-json-key">${key}</span>`;
      if (str) return `<span class="curl-json-string">${str}</span>`;
      if (kw) return `<span class="curl-json-keyword">${kw}</span>`;
      if (num) return `<span class="curl-json-number">${num}</span>`;
      return _match;
    },
  );
}

function CopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(value);
        } else {
          const ta = document.createElement('textarea');
          ta.value = value;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        /* ignore */
      }
    },
    [value],
  );
  return (
    <button
      type="button"
      className={`curl-copy-btn${copied ? ' copied' : ''}`}
      onClick={handleCopy}
      title={title}
      aria-label={title}
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} />
    </button>
  );
}

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.max(0, max - 1);
  return text.slice(0, keep) + '…';
}

function AgentMessageCard({
  targetAgentId,
  message,
  rawCommand,
}: {
  targetAgentId: string;
  message: string;
  rawCommand?: string;
}) {
  const agent = useAgent(targetAgentId);
  const viewMode = useViewMode();
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  const needsCollapse = useMemo(() => {
    return message.split('\n').length > AGENT_MESSAGE_COLLAPSE_LINE_THRESHOLD
      || message.length > AGENT_MESSAGE_COLLAPSE_CHAR_THRESHOLD;
  }, [message]);

  const collapsed = needsCollapse && !expanded;

  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(v => !v);
  }, []);

  // Clicking the agent name focuses/opens that agent. Reuses the SAME selection
  // path as clicking a pinned chip (PinnedAgentsBar.handleSelect): focus it, then
  // open the Guake terminal unless we're in Flat mode (which drives its own inline
  // chat and would otherwise stack a second overlay). No-op if the agent is gone.
  const openAgent = useCallback(() => {
    if (!agent) return;
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(targetAgentId);
    if (viewMode !== 'flat') store.setTerminalOpen(true);
  }, [agent, targetAgentId, viewMode]);

  const handleNameClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    openAgent();
  }, [openAgent]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      openAgent();
    }
  }, [openAgent]);

  return (
    <div className="curl-card curl-card--agent-message" title={rawCommand}>
      <div className="curl-agent-message-title">
        <span className="curl-agent-message-icon"><Icon name="envelope-simple" size={12} /></span>
        <span>Sending message to agent</span>
      </div>
      <div className="curl-agent-message-row">
        <span className="curl-agent-message-label">To</span>
        <span className="curl-agent-message-name">
          {agent && <AgentIcon agent={agent} size={12} />}
          {agent ? (
            <span
              className="curl-agent-message-name-text clickable-agent-name"
              role="button"
              tabIndex={0}
              title={`Open ${agent.name}`}
              onClick={handleNameClick}
              onKeyDown={handleNameKeyDown}
            >
              {agent.name}
            </span>
          ) : (
            <span className="curl-agent-message-name-text" title="Agent unavailable">
              {targetAgentId}
            </span>
          )}
          {!agent && <CopyButton value={targetAgentId} title="Copy ID" />}
        </span>
      </div>
      <div
        id={bodyId}
        className={`curl-agent-message-body${collapsed ? ' curl-agent-message-body--collapsed' : ''}`}
      >
        <span className="curl-agent-message-quote-mark">“</span>
        <span className="curl-agent-message-text">{message}</span>
      </div>
      {needsCollapse && (
        <div className="curl-agent-message-footer">
          <button
            type="button"
            className="curl-agent-message-more-btn"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            aria-controls={bodyId}
          >
            <span>{expanded ? 'Show less' : 'Show more'}</span>
            <Icon name={expanded ? 'caret-up' : 'caret-down'} size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

function AgentFetchCard({ agentId, rawCommand }: { agentId: string; rawCommand?: string }) {
  const agent = useAgent(agentId);
  return (
    <div className="curl-card curl-card--agent-fetch" title={rawCommand}>
      <div className="curl-agent-fetch-title">
        <span className="curl-agent-fetch-icon"><Icon name="search" size={14} /></span>
        <span>Fetching agent details</span>
      </div>
      {agent && (
        <div className="curl-agent-fetch-row">
          <span className="curl-agent-fetch-label">Agent</span>
          <span className="curl-agent-fetch-name">
            <AgentIcon agent={agent} size={13} />
            <span className="curl-agent-fetch-name-text">{agent.name}</span>
          </span>
        </div>
      )}
      <div className="curl-agent-fetch-row">
        <span className="curl-agent-fetch-label">ID</span>
        <span className="curl-agent-fetch-id-value">
          <code className="curl-agent-fetch-id">{agentId}</code>
          <CopyButton value={agentId} title="Copy ID" />
        </span>
      </div>
    </div>
  );
}

function BrowserActionCard({ action, rawCommand }: { action: BrowserAction; rawCommand?: string }) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(v => !v);
  }, []);

  const hasBody = action.body !== undefined && action.body !== null;
  const bodyHtml = hasBody ? formatJsonWithHighlight(action.body) : undefined;
  const bodyText = hasBody ? JSON.stringify(action.body, null, 2) : undefined;

  return (
    <div className={`curl-card curl-card--browser${expanded ? ' curl-card-expanded' : ''}`} title={rawCommand}>
      <div
        className="curl-browser-head"
        onClick={hasBody ? toggleExpanded : undefined}
        role={hasBody ? 'button' : undefined}
        tabIndex={hasBody ? 0 : undefined}
      >
        <span className="curl-browser-icon"><Icon name={action.icon as React.ComponentProps<typeof Icon>['name']} size={14} /></span>
        <span className="curl-browser-brand">Browser</span>
        <span className="curl-browser-verb">{action.verb}</span>
        {action.target && (
          <code className="curl-browser-target" title={action.target}>{truncateMiddle(action.target, 72)}</code>
        )}
        {action.detail && <span className="curl-browser-detail">{action.detail}</span>}
        <span className="curl-browser-spacer" />
        {action.diff && <span className="curl-browser-badge curl-browser-badge--diff">diff</span>}
        {action.tab && <span className="curl-browser-tab" title="Target tab">{action.tab}</span>}
        {hasBody && (
          <button
            type="button"
            className="curl-expand-btn"
            onClick={toggleExpanded}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            aria-expanded={expanded}
            title={expanded ? 'Collapse' : 'Details'}
          >
            <Icon name={expanded ? 'caret-down' : 'caret-right'} size={12} />
          </button>
        )}
      </div>
      {expanded && bodyHtml !== undefined && (
        <div className="curl-card-row curl-body-row">
          <div className="curl-body-block">
            <pre className="curl-body-pre" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            {bodyText !== undefined && bodyText.length > 0 && (
              <CopyButton value={bodyText} title="Copy body" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const CurlCard = memo(function CurlCard({ parsed, rawCommand }: CurlCardProps) {
  const browserAction = detectBrowserAction(parsed);
  if (browserAction) {
    return <BrowserActionCard action={browserAction} rawCommand={rawCommand} />;
  }
  const agentMessage = detectAgentMessage(parsed, rawCommand);
  if (agentMessage) {
    return (
      <AgentMessageCard
        targetAgentId={agentMessage.targetAgentId}
        message={agentMessage.message}
        rawCommand={rawCommand}
      />
    );
  }
  const agentFetch = detectAgentFetch(parsed);
  if (agentFetch) {
    return <AgentFetchCard agentId={agentFetch.agentId} rawCommand={rawCommand} />;
  }
  return <GenericCurlCard parsed={parsed} rawCommand={rawCommand} />;
});

const GenericCurlCard = memo(function GenericCurlCard({ parsed, rawCommand }: CurlCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { method, url, headers, body, bodyJson, flags } = parsed;
  const headerEntries = Object.entries(headers);
  const methodClass = `curl-method method-${method.toLowerCase()}`;

  const bodyText = bodyJson !== undefined ? JSON.stringify(bodyJson, null, 2) : body;
  const bodyHtml = bodyJson !== undefined ? formatJsonWithHighlight(bodyJson) : undefined;

  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(v => !v);
  }, []);

  if (!expanded) {
    const compactRaw = rawCommand ? truncateMiddle(rawCommand, 160) : `${method} ${url}`;
    return (
      <div
        className="curl-card curl-card-collapsed"
        onClick={toggleExpanded}
        title={rawCommand || `${method} ${url}`}
        role="button"
        tabIndex={0}
      >
        <span className="curl-card-icon"><Icon name="globe" size={14} /></span>
        <span className={methodClass}>{method}</span>
        <span className="curl-collapsed-raw">{compactRaw}</span>
        <button
          type="button"
          className="curl-expand-btn"
          onClick={toggleExpanded}
          aria-label="Expand request"
          title="Expand"
        >
          <Icon name="caret-right" size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="curl-card curl-card-expanded" title={rawCommand}>
      <div className="curl-card-header">
        <span className="curl-card-icon"><Icon name="globe" size={14} /></span>
        <span className="curl-card-title">HTTP Request</span>
        <span className={methodClass}>{method}</span>
        <button
          type="button"
          className="curl-expand-btn curl-collapse-btn"
          onClick={toggleExpanded}
          aria-label="Collapse request"
          title="Collapse"
        >
          <Icon name="caret-down" size={12} />
        </button>
      </div>

      <div className="curl-card-row curl-url-row">
        <span className="curl-label">URL</span>
        <span className="curl-url-value">
          <span className="curl-url-text">{url}</span>
          <CopyButton value={url} title="Copy URL" />
        </span>
      </div>

      {headerEntries.length > 0 && (
        <div className="curl-card-row curl-headers-row">
          <span className="curl-label">HEADERS</span>
          <div className="curl-headers-list">
            {headerEntries.map(([name, value]) => (
              <div className="curl-header-item" key={name}>
                <span className="curl-header-name">{name}</span>
                <span className="curl-header-sep">:</span>
                <span className="curl-header-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {body !== undefined && (
        <div className="curl-card-row curl-body-row">
          <span className="curl-label">
            BODY{bodyJson !== undefined ? ' (JSON)' : ''}
          </span>
          <div className="curl-body-block">
            {bodyHtml !== undefined ? (
              <pre
                className="curl-body-pre"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            ) : (
              <pre className="curl-body-pre">{body}</pre>
            )}
            {bodyText !== undefined && bodyText.length > 0 && (
              <CopyButton value={bodyText} title="Copy body" />
            )}
          </div>
        </div>
      )}

      {flags.length > 0 && (
        <div className="curl-card-row curl-flags-row">
          <span className="curl-label">FLAGS</span>
          <span className="curl-flags-value">{flags.join(' ')}</span>
        </div>
      )}
    </div>
  );
});
