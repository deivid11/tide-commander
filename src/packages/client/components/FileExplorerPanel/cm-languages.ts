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
import { java } from '@codemirror/lang-java';
import { php } from '@codemirror/lang-php';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { kotlin, scala, dart } from '@codemirror/legacy-modes/mode/clike';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { go } from '@codemirror/legacy-modes/mode/go';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { r } from '@codemirror/legacy-modes/mode/r';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { d } from '@codemirror/legacy-modes/mode/d';
import { elm } from '@codemirror/legacy-modes/mode/elm';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { oCaml, fSharp } from '@codemirror/legacy-modes/mode/mllike';
import { vb } from '@codemirror/legacy-modes/mode/vb';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { pascal } from '@codemirror/legacy-modes/mode/pascal';
import { cobol } from '@codemirror/legacy-modes/mode/cobol';
import { fortran } from '@codemirror/legacy-modes/mode/fortran';
import { tcl } from '@codemirror/legacy-modes/mode/tcl';
import { sass } from '@codemirror/legacy-modes/mode/sass';
import { stylus } from '@codemirror/legacy-modes/mode/stylus';
import { wast } from '@codemirror/legacy-modes/mode/wast';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';
import { gas } from '@codemirror/legacy-modes/mode/gas';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl';
import { crystal } from '@codemirror/legacy-modes/mode/crystal';

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
    case '.astro':
    case '.ejs':
    case '.hbs':
    case '.njk':
    case '.jsp':
    case '.erb':
      return html();

    // CSS / preprocessors
    case '.css':
    case '.scss':
    case '.less':
      return css();

    // Sass (indented syntax)
    case '.sass':
      return StreamLanguage.define(sass);

    // Stylus
    case '.styl':
      return StreamLanguage.define(stylus);

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

    // Java
    case '.java':
      return java();

    // PHP
    case '.php':
    case '.phtml':
      return php();

    // JVM languages
    case '.kt':
    case '.kts':
      return StreamLanguage.define(kotlin);
    case '.groovy':
    case '.gradle':
      return StreamLanguage.define(groovy);
    case '.scala':
    case '.sc':
    case '.sbt':
      return StreamLanguage.define(scala);

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

    // D
    case '.d':
      return StreamLanguage.define(d);

    // Dart
    case '.dart':
      return StreamLanguage.define(dart);

    // Visual Basic / VB.NET
    case '.vb':
      return StreamLanguage.define(vb);

    // Go
    case '.go':
      return StreamLanguage.define(go);

    // Ruby
    case '.rb':
    case '.rbw':
    case '.rake':
    case '.gemspec':
      return StreamLanguage.define(ruby);

    // Swift
    case '.swift':
      return StreamLanguage.define(swift);

    // Shell scripting
    case '.sh':
    case '.bash':
    case '.zsh':
    case '.ksh':
    case '.fish':
    case '.env':
      return StreamLanguage.define(shell);

    // Windows batch
    case '.bat':
    case '.cmd':
      return StreamLanguage.define(shell);

    // TOML
    case '.toml':
      return StreamLanguage.define(toml);

    // Lua
    case '.lua':
      return StreamLanguage.define(lua);

    // Perl
    case '.pl':
    case '.pm':
      return StreamLanguage.define(perl);

    // R
    case '.r':
      return StreamLanguage.define(r);

    // Julia
    case '.jl':
      return StreamLanguage.define(julia);

    // Elm
    case '.elm':
      return StreamLanguage.define(elm);

    // OCaml / ReScript (shared ML-family grammar)
    case '.ml':
    case '.mli':
    case '.res':
    case '.resi':
      return StreamLanguage.define(oCaml);

    // F#
    case '.fs':
    case '.fsi':
    case '.fsx':
      return StreamLanguage.define(fSharp);

    // Haskell
    case '.hs':
    case '.lhs':
      return StreamLanguage.define(haskell);

    // Clojure
    case '.clj':
    case '.cljs':
    case '.cljc':
    case '.edn':
      return StreamLanguage.define(clojure);

    // Erlang
    case '.erl':
    case '.hrl':
      return StreamLanguage.define(erlang);

    // Crystal
    case '.cr':
      return StreamLanguage.define(crystal);

    // Dockerfile
    case '.dockerfile':
      return StreamLanguage.define(dockerFile);

    // Diff / patch
    case '.diff':
    case '.patch':
      return StreamLanguage.define(diff);

    // PowerShell
    case '.ps1':
    case '.psm1':
    case '.psd1':
      return StreamLanguage.define(powerShell);

    // Nginx
    case '.nginx':
      return StreamLanguage.define(nginx);

    // Properties / INI-like
    case '.properties':
      return StreamLanguage.define(properties);

    // CMake
    case '.cmake':
      return StreamLanguage.define(cmake);

    // Pascal
    case '.pas':
    case '.pp':
      return StreamLanguage.define(pascal);

    // COBOL
    case '.cbl':
    case '.cob':
      return StreamLanguage.define(cobol);

    // Fortran
    case '.f':
    case '.for':
    case '.f77':
    case '.f90':
    case '.f95':
    case '.f03':
    case '.f08':
      return StreamLanguage.define(fortran);

    // Tcl
    case '.tcl':
      return StreamLanguage.define(tcl);

    // WebAssembly text format
    case '.wat':
    case '.wasm':
      return StreamLanguage.define(wast);

    // LaTeX
    case '.tex':
    case '.latex':
    case '.ltx':
      return StreamLanguage.define(stex);

    // Protobuf
    case '.proto':
      return StreamLanguage.define(protobuf);

    // Assembly (GAS / AT&T syntax)
    case '.asm':
    case '.s':
      return StreamLanguage.define(gas);

    // Verilog / SystemVerilog
    case '.v':
    case '.sv':
    case '.vh':
      return StreamLanguage.define(verilog);

    // VHDL
    case '.vhd':
    case '.vhdl':
      return StreamLanguage.define(vhdl);

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
