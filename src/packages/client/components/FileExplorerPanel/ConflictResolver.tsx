/**
 * ConflictResolver - Git merge conflict resolution component
 *
 * Parses conflict markers from a merged file and lets users accept
 * "current" (ours) or "incoming" (theirs) changes per conflict section.
 */

import React, { memo, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// TYPES
// ============================================================================

interface ConflictResolverProps {
  file: string;
  versions: { ours: string; theirs: string; merged: string; filename: string } | null;
  loading: boolean;
  onResolve: (content: string) => Promise<void>;
  onClose: () => void;
  currentBranch: string;
  mergingBranch: string;
}

type Section =
  | { type: 'unchanged'; content: string }
  | { type: 'conflict'; ours: string; theirs: string; resolved: 'ours' | 'theirs' | null };

// ============================================================================
// CONFLICT MARKER PARSING
// ============================================================================

function parseConflicts(merged: string): Section[] {
  const sections: Section[] = [];
  const lines = merged.split('\n');
  let currentUnchanged: string[] = [];
  let inConflict = false;
  let currentOurs: string[] = [];
  let currentTheirs: string[] = [];
  let inTheirs = false;

  for (const line of lines) {
    if (line.startsWith('<<<<<<<')) {
      if (currentUnchanged.length > 0) {
        sections.push({ type: 'unchanged', content: currentUnchanged.join('\n') });
        currentUnchanged = [];
      }
      inConflict = true;
      inTheirs = false;
      currentOurs = [];
      currentTheirs = [];
    } else if (line.startsWith('=======') && inConflict) {
      inTheirs = true;
    } else if (line.startsWith('>>>>>>>') && inConflict) {
      sections.push({ type: 'conflict', ours: currentOurs.join('\n'), theirs: currentTheirs.join('\n'), resolved: null });
      inConflict = false;
      inTheirs = false;
    } else if (inConflict) {
      if (inTheirs) {
        currentTheirs.push(line);
      } else {
        currentOurs.push(line);
      }
    } else {
      currentUnchanged.push(line);
    }
  }

  if (currentUnchanged.length > 0) {
    sections.push({ type: 'unchanged', content: currentUnchanged.join('\n') });
  }

  return sections;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ConflictResolver = memo(function ConflictResolver({
  file: _file,
  versions,
  loading,
  onResolve,
  onClose,
  currentBranch,
  mergingBranch,
}: ConflictResolverProps) {
  const { t } = useTranslation(['terminal']);
  const initialSections = useMemo(() => {
    if (!versions?.merged) return [];
    return parseConflicts(versions.merged);
  }, [versions?.merged]);

  const [sections, setSections] = useState<Section[]>(initialSections);
  const [isSaving, setIsSaving] = useState(false);

  // Re-initialize sections when versions change
  useMemo(() => {
    setSections(initialSections);
  }, [initialSections]);

  const allResolved = useMemo(() => {
    const conflictSections = sections.filter((s): s is Extract<Section, { type: 'conflict' }> => s.type === 'conflict');
    return conflictSections.length > 0 && conflictSections.every((s) => s.resolved !== null);
  }, [sections]);

  const handleResolveSection = useCallback((idx: number, choice: 'ours' | 'theirs') => {
    setSections((prev) =>
      prev.map((section, i) => {
        if (i !== idx || section.type !== 'conflict') return section;
        return { ...section, resolved: choice };
      }),
    );
  }, []);

  const handleAcceptAll = useCallback((choice: 'ours' | 'theirs') => {
    setSections((prev) =>
      prev.map((section) => {
        if (section.type !== 'conflict') return section;
        return { ...section, resolved: choice };
      }),
    );
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const resolvedContent = sections
        .map((section) => {
          if (section.type === 'unchanged') {
            return section.content;
          }
          // conflict section
          if (section.resolved === 'ours') {
            return section.ours;
          }
          if (section.resolved === 'theirs') {
            return section.theirs;
          }
          // Unresolved - keep original markers
          return `<<<<<<< ${currentBranch}\n${section.ours}\n=======\n${section.theirs}\n>>>>>>> ${mergingBranch}`;
        })
        .join('\n');

      await onResolve(resolvedContent);
    } finally {
      setIsSaving(false);
    }
  }, [sections, onResolve, currentBranch, mergingBranch]);

  return (
    <div className="conflict-resolver">
      {/* Header */}
      <div className="conflict-header">
        <span className="conflict-header-title">
          {t('terminal:fileExplorer.resolveFile', { filename: versions?.filename })}
        </span>
        <button className="conflict-close-btn" onClick={onClose}>×</button>
      </div>

      {loading || !versions ? (
        <div className="conflict-loading">{t('terminal:fileExplorer.loadingConflictData')}</div>
      ) : (
        <>
          {/* Column Headers */}
          <div className="conflict-pane-headers">
            <div className="conflict-pane-header current">{t('terminal:fileExplorer.currentBranchLabel', { branch: currentBranch })}</div>
            <div className="conflict-pane-header incoming">{t('terminal:fileExplorer.incomingBranchLabel', { branch: mergingBranch })}</div>
          </div>

          {/* Content */}
          <div className="conflict-content">
            {sections.map((section, idx) => {
              if (section.type === 'unchanged') {
                return (
                  <div key={idx} className="conflict-section-unchanged">
                    <pre>{section.content}</pre>
                  </div>
                );
              }
              // conflict section
              return (
                <div key={idx} className={`conflict-section-conflict ${section.resolved ? 'resolved' : ''}`}>
                  <div className="conflict-panes">
                    <div className={`conflict-pane ours ${section.resolved === 'ours' ? 'accepted' : ''}`}>
                      <pre>{section.ours}</pre>
                      <button
                        className="conflict-accept-btn ours"
                        onClick={() => handleResolveSection(idx, 'ours')}
                        disabled={section.resolved === 'ours'}
                      >
                        {section.resolved === 'ours' ? t('terminal:fileExplorer.accepted') : t('terminal:fileExplorer.acceptCurrent')}
                      </button>
                    </div>
                    <div className={`conflict-pane theirs ${section.resolved === 'theirs' ? 'accepted' : ''}`}>
                      <pre>{section.theirs}</pre>
                      <button
                        className="conflict-accept-btn theirs"
                        onClick={() => handleResolveSection(idx, 'theirs')}
                        disabled={section.resolved === 'theirs'}
                      >
                        {section.resolved === 'theirs' ? t('terminal:fileExplorer.accepted') : t('terminal:fileExplorer.acceptIncoming')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="conflict-actions">
            <button className="conflict-action-btn accept-all-current" onClick={() => handleAcceptAll('ours')}>
              {t('terminal:fileExplorer.acceptAllCurrent')}
            </button>
            <button className="conflict-action-btn accept-all-incoming" onClick={() => handleAcceptAll('theirs')}>
              {t('terminal:fileExplorer.acceptAllIncoming')}
            </button>
            <button
              className="conflict-action-btn save-resolved"
              onClick={handleSave}
              disabled={!allResolved || isSaving}
            >
              {isSaving ? t('terminal:fileExplorer.saving') : t('terminal:fileExplorer.saveAndResolve')}
            </button>
          </div>
        </>
      )}
    </div>
  );
});
