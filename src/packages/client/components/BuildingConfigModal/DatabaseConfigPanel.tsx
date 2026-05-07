import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DATABASE_ENGINES,
  type DatabaseEngine,
  type DatabaseConnection,
  type SSHTunnelConfig,
} from '../../../shared/types';
import { HelpTooltip } from '../shared/Tooltip';
import { store } from '../../store';

interface DatabaseConfigPanelProps {
  dbConnections: DatabaseConnection[];
  setDbConnections: (v: DatabaseConnection[]) => void;
  activeDbConnectionId: string | undefined;
  setActiveDbConnectionId: (v: string | undefined) => void;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; serverVersion?: string }
  | { status: 'error'; error: string };

const DEFAULT_SSH: SSHTunnelConfig = {
  enabled: false,
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
};

export function DatabaseConfigPanel({
  dbConnections,
  setDbConnections,
  activeDbConnectionId,
  setActiveDbConnectionId,
}: DatabaseConfigPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);

  // Per-connection test status keyed by connection id.
  const [testState, setTestState] = useState<Record<string, TestState>>({});
  const pendingRequests = useRef<Map<string, string>>(new Map()); // requestId -> connectionId

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        requestId: string;
        success: boolean;
        error?: string;
        serverVersion?: string;
      };
      if (!detail || !detail.requestId) return;
      const connId = pendingRequests.current.get(detail.requestId);
      if (!connId) return;
      pendingRequests.current.delete(detail.requestId);
      setTestState(prev => ({
        ...prev,
        [connId]: detail.success
          ? { status: 'success', serverVersion: detail.serverVersion }
          : { status: 'error', error: detail.error || 'Connection failed' },
      }));
    };
    window.addEventListener('tide:db-test-result', handler);
    return () => window.removeEventListener('tide:db-test-result', handler);
  }, []);

  const updateConnection = (index: number, patch: Partial<DatabaseConnection>): void => {
    const newConns = [...dbConnections];
    newConns[index] = { ...newConns[index], ...patch };
    setDbConnections(newConns);
  };

  const updateSSH = (index: number, patch: Partial<SSHTunnelConfig>): void => {
    const conn = dbConnections[index];
    const ssh = { ...(conn.ssh ?? DEFAULT_SSH), ...patch };
    updateConnection(index, { ssh });
  };

  const handleTestConnection = (conn: DatabaseConnection): void => {
    const requestId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pendingRequests.current.set(requestId, conn.id);
    setTestState(prev => ({ ...prev, [conn.id]: { status: 'testing' } }));
    store.testDatabaseConnectionTransient(requestId, conn);
    // Hard timeout: 30s
    window.setTimeout(() => {
      if (pendingRequests.current.has(requestId)) {
        pendingRequests.current.delete(requestId);
        setTestState(prev => {
          const cur = prev[conn.id];
          if (cur?.status !== 'testing') return prev;
          return { ...prev, [conn.id]: { status: 'error', error: 'Test connection timed out after 30s' } };
        });
      }
    }, 30000);
  };

  return (
    <div className="form-section database-config-section">
      <label className="form-label">
        {t('terminal:building.dbConnections')}
        <HelpTooltip
          text={t('terminal:building.helpDbConnections')}
          title={t('terminal:building.dbConnections')}
          position="top"
          size="sm"
        />
        <button
          type="button"
          className="btn btn-sm btn-add"
          onClick={() => {
            const newConn: DatabaseConnection = {
              id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: `Connection ${dbConnections.length + 1}`,
              engine: 'mysql',
              host: 'localhost',
              port: 3306,
              username: 'root',
            };
            setDbConnections([...dbConnections, newConn]);
            if (!activeDbConnectionId) {
              setActiveDbConnectionId(newConn.id);
            }
          }}
        >
          {t('terminal:database.addConnection')}
        </button>
      </label>

      {dbConnections.length === 0 && (
        <div className="form-hint">
          {t('terminal:building.dbGetStarted')}
        </div>
      )}

      {dbConnections.map((conn, index) => {
        const ts = testState[conn.id] ?? { status: 'idle' as const };
        const sshEnabled = conn.ssh?.enabled === true;
        return (
        <div key={conn.id} className="db-connection-card">
          <div className="db-connection-header">
            <label className="db-connection-active">
              <input
                type="radio"
                name="activeConnection"
                checked={activeDbConnectionId === conn.id}
                onChange={() => setActiveDbConnectionId(conn.id)}
              />
              {t('common:labels.default')}
              <HelpTooltip
                text={t('terminal:building.helpDbDefault')}
                position="top"
                size="sm"
              />
            </label>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                const newConns = dbConnections.filter(c => c.id !== conn.id);
                setDbConnections(newConns);
                if (activeDbConnectionId === conn.id && newConns.length > 0) {
                  setActiveDbConnectionId(newConns[0].id);
                } else if (newConns.length === 0) {
                  setActiveDbConnectionId(undefined);
                }
              }}
            >
              {t('common:buttons.remove')}
            </button>
          </div>

          <div className="db-connection-row">
            <div className="db-field">
              <label>{t('common:labels.name')}</label>
              <input
                type="text"
                className="form-input"
                value={conn.name}
                onChange={(e) => updateConnection(index, { name: e.target.value })}
                placeholder="My Database"
              />
            </div>
            <div className="db-field db-field--small">
              <label>{t('terminal:building.dbEngine')}</label>
              <select
                className="form-input form-select"
                value={conn.engine}
                onChange={(e) => {
                  const engine = e.target.value as DatabaseEngine;
                  updateConnection(index, {
                    engine,
                    port: DATABASE_ENGINES[engine].defaultPort,
                  });
                }}
              >
                {(Object.keys(DATABASE_ENGINES) as DatabaseEngine[]).map((eng) => (
                  <option key={eng} value={eng}>
                    {DATABASE_ENGINES[eng].icon} {DATABASE_ENGINES[eng].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {conn.engine === 'sqlite' ? (
            /* SQLite: file path only */
            <div className="db-connection-row">
              <div className="db-field db-field--grow">
                <label>{t('terminal:building.dbFilepath')}</label>
                <input
                  type="text"
                  className="form-input"
                  value={conn.filepath || ''}
                  onChange={(e) => updateConnection(index, { filepath: e.target.value || undefined })}
                  placeholder="/path/to/database.db"
                />
              </div>
            </div>
          ) : (
            /* Network databases: host, port, credentials */
            <>
              <div className="db-connection-row">
                <div className="db-field db-field--grow">
                  <label>
                    {t('terminal:building.dbHost')}
                    {sshEnabled && (
                      <HelpTooltip
                        text="Host as seen FROM the SSH server (often 'localhost' or 127.0.0.1)."
                        position="top"
                        size="sm"
                      />
                    )}
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={conn.host}
                    onChange={(e) => updateConnection(index, { host: e.target.value })}
                    placeholder={sshEnabled ? '127.0.0.1' : 'localhost'}
                  />
                </div>
                <div className="db-field db-field--small">
                  <label>{t('terminal:building.dbPort')}</label>
                  <input
                    type="number"
                    className="form-input"
                    value={conn.port}
                    onChange={(e) => updateConnection(index, { port: parseInt(e.target.value) || DATABASE_ENGINES[conn.engine].defaultPort })}
                  />
                </div>
              </div>

              <div className="db-connection-row">
                <div className="db-field">
                  <label>{t('terminal:building.dbUsername')}</label>
                  <input
                    type="text"
                    className="form-input"
                    value={conn.username}
                    onChange={(e) => updateConnection(index, { username: e.target.value })}
                    placeholder="root"
                  />
                </div>
                <div className="db-field">
                  <label>{t('terminal:building.dbPassword')}</label>
                  <input
                    type="password"
                    className="form-input"
                    value={conn.password || ''}
                    onChange={(e) => updateConnection(index, { password: e.target.value || undefined })}
                    placeholder="Optional"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="db-connection-row">
                <div className="db-field db-field--grow">
                  <label>{t('terminal:building.dbDefaultDatabase')}</label>
                  <input
                    type="text"
                    className="form-input"
                    value={conn.database || ''}
                    onChange={(e) => updateConnection(index, { database: e.target.value || undefined })}
                    placeholder="Optional - select after connecting"
                  />
                </div>
                <div className="db-field db-field--small">
                  <label>
                    SSL
                    <HelpTooltip
                      text={t('terminal:building.helpDbSsl')}
                      position="top"
                      size="sm"
                    />
                  </label>
                  <label className="toggle-switch toggle-switch--small">
                    <input
                      type="checkbox"
                      checked={conn.ssl || false}
                      onChange={(e) => updateConnection(index, { ssl: e.target.checked })}
                    />
                    <span className="toggle-track">
                      <span className="toggle-thumb" />
                    </span>
                  </label>
                </div>
              </div>

              {/* SSH Tunnel Section */}
              <div className="db-connection-row">
                <div className="db-field db-field--grow">
                  <label>
                    SSH Tunnel
                    <HelpTooltip
                      text="Forward DB traffic through an SSH jump host. Required when the DB is only reachable from inside a private network."
                      position="top"
                      size="sm"
                    />
                  </label>
                </div>
                <div className="db-field db-field--small">
                  <label className="toggle-switch toggle-switch--small">
                    <input
                      type="checkbox"
                      checked={sshEnabled}
                      onChange={(e) => updateSSH(index, { enabled: e.target.checked })}
                    />
                    <span className="toggle-track">
                      <span className="toggle-thumb" />
                    </span>
                  </label>
                </div>
              </div>

              {sshEnabled && (
                <div className="db-ssh-subsection">
                  <div className="db-connection-row">
                    <div className="db-field db-field--grow">
                      <label>SSH Host</label>
                      <input
                        type="text"
                        className="form-input"
                        value={conn.ssh?.host || ''}
                        onChange={(e) => updateSSH(index, { host: e.target.value })}
                        placeholder="bastion.example.com"
                      />
                    </div>
                    <div className="db-field db-field--small">
                      <label>SSH Port</label>
                      <input
                        type="number"
                        className="form-input"
                        value={conn.ssh?.port || 22}
                        onChange={(e) => updateSSH(index, { port: parseInt(e.target.value) || 22 })}
                      />
                    </div>
                  </div>

                  <div className="db-connection-row">
                    <div className="db-field db-field--grow">
                      <label>SSH Username</label>
                      <input
                        type="text"
                        className="form-input"
                        value={conn.ssh?.username || ''}
                        onChange={(e) => updateSSH(index, { username: e.target.value })}
                        placeholder="ubuntu"
                      />
                    </div>
                    <div className="db-field db-field--small">
                      <label>Auth Method</label>
                      <select
                        className="form-input form-select"
                        value={conn.ssh?.authMethod || 'password'}
                        onChange={(e) => updateSSH(index, { authMethod: e.target.value as SSHTunnelConfig['authMethod'] })}
                      >
                        <option value="password">Password</option>
                        <option value="privateKey">Private Key</option>
                      </select>
                    </div>
                  </div>

                  {(conn.ssh?.authMethod || 'password') === 'password' ? (
                    <div className="db-connection-row">
                      <div className="db-field db-field--grow">
                        <label>SSH Password</label>
                        <input
                          type="password"
                          className="form-input"
                          value={conn.ssh?.password || ''}
                          onChange={(e) => updateSSH(index, { password: e.target.value || undefined })}
                          placeholder="SSH password"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="db-connection-row">
                        <div className="db-field db-field--grow">
                          <label>
                            Private Key Path
                            <HelpTooltip
                              text="Path to a private key file on the server, e.g. ~/.ssh/id_rsa. Use this OR paste the key contents below."
                              position="top"
                              size="sm"
                            />
                          </label>
                          <input
                            type="text"
                            className="form-input"
                            value={conn.ssh?.privateKeyPath || ''}
                            onChange={(e) => updateSSH(index, { privateKeyPath: e.target.value || undefined })}
                            placeholder="/home/user/.ssh/id_rsa"
                          />
                        </div>
                      </div>
                      <div className="db-connection-row">
                        <div className="db-field db-field--grow">
                          <label>
                            Private Key Contents (PEM)
                            <HelpTooltip
                              text="Paste the full private key contents inline. Encrypted at rest."
                              position="top"
                              size="sm"
                            />
                          </label>
                          <textarea
                            className="form-input"
                            value={conn.ssh?.privateKey || ''}
                            onChange={(e) => updateSSH(index, { privateKey: e.target.value || undefined })}
                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----\n..."
                            rows={4}
                            style={{ fontFamily: 'monospace', fontSize: 12 }}
                          />
                        </div>
                      </div>
                      <div className="db-connection-row">
                        <div className="db-field db-field--grow">
                          <label>Key Passphrase (optional)</label>
                          <input
                            type="password"
                            className="form-input"
                            value={conn.ssh?.passphrase || ''}
                            onChange={(e) => updateSSH(index, { passphrase: e.target.value || undefined })}
                            placeholder="If your key is encrypted"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="db-connection-row">
                    <div className="db-field db-field--small">
                      <label>
                        Local Port
                        <HelpTooltip
                          text="Optional fixed local forwarded port. Leave blank to auto-assign."
                          position="top"
                          size="sm"
                        />
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        value={conn.ssh?.localPort ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          updateSSH(index, { localPort: v ? parseInt(v) : undefined });
                        }}
                        placeholder="auto"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Test Connection */}
              <div className="db-connection-row" style={{ alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={ts.status === 'testing'}
                  onClick={() => handleTestConnection(conn)}
                >
                  {ts.status === 'testing' ? 'Testing…' : 'Test Connection'}
                </button>
                {ts.status === 'success' && (
                  <span style={{ color: '#4aff9e', fontSize: 12 }}>
                    ✓ Connected{ts.serverVersion ? ` — ${ts.serverVersion}` : ''}
                  </span>
                )}
                {ts.status === 'error' && (
                  <span style={{ color: '#ff6b6b', fontSize: 12 }} title={ts.error}>
                    ✗ {ts.error}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        );
      })}

      {dbConnections.length > 0 && (
        <div className="form-hint">
          {t('terminal:building.dbAfterSaving')}
        </div>
      )}
    </div>
  );
}
