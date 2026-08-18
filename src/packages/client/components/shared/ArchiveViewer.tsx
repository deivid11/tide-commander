/**
 * ArchiveViewer — browsable listing of a compressed archive (zip / jar / apk /
 * tar.* / 7z / rar / …) for the file viewers. The server enumerates entries
 * without extracting (GET /api/files/archive); this renders them as a
 * collapsible tree with per-folder aggregate sizes, a filter box and a
 * summary bar (format · counts · uncompressed vs stored size · ratio).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { getFileIconFromPath } from '../Spotlight/utils';
import { apiUrl, authFetch } from '../../utils/storage';
import {
  AUTO_EXPAND_LIMIT,
  buildArchiveTree,
  collectArchiveDirPaths,
  countArchiveNodes,
  formatArchiveMtime,
  formatArchiveSize,
  type ArchiveListingDto,
  type ArchiveTreeNode,
} from './archiveTree';

export type { ArchiveEntryDto, ArchiveListingDto } from './archiveTree';

interface ArchiveViewerProps {
  /** Archive path (absolute, or relative to `baseDir`). */
  filePath: string;
  baseDir?: string;
  filename: string;
  className?: string;
}

export function ArchiveViewer({ filePath, baseDir, filename, className }: ArchiveViewerProps) {
  const { t } = useTranslation('terminal');
  const [data, setData] = useState<ArchiveListingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    const baseDirParam = baseDir ? `&baseDir=${encodeURIComponent(baseDir)}` : '';
    authFetch(apiUrl(`/api/files/archive?path=${encodeURIComponent(filePath)}${baseDirParam}`))
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body as ArchiveListingDto;
      })
      .then((listing) => {
        if (cancelled) return;
        setData(listing);
        const tree = buildArchiveTree(listing.entries);
        // Small archives open fully; big ones open the top level only.
        setExpanded(new Set(countArchiveNodes(tree) <= AUTO_EXPAND_LIMIT ? collectArchiveDirPaths(tree) : []));
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filePath, baseDir]);

  const tree = useMemo(() => (data ? buildArchiveTree(data.entries) : null), [data]);
  const hasCompressed = useMemo(() => !!data && data.entries.some((e) => e.compressedSize !== null && !e.isDir), [data]);
  const hasMtime = useMemo(() => !!data && data.entries.some((e) => !!e.mtime), [data]);
  const allDirs = useMemo(() => (tree ? collectArchiveDirPaths(tree) : []), [tree]);

  const toggle = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }, []);

  const filterLower = filter.trim().toLowerCase();
  const filteredFlat = useMemo(() => {
    if (!data || !filterLower) return null;
    return data.entries.filter((e) => e.path.toLowerCase().includes(filterLower));
  }, [data, filterLower]);

  if (loading) {
    return <div className={`archive-viewer ${className ?? ''}`}><div className="file-viewer-loading">{t('archiveViewer.loading', { defaultValue: 'Reading archive…' })}</div></div>;
  }
  if (error || !data || !tree) {
    return (
      <div className={`archive-viewer ${className ?? ''}`}>
        <div className="file-viewer-error archive-viewer-error">
          <Icon name="warn" size={16} aria-hidden />
          <span>{t('archiveViewer.error', { defaultValue: 'Could not list archive' })}: {error || 'unknown error'}</span>
        </div>
      </div>
    );
  }

  const ratio = data.totalSize && data.totalCompressed !== null && data.totalSize > 0
    ? Math.round((1 - data.totalCompressed / data.totalSize) * 100)
    : null;
  // Column layout class — the stylesheet maps it to the grid template and,
  // in narrow containers (phones, the guake side panel), drops the Modified
  // and Stored columns so the name column keeps its width.
  const colsClass = `cols-name-size${hasCompressed ? '-stored' : ''}${hasMtime ? '-mtime' : ''}`;

  const renderRow = (node: ArchiveTreeNode, depth: number, key: string, opts?: { flat?: boolean }): React.ReactNode => {
    const flat = !!opts?.flat;
    const interactive = node.isDir && !flat;
    const isOpen = interactive && expanded.has(node.path);
    return (
      <div
        key={key}
        className={`archive-row ${node.isDir ? 'is-dir' : 'is-file'}${isOpen ? ' is-open' : ''}${flat ? ' is-flat' : ''}`}
        style={{ ['--depth' as string]: depth }}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? () => toggle(node.path) : undefined}
        onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(node.path); } } : undefined}
        title={node.path}
      >
        <span className="archive-cell archive-cell-name">
          <span className="archive-indent" aria-hidden="true" />
          {node.isDir ? (
            <>
              {interactive && <span className="archive-caret"><Icon name={isOpen ? 'caret-down' : 'caret-right'} size={10} /></span>}
              <span className="archive-icon"><Icon name={isOpen ? 'folder-open' : 'folder'} size={14} /></span>
            </>
          ) : (
            <span className="archive-icon">{getFileIconFromPath(node.name, 14)}</span>
          )}
          <span className="archive-name">{flat ? node.path : node.name}{node.isDir ? '/' : ''}</span>
          {interactive && (
            <span className="archive-dir-count">{t('archiveViewer.fileCount', { count: node.fileCount, defaultValue: '{{count}} files' })}</span>
          )}
        </span>
        <span className="archive-cell archive-cell-size">{formatArchiveSize(node.size)}</span>
        {hasCompressed && (
          <span className="archive-cell archive-cell-size archive-cell-compressed">{node.isDir && node.compressedSize === 0 && node.fileCount === 0 ? '' : formatArchiveSize(node.compressedSize)}</span>
        )}
        {hasMtime && <span className="archive-cell archive-cell-mtime">{formatArchiveMtime(node.mtime)}</span>}
      </div>
    );
  };

  const renderTree = (node: ArchiveTreeNode, depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    for (const child of node.children) {
      rows.push(renderRow(child, depth, child.path));
      if (child.isDir && expanded.has(child.path)) rows.push(...renderTree(child, depth + 1));
    }
    return rows;
  };

  return (
    <div className={`archive-viewer ${colsClass} ${className ?? ''}`}>
      <div className="archive-head">
      <div className="archive-summary">
        <span className="archive-format-badge">{data.format.toUpperCase()}</span>
        <span className="archive-summary-item">
          <Icon name="file-text" size={12} aria-hidden /> {t('archiveViewer.summaryFiles', { count: data.fileCount, defaultValue: '{{count}} files' })}
        </span>
        <span className="archive-summary-item">
          <Icon name="folder" size={12} aria-hidden /> {t('archiveViewer.summaryDirs', { count: data.dirCount + Math.max(0, allDirs.length - data.dirCount), defaultValue: '{{count}} folders' })}
        </span>
        <span className="archive-summary-item" title={t('archiveViewer.uncompressedTitle', { defaultValue: 'Total uncompressed size' })}>
          {t('archiveViewer.uncompressed', { defaultValue: 'uncompressed' })} <b>{formatArchiveSize(data.totalSize)}</b>
        </span>
        <span className="archive-summary-item" title={t('archiveViewer.archiveSizeTitle', { defaultValue: 'Archive size on disk' })}>
          {t('archiveViewer.archive', { defaultValue: 'archive' })} <b>{formatArchiveSize(data.size)}</b>
          {ratio !== null && <span className="archive-ratio">−{ratio}%</span>}
        </span>
        <span className="archive-summary-tool" title={t('archiveViewer.toolTitle', { defaultValue: 'Listed by' })}>via {data.tool}</span>
        {data.truncated && (
          <span className="archive-summary-warn"><Icon name="warn" size={12} aria-hidden /> {t('archiveViewer.truncated', { count: data.entryCount, defaultValue: 'showing first {{count}} entries' })}</span>
        )}
      </div>

      <div className="archive-toolbar">
        <div className="archive-filter">
          <Icon name="search" size={12} aria-hidden />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('archiveViewer.filterPlaceholder', { defaultValue: 'Filter entries…' })}
            spellCheck={false}
          />
          {filter && (
            <button type="button" className="archive-filter-clear" onClick={() => setFilter('')} title={t('archiveViewer.clearFilter', { defaultValue: 'Clear' })}>
              <Icon name="close" size={10} />
            </button>
          )}
        </div>
        {!filterLower && allDirs.length > 0 && (
          <div className="archive-toolbar-actions">
            <button type="button" onClick={() => setExpanded(new Set(allDirs))}>{t('archiveViewer.expandAll', { defaultValue: 'Expand all' })}</button>
            <button type="button" onClick={() => setExpanded(new Set())}>{t('archiveViewer.collapseAll', { defaultValue: 'Collapse all' })}</button>
          </div>
        )}
        {filteredFlat && (
          <span className="archive-filter-count">{t('archiveViewer.matches', { count: filteredFlat.length, defaultValue: '{{count}} matches' })}</span>
        )}
      </div>

      <div className="archive-row archive-header-row" aria-hidden="true">
        <span className="archive-cell archive-cell-name">{t('archiveViewer.colName', { defaultValue: 'Name' })}</span>
        <span className="archive-cell archive-cell-size">{t('archiveViewer.colSize', { defaultValue: 'Size' })}</span>
        {hasCompressed && <span className="archive-cell archive-cell-size archive-cell-compressed">{t('archiveViewer.colStored', { defaultValue: 'Stored' })}</span>}
        {hasMtime && <span className="archive-cell archive-cell-mtime">{t('archiveViewer.colModified', { defaultValue: 'Modified' })}</span>}
      </div>
      </div>

      <div className="archive-body" role="tree" aria-label={filename}>
        {filteredFlat
          ? filteredFlat.length === 0
            ? <div className="archive-empty">{t('archiveViewer.noMatches', { defaultValue: 'No entries match' })}</div>
            : filteredFlat.map((e) => renderRow(
                { name: e.path, path: e.path, isDir: e.isDir, size: e.size, compressedSize: e.compressedSize, mtime: e.mtime, children: [], fileCount: 0 },
                0,
                `flat:${e.path}`,
                { flat: true },
              ))
          : tree.children.length === 0
            ? <div className="archive-empty">{t('archiveViewer.empty', { defaultValue: 'Empty archive' })}</div>
            : renderTree(tree, 0)}
      </div>
    </div>
  );
}

export default ArchiveViewer;
