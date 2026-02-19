import type { ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type { CLIBackend, RunnerCallbacks, StandardEvent } from '../types.js';
import type { RunnerInternalEventBus } from './internal-events.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Runner');

interface StdoutPipelineDeps {
  backend: CLIBackend;
  callbacks: RunnerCallbacks;
  bus: RunnerInternalEventBus;
}

export class RunnerStdoutPipeline {
  private backend: CLIBackend;
  private callbacks: RunnerCallbacks;
  private bus: RunnerInternalEventBus;
  private activeSubagentName: Map<string, string> = new Map();
  private textEmittedInTurn: Set<string> = new Set();

  constructor(deps: StdoutPipelineDeps) {
    this.backend = deps.backend;
    this.callbacks = deps.callbacks;
    this.bus = deps.bus;
  }

  handleStdout(agentId: string, process: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      let resolved = false;

      process.stdout?.on('data', (data: Buffer) => {
        buffer += decoder.write(data);
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          this.processLine(agentId, line);
        }
      });

      process.stdout?.on('end', () => {
        const remaining = buffer + decoder.end();
        if (remaining.trim()) {
          this.processLine(agentId, remaining);
        }
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      process.stdout?.on('close', () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });
    });
  }

  private processLine(agentId: string, line: string): void {
    try {
      const rawEvent = JSON.parse(line);

      if (process.env.DEBUG) {
        log.log(`[EVENT] ${agentId.slice(0, 4)}: type=${rawEvent.type}, subtype=${rawEvent.subtype || 'none'}, tool_name=${rawEvent.tool_name || 'none'}`);
      }

      const sessionId = this.backend.extractSessionId(rawEvent);
      if (sessionId) {
        this.bus.emit({
          type: 'runner.session_id',
          agentId,
          sessionId,
        });
        this.callbacks.onSessionId(agentId, sessionId);
      }

      const eventOrEvents = this.backend.parseEvent(rawEvent);
      if (!eventOrEvents) {
        return;
      }

      if (Array.isArray(eventOrEvents)) {
        for (const event of eventOrEvents) {
          this.handleEvent(agentId, event);
        }
      } else {
        this.handleEvent(agentId, eventOrEvents);
      }
    } catch {
      this.callbacks.onOutput(agentId, `[raw] ${line}`);
    }
  }

  private handleEvent(agentId: string, event: StandardEvent): void {
    const now = Date.now();
    this.bus.emit({ type: 'runner.activity', agentId, timestamp: now });
    this.bus.emit({ type: 'runner.event', agentId, event });

    this.callbacks.onEvent(agentId, event);

    switch (event.type) {
      case 'init':
        this.callbacks.onOutput(agentId, `Session started: ${event.sessionId} (${event.model})`);
        break;

      case 'text':
        if (event.text) {
          this.callbacks.onOutput(agentId, event.text, event.isStreaming, undefined, event.uuid);
          this.textEmittedInTurn.add(agentId);
        }
        break;

      case 'thinking':
        if (event.text) {
          this.callbacks.onOutput(agentId, `[thinking] ${event.text}`, event.isStreaming, undefined, event.uuid);
        }
        break;

      case 'tool_start': {
        if (event.toolName === 'Task' && event.subagentName) {
          this.activeSubagentName.set(agentId, event.subagentName);
        }
        // Skip output for subagent internal tools (shown in inline activity panel instead)
        if (event.parentToolUseId) {
          break;
        }
        const toolStartSubName = event.subagentName || this.activeSubagentName.get(agentId);
        this.callbacks.onOutput(agentId, `Using tool: ${event.toolName}`, false, toolStartSubName, event.uuid, {
          toolName: event.toolName,
          toolInput: event.toolInput as Record<string, unknown> | undefined,
        });
        if (event.toolInput) {
          this.callbacks.onOutput(agentId, `Tool input: ${JSON.stringify(event.toolInput)}`, false, toolStartSubName, event.uuid);
        }
        break;
      }

      case 'tool_result': {
        // Skip output for subagent internal tools (shown in inline activity panel)
        if (!event.parentToolUseId) {
          const toolResultSubName = this.activeSubagentName.get(agentId);
          if (event.toolName === 'Bash' && event.toolOutput) {
            this.callbacks.onOutput(agentId, `Bash output:\n${event.toolOutput}`, false, toolResultSubName, event.uuid);
          }
        }
        if (event.toolName === 'Task') {
          this.activeSubagentName.delete(agentId);
        }
        break;
      }

      case 'step_complete': {
        if (event.resultText && !this.textEmittedInTurn.has(agentId)) {
          log.log(`[step_complete] Emitting resultText as fallback (no prior text events) for agent ${agentId.slice(0, 4)}`);
          this.callbacks.onOutput(agentId, event.resultText, false, undefined, event.uuid);
        } else if (event.resultText) {
          log.log(`[step_complete] Skipping resultText (already emitted via text events) for agent ${agentId.slice(0, 4)}`);
        }
        this.textEmittedInTurn.delete(agentId);
        if (event.tokens) {
          this.callbacks.onOutput(agentId, `Tokens: ${event.tokens.input} in, ${event.tokens.output} out`, false, undefined, event.uuid);
        }
        if (event.cost !== undefined) {
          this.callbacks.onOutput(agentId, `Cost: $${event.cost.toFixed(4)}`, false, undefined, event.uuid);
        }
        break;
      }

      case 'error':
        this.callbacks.onError(agentId, event.errorMessage || 'Unknown error');
        break;

      case 'usage_snapshot':
        // Silently pass through to onEvent (already called above) - no output needed
        break;

      case 'context_stats':
        if (event.contextStatsRaw) {
          this.callbacks.onOutput(agentId, event.contextStatsRaw, false, undefined, event.uuid);
        }
        break;

      default:
        break;
    }
  }
}
