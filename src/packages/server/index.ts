/**
 * Tide Commander Server
 * Entry point for the backend server
 */

import 'dotenv/config';

import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import fs from 'node:fs';
import type { Socket } from 'node:net';
import { createApp } from './app.js';
import { agentService, runtimeService, supervisorService, bossService, skillService, customClassService, secretsService, buildingService, eventRetentionService, triggerService, workflowService } from './services/index.js';
import * as websocket from './websocket/handler.js';
import { getDataDir } from './data/index.js';
import { initEventDb, closeEventDb } from './data/event-db.js';
import * as eventQueries from './data/event-queries.js';
import { logger, closeFileLogging, getLogFilePath, createLogger } from './utils/logger.js';
import { setupTerminalWsProxy } from './services/terminal-proxy.js';
import { initIntegrations, shutdownIntegrations, getIntegrationTriggerHandlers } from './integrations/integration-registry.js';
import type { IntegrationContext } from '../shared/integration-types.js';

// Configuration
const PORT = process.env.PORT || 6200;
const HOST = process.env.HOST || (process.env.LISTEN_ALL_INTERFACES ? '::' : '127.0.0.1');
const HTTPS_ENABLED = process.env.HTTPS === '1';
const TLS_KEY_PATH = process.env.TLS_KEY_PATH;
const TLS_CERT_PATH = process.env.TLS_CERT_PATH;
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
  supervisorService.init();
  bossService.init();
  skillService.initSkills();
  customClassService.initCustomClasses();
  secretsService.initSecrets();
  triggerService.initTriggers();
  workflowService.initWorkflows();

  // Initialize integration plugins
  const integrationCtx: IntegrationContext = {
    eventDb: {
      logTriggerFire: eventQueries.logTriggerFire as (...args: unknown[]) => unknown,
      logSlackMessage: eventQueries.logSlackMessage as (...args: unknown[]) => unknown,
      logEmailMessage: eventQueries.logEmailMessage as (...args: unknown[]) => unknown,
      logApprovalEvent: eventQueries.logApprovalEvent as (...args: unknown[]) => unknown,
      logDocumentGeneration: eventQueries.logDocumentGeneration as (...args: unknown[]) => unknown,
      logCalendarAction: eventQueries.logCalendarAction as (...args: unknown[]) => unknown,
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

  logger.server.log(`Data directory: ${getDataDir()}`);
  logger.server.log(`Log file: ${getLogFilePath()}`);

  // Create Express app and HTTP server
  const app = createApp();
  const server = HTTPS_ENABLED
    ? createHttpsServer(
      {
        key: fs.readFileSync(assertTlsPath(TLS_KEY_PATH, 'TLS_KEY_PATH')),
        cert: fs.readFileSync(assertTlsPath(TLS_CERT_PATH, 'TLS_CERT_PATH')),
      },
      app,
    )
    : createServer(app);
  const sockets = new Set<Socket>();

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  // Initialize WebSocket
  const wss = websocket.init(server);

  // Set up terminal WebSocket proxy for ttyd buildings
  // (HTTP proxy is set up in app.ts before API routes)
  setupTerminalWsProxy(server);

  // Set up skill hot-reload (must be after websocket init to have broadcast available)
  skillService.setupSkillHotReload(agentService, runtimeService, websocket.broadcast);

  // Start PM2 status polling for buildings
  buildingService.startPM2StatusPolling(websocket.broadcast);

  // Start Docker status polling for buildings
  buildingService.startDockerStatusPolling(websocket.broadcast);

  // Start terminal (ttyd) status polling for buildings
  buildingService.startTerminalStatusPolling(websocket.broadcast);

  // Start server
  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.server.error('Server listen error:', err);
    if (err.code === 'EADDRINUSE') {
      logger.server.error(`Port ${PORT} is already in use. Exiting.`);
      closeFileLogging();
      process.exit(1);
    }
  });

  server.listen(Number(PORT), HOST, () => {
    const protocol = HTTPS_ENABLED ? 'https' : 'http';
    const wsProtocol = HTTPS_ENABLED ? 'wss' : 'ws';
    logger.server.log(`Server running on ${protocol}://${HOST}:${PORT}`);
    logger.server.log(`WebSocket available at ${wsProtocol}://${HOST}:${PORT}/ws`);
    logger.server.log(`API available at ${protocol}://${HOST}:${PORT}/api`);
  });

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
      triggerService.shutdown();
      workflowService.shutdown();
      await shutdownIntegrations();
      supervisorService.shutdown();
      bossService.shutdown();
      eventRetentionService.shutdown();
      buildingService.stopPM2StatusPolling();
      buildingService.stopDockerStatusPolling();
      buildingService.stopTerminalStatusPolling();
      buildingService.cleanupAllTerminals();
      await runtimeService.shutdown();
      agentService.shutdownSessionHistory();
      agentService.flushPersistAgents();
      closeEventDb();
      wss.clients.forEach((client) => client.terminate());
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
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

function assertTlsPath(value: string | undefined, envName: string): string {
  if (!value) {
    throw new Error(`${envName} is required when HTTPS=1`);
  }
  return value;
}

main().catch(console.error);
