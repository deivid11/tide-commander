/**
 * Event Retention Service
 * Daily cleanup job that deletes events older than the configured retention period.
 * Default: 90 days. Configurable via ~/.local/share/tide-commander/event-retention.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDb, execute, transaction } from '../data/event-db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('EventRetention');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const RETENTION_CONFIG_FILE = path.join(DATA_DIR, 'event-retention.json');

// 24 hours in milliseconds
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface RetentionConfig {
  retentionDays: number;
  cleanupEnabled: boolean;
}

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

function loadRetentionConfig(): RetentionConfig {
  try {
    if (fs.existsSync(RETENTION_CONFIG_FILE)) {
      const raw = fs.readFileSync(RETENTION_CONFIG_FILE, 'utf-8');
      const config = JSON.parse(raw) as Partial<RetentionConfig>;
      return {
        retentionDays: config.retentionDays ?? 90,
        cleanupEnabled: config.cleanupEnabled ?? true,
      };
    }
  } catch {
    log.warn('Failed to read retention config, using defaults');
  }
  return { retentionDays: 90, cleanupEnabled: true };
}

// Tables and their timestamp columns
const EVENT_TABLES: Array<{ table: string; timestampCol: string }> = [
  { table: 'trigger_events', timestampCol: 'fired_at' },
  { table: 'slack_messages', timestampCol: 'received_at' },
  { table: 'email_messages', timestampCol: 'received_at' },
  { table: 'email_approval_events', timestampCol: 'recorded_at' },
  { table: 'document_generations', timestampCol: 'generated_at' },
  { table: 'calendar_event_logs', timestampCol: 'recorded_at' },
  { table: 'jira_ticket_logs', timestampCol: 'recorded_at' },
  { table: 'workflow_step_log', timestampCol: 'entered_at' },
  { table: 'workflow_variable_changes', timestampCol: 'changed_at' },
  { table: 'audit_log', timestampCol: 'created_at' },
];

export function cleanupOldEvents(retentionDays: number): void {
  const cutoffMs = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  log.log(`Running cleanup: deleting events older than ${retentionDays} days (before ${new Date(cutoffMs).toISOString()})`);

  transaction(() => {
    for (const { table, timestampCol } of EVENT_TABLES) {
      const result = execute(
        `DELETE FROM ${table} WHERE ${timestampCol} < ?`,
        [cutoffMs]
      );
      if (result.changes > 0) {
        log.log(`  ${table}: deleted ${result.changes} rows`);
      }
    }

    // Also clean up completed workflow instances older than retention
    const wfResult = execute(
      'DELETE FROM workflow_instances WHERE completed_at IS NOT NULL AND completed_at < ?',
      [cutoffMs]
    );
    if (wfResult.changes > 0) {
      log.log(`  workflow_instances (completed): deleted ${wfResult.changes} rows`);
    }
  });

  log.log('Cleanup complete');
}

export function getDbSize(): { sizeBytes: number; rowCounts: Record<string, number> } {
  const db = getDb();
  const rowCounts: Record<string, number> = {};

  const allTables = [
    ...EVENT_TABLES.map(t => t.table),
    'workflow_instances',
  ];

  for (const table of allTables) {
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
    rowCounts[table] = row.count;
  }

  // Get DB file size
  const dbPath = path.join(DATA_DIR, 'events.db');
  let sizeBytes = 0;
  try {
    const stat = fs.statSync(dbPath);
    sizeBytes = stat.size;
    // Also add WAL file size if it exists
    const walPath = dbPath + '-wal';
    if (fs.existsSync(walPath)) {
      sizeBytes += fs.statSync(walPath).size;
    }
  } catch {
    // DB file may not exist yet
  }

  return { sizeBytes, rowCounts };
}

function scheduleCleanup(): void {
  const config = loadRetentionConfig();

  if (!config.cleanupEnabled) {
    log.log('Event cleanup disabled via config');
    return;
  }

  cleanupTimer = setTimeout(() => {
    try {
      const freshConfig = loadRetentionConfig();
      if (freshConfig.cleanupEnabled) {
        cleanupOldEvents(freshConfig.retentionDays);
      }
    } catch (err) {
      log.error('Cleanup job failed:', err);
    }
    // Re-schedule for next day
    scheduleCleanup();
  }, CLEANUP_INTERVAL_MS);

  // Don't keep the process alive just for cleanup
  cleanupTimer.unref();
}

export function init(): void {
  const config = loadRetentionConfig();
  log.log(`Event retention: ${config.retentionDays} days, cleanup ${config.cleanupEnabled ? 'enabled' : 'disabled'}`);

  // Run initial cleanup on startup
  if (config.cleanupEnabled) {
    try {
      cleanupOldEvents(config.retentionDays);
    } catch (err) {
      log.error('Initial cleanup failed:', err);
    }
  }

  // Schedule daily cleanup
  scheduleCleanup();
}

export function shutdown(): void {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
}
