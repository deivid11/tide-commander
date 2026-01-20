/**
 * View filtering utilities for CommanderView
 * Determines which messages/outputs to show based on view mode
 */

import type { HistoryMessage } from './types';
import type { ClaudeOutput } from '../../store';
import { isHumanReadableOutput } from '../../utils/outputRendering';

/**
 * Filter history messages based on view mode
 * Simple view: only user and assistant messages
 * Advanced view: all messages including tool_use and tool_result
 */
export function filterHistoryMessages(
  messages: HistoryMessage[],
  advancedView: boolean
): HistoryMessage[] {
  if (advancedView) {
    return messages;
  }
  return messages.filter(msg => msg.type === 'user' || msg.type === 'assistant');
}

/**
 * Filter live outputs based on view mode
 * Simple view: only user prompts and human-readable output
 * Advanced view: all outputs
 */
export function filterOutputs(
  outputs: ClaudeOutput[],
  advancedView: boolean
): ClaudeOutput[] {
  if (advancedView) {
    return outputs;
  }
  return outputs.filter(output => output.isUserPrompt || isHumanReadableOutput(output.text));
}

/**
 * Check if a message should be shown in simple view
 */
export function isSimpleViewMessage(message: HistoryMessage): boolean {
  return message.type === 'user' || message.type === 'assistant';
}

/**
 * Check if an output should be shown in simple view
 */
export function isSimpleViewOutput(output: ClaudeOutput): boolean {
  return output.isUserPrompt || isHumanReadableOutput(output.text);
}
