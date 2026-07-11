/**
 * Grok headless streaming-json event parser.
 * Maps NDJSON events from `grok -p … --output-format streaming-json` to StandardEvent.
 *
 * Documented event types: text, thought, end, error.
 * Also handles max_turns_reached / auto_compact_* defensively.
 *
 * Grok emits one tiny token per NDJSON line. The client only merges streaming
 * chunks when they share a `uuid`, so we mint a stable stream id per block
 * (text / thinking) for the turn and finalize with isStreaming=false on end.
 */

import { randomUUID } from 'crypto';
import type { StandardEvent } from '../claude/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GrokParser');

interface GrokRawEvent {
  type?: string;
  data?: string;
  message?: string;
  stopReason?: string;
  sessionId?: string;
  requestId?: string;
  text?: string;
}

export class GrokJsonEventParser {
  private lastTextContent = '';
  private lastThinkingContent = '';
  private textEventEmittedInTurn = false;
  /** Stable uuid so token-sized deltas merge into one terminal row. */
  private textStreamUuid: string | undefined;
  private thinkingStreamUuid: string | undefined;

  parseEvent(rawEvent: unknown): StandardEvent[] {
    const event = rawEvent as GrokRawEvent;
    if (!event || typeof event !== 'object' || !event.type) {
      return [];
    }

    log.log(`parseEvent: type=${event.type}, sessionId=${event.sessionId || 'none'}`);

    switch (event.type) {
      case 'text':
        return this.parseText(event);
      case 'thought':
        return this.parseThought(event);
      case 'end':
        return this.parseEnd(event);
      case 'error':
        return this.parseError(event);
      case 'max_turns_reached':
        return [{
          type: 'error',
          errorMessage: event.message || 'Max turns reached',
          sessionId: event.sessionId,
        }];
      default:
        // Unknown / telemetry events — ignore for UI, but keep the stream alive
        log.log(`parseEvent: unknown event type '${event.type}' - skipping`);
        return [];
    }
  }

  private ensureTextStreamUuid(): string {
    if (!this.textStreamUuid) {
      this.textStreamUuid = `grok-text-${randomUUID()}`;
    }
    return this.textStreamUuid;
  }

  private ensureThinkingStreamUuid(): string {
    if (!this.thinkingStreamUuid) {
      this.thinkingStreamUuid = `grok-thinking-${randomUUID()}`;
    }
    return this.thinkingStreamUuid;
  }

  private parseText(event: GrokRawEvent): StandardEvent[] {
    const chunk = event.data ?? event.text;
    if (!chunk) return [];

    this.lastTextContent += chunk;
    this.textEventEmittedInTurn = true;

    return [{
      type: 'text',
      text: chunk,
      isStreaming: true,
      uuid: this.ensureTextStreamUuid(),
      sessionId: event.sessionId,
    }];
  }

  private parseThought(event: GrokRawEvent): StandardEvent[] {
    const chunk = event.data ?? event.text;
    if (!chunk) return [];

    this.lastThinkingContent += chunk;

    return [{
      type: 'thinking',
      text: chunk,
      isStreaming: true,
      uuid: this.ensureThinkingStreamUuid(),
      sessionId: event.sessionId,
    }];
  }

  /**
   * Finalize open text/thinking streams and mint new uuids for the next
   * generation — WITHOUT step_complete (agent stays "working").
   *
   * Grok keeps one agentic turn across many tool rounds and does not emit
   * `end` between them. Without this break, every intermediate status line
   * concatenates into a single mashed bubble until the final end.
   */
  breakOpenStreams(sessionId?: string): StandardEvent[] {
    const events: StandardEvent[] = [];

    if (this.thinkingStreamUuid && this.lastThinkingContent) {
      events.push({
        type: 'thinking',
        text: this.lastThinkingContent,
        isStreaming: false,
        uuid: this.thinkingStreamUuid,
        sessionId,
      });
    }

    if (this.textStreamUuid && this.lastTextContent) {
      events.push({
        type: 'text',
        text: this.lastTextContent,
        isStreaming: false,
        uuid: this.textStreamUuid,
        sessionId,
      });
    }

    this.lastTextContent = '';
    this.lastThinkingContent = '';
    // Keep textEventEmittedInTurn so a later end/step_complete still knows
    // we produced text this turn (avoids empty-thinking fallback).
    this.textStreamUuid = undefined;
    this.thinkingStreamUuid = undefined;

    return events;
  }

  private parseEnd(event: GrokRawEvent): StandardEvent[] {
    // Finalize open streams (same as a tool-boundary break) then step_complete.
    const events = this.breakOpenStreams(event.sessionId);

    // breakOpenStreams cleared accumulators — re-read is not possible. Capture
    // resultText from the finalize events we just built.
    const finalizedText = events.find((e) => e.type === 'text' && e.text)?.text;
    const finalizedThinking = events.find((e) => e.type === 'thinking' && e.text)?.text;

    const stepComplete: StandardEvent = {
      type: 'step_complete',
      sessionId: event.sessionId,
    };

    if (finalizedText) {
      stepComplete.resultText = finalizedText;
    } else if (finalizedThinking && !this.textEventEmittedInTurn) {
      // Thinking-only turn — surface a marker so the terminal isn't blank
      stepComplete.resultText = `(Empty response: thinking only, stopReason=${event.stopReason || 'EndTurn'})`;
    }

    events.push(stepComplete);

    this.textEventEmittedInTurn = false;

    return events;
  }

  private parseError(event: GrokRawEvent): StandardEvent[] {
    return [{
      type: 'error',
      errorMessage: event.message || event.data || 'Grok CLI error',
      sessionId: event.sessionId,
    }];
  }
}
