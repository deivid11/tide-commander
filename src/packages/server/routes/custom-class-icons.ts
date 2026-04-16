/**
 * Custom Class Icon Routes
 * REST API endpoints for uploading, serving, and deleting custom class PNG icons
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ensureClassIconsDir, getClassIconsDir, deleteClassIcon } from '../data/index.js';
import { getCustomClass, updateCustomClass } from '../services/custom-class-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ClassIcons');
const router = Router();

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp',
]);

// Max icon file size: 2MB
const MAX_ICON_SIZE = 2 * 1024 * 1024;

// Extension map from content type
const EXT_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

// MIME map from file extension
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// GET /api/custom-class-icons/:filename - Serve an icon file
router.get('/:filename', (req: Request, res: Response) => {
  try {
    ensureClassIconsDir();
    const filename = path.basename(String(req.params.filename)); // sanitize
    const filePath = path.join(getClassIconsDir(), filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Icon not found' });
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year - filenames are unique per class
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    log.error(' Failed to serve class icon:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/custom-class-icons/:classId - Upload an icon for a custom class
router.post('/:classId', (req: Request, res: Response) => {
  try {
    ensureClassIconsDir();
    const classId = String(req.params.classId);
    const contentType = req.headers['content-type'] || '';

    // Validate class exists
    const customClass = getCustomClass(classId);
    if (!customClass) {
      res.status(404).json({ error: `Custom class not found: ${classId}` });
      return;
    }

    // Validate image type
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      res.status(400).json({ error: `Invalid image type: ${contentType}. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}` });
      return;
    }

    // Delete existing icon for this class if any
    if (customClass.iconPath) {
      deleteClassIcon(customClass.iconPath);
    }

    // Determine extension and filename
    const ext = EXT_MAP[contentType] || '.png';
    const filename = `${classId}${ext}`;
    const filePath = path.join(getClassIconsDir(), filename);

    // Collect body data
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_ICON_SIZE) {
        res.status(413).json({ error: `Icon too large. Max size: ${MAX_ICON_SIZE / 1024 / 1024}MB` });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (res.headersSent) return; // Already sent 413
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buffer);
      log.log(` Uploaded class icon: ${filename} (${buffer.length} bytes)`);

      // Update the class's iconPath field
      updateCustomClass(classId, { iconPath: filename });

      res.json({
        success: true,
        filename,
        url: `/api/custom-class-icons/${filename}`,
        size: buffer.length,
      });
    });

    req.on('error', (err) => {
      log.error(' Icon upload error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Upload failed' });
      }
    });
  } catch (err: any) {
    log.error(' Failed to upload class icon:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/custom-class-icons/:classId - Delete the icon for a custom class
router.delete('/:classId', (req: Request, res: Response) => {
  try {
    const classId = String(req.params.classId);

    const customClass = getCustomClass(classId);
    if (!customClass) {
      res.status(404).json({ error: `Custom class not found: ${classId}` });
      return;
    }

    if (customClass.iconPath) {
      deleteClassIcon(customClass.iconPath);
      updateCustomClass(classId, { iconPath: undefined });
      log.log(` Removed icon for class ${classId}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to delete class icon:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
