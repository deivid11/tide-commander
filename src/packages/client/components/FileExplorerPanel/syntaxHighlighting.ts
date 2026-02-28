/**
 * Syntax highlighting utilities for FileExplorerPanel
 *
 * Centralizes Prism.js imports and highlighting logic.
 */

import Prism from 'prismjs';

// Import Prism language components
// NOTE: Import order matters! Base languages must come before those that extend them.

// Base language (required by many others)
import 'prismjs/components/prism-clike';

// Languages that extend clike (must come after clike)
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-groovy';
import 'prismjs/components/prism-ruby';

// Languages that extend other languages (must come after their parents)
import 'prismjs/components/prism-typescript'; // extends javascript
import 'prismjs/components/prism-jsx'; // extends javascript
import 'prismjs/components/prism-tsx'; // extends jsx/typescript
import 'prismjs/components/prism-cpp'; // extends c
import 'prismjs/components/prism-scala'; // extends java

// Markup and templating (required by PHP and other templating languages)
import 'prismjs/components/prism-markup-templating';

// Languages that need markup-templating
import 'prismjs/components/prism-php'; // requires markup-templating

// Independent languages (no dependencies)
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-haskell';
import 'prismjs/components/prism-elixir';
import 'prismjs/components/prism-erlang';
import 'prismjs/components/prism-clojure';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-vim';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-makefile';

import { EXTENSION_TO_LANGUAGE } from './constants';

/**
 * Highlight a code element using Prism.js
 */
export function highlightElement(element: HTMLElement): void {
  Prism.highlightElement(element);
}

/**
 * Get the Prism language for a file extension
 */
export function getLanguageForExtension(extension: string): string {
  return EXTENSION_TO_LANGUAGE[extension] || 'plaintext';
}

/**
 * Check if Prism supports a given language
 */
export function isLanguageSupported(language: string): boolean {
  return language in Prism.languages;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Highlight a code string using Prism.js.
 * Returns an HTML string safe for dangerouslySetInnerHTML.
 * Falls back to HTML-escaped plain text if the language is unsupported.
 */
export function highlightCode(code: string, language: string): string {
  if (!code) return '';
  const grammar = Prism.languages[language];
  if (!grammar) return escapeHtml(code);
  try {
    return Prism.highlight(code, grammar, language);
  } catch {
    return escapeHtml(code);
  }
}

// Re-export Prism for direct usage if needed
export { Prism };
