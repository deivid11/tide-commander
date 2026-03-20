/**
 * Integration Routes
 * REST API endpoints for managing integration plugins
 */

import { Router, Request, Response } from 'express';
import { getPlugin, getIntegrationConfigs } from '../integrations/integration-registry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('IntegrationRoutes');

const router = Router();

// GET /api/integrations — List all integrations with status and config schema
router.get('/', (_req: Request, res: Response) => {
  try {
    const integrations = getIntegrationConfigs();
    res.json(integrations);
  } catch (err) {
    log.error(`Failed to list integrations: ${err}`);
    res.status(500).json({ error: 'Failed to list integrations' });
  }
});

// GET /api/integrations/:id — Get single integration details
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const plugin = getPlugin(req.params.id);
    if (!plugin) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    res.json({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      schema: plugin.getConfigSchema(),
      values: plugin.getConfig(),
      status: plugin.getStatus(),
      customComponent: plugin.getCustomSettingsComponent?.() ?? undefined,
    });
  } catch (err) {
    log.error(`Failed to get integration ${req.params.id}: ${err}`);
    res.status(500).json({ error: 'Failed to get integration' });
  }
});

// GET /api/integrations/:id/status — Get integration status
router.get('/:id/status', (req: Request<{ id: string }>, res: Response) => {
  try {
    const plugin = getPlugin(req.params.id);
    if (!plugin) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    res.json(plugin.getStatus());
  } catch (err) {
    log.error(`Failed to get integration status ${req.params.id}: ${err}`);
    res.status(500).json({ error: 'Failed to get integration status' });
  }
});

// PATCH /api/integrations/:id/config — Update integration config
router.patch('/:id/config', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const plugin = getPlugin(req.params.id);
    if (!plugin) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    const config = req.body;
    if (!config || typeof config !== 'object') {
      res.status(400).json({ error: 'Request body must be a JSON object' });
      return;
    }

    await plugin.setConfig(config);

    res.json({
      id: plugin.id,
      values: plugin.getConfig(),
      status: plugin.getStatus(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Failed to update integration config ${req.params.id}: ${message}`);
    res.status(500).json({ error: message });
  }
});

export default router;
