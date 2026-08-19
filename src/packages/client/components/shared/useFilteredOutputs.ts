/**
 * Shared hook for filtering outputs based on view mode
 * Used by both ClaudeOutputPanel (Guake) and CommanderView (AgentPanel)
 */

import { useMemo, useRef } from 'react';
import type { ClaudeOutput } from '../../store/types';
import { extractToolKeyParam } from '../../utils/outputRendering';
import { debugLog } from '../../services/agentDebugger';

// Edit data for file viewer
export interface EditData {
  oldString: string;
  newString: string;
  operation?: string;
  unifiedDiff?: string;
}

// Extended output type with tool enrichment
export type EnrichedOutput = ClaudeOutput & {
  _toolKeyParam?: string;
  _editData?: EditData;
  _todoInput?: string; // TodoWrite input JSON for inline rendering
  _bashOutput?: string; // Bash command output for modal display
  _bashCommand?: string; // Full bash command for display in modal
  _isRunning?: boolean; // True if bash command is still running (no output yet)
};

// Bash command truncation length in simple view
const BASH_TRUNCATE_LENGTH = 300;

/**
 * Helper to determine if output should be shown in simple view
 */
export function isSimpleViewOutput(text: string | undefined): boolean {
  if (!text) return false;
  // SHOW tool names (will render with nice icons)
  if (text.startsWith('Using tool:')) return true;

  // HIDE tool input/result details
  if (text.startsWith('Tool input:')) return false;
  if (text.startsWith('Tool result:')) {
    // EXCEPTION: AskUserQuestion result carries the user's actual answers,
    // which are otherwise invisible. The CLI formats the answer line with the
    // unique prefix "Your questions have been answered:".
    if (text.includes('Your questions have been answered:')) return true;
    return false;
  }
  if (text.startsWith('Bash output:')) return false; // Hide bash output in simple view (shown via modal)

  // HIDE stats and system messages
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return true;
  if (text.startsWith('[raw]')) return false;
  if (text.startsWith('Session started:')) return false;
  if (text.startsWith('Session initialized')) return false;

  // HIDE raw JSON tool parameters (common tool input fields)
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const toolParamKeys = [
      '"file_path"',
      '"command"',
      '"pattern"',
      '"path"',
      '"content"',
      '"old_string"',
      '"new_string"',
      '"query"',
      '"url"',
      '"prompt"',
      '"notebook_path"',
      '"description"',
      '"offset"',
      '"limit"',
    ];
    if (toolParamKeys.some((key) => trimmed.includes(key))) {
      return false;
    }
  }

  // SHOW everything else (Claude's text responses)
  return true;
}

/**
 * Helper to determine if output should be shown in chat view
 */
export function isChatViewOutput(text: string | undefined): boolean {
  if (!text) return false;
  // HIDE all tool-related messages
  if (text.startsWith('Using tool:')) return false;
  if (text.startsWith('Tool input:')) return false;
  if (text.startsWith('Tool result:')) return false;

  // HIDE stats and system messages
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return false;
  if (text.startsWith('[raw]')) return false;
  if (text.startsWith('Session started:')) return false;
  if (text.startsWith('Session initialized')) return false;

  // HIDE raw JSON tool parameters
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const toolParamKeys = [
      '"file_path"',
      '"command"',
      '"pattern"',
      '"path"',
      '"content"',
      '"old_string"',
      '"new_string"',
      '"query"',
      '"url"',
      '"prompt"',
      '"notebook_path"',
      '"description"',
      '"offset"',
      '"limit"',
    ];
    if (toolParamKeys.some((key) => trimmed.includes(key))) {
      return false;
    }
  }

  // HIDE intermediate reasoning/planning messages
  const intermediatePatterns = [
    /^(let me|i'll|i will|now i|first,? i|i need to|i should|i'm going to)/i,
    /^(looking at|reading|checking|searching|exploring|examining|investigating)/i,
    /^(based on|from what|according to|it (looks|seems|appears))/i,
    /^(this (shows|indicates|suggests|means|is))/i,
    /^(the (code|file|function|class|component|implementation))/i,
    /^(now (let|i))/i,
  ];

  if (intermediatePatterns.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  return true;
}

export type ViewMode = 'simple' | 'chat' | 'advanced';

interface UseFilteredOutputsOptions {
  outputs: ClaudeOutput[];
  viewMode: ViewMode;
}

/**
 * Sort live outputs by canonical 'created at' (timestamp) ascending, with
 * uuid lex ascending as the explicit tiebreaker. Falls back to original
 * insertion order for items that share both timestamp and uuid.
 *
 * Exported for tests and ad-hoc callers. The authoritative chronological sort
 * for the rendered Guake list is performed in VirtualizedOutputList, which
 * also merges history into the same time order — avoid calling this from
 * additional layers so we keep a single source-of-truth ordering.
 */
export function sortOutputsChronologically(outputs: ClaudeOutput[]): ClaudeOutput[] {
  const indexed = outputs.map((o, i) => ({ o, i }));
  indexed.sort((a, b) => {
    const ta = a.o.timestamp ?? 0;
    const tb = b.o.timestamp ?? 0;
    if (ta !== tb) return ta - tb;
    const ua = a.o.uuid ?? '';
    const ub = b.o.uuid ?? '';
    if (ua !== ub) return ua < ub ? -1 : 1;
    return a.i - b.i;
  });
  return indexed.map((x) => x.o);
}

/** Value equality for computed edit enrichment (a fresh object is parsed per pass). */
function editDataEquals(a: EditData | undefined, b: EditData | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.oldString === b.oldString
    && a.newString === b.newString
    && a.operation === b.operation
    && a.unifiedDiff === b.unifiedDiff;
}

// ─── Per-row JSON enrichment caches ──────────────────────────────────────────
// The simple-view enrichment pass reruns on EVERY outputs-array change — during
// word-streaming that's up to ~20×/s. Output objects are immutable (the store
// replaces, never mutates), so the expensive JSON.stringify/JSON.parse work per
// tool row is cached by object identity. WeakMaps let dropped rows GC normally.

interface ToolRowEnrichment {
  keyParam: string | null;
  editData?: EditData;
  todoInputText?: string;
  bashCommand?: string;
}

function computeToolRowEnrichment(toolName: string, inputJson: string, parsed: Record<string, unknown>): ToolRowEnrichment {
  const enrichment: ToolRowEnrichment = {
    keyParam: extractToolKeyParam(toolName, inputJson),
  };
  if (toolName === 'Edit') {
    if (parsed.old_string !== undefined || parsed.new_string !== undefined || parsed.unified_diff !== undefined) {
      enrichment.editData = {
        oldString: (parsed.old_string as string) || '',
        newString: (parsed.new_string as string) || '',
        operation: typeof parsed.operation === 'string' ? parsed.operation : undefined,
        unifiedDiff: typeof parsed.unified_diff === 'string' ? parsed.unified_diff : undefined,
      };
    }
  }
  if (toolName === 'TodoWrite' && Array.isArray((parsed as { todos?: unknown }).todos)) {
    enrichment.todoInputText = inputJson;
  }
  if (toolName === 'Bash') {
    const cmd = (parsed as { command?: unknown }).command;
    if (typeof cmd === 'string' && cmd) enrichment.bashCommand = cmd;
  }
  return enrichment;
}

/** "Using tool:" rows with a toolInput payload → computed once per row object. */
const payloadEnrichmentCache = new WeakMap<ClaudeOutput, ToolRowEnrichment>();

function getPayloadEnrichment(output: ClaudeOutput, toolName: string): ToolRowEnrichment | null {
  const cached = payloadEnrichmentCache.get(output);
  if (cached) return cached;
  try {
    const inputJson = JSON.stringify(output.toolInput);
    const enrichment = computeToolRowEnrichment(toolName, inputJson, output.toolInput as Record<string, unknown>);
    payloadEnrichmentCache.set(output, enrichment);
    return enrichment;
  } catch {
    return null;
  }
}

/** "Tool input: {...}" look-ahead rows → parsed once per (row object, toolName). */
const toolInputRowCache = new WeakMap<ClaudeOutput, { toolName: string; enrichment: ToolRowEnrichment | null }>();

function getToolInputRowEnrichment(row: ClaudeOutput, toolName: string, inputJson: string): ToolRowEnrichment | null {
  const cached = toolInputRowCache.get(row);
  if (cached && cached.toolName === toolName) return cached.enrichment;
  let enrichment: ToolRowEnrichment | null = null;
  try {
    const parsed = JSON.parse(inputJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      enrichment = computeToolRowEnrichment(toolName, inputJson, parsed as Record<string, unknown>);
    } else {
      enrichment = { keyParam: extractToolKeyParam(toolName, inputJson) };
    }
  } catch {
    // Malformed/partial JSON — key param extraction still handles raw strings.
    enrichment = { keyParam: extractToolKeyParam(toolName, inputJson) };
  }
  toolInputRowCache.set(row, { toolName, enrichment });
  return enrichment;
}

/**
 * Hook to filter and enrich outputs based on view mode
 * - Advanced: show all outputs as-is
 * - Chat: show only user messages and final responses
 * - Simple: show tool names with key params, hide input/result details
 */
export function useFilteredOutputs({
  outputs,
  viewMode,
}: UseFilteredOutputsOptions): EnrichedOutput[] {
  // Reuses the previous enriched object for a tool row when both the source
  // output identity and every computed enrichment field are unchanged — a
  // fresh `{ ...output }` per streamed chunk mints new identities that defeat
  // React.memo on every visible tool row downstream. Keyed by source object
  // identity (the store replaces output objects immutably, never mutates).
  // Rebuilt from scratch each pass, so it only ever holds entries for the
  // current outputs array — no growth across agents or after truncation.
  const enrichedToolCacheRef = useRef(new Map<ClaudeOutput, EnrichedOutput>());

  return useMemo(() => {
    if (viewMode === 'advanced') return outputs;

    if (viewMode === 'chat') {
      return outputs.filter((output) => {
        if (output.isUserPrompt) return true;
        return output.text ? isChatViewOutput(output.text) : false;
      });
    }

    // Simple view: enrich tool lines with key parameters
    //
    // Bash results are paired with their "Using tool: Bash" card by uuid when
    // both carry one (subagent tools: uuid = the subagent-internal tool_use
    // id). The positional look-ahead below stays as fallback for top-level
    // Bash, whose result rows have no uuid — but it must never match a
    // uuid-tagged result row from a DIFFERENT tool call (parallel subagents
    // interleave their cards and results).
    const bashOutputByUuid = new Map<string, string>();
    for (const o of outputs) {
      if (o.uuid && o.text && o.text.startsWith('Bash output:')) {
        bashOutputByUuid.set(o.uuid, o.text.replace('Bash output:', '').trim());
      }
    }

    const prevEnriched = enrichedToolCacheRef.current;
    const nextEnriched = new Map<ClaudeOutput, EnrichedOutput>();

    const result: EnrichedOutput[] = [];
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];

      if (output.isUserPrompt) {
        result.push(output);
        continue;
      }

      // Skip outputs without text
      if (!output.text) {
        result.push(output);
        continue;
      }

      if (output.text.startsWith('Using tool:')) {
        const toolName = output.text.replace('Using tool:', '').trim();

        let keyParam: string | null = null;
        let editData: EditData | undefined;
        let todoInputText: string | undefined;
        let bashOutput: string | undefined;
        let bashCommand: string | undefined;

        // Prefer payload toolInput (Grok upgrades the early tool card in-place with
        // full args on the same uuid — there may be no separate "Tool input:" row
        // with the full payload, or the sibling still shows "{}"). Cached per
        // row object — streaming re-passes don't re-stringify every payload.
        if (output.toolInput && typeof output.toolInput === 'object' && Object.keys(output.toolInput).length > 0) {
          const payload = getPayloadEnrichment(output, toolName);
          if (payload) {
            keyParam = payload.keyParam;
            if (payload.editData) editData = payload.editData;
            if (payload.todoInputText) todoInputText = payload.todoInputText;
            if (payload.bashCommand) bashCommand = payload.bashCommand;
          }
        }

        // Look ahead for tool input and output (use generous window; breaks at next "Using tool:")
        for (let j = i + 1; j < outputs.length && j <= i + 20; j++) {
          const nextOutput = outputs[j];
          if (nextOutput.text.startsWith('Tool input:')) {
            const inputJson = nextOutput.text.replace('Tool input:', '').trim();
            // Empty early "Tool input: {}" must not wipe payload-based enrichment.
            if (inputJson === '{}' || inputJson === '') {
              continue;
            }
            // Parsed once per row object — streaming re-passes hit the cache.
            const rowEnrichment = getToolInputRowEnrichment(nextOutput, toolName, inputJson);
            if (rowEnrichment) {
              if (rowEnrichment.keyParam) keyParam = rowEnrichment.keyParam;
              if (toolName === 'Edit' && rowEnrichment.editData) editData = rowEnrichment.editData;
              if (toolName === 'TodoWrite' && rowEnrichment.todoInputText) todoInputText = rowEnrichment.todoInputText;
              if (toolName === 'Bash' && rowEnrichment.bashCommand) bashCommand = rowEnrichment.bashCommand;
            }
          }
          // Capture Bash output. uuid-tagged result rows belong to a specific
          // tool call — only accept them for the matching card; untagged rows
          // (top-level Bash) keep the positional pairing.
          if (
            toolName === 'Bash'
            && nextOutput.text.startsWith('Bash output:')
            && (!nextOutput.uuid || nextOutput.uuid === output.uuid)
          ) {
            bashOutput = nextOutput.text.replace('Bash output:', '').trim();
          }
          if (nextOutput.text.startsWith('Using tool:')) {
            break;
          }
        }

        if (toolName === 'Bash' && keyParam && keyParam.length > BASH_TRUNCATE_LENGTH) {
          keyParam = keyParam.substring(0, BASH_TRUNCATE_LENGTH - 3) + '...';
        }

        // Exact uuid pairing wins over the positional look-ahead (essential
        // for subagent Bash cards, whose results can land far away in the
        // stream when several subagents run in parallel).
        if (toolName === 'Bash' && output.uuid && bashOutputByUuid.has(output.uuid)) {
          bashOutput = bashOutputByUuid.get(output.uuid);
        }

        // For Bash: if no output captured yet, mark as running
        const isRunning = toolName === 'Bash' && !bashOutput;

        // Match OutputLine's early-tool guard here, before virtualization. A
        // tool_started event with `{}` renders null until its args arrive; if
        // it remains in the virtual list, the virtualizer reserves an estimated
        // row and later measures it as 0px, forcing a visible bottom correction
        // during agent switches.
        const payloadInput = output.toolInput;
        const earlyEmptyInput = !payloadInput
          || (typeof payloadInput === 'object'
            && !Array.isArray(payloadInput)
            && Object.keys(payloadInput).length === 0);
        const hasLookAheadArgs = !!(keyParam || bashCommand || editData || todoInputText);
        if (earlyEmptyInput && !hasLookAheadArgs) continue;

        const toolKeyParam = keyParam || undefined;
        const cached = prevEnriched.get(output);
        const enriched: EnrichedOutput = cached
          && cached._toolKeyParam === toolKeyParam
          && editDataEquals(cached._editData, editData)
          && cached._todoInput === todoInputText
          && cached._bashOutput === bashOutput
          && cached._bashCommand === bashCommand
          && cached._isRunning === isRunning
          ? cached
          : ({
              ...output,
              _toolKeyParam: toolKeyParam,
              _editData: editData,
              _todoInput: todoInputText,
              _bashOutput: bashOutput,
              _bashCommand: bashCommand,
              _isRunning: isRunning,
            } as EnrichedOutput);
        nextEnriched.set(output, enriched);
        result.push(enriched);
        continue;
      }

      if (isSimpleViewOutput(output.text)) {
        result.push(output);
      }
    }
    enrichedToolCacheRef.current = nextEnriched;
    return result;
  }, [outputs, viewMode]);
}

/**
 * Wrapper hook that adds debug logging for filtered outputs
 */
export function useFilteredOutputsWithLogging({
  outputs,
  viewMode,
}: UseFilteredOutputsOptions): EnrichedOutput[] {
  const prevInputLenRef = useRef(0);
  const prevOutputLenRef = useRef(0);

  const filtered = useFilteredOutputs({ outputs, viewMode });

  // Log when input or output changes
  if (outputs.length !== prevInputLenRef.current || filtered.length !== prevOutputLenRef.current) {
    const lastOutput = outputs.length > 0 ? outputs[outputs.length - 1] : null;
    const lastInputText = lastOutput?.text ? lastOutput.text.slice(0, 40) : null;
    debugLog.info(`Filter: in=${outputs.length} out=${filtered.length} mode=${viewMode}`, {
      inputLen: outputs.length,
      outputLen: filtered.length,
      viewMode,
      lastInput: lastInputText,
    }, 'useFilteredOutputs');
    prevInputLenRef.current = outputs.length;
    prevOutputLenRef.current = filtered.length;
  }

  return filtered;
}
