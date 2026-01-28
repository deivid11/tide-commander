/**
 * Database Service
 * Handles database connections and query execution for MySQL and PostgreSQL
 */

import mysql from 'mysql2/promise';
import pg from 'pg';
import type {
  DatabaseConnection,
  DatabaseEngine,
  QueryResult,
  QueryField,
  QueryHistoryEntry,
  TableColumn,
  TableIndex,
  ForeignKey,
  TableInfo,
} from '../../shared/types.js';
import { loadQueryHistory, saveQueryHistory } from '../data/index.js';

// Connection pool storage
const mysqlPools = new Map<string, mysql.Pool>();
const pgPools = new Map<string, pg.Pool>();

// In-memory query history cache
const queryHistoryCache = new Map<string, QueryHistoryEntry[]>();

/**
 * Generate a unique key for connection pooling
 */
function getConnectionKey(connection: DatabaseConnection, database?: string): string {
  return `${connection.id}:${database || connection.database || 'default'}`;
}

/**
 * Get or create a MySQL connection pool
 */
async function getMySQLPool(connection: DatabaseConnection, database?: string): Promise<mysql.Pool> {
  const key = getConnectionKey(connection, database);

  if (mysqlPools.has(key)) {
    return mysqlPools.get(key)!;
  }

  const pool = mysql.createPool({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: connection.password,
    database: database || connection.database,
    ssl: connection.ssl ? {
      rejectUnauthorized: connection.sslConfig?.rejectUnauthorized ?? true,
      ca: connection.sslConfig?.ca,
      cert: connection.sslConfig?.cert,
      key: connection.sslConfig?.key,
    } : undefined,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

  mysqlPools.set(key, pool);
  return pool;
}

/**
 * Get or create a PostgreSQL connection pool
 */
async function getPgPool(connection: DatabaseConnection, database?: string): Promise<pg.Pool> {
  const key = getConnectionKey(connection, database);

  if (pgPools.has(key)) {
    return pgPools.get(key)!;
  }

  const pool = new pg.Pool({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: connection.password,
    database: database || connection.database || 'postgres',
    ssl: connection.ssl ? {
      rejectUnauthorized: connection.sslConfig?.rejectUnauthorized ?? true,
      ca: connection.sslConfig?.ca,
      cert: connection.sslConfig?.cert,
      key: connection.sslConfig?.key,
    } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pgPools.set(key, pool);
  return pool;
}

/**
 * Test a database connection
 */
export async function testConnection(
  connection: DatabaseConnection
): Promise<{ success: boolean; error?: string; serverVersion?: string }> {
  try {
    if (connection.engine === 'mysql') {
      const pool = await getMySQLPool(connection);
      const [rows] = await pool.query('SELECT VERSION() as version');
      const version = (rows as Array<{ version: string }>)[0]?.version;
      return { success: true, serverVersion: version };
    } else if (connection.engine === 'postgresql') {
      const pool = await getPgPool(connection);
      const result = await pool.query('SELECT version()');
      const version = result.rows[0]?.version?.split(' ').slice(0, 2).join(' ');
      return { success: true, serverVersion: version };
    }
    return { success: false, error: 'Unsupported database engine' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * List all databases available on the connection
 */
export async function listDatabases(connection: DatabaseConnection): Promise<string[]> {
  try {
    if (connection.engine === 'mysql') {
      const pool = await getMySQLPool(connection);
      const [rows] = await pool.query('SHOW DATABASES');
      return (rows as Array<{ Database: string }>).map(r => r.Database);
    } else if (connection.engine === 'postgresql') {
      const pool = await getPgPool(connection);
      const result = await pool.query(
        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
      );
      return result.rows.map(r => r.datname);
    }
    return [];
  } catch (error) {
    console.error('Error listing databases:', error);
    throw error;
  }
}

/**
 * List all tables in a database
 */
export async function listTables(
  connection: DatabaseConnection,
  database: string
): Promise<TableInfo[]> {
  try {
    if (connection.engine === 'mysql') {
      const pool = await getMySQLPool(connection, database);
      const [rows] = await pool.query(`
        SELECT
          TABLE_NAME as name,
          TABLE_TYPE as type,
          ENGINE as engine,
          TABLE_ROWS as \`rows\`,
          DATA_LENGTH + INDEX_LENGTH as size,
          TABLE_COMMENT as comment
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME
      `, [database]);

      return (rows as Array<{
        name: string;
        type: string;
        engine: string;
        rows: number;
        size: number;
        comment: string;
      }>).map(r => ({
        name: r.name,
        type: r.type === 'VIEW' ? 'view' : 'table',
        engine: r.engine,
        rows: r.rows,
        size: r.size,
        comment: r.comment || undefined,
      }));
    } else if (connection.engine === 'postgresql') {
      const pool = await getPgPool(connection, database);
      const result = await pool.query(`
        SELECT
          t.tablename as name,
          'table' as type,
          pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)) as size,
          obj_description((quote_ident(t.schemaname) || '.' || quote_ident(t.tablename))::regclass) as comment
        FROM pg_tables t
        WHERE t.schemaname = 'public'
        UNION ALL
        SELECT
          v.viewname as name,
          'view' as type,
          0 as size,
          obj_description((quote_ident(v.schemaname) || '.' || quote_ident(v.viewname))::regclass) as comment
        FROM pg_views v
        WHERE v.schemaname = 'public'
        ORDER BY name
      `);

      return result.rows.map(r => ({
        name: r.name,
        type: r.type as 'table' | 'view',
        size: parseInt(r.size) || undefined,
        comment: r.comment || undefined,
      }));
    }
    return [];
  } catch (error) {
    console.error('Error listing tables:', error);
    throw error;
  }
}

/**
 * Get table schema (columns, indexes, foreign keys)
 */
export async function getTableSchema(
  connection: DatabaseConnection,
  database: string,
  table: string
): Promise<{ columns: TableColumn[]; indexes: TableIndex[]; foreignKeys: ForeignKey[] }> {
  const columns: TableColumn[] = [];
  const indexes: TableIndex[] = [];
  const foreignKeys: ForeignKey[] = [];

  try {
    if (connection.engine === 'mysql') {
      const pool = await getMySQLPool(connection, database);

      // Get columns
      const [columnRows] = await pool.query(`
        SELECT
          COLUMN_NAME as name,
          COLUMN_TYPE as type,
          IS_NULLABLE as nullable,
          COLUMN_DEFAULT as defaultValue,
          COLUMN_KEY as columnKey,
          EXTRA as extra,
          COLUMN_COMMENT as comment
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [database, table]);

      for (const col of columnRows as Array<{
        name: string;
        type: string;
        nullable: string;
        defaultValue: string | null;
        columnKey: string;
        extra: string;
        comment: string;
      }>) {
        columns.push({
          name: col.name,
          type: col.type,
          nullable: col.nullable === 'YES',
          defaultValue: col.defaultValue ?? undefined,
          primaryKey: col.columnKey === 'PRI',
          autoIncrement: col.extra.includes('auto_increment'),
          comment: col.comment || undefined,
        });
      }

      // Get indexes
      const [indexRows] = await pool.query(`
        SELECT
          INDEX_NAME as name,
          GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns,
          NOT NON_UNIQUE as isUnique,
          INDEX_TYPE as type
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE
      `, [database, table]);

      for (const idx of indexRows as Array<{
        name: string;
        columns: string;
        isUnique: number;
        type: string;
      }>) {
        indexes.push({
          name: idx.name,
          columns: idx.columns.split(','),
          unique: Boolean(idx.isUnique),
          type: idx.type,
        });
      }

      // Get foreign keys
      const [fkRows] = await pool.query(`
        SELECT
          kcu.CONSTRAINT_NAME as name,
          GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) as columns,
          kcu.REFERENCED_TABLE_NAME as referencedTable,
          GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) as referencedColumns,
          rc.DELETE_RULE as onDelete,
          rc.UPDATE_RULE as onUpdate
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
          AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        GROUP BY kcu.CONSTRAINT_NAME, kcu.REFERENCED_TABLE_NAME, rc.DELETE_RULE, rc.UPDATE_RULE
      `, [database, table]);

      for (const fk of fkRows as Array<{
        name: string;
        columns: string;
        referencedTable: string;
        referencedColumns: string;
        onDelete: string;
        onUpdate: string;
      }>) {
        foreignKeys.push({
          name: fk.name,
          columns: fk.columns.split(','),
          referencedTable: fk.referencedTable,
          referencedColumns: fk.referencedColumns.split(','),
          onDelete: fk.onDelete,
          onUpdate: fk.onUpdate,
        });
      }
    } else if (connection.engine === 'postgresql') {
      const pool = await getPgPool(connection, database);

      // Get columns
      const columnResult = await pool.query(`
        SELECT
          a.attname as name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
          NOT a.attnotnull as nullable,
          pg_get_expr(d.adbin, d.adrelid) as "defaultValue",
          COALESCE(pk.is_pk, false) as "primaryKey",
          a.attidentity != '' OR COALESCE(s.is_serial, false) as "autoIncrement",
          col_description(c.oid, a.attnum) as comment
        FROM pg_class c
        JOIN pg_attribute a ON a.attrelid = c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        LEFT JOIN (
          SELECT kcu.column_name, true as is_pk
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
        ) pk ON pk.column_name = a.attname
        LEFT JOIN (
          SELECT column_name, true as is_serial
          FROM information_schema.columns
          WHERE table_name = $1 AND column_default LIKE 'nextval%'
        ) s ON s.column_name = a.attname
        WHERE c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
      `, [table]);

      for (const col of columnResult.rows) {
        columns.push({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          defaultValue: col.defaultValue ?? undefined,
          primaryKey: col.primaryKey,
          autoIncrement: col.autoIncrement,
          comment: col.comment || undefined,
        });
      }

      // Get indexes
      const indexResult = await pool.query(`
        SELECT
          i.relname as name,
          array_agg(a.attname ORDER BY x.n) as columns,
          ix.indisunique as "unique",
          am.amname as type
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_am am ON am.oid = i.relam
        CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
        WHERE t.relname = $1 AND t.relkind = 'r'
        GROUP BY i.relname, ix.indisunique, am.amname
      `, [table]);

      for (const idx of indexResult.rows) {
        indexes.push({
          name: idx.name,
          columns: idx.columns,
          unique: idx.unique,
          type: idx.type,
        });
      }

      // Get foreign keys
      const fkResult = await pool.query(`
        SELECT
          conname as name,
          array_agg(a.attname ORDER BY x.n) as columns,
          confrelid::regclass::text as "referencedTable",
          array_agg(af.attname ORDER BY x.n) as "referencedColumns",
          CASE confdeltype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
          END as "onDelete",
          CASE confupdtype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
          END as "onUpdate"
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS x(attnum, fkattnum, n)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum
        JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = x.fkattnum
        WHERE t.relname = $1 AND c.contype = 'f'
        GROUP BY conname, confrelid, confdeltype, confupdtype
      `, [table]);

      for (const fk of fkResult.rows) {
        foreignKeys.push({
          name: fk.name,
          columns: fk.columns,
          referencedTable: fk.referencedTable,
          referencedColumns: fk.referencedColumns,
          onDelete: fk.onDelete,
          onUpdate: fk.onUpdate,
        });
      }
    }
  } catch (error) {
    console.error('Error getting table schema:', error);
    throw error;
  }

  return { columns, indexes, foreignKeys };
}

/**
 * Execute a query and return results
 */
export async function executeQuery(
  connection: DatabaseConnection,
  database: string,
  query: string,
  limit: number = 1000
): Promise<QueryResult> {
  const queryId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();

  try {
    let rows: Record<string, unknown>[] = [];
    let fields: QueryField[] = [];
    let affectedRows: number | undefined;

    // Determine if this is a SELECT-like query
    const trimmedQuery = query.trim().toLowerCase();
    const isSelect = trimmedQuery.startsWith('select') ||
                     trimmedQuery.startsWith('show') ||
                     trimmedQuery.startsWith('describe') ||
                     trimmedQuery.startsWith('explain');

    if (connection.engine === 'mysql') {
      const pool = await getMySQLPool(connection, database);

      if (isSelect) {
        // Add LIMIT if not present
        let limitedQuery = query;
        if (!trimmedQuery.includes(' limit ')) {
          limitedQuery = `${query.trim().replace(/;$/, '')} LIMIT ${limit}`;
        }

        const [result, fieldInfo] = await pool.query(limitedQuery);
        rows = result as Record<string, unknown>[];

        if (fieldInfo && Array.isArray(fieldInfo)) {
          fields = fieldInfo.map((f: mysql.FieldPacket) => ({
            name: f.name,
            type: getFieldTypeName(f.type, 'mysql'),
            table: f.table || undefined,
          }));
        }
      } else {
        const [result] = await pool.query(query);
        affectedRows = (result as mysql.ResultSetHeader).affectedRows;
      }
    } else if (connection.engine === 'postgresql') {
      const pool = await getPgPool(connection, database);

      if (isSelect) {
        // Add LIMIT if not present
        let limitedQuery = query;
        if (!trimmedQuery.includes(' limit ')) {
          limitedQuery = `${query.trim().replace(/;$/, '')} LIMIT ${limit}`;
        }

        const result = await pool.query(limitedQuery);
        rows = result.rows;

        if (result.fields) {
          fields = result.fields.map(f => ({
            name: f.name,
            type: getFieldTypeName(f.dataTypeID, 'postgresql'),
            table: undefined,
          }));
        }
      } else {
        const result = await pool.query(query);
        affectedRows = result.rowCount ?? undefined;
      }
    }

    const duration = Date.now() - startTime;

    return {
      id: queryId,
      connectionId: connection.id,
      database,
      query,
      status: 'success',
      executedAt: startTime,
      duration,
      rows,
      fields,
      rowCount: rows.length,
      affectedRows,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as { code?: string })?.code;

    return {
      id: queryId,
      connectionId: connection.id,
      database,
      query,
      status: 'error',
      executedAt: startTime,
      duration,
      error: errorMessage,
      errorCode,
    };
  }
}

/**
 * Add a query to history
 */
export function addToHistory(buildingId: string, result: QueryResult): void {
  const entry: QueryHistoryEntry = {
    id: result.id,
    buildingId,
    connectionId: result.connectionId,
    database: result.database,
    query: result.query,
    executedAt: result.executedAt,
    duration: result.duration,
    status: result.status,
    rowCount: result.rowCount,
    error: result.error,
    favorite: false,
  };

  let history = queryHistoryCache.get(buildingId) || loadQueryHistory(buildingId);

  // Add new entry at the beginning
  history = [entry, ...history];

  // Keep only last 50 entries
  if (history.length > 50) {
    history = history.slice(0, 50);
  }

  queryHistoryCache.set(buildingId, history);
  saveQueryHistory(buildingId, history);
}

/**
 * Get query history for a building
 */
export function getHistory(buildingId: string, limit: number = 100): QueryHistoryEntry[] {
  let history = queryHistoryCache.get(buildingId);

  if (!history) {
    history = loadQueryHistory(buildingId);
    queryHistoryCache.set(buildingId, history);
  }

  return history.slice(0, limit);
}

/**
 * Toggle favorite status for a query
 */
export function toggleFavorite(buildingId: string, queryId: string): boolean {
  const history = queryHistoryCache.get(buildingId) || loadQueryHistory(buildingId);
  const entry = history.find(h => h.id === queryId);

  if (entry) {
    entry.favorite = !entry.favorite;
    queryHistoryCache.set(buildingId, history);
    saveQueryHistory(buildingId, history);
    return entry.favorite;
  }

  return false;
}

/**
 * Delete a query from history
 */
export function deleteFromHistory(buildingId: string, queryId: string): void {
  let history = queryHistoryCache.get(buildingId) || loadQueryHistory(buildingId);
  history = history.filter(h => h.id !== queryId);
  queryHistoryCache.set(buildingId, history);
  saveQueryHistory(buildingId, history);
}

/**
 * Clear all query history for a building
 */
export function clearHistory(buildingId: string): void {
  queryHistoryCache.set(buildingId, []);
  saveQueryHistory(buildingId, []);
}

/**
 * Close all connection pools for a building/connection
 */
export function closeConnection(connectionId: string): void {
  // Close all pools that match this connection ID
  for (const [key, pool] of mysqlPools.entries()) {
    if (key.startsWith(connectionId + ':')) {
      pool.end();
      mysqlPools.delete(key);
    }
  }

  for (const [key, pool] of pgPools.entries()) {
    if (key.startsWith(connectionId + ':')) {
      pool.end();
      pgPools.delete(key);
    }
  }
}

/**
 * Close all connection pools
 */
export async function closeAllConnections(): Promise<void> {
  for (const pool of mysqlPools.values()) {
    await pool.end();
  }
  mysqlPools.clear();

  for (const pool of pgPools.values()) {
    await pool.end();
  }
  pgPools.clear();
}

/**
 * Get human-readable field type name
 */
function getFieldTypeName(typeId: number | undefined, engine: DatabaseEngine): string {
  if (typeId === undefined) return 'unknown';

  if (engine === 'mysql') {
    // MySQL field types
    const mysqlTypes: Record<number, string> = {
      0: 'DECIMAL',
      1: 'TINYINT',
      2: 'SMALLINT',
      3: 'INT',
      4: 'FLOAT',
      5: 'DOUBLE',
      6: 'NULL',
      7: 'TIMESTAMP',
      8: 'BIGINT',
      9: 'MEDIUMINT',
      10: 'DATE',
      11: 'TIME',
      12: 'DATETIME',
      13: 'YEAR',
      14: 'NEWDATE',
      15: 'VARCHAR',
      16: 'BIT',
      245: 'JSON',
      246: 'NEWDECIMAL',
      247: 'ENUM',
      248: 'SET',
      249: 'TINY_BLOB',
      250: 'MEDIUM_BLOB',
      251: 'LONG_BLOB',
      252: 'BLOB',
      253: 'VAR_STRING',
      254: 'STRING',
      255: 'GEOMETRY',
    };
    return mysqlTypes[typeId] || `TYPE_${typeId}`;
  } else if (engine === 'postgresql') {
    // PostgreSQL OID types
    const pgTypes: Record<number, string> = {
      16: 'boolean',
      17: 'bytea',
      18: 'char',
      19: 'name',
      20: 'bigint',
      21: 'smallint',
      23: 'integer',
      25: 'text',
      26: 'oid',
      114: 'json',
      142: 'xml',
      700: 'real',
      701: 'double',
      790: 'money',
      1042: 'char',
      1043: 'varchar',
      1082: 'date',
      1083: 'time',
      1114: 'timestamp',
      1184: 'timestamptz',
      1186: 'interval',
      1266: 'timetz',
      1700: 'numeric',
      2950: 'uuid',
      3802: 'jsonb',
    };
    return pgTypes[typeId] || `OID_${typeId}`;
  }

  return 'unknown';
}
