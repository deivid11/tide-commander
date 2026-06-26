/**
 * Express Application
 * Main Express app configuration
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import { logger } from './utils/logger.js';
import { authMiddleware, isAuthEnabled, getAuthTokenPreview } from './auth/index.js';
import { recordRequestTiming } from './routes/perf.js';
import { setupTerminalHttpProxy } from './services/terminal-proxy.js';
import { ATTACHMENT_DIR } from './services/browser-error-service.js';

// Temp directory for uploads (same as in files.ts)
const UPLOADS_DIR = path.join(os.tmpdir(), 'tide-commander-uploads');

// Find project root (where package.json is)
function findProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

// Paths matched here are skipped by the HTTP request logger to reduce noise from
// frequently-polled endpoints. Match is exact OR startsWith. Add new entries as
// `'METHOD /path'` (method-scoped) or `'/path'` (any method).
const HTTP_LOG_BLACKLIST: string[] = [
  'GET /api/files/git-status',
];

function isHttpLogBlacklisted(method: string, urlPath: string): boolean {
  const methodPath = `${method} ${urlPath}`;
  for (const entry of HTTP_LOG_BLACKLIST) {
    if (entry.includes(' ')) {
      if (methodPath === entry || methodPath.startsWith(entry + '/')) return true;
    } else {
      if (urlPath === entry || urlPath.startsWith(entry + '/')) return true;
    }
  }
  return false;
}

export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(cors());

  // Webhook routes need the raw request bytes for HMAC signature verification.
  // Bitbucket and GitHub compute the signature over the exact bytes they send,
  // so re-serializing via JSON.stringify(req.body) can produce a different
  // digest (key ordering / whitespace) and falsely reject valid deliveries.
  // The path-scoped JSON parser below runs first; it parses the body AND
  // stashes the raw buffer on req.rawBody. Once req._body is set, the global
  // express.json that follows is a no-op for these requests, so the raw
  // buffer is only retained for webhook deliveries — not every JSON request.
  app.use(
    '/api/triggers/webhook',
    express.json({
      limit: '50mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.use(express.json({ limit: '50mb' })); // Increased for audio uploads (STT)

  // Request logging & timing
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isHttpLogBlacklisted(req.method, req.path)) {
      logger.http.log(`${req.method} ${req.path}`);
    }
    const start = Date.now();
    res.on('finish', () => {
      recordRequestTiming(req.method, req.path, Date.now() - start);
    });
    next();
  });

  // Authentication middleware (must be before routes)
  app.use('/api', authMiddleware);

  // Log auth status on app creation
  if (isAuthEnabled()) {
    logger.server.log(`Authentication enabled (token: ${getAuthTokenPreview()})`);
  } else {
    logger.server.log('Authentication disabled (no AUTH_TOKEN set)');
  }

  // Serve uploaded files statically
  app.use('/uploads', express.static(UPLOADS_DIR));
  // Serve browser-extension attachments (image attachments / element shots) so
  // the extension can render them as thumbnails + lightbox previews.
  app.use('/attachments', express.static(ATTACHMENT_DIR));

  // Terminal proxy (must be before API routes to avoid 404 catch-all)
  // Auth is already applied above via app.use('/api', authMiddleware)
  setupTerminalHttpProxy(app);

  // API routes
  app.use('/api', routes);

  // Serve static assets from dist (production build) or public (development)
  // Check dist first, then fall back to public
  if (fs.existsSync(DIST_DIR)) {
    app.use('/assets', express.static(path.join(DIST_DIR, 'assets')));
    // Serve index.html for SPA routes
    app.use(express.static(DIST_DIR));
    app.get('/{*path}', (req: Request, res: Response, next: NextFunction) => {
      // Skip API routes
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/attachments') || req.path.startsWith('/ws')) {
        return next();
      }
      const indexPath = path.join(DIST_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  } else if (fs.existsSync(PUBLIC_DIR)) {
    // Development: serve from public folder
    app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
  }

  // 404 handler (for API routes only now)
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error & { type?: string; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    // body-parser surfaces malformed JSON as SyntaxError with type 'entity.parse.failed',
    // and oversized bodies as 'entity.too.large'. Surface the actual parser message so
    // clients/agents can debug from the response without tailing server logs.
    if (err.type === 'entity.parse.failed') {
      logger.http.error(`Body parse error: ${err.message}`);
      res.status(400).json({ error: `Invalid JSON body: ${err.message}` });
      return;
    }
    if (err.type === 'entity.too.large') {
      logger.http.error(`Body too large: ${err.message}`);
      res.status(413).json({ error: `Request body too large: ${err.message}` });
      return;
    }
    logger.http.error('Request error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
