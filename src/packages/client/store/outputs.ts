/**
 * Output Store Actions
 *
 * Handles agent output management.
 */

import type { StoreState, AgentOutput, LastPrompt } from './types';
import { perf } from '../utils/profiling';
import { debugLog } from '../services/agentDebugger';

const MAX_OUTPUTS_PER_AGENT = 200;

function enforceOutputBufferLimits(outputs: AgentOutput[]): AgentOutput[] {
  if (outputs.length <= MAX_OUTPUTS_PER_AGENT) {
    return outputs;
  }

  return outputs.slice(-MAX_OUTPUTS_PER_AGENT);
}

function toolInputEquals(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length === 0 && bKeys.length === 0) return true;
  if (aKeys.length !== bKeys.length) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isSameOutputEvent(a: AgentOutput, b: AgentOutput): boolean {
  return a.uuid === b.uuid
    && a.text === b.text
    && a.isStreaming === b.isStreaming
    && a.isUserPrompt === b.isUserPrompt
    && a.isDelegation === b.isDelegation
    && a.subagentName === b.subagentName
    && a.toolName === b.toolName
    && a.toolOutput === b.toolOutput
    && a.isError === b.isError
    // Grok re-emits the same "Using tool: X" uuid with empty then full toolInput.
    // Without this, the upgrade is treated as an exact resend and the merge
    // path below never runs — chips stay empty and the UI hides them forever.
    && toolInputEquals(a.toolInput, b.toolInput);
}

/**
 * Mark open stream rows as complete. Grok/Claude sometimes never emit the
 * isStreaming:false finalize (missed tool boundary / side-channel race), which
 * leaves thinking cards stuck with a caret + raw markdown forever.
 */
export function settleStreamingOutputs(
  outputs: AgentOutput[],
  opts?: { exceptUuid?: string },
): AgentOutput[] {
  let changed = false;
  const next = outputs.map((o) => {
    if (!o.isStreaming) return o;
    if (opts?.exceptUuid && o.uuid && o.uuid === opts.exceptUuid) return o;
    changed = true;
    return { ...o, isStreaming: false };
  });
  return changed ? next : outputs;
}

function looksLikeToolCard(output: AgentOutput): boolean {
  if (output.toolName) return true;
  const t = output.text || '';
  return t.startsWith('Using tool:') || t.startsWith('Tool input:');
}

// ─── Server clock alignment ──────────────────────────────────────────────────
// Agent/response outputs are timestamped by the SERVER, but optimistic
// client-side items (the user's own prompt) are stamped with the local clock.
// On mobile the device clock can differ from the server's by seconds, which
// makes the optimistic user prompt sort AFTER the server-stamped agent
// responses — it appears at the bottom while the later replies float above it.
// We estimate the server↔client offset from server-stamped outputs and stamp
// optimistic items in the server's time domain so the chronological merge sort
// (VirtualizedOutputList) stays correct regardless of device-clock skew.
let serverClockOffsetMs = 0;
let hasServerClockSample = false;

/** Record a known server timestamp (epoch ms) to refine the clock offset. */
export function noteServerTimestamp(serverTimestampMs: number | undefined): void {
  if (typeof serverTimestampMs !== 'number' || !Number.isFinite(serverTimestampMs) || serverTimestampMs <= 0) return;
  // Network latency makes the sample slightly old, which is negligible next to
  // the multi-second device-clock skew this corrects. Last-write-wins is fine.
  serverClockOffsetMs = serverTimestampMs - Date.now();
  hasServerClockSample = true;
}

/** Best estimate of the server's 'now' in epoch ms (falls back to local clock). */
export function serverNow(): number {
  return hasServerClockSample ? Date.now() + serverClockOffsetMs : Date.now();
}

export interface OutputActions {
  addOutput(agentId: string, output: AgentOutput): void;
  /** Attach a tool result to its existing live tool-use card. */
  attachToolResult(agentId: string, toolUseId: string, toolOutput: string): void;
  clearOutputs(agentId: string): void;
  /** Force any open isStreaming rows for this agent to settle (e.g. agent went idle). */
  settleOpenStreams(agentId: string): void;
  getOutputs(agentId: string): AgentOutput[];
  addUserPromptToOutput(agentId: string, command: string, opts?: { pendingEcho?: boolean }): void;
  /**
   * Resolve an optimistic (pendingEcho) user prompt when the server's
   * command_started echo arrives. Adopts the server's text (which may wrap the
   * raw prompt with [@file:]/boss context) so later history-refetch dedup keys
   * match. Returns false when no pending prompt matches — the echo then
   * belongs to a command sent from another client and must be appended.
   */
  confirmUserPromptEcho(agentId: string, serverCommand: string): boolean;
  getLastPrompt(agentId: string): LastPrompt | undefined;
  setLastPrompt(agentId: string, text: string): void;
  /** Preserve current outputs before reconnect - returns snapshot to restore later */
  preserveOutputs(): Map<string, AgentOutput[]>;
  /** Merge preserved outputs with history */
  mergeOutputsWithHistory(
    agentId: string,
    historyMessages: AgentOutput[],
    preservedOutputs: AgentOutput[]
  ): AgentOutput[];
}

// Streaming text deltas arrive many times per second and every notify() fans
// out synchronously to all mounted selector hooks. Coalesce addOutput
// notifications: state is mutated immediately (reads are always current), the
// first chunk notifies synchronously, and further chunks inside the window
// share a single trailing notify.
const OUTPUT_NOTIFY_WINDOW_MS = 50;

export function createOutputActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getListenerCount: () => number
): OutputActions {
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  let notifyPending = false;

  const scheduleNotify = (): void => {
    if (notifyTimer !== null) {
      notifyPending = true;
      return;
    }
    notify();
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      if (notifyPending) {
        notifyPending = false;
        scheduleNotify();
      }
    }, OUTPUT_NOTIFY_WINDOW_MS);
  };

  return {
    addOutput(agentId: string, output: AgentOutput): void {
      perf.start('store:addOutput');
      const listenerCount = getListenerCount();

      // IMPORTANT: All state reads and mutations must happen inside setState
      // to avoid race conditions when multiple outputs arrive rapidly
      setState((s) => {
        let currentOutputs = s.agentOutputs.get(agentId) || [];

        // Tool cards / non-stream finals mean prior text/thinking streams are done.
        // Without this, Grok thinking rows can stay isStreaming forever (caret + raw MD).
        if (looksLikeToolCard(output) || (!output.isStreaming && !output.isUserPrompt)) {
          currentOutputs = settleStreamingOutputs(currentOutputs, {
            exceptUuid: output.uuid,
          });
        }
        // A brand-new stream uuid also closes any other open streams.
        if (output.isStreaming && output.uuid) {
          const hasSame = currentOutputs.some((o) => o.uuid === output.uuid);
          if (!hasSame) {
            currentOutputs = settleStreamingOutputs(currentOutputs);
          }
        }

        // DEDUPLICATION: UUIDs identify a message/tool block, not always a
        // single WebSocket output. Claude text deltas reuse the same UUID, so
        // streaming chunks must be merged instead of dropped.
        if (output.uuid) {
          const existingIndex = currentOutputs.findIndex(existing => existing.uuid === output.uuid);
          if (existingIndex >= 0) {
            const existing = currentOutputs[existingIndex];

            if (existing.isStreaming || output.isStreaming) {
              const updatedOutputs = [...currentOutputs];
              updatedOutputs[existingIndex] = output.isStreaming
                ? {
                    ...existing,
                    text: existing.text + output.text,
                    isStreaming: true,
                    skillUpdate: output.skillUpdate ?? existing.skillUpdate,
                    subagentName: output.subagentName ?? existing.subagentName,
                    toolName: output.toolName ?? existing.toolName,
                    toolInput: output.toolInput ?? existing.toolInput,
                    toolOutput: output.toolOutput ?? existing.toolOutput,
                    isError: output.isError ?? existing.isError,
                  }
                : {
                    ...existing,
                    ...output,
                    // Keep the original timestamp so the in-progress row does
                    // not jump to the end again when the final message arrives.
                    timestamp: existing.timestamp,
                    isStreaming: false,
                  };

              const limitedOutputs = enforceOutputBufferLimits(updatedOutputs);
              const newAgentOutputs = new Map(s.agentOutputs);
              newAgentOutputs.set(agentId, limitedOutputs);
              s.agentOutputs = newAgentOutputs;
              return;
            }

            if (isSameOutputEvent(existing, output)) {
              // Exact resend - skip.
              return;
            }

            // Grok early tool_start cards arrive with empty toolInput; when the
            // chat_history line lands we re-emit the same uuid with full args.
            // Merge into the existing row instead of stacking a duplicate chip.
            const existingIsToolStart = typeof existing.text === 'string' && existing.text.startsWith('Using tool:');
            const incomingIsToolStart = typeof output.text === 'string' && output.text.startsWith('Using tool:');
            const existingInputEmpty = !existing.toolInput || Object.keys(existing.toolInput).length === 0;
            const incomingHasInput = !!output.toolInput && Object.keys(output.toolInput).length > 0;
            if (existingIsToolStart && incomingIsToolStart && existingInputEmpty && incomingHasInput) {
              const updatedOutputs = [...currentOutputs];
              updatedOutputs[existingIndex] = {
                ...existing,
                ...output,
                timestamp: existing.timestamp,
                text: existing.text || output.text,
                toolName: output.toolName ?? existing.toolName,
                toolInput: output.toolInput,
              };
              const limitedOutputs = enforceOutputBufferLimits(updatedOutputs);
              const newAgentOutputs = new Map(s.agentOutputs);
              newAgentOutputs.set(agentId, limitedOutputs);
              s.agentOutputs = newAgentOutputs;
              return;
            }

            // Same uuid "Tool input: {...}" after an empty early "Using tool:" —
            // fold args onto the chip (still append the Tool input row so
            // advanced view / look-ahead keep working).
            const incomingIsToolInput = typeof output.text === 'string' && output.text.startsWith('Tool input:');
            if (existingIsToolStart && incomingIsToolInput && existingInputEmpty) {
              let parsedInput: Record<string, unknown> | undefined = output.toolInput;
              if (!parsedInput || Object.keys(parsedInput).length === 0) {
                try {
                  const raw = output.text.replace(/^Tool input:\s*/, '').trim();
                  if (raw && raw !== '{}') {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      parsedInput = parsed as Record<string, unknown>;
                    }
                  }
                } catch {
                  /* ignore */
                }
              }
              if (parsedInput && Object.keys(parsedInput).length > 0) {
                const updatedOutputs = [...currentOutputs];
                updatedOutputs[existingIndex] = {
                  ...existing,
                  toolInput: parsedInput,
                  toolName: output.toolName ?? existing.toolName,
                };
                // Fall through to also append the Tool input row itself.
                const withMerged = enforceOutputBufferLimits([...updatedOutputs, output]);
                const newAgentOutputs = new Map(s.agentOutputs);
                newAgentOutputs.set(agentId, withMerged);
                s.agentOutputs = newAgentOutputs;
                return;
              }
            }

            // Same UUID with different non-streaming text is valid for tool
            // blocks such as "Using tool:" followed by "Tool input:".
            // Fall through and append it as a distinct output row.
          }
        }

        // Create NEW array with the new output appended (immutable update for React reactivity)
        const newOutputs = enforceOutputBufferLimits([...currentOutputs, output]);

        debugLog.info(`Store: ${currentOutputs.length} -> ${newOutputs.length}`, {
          agentId,
          text: output.text.slice(0, 60),
          isStreaming: output.isStreaming,
          listeners: listenerCount,
        }, 'store:addOutput');

        const newAgentOutputs = new Map(s.agentOutputs);
        newAgentOutputs.set(agentId, newOutputs);
        s.agentOutputs = newAgentOutputs;
      });

      scheduleNotify();
      perf.end('store:addOutput');
    },

    attachToolResult(agentId: string, toolUseId: string, toolOutput: string): void {
      if (!toolUseId) return;
      let changed = false;
      setState((s) => {
        const currentOutputs = s.agentOutputs.get(agentId);
        if (!currentOutputs) return;

        // A tool invocation may also have a legacy "Tool input:" sibling with
        // the same uuid. Enrich the semantic "Using tool:" card only.
        const index = currentOutputs.findIndex((output) =>
          output.uuid === toolUseId && output.text.startsWith('Using tool:')
        );
        if (index < 0 || currentOutputs[index].toolOutput === toolOutput) return;

        const updatedOutputs = [...currentOutputs];
        updatedOutputs[index] = {
          ...updatedOutputs[index],
          toolOutput,
          isStreaming: false,
        };
        const newAgentOutputs = new Map(s.agentOutputs);
        newAgentOutputs.set(agentId, updatedOutputs);
        s.agentOutputs = newAgentOutputs;
        changed = true;
      });
      if (changed) scheduleNotify();
    },

    clearOutputs(agentId: string): void {
      setState((state) => {
        const newAgentOutputs = new Map(state.agentOutputs);
        newAgentOutputs.delete(agentId);
        state.agentOutputs = newAgentOutputs;
      });
      notify();
    },

    settleOpenStreams(agentId: string): void {
      let changed = false;
      setState((s) => {
        const current = s.agentOutputs.get(agentId);
        if (!current || current.length === 0) return;
        const settled = settleStreamingOutputs(current);
        if (settled === current) return;
        const newAgentOutputs = new Map(s.agentOutputs);
        newAgentOutputs.set(agentId, settled);
        s.agentOutputs = newAgentOutputs;
        changed = true;
      });
      if (changed) notify();
    },

    getOutputs(agentId: string): AgentOutput[] {
      return getState().agentOutputs.get(agentId) || [];
    },

    addUserPromptToOutput(agentId: string, command: string, opts?: { pendingEcho?: boolean }): void {
      this.addOutput(agentId, {
        text: command,
        isStreaming: false,
        // Stamp in the server's time domain so the optimistic prompt stays
        // correctly ordered against server-timestamped agent responses, even
        // when this device's clock differs from the server's (e.g. on mobile).
        timestamp: serverNow(),
        isUserPrompt: true,
        ...(opts?.pendingEcho ? { pendingEcho: true } : {}),
      });
    },

    confirmUserPromptEcho(agentId: string, serverCommand: string): boolean {
      const server = serverCommand.trim();
      if (server.length === 0) return false;
      let confirmed = false;

      setState((s) => {
        const outputs = s.agentOutputs.get(agentId);
        if (!outputs || outputs.length === 0) return;

        // Exact-text match first so multiple in-flight prompts resolve FIFO
        // against their own echo; fall back to containment because the server
        // side may have wrapped the raw prompt this client rendered (expanded
        // [@file:]/[@folder:] mentions, boss context, property notifications).
        let idx = outputs.findIndex((o) => o.pendingEcho && o.text.trim() === server);
        if (idx < 0) {
          idx = outputs.findIndex((o) => o.pendingEcho && o.text.trim().length > 0 && server.includes(o.text.trim()));
        }
        if (idx < 0) return;

        const next = [...outputs];
        // Adopt the server's canonical text so the text-key dedup in
        // useHistoryLoader matches what the session history will contain.
        next[idx] = { ...next[idx], text: serverCommand, pendingEcho: undefined };

        const newAgentOutputs = new Map(s.agentOutputs);
        newAgentOutputs.set(agentId, next);
        s.agentOutputs = newAgentOutputs;
        confirmed = true;
      });

      if (confirmed) notify();
      return confirmed;
    },

    getLastPrompt(agentId: string): LastPrompt | undefined {
      return getState().lastPrompts.get(agentId);
    },

    setLastPrompt(agentId: string, text: string): void {
      setState((state) => {
        state.lastPrompts.set(agentId, {
          text,
          timestamp: Date.now(),
        });
      });
      notify();
    },

    preserveOutputs(): Map<string, AgentOutput[]> {
      const state = getState();
      const snapshot = new Map<string, AgentOutput[]>();
      for (const [agentId, outputs] of state.agentOutputs) {
        snapshot.set(agentId, outputs.map(o => ({ ...o })));
      }
      return snapshot;
    },

    mergeOutputsWithHistory(
      agentId: string,
      historyMessages: AgentOutput[],
      preservedOutputs: AgentOutput[]
    ): AgentOutput[] {
      // Just concatenate and sort by timestamp - no dedup
      let merged = [...historyMessages, ...preservedOutputs];
      merged.sort((a, b) => a.timestamp - b.timestamp);
      merged = enforceOutputBufferLimits(merged);

      setState((s) => {
        const newAgentOutputs = new Map(s.agentOutputs);
        newAgentOutputs.set(agentId, merged);
        s.agentOutputs = newAgentOutputs;
      });
      notify();

      return merged;
    },
  };
}
