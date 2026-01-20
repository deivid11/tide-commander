/**
 * FileViewer - File content viewer with syntax highlighting
 *
 * Displays file content with Prism.js syntax highlighting.
 * Following ClaudeOutputPanel's component decomposition pattern.
 */

import React, { useEffect, useRef, memo } from 'react';
import type { FileViewerProps } from './types';
import { formatFileSize } from './fileUtils';
import { highlightElement, getLanguageForExtension } from './syntaxHighlighting';

// ============================================================================
// FILE VIEWER COMPONENT
// ============================================================================

function FileViewerComponent({ file, loading, error }: FileViewerProps) {
  const codeRef = useRef<HTMLElement>(null);

  // Apply syntax highlighting when file changes
  useEffect(() => {
    if (file && codeRef.current) {
      highlightElement(codeRef.current);
    }
  }, [file]);

  // Loading state
  if (loading) {
    return <div className="file-viewer-placeholder">Loading...</div>;
  }

  // Error state
  if (error) {
    return <div className="file-viewer-placeholder error">{error}</div>;
  }

  // Empty state
  if (!file) {
    return (
      <div className="file-viewer-placeholder">
        <div className="placeholder-icon">📂</div>
        <div className="placeholder-text">Select a file to view</div>
      </div>
    );
  }

  const language = getLanguageForExtension(file.extension);

  return (
    <div className="file-viewer-content">
      <div className="file-viewer-header">
        <span className="file-viewer-filename">{file.filename}</span>
        <span className="file-viewer-meta">
          {formatFileSize(file.size)} • {language}
        </span>
      </div>
      <div className="file-viewer-code-wrapper">
        <pre className="file-viewer-pre">
          <code ref={codeRef} className={`language-${language}`}>
            {file.content}
          </code>
        </pre>
      </div>
    </div>
  );
}

/**
 * Memoized FileViewer component
 * Prevents unnecessary re-renders when file hasn't changed
 */
export const FileViewer = memo(FileViewerComponent, (prev, next) => {
  // Re-render only if file, loading, or error changed
  if (prev.loading !== next.loading) return false;
  if (prev.error !== next.error) return false;

  // Deep compare file object
  if (prev.file === null && next.file === null) return true;
  if (prev.file === null || next.file === null) return false;

  return (
    prev.file.path === next.file.path &&
    prev.file.content === next.file.content &&
    prev.file.modified === next.file.modified
  );
});

FileViewer.displayName = 'FileViewer';
