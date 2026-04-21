/**
 * Syntax highlighting utilities for FileExplorerPanel
 *
 * Centralizes Prism.js imports and highlighting logic.
 * Core languages are loaded eagerly; rare languages are loaded on-demand.
 */

import Prism from 'prismjs';

// Import Prism language components
// NOTE: Import order matters! Base languages must come before those that extend them.

// Base language (required by many others)
import 'prismjs/components/prism-clike';

// Core languages loaded eagerly (most commonly used)
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript'; // extends javascript
import 'prismjs/components/prism-jsx'; // extends javascript
import 'prismjs/components/prism-tsx'; // extends jsx/typescript
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';

import { EXTENSION_TO_LANGUAGE } from './constants';

// On-demand language loaders — imported only when first needed
const LAZY_LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  c: () => import('prismjs/components/prism-c'),
  cpp: () => import('prismjs/components/prism-c').then(() => import('prismjs/components/prism-cpp')),
  scala: () => import('prismjs/components/prism-scala'),
  csharp: () => import('prismjs/components/prism-csharp'),
  kotlin: () => import('prismjs/components/prism-kotlin'),
  groovy: () => import('prismjs/components/prism-groovy'),
  ruby: () => import('prismjs/components/prism-ruby'),
  scss: () => import('prismjs/components/prism-scss'),
  toml: () => import('prismjs/components/prism-toml'),
  docker: () => import('prismjs/components/prism-docker'),
  swift: () => import('prismjs/components/prism-swift'),
  lua: () => import('prismjs/components/prism-lua'),
  perl: () => import('prismjs/components/prism-perl'),
  r: () => import('prismjs/components/prism-r'),
  haskell: () => import('prismjs/components/prism-haskell'),
  elixir: () => import('prismjs/components/prism-elixir'),
  erlang: () => import('prismjs/components/prism-erlang'),
  clojure: () => import('prismjs/components/prism-clojure'),
  graphql: () => import('prismjs/components/prism-graphql'),
  nginx: () => import('prismjs/components/prism-nginx'),
  vim: () => import('prismjs/components/prism-vim'),
  diff: () => import('prismjs/components/prism-diff'),
  ini: () => import('prismjs/components/prism-ini'),
  powershell: () => import('prismjs/components/prism-powershell'),
  makefile: () => import('prismjs/components/prism-makefile'),
};

// Track in-flight loads to avoid duplicate imports
const loadingLanguages = new Map<string, Promise<unknown>>();

/**
 * Ensure a Prism language is loaded. Returns immediately if already available.
 */
export async function ensureLanguageLoaded(language: string): Promise<boolean> {
  if (language in Prism.languages) return true;

  const loader = LAZY_LANGUAGE_LOADERS[language];
  if (!loader) return false;

  let promise = loadingLanguages.get(language);
  if (!promise) {
    promise = loader();
    loadingLanguages.set(language, promise);
  }
  try {
    await promise;
    return language in Prism.languages;
  } catch {
    return false;
  } finally {
    loadingLanguages.delete(language);
  }
}

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
