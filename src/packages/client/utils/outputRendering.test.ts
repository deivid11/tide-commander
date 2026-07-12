import { describe, expect, it } from 'vitest';
import { decodeTideFileHref, extractExecWrappedCommand, linkifyFilePathsForMarkdown, parseBashNotificationCommand, parseBashSearchCommand, parseBashTrackingStatusCommand, getTrackingStatusIcon, summarizeCodexExecScript, extractToolKeyParam, getCodexExecPresentation, getCodexExecEditPaths, getCodexExecFileTarget } from './outputRendering';

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
      .toBe('/tmp/screenshot.png · image');
  });

  it('summarizes mixed orchestration calls', () => {
    const script = 'const a = await Promise.all([tools.exec_command({}), tools.write_stdin({})]);';
    expect(summarizeCodexExecScript(script)).toBe('Run 1 command + 1 terminal input in parallel');
  });

  it('classifies terminal commands like familiar Claude tools', () => {
    expect(getCodexExecPresentation('const r = await tools.exec_command({ cmd: "rg -n \\\"needle\\\" src" });'))
      .toEqual({ toolName: 'Grep', detail: 'rg -n "needle" src' });
    expect(getCodexExecPresentation('const r = await tools.exec_command({ cmd: "sed -n \\\"1,80p\\\" src/App.tsx" });'))
      .toEqual({ toolName: 'Read', detail: 'src/App.tsx · lines 1–80' });
    expect(getCodexExecPresentation('const r = await tools.exec_command({ cmd: "rg --files src" });'))
      .toEqual({ toolName: 'Glob', detail: 'rg --files src' });
  });

  it('extracts touched files from apply_patch calls for the diff modal', () => {
    const script = `const patch = "*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-old\n+new\n*** Add File: src/new.ts\n+value\n*** End Patch";
      await tools.apply_patch(patch);`;
    expect(getCodexExecEditPaths({ input: script })).toEqual(['src/App.tsx', 'src/new.ts']);

    const persisted = String.raw`const patch = "*** Begin Patch\n*** Update File: /workspace/src/Panel.tsx\n@@\n-old\n+new\n*** End Patch"; await tools.apply_patch(patch);`;
    expect(getCodexExecEditPaths({ input: persisted })).toEqual(['/workspace/src/Panel.tsx']);
    expect(getCodexExecPresentation({ input: persisted }))
      .toEqual({ toolName: 'Edit', detail: '/workspace/src/Panel.tsx' });
  });

  it('resolves exact read ranges and grep result lines for the file modal', () => {
    expect(getCodexExecFileTarget({ input: `const r = await tools.exec_command({cmd: "sed -n '440,545p' src/Panel.tsx"});` }))
      .toEqual({ path: 'src/Panel.tsx', highlightRange: { offset: 440, limit: 106 } });
    expect(getCodexExecFileTarget(
      { input: 'const r = await tools.exec_command({cmd: "rg -n needle src"});' },
      'src/App.tsx:37:const needle = true;\nsrc/Other.ts:8:needle',
    )).toEqual({ path: 'src/App.tsx', highlightRange: { offset: 37, limit: 1 } });
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
