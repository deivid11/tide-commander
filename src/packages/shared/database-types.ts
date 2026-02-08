// ============================================================================
// Database Building Types
// ============================================================================

// Supported database engines
export type DatabaseEngine = 'mysql' | 'postgresql' | 'oracle';

export const DATABASE_ENGINES: Record<DatabaseEngine, { label: string; icon: string; defaultPort: number }> = {
  mysql: { label: 'MySQL', icon: '🐬', defaultPort: 3306 },
  postgresql: { label: 'PostgreSQL', icon: '🐘', defaultPort: 5432 },
  oracle: { label: 'Oracle', icon: '🔶', defaultPort: 1521 },
};

// Database connection configuration
export interface DatabaseConnection {
  id: string;
  name: string;                    // Connection name (e.g., "Production MySQL")
  engine: DatabaseEngine;
  host: string;
  port: number;
  username: string;
  password?: string;               // Optional - can use env vars
  database?: string;               // Default database to connect to
  ssl?: boolean;                   // Use SSL/TLS
  sslConfig?: {
    rejectUnauthorized?: boolean;
    ca?: string;                   // CA certificate
    cert?: string;                 // Client certificate
    key?: string;                  // Client key
  };
}

// Full database building configuration
export interface DatabaseConfig {
  connections: DatabaseConnection[];
  activeConnectionId?: string;     // Currently selected connection
  activeDatabase?: string;         // Currently selected database within the connection
}

// Query execution result
export interface QueryResult {
  id: string;
  connectionId: string;
  database: string;
  query: string;
  status: 'success' | 'error';
  executedAt: number;
  duration: number;                // Execution time in ms

  // Success fields
  rows?: Record<string, unknown>[];
  fields?: QueryField[];
  rowCount?: number;
  affectedRows?: number;           // For INSERT/UPDATE/DELETE

  // Error fields
  error?: string;
  errorCode?: string;
}

// Field metadata from query result
export interface QueryField {
  name: string;
  type: string;                    // SQL data type
  nullable?: boolean;
  primaryKey?: boolean;
  table?: string;
}

// Query history entry
export interface QueryHistoryEntry {
  id: string;
  buildingId: string;
  connectionId: string;
  database: string;
  query: string;
  executedAt: number;
  duration: number;
  status: 'success' | 'error';
  rowCount?: number;
  error?: string;
  favorite?: boolean;              // User can star queries
}

// Table column definition
export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
  autoIncrement?: boolean;
  comment?: string;
}

// Table index definition
export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type?: string;                 // BTREE, HASH, etc.
}

// Foreign key definition
export interface ForeignKey {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

// Table info for list
export interface TableInfo {
  name: string;
  type: 'table' | 'view';
  engine?: string;               // MySQL: InnoDB, MyISAM, etc.
  rows?: number;                 // Approximate row count
  size?: number;                 // Table size in bytes
  comment?: string;
}
