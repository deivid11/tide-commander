import React, { useState, useEffect } from 'react';
import { fetchSystemPrompt, updateSystemPrompt, clearSystemPrompt } from '../../api/system-settings';
import '../styles/system-prompt-section.scss';

interface SystemPromptSectionProps {
  searchQuery?: string;
}

export const SystemPromptSection: React.FC<SystemPromptSectionProps> = ({ searchQuery = '' }) => {
  const [prompt, setPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Load system prompt on mount
  useEffect(() => {
    loadSystemPrompt();
  }, []);

  const loadSystemPrompt = async () => {
    try {
      setLoading(true);
      setError(null);
      const content = await fetchSystemPrompt();
      setPrompt(content);
      setOriginalPrompt(content);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system prompt');
    } finally {
      setLoading(false);
    }
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newPrompt = e.target.value;
    setPrompt(newPrompt);
    setIsDirty(newPrompt !== originalPrompt);
    setError(null);
    setSuccess(null);
  };

  const handleSave = async () => {
    try {
      setError(null);
      setSuccess(null);
      await updateSystemPrompt(prompt);
      setOriginalPrompt(prompt);
      setIsDirty(false);
      setSuccess('System prompt saved successfully. It will apply to all new agent sessions.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save system prompt');
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Are you sure you want to clear the system prompt?')) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      await clearSystemPrompt();
      setPrompt('');
      setOriginalPrompt('');
      setIsDirty(false);
      setSuccess('System prompt cleared successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear system prompt');
    }
  };

  const handleReset = () => {
    setPrompt(originalPrompt);
    setIsDirty(false);
    setError(null);
    setSuccess(null);
  };

  // Filter based on search query
  if (searchQuery && !'system prompt'.includes(searchQuery.toLowerCase())) {
    return null;
  }

  return (
    <div className="system-prompt-section">
      <div className="section-header">
        <h3>System Prompt</h3>
        <p className="section-description">
          Add global instructions that will apply to all agents. This appears after Tide Commander base rules but before agent-specific instructions.
        </p>
      </div>

      {loading ? (
        <div className="loading">Loading system prompt...</div>
      ) : (
        <div className="section-content">
          {error && (
            <div className="alert alert-error">
              <span className="alert-icon">⚠️</span>
              {error}
            </div>
          )}

          {success && (
            <div className="alert alert-success">
              <span className="alert-icon">✓</span>
              {success}
            </div>
          )}

          <div className="editor-wrapper">
            <div className="editor-info">
              <span className="char-count">
                {prompt.length} characters
              </span>
            </div>

            <textarea
              className="prompt-editor"
              value={prompt}
              onChange={handlePromptChange}
              placeholder="Enter your global system prompt here...&#10;&#10;Examples:&#10;- Coding style guidelines&#10;- Team communication rules&#10;- Project-wide conventions&#10;- Security best practices"
              rows={12}
            />

            <div className="editor-hint">
              This prompt will be inserted into the system instructions for all agents.
            </div>
          </div>

          <div className="button-group">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!isDirty || loading}
            >
              Save Prompt
            </button>

            <button
              className="btn btn-secondary"
              onClick={handleReset}
              disabled={!isDirty || loading}
            >
              Reset Changes
            </button>

            <button
              className="btn btn-danger"
              onClick={handleClear}
              disabled={!prompt || loading}
            >
              Clear Prompt
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
