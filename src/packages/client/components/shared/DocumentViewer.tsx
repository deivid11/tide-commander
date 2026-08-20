/**
 * DocumentViewer — reading view of a word-processing document (.docx/.docm,
 * .odt, legacy .doc, .rtf) for the file viewers. The server parses (GET
 * /api/files/document → blocks); this renders it as a page:
 *  - headings, styled runs (bold/italic/underline/strike/code/color/highlight,
 *    super/subscript), links, real bullet/numbered lists, tables, inline
 *    images (streamed from the container by /api/files/document-media),
 *    footnotes and the document's own header/footer as chrome;
 *  - an outline sidebar built from the headings (click to jump);
 *  - find-in-document with match highlighting and next/previous;
 *  - copy as text or Markdown;
 *  - "load more" when the document is longer than the block cap.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { apiUrl, authFetch, getAuthToken } from '../../utils/storage';
import { copyTextToClipboard } from '../../utils/clipboard';
import {
  blocksToMarkdown,
  blocksToPlainText,
  buildOutline,
  countMatches,
  findMatchingBlocks,
  groupBlocks,
  splitHighlight,
  type DocBlock,
  type DocParagraph,
  type DocRun,
  type DocTable,
  type DocumentResponse,
} from './documentBlocks';

export type { DocumentResponse } from './documentBlocks';

/** Block-cap ladder for "load more". */
const BLOCK_LIMIT_STEPS = [2000, 8000, 20000];

interface DocumentViewerProps {
  /** File path (absolute, or relative to `baseDir`). */
  filePath: string;
  baseDir?: string;
  filename: string;
  className?: string;
}

interface LoadError {
  message: string;
  unsupported: boolean;
}

function RunText({ run, query }: { run: DocRun; query: string }) {
  const style: React.CSSProperties = {};
  if (run.color) style.color = run.color;
  if (run.highlight) style.background = run.highlight;
  const cls = [
    run.bold ? 'is-bold' : '',
    run.italic ? 'is-italic' : '',
    run.underline ? 'is-underline' : '',
    run.strike ? 'is-strike' : '',
    run.mono ? 'is-mono' : '',
  ].filter(Boolean).join(' ');

  const content = query
    ? splitHighlight(run.text, query).map((seg, i) => (
      seg.match ? <mark key={i} className="doc-match">{seg.text}</mark> : <React.Fragment key={i}>{seg.text}</React.Fragment>
    ))
    : run.text;

  let node: React.ReactNode = <span className={`doc-run ${cls}`} style={style}>{content}</span>;
  if (run.superscript) node = <sup>{node}</sup>;
  else if (run.subscript) node = <sub>{node}</sub>;
  if (run.href) {
    node = (
      <a
        className="doc-link"
        href={run.href}
        target={run.href.startsWith('#') ? undefined : '_blank'}
        rel="noreferrer noopener"
        title={run.href}
      >
        {node}
      </a>
    );
  }
  return <>{node}</>;
}

function ParagraphBlock({
  para, query, mediaUrl, index, blockRef,
}: {
  para: DocParagraph;
  query: string;
  mediaUrl: (entry: string) => string;
  index: number;
  blockRef: (index: number, el: HTMLElement | null) => void;
}) {
  const runs = para.runs.map((r, i) => <RunText key={i} run={r} query={query} />);
  const images = para.images?.map((img, i) => (
    <img
      key={i}
      className="doc-image"
      src={mediaUrl(img.entry)}
      alt={img.alt ?? ''}
      loading="lazy"
      style={{ width: img.width ? `${img.width}px` : undefined, maxHeight: img.height ? `${img.height * 2}px` : undefined }}
    />
  ));
  const style = para.align ? ({ textAlign: para.align } as React.CSSProperties) : undefined;
  const indentClass = para.indent ? ` doc-indent-${Math.min(6, para.indent)}` : '';
  const ref = (el: HTMLElement | null) => blockRef(index, el);

  if (para.heading) {
    const Tag = (`h${Math.min(6, para.heading)}`) as 'h1';
    return <Tag ref={ref as never} className={`doc-heading doc-h${para.heading}`} style={style}>{runs}</Tag>;
  }
  const styleClass = para.styleName === 'Title' ? ' doc-title-style' : para.styleName === 'Subtitle' ? ' doc-subtitle-style' : '';
  return (
    <p ref={ref as never} className={`doc-paragraph${styleClass}${indentClass}`} style={style}>
      {runs}
      {images}
    </p>
  );
}

function TableBlock({
  table, query, mediaUrl, index, blockRef,
}: {
  table: DocTable;
  query: string;
  mediaUrl: (entry: string) => string;
  index: number;
  blockRef: (index: number, el: HTMLElement | null) => void;
}) {
  const noop = useCallback(() => { /* nested blocks are not jump targets */ }, []);
  return (
    <div className="doc-table-wrap" ref={(el) => blockRef(index, el)}>
      <table className="doc-table">
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                const Tag = cell.header ? 'th' : 'td';
                return (
                  <Tag
                    key={c}
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan}
                    style={cell.background ? { background: cell.background } : undefined}
                  >
                    {cell.blocks.map((b, i) => (
                      b.type === 'paragraph'
                        ? <ParagraphBlock key={i} para={b} query={query} mediaUrl={mediaUrl} index={-1} blockRef={noop} />
                        : <TableBlock key={i} table={b} query={query} mediaUrl={mediaUrl} index={-1} blockRef={noop} />
                    ))}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {table.truncated && <div className="doc-table-note">…</div>}
    </div>
  );
}

export function DocumentViewer({ filePath, baseDir, filename: _filename, className }: DocumentViewerProps) {
  const { t } = useTranslation('terminal');
  const fileKey = `${baseDir ?? ''}|${filePath}`;
  const [limitState, setLimitState] = useState<{ key: string; blocks: number }>({ key: fileKey, blocks: BLOCK_LIMIT_STEPS[0] });
  const blockLimit = limitState.key === fileKey ? limitState.blocks : BLOCK_LIMIT_STEPS[0];
  const [dataState, setDataState] = useState<{ key: string; resp: DocumentResponse } | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; err: LoadError } | null>(null);
  const data = dataState && dataState.key === fileKey ? dataState.resp : null;
  const error = errorState && errorState.key === fileKey ? errorState.err : null;
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'idle' | 'text' | 'markdown' | 'error'>('idle');
  const [showOutline, setShowOutline] = useState(false);
  const [searchState, setSearchState] = useState<{ key: string; text: string }>({ key: fileKey, text: '' });
  const search = searchState.key === fileKey ? searchState.text : '';
  const [matchCursor, setMatchCursor] = useState(0);
  const blockEls = useRef(new Map<number, HTMLElement>());
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorState(null);
    const baseDirParam = baseDir ? `&baseDir=${encodeURIComponent(baseDir)}` : '';
    authFetch(apiUrl(`/api/files/document?path=${encodeURIComponent(filePath)}${baseDirParam}&blocks=${blockLimit}`))
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err: LoadError = { message: body.error || `HTTP ${res.status}`, unsupported: body.unsupported === true };
          throw err;
        }
        return body as DocumentResponse;
      })
      .then((resp) => { if (!cancelled) setDataState({ key: fileKey, resp }); })
      .catch((e: LoadError | Error) => {
        if (cancelled) return;
        setErrorState({ key: fileKey, err: 'unsupported' in e ? e : { message: e.message, unsupported: false } });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filePath, baseDir, fileKey, blockLimit]);

  const blocks = data?.blocks;
  const outline = useMemo(() => (blocks ? buildOutline(blocks) : []), [blocks]);
  const groups = useMemo(() => (blocks ? groupBlocks(blocks) : []), [blocks]);
  const matches = useMemo(() => (blocks && search.trim() ? findMatchingBlocks(blocks, search) : []), [blocks, search]);
  const matchCount = useMemo(() => (blocks && search.trim() ? countMatches(blocks, search) : 0), [blocks, search]);
  const nextBlockLimit = BLOCK_LIMIT_STEPS.find((s) => s > blockLimit);

  const authToken = getAuthToken();
  const mediaUrl = useCallback((entry: string) => {
    const baseDirParam = baseDir ? `&baseDir=${encodeURIComponent(baseDir)}` : '';
    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
    return apiUrl(`/api/files/document-media?path=${encodeURIComponent(filePath)}${baseDirParam}&entry=${encodeURIComponent(entry)}${tokenParam}`);
  }, [filePath, baseDir, authToken]);

  const registerBlock = useCallback((index: number, el: HTMLElement | null) => {
    if (index < 0) return;
    if (el) blockEls.current.set(index, el);
    else blockEls.current.delete(index);
  }, []);

  const scrollToBlock = useCallback((index: number) => {
    const el = blockEls.current.get(index);
    const scroller = bodyRef.current;
    if (!el || !scroller) return;
    const top = el.offsetTop - scroller.offsetTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 900);
  }, []);

  const jumpMatch = useCallback((delta: number) => {
    if (matches.length === 0) return;
    const next = (matchCursor + delta + matches.length) % matches.length;
    setMatchCursor(next);
    scrollToBlock(matches[next]);
  }, [matches, matchCursor, scrollToBlock]);

  const copyAs = useCallback(async (kind: 'text' | 'markdown') => {
    if (!blocks) return;
    try {
      await copyTextToClipboard(kind === 'text' ? blocksToPlainText(blocks) : blocksToMarkdown(blocks));
      setCopied(kind);
    } catch {
      setCopied('error');
    }
    window.setTimeout(() => setCopied('idle'), 1500);
  }, [blocks]);

  const rootClass = `document-viewer ${className ?? ''}`;

  if (error) {
    return (
      <div className={rootClass}>
        <div className={`file-viewer-error document-viewer-error${error.unsupported ? ' is-unsupported' : ''}`}>
          <Icon name={error.unsupported ? 'info' : 'warn'} size={16} aria-hidden />
          <span>
            {error.unsupported
              ? error.message
              : `${t('documentViewer.error', { defaultValue: 'Could not read document' })}: ${error.message}`}
          </span>
        </div>
      </div>
    );
  }

  if (!data || !blocks) {
    return <div className={rootClass}><div className="file-viewer-loading">{t('documentViewer.loading', { defaultValue: 'Reading document…' })}</div></div>;
  }

  return (
    <div className={rootClass}>
      <div className="document-head">
        <div className="document-summary">
          <span className="document-format-badge">{data.format.toUpperCase()}</span>
          {outline.length > 0 && (
            <button
              type="button"
              className={`document-outline-toggle${showOutline ? ' is-active' : ''}`}
              onClick={() => setShowOutline((v) => !v)}
              title={t('documentViewer.outlineTitle', { defaultValue: 'Show the document outline' })}
            >
              <Icon name="list-bullets" size={12} aria-hidden />
              <span>{t('documentViewer.outline', { defaultValue: 'Outline' })}</span>
            </button>
          )}
          <span className="document-summary-item" title={t('documentViewer.wordsTitle', { defaultValue: 'Words in the loaded part' })}>
            <b>{data.wordCount.toLocaleString()}</b> {t('documentViewer.words', { defaultValue: 'words' })}
          </span>
          {data.author && (
            <span className="document-summary-item document-author" title={t('documentViewer.authorTitle', { defaultValue: 'Author' })}>
              <Icon name="user-circle" size={12} aria-hidden /> {data.author}
            </span>
          )}
          {data.plainTextOnly && (
            <span className="document-summary-note" title={t('documentViewer.plainTextTitle', { defaultValue: 'This format only yields text — save it as .docx for full formatting.' })}>
              {t('documentViewer.plainText', { defaultValue: 'text only' })}
            </span>
          )}
          {data.truncated && (
            <span className="document-summary-warn">
              <Icon name="warn" size={12} aria-hidden />
              <span>{t('documentViewer.truncated', { shown: blocks.length.toLocaleString(), total: data.blockCount.toLocaleString(), defaultValue: 'showing {{shown}} of {{total}} blocks' })}</span>
              {nextBlockLimit && (
                <button
                  type="button"
                  className="document-more-btn"
                  onClick={() => setLimitState({ key: fileKey, blocks: nextBlockLimit })}
                  disabled={loading}
                >
                  {t('documentViewer.loadMore', { count: nextBlockLimit, defaultValue: 'load up to {{count}}' })}
                </button>
              )}
            </span>
          )}
          <span className="document-summary-spacer" />
          <div className="document-search">
            <Icon name="search" size={12} aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearchState({ key: fileKey, text: e.target.value }); setMatchCursor(0); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); jumpMatch(e.shiftKey ? -1 : 1); } }}
              placeholder={t('documentViewer.searchPlaceholder', { defaultValue: 'Find in document…' })}
              spellCheck={false}
              aria-label={t('documentViewer.searchPlaceholder', { defaultValue: 'Find in document…' })}
            />
            {search.trim() && (
              <>
                <span className="document-search-count">
                  {matchCount > 0 ? `${matchCursor + 1}/${matchCount}` : t('documentViewer.noMatches', { defaultValue: 'none' })}
                </span>
                <button type="button" onClick={() => jumpMatch(-1)} disabled={matches.length === 0} title={t('documentViewer.prevMatch', { defaultValue: 'Previous match' })}>
                  <Icon name="caret-up" size={10} />
                </button>
                <button type="button" onClick={() => jumpMatch(1)} disabled={matches.length === 0} title={t('documentViewer.nextMatch', { defaultValue: 'Next match' })}>
                  <Icon name="caret-down" size={10} />
                </button>
                <button type="button" onClick={() => setSearchState({ key: fileKey, text: '' })} title={t('documentViewer.clearSearch', { defaultValue: 'Clear' })}>
                  <Icon name="close" size={10} />
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            className={`document-copy-btn${copied === 'text' ? ' is-copied' : copied === 'error' ? ' is-error' : ''}`}
            onClick={() => copyAs('text')}
            title={t('documentViewer.copyTextTitle', { defaultValue: 'Copy the document as plain text' })}
          >
            <Icon name={copied === 'text' ? 'check' : 'copy'} size={12} aria-hidden />
            <span>{t('documentViewer.copyText', { defaultValue: 'Text' })}</span>
          </button>
          <button
            type="button"
            className={`document-copy-btn${copied === 'markdown' ? ' is-copied' : ''}`}
            onClick={() => copyAs('markdown')}
            title={t('documentViewer.copyMarkdownTitle', { defaultValue: 'Copy the document as Markdown' })}
          >
            <Icon name={copied === 'markdown' ? 'check' : 'file-text'} size={12} aria-hidden />
            <span>{t('documentViewer.copyMarkdown', { defaultValue: 'Markdown' })}</span>
          </button>
        </div>
      </div>

      <div className="document-layout">
        {showOutline && outline.length > 0 && (
          <nav className="document-outline" aria-label={t('documentViewer.outline', { defaultValue: 'Outline' })}>
            {outline.map((entry) => (
              <button
                key={entry.index}
                type="button"
                className={`document-outline-item lvl-${entry.level}`}
                onClick={() => scrollToBlock(entry.index)}
                title={entry.text}
              >
                {entry.text}
              </button>
            ))}
          </nav>
        )}

        <div className={`document-body${loading ? ' is-loading' : ''}`} ref={bodyRef}>
          <article className="document-page">
            {data.header && <div className="document-chrome document-chrome--header">{data.header}</div>}
            {data.title && <h1 className="document-title">{data.title}</h1>}

            {groups.map((group, gi) => {
              if (group.kind === 'list') {
                const ListTag = group.listKind === 'ordered' ? 'ol' : 'ul';
                return (
                  <ListTag key={gi} className={`doc-list doc-list-level-${group.level ?? 0}`}>
                    {group.blocks.map(({ block, index }) => (
                      <li key={index} ref={(el) => registerBlock(index, el)}>
                        {(block as DocParagraph).runs.map((r, i) => <RunText key={i} run={r} query={search} />)}
                      </li>
                    ))}
                  </ListTag>
                );
              }
              const { block, index } = group.blocks[0];
              if (block.type === 'table') {
                return <TableBlock key={gi} table={block} query={search} mediaUrl={mediaUrl} index={index} blockRef={registerBlock} />;
              }
              const para = block as DocParagraph;
              return (
                <React.Fragment key={gi}>
                  {para.pageBreak && <div className="doc-page-break" aria-hidden />}
                  <ParagraphBlock para={para} query={search} mediaUrl={mediaUrl} index={index} blockRef={registerBlock} />
                </React.Fragment>
              );
            })}

            {data.footnotes && data.footnotes.length > 0 && (
              <section className="document-footnotes">
                <h2>{t('documentViewer.footnotes', { defaultValue: 'Notes' })}</h2>
                {data.footnotes.map((note) => (
                  <div className="document-footnote" key={note.id}>
                    <span className="document-footnote-id">{note.id}</span>
                    <div className="document-footnote-body">
                      {note.blocks.map((b: DocBlock, i: number) => (
                        b.type === 'paragraph'
                          ? <ParagraphBlock key={i} para={b} query={search} mediaUrl={mediaUrl} index={-1} blockRef={registerBlock} />
                          : <TableBlock key={i} table={b} query={search} mediaUrl={mediaUrl} index={-1} blockRef={registerBlock} />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {data.footer && <div className="document-chrome document-chrome--footer">{data.footer}</div>}
          </article>
        </div>
      </div>
    </div>
  );
}
