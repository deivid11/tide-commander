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
  // Streaming thinking blocks share a uuid across token deltas. The UI marks a
  // row as thinking via a single leading `[thinking]` prefix — only the first
  // chunk of each stream should get it, otherwise merges become
  // `[thinking] a[thinking] b…`.
  private thinkingStreamPrefixed: Set<string> = new Set();
  // High-frequency token streams (Grok headless) produce dozens of tiny deltas
  // per second. Coalesce them into ~one flush every STREAM_COALESCE_MS so the
  // client doesn't remeasure/redraw the virtual list on every token.
  private streamCoalesce: Map<string, {
    agentId: string;
    uuid: string;
    kind: 'text' | 'thinking';
    chunks: string[];
    timer: ReturnType<typeof setTimeout> | null;
  }> = new Map();

  constructor(deps: StdoutPipelineDeps) {
    this.backend = deps.backend;
    this.callbacks = deps.callbacks;
    this.bus = deps.bus;
  }

  /** Backends that emit token-sized streaming-json deltas. */
  private shouldCoalesceStreaming(): boolean {
    // Grok always streams token-sized NDJSON; Claude does with
    // --include-partial-messages. Codex/OpenCode stream when their CLI
    // surfaces item.updated / message.part.delta (stable-uuid parsers ready).
    return (
      this.backend.name === 'grok' ||
      this.backend.name === 'claude' ||
      this.backend.name === 'codex' ||
      this.backend.name === 'opencode'
    );
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
        // Even unmapped events (task_progress, thinking_tokens, ...) prove the CLI is
        // alive and mid-work — keep the watchdog's activity clock fresh so a session
        // waiting on background tasks isn't idle-killed or flagged as stuck.
        this.bus.emit({ type: 'runner.activity', agentId, timestamp: Date.now() });
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

  /**
   * Inject an already-normalized StandardEvent into the same fan-out path the
   * stdout/JSON parser uses (activity + event bus, onEvent/onOutput callbacks,
   * turn-state tracking). Used by the interactive-TUI runner, which reconstructs
   * events from the session transcript JSONL instead of a stdout JSON stream.
   */
  emitStandardEvent(agentId: string, event: StandardEvent): void {
    this.handleEvent(agentId, event);
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
        this.clearThinkingPrefixState(agentId);
        this.callbacks.onOutput(agentId, `Session started: ${event.sessionId} (${event.model})`);
        break;

      case 'text':
        if (event.text) {
          // Suppress consecutive identical text (extra safety for OpenCode agentic loop)
          // Skip for streaming chunks — token-level deltas are intentionally small and
          // may legitimately repeat, and they are merged client-side by uuid.
          const prevText = this.lastEmittedText.get(agentId);
          if (!event.isStreaming && prevText && prevText === event.text.trim()) {
            log.log(`[text] Suppressing duplicate text for agent ${agentId.slice(0, 4)}`);
            this.textEmittedInTurn.add(agentId);
            break;
          }
          if (event.isStreaming && event.uuid && this.shouldCoalesceStreaming()) {
            this.enqueueStreamChunk(agentId, event.uuid, 'text', event.text);
          } else {
            // Flush any pending coalesced deltas before a final/non-stream emit
            // so the client never applies final full-text over a stale partial.
            if (event.uuid) {
              this.flushStreamCoalesce(`${agentId}:text:${event.uuid}`);
            }
            if (!event.isStreaming) {
              this.lastEmittedText.set(agentId, event.text.trim());
            }
            this.callbacks.onOutput(agentId, event.text, event.isStreaming, undefined, event.uuid);
          }
          this.textEmittedInTurn.add(agentId);
        }
        break;

      case 'thinking':
        if (event.text) {
          const streamKey = event.uuid ? `${agentId}:${event.uuid}` : undefined;
          if (!event.isStreaming) {
            if (event.uuid) {
              this.flushStreamCoalesce(`${agentId}:thinking:${event.uuid}`);
            }
            const thinkingOut = event.text.startsWith('[thinking]')
              ? event.text
              : `[thinking] ${event.text}`;
            this.callbacks.onOutput(agentId, thinkingOut, false, undefined, event.uuid);
            if (streamKey) {
              this.thinkingStreamPrefixed.delete(streamKey);
            }
            break;
          }

          // Streaming path
          if (event.uuid && this.shouldCoalesceStreaming()) {
            let chunk = event.text;
            if (streamKey && !this.thinkingStreamPrefixed.has(streamKey)) {
              this.thinkingStreamPrefixed.add(streamKey);
              chunk = `[thinking] ${event.text}`;
            }
            this.enqueueStreamChunk(agentId, event.uuid, 'thinking', chunk);
          } else {
            let thinkingOut = event.text;
            if (streamKey) {
              if (!this.thinkingStreamPrefixed.has(streamKey)) {
                this.thinkingStreamPrefixed.add(streamKey);
                thinkingOut = `[thinking] ${event.text}`;
              }
            } else if (!event.text.startsWith('[thinking]')) {
              thinkingOut = `[thinking] ${event.text}`;
            }
            this.callbacks.onOutput(agentId, thinkingOut, true, undefined, event.uuid);
          }
        }
        break;

      case 'tool_start': {
        if ((event.toolName === 'Task' || event.toolName === 'Agent') && event.subagentName) {
          this.activeSubagentName.set(agentId, event.subagentName);
        }
        // Detect OpenCode notification curl — mark agent so the top-level gate
        // in handleEvent suppresses subsequent agentic loop turns. Codex uses
        // this shared runner but starts a fresh process per turn, so applying
        // this gate there can hide future live output until a history refresh.
        if (this.backend.name === 'opencode' && event.toolName === 'Bash' && this.isNotificationCurl(event.toolInput)) {
          this.notificationSent.add(agentId);
          log.log(`[tool_start] Notification detected for agent ${agentId.slice(0, 4)} - will suppress subsequent turns`);
        }
        // Skip output for subagent internal tools (shown in inline activity panel instead)
        if (event.parentToolUseId) {
          break;
        }
        const toolInput = event.toolInput as Record<string, unknown> | undefined;
        const hasToolInput = !!toolInput
          && typeof toolInput === 'object'
          && !Array.isArray(toolInput)
          && Object.keys(toolInput).length > 0;
        // Grok events.jsonl fires tool_started with name only (empty {}). Emitting
        // those as terminal cards creates bare "LIST FILES" / "TASK OUTPUT" /
        // "TODOWRITE" rows; chat_history re-emits the same uuid with full args.
        // Still forward onEvent (above) for activity badges — only skip terminal text.
        if (!hasToolInput && this.backend.name === 'grok') {
          break;
        }
        const toolStartSubName = event.subagentName || this.activeSubagentName.get(agentId);
        this.callbacks.onOutput(agentId, `Using tool: ${event.toolName}`, false, toolStartSubName, event.uuid, {
          toolName: event.toolName,
          toolInput,
        });
        // Never emit "Tool input: {}" — empty object is truthy in JS and was
        // producing useless sibling rows for every Grok early tool_start.
        if (hasToolInput) {
          this.callbacks.onOutput(agentId, `Tool input: ${JSON.stringify(toolInput)}`, false, toolStartSubName, event.uuid);
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
        // Flush any pending coalesced stream chunks before finalizing the turn
        this.flushAllStreamCoalesceForAgent(agentId);
        const hasErrorResultText = this.isLikelyErrorResultText(event.resultText);
        if (event.resultText && (!this.textEmittedInTurn.has(agentId) || hasErrorResultText)) {
          log.log(`[step_complete] Emitting resultText as fallback (no prior text events) for agent ${agentId.slice(0, 4)}`);
          this.callbacks.onOutput(agentId, event.resultText, false, undefined, event.uuid);
        } else if (event.resultText) {
          log.log(`[step_complete] Skipping resultText (already emitted via text events) for agent ${agentId.slice(0, 4)}`);
        }
        this.textEmittedInTurn.delete(agentId);
        this.clearThinkingPrefixState(agentId);
        if (event.permissionDenials && event.permissionDenials.length > 0) {
          for (const denial of event.permissionDenials) {
            // Suppress the "[System] Permission denied" line for the two tools
            // routed through our MCP perm-prompt server (AskUserQuestion,
            // ExitPlanMode). For those, the user rejecting via the inline UI
            // already conveys the outcome; surfacing the CLI's generic denial
            // is just noise that looks like a system error.
            if (denial.toolName === 'AskUserQuestion' || denial.toolName === 'AskFollowupQuestion' || denial.toolName === 'ExitPlanMode') {
              continue;
            }
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

  private clearThinkingPrefixState(agentId: string): void {
    const prefix = `${agentId}:`;
    for (const key of this.thinkingStreamPrefixed) {
      if (key.startsWith(prefix)) {
        this.thinkingStreamPrefixed.delete(key);
      }
    }
    // Drop any pending coalesced chunks for this agent
    for (const [key, buf] of this.streamCoalesce) {
      if (buf.agentId === agentId) {
        if (buf.timer) clearTimeout(buf.timer);
        this.streamCoalesce.delete(key);
      }
    }
  }

  private static readonly STREAM_COALESCE_MS = 80;

  private enqueueStreamChunk(
    agentId: string,
    uuid: string,
    kind: 'text' | 'thinking',
    chunk: string
  ): void {
    const key = `${agentId}:${kind}:${uuid}`;
    let buf = this.streamCoalesce.get(key);
    if (!buf) {
      buf = { agentId, uuid, kind, chunks: [], timer: null };
      this.streamCoalesce.set(key, buf);
    }
    buf.chunks.push(chunk);
    if (buf.timer) return;
    buf.timer = setTimeout(() => {
      this.flushStreamCoalesce(key);
    }, RunnerStdoutPipeline.STREAM_COALESCE_MS);
  }

  private flushStreamCoalesce(key: string): void {
    const buf = this.streamCoalesce.get(key);
    if (!buf) return;
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    if (buf.chunks.length === 0) {
      this.streamCoalesce.delete(key);
      return;
    }
    const text = buf.chunks.join('');
    buf.chunks = [];
    this.streamCoalesce.delete(key);
    this.callbacks.onOutput(buf.agentId, text, true, undefined, buf.uuid);
  }

  private flushAllStreamCoalesceForAgent(agentId: string): void {
    const keys = [...this.streamCoalesce.keys()].filter((k) => k.startsWith(`${agentId}:`));
    for (const key of keys) {
      this.flushStreamCoalesce(key);
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
