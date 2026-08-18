import { describe, expect, it } from 'vitest';
import { codeLangForFile, detectCodeLanguage, highlightCodeHtml, splitHighlightedHtml } from './codeHighlight';
import { analyzeShellOutput, highlightShellLine } from './shellOutputHighlight';
import { terminalOutputToHtmlLines } from './terminalOutputHtml';

const TSX = `import React from 'react';
import { store } from '../../store';

/**
 * Doc comment
 * spanning lines
 */
export function Toggle({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation(['tools']);
  return (
    <span className={enabled ? 'active' : ''} onClick={(e) => e.stopPropagation()}>
      {t('x')}
    </span>
  );
}`;

const PY = `import os
from pathlib import Path

def main(argv):
    if not argv:
        return None
    for p in argv:
        print(Path(p).resolve())

if __name__ == "__main__":
    main(sys.argv[1:])`;

const SCSS = `@use '../../variables' as *;

.bash-inline-output {
  width: 100%;

  pre {
    margin: 2px 0 8px 0;
    color: var(--text-secondary);
  }
}`;

const MARKDOWN = `## Estado

- **last-tick:** 2026-08-17 12:56 CDMX (lun) — algo pasó con [[5261]] y sigue abierto.
- **last-tick:** 2026-08-17 12:55 CDMX (lun) — otra nota con \`código\` inline.
- [ ] tarea pendiente (id:: 5264)(proj:: OPM)
- [x] tarea hecha (id:: 5246)`;

describe('detectCodeLanguage', () => {
  it('recognises TS/TSX, Python, CSS/SCSS and JSON', () => {
    expect(detectCodeLanguage(TSX.split('\n'))).toBe('tsx');
    expect(detectCodeLanguage(PY.split('\n'))).toBe('python');
    expect(detectCodeLanguage(SCSS.split('\n'))).toBe('scss');
    expect(detectCodeLanguage(['.a {', '  color: red;', '  margin: 0 auto;', '}', '.b { display: none; }'])).toBe('css');
    expect(detectCodeLanguage(['{', '  "a": 1,', '  "b": [true, null]', '}'])).toBe('json');
  });

  it('leaves markdown / prose / logs alone', () => {
    expect(detectCodeLanguage(MARKDOWN.split('\n'))).toBeNull();
    expect(detectCodeLanguage([
      'INFO server listening on http://localhost:5174',
      'WARN deprecated option --legacy',
      'error TS2322: Type string is not assignable',
      '✓ 17 tests passed in 15ms',
    ])).toBeNull();
    expect(detectCodeLanguage([' M src/a.ts', '?? src/b.ts', 'A  src/c.ts'])).toBeNull();
    expect(detectCodeLanguage(['a', 'b'])).toBeNull();
  });

  it('accepts a strip callback for prefixed rows', () => {
    const rows = TSX.split('\n').map((l, i) => `${i + 1}:${l}`);
    expect(detectCodeLanguage(rows)).toBeNull();
    expect(detectCodeLanguage(rows, (l) => l.replace(/^\d+:/, ''))).toBe('tsx');
  });
});

describe('codeLangForFile', () => {
  it('maps known extensions (with optional :line:col)', () => {
    expect(codeLangForFile('src/x.tsx')).toBe('tsx');
    expect(codeLangForFile('src/x.ts:12:5')).toBe('typescript');
    expect(codeLangForFile('styles/_tools.scss')).toBe('scss');
    expect(codeLangForFile('styles/a.css')).toBe('css');
    expect(codeLangForFile('script.py')).toBe('python');
    expect(codeLangForFile('README.md')).toBeNull();
    expect(codeLangForFile('Makefile')).toBeNull();
  });
});

describe('splitHighlightedHtml', () => {
  it('re-balances spans that cross line breaks', () => {
    const html = highlightCodeHtml('/* a\nb */\nconst x = 1;', 'javascript');
    const lines = splitHighlightedHtml(html);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^<span class="token comment">\/\* a<\/span>$/);
    expect(lines[1]).toMatch(/^<span class="token comment">b \*\/<\/span>$/);
    expect(lines[2]).toContain('<span class="token keyword">const</span>');
    for (const l of lines) {
      expect((l.match(/<span/g) || []).length).toBe((l.match(/<\/span>/g) || []).length);
    }
  });
});

describe('analyzeShellOutput formats', () => {
  it('detects grep rows and picks the language per file extension', () => {
    const out = [
      'src/a.ts:12:  const x: number = 1;',
      'src/b.tsx:40:  return <div className="x" />;',
      'styles/_t.scss:5:  color: red;',
    ];
    const ctx = analyzeShellOutput(out);
    expect(ctx.format).toBe('grep');
    const html = highlightShellLine(out[0], ctx);
    expect(html).toContain('<span class="sh-path" data-path="src/a.ts:12">src/a.ts:12</span>');
    expect(html).toContain('<span class="token keyword">const</span>');
    const scss = highlightShellLine(out[2], ctx);
    expect(scss).toContain('data-path="styles/_t.scss:5"');
    expect(scss).toContain('<span class="token property">color</span>');
  });

  it('renders rg context rows (path-12-) with a dim separator', () => {
    const out = ['src/a.ts-11-  // before', 'src/a.ts:12:  const x = 1;', 'src/a.ts-13-  // after'];
    const ctx = analyzeShellOutput(out);
    expect(ctx.format).toBe('grep');
    const html = highlightShellLine(out[0], ctx);
    expect(html).toMatch(/^<span class="sh-path" data-path="src\/a\.ts:11">src\/a\.ts<\/span><span class="sh-dim">-11-<\/span>/);
  });

  it('detects numbered code rows (grep -n / cat -n) and dims the number', () => {
    const rows = TSX.split('\n').map((l, i) => `${i + 1}:${l}`);
    const ctx = analyzeShellOutput(rows);
    expect(ctx.format).toBe('numbered');
    expect(ctx.lang).toBe('tsx');
    const html = highlightShellLine(rows[0], ctx);
    expect(html).toMatch(/^<span class="sh-dim">1:<\/span><span class="sh-code"><span class="token keyword">import<\/span>/);
  });

  it('numbered prose rows (grep -n over markdown) stay semantic', () => {
    const rows = MARKDOWN.split('\n').filter(Boolean).map((l, i) => `${i + 1}:${l}`);
    const ctx = analyzeShellOutput(rows);
    expect(ctx.format).toBeNull();
  });

  it('a source dump becomes format=code; colored tool output does not', () => {
    expect(analyzeShellOutput(TSX.split('\n'))).toMatchObject({ format: 'code', lang: 'tsx' });
    const colored = TSX.split('\n').map((l) => `\x1b[32m${l}\x1b[39m`);
    expect(analyzeShellOutput(colored).format).toBeNull();
  });
});

describe('terminalOutputToHtmlLines with code', () => {
  it('highlights a whole file dump with Prism, keeping multi-line comments intact', () => {
    const lines = terminalOutputToHtmlLines(TSX);
    expect(lines[0]).toContain('<span class="token keyword">import</span>');
    expect(lines[3]).toBe('<span class="sh-code"><span class="token comment">/**</span></span>');
    expect(lines[4]).toBe('<span class="sh-code"><span class="token comment"> * Doc comment</span></span>');
    expect(lines.join('\n')).not.toContain('sh-num');
  });

  it('keeps wc/path and Exit code lines semantic inside a code dump', () => {
    const lines = terminalOutputToHtmlLines(`304 src/packages/shared/terminal-render.ts\n${TSX}\nExit code 1`);
    expect(lines[0]).toContain('data-path="src/packages/shared/terminal-render.ts"');
    expect(lines[0]).not.toContain('token');
    expect(lines[lines.length - 1]).toBe('<span class="sh-error"><span class="sh-lvl">Exit code 1</span></span>');
  });

  it('splits multi-command outputs at section markers and analyses each segment', () => {
    const lines = terminalOutputToHtmlLines(`${TSX}\n=== SCSS ===\n${SCSS}`);
    const marker = lines.findIndex((l) => l.includes('sh-section'));
    expect(marker).toBeGreaterThan(0);
    expect(lines[0]).toContain('<span class="token keyword">import</span>');
    expect(lines[marker + 1]).toContain('@use');
    expect(lines[marker + 1]).toContain('token');
    expect(lines[marker + 3]).toContain('.bash-inline-output');
    expect(lines[marker + 3]).toContain('token selector');
  });

  it('prose stays semantic (no Prism tokens)', () => {
    const html = terminalOutputToHtmlLines(MARKDOWN).join('\n');
    expect(html).not.toContain('token');
    expect(html).toContain('sh-section');
    expect(html).toContain('sh-time');
  });
});

describe('path false positives fixed', () => {
  it('ignores regex flags, Spanish word/word, digit-only segments and single-word roots', () => {
    expect(highlightShellLine(".replace(/x/g, '')")).not.toContain('sh-path');
    expect(highlightShellLine('se canceló/reagendará hoy')).not.toContain('sh-path');
    expect(highlightShellLine('tablero 5227/5225/5244 cerradas')).not.toContain('sh-path');
    expect(highlightShellLine('and/or')).not.toContain('sh-path');
    // still paths
    expect(highlightShellLine('/tmp')).toContain('sh-path');
    expect(highlightShellLine('Bitácora-Bolba.md')).toContain('data-path="Bitácora-Bolba.md"');
    expect(highlightShellLine('src/x.ts')).toContain('sh-path');
  });

  it('keeps leading whitespace out of key/tag tokens', () => {
    expect(highlightShellLine('  data: unknown;')).toBe('  <span class="sh-key">data</span>: unknown;');
    expect(highlightShellLine('  [Tide] up')).toBe('  <span class="sh-tag">[Tide]</span> up');
  });

  it('does not read "CC OSPEI-2877 — release" as a git status entry', () => {
    expect(highlightShellLine('CC OSPEI-2877 — Actualizacion MDO PROD')).not.toContain('sh-git');
  });
});
