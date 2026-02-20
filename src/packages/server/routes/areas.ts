/**
 * Area Routes
 * REST API endpoints for drawing/project areas
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { loadAreas, ensureAreaLogosDir, getAreaLogosDir, deleteAreaLogo } from '../data/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Areas');
const router = Router();

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
]);

// Max logo file size: 5MB
const MAX_LOGO_SIZE = 5 * 1024 * 1024;

// GET /api/areas - List all drawing areas
router.get('/', (_req: Request, res: Response) => {
  const areas = loadAreas();
  res.json(areas);
});

// GET /api/areas/logos/:filename - Serve a logo image
router.get('/logos/:filename', (req: Request, res: Response) => {
  try {
    ensureAreaLogosDir();
    const filename = path.basename(String(req.params.filename)); // sanitize
    const filePath = path.join(getAreaLogosDir(), filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Logo not found' });
      return;
    }

    // Determine content type from extension
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year - filenames are unique
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    log.error(' Failed to serve logo:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/areas/:areaId/logo - Upload a logo for a zone
router.post('/:areaId/logo', (req: Request, res: Response) => {
  try {
    ensureAreaLogosDir();
    const { areaId } = req.params;
    const contentType = req.headers['content-type'] || '';

    // Validate image type
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      res.status(400).json({ error: `Invalid image type: ${contentType}. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}` });
      return;
    }

    // Delete existing logo for this area if any
    const areas = loadAreas();
    const area = areas.find(a => a.id === areaId);
    if (area?.logo?.filename) {
      deleteAreaLogo(area.logo.filename);
    }

    // Determine extension from content type
    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp',
    };
    const ext = extMap[contentType] || '.png';
    const randomId = crypto.randomBytes(4).toString('hex');
    const filename = `${areaId}-${randomId}${ext}`;
    const filePath = path.join(getAreaLogosDir(), filename);

    // Collect body data
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_LOGO_SIZE) {
        res.status(413).json({ error: `Logo too large. Max size: ${MAX_LOGO_SIZE / 1024 / 1024}MB` });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (res.headersSent) return; // Already sent 413
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buffer);
      log.log(` Uploaded area logo: ${filename} (${buffer.length} bytes)`);

      res.json({
        success: true,
        filename,
        url: `/api/areas/logos/${filename}`,
        size: buffer.length,
      });
    });

    req.on('error', (err) => {
      log.error(' Logo upload error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Upload failed' });
      }
    });
  } catch (err: any) {
    log.error(' Failed to upload logo:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/areas/:areaId/logo - Remove a logo from a zone
router.delete('/:areaId/logo', (_req: Request, res: Response) => {
  try {
    const { areaId } = _req.params;
    const areas = loadAreas();
    const area = areas.find(a => a.id === areaId);

    if (area?.logo?.filename) {
      deleteAreaLogo(area.logo.filename);
      log.log(` Removed logo for area ${areaId}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to delete logo:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
