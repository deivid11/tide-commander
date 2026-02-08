/**
 * Claude Code CLI Backend
 * Handles argument building and event parsing for Claude Code CLI
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type {
  CLIBackend,
  BackendConfig,
  StandardEvent,
  ClaudeRawEvent,
} from './types.js';
import { createLogger, sanitizeUnicode } from '../utils/index.js';
import { TIDE_COMMANDER_APPENDED_PROMPT } from '../prompts/tide-commander.js';

const log = createLogger('Backend');

// Track tool_use_id to tool_name mapping for matching tool_result events
// This is a module-level map that persists across parseEvent calls
const toolUseIdToName: Map<string, string> = new Map();

/**
 * Write prompt content to a temp file for use with --system-prompt-file / --append-system-prompt-file
 * This avoids issues with multiline prompts and shell escaping
 */
function writePromptToFile(prompt: string, agentId?: string): string {
  const tideDataDir = path.join(os.homedir(), '.tide-commander', 'prompts');
  if (!fs.existsSync(tideDataDir)) {
    fs.mkdirSync(tideDataDir, { recursive: true });
  }
  const filename = agentId ? `prompt-${agentId}.md` : `prompt-${Date.now()}.md`;
  const promptPath = path.join(tideDataDir, filename);
  fs.writeFileSync(promptPath, prompt, 'utf-8');
  log.log(` Wrote prompt (${prompt.length} chars) to ${promptPath}`);
  return promptPath;
}

export class ClaudeBackend implements CLIBackend {
  readonly name = 'claude';

  /**
   * Build CLI arguments for Claude Code
   */
  buildArgs(config: BackendConfig): string[] {
    const args: string[] = [];

    log.log(` buildArgs called: sessionId=${config.sessionId ? 'yes' : 'no'}, customAgent=${config.customAgent ? config.customAgent.name : 'no'}, systemPrompt=${config.systemPrompt ? 'yes' : 'no'}`);

    // Core output format for streaming JSON
    args.push('--print');
    args.push('--verbose');
    args.push('--output-format', 'stream-json');
    args.push('--input-format', 'stream-json');

    // Resume existing session if available
    if (config.sessionId) {
      args.push('--resume', config.sessionId);
    }

    // Permission mode - bypass for autonomous agents, interactive uses hooks
    if (config.permissionMode === 'bypass') {
      args.push('--dangerously-skip-permissions');
    } else if (config.permissionMode === 'interactive') {
      // For interactive mode, configure the PreToolUse hook to ask for permission
      // The hook script calls the Tide Commander server which shows UI for approval
      const hookPath = path.join(process.cwd(), 'hooks', 'permission-hook.sh');
      const hookSettings = {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: hookPath,
                  timeout: 300, // 5 minute timeout for user response
                },
              ],
            },
          ],
        },
      };
      // Write settings to a temp file to avoid shell escaping issues
      const tideDataDir = path.join(os.homedir(), '.tide-commander');
      if (!fs.existsSync(tideDataDir)) {
        fs.mkdirSync(tideDataDir, { recursive: true });
      }
      const settingsPath = path.join(tideDataDir, 'hook-settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify(hookSettings, null, 2));
      args.push('--settings', settingsPath);
    }

    // Model selection
    if (config.model) {
      args.push('--model', config.model);
    }

    // Chrome browser mode
    if (config.useChrome) {
      args.push('--chrome');
    }

    // Custom agent instructions (class instructions + skills)
    // Write prompt to file and use --append-system-prompt-file
    // This appends to Claude's default system prompt rather than replacing it
    if (config.customAgent) {
      const prompt = config.customAgent.definition?.prompt;
      log.log(` customAgent detected: name=${config.customAgent.name}, hasDefinition=${!!config.customAgent.definition}, prompt=${prompt ? `${prompt.length} chars` : 'EMPTY/UNDEFINED'}`);
      if (prompt) {
        const promptFile = writePromptToFile(prompt, config.customAgent.name);
        log.log(` Adding customAgent prompt via file (${prompt.length} chars)`);
        args.push('--append-system-prompt-file', promptFile);
      } else {
        log.log(` WARNING: customAgent has no prompt!`);
      }
    }

    // System prompt for boss agents or custom context
    // Write prompt to file and use --append-system-prompt-file
    // This appends to Claude's default system prompt rather than replacing it
    if (config.systemPrompt && !config.customAgent) {
      const promptFile = writePromptToFile(config.systemPrompt, config.agentId);
      log.log(` Adding systemPrompt via file (${config.systemPrompt.length} chars)`);
      args.push('--append-system-prompt-file', promptFile);
    }

    // Tide Commander enforced prompt additions (always appended last so rules win).
    const tidePromptFile = writePromptToFile(TIDE_COMMANDER_APPENDED_PROMPT, `${config.agentId || 'agent'}-tide`);
    args.push('--append-system-prompt-file', tidePromptFile);

    return args;
  }

  /**
   * Parse Claude CLI raw event into normalized StandardEvent
   */
  parseEvent(rawEvent: unknown): StandardEvent | StandardEvent[] | null {
    const event = rawEvent as ClaudeRawEvent;

    // Log ALL events to understand what we're receiving
    log.log(`parseEvent: type=${event.type}, subtype=${event.subtype || 'none'}, tool_name=${event.tool_name || 'n/a'}`);

    // Log assistant events with tool_use blocks
    if (event.type === 'assistant' && event.message?.content) {
      const toolUseBlocks = event.message.content.filter((b: any) => b.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        log.log(`parseEvent: assistant message has ${toolUseBlocks.length} tool_use block(s): ${toolUseBlocks.map((b: any) => b.name).join(', ')}`);
      }
    }

    let result: StandardEvent | StandardEvent[] | null = null;

    switch (event.type) {
      case 'system':
        result = this.parseSystemEvent(event);
        break;

      case 'assistant':
        result = this.parseAssistantEvent(event);
        break;

      case 'tool_use':
        result = this.parseToolUseEvent(event);
        break;

      case 'result':
        result = this.parseResultEvent(event);
        break;

      case 'stream_event':
        result = this.parseStreamEvent(event);
        break;

      case 'user':
        result = this.parseUserEvent(event);
        break;

      default:
        log.log(`parseEvent: UNKNOWN event type '${event.type}' - not handled`);
        result = null;
    }

    if (result === null && event.type !== 'assistant') {
      // Log when we're dropping events (assistant events may return null for text-only content)
      log.log(`parseEvent: returned NULL for type=${event.type}, subtype=${event.subtype || 'none'}`);
    }

    return result;
  }

  private parseUserEvent(event: ClaudeRawEvent): StandardEvent | StandardEvent[] | null {
    const message = event.message as { content?: string | Array<{ type: string; content?: string; tool_use_id?: string }> };

    // Handle array content (tool_result blocks)
    if (Array.isArray(message?.content)) {
      const toolResults: StandardEvent[] = [];
      for (const block of message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          // Prefer tool_use_result.stdout (raw output) over block.content (may be truncated)
          let content: string;
          if (event.tool_use_result?.stdout !== undefined) {
            // Combine stdout and stderr if both present
            content = event.tool_use_result.stdout;
            if (event.tool_use_result.stderr) {
              content += (content ? '\n' : '') + '[stderr] ' + event.tool_use_result.stderr;
            }
          } else {
            content = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          }
          // Look up the tool name from the tool_use_id mapping
          const toolName = toolUseIdToName.get(block.tool_use_id) || 'unknown';
          log.log(`parseUserEvent: Found tool_result for tool_use_id=${block.tool_use_id}, toolName=${toolName}, content length=${content?.length || 0}, hasToolUseResult=${!!event.tool_use_result}`);
          toolResults.push({
            type: 'tool_result',
            toolName,
            toolOutput: content,
            toolUseId: block.tool_use_id, // Preserve for subagent correlation
          });
          // Clean up the mapping after use (tool_use_id is unique per invocation)
          toolUseIdToName.delete(block.tool_use_id);
        }
      }
      if (toolResults.length > 0) {
        log.log(`parseUserEvent: Extracted ${toolResults.length} tool_result(s)`);
        return toolResults.length === 1 ? toolResults[0] : toolResults;
      }
    }

    // Check for local-command-stdout (from /context, /cost, /usage etc. commands)
    if (typeof message?.content === 'string' && message.content.includes('<local-command-stdout>')) {
      // Extract content between tags
      const match = message.content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
      if (match) {
        const content = match[1];
        // Check if this is /context output
        if (content.includes('## Context Usage') || content.includes('**Model:**')) {
          log.log(`parseUserEvent: Found /context output`);
          return {
            type: 'context_stats',
            contextStatsRaw: content,
          };
        }
        // Check if this is /usage output
        if (content.includes('## Usage') || content.includes('Current Session')) {
          log.log(`parseUserEvent: Found /usage output`);
          return {
            type: 'usage_stats',
            usageStatsRaw: content,
          };
        }
      }
    }
    return null;
  }

  private parseSystemEvent(event: ClaudeRawEvent): StandardEvent | null {
    if (event.subtype === 'init') {
      console.log(`[Backend] parseSystemEvent init: tools=${JSON.stringify(event.tools)}, agents=${JSON.stringify((event as any).agents)}`);
      return {
        type: 'init',
        sessionId: event.session_id,
        model: event.model,
        tools: event.tools,
      };
    }
    if (event.subtype === 'error' && event.error) {
      return {
        type: 'error',
        errorMessage: event.error,
      };
    }
    return null;
  }

  private parseAssistantEvent(event: ClaudeRawEvent): StandardEvent | StandardEvent[] | null {
    // Check for content blocks in assistant message
    // Claude CLI sends both text and tool_use as content blocks within assistant events
    if (event.message?.content && Array.isArray(event.message.content)) {
      const events: StandardEvent[] = [];
      // Use event UUID if available (unique identifier from Claude)
      const uuid = event.uuid;

      // Extract text blocks - emit as non-streaming final text
      // This ensures text is captured even if streaming deltas were missed
      const textBlocks = event.message.content.filter((b: any) => b.type === 'text');
      for (const block of textBlocks) {
        if (block.text && block.text.trim()) {
          events.push({
            type: 'text' as const,
            text: block.text,
            isStreaming: false, // Mark as final, non-streaming text
            uuid, // Add message UUID for deduplication
          });
        }
      }

      // Extract tool_use blocks
      const toolUseBlocks = event.message.content.filter((b: any) => b.type === 'tool_use');
      for (const block of toolUseBlocks) {
        const toolName = block.name || 'unknown';
        // Store tool_use_id to name mapping for later tool_result matching
        if (block.id) {
          toolUseIdToName.set(block.id, toolName);
          log.log(`parseAssistantEvent: Stored mapping ${block.id} -> ${toolName}`);
        }
        const toolEvent: StandardEvent = {
          type: 'tool_start' as const,
          toolName,
          toolInput: block.input,
          toolUseId: block.id,
          uuid: block.id, // tool_use block has unique ID for deduplication
        };
        // Extract subagent metadata from Task tool inputs
        if (toolName === 'Task' && block.input) {
          const input = block.input as Record<string, unknown>;
          toolEvent.subagentName = (input.name as string) || (input.description as string) || 'Subagent';
          toolEvent.subagentDescription = (input.description as string) || '';
          toolEvent.subagentType = (input.subagent_type as string) || 'general-purpose';
          toolEvent.subagentModel = (input.model as string) || undefined;
          log.log(`parseAssistantEvent: Task tool detected - name="${toolEvent.subagentName}", type="${toolEvent.subagentType}", model="${toolEvent.subagentModel || 'inherit'}"`);
        }
        events.push(toolEvent);
      }

      if (events.length > 0) {
        log.log(`parseAssistantEvent: extracted ${textBlocks.length} text block(s) and ${toolUseBlocks.length} tool_use block(s), uuid=${uuid}`);
        return events.length === 1 ? events[0] : events;
      }
    }

    return null;
  }

  private parseToolUseEvent(event: ClaudeRawEvent): StandardEvent | null {
    const toolName = event.tool_name || 'unknown';

    log.log(`parseToolUseEvent: tool=${toolName}, subtype=${event.subtype}, hasInput=${!!event.input}, hasResult=${!!event.result}`);

    if (event.subtype === 'input' && event.input) {
      log.log(`  -> Emitting tool_start for ${toolName}`);
      return {
        type: 'tool_start',
        toolName,
        toolInput: event.input,
      };
    } else if (event.subtype === 'result') {
      const output =
        typeof event.result === 'string'
          ? event.result
          : JSON.stringify(event.result);
      log.log(`  -> Emitting tool_result for ${toolName}, output=${output.slice(0, 100)}`);
      return {
        type: 'tool_result',
        toolName,
        toolOutput: output,
      };
    }
    log.log(`  -> No event emitted (subtype=${event.subtype}, hasInput=${!!event.input})`);
    return null;
  }

  private parseResultEvent(event: ClaudeRawEvent): StandardEvent {
    log.log(`parseResultEvent: usage=${JSON.stringify(event.usage)}, modelUsage=${JSON.stringify(event.modelUsage)}, cost=${event.total_cost_usd}`);
    // Extract result text if available (used for boss delegation parsing)
    const resultText = typeof event.result === 'string' ? event.result : undefined;

    // Extract permission denials if any
    const permissionDenials = event.permission_denials?.map(denial => ({
      toolName: denial.tool_name,
      toolUseId: denial.tool_use_id,
      toolInput: denial.tool_input,
    }));

    if (permissionDenials && permissionDenials.length > 0) {
      log.log(`parseResultEvent: ${permissionDenials.length} permission denial(s)`);
    }

    // Extract modelUsage if available (contains contextWindow size)
    let modelUsage: StandardEvent['modelUsage'] | undefined;
    if (event.modelUsage) {
      // Get the first model's usage (there's usually only one)
      const modelName = Object.keys(event.modelUsage)[0];
      if (modelName && event.modelUsage[modelName]) {
        const usage = event.modelUsage[modelName];
        modelUsage = {
          contextWindow: usage.contextWindow,
          maxOutputTokens: usage.maxOutputTokens,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
        };
        log.log(`parseResultEvent: modelUsage extracted - contextWindow=${usage.contextWindow}, cacheRead=${usage.cacheReadInputTokens}, cacheCreation=${usage.cacheCreationInputTokens}`);
      }
    }

    return {
      type: 'step_complete',
      durationMs: event.duration_ms,
      cost: event.total_cost_usd,
      tokens: event.usage
        ? {
            input: event.usage.input_tokens,
            output: event.usage.output_tokens,
            cacheCreation: event.usage.cache_creation_input_tokens,
            cacheRead: event.usage.cache_read_input_tokens,
          }
        : undefined,
      modelUsage,
      resultText,
      permissionDenials,
    };
  }

  private parseStreamEvent(event: ClaudeRawEvent): StandardEvent | null {
    const streamEvent = event.event;
    if (!streamEvent) return null;

    if (streamEvent.type === 'content_block_delta') {
      if (streamEvent.delta?.type === 'text_delta' && streamEvent.delta.text) {
        return {
          type: 'text',
          text: streamEvent.delta.text,
          isStreaming: true,
          uuid: event.uuid, // Propagate UUID for streaming chunks
        };
      } else if (
        streamEvent.delta?.type === 'thinking_delta' &&
        streamEvent.delta.text
      ) {
        return {
          type: 'thinking',
          text: streamEvent.delta.text,
          isStreaming: true,
          uuid: event.uuid, // Propagate UUID for streaming chunks
        };
      }
    } else if (streamEvent.type === 'content_block_start') {
      const blockType = streamEvent.content_block?.type;
      if (blockType === 'text' || blockType === 'thinking') {
        return {
          type: 'block_start',
          blockType: blockType,
          uuid: event.uuid, // Include UUID for block markers too
        };
      }
    } else if (streamEvent.type === 'content_block_stop') {
      return {
        type: 'block_end',
        uuid: event.uuid,
      };
    }
    return null;
  }

  /**
   * Extract session ID from raw event
   */
  extractSessionId(rawEvent: unknown): string | null {
    const event = rawEvent as ClaudeRawEvent;
    if (event.type === 'system' && event.subtype === 'init') {
      return event.session_id || null;
    }
    return null;
  }

  /**
   * Get Claude Code executable path
   */
  getExecutablePath(): string {
    const detected = this.detectInstallation();
    return detected || 'claude';
  }

  /**
   * Detect Claude Code CLI installation locations
   */
  detectInstallation(): string | null {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';

    const possiblePaths = isWindows
      ? [
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(
            homeDir,
            'AppData',
            'Local',
            'Programs',
            'claude',
            'claude.exe'
          ),
          path.join(homeDir, '.bun', 'bin', 'claude.exe'),
        ]
      : [
          path.join(homeDir, '.local', 'bin', 'claude'),
          path.join(homeDir, '.bun', 'bin', 'claude'),
          '/usr/local/bin/claude',
          '/usr/bin/claude',
        ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Claude requires stdin input for prompts
   */
  requiresStdinInput(): boolean {
    return true;
  }

  /**
   * Format prompt as stdin input for Claude CLI (stream-json format)
   */
  formatStdinInput(prompt: string): string {
    // Sanitize prompt to remove invalid Unicode surrogates that break JSON
    const sanitizedPrompt = sanitizeUnicode(prompt);
    return JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: sanitizedPrompt,
      },
    });
  }
}

/**
 * Parse the /context command output from Claude Code
 * Example format:
 * ## Context Usage
 * **Model:** claude-opus-4-5-20251101
 * **Tokens:** 19.6k / 200.0k (10%)
 *
 * ### Categories
 * | Category | Tokens | Percentage |
 * |----------|--------|------------|
 * | System prompt | 3.1k | 1.6% |
 * | System tools | 16.5k | 8.3% |
 * | Messages | 8 | 0.0% |
 * | Free space | 135.4k | 67.7% |
 * | Autocompact buffer | 45.0k | 22.5% |
 */
export function parseContextOutput(content: string): import('../../shared/types.js').ContextStats | null {
  try {
    // Extract model name
    const modelMatch = content.match(/\*\*Model:\*\*\s*(.+)/);
    const model = modelMatch ? modelMatch[1].trim() : 'unknown';

    // Extract total tokens and context window
    // Format: **Tokens:** 19.6k / 200.0k (10%)
    const tokensMatch = content.match(/\*\*Tokens:\*\*\s*([\d.]+)k?\s*\/\s*([\d.]+)k?\s*\((\d+)%\)/);
    if (!tokensMatch) {
      log.log('parseContextOutput: Could not parse tokens line');
      return null;
    }

    const parseTokens = (str: string): number => {
      const num = parseFloat(str);
      // If original string had 'k' suffix, multiply by 1000
      return str.includes('k') || num < 1000 ? num * 1000 : num;
    };

    const totalTokens = parseTokens(tokensMatch[1]);
    const contextWindow = parseTokens(tokensMatch[2]);
    const usedPercent = parseInt(tokensMatch[3], 10);

    // Parse category table
    const parseCategory = (name: string): { tokens: number; percent: number } => {
      // Match: | Category Name | 3.1k | 1.6% |
      const regex = new RegExp(`\\|\\s*${name}\\s*\\|\\s*([\\d.]+)k?\\s*\\|\\s*([\\d.]+)%\\s*\\|`, 'i');
      const match = content.match(regex);
      if (match) {
        const tokens = parseFloat(match[1]) * (match[1].includes('k') || parseFloat(match[1]) < 100 ? 1000 : 1);
        return { tokens, percent: parseFloat(match[2]) };
      }
      return { tokens: 0, percent: 0 };
    };

    const categories = {
      systemPrompt: parseCategory('System prompt'),
      systemTools: parseCategory('System tools'),
      messages: parseCategory('Messages'),
      freeSpace: parseCategory('Free space'),
      autocompactBuffer: parseCategory('Autocompact buffer'),
    };

    return {
      model,
      contextWindow,
      totalTokens,
      usedPercent,
      categories,
      lastUpdated: Date.now(),
    };
  } catch (error) {
    log.error('parseContextOutput error:', error);
    return null;
  }
}

/**
 * Parse /usage command output from Claude Code CLI
 *
 * Expected format:
 * ## Usage
 *
 * | Category | % | Reset |
 * |---|---|---|
 * | Current Session | 45.2% | Jan 25 at 5:00 PM |
 * | Current Week (All Models) | 12.3% | Jan 27 at 12:00 AM |
 * | Current Week (Sonnet Only) | 8.5% | Jan 27 at 12:00 AM |
 */
export function parseUsageOutput(content: string): {
  session: { percentUsed: number; resetTime: string };
  weeklyAllModels: { percentUsed: number; resetTime: string };
  weeklySonnet: { percentUsed: number; resetTime: string };
} | null {
  try {
    log.log('parseUsageOutput: Attempting to parse usage output');
    log.log('parseUsageOutput content:', content.substring(0, 500));

    // Parse a usage row: | Category Name | XX.X% | Reset Time |
    const parseUsageRow = (categoryPattern: string): { percentUsed: number; resetTime: string } | null => {
      const regex = new RegExp(`\\|\\s*${categoryPattern}\\s*\\|\\s*([\\d.]+)%\\s*\\|\\s*([^|]+)\\s*\\|`, 'i');
      const match = content.match(regex);
      if (match) {
        return {
          percentUsed: parseFloat(match[1]),
          resetTime: match[2].trim(),
        };
      }
      return null;
    };

    const session = parseUsageRow('Current Session');
    const weeklyAllModels = parseUsageRow('Current Week \\(All Models\\)');
    const weeklySonnet = parseUsageRow('Current Week \\(Sonnet Only\\)');

    if (!session || !weeklyAllModels || !weeklySonnet) {
      log.log('parseUsageOutput: Could not parse all usage categories');
      log.log(`  session: ${session ? 'found' : 'missing'}`);
      log.log(`  weeklyAllModels: ${weeklyAllModels ? 'found' : 'missing'}`);
      log.log(`  weeklySonnet: ${weeklySonnet ? 'found' : 'missing'}`);
      return null;
    }

    log.log('parseUsageOutput: Successfully parsed usage stats');
    return { session, weeklyAllModels, weeklySonnet };
  } catch (error) {
    log.error('parseUsageOutput error:', error);
    return null;
  }
}
