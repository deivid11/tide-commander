import type { RuntimeEvent } from '../runtime/types.js';

type JsonObject = Record<string, unknown>;

interface CodexItemAction {
  type?: string;
  query?: string;
  queries?: string[];
  url?: string;
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  query?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  action?: CodexItemAction;
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

interface CodexEventEnvelope {
  type?: string;
  item?: CodexItem;
  usage?: CodexUsage;
}

interface InferredToolCall {
  toolName: 'Read' | 'Write' | 'Edit';
  toolInput: Record<string, unknown>;
  toolOutput?: string;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allStrings = value.every((entry) => typeof entry === 'string');
  return allStrings ? (value as string[]) : undefined;
}

function parseAction(action: unknown): CodexItemAction | undefined {
  if (!isObject(action)) return undefined;
  return {
    type: asString(action.type),
    query: asString(action.query),
    queries: asStringArray(action.queries),
    url: asString(action.url),
  };
}

function parseItem(item: unknown): CodexItem | undefined {
  if (!isObject(item)) return undefined;
  return {
    id: asString(item.id),
    type: asString(item.type),
    text: asString(item.text),
    query: asString(item.query),
    command: asString(item.command),
    aggregated_output: asString(item.aggregated_output),
    exit_code: asNumber(item.exit_code),
    status: asString(item.status),
    action: parseAction(item.action),
  };
}

function parseUsage(usage: unknown): CodexUsage | undefined {
  if (!isObject(usage)) return undefined;
  return {
    input_tokens: asNumber(usage.input_tokens),
    cached_input_tokens: asNumber(usage.cached_input_tokens),
    output_tokens: asNumber(usage.output_tokens),
  };
}

function parseEnvelope(value: unknown): CodexEventEnvelope | undefined {
  if (!isObject(value)) return undefined;
  return {
    type: asString(value.type),
    item: parseItem(value.item),
    usage: parseUsage(value.usage),
  };
}

/**
 * Parses line-delimited JSON events from `codex exec --json` and maps them to
 * Tide runtime events.
 */
export class CodexJsonEventParser {
  private activeToolByItemId = new Map<string, string>();

  parseLine(line: string): RuntimeEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      return this.parseEvent(parsed);
    } catch {
      return [];
    }
  }

  parseEvent(rawEvent: unknown): RuntimeEvent[] {
    const event = parseEnvelope(rawEvent);
    if (!event?.type) return [];

    if (event.type === 'item.started') {
      return this.parseItemStarted(event.item);
    }
    if (event.type === 'item.completed') {
      return this.parseItemCompleted(event.item);
    }
    if (event.type === 'turn.completed') {
      return this.parseTurnCompleted(event.usage);
    }

    return [];
  }

  private parseItemStarted(item?: CodexItem): RuntimeEvent[] {
    if (!item?.type) return [];

    if (item.type === 'web_search') {
      const toolName = 'web_search';
      if (item.id) {
        this.activeToolByItemId.set(item.id, toolName);
      }
      return [
        {
          type: 'tool_start',
          toolName,
          toolInput: this.buildWebSearchToolInput(item),
        },
      ];
    }

    if (item.type === 'command_execution') {
      const toolName = 'Bash';
      if (item.id) {
        this.activeToolByItemId.set(item.id, toolName);
      }
      return [
        {
          type: 'tool_start',
          toolName,
          toolInput: this.buildCommandExecutionToolInput(item),
        },
      ];
    }

    return [];
  }

  private parseItemCompleted(item?: CodexItem): RuntimeEvent[] {
    if (!item?.type) return [];

    if (item.type === 'reasoning' && item.text) {
      return [{ type: 'thinking', text: item.text, isStreaming: false }];
    }

    if (item.type === 'agent_message' && item.text) {
      return [{ type: 'text', text: item.text, isStreaming: false }];
    }

    if (item.type === 'web_search') {
      const toolName = item.id ? (this.activeToolByItemId.get(item.id) ?? 'web_search') : 'web_search';
      if (item.id) {
        this.activeToolByItemId.delete(item.id);
      }
      return [
        {
          type: 'tool_result',
          toolName,
          toolOutput: JSON.stringify(this.buildWebSearchToolInput(item)),
        },
      ];
    }

    if (item.type === 'command_execution') {
      const toolName = item.id ? (this.activeToolByItemId.get(item.id) ?? 'Bash') : 'Bash';
      if (item.id) {
        this.activeToolByItemId.delete(item.id);
      }
      const inferredToolEvents = this.buildInferredToolEvents(item);
      return [
        ...inferredToolEvents,
        {
          type: 'tool_result',
          toolName,
          toolOutput: this.buildCommandExecutionToolOutput(item),
        },
      ];
    }

    return [];
  }

  private parseTurnCompleted(usage?: CodexUsage): RuntimeEvent[] {
    if (!usage) return [];

    return [
      {
        type: 'step_complete',
        tokens: {
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          cacheRead: usage.cached_input_tokens,
        },
      },
    ];
  }

  private buildWebSearchToolInput(item: CodexItem): Record<string, unknown> {
    return {
      query: item.query,
      actionType: item.action?.type,
      actionQuery: item.action?.query,
      actionQueries: item.action?.queries,
      actionUrl: item.action?.url,
    };
  }

  private buildCommandExecutionToolInput(item: CodexItem): Record<string, unknown> {
    return {
      command: item.command,
      status: item.status,
    };
  }

  private buildCommandExecutionToolOutput(item: CodexItem): string {
    if (item.aggregated_output) {
      return item.aggregated_output;
    }
    if (item.exit_code !== undefined) {
      return `[exit ${item.exit_code}]`;
    }
    if (item.status) {
      return `Command status: ${item.status}`;
    }
    return '';
  }

  private buildInferredToolEvents(item: CodexItem): RuntimeEvent[] {
    const inferredCalls = this.inferToolCalls(item.command, item.aggregated_output);
    if (inferredCalls.length === 0) return [];

    const events: RuntimeEvent[] = [];
    for (const call of inferredCalls) {
      events.push({
        type: 'tool_start',
        toolName: call.toolName,
        toolInput: call.toolInput,
      });
      if (call.toolOutput) {
        events.push({
          type: 'tool_result',
          toolName: call.toolName,
          toolOutput: call.toolOutput,
        });
      }
    }
    return events;
  }

  private inferToolCalls(command?: string, aggregatedOutput?: string): InferredToolCall[] {
    if (!command) return [];

    const calls: InferredToolCall[] = [];
    const seen = new Set<string>();
    const shell = this.extractShellCommand(command);

    const add = (call: InferredToolCall): void => {
      const filePath = this.stringField(call.toolInput.file_path);
      if (!filePath) return;
      const uiPath = this.normalizePathForUi(filePath);
      if (!uiPath) return;
      call.toolInput.file_path = uiPath;
      const key = `${call.toolName}:${uiPath}:${this.stringField(call.toolInput.operation) || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      calls.push(call);
    };

    // 1) apply_patch blocks -> high-fidelity file operations
    for (const op of this.extractApplyPatchOperations(shell)) {
      add(op);
    }

    // 2) Common shell writes/appends
    for (const appendEdit of this.extractAppendEdits(shell)) {
      add(appendEdit);
    }
    for (const path of this.extractRedirectTargets(shell, '>>')) {
      add({
        toolName: 'Edit',
        toolInput: {
          file_path: path,
          operation: 'append',
          old_string: '',
          new_string: '',
        },
      });
    }
    for (const path of this.extractRedirectTargets(shell, '>')) {
      if (path === '/dev/null') continue;
      add({
        toolName: 'Write',
        toolInput: { file_path: path },
      });
    }

    // 3) In-place edit commands
    for (const edit of this.extractInPlaceEdits(shell)) {
      add(edit);
    }

    // 4) Read commands
    for (const path of this.extractReadTargets(shell)) {
      add({
        toolName: 'Read',
        toolInput: { file_path: path },
      });
    }

    // 5) If command output indicates apply_patch success but command parsing missed details
    if (calls.length === 0 && aggregatedOutput?.includes('Success. Updated the following files:')) {
      const outputPaths = this.extractUpdatedPathsFromOutput(aggregatedOutput);
      for (const path of outputPaths) {
        add({
          toolName: 'Edit',
          toolInput: { file_path: path },
        });
      }
    }

    return calls;
  }

  private extractShellCommand(command: string): string {
    // Typical form from codex exec JSON:
    // /bin/zsh -lc "actual command"
    const doubleQuoted = command.match(/-lc\s+"([\s\S]*)"$/);
    if (doubleQuoted) {
      return this.unescapeShellDoubleQuotes(doubleQuoted[1]);
    }
    const singleQuoted = command.match(/-lc\s+'([\s\S]*)'$/);
    if (singleQuoted) {
      return singleQuoted[1];
    }
    return command;
  }

  private unescapeShellDoubleQuotes(text: string): string {
    return text
      .replace(/\\"/g, '"')
      .replace(/\\`/g, '`')
      .replace(/\\\$/g, '$')
      .replace(/\\\\/g, '\\');
  }

  private extractApplyPatchOperations(shell: string): InferredToolCall[] {
    const patchBlockMatch = shell.match(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/);
    if (!patchBlockMatch) return [];

    const patch = patchBlockMatch[0];
    const lines = patch.split('\n');
    const calls: InferredToolCall[] = [];

    let currentPath: string | undefined;
    let currentMode: 'add' | 'update' | 'delete' | undefined;
    let oldLines: string[] = [];
    let newLines: string[] = [];

    const flush = (): void => {
      if (!currentPath || !currentMode) return;

      if (currentMode === 'add') {
        calls.push({
          toolName: 'Write',
          toolInput: {
            file_path: currentPath,
            content: newLines.join('\n'),
          },
          toolOutput: 'Created file',
        });
      } else if (currentMode === 'update') {
        const toolInput: Record<string, unknown> = { file_path: currentPath };
        if (oldLines.length > 0 || newLines.length > 0) {
          toolInput.old_string = oldLines.join('\n');
          toolInput.new_string = newLines.join('\n');
        }
        calls.push({
          toolName: 'Edit',
          toolInput,
          toolOutput: 'Updated file',
        });
      } else if (currentMode === 'delete') {
        calls.push({
          toolName: 'Edit',
          toolInput: {
            file_path: currentPath,
            operation: 'delete',
            old_string: oldLines.join('\n'),
            new_string: '',
          },
          toolOutput: 'Deleted file',
        });
      }

      currentPath = undefined;
      currentMode = undefined;
      oldLines = [];
      newLines = [];
    };

    for (const line of lines) {
      const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
      if (addMatch) {
        flush();
        currentPath = addMatch[1].trim();
        currentMode = 'add';
        continue;
      }

      const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
      if (updateMatch) {
        flush();
        currentPath = updateMatch[1].trim();
        currentMode = 'update';
        continue;
      }

      const deleteMatch = line.match(/^\*\*\* Delete File: (.+)$/);
      if (deleteMatch) {
        flush();
        currentPath = deleteMatch[1].trim();
        currentMode = 'delete';
        continue;
      }

      if (!currentPath || !currentMode) continue;
      if (line.startsWith('*** ')) continue;
      if (line.startsWith('@@')) continue;
      if (line.startsWith('+')) {
        newLines.push(line.slice(1));
        continue;
      }
      if (line.startsWith('-')) {
        oldLines.push(line.slice(1));
      }
    }

    flush();
    return calls;
  }

  private extractRedirectTargets(shell: string, operator: '>' | '>>'): string[] {
    const targets = new Set<string>();
    const escaped = operator === '>>' ? '>>' : '(?<![0-9>])>(?!>)';
    const quoted = new RegExp(`${escaped}\\s*['"]([^'"]+)['"]`, 'g');
    const unquoted = new RegExp(`${escaped}\\s*([^\\s;|&]+)`, 'g');

    for (const regex of [quoted, unquoted]) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(shell)) !== null) {
        const candidate = this.normalizeCandidatePath(match[1]);
        if (!candidate) continue;
        targets.add(candidate);
      }
    }

    return Array.from(targets);
  }

  private extractInPlaceEdits(shell: string): InferredToolCall[] {
    const edits: InferredToolCall[] = [];
    const seen = new Set<string>();
    const segments = shell.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);

    for (const segment of segments) {
      const isInPlaceEdit = /\bsed\s+-i\b/.test(segment) || /\bperl\s+-pi\b/.test(segment);
      if (!isInPlaceEdit) continue;

      const filePath = this.extractLastLikelyFilePath(segment);
      if (!filePath) continue;

      const oldLineHint = this.extractRemovalHint(segment);
      const key = `${filePath}:${oldLineHint || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edits.push({
        toolName: 'Edit',
        toolInput: {
          file_path: filePath,
          operation: 'in_place_edit',
          old_string: oldLineHint || '',
          new_string: '',
        },
      });
    }

    return edits;
  }

  private extractReadTargets(shell: string): string[] {
    const targets = new Set<string>();
    const patterns = [
      /\bcat\s+['"]([^'"]+)['"]/g,
      /\bcat\s+([^\s;|&]+)/g,
      /\b(?:tail|head)\s+(?:-[^\s]+\s+)*['"]([^'"]+)['"]/g,
      /\b(?:tail|head)\s+(?:-[^\s]+\s+)*([^\s;|&]+)/g,
      /\bsed\s+-n\s+['"][^'"]*['"]\s+['"]([^'"]+)['"]/g,
      /\bsed\s+-n\s+['"][^'"]*['"]\s+([^\s;|&]+)/g,
    ];

    for (const regex of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(shell)) !== null) {
        const candidate = this.normalizeCandidatePath(match[1]);
        if (!candidate) continue;
        targets.add(candidate);
      }
    }

    return Array.from(targets);
  }

  private extractUpdatedPathsFromOutput(output: string): string[] {
    const paths = new Set<string>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Success.')) continue;
      if (trimmed.startsWith('- ')) {
        paths.add(trimmed.slice(2).trim());
      }
    }
    return Array.from(paths);
  }

  private stringField(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private normalizeCandidatePath(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;

    const candidate = value.trim().replace(/^['"]|['"]$/g, '');
    if (!candidate) return undefined;
    if (candidate === '/') return undefined;
    if (candidate.startsWith('&') || candidate.startsWith('(')) return undefined;
    if (candidate.startsWith('-')) return undefined;
    if (/^[><|&]+$/.test(candidate)) return undefined;
    if (/^\d+$/.test(candidate)) return undefined;
    if (!/[/.~]/.test(candidate) && !/^[A-Z][A-Za-z0-9_-]*$/.test(candidate)) return undefined;
    if (/^(one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(candidate)) return undefined;

    return candidate;
  }

  private extractLastLikelyFilePath(segment: string): string | undefined {
    const tokens = segment.match(/'[^']*'|"[^"]*"|\S+/g) || [];
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const candidate = this.normalizeCandidatePath(tokens[i]);
      if (candidate) return candidate;
    }
    return undefined;
  }

  private normalizePathForUi(path: string): string | undefined {
    const normalized = this.normalizeCandidatePath(path);
    if (!normalized) return undefined;
    if (normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('~')) {
      return normalized;
    }
    // Make plain relative files clickable by existing UI path detection.
    return `./${normalized}`;
  }

  private extractAppendEdits(shell: string): InferredToolCall[] {
    const edits: InferredToolCall[] = [];
    const patterns = [
      /\bprintf\s+(['"])([\s\S]*?)\1\s*>>\s*([^\s;|&]+)/g,
      /\becho\s+(['"])([\s\S]*?)\1\s*>>\s*([^\s;|&]+)/g,
    ];

    for (const regex of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(shell)) !== null) {
        const rawContent = match[2] || '';
        const filePath = this.normalizeCandidatePath(match[3]);
        if (!filePath) continue;

        const appended = this.unescapePrintfLikeString(rawContent);
        edits.push({
          toolName: 'Edit',
          toolInput: {
            file_path: filePath,
            operation: 'append',
            old_string: '',
            new_string: appended,
          },
        });
      }
    }

    return edits;
  }

  private unescapePrintfLikeString(input: string): string {
    return input
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, '\'')
      .replace(/\\\\/g, '\\');
  }

  private extractRemovalHint(segment: string): string | undefined {
    // Common sed/perl delete pattern hints:
    // sed -i '' '/^Added one more line\.$/d' README.md
    // perl -i -ne 'print unless /^Added one more line\.\s*$/' README.md
    const sedMatch = segment.match(/\/\^?([^/$]+)\$?\/d/);
    if (sedMatch) {
      return this.unescapeRegexLiteral(sedMatch[1]);
    }

    const perlMatch = segment.match(/unless\s+\/\^?([^/$]+)\$?\//);
    if (perlMatch) {
      return this.unescapeRegexLiteral(perlMatch[1]);
    }

    return undefined;
  }

  private unescapeRegexLiteral(value: string): string {
    return value
      .replace(/\\\./g, '.')
      .replace(/\\\$/g, '$')
      .replace(/\\\^/g, '^')
      .replace(/\\\//g, '/')
      .replace(/\\s\*/g, '')
      .replace(/\\n/g, '\n')
      .trim();
  }
}
