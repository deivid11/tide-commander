import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSecretsArray, store } from '../../store';
import type { Secret } from '../../../shared/types';

export function SecretsSection() {
  const { t } = useTranslation(['config', 'common']);
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
    if (confirm(t('config:secrets.deleteConfirm'))) {
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
        {t('config:secrets.description', { placeholder: '{{KEY}}' })}
      </div>

      {/* Secrets List */}
      <div className="secrets-list">
        {secrets.length === 0 && !isAdding ? (
          <div className="secrets-empty">{t('config:secrets.noSecrets')}</div>
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
                    title={t('config:secrets.copyPlaceholder')}
                  >
                    {`{{${secret.key}}}`}
                  </code>
                </div>
                <div className="secret-item-actions">
                  <button
                    className="secret-item-btn edit"
                    onClick={() => handleEdit(secret)}
                    title={t('common:buttons.edit')}
                  >
                    ✎
                  </button>
                  <button
                    className="secret-item-btn delete"
                    onClick={() => handleDelete(secret.id)}
                    title={t('common:buttons.delete')}
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
            <label className="secret-form-label">{t('common:labels.name')}</label>
            <input
              type="text"
              className="secret-form-input"
              placeholder={t('config:secrets.namePlaceholder')}
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
              placeholder={t('config:secrets.keyPlaceholder')}
              value={formData.key}
              onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
            />
            <span className="secret-form-hint">{t('config:secrets.usedAs', { placeholder: `{{${formData.key || 'KEY'}}}` })}</span>
          </div>
          <div className="secret-form-row">
            <label className="secret-form-label">{t('config:secrets.secretValue')}</label>
            <input
              type="password"
              className="secret-form-input"
              placeholder={t('config:secrets.valuePlaceholder')}
              value={formData.value}
              onChange={(e) => setFormData({ ...formData, value: e.target.value })}
            />
          </div>
          <div className="secret-form-row">
            <label className="secret-form-label">{t('common:labels.description')}</label>
            <input
              type="text"
              className="secret-form-input"
              placeholder={t('config:secrets.descriptionPlaceholder')}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          <div className="secret-form-actions">
            <button className="secret-form-btn cancel" onClick={handleCancel}>
              {t('common:buttons.cancel')}
            </button>
            <button
              className="secret-form-btn save"
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.key.trim()}
            >
              {editingId ? t('config:secrets.update') : t('common:buttons.add')}
            </button>
          </div>
        </div>
      )}

      {/* Add Button */}
      {!isAdding && !editingId && (
        <button className="secrets-add-btn" onClick={handleAdd}>
          {t('config:secrets.addSecret')}
        </button>
      )}
    </div>
  );
}
