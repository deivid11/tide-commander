import React, { useState, useEffect } from 'react';
import { apiUrl, authFetch } from '../../utils/storage';

// Config category for export/import
interface ConfigCategory {
  id: string;
  name: string;
  description: string;
  fileCount?: number;
}

export function DataSection() {
  const [categories, setCategories] = useState<ConfigCategory[]>([]);
  const [selectedExport, setSelectedExport] = useState<Set<string>>(new Set());
  const [selectedImport, setSelectedImport] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ version: string; exportedAt: string; categories: ConfigCategory[] } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch available categories on mount
  useEffect(() => {
    authFetch(apiUrl('/api/config/categories'))
      .then(res => res.json())
      .then((cats: ConfigCategory[]) => {
        setCategories(cats);
        setSelectedExport(new Set(cats.map(c => c.id)));
      })
      .catch(err => console.error('Failed to fetch config categories:', err));
  }, []);

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

      setMessage({ type: 'success', text: 'Config exported successfully!' });
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
      setImportPreview(preview);
      setSelectedImport(new Set(preview.categories.map((c: ConfigCategory) => c.id)));
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

      setMessage({ type: 'success', text: result.message || 'Config imported successfully!' });
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

      {/* Export Section */}
      <div className="data-subsection">
        <div className="data-subsection-header">
          <span className="data-subsection-title">Export</span>
          <div className="data-select-controls">
            <button className="data-select-btn" onClick={selectAllExport}>All</button>
            <button className="data-select-btn" onClick={selectNoneExport}>None</button>
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
          {isExporting ? 'Exporting...' : `Export (${selectedExport.size})`}
        </button>
      </div>

      {/* Import Section */}
      <div className="data-subsection">
        <div className="data-subsection-header">
          <span className="data-subsection-title">Import</span>
        </div>

        {!importFile ? (
          <label className="data-file-input">
            <input
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <span className="data-file-input-label">Select config ZIP file...</span>
          </label>
        ) : importPreview ? (
          <>
            <div className="data-import-info">
              <div className="data-import-file">{importFile.name}</div>
              <div className="data-import-date">
                Exported: {new Date(importPreview.exportedAt).toLocaleDateString()}
              </div>
            </div>
            <div className="data-subsection-header">
              <span className="data-subsection-subtitle">Select what to import:</span>
              <div className="data-select-controls">
                <button className="data-select-btn" onClick={selectAllImport}>All</button>
                <button className="data-select-btn" onClick={selectNoneImport}>None</button>
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
                    <span className="data-category-count">({cat.fileCount} files)</span>
                  )}
                </label>
              ))}
            </div>
            <div className="data-import-actions">
              <button className="data-action-btn cancel" onClick={cancelImport}>
                Cancel
              </button>
              <button
                className="data-action-btn import"
                onClick={handleImport}
                disabled={isImporting || selectedImport.size === 0}
              >
                {isImporting ? 'Importing...' : `Import (${selectedImport.size})`}
              </button>
            </div>
          </>
        ) : (
          <div className="data-loading">Reading file...</div>
        )}
      </div>
    </div>
  );
}
