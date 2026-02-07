/**
 * Tide Commander Server
 * Entry point for the backend server
 */

import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app.js';
import { agentService, runtimeService, supervisorService, bossService, skillService, customClassService, secretsService, buildingService } from './services/index.js';
import * as websocket from './websocket/handler.js';
import { getDataDir } from './data/index.js';
import { logger, closeFileLogging, getLogFilePath } from './utils/logger.js';

// Configuration
const PORT = process.env.PORT || 5174;
const HOST = process.env.LISTEN_ALL_INTERFACES ? '::' : '127.0.0.1';

// ============================================================================
// Global Error Handlers
// ============================================================================
// These handlers prevent the commander from crashing on unhandled errors.
// With childProcess.unref(), Claude processes will continue running even if
// the commander crashes, but these handlers help prevent crashes in the first place.

process.on('uncaughtException', (err) => {
  logger.server.error('Uncaught exception (commander will continue):', err);
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
  // Initialize services
  agentService.initAgents();
  runtimeService.init();
  supervisorService.init();
  bossService.init();
  skillService.initSkills();
  customClassService.initCustomClasses();
  secretsService.initSecrets();

  logger.server.log(`Data directory: ${getDataDir()}`);
  logger.server.log(`Log file: ${getLogFilePath()}`);

  // Create Express app and HTTP server
  const app = createApp();
  const server = createServer(app);

  // Initialize WebSocket
  websocket.init(server);

  // Set up skill hot-reload (must be after websocket init to have broadcast available)
  skillService.setupSkillHotReload(agentService, runtimeService, websocket.broadcast);

  // Start PM2 status polling for buildings
  buildingService.startPM2StatusPolling(websocket.broadcast);

  // Start Docker status polling for buildings
  buildingService.startDockerStatusPolling(websocket.broadcast);

  // Start server
  server.listen(Number(PORT), HOST, () => {
    logger.server.log(`Server running on http://${HOST}:${PORT}`);
    logger.server.log(`WebSocket available at ws://${HOST}:${PORT}/ws`);
    logger.server.log(`API available at http://${HOST}:${PORT}/api`);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.server.warn('Shutting down...');
    supervisorService.shutdown();
    bossService.shutdown();
    buildingService.stopPM2StatusPolling();
    buildingService.stopDockerStatusPolling();
    await runtimeService.shutdown();
    agentService.persistAgents();
    server.close();
    closeFileLogging();
    process.exit(0);
  });
}

main().catch(console.error);
