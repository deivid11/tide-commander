import type { ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type { CLIBackend, RunnerCallbacks, StandardEvent } from '../types.js';
import type { RunnerInternalEventBus } from './internal-events.js';
import { createLogger } from '../../utils/logger.js';
import { createFileTailer, type TmuxFileTailer } from './tmux-helper.js';

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
  // Track last emitted text per agent to suppress consecutive identical outputs
  // (OpenCode's agentic loop can re-emit the same text in the next turn after a tool call)
  private lastEmittedText: Map<string, string> = new Map();
  // Track agents that have sent a completion notification.
  // OpenCode's agentic loop gives the model another turn after tool calls, causing infinite
  // loops (respond → notify → respond → notify → ...). Once the notification is sent,
  // suppress all further text/tool output until a new user message arrives.
  private notificationSent: Set<string> = new Set();

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

  /**
   * tmux mode: tail a log file instead of reading process.stdout.
   * Lines are processed identically to the pipe-based path.
   */
  handleTmuxLog(agentId: string, logFile: string, startOffset?: number): TmuxFileTailer {
    const tailer = createFileTailer(logFile, (line) => {
      this.processLine(agentId, line);
    });
    if (startOffset !== undefined) {
      tailer.setOffset(startOffset);
    }
    tailer.start();
    return tailer;
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
    // After notification is sent, suppress output-producing events from the agentic loop.
    // This prevents status flickering (working → idle → working) caused by OpenCode
    // giving the model additional turns after the completion notification.
    // Allow through: init (resets gate), step_complete (needed for idle transition),
    // usage_snapshot (context tracking), error (always important).
    if (this.notificationSent.has(agentId)) {
      const passthrough = event.type === 'init' || event.type === 'step_complete'
        || event.type === 'usage_snapshot' || event.type === 'error' || event.type === 'compacting';
      if (!passthrough) {
        return;
      }
    }

    const now = Date.now();
    this.bus.emit({ type: 'runner.activity', agentId, timestamp: now });
    this.bus.emit({ type: 'runner.event', agentId, event });

    this.callbacks.onEvent(agentId, event);

    switch (event.type) {
      case 'init':
        this.lastEmittedText.delete(agentId);
        this.notificationSent.delete(agentId);
        this.callbacks.onOutput(agentId, `Session started: ${event.sessionId} (${event.model})`);
        break;

      case 'text':
        if (event.text) {
          // Suppress consecutive identical text (extra safety for OpenCode agentic loop)
          const prevText = this.lastEmittedText.get(agentId);
          if (prevText && prevText === event.text.trim()) {
            log.log(`[text] Suppressing duplicate text for agent ${agentId.slice(0, 4)}`);
            this.textEmittedInTurn.add(agentId);
            break;
          }
          this.lastEmittedText.set(agentId, event.text.trim());
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
        if ((event.toolName === 'Task' || event.toolName === 'Agent') && event.subagentName) {
          this.activeSubagentName.set(agentId, event.subagentName);
        }
        // Detect notification curl — mark agent so the top-level gate in handleEvent
        // suppresses all subsequent agentic loop turns (text, tools, status flips).
        if (event.toolName === 'Bash' && this.isNotificationCurl(event.toolInput)) {
          this.notificationSent.add(agentId);
          log.log(`[tool_start] Notification detected for agent ${agentId.slice(0, 4)} - will suppress subsequent turns`);
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
          if (event.toolName === 'Bash') {
            this.callbacks.onOutput(agentId, `Bash output:\n${event.toolOutput || '(no output)'}`, false, toolResultSubName, event.uuid);
          }
        }
        if (event.toolName === 'Task' || event.toolName === 'Agent') {
          this.activeSubagentName.delete(agentId);
        }
        break;
      }

      case 'step_complete': {
        const hasErrorResultText = this.isLikelyErrorResultText(event.resultText);
        if (event.resultText && (!this.textEmittedInTurn.has(agentId) || hasErrorResultText)) {
          log.log(`[step_complete] Emitting resultText as fallback (no prior text events) for agent ${agentId.slice(0, 4)}`);
          this.callbacks.onOutput(agentId, event.resultText, false, undefined, event.uuid);
        } else if (event.resultText) {
          log.log(`[step_complete] Skipping resultText (already emitted via text events) for agent ${agentId.slice(0, 4)}`);
        }
        if (event.permissionDenials && event.permissionDenials.length > 0) {
          for (const denial of event.permissionDenials) {
            const denialSummary = this.formatPermissionDenialSummary(denial.toolName, denial.toolInput);
            this.callbacks.onOutput(agentId, `[System] Permission denied: ${denialSummary}`, false, undefined, event.uuid);
          }
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

      case 'compacting':
        // Emit as output so runtime-listeners can broadcast it to clients
        this.callbacks.onOutput(agentId, '[System] Compacting context...', false, undefined, event.uuid);
        break;

      default:
        break;
    }
  }

  private isNotificationCurl(toolInput?: Record<string, unknown>): boolean {
    const cmd = typeof toolInput?.command === 'string' ? toolInput.command : '';
    return cmd.includes('/api/notify');
  }

  private isLikelyErrorResultText(resultText?: string): boolean {
    if (!resultText) return false;
    const lower = resultText.toLowerCase();
    return (
      lower.includes('api error') ||
      lower.includes('internal server error') ||
      lower.includes('permission denied') ||
      lower.includes('tool denied') ||
      lower.includes('error')
    );
  }

  private formatPermissionDenialSummary(toolName: string, input?: Record<string, unknown>): string {
    const details = input && typeof input === 'object' ? this.summarizeToolInput(input) : '';
    return details ? `${toolName} (${details})` : toolName;
  }

  private summarizeToolInput(input: Record<string, unknown>): string {
    const summaryKeys = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description'];
    for (const key of summaryKeys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.length > 120 ? `${value.slice(0, 117)}...` : value;
      }
    }
    return '';
  }
}
