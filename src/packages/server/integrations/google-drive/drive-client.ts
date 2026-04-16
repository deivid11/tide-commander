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
import { Readable } from 'stream';

// ─── Types ───

export interface DriveStatus {
  authenticated: boolean;
  connected: boolean;
  lastChecked: number;
  error?: string;
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
  content: string;
  mimeType?: string;
  folderId?: string;
  description?: string;
  agentId?: string;
  workflowInstanceId?: string;
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

  oauth2Client = new google.auth.OAuth2(clientId, clientSecret, `${ctx.serverConfig.baseUrl}${REDIRECT_PATH}`);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  driveApi = google.drive({ version: 'v3', auth: oauth2Client });
  docsApi = google.docs({ version: 'v1', auth: oauth2Client });
  ctx.log.info('Google Drive initialized');
}

export async function shutdown(): Promise<void> {
  driveApi = null;
  docsApi = null;
}

// ─── Status ───

export function getStatus(): DriveStatus {
  const config = loadConfig();
  const hasCredentials = !!(
    ctx?.secrets.get('GOOGLE_CLIENT_ID') &&
    ctx?.secrets.get('GOOGLE_CLIENT_SECRET') &&
    ctx?.secrets.get('GOOGLE_REFRESH_TOKEN')
  );

  return {
    authenticated: Boolean(driveApi && hasCredentials),
    connected: config.enabled && hasCredentials && driveApi !== null,
    lastChecked: Date.now(),
    error: !hasCredentials && config.enabled ? 'Missing OAuth credentials' : undefined,
  };
}

export function isConfigured(): boolean {
  return driveApi !== null;
}

// ─── OAuth ───

export function getAuthUrl(): string {
  if (!oauth2Client) {
    const clientId = ctx?.secrets.get('GOOGLE_CLIENT_ID');
    const clientSecret = ctx?.secrets.get('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret || !ctx) {
      throw new Error('Google Drive OAuth not configured');
    }
    oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${ctx.serverConfig.baseUrl}${REDIRECT_PATH}`
    );
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

export async function getFileContent(fileId: string, exportMimeType?: string): Promise<{ content: string; mimeType: string }> {
  if (!driveApi) throw new Error('Google Drive not configured');

  // First, get the file metadata to check its type
  const meta = await driveApi.files.get({
    fileId,
    fields: 'mimeType, name',
    supportsAllDrives: true,
  });

  const fileMimeType = meta.data.mimeType || '';

  // Google Workspace files (Docs, Sheets, Slides) must be exported
  if (fileMimeType.startsWith('application/vnd.google-apps.')) {
    const exportType = exportMimeType || getDefaultExportType(fileMimeType);
    const result = await driveApi.files.export({
      fileId,
      mimeType: exportType,
    }, { responseType: 'text' });

    return {
      content: typeof result.data === 'string' ? result.data : String(result.data),
      mimeType: exportType,
    };
  }

  // Regular files: download content
  const result = await driveApi.files.get({
    fileId,
    alt: 'media',
    supportsAllDrives: true,
  }, { responseType: 'text' });

  return {
    content: typeof result.data === 'string' ? result.data : String(result.data),
    mimeType: fileMimeType,
  };
}

export async function createFile(params: CreateFileParams): Promise<DriveFile> {
  if (!driveApi) throw new Error('Google Drive not configured');

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
  if (googleDocType) {
    fileMetadata.mimeType = googleDocType;
    const looksLikeHtml = /^\s*<(!doctype|html|body|div|h[1-6]|p|ul|ol|table)\b/i.test(params.content);
    mediaMimeType = looksLikeHtml ? 'text/html' : 'text/plain';
  }

  const media = {
    mimeType: mediaMimeType,
    body: Readable.from(params.content),
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
