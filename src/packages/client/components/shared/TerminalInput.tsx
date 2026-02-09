/**
 * Shared TerminalInput component
 * Used by both ClaudeOutputPanel (Guake) and CommanderView (AgentPanel)
 *
 * Handles:
 * - Text input with auto-expand to textarea
 * - File attachments and image paste
 * - Large text paste collapsing
 * - Auto-resize textarea
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { AttachedFile } from './outputTypes';

interface TerminalInputProps {
  // Input state
  command: string;
  onCommandChange: (value: string) => void;

  // Textarea mode
  useTextarea: boolean;
  forceTextarea: boolean;
  onForceTextarea: (value: boolean) => void;

  // Send handling
  onSend: () => void;
  canSend: boolean;

  // File attachments
  attachedFiles: AttachedFile[];
  onAddFile: (file: AttachedFile) => void;
  onRemoveFile: (id: number) => void;
  uploadFile: (file: File | Blob, filename?: string) => Promise<AttachedFile | null>;

  // Pasted text handling
  onAddPastedText: (text: string) => number;

  // Optional props
  placeholder?: string;
  className?: string;
  compact?: boolean; // For smaller Commander panels
  inputRef?: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

export function TerminalInput({
  command,
  onCommandChange,
  useTextarea,
  forceTextarea: _forceTextarea,
  onForceTextarea,
  onSend,
  canSend,
  attachedFiles,
  onAddFile,
  onRemoveFile,
  uploadFile,
  onAddPastedText,
  placeholder = 'Message...',
  className = '',
  compact = false,
  inputRef,
}: TerminalInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // When switching from input to textarea, focus and place cursor at end
  const prevUseTextareaRef = useRef(useTextarea);
  useEffect(() => {
    if (useTextarea && !prevUseTextareaRef.current && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    }
    prevUseTextareaRef.current = useTextarea;
  }, [useTextarea]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !useTextarea) return;

    textarea.style.height = 'auto';
    const maxHeight = compact ? 120 : 180;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [command, useTextarea, compact]);

  // Handle paste event
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    // Check for images first
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const attached = await uploadFile(blob);
          if (attached) {
            onAddFile(attached);
          }
        }
        return;
      }
    }

    // Check for files
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        const attached = await uploadFile(file);
        if (attached) {
          onAddFile(attached);
        }
      }
      return;
    }

    // Handle text paste (collapse large text)
    const pastedText = e.clipboardData.getData('text');
    const lineCount = (pastedText.match(/\n/g) || []).length + 1;

    if (lineCount > 5) {
      e.preventDefault();
      const pasteId = onAddPastedText(pastedText);

      const placeholder = `[Pasted text #${pasteId} +${lineCount} lines]`;
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newCommand = command.slice(0, start) + placeholder + command.slice(end);
      onCommandChange(newCommand);

      if (!useTextarea) {
        onForceTextarea(true);
      }
    }
  }, [command, onCommandChange, useTextarea, onForceTextarea, uploadFile, onAddFile, onAddPastedText]);

  // Handle file input change
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      const attached = await uploadFile(file);
      if (attached) {
        onAddFile(attached);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [uploadFile, onAddFile]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Shift+Enter: switch to textarea mode or add newline
    if (e.key === 'Enter' && e.shiftKey) {
      if (!useTextarea) {
        e.preventDefault();
        onForceTextarea(true);
      }
      return;
    }
    // Regular Enter: send command
    if (e.key === 'Enter') {
      e.preventDefault();
      onSend();
    }
  }, [useTextarea, onForceTextarea, onSend]);

  // Allow normal mouse events on input/textarea
  // Middle-click paste is now only disabled on the container itself
  const handleMouseDown = useCallback((_e: React.MouseEvent) => {
    // No-op: allow all mouse events on input/textarea
  }, []);

  // Disable middle-click (auxclick is the proper event for middle-click)
  const handleContainerAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // Combined ref handler for textarea
  const setTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    inputRef?.(el);
  }, [inputRef]);

  const baseClass = compact ? 'agent-panel-input' : 'guake-input';
  const containerClass = compact ? 'agent-panel-input-container' : 'guake-input-container';
  const attachBtnClass = compact ? 'agent-panel-attach-btn' : 'guake-attach-btn';
  const sendBtnClass = compact ? 'agent-panel-send-btn' : '';
  const expandedClass = useTextarea ? (compact ? 'agent-panel-input-expanded' : 'guake-input-expanded') : '';

  return (
    <>
      {/* Attached files display */}
      {attachedFiles.length > 0 && (
        <div className={compact ? 'agent-panel-attachments' : 'guake-attachments'}>
          {attachedFiles.map(file => (
            <div
              key={file.id}
              className={`${compact ? 'agent-panel-attachment' : 'guake-attachment'} ${file.isImage ? 'is-image' : ''}`}
            >
              <span className={compact ? 'agent-panel-attachment-icon' : 'guake-attachment-icon'}>
                {file.isImage ? '🖼️' : '📎'}
              </span>
              <span
                className={compact ? 'agent-panel-attachment-name' : 'guake-attachment-name'}
                title={file.path}
              >
                {file.name}
              </span>
              {!compact && (
                <span className="guake-attachment-size">({Math.round(file.size / 1024)}KB)</span>
              )}
              <button
                className={compact ? 'agent-panel-attachment-remove' : 'guake-attachment-remove'}
                onClick={() => onRemoveFile(file.id)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`${baseClass} ${expandedClass} ${className}`}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.sh,.css,.scss,.html,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf"
        />
        <div className={containerClass} onAuxClick={handleContainerAuxClick}>
          <button
            className={attachBtnClass}
            onClick={() => fileInputRef.current?.click()}
            title="Attach file (or paste image)"
          >
            📎
          </button>
          {useTextarea ? (
            <textarea
              ref={setTextareaRef}
              placeholder={placeholder}
              value={command}
              onChange={e => onCommandChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onMouseDown={handleMouseDown}
            />
          ) : (
            <input
              ref={inputRef as React.RefCallback<HTMLInputElement>}
              type="text"
              placeholder={placeholder}
              value={command}
              onChange={e => onCommandChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onMouseDown={handleMouseDown}
            />
          )}
          <button
            className={sendBtnClass}
            onClick={onSend}
            disabled={!canSend}
            title="Send"
          >
            ➤
          </button>
        </div>
      </div>
    </>
  );
}
