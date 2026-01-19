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
import { createLogger } from '../utils/logger.js';

const log = createLogger('Backend');

/**
 * Sanitize a string by removing invalid Unicode surrogate pairs.
 * This fixes "no low surrogate in string" JSON errors that occur when
 * strings contain unpaired high surrogates (0xD800-0xDBFF without matching 0xDC00-0xDFFF).
 * Also handles JSON-escaped surrogates like \ud83d that lack their low surrogate pair.
 */
function sanitizeUnicode(str: string): string {
  // First, handle JSON-escaped surrogates (e.g., \ud83d without \udc00-\udfff following)
  // High surrogate: \uD800-\uDBFF -> \u[dD][89aAbB][0-9a-fA-F]{2}
  // Low surrogate: \uDC00-\uDFFF -> \u[dD][cCdDeEfF][0-9a-fA-F]{2}
  const highPattern = /\\u[dD][89aAbB][0-9a-fA-F]{2}/g;
  const lowPattern = /\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/;

  // Replace unpaired JSON-escaped surrogates
  let sanitized = str.replace(highPattern, (match, offset) => {
    // Check if followed by a low surrogate escape
    const afterMatch = str.slice(offset + match.length);
    if (lowPattern.test(afterMatch.slice(0, 6))) {
      return match; // Valid pair, keep it
    }
    return '\\ufffd'; // Replace unpaired high surrogate
  });

  // Also replace orphan low surrogates (not preceded by high)
  sanitized = sanitized.replace(/\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g, (match, offset) => {
    // Check if preceded by a high surrogate
    const beforeMatch = sanitized.slice(Math.max(0, offset - 6), offset);
    if (/\\u[dD][89aAbB][0-9a-fA-F]{2}$/.test(beforeMatch)) {
      return match; // Valid pair, keep it
    }
    return '\\ufffd'; // Replace orphan low surrogate
  });

  // Then handle raw Unicode surrogates at character level
  let result = '';
  for (let i = 0; i < sanitized.length; i++) {
    const code = sanitized.charCodeAt(i);

    // Check if this is a high surrogate (0xD800-0xDBFF)
    if (code >= 0xD800 && code <= 0xDBFF) {
      // Check if next char is a valid low surrogate
      const nextCode = sanitized.charCodeAt(i + 1);
      if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
        // Valid surrogate pair - keep both
        result += sanitized[i] + sanitized[i + 1];
        i++; // Skip the low surrogate since we already added it
      } else {
        // Unpaired high surrogate - replace with replacement char
        result += '\uFFFD';
      }
    }
    // Check if this is a low surrogate without preceding high surrogate
    else if (code >= 0xDC00 && code <= 0xDFFF) {
      // Unpaired low surrogate - replace with replacement char
      result += '\uFFFD';
    }
    else {
      // Normal character
      result += sanitized[i];
    }
  }
  return result;
}

export class ClaudeBackend implements CLIBackend {
  readonly name = 'claude';

  /**
   * Build CLI arguments for Claude Code
   */
  buildArgs(config: BackendConfig): string[] {
    const args: string[] = [];

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
    // Pass the prompt content directly via --system-prompt
    if (config.customAgent) {
      const prompt = config.customAgent.definition.prompt;
      if (config.sessionId) {
        // Resuming - append to existing system prompt
        args.push('--append-system-prompt', prompt);
      } else {
        // New session - set the system prompt
        args.push('--system-prompt', prompt);
      }
    }

    // System prompt for boss agents or custom context
    // Use --append-system-prompt when resuming (--system-prompt is ignored on resume)
    // Use --system-prompt for new sessions
    if (config.systemPrompt && !config.customAgent) {
      if (config.sessionId) {
        // Resuming - append to existing system prompt
        args.push('--append-system-prompt', config.systemPrompt);
      } else {
        // New session - set the system prompt
        args.push('--system-prompt', config.systemPrompt);
      }
    }

    return args;
  }

  /**
   * Parse Claude CLI raw event into normalized StandardEvent
   */
  parseEvent(rawEvent: unknown): StandardEvent | null {
    const event = rawEvent as ClaudeRawEvent;

    switch (event.type) {
      case 'system':
        return this.parseSystemEvent(event);

      case 'assistant':
        return this.parseAssistantEvent(event);

      case 'tool_use':
        return this.parseToolUseEvent(event);

      case 'result':
        return this.parseResultEvent(event);

      case 'stream_event':
        return this.parseStreamEvent(event);

      case 'user':
        return this.parseUserEvent(event);

      default:
        return null;
    }
  }

  private parseUserEvent(event: ClaudeRawEvent): StandardEvent | null {
    // Check for local-command-stdout (from /context, /cost, etc. commands)
    const message = event.message as { content?: string };
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

  private parseAssistantEvent(event: ClaudeRawEvent): StandardEvent | null {
    if (!event.message?.content) return null;

    // Process content blocks - return first meaningful one
    for (const block of event.message.content) {
      if (block.type === 'thinking' && block.text) {
        return {
          type: 'thinking',
          text: block.text,
        };
      } else if (block.type === 'text' && block.text) {
        return {
          type: 'text',
          text: block.text,
        };
      } else if (block.type === 'tool_use' && block.name) {
        return {
          type: 'tool_start',
          toolName: block.name,
          toolInput: block.input,
        };
      }
    }
    return null;
  }

  private parseToolUseEvent(event: ClaudeRawEvent): StandardEvent | null {
    const toolName = event.tool_name || 'unknown';

    if (event.subtype === 'input' && event.input) {
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
      return {
        type: 'tool_result',
        toolName,
        toolOutput: output,
      };
    }
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
        };
      } else if (
        streamEvent.delta?.type === 'thinking_delta' &&
        streamEvent.delta.text
      ) {
        return {
          type: 'thinking',
          text: streamEvent.delta.text,
          isStreaming: true,
        };
      }
    } else if (streamEvent.type === 'content_block_start') {
      const blockType = streamEvent.content_block?.type;
      if (blockType === 'text' || blockType === 'thinking') {
        return {
          type: 'block_start',
          blockType: blockType,
        };
      }
    } else if (streamEvent.type === 'content_block_stop') {
      return {
        type: 'block_end',
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
