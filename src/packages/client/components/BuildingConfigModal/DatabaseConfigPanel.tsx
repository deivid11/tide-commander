import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  DATABASE_ENGINES,
  type DatabaseEngine,
  type DatabaseConnection,
} from '../../../shared/types';
import { HelpTooltip } from '../shared/Tooltip';

interface DatabaseConfigPanelProps {
  dbConnections: DatabaseConnection[];
  setDbConnections: (v: DatabaseConnection[]) => void;
  activeDbConnectionId: string | undefined;
  setActiveDbConnectionId: (v: string | undefined) => void;
}

export function DatabaseConfigPanel({
  dbConnections,
  setDbConnections,
  activeDbConnectionId,
  setActiveDbConnectionId,
}: DatabaseConfigPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
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

      {dbConnections.map((conn, index) => (
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
                onChange={(e) => {
                  const newConns = [...dbConnections];
                  newConns[index] = { ...conn, name: e.target.value };
                  setDbConnections(newConns);
                }}
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
                  const newConns = [...dbConnections];
                  newConns[index] = {
                    ...conn,
                    engine,
                    port: DATABASE_ENGINES[engine].defaultPort,
                  };
                  setDbConnections(newConns);
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

          <div className="db-connection-row">
            <div className="db-field db-field--grow">
              <label>{t('terminal:building.dbHost')}</label>
              <input
                type="text"
                className="form-input"
                value={conn.host}
                onChange={(e) => {
                  const newConns = [...dbConnections];
                  newConns[index] = { ...conn, host: e.target.value };
                  setDbConnections(newConns);
                }}
                placeholder="localhost"
              />
            </div>
            <div className="db-field db-field--small">
              <label>{t('terminal:building.dbPort')}</label>
              <input
                type="number"
                className="form-input"
                value={conn.port}
                onChange={(e) => {
                  const newConns = [...dbConnections];
                  newConns[index] = { ...conn, port: parseInt(e.target.value) || DATABASE_ENGINES[conn.engine].defaultPort };
                  setDbConnections(newConns);
                }}
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
                onChange={(e) => {
                  const newConns = [...dbConnections];
                  newConns[index] = { ...conn, username: e.target.value };
                  setDbConnections(newConns);
                }}
                placeholder="root"
              />
            </div>
            <div className="db-field">
              <label>{t('terminal:building.dbPassword')}</label>
              <input
                type="password"
                className="form-input"
                value={conn.password || ''}
                onChange={(e) => {
                  const newConns = [...dbConnections];
                  newConns[index] = { ...conn, password: e.target.value || undefined };
                  setDbConnections(newConns);
                }}
                placeholder="Optional"
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
                onChange={(e) => {
                  const newConns = [...dbConnections];
                  newConns[index] = { ...conn, database: e.target.value || undefined };
                  setDbConnections(newConns);
                }}
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
                  onChange={(e) => {
                    const newConns = [...dbConnections];
                    newConns[index] = { ...conn, ssl: e.target.checked };
                    setDbConnections(newConns);
                  }}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
              </label>
            </div>
          </div>
        </div>
      ))}

      {dbConnections.length > 0 && (
        <div className="form-hint">
          {t('terminal:building.dbAfterSaving')}
        </div>
      )}
    </div>
  );
}
