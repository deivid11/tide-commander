/**
 * Tide Commander Server
 * Entry point for the backend server
 */

import 'dotenv/config';

import { createServer } from 'http';
import type { Server as HttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import type { Server as HttpsServer } from 'https';
import fs from 'node:fs';
import type { Socket } from 'node:net';
import { createApp } from './app.js';
import { agentService, runtimeService, bossService, skillService, customClassService, secretsService, buildingService, eventRetentionService, triggerService, autoCollapseService, workflowService, databaseService } from './services/index.js';
import * as websocket from './websocket/handler.js';
import { getDataDir } from './data/index.js';
import { initEventDb, closeEventDb } from './data/event-db.js';
import * as eventQueries from './data/event-queries.js';
import { logger, closeFileLogging, getLogFilePath, createLogger } from './utils/logger.js';
import { setupTerminalWsProxy } from './services/terminal-proxy.js';
import { initIntegrations, shutdownIntegrations, getIntegrationTriggerHandlers } from './integrations/integration-registry.js';
import { initBackupService, shutdownBackupService } from './services/backup-service.js';
import { initAutoUpdateService, shutdownAutoUpdateService } from './services/auto-update-service.js';
import { initAttachmentJanitor, shutdownAttachmentJanitor } from './services/attachment-janitor.js';
import { stopAllAgentTerminals, sweepAllAgentTtyds } from './services/agent-terminal-service.js';
import {
  initClaudeCredentialKeepAlive,
  shutdownClaudeCredentialKeepAlive,
} from './services/claude-credentials-service.js';
import type { IntegrationContext } from '../shared/integration-types.js';

// Configuration
const PORT = process.env.PORT || 6200;
const HOST = process.env.HOST || (process.env.LISTEN_ALL_INTERFACES ? '::' : '127.0.0.1');
const HTTPS_ENABLED = process.env.HTTPS === '1';
const TLS_KEY_PATH = process.env.TLS_KEY_PATH;
const TLS_CERT_PATH = process.env.TLS_CERT_PATH;
// When set, TLS is served on this port IN ADDITION to plain HTTP on PORT, so
// http:// and https:// clients can both connect to the same instance. Takes
// precedence over HTTPS=1 (which serves TLS on PORT and nothing in the clear).
const HTTPS_PORT = process.env.HTTPS_PORT ? Number(process.env.HTTPS_PORT) : null;
const FORCE_SHUTDOWN_TIMEOUT_MS = 4500;

// ============================================================================
// Global Error Handlers
// ============================================================================
// These handlers prevent the commander from crashing on unhandled errors.
// With childProcess.unref(), Claude processes will continue running even if
// the commander crashes, but these handlers help prevent crashes in the first place.

process.on('uncaughtException', (err) => {
  logger.server.error('Uncaught exception (commander will continue):', err);
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'EADDRINUSE') {
    logger.server.error('Fatal startup error: address already in use, exiting process');
    closeFileLogging();
    process.exit(1);
  }
  // Log the error but don't exit - agents should continue running
  // In production, you might want to notify monitoring systems here
});

process.on('unhandledRejection', (reason, _promise) => {
  logger.server.error('Unhandled promise rejection (commander will continue):', reason);
  // Log but don't crash - async errors shouldn't kill all agents
});

// Ignore SIGHUP - this is sent when a terminal closes
// We want the commander to keep running even if the terminal is closed
process.on('SIGHUP', () => {
  logger.server.warn('Received SIGHUP (terminal closed) - ignoring, commander continues running');
  // Don't exit - just log and continue
});

// Handle SIGPIPE gracefully (broken pipe - happens when client disconnects)
process.on('SIGPIPE', () => {
  logger.server.warn('Received SIGPIPE (broken pipe) - ignoring');
});

async function main(): Promise<void> {
  // Initialize event database FIRST — before any service that logs events
  initEventDb();
  eventRetentionService.init();

  // Initialize services
  agentService.initAgents();
  agentService.initSessionHistory();
  runtimeService.init();
  // Clean up any agent terminal viewers orphaned by a prior instance.
  sweepAllAgentTtyds();
  bossService.init();
  skillService.initSkills();
  customClassService.initCustomClasses();
  secretsService.initSecrets();
  triggerService.initTriggers();
  autoCollapseService.initAutoCollapse();
  workflowService.initWorkflows();

  // Initialize integration plugins
  const integrationCtx: IntegrationContext = {
    eventDb: {
      logTriggerFire: eventQueries.logTriggerFire as (...args: unknown[]) => unknown,
      logSlackMessage: eventQueries.logSlackMessage as (...args: unknown[]) => unknown,
      hasSlackMessage: eventQueries.hasSlackMessage,
      recentSlackThreadActivity: eventQueries.recentSlackThreadActivity,
      logWhatsAppMessage: eventQueries.logWhatsAppMessage as (...args: unknown[]) => unknown,
      logEmailMessage: eventQueries.logEmailMessage as (...args: unknown[]) => unknown,
      logApprovalEvent: eventQueries.logApprovalEvent as (...args: unknown[]) => unknown,
      logDocumentGeneration: eventQueries.logDocumentGeneration as (...args: unknown[]) => unknown,
      logCalendarAction: eventQueries.logCalendarAction as (...args: unknown[]) => unknown,
      logDriveAction: eventQueries.logDriveAction as (...args: unknown[]) => unknown,
      logJiraTicketAction: eventQueries.logJiraTicketAction as (...args: unknown[]) => unknown,
      logAudit: eventQueries.logAudit as (...args: unknown[]) => unknown,
    },
    sendAgentMessage: async (agentId: string, message: string) => {
      await runtimeService.sendCommand(agentId, message);
    },
    broadcast: (message: unknown) => {
      websocket.broadcast(message as never);
    },
    secrets: {
      get: (key: string) => {
        const secret = secretsService.getSecretByKey(key);
        return secret?.value;
      },
      set: (key: string, value: string) => {
        const existing = secretsService.getSecretByKey(key);
        if (existing) {
          const result = secretsService.updateSecret(existing.id, { value });
          if (result && 'error' in result) {
            throw new Error(result.error);
          }
        } else {
          const result = secretsService.createSecret({ key, value, name: key });
          // If key already exists error, try to find and update it
          if ('error' in result && result.error.includes('already exists')) {
            const retry = secretsService.getSecretByKey(key);
            if (retry) {
              const updateResult = secretsService.updateSecret(retry.id, { value });
              if (updateResult && 'error' in updateResult) {
                throw new Error(updateResult.error);
              }
              return;
            }
          }
          // Otherwise throw the original error
          if ('error' in result) {
            throw new Error(result.error);
          }
        }
      },
    },
    serverConfig: {
      port: Number(PORT),
      host: String(HOST),
      authToken: process.env.AUTH_TOKEN,
      baseUrl: `http://localhost:${PORT}`,
    },
    log: {
      info: (msg: string, ...args: unknown[]) => createLogger('Integration').log(msg, ...args),
      warn: (msg: string, ...args: unknown[]) => createLogger('Integration').warn(msg, ...args),
      error: (msg: string, ...args: unknown[]) => createLogger('Integration').error(msg, ...args),
    },
  };
  await initIntegrations(integrationCtx);

  // Load integration skills now that plugins are initialized
  skillService.loadIntegrationSkills();

  // Register integration trigger handlers (Slack, Jira, etc.) with the trigger service
  for (const handler of getIntegrationTriggerHandlers()) {
    triggerService.registerHandler(handler);
  }

  // Start hourly backup scheduler (reads persisted enabled/disabled setting)
  initBackupService();

  // Start unattended-update scheduler (opt-in; disabled by default)
  initAutoUpdateService();

  // Start hourly sweeper for the trigger-attachment temp dir.
  initAttachmentJanitor();

  // Keep every saved Claude OAuth account warm while Tide Commander is on.
  initClaudeCredentialKeepAlive();

  logger.server.log(`Data directory: ${getDataDir()}`);
  logger.server.log(`Log file: ${getLogFilePath()}`);

  // Create Express app and HTTP server(s)
  const app = createApp();

  const readTlsOptions = (reason: string): { key: Buffer; cert: Buffer } => ({
    key: fs.readFileSync(assertTlsPath(TLS_KEY_PATH, 'TLS_KEY_PATH', reason)),
    cert: fs.readFileSync(assertTlsPath(TLS_CERT_PATH, 'TLS_CERT_PATH', reason)),
  });

  if (HTTPS_PORT && HTTPS_ENABLED) {
    logger.server.warn('HTTPS=1 and HTTPS_PORT are both set; HTTPS_PORT wins '
      + `(plain HTTP on ${PORT}, TLS on ${HTTPS_PORT})`);
  }

  // Listener set: either a single server (legacy) or HTTP + HTTPS side by side.
  const listeners: Array<{ server: HttpServer | HttpsServer; protocol: 'http' | 'https'; port: number }> =
    HTTPS_PORT
      ? [
        { server: createServer(app), protocol: 'http', port: Number(PORT) },
        { server: createHttpsServer(readTlsOptions('HTTPS_PORT'), app), protocol: 'https', port: HTTPS_PORT },
      ]
      : [{
        server: HTTPS_ENABLED ? createHttpsServer(readTlsOptions('HTTPS=1'), app) : createServer(app),
        protocol: HTTPS_ENABLED ? 'https' : 'http',
        port: Number(PORT),
      }];

  const primary = listeners[0].server;
  const sockets = new Set<Socket>();

  for (const { server: listener } of listeners) {
    // Node closes idle keep-alive sockets after 5s by default; browsers hold
    // them in their pool far longer. When the two race — the browser writes a
    // request onto a socket the server is closing — the request dies mid-flight.
    // Browsers silently retry idempotent GETs, but never a POST, so the symptom
    // is an upload failing with net::ERR_FAILED while every GET looks fine, and
    // server-side an ECONNRESET the instant the headers land. Widen the window
    // past any browser's idle timeout; headersTimeout must stay above it.
    listener.keepAliveTimeout = 75_000;
    listener.headersTimeout = 80_000;

    listener.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.on('close', () => {
        sockets.delete(socket);
      });
    });
  }

  // Initialize WebSocket. Every listener shares one WebSocketServer so clients
  // land in the same client set no matter which scheme they arrived over.
  const wss = websocket.init(primary);
  for (const { server: listener } of listeners.slice(1)) {
    websocket.attachServer(listener, wss);
  }

  // Set up terminal WebSocket proxy for ttyd buildings
  // (HTTP proxy is set up in app.ts before API routes)
  for (const { server: listener } of listeners) {
    setupTerminalWsProxy(listener);
  }

  // Set up skill hot-reload (must be after websocket init to have broadcast available)
  skillService.setupSkillHotReload(agentService, runtimeService, websocket.broadcast);

  // Start PM2 status polling for buildings
  buildingService.startPM2StatusPolling(websocket.broadcast);

  // Start Docker status polling for buildings
  buildingService.startDockerStatusPolling(websocket.broadcast);

  // Start terminal (ttyd) status polling for buildings
  buildingService.startTerminalStatusPolling(websocket.broadcast);

  // Start server(s)
  for (const { server: listener, protocol, port } of listeners) {
    listener.on('error', (err: NodeJS.ErrnoException) => {
      logger.server.error(`Server listen error (${protocol}:${port}):`, err);
      if (err.code === 'EADDRINUSE') {
        logger.server.error(`Port ${port} is already in use. Exiting.`);
        closeFileLogging();
        process.exit(1);
      }
    });

    listener.listen(port, HOST, () => {
      const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
      logger.server.log(`Server running on ${protocol}://${HOST}:${port}`);
      logger.server.log(`WebSocket available at ${wsProtocol}://${HOST}:${port}/ws`);
      logger.server.log(`API available at ${protocol}://${HOST}:${port}/api`);
    });
  }

  let isShuttingDown = false;
  const gracefulShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      logger.server.warn(`Shutdown already in progress (received ${signal})`);
      return;
    }

    isShuttingDown = true;
    logger.server.warn(`Shutting down on ${signal}...`);

    const forceShutdownTimer = setTimeout(() => {
      logger.server.error(`Forced shutdown after ${FORCE_SHUTDOWN_TIMEOUT_MS}ms timeout on ${signal}`);
      closeFileLogging();
      process.exit(0);
    }, FORCE_SHUTDOWN_TIMEOUT_MS);
    forceShutdownTimer.unref();

    try {
      shutdownBackupService();
      shutdownAutoUpdateService();
      shutdownAttachmentJanitor();
      shutdownClaudeCredentialKeepAlive();
      triggerService.shutdown();
      autoCollapseService.shutdown();
      workflowService.shutdown();
      await shutdownIntegrations();
      bossService.shutdown();
      eventRetentionService.shutdown();
      buildingService.stopPM2StatusPolling();
      buildingService.stopDockerStatusPolling();
      buildingService.stopTerminalStatusPolling();
      buildingService.cleanupAllTerminals();
      stopAllAgentTerminals();
      await databaseService.closeAllConnections();
      await runtimeService.shutdown();
      agentService.shutdownSessionHistory();
      agentService.flushPersistAgents();
      closeEventDb();
      wss.clients.forEach((client) => client.terminate());
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      sockets.forEach((socket) => socket.destroy());
      await Promise.all(listeners.map(({ server: listener }) => (
        new Promise<void>((resolve) => listener.close(() => resolve()))
      )));
      clearTimeout(forceShutdownTimer);
      closeFileLogging();
      process.exit(0);
    } catch (err) {
      clearTimeout(forceShutdownTimer);
      logger.server.error(`Graceful shutdown failed on ${signal}:`, err);
      closeFileLogging();
      process.exit(1);
    }
  };

  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
}

function assertTlsPath(value: string | undefined, envName: string, reason: string): string {
  if (!value) {
    throw new Error(`${envName} is required when ${reason} is set`);
  }
  return value;
}

main().catch(console.error);
