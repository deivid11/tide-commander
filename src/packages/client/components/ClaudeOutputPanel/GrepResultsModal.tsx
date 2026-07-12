import React from 'react';
import { ModalPortal } from '../shared/ModalPortal';
import { Icon } from '../Icon';
import type { CodexGrepResults } from '../../utils/outputRendering';

interface Props {
  results: CodexGrepResults;
  onClose: () => void;
  onFileClick?: (path: string, data?: { highlightRange: { offset: number; limit: number } }) => void;
}

export function GrepResultsModal({ results, onClose, onFileClick }: Props) {
  const groups = new Map<string, typeof results.matches>();
  for (const match of results.matches) {
    const group = groups.get(match.path) || [];
    group.push(match);
    groups.set(match.path, group);
  }
  const highlight = (text: string) => {
    const index = text.toLowerCase().indexOf(results.query.toLowerCase());
    if (index < 0) return text;
    return <>{text.slice(0, index)}<mark>{text.slice(index, index + results.query.length)}</mark>{text.slice(index + results.query.length)}</>;
  };

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onClick={onClose}>
        <div className="modal grep-results-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header grep-results-header">
            <div className="grep-results-title"><Icon name="search" size={16} /><span>Search results</span></div>
            <button className="agent-response-modal-close" onClick={onClose}>&times;</button>
          </div>
          <div className="grep-results-summary">
            <code>{results.query}</code>
            <span>{results.matches.length} matches · {groups.size} files</span>
          </div>
          <div className="modal-body grep-results-body">
            {results.matches.length === 0 ? <div className="grep-results-empty">No captured matches</div> : [...groups].map(([path, matches]) => (
              <section className="grep-result-file" key={path}>
                <button className="grep-result-file-name" onClick={() => onFileClick?.(path, { highlightRange: { offset: matches[0].line, limit: 1 } })} title={path}>
                  <Icon name="file-code" size={13} /> {path.split('/').pop() || path}
                  <span>{matches.length}</span>
                </button>
                {matches.map((match, index) => (
                  <button className="grep-result-match" key={`${match.line}-${index}`} onClick={() => onFileClick?.(path, { highlightRange: { offset: match.line, limit: 1 } })}>
                    <span className="grep-result-line">{match.line}</span>
                    <code>{highlight(match.text)}</code>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
