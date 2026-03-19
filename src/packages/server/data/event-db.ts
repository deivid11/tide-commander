/**
 * Event Database Module
 * Manages SQLite connection, schema migrations, and typed helpers
 * for the centralized event store.
 *
 * Database location: ~/.local/share/tide-commander/events.db
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const log = createLogger('EventDB');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// XDG-compliant data directory (same as src/packages/server/data/index.ts)
const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const DB_PATH = path.join(DATA_DIR, 'events.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let db: Database.Database | null = null;

// ─── Lifecycle ───

export function initEventDb(): void {
  if (db) {
    log.warn('Event database already initialized');
    return;
  }

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for concurrent read safety
  db.pragma('journal_mode = WAL');
  // Busy timeout so concurrent writes don't fail immediately
  db.pragma('busy_timeout = 5000');

  log.log(`Opened event database at ${DB_PATH}`);

  runMigrations();
}

export function closeEventDb(): void {
  if (db) {
    db.close();
    db = null;
    log.log('Closed event database');
  }
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Event database not initialized. Call initEventDb() first.');
  }
  return db;
}

// ─── Schema Migration ───

function runMigrations(): void {
  const database = getDb();

  // Create migrations tracking table if it doesn't exist
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  // Get current version
  const row = database.prepare('SELECT MAX(version) as version FROM _migrations').get() as { version: number | null } | undefined;
  const currentVersion = row?.version ?? 0;

  // Find migration files
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    log.warn(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    return;
  }

  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    const name = match[2];

    if (version <= currentVersion) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

    log.log(`Applying migration ${version}: ${name}`);

    // Apply migration in a transaction
    database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version, name, Date.now()
      );
    })();

    log.log(`Migration ${version} applied successfully`);
  }
}

// ─── Helpers ───

export function insertOne<T extends Record<string, unknown>>(table: string, row: T): number {
  const database = getDb();
  const keys = Object.keys(row);
  const placeholders = keys.map(() => '?').join(', ');
  const columns = keys.join(', ');
  const values = keys.map(k => row[k]);

  const stmt = database.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`);
  const result = stmt.run(...values);
  return Number(result.lastInsertRowid);
}

export function queryMany<T>(sql: string, params?: unknown[]): T[] {
  const database = getDb();
  const stmt = database.prepare(sql);
  return (params ? stmt.all(...params) : stmt.all()) as T[];
}

export function queryOne<T>(sql: string, params?: unknown[]): T | undefined {
  const database = getDb();
  const stmt = database.prepare(sql);
  return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
}

export function execute(sql: string, params?: unknown[]): Database.RunResult {
  const database = getDb();
  const stmt = database.prepare(sql);
  return params ? stmt.run(...params) : stmt.run();
}

export function transaction<T>(fn: () => T): T {
  const database = getDb();
  return database.transaction(fn)();
}
