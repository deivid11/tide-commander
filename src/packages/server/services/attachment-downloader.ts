/**
 * Attachment Downloader Service
 *
 * Downloads files referenced by inbound integration events (Slack file_share,
 * WhatsApp media messages, etc.) to a local temp directory so agents can read
 * them with the `Read` tool. Files are saved under
 * `<TEMP_DIR>/triggers/<source>/<messageId>/<sanitized-filename>` where
 * `TEMP_DIR` is the shared `/tmp/tide-commander-uploads` mount (already served
 * statically at `/uploads/` by the Express app).
 *
 * Design notes:
 *  - Never throws. Returns `null` on fetch error / size-cap violation.
 *  - Hard cap: 25 MB per file. Larger files are aborted and the partial file
 *    is unlinked.
 *  - Idempotent: if the target path already exists with the expected size, the
 *    download is skipped and the existing record is returned.
 *  - Auth headers are caller-controlled. The caller is responsible for not
 *    sending tokens to cross-origin URLs.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import { TEMP_DIR } from '../routes/files.js';
import type { DownloadedAttachment } from '../../shared/integration-types.js';

const log = createLogger('AttachmentDownloader');

/** Hard cap per file. Anything above this is aborted. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Render the agent-facing one-liner for a downloaded attachment, omitting
 * `key=` segments whose value is missing/blank. The path is always emitted —
 * even if mimetype/filename came back undefined from the upstream the agent
 * can still `Read` the file.
 *
 *   formatAttachmentLine({ path: '/tmp/foo.pdf' })
 *   → "[attachment: /tmp/foo.pdf]"
 *
 *   formatAttachmentLine({ path: '/tmp/foo.png', mimetype: 'image/png', filename: 'foo.png', size: 1024 })
 *   → "[attachment: /tmp/foo.png  mimetype=image/png  name=foo.png  size=1024]"
 */
export function formatAttachmentLine(att: DownloadedAttachment): string {
  const parts: string[] = [`[attachment: ${att.path}`];
  if (att.mimetype && att.mimetype !== 'application/octet-stream') {
    parts.push(`mimetype=${att.mimetype}`);
  }
  if (att.filename && att.filename.trim()) {
    parts.push(`name=${att.filename}`);
  }
  if (typeof att.size === 'number' && att.size > 0) {
    parts.push(`size=${att.size}`);
  }
  return parts.join('  ') + ']';
}

/** Root for all trigger attachments. Lives under the shared uploads root so
 *  the static `/uploads/triggers/...` URL also works if a consumer wants it. */
export const TRIGGER_ATTACHMENT_ROOT = path.join(TEMP_DIR, 'triggers');

export interface DownloadAttachmentOpts {
  /** Integration source — used as the first subdir under triggers/. */
  source: 'slack' | 'whatsapp';
  /** Stable identifier for the inbound message. Used as the second subdir. */
  messageId: string;
  /** Absolute URL to fetch the bytes from. */
  url: string;
  /** Headers attached to the request. Caller MUST not send tokens cross-origin. */
  headers?: Record<string, string>;
  /** Original filename, if the integration provides one. */
  suggestedFilename?: string;
  /** MIME type reported by the integration. Used for the response and the
   *  fallback extension when no suggestedFilename is supplied. */
  mimetype?: string;
  /** Size hint from the integration. Used as a pre-flight check against the
   *  cap and for idempotent skip when the target file already matches. */
  sizeHintBytes?: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/3gpp': '.3gp',
  'video/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/json': '.json',
  'application/xml': '.xml',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/markdown': '.md',
};

/** Sanitize a filename: strip path separators, `..` segments, control chars.
 *  Returns a non-empty string with at most 200 chars; falls back to `file<ext>`
 *  when the input is hostile or empty. */
function sanitizeFilename(raw: string | undefined, fallbackExt: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return `file${fallbackExt}`;
  // Strip path separators and control chars; collapse `..` segments.
  const cleaned = trimmed
    .replace(/[\\/\x00-\x1f\x7f]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '_');
  const limited = cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
  return limited || `file${fallbackExt}`;
}

/** Sanitize a path segment (the source/messageId pieces of the target dir). */
function sanitizeSegment(raw: string): string {
  const cleaned = raw.replace(/[\\/\x00-\x1f\x7f]/g, '_').replace(/\.{2,}/g, '_');
  return cleaned.slice(0, 120) || randomUUID();
}

function extFromMime(mimetype: string | undefined): string {
  if (!mimetype) return '';
  return MIME_TO_EXT[mimetype.toLowerCase()] ?? '';
}

/** Ensure the filename ends with an extension. If the input has none, append
 *  the mime-derived ext (or no-op if the mime is unknown). */
function ensureExtension(filename: string, mimetype: string | undefined): string {
  if (filename.includes('.') && !filename.startsWith('.')) return filename;
  const ext = extFromMime(mimetype);
  return ext ? `${filename}${ext}` : filename;
}

/** Probe existing file: if size matches expected, treat as a cache hit. */
async function existingSizeMatches(targetPath: string, expected: number | undefined): Promise<number | null> {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) return null;
    if (typeof expected === 'number' && expected > 0 && stat.size === expected) return stat.size;
    // Size hint absent — accept any existing file as a cache hit, otherwise
    // we'd re-fetch on every event.
    if (typeof expected !== 'number') return stat.size;
    return null;
  } catch {
    return null;
  }
}

/** Pull `filename` out of a `Content-Disposition` header. Supports both
 *  RFC 5987 (`filename*=UTF-8''…`) and the legacy quoted/bare forms. Returns
 *  undefined when there's nothing usable. */
function parseContentDispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  // RFC 5987 form first (preferred — supports non-ASCII).
  const star = /filename\*=\s*([^']+)''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch {
      return star[2].trim();
    }
  }
  // Quoted: filename="foo bar.pdf"
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(header);
  if (quoted) return quoted[1].trim();
  // Bare: filename=foo.pdf
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  if (bare) return bare[1].trim();
  return undefined;
}

/** Strip any `; charset=...` suffix from a Content-Type header. */
function parseContentTypeMime(header: string | null): string | undefined {
  if (!header) return undefined;
  const idx = header.indexOf(';');
  const raw = (idx >= 0 ? header.slice(0, idx) : header).trim();
  return raw || undefined;
}

/**
 * Download one attachment. Returns the persisted record or `null` if the file
 * was skipped (cap exceeded, fetch failure, missing URL).
 */
export async function downloadAttachment(opts: DownloadAttachmentOpts): Promise<DownloadedAttachment | null> {
  if (!opts.url) {
    log.warn(`download skipped — empty URL (source=${opts.source} messageId=${opts.messageId})`);
    return null;
  }

  if (typeof opts.sizeHintBytes === 'number' && opts.sizeHintBytes > MAX_ATTACHMENT_BYTES) {
    log.log(`download skipped — sizeHint ${opts.sizeHintBytes}B exceeds cap (source=${opts.source} name=${opts.suggestedFilename ?? 'unknown'})`);
    return null;
  }

  const sourceDir = sanitizeSegment(opts.source);
  const messageDir = sanitizeSegment(opts.messageId || randomUUID());
  const targetDir = path.join(TRIGGER_ATTACHMENT_ROOT, sourceDir, messageDir);

  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (err) {
    log.warn(`mkdir failed for ${targetDir}: ${err}`);
    return null;
  }

  // Early idempotency check — only viable when the caller gave us enough
  // info to predict the final filename without touching the network. The
  // WhatsApp flat-event case has neither suggestedFilename nor mimetype, so
  // we fall through to the post-fetch path below.
  if (opts.suggestedFilename && opts.mimetype) {
    const earlyExt = extFromMime(opts.mimetype);
    const earlyName = ensureExtension(
      sanitizeFilename(opts.suggestedFilename, earlyExt || ''),
      opts.mimetype,
    );
    const earlyPath = path.join(targetDir, earlyName);
    const cachedSize = await existingSizeMatches(earlyPath, opts.sizeHintBytes);
    if (cachedSize !== null) {
      log.debug(`download cache-hit ${earlyPath} (${cachedSize}B)`);
      return {
        path: earlyPath,
        filename: earlyName,
        mimetype: opts.mimetype,
        size: cachedSize,
        sourceUrl: opts.url,
      };
    }
  }

  let response: Response;
  try {
    response = await fetch(opts.url, {
      method: 'GET',
      headers: opts.headers ?? {},
    });
  } catch (err) {
    log.warn(`fetch failed for ${opts.url}: ${err}`);
    return null;
  }

  if (!response.ok) {
    log.warn(`fetch non-OK ${response.status} for ${opts.url}`);
    return null;
  }

  // Pre-flight check against Content-Length header.
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
      log.log(`download aborted — Content-Length ${declared}B exceeds cap`);
      return null;
    }
  }

  // Derive final filename + mimetype, preferring caller-supplied values and
  // falling back to response headers (Content-Type, Content-Disposition).
  const headerMime = parseContentTypeMime(response.headers.get('content-type'));
  const headerFilename = parseContentDispositionFilename(response.headers.get('content-disposition'));
  const effectiveMime = opts.mimetype ?? headerMime;
  const effectiveExt = extFromMime(effectiveMime);
  const effectiveNameRaw = opts.suggestedFilename ?? headerFilename;
  const effectiveName = ensureExtension(
    sanitizeFilename(effectiveNameRaw, effectiveExt || ''),
    effectiveMime,
  );
  const finalName = effectiveName || `${randomUUID()}${effectiveExt}`;
  const targetPath = path.join(targetDir, finalName);

  // Late idempotency check (when we couldn't do it pre-fetch).
  if (!opts.suggestedFilename || !opts.mimetype) {
    const cachedSize = await existingSizeMatches(targetPath, opts.sizeHintBytes);
    if (cachedSize !== null) {
      try { await response.body?.cancel(); } catch { /* ignore */ }
      log.debug(`download cache-hit (post-fetch) ${targetPath} (${cachedSize}B)`);
      return {
        path: targetPath,
        filename: finalName,
        mimetype: effectiveMime ?? 'application/octet-stream',
        size: cachedSize,
        sourceUrl: opts.url,
      };
    }
  }

  if (!response.body) {
    log.warn(`response has no body for ${opts.url}`);
    return null;
  }

  // Stream chunks while enforcing the cap. Accumulate into memory — 25 MB
  // ceiling makes this safe and avoids a half-written file on cap overflow.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > MAX_ATTACHMENT_BYTES) {
        log.log(`download aborted — streamed bytes exceeded cap (${total}B > ${MAX_ATTACHMENT_BYTES}B) url=${opts.url}`);
        try { await reader.cancel(); } catch { /* ignore */ }
        return null;
      }
      chunks.push(value);
    }
  } catch (err) {
    log.warn(`stream read failed for ${opts.url}: ${err}`);
    return null;
  }

  // Concatenate into a single Buffer and persist.
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  try {
    await fs.writeFile(targetPath, buf);
  } catch (err) {
    log.warn(`write failed for ${targetPath}: ${err}`);
    return null;
  }

  log.log(`downloaded ${total}B → ${targetPath} (source=${opts.source} mime=${effectiveMime ?? 'unknown'})`);

  return {
    path: targetPath,
    filename: finalName,
    mimetype: effectiveMime ?? 'application/octet-stream',
    size: total,
    sourceUrl: opts.url,
  };
}
