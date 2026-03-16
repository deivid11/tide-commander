/**
 * EmbeddedEditor - CodeMirror 6 based file editor
 *
 * Provides in-app editing with syntax highlighting, line numbers,
 * auto-save on change (debounced), and Escape to exit.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import { getLanguageExtension } from './cm-languages';
import './EmbeddedEditor.scss';

const AUTO_SAVE_DELAY = 1000; // ms after last keystroke

interface EmbeddedEditorProps {
  content: string;
  extension: string;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}


export const EmbeddedEditor: React.FC<EmbeddedEditorProps> = ({
  content,
  extension,
  onSave,
  onCancel,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const doSave = useCallback(async () => {
    if (!viewRef.current || savingRef.current) return;
    savingRef.current = true;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const currentContent = viewRef.current.state.doc.toString();
      await onSaveRef.current(currentContent);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 1500);
    } catch (err: any) {
      setSaveStatus('error');
      setSaveError(err.message || 'Save failed');
    } finally {
      savingRef.current = false;
    }
  }, []);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      doSave();
    }, AUTO_SAVE_DELAY);
  }, [doSave]);

  const handleCancel = useCallback(() => {
    // Flush pending auto-save before closing
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      doSave();
    }
    onCancel();
  }, [onCancel, doSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current) return;

    const langExt = getLanguageExtension(extension);

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      foldGutter(),
      drawSelection(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      oneDark,
      EditorView.lineWrapping,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
        {
          key: 'Mod-s',
          run: () => {
            // Immediate save on Ctrl+S
            if (autoSaveTimerRef.current) {
              clearTimeout(autoSaveTimerRef.current);
              autoSaveTimerRef.current = null;
            }
            doSave();
            return true;
          },
        },
        {
          key: 'Escape',
          run: () => {
            handleCancel();
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          setSaveError(null);
          scheduleAutoSave();
        }
      }),
    ];

    if (langExt) {
      extensions.push(langExt);
    }

    const state = EditorState.create({
      doc: content,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    // Focus the editor
    requestAnimationFrame(() => view.focus());

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only re-create on mount
  }, []);

  return (
    <div className="embedded-editor">
      <div className="embedded-editor__toolbar">
        <div className="embedded-editor__toolbar-left">
          {saveStatus === 'saving' && <span className="embedded-editor__status embedded-editor__status--saving">Saving...</span>}
          {saveStatus === 'saved' && <span className="embedded-editor__status embedded-editor__status--saved">Saved</span>}
          {saveStatus === 'error' && <span className="embedded-editor__status embedded-editor__status--error">{saveError || 'Save failed'}</span>}
        </div>
        <div className="embedded-editor__toolbar-right">
          <span className="embedded-editor__shortcut-hint">Auto-saves &middot; Esc to close</span>
          <button
            className="embedded-editor__btn embedded-editor__btn--close"
            onClick={handleCancel}
          >
            Close
          </button>
        </div>
      </div>
      <div className="embedded-editor__container" ref={editorRef} />
    </div>
  );
};
