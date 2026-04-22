import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { apiUrl, authFetch } from '../../utils/storage';
import { fetchBackupStatus, updateBackupEnabled, type BackupStatus } from '../../api/system-settings';

// Config category for export/import
interface ConfigCategory {
  id: string;
  name: string;
  description: string;
  fileCount?: number;
}

// Local copy of the Toggle used in ConfigSection.tsx — keeps CSS class parity.
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className="config-toggle">
      <input
        type="checkbox"
        className="config-toggle-input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="config-toggle-track">
        <span className="config-toggle-thumb" />
      </span>
    </label>
  );
}

export function DataSection() {
  const { t } = useTranslation(['config', 'common']);
  const [categories, setCategories] = useState<ConfigCategory[]>([]);
  const [selectedExport, setSelectedExport] = useState<Set<string>>(new Set());
  const [selectedImport, setSelectedImport] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ version: string; exportedAt: string; categories: ConfigCategory[] } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Hourly-backup cron status
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  // Fetch available categories on mount
  useEffect(() => {
    authFetch(apiUrl('/api/config/categories'))
      .then(res => res.json())
      .then((cats: ConfigCategory[] | unknown) => {
        const arr = Array.isArray(cats) ? cats : [];
        setCategories(arr);
        setSelectedExport(new Set(arr.map(c => c.id)));
      })
      .catch(err => console.error('Failed to fetch config categories:', err));
  }, []);

  // Fetch backup cron status on mount
  useEffect(() => {
    fetchBackupStatus()
      .then(setBackupStatus)
      .catch(err => {
        console.error('Failed to fetch backup status:', err);
        setBackupError(err.message || 'Failed to fetch backup status');
      });
  }, []);

  const handleToggleBackup = async (enabled: boolean) => {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupError(null);
    try {
      const next = await updateBackupEnabled(enabled);
      setBackupStatus(next);
    } catch (err: any) {
      setBackupError(err.message || 'Failed to update backup setting');
    } finally {
      setBackupBusy(false);
    }
  };

  const toggleExportCategory = (id: string) => {
    setSelectedExport(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleImportCategory = (id: string) => {
    setSelectedImport(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllExport = () => setSelectedExport(new Set(categories.map(c => c.id)));
  const selectNoneExport = () => setSelectedExport(new Set());

  const selectAllImport = () => {
    if (importPreview) {
      setSelectedImport(new Set(importPreview.categories.map(c => c.id)));
    }
  };
  const selectNoneImport = () => setSelectedImport(new Set());

  const handleExport = async () => {
    if (selectedExport.size === 0) return;

    setIsExporting(true);
    setMessage(null);

    try {
      const categoriesParam = Array.from(selectedExport).join(',');
      const response = await authFetch(apiUrl(`/api/config/export?categories=${categoriesParam}`));

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || 'tide-commander-config.zip';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setMessage({ type: 'success', text: t('config:data.exportSuccess') });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Export failed' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setMessage(null);
    setImportPreview(null);
    setSelectedImport(new Set());

    try {
      const response = await authFetch(apiUrl('/api/config/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: await file.arrayBuffer(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to preview config file');
      }

      const preview = await response.json();
      const previewCats = Array.isArray(preview.categories) ? preview.categories : [];
      setImportPreview({ ...preview, categories: previewCats });
      setSelectedImport(new Set(previewCats.map((c: ConfigCategory) => c.id)));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to read config file' });
      setImportFile(null);
    }
  };

  const handleImport = async () => {
    if (!importFile || selectedImport.size === 0) return;

    setIsImporting(true);
    setMessage(null);

    try {
      const categoriesParam = Array.from(selectedImport).join(',');
      const response = await authFetch(apiUrl(`/api/config/import?categories=${categoriesParam}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: await importFile.arrayBuffer(),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }

      setMessage({ type: 'success', text: result.message || t('config:data.importSuccess') });
      setImportFile(null);
      setImportPreview(null);
      setSelectedImport(new Set());
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Import failed' });
    } finally {
      setIsImporting(false);
    }
  };

  const cancelImport = () => {
    setImportFile(null);
    setImportPreview(null);
    setSelectedImport(new Set());
    setMessage(null);
  };

  return (
    <div className="data-section">
      {message && (
        <div className={`data-message data-message-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Hourly Backup Toggle */}
      <div className="data-subsection">
        <div className="data-subsection-header">
          <span className="data-subsection-title">Hourly Backups</span>
          <Toggle
            checked={!!backupStatus?.enabled}
            disabled={backupBusy || !backupStatus}
            onChange={handleToggleBackup}
          />
        </div>
        <div className="data-backup-info">
          {backupStatus ? (
            <>
              <div>
                Saves a compressed snapshot of your data every hour to{' '}
                <code>{backupStatus.backupDir}</code>.
                Identical snapshots are skipped. Keeps the 8 newest plus one from each
                of the 2 most recent prior days.
              </div>
              {!backupStatus.scriptExists && (
                <div style={{ marginTop: 6, color: 'var(--dracula-red, #ff5555)' }}>
                  Backup script not found at <code>{backupStatus.scriptPath}</code>
                </div>
              )}
              {backupStatus.lastRunAt && (
                <div style={{ marginTop: 6 }}>
                  Last run: {new Date(backupStatus.lastRunAt).toLocaleString()}
                  {backupStatus.lastRunOk === true && ' — ok'}
                  {backupStatus.lastRunOk === false && backupStatus.lastRunError && (
                    <span style={{ color: 'var(--dracula-red, #ff5555)' }}>
                      {' — '}{backupStatus.lastRunError}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div>Loading backup status…</div>
          )}
          {backupError && (
            <div className="data-message data-message-error" style={{ marginTop: 6 }}>
              {backupError}
            </div>
          )}
        </div>
      </div>

      {/* Export Section */}
      <div className="data-subsection">
        <div className="data-subsection-header">
          <span className="data-subsection-title">{t('config:data.exportData')}</span>
          <div className="data-select-controls">
            <button className="data-select-btn" onClick={selectAllExport}>{t('common:labels.all')}</button>
            <button className="data-select-btn" onClick={selectNoneExport}>{t('common:labels.none')}</button>
          </div>
        </div>
        <div className="data-category-list">
          {categories.map(cat => (
            <label key={cat.id} className="data-category-item">
              <input
                type="checkbox"
                checked={selectedExport.has(cat.id)}
                onChange={() => toggleExportCategory(cat.id)}
              />
              <span className="data-category-name">{cat.name}</span>
            </label>
          ))}
        </div>
        <button
          className="data-action-btn export"
          onClick={handleExport}
          disabled={isExporting || selectedExport.size === 0}
        >
          {isExporting ? t('config:data.exporting') : t('config:data.exportCount', { count: selectedExport.size })}
        </button>
      </div>

      {/* Import Section */}
      <div className="data-subsection">
        <div className="data-subsection-header">
          <span className="data-subsection-title">{t('config:data.importData')}</span>
        </div>

        {!importFile ? (
          <label className="data-file-input">
            <input
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <span className="data-file-input-label">{t('config:data.selectFile')}</span>
          </label>
        ) : importPreview ? (
          <>
            <div className="data-import-info">
              <div className="data-import-file">{importFile.name}</div>
              <div className="data-import-date">
                {t('config:data.exported')}: {new Date(importPreview.exportedAt).toLocaleDateString()}
              </div>
            </div>
            <div className="data-subsection-header">
              <span className="data-subsection-subtitle">{t('config:data.selectToImport')}</span>
              <div className="data-select-controls">
                <button className="data-select-btn" onClick={selectAllImport}>{t('common:labels.all')}</button>
                <button className="data-select-btn" onClick={selectNoneImport}>{t('common:labels.none')}</button>
              </div>
            </div>
            <div className="data-category-list">
              {importPreview.categories.map(cat => (
                <label key={cat.id} className="data-category-item">
                  <input
                    type="checkbox"
                    checked={selectedImport.has(cat.id)}
                    onChange={() => toggleImportCategory(cat.id)}
                  />
                  <span className="data-category-name">{cat.name}</span>
                  {cat.fileCount && (
                    <span className="data-category-count">({cat.fileCount} {t('config:data.files')})</span>
                  )}
                </label>
              ))}
            </div>
            <div className="data-import-actions">
              <button className="data-action-btn cancel" onClick={cancelImport}>
                {t('common:buttons.cancel')}
              </button>
              <button
                className="data-action-btn import"
                onClick={handleImport}
                disabled={isImporting || selectedImport.size === 0}
              >
                {isImporting ? t('config:data.importing') : t('config:data.importCount', { count: selectedImport.size })}
              </button>
            </div>
          </>
        ) : (
          <div className="data-loading">{t('config:data.readingFile')}</div>
        )}
      </div>
    </div>
  );
}
