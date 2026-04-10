/**
 * Workspace Routes
 * REST API endpoints for workspace management
 */

import { Router, Request, Response } from 'express';
import {
  getWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getActiveWorkspace,
  setActiveWorkspace,
} from '../services/workspace-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WorkspaceRoutes');
const router = Router();

// GET /api/workspaces - List all workspaces
router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(getWorkspaces());
  } catch (err: any) {
    log.error(`Failed to list workspaces: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workspaces/active - Get active workspace ID
router.get('/active', (_req: Request, res: Response) => {
  try {
    res.json({ workspaceId: getActiveWorkspace() });
  } catch (err: any) {
    log.error(`Failed to get active workspace: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/workspaces/active - Set active workspace
router.put('/active', (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.body;
    if (workspaceId !== null && typeof workspaceId !== 'string') {
      res.status(400).json({ error: 'workspaceId must be a string or null' });
      return;
    }
    setActiveWorkspace(workspaceId ?? null);
    res.json({ workspaceId: getActiveWorkspace() });
  } catch (err: any) {
    log.error(`Failed to set active workspace: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/workspaces - Create workspace
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, areaIds } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required and must be a string' });
      return;
    }
    if (!Array.isArray(areaIds)) {
      res.status(400).json({ error: 'areaIds must be an array' });
      return;
    }
    const workspace = createWorkspace(name.trim(), areaIds);
    res.status(201).json(workspace);
  } catch (err: any) {
    log.error(`Failed to create workspace: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/workspaces/:id - Update workspace
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, areaIds, cameraState, cameraState2d } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (areaIds !== undefined) updates.areaIds = areaIds;
    if (cameraState !== undefined) updates.cameraState = cameraState;
    if (cameraState2d !== undefined) updates.cameraState2d = cameraState2d;

    const workspace = updateWorkspace(String(id), updates);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    res.json(workspace);
  } catch (err: any) {
    log.error(`Failed to update workspace: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/workspaces/:id - Delete workspace
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = deleteWorkspace(String(id));
    if (!deleted) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    log.error(`Failed to delete workspace: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workspaces/:id - Get single workspace
router.get('/:id', (req: Request, res: Response) => {
  try {
    const workspace = getWorkspace(String(req.params.id));
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    res.json(workspace);
  } catch (err: any) {
    log.error(`Failed to get workspace: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
