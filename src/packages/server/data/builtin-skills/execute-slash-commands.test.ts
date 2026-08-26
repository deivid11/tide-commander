import { describe, expect, it } from 'vitest';
import { BUILTIN_SKILLS } from './index.js';
import { executeSlashCommands } from './execute-slash-commands.js';

describe('Execute Slash Commands built-in skill', () => {
  it('is registered and documents plugin and streamed shell execution', () => {
    expect(BUILTIN_SKILLS).toContain(executeSlashCommands);
    expect(executeSlashCommands.content).toContain('GET /api/plugins/slash-commands');
    expect(executeSlashCommands.content).toContain('shellCommandId');
    expect(executeSlashCommands.content).toContain('requiresSudo');
    expect(executeSlashCommands.content).toContain('"grep":"literal text"');
    expect(executeSlashCommands.content).toContain('"tail":10');
    expect(executeSlashCommands.content).toContain('Never place `| grep`');
    expect(executeSlashCommands.content).toContain('awaitingUserAuthorization: true');
    expect(executeSlashCommands.content).toContain('secure password component');
    expect(executeSlashCommands.content).toContain('COMMANDER_SLASH_COMMAND_RESULT');
    expect(executeSlashCommands.content).toContain('GET /api/exec/tasks/YOUR_AGENT_ID');
    expect(executeSlashCommands.content).toContain('/output?tail=200');
    expect(executeSlashCommands.content).toContain('cancelEndpoint');
    expect(executeSlashCommands.content).toContain('HTTP `DELETE`');
    expect(executeSlashCommands.content).toContain('never rerun the command automatically');
    expect(executeSlashCommands.content).toContain('Never ask for, accept, read, or transmit');
  });
});
