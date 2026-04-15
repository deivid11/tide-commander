/**
 * OpenCode JSON Event Parser
 * Maps OpenCode NDJSON events to StandardEvent format
 */

import type { StandardEvent } from '../claude/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OpencodeParser');

interface OpencodeRawEvent {
  type?: string;
  timestamp?: number;
  sessionID?: string;
  part?: {
    id?: string;
    messageID?: string;
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    title?: string;
    reason?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
    };
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: {
        write?: number;
        read?: number;
      };
    };
    cost?: number;
    time?: {
      start?: number;
      end?: number;
    };
  };
}

// OpenCode uses lowercase tool names; normalize to match Claude's capitalized format
// so the frontend rendering (TOOL_ICONS, recognizedTools, etc.) works correctly.
const TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Task',
  agent: 'Agent',
  skill: 'Skill',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  todowrite: 'TodoWrite',
  notebookedit: 'NotebookEdit',
  askuserquestion: 'AskUserQuestion',
  askfollowupquestion: 'AskFollowupQuestion',
  toolsearch: 'ToolSearch',
  enterplanmode: 'EnterPlanMode',
  exitplanmode: 'ExitPlanMode',
};

function normalizeToolName(raw: string): string {
  return TOOL_NAME_MAP[raw.toLowerCase()] || raw;
}

export class OpencodeJsonEventParser {
  private lastTextContent: string | undefined;
  private textEventEmittedInTurn = false;

  parseEvent(rawEvent: unknown): StandardEvent[] {
    const event = rawEvent as OpencodeRawEvent;
    if (!event || typeof event !== 'object' || !event.type) {
      return [];
    }

    log.log(`parseEvent: type=${event.type}, sessionID=${event.sessionID || 'none'}`);

    switch (event.type) {
      case 'step_start':
        return this.parseStepStart(event);
      case 'text':
        return this.parseText(event);
      case 'tool_use':
        return this.parseToolUse(event);
      case 'step_finish':
        return this.parseStepFinish(event);
      default:
        log.log(`parseEvent: unknown event type '${event.type}' - skipping`);
        return [];
    }
  }

  private parseStepStart(event: OpencodeRawEvent): StandardEvent[] {
    return [{
      type: 'init',
      sessionId: event.sessionID,
    }];
  }

  private parseText(event: OpencodeRawEvent): StandardEvent[] {
    const text = event.part?.text;
    if (!text) return [];

    // Track last text for resultText in step_complete (boss delegation parsing)
    this.lastTextContent = text;
    this.textEventEmittedInTurn = true;

    return [{
      type: 'text',
      text,
      isStreaming: false,
    }];
  }

  private parseToolUse(event: OpencodeRawEvent): StandardEvent[] {
    const part = event.part;
    if (!part) return [];

    const toolName = normalizeToolName(part.tool || 'unknown');
    const callId = part.callID;
    const state = part.state;
    const events: StandardEvent[] = [];

    // Emit tool_start
    const toolStart: StandardEvent = {
      type: 'tool_start',
      toolName,
      toolInput: state?.input,
    };
    if (callId) {
      toolStart.toolUseId = callId;
    }
    events.push(toolStart);

    // Emit tool_result if state is present (completed tool)
    if (state) {
      const toolResult: StandardEvent = {
        type: 'tool_result',
        toolName,
        toolOutput: state.output || '',
      };
      if (callId) {
        toolResult.toolUseId = callId;
      }
      events.push(toolResult);
    }

    return events;
  }

  private parseStepFinish(event: OpencodeRawEvent): StandardEvent[] {
    const part = event.part;
    if (!part) return [];

    const events: StandardEvent[] = [];
    const tokens = part.tokens;

    // Emit usage_snapshot if token info is available
    if (tokens) {
      events.push({
        type: 'usage_snapshot',
        tokens: {
          input: tokens.input || 0,
          output: tokens.output || 0,
          cacheCreation: tokens.cache?.write || 0,
          cacheRead: tokens.cache?.read || 0,
        },
      });
    }

    // Emit step_complete
    const stepComplete: StandardEvent = {
      type: 'step_complete',
      cost: part.cost,
      tokens: tokens ? {
        input: tokens.input || 0,
        output: tokens.output || 0,
        cacheCreation: tokens.cache?.write || 0,
        cacheRead: tokens.cache?.read || 0,
      } : undefined,
    };

    // Include resultText for boss delegation parsing when the step ends normally.
    // Always set it so delegation parsing works, but the stdout-pipeline's
    // textEmittedInTurn guard will prevent duplicate output display.
    if (part.reason === 'stop' && this.lastTextContent) {
      stepComplete.resultText = this.lastTextContent;
    }

    events.push(stepComplete);

    // Reset text tracking for next turn
    this.lastTextContent = undefined;
    this.textEventEmittedInTurn = false;

    return events;
  }
}
