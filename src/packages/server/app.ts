/**
 * Express Application
 * Main Express app configuration
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';
import routes from './routes/index.js';
import { logger } from './utils/logger.js';
import { authMiddleware, isAuthEnabled, getAuthTokenPreview } from './auth/index.js';

// Temp directory for uploads (same as in files.ts)
const UPLOADS_DIR = path.join(os.tmpdir(), 'tide-commander-uploads');

// Find project root (where package.json is)
function findProjectRoot(): string {
  let dir = import.meta.dirname;
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

export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '50mb' })); // Increased for audio uploads (STT)

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.http.log(`${req.method} ${req.path}`);
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
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) {
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
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.http.error('Request error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
