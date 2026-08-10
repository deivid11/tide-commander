import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CadCapabilities,
  CadCheckRequest,
  CadJob,
  CadJobRequest,
  CadObjectReference,
  CadObjectSelection,
  CadOutputRequest,
  CadRenderRequest,
  CadRunResult,
} from '../../shared/cad-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CAD');
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_JOBS = 100;
const MAX_ARTIFACTS_PER_JOB = 64;
const ENTRYPOINT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

interface FreeCadCommand {
  executable: string;
  prefixArgs: string[];
  display: string;
  version: string;
  flatpakAppId?: string;
}

export class CadRequestError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'CadRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CadRequestError(`${field} must be a non-empty string`);
  }
  return value;
}

function assertNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new CadRequestError(`${field} must be a number between ${min} and ${max}`);
  }
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await fs.access(current, fsConstants.F_OK);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new CadRequestError(`No existing parent for output path: ${candidate}`);
      current = parent;
    }
  }
}

async function normalizeArtifactPath(workspace: string, value: unknown, field: string, extension: string): Promise<string> {
  const relativePath = assertString(value, field);
  if (path.isAbsolute(relativePath)) {
    throw new CadRequestError(`${field} must be relative to workspace`);
  }

  const target = path.resolve(workspace, relativePath);
  if (!isWithin(workspace, target)) {
    throw new CadRequestError(`${field} escapes workspace`);
  }
  if (path.extname(target).toLowerCase() !== extension) {
    throw new CadRequestError(`${field} must end in ${extension}`);
  }

  const ancestor = await nearestExistingAncestor(path.dirname(target));
  const realAncestor = await fs.realpath(ancestor);
  if (!isWithin(workspace, realAncestor)) {
    throw new CadRequestError(`${field} resolves through a directory outside workspace`);
  }
  return path.relative(workspace, target);
}

function normalizeSelection(value: Record<string, unknown>, field: string): CadObjectSelection {
  const selection: CadObjectSelection = {};
  if (value.document !== undefined) selection.document = assertString(value.document, `${field}.document`);
  if (value.objects !== undefined) {
    if (!Array.isArray(value.objects) || value.objects.length === 0 || value.objects.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new CadRequestError(`${field}.objects must be a non-empty string array`);
    }
    selection.objects = [...new Set(value.objects as string[])];
  }
  return selection;
}

function normalizeObjectReference(value: unknown, field: string): CadObjectReference {
  if (!isRecord(value)) throw new CadRequestError(`${field} must be an object`);
  const object = assertString(value.object, `${field}.object`);
  const document = value.document === undefined ? undefined : assertString(value.document, `${field}.document`);
  return { object, ...(document ? { document } : {}) };
}

async function normalizeOutputs(workspace: string, value: unknown): Promise<CadOutputRequest[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CadRequestError('outputs must be an array');
  if (value.length > MAX_ARTIFACTS_PER_JOB) throw new CadRequestError(`outputs may contain at most ${MAX_ARTIFACTS_PER_JOB} entries`);

  return Promise.all(value.map(async (raw, index) => {
    if (!isRecord(raw)) throw new CadRequestError(`outputs[${index}] must be an object`);
    if (raw.format !== 'fcstd' && raw.format !== 'stl' && raw.format !== 'step') {
      throw new CadRequestError(`outputs[${index}].format must be fcstd, stl, or step`);
    }
    const extension = raw.format === 'fcstd' ? '.fcstd' : `.${raw.format}`;
    const output: CadOutputRequest = {
      ...normalizeSelection(raw, `outputs[${index}]`),
      format: raw.format,
      path: await normalizeArtifactPath(workspace, raw.path, `outputs[${index}].path`, extension),
    };
    if (raw.linearDeflection !== undefined) {
      output.linearDeflection = assertNumber(raw.linearDeflection, `outputs[${index}].linearDeflection`, 0.001, 10);
    }
    if (raw.angularDeflection !== undefined) {
      output.angularDeflection = assertNumber(raw.angularDeflection, `outputs[${index}].angularDeflection`, 0.001, Math.PI);
    }
    return output;
  }));
}

async function normalizeRenders(workspace: string, value: unknown): Promise<CadRenderRequest[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CadRequestError('renders must be an array');
  if (value.length > MAX_ARTIFACTS_PER_JOB) throw new CadRequestError(`renders may contain at most ${MAX_ARTIFACTS_PER_JOB} entries`);

  const views = new Set(['isometric', 'front', 'back', 'left', 'right', 'top', 'bottom']);
  return Promise.all(value.map(async (raw, index) => {
    if (!isRecord(raw)) throw new CadRequestError(`renders[${index}] must be an object`);
    const render: CadRenderRequest = {
      ...normalizeSelection(raw, `renders[${index}]`),
      path: await normalizeArtifactPath(workspace, raw.path, `renders[${index}].path`, '.png'),
    };
    if (raw.view !== undefined) {
      if (typeof raw.view !== 'string' || !views.has(raw.view)) throw new CadRequestError(`renders[${index}].view is invalid`);
      render.view = raw.view as CadRenderRequest['view'];
    }
    if (raw.width !== undefined) render.width = assertNumber(raw.width, `renders[${index}].width`, 128, 4096);
    if (raw.height !== undefined) render.height = assertNumber(raw.height, `renders[${index}].height`, 128, 4096);
    if (raw.fitMargin !== undefined) render.fitMargin = assertNumber(raw.fitMargin, `renders[${index}].fitMargin`, 0, 0.4);
    if (raw.linearDeflection !== undefined) {
      render.linearDeflection = assertNumber(raw.linearDeflection, `renders[${index}].linearDeflection`, 0.001, 10);
    }
    for (const colorField of ['color', 'edgeColor'] as const) {
      if (raw[colorField] !== undefined) {
        if (typeof raw[colorField] !== 'string' || !HEX_COLOR_RE.test(raw[colorField])) {
          throw new CadRequestError(`renders[${index}].${colorField} must be a six-digit hex color`);
        }
        render[colorField] = raw[colorField];
      }
    }
    if (raw.background !== undefined) {
      if (raw.background !== 'transparent' && (typeof raw.background !== 'string' || !HEX_COLOR_RE.test(raw.background))) {
        throw new CadRequestError(`renders[${index}].background must be transparent or a six-digit hex color`);
      }
      render.background = raw.background;
    }
    if (raw.edges !== undefined) {
      if (typeof raw.edges !== 'boolean') throw new CadRequestError(`renders[${index}].edges must be boolean`);
      render.edges = raw.edges;
    }
    return render;
  }));
}

function normalizeChecks(value: unknown): CadCheckRequest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CadRequestError('checks must be an array');
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new CadRequestError(`checks[${index}] must be an object`);
    if (raw.type !== 'clearance' && raw.type !== 'intersection') {
      throw new CadRequestError(`checks[${index}].type must be clearance or intersection`);
    }
    const base = {
      type: raw.type,
      ...(raw.name === undefined ? {} : { name: assertString(raw.name, `checks[${index}].name`) }),
      a: normalizeObjectReference(raw.a, `checks[${index}].a`),
      b: normalizeObjectReference(raw.b, `checks[${index}].b`),
    };
    if (raw.type === 'clearance') {
      return { ...base, type: 'clearance', minimum: assertNumber(raw.minimum, `checks[${index}].minimum`, 0, 100_000) };
    }
    return {
      ...base,
      type: 'intersection',
      ...(raw.maximumVolume === undefined
        ? {}
        : { maximumVolume: assertNumber(raw.maximumVolume, `checks[${index}].maximumVolume`, 0, Number.MAX_SAFE_INTEGER) }),
    };
  });
}

export async function normalizeCadJobRequest(value: unknown): Promise<CadJobRequest> {
  if (!isRecord(value)) throw new CadRequestError('Request body must be a JSON object');

  const requestedWorkspace = path.resolve(assertString(value.workspace, 'workspace'));
  let workspace: string;
  try {
    workspace = await fs.realpath(requestedWorkspace);
    const stat = await fs.stat(workspace);
    if (!stat.isDirectory()) throw new CadRequestError('workspace must be a directory');
  } catch (error) {
    if (error instanceof CadRequestError) throw error;
    throw new CadRequestError(`workspace does not exist: ${requestedWorkspace}`);
  }

  const requestedScript = assertString(value.script, 'script');
  if (path.isAbsolute(requestedScript)) throw new CadRequestError('script must be relative to workspace');
  const scriptCandidate = path.resolve(workspace, requestedScript);
  if (!isWithin(workspace, scriptCandidate)) throw new CadRequestError('script escapes workspace');
  let scriptRealPath: string;
  try {
    scriptRealPath = await fs.realpath(scriptCandidate);
  } catch {
    throw new CadRequestError(`script does not exist: ${requestedScript}`);
  }
  if (!isWithin(workspace, scriptRealPath)) throw new CadRequestError('script resolves outside workspace');
  if (path.extname(scriptRealPath).toLowerCase() !== '.py') throw new CadRequestError('script must be a .py file');

  let entrypoint: string | null = 'build';
  if (value.entrypoint === null) entrypoint = null;
  else if (value.entrypoint !== undefined) {
    entrypoint = assertString(value.entrypoint, 'entrypoint');
    if (!ENTRYPOINT_RE.test(entrypoint)) throw new CadRequestError('entrypoint must be a Python identifier');
  }

  let parameters: Record<string, unknown> = {};
  if (value.parameters !== undefined) {
    if (!isRecord(value.parameters)) throw new CadRequestError('parameters must be a JSON object');
    try {
      JSON.stringify(value.parameters);
    } catch {
      throw new CadRequestError('parameters must be JSON serializable');
    }
    parameters = value.parameters;
  }

  const outputs = await normalizeOutputs(workspace, value.outputs);
  const renders = await normalizeRenders(workspace, value.renders);
  if (outputs.length + renders.length > MAX_ARTIFACTS_PER_JOB) {
    throw new CadRequestError(`A job may create at most ${MAX_ARTIFACTS_PER_JOB} artifacts`);
  }
  const allPaths = [...outputs.map((output) => output.path), ...renders.map((render) => render.path)];
  if (new Set(allPaths).size !== allPaths.length) throw new CadRequestError('Artifact paths must be unique within a job');

  const timeoutMs = value.timeoutMs === undefined
    ? DEFAULT_TIMEOUT_MS
    : assertNumber(value.timeoutMs, 'timeoutMs', 1_000, MAX_TIMEOUT_MS);

  return {
    workspace,
    script: path.relative(workspace, scriptRealPath),
    entrypoint,
    parameters,
    outputs,
    renders,
    checks: normalizeChecks(value.checks),
    timeoutMs,
  };
}

function appendCapped(current: string, chunk: Buffer | string): string {
  const combined = current + chunk.toString();
  if (Buffer.byteLength(combined) <= MAX_LOG_BYTES) return combined;
  const marker = '\n[output truncated by Tide Commander]\n';
  return combined.slice(combined.length - MAX_LOG_BYTES + marker.length) + marker;
}

function executableOnPath(name: string): Promise<string | null> {
  if (name.includes(path.sep)) {
    return fs.access(name, fsConstants.X_OK).then(() => name).catch(() => null);
  }
  const entries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return Promise.all(entries.map(async (entry) => {
    const candidate = path.join(entry, name);
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  })).then((matches) => matches.find(Boolean) || null);
}

async function capture(executable: string, args: string[], timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const child = spawn(executable, args, { shell: false, env: { ...process.env } });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        resolve({ code: null, output: `${output}\nCommand timed out` });
      }
    }, timeoutMs);
    timer.unref();
    child.stdout?.on('data', (data: Buffer) => { output = appendCapped(output, data); });
    child.stderr?.on('data', (data: Buffer) => { output = appendCapped(output, data); });
    child.once('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code: null, output: `${output}\n${error.message}` });
      }
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code, output });
      }
    });
  });
}

async function findFreeCadCommand(): Promise<FreeCadCommand> {
  const candidates: Array<{ executable: string; prefixArgs: string[]; display: string; flatpakAppId?: string }> = [];
  const override = process.env.TIDE_CAD_FREECAD_CMD?.trim();
  if (override) {
    candidates.push({ executable: override, prefixArgs: [], display: override });
  }
  candidates.push(
    { executable: 'FreeCADCmd', prefixArgs: [], display: 'FreeCADCmd' },
    { executable: 'freecadcmd', prefixArgs: [], display: 'freecadcmd' },
    {
      executable: 'flatpak',
      prefixArgs: ['run', '--command=FreeCADCmd', process.env.TIDE_CAD_FREECAD_FLATPAK_ID || 'org.freecad.FreeCAD'],
      display: `flatpak:${process.env.TIDE_CAD_FREECAD_FLATPAK_ID || 'org.freecad.FreeCAD'}`,
      flatpakAppId: process.env.TIDE_CAD_FREECAD_FLATPAK_ID || 'org.freecad.FreeCAD',
    },
  );

  const failures: string[] = [];
  for (const candidate of candidates) {
    const executable = await executableOnPath(candidate.executable);
    if (!executable) {
      failures.push(`${candidate.display}: executable not found`);
      continue;
    }
    const probe = await capture(executable, [...candidate.prefixArgs, '--version'], 10_000);
    if (probe.code === 0) {
      const version = probe.output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || 'unknown';
      return { ...candidate, executable, version };
    }
    failures.push(`${candidate.display}: ${probe.output.trim() || `exit ${probe.code}`}`);
  }
  throw new Error(`FreeCADCmd is unavailable. ${failures.join('; ')}`);
}

function terminateProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* process already exited */ }
  }
}

export class CadService {
  private readonly jobs = new Map<string, CadJob>();
  private readonly queue: string[] = [];
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly concurrency: number;
  private activeCount = 0;
  private commandPromise: Promise<FreeCadCommand> | null = null;
  private readonly runnerPath: string;

  constructor(options: { concurrency?: number; runnerPath?: string } = {}) {
    const configured = Number(process.env.TIDE_CAD_MAX_CONCURRENCY || 1);
    this.concurrency = Math.max(1, Math.min(4, options.concurrency ?? (Number.isFinite(configured) ? configured : 1)));
    this.runnerPath = options.runnerPath || fileURLToPath(new URL('../cad/freecad-runner.py', import.meta.url));
  }

  async getCapabilities(force = false): Promise<CadCapabilities> {
    if (force) this.commandPromise = null;
    try {
      this.commandPromise ||= findFreeCadCommand();
      const command = await this.commandPromise;
      return {
        available: true,
        engine: 'freecadcmd',
        command: command.display,
        version: command.version,
        renderBackend: 'pillow-software',
        formats: ['fcstd', 'stl', 'step', 'png'],
      };
    } catch (error) {
      this.commandPromise = null;
      return {
        available: false,
        engine: 'freecadcmd',
        renderBackend: 'pillow-software',
        formats: ['fcstd', 'stl', 'step', 'png'],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createJob(value: unknown): Promise<CadJob> {
    const request = await normalizeCadJobRequest(value);
    const job: CadJob = {
      id: randomUUID(),
      status: 'queued',
      request,
      createdAt: Date.now(),
      stdout: '',
      stderr: '',
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.pruneJobs();
    this.pump();
    return job;
  }

  getJob(id: string): CadJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(limit = 20): CadJob[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, safeLimit);
  }

  cancelJob(id: string): CadJob | undefined {
    const job = this.jobs.get(id);
    if (!job || !['queued', 'running'].includes(job.status)) return undefined;
    job.status = 'cancelled';
    job.completedAt = Date.now();
    const queuedIndex = this.queue.indexOf(id);
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
    const child = this.activeProcesses.get(id);
    if (child) terminateProcess(child, 'SIGTERM');
    return job;
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      this.activeCount++;
      void this.runJob(job).finally(() => {
        this.activeCount--;
        this.pump();
      });
    }
  }

  private async runJob(job: CadJob): Promise<void> {
    job.status = 'running';
    job.startedAt = Date.now();
    const scratchRoot = path.join(os.homedir(), '.cache', 'tide-commander', 'cad-jobs');
    const scratch = path.join(scratchRoot, job.id);
    const requestPath = path.join(scratch, 'job.json');
    const resultPath = path.join(scratch, 'result.json');

    try {
      await fs.mkdir(scratch, { recursive: true });
      await fs.writeFile(requestPath, JSON.stringify({ ...job.request, jobId: job.id }, null, 2), 'utf8');
      const command = await (this.commandPromise ||= findFreeCadCommand());
      await fs.access(this.runnerPath, fsConstants.R_OK);

      const runnerArgs = command.flatpakAppId
        ? [
            'run',
            '--command=FreeCADCmd',
            `--env=TIDE_CAD_JOB_PATH=${requestPath}`,
            `--env=TIDE_CAD_RESULT_PATH=${resultPath}`,
            '--env=TIDE_CAD_HEADLESS=1',
            command.flatpakAppId,
            this.runnerPath,
          ]
        : [...command.prefixArgs, this.runnerPath];
      const child = spawn(command.executable, runnerArgs, {
        cwd: job.request.workspace,
        env: {
          ...process.env,
          TIDE_CAD_HEADLESS: '1',
          TIDE_CAD_JOB_PATH: requestPath,
          TIDE_CAD_RESULT_PATH: resultPath,
        },
        shell: false,
        detached: process.platform !== 'win32',
      });
      this.activeProcesses.set(job.id, child);
      child.stdout?.on('data', (data: Buffer) => { job.stdout = appendCapped(job.stdout, data); });
      child.stderr?.on('data', (data: Buffer) => { job.stderr = appendCapped(job.stderr, data); });

      const timeoutMs = job.request.timeoutMs || DEFAULT_TIMEOUT_MS;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        terminateProcess(child, 'SIGTERM');
        const hardKill = setTimeout(() => terminateProcess(child, 'SIGKILL'), 2_000);
        hardKill.unref();
      }, timeoutMs);
      timer.unref();

      const exit = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
        let settled = false;
        child.once('error', (error) => {
          if (!settled) {
            settled = true;
            resolve({ code: null, error });
          }
        });
        child.once('close', (code) => {
          if (!settled) {
            settled = true;
            resolve({ code });
          }
        });
      });
      clearTimeout(timer);
      this.activeProcesses.delete(job.id);

      if (this.jobs.get(job.id)?.status === 'cancelled') return;
      if (timedOut) throw new Error(`CAD job timed out after ${timeoutMs} ms`);
      if (exit.error) throw exit.error;

      let result: CadRunResult | undefined;
      try {
        result = JSON.parse(await fs.readFile(resultPath, 'utf8')) as CadRunResult;
      } catch (error) {
        throw new Error(`FreeCAD runner did not produce a readable result (exit ${exit.code}): ${error instanceof Error ? error.message : error}`);
      }
      job.result = result;
      if (exit.code !== 0 || !result.ok) {
        throw new Error(result.error || `FreeCAD runner exited with code ${exit.code}`);
      }
      job.status = 'completed';
      job.completedAt = Date.now();
      log.log(`Completed CAD job ${job.id} in ${job.completedAt - job.startedAt} ms`);
    } catch (error) {
      if (this.jobs.get(job.id)?.status !== 'cancelled') {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.completedAt = Date.now();
        log.error(`CAD job ${job.id} failed: ${job.error}`);
      }
    } finally {
      this.activeProcesses.delete(job.id);
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private pruneJobs(): void {
    if (this.jobs.size <= MAX_JOBS) return;
    const terminal = Array.from(this.jobs.values())
      .filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status))
      .sort((a, b) => a.createdAt - b.createdAt);
    while (this.jobs.size > MAX_JOBS && terminal.length > 0) {
      this.jobs.delete(terminal.shift()!.id);
    }
  }
}

export const cadService = new CadService();
