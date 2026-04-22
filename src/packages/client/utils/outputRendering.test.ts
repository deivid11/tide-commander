import { describe, expect, it } from 'vitest';
import { decodeTideFileHref, extractExecWrappedCommand, linkifyFilePathsForMarkdown, parseBashNotificationCommand, parseBashSearchCommand, parseBashTrackingStatusCommand, getTrackingStatusIcon } from './outputRendering';

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
