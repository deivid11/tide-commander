/**
 * Headless CAD jobs backed by FreeCADCmd. The global /api auth middleware
 * protects these routes; model scripts and artifacts are confined to the
 * workspace supplied in each request.
 */

import { Router, type Request, type Response } from 'express';
import { cadService, CadRequestError } from '../services/cad-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CADRoute');
const router = Router();

router.get('/capabilities', async (req: Request, res: Response) => {
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  const capabilities = await cadService.getCapabilities(force);
  res.status(capabilities.available ? 200 : 503).json(capabilities);
});

router.get('/jobs', (req: Request, res: Response) => {
  const requestedLimit = Number(req.query.limit || 20);
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 20;
  res.json({ jobs: cadService.listJobs(limit) });
});

router.post('/jobs', async (req: Request, res: Response) => {
  try {
    const job = await cadService.createJob(req.body);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof CadRequestError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    log.error('Failed to create CAD job:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/jobs/:id', (req: Request, res: Response) => {
  const job = cadService.getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: `CAD job not found: ${req.params.id}` });
    return;
  }
  res.json(job);
});

router.delete('/jobs/:id', (req: Request, res: Response) => {
  const existing = cadService.getJob(String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: `CAD job not found: ${req.params.id}` });
    return;
  }
  const job = cadService.cancelJob(existing.id);
  if (!job) {
    res.status(409).json({ error: `CAD job is already ${existing.status}`, job: existing });
    return;
  }
  res.json(job);
});

export default router;
