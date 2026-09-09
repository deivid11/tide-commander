/**
 * Image Generation Service
 *
 * Wraps the OpenAI Images API (`/v1/images/generations`) so agents can turn a
 * prompt into real files on disk through `/api/images/generate` instead of
 * hand-rolling a curl with a raw API key in their shell history.
 *
 * Design constraints:
 *  - THE KEY NEVER LEAVES THE SERVER. It is resolved here (secrets store →
 *    environment → key file) and never accepted as a request field, so it
 *    cannot end up in an agent transcript, a log line or the exec history.
 *  - NEVER THROWS on a generation failure. Model refusals, HTTP errors and
 *    timeouts come back as `{ ok: false, error }` so the caller can report
 *    them as a normal result. Only programmer errors (bad arguments) throw.
 *  - Writes stay inside home / cwd / tmp — same containment rule the .http
 *    runner uses for the folders it will touch.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getDataDir } from '../data/index.js';
import { createLogger } from '../utils/logger.js';
import { getSecretByKey } from './secrets-service.js';
import {
  DEFAULT_IMAGE_MODEL,
  OPENAI_API_KEY_SECRET,
  type GeneratedImageFile,
  type ImageApiKeySource,
  type ImageGenerationRequestBody,
  type ImageGenerationResult,
  type ImageGenerationStatus,
  type ImageOutputFormat,
} from '../../shared/image-types.js';

const log = createLogger('ImageService');

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_IMAGES = 10;
const MAX_PROMPT_CHARS = 32_000;

const FORMAT_EXTENSIONS: Record<ImageOutputFormat, string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
};

// ============================================================================
// API key resolution
// ============================================================================

export interface ApiKeyResolution {
  key: string | null;
  source: ImageApiKeySource | null;
}

/** Path of the key file consulted as the last fallback. */
export function getKeyFilePath(): string {
  return process.env.TIDE_OPENAI_KEY_FILE || path.join(os.homedir(), '.tide_openai_key');
}

/**
 * Find the OpenAI API key. Secrets first (that's the one the user configured
 * in the UI, so it should win over whatever the server process inherited),
 * then `OPENAI_API_KEY`, then the key file.
 */
export function resolveApiKey(): ApiKeyResolution {
  const fromSecret = getSecretByKey(OPENAI_API_KEY_SECRET)?.value?.trim();
  if (fromSecret) return { key: fromSecret, source: 'secret' };

  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };

  try {
    const fromFile = fs.readFileSync(getKeyFilePath(), 'utf-8').trim();
    if (fromFile) return { key: fromFile, source: 'file' };
  } catch { /* no key file — not an error, just unconfigured */ }

  return { key: null, source: null };
}

/** `sk-proj-…f3a9` — enough to tell two keys apart, useless if leaked. */
export function maskKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** Directory used when the caller does not pass `outputDir`. */
export function getDefaultOutputDir(): string {
  return path.join(getDataDir(), 'generated-images');
}

export function getStatus(): ImageGenerationStatus {
  const { key, source } = resolveApiKey();
  return {
    configured: Boolean(key),
    source: source ?? undefined,
    maskedKey: key ? maskKey(key) : undefined,
    defaultModel: DEFAULT_IMAGE_MODEL,
    defaultOutputDir: getDefaultOutputDir(),
    keyFilePath: getKeyFilePath(),
    secretKey: OPENAI_API_KEY_SECRET,
  };
}

// ============================================================================
// Output paths
// ============================================================================

function realpathOrResolve(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Resolve `dir` through symlinks as far as it exists, keeping the
 * not-yet-created tail. Without this a brand-new output directory could never
 * be checked against the allowed roots (realpath throws on missing paths), and
 * `/home/user/link-to-elsewhere/new-dir` would slip past the containment test.
 */
function resolveThroughExistingAncestor(dir: string): string {
  const absolute = path.resolve(dir);
  const tail: string[] = [];
  let current = absolute;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return absolute; // hit the fs root, nothing exists
    tail.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathOrResolve(current), ...tail);
}

function containmentRoots(): string[] {
  return [process.cwd(), os.homedir(), os.tmpdir()].filter(Boolean).map(realpathOrResolve);
}

/**
 * True when `dir` sits inside the working directory, the home directory or the
 * system temp dir — the only places we will write generated images.
 */
export function isSafeOutputDir(dir: string): boolean {
  if (!dir) return false;
  const resolved = resolveThroughExistingAncestor(dir);
  return containmentRoots().some((root) => {
    const rel = path.relative(root, resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/** Lowercase, dash-separated stem derived from the prompt. */
export function slugifyPrompt(prompt: string, maxLength = 48): string {
  const slug = prompt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'image';
}

/**
 * Turn a caller-supplied filename into a safe basename stem: directory
 * components, traversal and shell-hostile characters are stripped, and any
 * image extension is dropped (the format decides the real one).
 */
export function sanitizeFilenameStem(filename: string): string {
  const base = path.basename(filename.trim())
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 120);
  return base || 'image';
}

/**
 * Build the file names for one run. A single image keeps the bare stem; a
 * batch gets `-1`, `-2`, … so nothing overwrites itself. Existing files are
 * never clobbered — a numeric suffix is appended instead.
 */
export function buildOutputPaths(
  outputDir: string,
  stem: string,
  count: number,
  format: ImageOutputFormat,
  exists: (p: string) => boolean = fs.existsSync,
): string[] {
  const ext = FORMAT_EXTENSIONS[format];
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const base = count > 1 ? `${stem}-${i + 1}` : stem;
    let candidate = path.join(outputDir, `${base}${ext}`);
    let dedupe = 2;
    while (exists(candidate) || paths.includes(candidate)) {
      candidate = path.join(outputDir, `${base}-${dedupe}${ext}`);
      dedupe++;
    }
    paths.push(candidate);
  }
  return paths;
}

// ============================================================================
// Request payload
// ============================================================================

/** DALL·E models take a different parameter vocabulary than the gpt-image family. */
function isDalleModel(model: string): boolean {
  return model.startsWith('dall-e');
}

interface OpenAIImagePayload {
  model: string;
  prompt: string;
  n: number;
  size?: string;
  quality?: string;
  background?: string;
  output_format?: string;
  output_compression?: number;
  response_format?: string;
  style?: string;
}

/**
 * Translate our request body into the OpenAI payload for the target model.
 * Exported for tests — the gpt-image / DALL·E split is easy to get wrong and
 * the API rejects the whole call on one unknown field.
 */
export function buildRequestPayload(opts: ImageGenerationRequestBody): OpenAIImagePayload {
  const model = opts.model?.trim() || DEFAULT_IMAGE_MODEL;
  const n = Math.min(Math.max(Math.trunc(opts.n ?? 1) || 1, 1), MAX_IMAGES);
  const payload: OpenAIImagePayload = { model, prompt: opts.prompt, n };

  if (opts.size) payload.size = opts.size;

  if (isDalleModel(model)) {
    // DALL·E only knows standard/hd, and only returns base64 when asked to.
    if (opts.quality) {
      payload.quality = opts.quality === 'high' || opts.quality === 'hd' ? 'hd' : 'standard';
    }
    payload.response_format = 'b64_json';
    return payload;
  }

  if (opts.quality) payload.quality = opts.quality;
  if (opts.background) payload.background = opts.background;
  if (opts.format) payload.output_format = opts.format;
  if (typeof opts.compression === 'number' && (opts.format === 'jpeg' || opts.format === 'webp')) {
    payload.output_compression = Math.min(Math.max(Math.trunc(opts.compression), 0), 100);
  }
  return payload;
}

// ============================================================================
// Generation
// ============================================================================

interface OpenAIImageResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

/** Readable one-liner for an OpenAI error body / HTTP status. */
function describeApiError(status: number, body: string): string {
  let message = '';
  try {
    const parsed = JSON.parse(body) as OpenAIImageResponse;
    message = parsed.error?.message || '';
  } catch { /* non-JSON error body (proxy/gateway) — fall back to the text */ }
  const detail = message || body.slice(0, 400).trim() || 'no response body';
  if (status === 401) return `OpenAI rejected the API key (401): ${detail}`;
  if (status === 403) return `OpenAI denied access (403) — the org may not be verified for this model: ${detail}`;
  if (status === 429) return `OpenAI rate limit or quota exceeded (429): ${detail}`;
  return `OpenAI images API failed (${status}): ${detail}`;
}

async function fetchImageBytes(entry: { b64_json?: string; url?: string }): Promise<Buffer | null> {
  if (entry.b64_json) return Buffer.from(entry.b64_json, 'base64');
  if (entry.url) {
    // DALL·E can hand back a short-lived CDN URL instead of base64.
    const res = await fetch(entry.url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

/**
 * Generate one or more images and write them to disk. Resolves with
 * `ok: false` and a human-readable `error` for every failure mode except
 * invalid arguments, which reject.
 */
export async function generateImages(opts: ImageGenerationRequestBody): Promise<ImageGenerationResult> {
  const startedAt = Date.now();
  const prompt = (opts.prompt || '').trim();
  const model = opts.model?.trim() || DEFAULT_IMAGE_MODEL;
  const format: ImageOutputFormat = opts.format || 'png';
  const outputDir = path.resolve(opts.outputDir?.trim() || getDefaultOutputDir());
  const n = Math.min(Math.max(Math.trunc(opts.n ?? 1) || 1, 1), MAX_IMAGES);

  const fail = (error: string): ImageGenerationResult => ({
    ok: false,
    model,
    prompt,
    outputDir,
    images: [],
    timeMs: Date.now() - startedAt,
    size: opts.size,
    quality: opts.quality,
    error,
    agentId: opts.agentId,
  });

  if (!prompt) throw new Error('Missing required field: prompt');
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt is too long (${prompt.length} chars, max ${MAX_PROMPT_CHARS})`);
  }
  if (!FORMAT_EXTENSIONS[format]) throw new Error(`Unsupported format: ${format}`);
  if (!isSafeOutputDir(outputDir)) {
    throw new Error('Refusing to write images outside the home, working or temp directory.');
  }

  const { key } = resolveApiKey();
  if (!key) {
    return fail(
      `No OpenAI API key configured. Add a secret named ${OPENAI_API_KEY_SECRET} in Settings → Secrets, ` +
      `set OPENAI_API_KEY in the server environment, or write the key to ${getKeyFilePath()}.`,
    );
  }

  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let parsed: OpenAIImageResponse;
  try {
    const response = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildRequestPayload({ ...opts, prompt, model, n, format })),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return fail(describeApiError(response.status, text));
    parsed = JSON.parse(text) as OpenAIImageResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted) {
      return fail(`Image generation timed out after ${timeoutMs}ms`);
    }
    return fail(`Image generation request failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  const entries = parsed.data ?? [];
  if (entries.length === 0) return fail('OpenAI returned no images');

  try {
    await fsp.mkdir(outputDir, { recursive: true });
  } catch (err) {
    return fail(`Could not create output directory ${outputDir}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const stem = opts.filename ? sanitizeFilenameStem(opts.filename) : slugifyPrompt(prompt);
  const targets = buildOutputPaths(outputDir, stem, entries.length, format);
  const images: GeneratedImageFile[] = [];

  for (let i = 0; i < entries.length; i++) {
    let bytes: Buffer | null;
    try {
      bytes = await fetchImageBytes(entries[i]);
    } catch (err) {
      return fail(`Could not download generated image ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!bytes || bytes.length === 0) return fail(`OpenAI returned an empty image (index ${i})`);
    try {
      await fsp.writeFile(targets[i], bytes);
    } catch (err) {
      return fail(`Could not write ${targets[i]}: ${err instanceof Error ? err.message : String(err)}`);
    }
    images.push({
      path: targets[i],
      filename: path.basename(targets[i]),
      bytes: bytes.length,
      format,
    });
  }

  const timeMs = Date.now() - startedAt;
  log.log(`Generated ${images.length} image(s) with ${model} in ${timeMs}ms → ${outputDir}`);

  return {
    ok: true,
    model,
    prompt,
    revisedPrompt: entries[0]?.revised_prompt,
    outputDir,
    images,
    timeMs,
    size: opts.size,
    quality: opts.quality,
    usage: parsed.usage
      ? {
          totalTokens: parsed.usage.total_tokens,
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
        }
      : undefined,
    agentId: opts.agentId,
  };
}
