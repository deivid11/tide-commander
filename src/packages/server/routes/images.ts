/**
 * Image Generation Routes
 *
 * REST API in front of the OpenAI Images API: an agent POSTs a prompt and gets
 * back the absolute paths of the files that were written. Generation is
 * synchronous — a single request takes seconds, so there is no runId/WebSocket
 * plumbing (same call shape as the .http runner).
 */

import { Router, Request, Response } from 'express';
import { imageService } from '../services/index.js';
import { createLogger } from '../utils/index.js';
import type { ImageGenerationRequestBody } from '../../shared/types.js';

const log = createLogger('ImagesRoute');

const router = Router();

/**
 * GET /api/images/status - Is an OpenAI key configured, and where from?
 * Never returns the key itself, only a masked fingerprint.
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json(imageService.getStatus());
});

/**
 * POST /api/images/generate - Generate image(s) from a prompt and write them
 * to disk. Body: ImageGenerationRequestBody. Responds with the full
 * ImageGenerationResult; a model/API failure comes back as 200 with
 * `ok: false` so callers report it as a result rather than a transport error.
 */
router.post('/generate', async (req: Request, res: Response) => {
  const body = req.body as Partial<ImageGenerationRequestBody>;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'Missing required field: prompt' });
    return;
  }
  if (body.outputDir !== undefined && typeof body.outputDir !== 'string') {
    res.status(400).json({ error: 'outputDir must be a string' });
    return;
  }

  try {
    const result = await imageService.generateImages({ ...body, prompt });
    if (!result.ok) {
      log.warn(`Image generation failed: ${result.error}`);
    }
    res.json(result);
  } catch (err) {
    // Only argument/containment problems reach here — the service turns every
    // runtime failure into an ok:false result.
    const message = err instanceof Error ? err.message : 'Failed to generate image';
    log.warn(`Rejected image request: ${message}`);
    res.status(400).json({ error: message });
  }
});

export default router;
