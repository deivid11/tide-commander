import { describe, expect, it } from 'vitest';
import { scriptReplacements } from './script-replacements';
import { getShellFileWrites } from './shell-file-writes';

describe('scriptReplacements', () => {
  it('extracts the pair from a variable + concatenation patch (the common agent shape)', () => {
    const script = [
      "p='bench.mjs'",
      's=open(p).read()',
      `a="page.on('pageerror', error => log('pageerror', error.message));"`,
      'assert s.count(a)==1',
      `s=s.replace(a, a+"\\npage.on('console', message => log(message.text()));")`,
      "open(p,'w').write(s)",
    ].join('\n');

    expect(scriptReplacements(script)).toEqual([{
      oldText: "page.on('pageerror', error => log('pageerror', error.message));",
      newText: "page.on('pageerror', error => log('pageerror', error.message));\npage.on('console', message => log(message.text()));",
    }]);
  });

  it('follows a `rep(old, new)` helper that wraps str.replace', () => {
    const script = [
      "p='x.ts'",
      's=open(p).read()',
      'def rep(a,b):',
      '  global s',
      '  s=s.replace(a,b)',
      'rep("const runs = 3;", "const runs = 8;")',
      'rep("let debug = false", "let debug = true")',
      "open(p,'w').write(s)",
    ].join('\n');

    expect(scriptReplacements(script)).toEqual([
      { oldText: 'const runs = 3;', newText: 'const runs = 8;' },
      { oldText: 'let debug = false', newText: 'let debug = true' },
    ]);
  });

  it('maps helper parameters by position, so `rep(path, old, new)` never uses the path as old text', () => {
    const script = [
      "p='src/packages/client/components/shared/useFilteredOutputs.ts'",
      's=open(p).read()',
      'def rep(path,old,new,count=1):',
      '  global s',
      '  assert s.count(old)==count',
      '  s=s.replace(old,new)',
      'rep(p,"export interface EditData {","export interface EditData {\\n  replacements?: string[];")',
      "open(p,'w').write(s)",
    ].join('\n');

    expect(scriptReplacements(script)).toEqual([{
      oldText: 'export interface EditData {',
      newText: 'export interface EditData {\n  replacements?: string[];',
    }]);
  });

  it('skips a helper whose replace arguments are not its parameters', () => {
    const script = [
      'def patch(p, pairs):',
      '  s=open(p).read()',
      '  for a,b in pairs:',
      '    s=s.replace(a,b)',
      "  open(p,'w').write(s)",
      "patch('x.ts', [('one','two')])",
    ].join('\n');
    // `a`/`b` are loop variables, not parameters: refuse rather than guess.
    expect(scriptReplacements(script)).toEqual([]);
  });

  it('handles triple-quoted blocks and escapes, and refuses what it cannot resolve', () => {
    const triple = 'body = """line one\nline two"""\ns = s.replace("marker", body)';
    expect(scriptReplacements(triple)).toEqual([{ oldText: 'marker', newText: 'line one\nline two' }]);

    // Tab + newline escapes are decoded so the text matches the real file.
    expect(scriptReplacements(`s = s.replace("a\\tb", "a\\nb")`)).toEqual([{ oldText: 'a\tb', newText: 'a\nb' }]);
    // A raw string keeps its backslashes.
    expect(scriptReplacements(`s = s.replace(r"a\\nb", "c")`)).toEqual([{ oldText: 'a\\nb', newText: 'c' }]);

    // Unresolvable: f-strings, unknown names, regex substitution, no-op pairs.
    expect(scriptReplacements('s = s.replace(f"{x}", "y")')).toEqual([]);
    expect(scriptReplacements('s = s.replace(missing, "y")')).toEqual([]);
    expect(scriptReplacements('s = re.sub(r"a+", "b", s)')).toEqual([]);
    expect(scriptReplacements('s = s.replace("same", "same")')).toEqual([]);
  });
});

describe('getShellFileWrites with script replacements', () => {
  it('attaches the pairs to the file the script rewrites', () => {
    const command = [
      "cd /pg/smash-perf && python3 - <<'EOF'",
      "p='bench.mjs'",
      's=open(p).read()',
      's=s.replace("--measure 3", "--measure 5")',
      "open(p,'w').write(s)",
      'EOF',
      'node bench.mjs --base http://127.0.0.1:5297',
    ].join('\n');

    const [write] = getShellFileWrites(command);
    expect(write.path).toBe('/pg/smash-perf/bench.mjs');
    expect(write.fromScript).toBe(true);
    expect(write.replacements).toEqual([{ oldText: '--measure 3', newText: '--measure 5' }]);
  });

  it('leaves replacements unset for a plain redirect or sed', () => {
    expect(getShellFileWrites('echo hi > notes.md')[0].replacements).toBeUndefined();
    expect(getShellFileWrites("sed -i 's/a/b/' x.ts")[0].replacements).toBeUndefined();
  });
});
