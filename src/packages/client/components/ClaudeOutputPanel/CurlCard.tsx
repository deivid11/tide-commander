import React, { memo, useCallback, useState } from 'react';
import { detectAgentFetch, detectAgentMessage, type ParsedCurl } from './curlParser';
import { useAgent } from '../../store/selectors';
import { AgentIcon } from '../AgentIcon';

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
      {copied ? '✓' : '⧉'}
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
  return (
    <div className="curl-card curl-card--agent-message" title={rawCommand}>
      <div className="curl-agent-message-title">
        <span className="curl-agent-message-icon">✉️</span>
        <span>Sending message to agent</span>
      </div>
      <div className="curl-agent-message-row">
        <span className="curl-agent-message-label">To</span>
        <span className="curl-agent-message-name">
          {agent && <AgentIcon agent={agent} size={13} />}
          <span className="curl-agent-message-name-text">
            {agent ? agent.name : targetAgentId}
          </span>
          {!agent && <CopyButton value={targetAgentId} title="Copy ID" />}
        </span>
      </div>
      <div className="curl-agent-message-body">
        <span className="curl-agent-message-quote-mark">“</span>
        <span className="curl-agent-message-text">{message}</span>
      </div>
    </div>
  );
}

function AgentFetchCard({ agentId, rawCommand }: { agentId: string; rawCommand?: string }) {
  const agent = useAgent(agentId);
  return (
    <div className="curl-card curl-card--agent-fetch" title={rawCommand}>
      <div className="curl-agent-fetch-title">
        <span className="curl-agent-fetch-icon">🔍</span>
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

export const CurlCard = memo(function CurlCard({ parsed, rawCommand }: CurlCardProps) {
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
        <span className="curl-card-icon">🌐</span>
        <span className={methodClass}>{method}</span>
        <span className="curl-collapsed-raw">{compactRaw}</span>
        <button
          type="button"
          className="curl-expand-btn"
          onClick={toggleExpanded}
          aria-label="Expand request"
          title="Expand"
        >
          ▶
        </button>
      </div>
    );
  }

  return (
    <div className="curl-card curl-card-expanded" title={rawCommand}>
      <div className="curl-card-header">
        <span className="curl-card-icon">🌐</span>
        <span className="curl-card-title">HTTP Request</span>
        <span className={methodClass}>{method}</span>
        <button
          type="button"
          className="curl-expand-btn curl-collapse-btn"
          onClick={toggleExpanded}
          aria-label="Collapse request"
          title="Collapse"
        >
          ▼
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
