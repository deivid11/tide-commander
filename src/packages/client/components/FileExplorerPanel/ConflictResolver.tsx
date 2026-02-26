/**
 * ConflictResolver - Git merge conflict resolution component
 *
 * Parses conflict markers from a merged file and lets users accept
 * "current" (ours) or "incoming" (theirs) changes per conflict section.
 */

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Prism, getLanguageForExtension } from './syntaxHighlighting';

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
  | { type: 'conflict'; ours: string; theirs: string; resolved: 'ours' | 'theirs' | 'both' | null };

// ============================================================================
// SYNTAX HIGHLIGHTING
// ============================================================================

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(code: string, language: string): string {
  if (!code) return '';
  const grammar = Prism.languages[language];
  if (!grammar) return escapeHtml(code);
  return Prism.highlight(code, grammar, language);
}

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

  const prismLang = useMemo(() => {
    if (!versions?.filename) return 'plaintext';
    const ext = '.' + versions.filename.split('.').pop()?.toLowerCase();
    return getLanguageForExtension(ext);
  }, [versions?.filename]);

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

  const contentRef = useRef<HTMLDivElement>(null);
  const [activeConflictIdx, setActiveConflictIdx] = useState(0);

  // Indices of conflict sections within the sections array
  const conflictIndices = useMemo(
    () => sections.map((s, i) => (s.type === 'conflict' ? i : -1)).filter((i) => i !== -1),
    [sections],
  );

  const totalConflicts = conflictIndices.length;

  const scrollToConflict = useCallback(
    (conflictNum: number) => {
      const container = contentRef.current;
      if (!container || conflictNum < 0 || conflictNum >= conflictIndices.length) return;
      const sectionIdx = conflictIndices[conflictNum];
      const el = container.querySelector(`[data-section-idx="${sectionIdx}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setActiveConflictIdx(conflictNum);
      }
    },
    [conflictIndices],
  );

  const handlePrevConflict = useCallback(() => {
    scrollToConflict(activeConflictIdx > 0 ? activeConflictIdx - 1 : conflictIndices.length - 1);
  }, [activeConflictIdx, conflictIndices.length, scrollToConflict]);

  const handleNextConflict = useCallback(() => {
    scrollToConflict(activeConflictIdx < conflictIndices.length - 1 ? activeConflictIdx + 1 : 0);
  }, [activeConflictIdx, conflictIndices.length, scrollToConflict]);

  // Auto-scroll to first conflict on load
  useEffect(() => {
    if (conflictIndices.length > 0 && contentRef.current) {
      // Small delay to let the DOM render
      const timer = setTimeout(() => scrollToConflict(0), 100);
      return () => clearTimeout(timer);
    }
  }, [conflictIndices.length, scrollToConflict]);

  const allResolved = useMemo(() => {
    const conflictSections = sections.filter((s): s is Extract<Section, { type: 'conflict' }> => s.type === 'conflict');
    return conflictSections.length > 0 && conflictSections.every((s) => s.resolved !== null);
  }, [sections]);

  const handleResolveSection = useCallback((idx: number, choice: 'ours' | 'theirs' | 'both') => {
    setSections((prev) =>
      prev.map((section, i) => {
        if (i !== idx || section.type !== 'conflict') return section;
        return { ...section, resolved: choice };
      }),
    );
  }, []);

  const handleAcceptAll = useCallback((choice: 'ours' | 'theirs' | 'both') => {
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
          if (section.resolved === 'both') {
            return section.ours + '\n' + section.theirs;
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
        {totalConflicts > 0 && (
          <div className="conflict-nav">
            <button className="conflict-nav-btn" onClick={handlePrevConflict} title={t('terminal:fileExplorer.prevConflict')}>
              ▲
            </button>
            <span className="conflict-nav-counter">
              {activeConflictIdx + 1} / {totalConflicts}
            </span>
            <button className="conflict-nav-btn" onClick={handleNextConflict} title={t('terminal:fileExplorer.nextConflict')}>
              ▼
            </button>
          </div>
        )}
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
          <div className="conflict-content" ref={contentRef}>
            {sections.map((section, idx) => {
              if (section.type === 'unchanged') {
                return (
                  <div key={idx} className="conflict-section-unchanged">
                    <div className="conflict-panes">
                      <div className="conflict-pane ours">
                        <pre dangerouslySetInnerHTML={{ __html: highlightCode(section.content, prismLang) }} />
                      </div>
                      <div className="conflict-pane theirs">
                        <pre dangerouslySetInnerHTML={{ __html: highlightCode(section.content, prismLang) }} />
                      </div>
                    </div>
                  </div>
                );
              }
              // conflict section
              return (
                <div key={idx} data-section-idx={idx} className={`conflict-section-conflict ${section.resolved ? 'resolved' : ''}`}>
                  <div className="conflict-panes">
                    <div className={`conflict-pane ours ${section.resolved === 'ours' || section.resolved === 'both' ? 'accepted' : ''}`}>
                      <pre dangerouslySetInnerHTML={{ __html: highlightCode(section.ours, prismLang) }} />
                      <button
                        className="conflict-accept-btn ours"
                        onClick={() => handleResolveSection(idx, 'ours')}
                        disabled={section.resolved === 'ours'}
                      >
                        {section.resolved === 'ours' ? t('terminal:fileExplorer.accepted') : t('terminal:fileExplorer.acceptCurrent')}
                      </button>
                    </div>
                    <div className={`conflict-pane theirs ${section.resolved === 'theirs' || section.resolved === 'both' ? 'accepted' : ''}`}>
                      <pre dangerouslySetInnerHTML={{ __html: highlightCode(section.theirs, prismLang) }} />
                      <button
                        className="conflict-accept-btn theirs"
                        onClick={() => handleResolveSection(idx, 'theirs')}
                        disabled={section.resolved === 'theirs'}
                      >
                        {section.resolved === 'theirs' ? t('terminal:fileExplorer.accepted') : t('terminal:fileExplorer.acceptIncoming')}
                      </button>
                    </div>
                  </div>
                  <button
                    className={`conflict-accept-both-btn ${section.resolved === 'both' ? 'accepted' : ''}`}
                    onClick={() => handleResolveSection(idx, 'both')}
                    disabled={section.resolved === 'both'}
                  >
                    {section.resolved === 'both' ? t('terminal:fileExplorer.accepted') : t('terminal:fileExplorer.acceptBoth')}
                  </button>
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
            <button className="conflict-action-btn accept-all-both" onClick={() => handleAcceptAll('both')}>
              {t('terminal:fileExplorer.acceptAllBoth')}
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
