import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type Server as NetServer } from 'node:net';
import { getDataDir } from '../data/index.js';
import type {
  PluginShellCommandDefinition,
  PluginShellCommandInput,
  PluginShellCommandPrepareResult,
} from '../../shared/plugin-types.js';

const COMMAND_RE = /^\/?[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const MAX_SCRIPT_BYTES = 128 * 1024;
const CHALLENGE_TTL_MS = 10 * 60_000;
const AUTHORIZATION_TTL_MS = 30_000;

export const EXECUTE_SUDO_COMMAND_ID = 'builtin-execute-sudo-command';
const EXECUTE_SUDO_COMMAND_SCRIPT = `set -euo pipefail
if [ "$#" -eq 0 ]; then
  echo "execute-sudo-command requires an executable" >&2
  exit 64
fi
if [ "$1" = "sudo" ]; then
  shift
fi
if [ "$#" -eq 0 ]; then
  echo "execute-sudo-command requires an executable after sudo" >&2
  exit 64
fi
sudo "$@"`;
const EXECUTE_SUDO_COMMAND_DEFINITION: PluginShellCommandDefinition = {
  id: EXECUTE_SUDO_COMMAND_ID,
  name: '/execute-sudo-command',
  summary: 'Execute an explicitly authorized command with sudo',
  script: EXECUTE_SUDO_COMMAND_SCRIPT,
  runAsSudo: true,
  pty: true,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

interface PersistedShellCommands {
  version: 1;
  commands: PluginShellCommandDefinition[];
}

interface SudoChallenge {
  id: string;
  commandId: string;
  agentId: string;
  args: string[];
  expiresAt: number;
  authorized: boolean;
  requestedByAgent: boolean;
  /** Ephemeral launch credential; zeroed after the per-run sudo channel serves or closes. */
  password?: Buffer;
}

export interface PreparedShellCommandExecution {
  definition: PluginShellCommandDefinition;
  invocation: string;
  args: string[];
  sudoPassword?: Buffer;
  requestedByAgent?: boolean;
}

export class PluginShellCommandError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'SHELL_COMMAND_ERROR',
  ) {
    super(message);
    this.name = 'PluginShellCommandError';
  }
}

export type SudoPasswordValidator = (password: string) => Promise<boolean>;

function normalizeName(value: string): string {
  const trimmed = value.trim();
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.toLowerCase();
}

function cleanInput(input: PluginShellCommandInput): Omit<PluginShellCommandDefinition, 'id' | 'createdAt' | 'updatedAt'> {
  if (typeof input.name !== 'string' || !COMMAND_RE.test(input.name.trim())) {
    throw new PluginShellCommandError('Slash command must contain only letters, numbers, dashes, or underscores');
  }
  const name = normalizeName(input.name);
  if (name.length > 81) throw new PluginShellCommandError('Slash command is too long');

  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  if (!summary || summary.length > 500 || summary.includes('\0')) {
    throw new PluginShellCommandError('Description is required and must be 500 characters or fewer');
  }

  const script = typeof input.script === 'string' ? input.script.replace(/\r\n/g, '\n').trim() : '';
  if (!script || Buffer.byteLength(script, 'utf8') > MAX_SCRIPT_BYTES || script.includes('\0')) {
    throw new PluginShellCommandError('Bash script is required and must be 128 KB or smaller');
  }

  const cwd = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : undefined;
  if (cwd && (!path.isAbsolute(cwd) || cwd.includes('\0') || cwd.length > 2_000)) {
    throw new PluginShellCommandError('Working directory must be an absolute path');
  }

  return {
    name,
    summary,
    script,
    ...(cwd ? { cwd } : {}),
    runAsSudo: input.runAsSudo === true,
    pty: input.pty !== false,
    enabled: input.enabled !== false,
  };
}

/** Parse shell-like quoted arguments without ever evaluating them. */
export function parsePluginShellCommandArgs(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let started = false;
  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      started = true;
    } else if (character === '\\' && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
      started = true;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
    } else {
      current += character;
      started = true;
    }
  }
  if (quote) throw new PluginShellCommandError('Unclosed quote in command arguments');
  if (escaped) current += '\\';
  if (started || escaped) args.push(current);
  if (args.length > 100) throw new PluginShellCommandError('A slash command accepts at most 100 arguments');
  if (args.some((argument) => argument.length > 8_192 || argument.includes('\0'))) {
    throw new PluginShellCommandError('One or more command arguments are too long');
  }
  return args;
}

function sameArgs(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function defaultSudoPasswordValidator(password: string): Promise<boolean> {
  if (!password || password.length > 4_096 || /[\0\r\n]/.test(password)) return false;
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn('sudo', ['-S', '-k', '-p', '', '-v'], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' },
    });
    let settled = false;
    const finish = (result: boolean, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, 15_000);
    child.stderr?.resume();
    child.once('error', (error) => finish(false, new PluginShellCommandError(
      error.message.includes('ENOENT') ? 'sudo is not installed on the Commander host' : 'Unable to start sudo',
      503,
      'SUDO_UNAVAILABLE',
    )));
    child.once('close', (code) => finish(code === 0));
    child.stdin?.end(`${password}\n`);
  });
}

export class PluginShellCommandService {
  private readonly dataDir: string;
  private readonly stateFile: string;
  private readonly runDir: string;
  private readonly sudoSocketDir: string;
  private readonly validateSudoPassword: SudoPasswordValidator;
  private commands = new Map<string, PluginShellCommandDefinition>();
  private challenges = new Map<string, SudoChallenge>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    dataDir?: string;
    sudoSocketDir?: string;
    sudoPasswordValidator?: SudoPasswordValidator;
  } = {}) {
    this.dataDir = options.dataDir ?? path.join(getDataDir(), 'plugins', 'shell-commands');
    this.stateFile = path.join(this.dataDir, 'commands.json');
    this.runDir = path.join(this.dataDir, 'runs');
    const runtimeBase = process.env.XDG_RUNTIME_DIR?.trim()
      || path.join(os.tmpdir(), `tide-commander-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`);
    this.sudoSocketDir = options.sudoSocketDir
      ?? path.join(runtimeBase, 'tide-commander', `sudo-${process.pid}`);
    this.validateSudoPassword = options.sudoPasswordValidator ?? defaultSudoPasswordValidator;
  }

  async list(): Promise<PluginShellCommandDefinition[]> {
    await this.ensureLoaded();
    return Array.from(this.commands.values())
      .map((command) => ({ ...command }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(id: string): Promise<PluginShellCommandDefinition> {
    if (id === EXECUTE_SUDO_COMMAND_ID) return { ...EXECUTE_SUDO_COMMAND_DEFINITION };
    await this.ensureLoaded();
    const command = this.commands.get(id);
    if (!command) throw new PluginShellCommandError('Shell slash command not found', 404, 'SHELL_COMMAND_NOT_FOUND');
    return { ...command };
  }

  async findByName(name: string): Promise<PluginShellCommandDefinition | undefined> {
    await this.ensureLoaded();
    const normalized = normalizeName(name);
    const command = Array.from(this.commands.values()).find((candidate) => candidate.name === normalized);
    return command ? { ...command } : undefined;
  }

  async create(input: PluginShellCommandInput): Promise<PluginShellCommandDefinition> {
    return this.mutate(async () => {
      const clean = cleanInput(input);
      this.assertUniqueName(clean.name);
      const now = Date.now();
      const command: PluginShellCommandDefinition = { ...clean, id: randomUUID(), createdAt: now, updatedAt: now };
      this.commands.set(command.id, command);
      await this.persist();
      return { ...command };
    });
  }

  async update(id: string, input: PluginShellCommandInput): Promise<PluginShellCommandDefinition> {
    return this.mutate(async () => {
      const existing = this.commands.get(id);
      if (!existing) throw new PluginShellCommandError('Shell slash command not found', 404, 'SHELL_COMMAND_NOT_FOUND');
      const clean = cleanInput(input);
      this.assertUniqueName(clean.name, id);
      const command: PluginShellCommandDefinition = {
        ...clean,
        id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      this.commands.set(id, command);
      await this.persist();
      return { ...command };
    });
  }

  async remove(id: string): Promise<void> {
    await this.mutate(async () => {
      if (!this.commands.delete(id)) {
        throw new PluginShellCommandError('Shell slash command not found', 404, 'SHELL_COMMAND_NOT_FOUND');
      }
      for (const [challengeId, challenge] of this.challenges) {
        if (challenge.commandId === id) {
          challenge.password?.fill(0);
          this.challenges.delete(challengeId);
        }
      }
      await this.persist();
    });
  }

  async prepare(id: string, agentId: string, argsText: string): Promise<PluginShellCommandPrepareResult> {
    return this.createPreparation(id, agentId, parsePluginShellCommandArgs(argsText), false);
  }

  async prepareArgs(
    id: string,
    agentId: string,
    args: string[],
    requestedByAgent = true,
  ): Promise<PluginShellCommandPrepareResult> {
    return this.createPreparation(id, agentId, args, requestedByAgent);
  }

  private async createPreparation(
    id: string,
    agentId: string,
    args: string[],
    requestedByAgent: boolean,
  ): Promise<PluginShellCommandPrepareResult> {
    const definition = await this.get(id);
    if (!definition.enabled) throw new PluginShellCommandError('Shell slash command is disabled', 409, 'SHELL_COMMAND_DISABLED');
    if (args.length > 100 || args.some((argument) => typeof argument !== 'string' || argument.includes('\0') || argument.length > 8_192)) {
      throw new PluginShellCommandError('Invalid shell command arguments');
    }
    const invocation = [definition.name, ...args.map((argument) => shellQuote(argument))].join(' ');
    if (!definition.runAsSudo) {
      return { commandId: id, invocation, args: [...args], requiresSudo: false };
    }
    this.pruneChallenges();
    const challengeId = randomUUID();
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    this.challenges.set(challengeId, {
      id: challengeId,
      commandId: id,
      agentId,
      args: [...args],
      expiresAt,
      authorized: false,
      requestedByAgent,
    });
    return { commandId: id, invocation, args: [...args], requiresSudo: true, challengeId, expiresAt };
  }

  async authorizeSudo(challengeId: string, password: string): Promise<void> {
    this.pruneChallenges();
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.expiresAt <= Date.now()) {
      throw new PluginShellCommandError('Sudo authorization request expired', 410, 'SUDO_CHALLENGE_EXPIRED');
    }
    const valid = password.length > 0
      && password.length <= 4_096
      && !/[\0\r\n]/.test(password)
      && await this.validateSudoPassword(password);
    if (!valid) throw new PluginShellCommandError('Incorrect sudo password', 401, 'SUDO_PASSWORD_INVALID');
    challenge.password?.fill(0);
    challenge.password = Buffer.from(password, 'utf8');
    challenge.authorized = true;
    challenge.expiresAt = Date.now() + AUTHORIZATION_TTL_MS;
    const expiryTimer = setTimeout(() => {
      const stale = this.challenges.get(challengeId);
      if (stale && stale.expiresAt <= Date.now()) {
        stale.password?.fill(0);
        this.challenges.delete(challengeId);
      }
    }, AUTHORIZATION_TTL_MS + 100);
    expiryTimer.unref();
  }

  async prepareExecution(
    id: string,
    agentId: string,
    args: string[],
    authorizationId?: string,
  ): Promise<PreparedShellCommandExecution> {
    const definition = await this.get(id);
    if (!definition.enabled) throw new PluginShellCommandError('Shell slash command is disabled', 409, 'SHELL_COMMAND_DISABLED');
    if (args.length > 100 || args.some((argument) => typeof argument !== 'string' || argument.includes('\0') || argument.length > 8_192)) {
      throw new PluginShellCommandError('Invalid shell command arguments');
    }
    const sudoAuthorization = definition.runAsSudo
      ? this.consumeAuthorization(authorizationId, id, agentId, args)
      : undefined;
    const invocation = [definition.name, ...args.map((argument) => shellQuote(argument))].join(' ');
    return {
      definition,
      invocation,
      args: [...args],
      ...(sudoAuthorization ? {
        sudoPassword: sudoAuthorization.password,
        requestedByAgent: sudoAuthorization.requestedByAgent,
      } : {}),
    };
  }

  async materializeScript(script: string, sudoEnabled = false): Promise<{
    filePath: string;
    sudoEnv?: Record<string, string>;
    sudoSocketPath?: string;
    cleanup: () => Promise<void>;
  }> {
    await fs.mkdir(this.runDir, { recursive: true, mode: 0o700 });
    const executionDir = path.join(this.runDir, randomUUID());
    await fs.mkdir(executionDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(executionDir, 'command.sh');
    await fs.writeFile(filePath, `#!/usr/bin/env bash\n${script}\n`, { encoding: 'utf8', mode: 0o700 });
    await fs.chmod(filePath, 0o700);

    let sudoEnv: Record<string, string> | undefined;
    if (sudoEnabled) {
      const binDir = path.join(executionDir, 'bin');
      await fs.mkdir(binDir, { mode: 0o700 });
      const askpassPath = path.join(executionDir, 'sudo-askpass.sh');
      const sudoPath = path.join(binDir, 'sudo');
      const sudoSocketPath = path.join(this.sudoSocketDir, `${randomUUID()}.sock`);
      // askpass receives only an ephemeral Unix-socket path. The password is
      // delivered by Commander when sudo asks; it never enters argv/env/files.
      await fs.access('/usr/bin/socat').catch(() => {
        throw new PluginShellCommandError(
          'sudo password support requires /usr/bin/socat on the Commander host',
          503,
          'SUDO_ASKPASS_UNAVAILABLE',
        );
      });
      await fs.writeFile(
        askpassPath,
        '#!/bin/sh\nexec /usr/bin/socat - "UNIX-CONNECT:${TIDE_SUDO_SOCKET}"\n',
        { encoding: 'utf8', mode: 0o700 },
      );
      await fs.writeFile(
        sudoPath,
        "#!/bin/sh\nexec /usr/bin/sudo -A \"$@\"\n",
        { encoding: 'utf8', mode: 0o700 },
      );
      await Promise.all([fs.chmod(askpassPath, 0o700), fs.chmod(sudoPath, 0o700)]);
      sudoEnv = {
        PATH: `${binDir}:${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
        SUDO_ASKPASS: askpassPath,
        SUDO_ASKPASS_REQUIRE: 'force',
        TIDE_SUDO_SOCKET: sudoSocketPath,
      };
    }

    return {
      filePath,
      ...(sudoEnv ? { sudoEnv, sudoSocketPath: sudoEnv.TIDE_SUDO_SOCKET } : {}),
      cleanup: async () => { await fs.rm(executionDir, { recursive: true, force: true }); },
    };
  }

  async openSudoCredentialChannel(
    socketPath: string,
    password: Buffer,
  ): Promise<{ close: () => Promise<void> }> {
    if (Buffer.byteLength(socketPath) >= 104) {
      password.fill(0);
      throw new PluginShellCommandError(
        'Commander sudo socket path exceeds the host limit',
        500,
        'SUDO_SOCKET_PATH_TOO_LONG',
      );
    }
    await fs.mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(socketPath), 0o700);
    await fs.rm(socketPath, { force: true });
    let served = false;
    let closed = false;
    let server: NetServer;
    const close = async () => {
      if (closed) return;
      closed = true;
      password.fill(0);
      await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined);
      await fs.rm(socketPath, { force: true });
    };
    server = createServer((socket) => {
      socket.on('error', () => undefined);
      if (served) {
        socket.destroy();
        return;
      }
      served = true;
      const payload = Buffer.concat([password, Buffer.from('\n')]);
      socket.end(payload, () => {
        payload.fill(0);
        void close();
      });
    });
    server.on('error', () => {
      password.fill(0);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    await fs.chmod(socketPath, 0o600);
    return { close };
  }

  private consumeAuthorization(
    authorizationId: string | undefined,
    commandId: string,
    agentId: string,
    args: string[],
  ): { password: Buffer; requestedByAgent: boolean } {
    this.pruneChallenges();
    const challenge = authorizationId ? this.challenges.get(authorizationId) : undefined;
    if (!challenge || !challenge.authorized || challenge.expiresAt <= Date.now()) {
      throw new PluginShellCommandError('Sudo password is required', 428, 'SUDO_PASSWORD_REQUIRED');
    }
    if (challenge.commandId !== commandId || challenge.agentId !== agentId || !sameArgs(challenge.args, args)) {
      throw new PluginShellCommandError('Sudo authorization does not match this command', 403, 'SUDO_AUTHORIZATION_MISMATCH');
    }
    if (!challenge.password) {
      throw new PluginShellCommandError('Sudo password is required', 428, 'SUDO_PASSWORD_REQUIRED');
    }
    this.challenges.delete(challenge.id);
    return { password: challenge.password, requestedByAgent: challenge.requestedByAgent };
  }

  private pruneChallenges(): void {
    const now = Date.now();
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) {
        challenge.password?.fill(0);
        this.challenges.delete(id);
      }
    }
  }

  private assertUniqueName(name: string, exceptId?: string): void {
    const duplicate = Array.from(this.commands.values()).find((command) => command.id !== exceptId && command.name === name);
    if (duplicate) throw new PluginShellCommandError(`Slash command ${name} is already registered`, 409, 'SHELL_COMMAND_EXISTS');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
        // Execution copies may contain resolved {{SECRET}} values. A crash can
        // skip normal cleanup, so purge stale copies before accepting commands.
        await fs.rm(this.runDir, { recursive: true, force: true });
        await fs.mkdir(this.runDir, { recursive: true, mode: 0o700 });
        await fs.rm(this.sudoSocketDir, { recursive: true, force: true });
        await fs.mkdir(this.sudoSocketDir, { recursive: true, mode: 0o700 });
        try {
          const raw = JSON.parse(await fs.readFile(this.stateFile, 'utf8')) as Partial<PersistedShellCommands>;
          if (raw.version === 1 && Array.isArray(raw.commands)) {
            for (const command of raw.commands) {
              try {
                const clean = cleanInput(command);
                if (typeof command.id !== 'string' || !command.id) continue;
                this.commands.set(command.id, {
                  ...clean,
                  id: command.id,
                  createdAt: Number(command.createdAt) || Date.now(),
                  updatedAt: Number(command.updatedAt) || Date.now(),
                });
              } catch {
                // Ignore only the invalid record; one bad edit must not hide all commands.
              }
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        this.loaded = true;
      })().finally(() => { this.loadPromise = null; });
    }
    await this.loadPromise;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${this.stateFile}.${process.pid}.tmp`;
    const body: PersistedShellCommands = { version: 1, commands: Array.from(this.commands.values()) };
    await fs.writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, this.stateFile);
    await fs.chmod(this.stateFile, 0o600);
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureLoaded();
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const pluginShellCommandService = new PluginShellCommandService();
