/**
 * File Tracker Service
 * Tracks which files Claude creates or modifies during a conversation
 * and collects their contents for snapshot creation
 *
 * This service analyzes Claude session files to find Write and Edit tool uses,
 * then collects the current content of those files for snapshot preservation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { SnapshotFile } from '../../shared/types.js';
import { getProjectDir } from '../claude/session-loader.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('FileTracker');

/**
 * Tracked file change from session analysis
 */
export interface TrackedFileChange {
  filePath: string;
  type: 'created' | 'modified';
  timestamp: number;
}

/**
 * Extract file changes from a Claude session file
 * Looks for Write (created) and Edit (modified) tool uses
 *
 * @param cwd - Working directory of the agent
 * @param sessionId - Session ID to analyze
 * @returns Array of tracked file changes
 */
export async function extractFileChangesFromSession(
  cwd: string,
  sessionId: string
): Promise<TrackedFileChange[]> {
  const projectDir = getProjectDir(cwd);
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);

  const _fileChanges: TrackedFileChange[] = [];
  const seenPaths = new Map<string, TrackedFileChange>(); // Track latest change per path

  if (!fs.existsSync(sessionFile)) {
    log.log(` Session file not found: ${sessionFile}`);
    return [];
  }

  // Read file line by line
  const fileStream = fs.createReadStream(sessionFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      // Look for tool_use in assistant messages
      if (entry.type === 'assistant' && entry.message?.content) {
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_use' && block.name) {
              const toolInput = block.input as Record<string, unknown> | undefined;

              if (toolInput) {
                const filePath = (toolInput.file_path || toolInput.path) as string | undefined;

                if (filePath && (block.name === 'Write' || block.name === 'Edit')) {
                  const timestamp = new Date(entry.timestamp).getTime();
                  const change: TrackedFileChange = {
                    filePath,
                    type: block.name === 'Write' ? 'created' : 'modified',
                    timestamp,
                  };

                  // Keep the latest change for each path
                  // A file written then edited should show as created
                  const existing = seenPaths.get(filePath);
                  if (!existing || change.timestamp > existing.timestamp) {
                    // If first write, then edit - keep as 'created'
                    if (existing && existing.type === 'created') {
                      change.type = 'created';
                    }
                    seenPaths.set(filePath, change);
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Skip invalid lines
    }
  }

  // Return unique file changes
  return Array.from(seenPaths.values());
}

/**
 * Read file content safely
 * Returns null if file doesn't exist or can't be read
 *
 * @param filePath - Absolute path to the file
 * @returns File content or null
 */
export function readFileContent(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      log.log(` File no longer exists: ${filePath}`);
      return null;
    }

    const stats = fs.statSync(filePath);

    // Skip very large files (> 1MB)
    if (stats.size > 1024 * 1024) {
      log.log(` Skipping large file (${stats.size} bytes): ${filePath}`);
      return null;
    }

    // Skip binary files
    const ext = path.extname(filePath).toLowerCase();
    const binaryExtensions = [
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.zip', '.tar', '.gz', '.rar', '.7z',
      '.exe', '.dll', '.so', '.dylib',
      '.woff', '.woff2', '.ttf', '.eot',
      '.mp3', '.wav', '.ogg', '.mp4', '.avi', '.mov', '.webm',
      '.db', '.sqlite', '.sqlite3',
    ];

    if (binaryExtensions.includes(ext)) {
      log.log(` Skipping binary file: ${filePath}`);
      return null;
    }

    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.error(` Failed to read file ${filePath}:`, err);
    return null;
  }
}

/**
 * Get file size in bytes
 *
 * @param filePath - Absolute path to the file
 * @returns File size or 0 if file doesn't exist
 */
export function getFileSize(filePath: string): number {
  try {
    if (!fs.existsSync(filePath)) {
      return 0;
    }
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Get relative path from base directory
 *
 * @param filePath - Absolute file path
 * @param basePath - Base directory path
 * @returns Relative path
 */
export function getRelativePath(filePath: string, basePath: string): string {
  // Normalize paths
  const normalizedFile = path.normalize(filePath);
  const normalizedBase = path.normalize(basePath);

  // Check if file is within base path
  if (normalizedFile.startsWith(normalizedBase)) {
    return path.relative(normalizedBase, normalizedFile);
  }

  return normalizedFile;
}

/**
 * Collect file contents for snapshot
 * Extracts all file changes from a session and reads their current content
 *
 * @param cwd - Working directory of the agent
 * @param sessionId - Session ID to analyze
 * @returns Array of snapshot files with content
 */
export async function collectFilesForSnapshot(
  cwd: string,
  sessionId: string
): Promise<SnapshotFile[]> {
  // Extract file changes from session
  const changes = await extractFileChangesFromSession(cwd, sessionId);

  if (changes.length === 0) {
    log.log(` No file changes found in session ${sessionId}`);
    return [];
  }

  log.log(` Found ${changes.length} file change(s) in session ${sessionId}`);

  const snapshotFiles: SnapshotFile[] = [];

  for (const change of changes) {
    const content = readFileContent(change.filePath);

    // Skip files we couldn't read
    if (content === null) {
      continue;
    }

    snapshotFiles.push({
      path: change.filePath,
      relativePath: getRelativePath(change.filePath, cwd),
      content,
      type: change.type,
      timestamp: change.timestamp,
      size: getFileSize(change.filePath),
    });
  }

  log.log(` Collected ${snapshotFiles.length} file(s) for snapshot`);

  return snapshotFiles;
}

/**
 * Restore files from a snapshot
 *
 * @param files - Files to restore
 * @param targetDir - Optional alternative directory to restore to
 * @param overwrite - Whether to overwrite existing files
 * @returns Object with lists of restored and skipped files
 */
export function restoreFilesFromSnapshot(
  files: SnapshotFile[],
  targetDir?: string,
  overwrite: boolean = false
): { restored: string[]; skipped: string[] } {
  const restored: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    // Determine target path
    let targetPath = file.path;

    if (targetDir && file.relativePath) {
      // If alternative target dir provided, use relative path
      targetPath = path.join(targetDir, file.relativePath);
    }

    // Check if file exists
    if (fs.existsSync(targetPath) && !overwrite) {
      log.log(` Skipping existing file: ${targetPath}`);
      skipped.push(targetPath);
      continue;
    }

    try {
      // Ensure parent directory exists
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(targetPath, file.content, 'utf-8');
      log.log(` Restored file: ${targetPath}`);
      restored.push(targetPath);
    } catch (err) {
      log.error(` Failed to restore file ${targetPath}:`, err);
      skipped.push(targetPath);
    }
  }

  return { restored, skipped };
}

// Export service as a singleton-like object for consistency
export const fileTrackerService = {
  extractFileChangesFromSession,
  readFileContent,
  getFileSize,
  getRelativePath,
  collectFilesForSnapshot,
  restoreFilesFromSnapshot,
};
