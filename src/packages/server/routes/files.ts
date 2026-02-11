/**
 * Files Routes
 * REST API endpoints for file operations
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import * as os from 'os';
import { logger } from '../utils/logger.js';

const log = logger.files;

// Get or create temp directory for tide-commander uploads
const TEMP_DIR = path.join(os.tmpdir(), 'tide-commander-uploads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
log.log(` Temp upload directory: ${TEMP_DIR}`);

// File entry for directory listing
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: Date;
  extension: string;
}

// Tree node for recursive listing
interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  extension: string;
  children?: TreeNode[];
}

const router = Router();

// GET /api/files/read - Read file contents
router.get('/read', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    // Security: ensure path is absolute and doesn't contain ..
    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory' });
      return;
    }

    // Limit file size to 1MB
    if (stats.size > 1024 * 1024) {
      res.status(400).json({ error: 'File too large (max 1MB)' });
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    res.json({
      path: filePath,
      filename,
      extension,
      content,
      size: stats.size,
      modified: stats.mtime,
    });
  } catch (err: any) {
    log.error(' Failed to read file:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/exists - Check if a file exists
router.get('/exists', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    const exists = fs.existsSync(filePath);
    res.json({ exists, path: filePath });
  } catch (err: any) {
    log.error(' Failed to check file existence:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/info - Get file info without content
router.get('/info', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory' });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    res.json({
      path: filePath,
      filename,
      extension,
      size: stats.size,
      modified: stats.mtime,
    });
  } catch (err: any) {
    log.error(' Failed to get file info:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/binary - Read binary file (for images, PDFs, downloads)
router.get('/binary', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    const download = req.query.download === 'true';

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory' });
      return;
    }

    // Limit file size to 50MB for binary files
    if (stats.size > 50 * 1024 * 1024) {
      res.status(400).json({ error: 'File too large (max 50MB)' });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    // Set content type based on extension
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.wav': 'audio/wav',
    };

    const contentType = mimeTypes[extension] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);

    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    // Stream the file
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err: any) {
    log.error(' Failed to read binary file:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/list - List directory contents
router.get('/list', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;

    if (!dirPath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    // Security: ensure path is absolute
    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files: FileEntry[] = [];

    for (const entry of entries) {
      // Skip hidden files by default
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      try {
        const entryStats = fs.statSync(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: entryStats.size,
          modified: entryStats.mtime,
          extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
        });
      } catch {
        // Skip files we can't stat (permission issues, etc.)
      }
    }

    // Sort: directories first, then alphabetically
    files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json({
      path: dirPath,
      parent: path.dirname(dirPath),
      files,
    });
  } catch (err: any) {
    log.error(' Failed to list directory:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper function to build tree recursively
function buildTree(dirPath: string, depth: number, maxDepth: number): TreeNode[] {
  if (depth > maxDepth) return [];

  const nodes: TreeNode[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;
      // Skip common non-essential directories (but keep 'build' for APK access)
      if (['node_modules', 'dist', '.git', '__pycache__', 'venv', '.venv'].includes(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);

      try {
        const stats = fs.statSync(fullPath);
        const node: TreeNode = {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
        };

        if (entry.isDirectory()) {
          node.children = buildTree(fullPath, depth + 1, maxDepth);
        }

        nodes.push(node);
      } catch {
        // Skip files we can't access
      }
    }

    // Sort: directories first, then alphabetically
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch {
    // Return empty if can't read directory
  }

  return nodes;
}

// GET /api/files/tree - Get recursive directory tree
router.get('/tree', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const maxDepth = parseInt(req.query.depth as string) || 5;

    if (!dirPath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    const tree = buildTree(dirPath, 0, maxDepth);

    res.json({
      path: dirPath,
      name: path.basename(dirPath),
      tree,
    });
  } catch (err: any) {
    log.error(' Failed to build tree:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper function to search files recursively
function searchFiles(dirPath: string, query: string, results: TreeNode[], maxResults: number, depth: number = 0): void {
  if (results.length >= maxResults || depth > 10) return;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      // Skip hidden and common non-essential
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', '.git', '__pycache__', 'venv', '.venv'].includes(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);

      // Check if name matches query (case-insensitive)
      if (entry.name.toLowerCase().includes(query.toLowerCase())) {
        try {
          const stats = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stats.size,
            extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
          });
        } catch {
          // Skip
        }
      }

      // Recurse into directories
      if (entry.isDirectory()) {
        searchFiles(fullPath, query, results, maxResults, depth + 1);
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

// GET /api/files/search - Search for files
router.get('/search', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const query = req.query.q as string;
    const maxResults = parseInt(req.query.limit as string) || 50;

    if (!dirPath || !query) {
      res.status(400).json({ error: 'Missing path or query parameter' });
      return;
    }

    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    const results: TreeNode[] = [];
    searchFiles(dirPath, query, results, maxResults);

    // Sort: files first (more likely what user wants), then by name
    results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json({ results });
  } catch (err: any) {
    log.error(' Failed to search files:', err);
    res.status(500).json({ error: err.message });
  }
});

// Content search result type
interface ContentMatch {
  path: string;
  name: string;
  extension: string;
  matches: {
    line: number;
    content: string;
    context?: { before: string; after: string };
  }[];
}

// Text file extensions for content search
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.css', '.scss', '.sass', '.less', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs',
  '.swift', '.kt', '.scala', '.clj', '.ex', '.exs', '.erl', '.hs', '.ml', '.fs',
  '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.gitignore', '.dockerignore',
  '.editorconfig', '.prettierrc', '.eslintrc', '.babelrc',
  '.log', '.csv', '.tsv', '.svg', '.vue', '.svelte',
]);

// Helper function to search file contents recursively
function searchFileContents(
  dirPath: string,
  query: string,
  results: ContentMatch[],
  maxResults: number,
  depth: number = 0
): void {
  if (results.length >= maxResults || depth > 10) return;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const queryLower = query.toLowerCase();

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      // Skip hidden and common non-essential
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'build', '.git', '__pycache__', 'venv', '.venv', 'target', 'vendor'].includes(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recurse into directories
        searchFileContents(fullPath, query, results, maxResults, depth + 1);
      } else {
        // Check if it's a text file we can search
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext) && ext !== '') continue;

        try {
          const stats = fs.statSync(fullPath);
          // Skip files larger than 1MB
          if (stats.size > 1024 * 1024) continue;

          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const matches: ContentMatch['matches'] = [];

          for (let i = 0; i < lines.length && matches.length < 5; i++) {
            const line = lines[i];
            if (line.toLowerCase().includes(queryLower)) {
              matches.push({
                line: i + 1,
                content: line.slice(0, 200), // Truncate long lines
                context: {
                  before: i > 0 ? lines[i - 1].slice(0, 100) : '',
                  after: i < lines.length - 1 ? lines[i + 1].slice(0, 100) : '',
                },
              });
            }
          }

          if (matches.length > 0) {
            results.push({
              path: fullPath,
              name: entry.name,
              extension: ext,
              matches,
            });
          }
        } catch {
          // Skip files we can't read (binary, permission issues)
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

// GET /api/files/search-content - Search file contents
router.get('/search-content', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const query = req.query.q as string;
    const maxResults = parseInt(req.query.limit as string) || 30;

    if (!dirPath || !query) {
      res.status(400).json({ error: 'Missing path or query parameter' });
      return;
    }

    if (query.length < 2) {
      res.status(400).json({ error: 'Query must be at least 2 characters' });
      return;
    }

    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    const results: ContentMatch[] = [];
    searchFileContents(dirPath, query, results, maxResults);

    res.json({ results });
  } catch (err: any) {
    log.error(' Failed to search content:', err);
    res.status(500).json({ error: err.message });
  }
});

// Git file status type
interface GitFileStatus {
  path: string;
  name: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict';
  oldPath?: string; // For renamed files
}

// GET /api/files/git-status - Get git status for a directory
router.get('/git-status', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;

    if (!dirPath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    // Check if directory is a git repo and get the git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      res.json({ isGitRepo: false, files: [] });
      return;
    }

    // Check if a merge is in progress
    const mergeInProgress = fs.existsSync(path.join(gitRoot, '.git', 'MERGE_HEAD'));

    // Get git status with porcelain format for easy parsing
    let statusOutput = '';
    try {
      statusOutput = execSync('git status --porcelain -uall', {
        cwd: dirPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
    } catch (err) {
      log.error(' Git status failed:', err);
      res.json({ isGitRepo: true, files: [], error: 'Failed to get git status' });
      return;
    }

    const files: GitFileStatus[] = [];
    const lines = statusOutput.replace(/\n$/, '').split('\n').filter(Boolean);

    for (const line of lines) {
      // Porcelain v1 format: "XY PATH" or "XY ORIG -> NEW" for renames
      // X = index status (pos 0), Y = worktree status (pos 1),
      // space separator (pos 2), path starts at pos 3.
      // Paths are always relative to the git root.
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePart = line.substring(3);

      let status: GitFileStatus['status'];
      let filePath: string;
      let oldPath: string | undefined;

      // Check for rename (contains ' -> ')
      if (filePart.includes(' -> ')) {
        const [old, newPath] = filePart.split(' -> ');
        filePath = path.join(gitRoot, newPath);
        oldPath = path.join(gitRoot, old);
        status = 'renamed';
      } else {
        filePath = path.join(gitRoot, filePart);

        // Determine status from XY codes
        // Check for conflicts first (both modified, both added, both deleted, etc.)
        const conflictCodes = ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'];
        const xyCode = indexStatus + workTreeStatus;

        if (conflictCodes.includes(xyCode)) {
          status = 'conflict';
        } else if (indexStatus === '?' || workTreeStatus === '?') {
          status = 'untracked';
        } else if (indexStatus === 'A' || workTreeStatus === 'A') {
          status = 'added';
        } else if (indexStatus === 'D' || workTreeStatus === 'D') {
          status = 'deleted';
        } else if (indexStatus === 'R' || workTreeStatus === 'R') {
          status = 'renamed';
        } else {
          status = 'modified';
        }
      }

      files.push({
        path: filePath,
        name: path.basename(filePath),
        status,
        oldPath,
      });
    }

    // Sort by status priority: modified > added > deleted > untracked
    const statusOrder: Record<string, number> = { conflict: 0, modified: 1, added: 2, deleted: 3, renamed: 4, untracked: 5 };
    files.sort((a, b) => {
      const orderDiff = statusOrder[a.status] - statusOrder[b.status];
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });

    // Get branch name
    let branch = 'unknown';
    try {
      branch = execSync('git branch --show-current', {
        cwd: dirPath,
        encoding: 'utf-8',
      }).trim() || 'HEAD';
    } catch {
      // Ignore
    }

    res.json({
      isGitRepo: true,
      branch,
      files,
      mergeInProgress,
      counts: {
        conflict: files.filter(f => f.status === 'conflict').length,
        modified: files.filter(f => f.status === 'modified').length,
        added: files.filter(f => f.status === 'added').length,
        deleted: files.filter(f => f.status === 'deleted').length,
        untracked: files.filter(f => f.status === 'untracked').length,
        renamed: files.filter(f => f.status === 'renamed').length,
      },
    });
  } catch (err: any) {
    log.error(' Failed to get git status:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-add - Stage files with git add
router.post('/git-add', async (req: Request, res: Response) => {
  try {
    const { paths, directory } = req.body as { paths?: string[]; directory?: string };

    if (!directory || typeof directory !== 'string') {
      res.status(400).json({ error: 'Missing directory parameter' });
      return;
    }

    if (!path.isAbsolute(directory)) {
      res.status(400).json({ error: 'Directory must be absolute' });
      return;
    }

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      res.status(400).json({ error: 'Missing or empty paths array' });
      return;
    }

    // Validate all paths are absolute and don't contain traversal
    for (const p of paths) {
      if (!path.isAbsolute(p)) {
        res.status(400).json({ error: `Path must be absolute: ${p}` });
        return;
      }
      if (p.includes('..')) {
        res.status(400).json({ error: `Path traversal not allowed: ${p}` });
        return;
      }
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Convert absolute paths to relative paths from git root and validate they're within the repo
    const relativePaths: string[] = [];
    for (const p of paths) {
      const rel = path.relative(gitRoot, p);
      if (rel.startsWith('..')) {
        res.status(400).json({ error: `Path is outside the git repository: ${p}` });
        return;
      }
      relativePaths.push(rel);
    }

    // Stage the files
    const quotedPaths = relativePaths.map(p => `"${p}"`).join(' ');
    try {
      execSync(`git add ${quotedPaths}`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: any) {
      log.error(' Git add failed:', err);
      res.status(500).json({ error: `Git add failed: ${err.message}` });
      return;
    }

    res.json({ success: true, staged: paths.length });
  } catch (err: any) {
    log.error(' Failed to stage files:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-original - Get original file content from git HEAD
router.get('/git-original', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: path.dirname(filePath),
        encoding: 'utf-8',
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get relative path from git root
    const relativePath = path.relative(gitRoot, filePath);

    // Get original content from HEAD
    let originalContent: string;
    try {
      originalContent = execSync(`git show HEAD:"${relativePath}"`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    } catch (err: any) {
      // File might be new (not in HEAD)
      if (err.message?.includes('does not exist') || err.message?.includes('fatal')) {
        res.json({
          path: filePath,
          filename: path.basename(filePath),
          extension: path.extname(filePath).toLowerCase(),
          content: '',
          isNew: true,
        });
        return;
      }
      throw err;
    }

    res.json({
      path: filePath,
      filename: path.basename(filePath),
      extension: path.extname(filePath).toLowerCase(),
      content: originalContent,
      isNew: false,
    });
  } catch (err: any) {
    log.error(' Failed to get git original:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-diff - Get unified diff for a file
router.get('/git-diff', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: path.dirname(filePath),
        encoding: 'utf-8',
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get relative path from git root
    const relativePath = path.relative(gitRoot, filePath);

    // Get diff
    let diff: string;
    try {
      diff = execSync(`git diff HEAD -- "${relativePath}"`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      diff = '';
    }

    res.json({
      path: filePath,
      diff,
    });
  } catch (err: any) {
    log.error(' Failed to get git diff:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-branches - List all local and remote branches
router.get('/git-branches', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (!fs.existsSync(dirPath)) { res.status(404).json({ error: 'Directory not found' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: dirPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    let currentBranch = '';
    try {
      currentBranch = execSync('git branch --show-current', { cwd: gitRoot, encoding: 'utf-8' }).trim() || 'HEAD';
    } catch { currentBranch = 'HEAD'; }

    interface BranchInfo {
      name: string;
      isCurrent: boolean;
      isRemote: boolean;
      remote?: string;
      lastCommit?: string;
      lastMessage?: string;
    }
    const branches: BranchInfo[] = [];

    try {
      const localOutput = execSync(
        "git branch --format='%(refname:short)|%(objectname:short)|%(subject)' --sort=-committerdate",
        { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      );
      for (const line of localOutput.trim().split('\n').filter(Boolean)) {
        const [name, commit, ...msgParts] = line.split('|');
        branches.push({
          name: name.trim(),
          isCurrent: name.trim() === currentBranch,
          isRemote: false,
          lastCommit: commit?.trim(),
          lastMessage: msgParts.join('|').trim(),
        });
      }
    } catch (err) {
      log.error(' Failed to list local branches:', err);
    }

    try {
      const remoteOutput = execSync(
        "git branch -r --format='%(refname:short)|%(objectname:short)|%(subject)' --sort=-committerdate",
        { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      );
      for (const line of remoteOutput.trim().split('\n').filter(Boolean)) {
        const [name, commit, ...msgParts] = line.split('|');
        const trimmedName = name.trim();
        if (trimmedName.includes('/HEAD')) continue;
        const slashIndex = trimmedName.indexOf('/');
        const remote = slashIndex > -1 ? trimmedName.substring(0, slashIndex) : undefined;
        branches.push({
          name: trimmedName,
          isCurrent: false,
          isRemote: true,
          remote,
          lastCommit: commit?.trim(),
          lastMessage: msgParts.join('|').trim(),
        });
      }
    } catch {
      // No remote branches or not configured
    }

    let remotes: string[] = [];
    try {
      remotes = execSync('git remote', { cwd: gitRoot, encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    } catch { /* no remotes */ }

    res.json({ branches, currentBranch, remotes });
  } catch (err: any) {
    log.error(' Failed to list branches:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-checkout - Switch to a different branch
router.post('/git-checkout', async (req: Request, res: Response) => {
  try {
    const { directory, branch } = req.body as { directory?: string; branch?: string };
    if (!directory || !branch) { res.status(400).json({ error: 'Missing directory or branch parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }
    if (!/^[a-zA-Z0-9._\-\/]+$/.test(branch)) { res.status(400).json({ error: 'Invalid branch name' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const isRemote = branch.includes('/');
      if (isRemote) {
        const localName = branch.substring(branch.indexOf('/') + 1);
        try {
          execSync(`git rev-parse --verify "${localName}"`, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          execSync(`git checkout "${localName}"`, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        } catch {
          execSync(`git checkout -b "${localName}" "${branch}"`, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        }
        res.json({ success: true, branch: localName });
      } else {
        execSync(`git checkout "${branch}"`, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        res.json({ success: true, branch });
      }
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('Your local changes')) {
        res.status(409).json({ success: false, error: 'Uncommitted changes would be overwritten. Commit or stash first.' });
      } else if (stderr.includes('pathspec')) {
        res.status(404).json({ success: false, error: `Branch not found: ${branch}` });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to checkout branch:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-branch-create - Create a new branch and switch to it
router.post('/git-branch-create', async (req: Request, res: Response) => {
  try {
    const { directory, name, startPoint } = req.body as { directory?: string; name?: string; startPoint?: string };
    if (!directory || !name) { res.status(400).json({ error: 'Missing directory or name parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }
    if (!/^[a-zA-Z0-9._\-\/]+$/.test(name)) { res.status(400).json({ error: 'Invalid branch name. Use only letters, numbers, dots, hyphens, underscores, and slashes.' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const cmd = startPoint
        ? `git checkout -b "${name}" "${startPoint}"`
        : `git checkout -b "${name}"`;
      execSync(cmd, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      res.json({ success: true, branch: name });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('already exists')) {
        res.status(409).json({ success: false, error: `Branch "${name}" already exists.` });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to create branch:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-pull - Pull from remote
router.post('/git-pull', async (req: Request, res: Response) => {
  try {
    const { directory, remote, branch } = req.body as { directory?: string; remote?: string; branch?: string };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      let cmd = 'git pull';
      if (remote) cmd += ` "${remote}"`;
      if (branch) cmd += ` "${branch}"`;
      const output = execSync(cmd, { cwd: gitRoot, encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('CONFLICT')) {
        res.status(409).json({ success: false, error: 'Merge conflict detected during pull. Resolve conflicts manually.' });
      } else if (stderr.includes('ETIMEDOUT') || stderr.includes('Could not resolve')) {
        res.status(504).json({ success: false, error: 'Network error. Check your connection.' });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to pull:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-push - Push to remote
router.post('/git-push', async (req: Request, res: Response) => {
  try {
    const { directory, remote, branch, setUpstream } = req.body as { directory?: string; remote?: string; branch?: string; setUpstream?: boolean };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      let cmd = 'git push';
      if (setUpstream) cmd += ' -u';
      if (remote) cmd += ` "${remote}"`;
      if (branch) cmd += ` "${branch}"`;
      const output = execSync(cmd, { cwd: gitRoot, encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('rejected')) {
        res.status(409).json({ success: false, error: 'Push rejected. Pull first to integrate remote changes.' });
      } else if (stderr.includes('no upstream')) {
        res.status(400).json({ success: false, error: 'No upstream branch configured. Use "Set Upstream" option.' });
      } else if (stderr.includes('ETIMEDOUT') || stderr.includes('Could not resolve')) {
        res.status(504).json({ success: false, error: 'Network error. Check your connection.' });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to push:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-log-message - Get last commit message (for amend)
router.get('/git-log-message', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: dirPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const message = execSync('git log -1 --format=%B', { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      res.json({ message });
    } catch {
      res.json({ message: '' });
    }
  } catch (err: any) {
    log.error(' Failed to get log message:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-commit - Commit staged changes
router.post('/git-commit', async (req: Request, res: Response) => {
  try {
    const { directory, message, amend, paths } = req.body as {
      directory?: string;
      message?: string;
      amend?: boolean;
      paths?: string[];
    };

    if (!directory || typeof directory !== 'string') {
      res.status(400).json({ error: 'Missing directory parameter' });
      return;
    }
    if (!path.isAbsolute(directory)) {
      res.status(400).json({ error: 'Directory must be absolute' });
      return;
    }
    if (!message || !message.trim()) {
      res.status(400).json({ error: 'Commit message cannot be empty' });
      return;
    }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // If specific paths are provided, stage them first
    if (paths && Array.isArray(paths) && paths.length > 0) {
      const relativePaths: string[] = [];
      for (const p of paths) {
        if (!path.isAbsolute(p)) {
          res.status(400).json({ error: `Path must be absolute: ${p}` });
          return;
        }
        const rel = path.relative(gitRoot, p);
        if (rel.startsWith('..')) {
          res.status(400).json({ error: `Path is outside the git repository: ${p}` });
          return;
        }
        relativePaths.push(rel);
      }
      const quotedPaths = relativePaths.map(p => `"${p}"`).join(' ');
      try {
        execSync(`git add ${quotedPaths}`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      } catch (err: any) {
        res.status(500).json({ success: false, error: `Failed to stage files: ${err.message}` });
        return;
      }
    }

    // Build commit command - write message to a temp file to avoid shell escaping issues
    const tmpFile = path.join(gitRoot, '.git', 'TIDE_COMMIT_MSG');
    try {
      fs.writeFileSync(tmpFile, message, 'utf-8');
      let cmd = `git commit -F "${tmpFile}"`;
      if (amend) cmd = `git commit --amend -F "${tmpFile}"`;

      const output = execSync(cmd, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.stdout?.toString() || err.message || '';
      if (stderr.includes('nothing to commit') || stderr.includes('nothing added to commit')) {
        res.status(400).json({ success: false, error: 'Nothing to commit. Stage files first.' });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  } catch (err: any) {
    log.error(' Failed to commit:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-merge - Merge a branch into the current branch
router.post('/git-merge', async (req: Request, res: Response) => {
  try {
    const { directory, branch } = req.body as { directory?: string; branch?: string };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }
    if (!branch) { res.status(400).json({ error: 'Missing branch parameter' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const output = execSync(`git merge "${branch}"`, { cwd: gitRoot, encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || '';
      const stdout = err.stdout?.toString() || '';
      const combined = stdout + '\n' + stderr;

      if (combined.includes('CONFLICT') || combined.includes('Automatic merge failed')) {
        // Parse conflict file paths from output
        const conflicts: string[] = [];
        const conflictRegex = /CONFLICT \([^)]+\): Merge conflict in (.+)/g;
        let match;
        while ((match = conflictRegex.exec(combined)) !== null) {
          conflicts.push(path.join(gitRoot, match[1].trim()));
        }
        // Also check for "both modified" / "both added" patterns
        const bothRegex = /CONFLICT \([^)]+\):.+?(?:both modified|both added):\s*(.+)/g;
        while ((match = bothRegex.exec(combined)) !== null) {
          const conflictPath = path.join(gitRoot, match[1].trim());
          if (!conflicts.includes(conflictPath)) {
            conflicts.push(conflictPath);
          }
        }
        res.json({ success: false, output: combined.trim(), conflicts });
      } else if (combined.includes('not something we can merge') || combined.includes('not a valid')) {
        res.status(400).json({ success: false, error: `Branch '${branch}' not found` });
      } else if (combined.includes('uncommitted changes') || combined.includes('not possible because you have unmerged')) {
        res.status(409).json({ success: false, error: 'You have uncommitted changes. Commit or stash them first.' });
      } else {
        res.status(500).json({ success: false, error: (stderr || stdout).trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to merge:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-conflict-file - Get ours/theirs/merged versions of a conflict file
router.get('/git-conflict-file', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const filePath = req.query.file as string;
    if (!dirPath || !filePath) { res.status(400).json({ error: 'Missing path or file parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: dirPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get the relative path from git root
    const absFilePath = path.isAbsolute(filePath) ? filePath : path.join(gitRoot, filePath);
    const relPath = path.relative(gitRoot, absFilePath);

    // Read the three versions
    let ours = '';
    let theirs = '';
    let merged = '';

    try {
      ours = execSync(`git show ":2:${relPath}"`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      ours = ''; // File may not exist in ours (e.g., added by both)
    }

    try {
      theirs = execSync(`git show ":3:${relPath}"`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      theirs = ''; // File may not exist in theirs
    }

    try {
      merged = fs.readFileSync(absFilePath, 'utf-8');
    } catch {
      res.status(404).json({ error: 'Conflict file not found on disk' });
      return;
    }

    res.json({ ours, theirs, merged, filename: path.basename(absFilePath) });
  } catch (err: any) {
    log.error(' Failed to get conflict file:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-resolve-conflict - Write resolved content and stage the file
router.post('/git-resolve-conflict', async (req: Request, res: Response) => {
  try {
    const { directory, file, content } = req.body as { directory?: string; file?: string; content?: string };
    if (!directory || !file) { res.status(400).json({ error: 'Missing directory or file parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }
    if (content === undefined || content === null) { res.status(400).json({ error: 'Missing content parameter' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    const absFilePath = path.isAbsolute(file) ? file : path.join(gitRoot, file);
    const relPath = path.relative(gitRoot, absFilePath);

    if (relPath.startsWith('..')) {
      res.status(400).json({ error: 'File is outside the git repository' });
      return;
    }

    // Write the resolved content
    fs.writeFileSync(absFilePath, content, 'utf-8');

    // Stage the resolved file
    execSync(`git add "${relPath}"`, { cwd: gitRoot, encoding: 'utf-8' });

    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to resolve conflict:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-merge-continue - Complete the merge after all conflicts are resolved
router.post('/git-merge-continue', async (req: Request, res: Response) => {
  try {
    const { directory } = req.body as { directory?: string };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const output = execSync('git commit --no-edit', { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.stdout?.toString() || err.message || '';
      res.status(500).json({ success: false, error: stderr.trim() || err.message });
    }
  } catch (err: any) {
    log.error(' Failed to continue merge:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-merge-abort - Abort an in-progress merge
router.post('/git-merge-abort', async (req: Request, res: Response) => {
  try {
    const { directory } = req.body as { directory?: string };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const output = execSync('git merge --abort', { cwd: gitRoot, encoding: 'utf-8' });
      res.json({ success: true, output: (output || '').trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      res.status(500).json({ success: false, error: stderr.trim() || err.message });
    }
  } catch (err: any) {
    log.error(' Failed to abort merge:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-branch-compare - Compare two branches and return changed files
router.get('/git-branch-compare', async (req: Request, res: Response) => {
  try {
    const directory = req.query.directory as string;
    const branch = req.query.branch as string;

    if (!directory) {
      res.status(400).json({ error: 'Missing directory parameter' });
      return;
    }

    if (!path.isAbsolute(directory)) {
      res.status(400).json({ error: 'Directory must be absolute' });
      return;
    }

    if (!branch) {
      res.status(400).json({ error: 'Missing branch parameter' });
      return;
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get current branch
    let currentBranch: string;
    try {
      currentBranch = execSync('git branch --show-current', {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      currentBranch = 'HEAD';
    }

    // Get diff between branches (three-dot diff: changes since branches diverged)
    let diffOutput: string;
    try {
      diffOutput = execSync(`git diff --name-status ${branch}...HEAD`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      res.status(400).json({ error: stderr.trim() || 'Failed to compare branches' });
      return;
    }

    const counts = { modified: 0, added: 0, deleted: 0, untracked: 0, renamed: 0, conflict: 0 };
    const files: Array<{ path: string; name: string; status: string; oldPath?: string }> = [];

    const lines = diffOutput.trim().split('\n').filter((l: string) => l.trim());
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;

      const statusCode = parts[0].trim();
      let status: string;
      let filePath: string;
      let oldPath: string | undefined;

      if (statusCode === 'M') {
        status = 'modified';
        filePath = parts[1];
      } else if (statusCode === 'A') {
        status = 'added';
        filePath = parts[1];
      } else if (statusCode === 'D') {
        status = 'deleted';
        filePath = parts[1];
      } else if (statusCode.startsWith('R')) {
        status = 'renamed';
        oldPath = path.join(gitRoot, parts[1]);
        filePath = parts[2] || parts[1];
      } else if (statusCode.startsWith('C')) {
        status = 'modified';
        filePath = parts[2] || parts[1];
      } else {
        status = 'modified';
        filePath = parts[1];
      }

      const absolutePath = path.join(gitRoot, filePath);
      const entry: { path: string; name: string; status: string; oldPath?: string } = {
        path: absolutePath,
        name: path.basename(absolutePath),
        status,
      };
      if (oldPath) {
        entry.oldPath = oldPath;
      }
      files.push(entry);

      if (status === 'renamed') {
        counts.renamed++;
      } else if (status in counts) {
        (counts as any)[status]++;
      }
    }

    res.json({ files, counts, baseBranch: branch, currentBranch });
  } catch (err: any) {
    log.error(' Failed to compare branches:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-show - Get file content at a specific git ref
router.get('/git-show', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    const ref = req.query.ref as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!ref) {
      res.status(400).json({ error: 'Missing ref parameter' });
      return;
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: path.dirname(filePath),
        encoding: 'utf-8',
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get relative path from git root
    const relativePath = path.relative(gitRoot, filePath);

    // Get file content at the specified ref
    let content: string;
    try {
      content = execSync(`git show ${ref}:"${relativePath}"`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    } catch (err: any) {
      // File doesn't exist at the given ref
      if (err.message?.includes('does not exist') || err.message?.includes('fatal')) {
        res.json({
          path: filePath,
          filename: path.basename(filePath),
          extension: path.extname(filePath).toLowerCase(),
          content: '',
          notFound: true,
        });
        return;
      }
      throw err;
    }

    res.json({
      path: filePath,
      filename: path.basename(filePath),
      extension: path.extname(filePath).toLowerCase(),
      content,
      notFound: false,
    });
  } catch (err: any) {
    log.error(' Failed to get file at ref:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/open-in-editor - Open file in specified or default editor
router.post('/open-in-editor', async (req: Request, res: Response) => {
  try {
    const { path: filePath, editorCommand } = req.body as { path?: string; editorCommand?: string };
    if (!filePath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(filePath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (filePath.includes('..')) { res.status(400).json({ error: 'Path traversal not allowed' }); return; }
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }

    const platform = process.platform;
    let cmd: string;
    let args: string[];

    // If custom editor command is provided, use it
    if (editorCommand && editorCommand.trim()) {
      // Parse the command string to separate command and arguments
      const parts = editorCommand.trim().split(/\s+/);
      cmd = parts[0];
      args = [...parts.slice(1), filePath];
    } else {
      // Use platform default
      if (platform === 'linux') {
        cmd = 'xdg-open';
        args = [filePath];
      } else if (platform === 'darwin') {
        cmd = 'open';
        args = [filePath];
      } else if (platform === 'win32') {
        cmd = 'cmd';
        args = ['/c', 'start', '', filePath];
      } else {
        res.status(500).json({ error: `Unsupported platform: ${platform}` });
        return;
      }
    }

    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();

    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to open in editor:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/by-path - Load and return a file by its path (for clipboard paste)
router.post('/by-path', async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.body as { path?: string };

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    // Expand ~ to home directory
    let expandedPath = filePath;
    if (filePath.startsWith('~')) {
      expandedPath = path.join(os.homedir(), filePath.slice(1));
    }

    // Security: ensure path is absolute
    if (!path.isAbsolute(expandedPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(expandedPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const stats = fs.statSync(expandedPath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory' });
      return;
    }

    // Limit file size to 50MB for binary files
    if (stats.size > 50 * 1024 * 1024) {
      res.status(400).json({ error: 'File too large (max 50MB)' });
      return;
    }

    const extension = path.extname(expandedPath).toLowerCase();
    const _filename = path.basename(expandedPath);

    // Determine if it's an image
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];
    const _isImage = imageExtensions.includes(extension);

    // Set content type based on extension
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.wav': 'audio/wav',
    };

    const contentType = mimeTypes[extension] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const stream = fs.createReadStream(expandedPath);
    stream.pipe(res);

    stream.on('error', (err) => {
      log.error(' Failed to stream file:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read file' });
      }
    });
  } catch (err: any) {
    log.error(' Failed to load file by path:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/upload - Upload a file to temp directory
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const contentType = req.headers['content-type'] || '';
    let filename = req.headers['x-filename'] as string;
    const isImage = contentType.startsWith('image/');

    // Decode filename if it's URL-encoded (handles special characters like –, é, etc.)
    if (filename) {
      try {
        filename = decodeURIComponent(filename);
      } catch {
        // If decoding fails, use as-is
      }
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);

    let finalFilename: string;
    let extension: string;

    if (filename) {
      // Use provided filename with unique prefix
      extension = path.extname(filename);
      const baseName = path.basename(filename, extension);
      finalFilename = `${baseName}-${randomId}${extension}`;
    } else if (isImage) {
      // Determine extension from content type
      const extMap: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
      };
      extension = extMap[contentType] || '.png';
      finalFilename = `image-${timestamp}-${randomId}${extension}`;
    } else {
      // Default to txt
      extension = '.txt';
      finalFilename = `file-${timestamp}-${randomId}${extension}`;
    }

    const filePath = path.join(TEMP_DIR, finalFilename);

    // Collect body data
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);

      // Write file
      fs.writeFileSync(filePath, buffer);

      log.log(` Uploaded: ${filePath} (${buffer.length} bytes)`);

      res.json({
        success: true,
        path: `/uploads/${finalFilename}`,
        absolutePath: filePath,
        filename: finalFilename,
        size: buffer.length,
        isImage,
        tempDir: TEMP_DIR,
      });
    });

    req.on('error', (err) => {
      log.error(' Upload error:', err);
      res.status(500).json({ error: 'Upload failed' });
    });
  } catch (err: any) {
    log.error(' Failed to upload file:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/temp-dir - Get the temp directory path
router.get('/temp-dir', (_req: Request, res: Response) => {
  res.json({ path: TEMP_DIR });
});

// GET /api/files/autocomplete - Autocomplete paths for folder/file input
router.get('/autocomplete', async (req: Request, res: Response) => {
  try {
    const inputPath = req.query.path as string;
    const directoriesOnly = req.query.dirs === 'true';
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (!inputPath) {
      // Return common starting points
      const homedir = os.homedir();
      const suggestions = [
        { name: '~', path: homedir, isDirectory: true },
        { name: '/', path: '/', isDirectory: true },
      ];
      res.json({ suggestions, basePath: '', partial: '' });
      return;
    }

    // Expand ~ to home directory
    let expandedPath = inputPath;
    if (inputPath.startsWith('~')) {
      expandedPath = path.join(os.homedir(), inputPath.slice(1));
    }

    // Determine base directory and partial name being typed
    let basePath: string;
    let partial: string;

    if (expandedPath.endsWith('/') || expandedPath === '/') {
      // User ended with / - list contents of that directory
      basePath = expandedPath === '/' ? '/' : expandedPath.slice(0, -1);
      partial = '';
    } else {
      // User is typing a partial name - get parent directory
      basePath = path.dirname(expandedPath);
      partial = path.basename(expandedPath).toLowerCase();
    }

    // Check if base path exists
    if (!fs.existsSync(basePath)) {
      // Try to find the closest existing parent
      let checkPath = basePath;
      while (checkPath !== '/' && !fs.existsSync(checkPath)) {
        checkPath = path.dirname(checkPath);
      }
      res.json({ suggestions: [], basePath: checkPath, partial, error: 'Path not found' });
      return;
    }

    // Check if it's a directory
    const stats = fs.statSync(basePath);
    if (!stats.isDirectory()) {
      res.json({ suggestions: [], basePath, partial, error: 'Not a directory' });
      return;
    }

    // Read directory entries
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    const suggestions: Array<{ name: string; path: string; isDirectory: boolean }> = [];

    for (const entry of entries) {
      // Skip hidden files unless user is explicitly typing a dot
      if (entry.name.startsWith('.') && !partial.startsWith('.')) continue;

      // Filter by partial match
      if (partial && !entry.name.toLowerCase().startsWith(partial)) continue;

      // Filter by directories only if requested
      if (directoriesOnly && !entry.isDirectory()) continue;

      const fullPath = path.join(basePath, entry.name);

      suggestions.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
      });

      if (suggestions.length >= limit) break;
    }

    // Sort: directories first, then alphabetically
    suggestions.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json({ suggestions, basePath, partial });
  } catch (err: any) {
    log.error(' Failed to autocomplete path:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/files/temp/:filename - Delete a temp file
router.delete('/temp/:filename', (req: Request<{ filename: string }>, res: Response) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(TEMP_DIR, filename);

    // Security: ensure file is in temp dir
    if (!filePath.startsWith(TEMP_DIR)) {
      res.status(403).json({ error: 'Invalid path' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to delete temp file:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
