import { describe, it, expect } from 'vitest';
import { classifyTcApiOutput, readTcPluginOutput } from '../tcApiOutput';
import { parseCurlCommand, detectTcApiCall } from '../curlParser';

describe('detectTcApiCall', () => {
  const detect = (cmd: string) => {
    const parsed = parseCurlCommand(cmd);
    return parsed ? detectTcApiCall(parsed) : null;
  };

  it('detects a localhost /api call with method, path and resource branding', () => {
    const call = detect(`curl -s -H "X-Auth-Token: abcd" http://localhost:5174/api/agents`);
    expect(call).toMatchObject({ method: 'GET', path: '/api/agents', resource: 'agents', label: 'Agents' });
  });

  it('detects POST with a body and keeps the sub-path', () => {
    const call = detect(`curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/browser/dom -d '{"x":1}'`);
    expect(call).toMatchObject({ method: 'POST', path: '/api/browser/dom', resource: 'browser' });
  });

  it('strips query strings and trailing slashes', () => {
    const call = detect(`curl -s http://127.0.0.1:5174/api/sessions/?limit=5`);
    expect(call).toMatchObject({ path: '/api/sessions', resource: 'sessions', label: 'Sessions' });
  });

  it('labels unknown resources with the raw segment', () => {
    const call = detect(`curl -s http://localhost:5174/api/delegation-history`);
    expect(call).toMatchObject({ resource: 'delegation-history', label: 'delegation-history' });
  });

  it('ignores non-local hosts and non-/api paths', () => {
    expect(detect(`curl -s https://example.com/api/agents`)).toBeNull();
    expect(detect(`curl -s http://localhost:5174/healthz`)).toBeNull();
  });
});

describe('readTcPluginOutput', () => {
  it('extracts an interactive plugin envelope with an agent runtime suffix', () => {
    const envelope = {
      output: {
        pluginId: 'rename-agent',
        rendererId: 'agent-name-proposals',
        instanceId: 'request-1',
        data: { kind: 'agent-name-proposals', agentId: 'agent-1', status: 'ready' },
        title: 'Rename Agent',
      },
    };
    expect(readTcPluginOutput(`${JSON.stringify(envelope)}POST EXIT:0`)).toEqual(envelope.output);
  });

  it('rejects ordinary and malformed API payloads', () => {
    expect(readTcPluginOutput('{"success":true}')).toBeNull();
    expect(readTcPluginOutput('{"output":{"pluginId":"x"}}')).toBeNull();
  });
});

describe('classifyTcApiOutput', () => {
  it('returns null for missing or empty output', () => {
    expect(classifyTcApiOutput(undefined)).toBeNull();
    expect(classifyTcApiOutput('   ')).toBeNull();
  });

  it('classifies a full agents payload', () => {
    const output = JSON.stringify([
      { id: 'a1', name: 'Ponyta Juanito', class: 'ponyta', status: 'idle', cwd: '/home/riven/d/tide-commander', provider: 'claude' },
      { id: 'a2', name: 'Designer 3D print', class: 'ralts', status: 'working', cwd: '/home/riven/d/daisy', provider: 'claude' },
    ]);
    const r = classifyTcApiOutput(output);
    expect(r).toMatchObject({ kind: 'agents', total: 2 });
    if (r?.kind === 'agents') {
      expect(r.rows[1]).toMatchObject({ id: 'a2', name: 'Designer 3D print', status: 'working', agentClass: 'ralts' });
    }
  });

  it('classifies a jq projection of agents (subset of keys survives)', () => {
    const r = classifyTcApiOutput(JSON.stringify([{ id: 'a1', name: 'Zapdos Kai', status: 'idle', cwd: '/x' }]));
    expect(r?.kind).toBe('agents');
  });

  it('classifies the skills envelope {skills: [...]}', () => {
    const output = JSON.stringify({
      skills: [
        { id: 's1', name: 'Browser Control', slug: 'browser-control', description: 'Drive the browser', enabled: true, assignedAgentIds: ['a1'], assignedAgentClasses: [] },
      ],
    });
    const r = classifyTcApiOutput(output);
    expect(r).toMatchObject({ kind: 'skills', total: 1 });
    if (r?.kind === 'skills') {
      expect(r.rows[0]).toMatchObject({ name: 'Browser Control', enabled: true, assignedCount: 1 });
    }
  });

  it('classifies skills BEFORE areas when both discriminators are present', () => {
    const r = classifyTcApiOutput(JSON.stringify([{ id: 's1', name: 'X', assignedAgentClasses: [], assignedAgentIds: ['a'] }]));
    expect(r?.kind).toBe('skills');
  });

  it('classifies areas', () => {
    const output = JSON.stringify([
      { id: 'ar1', name: 'DaisySeed', type: 'rectangle', color: '#ff6b4a', assignedAgentIds: ['a1', 'a2'] },
    ]);
    const r = classifyTcApiOutput(output);
    expect(r).toMatchObject({ kind: 'areas', total: 1 });
    if (r?.kind === 'areas') {
      expect(r.rows[0]).toMatchObject({ name: 'DaisySeed', color: '#ff6b4a', agentCount: 2 });
    }
  });

  it('classifies buildings by type even though they also have status+cwd', () => {
    const r = classifyTcApiOutput(JSON.stringify([{ id: 'b1', name: 'GAP API', type: 'server', status: 'running', cwd: '/x' }]));
    expect(r).toMatchObject({ kind: 'buildings', total: 1 });
    if (r?.kind === 'buildings') {
      expect(r.rows[0]).toMatchObject({ name: 'GAP API', buildingType: 'server', status: 'running' });
    }
  });

  it('caps rows but reports the real total', () => {
    const agents = Array.from({ length: 166 }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}`, status: 'idle', cwd: '/x' }));
    const r = classifyTcApiOutput(JSON.stringify(agents));
    expect(r).toMatchObject({ kind: 'agents', total: 166 });
    if (r?.kind === 'agents') expect(r.rows.length).toBeLessThanOrEqual(40);
  });

  it('falls back to json for unrecognized structures', () => {
    const r = classifyTcApiOutput('{"ok":true,"count":3}');
    expect(r).toMatchObject({ kind: 'json', preview: '{"ok":true,"count":3}' });
  });

  it('falls back to text for jq scalar/raw output', () => {
    expect(classifyTcApiOutput('166')).toMatchObject({ kind: 'text', text: '166' });
    expect(classifyTcApiOutput('scout\t10\nvenasour\t4')).toMatchObject({ kind: 'text' });
  });

  it('falls back to text for truncated/invalid JSON', () => {
    expect(classifyTcApiOutput('[{"id":"a1","na')).toMatchObject({ kind: 'text' });
  });
});
