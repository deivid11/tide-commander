import React, { useState } from 'react';
import { useSecretsArray, store } from '../../store';
import type { Secret } from '../../../shared/types';

export function SecretsSection() {
  const secrets = useSecretsArray();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', key: '', value: '', description: '' });

  const handleAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormData({ name: '', key: '', value: '', description: '' });
  };

  const handleEdit = (secret: Secret) => {
    setEditingId(secret.id);
    setIsAdding(false);
    setFormData({
      name: secret.name,
      key: secret.key,
      value: secret.value,
      description: secret.description || '',
    });
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', key: '', value: '', description: '' });
  };

  const handleSave = () => {
    if (!formData.name.trim() || !formData.key.trim()) return;

    if (editingId) {
      store.updateSecret(editingId, {
        name: formData.name.trim(),
        key: formData.key.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        value: formData.value,
        description: formData.description.trim() || undefined,
      });
    } else {
      store.createSecret({
        name: formData.name.trim(),
        key: formData.key.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        value: formData.value,
        description: formData.description.trim() || undefined,
      });
    }
    handleCancel();
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this secret?')) {
      store.deleteSecret(id);
      if (editingId === id) handleCancel();
    }
  };

  const copyPlaceholder = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`);
  };

  return (
    <div className="secrets-section">
      <div className="secrets-description">
        Store secrets that can be referenced in prompts using <code>{`{{KEY}}`}</code> placeholders.
      </div>

      {/* Secrets List */}
      <div className="secrets-list">
        {secrets.length === 0 && !isAdding ? (
          <div className="secrets-empty">No secrets configured</div>
        ) : (
          secrets.map((secret) => (
            <div
              key={secret.id}
              className={`secret-item ${editingId === secret.id ? 'editing' : ''}`}
            >
              <div className="secret-item-header">
                <div className="secret-item-info">
                  <span className="secret-item-name">{secret.name}</span>
                  <code
                    className="secret-item-key"
                    onClick={() => copyPlaceholder(secret.key)}
                    title="Click to copy placeholder"
                  >
                    {`{{${secret.key}}}`}
                  </code>
                </div>
                <div className="secret-item-actions">
                  <button
                    className="secret-item-btn edit"
                    onClick={() => handleEdit(secret)}
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button
                    className="secret-item-btn delete"
                    onClick={() => handleDelete(secret.id)}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
              {secret.description && (
                <div className="secret-item-description">{secret.description}</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Form */}
      {(isAdding || editingId) && (
        <div className="secret-form">
          <div className="secret-form-row">
            <label className="secret-form-label">Name</label>
            <input
              type="text"
              className="secret-form-input"
              placeholder="My API Key"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="secret-form-row">
            <label className="secret-form-label">Key</label>
            <input
              type="text"
              className="secret-form-input"
              placeholder="MY_API_KEY"
              value={formData.key}
              onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
            />
            <span className="secret-form-hint">Used as {`{{${formData.key || 'KEY'}}}`}</span>
          </div>
          <div className="secret-form-row">
            <label className="secret-form-label">Value</label>
            <input
              type="password"
              className="secret-form-input"
              placeholder="secret value..."
              value={formData.value}
              onChange={(e) => setFormData({ ...formData, value: e.target.value })}
            />
          </div>
          <div className="secret-form-row">
            <label className="secret-form-label">Description</label>
            <input
              type="text"
              className="secret-form-input"
              placeholder="Optional description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          <div className="secret-form-actions">
            <button className="secret-form-btn cancel" onClick={handleCancel}>
              Cancel
            </button>
            <button
              className="secret-form-btn save"
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.key.trim()}
            >
              {editingId ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Add Button */}
      {!isAdding && !editingId && (
        <button className="secrets-add-btn" onClick={handleAdd}>
          + Add Secret
        </button>
      )}
    </div>
  );
}
