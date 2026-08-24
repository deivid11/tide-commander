import { describe, expect, it } from 'vitest';
import { parseShellCommandResult, shellCommandResultPreview } from './shellCommandResult';

const result = `[COMMANDER_SLASH_COMMAND_RESULT]
The user authorized and Commander finished the sudo slash command you requested.
Command: /execute-sudo-command 'touch' '/opt/test'
Exit code: 0
Duration: 788 ms
Output:
(no output)
[/COMMANDER_SLASH_COMMAND_RESULT]
Review the result, inform the user, and continue.`;

describe('shell command result presentation', () => {
  it('parses the internal callback into a compact result', () => {
    expect(parseShellCommandResult(result)).toEqual({
      command: "/execute-sudo-command 'touch' '/opt/test'",
      exitCode: 0,
      durationMs: 788,
      output: '',
      outputTruncated: false,
    });
    expect(shellCommandResultPreview(result)).toBe(
      "Sudo completado · /execute-sudo-command 'touch' '/opt/test'",
    );
  });

  it('parses failures and truncated output', () => {
    expect(parseShellCommandResult(`[COMMANDER_SLASH_COMMAND_RESULT]
Command: /deploy
Exit code: 7
Duration: 1200 ms
Output (tail; earlier output omitted):
permission denied
[/COMMANDER_SLASH_COMMAND_RESULT]`)).toMatchObject({
      exitCode: 7,
      output: 'permission denied',
      outputTruncated: true,
    });
  });

  it('ignores ordinary messages and malformed callbacks', () => {
    expect(parseShellCommandResult('touch completed')).toBeNull();
    expect(parseShellCommandResult('[COMMANDER_SLASH_COMMAND_RESULT] missing')).toBeNull();
  });
});
