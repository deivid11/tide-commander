/**
 * SSH Tunnel Service
 *
 * Manages SSH tunnel lifecycles for Database buildings. Each tunnel:
 *   1. Opens an ssh2 Client to the configured jump host.
 *   2. Listens on a local TCP port (auto-assigned or fixed via config.localPort).
 *   3. On each incoming local connection, calls client.forwardOut() to relay
 *      traffic to the DB target host:port as seen FROM the SSH server.
 *
 * Tunnels are keyed by connection ID and reused across pool factories.
 * Errors are surfaced as Error rejections; credentials are NEVER logged.
 */

import { Client as SSHClient, type ConnectConfig } from 'ssh2';
import net from 'net';
import fs from 'fs';
import { createLogger } from '../utils/index.js';
import type { SSHTunnelConfig } from '../../shared/database-types.js';

const log = createLogger('SSHTunnelService');

interface TunnelHandle {
  connectionId: string;            // Logical key (DB connection id, or transient id)
  localHost: string;               // Always 127.0.0.1
  localPort: number;               // Actual port the local server listens on
  remoteHost: string;              // DB host as seen from the SSH server
  remotePort: number;              // DB port
  client: SSHClient;
  server: net.Server;
  closed: boolean;
}

// Active tunnels keyed by connection ID. Stored as Promise so concurrent
// callers share a single bring-up.
const tunnels = new Map<string, Promise<TunnelHandle>>();

function buildSSHConnectConfig(cfg: SSHTunnelConfig): ConnectConfig {
  const base: ConnectConfig = {
    host: cfg.host,
    port: cfg.port || 22,
    username: cfg.username,
    readyTimeout: cfg.readyTimeoutMs ?? 20000,
    keepaliveInterval: cfg.keepaliveIntervalMs ?? 10000,
  };

  if (cfg.authMethod === 'password') {
    if (!cfg.password) {
      throw new Error('SSH password required when authMethod is "password"');
    }
    base.password = cfg.password;
    return base;
  }

  // privateKey auth: prefer inline, fall back to file path
  let key: Buffer | string | undefined;
  if (cfg.privateKey && cfg.privateKey.trim().length > 0) {
    key = cfg.privateKey;
  } else if (cfg.privateKeyPath && cfg.privateKeyPath.trim().length > 0) {
    try {
      key = fs.readFileSync(cfg.privateKeyPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read SSH private key file: ${msg}`);
    }
  }

  if (!key) {
    throw new Error('SSH private key required when authMethod is "privateKey"');
  }

  base.privateKey = key;
  if (cfg.passphrase) base.passphrase = cfg.passphrase;
  return base;
}

/**
 * Open the SSH client and listen on a local TCP port that forwards each
 * incoming connection to remoteHost:remotePort via the SSH server.
 */
function openTunnel(
  connectionId: string,
  cfg: SSHTunnelConfig,
  remoteHost: string,
  remotePort: number
): Promise<TunnelHandle> {
  return new Promise<TunnelHandle>((resolve, reject) => {
    let connectConfig: ConnectConfig;
    try {
      connectConfig = buildSSHConnectConfig(cfg);
    } catch (err) {
      reject(err);
      return;
    }

    const client = new SSHClient();
    let resolved = false;

    const cleanupOnFailure = (err: Error): void => {
      if (resolved) return;
      resolved = true;
      try { client.end(); } catch { /* ignore */ }
      reject(err);
    };

    client.on('error', (err) => {
      log.error(`SSH error for connection ${connectionId}: ${err.message}`);
      cleanupOnFailure(new Error(`SSH connection failed: ${err.message}`));
    });

    let handleRef: TunnelHandle | undefined;

    client.on('close', () => {
      if (handleRef && !handleRef.closed) {
        handleRef.closed = true;
        log.warn(`SSH client closed unexpectedly for ${connectionId}; tunnel marked dead`);
        try { handleRef.server.close(); } catch { /* ignore */ }
        // Remove from registry so next caller rebuilds the tunnel
        if (tunnels.get(connectionId) instanceof Promise) {
          tunnels.delete(connectionId);
        }
      }
    });

    client.on('ready', () => {
      const server = net.createServer((localSocket) => {
        client.forwardOut(
          '127.0.0.1',
          0,
          remoteHost,
          remotePort,
          (err, stream) => {
            if (err) {
              log.error(`Forward-out failed for ${connectionId}: ${err.message}`);
              localSocket.destroy(err);
              return;
            }
            localSocket.pipe(stream).pipe(localSocket);
            stream.on('error', () => localSocket.destroy());
            localSocket.on('error', () => stream.destroy());
          }
        );
      });

      server.on('error', (err) => {
        log.error(`Local tunnel server error (${connectionId}): ${err.message}`);
        cleanupOnFailure(err);
      });

      const desiredPort = cfg.localPort && cfg.localPort > 0 ? cfg.localPort : 0;
      server.listen(desiredPort, '127.0.0.1', () => {
        const addr = server.address();
        const localPort = typeof addr === 'object' && addr ? addr.port : desiredPort;
        if (!localPort) {
          cleanupOnFailure(new Error('Failed to determine local tunnel port'));
          return;
        }
        resolved = true;
        log.log(
          `Tunnel up: ${connectionId} 127.0.0.1:${localPort} -> ${cfg.host}:${cfg.port || 22} -> ${remoteHost}:${remotePort}`
        );
        const handle: TunnelHandle = {
          connectionId,
          localHost: '127.0.0.1',
          localPort,
          remoteHost,
          remotePort,
          client,
          server,
          closed: false,
        };
        handleRef = handle;
        resolve(handle);
      });
    });

    try {
      client.connect(connectConfig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      cleanupOnFailure(new Error(`Failed to start SSH connect: ${msg}`));
    }
  });
}

/**
 * Get or create a tunnel for the given connection ID. If a tunnel already
 * exists with the same target, it is reused; otherwise the prior one is
 * closed and a new one created.
 */
export async function getOrCreateTunnel(
  connectionId: string,
  cfg: SSHTunnelConfig,
  remoteHost: string,
  remotePort: number
): Promise<TunnelHandle> {
  const existingPromise = tunnels.get(connectionId);
  if (existingPromise) {
    try {
      const existing = await existingPromise;
      if (
        !existing.closed &&
        existing.remoteHost === remoteHost &&
        existing.remotePort === remotePort
      ) {
        return existing;
      }
    } catch {
      // Fall through and recreate
    }
    await closeTunnel(connectionId);
  }

  const created = openTunnel(connectionId, cfg, remoteHost, remotePort);
  tunnels.set(connectionId, created);
  try {
    return await created;
  } catch (err) {
    tunnels.delete(connectionId);
    throw err;
  }
}

/**
 * Run a one-off transient tunnel (no caching). Caller MUST close it.
 * Useful for "Test Connection" flows where we don't want to keep the
 * tunnel alive after the test.
 */
export async function openTransientTunnel(
  cfg: SSHTunnelConfig,
  remoteHost: string,
  remotePort: number
): Promise<TunnelHandle> {
  const transientId = `transient_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return openTunnel(transientId, cfg, remoteHost, remotePort);
}

/**
 * Close an active tunnel by connection ID.
 */
export async function closeTunnel(connectionId: string): Promise<void> {
  const promise = tunnels.get(connectionId);
  tunnels.delete(connectionId);
  if (!promise) return;

  try {
    const handle = await promise;
    await closeTunnelHandle(handle);
  } catch {
    // Already failed to open; nothing to close.
  }
}

/**
 * Close a tunnel handle (used for transient tunnels and via closeTunnel).
 */
export async function closeTunnelHandle(handle: TunnelHandle): Promise<void> {
  if (handle.closed) return;
  handle.closed = true;
  try {
    await new Promise<void>((resolve) => {
      handle.server.close(() => resolve());
    });
  } catch { /* ignore */ }
  try { handle.client.end(); } catch { /* ignore */ }
  log.log(`Tunnel closed: ${handle.connectionId}`);
}

/**
 * Close every active tunnel. Called during graceful shutdown.
 */
export async function closeAllTunnels(): Promise<void> {
  const ids = Array.from(tunnels.keys());
  await Promise.all(ids.map((id) => closeTunnel(id)));
}

/**
 * Snapshot of currently open tunnels (for status/debug).
 */
export async function listOpenTunnels(): Promise<Array<{
  connectionId: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}>> {
  const out: Array<{
    connectionId: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
  }> = [];
  for (const [id, promise] of tunnels.entries()) {
    try {
      const h = await promise;
      if (!h.closed) {
        out.push({
          connectionId: id,
          localPort: h.localPort,
          remoteHost: h.remoteHost,
          remotePort: h.remotePort,
        });
      }
    } catch { /* skip failed */ }
  }
  return out;
}

export type { TunnelHandle };
