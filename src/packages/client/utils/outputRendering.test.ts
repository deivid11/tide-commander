import { describe, expect, it } from 'vitest';
import { parseBashNotificationCommand, parseBashSearchCommand } from './outputRendering';

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
