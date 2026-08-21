import React, { useCallback, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { classifyBolbaTasksOutput, type BolbaTaskRow } from './bolbaTasksOutput';
import type { BolbaTasksCall } from './bolbaCurl';
import type { PluginCurlRendererProps } from '../types';

const VISIBLE_ROWS = 6;
const TEXT_VISIBLE_LINES = 5;
const TEXT_MAX_LINES = 200;

function formatJsonWithHighlight(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    (match, key, str, keyword, number) => {
      if (key) return `<span class="curl-json-key">${key}</span>`;
      if (str) return `<span class="curl-json-string">${str}</span>`;
      if (keyword) return `<span class="curl-json-keyword">${keyword}</span>`;
      if (number) return `<span class="curl-json-number">${number}</span>`;
      return match;
    },
  );
}

function CopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`curl-copy-btn${copied ? ' copied' : ''}`}
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} />
    </button>
  );
}

function truncateMiddle(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dueClass(due: string | undefined, status: string | undefined): string {
  if (!due || (status && status !== 'open' && status !== 'waiting')) return '';
  const day = due.slice(0, 10);
  const current = today();
  if (day < current) return ' bolba-due--overdue';
  if (day === current) return ' bolba-due--today';
  return '';
}

function TaskRow({ row }: { row: BolbaTaskRow }) {
  return (
    <div className="bolba-row" title={row.head ?? row.title}>
      {row.id !== undefined && <span className="bolba-row-id">#{row.id}</span>}
      {row.proj && <span className="bolba-proj">{row.proj}</span>}
      {row.status && <span className={`bolba-status bolba-status--${row.status}`}>{row.status}</span>}
      {row.due && <span className={`bolba-due${dueClass(row.due, row.status)}`}>{row.due.slice(0, 10)}</span>}
      <span className="bolba-row-title">{row.title.replace(/\*\*/g, '')}</span>
    </div>
  );
}

export function BolbaCurlCard({ rawCommand, output, match: call }: PluginCurlRendererProps<BolbaTasksCall>) {
  const [showAll, setShowAll] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const result = useMemo(() => classifyBolbaTasksOutput(output), [output]);
  const rawPretty = useMemo(() => {
    if (!showRaw || !output) return null;
    try { return formatJsonWithHighlight(JSON.parse(output.trim())); } catch { return null; }
  }, [showRaw, output]);
  const toggleRaw = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setShowRaw((value) => !value);
  }, []);

  const bodyTitle = typeof call.body?.title === 'string' ? call.body.title : undefined;
  const detail = call.query !== undefined
    ? `“${truncateMiddle(call.query, 48)}”`
    : call.filters ?? (call.action === 'create' && bodyTitle ? truncateMiddle(bodyTitle, 56) : undefined);

  let countLabel: string | undefined;
  if (result?.kind === 'list') countLabel = `${result.count} tarea${result.count === 1 ? '' : 's'}`;
  else if (result?.kind === 'mutation' && result.added !== undefined) countLabel = `+${result.added} evento${result.added === 1 ? '' : 's'}`;
  else if (result?.kind === 'mutation' && result.createdId !== undefined) countLabel = `#${result.createdId}`;

  const renderResult = (): React.ReactNode => {
    if (!result) return null;
    switch (result.kind) {
      case 'list': {
        const rows = showAll ? result.tasks : result.tasks.slice(0, VISIBLE_ROWS);
        const hidden = result.tasks.length - rows.length;
        return (
          <>
            <div className="bolba-rows">{rows.map((row, index) => <TaskRow key={row.id ?? index} row={row} />)}</div>
            {hidden > 0 && (
              <button type="button" className="tc-api-more-btn" onClick={(event) => { event.stopPropagation(); setShowAll(true); }}>
                +{hidden} más
              </button>
            )}
            {showAll && result.count > result.tasks.length && (
              <div className="tc-api-truncation-note">…y {result.count - result.tasks.length} más (ver salida cruda)</div>
            )}
            {showAll && hidden <= 0 && result.tasks.length > VISIBLE_ROWS && (
              <button type="button" className="tc-api-more-btn" onClick={(event) => { event.stopPropagation(); setShowAll(false); }}>Ver menos</button>
            )}
          </>
        );
      }
      case 'mutation': {
        const task = result.task;
        return (
          <div className="bolba-rows">
            <TaskRow row={task} />
            {(task.real !== undefined || task.section || task.done || task.lastEvent) && (
              <div className="bolba-meta-line">
                {task.done && <span className="bolba-meta">done: {task.done}</span>}
                {task.section && <span className="bolba-meta">sección: {task.section}</span>}
                {task.real !== undefined && <span className="bolba-meta">⏱ {task.real} min</span>}
                {task.lastEvent && <span className="bolba-meta bolba-meta--event" title={task.lastEvent}>{truncateMiddle(task.lastEvent, 96)}</span>}
              </div>
            )}
            {result.reimported.length > 0 && (
              <div className="bolba-note"><Icon name="arrow-clockwise" size={11} /><span>reimportado de disco: {result.reimported.join(', ')}</span></div>
            )}
            {result.warnings.map((warning, index) => (
              <div className="bolba-warning" key={index}><Icon name="warn" size={11} /><span>{warning}</span></div>
            ))}
          </div>
        );
      }
      case 'duplicate':
        return (
          <div className="bolba-rows">
            <div className="bolba-warning bolba-warning--dup"><Icon name="copy" size={11} /><span>{result.error}</span></div>
            {result.candidates.map((candidate, index) => (
              <div className="bolba-row" key={candidate.id ?? index} title={candidate.title}>
                {candidate.id !== undefined && <span className="bolba-row-id">#{candidate.id}</span>}
                {candidate.proj && <span className="bolba-proj">{candidate.proj}</span>}
                {candidate.status && <span className={`bolba-status bolba-status--${candidate.status}`}>{candidate.status}</span>}
                {candidate.similarity !== undefined && <span className="bolba-similarity">{Math.round(candidate.similarity * 100)}%</span>}
                <span className="bolba-row-title">{candidate.title.replace(/\*\*/g, '')}</span>
              </div>
            ))}
          </div>
        );
      case 'error':
        return (
          <div className="bolba-rows">
            <div className="bolba-error"><Icon name="cross" size={11} /><span>{result.error}</span></div>
            {result.valid && result.valid.length > 0 && <div className="bolba-note"><span>válidos: {result.valid.join(', ')}</span></div>}
          </div>
        );
      case 'deleted':
        return <div className="bolba-rows"><div className="bolba-note"><Icon name="trash" size={11} /><span>tarea #{result.id} borrada</span></div></div>;
      case 'health':
        return (
          <div className="bolba-rows"><div className="bolba-meta-line">
            <span className={`bolba-status bolba-status--${result.ok ? 'open' : 'discarded'}`}>{result.ok ? 'ok' : 'fail'}</span>
            {result.byStatus.map(([status, count]) => <span className="bolba-meta" key={status}>{status}: {count}</span>)}
            {result.dueTodayOrOverdue !== undefined && <span className="bolba-meta bolba-due--overdue">vencen hoy o antes: {result.dueTodayOrOverdue}</span>}
          </div></div>
        );
      case 'text': {
        const lines = result.text.split('\n');
        const visible = showAll ? lines.slice(0, TEXT_MAX_LINES) : lines.slice(0, TEXT_VISIBLE_LINES);
        return (
          <>
            <pre className="tc-api-text-pre">{visible.join('\n')}</pre>
            {lines.length > TEXT_VISIBLE_LINES && (
              <button type="button" className="tc-api-more-btn" onClick={(event) => { event.stopPropagation(); setShowAll((value) => !value); }}>
                {showAll ? 'Ver menos' : `+${lines.length - TEXT_VISIBLE_LINES} líneas más`}
              </button>
            )}
          </>
        );
      }
      case 'json':
        return <div className="tc-api-result-line"><Icon name="check" size={11} /><code title="Resultado">{result.preview}</code></div>;
    }
  };

  return (
    <div className="curl-card curl-card--bolba" title={rawCommand}>
      <div className="bolba-head">
        <span className="bolba-brand-icon"><Icon name="plant" size={13} /></span>
        <span className="bolba-brand">Bolba</span>
        <span className={`curl-method method-${call.method.toLowerCase()}`}>{call.method}</span>
        <span className="bolba-verb"><Icon name={call.icon as React.ComponentProps<typeof Icon>['name']} size={12} />{call.verb}</span>
        {call.taskId && <span className="bolba-task-id">#{call.taskId}</span>}
        {detail && <span className="bolba-detail" title={call.query ?? call.filters ?? bodyTitle}>{detail}</span>}
        <span className="tc-api-spacer" />
        {call.actor && call.actor !== 'bolba' && <span className="bolba-actor" title="X-Actor">{call.actor}</span>}
        {result?.kind === 'mutation' && result.warnings.length > 0 && <span className="bolba-warn-count">{result.warnings.length} ⚠</span>}
        {countLabel && <span className="bolba-count">{countLabel}</span>}
        {output && (
          <button type="button" className="curl-expand-btn" onClick={toggleRaw} aria-expanded={showRaw} title={showRaw ? 'Ocultar salida cruda' : 'Salida cruda'}>
            <Icon name={showRaw ? 'caret-down' : 'caret-right'} size={12} />
          </button>
        )}
      </div>
      {!showRaw && renderResult()}
      {showRaw && output && (
        <div className="curl-card-row curl-body-row"><div className="curl-body-block">
          {rawPretty !== null ? <pre className="curl-body-pre" dangerouslySetInnerHTML={{ __html: rawPretty }} /> : <pre className="curl-body-pre">{output}</pre>}
          <CopyButton value={output} title="Copiar salida" />
        </div></div>
      )}
    </div>
  );
}
