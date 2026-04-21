/**
 * Shared CodeMirror language extension resolver.
 *
 * Maps file extensions to the appropriate @codemirror/lang-* extension.
 * Used by both the read-only file viewer and the embedded editor.
 */

import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';

/**
 * Map file extension to CodeMirror language extension.
 *
 * Only extensions whose languages are covered by an installed
 * @codemirror/lang-* package are listed here.
 */
export function getLanguageExtension(ext: string): Extension | null {
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

    // JVM languages
    case '.kt':
    case '.kts':
    case '.groovy':
    case '.gradle':
    case '.scala':
      return cpp();

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

    default:
      return null;
  }
}
