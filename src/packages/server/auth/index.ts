/**
 * Authentication Module
 * Handles token-based authentication for HTTP and WebSocket connections
 */

import { Request, Response, NextFunction } from 'express';
import { IncomingMessage } from 'http';
import { logger } from '../utils/logger.js';

const log = logger.server;

// Get auth token from environment
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

/**
 * Check if authentication is enabled
 */
export function isAuthEnabled(): boolean {
  return AUTH_TOKEN.length > 0;
}

/**
 * Get the configured auth token (for debugging/display purposes only)
 */
export function getAuthTokenPreview(): string {
  if (!AUTH_TOKEN) return '(not set)';
  if (AUTH_TOKEN.length <= 8) return '***';
  return `${AUTH_TOKEN.slice(0, 4)}...${AUTH_TOKEN.slice(-4)}`;
}

/**
 * Validate a token against the configured AUTH_TOKEN
 */
export function validateToken(token: string | null | undefined): boolean {
  if (!isAuthEnabled()) {
    return true; // No auth required if token not configured
  }
  return token === AUTH_TOKEN;
}

/**
 * Extract token from various sources in an HTTP request
 * Checks: Authorization header, X-Auth-Token header, query param
 */
export function extractTokenFromRequest(req: Request): string | null {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check X-Auth-Token header
  const tokenHeader = req.headers['x-auth-token'];
  if (typeof tokenHeader === 'string') {
    return tokenHeader;
  }

  // Check query parameter
  const queryToken = req.query.token;
  if (typeof queryToken === 'string') {
    return queryToken;
  }

  return null;
}

/**
 * Extract token from WebSocket upgrade request
 * Checks: query param in URL, Sec-WebSocket-Protocol header
 */
export function extractTokenFromWebSocket(req: IncomingMessage): string | null {
  // Check URL query parameter
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return queryToken;
  }

  // Check Sec-WebSocket-Protocol header (client sends token as subprotocol)
  const protocol = req.headers['sec-websocket-protocol'];
  if (typeof protocol === 'string') {
    // Format: "tide-auth, <token>"
    const parts = protocol.split(',').map(p => p.trim());
    const tokenPart = parts.find(p => p.startsWith('auth-'));
    if (tokenPart) {
      return tokenPart.slice(5); // Remove 'auth-' prefix
    }
  }

  return null;
}

/**
 * Express middleware for authenticating HTTP requests
 * Allows unauthenticated access to /api/health for status checks
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Always allow health check
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }

  // Skip auth if not enabled
  if (!isAuthEnabled()) {
    return next();
  }

  const token = extractTokenFromRequest(req);

  if (!validateToken(token)) {
    log.log(`[AUTH] Unauthorized request to ${req.method} ${req.path}`);
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing auth token' });
    return;
  }

  next();
}

/**
 * Validate WebSocket connection authentication
 * Returns true if connection should be allowed
 */
export function validateWebSocketAuth(req: IncomingMessage): boolean {
  if (!isAuthEnabled()) {
    return true;
  }

  const token = extractTokenFromWebSocket(req);
  const isValid = validateToken(token);

  if (!isValid) {
    log.log(`[AUTH] Unauthorized WebSocket connection attempt`);
  }

  return isValid;
}
