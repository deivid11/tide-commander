import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveAgentFilePath } from '../../utils/filePaths';
import { apiUrl } from '../../utils/storage';

const StlViewer = React.lazy(async () => {
  const module = await import('../shared/StlViewer');
  return { default: module.StlViewer };
});

const FcStdViewer = React.lazy(async () => {
  const module = await import('../shared/FcStdViewer');
  return { default: module.FcStdViewer };
});

interface InlineModelPreviewProps {
  fileRef: string;
  label?: string;
  baseDir?: string;
  onFileClick?: (path: string) => void;
}

/**
 * Inline 3D card for standalone STL/FCStd Markdown references. The actual
 * WebGL viewer is mounted only while the card is near the viewport so long
 * terminal histories do not create dozens of WebGL contexts at once.
 */
export function InlineModelPreview({ fileRef, label, baseDir, onFileClick }: InlineModelPreviewProps) {
  const { t } = useTranslation('terminal');
  const rootRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const resolvedPath = useMemo(() => resolveAgentFilePath(fileRef, baseDir), [fileRef, baseDir]);
  const [selectedPath, setSelectedPath] = useState(resolvedPath);
  const filename = selectedPath.split('/').filter(Boolean).pop() || label || fileRef;
  const isFcStd = /\.fcstd$/i.test(selectedPath);
  const baseDirParam = baseDir ? `&baseDir=${encodeURIComponent(baseDir)}` : '';
  const viewerUrl = apiUrl(`/api/files/binary?path=${encodeURIComponent(selectedPath)}${baseDirParam}`);

  useEffect(() => setSelectedPath(resolvedPath), [resolvedPath]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin: '500px 0px' },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="markdown-model-preview"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="markdown-model-preview-header">
        <span className="markdown-model-preview-kind">{isFcStd ? 'FreeCAD · 3D' : 'STL · 3D'}</span>
        <span className="markdown-model-preview-name" title={selectedPath}>{selectedPath === resolvedPath ? (label || filename) : filename}</span>
        {onFileClick && (
          <button type="button" onClick={() => onFileClick(selectedPath)} title={t('content.open3dInViewer')}>
            {t('content.open3dInViewer')}
          </button>
        )}
      </div>
      <div className="markdown-model-preview-stage">
        {nearViewport ? (
          <Suspense fallback={<div className="markdown-model-preview-placeholder">{t('fileViewerModal.loading3d')}</div>}>
            {isFcStd
              ? <FcStdViewer key={selectedPath} url={viewerUrl} filename={filename} filePath={selectedPath} onFileSelect={setSelectedPath} />
              : <StlViewer key={selectedPath} url={viewerUrl} filename={filename} filePath={selectedPath} onFileSelect={setSelectedPath} />}
          </Suspense>
        ) : (
          <div className="markdown-model-preview-placeholder">{t('content.scrollToLoad3d')}</div>
        )}
      </div>
    </div>
  );
}
