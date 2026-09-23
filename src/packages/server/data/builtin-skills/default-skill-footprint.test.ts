import { describe, expect, it } from 'vitest';
import { FACTORY_DEFAULT_AGENT_SKILL_SLUGS } from '../../../shared/types.js';
import { BUILTIN_SKILLS } from './index.js';
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
  reportTaskToBoss,
  agentMemory,
  sendMessageToAgent,
];

describe('default skill prompt footprint', () => {
  it('covers the exact spawn defaults', () => {
    expect(defaultSkills.map(skill => skill.slug)).toEqual(FACTORY_DEFAULT_AGENT_SKILL_SLUGS);
  });

  it('only names skills that actually ship', () => {
    const shipped = new Set(BUILTIN_SKILLS.map(skill => skill.slug));
    for (const slug of FACTORY_DEFAULT_AGENT_SKILL_SLUGS) {
      expect(shipped.has(slug), `factory default "${slug}" is not a built-in skill`).toBe(true);
    }
  });

  it('keeps the pre-selected skills below the compact prompt budget', () => {
    const rendered = defaultSkills
      .map(skill => `## Skill: ${skill.name}\n_${skill.description}_\n${skill.content}`)
      .join('\n---\n');

    expect(rendered.length).toBeLessThan(6_500);
  });

  it('leaves the status-reporting and slash-command skills opt-in', () => {
    // These pay off only in setups that watch tracking status or run plugin
    // slash commands; every other install would pay their prompt cost for
    // nothing. They stay installed, just not pre-selected.
    for (const skill of [taskLabel, agentTracking, executeSlashCommands]) {
      expect(FACTORY_DEFAULT_AGENT_SKILL_SLUGS).not.toContain(skill.slug);
    }
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
