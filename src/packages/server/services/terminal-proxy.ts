/**
 * Terminal Proxy Service
 * Proxies HTTP and WebSocket connections from /api/terminal/:buildingId/* to ttyd localhost ports.
 * This ensures ttyd traffic goes through Commander's auth middleware.
 *
 * ttyd is started with --base-path /api/terminal/<buildingId> so it expects
 * the full path in requests. The proxy forwards the path as-is without stripping.
 *
 * Split into two setup functions:
 * - setupTerminalHttpProxy(app) - called in app.ts BEFORE API routes
 * - setupTerminalWsProxy(server) - called in index.ts for WebSocket upgrades
 */

import type { Express } from 'express';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import httpProxy from 'http-proxy';
import { isTerminalRunning, getTerminalStatus } from './terminal-service.js';
import { loadBuildings } from '../data/index.js';
import { isAuthEnabled, validateToken, extractTokenFromWebSocket } from '../auth/index.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('TerminalProxy');

const TERMINAL_PATH_PREFIX = '/api/terminal/';

// Shared proxy instances
let proxy: httpProxy | null = null;
let htmlProxy: httpProxy | null = null;

// Custom CSS injected into ttyd index HTML for scrollbar styling
const CUSTOM_CSS = `<style>
.xterm-viewport::-webkit-scrollbar{width:6px}
.xterm-viewport::-webkit-scrollbar-track{background:transparent}
.xterm-viewport::-webkit-scrollbar-thumb{background:rgba(98,114,164,.4);border-radius:3px}
.xterm-viewport::-webkit-scrollbar-thumb:hover{background:rgba(98,114,164,.7)}
.xterm-viewport{scrollbar-width:thin;scrollbar-color:rgba(98,114,164,.4) transparent}
</style>`;

// Script injected into ttyd HTML to forward auth token on WebSocket connections.
// ttyd's JS constructs ws:// URLs from window.location.pathname, dropping query params.
// This patches the WebSocket constructor to re-append the token so the WS upgrade passes auth.
const AUTH_WS_SCRIPT = `<script>
(function(){
  var t=new URLSearchParams(location.search).get('token');
  if(!t)return;
  var O=WebSocket;
  window.WebSocket=function(u,p){
    try{var o=new URL(u,location.origin);o.searchParams.set('token',t);u=o.toString()}catch(e){}
    return p!==undefined?new O(u,p):new O(u);
  };
  window.WebSocket.prototype=O.prototype;
  window.WebSocket.CONNECTING=O.CONNECTING;
  window.WebSocket.OPEN=O.OPEN;
  window.WebSocket.CLOSING=O.CLOSING;
  window.WebSocket.CLOSED=O.CLOSED;
})();
</script>`;

function getProxy(): httpProxy {
  if (!proxy) {
    proxy = httpProxy.createProxyServer({
      ws: true,
      changeOrigin: true,
      xfwd: false,
    });

    proxy.on('error', (err, _req, res) => {
      log.error(`Proxy error: ${err.message}`);
      if (res && 'writeHead' in res && !res.writableEnded) {
        (res as any).writeHead(502, { 'Content-Type': 'application/json' });
        (res as any).end(JSON.stringify({ error: 'Terminal not available' }));
      }
    });
  }
  return proxy;
}

/**
 * Separate proxy for HTML index pages only, with selfHandleResponse
 * so we can buffer and modify the response to inject custom CSS.
 */
function getHtmlProxy(): httpProxy {
  if (!htmlProxy) {
    htmlProxy = httpProxy.createProxyServer({
      changeOrigin: true,
      xfwd: false,
      selfHandleResponse: true,
    });

    htmlProxy.on('proxyRes', (proxyRes, _req, res) => {
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf-8');
        body = body.replace('</head>', AUTH_WS_SCRIPT + CUSTOM_CSS + '</head>');
        const headers = { ...proxyRes.headers };
        delete headers['content-length'];
        delete headers['content-encoding'];
        (res as any).writeHead(proxyRes.statusCode || 200, headers);
        (res as any).end(body);
      });
    });

    htmlProxy.on('error', (err, _req, res) => {
      log.error(`HTML proxy error: ${err.message}`);
      if (res && 'writeHead' in res && !res.writableEnded) {
        (res as any).writeHead(502, { 'Content-Type': 'application/json' });
        (res as any).end(JSON.stringify({ error: 'Terminal not available' }));
      }
    });
  }
  return htmlProxy;
}

/**
 * Extract buildingId from a terminal proxy URL
 */
function extractBuildingId(url: string): string | null {
  if (!url.startsWith(TERMINAL_PATH_PREFIX)) return null;
  const rest = url.slice(TERMINAL_PATH_PREFIX.length);
  const slashIdx = rest.indexOf('/');
  return slashIdx === -1 ? (rest || null) : rest.slice(0, slashIdx);
}

/**
 * Get the ttyd target URL for a building
 */
function getTargetUrl(buildingId: string): string | null {
  if (!isTerminalRunning(buildingId)) return null;
  const buildings = loadBuildings();
  const building = buildings.find(b => b.id === buildingId);
  if (!building) return null;

  const status = getTerminalStatus(building);
  if (!status?.port) return null;

  return `http://127.0.0.1:${status.port}`;
}

/**
 * Set up HTTP proxy for terminal buildings.
 * Must be called in app.ts BEFORE the API routes to avoid the 404 catch-all.
 * Auth is already applied via app.use('/api', authMiddleware).
 */
export function setupTerminalHttpProxy(app: Express): void {
  const p = getProxy();

  const hp = getHtmlProxy();

  // Use a full-path route pattern so Express doesn't interfere with the API router
  app.use('/api/terminal', (req, res) => {
    // req.url here has been stripped of '/api/terminal', so it's like '/buildingId/...'
    // Reconstruct the full original path for ttyd (which has --base-path set)
    const fullPath = '/api/terminal' + req.url;
    const buildingId = extractBuildingId(fullPath);

    if (!buildingId) {
      res.status(400).json({ error: 'Invalid terminal path' });
      return;
    }

    const target = getTargetUrl(buildingId);
    if (!target) {
      res.status(404).json({ error: 'Terminal not running' });
      return;
    }

    // Restore the full path so ttyd receives it with the base-path prefix
    req.url = fullPath;

    // For index pages, use the HTML proxy that injects custom CSS
    const isIndexPage = fullPath.endsWith('/');
    if (isIndexPage) {
      // Request uncompressed so we can do string replacement
      delete req.headers['accept-encoding'];
      hp.web(req, res, { target });
    } else {
      p.web(req, res, { target });
    }
  });

  log.log('Terminal HTTP proxy initialized');
}

/**
 * Set up WebSocket proxy for terminal buildings.
 * Called in index.ts after the HTTP server is created.
 */
export function setupTerminalWsProxy(server: HttpServer): void {
  const p = getProxy();

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url || '';

    // Only handle terminal proxy paths (let the main WS handler deal with /ws)
    if (!url.startsWith(TERMINAL_PATH_PREFIX)) return;

    // Auth check for WebSocket upgrade
    if (isAuthEnabled()) {
      const token = extractTokenFromWebSocket(req);
      if (!validateToken(token)) {
        log.log('Terminal WebSocket rejected: invalid auth');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const buildingId = extractBuildingId(url);
    if (!buildingId) {
      socket.destroy();
      return;
    }

    const target = getTargetUrl(buildingId);
    if (!target) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Keep the full URL path - ttyd expects it with the base-path prefix
    p.ws(req, socket, head, { target });
  });

  log.log('Terminal WebSocket proxy initialized');
}

/**
 * Legacy combined setup (kept for backward compat, now delegates to individual functions)
 */
export function setupTerminalProxy(app: Express, server: HttpServer): void {
  setupTerminalHttpProxy(app);
  setupTerminalWsProxy(server);
}
