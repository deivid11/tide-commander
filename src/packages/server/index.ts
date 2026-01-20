/**
 * Tide Commander Server
 * Entry point for the backend server
 */

import { createServer } from 'http';
import { createApp } from './app.js';
import { agentService, claudeService, supervisorService, bossService, skillService, customClassService } from './services/index.js';
import * as websocket from './websocket/handler.js';
import { getDataDir } from './data/index.js';
import { logger } from './utils/logger.js';

// Configuration
const PORT = process.env.PORT || 5174;

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

process.on('unhandledRejection', (reason, promise) => {
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
  claudeService.init();
  supervisorService.init();
  bossService.init();
  skillService.initSkills();
  customClassService.initCustomClasses();

  logger.server.log(`Data directory: ${getDataDir()}`);

  // Create Express app and HTTP server
  const app = createApp();
  const server = createServer(app);

  // Initialize WebSocket
  websocket.init(server);

  // Start server
  server.listen(PORT, () => {
    logger.server.log(`Server running on http://localhost:${PORT}`);
    logger.server.log(`WebSocket available at ws://localhost:${PORT}/ws`);
    logger.server.log(`API available at http://localhost:${PORT}/api`);
  });

  // Graceful shutdown
  // By default, don't kill Claude processes - they should continue running independently
  // Use SIGTERM (kill) to force-kill all processes, SIGINT (Ctrl+C) leaves them running
  process.on('SIGINT', async () => {
    logger.server.warn('Shutting down (SIGINT)... Claude processes will continue running');
    supervisorService.shutdown();
    bossService.shutdown();
    await claudeService.shutdown(false); // Don't kill processes - they continue independently
    agentService.persistAgents();
    server.close();
    process.exit(0);
  });

  // SIGTERM is used for force shutdown - kill all processes
  process.on('SIGTERM', async () => {
    logger.server.warn('Force shutting down (SIGTERM)... Killing all Claude processes');
    supervisorService.shutdown();
    bossService.shutdown();
    await claudeService.shutdown(true); // Force kill all processes
    agentService.persistAgents();
    server.close();
    process.exit(0);
  });
}

main().catch(console.error);
