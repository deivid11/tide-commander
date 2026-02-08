import { describe, expect, it } from 'vitest';
import { decodeTideFileHref, linkifyFilePathsForMarkdown, parseBashNotificationCommand, parseBashSearchCommand } from './outputRendering';

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
