import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerBashToolCall,
  completeBashToolCall,
  clearBashToolCalls,
  findBashToolUseForExec,
  _resetBashToolCallRegistry,
} from './bash-toolcall-registry.js';

const CURL = (body: string) => `curl -s -X POST -H "X-Auth-Token: abcd" http://localhost:5174/api/exec -H "Content-Type: application/json" -d '${body}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('output',''))"`;

describe('bash tool-call registry (exec ↔ tool_use pairing)', () => {
  beforeEach(() => _resetBashToolCallRegistry());

  it('pairs an exec with the in-flight Bash call whose curl body carries the (JSON-escaped) command — the sweep case', () => {
    const execCmd = `S=/x/sweep.sh; echo "=== FASE 1: baseline y config actual, ROCm vs Vulkan"; $S rocm 0 0; $S vulkan 0 0`;
    const outer = CURL(`{"agentId":"a1","command":"S=/x/sweep.sh; echo \\"=== FASE 1: baseline y config actual, ROCm vs Vulkan\\"; $S rocm 0 0; $S vulkan 0 0","cwd":"/x","tail":30}`);
    registerBashToolCall('a1', 'toolu_1', 'git status');           // unrelated, in flight
    registerBashToolCall('a1', 'toolu_2', outer);
    expect(findBashToolUseForExec('a1', execCmd)).toBe('toolu_2');
  });

  it("accepts the only /api/exec candidate even when quoting hides the command (the '\\'' idiom)", () => {
    const execCmd = `ssh host "docker ps --format '{{.ID}}'"`;
    const outer = CURL(`{"agentId":"a1","command":"ssh host \\"docker ps --format '\\''{{.ID}}'\\''\\""}`);
    registerBashToolCall('a1', 'toolu_9', outer);
    expect(findBashToolUseForExec('a1', execCmd)).toBe('toolu_9');
  });

  it('with several /api/exec calls in flight, picks the one carrying the command; ambiguous → undefined', () => {
    registerBashToolCall('a1', 'toolu_a', CURL(`{"agentId":"a1","command":"npm run build"}`));
    registerBashToolCall('a1', 'toolu_b', CURL(`{"agentId":"a1","command":"npm test"}`));
    expect(findBashToolUseForExec('a1', 'npm test')).toBe('toolu_b');
    expect(findBashToolUseForExec('a1', 'npm run build')).toBe('toolu_a');
    // Neither body carries this command and there are two candidates → no guess.
    expect(findBashToolUseForExec('a1', 'make')).toBeUndefined();
  });

  it('is scoped per agent, forgets completed calls, and clears on turn end', () => {
    registerBashToolCall('a1', 'toolu_x', CURL(`{"command":"npm run build"}`));
    expect(findBashToolUseForExec('a2', 'npm run build')).toBeUndefined();
    completeBashToolCall('a1', 'toolu_x');
    expect(findBashToolUseForExec('a1', 'npm run build')).toBeUndefined();
    registerBashToolCall('a1', 'toolu_y', CURL(`{"command":"npm run build"}`));
    clearBashToolCalls('a1');
    expect(findBashToolUseForExec('a1', 'npm run build')).toBeUndefined();
  });

  it('ignores calls that are not exec curls and tolerates missing ids/commands', () => {
    registerBashToolCall('a1', undefined, 'curl http://localhost:5174/api/exec -d x');
    registerBashToolCall('a1', 'toolu_z', undefined);
    registerBashToolCall('a1', 'toolu_w', 'ls -la');
    expect(findBashToolUseForExec('a1', 'anything')).toBeUndefined();
  });
});
