/**
 * Google Drive Client
 * Wraps the Google Drive API via googleapis.
 * Shares OAuth2 credentials with Gmail/Calendar plugins through the secrets system.
 * Supports: list files, read file content, create files, update files, create folders.
 */

import { google, drive_v3, docs_v1 } from 'googleapis';
import type { IntegrationContext } from '../../../shared/integration-types.js';
import type { DriveActionEvent } from '../../../shared/event-types.js';
import { loadConfig, updateConfig } from './drive-config.js';
import {
  getTokenHealth,
  needsReauth,
  notifyTokenRotated,
  onTokenRotated,
  probeTokenHealth,
  reportGoogleApiError,
  reportGoogleApiSuccess,
  startTokenHealthMonitor,
  type GoogleTokenState,
} from '../google-auth/token-health.js';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Types ───

export interface DriveStatus {
  authenticated: boolean;
  connected: boolean;
  lastChecked: number;
  error?: string;
  /** Credentials are stored but Google rejected them — re-authorization required. */
  needsReauth?: boolean;
  /** Result of the last real refresh_token exchange against Google. */
  tokenState?: GoogleTokenState;
}

export interface DriveFile {
  fileId: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  trashed: boolean;
}

export interface CreateFileParams {
  name: string;
  /** Either `content` (UTF-8 string) or `filePath` (absolute local path read from disk) must be provided. */
  content?: string;
  /** Absolute path on the host filesystem. When set, the file is streamed from disk — supports binary uploads (PDF/PNG/etc). */
  filePath?: string;
  mimeType?: string;
  folderId?: string;
  description?: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export interface FileContentResult {
  /** Decoded text, or base64 when the bytes aren't valid text (`encoding` says which). */
  content: string;
  mimeType: string;
  /** `utf-8` for text, `base64` for binary. Always set so callers never guess. */
  encoding: 'utf-8' | 'base64';
  /** Size of the decoded bytes (not of the base64 string). */
  bytes: number;
  name: string;
}

export interface DownloadFileParams {
  /**
   * Where to write the file. Absolute path, or `~/...`. If it points at an existing
   * directory (or ends with a separator) the Drive file name is used inside it.
   * Defaults to the OS temp dir.
   */
  destPath?: string;
  /** Export format for native Google Workspace files (Docs/Sheets/Slides). */
  exportMimeType?: string;
  /** Fail instead of replacing an existing file at the destination. */
  overwrite?: boolean;
}

export interface DownloadFileResult {
  fileId: string;
  name: string;
  /** Absolute path of the file written to disk. */
  path: string;
  bytes: number;
  mimeType: string;
  /** True when the source was a Google Workspace file and had to be exported. */
  exported: boolean;
}

export interface UpdateFileParams {
  content?: string;
  name?: string;
  mimeType?: string;
  description?: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export interface CopyFileParams {
  /** Source file to copy from (typically a template). */
  sourceFileId: string;
  /** Optional new name for the copy. Defaults to `Copy of <original>`. */
  name?: string;
  /** Optional destination folder. Defaults to the source file's parent. */
  folderId?: string;
  /** Optional description for the copy. */
  description?: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export interface MoveFileParams {
  /** Folder the file should end up in. Use `"root"` for My Drive root. */
  folderId: string;
  /** Optional list of current parents to detach. If omitted, all current parents are removed. */
  removeFromFolderIds?: string[];
  agentId?: string;
  workflowInstanceId?: string;
}

export interface ReplaceTextParams {
  /** List of find/replace pairs applied in order. */
  replacements: Array<{
    find: string;
    replace: string;
    matchCase?: boolean;
  }>;
  /** Optional plain text to append to the end of the document. */
  appendText?: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export interface ReplaceTextResult {
  fileId: string;
  totalOccurrencesChanged: number;
  appended: boolean;
}

export interface CreateDocumentParams {
  /** Document title (also used as the Drive file name). */
  title: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export interface BatchUpdateDocumentParams {
  /** Raw Google Docs API request array. See drive-skill.ts for common request types. */
  requests: docs_v1.Schema$Request[];
  /** Optional writeControl for concurrency (requiredRevisionId or targetRevisionId). */
  writeControl?: docs_v1.Schema$WriteControl;
  agentId?: string;
  workflowInstanceId?: string;
}

export interface BatchUpdateDocumentResult {
  documentId: string;
  replies: docs_v1.Schema$Response[];
  writeControl?: docs_v1.Schema$WriteControl;
}

export interface ListFilesParams {
  folderId?: string;
  query?: string;
  mimeType?: string;
  maxResults?: number;
  pageToken?: string;
  orderBy?: string;
  trashed?: boolean;
  /** If set, restrict results to this Shared Drive (Team Drive). */
  driveId?: string;
  /** If true, include files from My Drive and all accessible Shared Drives. */
  includeItemsFromAllDrives?: boolean;
}

export interface ListFilesResult {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface SharedDrive {
  driveId: string;
  name: string;
  createdTime?: string;
  hidden: boolean;
  colorRgb?: string;
  themeId?: string;
  backgroundImageLink?: string;
  capabilities?: {
    canEdit?: boolean;
    canManageMembers?: boolean;
    canShare?: boolean;
  };
}

export interface ListSharedDrivesParams {
  maxResults?: number;
  pageToken?: string;
  query?: string;
  useDomainAdminAccess?: boolean;
}

export interface ListSharedDrivesResult {
  drives: SharedDrive[];
  nextPageToken?: string;
}

// ─── State ───

let ctx: IntegrationContext | null = null;
let driveApi: drive_v3.Drive | null = null;
let docsApi: docs_v1.Docs | null = null;

// ─── OAuth ───

// Combined scopes for Gmail, Calendar, and Drive (shared OAuth client)
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
];
const REDIRECT_PATH = '/api/drive/auth/callback';

let oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

/**
 * Build an OAuth2 client whose every outbound call updates shared token health.
 *
 * Every Drive and Docs call made with `auth: oauth2Client` funnels through this one
 * `request()` method, so wrapping it here means a revoked token is detected the moment
 * an agent actually touches Drive — no waiting for the next background probe — without
 * instrumenting each of the ~15 API call sites.
 */
function createOAuthClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): InstanceType<typeof google.auth.OAuth2> {
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const originalRequest = client.request.bind(client);

  client.request = (async (opts: Parameters<typeof originalRequest>[0]) => {
    try {
      const result = await originalRequest(opts);
      reportGoogleApiSuccess();
      return result;
    } catch (err) {
      reportGoogleApiError(err);
      throw err;
    }
  }) as typeof client.request;

  return client;
}

function getRedirectUri(): string {
  if (!ctx) throw new Error('Google Drive not initialized');
  const override = ctx.secrets.get('GOOGLE_REDIRECT_BASE_URL')?.trim();
  const base = (override || ctx.serverConfig.baseUrl).replace(/\/$/, '');
  return `${base}${REDIRECT_PATH}`;
}

// ─── Init / Shutdown ───

export async function init(integrationCtx: IntegrationContext): Promise<void> {
  ctx = integrationCtx;

  const config = loadConfig();
  if (!config.enabled) {
    ctx.log.info('Google Drive integration disabled, skipping init');
    return;
  }

  const clientId = ctx.secrets.get('GOOGLE_CLIENT_ID');
  const clientSecret = ctx.secrets.get('GOOGLE_CLIENT_SECRET');
  const refreshToken = ctx.secrets.get('GOOGLE_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    ctx.log.info('Google Drive missing OAuth credentials, skipping init');
    return;
  }

  oauth2Client = createOAuthClient(clientId, clientSecret, getRedirectUri());
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  driveApi = google.drive({ version: 'v3', auth: oauth2Client });
  docsApi = google.docs({ version: 'v1', auth: oauth2Client });

  // Constructing the client above proves nothing — it just wraps the token string.
  // Probe Google (and keep probing) so an expired token is reflected in getStatus().
  startTokenHealthMonitor(ctx);

  // Re-read the shared refresh token if the user re-consents via Gmail or Calendar,
  // otherwise this client keeps using the token it was seeded with here.
  onTokenRotated('google-drive', () => init(integrationCtx));

  ctx.log.info('Google Drive initialized');
}

export async function shutdown(): Promise<void> {
  driveApi = null;
  docsApi = null;
  oauth2Client = null;
}

// ─── Status ───

export function getStatus(): DriveStatus {
  const config = loadConfig();
  const hasCredentials = !!(
    ctx?.secrets.get('GOOGLE_CLIENT_ID') &&
    ctx?.secrets.get('GOOGLE_CLIENT_SECRET') &&
    ctx?.secrets.get('GOOGLE_REFRESH_TOKEN')
  );

  const health = getTokenHealth();
  const reauth = hasCredentials && needsReauth(health);
  // Having credentials on disk is necessary but not sufficient — a revoked refresh
  // token is still three non-empty strings. Only report connected when Google's last
  // verdict wasn't a rejection. An 'unreachable' probe (offline host) is deliberately
  // NOT treated as a rejection: it would push users into a pointless re-consent flow.
  const wired = config.enabled && hasCredentials && driveApi !== null;

  let error: string | undefined;
  if (!hasCredentials && config.enabled) error = 'Missing OAuth credentials';
  else if (reauth) error = health.error;

  return {
    authenticated: Boolean(driveApi && hasCredentials) && !reauth,
    connected: wired && !reauth,
    lastChecked: health.checkedAt || Date.now(),
    error,
    needsReauth: reauth,
    tokenState: hasCredentials ? health.state : undefined,
  };
}

export function isConfigured(): boolean {
  return driveApi !== null;
}

/** Force a live refresh_token exchange against Google and return the updated status. */
export async function probeToken(): Promise<DriveStatus> {
  if (ctx) await probeTokenHealth(ctx, { force: true });
  return getStatus();
}

// ─── OAuth ───

export function getAuthUrl(): string {
  if (!oauth2Client) {
    const clientId = ctx?.secrets.get('GOOGLE_CLIENT_ID');
    const clientSecret = ctx?.secrets.get('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret || !ctx) {
      throw new Error('Google Drive OAuth not configured');
    }
    oauth2Client = createOAuthClient(clientId, clientSecret, getRedirectUri());
  }
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function handleAuthCallback(code: string): Promise<void> {
  if (!oauth2Client || !ctx) throw new Error('Google Drive OAuth not initialized');

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (tokens.refresh_token) {
    ctx.secrets.set('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
  }

  driveApi = google.drive({ version: 'v3', auth: oauth2Client });
  docsApi = google.docs({ version: 'v1', auth: oauth2Client });

  // Auto-enable the integration after successful OAuth
  updateConfig({ enabled: true });

  // Fresh consent just produced this token. Clears the 'expired' verdict AND re-arms
  // Gmail and Calendar, whose clients still hold the old refresh token — all three
  // share this one secret, so one consent must repair all three.
  await notifyTokenRotated();

  ctx.log.info('Google Drive OAuth complete. Drive initialized.');
}

// ─── Files CRUD ───

const FILE_FIELDS = 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents, trashed';

export async function listFiles(params: ListFilesParams): Promise<ListFilesResult> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const config = loadConfig();
  const queryParts: string[] = [];

  // Folder filter
  const folderId = params.folderId || config.defaultFolderId;
  if (folderId) {
    queryParts.push(`'${folderId}' in parents`);
  }

  // MIME type filter
  if (params.mimeType) {
    queryParts.push(`mimeType = '${params.mimeType}'`);
  }

  // Trashed filter (default: exclude trashed)
  if (params.trashed === true) {
    queryParts.push('trashed = true');
  } else {
    queryParts.push('trashed = false');
  }

  // Custom query (appended with AND)
  if (params.query) {
    queryParts.push(params.query);
  }

  // Shared Drive scoping: when a driveId is provided we scope results to that
  // Shared Drive (corpora='drive'). When includeItemsFromAllDrives is requested,
  // we broaden the listing across My Drive + all accessible Shared Drives.
  const useSharedDrives = Boolean(params.driveId) || params.includeItemsFromAllDrives === true;

  const result = await driveApi.files.list({
    q: queryParts.join(' and '),
    fields: `nextPageToken, files(${FILE_FIELDS})`,
    pageSize: params.maxResults || 50,
    pageToken: params.pageToken,
    orderBy: params.orderBy || 'modifiedTime desc',
    supportsAllDrives: useSharedDrives || undefined,
    includeItemsFromAllDrives: useSharedDrives || undefined,
    corpora: params.driveId ? 'drive' : undefined,
    driveId: params.driveId,
  });

  return {
    files: (result.data.files || []).map(mapDriveFile),
    nextPageToken: result.data.nextPageToken || undefined,
  };
}

export async function getFile(fileId: string): Promise<DriveFile> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const result = await driveApi.files.get({
    fileId,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });

  return mapDriveFile(result.data);
}

/**
 * Maximum payload `getFileContent` will inline into a JSON response.
 *
 * Above this the JSON round-trip stops being viable long before Drive does — base64
 * inflates by 4/3 and Node caps a single string at ~512 MB — so oversized reads are
 * refused with a pointer to `downloadFile`, which streams to disk instead.
 */
const MAX_INLINE_CONTENT_BYTES = 10 * 1024 * 1024;

/**
 * Open the raw byte stream for a Drive file, exporting it first if it's a native
 * Google Workspace doc. Nothing is buffered in memory: callers pipe it to disk or to
 * an HTTP response, which is what makes multi-hundred-MB files downloadable at all.
 */
export async function openDownloadStream(
  fileId: string,
  exportMimeType?: string,
): Promise<{ stream: Readable; name: string; mimeType: string; size?: number; exported: boolean }> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const meta = await driveApi.files.get({
    fileId,
    fields: 'name, mimeType, size',
    supportsAllDrives: true,
  });

  const name = meta.data.name || fileId;
  const sourceMimeType = meta.data.mimeType || 'application/octet-stream';

  if (sourceMimeType.startsWith('application/vnd.google-apps.')) {
    const exportType = exportMimeType || getDefaultExportType(sourceMimeType);
    const result = await driveApi.files.export({ fileId, mimeType: exportType }, { responseType: 'stream' });
    // Exported bytes are generated on the fly, so Drive reports no size up front.
    return { stream: result.data as unknown as Readable, name, mimeType: exportType, exported: true };
  }

  const result = await driveApi.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );

  return {
    stream: result.data as unknown as Readable,
    name,
    mimeType: sourceMimeType,
    size: meta.data.size ? Number(meta.data.size) : undefined,
    exported: false,
  };
}

/**
 * Download a Drive file straight to the local filesystem.
 *
 * Streams through a `.part` file and renames on success, so an interrupted transfer
 * never leaves a truncated file sitting at the destination path.
 */
export async function downloadFile(fileId: string, params: DownloadFileParams = {}): Promise<DownloadFileResult> {
  const { stream, name, mimeType, exported } = await openDownloadStream(fileId, params.exportMimeType);

  const targetPath = resolveDestPath(params.destPath, suggestFileName(name, mimeType, exported));

  if (params.overwrite === false && fs.existsSync(targetPath)) {
    stream.destroy();
    throw new Error(`Destination already exists: ${targetPath} (pass overwrite=true to replace it)`);
  }

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const partPath = `${targetPath}.part-${process.pid}-${Date.now()}`;

  try {
    await pipeline(stream, fs.createWriteStream(partPath));
    await fs.promises.rename(partPath, targetPath);
  } catch (err) {
    await fs.promises.rm(partPath, { force: true }).catch(() => {});
    throw err;
  }

  const { size } = await fs.promises.stat(targetPath);

  return { fileId, name, path: targetPath, bytes: size, mimeType, exported };
}

/**
 * Read a file's content into memory.
 *
 * Binary files come back base64-encoded. The previous version asked googleapis for
 * `responseType: 'text'`, which ran every byte through a UTF-8 decode — zips, PDFs and
 * images arrived full of U+FFFD replacement characters, and anything past Node's string
 * limit threw `Cannot create a string longer than ...`. Use `downloadFile` for anything
 * large; this endpoint refuses payloads over MAX_INLINE_CONTENT_BYTES.
 */
export async function getFileContent(fileId: string, exportMimeType?: string): Promise<FileContentResult> {
  if (!driveApi) throw new Error('Google Drive not configured');

  // First, get the file metadata to check its type
  const meta = await driveApi.files.get({
    fileId,
    fields: 'mimeType, name, size',
    supportsAllDrives: true,
  });

  const fileMimeType = meta.data.mimeType || '';
  const name = meta.data.name || fileId;
  const declaredSize = meta.data.size ? Number(meta.data.size) : undefined;

  // Refuse before transferring anything — Drive already told us how big this is.
  if (declaredSize !== undefined && declaredSize > MAX_INLINE_CONTENT_BYTES) {
    throw new Error(
      `${name} is ${formatBytes(declaredSize)}, over the ${formatBytes(MAX_INLINE_CONTENT_BYTES)} inline limit. `
      + `Use GET /api/drive/files/${fileId}/download?destPath=/absolute/path to stream it to disk instead.`,
    );
  }

  // Google Workspace files (Docs, Sheets, Slides) must be exported
  const isGoogleDoc = fileMimeType.startsWith('application/vnd.google-apps.');
  const resultMimeType = isGoogleDoc ? (exportMimeType || getDefaultExportType(fileMimeType)) : fileMimeType;

  const result = isGoogleDoc
    ? await driveApi.files.export({ fileId, mimeType: resultMimeType }, { responseType: 'arraybuffer' })
    : await driveApi.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      );

  const buffer = toBuffer(result.data);

  if (buffer.length > MAX_INLINE_CONTENT_BYTES) {
    throw new Error(
      `${name} is ${formatBytes(buffer.length)}, over the ${formatBytes(MAX_INLINE_CONTENT_BYTES)} inline limit. `
      + `Use GET /api/drive/files/${fileId}/download?destPath=/absolute/path to stream it to disk instead.`,
    );
  }

  const binary = !isTextContent(buffer, resultMimeType);

  return {
    content: binary ? buffer.toString('base64') : buffer.toString('utf-8'),
    mimeType: resultMimeType,
    encoding: binary ? 'base64' : 'utf-8',
    bytes: buffer.length,
    name,
  };
}

export async function createFile(params: CreateFileParams): Promise<DriveFile> {
  if (!driveApi) throw new Error('Google Drive not configured');
  if (params.content === undefined && !params.filePath) {
    throw new Error('createFile requires either `content` or `filePath`');
  }

  const config = loadConfig();
  const folderId = params.folderId || config.defaultFolderId;

  const fileMetadata: drive_v3.Schema$File = {
    name: params.name,
    description: params.description,
    parents: folderId ? [folderId] : undefined,
  };

  // Determine if we should create a Google Workspace file
  const mimeType = params.mimeType || 'text/plain';
  const googleDocType = getGoogleDocType(mimeType);

  // For Google Workspace files the target mimeType goes on the metadata so Drive
  // converts the upload into a native Doc/Sheet/Slide, while the media itself must
  // describe the SOURCE format (plain text by default, or HTML if the content
  // looks like HTML so Docs preserves formatting).
  let mediaMimeType = mimeType;
  if (googleDocType && params.content !== undefined) {
    fileMetadata.mimeType = googleDocType;
    const looksLikeHtml = /^\s*<(!doctype|html|body|div|h[1-6]|p|ul|ol|table)\b/i.test(params.content);
    mediaMimeType = looksLikeHtml ? 'text/html' : 'text/plain';
  }

  // Build the upload stream — from disk if filePath is set, otherwise from the inline string content
  const fsModule = await import('fs');
  const body = params.filePath
    ? fsModule.createReadStream(params.filePath)
    : Readable.from(params.content as string);

  const media = {
    mimeType: mediaMimeType,
    body,
  };

  const result = await driveApi.files.create({
    requestBody: fileMetadata,
    media,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });

  const file = mapDriveFile(result.data);

  // Log to SQLite
  ctx?.eventDb.logDriveAction({
    fileId: file.fileId,
    action: 'created',
    fileName: params.name,
    mimeType: file.mimeType,
    folderId: folderId || undefined,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);

  return file;
}

export async function copyFile(params: CopyFileParams): Promise<DriveFile> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const requestBody: drive_v3.Schema$File = {};
  if (params.name) requestBody.name = params.name;
  if (params.description !== undefined) requestBody.description = params.description;
  if (params.folderId) requestBody.parents = [params.folderId];

  const result = await driveApi.files.copy({
    fileId: params.sourceFileId,
    requestBody,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });

  const file = mapDriveFile(result.data);

  ctx?.eventDb.logDriveAction({
    fileId: file.fileId,
    action: 'created',
    fileName: file.name,
    mimeType: file.mimeType,
    folderId: params.folderId,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);

  return file;
}

export async function moveFile(
  fileId: string,
  params: MoveFileParams,
): Promise<DriveFile> {
  if (!driveApi) throw new Error('Google Drive not configured');

  // Figure out which parents to detach
  let removeParents = params.removeFromFolderIds;
  if (!removeParents) {
    const existing = await driveApi.files.get({
      fileId,
      fields: 'parents',
      supportsAllDrives: true,
    });
    removeParents = existing.data.parents || [];
  }

  const result = await driveApi.files.update({
    fileId,
    addParents: params.folderId,
    removeParents: removeParents.join(','),
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });

  const file = mapDriveFile(result.data);

  ctx?.eventDb.logDriveAction({
    fileId: file.fileId,
    action: 'updated',
    fileName: file.name,
    mimeType: file.mimeType,
    folderId: params.folderId,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);

  return file;
}

export async function replaceTextInDoc(
  fileId: string,
  params: ReplaceTextParams,
): Promise<ReplaceTextResult> {
  if (!docsApi) throw new Error('Google Docs API not configured');

  const requests: docs_v1.Schema$Request[] = params.replacements.map(r => ({
    replaceAllText: {
      containsText: {
        text: r.find,
        matchCase: r.matchCase ?? false,
      },
      replaceText: r.replace,
    },
  }));

  // Append plain text if requested. We read the current end index so the new text
  // goes at the tail of the body, just before the trailing newline that Docs always has.
  let appended = false;
  if (params.appendText && params.appendText.length > 0) {
    const doc = await docsApi.documents.get({ documentId: fileId, fields: 'body(content(endIndex))' });
    const segments = doc.data.body?.content || [];
    const lastEnd = segments.reduce((max, seg) => Math.max(max, seg.endIndex || 0), 1);
    // endIndex points one past the final newline; insert BEFORE it so the body keeps a trailing newline.
    const insertAt = Math.max(1, lastEnd - 1);
    requests.push({
      insertText: {
        location: { index: insertAt },
        text: (insertAt > 1 ? '\n' : '') + params.appendText,
      },
    });
    appended = true;
  }

  const result = await docsApi.documents.batchUpdate({
    documentId: fileId,
    requestBody: { requests },
  });

  const totalOccurrencesChanged = (result.data.replies || []).reduce((sum, reply) => {
    return sum + (reply.replaceAllText?.occurrencesChanged || 0);
  }, 0);

  ctx?.eventDb.logDriveAction({
    fileId,
    action: 'updated',
    fileName: fileId,
    mimeType: 'application/vnd.google-apps.document',
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);

  return { fileId, totalOccurrencesChanged, appended };
}

// ─── Google Docs API ───
// These functions use the Docs API directly (instead of Drive). They operate on
// Google Doc files only (mimeType application/vnd.google-apps.document).

/**
 * Create a blank Google Doc with the given title. Returns the same DriveFile
 * shape as createFile for consistency.
 */
export async function createDocument(params: CreateDocumentParams): Promise<DriveFile> {
  if (!docsApi) throw new Error('Google Docs API not configured');
  if (!driveApi) throw new Error('Google Drive not configured');

  const created = await docsApi.documents.create({
    requestBody: { title: params.title },
  });

  const documentId = created.data.documentId;
  if (!documentId) throw new Error('documents.create returned no documentId');

  // Fetch the matching Drive file record so we can return standard DriveFile fields.
  const driveRes = await driveApi.files.get({
    fileId: documentId,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  const file = mapDriveFile(driveRes.data);

  ctx?.eventDb.logDriveAction({
    fileId: file.fileId,
    action: 'created',
    fileName: file.name,
    mimeType: file.mimeType,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);

  return file;
}

/**
 * Get the full structured Google Doc including body, headers, footers, styles,
 * named ranges, inline objects and revision metadata. This is the Docs API's
 * native representation — much richer than the Drive text/plain export.
 */
export async function getDocument(documentId: string): Promise<docs_v1.Schema$Document> {
  if (!docsApi) throw new Error('Google Docs API not configured');
  const result = await docsApi.documents.get({ documentId });
  return result.data;
}

/**
 * Generic passthrough to documents.batchUpdate. Accepts the raw requests array
 * so every Docs API mutation type (replaceAllText, insertText, insertTable,
 * insertInlineImage, updateParagraphStyle, updateTextStyle, createParagraphBullets,
 * insertPageBreak, insertSectionBreak, replaceImage, createHeader, createFooter,
 * createFootnote, deleteContentRange, etc.) is supported without any new server
 * code.
 */
export async function batchUpdateDocument(
  documentId: string,
  params: BatchUpdateDocumentParams,
): Promise<BatchUpdateDocumentResult> {
  if (!docsApi) throw new Error('Google Docs API not configured');

  const requestBody: docs_v1.Schema$BatchUpdateDocumentRequest = {
    requests: params.requests,
  };
  if (params.writeControl) requestBody.writeControl = params.writeControl;

  const result = await docsApi.documents.batchUpdate({
    documentId,
    requestBody,
  });

  ctx?.eventDb.logDriveAction({
    fileId: documentId,
    action: 'updated',
    fileName: documentId,
    mimeType: 'application/vnd.google-apps.document',
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);

  return {
    documentId: result.data.documentId || documentId,
    replies: result.data.replies || [],
    writeControl: result.data.writeControl || undefined,
  };
}

export async function updateFile(
  fileId: string,
  params: UpdateFileParams,
): Promise<DriveFile> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const requestBody: drive_v3.Schema$File = {};
  if (params.name !== undefined) requestBody.name = params.name;
  if (params.description !== undefined) requestBody.description = params.description;

  let media: { mimeType: string; body: Readable } | undefined;
  if (params.content !== undefined) {
    const mimeType = params.mimeType || 'text/plain';
    media = {
      mimeType,
      body: Readable.from(params.content),
    };
  }

  const result = await driveApi.files.update({
    fileId,
    requestBody,
    media,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });

  const file = mapDriveFile(result.data);

  ctx?.eventDb.logDriveAction({
    fileId: file.fileId,
    action: 'updated',
    fileName: file.name,
    mimeType: file.mimeType,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);

  return file;
}

export async function deleteFile(
  fileId: string,
  opts?: { agentId?: string; workflowInstanceId?: string },
): Promise<void> {
  if (!driveApi) throw new Error('Google Drive not configured');

  // Get file name before deletion for logging
  let fileName = fileId;
  try {
    const existing = await driveApi.files.get({ fileId, fields: 'name, mimeType', supportsAllDrives: true });
    fileName = existing.data.name || fileId;
  } catch {
    // File may already be deleted, proceed
  }

  await driveApi.files.delete({ fileId, supportsAllDrives: true });

  ctx?.eventDb.logDriveAction({
    fileId,
    action: 'deleted',
    fileName,
    mimeType: '',
    agentId: opts?.agentId,
    workflowInstanceId: opts?.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);
}

export async function createFolder(
  name: string,
  parentFolderId?: string,
  opts?: { agentId?: string; workflowInstanceId?: string },
): Promise<DriveFile> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const config = loadConfig();
  const parent = parentFolderId || config.defaultFolderId;

  const result = await driveApi.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parent ? [parent] : undefined,
    },
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });

  const folder = mapDriveFile(result.data);

  ctx?.eventDb.logDriveAction({
    fileId: folder.fileId,
    action: 'created',
    fileName: name,
    mimeType: 'application/vnd.google-apps.folder',
    folderId: parent || undefined,
    agentId: opts?.agentId,
    workflowInstanceId: opts?.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies DriveActionEvent);

  return folder;
}

export async function searchFiles(
  queryText: string,
  maxResults?: number,
): Promise<DriveFile[]> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const result = await driveApi.files.list({
    q: `fullText contains '${queryText.replace(/'/g, "\\'")}' and trashed = false`,
    fields: `files(${FILE_FIELDS})`,
    pageSize: maxResults || 20,
    orderBy: 'modifiedTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (result.data.files || []).map(mapDriveFile);
}

// ─── Shared Drives (Team Drives) ───

const DRIVE_FIELDS = 'id, name, createdTime, hidden, colorRgb, themeId, backgroundImageLink, capabilities';

export async function listSharedDrives(params: ListSharedDrivesParams = {}): Promise<ListSharedDrivesResult> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const result = await driveApi.drives.list({
    pageSize: params.maxResults || 50,
    pageToken: params.pageToken,
    q: params.query,
    useDomainAdminAccess: params.useDomainAdminAccess,
    fields: `nextPageToken, drives(${DRIVE_FIELDS})`,
  });

  return {
    drives: (result.data.drives || []).map(mapSharedDrive),
    nextPageToken: result.data.nextPageToken || undefined,
  };
}

export async function getSharedDrive(driveId: string): Promise<SharedDrive> {
  if (!driveApi) throw new Error('Google Drive not configured');

  const result = await driveApi.drives.get({
    driveId,
    fields: DRIVE_FIELDS,
  });

  return mapSharedDrive(result.data);
}

// ─── Helpers ───

function mapDriveFile(data: drive_v3.Schema$File): DriveFile {
  return {
    fileId: data.id || '',
    name: data.name || '',
    mimeType: data.mimeType || '',
    size: data.size || undefined,
    createdTime: data.createdTime || undefined,
    modifiedTime: data.modifiedTime || undefined,
    webViewLink: data.webViewLink || undefined,
    parents: data.parents || undefined,
    trashed: data.trashed || false,
  };
}

function mapSharedDrive(data: drive_v3.Schema$Drive): SharedDrive {
  return {
    driveId: data.id || '',
    name: data.name || '',
    createdTime: data.createdTime || undefined,
    hidden: data.hidden || false,
    colorRgb: data.colorRgb || undefined,
    themeId: data.themeId || undefined,
    backgroundImageLink: data.backgroundImageLink || undefined,
    capabilities: data.capabilities
      ? {
          canEdit: data.capabilities.canEdit || undefined,
          canManageMembers: data.capabilities.canManageMembers || undefined,
          canShare: data.capabilities.canShare || undefined,
        }
      : undefined,
  };
}

/** Normalize whatever googleapis hands back for `responseType: 'arraybuffer'` into a Buffer. */
function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(String(data ?? ''), 'utf-8');
}

/**
 * Decide whether bytes can be handed back as a UTF-8 string.
 *
 * The mime type alone lies often enough (Drive labels plenty of real files
 * `application/octet-stream`), so the bytes get the final say: a NUL byte or a failed
 * round-trip through UTF-8 means base64. Getting this wrong is the corruption bug.
 */
function isTextContent(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length === 0) return true;

  const looksTextual = mimeType.startsWith('text/')
    || /^application\/(json|xml|javascript|x-ndjson|yaml|x-yaml|sql|x-sh)\b/.test(mimeType)
    || /\+(json|xml)\b/.test(mimeType);

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;

  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(sample);
  if (decoded.includes('\uFFFD')) return false;

  if (looksTextual) return true;

  // Unlabeled but clean UTF-8 with no control-character noise: treat as text.
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded);
}

/** Pick the filename to write on disk, appending an extension when an export changed the format. */
function suggestFileName(driveName: string, mimeType: string, exported: boolean): string {
  const safe = driveName.replace(/[/\\\u0000]/g, '_').trim() || 'drive-file';
  if (!exported) return safe;

  const ext = EXPORT_EXTENSIONS[mimeType];
  if (!ext || safe.toLowerCase().endsWith(ext)) return safe;
  return `${safe}${ext}`;
}

const EXPORT_EXTENSIONS: Record<string, string> = {
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/markdown': '.md',
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'application/rtf': '.rtf',
  'application/zip': '.zip',
  'application/epub+zip': '.epub',
  'application/x-vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

/**
 * Resolve the caller's `destPath` into an absolute file path.
 * A directory (existing, or written with a trailing separator) gets the Drive name appended.
 */
function resolveDestPath(destPath: string | undefined, suggestedName: string): string {
  const raw = (destPath || '').trim();
  if (!raw) return path.join(os.tmpdir(), suggestedName);

  const expanded = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
  const resolved = path.resolve(expanded);

  const isDirectory = /[/\\]$/.test(raw)
    || (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory());

  return isDirectory ? path.join(resolved, suggestedName) : resolved;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function getDefaultExportType(googleMimeType: string): string {
  switch (googleMimeType) {
    case 'application/vnd.google-apps.document':
      return 'text/plain';
    case 'application/vnd.google-apps.spreadsheet':
      return 'text/csv';
    case 'application/vnd.google-apps.presentation':
      return 'text/plain';
    case 'application/vnd.google-apps.drawing':
      return 'image/png';
    default:
      return 'text/plain';
  }
}

function getGoogleDocType(mimeType: string): string | null {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return 'application/vnd.google-apps.document';
    case 'application/vnd.google-apps.spreadsheet':
      return 'application/vnd.google-apps.spreadsheet';
    case 'application/vnd.google-apps.presentation':
      return 'application/vnd.google-apps.presentation';
    default:
      return null;
  }
}
