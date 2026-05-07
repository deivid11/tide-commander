// ============================================================================
// Database Building Types
// ============================================================================

// Supported database engines
export type DatabaseEngine = 'mysql' | 'postgresql' | 'oracle' | 'sqlite' | 'mssql';

export const DATABASE_ENGINES: Record<DatabaseEngine, { label: string; icon: string; defaultPort: number }> = {
  mysql: { label: 'MySQL', icon: '🐬', defaultPort: 3306 },
  postgresql: { label: 'PostgreSQL', icon: '🐘', defaultPort: 5432 },
  oracle: { label: 'Oracle', icon: '🔶', defaultPort: 1521 },
  sqlite: { label: 'SQLite', icon: '🪶', defaultPort: 0 },
  mssql: { label: 'SQL Server', icon: '🔷', defaultPort: 1433 },
};

// SSH tunnel authentication method
export type SSHAuthMethod = 'password' | 'privateKey';

// SSH tunnel configuration (used to forward DB traffic through a jump host)
export interface SSHTunnelConfig {
  enabled: boolean;
  host: string;                    // SSH server (jump host) hostname / IP
  port: number;                    // SSH port (default 22)
  username: string;                // SSH username
  authMethod: SSHAuthMethod;       // 'password' or 'privateKey'
  password?: string;               // Used when authMethod === 'password' OR as privateKey passphrase
  privateKey?: string;             // PEM-formatted private key contents (inline)
  privateKeyPath?: string;         // Path to a private key file on disk (alternative to inline)
  passphrase?: string;             // Passphrase for an encrypted private key
  localPort?: number;              // Optional fixed local forwarded port (auto-assigned if omitted)
  keepaliveIntervalMs?: number;    // Optional keepalive (default 10000)
  readyTimeoutMs?: number;         // Optional connect timeout (default 20000)
}
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
  filepath?: string;               // File path for SQLite databases
  ssl?: boolean;                   // Use SSL/TLS
  sslConfig?: {
    rejectUnauthorized?: boolean;
    ca?: string;                   // CA certificate
    cert?: string;                 // Client certificate
    key?: string;                  // Client key
  };
  // Optional SSH tunnel: when ssh.enabled is true, traffic to host:port is forwarded
  // through the SSH server. host/port still represent the DB target as seen FROM the
  // SSH server (often 'localhost'/127.0.0.1 + the DB's native port).
  ssh?: SSHTunnelConfig;
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
