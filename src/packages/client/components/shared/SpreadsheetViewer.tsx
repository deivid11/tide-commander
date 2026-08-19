/**
 * SpreadsheetViewer — grid preview of a workbook (.xlsx/.xlsm/.xls/.ods) or a
 * delimited/HTML table file for the file viewers. The server parses (GET
 * /api/files/spreadsheet — one sheet per call, capped rows × cols); this
 * renders it VisiData-style:
 *  - sheet tabs, sticky column letters + row numbers, virtualized rows (only
 *    the visible window is in the DOM, so 10k rows scroll like 10);
 *  - fixed column widths estimated from the data (no jumping while scrolling);
 *  - filter box (substring over loaded rows) and per-column sort;
 *  - cell / range / column / row selection (drag, Shift extends, Ctrl/Cmd+click
 *    adds non-contiguous ranges) with a live status bar: count, numeric count,
 *    sum, average, min, max — and Ctrl/Cmd+C copies the selection as TSV;
 *  - extent + truncation notes with a "load more rows" ladder;
 *  - unsupported files get the server's explanation instead of a grid.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { apiUrl, authFetch } from '../../utils/storage';
import { copyTextToClipboard } from '../../utils/clipboard';
import {
  columnLabel,
  computeMultiSelectionStats,
  describeDelimiter,
  estimateColumnWidths,
  filterRowIndices,
  formatBadge,
  formatExtent,
  formatStat,
  gridToTsv,
  isNumericCell,
  normalizeRange,
  rangesContain,
  rangesToTsv,
  sheetCacheKey,
  sortRowIndices,
  visibleColumnCount,
  type CellRange,
  type SortDir,
  type SpreadsheetResponse,
} from './spreadsheetGrid';

export type { SpreadsheetResponse } from './spreadsheetGrid';

/** Row-cap ladder for "load more": each click asks the server for the next step. */
const ROW_LIMIT_STEPS = [500, 2000, 10000];
/** Rows rendered above/below the visible window. */
const OVERSCAN_ROWS = 12;
const ROW_HEAD_WIDTH = 48;

interface SpreadsheetViewerProps {
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

interface CellPos { r: number; c: number }

export function SpreadsheetViewer({ filePath, baseDir, filename, className }: SpreadsheetViewerProps) {
  const { t } = useTranslation('terminal');
  // Everything file-scoped is keyed by the file so a path change never shows
  // the previous file's grid, error, sheet or row ladder for a frame.
  const fileKey = `${baseDir ?? ''}|${filePath}`;
  const [view, setView] = useState<{ key: string; sheet: number; rows: number }>({ key: fileKey, sheet: 0, rows: ROW_LIMIT_STEPS[0] });
  const sheetIndex = view.key === fileKey ? view.sheet : 0;
  const rowLimit = view.key === fileKey ? view.rows : ROW_LIMIT_STEPS[0];
  const [dataState, setDataState] = useState<{ key: string; resp: SpreadsheetResponse } | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; err: LoadError } | null>(null);
  const data = dataState && dataState.key === fileKey ? dataState.resp : null;
  const error = errorState && errorState.key === fileKey ? errorState.err : null;
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'error'>('idle');
  const cache = useRef(new Map<string, SpreadsheetResponse>());

  // Grid interaction state (reset per sheet).
  const sheetKey = `${fileKey}#${sheetIndex}`;
  const [filterState, setFilterState] = useState<{ key: string; text: string }>({ key: sheetKey, text: '' });
  const filter = filterState.key === sheetKey ? filterState.text : '';
  const [sortState, setSortState] = useState<{ key: string; col: number; dir: SortDir } | null>(null);
  const sort = sortState && sortState.key === sheetKey ? sortState : null;
  // Selection = ordered list of ranges (Ctrl/Cmd+click appends); drag/shift/
  // arrows always act on the LAST range.
  const [selState, setSelState] = useState<{ key: string; ranges: Array<{ anchor: CellPos; focus: CellPos }> } | null>(null);
  const selRanges = selState && selState.key === sheetKey ? selState.ranges : null;
  const selection: CellRange[] | null = useMemo(
    () => (selRanges && selRanges.length > 0 ? selRanges.map((r) => normalizeRange(r.anchor, r.focus)) : null),
    [selRanges],
  );
  const dragging = useRef(false);

  // Virtualization.
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  const [rowHeight, setRowHeight] = useState(24);

  useEffect(() => {
    let cancelled = false;
    const key = sheetCacheKey(fileKey, sheetIndex, rowLimit);
    const cached = cache.current.get(key);
    if (cached) {
      setDataState({ key: fileKey, resp: cached });
      setErrorState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorState(null);
    const baseDirParam = baseDir ? `&baseDir=${encodeURIComponent(baseDir)}` : '';
    authFetch(apiUrl(`/api/files/spreadsheet?path=${encodeURIComponent(filePath)}${baseDirParam}&sheet=${sheetIndex}&rows=${rowLimit}`))
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err: LoadError = { message: body.error || `HTTP ${res.status}`, unsupported: body.unsupported === true };
          throw err;
        }
        return body as SpreadsheetResponse;
      })
      .then((resp) => {
        if (cancelled) return;
        // Bounded cache: sheets of the current file only.
        if (cache.current.size > 64) cache.current.clear();
        cache.current.set(key, resp);
        setDataState({ key: fileKey, resp });
      })
      .catch((e: LoadError | Error) => {
        if (cancelled) return;
        setErrorState({ key: fileKey, err: 'unsupported' in e ? e : { message: e.message, unsupported: false } });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filePath, baseDir, fileKey, sheetIndex, rowLimit]);

  // Switching sheets starts the row ladder over and scrolls back to the top.
  const selectSheet = useCallback((idx: number) => {
    setView({ key: fileKey, sheet: idx, rows: ROW_LIMIT_STEPS[0] });
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [fileKey]);
  const loadMoreRows = useCallback((rows: number) => {
    setView({ key: fileKey, sheet: sheetIndex, rows });
  }, [fileKey, sheetIndex]);

  const nextRowLimit = ROW_LIMIT_STEPS.find((s) => s > rowLimit);

  const sheet = data?.sheet;
  const rows = sheet?.rows;
  const cols = useMemo(() => (data && sheet ? visibleColumnCount(sheet.rows, sheet.colCount, data.maxCols) : 0), [data, sheet]);
  const columnLabels = useMemo(() => Array.from({ length: cols }, (_, i) => columnLabel(i)), [cols]);
  const colWidths = useMemo(() => (rows ? estimateColumnWidths(rows, cols) : []), [rows, cols]);
  const totalWidth = useMemo(() => ROW_HEAD_WIDTH + colWidths.reduce((a, b) => a + b, 0), [colWidths]);

  // Displayed rows = filter → sort (indices into sheet.rows).
  const display = useMemo(() => {
    if (!rows) return [] as number[];
    const filtered = filterRowIndices(rows, filter);
    return sort ? sortRowIndices(rows, filtered, sort.col, sort.dir) : filtered;
  }, [rows, filter, sort]);

  // Measure viewport + row height for virtualization.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      setViewport((v) => (v.height === el.clientHeight ? v : { ...v, height: el.clientHeight }));
      const probe = el.querySelector<HTMLElement>('tbody tr[data-row]');
      if (probe && probe.offsetHeight > 0) setRowHeight((h) => (h === probe.offsetHeight ? h : probe.offsetHeight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, display.length]);

  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    setViewport((v) => (Math.abs(v.scrollTop - el.scrollTop) < 1 ? v : { ...v, scrollTop: el.scrollTop }));
  }, []);

  const total = display.length;
  const firstVisible = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - OVERSCAN_ROWS);
  const lastVisible = Math.min(total, Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + OVERSCAN_ROWS);
  const topPad = firstVisible * rowHeight;
  const bottomPad = Math.max(0, (total - lastVisible) * rowHeight);

  // ── selection ──────────────────────────────────────────────────────────────
  const replaceSelection = useCallback((anchor: CellPos, focus: CellPos) => {
    setSelState({ key: sheetKey, ranges: [{ anchor, focus }] });
  }, [sheetKey]);
  const appendRange = useCallback((anchor: CellPos, focus: CellPos) => {
    setSelState((prev) => ({
      key: sheetKey,
      ranges: [...(prev && prev.key === sheetKey ? prev.ranges : []), { anchor, focus }],
    }));
  }, [sheetKey]);
  /** Move the focus of the last range (drag / shift / arrows), keeping its anchor. */
  const extendLast = useCallback((focus: CellPos, anchorOverride?: CellPos) => {
    setSelState((prev) => {
      const ranges = prev && prev.key === sheetKey ? prev.ranges.slice() : [];
      if (ranges.length === 0) return { key: sheetKey, ranges: [{ anchor: anchorOverride ?? focus, focus }] };
      const last = ranges[ranges.length - 1];
      ranges[ranges.length - 1] = { anchor: anchorOverride ?? last.anchor, focus };
      return { key: sheetKey, ranges };
    });
  }, [sheetKey]);
  const clearSelection = useCallback(() => setSelState(null), []);
  const lastRange = selRanges && selRanges.length > 0 ? selRanges[selRanges.length - 1] : null;

  const onCellMouseDown = useCallback((e: React.MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    rootRef.current?.focus({ preventScroll: true });
    e.preventDefault();
    const multi = e.ctrlKey || e.metaKey;
    if (multi) {
      // Ctrl/Cmd+click on an already single-selected cell removes that range.
      const idx = selRanges ? selRanges.findIndex((x) => x.anchor.r === r && x.anchor.c === c && x.focus.r === r && x.focus.c === c) : -1;
      if (idx >= 0) {
        const ranges = selRanges!.filter((_, i) => i !== idx);
        setSelState(ranges.length > 0 ? { key: sheetKey, ranges } : null);
        return;
      }
      appendRange({ r, c }, { r, c });
      dragging.current = true;
      return;
    }
    if (e.shiftKey && lastRange) {
      extendLast({ r, c });
      return;
    }
    replaceSelection({ r, c }, { r, c });
    dragging.current = true;
  }, [selRanges, sheetKey, lastRange, appendRange, extendLast, replaceSelection]);

  const onCellMouseEnter = useCallback((r: number, c: number) => {
    if (!dragging.current || !lastRange) return;
    if (lastRange.focus.r === r && lastRange.focus.c === c) return;
    extendLast({ r, c });
  }, [lastRange, extendLast]);

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const selectColumn = useCallback((c: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    rootRef.current?.focus({ preventScroll: true });
    const last = Math.max(0, total - 1);
    if ((e.ctrlKey || e.metaKey)) appendRange({ r: 0, c }, { r: last, c });
    else if (e.shiftKey && lastRange) extendLast({ r: last, c }, { r: 0, c: lastRange.anchor.c });
    else replaceSelection({ r: 0, c }, { r: last, c });
  }, [total, lastRange, appendRange, extendLast, replaceSelection]);

  const selectRow = useCallback((r: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    rootRef.current?.focus({ preventScroll: true });
    const lastCol = Math.max(0, cols - 1);
    if ((e.ctrlKey || e.metaKey)) appendRange({ r, c: 0 }, { r, c: lastCol });
    else if (e.shiftKey && lastRange) extendLast({ r, c: lastCol }, { r: lastRange.anchor.r, c: 0 });
    else replaceSelection({ r, c: 0 }, { r, c: lastCol });
  }, [cols, lastRange, appendRange, extendLast, replaceSelection]);

  const toggleSort = useCallback((c: number) => {
    setSortState((prev) => {
      if (!prev || prev.key !== sheetKey || prev.col !== c) return { key: sheetKey, col: c, dir: 'asc' };
      if (prev.dir === 'asc') return { key: sheetKey, col: c, dir: 'desc' };
      return null;
    });
    setSelState(null);
  }, [sheetKey]);

  const stats = useMemo(() => (rows && selection ? computeMultiSelectionStats(rows, display, selection) : null), [rows, display, selection]);

  const copyGrid = useCallback(async () => {
    if (!rows) return;
    try {
      const text = selection ? rangesToTsv(rows, display, selection) : gridToTsv(display.map((i) => rows[i]), cols);
      await copyTextToClipboard(text);
      setCopied('copied');
    } catch {
      setCopied('error');
    }
    window.setTimeout(() => setCopied('idle'), 1500);
  }, [rows, display, selection, cols]);

  const scrollRowIntoView = useCallback((r: number) => {
    const el = bodyRef.current;
    if (!el) return;
    const headH = el.querySelector<HTMLElement>('thead')?.offsetHeight ?? rowHeight;
    const top = r * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight - headH) el.scrollTop = top + rowHeight - el.clientHeight + headH;
  }, [rowHeight]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!rows) return;
    // Typing in the filter box (or any control) must keep its native keys.
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'c' || e.key === 'C')) {
      if (selection) { e.preventDefault(); void copyGrid(); }
      return;
    }
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      replaceSelection({ r: 0, c: 0 }, { r: Math.max(0, total - 1), c: Math.max(0, cols - 1) });
      return;
    }
    if (e.key === 'Escape') { clearSelection(); return; }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const delta = arrows[e.key];
    if (!delta) return;
    e.preventDefault();
    const from = lastRange ? lastRange.focus : { r: 0, c: 0 };
    const next = {
      r: Math.min(Math.max(0, from.r + delta[0]), Math.max(0, total - 1)),
      c: Math.min(Math.max(0, from.c + delta[1]), Math.max(0, cols - 1)),
    };
    if (e.shiftKey && lastRange) extendLast(next);
    else replaceSelection(next, next);
    scrollRowIntoView(next.r);
  }, [rows, selection, copyGrid, replaceSelection, extendLast, clearSelection, total, cols, lastRange, scrollRowIntoView]);

  const rootClass = `spreadsheet-viewer ${className ?? ''}`;

  if (error) {
    return (
      <div className={rootClass}>
        <div className={`file-viewer-error spreadsheet-viewer-error${error.unsupported ? ' is-unsupported' : ''}`}>
          <Icon name={error.unsupported ? 'info' : 'warn'} size={16} aria-hidden />
          <span>
            {error.unsupported
              ? error.message
              : `${t('spreadsheetViewer.error', { defaultValue: 'Could not read spreadsheet' })}: ${error.message}`}
          </span>
        </div>
      </div>
    );
  }

  if (!data || !sheet || !rows) {
    return <div className={rootClass}><div className="file-viewer-loading">{t('spreadsheetViewer.loading', { defaultValue: 'Reading spreadsheet…' })}</div></div>;
  }

  const delimiterName = data.format === 'csv' || data.format === 'tsv' ? describeDelimiter(data.delimiter) : null;
  const shownRows = rows.length;
  const isEmpty = shownRows === 0 || cols === 0;
  const filtering = filter.trim() !== '';
  const colSelected = (c: number) => !!selection && selection.some((x) => x.c1 <= c && x.c2 >= c);
  const rowSelected = (r: number) => !!selection && selection.some((x) => x.r1 <= r && x.r2 >= r);
  const firstRange = selection ? selection[0] : null;

  return (
    <div className={rootClass} ref={rootRef} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="spreadsheet-head">
        <div className="spreadsheet-summary">
          <span className="spreadsheet-format-badge">{formatBadge(data)}</span>
          {data.sheets.length > 1 && (
            <span className="spreadsheet-summary-item">
              <Icon name="list-bullets" size={12} aria-hidden /> {t('spreadsheetViewer.sheetCount', { count: data.sheets.length, defaultValue: '{{count}} sheets' })}
            </span>
          )}
          <span className="spreadsheet-summary-item" title={t('spreadsheetViewer.extentTitle', { defaultValue: 'Rows × columns of this sheet' })}>
            <Icon name="grid" size={12} aria-hidden /> <b>{formatExtent(sheet.rowCount, sheet.colCount)}</b>
          </span>
          {delimiterName && (
            <span className="spreadsheet-summary-item spreadsheet-delimiter" title={t('spreadsheetViewer.delimiterTitle', { defaultValue: 'Detected delimiter' })}>
              {t(`spreadsheetViewer.delimiter.${delimiterName}`, { defaultValue: delimiterName })}
            </span>
          )}
          {(sheet.truncatedRows || sheet.truncatedCols) && (
            <span className="spreadsheet-summary-warn">
              <Icon name="warn" size={12} aria-hidden />
              {sheet.truncatedRows && (
                <span>{t('spreadsheetViewer.truncatedRows', { shown: shownRows.toLocaleString(), total: sheet.rowCount.toLocaleString(), defaultValue: 'showing {{shown}} of {{total}} rows' })}</span>
              )}
              {sheet.truncatedRows && sheet.truncatedCols && <span aria-hidden> · </span>}
              {sheet.truncatedCols && (
                <span>{t('spreadsheetViewer.truncatedCols', { shown: cols.toLocaleString(), total: sheet.colCount.toLocaleString(), defaultValue: '{{shown}} of {{total}} columns' })}</span>
              )}
              {sheet.truncatedRows && nextRowLimit && (
                <button
                  type="button"
                  className="spreadsheet-more-btn"
                  onClick={() => loadMoreRows(nextRowLimit)}
                  disabled={loading}
                >
                  {t('spreadsheetViewer.loadMore', { count: nextRowLimit, defaultValue: 'load up to {{count}} rows' })}
                </button>
              )}
            </span>
          )}
          <span className="spreadsheet-summary-spacer" />
          {!isEmpty && (
            <div className="spreadsheet-filter">
              <Icon name="search" size={12} aria-hidden />
              <input
                type="text"
                value={filter}
                onChange={(e) => { setFilterState({ key: sheetKey, text: e.target.value }); setSelState(null); }}
                placeholder={t('spreadsheetViewer.filterPlaceholder', { defaultValue: 'Filter rows…' })}
                spellCheck={false}
                aria-label={t('spreadsheetViewer.filterPlaceholder', { defaultValue: 'Filter rows…' })}
              />
              {filtering && (
                <>
                  <span className="spreadsheet-filter-count">{t('spreadsheetViewer.matches', { count: total, defaultValue: '{{count}} matches' })}</span>
                  <button type="button" className="spreadsheet-filter-clear" onClick={() => setFilterState({ key: sheetKey, text: '' })} title={t('spreadsheetViewer.clearFilter', { defaultValue: 'Clear' })}>
                    <Icon name="close" size={10} />
                  </button>
                </>
              )}
            </div>
          )}
          {!isEmpty && (
            <button
              type="button"
              className={`spreadsheet-copy-btn is-${copied}`}
              onClick={copyGrid}
              title={selection
                ? t('spreadsheetViewer.copySelectionTitle', { defaultValue: 'Copy the selected cells as tab-separated text (Ctrl/Cmd+C)' })
                : t('spreadsheetViewer.copyTsvTitle', { defaultValue: 'Copy the visible grid as tab-separated text' })}
            >
              <Icon name={copied === 'copied' ? 'check' : 'copy'} size={12} aria-hidden />
              <span>{copied === 'copied'
                ? t('spreadsheetViewer.copied', { defaultValue: 'Copied' })
                : selection
                  ? t('spreadsheetViewer.copySelection', { defaultValue: 'Copy selection' })
                  : t('spreadsheetViewer.copyTsv', { defaultValue: 'Copy TSV' })}</span>
            </button>
          )}
        </div>

        {data.sheets.length > 1 && (
          <div className="spreadsheet-tabs" role="tablist" aria-label={t('spreadsheetViewer.sheets', { defaultValue: 'Sheets' })}>
            {data.sheets.map((s, i) => (
              <button
                key={`${i}-${s.name}`}
                type="button"
                role="tab"
                aria-selected={i === data.sheetIndex}
                className={`spreadsheet-tab${i === data.sheetIndex ? ' is-active' : ''}${s.hidden ? ' is-hidden-sheet' : ''}`}
                onClick={() => selectSheet(i)}
                title={s.hidden ? t('spreadsheetViewer.hiddenSheet', { name: s.name, defaultValue: '{{name}} (hidden sheet)' }) : s.name}
              >
                {s.hidden && <Icon name="eye-closed" size={11} aria-hidden />}
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`spreadsheet-body${loading ? ' is-loading' : ''}`} ref={bodyRef} onScroll={onScroll}>
        {isEmpty ? (
          <div className="spreadsheet-empty">{t('spreadsheetViewer.empty', { defaultValue: 'Empty sheet' })}</div>
        ) : total === 0 ? (
          <div className="spreadsheet-empty">{t('spreadsheetViewer.noMatches', { defaultValue: 'No rows match the filter' })}</div>
        ) : (
          <table className="spreadsheet-table" style={{ width: totalWidth }} aria-label={`${filename} — ${sheet.name}`}>
            <colgroup>
              <col style={{ width: ROW_HEAD_WIDTH }} />
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                <th
                  className="spreadsheet-corner"
                  scope="col"
                  title={t('spreadsheetViewer.selectAll', { defaultValue: 'Select all' })}
                  onClick={() => replaceSelection({ r: 0, c: 0 }, { r: Math.max(0, total - 1), c: Math.max(0, cols - 1) })}
                />
                {columnLabels.map((label, c) => (
                  <th
                    key={label}
                    scope="col"
                    className={`spreadsheet-col-head${colSelected(c) ? ' is-selected' : ''}${sort?.col === c ? ` is-sorted-${sort.dir}` : ''}`}
                    onClick={(e) => selectColumn(c, e)}
                    title={t('spreadsheetViewer.selectColumn', { label, defaultValue: 'Select column {{label}}' })}
                  >
                    <span className="spreadsheet-col-label">{label}</span>
                    <button
                      type="button"
                      className="spreadsheet-sort-btn"
                      onClick={(e) => { e.stopPropagation(); toggleSort(c); }}
                      title={t('spreadsheetViewer.sortColumn', { defaultValue: 'Sort by this column' })}
                      aria-label={t('spreadsheetViewer.sortColumn', { defaultValue: 'Sort by this column' })}
                    >
                      <Icon name={sort?.col === c ? (sort.dir === 'asc' ? 'caret-up' : 'caret-down') : 'arrows-vertical'} size={10} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topPad > 0 && <tr className="spreadsheet-spacer" aria-hidden><td colSpan={cols + 1} style={{ height: topPad }} /></tr>}
              {display.slice(firstVisible, lastVisible).map((srcIndex, i) => {
                const r = firstVisible + i;
                const row = rows[srcIndex];
                const rowSel = rowSelected(r);
                return (
                  <tr key={srcIndex} data-row={srcIndex} className={rowSel ? 'is-row-selected' : undefined}>
                    <th
                      scope="row"
                      className={`spreadsheet-row-head${rowSel ? ' is-selected' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); selectRow(r, e); }}
                      title={t('spreadsheetViewer.selectRow', { n: srcIndex + 1, defaultValue: 'Select row {{n}}' })}
                    >
                      {srcIndex + 1}
                    </th>
                    {columnLabels.map((_, c) => {
                      const v = row[c] ?? '';
                      const inSel = !!selection && rangesContain(selection, r, c);
                      return (
                        <td
                          key={c}
                          className={`spreadsheet-cell${v !== '' && isNumericCell(v) ? ' is-number' : ''}${inSel ? ' is-selected' : ''}`}
                          title={v.length > 24 || v.includes('\n') ? v : undefined}
                          onMouseDown={(e) => onCellMouseDown(e, r, c)}
                          onMouseEnter={() => onCellMouseEnter(r, c)}
                        >
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {bottomPad > 0 && <tr className="spreadsheet-spacer" aria-hidden><td colSpan={cols + 1} style={{ height: bottomPad }} /></tr>}
            </tbody>
          </table>
        )}
      </div>

      <div className="spreadsheet-status" aria-live="polite">
        {stats && selection && firstRange ? (
          <>
            <span className="spreadsheet-status-range">
              {columnLabel(firstRange.c1)}{(display[firstRange.r1] ?? 0) + 1}
              {(firstRange.r1 !== firstRange.r2 || firstRange.c1 !== firstRange.c2) && `:${columnLabel(firstRange.c2)}${(display[firstRange.r2] ?? 0) + 1}`}
              {selection.length > 1 && <span className="spreadsheet-stat-dim"> +{selection.length - 1}</span>}
            </span>
            <span className="spreadsheet-stat"><span className="spreadsheet-stat-label">{t('spreadsheetViewer.stat.count', { defaultValue: 'Count' })}</span><b>{stats.nonEmpty.toLocaleString()}</b>{stats.nonEmpty !== stats.cells && <span className="spreadsheet-stat-dim">/{stats.cells.toLocaleString()}</span>}</span>
            {stats.numbers > 0 && (
              <>
                <span className="spreadsheet-stat"><span className="spreadsheet-stat-label">{t('spreadsheetViewer.stat.numbers', { defaultValue: 'Numbers' })}</span><b>{stats.numbers.toLocaleString()}</b></span>
                <span className="spreadsheet-stat spreadsheet-stat--sum"><span className="spreadsheet-stat-label">{t('spreadsheetViewer.stat.sum', { defaultValue: 'Sum' })}</span><b>{formatStat(stats.sum, stats.allPercent)}</b></span>
                <span className="spreadsheet-stat"><span className="spreadsheet-stat-label">{t('spreadsheetViewer.stat.avg', { defaultValue: 'Avg' })}</span><b>{formatStat(stats.avg, stats.allPercent)}</b></span>
                <span className="spreadsheet-stat"><span className="spreadsheet-stat-label">{t('spreadsheetViewer.stat.min', { defaultValue: 'Min' })}</span><b>{formatStat(stats.min, stats.allPercent)}</b></span>
                <span className="spreadsheet-stat"><span className="spreadsheet-stat-label">{t('spreadsheetViewer.stat.max', { defaultValue: 'Max' })}</span><b>{formatStat(stats.max, stats.allPercent)}</b></span>
              </>
            )}
            <span className="spreadsheet-summary-spacer" />
            <button type="button" className="spreadsheet-status-clear" onClick={clearSelection} title={t('spreadsheetViewer.clearSelection', { defaultValue: 'Clear selection' })}>
              <Icon name="close" size={10} />
            </button>
          </>
        ) : (
          <span className="spreadsheet-status-hint">
            {isEmpty
              ? ''
              : t('spreadsheetViewer.hint', { defaultValue: 'Click a cell, drag a range, Ctrl/Cmd+click to add more, or click a column/row header — count · sum · avg · min · max' })}
          </span>
        )}
      </div>
    </div>
  );
}
