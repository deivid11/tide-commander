/**
 * Source-code detection + Prism highlighting for command output.
 *
 * `cat`, `sed -n`, `rg`/`grep -n` and friends dump source code into the
 * terminal as plain text. Coloring only strings and numbers in such lines
 * reads as half-done, so when an output (or the code part of a `path:line:`
 * result row) is recognisably code, it goes through Prism with the same token
 * palette the file viewer uses (`.token.*` in file-explorer/_syntax.scss).
 *
 * Detection is deliberately conservative: prose, markdown, logs and mixed
 * outputs stay on the semantic highlighter. Only eagerly-bundled grammars are
 * used (no async loads mid-render); unsupported languages fall back to a
 * close relative (less → scss, java → clike) or to no code highlighting.
 */

import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';

export type CodeLang =
  | 'tsx' | 'javascript' | 'typescript' | 'jsx' | 'css' | 'scss' | 'json' | 'yaml' | 'python' | 'bash' | 'go' | 'rust' | 'sql' | 'clike';

const EXT_TO_LANG: Record<string, CodeLang> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  css: 'css', scss: 'scss', sass: 'scss', less: 'scss',
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json',
  yml: 'yaml', yaml: 'yaml',
  py: 'python', pyi: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  go: 'go', rs: 'rust', sql: 'sql',
  java: 'clike', kt: 'clike', kts: 'clike', c: 'clike', h: 'clike', cpp: 'clike', hpp: 'clike', cc: 'clike', cs: 'clike', swift: 'clike', dart: 'clike', scala: 'clike', groovy: 'clike',
};

/** Prism language for a file name / extension, or null when we have no grammar. */
export function codeLangForFile(name: string): CodeLang | null {
  const m = /\.([A-Za-z0-9]{1,6})(?::\d+(?::\d+)?)?$/.exec(name);
  if (!m) return null;
  const lang = EXT_TO_LANG[m[1].toLowerCase()];
  return lang && Prism.languages[lang] ? lang : null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Prism-highlight one string (single or multi-line). Escaped fallback. */
export function highlightCodeHtml(code: string, lang: CodeLang): string {
  const grammar = Prism.languages[lang];
  if (!grammar || !code) return escapeHtml(code);
  try {
    return Prism.highlight(code, grammar, lang);
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Split multi-line highlighted HTML into per-line HTML, closing open spans at
 * each newline and re-opening them on the next line — so a block comment or
 * template string spanning lines still renders correctly line by line.
 */
export function splitHighlightedHtml(html: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  let cur = '';
  let last = 0;
  const re = /<span\b[^>]*>|<\/span>|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    cur += html.slice(last, m.index);
    last = re.lastIndex;
    const t = m[0];
    if (t === '\n') {
      out.push(cur + '</span>'.repeat(stack.length));
      cur = stack.join('');
    } else if (t === '</span>') {
      stack.pop();
      cur += t;
    } else {
      stack.push(t);
      cur += t;
    }
  }
  cur += html.slice(last);
  out.push(cur + '</span>'.repeat(stack.length));
  return out;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

// 'markdown' is a decoy: when prose/markdown out-scores every real grammar the
// output stays on the semantic highlighter (no Prism), which is what a README,
// a task list or a chat log wants.
type DetectLang = CodeLang | 'markdown';

interface LangSignals { lang: DetectLang; rules: Array<[RegExp, number]> }

const SIGNALS: LangSignals[] = [
  {
    lang: 'markdown',
    rules: [
      [/^#{1,6}\s+\S/, 4],
      [/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?\S/, 2],
      [/\*\*[^*\n]+\*\*/, 2],
      [/`[^`\n]+`/, 1],
      [/\[[^\]\n]+\]\([^)\n]+\)|\[\[[^\]\n]+\]\]/, 2],
      [/^>\s+\S/, 2],
      [/^\|.*\|\s*$/, 2],
      [/^\s*[A-ZÁÉÍÓÚa-záéíóúñ][^;{}=<>]{40,}[.!?:]\s*$/, 1],
    ],
  },
  {
    lang: 'tsx',
    rules: [
      [/^\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]/, 4],
      [/^\s*export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum|async|\{)/, 4],
      [/^\s*(?:const|let|var)\s+[\w{[$]/, 3],
      [/^\s*(?:interface|type|enum)\s+\w+/, 3],
      [/^\s*(?:async\s+)?function\s*\*?\s*\w*\s*\(/, 3],
      [/=>/, 2],
      [/:\s*(?:string|number|boolean|void|unknown|any|never|null|undefined|Record<|Array<|Promise<)\b/, 3],
      [/^\s*(?:return|if|else|for|while|switch|case|try|catch|finally|throw|await|new)\b/, 1],
      [/^\s*(?:\/\/|\/\*\*?|\*\s|\*\/)/, 1],
      [/[;{}]\s*$/, 1],
      [/^\s*[)}\]];?\s*$/, 1],
      [/<\/?[A-Z]\w*[\s>/]/, 2],
      [/\b(?:React|useState|useEffect|console\.log|document\.|window\.)/, 2],
    ],
  },
  {
    lang: 'python',
    rules: [
      [/^\s*def\s+\w+\s*\(/, 5],
      [/^\s*class\s+\w+(?:\([^)]*\))?\s*:\s*$/, 5],
      [/^\s*from\s+[\w.]+\s+import\s+/, 5],
      [/^\s*import\s+[\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+)*\s*$/, 4],
      [/^\s*(?:if|elif|for|while|with|try|except|finally|else)\b.*:\s*$/, 3],
      [/^\s*(?:return|raise|yield|pass|break|continue|print\()/, 2],
      [/\bself\b|\bNone\b|\bTrue\b|\bFalse\b|__init__|__name__/, 2],
      [/^\s*#(?!!)/, 1],
      [/^\s*@\w+/, 1],
    ],
  },
  {
    lang: 'css',
    rules: [
      [/^\s*@(?:use|forward|import|mixin|include|media|keyframes|extend|each|if|else|function|return|layer|supports)\b/, 4],
      [/^\s*[.#&:\w[\]="'*>~+,\s-]+\{\s*$/, 3],
      [/^\s*[\w-]+\s*:\s*[^;{}]+;\s*$/, 2],
      [/^\s*\$[\w-]+\s*:/, 4],
      [/^\s*\}\s*$/, 1],
      [/^\s*(?:\/\/|\/\*)/, 1],
      [/\bvar\(--[\w-]+\)|!important|\d+(?:px|rem|em|%|vh|vw)\b/, 2],
    ],
  },
  {
    lang: 'json',
    rules: [
      [/^\s*"[^"\n]+"\s*:\s*/, 3],
      [/^\s*[{}[\]],?\s*$/, 1],
      [/^\s*(?:"[^"\n]*"|-?\d+(?:\.\d+)?|true|false|null),?\s*$/, 1],
    ],
  },
  {
    lang: 'yaml',
    rules: [
      [/^\s*[\w.-]+:\s*(?:[^\s{}[\];][^;{}]*)?$/, 2],
      [/^\s*-\s+[\w"'[{]/, 1],
      [/^---\s*$/, 2],
      [/^\s*#(?!!)/, 1],
    ],
  },
  {
    lang: 'bash',
    rules: [
      [/^#!\s*\S*\b(?:sh|bash|zsh)\b/, 8],
      [/^\s*(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function|export|local|echo|cd|set|source|exit|shift|read)\b/, 2],
      [/\$\{?[\w@#?*!$-]/, 2],
      [/^\s*\w+\s*\(\)\s*\{/, 4],
      [/\|\s*\w+|&&\s*\w+|>\s*\/dev\/null|2>&1/, 2],
      [/^\s*#(?!!)/, 1],
    ],
  },
  {
    lang: 'sql',
    rules: [
      [/^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE|DROP\s+TABLE|WITH)\b/i, 5],
      [/^\s*(?:FROM|WHERE|(?:LEFT|RIGHT|INNER|OUTER)?\s*JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|VALUES|SET|LIMIT|ON)\b/i, 3],
      [/;\s*$/, 1],
      [/^\s*--/, 1],
    ],
  },
  {
    lang: 'go',
    rules: [
      [/^\s*package\s+\w+\s*$/, 6],
      [/^\s*func\s+(?:\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/, 5],
      [/:=/, 3],
      [/^\s*(?:import|type|var|const)\s+[\w(]/, 2],
      [/\bfmt\.|\berr\s*!=\s*nil\b|\bnil\b/, 2],
    ],
  },
  {
    lang: 'rust',
    rules: [
      [/^\s*(?:pub(?:\([^)]*\))?\s+)?fn\s+\w+/, 6],
      [/^\s*(?:pub\s+)?(?:struct|enum|impl|trait|mod)\s+\w+/, 5],
      [/^\s*use\s+[\w:]+(?:::\{)?/, 4],
      [/^\s*let\s+(?:mut\s+)?\w+/, 3],
      [/->\s*[\w<&]/, 2],
      [/\w::\w|&mut\b|\bSome\(|\bOk\(|\bErr\(/, 2],
    ],
  },
  {
    lang: 'clike',
    rules: [
      [/^\s*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>[\]]+\s+\w+\s*[(=;]/, 5],
      [/^\s*package\s+[\w.]+;\s*$/, 6],
      [/^\s*import\s+[\w.*]+;\s*$/, 5],
      [/^\s*#include\s*[<"]/, 6],
      [/^\s*(?:public\s+)?(?:abstract\s+|final\s+)?class\s+\w+/, 3],
      [/^\s*@\w+(?:\([^)]*\))?\s*$/, 2],
      [/;\s*$/, 1],
    ],
  },
];

const MAX_SAMPLE_LINES = 300;

/**
 * Guess the language of a block of plain text lines. Returns null unless the
 * evidence is strong: enough signal lines, a decent share of the sample, and a
 * clear margin over the runner-up. `strip` lets callers remove `path:line:`
 * or `NN:` prefixes before scoring.
 */
export function detectCodeLanguage(lines: string[], strip?: (line: string) => string): CodeLang | null {
  const sample = sampleLines(lines, strip);
  if (sample.length < 3) return null;

  // Whole-text JSON is unambiguous.
  const joined = sample.join('\n').trim();
  if ((joined.startsWith('{') && joined.endsWith('}')) || (joined.startsWith('[') && joined.endsWith(']'))) {
    try { JSON.parse(joined); return 'json'; } catch { /* not JSON */ }
  }

  const ranked = scoreCodeLanguages(sample);
  const best = ranked[0];
  const second = ranked[1]?.score ?? 0;
  if (!best || best.score === 0 || best.lang === 'markdown') return null;
  const share = best.hits / sample.length;
  // Prose/markdown/logs: few structural hits per line → stay semantic.
  if (best.hits < 3 || share < 0.45 || best.score < 8) return null;
  if (second > 0 && best.score < second * 1.25) return null;
  if (best.lang === 'css' && sample.some((l) => SCSS_ONLY_RE.test(l))) return 'scss';
  return best.lang;
}

// `//` comments, `$vars`, `@use/@mixin`, `&:hover` nesting → SCSS grammar (plain CSS has none of these).
const SCSS_ONLY_RE = /^\s*\/\/|^\s*\$[\w-]+\s*:|@(?:use|forward|mixin|include|extend|each|function|return)\b|^\s*&[:.\w[-]/;

function sampleLines(lines: string[], strip?: (line: string) => string): string[] {
  const sample: string[] = [];
  for (const raw of lines) {
    const l = strip ? strip(raw) : raw;
    if (l.trim().length === 0) continue;
    sample.push(l);
    if (sample.length >= MAX_SAMPLE_LINES) break;
  }
  return sample;
}

/** Per-language evidence, best first (exported for tests / diagnostics). */
export function scoreCodeLanguages(sample: string[]): Array<{ lang: DetectLang; score: number; hits: number }> {
  const out: Array<{ lang: DetectLang; score: number; hits: number }> = [];
  for (const { lang, rules } of SIGNALS) {
    let score = 0;
    let hits = 0;
    for (const line of sample) {
      let lineScore = 0;
      for (const [re, w] of rules) if (re.test(line)) lineScore += w;
      if (lineScore > 0) { hits += 1; score += Math.min(lineScore, 6); }
    }
    out.push({ lang, score, hits });
  }
  return out.sort((a, b) => b.score - a.score);
}
