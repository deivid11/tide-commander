/**
 * Custom Models Routes
 * REST API endpoints for custom 3D model operations
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';
import {
  saveCustomModel,
  hasCustomModel,
  getCustomModelPath,
  getCustomClass,
  updateCustomClass,
} from '../services/custom-class-service.js';

const log = logger.files;
const router = Router();

// Maximum file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * POST /api/custom-models/upload/:classId
 * Upload a custom GLB model for a class
 *
 * Headers:
 *   Content-Type: application/octet-stream or model/gltf-binary
 *   X-Filename: optional original filename
 *
 * Body: Raw GLB file data
 *
 * Returns: { success: true, path: string, size: number }
 */
router.post('/upload/:classId', async (req: Request<{ classId: string }>, res: Response) => {
  try {
    const { classId } = req.params;

    if (!classId) {
      res.status(400).json({ error: 'Missing classId parameter' });
      return;
    }

    // Verify the class exists
    const customClass = getCustomClass(classId);
    if (!customClass) {
      res.status(404).json({ error: 'Custom class not found' });
      return;
    }

    // Collect body data
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE) {
        res.status(413).json({ error: 'File too large (max 50MB)' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (res.headersSent) return; // Already responded with error

      const buffer = Buffer.concat(chunks);

      // Validate GLB magic number (glTF binary starts with 'glTF')
      if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'glTF') {
        res.status(400).json({ error: 'Invalid GLB file format' });
        return;
      }

      // Save the model
      const modelPath = saveCustomModel(classId, buffer);

      // Update the class with the custom model path
      updateCustomClass(classId, {
        customModelPath: modelPath,
        model: undefined, // Clear built-in model selection
      });

      log.log(`Uploaded custom model for class ${classId} (${buffer.length} bytes)`);

      res.json({
        success: true,
        path: modelPath,
        size: buffer.length,
      });
    });

    req.on('error', (err) => {
      log.error('Model upload error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Upload failed' });
      }
    });
  } catch (err: any) {
    log.error('Failed to upload custom model:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/custom-models/:classId
 * Serve a custom model file
 *
 * Returns: GLB file binary data
 */
router.get('/:classId', async (req: Request<{ classId: string }>, res: Response) => {
  try {
    const { classId } = req.params;

    if (!classId) {
      res.status(400).json({ error: 'Missing classId parameter' });
      return;
    }

    const modelPath = getCustomModelPath(classId);
    if (!modelPath) {
      res.status(404).json({ error: 'Custom model not found' });
      return;
    }

    const stats = fs.statSync(modelPath);

    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    const stream = fs.createReadStream(modelPath);
    stream.pipe(res);
  } catch (err: any) {
    log.error('Failed to serve custom model:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/custom-models/:classId
 * Delete a custom model and revert class to default model
 */
router.delete('/:classId', async (req: Request<{ classId: string }>, res: Response) => {
  try {
    const { classId } = req.params;

    if (!classId) {
      res.status(400).json({ error: 'Missing classId parameter' });
      return;
    }

    const customClass = getCustomClass(classId);
    if (!customClass) {
      res.status(404).json({ error: 'Custom class not found' });
      return;
    }

    const modelPath = getCustomModelPath(classId);
    if (modelPath && fs.existsSync(modelPath)) {
      fs.unlinkSync(modelPath);
      log.log(`Deleted custom model for class ${classId}`);
    }

    // Update class to use default model
    updateCustomClass(classId, {
      customModelPath: undefined,
      model: 'character-male-a.glb', // Revert to default
      animationMapping: undefined,
      availableAnimations: undefined,
      modelScale: undefined,
    });

    res.json({ success: true });
  } catch (err: any) {
    log.error('Failed to delete custom model:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/custom-models/:classId/exists
 * Check if a custom model exists for a class
 */
router.get('/:classId/exists', async (req: Request<{ classId: string }>, res: Response) => {
  try {
    const { classId } = req.params;

    if (!classId) {
      res.status(400).json({ error: 'Missing classId parameter' });
      return;
    }

    const exists = hasCustomModel(classId);
    res.json({ exists, classId });
  } catch (err: any) {
    log.error('Failed to check custom model:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
