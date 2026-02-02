/**
 * Snapshot Routes
 * REST API endpoints for managing conversation snapshots
 *
 * POST   /api/snapshots           - Create a new snapshot
 * GET    /api/snapshots           - List all snapshots
 * GET    /api/snapshots/:id       - Get snapshot details
 * POST   /api/snapshots/:id/restore - Restore files from snapshot
 * DELETE /api/snapshots/:id       - Delete a snapshot
 */

import { Router, Request, Response } from 'express';
import type {
  ConversationSnapshot,
  SnapshotListItem,
  SnapshotOutput,
  CreateSnapshotRequest,
  CreateSnapshotResponse,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
} from '../../shared/types.js';
import { agentService } from '../services/index.js';
import { collectFilesForSnapshot, restoreFilesFromSnapshot } from '../services/fileTracker.js';
import {
  saveSnapshot,
  loadSnapshot,
  listSnapshots,
  deleteSnapshot,
  snapshotExists,
} from '../data/snapshots.js';
import { loadSession } from '../claude/session-loader.js';
import { createLogger, generateId } from '../utils/index.js';

const log = createLogger('SnapshotRoutes');

const router = Router();

// ============================================================================
// POST /api/snapshots - Create a new snapshot
// ============================================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const { agentId, title, description } = req.body as CreateSnapshotRequest;

    // Validate required fields
    if (!agentId || !title) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentId, title',
      } as CreateSnapshotResponse);
      return;
    }

    // Get agent
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      res.status(404).json({
        success: false,
        error: `Agent not found: ${agentId}`,
      } as CreateSnapshotResponse);
      return;
    }

    // Check agent has a session
    if (!agent.sessionId) {
      res.status(400).json({
        success: false,
        error: 'Agent has no active session',
      } as CreateSnapshotResponse);
      return;
    }

    log.log(` Creating snapshot for agent ${agent.name} (${agentId})`);

    // Load conversation outputs from session
    const sessionData = await loadSession(agent.cwd, agent.sessionId, 1000, 0);
    if (!sessionData) {
      res.status(500).json({
        success: false,
        error: 'Failed to load session data',
      } as CreateSnapshotResponse);
      return;
    }

    // Convert session messages to snapshot outputs
    log.log(` Creating snapshot with ${sessionData.messages.length} messages from session`);
    const outputs: SnapshotOutput[] = sessionData.messages
      .filter(msg => msg.content) // Only include messages with content
      .map((msg, index) => {
        const output = {
          id: `msg-${index}`,
          text: msg.content,
          timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : (typeof msg.timestamp === 'string' ? new Date(msg.timestamp).getTime() : Date.now()),
          isStreaming: false,
        };
        // Log all messages with their content length
        if (index < 5) {
          log.log(` Message ${index}: type=${msg.type}, textLength=${output.text.length}, preview=${output.text.slice(0, 50)}`);
        }
        return output;
      });
    log.log(` Total outputs after filtering: ${outputs.length}`);

    // Collect files that were created/modified
    const files = await collectFilesForSnapshot(agent.cwd, agent.sessionId);

    // Generate snapshot ID
    const snapshotId = generateId();

    // Create snapshot object
    const snapshot: ConversationSnapshot = {
      id: snapshotId,
      agentId: agent.id,
      agentName: agent.name,
      agentClass: agent.class,
      title,
      description,
      outputs,
      sessionId: agent.sessionId,
      files,
      cwd: agent.cwd,
      createdAt: Date.now(),
      conversationStartedAt: outputs.length > 0
        ? new Date(outputs[0].timestamp).getTime()
        : undefined,
      tokensUsed: agent.tokensUsed,
      contextUsed: agent.contextUsed,
    };

    // Save to disk
    saveSnapshot(snapshot);

    log.log(` Created snapshot "${title}" (${snapshotId}) with ${files.length} files, ${outputs.length} messages`);

    res.status(201).json({
      success: true,
      snapshot,
    } as CreateSnapshotResponse);
  } catch (err: any) {
    log.error(' Failed to create snapshot:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    } as CreateSnapshotResponse);
  }
});

// ============================================================================
// GET /api/snapshots - List all snapshots
// ============================================================================
router.get('/', (_req: Request, res: Response) => {
  try {
    const agentId = _req.query.agentId as string | undefined;
    const limit = _req.query.limit
      ? parseInt(_req.query.limit as string, 10)
      : undefined;

    const snapshots = listSnapshots(agentId, limit);

    res.json({
      snapshots,
      count: snapshots.length,
    });
  } catch (err: any) {
    log.error(' Failed to list snapshots:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GET /api/snapshots/:id - Get snapshot details
// ============================================================================
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;

    const snapshot = loadSnapshot(id);
    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    res.json(snapshot);
  } catch (err: any) {
    log.error(' Failed to load snapshot:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /api/snapshots/:id/restore - Restore files from snapshot
// ============================================================================
router.post('/:id/restore', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const { overwrite = false, targetDir } = req.body as Omit<RestoreSnapshotRequest, 'snapshotId'>;

    // Load snapshot
    const snapshot = loadSnapshot(id);
    if (!snapshot) {
      res.status(404).json({
        success: false,
        restoredFiles: [],
        skippedFiles: [],
        error: 'Snapshot not found',
      } as RestoreSnapshotResponse);
      return;
    }

    if (snapshot.files.length === 0) {
      res.json({
        success: true,
        restoredFiles: [],
        skippedFiles: [],
      } as RestoreSnapshotResponse);
      return;
    }

    log.log(` Restoring ${snapshot.files.length} files from snapshot ${id}`);

    // Restore files
    const { restored, skipped } = restoreFilesFromSnapshot(
      snapshot.files,
      targetDir,
      overwrite
    );

    log.log(` Restored ${restored.length} files, skipped ${skipped.length}`);

    res.json({
      success: true,
      restoredFiles: restored,
      skippedFiles: skipped,
    } as RestoreSnapshotResponse);
  } catch (err: any) {
    log.error(' Failed to restore snapshot:', err);
    res.status(500).json({
      success: false,
      restoredFiles: [],
      skippedFiles: [],
      error: err.message,
    } as RestoreSnapshotResponse);
  }
});

// ============================================================================
// DELETE /api/snapshots/:id - Delete a snapshot
// ============================================================================
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;

    if (!snapshotExists(id)) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    const deleted = deleteSnapshot(id);
    if (!deleted) {
      res.status(500).json({ error: 'Failed to delete snapshot' });
      return;
    }

    log.log(` Deleted snapshot ${id}`);

    res.status(204).end();
  } catch (err: any) {
    log.error(' Failed to delete snapshot:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
