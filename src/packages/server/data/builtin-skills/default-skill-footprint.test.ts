import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_SKILL_SLUGS } from '../../../shared/types.js';
import { agentMemory } from './agent-memory.js';
import { agentTracking } from './agent-tracking.js';
import { executeSlashCommands } from './execute-slash-commands.js';
import { fullNotifications } from './full-notifications.js';
import { reportTaskToBoss } from './report-task-to-boss.js';
import { sendMessageToAgent } from './send-message-to-agent.js';
import { streamingExec } from './streaming-exec.js';
import { taskLabel } from './task-label.js';

const defaultSkills = [
  fullNotifications,
  streamingExec,
  executeSlashCommands,
  taskLabel,
  reportTaskToBoss,
  agentTracking,
  agentMemory,
  sendMessageToAgent,
];

describe('default skill prompt footprint', () => {
  it('covers the exact spawn defaults', () => {
    expect(defaultSkills.map(skill => skill.slug)).toEqual(DEFAULT_AGENT_SKILL_SLUGS);
  });

  it('keeps the eight pre-selected skills below the compact prompt budget', () => {
    const rendered = defaultSkills
      .map(skill => `## Skill: ${skill.name}\n_${skill.description}_\n${skill.content}`)
      .join('\n---\n');

    expect(rendered.length).toBeLessThan(11_500);
  });

  it('retains every mandatory API contract after compaction', () => {
    expect(fullNotifications.content).toContain('POST /api/notify');
    expect(sendMessageToAgent.content).toContain('POST /api/agents/AGENT_ID/message');
    expect(streamingExec.content).toContain('POST /api/exec');
    expect(streamingExec.content).toContain('GET /api/exec/tasks/YOUR_AGENT_ID');
    expect(streamingExec.content).toContain('cancelEndpoint');
    expect(executeSlashCommands.content).toContain('GET /api/plugins/slash-commands');
    expect(executeSlashCommands.content).toContain('/execute-sudo-command');
    expect(taskLabel.content).toContain('PATCH /api/agents/YOUR_AGENT_ID');
    expect(agentTracking.content).toContain('LAST tool call');
    expect(agentMemory.content).toContain('PATCH /api/agents/YOUR_AGENT_ID/memory');
    expect(reportTaskToBoss.content).toContain('POST /api/agents/YOUR_AGENT_ID/report-task');
  });
});
