import { describe, expect, it } from 'vitest';
import { analyzeShellOutput, highlightShellLine } from './shellOutputHighlight';
import { shellLineToHtml, terminalOutputToHtmlLines } from './terminalOutputHtml';

const DIFF = { diff: true, format: null, lang: null } as const;
const PLAIN = { diff: false, format: null, lang: null } as const;

describe('analyzeShellOutput', () => {
  it('detects unified diffs by hunk / header markers', () => {
    expect(analyzeShellOutput('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b').diff).toBe(true);
    expect(analyzeShellOutput('@@ -21,7 +21,7 @@ import {\n import x').diff).toBe(true);
    expect(analyzeShellOutput('- bullet\n+ plus\nnothing here').diff).toBe(false);
  });
});

describe('highlightShellLine — structure', () => {
  it('escapes HTML in plain text', () => {
    expect(highlightShellLine('a < b & c')).toBe('a &lt; b &amp; c');
  });

  it('colors unified diff lines', () => {
    expect(highlightShellLine('diff --git a/src/x.ts b/src/x.ts')).toBe(
      '<span class="sh-diff-head">diff --git a/src/x.ts b/src/x.ts</span>',
    );
    expect(highlightShellLine('+++ b/src/x.ts')).toBe('<span class="sh-diff-file">+++ b/src/x.ts</span>');
    expect(highlightShellLine('--- a/src/x.ts')).toBe('<span class="sh-diff-file">--- a/src/x.ts</span>');
    expect(highlightShellLine('@@ -21,7 +21,7 @@ import {')).toBe(
      '<span class="sh-diff-hunk">@@ -21,7 +21,7 @@</span> import {',
    );
    expect(highlightShellLine('+  added line', DIFF)).toBe('<span class="sh-diff-add">+  added line</span>');
    expect(highlightShellLine('-  removed line', DIFF)).toBe('<span class="sh-diff-del">-  removed line</span>');
    expect(highlightShellLine('index adce3464..11705dd4 100644', DIFF)).toBe(
      '<span class="sh-dim">index adce3464..11705dd4 100644</span>',
    );
  });

  it('does not treat +/- lines as diff outside diff context (markdown bullets)', () => {
    expect(highlightShellLine('- item one', PLAIN)).toBe('- item one');
    expect(highlightShellLine('+ more', PLAIN)).toBe('+ more');
  });

  it('colors git diff --stat rows and the summary line', () => {
    const html = highlightShellLine(' src/packages/shared/terminal-render.ts             |  5 +-');
    expect(html).toContain('<span class="sh-path" data-path="src/packages/shared/terminal-render.ts">');
    expect(html).toContain('<span class="sh-num">5</span>');
    expect(html).toContain('<span class="sh-diff-add">+</span><span class="sh-diff-del">-</span>');
    const sum = highlightShellLine(' 4 files changed, 116 insertions(+), 15 deletions(-)');
    expect(sum).toContain('<span class="sh-diff-add">116 insertions(+)</span>');
    expect(sum).toContain('<span class="sh-diff-del">15 deletions(-)</span>');
  });

  it('colors git status --short with git palette (index green, worktree red, untracked red)', () => {
    expect(highlightShellLine(' M src/packages/client/utils/ansiToHtml.ts')).toBe(
      ' <span class="sh-git-work">M</span> <span class="sh-path" data-path="src/packages/client/utils/ansiToHtml.ts">src/packages/client/utils/ansiToHtml.ts</span>',
    );
    expect(highlightShellLine('A  new.ts')).toContain('<span class="sh-git-index">A</span> ');
    expect(highlightShellLine('?? src/new.test.ts')).toContain('<span class="sh-git-untracked">??</span>');
    expect(highlightShellLine('UU conflict.ts')).toContain('<span class="sh-git-conflict">UU</span>');
    // prose that merely starts with two status letters is left alone
    expect(highlightShellLine('AM I right')).toBe('AM I right');
  });

  it('colors long git status and headers', () => {
    expect(highlightShellLine('\tmodified:   src/x.ts')).toContain('<span class="sh-git-work">modified:</span>');
    expect(highlightShellLine('\tnew file:   src/y.ts')).toContain('<span class="sh-git-index">new file:</span>');
    expect(highlightShellLine('\tdeleted:    src/z.ts')).toContain('<span class="sh-diff-del">deleted:</span>');
    expect(highlightShellLine('On branch master')).toMatch(/^<span class="sh-head">/);
    expect(highlightShellLine('Untracked files:')).toMatch(/^<span class="sh-head">/);
  });

  it('colors log levels with a bold token and tinted line', () => {
    expect(highlightShellLine('error TS2322: Type X')).toBe(
      '<span class="sh-error"><span class="sh-lvl">error</span> TS2322: Type X</span>',
    );
    expect(highlightShellLine('Exit code 1')).toBe('<span class="sh-error"><span class="sh-lvl">Exit code 1</span></span>');
    expect(highlightShellLine('[ERROR] boom')).toMatch(/^<span class="sh-error"><span class="sh-lvl">\[ERROR\]<\/span> boom<\/span>$/);
    expect(highlightShellLine('npm WARN deprecated foo')).toMatch(/^<span class="sh-warn"><span class="sh-lvl">npm WARN<\/span>/);
    expect(highlightShellLine('done')).toBe('<span class="sh-ok"><span class="sh-lvl">done</span></span>');
    expect(highlightShellLine('✓ 12 passed')).toMatch(/^<span class="sh-ok"><span class="sh-lvl">✓<\/span> <span class="sh-num">12<\/span> passed<\/span>$/);
    expect(highlightShellLine('INFO server up')).toMatch(/^<span class="sh-info">/);
    expect(highlightShellLine('DEBUG x')).toMatch(/^<span class="sh-dim">/);
    // "Errors" is a different word
    expect(highlightShellLine('Errors: 0')).not.toContain('sh-error');
  });

  it('colors section markers, separators, prompts and stack frames', () => {
    expect(highlightShellLine('=== config locale diff ===')).toBe('<span class="sh-section">=== config locale diff ===</span>');
    expect(highlightShellLine('## Heading')).toBe('<span class="sh-section">## Heading</span>');
    expect(highlightShellLine('# shell comment')).toBe('# shell comment');
    expect(highlightShellLine('---')).toBe('<span class="sh-sep">---</span>');
    expect(highlightShellLine('$ npm test')).toBe('<span class="sh-dim">$</span> <span class="sh-cmd">npm test</span>');
    const frame = highlightShellLine('    at Object.<anonymous> (/home/riven/d/x.js:10:5)');
    expect(frame).toMatch(/^<span class="sh-dim">/);
    expect(frame).toContain('data-path="/home/riven/d/x.js:10:5"');
    expect(highlightShellLine('  at the moment')).toBe('  at the moment');
  });

  it('dims ls -l permission columns', () => {
    expect(highlightShellLine('drwxr-xr-x 1 riven riven 1498 Aug 18 10:34 utils')).toMatch(/^<span class="sh-ls-dir">drwxr-xr-x<\/span>/);
    expect(highlightShellLine('-rw-r--r-- 1 riven riven 1864 Apr 23 18:50 agentDrafts.ts')).toMatch(/^<span class="sh-dim">-rw-r--r--<\/span>/);
  });
});

describe('highlightShellLine — inline tokens', () => {
  it('marks file paths (with optional :line:col) as clickable data-path spans', () => {
    expect(highlightShellLine('see src/packages/server/routes/exec.ts:261 now')).toBe(
      'see <span class="sh-path" data-path="src/packages/server/routes/exec.ts:261">src/packages/server/routes/exec.ts:261</span> now',
    );
    expect(highlightShellLine('/home/riven/d/tide-commander/')).toContain('data-path="/home/riven/d/tide-commander/"');
    expect(highlightShellLine('./scripts/run.sh')).toContain('data-path="./scripts/run.sh"');
    expect(highlightShellLine('README.md')).toContain('data-path="README.md"');
    // not paths: bare words with one slash, "and/or", version numbers
    expect(highlightShellLine('and/or')).toBe('and/or');
    expect(highlightShellLine('v1.196.0')).not.toContain('sh-path');
  });

  it('marks URLs, hashes, numbers, timestamps, literals, strings, keys and tags', () => {
    expect(highlightShellLine('open http://localhost:5174/api/x?y=1.')).toBe(
      'open <span class="sh-url">http://localhost:5174/api/x?y=1</span>.',
    );
    expect(highlightShellLine('0b7da4c3 chore(release): v1.196.0')).toMatch(
      /^<span class="sh-hash">0b7da4c3<\/span> chore\(release\): <span class="sh-num">v1.196.0<\/span>$/,
    );
    expect(highlightShellLine('Duration 7.94s (transform 18.60s)')).toContain('<span class="sh-num">7.94s</span>');
    expect(highlightShellLine('Tests 1678 passed | 1 skipped')).toContain('<span class="sh-num">1678</span>');
    expect(highlightShellLine('Start at 10:35:06')).toContain('<span class="sh-time">10:35:06</span>');
    expect(highlightShellLine('2026-08-18T10:37:16.514Z x')).toContain('<span class="sh-time">2026-08-18T10:37:16.514Z</span>');
    expect(highlightShellLine('ok: true, v: null')).toContain('<span class="sh-lit">true</span>');
    expect(highlightShellLine('echo "hello world"')).toContain('<span class="sh-str">&quot;hello world&quot;</span>');
    expect(highlightShellLine("from './x'")).toContain('<span class="sh-str">&#039;./x&#039;</span>');
    expect(highlightShellLine("don't do it")).toBe('don&#039;t do it');
    expect(highlightShellLine('  "taskId": "abc"')).toBe(
      '  <span class="sh-key">&quot;taskId&quot;</span>: <span class="sh-str">&quot;abc&quot;</span>',
    );
    expect(highlightShellLine('FORCE_COLOR=3')).toBe('<span class="sh-key">FORCE_COLOR</span>=<span class="sh-num">3</span>');
    expect(highlightShellLine('[Tide] 1076691  - LOG')).toMatch(/^<span class="sh-tag">\[Tide\]<\/span>/);
    expect(highlightShellLine('[stderr] warning: x')).toMatch(/^<span class="sh-stderr">\[stderr\]<\/span>/);
  });

  it('never nests or overlaps spans', () => {
    const html = highlightShellLine('src/x.ts:1 "str" 0deadbe 12ms http://a.b/c 10:00 true');
    expect(html).not.toMatch(/<span[^>]*><span/);
    expect((html.match(/<span/g) || []).length).toBe((html.match(/<\/span>/g) || []).length);
  });

  it('escapes only, without tokens, on pathological long lines', () => {
    const line = 'x'.repeat(5000) + ' <b>';
    expect(highlightShellLine(line)).toBe('x'.repeat(5000) + ' &lt;b&gt;');
  });
});

describe('shellLineToHtml / terminalOutputToHtmlLines integration', () => {
  it('keeps ANSI-colored lines as-is and highlights plain ones', () => {
    expect(shellLineToHtml('\x1b[32m✓\x1b[39m ok')).toBe('<span style="color:#a3be8c">✓</span> ok');
    expect(shellLineToHtml('✓ ok')).toBe('<span class="sh-ok"><span class="sh-lvl">✓</span> ok</span>');
  });

  it('threads the diff context from the whole output into every line', () => {
    const lines = terminalOutputToHtmlLines('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n');
    expect(lines[4]).toBe('<span class="sh-diff-del">-old</span>');
    expect(lines[5]).toBe('<span class="sh-diff-add">+new</span>');
  });

  it('memoizes identical lines (same output for repeated calls)', () => {
    const a = shellLineToHtml(' M src/a.ts');
    const b = shellLineToHtml(' M src/a.ts');
    expect(a).toBe(b);
    expect(a).toContain('sh-git-work');
  });
});
