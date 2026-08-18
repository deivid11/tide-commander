/**
 * Semantic highlighting for PLAIN command output.
 *
 * Most tools only colorize when stdout is a TTY, and the Bash tool's stdout
 * never is — so `git status`, `git diff`, `ls`, `grep`, `find`, `cat`, curl
 * bodies… reach the terminal as flat gray text. This module gives those
 * lines the look a real terminal (with `--color=auto` on a TTY) would give
 * them: unified diffs, `git status`, log levels, section markers, file paths
 * (clickable), URLs, hashes, numbers/durations, timestamps, quoted strings,
 * JSON keys and literals.
 *
 * It is applied ONLY to lines that carry no ANSI SGR of their own — a tool
 * that colored its output already made its choices; we never repaint those.
 * Everything is emitted as flat `<span class="sh-*">` runs (theme-aware via
 * CSS variables in guake-terminal/_shell-output.scss); no nested markup, so
 * the HTML stays trivially safe for `dangerouslySetInnerHTML`.
 */

import { codeLangForFile, detectCodeLanguage, highlightCodeHtml, type CodeLang } from './codeHighlight';

export type ShellOutputFormat = 'code' | 'grep' | 'numbered' | null;

export interface ShellHighlightContext {
  /** Output looks like a unified diff → bare `+`/`-` lines are add/del. */
  diff: boolean;
  /**
   * Output shape: `code` (a source file dump: cat/sed/head), `grep`
   * (`path:line:code` rows), `numbered` (`NN:code` / `cat -n` rows) or null
   * (logs, prose, listings → semantic tokens only).
   */
  format: ShellOutputFormat;
  /** Prism language for the code portions when `format` is set. */
  lang: CodeLang | null;
}

const DEFAULT_CTX: ShellHighlightContext = { diff: false, format: null, lang: null };

const SGR_RE_G = /\x1b\[[0-9;]*m/g;
// `path:12:code` / `path-12-code` (rg/grep -n; the path needs a `/` or a dot)
const RE_GREP_ROW = /^((?:[^\s:]*[/.])[^\s:]*)([:-])(\d+)([:-])(.*)$/;
// `12:code`, `12-code` (single-file grep -n / rg context) or `   12\tcode` (cat -n)
const RE_NUMBERED_ROW = /^(\s{0,7})(\d{1,7})([:\t-])(.*)$/;

/** Sniff output-level facts the per-line rules need. */
export function analyzeShellOutput(input: string | string[]): ShellHighlightContext {
  const rawLines = Array.isArray(input) ? input : input.split('\n');
  const text = Array.isArray(input) ? input.join('\n') : input;
  const ctx: ShellHighlightContext = {
    diff: /^(?:@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@|diff --git |\+\+\+ (?:b\/|\/dev\/null))/m.test(text),
    format: null,
    lang: null,
  };
  if (ctx.diff) return ctx;

  // Only plain outputs are candidates for code detection: a tool that colored
  // its own output (vitest, eslint, chalk) already made its choices.
  const lines: string[] = [];
  let colored = 0;
  for (const raw of rawLines) {
    if (lines.length >= 400) break;
    if (raw.trim().length === 0) continue;
    if (SGR_RE_G.test(raw)) { colored += 1; SGR_RE_G.lastIndex = 0; continue; }
    lines.push(raw);
  }
  if (lines.length < 2 || colored > lines.length * 0.1) return ctx;

  let grep = 0;
  let numbered = 0;
  for (const l of lines) {
    if (RE_GREP_ROW.test(l)) grep += 1;
    else if (RE_NUMBERED_ROW.test(l)) numbered += 1;
  }
  if (grep >= 2 && grep >= lines.length * 0.5) {
    ctx.format = 'grep';
    // Fallback language for rows whose extension we do not know.
    ctx.lang = detectCodeLanguage(lines, (l) => { const m = RE_GREP_ROW.exec(l); return m ? m[5] : l; });
    return ctx;
  }
  if (numbered >= 3 && numbered >= lines.length * 0.6) {
    const lang = detectCodeLanguage(lines, (l) => { const m = RE_NUMBERED_ROW.exec(l); return m ? m[4] : l; });
    if (lang) { ctx.format = 'numbered'; ctx.lang = lang; }
    return ctx;
  }
  const lang = detectCodeLanguage(lines);
  if (lang) { ctx.format = 'code'; ctx.lang = lang; }
  return ctx;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Inline token rules
// ---------------------------------------------------------------------------

interface TokenRule {
  cls: string;
  re: RegExp; // must be /g
  /**
   * The regex starts with a consumed boundary group `(^|[^…])` and the token
   * is group 2 (lookbehind is avoided on purpose: it is a SyntaxError on older
   * iOS Safari and would take the whole client bundle down at load).
   */
  lead?: boolean;
  /** Optional acceptance filter on the token text. */
  accept?: (tok: string) => boolean;
  /** Emit data attributes (used for clickable paths). */
  data?: (tok: string) => Record<string, string> | undefined;
}

const KNOWN_TOP_DIRS = new Set([
  'src', 'lib', 'dist', 'build', 'out', 'bin', 'test', 'tests', '__tests__', 'spec', 'docs', 'doc',
  'public', 'static', 'assets', 'app', 'apps', 'packages', 'node_modules', 'scripts', 'config',
  'components', 'utils', 'server', 'client', 'shared', 'api', 'pages', 'styles', 'android', 'ios',
  'home', 'usr', 'etc', 'var', 'tmp', 'opt', 'proc', 'dev', 'mnt', 'root', 'target', 'vendor', 'cmd',
  'internal', 'pkg', 'migrations', 'locales', 'browser-extension', 'coverage', 'logs',
]);

// Segment chars are Unicode-aware (`Bitácora.md`, `año/informe.pdf`) so an
// accented letter neither breaks a path nor lets one start mid-word.
const SEG = String.raw`[\p{L}\p{N}_.@%+-]`;
const PATH_CORE = String.raw`(?:~|\.{1,2})?\/(?:${SEG}+\/)*${SEG}*|(?:${SEG}+\/)+${SEG}*|${SEG}+\.(?:tsx?|jsx?|mjs|cjs|json|jsonl|md|mdx|s?css|less|html?|xml|ya?ml|toml|ini|env|sh|bash|zsh|py|rb|go|rs|java|kt|kts|c|h|cpp|hpp|cs|php|sql|txt|log|csv|lock|svg|png|jpe?g|gif|webp|pdf|zip|tar|gz|tgz|apk|jar|war|dart|swift|vue|svelte|prisma|proto|gradle|properties|conf|cfg|service|ttf|woff2?)`;
const PATH_RE = new RegExp(String.raw`(^|[^\p{L}\p{N}_@:/.-])((?:${PATH_CORE})(?::\d+(?::\d+)?)?)(?![\p{L}\p{N}_@%+-])`, 'gu');
const HAS_EXT_RE = /\.\w{1,6}$/;

function isLikelyPath(raw: string): boolean {
  const s = raw.replace(/(?::\d+){1,2}$/, '');
  if (s.length < 2) return false;
  const rooted = /^(?:\/|~\/|\.\.?\/)/.test(s);
  const body = s.replace(/^(?:~\/|\.{1,2}\/|\/)/, '');
  if (body.length === 0) return false;
  const segs = body.split('/').filter(Boolean);
  const hasExt = HAS_EXT_RE.test(s);
  // `5227/5225/5244` and `4m/…` are ids/units, not paths (unless they end in an extension).
  if (/^\d/.test(body) && !hasExt) return false;
  if (rooted) {
    // `/g` `/i` (regex flags), `/reagendar` (Spanish "cancelar/reagendar")…
    // a lone root segment is only a path when it is a well-known dir or a file.
    if (s.startsWith('/') && segs.length === 1) return KNOWN_TOP_DIRS.has(segs[0]) || hasExt;
    // `/x/g`, `/\d+/gi` — a regex literal, not a two-level path.
    if (s.startsWith('/') && segs.length === 2 && !KNOWN_TOP_DIRS.has(segs[0]) && /^[gimsuyd]{1,4}$/.test(segs[1])) return false;
    return true;
  }
  if (segs.length >= 3) return true;
  if (segs.length === 2) return KNOWN_TOP_DIRS.has(segs[0]) || hasExt || s.endsWith('/');
  return hasExt && !/^\.\w+$/.test(s);
}

const RULES: TokenRule[] = [
  // Backend-merged stderr marker at the very start of the line.
  { cls: 'sh-stderr', re: /^\[stderr\](?= |$)/g },
  // URLs
  { cls: 'sh-url', re: /\bhttps?:\/\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?]/g },
  // File paths (optionally path:line:col) — clickable.
  {
    cls: 'sh-path',
    re: PATH_RE,
    lead: true,
    accept: isLikelyPath,
    data: (tok) => ({ path: tok }),
  },
  // JSON / YAML keys: "key": …  and  key: value at line start
  { cls: 'sh-key', re: /"(?:[^"\\\n]|\\.){1,80}"(?=\s*:)/g },
  { cls: 'sh-key', re: /(^\s*)([A-Za-z_$][\w.$-]{0,48})(?=\s*(?:=(?=\S)|:(?=\s|$)))/g, lead: true },
  // Bracket tags at line start: [Tide] [vite] [INFO]
  { cls: 'sh-tag', re: /(^\s*)(\[[^\]\s]{1,24}\])(?=[\s:]|$)/g, lead: true },
  // Quoted strings ("…" always; '…' only when unspaced, to survive prose apostrophes)
  { cls: 'sh-str', re: /"(?:[^"\\\n]|\\.){0,240}"/g },
  { cls: 'sh-str', re: /(^|[^\w'])('[^'\s]{1,160}')(?![\w'])/g, lead: true },
  // Timestamps / dates (before numbers so 10:34:09 isn't split)
  {
    cls: 'sh-time',
    re: /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,6})?(?:\s?[AP]M)?\b/g,
  },
  // Git-ish hashes (needs a digit AND a letter — else it's a number or a word)
  {
    cls: 'sh-hash',
    re: /(^|[^\w./@-])([0-9a-f]{7,40})(?![\w./@-])/g,
    lead: true,
    accept: (tok) => /\d/.test(tok) && /[a-f]/.test(tok),
  },
  // `N files changed, X insertions(+), Y deletions(-)`
  { cls: 'sh-diff-add', re: /\b\d+ insertions?\(\+\)/g },
  { cls: 'sh-diff-del', re: /\b\d+ deletions?\(-\)/g },
  // Literals
  { cls: 'sh-lit', re: /\b(?:true|false|null|undefined|None|True|False|nil|NaN|Infinity)\b/g },
  // Versions: v1.196.0, 4.1.2, 1.0.0-beta.2
  { cls: 'sh-num', re: /(^|[^\w.])(v?\d+\.\d+(?:\.\d+)+(?:-[\w.]+)?)(?![\w.])/g, lead: true },
  // Numbers with optional unit / percent / decimals
  {
    cls: 'sh-num',
    re: /(^|[^\w./+-])([+-]?\d+(?:[.,]\d+)*(?:%|ms|µs|us|ns|s|m|h|d|[KMGTkmgt]i?[Bb]|[KMGT]|x|px|fps)?)(?![\w./%-])/g,
    lead: true,
  },
  // Status glyphs
  { cls: 'sh-ok', re: /[✓✔√✅]/g },
  { cls: 'sh-error', re: /[✗✖×❌✘]/g },
  { cls: 'sh-warn', re: /[⚠]/g },
  { cls: 'sh-dim', re: /[→⇒➜›»…]/g },
];

interface Seg { start: number; end: number; cls: string; prio: number; data?: Record<string, string> }

function collectTokens(line: string, skip: Set<string> | null): Seg[] {
  const segs: Seg[] = [];
  for (let prio = 0; prio < RULES.length; prio += 1) {
    const rule = RULES[prio];
    if (skip && skip.has(rule.cls)) continue;
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(line)) !== null) {
      if (m[0].length === 0) { rule.re.lastIndex += 1; continue; }
      const lead = rule.lead ? m[1].length : 0;
      const tok = rule.lead ? m[2] : m[0];
      if (!tok) continue;
      if (rule.accept && !rule.accept(tok)) continue;
      const start = m.index + lead;
      segs.push({ start, end: start + tok.length, cls: rule.cls, prio, data: rule.data?.(tok) });
    }
  }
  segs.sort((a, b) => a.start - b.start || a.prio - b.prio || b.end - a.end);
  const out: Seg[] = [];
  let lastEnd = 0;
  for (const s of segs) {
    if (s.start < lastEnd) continue;
    out.push(s);
    lastEnd = s.end;
  }
  return out;
}

function span(cls: string, text: string, data?: Record<string, string>): string {
  let attrs = '';
  if (data) {
    for (const [k, v] of Object.entries(data)) attrs += ` data-${k}="${escapeHtml(v)}"`;
  }
  return `<span class="${cls}"${attrs}>${escapeHtml(text)}</span>`;
}

/** Inline-token pass over a plain text slice. */
function tokens(text: string, skip: Set<string> | null = null): string {
  if (!text) return '';
  const segs = collectTokens(text, skip);
  if (segs.length === 0) return escapeHtml(text);
  let out = '';
  let pos = 0;
  for (const s of segs) {
    if (s.start > pos) out += escapeHtml(text.slice(pos, s.start));
    out += span(s.cls, text.slice(s.start, s.end), s.data);
    pos = s.end;
  }
  if (pos < text.length) out += escapeHtml(text.slice(pos));
  return out;
}

// ---------------------------------------------------------------------------
// Line-level rules
// ---------------------------------------------------------------------------

const LEVEL_SKIP = new Set(['sh-key', 'sh-tag']);
const NO_TOKENS = null;

const RE_DIFF_HEAD = /^diff --(?:git|cc|combined) /;
const RE_DIFF_INDEX = /^(?:index [0-9a-f]+\.\.[0-9a-f]+|(?:old|new|deleted file|new file|similarity index|rename (?:from|to)|copy (?:from|to)) )/;
const RE_DIFF_FILE = /^(?:---|\+\+\+) (?:a\/|b\/|\/dev\/null|"a\/|"b\/)/;
const RE_DIFF_HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
const RE_DIFF_STAT = /^(\s*\S.*?\s\|\s+)(\d+)(\s+)(\+*)(-*)(\s*)$/;
const RE_GIT_SHORT = /^([ MADRCU?!])([ MADRCU?!]) (?=\S)/;
const RE_GIT_LONG = /^(\s+)(modified|new file|deleted|renamed|copied|typechange|both modified|added by us|added by them|deleted by us|deleted by them|both added|both deleted):(\s+)/;
const RE_GIT_HEAD = /^(?:On branch |Your branch |HEAD detached |Changes to be committed:|Changes not staged for commit:|Untracked files:|Unmerged paths:|nothing to commit|nothing added to commit)/;
const RE_LEVEL_ERR = /^(\s*)(\[?(?:npm )?(?:ERR!|ERROR|Error|error|FATAL|Fatal|fatal|CRITICAL|PANIC|panic|FAIL(?:ED|URE)?|✗|✖|×|❌|✘|Exit code [1-9]\d*|Traceback \(most recent call last\))\]?)(?=[\s:!\]]|$)/;
const RE_LEVEL_WARN = /^(\s*)(\[?(?:npm )?(?:WARN(?:ING)?|Warn(?:ing)?|warn(?:ing)?|DEPRECATED|deprecated|⚠)\]?)(?=[\s:!\]]|$)/;
const RE_LEVEL_OK = /^(\s*)(\[?(?:✓|✔|√|✅|PASS(?:ED)?|OK|ok|Ok|SUCCESS|Success|success|Done|done|DONE|Finished|finished|Compiled|compiled|Built|built|✨)\]?)(?=[\s:!.\]]|$)/;
const RE_LEVEL_INFO = /^(\s*)(\[?(?:INFO|Info|info|NOTICE|notice|ℹ)\]?)(?=[\s:\]]|$)/;
const RE_LEVEL_DIM = /^(\s*)(\[?(?:DEBUG|debug|TRACE|trace|VERBOSE|verbose|SILLY|silly)\]?)(?=[\s:\]]|$)/;
const RE_SECTION = /^\s*(?:={2,}|-{3,}|#{2,4}|\*{2,}|>{2,}|<{2,}|~{3,})\s+\S/;
const RE_SEPARATOR = /^\s*[-=_*#~─━═]{3,}\s*$/;
const RE_STACK_FRAME = /^\s+at\s+(?:async\s+)?(?:new\s+)?(?:\S+\s+\(.+\)|\S+:\d+(?::\d+)?)\s*$/;
const RE_LS_PERMS = /^([-dlcbps][-rwxsStT]{9}[+@.]?)(?=\s)/;
const RE_PROMPT = /^(\$|>|❯|➜) (?=\S)/;

function levelLine(cls: string, m: RegExpMatchArray, line: string): string {
  const rest = line.slice(m[0].length);
  return `<span class="${cls}">${escapeHtml(m[1])}<span class="sh-lvl">${escapeHtml(m[2])}</span>${tokens(rest, LEVEL_SKIP)}</span>`;
}

/**
 * `XY path` is only trusted when the path part looks like one — otherwise
 * prose such as "AM I sure" or "AD hoc" would light up as a status entry.
 */
function looksLikeGitShortEntry(x: string, y: string, rest: string): boolean {
  if ((x === '?' && y === '?') || (x === '!' && y === '!')) return true;
  const first = rest.split(' -> ')[0].trim();
  // A path has no unquoted whitespace ("CC OSPEI-2877 — release notes" is prose).
  if (first.length === 0 || (/\s/.test(first) && !/^".*"$/.test(first))) return false;
  const tok = first.replace(/^"|"$/g, '');
  return isLikelyPath(tok) || /[/.]/.test(tok);
}

function gitShortStatus(x: string, y: string): string {
  const cell = (c: string, cls: string) => (c === ' ' ? ' ' : `<span class="${cls}">${escapeHtml(c)}</span>`);
  if (x === '?' && y === '?') return `<span class="sh-git-untracked">??</span>`;
  if (x === '!' && y === '!') return `<span class="sh-dim">!!</span>`;
  const conflict = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
  if (conflict) return `<span class="sh-git-conflict">${escapeHtml(x + y)}</span>`;
  // git's own palette: index (X) green, worktree (Y) red.
  return cell(x, 'sh-git-index') + cell(y, 'sh-git-work');
}

const RE_EXIT_CODE = /^Exit code [1-9]\d*$/;
const RE_STDERR_PREFIX = /^\[stderr\](?= |$)/;
// `304 src/x.ts` (wc -l) or a bare path line inside an otherwise-code dump.
const RE_PATH_ONLY = /^\s*(?:\d+\s+)?(?:~|\.{1,2})?\/?[\p{L}\p{N}_.@%+-]+(?:\/[\p{L}\p{N}_.@%+-]*)+\/?(?::\d+(?::\d+)?)?\s*$/u;

/** Section markers / separators split multi-command outputs into segments. */
export function isSegmentBoundary(line: string): boolean {
  return RE_SEPARATOR.test(line) || RE_SECTION.test(line);
}

/**
 * Lines that keep their semantic rendering even inside a source-code dump
 * (separators, section markers, `Exit code N`, wc/path lines). Returns HTML
 * or null when the line is ordinary content.
 */
export function structuralHtml(line: string, ctx: ShellHighlightContext = DEFAULT_CTX): string | null {
  if (line.length === 0) return '';
  if (RE_SEPARATOR.test(line)) return `<span class="sh-sep">${escapeHtml(line)}</span>`;
  if (RE_SECTION.test(line)) return `<span class="sh-section">${escapeHtml(line)}</span>`;
  if (RE_EXIT_CODE.test(line)) return `<span class="sh-error"><span class="sh-lvl">${escapeHtml(line)}</span></span>`;
  if (RE_STDERR_PREFIX.test(line)) return tokens(line, LEVEL_SKIP);
  if (RE_DIFF_HEAD.test(line) || RE_DIFF_HUNK.test(line) || RE_DIFF_FILE.test(line)) return highlightShellLine(line, { ...ctx, format: null, lang: null });
  if (ctx.format === 'code' && RE_PATH_ONLY.test(line) && !/[;{}()=]/.test(line)) return tokens(line, LEVEL_SKIP);
  return null;
}

/** Prism'd code, wrapped so its base tone matches the file viewer (`.sh-code`). */
export function wrapCode(html: string): string {
  return html ? `<span class="sh-code">${html}</span>` : '';
}

function codeHtml(code: string, lang: CodeLang | null): string {
  return lang ? wrapCode(highlightCodeHtml(code, lang)) : tokens(code, LEVEL_SKIP);
}

/**
 * Highlight one plain (ANSI-free) line of command output. Returns HTML.
 */
export function highlightShellLine(line: string, ctx: ShellHighlightContext = DEFAULT_CTX): string {
  if (line.length === 0) return '';
  // Very long lines (minified bundles, base64 blobs) — escape only.
  if (line.length > 4000) return escapeHtml(line);

  let m: RegExpMatchArray | null;

  // Source-code shapes: structural lines stay semantic, the rest is Prism.
  if (ctx.format) {
    const structural = structuralHtml(line, ctx);
    if (structural !== null) return structural;
    if (ctx.format === 'grep' && (m = line.match(RE_GREP_ROW))) {
      const [, path, sep1, num, sep2, code] = m;
      const ref = `${path}:${num}`;
      const lang = codeLangForFile(path) ?? ctx.lang;
      // Match rows `path:12:` → one clickable "path:12"; context rows
      // `path-12-` → clickable path with a dim "-12-" so the two read apart.
      const head = sep1 === ':'
        ? `${span('sh-path', ref, { path: ref })}<span class="sh-dim">${escapeHtml(sep2)}</span>`
        : `${span('sh-path', path, { path: ref })}<span class="sh-dim">${escapeHtml(sep1 + num + sep2)}</span>`;
      return head + codeHtml(code, lang);
    }
    if (ctx.format === 'numbered' && (m = line.match(RE_NUMBERED_ROW))) {
      const [, indent, num, sep, code] = m;
      return `${indent}<span class="sh-dim">${escapeHtml(num + sep)}</span>${codeHtml(code, ctx.lang)}`;
    }
    if (ctx.format === 'code' && ctx.lang) return wrapCode(highlightCodeHtml(line, ctx.lang));
    // grep/numbered rows that did not match the shape (headers, `--` groups…)
    return tokens(line, NO_TOKENS);
  }

  // Pure separators first: `echo ---` between commands must not read as a
  // removed diff line when another command in the same output was a diff.
  if (RE_SEPARATOR.test(line)) return `<span class="sh-sep">${escapeHtml(line)}</span>`;

  // Diff structure (strong markers work everywhere; +/- need diff context).
  if (RE_DIFF_HEAD.test(line)) return `<span class="sh-diff-head">${escapeHtml(line)}</span>`;
  if (RE_DIFF_HUNK.test(line)) {
    const idx = line.indexOf('@@', 2) + 2;
    return `<span class="sh-diff-hunk">${escapeHtml(line.slice(0, idx))}</span>${escapeHtml(line.slice(idx))}`;
  }
  if (RE_DIFF_FILE.test(line)) return `<span class="sh-diff-file">${escapeHtml(line)}</span>`;
  if (ctx.diff) {
    if (RE_DIFF_INDEX.test(line)) return `<span class="sh-dim">${escapeHtml(line)}</span>`;
    if (line[0] === '+') return `<span class="sh-diff-add">${escapeHtml(line)}</span>`;
    if (line[0] === '-') return `<span class="sh-diff-del">${escapeHtml(line)}</span>`;
    if (line.startsWith('\\ No newline')) return `<span class="sh-dim">${escapeHtml(line)}</span>`;
  }
  // `git diff --stat`:  path | 12 ++++--
  if ((m = line.match(RE_DIFF_STAT)) && (m[4] || m[5])) {
    return `${tokens(m[1])}<span class="sh-num">${m[2]}</span>${m[3]}<span class="sh-diff-add">${m[4]}</span><span class="sh-diff-del">${m[5]}</span>${m[6]}`;
  }

  // Section headers
  if (RE_SECTION.test(line)) return `<span class="sh-section">${escapeHtml(line)}</span>`;

  // git status
  if ((m = line.match(RE_GIT_SHORT)) && looksLikeGitShortEntry(m[1], m[2], line.slice(3))) {
    return `${gitShortStatus(m[1], m[2])} ${tokens(line.slice(3))}`;
  }
  if ((m = line.match(RE_GIT_LONG))) {
    const cls = /^(new file|added)/.test(m[2]) ? 'sh-git-index' : /^deleted/.test(m[2]) ? 'sh-diff-del' : 'sh-git-work';
    return `${m[1]}<span class="${cls}">${escapeHtml(m[2])}:</span>${m[3]}${tokens(line.slice(m[0].length))}`;
  }
  if (RE_GIT_HEAD.test(line)) return `<span class="sh-head">${tokens(line, LEVEL_SKIP)}</span>`;

  // Log levels / results
  if ((m = line.match(RE_LEVEL_ERR))) return levelLine('sh-error', m, line);
  if ((m = line.match(RE_LEVEL_WARN))) return levelLine('sh-warn', m, line);
  if ((m = line.match(RE_LEVEL_OK))) return levelLine('sh-ok', m, line);
  if ((m = line.match(RE_LEVEL_INFO))) return levelLine('sh-info', m, line);
  if ((m = line.match(RE_LEVEL_DIM))) return levelLine('sh-dim', m, line);

  // Stack frames: dim, but keep the file:line clickable.
  if (RE_STACK_FRAME.test(line)) return `<span class="sh-dim">${tokens(line, LEVEL_SKIP)}</span>`;

  // ls -l permission column
  if ((m = line.match(RE_LS_PERMS))) {
    const dirCls = m[1][0] === 'd' ? 'sh-ls-dir' : m[1][0] === 'l' ? 'sh-ls-link' : 'sh-dim';
    return `<span class="${dirCls}">${escapeHtml(m[1])}</span>${tokens(line.slice(m[1].length), LEVEL_SKIP)}`;
  }

  // Echoed prompt lines: "$ cmd"
  if ((m = line.match(RE_PROMPT))) {
    return `<span class="sh-dim">${escapeHtml(m[1])}</span> <span class="sh-cmd">${escapeHtml(line.slice(m[0].length))}</span>`;
  }

  return tokens(line, NO_TOKENS);
}
