/**
 * Files Routes
 * REST API endpoints for file operations
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
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
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
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

    // Check if directory is a git repo
    try {
      execSync('git rev-parse --git-dir', { cwd: dirPath, stdio: 'pipe' });
    } catch {
      res.json({ isGitRepo: false, files: [] });
      return;
    }

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
    const lines = statusOutput.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      // Porcelain format: XY PATH or XY ORIG_PATH -> NEW_PATH for renames
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePart = line.slice(3);

      let status: GitFileStatus['status'];
      let filePath: string;
      let oldPath: string | undefined;

      // Check for rename (contains ' -> ')
      if (filePart.includes(' -> ')) {
        const [old, newPath] = filePart.split(' -> ');
        filePath = path.join(dirPath, newPath);
        oldPath = path.join(dirPath, old);
        status = 'renamed';
      } else {
        filePath = path.join(dirPath, filePart);

        // Determine status from XY codes
        if (indexStatus === '?' || workTreeStatus === '?') {
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
    const statusOrder = { modified: 0, added: 1, deleted: 2, renamed: 3, untracked: 4 };
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
      counts: {
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
    } catch (err: any) {
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

// POST /api/files/upload - Upload a file to temp directory
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const contentType = req.headers['content-type'] || '';
    const filename = req.headers['x-filename'] as string;
    const isImage = contentType.startsWith('image/');

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
