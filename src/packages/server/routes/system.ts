/**
 * System Routes
 * Endpoints for inspecting / updating the running Tide Commander install.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';
import { fetchLatestNpmVersion, getVersionRelation } from '../../shared/version.js';
import {
  endUpdate,
  getInstallInfo,
  isAutoUpdateSupported,
  isUpdateInProgress,
  runNpmGlobalUpdate,
  schedulePostUpdateRestart,
  tryBeginUpdate,
} from '../services/self-update-service.js';
import { getAutoUpdateStatus, setAutoUpdateEnabled } from '../services/auto-update-service.js';

const log = createLogger('SystemRoutes');
const router = Router();

const PACKAGE_NAME = 'tide-commander';

/**
 * GET /api/system/install-info
 *
 * Returns enough info for the UI to decide whether to render the "Update now"
 * button and which command to suggest if auto-update isn't supported.
 */
router.get('/install-info', async (_req: Request, res: Response) => {
  try {
    const info = getInstallInfo();
    const latestVersion = await fetchLatestNpmVersion(PACKAGE_NAME);
    const relation = latestVersion
      ? getVersionRelation(info.currentVersion, latestVersion)
      : 'unknown';
    const updateAvailable = relation === 'behind';

    res.json({
      isGlobalInstall: info.isGlobalInstall,
      packageManager: info.packageManager,
      installRoot: info.installRoot,
      currentVersion: info.currentVersion,
      latestVersion,
      updateAvailable,
      autoUpdateSupported: isAutoUpdateSupported(info),
      writable: info.writable,
      suggestedManualCommand: info.suggestedManualCommand,
      reason: info.reason,
      updateInProgress: isUpdateInProgress(),
    });
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to get install info: ${message}`);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/system/changelog
 *
 * Serves the bundled CHANGELOG.md (Keep a Changelog markdown) so the UI can
 * render release notes locally — no GitHub API, no rate limits, works offline
 * and always matches the installed version.
 */
router.get('/changelog', (_req: Request, res: Response) => {
  try {
    const installRoot = getInstallInfo().installRoot;
    if (!installRoot) {
      res.status(404).json({ error: 'Could not locate install root.' });
      return;
    }
    const changelogPath = path.join(installRoot, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) {
      res.status(404).json({ error: 'CHANGELOG.md not found.' });
      return;
    }
    const content = fs.readFileSync(changelogPath, 'utf8');
    res.type('text/markdown').send(content);
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to read changelog: ${message}`);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/system/self-update
 *
 * Streams the output of `npm install -g tide-commander@latest` via SSE.
 *
 * SSE events:
 *   - start    { message }
 *   - stdout   { chunk }
 *   - stderr   { chunk }
 *   - done     { success, exitCode, newVersion, requiresRestart }
 *   - error    { message, permissionDenied, suggestedManualCommand }
 *
 * On success the server relaunches itself (detached `tide-commander start
 * --restart`) so the new binary comes up automatically; if that can't be
 * scheduled it falls back to exiting for a manual restart.
 */
router.post('/self-update', async (_req: Request, res: Response) => {
  const info = getInstallInfo();

  if (!info.isGlobalInstall) {
    res.status(400).json({
      error: 'Auto-update is only available when running from a global install.',
      reason: info.reason,
    });
    return;
  }

  if (!isAutoUpdateSupported(info)) {
    const permsIssue = info.isGlobalInstall && info.packageManager === 'npm' && !info.writable;
    res.status(400).json({
      error: permsIssue
        ? `The install directory (${info.installRoot}) is not writable by this process — auto-update needs elevated permissions. Update manually: ${info.suggestedManualCommand}`
        : `Auto-update is not supported for package manager: ${info.packageManager}`,
      suggestedManualCommand: info.suggestedManualCommand,
    });
    return;
  }

  if (!tryBeginUpdate()) {
    res.status(409).json({ error: 'An update is already in progress.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Keepalive comment every 15s in case the install takes a while
  const keepalive = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      // socket closed
    }
  }, 15000);

  send('start', { message: `Running npm install -g ${PACKAGE_NAME}@latest...` });

  try {
    const result = await runNpmGlobalUpdate({
      onStdout: (chunk) => send('stdout', { chunk }),
      onStderr: (chunk) => send('stderr', { chunk }),
    });

    if (result.exitCode === 0) {
      // Keepalive stays active through this fetch (up to 5s): the client's
      // stall watchdog needs to keep seeing bytes until 'done' goes out.
      const newVersion = (await fetchLatestNpmVersion(PACKAGE_NAME)) ?? null;

      // Try to bring the new binary up automatically. The relauncher will
      // SIGTERM this process, so we must NOT exit ourselves when it's scheduled.
      const autoRestart = schedulePostUpdateRestart();

      send('done', {
        success: true,
        exitCode: 0,
        newVersion,
        requiresRestart: true,
        autoRestart,
        message: autoRestart
          ? 'Update installed — Tide Commander is restarting automatically. The UI will reconnect in a few seconds.'
          : 'Update installed. Please restart Tide Commander from your terminal.',
      });
      clearInterval(keepalive);
      res.end();

      if (autoRestart) {
        log.log('Update succeeded — detached relauncher scheduled; awaiting takeover.');
        // Safety net: if the relauncher never takes over, don't stay locked.
        setTimeout(() => {
          log.warn('Relauncher did not take over within 30s — clearing update lock.');
          endUpdate();
        }, 30000).unref?.();
      } else {
        // Couldn't schedule an auto-restart — fall back to the old behaviour:
        // exit so the next manual launch picks up the new binary.
        log.log('Auto-restart unavailable — scheduling exit in 1500ms for manual restart.');
        setTimeout(() => {
          log.log('Exiting after successful update. Restart manually with: tide-commander');
          process.exit(0);
        }, 1500);
      }
    } else {
      const errMsg = result.permissionDenied
        ? 'Permission denied while installing globally. Re-run from a terminal with the appropriate permissions (e.g. sudo npm install -g tide-commander@latest), or fix your npm prefix to a user-owned directory.'
        : `npm install exited with code ${result.exitCode}.`;

      send('error', {
        message: errMsg,
        exitCode: result.exitCode,
        permissionDenied: result.permissionDenied,
        suggestedManualCommand: info.suggestedManualCommand,
      });
      send('done', {
        success: false,
        exitCode: result.exitCode,
        newVersion: null,
        requiresRestart: false,
      });
      clearInterval(keepalive);
      res.end();
      endUpdate();
    }
  } catch (err) {
    clearInterval(keepalive);
    const message = (err as Error).message;
    log.error(`Self-update failed: ${message}`);
    send('error', { message, permissionDenied: false, suggestedManualCommand: info.suggestedManualCommand });
    send('done', { success: false, exitCode: -1, newVersion: null, requiresRestart: false });
    res.end();
    endUpdate();
  }
});

/**
 * GET /api/system/auto-update — unattended-update scheduler status.
 * POST /api/system/auto-update { enabled } — opt in/out (persisted).
 */
router.get('/auto-update', (_req: Request, res: Response) => {
  res.json(getAutoUpdateStatus());
});

router.post('/auto-update', (req: Request, res: Response) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'Body must include { enabled: boolean }' });
    return;
  }
  log.log(`Auto-update ${enabled ? 'enabled' : 'disabled'} via API`);
  res.json(setAutoUpdateEnabled(enabled));
});

export default router;
