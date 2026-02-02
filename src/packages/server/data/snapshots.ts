/**
 * Snapshot Persistence Layer
 * Manages storage and retrieval of conversation snapshots
 *
 * Storage structure:
 * ~/.tide-commander/snapshots/
 *   <snapshot-id>/
 *     snapshot.json  - Metadata + conversation outputs
 *     files/         - Directory with all file artifacts (optional compression)
 *       <relative-path>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import type {
  ConversationSnapshot,
  SnapshotListItem,
  SnapshotFile,
} from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SnapshotData');

// Snapshots directory inside ~/.tide-commander
const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');

// Size threshold for compressing files (10KB)
const COMPRESSION_THRESHOLD = 10 * 1024;

// Maximum total size for all files in a snapshot (50MB)
const MAX_SNAPSHOT_SIZE = 50 * 1024 * 1024;

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Ensure snapshots directory exists
 */
function ensureSnapshotsDir(): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    log.log(` Created snapshots directory: ${SNAPSHOTS_DIR}`);
  }
}

/**
 * Get the directory path for a specific snapshot
 */
function getSnapshotDir(snapshotId: string): string {
  return path.join(SNAPSHOTS_DIR, snapshotId);
}

/**
 * Get the metadata file path for a snapshot
 */
function getSnapshotMetadataPath(snapshotId: string): string {
  return path.join(getSnapshotDir(snapshotId), 'snapshot.json');
}

/**
 * Get the files directory path for a snapshot
 */
function getSnapshotFilesDir(snapshotId: string): string {
  return path.join(getSnapshotDir(snapshotId), 'files');
}

// ============================================================================
// Compression Utilities
// ============================================================================

/**
 * Compress content using gzip if above threshold
 */
function maybeCompress(content: string): { data: Buffer; compressed: boolean } {
  const buffer = Buffer.from(content, 'utf-8');

  if (buffer.length < COMPRESSION_THRESHOLD) {
    return { data: buffer, compressed: false };
  }

  const compressed = zlib.gzipSync(buffer);

  // Only use compression if it actually saves space
  if (compressed.length < buffer.length) {
    return { data: compressed, compressed: true };
  }

  return { data: buffer, compressed: false };
}

/**
 * Decompress content if it was compressed
 */
function maybeDecompress(data: Buffer, compressed: boolean): string {
  if (compressed) {
    return zlib.gunzipSync(data).toString('utf-8');
  }
  return data.toString('utf-8');
}

// ============================================================================
// Snapshot CRUD Operations
// ============================================================================

/**
 * Save a snapshot to disk
 * Creates directory structure and stores metadata + files
 */
export function saveSnapshot(snapshot: ConversationSnapshot): void {
  ensureSnapshotsDir();

  const snapshotDir = getSnapshotDir(snapshot.id);
  const filesDir = getSnapshotFilesDir(snapshot.id);

  // Create snapshot directory
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  // Store files separately (with optional compression)
  if (snapshot.files.length > 0) {
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    // Track total size
    let totalSize = 0;

    for (const file of snapshot.files) {
      const { data, compressed } = maybeCompress(file.content);
      totalSize += data.length;

      // Check total size limit
      if (totalSize > MAX_SNAPSHOT_SIZE) {
        log.warn(` Snapshot ${snapshot.id} exceeds size limit, truncating files`);
        break;
      }

      // Create relative path structure in files directory
      // Use a safe filename by replacing / with __
      const safeFileName = file.relativePath
        ? file.relativePath.replace(/\//g, '__')
        : path.basename(file.path);

      const filePath = path.join(filesDir, safeFileName + (compressed ? '.gz' : ''));

      fs.writeFileSync(filePath, data);

      // Also save file metadata
      const metaPath = path.join(filesDir, safeFileName + '.meta.json');
      fs.writeFileSync(metaPath, JSON.stringify({
        originalPath: file.path,
        relativePath: file.relativePath,
        type: file.type,
        timestamp: file.timestamp,
        size: file.size,
        compressed,
      }, null, 2));
    }
  }

  // Save metadata (without file contents - those are stored separately)
  const metadata: Omit<ConversationSnapshot, 'files'> & { fileCount: number } = {
    id: snapshot.id,
    agentId: snapshot.agentId,
    agentName: snapshot.agentName,
    agentClass: snapshot.agentClass,
    title: snapshot.title,
    description: snapshot.description,
    outputs: snapshot.outputs,
    sessionId: snapshot.sessionId,
    cwd: snapshot.cwd,
    createdAt: snapshot.createdAt,
    conversationStartedAt: snapshot.conversationStartedAt,
    tokensUsed: snapshot.tokensUsed,
    contextUsed: snapshot.contextUsed,
    fileCount: snapshot.files.length,
  };

  const metadataPath = getSnapshotMetadataPath(snapshot.id);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  log.log(` Saved snapshot "${snapshot.title}" (${snapshot.id}) with ${snapshot.files.length} files`);
}

/**
 * Load a snapshot from disk (full version with file contents)
 */
export function loadSnapshot(snapshotId: string): ConversationSnapshot | null {
  const metadataPath = getSnapshotMetadataPath(snapshotId);

  if (!fs.existsSync(metadataPath)) {
    log.log(` Snapshot not found: ${snapshotId}`);
    return null;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    // Migrate old snapshot format to new format if needed
    // Old format had type/content, new format has id/text
    if (metadata.outputs && metadata.outputs.length > 0 && !metadata.outputs[0].text) {
      log.log(` Migrating old snapshot format for ${snapshotId}`);
      metadata.outputs = metadata.outputs.map((output: any, index: number) => ({
        id: output.id || `msg-${index}`,
        text: output.content || '',
        timestamp: typeof output.timestamp === 'number' ? output.timestamp : (typeof output.timestamp === 'string' ? new Date(output.timestamp).getTime() : Date.now()),
        isStreaming: false,
      }));
    }

    // Load files from files directory
    const files: SnapshotFile[] = [];
    const filesDir = getSnapshotFilesDir(snapshotId);

    if (fs.existsSync(filesDir)) {
      const entries = fs.readdirSync(filesDir);

      // Find all .meta.json files
      const metaFiles = entries.filter(f => f.endsWith('.meta.json'));

      for (const metaFile of metaFiles) {
        const baseName = metaFile.replace('.meta.json', '');

        try {
          const fileMeta = JSON.parse(
            fs.readFileSync(path.join(filesDir, metaFile), 'utf-8')
          );

          // Determine content file path
          const contentFile = fileMeta.compressed
            ? path.join(filesDir, baseName + '.gz')
            : path.join(filesDir, baseName);

          if (fs.existsSync(contentFile)) {
            const data = fs.readFileSync(contentFile);
            const content = maybeDecompress(data, fileMeta.compressed);

            files.push({
              path: fileMeta.originalPath,
              relativePath: fileMeta.relativePath,
              content,
              type: fileMeta.type,
              timestamp: fileMeta.timestamp,
              size: fileMeta.size,
            });
          }
        } catch (err) {
          log.error(` Failed to load file ${metaFile}:`, err);
        }
      }
    }

    return {
      ...metadata,
      files,
    };
  } catch (err) {
    log.error(` Failed to load snapshot ${snapshotId}:`, err);
    return null;
  }
}

/**
 * Load snapshot metadata only (for listing)
 */
export function loadSnapshotMetadata(snapshotId: string): SnapshotListItem | null {
  const metadataPath = getSnapshotMetadataPath(snapshotId);

  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    return {
      id: metadata.id,
      title: metadata.title,
      description: metadata.description,
      agentId: metadata.agentId,
      agentName: metadata.agentName,
      agentClass: metadata.agentClass,
      cwd: metadata.cwd,
      createdAt: metadata.createdAt,
      fileCount: metadata.fileCount || 0,
      outputCount: metadata.outputs?.length || 0,
    };
  } catch (err) {
    log.error(` Failed to load snapshot metadata ${snapshotId}:`, err);
    return null;
  }
}

/**
 * List all snapshots (metadata only)
 * Optionally filter by agentId
 */
export function listSnapshots(agentId?: string, limit?: number): SnapshotListItem[] {
  ensureSnapshotsDir();

  const snapshots: SnapshotListItem[] = [];

  try {
    const entries = fs.readdirSync(SNAPSHOTS_DIR);

    for (const entry of entries) {
      const entryPath = path.join(SNAPSHOTS_DIR, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory()) {
        const metadata = loadSnapshotMetadata(entry);

        if (metadata) {
          // Filter by agentId if specified
          if (agentId && metadata.agentId !== agentId) {
            continue;
          }

          snapshots.push(metadata);
        }
      }
    }

    // Sort by creation date, newest first
    snapshots.sort((a, b) => b.createdAt - a.createdAt);

    // Apply limit if specified
    if (limit && limit > 0) {
      return snapshots.slice(0, limit);
    }

    return snapshots;
  } catch (err) {
    log.error(' Failed to list snapshots:', err);
    return [];
  }
}

/**
 * Delete a snapshot and all its files
 */
export function deleteSnapshot(snapshotId: string): boolean {
  const snapshotDir = getSnapshotDir(snapshotId);

  if (!fs.existsSync(snapshotDir)) {
    log.log(` Snapshot not found: ${snapshotId}`);
    return false;
  }

  try {
    // Recursively remove the snapshot directory
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    log.log(` Deleted snapshot: ${snapshotId}`);
    return true;
  } catch (err) {
    log.error(` Failed to delete snapshot ${snapshotId}:`, err);
    return false;
  }
}

/**
 * Check if a snapshot exists
 */
export function snapshotExists(snapshotId: string): boolean {
  return fs.existsSync(getSnapshotMetadataPath(snapshotId));
}

/**
 * Get the total size of a snapshot on disk (in bytes)
 */
export function getSnapshotSize(snapshotId: string): number {
  const snapshotDir = getSnapshotDir(snapshotId);

  if (!fs.existsSync(snapshotDir)) {
    return 0;
  }

  let totalSize = 0;

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory()) {
        walkDir(entryPath);
      } else {
        totalSize += stat.size;
      }
    }
  }

  try {
    walkDir(snapshotDir);
  } catch (err) {
    log.error(` Failed to get snapshot size ${snapshotId}:`, err);
  }

  return totalSize;
}

/**
 * Get total disk usage of all snapshots (in bytes)
 */
export function getTotalSnapshotsSize(): number {
  ensureSnapshotsDir();

  let totalSize = 0;

  try {
    const entries = fs.readdirSync(SNAPSHOTS_DIR);

    for (const entry of entries) {
      totalSize += getSnapshotSize(entry);
    }
  } catch (err) {
    log.error(' Failed to get total snapshots size:', err);
  }

  return totalSize;
}

/**
 * Get the snapshots directory path (for UI display)
 */
export function getSnapshotsDir(): string {
  return SNAPSHOTS_DIR;
}

// Export as a singleton-like object for consistency
export const snapshotDataService = {
  saveSnapshot,
  loadSnapshot,
  loadSnapshotMetadata,
  listSnapshots,
  deleteSnapshot,
  snapshotExists,
  getSnapshotSize,
  getTotalSnapshotsSize,
  getSnapshotsDir,
};
