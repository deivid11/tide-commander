import { describe, expect, it } from 'vitest';
import { decodeTideFileHref, isImageViewTool, getImageViewTarget, extractExecWrappedCommand, linkifyFilePathsForMarkdown, parseBashNotificationCommand, parseBashSearchCommand, parseBashTrackingStatusCommand, getTrackingStatusIcon, summarizeCodexExecScript, extractToolKeyParam, getCodexExecPresentation, getShellCommandPresentation, isCodexExecWrapper, getCodexExecEditPaths, getCodexExecPatchForFile, getCodexExecFileTarget, getCodexExecCommand, getShellReadTarget, getShellReadTargets, parseCodexGrepResults, prettifyToolName } from './outputRendering';

describe('Codex exec activity summaries', () => {
  it('describes parallel terminal commands without exposing orchestration code', () => {
    const script = `const r = await Promise.all([
      tools.exec_command({ cmd: "npm test" }),
      tools.exec_command({ cmd: "npm run build" }),
      tools.exec_command({ cmd: "npm run lint" }),
    ]);`;
    expect(summarizeCodexExecScript(script)).toBe('Run 3 commands in parallel');
    expect(extractToolKeyParam('exec', JSON.stringify({ input: script }))).toBe('Run 3 commands in parallel');
  });

  it('describes terminal input and image inspection', () => {
    expect(summarizeCodexExecScript('const r = await tools.write_stdin({ session_id: 42 });'))
      .toBe('Continue terminal command');
    expect(summarizeCodexExecScript(`const r = await tools.view_image({ path: "/tmp/screenshot.png" });`))
      .toBe('image');
  });

  it('summarizes mixed orchestration calls', () => {
    const script = 'const a = await Promise.all([tools.exec_command({}), tools.write_stdin({})]);';
    expect(summarizeCodexExecScript(script)).toBe('Run 1 command + 1 terminal input in parallel');
  });

  it('classifies terminal commands like familiar Claude tools', () => {
    expect(getCodexExecPresentation('const r = await tools.exec_command({ cmd: "rg -n \\\"needle\\\" src" });'))
      .toEqual({ toolName: 'Grep', detail: 'rg -n "needle" src' });
    expect(getCodexExecPresentation('const r = await tools.exec_command({ cmd: "sed -n \\\"1,80p\\\" src/App.tsx" });'))
      .toEqual({ toolName: 'Read', detail: 'lines 1–80', filePaths: ['src/App.tsx'] });
    expect(getCodexExecPresentation('const r = await tools.exec_command({ cmd: "rg --files src" });'))
      .toEqual({ toolName: 'Glob', detail: 'rg --files src' });
    expect(getCodexExecPresentation({
      input: `const r = await tools.exec_command({ cmd: "/usr/bin/zsh -lc \\\"sed -n '1335,1362p' src/GrepPanel.tsx\\\"" });`,
    })).toEqual({ toolName: 'Read', detail: 'lines 1335–1362', filePaths: ['src/GrepPanel.tsx'] });
  });

  it('classifies direct compound Bash reads semantically', () => {
    expect(getShellCommandPresentation(`/usr/bin/zsh -lc "sed -n '1,55p' src/A.ts; rg -n needle src"`))
      .toEqual({ toolName: 'Read', detail: 'lines 1–55', filePaths: ['src/A.ts'] });
    expect(getShellCommandPresentation(`/usr/bin/zsh -lc "sed -n '50,75p' src/A.ts; sed -n '420,450p' src/B.ts"`))
      .toEqual({ toolName: 'Read', detail: '2 ranges', filePaths: ['src/A.ts', 'src/B.ts'] });
  });

  it('extracts touched files from apply_patch calls for the diff modal', () => {
    const script = `const patch = "*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-old\n+new\n*** Add File: src/new.ts\n+value\n*** End Patch";
      await tools.apply_patch(patch);`;
    expect(getCodexExecEditPaths({ input: script })).toEqual(['src/App.tsx', 'src/new.ts']);

    const persisted = String.raw`const patch = "*** Begin Patch\n*** Update File: /workspace/src/Panel.tsx\n@@\n-old\n+new\n*** End Patch"; await tools.apply_patch(patch);`;
    expect(getCodexExecEditPaths({ input: persisted })).toEqual(['/workspace/src/Panel.tsx']);
    expect(getCodexExecPatchForFile({ input: persisted }, '/workspace/src/Panel.tsx'))
      .toContain("*** Update File: /workspace/src/Panel.tsx\n@@\n-old\n+new");
    expect(getCodexExecPresentation({ input: persisted }))
      .toEqual({ toolName: 'Edit', detail: 'modified', filePaths: ['/workspace/src/Panel.tsx'] });
  });

  it('resolves exact read ranges and grep result lines for the file modal', () => {
    expect(getCodexExecFileTarget({ input: `const r = await tools.exec_command({cmd: "sed -n '440,545p' src/Panel.tsx"});` }))
      .toEqual({ path: 'src/Panel.tsx', highlightRange: { offset: 440, limit: 106 } });
    expect(getCodexExecFileTarget({ input: `const r = await tools.exec_command({cmd: "/usr/bin/zsh -lc \\\"sed -n '10,12p' src/Panel.tsx\\\""});` }))
      .toEqual({ path: 'src/Panel.tsx', highlightRange: { offset: 10, limit: 3 } });
    expect(getShellReadTarget(`/usr/bin/zsh -lc "sed -n '1335,1362p' src/OutputLine.tsx"`))
      .toEqual({ path: 'src/OutputLine.tsx', highlightRange: { offset: 1335, limit: 28 } });
    const compound = `sed -n '10,12p' src/A.ts; sed -n '20,25p' src/B.ts; rg -n needle src`;
    expect(getShellReadTargets(compound)).toEqual([
      { path: 'src/A.ts', highlightRange: { offset: 10, limit: 3 } },
      { path: 'src/B.ts', highlightRange: { offset: 20, limit: 6 } },
    ]);
    expect(getCodexExecPresentation({ input: `const r = await tools.exec_command({cmd: "${compound}"});` }))
      .toEqual({ toolName: 'Read', detail: '2 ranges', filePaths: ['src/A.ts', 'src/B.ts'] });
    expect(getCodexExecFileTarget(
      { input: 'const r = await tools.exec_command({cmd: "rg -n needle src"});' },
      'src/App.tsx:37:const needle = true;\nsrc/Other.ts:8:needle',
    )).toEqual({ path: 'src/App.tsx', highlightRange: { offset: 37, limit: 1 } });
  });

  it('extracts commands for the Bash modal and summarizes chained work', () => {
    const input = { input: 'const r = await tools.exec_command({cmd: "npx vitest run src/a.test.ts && npx tsc --noEmit && git diff --check"}); text(r.output);' };
    expect(getCodexExecCommand(input)).toBe('npx vitest run src/a.test.ts && npx tsc --noEmit && git diff --check');
    expect(getCodexExecPresentation(input)).toEqual({
      toolName: 'Bash',
      detail: '3 steps · tests → type check → check diff',
    });
  });

  it('does not misclassify tool names contained inside a patch body', () => {
    const input = { input: String.raw`const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n+tools.exec_command({})\n+tools.write_stdin({})\n*** End Patch"; await tools.apply_patch(patch);` };
    expect(getCodexExecPresentation(input)).toEqual({ toolName: 'Edit', detail: 'modified', filePaths: ['src/a.ts'] });
  });

  it('parses rg output for a grouped clickable results modal', () => {
    const input = { input: 'const r = await tools.exec_command({cmd: "rg -n \\\"needle\\\" src"});' };
    expect(parseCodexGrepResults(input, 'src/A.ts:12:const needle = 1;\nsrc/B.ts:7:// needle'))
      .toEqual({
        query: 'needle',
        matches: [
          { path: 'src/A.ts', line: 12, text: 'const needle = 1;' },
          { path: 'src/B.ts', line: 7, text: '// needle' },
        ],
      });
  });

  it('skips grep options with values when extracting the query', () => {
    const input = { command: 'rg -n -C 10 --glob "*.ts" "Order with id" src' };
    expect(parseCodexGrepResults(input, 'src/order.ts:41:Order with id'))
      .toMatchObject({ query: 'Order with id' });
  });

  it('extracts an explicit -e grep pattern', () => {
    const input = { command: "grep -R -e 'Order with id' src" };
    expect(parseCodexGrepResults(input, 'src/order.ts:41:Order with id'))
      .toMatchObject({ query: 'Order with id' });
  });

  it('parses native Claude Grep input and scoped output', () => {
    expect(parseCodexGrepResults(
      { pattern: 'needle', path: 'src/A.ts', output_mode: 'content' },
      '12:const needle = 1;\n18-// needle context',
    )).toEqual({
      query: 'needle',
      matches: [
        { path: 'src/A.ts', line: 12, text: 'const needle = 1;' },
      ],
    });
  });

  it('parses native Claude Grep context separators', () => {
    expect(parseCodexGrepResults(
      { pattern: 'needle', path: 'src' },
      'src/A.ts-12-const needle = 1;',
    )).toEqual({
      query: 'needle',
      matches: [{ path: 'src/A.ts', line: 12, text: 'const needle = 1;' }],
    });
  });

  it('parses rg -l files-only output as whole-file entries (line 0)', () => {
    const input = { command: 'rg -l "needle|other" /home/user/project --glob \'!node_modules\' -i' };
    expect(parseCodexGrepResults(input, '/home/user/project/src/A.ts\n/home/user/project/src/B.tsx\n'))
      .toEqual({
        query: 'needle|other',
        matches: [
          { path: '/home/user/project/src/A.ts', line: 0, text: '' },
          { path: '/home/user/project/src/B.tsx', line: 0, text: '' },
        ],
      });
  });

  it('parses native Grep files_with_matches output, skipping the Found header', () => {
    expect(parseCodexGrepResults(
      { pattern: 'needle', path: 'src', output_mode: 'files_with_matches' },
      'Found 2 files\nsrc/A.ts\nsrc/B.ts',
    )).toEqual({
      query: 'needle',
      matches: [
        { path: 'src/A.ts', line: 0, text: '' },
        { path: 'src/B.ts', line: 0, text: '' },
      ],
    });
  });

  it('parses count-mode output by stripping the :count suffix', () => {
    expect(parseCodexGrepResults(
      { pattern: 'needle', path: 'src', output_mode: 'count' },
      'src/A.ts:3\nsrc/B.ts:1',
    )).toEqual({
      query: 'needle',
      matches: [
        { path: 'src/A.ts', line: 0, text: '' },
        { path: 'src/B.ts', line: 0, text: '' },
      ],
    });
  });

  it('does not misread arbitrary command output as a file list', () => {
    expect(parseCodexGrepResults(
      { command: 'rg -l "needle" src' },
      'error: something went wrong while searching',
    )).toEqual({ query: 'needle', matches: [] });
  });

  it('attributes single-file rg output without path prefixes to the command target', () => {
    const input = { command: 'rg -n \'"test"|"typecheck"|"check"|vitest\' /home/user/project/package.json | head' };
    expect(parseCodexGrepResults(input, '35:    "test": "vitest run",\n139:    "vitest": "^4.0.17"'))
      .toEqual({
        query: '"test"|"typecheck"|"check"|vitest',
        matches: [
          { path: '/home/user/project/package.json', line: 35, text: '"test": "vitest run",' },
          { path: '/home/user/project/package.json', line: 139, text: '"vitest": "^4.0.17"' },
        ],
      });
  });

  it('keeps prefixed parsing for multi-file grep commands', () => {
    const input = { command: 'rg -n "toolOutput" src/a.ts src/b.ts 2>/dev/null | head -40' };
    expect(parseCodexGrepResults(input, 'src/a.ts:5:toolOutput x\nsrc/b.ts:9:toolOutput y'))
      .toEqual({
        query: 'toolOutput',
        matches: [
          { path: 'src/a.ts', line: 5, text: 'toolOutput x' },
          { path: 'src/b.ts', line: 9, text: 'toolOutput y' },
        ],
      });
  });

  it('does not scope a directory target (its output keeps path prefixes)', () => {
    const input = { command: 'rg -n "needle" src --glob \'!node_modules\' | head' };
    expect(parseCodexGrepResults(input, 'src/A.ts:12:const needle = 1;'))
      .toEqual({
        query: 'needle',
        matches: [{ path: 'src/A.ts', line: 12, text: 'const needle = 1;' }],
      });
  });

  it('recognizes a Codex exec wrapper persisted inside a Bash command field', () => {
    const input = { command: 'const r = await tools.exec_command({cmd: "rg -n \\\"flat mode\\\" src"}); text(r.output)' };
    expect(isCodexExecWrapper(input)).toBe(true);
    expect(getCodexExecCommand(input)).toBe('rg -n "flat mode" src');
    expect(getCodexExecPresentation(input)).toEqual({ toolName: 'Grep', detail: 'rg -n "flat mode" src' });
  });

  it('extracts commands from wrappers with JSON-style quoted keys', () => {
    const input = { command: 'const r = await tools.exec_command({"cmd":"./install.sh --skip-system-deps --skip-ydotool","workdir":"/tmp/project"}); text(JSON.stringify(r))' };
    expect(getCodexExecCommand(input)).toBe('./install.sh --skip-system-deps --skip-ydotool');
    expect(getCodexExecPresentation(input)).toEqual({
      toolName: 'Bash',
      detail: './install.sh --skip-system-deps --skip-ydotool',
    });
  });
});

describe('MCP tool presentation', () => {
  it('renders a friendly provider/tool label and concise target', () => {
    const toolName = 'mcp__onshape__eval_featurescript';
    expect(prettifyToolName(toolName)).toBe('MCP · Onshape · Eval Featurescript');
    expect(extractToolKeyParam(toolName, JSON.stringify({
      server: 'onshape',
      documentId: 'ee9cd63f067d1f70c44369e5',
      script: 'function(context is Context) { return []; }',
    }))).toBe('onshape · ee9cd63f067d1f70c44369e5');
  });
});

describe('parseBashSearchCommand', () => {
  it('parses zsh -lc rg search command', () => {
    const parsed = parseBashSearchCommand('/usr/bin/zsh -lc "ls -la && rg --files | rg \'^README\\\\.md$|/README\\\\.md$\'"');
    expect(parsed).toEqual({
      shellPrefix: '/usr/bin/zsh -lc',
      commandBody: 'ls -la && rg --files | rg \'^README\\\\.md$|/README\\\\.md$\'',
      searchTerm: '^README\\\\.md$|/README\\\\.md$',
    });
  });

  it('parses plain rg file search command without shell wrapper', () => {
    const parsed = parseBashSearchCommand('rg --files | rg "src/.+\\.ts$"');
    expect(parsed).toEqual({
      shellPrefix: undefined,
      commandBody: 'rg --files | rg "src/.+\\.ts$"',
      searchTerm: 'src/.+\\.ts$',
    });
  });

  it('returns null for non-search bash commands', () => {
    const parsed = parseBashSearchCommand('/usr/bin/zsh -lc "ls -la && npm test"');
    expect(parsed).toBeNull();
  });
});

describe('parseBashNotificationCommand', () => {
  it('parses zsh -lc full notification command', () => {
    const parsed = parseBashNotificationCommand(
      '/usr/bin/zsh -lc "curl -s -X POST http://localhost:5174/api/notify -H \\"Content-Type: application/json\\" -d \'{\\"agentId\\":\\"matwzct6\\",\\"title\\":\\"Task Complete\\",\\"message\\":\\"Removed thinking asterisks\\"}\' & gdbus call --session --dest=org.freedesktop.Notifications --object-path=/org/freedesktop/Notifications --method=org.freedesktop.Notifications.Notify \'Tide Commander\' 0 \'dialog-information\' \'Task Complete\' \'Removed thinking asterisks\' \'[]\' \'{}\' 5000"'
    );
    expect(parsed).toMatchObject({
      shellPrefix: '/usr/bin/zsh -lc',
      title: 'Task Complete',
      message: 'Removed thinking asterisks',
      viaCurl: true,
      viaGdbus: true,
    });
    expect(parsed?.commandBody).toContain('/api/notify');
    expect(parsed?.commandBody).toContain('Notifications.Notify');
  });

  it('returns null for non-notification command', () => {
    const parsed = parseBashNotificationCommand('/usr/bin/zsh -lc "npm test"');
    expect(parsed).toBeNull();
  });
});

describe('linkifyFilePathsForMarkdown', () => {
  it('linkifies plain file path lines', () => {
    const input = [
      'Added',
      'docs/architecture.md',
      'README.md',
    ].join('\n');
    const output = linkifyFilePathsForMarkdown(input);
    expect(output).toContain('[docs/architecture.md](tide-file://docs%2Farchitecture.md)');
    expect(output).toContain('[README.md](tide-file://README.md)');
  });

  it('does not linkify URLs or fenced code blocks', () => {
    const input = [
      'Visit https://example.com/docs/architecture.md',
      '```',
      'docs/architecture.md',
      '```',
    ].join('\n');
    const output = linkifyFilePathsForMarkdown(input);
    expect(output).toContain('https://example.com/docs/architecture.md');
    expect(output).toContain('\n```\ndocs/architecture.md\n```');
    expect(output).not.toContain('tide-file://https');
  });

  it('linkifies absolute paths with accented folders and a .pdf extension', () => {
    const path = '/home/riven/obsidian/Default/Proyectos/OPM/Operación/2026-06-02-ospei-2710-divergencia-saldos-inbursa.pdf';
    const output = linkifyFilePathsForMarkdown(path);
    // The full path (including the accented "Operación" segment) must be the link label.
    expect(output).toContain(`[${path}](tide-file://`);
    expect(output).toContain(encodeURIComponent(path));
  });

  it('linkifies backtick-wrapped accented paths', () => {
    const input = '- `docs/Operación/informe-análisis.md`';
    const output = linkifyFilePathsForMarkdown(input);
    expect(output).toContain('[`docs/Operación/informe-análisis.md`](tide-file://');
  });

  it('linkifies backtick-wrapped file paths from history markdown', () => {
    const input = [
      '### Added',
      '- `docs/architecture.md`',
      '- `docs/interactive-permissions.md`',
    ].join('\n');
    const output = linkifyFilePathsForMarkdown(input);
    expect(output).toContain('[`docs/architecture.md`](tide-file://docs%2Farchitecture.md)');
    expect(output).toContain('[`docs/interactive-permissions.md`](tide-file://docs%2Finteractive-permissions.md)');
  });
});

describe('decodeTideFileHref', () => {
  it('decodes custom tide file hrefs', () => {
    expect(decodeTideFileHref('tide-file://docs%2Farchitecture.md')).toBe('docs/architecture.md');
  });

  it('returns null for non file hrefs', () => {
    expect(decodeTideFileHref('https://example.com')).toBeNull();
  });
});

describe('parseBashTrackingStatusCommand', () => {
  it('parses zsh -lc PATCH tracking-status command', () => {
    const parsed = parseBashTrackingStatusCommand(
      '/usr/bin/zsh -lc "curl -s -X PATCH -H \\"X-Auth-Token: abcd\\" http://localhost:5174/api/agents/zhpciecy -H \\"Content-Type: application/json\\" -d \'{\\"trackingStatus\\":\\"need-review\\",\\"trackingStatusDetail\\":\\"Shipped tracking chip\\"}\'"'
    );
    expect(parsed).toMatchObject({
      shellPrefix: '/usr/bin/zsh -lc',
      trackingStatus: 'need-review',
      trackingStatusDetail: 'Shipped tracking chip',
    });
  });

  it('parses command without detail', () => {
    const parsed = parseBashTrackingStatusCommand(
      'curl -s -X PATCH http://localhost:5174/api/agents/abc -H "Content-Type: application/json" -d \'{"trackingStatus":"blocked"}\''
    );
    expect(parsed?.trackingStatus).toBe('blocked');
    expect(parsed?.trackingStatusDetail).toBeUndefined();
  });

  it('returns null for PATCH without trackingStatus field', () => {
    const parsed = parseBashTrackingStatusCommand(
      'curl -s -X PATCH http://localhost:5174/api/agents/abc -d \'{"taskLabel":"foo"}\''
    );
    expect(parsed).toBeNull();
  });

  it('returns null for non-PATCH command', () => {
    const parsed = parseBashTrackingStatusCommand(
      'curl -s -X POST http://localhost:5174/api/notify -d \'{"trackingStatus":"need-review"}\''
    );
    expect(parsed).toBeNull();
  });
});

describe('getTrackingStatusIcon', () => {
  it('returns specific icons for known statuses', () => {
    expect(getTrackingStatusIcon('need-review')).toBe('✅');
    expect(getTrackingStatusIcon('blocked')).toBe('🚫');
    expect(getTrackingStatusIcon('can-clear-context')).toBe('🧹');
    expect(getTrackingStatusIcon('waiting-subordinates')).toBe('⏳');
  });

  it('returns fallback icon for unknown statuses', () => {
    expect(getTrackingStatusIcon('mystery-state')).toBe('📍');
  });
});

describe('extractExecWrappedCommand', () => {
  it('unwraps curl /api/exec payload command with escaped JSON', () => {
    const cmd = `/usr/bin/zsh -lc "curl -s -X POST http://localhost:5174/api/exec -H \\"Content-Type: application/json\\" -d '{\\"agentId\\":\\"g3d1jvlr\\",\\"command\\":\\"npm test -- src/packages/client/utils/outputRendering.test.ts src/packages/client/utils/filePaths.test.ts\\",\\"cwd\\":\\"/home/riven/d/tide-commander\\"}'"`;
    expect(extractExecWrappedCommand(cmd)).toBe('npm test -- src/packages/client/utils/outputRendering.test.ts src/packages/client/utils/filePaths.test.ts');
  });

  it('returns original command when not wrapped', () => {
    const cmd = '/usr/bin/zsh -lc "npm run build"';
    expect(extractExecWrappedCommand(cmd)).toBe(cmd);
  });
});

describe('view_image tool target', () => {
  it('recognizes the direct image tool regardless of spelling', () => {
    expect(isImageViewTool('view_image')).toBe(true);
    expect(isImageViewTool('ViewImage')).toBe(true);
    expect(isImageViewTool('Read')).toBe(false);
    expect(isImageViewTool('')).toBe(false);
  });

  it('reads path and detail from the tool input', () => {
    expect(getImageViewTarget({ path: '/tmp/onshape-inspect-base.png', detail: 'original' }))
      .toEqual({ path: '/tmp/onshape-inspect-base.png', detail: 'original' });
    expect(getImageViewTarget('{"image_path":"/tmp/shot.png"}'))
      .toEqual({ path: '/tmp/shot.png', detail: undefined });
    expect(getImageViewTarget('/tmp/bare-path.png')).toEqual({ path: '/tmp/bare-path.png' });
  });

  it('returns null when no image path is present', () => {
    expect(getImageViewTarget({ detail: 'original' })).toBeNull();
    expect(getImageViewTarget({})).toBeNull();
    expect(getImageViewTarget('')).toBeNull();
    expect(getImageViewTarget(undefined)).toBeNull();
  });
});
