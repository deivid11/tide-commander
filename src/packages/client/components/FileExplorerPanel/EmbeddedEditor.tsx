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
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';
import { rust } from '@codemirror/lang-rust';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { php } from '@codemirror/lang-php';
import type { Extension } from '@codemirror/state';
import './EmbeddedEditor.scss';

const AUTO_SAVE_DELAY = 1000; // ms after last keystroke

interface EmbeddedEditorProps {
  content: string;
  extension: string;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Map file extension to CodeMirror language extension.
 *
 * Only extensions whose languages are covered by an installed
 * @codemirror/lang-* package are listed here.
 */
function getLanguageExtension(ext: string): Extension | null {
  const e = ext.toLowerCase();
  switch (e) {
    // JavaScript
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.es':
    case '.es6':
      return javascript();
    case '.jsx':
      return javascript({ jsx: true });

    // TypeScript
    case '.ts':
    case '.mts':
    case '.cts':
      return javascript({ typescript: true });
    case '.tsx':
      return javascript({ jsx: true, typescript: true });

    // Python
    case '.py':
    case '.pyw':
    case '.pyi':
    case '.pyx':
    case '.pxd':
      return python();

    // HTML / templating
    case '.html':
    case '.htm':
    case '.xhtml':
    case '.shtml':
    case '.svelte':
    case '.vue':
    case '.ejs':
    case '.hbs':
    case '.njk':
    case '.jsp':
    case '.erb':
      return html();

    // CSS / preprocessors
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return css();

    // JSON
    case '.json':
    case '.jsonc':
    case '.json5':
    case '.jsonl':
    case '.geojson':
    case '.webmanifest':
      return json();

    // Markdown
    case '.md':
    case '.mdx':
    case '.markdown':
    case '.mdown':
    case '.mkd':
      return markdown();

    // SQL
    case '.sql':
    case '.psql':
    case '.mysql':
    case '.plsql':
      return sql();

    // Rust
    case '.rs':
      return rust();

    // JVM languages (Java syntax highlighting)
    case '.java':
    case '.kt':
    case '.kts':
    case '.groovy':
    case '.gradle':
    case '.scala':
      return java();

    // C / C++ / C-family
    case '.c':
    case '.h':
    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.hpp':
    case '.hxx':
    case '.hh':
    case '.cs':
    case '.m':
    case '.mm':
    case '.ino':
      return cpp();

    // XML / schemas
    case '.xml':
    case '.xsl':
    case '.xslt':
    case '.xsd':
    case '.dtd':
    case '.svg':
    case '.plist':
    case '.rss':
    case '.atom':
    case '.wsdl':
    case '.xaml':
    case '.csproj':
    case '.fsproj':
    case '.vbproj':
      return xml();

    // YAML
    case '.yaml':
    case '.yml':
      return yaml();

    // PHP
    case '.php':
    case '.phtml':
    case '.php3':
    case '.php4':
    case '.php5':
      return php();

    default:
      return null;
  }
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
