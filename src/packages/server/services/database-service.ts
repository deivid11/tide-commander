/**
 * Database Service
 * Handles database connections and query execution for MySQL and PostgreSQL
 */

import mysql from 'mysql2/promise';
import pg from 'pg';
import oracledb from 'oracledb';
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
const oraclePools = new Map<string, oracledb.Pool>();

// Note: oracledb 6.0+ uses thin mode by default, which doesn't require Oracle Instant Client

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
 * Get or create an Oracle connection pool
 * Note: For Oracle, we always connect to the same service (from connection.database).
 * The "database" parameter in other functions represents the schema/owner to query,
 * not a different database to connect to.
 */
async function getOraclePool(connection: DatabaseConnection): Promise<oracledb.Pool> {
  // For Oracle, we use only the connection ID as the key since we always connect
  // to the same service - the schema is just used in queries, not connection
  const key = connection.id;

  if (oraclePools.has(key)) {
    return oraclePools.get(key)!;
  }

  // Build connection string - Oracle uses service name or SID
  // Format: host:port/serviceName
  // The service name comes from connection.database (e.g., ORCLPDB1)
  const serviceName = connection.database || 'ORCL';
  const connectString = `${connection.host}:${connection.port}/${serviceName}`;

  const pool = await oracledb.createPool({
    user: connection.username,
    password: connection.password,
    connectString,
    poolMin: 1,
    poolMax: 5,
    poolIncrement: 1,
    poolTimeout: 60,
  });

  oraclePools.set(key, pool);
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
    } else if (connection.engine === 'oracle') {
      const pool = await getOraclePool(connection);
      const conn = await pool.getConnection();
      try {
        const result = await conn.execute<{ BANNER: string }>(
          "SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1",
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const version = result.rows?.[0]?.BANNER || 'Oracle';
        return { success: true, serverVersion: version };
      } finally {
        await conn.close();
      }
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
    } else if (connection.engine === 'oracle') {
      // Oracle: list accessible schemas as "databases"
      // Try ALL_USERS first, fall back to just the current user's schema
      const pool = await getOraclePool(connection);
      const conn = await pool.getConnection();
      try {
        const execOptions = { outFormat: oracledb.OUT_FORMAT_OBJECT };

        // First try to get all accessible schemas
        try {
          const result = await conn.execute<{ USERNAME: string }>(
            `SELECT USERNAME FROM ALL_USERS
             WHERE USERNAME NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'XDB', 'WMSYS', 'CTXSYS', 'ANONYMOUS', 'MDSYS', 'OLAPSYS', 'ORDDATA', 'ORDSYS', 'EXFSYS', 'DMSYS', 'APEX_PUBLIC_USER', 'APPQOSSYS', 'AUDSYS', 'DBSFWUSER', 'DIP', 'GGSYS', 'GSMADMIN_INTERNAL', 'GSMCATUSER', 'GSMUSER', 'LBACSYS', 'OJVMSYS', 'REMOTE_SCHEDULER_AGENT', 'SYS$UMF', 'SYSBACKUP', 'SYSDG', 'SYSKM', 'SYSRAC', 'XS$NULL')
             AND ORACLE_MAINTAINED = 'N'
             ORDER BY USERNAME`,
            [],
            execOptions
          );
          if (result.rows && result.rows.length > 0) {
            return result.rows.map(r => r.USERNAME);
          }
        } catch {
          // ORACLE_MAINTAINED column might not exist in older versions, try simpler query
          try {
            const result = await conn.execute<{ USERNAME: string }>(
              `SELECT USERNAME FROM ALL_USERS
               WHERE USERNAME NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'XDB', 'WMSYS', 'CTXSYS', 'ANONYMOUS', 'MDSYS', 'OLAPSYS', 'ORDDATA', 'ORDSYS', 'EXFSYS', 'DMSYS', 'APEX_PUBLIC_USER')
               ORDER BY USERNAME`,
              [],
              execOptions
            );
            if (result.rows && result.rows.length > 0) {
              return result.rows.map(r => r.USERNAME);
            }
          } catch {
            // Fall through to current user only
          }
        }

        // Fallback: just return the current user's schema
        const userResult = await conn.execute<{ USERNAME: string }>(
          `SELECT USER as USERNAME FROM DUAL`,
          [],
          execOptions
        );
        return (userResult.rows || []).map(r => r.USERNAME);
      } finally {
        await conn.close();
      }
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
    } else if (connection.engine === 'oracle') {
      // In Oracle, database parameter is treated as schema/owner
      const pool = await getOraclePool(connection);
      const conn = await pool.getConnection();
      try {
        // Simple query without joins - more compatible with restricted permissions
        const result = await conn.execute<{
          NAME: string;
          TYPE: string;
          NUM_ROWS: number;
        }>(`
          SELECT TABLE_NAME as NAME, 'table' as TYPE, NUM_ROWS
          FROM ALL_TABLES
          WHERE OWNER = :owner
          UNION ALL
          SELECT VIEW_NAME as NAME, 'view' as TYPE, NULL as NUM_ROWS
          FROM ALL_VIEWS
          WHERE OWNER = :owner
          ORDER BY NAME
        `, { owner: database.toUpperCase() }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        return (result.rows || []).map(r => ({
          name: r.NAME,
          type: r.TYPE as 'table' | 'view',
          rows: r.NUM_ROWS || undefined,
        }));
      } finally {
        await conn.close();
      }
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
    } else if (connection.engine === 'oracle') {
      // In Oracle, database parameter is treated as schema/owner
      const pool = await getOraclePool(connection);
      const conn = await pool.getConnection();
      const execOptions = { outFormat: oracledb.OUT_FORMAT_OBJECT };
      try {
        // Get columns (compatible with Oracle 11g and later)
        const columnResult = await conn.execute<{
          NAME: string;
          TYPE: string;
          NULLABLE: string;
          DEFAULT_VALUE: string;
          PRIMARY_KEY: number;
          COMMENTS: string;
        }>(`
          SELECT
            c.COLUMN_NAME as NAME,
            c.DATA_TYPE || CASE
              WHEN c.DATA_TYPE IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR') THEN '(' || c.DATA_LENGTH || ')'
              WHEN c.DATA_TYPE = 'NUMBER' AND c.DATA_PRECISION IS NOT NULL THEN '(' || c.DATA_PRECISION || ',' || NVL(c.DATA_SCALE, 0) || ')'
              ELSE ''
            END as TYPE,
            c.NULLABLE,
            c.DATA_DEFAULT as DEFAULT_VALUE,
            CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as PRIMARY_KEY,
            cc.COMMENTS
          FROM ALL_TAB_COLUMNS c
          LEFT JOIN (
            SELECT cols.COLUMN_NAME, cols.TABLE_NAME, cols.OWNER
            FROM ALL_CONSTRAINTS cons
            JOIN ALL_CONS_COLUMNS cols ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND cons.OWNER = cols.OWNER
            WHERE cons.CONSTRAINT_TYPE = 'P' AND cons.TABLE_NAME = :table AND cons.OWNER = :owner
          ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME AND c.TABLE_NAME = pk.TABLE_NAME AND c.OWNER = pk.OWNER
          LEFT JOIN ALL_COL_COMMENTS cc ON c.COLUMN_NAME = cc.COLUMN_NAME AND c.TABLE_NAME = cc.TABLE_NAME AND c.OWNER = cc.OWNER
          WHERE c.TABLE_NAME = :table AND c.OWNER = :owner
          ORDER BY c.COLUMN_ID
        `, { table: table.toUpperCase(), owner: database.toUpperCase() }, execOptions);

        for (const col of columnResult.rows || []) {
          columns.push({
            name: col.NAME,
            type: col.TYPE,
            nullable: col.NULLABLE === 'Y',
            defaultValue: col.DEFAULT_VALUE?.trim() || undefined,
            primaryKey: col.PRIMARY_KEY === 1,
            autoIncrement: false, // Oracle doesn't have auto_increment in the same way
            comment: col.COMMENTS || undefined,
          });
        }

        // Get indexes
        const indexResult = await conn.execute<{
          NAME: string;
          COLUMNS: string;
          IS_UNIQUE: string;
          TYPE: string;
        }>(`
          SELECT
            i.INDEX_NAME as NAME,
            LISTAGG(ic.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY ic.COLUMN_POSITION) as COLUMNS,
            i.UNIQUENESS as IS_UNIQUE,
            i.INDEX_TYPE as TYPE
          FROM ALL_INDEXES i
          JOIN ALL_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER
          WHERE i.TABLE_NAME = :table AND i.OWNER = :owner
          GROUP BY i.INDEX_NAME, i.UNIQUENESS, i.INDEX_TYPE
        `, { table: table.toUpperCase(), owner: database.toUpperCase() }, execOptions);

        for (const idx of indexResult.rows || []) {
          indexes.push({
            name: idx.NAME,
            columns: idx.COLUMNS.split(','),
            unique: idx.IS_UNIQUE === 'UNIQUE',
            type: idx.TYPE,
          });
        }

        // Get foreign keys
        const fkResult = await conn.execute<{
          NAME: string;
          COLUMNS: string;
          REFERENCED_TABLE: string;
          REFERENCED_COLUMNS: string;
          DELETE_RULE: string;
        }>(`
          SELECT
            c.CONSTRAINT_NAME as NAME,
            LISTAGG(cols.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY cols.POSITION) as COLUMNS,
            r_cons.TABLE_NAME as REFERENCED_TABLE,
            LISTAGG(r_cols.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY r_cols.POSITION) as REFERENCED_COLUMNS,
            c.DELETE_RULE
          FROM ALL_CONSTRAINTS c
          JOIN ALL_CONS_COLUMNS cols ON c.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND c.OWNER = cols.OWNER
          JOIN ALL_CONSTRAINTS r_cons ON c.R_CONSTRAINT_NAME = r_cons.CONSTRAINT_NAME AND c.R_OWNER = r_cons.OWNER
          JOIN ALL_CONS_COLUMNS r_cols ON r_cons.CONSTRAINT_NAME = r_cols.CONSTRAINT_NAME AND r_cons.OWNER = r_cols.OWNER
          WHERE c.CONSTRAINT_TYPE = 'R' AND c.TABLE_NAME = :table AND c.OWNER = :owner
          GROUP BY c.CONSTRAINT_NAME, r_cons.TABLE_NAME, c.DELETE_RULE
        `, { table: table.toUpperCase(), owner: database.toUpperCase() }, execOptions);

        for (const fk of fkResult.rows || []) {
          foreignKeys.push({
            name: fk.NAME,
            columns: fk.COLUMNS.split(','),
            referencedTable: fk.REFERENCED_TABLE,
            referencedColumns: fk.REFERENCED_COLUMNS.split(','),
            onDelete: fk.DELETE_RULE || undefined,
            onUpdate: undefined, // Oracle doesn't support ON UPDATE in the same way
          });
        }
      } finally {
        await conn.close();
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
    } else if (connection.engine === 'oracle') {
      const pool = await getOraclePool(connection);
      const conn = await pool.getConnection();
      try {
        if (isSelect) {
          // Add FETCH FIRST for Oracle 12c+ if no ROWNUM/FETCH present
          let limitedQuery = query;
          if (!trimmedQuery.includes('rownum') && !trimmedQuery.includes('fetch ')) {
            limitedQuery = `${query.trim().replace(/;$/, '')} FETCH FIRST ${limit} ROWS ONLY`;
          }

          const result = await conn.execute(limitedQuery, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchArraySize: limit,
          });

          rows = (result.rows as Record<string, unknown>[]) || [];

          if (result.metaData) {
            fields = result.metaData.map(m => ({
              name: m.name,
              type: getFieldTypeName(m.dbType as number | undefined, 'oracle'),
              table: undefined,
            }));
          }
        } else {
          const result = await conn.execute(query, [], { autoCommit: true });
          affectedRows = result.rowsAffected;
        }
      } finally {
        await conn.close();
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
export async function closeConnection(connectionId: string): Promise<void> {
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

  for (const [key, pool] of oraclePools.entries()) {
    if (key.startsWith(connectionId + ':')) {
      await pool.close(0);
      oraclePools.delete(key);
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

  for (const pool of oraclePools.values()) {
    await pool.close(0);
  }
  oraclePools.clear();
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
  } else if (engine === 'oracle') {
    // Oracle DB_TYPE_* constants from oracledb
    const oracleTypes: Record<number, string> = {
      2001: 'VARCHAR2',
      2002: 'NUMBER',
      2003: 'LONG',
      2004: 'DATE',
      2005: 'RAW',
      2006: 'LONG RAW',
      2007: 'ROWID',
      2010: 'BINARY_FLOAT',
      2011: 'BINARY_DOUBLE',
      2012: 'CHAR',
      2013: 'NCHAR',
      2014: 'NVARCHAR2',
      2015: 'CLOB',
      2016: 'NCLOB',
      2017: 'BLOB',
      2018: 'BFILE',
      2019: 'TIMESTAMP',
      2020: 'TIMESTAMP WITH TIME ZONE',
      2021: 'INTERVAL YEAR TO MONTH',
      2022: 'INTERVAL DAY TO SECOND',
      2023: 'TIMESTAMP WITH LOCAL TIME ZONE',
      2024: 'OBJECT',
      2025: 'CURSOR',
      2100: 'BOOLEAN',
      2101: 'JSON',
    };
    return oracleTypes[typeId] || `DBTYPE_${typeId}`;
  }

  return 'unknown';
}
