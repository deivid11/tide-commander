/**
 * Syntax highlighting utilities for FileExplorerPanel
 *
 * Centralizes Prism.js imports and highlighting logic.
 */

import Prism from 'prismjs';

// Import Prism language components
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-docker';

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

// Re-export Prism for direct usage if needed
export { Prism };
