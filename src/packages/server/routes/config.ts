/**
 * Config Export/Import Routes
 * Handles exporting and importing Tide Commander configuration
 */

import { Router, Request, Response } from 'express';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import os from 'os';
import archiver from 'archiver';
import { Extract } from 'unzip-stream';
import { createLogger } from '../utils/index.js';

const log = createLogger('ConfigRoutes');
const router = Router();

// Config directories
const HOME_CONFIG_DIR = join(os.homedir(), '.tide-commander');
const DATA_CONFIG_DIR = join(os.homedir(), '.local', 'share', 'tide-commander');

// Define exportable config categories
export interface ConfigCategory {
  id: string;
  name: string;
  description: string;
  files: string[]; // Relative paths within their source directory
  sourceDir: 'home' | 'data';
}

const CONFIG_CATEGORIES: ConfigCategory[] = [
  {
    id: 'agents',
    name: 'Agents',
    description: 'Agent positions, names, and settings',
    files: ['agents.json'],
    sourceDir: 'data',
  },
  {
    id: 'areas',
    name: 'Areas',
    description: 'Drawing areas and zones',
    files: ['areas.json'],
    sourceDir: 'data',
  },
  {
    id: 'buildings',
    name: 'Buildings',
    description: 'Building configurations and PM2 settings',
    files: ['buildings.json'],
    sourceDir: 'data',
  },
  {
    id: 'skills',
    name: 'Skills',
    description: 'Custom skills and their assignments',
    files: ['skills.json'],
    sourceDir: 'data',
  },
  {
    id: 'custom-classes',
    name: 'Custom Agent Classes',
    description: 'Custom agent class definitions and instructions',
    files: ['custom-agent-classes.json'],
    sourceDir: 'data',
  },
  {
    id: 'class-instructions',
    name: 'Class Instructions',
    description: 'Markdown instruction files for custom classes',
    files: ['class-instructions/*'],
    sourceDir: 'home',
  },
  {
    id: 'prompts',
    name: 'Agent Prompts',
    description: 'Individual agent prompt files',
    files: ['prompts/*'],
    sourceDir: 'home',
  },
  {
    id: 'custom-models',
    name: 'Custom 3D Models',
    description: 'GLB model files for custom agent classes',
    files: ['custom-models/*'],
    sourceDir: 'home',
  },
  {
    id: 'hooks',
    name: 'Hooks',
    description: 'Hook scripts and settings',
    files: ['hooks/*', 'hook-settings.json'],
    sourceDir: 'home',
  },
  {
    id: 'permissions',
    name: 'Remembered Permissions',
    description: 'Saved permission decisions',
    files: ['remembered-permissions.json'],
    sourceDir: 'home',
  },
  {
    id: 'secrets',
    name: 'Secrets',
    description: 'Encrypted secrets (keys not included)',
    files: ['secrets.json'],
    sourceDir: 'data',
  },
];

/**
 * Get list of available config categories
 */
router.get('/categories', (_req: Request, res: Response) => {
  const categories = CONFIG_CATEGORIES.map(cat => ({
    id: cat.id,
    name: cat.name,
    description: cat.description,
  }));
  res.json(categories);
});

/**
 * Helper to get files matching a pattern
 */
function getFilesForPattern(baseDir: string, pattern: string): string[] {
  const files: string[] = [];

  if (pattern.endsWith('/*')) {
    // Directory pattern - get all files in directory
    const dirName = pattern.slice(0, -2);
    const dirPath = join(baseDir, dirName);

    if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
      const entries = readdirSync(dirPath);
      for (const entry of entries) {
        const entryPath = join(dirPath, entry);
        if (statSync(entryPath).isFile()) {
          files.push(join(dirName, entry));
        }
      }
    }
  } else {
    // Single file pattern
    const filePath = join(baseDir, pattern);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      files.push(pattern);
    }
  }

  return files;
}

/**
 * Export selected config categories as a ZIP file
 * GET /api/config/export?categories=agents,buildings,skills
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const categoriesParam = req.query.categories as string;
    const selectedIds = categoriesParam ? categoriesParam.split(',') : CONFIG_CATEGORIES.map(c => c.id);

    // Validate categories
    const selectedCategories = CONFIG_CATEGORIES.filter(c => selectedIds.includes(c.id));
    if (selectedCategories.length === 0) {
      res.status(400).json({ error: 'No valid categories selected' });
      return;
    }

    log.log(`Exporting config categories: ${selectedCategories.map(c => c.id).join(', ')}`);

    // Set response headers for ZIP download
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `tide-commander-config-${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      log.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive' });
      }
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add manifest file
    const manifest = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      categories: selectedCategories.map(c => c.id),
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Add files for each selected category
    for (const category of selectedCategories) {
      const baseDir = category.sourceDir === 'home' ? HOME_CONFIG_DIR : DATA_CONFIG_DIR;

      for (const pattern of category.files) {
        const files = getFilesForPattern(baseDir, pattern);

        for (const file of files) {
          const filePath = join(baseDir, file);
          const archivePath = join(category.sourceDir, file);

          archive.file(filePath, { name: archivePath });
        }
      }
    }

    await archive.finalize();
    log.log(`Config export completed: ${filename}`);
  } catch (error: any) {
    log.error('Export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * Preview what's in an uploaded config ZIP
 * POST /api/config/preview (multipart/form-data with 'file' field)
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Create temp directory for extraction
    const tempDir = join(os.tmpdir(), `tide-config-preview-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      // Write buffer to temp file and extract
      const tempZip = join(tempDir, 'upload.zip');
      await writeFile(tempZip, req.body);

      // Extract ZIP
      await new Promise<void>((resolve, reject) => {
        createReadStream(tempZip)
          .pipe(Extract({ path: tempDir }))
          .on('close', resolve)
          .on('error', reject);
      });

      // Read manifest
      const manifestPath = join(tempDir, 'manifest.json');
      if (!existsSync(manifestPath)) {
        res.status(400).json({ error: 'Invalid config file: missing manifest.json' });
        return;
      }

      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

      // Scan for available categories
      const availableCategories: { id: string; name: string; description: string; fileCount: number }[] = [];

      for (const category of CONFIG_CATEGORIES) {
        if (manifest.categories?.includes(category.id)) {
          const baseDir = join(tempDir, category.sourceDir);
          let fileCount = 0;

          for (const pattern of category.files) {
            const files = getFilesForPattern(baseDir, pattern);
            fileCount += files.length;
          }

          if (fileCount > 0) {
            availableCategories.push({
              id: category.id,
              name: category.name,
              description: category.description,
              fileCount,
            });
          }
        }
      }

      res.json({
        version: manifest.version,
        exportedAt: manifest.exportedAt,
        categories: availableCategories,
      });
    } finally {
      // Cleanup temp directory
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    log.error('Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Import config from uploaded ZIP
 * POST /api/config/import?categories=agents,buildings (multipart/form-data with 'file' field)
 */
router.post('/import', async (req: Request, res: Response) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const categoriesParam = req.query.categories as string;
    if (!categoriesParam) {
      res.status(400).json({ error: 'No categories specified' });
      return;
    }

    const selectedIds = categoriesParam.split(',');
    const selectedCategories = CONFIG_CATEGORIES.filter(c => selectedIds.includes(c.id));

    if (selectedCategories.length === 0) {
      res.status(400).json({ error: 'No valid categories selected' });
      return;
    }

    log.log(`Importing config categories: ${selectedCategories.map(c => c.id).join(', ')}`);

    // Create temp directory for extraction
    const tempDir = join(os.tmpdir(), `tide-config-import-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      // Write buffer to temp file and extract
      const tempZip = join(tempDir, 'upload.zip');
      await writeFile(tempZip, req.body);

      // Extract ZIP
      await new Promise<void>((resolve, reject) => {
        createReadStream(tempZip)
          .pipe(Extract({ path: tempDir }))
          .on('close', resolve)
          .on('error', reject);
      });

      // Verify manifest
      const manifestPath = join(tempDir, 'manifest.json');
      if (!existsSync(manifestPath)) {
        res.status(400).json({ error: 'Invalid config file: missing manifest.json' });
        return;
      }

      const imported: { category: string; files: string[] }[] = [];

      // Import each selected category
      for (const category of selectedCategories) {
        const sourceBaseDir = join(tempDir, category.sourceDir);
        const targetBaseDir = category.sourceDir === 'home' ? HOME_CONFIG_DIR : DATA_CONFIG_DIR;
        const importedFiles: string[] = [];

        for (const pattern of category.files) {
          const files = getFilesForPattern(sourceBaseDir, pattern);

          for (const file of files) {
            const sourcePath = join(sourceBaseDir, file);
            const targetPath = join(targetBaseDir, file);

            // Ensure target directory exists
            const targetDir = dirname(targetPath);
            if (!existsSync(targetDir)) {
              await mkdir(targetDir, { recursive: true });
            }

            // Copy file
            const content = await readFile(sourcePath);
            await writeFile(targetPath, content);
            importedFiles.push(file);
          }
        }

        if (importedFiles.length > 0) {
          imported.push({ category: category.id, files: importedFiles });
        }
      }

      log.log(`Config import completed: ${imported.map(i => `${i.category}(${i.files.length})`).join(', ')}`);

      res.json({
        success: true,
        imported,
        message: 'Config imported successfully. Restart Tide Commander to apply changes.',
      });
    } finally {
      // Cleanup temp directory
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    log.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
