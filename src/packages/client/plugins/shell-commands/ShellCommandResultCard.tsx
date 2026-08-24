import React, { useState } from 'react';
import { Icon } from '../../components/Icon';
import type { ShellCommandResultInfo } from './shellCommandResult';

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

export function ShellCommandResultCard({ result }: { result: ShellCommandResultInfo }) {
  const [expanded, setExpanded] = useState(false);
  const succeeded = result.exitCode === 0;
  const outputLines = result.output ? result.output.split('\n') : [];
  const hasMore = outputLines.length > 6 || result.output.length > 900;
  const displayedOutput = expanded || !hasMore
    ? result.output
    : `${outputLines.slice(0, 6).join('\n').slice(0, 900)}\n…`;

  return (
    <section className={`shell-command-result-card ${succeeded ? 'is-success' : 'is-failure'}`}>
      <header>
        <span className="shell-command-result-card__mark">
          <Icon name={succeeded ? 'check' : 'cross'} size={16} />
        </span>
        <div>
          <small>Execute Sudo Command · Result</small>
          <strong>{succeeded ? 'Comando completado' : 'El comando terminó con errores'}</strong>
        </div>
        <span className="shell-command-result-card__status">{succeeded ? 'Success' : `Exit ${result.exitCode ?? '—'}`}</span>
      </header>

      <div className="shell-command-result-card__command">
        <span aria-hidden="true">$</span>
        <code>{result.command}</code>
      </div>

      <div className="shell-command-result-card__metrics">
        <span><small>Exit code</small><strong>{result.exitCode ?? 'terminated'}</strong></span>
        <span><small>Duration</small><strong>{formatDuration(result.durationMs)}</strong></span>
        <span><small>Output</small><strong>{result.output ? `${outputLines.length} line${outputLines.length === 1 ? '' : 's'}` : 'Empty'}</strong></span>
      </div>

      {result.output ? (
        <div className="shell-command-result-card__output">
          <div><span>Command output</span>{result.outputTruncated && <em>tail only</em>}</div>
          <pre>{displayedOutput}</pre>
          {hasMore && (
            <button type="button" onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}>
              {expanded ? 'Show less' : 'Show full output'} <Icon name={expanded ? 'caret-up' : 'caret-down'} size={9} />
            </button>
          )}
        </div>
      ) : (
        <div className="shell-command-result-card__empty">
          <Icon name="check" size={11} /> El comando no produjo salida.
        </div>
      )}

      <footer><Icon name="shield" size={10} /> Resultado entregado automáticamente al agente solicitante.</footer>
    </section>
  );
}
