/**
 * Area Routes
 * REST API endpoints for drawing/project areas
 */

import { Router, Request, Response } from 'express';
import { loadAreas } from '../data/index.js';

const router = Router();

// GET /api/areas - List all drawing areas
router.get('/', (_req: Request, res: Response) => {
  const areas = loadAreas();
  res.json(areas);
});

export default router;
