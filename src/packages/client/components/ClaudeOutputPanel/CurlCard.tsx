import React, { memo, useCallback, useId, useMemo, useState } from 'react';
import { detectAgentFetch, detectAgentMessage, detectBolbaTasksCall, detectBrowserAction, detectTcApiCall, type BolbaTasksCall, type BrowserAction, type ParsedCurl, type TcApiCall } from './curlParser';
import { classifyTcApiOutput, type TcAgentRow, type TcApiListing } from './tcApiOutput';
import { classifyBolbaTasksOutput, type BolbaTaskRow } from './bolbaTasksOutput';
import { useAgent } from '../../store/selectors';
import { store, useViewMode } from '../../store';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';

const AGENT_MESSAGE_COLLAPSE_LINE_THRESHOLD = 5;
const AGENT_MESSAGE_COLLAPSE_CHAR_THRESHOLD = 280;

interface CurlCardProps {
  parsed: ParsedCurl;
  rawCommand?: string;
  /** Bash tool output paired with the command — lets internal TC API calls render their result inline. */
  output?: string;
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

// ── Tide Commander internal API card ─────────────────────────────────────────

const TC_API_VISIBLE_ROWS = 6;
const TC_API_TEXT_VISIBLE_LINES = 5;
const TC_API_TEXT_MAX_LINES = 200;

/** One agent row in a TC API listing — resolves the live agent for its icon and click-to-open. */
function TcAgentRowItem({ row }: { row: TcAgentRow }) {
  const agent = useAgent(row.id ?? '');
  const viewMode = useViewMode();

  // Same selection path as clicking a pinned chip / the agent-message card.
  const openAgent = useCallback(() => {
    if (!agent) return;
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(agent.id);
    if (viewMode !== 'flat') store.setTerminalOpen(true);
  }, [agent, viewMode]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      openAgent();
    }
  }, [openAgent]);

  const status = agent?.status ?? row.status;
  return (
    <div className="tc-api-row tc-api-row--agent">
      {agent
        ? <AgentIcon agent={agent} size={14} />
        : <span className="tc-api-row-icon"><Icon name="robot" size={12} /></span>}
      {agent ? (
        <span
          className="tc-api-row-name clickable-agent-name"
          role="button"
          tabIndex={0}
          title={`Open ${agent.name}`}
          onClick={(e) => { e.stopPropagation(); openAgent(); }}
          onKeyDown={handleKeyDown}
        >
          {row.name}
        </span>
      ) : (
        <span className="tc-api-row-name" title={row.id}>{row.name}</span>
      )}
      {status && <span className={`tc-api-status tc-api-status--${status}`}>{status}</span>}
      {row.agentClass && <span className="tc-api-row-dim">{row.agentClass}</span>}
      {row.cwd && <span className="tc-api-row-path" title={row.cwd}>{truncateMiddle(row.cwd, 42)}</span>}
    </div>
  );
}

function tcApiCountLabel(listing: TcApiListing): string | undefined {
  switch (listing.kind) {
    case 'agents': return `${listing.total} agent${listing.total === 1 ? '' : 's'}`;
    case 'skills': return `${listing.total} skill${listing.total === 1 ? '' : 's'}`;
    case 'areas': return `${listing.total} area${listing.total === 1 ? '' : 's'}`;
    case 'buildings': return `${listing.total} building${listing.total === 1 ? '' : 's'}`;
    default: return undefined;
  }
}

function TcApiCard({ call, output, rawCommand }: { call: TcApiCall; output?: string; rawCommand?: string }) {
  const [showAll, setShowAll] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const listing = useMemo(() => classifyTcApiOutput(output), [output]);

  // Raw view: pretty-printed JSON when the output parses, plain text otherwise.
  const rawPretty = useMemo(() => {
    if (!showRaw || !output) return null;
    try {
      return formatJsonWithHighlight(JSON.parse(output.trim()));
    } catch {
      return null;
    }
  }, [showRaw, output]);

  const toggleRaw = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRaw(v => !v);
  }, []);

  const methodClass = `curl-method method-${call.method.toLowerCase()}`;
  const countLabel = listing ? tcApiCountLabel(listing) : undefined;

  const renderRows = (): React.ReactNode => {
    if (!listing) return null;
    if (listing.kind === 'text') {
      const lines = listing.text.split('\n');
      if (lines.length === 1 && listing.text.length <= 100) {
        return (
          <div className="tc-api-result-line">
            <Icon name="check" size={11} />
            <code>{listing.text}</code>
          </div>
        );
      }
      const visible = showAll ? lines.slice(0, TC_API_TEXT_MAX_LINES) : lines.slice(0, TC_API_TEXT_VISIBLE_LINES);
      return (
        <>
          <pre className="tc-api-text-pre">{visible.join('\n')}</pre>
          {lines.length > TC_API_TEXT_VISIBLE_LINES && (
            <button type="button" className="tc-api-more-btn" onClick={(e) => { e.stopPropagation(); setShowAll(v => !v); }}>
              {showAll ? 'Show less' : `+${lines.length - TC_API_TEXT_VISIBLE_LINES} more lines`}
            </button>
          )}
        </>
      );
    }
    if (listing.kind === 'json') {
      return (
        <div className="tc-api-result-line">
          <Icon name="check" size={11} />
          <code title="Result">{listing.preview}</code>
        </div>
      );
    }

    const rows = showAll ? listing.rows : listing.rows.slice(0, TC_API_VISIBLE_ROWS);
    const hiddenCount = listing.total - rows.length;
    let rendered: React.ReactNode;
    switch (listing.kind) {
      case 'agents':
        rendered = rows.map((row, i) => <TcAgentRowItem key={row.id ?? i} row={row as TcAgentRow} />);
        break;
      case 'skills':
        rendered = (rows as typeof listing.rows).map((row, i) => (
          <div className="tc-api-row" key={row.id ?? i}>
            <span className="tc-api-row-icon"><Icon name="sparkle" size={12} /></span>
            <span className="tc-api-row-name" title={row.description}>{row.name}</span>
            {row.enabled === false && <span className="tc-api-status tc-api-status--off">off</span>}
            {row.assignedCount !== undefined && (
              <span className="tc-api-row-dim">{row.assignedCount} assigned</span>
            )}
            {row.description && <span className="tc-api-row-path" title={row.description}>{truncateMiddle(row.description, 48)}</span>}
          </div>
        ));
        break;
      case 'areas':
        rendered = (rows as typeof listing.rows).map((row, i) => (
          <div className="tc-api-row" key={row.id ?? i}>
            <span className="tc-api-area-dot" style={row.color ? { background: row.color } : undefined} />
            <span className="tc-api-row-name">{row.name}</span>
            {row.agentCount !== undefined && (
              <span className="tc-api-row-dim">{row.agentCount} agent{row.agentCount === 1 ? '' : 's'}</span>
            )}
          </div>
        ));
        break;
      case 'buildings':
        rendered = (rows as typeof listing.rows).map((row, i) => (
          <div className="tc-api-row" key={row.id ?? i}>
            <span className="tc-api-row-icon">
              <Icon name={row.buildingType === 'boss' ? 'crown' : row.buildingType === 'database' ? 'database' : row.buildingType === 'tests' ? 'flask' : 'buildings'} size={12} />
            </span>
            <span className="tc-api-row-name">{row.name}</span>
            {row.status && <span className={`tc-api-status tc-api-status--${row.status}`}>{row.status}</span>}
            {row.buildingType && <span className="tc-api-row-dim">{row.buildingType}</span>}
          </div>
        ));
        break;
    }
    return (
      <>
        <div className="tc-api-rows">{rendered}</div>
        {hiddenCount > 0 && (
          <button type="button" className="tc-api-more-btn" onClick={(e) => { e.stopPropagation(); setShowAll(true); }}>
            +{hiddenCount} more
          </button>
        )}
        {showAll && listing.total > listing.rows.length && (
          <div className="tc-api-truncation-note">…and {listing.total - listing.rows.length} more (see raw output)</div>
        )}
        {showAll && hiddenCount <= 0 && listing.total > TC_API_VISIBLE_ROWS && (
          <button type="button" className="tc-api-more-btn" onClick={(e) => { e.stopPropagation(); setShowAll(false); }}>
            Show less
          </button>
        )}
      </>
    );
  };

  return (
    <div className="curl-card curl-card--tc" title={rawCommand}>
      <div className="tc-api-head">
        <span className="tc-api-brand-icon"><Icon name="waves" size={13} /></span>
        <span className="tc-api-brand">Tide Commander</span>
        <span className={methodClass}>{call.method}</span>
        <span className="tc-api-label">
          <Icon name={call.icon as React.ComponentProps<typeof Icon>['name']} size={12} />
          {call.label}
        </span>
        <code className="tc-api-path" title={call.path}>{truncateMiddle(call.path, 44)}</code>
        <span className="tc-api-spacer" />
        {countLabel && <span className="tc-api-count">{countLabel}</span>}
        {output !== undefined && output !== '' && (
          <button
            type="button"
            className="curl-expand-btn"
            onClick={toggleRaw}
            aria-expanded={showRaw}
            aria-label={showRaw ? 'Hide raw output' : 'Show raw output'}
            title={showRaw ? 'Hide raw output' : 'Raw output'}
          >
            <Icon name={showRaw ? 'caret-down' : 'caret-right'} size={12} />
          </button>
        )}
      </div>
      {!showRaw && renderRows()}
      {showRaw && output && (
        <div className="curl-card-row curl-body-row">
          <div className="curl-body-block">
            {rawPretty !== null ? (
              <pre className="curl-body-pre" dangerouslySetInnerHTML={{ __html: rawPretty }} />
            ) : (
              <pre className="curl-body-pre">{output}</pre>
            )}
            <CopyButton value={output} title="Copy output" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bolba tasks board card (bolba-tasks service, 127.0.0.1:7492) ─────────────

const BOLBA_VISIBLE_ROWS = 6;
const BOLBA_TEXT_VISIBLE_LINES = 5;
const BOLBA_TEXT_MAX_LINES = 200;

/** Today as local `YYYY-MM-DD` — for due-date coloring. */
function bolbaToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bolbaDueClass(due: string | undefined, status: string | undefined): string {
  if (!due || (status && status !== 'open' && status !== 'waiting')) return '';
  const day = due.slice(0, 10);
  const today = bolbaToday();
  if (day < today) return ' bolba-due--overdue';
  if (day === today) return ' bolba-due--today';
  return '';
}

function BolbaTaskRowItem({ row }: { row: BolbaTaskRow }) {
  const title = row.title.replace(/\*\*/g, '');
  return (
    <div className="bolba-row" title={row.head ?? row.title}>
      {row.id !== undefined && <span className="bolba-row-id">#{row.id}</span>}
      {row.proj && <span className="bolba-proj">{row.proj}</span>}
      {row.status && <span className={`bolba-status bolba-status--${row.status}`}>{row.status}</span>}
      {row.due && <span className={`bolba-due${bolbaDueClass(row.due, row.status)}`}>{row.due.slice(0, 10)}</span>}
      <span className="bolba-row-title">{title}</span>
    </div>
  );
}

function BolbaTasksCard({ call, output, rawCommand }: { call: BolbaTasksCall; output?: string; rawCommand?: string }) {
  const [showAll, setShowAll] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const result = useMemo(() => classifyBolbaTasksOutput(output), [output]);

  const rawPretty = useMemo(() => {
    if (!showRaw || !output) return null;
    try {
      return formatJsonWithHighlight(JSON.parse(output.trim()));
    } catch {
      return null;
    }
  }, [showRaw, output]);

  const toggleRaw = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRaw(v => !v);
  }, []);

  // Header detail: search query, board filters, or the title being created.
  const bodyTitle = typeof call.body?.title === 'string' ? call.body.title : undefined;
  const detail = call.query !== undefined
    ? `“${truncateMiddle(call.query, 48)}”`
    : call.filters ?? ((call.action === 'create' && bodyTitle) ? truncateMiddle(bodyTitle, 56) : undefined);

  // Header count chip.
  let countLabel: string | undefined;
  if (result?.kind === 'list') countLabel = `${result.count} tarea${result.count === 1 ? '' : 's'}`;
  else if (result?.kind === 'mutation' && result.added !== undefined) countLabel = `+${result.added} evento${result.added === 1 ? '' : 's'}`;
  else if (result?.kind === 'mutation' && result.createdId !== undefined) countLabel = `#${result.createdId}`;

  const methodClass = `curl-method method-${call.method.toLowerCase()}`;

  const renderResult = (): React.ReactNode => {
    if (!result) return null;
    switch (result.kind) {
      case 'list': {
        const rows = showAll ? result.tasks : result.tasks.slice(0, BOLBA_VISIBLE_ROWS);
        const hidden = result.tasks.length - rows.length;
        return (
          <>
            <div className="bolba-rows">
              {rows.map((row, i) => <BolbaTaskRowItem key={row.id ?? i} row={row} />)}
            </div>
            {hidden > 0 && (
              <button type="button" className="tc-api-more-btn" onClick={(e) => { e.stopPropagation(); setShowAll(true); }}>
                +{hidden} más
              </button>
            )}
            {showAll && result.count > result.tasks.length && (
              <div className="tc-api-truncation-note">…y {result.count - result.tasks.length} más (ver salida cruda)</div>
            )}
            {showAll && hidden <= 0 && result.tasks.length > BOLBA_VISIBLE_ROWS && (
              <button type="button" className="tc-api-more-btn" onClick={(e) => { e.stopPropagation(); setShowAll(false); }}>
                Ver menos
              </button>
            )}
          </>
        );
      }
      case 'mutation': {
        const t = result.task;
        return (
          <div className="bolba-rows">
            <BolbaTaskRowItem row={t} />
            {(t.real !== undefined || t.section || t.done || t.lastEvent) && (
              <div className="bolba-meta-line">
                {t.done && <span className="bolba-meta">done: {t.done}</span>}
                {t.section && <span className="bolba-meta">sección: {t.section}</span>}
                {t.real !== undefined && <span className="bolba-meta">⏱ {t.real} min</span>}
                {t.lastEvent && <span className="bolba-meta bolba-meta--event" title={t.lastEvent}>{truncateMiddle(t.lastEvent, 96)}</span>}
              </div>
            )}
            {result.reimported.length > 0 && (
              <div className="bolba-note">
                <Icon name="arrow-clockwise" size={11} />
                <span>reimportado de disco: {result.reimported.join(', ')}</span>
              </div>
            )}
            {result.warnings.map((w, i) => (
              <div className="bolba-warning" key={i}>
                <Icon name="warn" size={11} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        );
      }
      case 'duplicate':
        return (
          <div className="bolba-rows">
            <div className="bolba-warning bolba-warning--dup">
              <Icon name="copy" size={11} />
              <span>{result.error}</span>
            </div>
            {result.candidates.map((c, i) => (
              <div className="bolba-row" key={c.id ?? i} title={c.title}>
                {c.id !== undefined && <span className="bolba-row-id">#{c.id}</span>}
                {c.proj && <span className="bolba-proj">{c.proj}</span>}
                {c.status && <span className={`bolba-status bolba-status--${c.status}`}>{c.status}</span>}
                {c.similarity !== undefined && (
                  <span className="bolba-similarity">{Math.round(c.similarity * 100)}%</span>
                )}
                <span className="bolba-row-title">{c.title.replace(/\*\*/g, '')}</span>
              </div>
            ))}
          </div>
        );
      case 'error':
        return (
          <div className="bolba-rows">
            <div className="bolba-error">
              <Icon name="cross" size={11} />
              <span>{result.error}</span>
            </div>
            {result.valid && result.valid.length > 0 && (
              <div className="bolba-note"><span>válidos: {result.valid.join(', ')}</span></div>
            )}
          </div>
        );
      case 'deleted':
        return (
          <div className="bolba-rows">
            <div className="bolba-note"><Icon name="trash" size={11} /><span>tarea #{result.id} borrada</span></div>
          </div>
        );
      case 'health':
        return (
          <div className="bolba-rows">
            <div className="bolba-meta-line">
              <span className={`bolba-status bolba-status--${result.ok ? 'open' : 'discarded'}`}>{result.ok ? 'ok' : 'fail'}</span>
              {result.byStatus.map(([status, n]) => (
                <span className="bolba-meta" key={status}>{status}: {n}</span>
              ))}
              {result.dueTodayOrOverdue !== undefined && (
                <span className="bolba-meta bolba-due--overdue">vencen hoy o antes: {result.dueTodayOrOverdue}</span>
              )}
            </div>
          </div>
        );
      case 'text': {
        const lines = result.text.split('\n');
        const visible = showAll ? lines.slice(0, BOLBA_TEXT_MAX_LINES) : lines.slice(0, BOLBA_TEXT_VISIBLE_LINES);
        return (
          <>
            <pre className="tc-api-text-pre">{visible.join('\n')}</pre>
            {lines.length > BOLBA_TEXT_VISIBLE_LINES && (
              <button type="button" className="tc-api-more-btn" onClick={(e) => { e.stopPropagation(); setShowAll(v => !v); }}>
                {showAll ? 'Ver menos' : `+${lines.length - BOLBA_TEXT_VISIBLE_LINES} líneas más`}
              </button>
            )}
          </>
        );
      }
      case 'json':
        return (
          <div className="tc-api-result-line">
            <Icon name="check" size={11} />
            <code title="Resultado">{result.preview}</code>
          </div>
        );
    }
  };

  return (
    <div className="curl-card curl-card--bolba" title={rawCommand}>
      <div className="bolba-head">
        <span className="bolba-brand-icon"><Icon name="plant" size={13} /></span>
        <span className="bolba-brand">Bolba</span>
        <span className={methodClass}>{call.method}</span>
        <span className="bolba-verb">
          <Icon name={call.icon as React.ComponentProps<typeof Icon>['name']} size={12} />
          {call.verb}
        </span>
        {call.taskId && <span className="bolba-task-id">#{call.taskId}</span>}
        {detail && <span className="bolba-detail" title={call.query ?? call.filters ?? bodyTitle}>{detail}</span>}
        <span className="tc-api-spacer" />
        {call.actor && call.actor !== 'bolba' && <span className="bolba-actor" title="X-Actor">{call.actor}</span>}
        {result?.kind === 'mutation' && result.warnings.length > 0 && (
          <span className="bolba-warn-count" title="Warnings del cierre">{result.warnings.length} ⚠</span>
        )}
        {countLabel && <span className="bolba-count">{countLabel}</span>}
        {output !== undefined && output !== '' && (
          <button
            type="button"
            className="curl-expand-btn"
            onClick={toggleRaw}
            aria-expanded={showRaw}
            aria-label={showRaw ? 'Ocultar salida cruda' : 'Ver salida cruda'}
            title={showRaw ? 'Ocultar salida cruda' : 'Salida cruda'}
          >
            <Icon name={showRaw ? 'caret-down' : 'caret-right'} size={12} />
          </button>
        )}
      </div>
      {!showRaw && renderResult()}
      {showRaw && output && (
        <div className="curl-card-row curl-body-row">
          <div className="curl-body-block">
            {rawPretty !== null ? (
              <pre className="curl-body-pre" dangerouslySetInnerHTML={{ __html: rawPretty }} />
            ) : (
              <pre className="curl-body-pre">{output}</pre>
            )}
            <CopyButton value={output} title="Copiar salida" />
          </div>
        </div>
      )}
    </div>
  );
}

export const CurlCard = memo(function CurlCard({ parsed, rawCommand, output }: CurlCardProps) {
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
  const bolbaTasks = detectBolbaTasksCall(parsed, rawCommand);
  if (bolbaTasks) {
    return <BolbaTasksCard call={bolbaTasks} output={output} rawCommand={rawCommand} />;
  }
  const tcApi = detectTcApiCall(parsed);
  if (tcApi) {
    return <TcApiCard call={tcApi} output={output} rawCommand={rawCommand} />;
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
