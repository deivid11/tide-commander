/**
 * HTTP Requests Service (IntelliJ-style .http files)
 *
 * Powers the "http" building: scans a folder for .http/.rest files, parses
 * them into individual requests (### separators, METHOD URL, headers, body,
 * {{variables}}), resolves variables from http-client.env.json /
 * http-client.private.env.json environments, and executes single requests
 * with fetch, capturing status/headers/body/timing for the UI.
 *
 * Deliberately dependency-free: the JetBrains ijhttp CLI needs a JDK and the
 * httpyac npm package drags a huge transitive tree (gRPC/Kafka/MQTT), while
 * the .http corpus this feature targets only uses the core syntax.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/index.js';
import type {
  HttpRequestFile,
  HttpRequestItem,
  HttpRequestsScanResult,
  HttpResolvedRequest,
  HttpRunResult,
} from '../../shared/types.js';

const log = createLogger('HttpRequests');

const MAX_SCAN_DEPTH = 4;
const MAX_FILES = 300;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // response body cap sent to the client
const REQUEST_TIMEOUT_MS = 60_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.idea', '.vscode']);

const HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'LOCK', 'UNLOCK', 'PROPFIND',
]);

// ============================================================================
// Safety
// ============================================================================

/** Same contract as testRunnerService.isSafeModuleRoot: stay under home/cwd. */
export function isSafeFolder(folder: string): boolean {
  try {
    const real = fs.realpathSync(folder);
    const roots = [process.cwd(), os.homedir()].filter(Boolean).map((r) => {
      try {
        return fs.realpathSync(r);
      } catch {
        return path.resolve(r);
      }
    });
    return roots.some((root) => {
      const rel = path.relative(root, real);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  } catch {
    return false;
  }
}

// ============================================================================
// Parsing
// ============================================================================

const VARIABLE_RE = /\{\{\s*([$A-Za-z0-9_.-]+)\s*\}\}/g;

function collectVariables(target: Set<string>, ...texts: (string | undefined)[]): void {
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(VARIABLE_RE)) target.add(m[1]);
  }
}

/**
 * Parse one .http file into requests.
 *
 * Grammar (the practical IntelliJ subset):
 * - A line starting with `###` separates requests; trailing text is the name
 *   (leading extra `#` are stripped, so `#### foo` names a request too).
 * - `@name = value` lines define file-level variables.
 * - `#`/`//` lines outside a body are comments.
 * - The request line is `METHOD URL [HTTP/x]`; indented follow-up lines
 *   starting with `?`/`&` continue the URL.
 * - Header lines (`Name: value`) follow until the first blank line; the rest
 *   is the body, up to the next separator.
 * - Response-handler blocks (`> {% ... %}` / `> path`) and response
 *   references (`<> path`) are stripped from the body.
 */
export function parseHttpFile(content: string, relFile: string): HttpRequestFile {
  const lines = content.split(/\r?\n/);
  const fileVariables: Record<string, string> = {};
  const requests: HttpRequestItem[] = [];

  let name: string | undefined;
  let current: {
    method: string;
    url: string;
    headers: { name: string; value: string }[];
    bodyLines: string[];
    line: number;
    inBody: boolean;
  } | null = null;

  const finish = () => {
    if (!current) return;
    // Trim trailing blank lines and strip response-handler blocks.
    const bodyLines = [...current.bodyLines];
    while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
    const cleaned: string[] = [];
    let inHandler = false;
    for (const l of bodyLines) {
      const t = l.trim();
      if (!inHandler && (t.startsWith('> {%') || t.startsWith('>! {%'))) {
        inHandler = !t.endsWith('%}') || t === '> {%';
        continue;
      }
      if (inHandler) {
        if (t.endsWith('%}')) inHandler = false;
        continue;
      }
      if (t.startsWith('> ') || t.startsWith('<> ')) continue; // handler file / response ref
      cleaned.push(l);
    }
    while (cleaned.length && cleaned[cleaned.length - 1].trim() === '') cleaned.pop();
    while (cleaned.length && cleaned[0].trim() === '') cleaned.shift();
    const body = cleaned.length ? cleaned.join('\n') : undefined;

    const variables = new Set<string>();
    collectVariables(variables, current.url, body, ...current.headers.map((h) => h.value), ...current.headers.map((h) => h.name));

    const index = requests.length;
    const urlForName = current.url.replace(/^https?:\/\/[^/]*/, '') || current.url;
    requests.push({
      id: `${relFile}#${index}`,
      index,
      name: name?.trim() || `${current.method} ${urlForName}`,
      method: current.method,
      url: current.url,
      headers: current.headers,
      body,
      line: current.line,
      variables: [...variables],
    });
    current = null;
    name = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Separator — closes the previous request and optionally names the next.
    if (trimmed.startsWith('###')) {
      finish();
      const label = trimmed.replace(/^#+/, '').trim();
      if (label) name = label;
      continue;
    }

    if (!current) {
      if (trimmed === '') continue;
      // File-level variable definition.
      const varDef = trimmed.match(/^@([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
      if (varDef) {
        fileVariables[varDef[1]] = varDef[2].trim();
        continue;
      }
      // Comments before the request line.
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      // Request line: `METHOD URL [HTTP/x]` (URL-only lines default to GET).
      const parts = trimmed.split(/\s+/);
      let method = 'GET';
      let rest = parts;
      if (HTTP_METHODS.has(parts[0].toUpperCase())) {
        method = parts[0].toUpperCase();
        rest = parts.slice(1);
      } else if (!/^[a-zA-Z{/]/.test(trimmed)) {
        continue; // garbage line — skip
      }
      if (rest.length === 0) continue;
      // Drop HTTP version tokens; rejoin the remainder (tolerates odd spaces).
      const url = rest.filter((p) => !/^HTTP\/[\d.]+$/i.test(p)).join(' ');
      if (!url) continue;
      current = { method, url, headers: [], bodyLines: [], line: i + 1, inBody: false };
      continue;
    }

    // Inside a request.
    if (!current.inBody) {
      // Multi-line URL continuation (indented ?param / &param lines).
      if (/^\s+[?&]/.test(raw) && current.headers.length === 0) {
        current.url += trimmed;
        continue;
      }
      if (trimmed === '') {
        current.inBody = true;
        continue;
      }
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      const colon = trimmed.indexOf(':');
      if (colon > 0) {
        current.headers.push({
          name: trimmed.slice(0, colon).trim(),
          value: trimmed.slice(colon + 1).trim(),
        });
        continue;
      }
      // Not a header and no blank line yet — treat as start of the body.
      current.inBody = true;
      current.bodyLines.push(raw);
      continue;
    }

    current.bodyLines.push(raw);
  }
  finish();

  return { relFile, requests, fileVariables };
}

// ============================================================================
// Environment files
// ============================================================================

interface EnvData {
  /** env name -> variables */
  environments: Record<string, Record<string, string>>;
  files: string[];
}

function readEnvJson(file: string): Record<string, Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Load environments for a .http file: env files sitting next to the file win
 * over the scan-root ones; *.private.env.json overrides the public one.
 */
function loadEnvironments(folder: string, fileDir?: string): EnvData {
  const environments: Record<string, Record<string, string>> = {};
  const files: string[] = [];
  const dirs = [folder];
  if (fileDir && path.resolve(fileDir) !== path.resolve(folder)) dirs.push(fileDir);

  for (const dir of dirs) {
    for (const base of ['http-client.env.json', 'http-client.private.env.json']) {
      const file = path.join(dir, base);
      if (!fs.existsSync(file)) continue;
      const data = readEnvJson(file);
      if (!data) continue;
      files.push(path.relative(folder, file) || base);
      for (const [envName, vars] of Object.entries(data)) {
        if (!vars || typeof vars !== 'object') continue;
        environments[envName] = { ...environments[envName] };
        for (const [k, v] of Object.entries(vars)) {
          environments[envName][k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
      }
    }
  }
  return { environments, files };
}

// ============================================================================
// Scanning
// ============================================================================

export function scanFolder(folder: string): HttpRequestsScanResult {
  const empty = (error: string): HttpRequestsScanResult => ({
    ok: false, folder, files: [], environments: [], envFiles: [], error,
  });

  let stat: fs.Stats;
  try {
    stat = fs.statSync(folder);
  } catch {
    return empty('Folder does not exist.');
  }
  if (!stat.isDirectory()) return empty('Path is not a directory.');

  const files: HttpRequestFile[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH || files.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(http|rest)$/i.test(entry.name)) continue;
      try {
        const parsed = parseHttpFile(fs.readFileSync(full, 'utf-8'), path.relative(folder, full));
        if (parsed.requests.length > 0) files.push(parsed);
      } catch (err) {
        log.error(`Failed to parse ${full}: ${err}`);
      }
    }
  };
  walk(folder, 0);

  // Collect environment names from the root env files plus any env file that
  // lives next to a scanned .http file.
  const envDirs = new Set<string>([folder]);
  for (const f of files) envDirs.add(path.join(folder, path.dirname(f.relFile)));
  const environments = new Set<string>();
  const envFiles = new Set<string>();
  for (const dir of envDirs) {
    const { environments: envs, files: found } = loadEnvironments(folder, dir);
    Object.keys(envs).forEach((e) => environments.add(e));
    found.forEach((f) => envFiles.add(f));
  }

  return {
    ok: true,
    folder,
    files,
    environments: [...environments].sort(),
    envFiles: [...envFiles].sort(),
  };
}

/** Parse one request's metadata without executing it (for run announcements). */
export function peekRequest(folder: string, relFile: string, requestIndex: number): HttpRequestItem | null {
  try {
    const filePath = path.join(folder, relFile);
    const parsed = parseHttpFile(fs.readFileSync(filePath, 'utf-8'), relFile);
    return parsed.requests[requestIndex] ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Variable resolution
// ============================================================================

function builtinVariable(nameRaw: string): string | undefined {
  const name = nameRaw.startsWith('$') ? nameRaw.slice(1) : undefined;
  if (!name) return undefined;
  if (name === 'uuid' || name === 'random.uuid') return randomUUID();
  if (name === 'timestamp') return String(Math.floor(Date.now() / 1000));
  if (name === 'isoTimestamp') return new Date().toISOString();
  if (name.startsWith('randomInt')) return String(Math.floor(Math.random() * 1000));
  return undefined;
}

function substitute(
  text: string,
  vars: Record<string, string>,
  unresolved: Set<string>,
): string {
  return text.replace(VARIABLE_RE, (whole, varName: string) => {
    const builtin = builtinVariable(varName);
    if (builtin !== undefined) return builtin;
    if (Object.prototype.hasOwnProperty.call(vars, varName)) return vars[varName];
    unresolved.add(varName);
    return whole;
  });
}

// ============================================================================
// Execution
// ============================================================================

const TEXTUAL_CONTENT_RE = /json|text|xml|html|javascript|urlencoded|csv|yaml|svg|graphql/i;

export async function executeRequest(
  folder: string,
  relFile: string,
  requestIndex: number,
  env?: string,
): Promise<HttpRunResult> {
  const filePath = path.join(folder, relFile);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(folder) + path.sep)) {
    throw new Error('Request file escapes the configured folder.');
  }

  const parsed = parseHttpFile(fs.readFileSync(filePath, 'utf-8'), relFile);
  const item = parsed.requests[requestIndex];
  if (!item) throw new Error(`Request #${requestIndex} not found in ${relFile} (has ${parsed.requests.length}).`);

  // Variable precedence: env file vars < in-file @vars (IntelliJ resolves
  // in-file definitions last).
  const { environments } = loadEnvironments(folder, path.dirname(filePath));
  const envVars = env ? environments[env] ?? {} : {};
  const vars = { ...envVars, ...parsed.fileVariables };

  const unresolved = new Set<string>();
  const url = substitute(item.url, vars, unresolved);
  const headers = item.headers.map((h) => ({
    name: substitute(h.name, vars, unresolved),
    value: substitute(h.value, vars, unresolved),
  }));
  let body = item.body !== undefined ? substitute(item.body, vars, unresolved) : undefined;

  // `< file` body include (single-line body referencing a payload file).
  if (body && /^<\s+\S/.test(body.trim()) && !body.includes('\n')) {
    const includePath = path.resolve(path.dirname(filePath), body.trim().slice(1).trim());
    if (includePath.startsWith(path.resolve(folder) + path.sep) && fs.existsSync(includePath)) {
      body = fs.readFileSync(includePath, 'utf-8');
    }
  }

  const request: HttpResolvedRequest = { method: item.method, url, headers, body };
  const base: Omit<HttpRunResult, 'ok' | 'timeMs'> = {
    requestName: item.name,
    request,
    unresolvedVariables: unresolved.size ? [...unresolved] : undefined,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = performance.now();
  try {
    const headerObj: Record<string, string> = {};
    for (const h of headers) headerObj[h.name] = h.value;
    const allowsBody = !['GET', 'HEAD'].includes(item.method);
    const res = await fetch(url, {
      method: item.method,
      headers: headerObj,
      body: allowsBody && body !== undefined ? body : undefined,
      redirect: 'follow',
      signal: controller.signal,
    });

    const buf = Buffer.from(await res.arrayBuffer());
    const timeMs = performance.now() - started;

    const contentType = res.headers.get('content-type') ?? undefined;
    const looksTextual = !contentType || TEXTUAL_CONTENT_RE.test(contentType);
    const truncated = buf.length > MAX_BODY_BYTES;
    const text = looksTextual ? buf.subarray(0, MAX_BODY_BYTES).toString('utf-8') : undefined;

    const responseHeaders: { name: string; value: string }[] = [];
    res.headers.forEach((value, name) => responseHeaders.push({ name, value }));

    return {
      ...base,
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      contentType,
      body: text,
      bodyTruncated: truncated || undefined,
      bodyBinary: !looksTextual || undefined,
      timeMs: Math.round(timeMs * 10) / 10,
      sizeBytes: buf.length,
      finalUrl: res.url && res.url !== url ? res.url : undefined,
    };
  } catch (err: any) {
    const timeMs = performance.now() - started;
    // undici buries the useful bit (ECONNREFUSED etc.) in error.cause, which
    // may itself be an AggregateError with an empty message.
    const cause = err?.cause;
    const causeDetail =
      cause?.code ||
      cause?.message ||
      cause?.errors?.map((e: any) => e?.code || e?.message).filter(Boolean).join(', ');
    const message =
      err?.name === 'AbortError'
        ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : causeDetail
          ? `${err?.message || 'Request failed'} (${causeDetail})`
          : err?.message || 'Request failed';
    return { ...base, ok: false, error: message, timeMs: Math.round(timeMs * 10) / 10 };
  } finally {
    clearTimeout(timeout);
  }
}
