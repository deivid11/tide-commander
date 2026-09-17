/**
 * Quote- and heredoc-aware detection of the files a shell command writes.
 *
 * Tide Commander labels Bash rows as file writes and synthesizes Edit rows
 * after a command runs. Doing that with regexes over the raw string produced
 * phantom edits: a `;` inside a quoted sed script split the command and the
 * regex fragment `.*` became a "file", and `=> [...new Set()]` inside a
 * heredoc body of TypeScript read as a redirect to `[...new`. This lexer only
 * reports writes that bash would actually perform: unquoted redirects outside
 * heredoc bodies, `tee` arguments, and the file operands of `sed -i` /
 * `perl -i`. Anything built from expansions or unquoted globs is dropped,
 * because it cannot be resolved without running a shell.
 */

import { scriptReplacements, type ShellScriptReplacement } from './script-replacements.js';

export type { ShellScriptReplacement };

export type ShellWriteOperation = 'overwrite' | 'append' | 'in_place_edit';

export interface ShellWriteTarget {
  /** Literal path, joined onto the last static `cd` in the chain when relative. */
  path: string;
  operation: ShellWriteOperation;
  /** Source text of the simple command that performs the write. */
  segment: string;
  /** Heredoc body written by `cat > file <<EOF` / `tee file <<EOF`. */
  content?: string;
  /** Written by an inline interpreter script (`python3 - <<'EOF' … open(p,'w') …`). */
  fromScript?: boolean;
  /**
   * Literal replacements the script performs (`s.replace(a, b)`). The script
   * states exactly what changed, so a row can show the diff without git or a
   * before-snapshot — the command itself is the record.
   */
  replacements?: ShellScriptReplacement[];
}

export interface ShellWord {
  /** Value after quote removal. */
  value: string;
  /** Contains `$` expansions, command substitutions or unquoted glob characters. */
  dynamic: boolean;
}

export interface ShellRedirect {
  op: '>' | '>>' | '&>' | '&>>' | '<' | '<<<' | '>&';
  /** Explicit file descriptor (`2>`), null when omitted. */
  fd: number | null;
  target: ShellWord | null;
}

export interface ShellSimpleCommand {
  words: ShellWord[];
  redirects: ShellRedirect[];
  heredocBodies: string[];
  text: string;
  /** Reads the previous command's stdout (`a | b` → true for b). */
  pipeInput: boolean;
}

const COMMAND_PREFIXES = new Set(['sudo', 'env', 'command', 'builtin', 'nohup', 'time', 'exec', 'nice']);
/** Compound-command keywords that can precede the real command name. */
const KEYWORD_PREFIXES = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}', 'fi', 'done', 'esac']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Split a shell string into simple commands, keeping redirects and heredoc bodies. */
export function parseShellCommands(input: string): ShellSimpleCommand[] {
  const commands: ShellSimpleCommand[] = [];
  const pendingHeredocs: Array<{ delimiter: string; stripTabs: boolean; command: ShellSimpleCommand }> = [];
  const n = input.length;
  let i = 0;
  let commandStart = 0;
  let current = emptyCommand();
  let buf = '';
  let inWord = false;
  let dynamic = false;
  let expectHeredoc: { stripTabs: boolean } | null = null;
  let expectTarget: ShellRedirect | null = null;
  let nextPipeInput = false;

  const flushWord = (): void => {
    if (!inWord) return;
    const word: ShellWord = { value: buf, dynamic };
    buf = '';
    inWord = false;
    dynamic = false;
    if (expectHeredoc) {
      pendingHeredocs.push({ delimiter: word.value, stripTabs: expectHeredoc.stripTabs, command: current });
      expectHeredoc = null;
      return;
    }
    if (expectTarget) {
      expectTarget.target = word;
      expectTarget = null;
      return;
    }
    current.words.push(word);
  };

  const endCommand = (end: number, pipesInto = false): void => {
    flushWord();
    expectHeredoc = null;
    expectTarget = null;
    current.text = input.slice(commandStart, end).trim();
    current.pipeInput = nextPipeInput;
    if (current.words.length > 0 || current.redirects.length > 0) commands.push(current);
    current = emptyCommand();
    nextPipeInput = pipesInto;
  };

  const addRedirect = (op: ShellRedirect['op'], fd: number | null): void => {
    const redirect: ShellRedirect = { op, fd, target: null };
    current.redirects.push(redirect);
    expectTarget = redirect;
  };

  /** An all-digit unquoted word directly before `>`/`<` is a file descriptor. */
  const takeFd = (): number | null => {
    if (inWord && !dynamic && /^\d+$/.test(buf) && i > 0 && /\d/.test(input[i - 1])) {
      const fd = Number(buf);
      buf = '';
      inWord = false;
      return fd;
    }
    flushWord();
    return null;
  };

  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '\n') {
      endCommand(i);
      i += 1;
      if (pendingHeredocs.length > 0) {
        i = consumeHeredocBodies(input, i, pendingHeredocs);
        pendingHeredocs.length = 0;
      }
      commandStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushWord();
      i += 1;
      continue;
    }
    if (ch === '\\') {
      if (next === '\n') { i += 2; continue; }
      if (next !== undefined) { buf += next; inWord = true; i += 2; continue; }
      i += 1;
      continue;
    }
    if (ch === '#' && !inWord) {
      while (i < n && input[i] !== '\n') i += 1;
      continue;
    }
    if (ch === "'") {
      const close = input.indexOf("'", i + 1);
      const end = close === -1 ? n : close;
      buf += input.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      i += 1;
      inWord = true;
      while (i < n && input[i] !== '"') {
        const c = input[i];
        if (c === '\\' && i + 1 < n && '"\\$`\n'.includes(input[i + 1])) {
          if (input[i + 1] !== '\n') buf += input[i + 1];
          i += 2;
          continue;
        }
        if (c === '$' || c === '`') {
          dynamic = true;
          if (c === '$' && input[i + 1] === '(') {
            const end = skipCommandSubstitution(input, i + 2);
            buf += input.slice(i, end);
            i = end;
            continue;
          }
        }
        buf += c;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '$') {
      inWord = true;
      if (next === "'") {
        // ANSI-C quoting: literal apart from escapes, which we keep verbatim.
        const close = input.indexOf("'", i + 2);
        const end = close === -1 ? n : close;
        buf += input.slice(i + 2, end);
        i = end + 1;
        continue;
      }
      dynamic = true;
      if (next === '(') {
        const end = skipCommandSubstitution(input, i + 2);
        buf += input.slice(i, end);
        i = end;
        continue;
      }
      if (next === '{') {
        const close = input.indexOf('}', i + 2);
        const end = close === -1 ? n : close + 1;
        buf += input.slice(i, end);
        i = end;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === '`') {
      const close = input.indexOf('`', i + 1);
      const end = close === -1 ? n : close + 1;
      buf += input.slice(i, end);
      inWord = true;
      dynamic = true;
      i = end;
      continue;
    }
    if (ch === '&') {
      if (next === '&') { endCommand(i); i += 2; commandStart = i; continue; }
      if (next === '>') {
        flushWord();
        const append = input[i + 2] === '>';
        addRedirect(append ? '&>>' : '&>', null);
        i += append ? 3 : 2;
        continue;
      }
      endCommand(i);
      i += 1;
      commandStart = i;
      continue;
    }
    if (ch === '|') {
      endCommand(i, next !== '|');
      i += next === '|' || next === '&' ? 2 : 1;
      commandStart = i;
      continue;
    }
    if (ch === '(' && next === '(' && !inWord) {
      // Arithmetic `(( i > 3 ))`: `>` is a comparison, never a redirect.
      endCommand(i);
      i = skipCommandSubstitution(input, i + 1);
      commandStart = i;
      continue;
    }
    if (ch === ';' || ch === '(' || ch === ')') {
      endCommand(i);
      i += ch === ';' && next === ';' ? 2 : 1;
      commandStart = i;
      continue;
    }
    if (ch === '>') {
      const fd = takeFd();
      if (next === '>') { addRedirect('>>', fd); i += 2; continue; }
      if (next === '|') { addRedirect('>', fd); i += 2; continue; }
      if (next === '&') {
        let j = i + 2;
        while (j < n && (input[j] === ' ' || input[j] === '\t')) j += 1;
        if (/[\d-]/.test(input[j] ?? '')) {
          // fd duplication (`2>&1`, `>&-`): no file involved.
          current.redirects.push({ op: '>&', fd, target: null });
          while (j < n && /[\d-]/.test(input[j])) j += 1;
          i = j;
          continue;
        }
        addRedirect('&>', fd);
        i += 2;
        continue;
      }
      addRedirect('>', fd);
      i += 1;
      continue;
    }
    if (ch === '<') {
      const fd = takeFd();
      if (next === '<' && input[i + 2] === '<') { addRedirect('<<<', fd); i += 3; continue; }
      if (next === '<') {
        const stripTabs = input[i + 2] === '-';
        expectHeredoc = { stripTabs };
        i += stripTabs ? 3 : 2;
        continue;
      }
      if (next === '&') {
        let j = i + 2;
        while (j < n && /[\d-]/.test(input[j])) j += 1;
        i = j;
        continue;
      }
      addRedirect('<', fd);
      i += next === '>' ? 2 : 1;
      continue;
    }
    if (ch === '*' || ch === '?' || ch === '[') dynamic = true;
    buf += ch;
    inWord = true;
    i += 1;
  }
  endCommand(n);
  return commands;
}

/**
 * Files written by `command`, in order of appearance. Relative paths are joined
 * onto the most recent static `cd` in the same chain.
 */
export function getShellFileWrites(command: string): ShellWriteTarget[] {
  return collectShellWrites(command).targets;
}

interface ShellWriteScan {
  targets: ShellWriteTarget[];
  commands: ShellSimpleCommand[];
  /** Indexes into `commands` of the simple commands that write a file. */
  writers: Set<number>;
}

function collectShellWrites(command: string): ShellWriteScan {
  const targets: ShellWriteTarget[] = [];
  const writers = new Set<number>();
  const commands = parseShellCommands(command);
  let commandIndex = 0;
  const seen = new Map<string, number>();
  let cwd: string | null = null;

  const add = (word: ShellWord | null, operation: ShellWriteOperation, command: ShellSimpleCommand, content?: string): void => {
    const literal = staticPath(word);
    if (!literal) return;
    writers.add(commandIndex);
    const resolved = cwd ? joinPosix(cwd, literal) : literal;
    const existing = seen.get(resolved);
    if (existing !== undefined) {
      // An in-place edit is more specific than a redirect to the same file.
      if (operation === 'in_place_edit') targets[existing].operation = operation;
      return;
    }
    seen.set(resolved, targets.length);
    targets.push({ path: resolved, operation, segment: command.text, ...(content !== undefined ? { content } : {}) });
  };

  for (commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
    const cmd = commands[commandIndex];
    const { name, args } = splitCommandName(cmd.words);
    // `[[ a > b ]]` compares strings; nothing is written.
    if (name === '[[') continue;

    if (name === 'cd' || name === 'pushd') {
      const dir = args.find((arg) => !arg.value.startsWith('-'));
      const literal = staticPath(dir ?? null);
      cwd = literal ? (cwd ? joinPosix(cwd, literal) : literal) : null;
      continue;
    }

    const heredoc = cmd.heredocBodies.length > 0 ? cmd.heredocBodies[cmd.heredocBodies.length - 1] : undefined;
    const catContent = name === 'cat' && args.length === 0 ? heredoc : undefined;

    for (const redirect of cmd.redirects) {
      if (redirect.fd !== null && redirect.fd !== 1) continue;
      if (redirect.op === '>' || redirect.op === '&>') add(redirect.target, 'overwrite', cmd, catContent);
      else if (redirect.op === '>>' || redirect.op === '&>>') add(redirect.target, 'append', cmd, catContent);
    }

    for (const scriptWrite of interpreterScriptWrites(name, args, cmd.heredocBodies)) {
      writers.add(commandIndex);
      const resolved = cwd ? joinPosix(cwd, scriptWrite.path) : scriptWrite.path;
      if (!seen.has(resolved)) {
        seen.set(resolved, targets.length);
        targets.push({
          path: resolved,
          operation: scriptWrite.operation,
          segment: cmd.text,
          fromScript: true,
          ...(scriptWrite.replacements.length > 0 ? { replacements: scriptWrite.replacements } : {}),
        });
      }
    }

    if (name === 'tee') {
      const append = args.some((arg) => arg.value === '-a' || arg.value === '--append');
      for (const arg of args) {
        if (arg.value.startsWith('-')) continue;
        add(arg, append ? 'append' : 'overwrite', cmd, heredoc);
      }
    } else if (name === 'sed') {
      for (const file of sedInPlaceFiles(args)) add(file, 'in_place_edit', cmd);
    } else if (name === 'perl') {
      for (const file of perlInPlaceFiles(args)) add(file, 'in_place_edit', cmd);
    }
  }
  return { targets, commands, writers };
}

/** Commands that only set up or annotate a chain around a file write. */
const WRITE_SETUP_COMMANDS = new Set(['cd', 'pushd', 'popd', 'mkdir', 'chmod', 'export', 'set', 'source', '.', 'true', ':', 'echo', 'printf']);
const WRITER_COMMANDS = new Set(['cat', 'tee', 'printf', 'echo', 'sed', 'perl', 'true', ':']);

export interface ShellFileWriteAnalysis {
  writes: ShellWriteTarget[];
  /** True when the chain does nothing but write files (plus cd/mkdir/chmod-style setup). */
  pure: boolean;
  /** Names of the other commands the chain runs, in order, e.g. ['npx', 'curl']. */
  otherCommands: string[];
}

/** One lexing pass: the files a command writes and what else it runs. */
export function analyzeShellFileWrites(command: string): ShellFileWriteAnalysis {
  const { targets, commands, writers } = collectShellWrites(command);
  const otherCommands: string[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    const cmd = commands[index];
    const { name } = splitCommandName(cmd.words);
    const writesHere = writers.has(index);
    // Bare redirect such as `> file` (a truncating write) or a keyword-only line.
    if (!name) {
      if (writesHere || cmd.redirects.length === 0) continue;
      otherCommands.push('redirect');
      continue;
    }
    if (writesHere && (WRITER_COMMANDS.has(name) || INTERPRETERS.has(name))) continue;
    if (!writesHere && WRITE_SETUP_COMMANDS.has(name)) continue;
    otherCommands.push(name);
  }
  return { writes: targets, pure: targets.length > 0 && otherCommands.length === 0, otherCommands };
}

/**
 * The writes of a command whose only job is writing files — `cd x && cat > f
 * <<EOF`, `sed -i … a.ts b.ts` — or null when it also runs anything else
 * (tests, builds, pipelines).
 */
export function getPureShellFileWrites(command: string): ShellWriteTarget[] | null {
  const analysis = analyzeShellFileWrites(command);
  return analysis.pure ? analysis.writes : null;
}

export interface ShellReadStep {
  kind: 'read';
  /** Resolved against a static `cd` in the chain when relative. */
  path: string;
  /** 1-based inclusive line range when the command names one (`sed -n 5,9p`, `head -n 40`). */
  range?: { start: number; end: number };
}

export interface ShellSearchStep {
  kind: 'search';
  /** Source text of the grep/rg command, without cd/echo scaffolding. */
  command: string;
  /** The searched pattern, when it is a literal argument. */
  pattern?: string;
  /** File/directory operands, resolved against a static `cd`. */
  paths: string[];
}

export type ShellInspectionStep = ShellReadStep | ShellSearchStep;

const SEARCH_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag']);
/** Commands that only transform piped output (`| head -5`, `| sort -u`). */
const PIPE_FILTER_COMMANDS = new Set(['head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'column', 'nl', 'cat', 'sed', 'awk', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg']);
const INSPECTION_SCAFFOLD_COMMANDS = new Set(['echo', 'printf', 'true', ':']);
/**
 * Read-only probes that flesh out an inspection chain (`ls docs; cat docs/x.md`)
 * without naming a file the row should headline.
 */
const NEUTRAL_INSPECT_COMMANDS = new Set([
  'ls', 'find', 'fd', 'wc', 'stat', 'file', 'du', 'df', 'which', 'type', 'basename', 'dirname',
  'realpath', 'readlink', 'uname', 'hostname', 'date', 'pwd', 'tree', 'ss', 'ps', 'env', 'printenv', 'awk',
]);
/** `git <subcommand>` that only reports; anything else (commit, checkout, …) ends the chain. */
const GIT_READ_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'describe', 'rev-parse', 'blame', 'shortlog', 'ls-files', 'reflog', 'cat-file', 'tag', 'config']);

/**
 * The file reads and searches of a chain that only inspects files — e.g.
 * `cd /repo; sed -n 713,730p a.tsx; echo '---'; sed -n 5,9p b.tsx` — or null
 * when it writes anything or runs any other program. `cd` updates the base
 * for relative paths; `echo` separators and piped filters are scaffolding.
 */
export function analyzeShellInspection(command: string): ShellInspectionStep[] | null {
  const steps: ShellInspectionStep[] = [];
  let cwd: string | null = null;
  const resolve = (path: string): string => (cwd ? joinPosix(cwd, path) : path);

  for (const cmd of parseShellCommands(command)) {
    for (const redirect of cmd.redirects) {
      const writesFile = (redirect.op === '>' || redirect.op === '>>' || redirect.op === '&>' || redirect.op === '&>>')
        && (redirect.fd === null || redirect.fd === 1)
        && redirect.target?.value !== '/dev/null';
      if (writesFile) return null;
    }
    const { name, args } = splitCommandName(cmd.words);
    if (!name) {
      if (cmd.redirects.length > 0 || cmd.heredocBodies.length > 0) return null;
      continue;
    }
    if (name === 'cd' || name === 'pushd') {
      const dir = staticPath(args.find((arg) => !arg.value.startsWith('-')) ?? null);
      cwd = dir ? resolve(dir) : null;
      continue;
    }
    if (name === 'popd') { cwd = null; continue; }
    if (INSPECTION_SCAFFOLD_COMMANDS.has(name) || NEUTRAL_INSPECT_COMMANDS.has(name)) continue;
    if (name === 'git') {
      const subcommand = args.find((arg) => !arg.value.startsWith('-'))?.value ?? '';
      if (!GIT_READ_SUBCOMMANDS.has(subcommand)) return null;
      continue;
    }
    if (cmd.pipeInput && PIPE_FILTER_COMMANDS.has(name) && !SEARCH_COMMANDS.has(name)) {
      if (name === 'sed' && sedInPlaceFiles(args).length > 0) return null;
      continue;
    }
    if (SEARCH_COMMANDS.has(name)) {
      // `rg --files` lists paths (a glob), it doesn't search contents.
      if (name === 'rg' && args.some((arg) => arg.value === '--files')) return null;
      const search = searchOperands(args);
      steps.push({
        kind: 'search',
        command: cmd.text,
        ...(search.pattern !== null ? { pattern: search.pattern } : {}),
        paths: search.paths.map(resolve),
      });
      continue;
    }
    const reads = readOperands(name, args);
    if (!reads) return null;
    // A reader with no resolvable operand (`sed -n 1,5p "$LOG"`) still belongs
    // to the chain; it just cannot name a file to headline.
    for (const read of reads) steps.push({ ...read, path: resolve(read.path) });
  }
  return steps.length > 0 ? steps : null;
}

/** Files (and line ranges) a read-only viewer command prints, or null when it isn't one. */
function readOperands(name: string, args: ShellWord[]): ShellReadStep[] | null {
  const readerNames = new Set(['cat', 'tail', 'nl', 'less', 'more', 'head', 'sed']);
  if (!readerNames.has(name)) return null;
  // Operands that need a shell to resolve: keep the chain, drop the target.
  if (args.some((arg) => arg.dynamic) && !args.every((arg) => arg.value.startsWith('-'))) {
    return name === 'sed' && sedInPlaceFiles(args).length > 0 ? null : [];
  }
  if (name === 'cat' || name === 'tail' || name === 'nl' || name === 'less' || name === 'more') {
    const files = fileOperands(args, name === 'tail' ? new Set(['-n', '-c', '--lines', '--bytes']) : new Set());
    return files.map((path) => ({ kind: 'read' as const, path }));
  }
  if (name === 'head') {
    let lines: number | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index].value;
      const inline = /^-(?:n)?(\d+)$/.exec(value) ?? /^--lines=(\d+)$/.exec(value);
      if (inline) lines = Number(inline[1]);
      else if ((value === '-n' || value === '--lines') && /^\d+$/.test(args[index + 1]?.value ?? '')) lines = Number(args[index + 1].value);
    }
    const files = fileOperands(args, new Set(['-n', '-c', '--lines', '--bytes']));
    return files.map((path) => ({ kind: 'read' as const, path, ...(lines ? { range: { start: 1, end: lines } } : {}) }));
  }
  if (name === 'sed') {
    if (sedInPlaceFiles(args).length > 0) return null;
    let quiet = false;
    let script: string | null = null;
    const operands: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg.value.startsWith('-') && arg.value.length > 1) {
        if (arg.value === '-e' || arg.value === '--expression') { script = args[index + 1]?.value ?? null; index += 1; continue; }
        if (/^-[A-Za-z]+$/.test(arg.value) && arg.value.includes('n')) quiet = true;
        if (arg.value === '--quiet' || arg.value === '--silent') quiet = true;
        continue;
      }
      if (script === null) { script = arg.value; continue; }
      if (arg.dynamic) return null;
      operands.push(arg.value);
    }
    if (operands.length === 0) return null;
    const range = quiet && script ? /^(\d+)(?:,(\d+))?p$/.exec(script.trim()) : null;
    return operands.map((path) => ({
      kind: 'read' as const,
      path,
      ...(range ? { range: { start: Number(range[1]), end: Number(range[2] ?? range[1]) } } : {}),
    }));
  }
  return null;
}

/** Pattern + file operands of a grep/rg command. */
function searchOperands(args: ShellWord[]): { pattern: string | null; paths: string[] } {
  const valueOptions = new Set(['-e', '--regexp', '-f', '--file', '--include', '--exclude', '--glob', '-g', '-m', '--max-count', '-A', '-B', '-C', '--type', '-t']);
  let pattern: string | null = null;
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = arg.value;
    if (value.startsWith('-') && value.length > 1) {
      if (value === '-e' || value === '--regexp') { pattern = args[index + 1]?.value ?? pattern; index += 1; continue; }
      if (valueOptions.has(value)) { index += 1; continue; }
      continue;
    }
    if (pattern === null) { pattern = value; continue; }
    const path = staticPath(arg);
    if (path) paths.push(path);
  }
  return { pattern, paths };
}

/** Non-option operands that resolve to a literal path; unresolvable ones are skipped. */
function fileOperands(args: ShellWord[], optionsWithValue: Set<string>): string[] {
  const files: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.value.startsWith('-') && arg.value.length > 1) {
      if (optionsWithValue.has(arg.value)) index += 1;
      continue;
    }
    const path = staticPath(arg);
    // An operand we cannot resolve or link (`/proc/<pid>/environ`) shouldn't
    // disqualify the chain — it just isn't a file the row can headline.
    if (path) files.push(path);
  }
  return files;
}

const INTERPRETERS = new Set(['python', 'python2', 'python3', 'node', 'nodejs', 'deno', 'bun', 'ruby']);

/**
 * Files an inline interpreter script writes — `python3 - <<'EOF' … p='a.ts';
 * open(p,'w').write(s) … EOF`, `node -e "writeFileSync('a.ts', …)"`. Agents
 * patch files this way constantly, and the row used to show 15 KB of script
 * instead of the file it rewrites. Only literal paths (directly or through a
 * variable assigned a literal) are reported.
 */
function interpreterScriptWrites(
  name: string | null,
  args: ShellWord[],
  heredocBodies: string[],
): Array<{ path: string; operation: ShellWriteOperation; replacements: ShellScriptReplacement[] }> {
  if (!name || !INTERPRETERS.has(name)) return [];
  const scripts: string[] = [...heredocBodies];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index].value;
    if ((value === '-c' || value === '-e' || value === '--eval') && args[index + 1]) scripts.push(args[index + 1].value);
  }
  if (scripts.length === 0) return [];

  const writes: Array<{ path: string; operation: ShellWriteOperation; replacements: ShellScriptReplacement[] }> = [];
  const seen = new Set<string>();
  for (const script of scripts) {
    // `p = 'path'`, `const p = "path"` — the variable form agents use most.
    const variables = new Map<string, string>();
    for (const match of script.matchAll(/(?:^|[\s;({[,])(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\n]+)\2/g)) {
      if (!variables.has(match[1])) variables.set(match[1], match[3]);
    }
    const resolveArg = (raw: string): string | null => {
      const literal = /^\s*(['"])([^'"\n]+)\1\s*$/.exec(raw);
      if (literal) return literal[2];
      const identifier = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(raw);
      return identifier ? variables.get(identifier[1]) ?? null : null;
    };
    const replacements = scriptReplacements(script);
    const record = (raw: string, operation: ShellWriteOperation): void => {
      const path = resolveArg(raw);
      if (!path || path.includes('\n') || /^[-\s]*$/.test(path)) return;
      const key = `${path}:${operation}`;
      if (seen.has(key)) return;
      seen.add(key);
      writes.push({ path, operation, replacements });
    };

    // python: open(x, 'w'|'a'), Path(x).write_text(...)
    for (const match of script.matchAll(/\bopen\s*\(\s*([^,()]+?)\s*,\s*(['"])([rwax]b?\+?)\2/g)) {
      const mode = match[3];
      if (mode.startsWith('w')) record(match[1], 'overwrite');
      else if (mode.startsWith('a')) record(match[1], 'append');
    }
    for (const match of script.matchAll(/\bPath\s*\(\s*([^,()]+?)\s*\)\s*\.\s*write_(?:text|bytes)\s*\(/g)) {
      record(match[1], 'overwrite');
    }
    // PIL / canvas style: `Image.open(src).crop(...).save('out.png')`
    for (const match of script.matchAll(/\.\s*save\s*\(\s*(['"])([^'"\n]+)\1/g)) {
      record(`'${match[2]}'`, 'overwrite');
    }
    // node: writeFileSync(x, …), appendFileSync(x, …), writeFile(x, …)
    for (const match of script.matchAll(/\b(write|append)File(?:Sync)?\s*\(\s*([^,()]+?)\s*,/g)) {
      record(match[2], match[1] === 'append' ? 'append' : 'overwrite');
    }
  }
  return writes;
}

function emptyCommand(): ShellSimpleCommand {
  return { words: [], redirects: [], heredocBodies: [], text: '', pipeInput: false };
}

function consumeHeredocBodies(
  input: string,
  start: number,
  pending: Array<{ delimiter: string; stripTabs: boolean; command: ShellSimpleCommand }>,
): number {
  let i = start;
  for (const heredoc of pending) {
    const lines: string[] = [];
    while (i < input.length) {
      const newline = input.indexOf('\n', i);
      const end = newline === -1 ? input.length : newline;
      const rawLine = input.slice(i, end);
      const line = heredoc.stripTabs ? rawLine.replace(/^\t+/, '') : rawLine;
      i = newline === -1 ? input.length : newline + 1;
      if (line.replace(/\r$/, '') === heredoc.delimiter) break;
      lines.push(line);
    }
    heredoc.command.heredocBodies.push(lines.length > 0 ? `${lines.join('\n')}\n` : '');
  }
  return i;
}

/**
 * Index just past the `)` closing a `$(` whose body starts at `start`. Tracks
 * quotes, nested substitutions and heredocs so text inside (a commit message
 * with `(`, `'` or `->`) cannot end it early or leak out as shell syntax.
 */
function skipCommandSubstitution(input: string, start: number): number {
  let depth = 1;
  let i = start;
  const heredocs: Array<{ delimiter: string; stripTabs: boolean }> = [];
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === "'") {
      const close = input.indexOf("'", i + 1);
      if (close === -1) return input.length;
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < input.length && input[i] !== '"') i += input[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === '<' && input[i + 1] === '<' && input[i + 2] !== '<') {
      const match = /^<<(-?)\s*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([A-Za-z0-9_]+))/.exec(input.slice(i, i + 200));
      if (match) {
        heredocs.push({ delimiter: match[2] ?? match[3] ?? match[4] ?? '', stripTabs: match[1] === '-' });
        i += match[0].length;
        continue;
      }
    }
    if (ch === '\n' && heredocs.length > 0) {
      i = consumeHeredocBodies(input, i + 1, heredocs.map((heredoc) => ({ ...heredoc, command: emptyCommand() })));
      heredocs.length = 0;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return input.length;
}

function splitCommandName(words: ShellWord[]): { name: string | null; args: ShellWord[] } {
  let index = 0;
  let afterPrefix = false;
  while (index < words.length) {
    const value = words[index].value;
    if (ASSIGNMENT.test(value) || KEYWORD_PREFIXES.has(value)) { index += 1; continue; }
    if (COMMAND_PREFIXES.has(value)) { index += 1; afterPrefix = true; continue; }
    if (afterPrefix && value.startsWith('-')) { index += 1; continue; }
    break;
  }
  if (index >= words.length) return { name: null, args: [] };
  const raw = words[index].value;
  const name = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return { name, args: words.slice(index + 1) };
}

function staticPath(word: ShellWord | null): string | null {
  if (!word || word.dynamic) return null;
  const value = word.value;
  if (!value || value === '-' || value.startsWith('-')) return null;
  if (value.includes('\n') || value.includes('\0')) return null;
  if (/^\/(?:dev|proc)\//.test(value)) return null;
  return value;
}

/** `sed` operands after the script, when `-i`/`--in-place` is set. */
function sedInPlaceFiles(args: ShellWord[]): ShellWord[] {
  let inPlace = false;
  let scriptGiven = false;
  const operands: ShellWord[] = [];
  let bsdSuffixPending = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = arg.value;
    if (bsdSuffixPending) {
      bsdSuffixPending = false;
      // BSD `sed -i '' 's/x/y/' file`: an empty word right after -i is the suffix.
      if (value === '') continue;
    }
    if (value === '--') {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (value.startsWith('--')) {
      if (value === '--in-place' || value.startsWith('--in-place=')) inPlace = true;
      else if (value === '--expression' || value === '--file') { scriptGiven = true; index += 1; }
      else if (value.startsWith('--expression=') || value.startsWith('--file=')) scriptGiven = true;
      continue;
    }
    if (value.startsWith('-') && value.length > 1) {
      for (let k = 1; k < value.length; k += 1) {
        const flag = value[k];
        if (flag === 'i') {
          inPlace = true;
          if (k === value.length - 1) bsdSuffixPending = true;
          break; // the rest of the cluster is the backup suffix
        }
        if (flag === 'e' || flag === 'f') {
          scriptGiven = true;
          if (k === value.length - 1) index += 1;
          break;
        }
        if (flag === 'l') {
          if (k === value.length - 1) index += 1;
          break;
        }
      }
      continue;
    }
    operands.push(arg);
  }
  if (!inPlace) return [];
  return scriptGiven ? operands : operands.slice(1);
}

/** `perl` file operands when `-i` is set (`perl -pi -e 's/a/b/' file`). */
function perlInPlaceFiles(args: ShellWord[]): ShellWord[] {
  let inPlace = false;
  let codeGiven = false;
  const operands: ShellWord[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index].value;
    if (value === '--') {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (value.startsWith('-') && value.length > 1 && operands.length === 0) {
      for (let k = 1; k < value.length; k += 1) {
        const flag = value[k];
        if (flag === 'i') { inPlace = true; break; }
        if (flag === 'e' || flag === 'E') {
          codeGiven = true;
          if (k === value.length - 1) index += 1;
          break;
        }
        if ('MmIFlxCdDV0'.includes(flag)) break; // switch consumes the rest of the cluster
      }
      continue;
    }
    operands.push(args[index]);
  }
  if (!inPlace) return [];
  return codeGiven ? operands : operands.slice(1);
}

/** POSIX join + `.`/`..` collapse without depending on node:path (runs in the browser). */
function joinPosix(base: string, target: string): string {
  if (target.startsWith('/') || target.startsWith('~')) return target;
  const absolute = base.startsWith('/');
  const parts: string[] = [];
  for (const part of `${base}/${target}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..' && parts[parts.length - 1] !== '~') parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`;
}
