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
  if (text.startsWith('Tool result:')) return false;
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
 * Hook to filter and enrich outputs based on view mode
 * - Advanced: show all outputs as-is
 * - Chat: show only user messages and final responses
 * - Simple: show tool names with key params, hide input/result details
 */
export function useFilteredOutputs({
  outputs,
  viewMode,
}: UseFilteredOutputsOptions): EnrichedOutput[] {
  return useMemo(() => {
    if (viewMode === 'advanced') return outputs;

    if (viewMode === 'chat') {
      return outputs.filter((output) => {
        if (output.isUserPrompt) return true;
        return output.text ? isChatViewOutput(output.text) : false;
      });
    }

    // Simple view: enrich tool lines with key parameters
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

        // Look ahead for tool input and output
        for (let j = i + 1; j < outputs.length && j <= i + 5; j++) {
          const nextOutput = outputs[j];
          if (nextOutput.text.startsWith('Tool input:')) {
            const inputJson = nextOutput.text.replace('Tool input:', '').trim();
            keyParam = extractToolKeyParam(toolName, inputJson);
            if (toolName === 'Edit') {
              try {
                const parsed = JSON.parse(inputJson);
                if (parsed.old_string !== undefined || parsed.new_string !== undefined) {
                  editData = {
                    oldString: parsed.old_string || '',
                    newString: parsed.new_string || '',
                    operation: typeof parsed.operation === 'string' ? parsed.operation : undefined,
                  };
                }
              } catch {
                /* ignore parse errors */
              }
            }
            // For TodoWrite, capture the full input so we can render it inline
            if (toolName === 'TodoWrite') {
              try {
                const parsed = JSON.parse(inputJson);
                if (Array.isArray(parsed.todos)) {
                  todoInputText = inputJson;
                }
              } catch {
                /* ignore parse errors */
              }
            }
            // For Bash, capture the full command
            if (toolName === 'Bash') {
              try {
                const parsed = JSON.parse(inputJson);
                if (parsed.command) {
                  bashCommand = parsed.command;
                }
              } catch {
                /* ignore parse errors */
              }
            }
          }
          // Capture Bash output
          if (toolName === 'Bash' && nextOutput.text.startsWith('Bash output:')) {
            bashOutput = nextOutput.text.replace('Bash output:', '').trim();
          }
          if (nextOutput.text.startsWith('Using tool:')) {
            break;
          }
        }

        if (toolName === 'Bash' && keyParam && keyParam.length > BASH_TRUNCATE_LENGTH) {
          keyParam = keyParam.substring(0, BASH_TRUNCATE_LENGTH - 3) + '...';
        }

        // For Bash: if no output captured yet, mark as running
        const isRunning = toolName === 'Bash' && !bashOutput;

        result.push({
          ...output,
          _toolKeyParam: keyParam || undefined,
          _editData: editData,
          _todoInput: todoInputText,
          _bashOutput: bashOutput,
          _bashCommand: bashCommand,
          _isRunning: isRunning,
        } as EnrichedOutput);
        continue;
      }

      if (isSimpleViewOutput(output.text)) {
        result.push(output);
      }
    }
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
