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
  // C / C++ / C#
  c: () => import('prismjs/components/prism-c'),
  cpp: () => import('prismjs/components/prism-c').then(() => import('prismjs/components/prism-cpp')),
  csharp: () => import('prismjs/components/prism-csharp'),
  objectivec: () => import('prismjs/components/prism-objectivec'),
  d: () => import('prismjs/components/prism-d'),
  zig: () => import('prismjs/components/prism-zig'),

  // JVM
  java: () => import('prismjs/components/prism-java'),
  kotlin: () => import('prismjs/components/prism-kotlin'),
  scala: () => import('prismjs/components/prism-scala'),
  groovy: () => import('prismjs/components/prism-groovy'),
  clojure: () => import('prismjs/components/prism-clojure'),

  // Scripting
  ruby: () => import('prismjs/components/prism-ruby'),
  php: () => import('prismjs/components/prism-markup-templating').then(() => import('prismjs/components/prism-php')),
  lua: () => import('prismjs/components/prism-lua'),
  perl: () => import('prismjs/components/prism-perl'),
  r: () => import('prismjs/components/prism-r'),
  julia: () => import('prismjs/components/prism-julia'),
  dart: () => import('prismjs/components/prism-dart'),

  // Functional
  haskell: () => import('prismjs/components/prism-haskell'),
  elixir: () => import('prismjs/components/prism-elixir'),
  erlang: () => import('prismjs/components/prism-erlang'),
  fsharp: () => import('prismjs/components/prism-fsharp'),
  ocaml: () => import('prismjs/components/prism-ocaml'),
  rescript: () => import('prismjs/components/prism-rescript'),
  elm: () => import('prismjs/components/prism-elm'),

  // CSS preprocessors
  scss: () => import('prismjs/components/prism-scss'),
  sass: () => import('prismjs/components/prism-sass'),
  less: () => import('prismjs/components/prism-less'),
  stylus: () => import('prismjs/components/prism-stylus'),

  // Shell / batch / PowerShell
  powershell: () => import('prismjs/components/prism-powershell'),
  batch: () => import('prismjs/components/prism-batch'),

  // .NET
  'visual-basic': () => import('prismjs/components/prism-visual-basic'),

  // Data / config
  toml: () => import('prismjs/components/prism-toml'),
  ini: () => import('prismjs/components/prism-ini'),
  properties: () => import('prismjs/components/prism-properties'),
  hcl: () => import('prismjs/components/prism-hcl'),
  cmake: () => import('prismjs/components/prism-cmake'),

  // Docs / markup
  rest: () => import('prismjs/components/prism-rest'),
  asciidoc: () => import('prismjs/components/prism-asciidoc'),
  latex: () => import('prismjs/components/prism-latex'),

  // IDL / protocol
  graphql: () => import('prismjs/components/prism-graphql'),
  protobuf: () => import('prismjs/components/prism-protobuf'),

  // Systems / low-level
  nasm: () => import('prismjs/components/prism-nasm'),
  wasm: () => import('prismjs/components/prism-wasm'),
  fortran: () => import('prismjs/components/prism-fortran'),
  cobol: () => import('prismjs/components/prism-cobol'),
  pascal: () => import('prismjs/components/prism-pascal'),

  // Build tools / infra
  docker: () => import('prismjs/components/prism-docker'),
  nginx: () => import('prismjs/components/prism-nginx'),
  makefile: () => import('prismjs/components/prism-makefile'),

  // Misc
  swift: () => import('prismjs/components/prism-swift'),
  solidity: () => import('prismjs/components/prism-solidity'),
  nix: () => import('prismjs/components/prism-nix'),
  tcl: () => import('prismjs/components/prism-tcl'),
  awk: () => import('prismjs/components/prism-awk'),
  vim: () => import('prismjs/components/prism-vim'),
  diff: () => import('prismjs/components/prism-diff'),
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
