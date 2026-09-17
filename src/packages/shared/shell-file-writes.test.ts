import { describe, expect, it } from 'vitest';
import { analyzeShellFileWrites, analyzeShellInspection, getPureShellFileWrites, getShellFileWrites, parseShellCommands } from './shell-file-writes';

const paths = (command: string) => getShellFileWrites(command).map((write) => `${write.operation}:${write.path}`);

describe('getShellFileWrites', () => {
  it('ignores `;` and regex fragments inside a quoted sed script (phantom ".*" edit)', () => {
    const command = `cp /repo/web/src/render/model-instance.ts /pg/model-instance.split.ts && sed -i 's/^for variant in .*; do$/for variant in split before split; do/' /pg/variants.sh && grep -n "for variant" /pg/variants.sh && curl -s -X POST -H "X-Auth-Token: abcd" http://localhost:5174/api/exec -H "Content-Type: application/json" -d '{"agentId":"6exyc67k","command":"/pg/variants.sh","tail":40}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('exitCode'))"`;
    expect(paths(command)).toEqual(['in_place_edit:/pg/variants.sh']);
  });

  it('reports the file a python heredoc patches, never `=>` inside it (phantom "[...new" edit)', () => {
    const command = [
      `python3 - <<'EOF'`,
      `p='tests/unit/render-perf-real.test.ts'`,
      `new = """  const ids = items.map((item) => [...new Set(item.tags)]);`,
      `  expect(a > b).toBe(true);"""`,
      `open(p,'w').write(new)`,
      `EOF`,
    ].join('\n');
    expect(paths(command)).toEqual(['overwrite:tests/unit/render-perf-real.test.ts']);
    expect(getShellFileWrites(command).every((write) => write.fromScript)).toBe(true);
  });

  it('reports a heredoc file creation, resolved against the preceding cd, with its content', () => {
    const command = `cd /home/riven/d/tc-playground/smash-perf/microbench && cat > parts.test.ts <<'EOF'\nimport { it } from 'vitest';\nconst x = a > b ? 1 : 2;\nEOF`;
    expect(getShellFileWrites(command)).toEqual([{
      path: '/home/riven/d/tc-playground/smash-perf/microbench/parts.test.ts',
      operation: 'overwrite',
      segment: 'cat > parts.test.ts <<\'EOF\'',
      content: "import { it } from 'vitest';\nconst x = a > b ? 1 : 2;\n",
    }]);
  });

  it('handles appends, tee, fd redirects and dup redirects', () => {
    expect(paths('npm test > out.log 2>&1')).toEqual(['overwrite:out.log']);
    expect(paths('npm test 2> err.log')).toEqual([]);
    expect(paths('echo hi >> notes.md')).toEqual(['append:notes.md']);
    expect(paths('echo x | tee -a a.txt b.txt')).toEqual(['append:a.txt', 'append:b.txt']);
    expect(paths('make &> build.log')).toEqual(['overwrite:build.log']);
    expect(paths('ls > /dev/null')).toEqual([]);
  });

  it('drops targets that need a shell to resolve', () => {
    expect(paths('echo x > "$OUT"')).toEqual([]);
    expect(paths('echo x > $(mktemp)')).toEqual([]);
    expect(paths(`python3 - <<'EOF'\nopen(sys.argv[1], 'w').write(x)\nEOF`)).toEqual([]);
    expect(paths('sed -i s/a/b/ src/*.ts')).toEqual([]);
    expect(paths("sed -i s/a/b/ 'app/[slug]/page.tsx'")).toEqual(['in_place_edit:app/[slug]/page.tsx']);
  });

  it('parses sed and perl in-place operands', () => {
    expect(paths("sed -i.bak -e 's/a/b/' -e 's/c/d/' one.ts two.ts")).toEqual(['in_place_edit:one.ts', 'in_place_edit:two.ts']);
    expect(paths("sed -i '' 's/a/b/' README.md")).toEqual(['in_place_edit:README.md']);
    expect(paths("sed -Ei 's/(a|b)/c/' x.txt")).toEqual(['in_place_edit:x.txt']);
    expect(paths("sed -n '1,20p' x.txt")).toEqual([]);
    expect(paths("perl -pi -e 's/a/b/g' lib/a.pm lib/b.pm")).toEqual(['in_place_edit:lib/a.pm', 'in_place_edit:lib/b.pm']);
    expect(paths("perl -ne 'print if /x/' file.txt")).toEqual([]);
  });

  it('ignores comparisons and text inside command substitutions', () => {
    expect(paths('(( count > 3 )) && echo big')).toEqual([]);
    expect(paths('[[ "$a" > "$b" ]] && echo later')).toEqual([]);
    expect(paths(`git commit -m "$(cat <<'EOF'\nFix it's parser (a -> b)\nEOF\n)"`)).toEqual([]);
    expect(paths("echo '> not-a-file' # > also-not")).toEqual([]);
  });

  it('keeps keywords out of the command name', () => {
    expect(paths('for f in a b; do sed -i s/x/y/ conf.ini; done')).toEqual(['in_place_edit:conf.ini']);
    expect(paths('if true; then cat > gen.txt <<EOF\nhello\nEOF\nfi')).toEqual(['overwrite:gen.txt']);
  });
});

describe('getPureShellFileWrites', () => {
  it('accepts chains whose only job is writing files', () => {
    expect(getPureShellFileWrites(`cd /tmp/x && cat > a.ts <<'EOF'\nconst a = 1;\nEOF`)?.map((w) => w.path)).toEqual(['/tmp/x/a.ts']);
    expect(getPureShellFileWrites(`mkdir -p scripts && cat > scripts/run.sh <<'EOF'\n#!/bin/sh\nEOF\nchmod +x scripts/run.sh`)?.map((w) => w.path)).toEqual(['scripts/run.sh']);
    expect(getPureShellFileWrites("sed -i 's/a/b/' x.ts && sed -i 's/c/d/' x.ts")?.map((w) => w.path)).toEqual(['x.ts']);
  });

  it('rejects chains that also run something', () => {
    expect(getPureShellFileWrites(`cat > a.test.ts <<'EOF'\nit('x')\nEOF\nnpx vitest run a.test.ts`)).toBeNull();
    expect(getPureShellFileWrites('npm test > out.log')).toBeNull();
    expect(getPureShellFileWrites('ls -la')).toBeNull();
  });
});

describe('parseShellCommands', () => {
  it('attaches heredoc bodies to the command that declared them', () => {
    const commands = parseShellCommands(`cat > a <<A && cat > b <<-B\none\nA\n\ttwo\n\tB\necho done`);
    expect(commands.map((c) => c.heredocBodies)).toEqual([['one\n'], ['two\n'], []]);
    expect(commands[2].words.map((w) => w.value)).toEqual(['echo', 'done']);
  });
});

describe('analyzeShellFileWrites', () => {
  it('lists what else a heredoc write chain runs', () => {
    const analysis = analyzeShellFileWrites(`cd /pg && cat > parts.test.ts <<'EOF'\nimport { it } from 'vitest';\nEOF\nsed -n '1,40p' lib/model.ts && curl -s http://localhost:5174/api/exec | python3 -c "print(1)"`);
    expect(analysis.writes.map((w) => w.path)).toEqual(['/pg/parts.test.ts']);
    expect(analysis.pure).toBe(false);
    expect(analysis.otherCommands).toEqual(['sed', 'curl', 'python3']);
  });
});

describe('interpreter script writes', () => {
  it('names the files an inline python/node script rewrites', () => {
    expect(paths(`grep -n x a.ts && python3 - <<'EOF'\np='web/src/render/model-instance.ts'\ns=open(p).read()\nopen(p,'w').write(s)\nEOF`))
      .toEqual(['overwrite:web/src/render/model-instance.ts']);
    expect(paths(`node -e "require('fs').writeFileSync('dist/out.json', JSON.stringify(x))"`)).toEqual(['overwrite:dist/out.json']);
    expect(paths(`python3 - <<'EOF'\nfrom pathlib import Path\nPath('notes.md').write_text(body)\nopen('log.txt','a').write(line)\nEOF`))
      .toEqual(['append:log.txt', 'overwrite:notes.md']); // grouped by write form, not source order
    expect(paths(`python3 -c "print(open('read-only.ts').read())"`)).toEqual([]);
  });
});

describe('analyzeShellInspection', () => {
  it('reads cd-prefixed sed ranges separated by echo banners as reads', () => {
    const command = "cd /home/riven/d/tide-commander; sed -n 713,730p src/HistoryLine.tsx; echo '-----'; sed -n 763,775p src/HistoryLine.tsx";
    expect(analyzeShellInspection(command)).toEqual([
      { kind: 'read', path: '/home/riven/d/tide-commander/src/HistoryLine.tsx', range: { start: 713, end: 730 } },
      { kind: 'read', path: '/home/riven/d/tide-commander/src/HistoryLine.tsx', range: { start: 763, end: 775 } },
    ]);
  });

  it('keeps searches and treats piped commands as filters', () => {
    expect(analyzeShellInspection('cd /repo; grep -nE "import .*Icon" a.tsx b.tsx; grep -n x c.ts | head -3')).toEqual([
      { kind: 'search', command: 'grep -nE "import .*Icon" a.tsx b.tsx', pattern: 'import .*Icon', paths: ['/repo/a.tsx', '/repo/b.tsx'] },
      { kind: 'search', command: 'grep -n x c.ts', pattern: 'x', paths: ['/repo/c.ts'] },
    ]);
    expect(analyzeShellInspection('head -n 40 README.md && tail -20 CHANGELOG.md 2>/dev/null')).toEqual([
      { kind: 'read', path: 'README.md', range: { start: 1, end: 40 } },
      { kind: 'read', path: 'CHANGELOG.md' },
    ]);
  });

  it('allows neutral probes and read-only git in an inspection chain', () => {
    expect(analyzeShellInspection('ls docs; wc -l docs/PLAN.md; cat docs/PLAN.md')).toEqual([
      { kind: 'read', path: 'docs/PLAN.md' },
    ]);
    expect(analyzeShellInspection('git status --short; grep -n TODO src/a.ts')).toEqual([
      { kind: 'search', command: 'grep -n TODO src/a.ts', pattern: 'TODO', paths: ['src/a.ts'] },
    ]);
    expect(analyzeShellInspection('git commit -m x; cat a.ts')).toBeNull();
  });

  it('rejects chains that write or run anything else', () => {
    expect(analyzeShellInspection('sed -n 1,5p a.ts > copy.ts')).toBeNull();
    expect(analyzeShellInspection("sed -i 's/a/b/' a.ts")).toBeNull();
    expect(analyzeShellInspection('cd /repo && npm test | grep FAIL')).toBeNull();
    expect(analyzeShellInspection('cat "$FILE"')).toBeNull();
    expect(analyzeShellInspection('echo hello')).toBeNull();
  });
});
