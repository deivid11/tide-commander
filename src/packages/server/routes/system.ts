/**
 * System Routes
 * Endpoints for inspecting / updating the running Tide Commander install.
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
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
import {
  deleteClaudeCredentialProfile,
  getClaudeCredentialProfilesUsage,
  listClaudeCredentialProfiles,
  renameClaudeCredentialProfile,
  saveActiveClaudeCredentialProfile,
  switchClaudeCredentialProfile,
} from '../services/claude-credentials-service.js';
import {
  deleteProviderCredentialProfile,
  listProviderCredentialProfiles,
  renameProviderCredentialProfile,
  saveActiveProviderCredentialProfile,
  switchProviderCredentialProfile,
  type CredentialProviderId,
} from '../services/provider-credentials-service.js';

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
 * Web bundle (OTA UI sync for the Android app)
 *
 * The APK can swap its WebView assets for a bundle pulled from this server
 * (Capacitor setServerBasePath — Expo-updates style), so UI-only releases
 * reach phones without installing a new APK. These endpoints expose the
 * client build this server serves (installRoot/dist).
 */

/** Root of the served client build, or null when no build exists (dev without dist). */
function getClientDistDir(): string | null {
  const installRoot = getInstallInfo().installRoot;
  if (!installRoot) return null;
  const dir = path.join(installRoot, 'dist');
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

// dist/ also holds the compiled server (src/) — never ship that to the WebView.
const WEB_BUNDLE_EXCLUDED_ROOTS = new Set(['src']);

function walkClientFiles(root: string): Array<{ path: string; size: number }> {
  const files: Array<{ path: string; size: number }> = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (!rel && WEB_BUNDLE_EXCLUDED_ROOTS.has(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.isFile() && !entry.name.endsWith('.map')) {
        files.push({ path: childRel, size: fs.statSync(path.join(root, childRel)).size });
      }
    }
  };
  walk('');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

interface WebBundleInfo {
  version: string;
  hash: string;
  fileCount: number;
  totalBytes: number;
}

/**
 * Bundle identity = file list + sizes + full index.html content. Vite
 * content-hashes asset filenames (so index.html captures every JS/CSS
 * change), and sizes catch edits to runtime-fetched files (locales, sw.js).
 */
function computeWebBundleInfo(): WebBundleInfo | null {
  const dir = getClientDistDir();
  if (!dir) return null;
  const files = walkClientFiles(dir);
  const indexContent = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(files))
    .update(indexContent)
    .digest('hex')
    .slice(0, 16);

  // The version must describe the dist we SERVE, not the live package.json —
  // package.json moves ahead of the last build (version bumps, dev work), and
  // advertising a version the bundle doesn't contain sends phones into an
  // eternal re-sync loop (pull → still "behind" → pull …). build-info.json is
  // emitted by the vite build; fall back to package.json for older dists.
  let version = getInstallInfo().currentVersion;
  try {
    const buildInfo = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8')) as {
      version?: string;
    };
    if (buildInfo.version) version = buildInfo.version;
  } catch {
    /* pre-build-info dist — package.json is the best guess */
  }

  return {
    version,
    hash,
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
  };
}

router.get('/web-bundle-info', (_req: Request, res: Response) => {
  try {
    const info = computeWebBundleInfo();
    if (!info) {
      res.status(404).json({ error: 'No client build to serve — run npm run build on the server first.' });
      return;
    }
    res.json(info);
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to compute web bundle info: ${message}`);
    res.status(500).json({ error: message });
  }
});

router.get('/web-bundle', (_req: Request, res: Response) => {
  const dir = getClientDistDir();
  if (!dir) {
    res.status(404).json({ error: 'No client build to serve — run npm run build on the server first.' });
    return;
  }
  try {
    const info = computeWebBundleInfo();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="web-bundle.zip"');
    if (info) res.setHeader('X-Bundle-Hash', info.hash);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      log.error(`Web bundle zip failed: ${err.message}`);
      res.destroy(err);
    });
    archive.pipe(res);
    for (const file of walkClientFiles(dir)) {
      archive.file(path.join(dir, file.path), { name: file.path });
    }
    void archive.finalize();
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to stream web bundle: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: message });
    else res.destroy();
  }
});

/**
 * GET /api/system/app-update
 *
 * Update metadata for the Android APK, checked server-side. The device asks
 * its own server instead of api.github.com because phones sit behind carrier
 * CGNAT where GitHub's unauthenticated 60 req/hour/IP quota routinely 403s —
 * the same failure that forced the changelog to be served locally. Responses
 * are cached; on a GitHub outage the last good payload is served stale.
 */
const GITHUB_REPO = 'deivid11/tide-commander';
const APP_UPDATE_CACHE_TTL_MS = 10 * 60 * 1000;

interface GitHubReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  assets: GitHubReleaseAsset[];
}

interface AppUpdateInfo {
  latestVersion: string;
  name: string | null;
  changelog: string | null;
  releaseUrl: string;
  apkUrl: string | null;
  apkSize: number | null;
  publishedAt: string | null;
  recentReleases: Array<{
    version: string;
    name: string | null;
    publishedAt: string;
    releaseUrl: string;
  }>;
}

let appUpdateCache: { fetchedAt: number; payload: AppUpdateInfo } | null = null;

router.get('/app-update', async (_req: Request, res: Response) => {
  if (appUpdateCache && Date.now() - appUpdateCache.fetchedAt < APP_UPDATE_CACHE_TTL_MS) {
    res.json(appUpdateCache.payload);
    return;
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      // GitHub rejects requests without a User-Agent
      'User-Agent': 'tide-commander-server',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const [latestRes, listRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers }),
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=3`, { headers }),
    ]);
    if (!latestRes.ok) {
      throw new Error(`GitHub API error: ${latestRes.status}`);
    }

    const release = (await latestRes.json()) as GitHubRelease;
    const list = listRes.ok ? ((await listRes.json()) as GitHubRelease[]) : [];
    const apkAsset = release.assets.find(
      (asset) =>
        asset.name.endsWith('.apk') &&
        asset.content_type === 'application/vnd.android.package-archive',
    );

    const payload: AppUpdateInfo = {
      latestVersion: release.tag_name,
      name: release.name,
      changelog: release.body,
      releaseUrl: release.html_url,
      apkUrl: apkAsset?.browser_download_url ?? null,
      apkSize: apkAsset?.size ?? null,
      publishedAt: release.published_at ?? null,
      recentReleases: list.map((r) => ({
        version: r.tag_name,
        name: r.name,
        publishedAt: r.published_at,
        releaseUrl: r.html_url,
      })),
    };

    appUpdateCache = { fetchedAt: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    const message = (err as Error).message;
    if (appUpdateCache) {
      log.warn(`App-update check failed (${message}) — serving stale cache`);
      res.json(appUpdateCache.payload);
      return;
    }
    log.error(`App-update check failed: ${message}`);
    res.status(502).json({ error: message });
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

/**
 * Claude CLI OAuth credential profiles (~/.claude/.credentials.json and
 * ~/.claude/.credentials.<name>.json). Used to switch the active Claude
 * account when rate limits are hit without manually renaming files.
 *
 * Tokens are never returned — only non-secret metadata + fingerprints.
 */
router.get('/claude-credentials', (_req: Request, res: Response) => {
  try {
    res.json(listClaudeCredentialProfiles());
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to list Claude credentials: ${message}`);
    res.status(500).json({ error: message });
  }
});

/**
 * Session (5h) + weekly rate-limit gauges per stored credential profile,
 * keyed by token fingerprint. Cached server-side; expired dormant tokens are
 * reported (with last-known gauges when available) instead of fetched.
 */
router.get('/claude-credentials/usage', async (_req: Request, res: Response) => {
  try {
    res.json(await getClaudeCredentialProfilesUsage());
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to fetch Claude credentials usage: ${message}`);
    res.status(500).json({ error: message });
  }
});

router.post('/claude-credentials/switch', (req: Request, res: Response) => {
  try {
    const name = req.body?.name;
    const stashActiveAs = req.body?.stashActiveAs;
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Body must include { name: string }' });
      return;
    }
    if (stashActiveAs !== undefined && typeof stashActiveAs !== 'string') {
      res.status(400).json({ error: 'stashActiveAs must be a string when provided' });
      return;
    }
    const result = switchClaudeCredentialProfile(name.trim(), {
      stashActiveAs: typeof stashActiveAs === 'string' ? stashActiveAs.trim() : undefined,
    });
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to switch Claude credentials: ${message}`);
    const status = /not found|Invalid|required|already exists|cannot be/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/claude-credentials/save', (req: Request, res: Response) => {
  try {
    const name = req.body?.name;
    const force = Boolean(req.body?.force);
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Body must include { name: string }' });
      return;
    }
    res.json(saveActiveClaudeCredentialProfile(name.trim(), { force }));
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to save Claude credentials profile: ${message}`);
    const status = /not found|Invalid|already exists|No valid/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/claude-credentials/rename', (req: Request, res: Response) => {
  try {
    const from = req.body?.from;
    const to = req.body?.to;
    if (typeof from !== 'string' || !from.trim() || typeof to !== 'string' || !to.trim()) {
      res.status(400).json({ error: 'Body must include { from: string, to: string }' });
      return;
    }
    res.json(renameClaudeCredentialProfile(from.trim(), to.trim()));
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to rename Claude credentials profile: ${message}`);
    const status = /not found|Invalid|already exists/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.delete('/claude-credentials/:name', (req: Request, res: Response) => {
  try {
    const name = typeof req.params.name === 'string' ? req.params.name : '';
    if (!name) {
      res.status(400).json({ error: 'Profile name required' });
      return;
    }
    res.json(deleteClaudeCredentialProfile(name));
  } catch (err) {
    const message = (err as Error).message;
    log.error(`Failed to delete Claude credentials profile: ${message}`);
    const status = /not found|Invalid/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Grok + Codex OAuth credential profiles — same account-switcher model as
 * Claude, generalized (~/.grok/auth.json, ~/.codex/auth.json + named copies).
 * Mounted per provider at /grok-credentials/* and /codex-credentials/*.
 * Tokens are never returned — only non-secret metadata + fingerprints.
 */
function mountProviderCredentialRoutes(provider: CredentialProviderId, basePath: string): void {
  router.get(basePath, (_req: Request, res: Response) => {
    try {
      res.json(listProviderCredentialProfiles(provider));
    } catch (err) {
      const message = (err as Error).message;
      log.error(`Failed to list ${provider} credentials: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  router.post(`${basePath}/switch`, (req: Request, res: Response) => {
    try {
      const name = req.body?.name;
      const stashActiveAs = req.body?.stashActiveAs;
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Body must include { name: string }' });
        return;
      }
      if (stashActiveAs !== undefined && typeof stashActiveAs !== 'string') {
        res.status(400).json({ error: 'stashActiveAs must be a string when provided' });
        return;
      }
      res.json(
        switchProviderCredentialProfile(provider, name.trim(), {
          stashActiveAs: typeof stashActiveAs === 'string' ? stashActiveAs.trim() : undefined,
        }),
      );
    } catch (err) {
      const message = (err as Error).message;
      log.error(`Failed to switch ${provider} credentials: ${message}`);
      const status = /not found|Invalid|required|already exists|cannot be|no valid/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post(`${basePath}/save`, (req: Request, res: Response) => {
    try {
      const name = req.body?.name;
      const force = Boolean(req.body?.force);
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Body must include { name: string }' });
        return;
      }
      res.json(saveActiveProviderCredentialProfile(provider, name.trim(), { force }));
    } catch (err) {
      const message = (err as Error).message;
      log.error(`Failed to save ${provider} credentials profile: ${message}`);
      const status = /not found|Invalid|already exists|No valid/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post(`${basePath}/rename`, (req: Request, res: Response) => {
    try {
      const from = req.body?.from;
      const to = req.body?.to;
      if (typeof from !== 'string' || !from.trim() || typeof to !== 'string' || !to.trim()) {
        res.status(400).json({ error: 'Body must include { from: string, to: string }' });
        return;
      }
      res.json(renameProviderCredentialProfile(provider, from.trim(), to.trim()));
    } catch (err) {
      const message = (err as Error).message;
      log.error(`Failed to rename ${provider} credentials profile: ${message}`);
      const status = /not found|Invalid|already exists/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.delete(`${basePath}/:name`, (req: Request, res: Response) => {
    try {
      const name = typeof req.params.name === 'string' ? req.params.name : '';
      if (!name) {
        res.status(400).json({ error: 'Profile name required' });
        return;
      }
      res.json(deleteProviderCredentialProfile(provider, name));
    } catch (err) {
      const message = (err as Error).message;
      log.error(`Failed to delete ${provider} credentials profile: ${message}`);
      const status = /not found|Invalid/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });
}

mountProviderCredentialRoutes('grok', '/grok-credentials');
mountProviderCredentialRoutes('codex', '/codex-credentials');

export default router;
