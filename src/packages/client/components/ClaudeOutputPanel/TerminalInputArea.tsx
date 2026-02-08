/**
 * TerminalInputArea - Input area component for the terminal panel
 *
 * Handles text input, file attachments, paste handling, and send functionality.
 */

import React, { useRef, useEffect, useState } from 'react';
import { store, useSettings } from '../../store';
import { PermissionRequestInline } from './PermissionRequest';
import { getImageWebUrl } from './contentRendering';
import { PastedTextChip } from './PastedTextChip';
import { useSTT } from '../../hooks/useSTT';
import type { Agent, PermissionRequest } from '../../../shared/types';
import type { AttachedFile } from './types';

export interface TerminalInputAreaProps {
  selectedAgent: Agent;
  selectedAgentId: string;
  // Terminal open state for autofocus
  isOpen: boolean;
  // Input state from useTerminalInput hook
  command: string;
  setCommand: (cmd: string) => void;
  forceTextarea: boolean;
  setForceTextarea: (force: boolean) => void;
  useTextarea: boolean;
  attachedFiles: AttachedFile[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  removeAttachedFile: (id: number) => void;
  uploadFile: (file: File) => Promise<AttachedFile | null>;
  pastedTexts: Map<number, string>;
  expandPastedTexts: (text: string) => string;
  incrementPastedCount: () => number;
  setPastedTexts: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  resetPastedCount: () => void;
  // Keyboard handling
  handleInputFocus: () => void;
  handleInputBlur: () => void;
  // Permission requests
  pendingPermissions: PermissionRequest[];
  // Completion indicator
  showCompletion: boolean;
  // Image modal handler
  onImageClick: (url: string, name: string) => void;
  // External refs for input elements (for keyboard navigation focus)
  inputRef?: React.RefObject<HTMLInputElement | null>;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  // Whether viewing a snapshot (read-only mode)
  isSnapshotView?: boolean;
  // Clear loaded history in panel (used by /clear command parity with header action)
  onClearHistory: () => void;
}

export function TerminalInputArea({
  selectedAgent,
  selectedAgentId,
  isOpen,
  command,
  setCommand,
  forceTextarea: _forceTextarea,
  setForceTextarea,
  useTextarea,
  attachedFiles,
  setAttachedFiles,
  removeAttachedFile,
  uploadFile,
  pastedTexts,
  expandPastedTexts,
  incrementPastedCount,
  setPastedTexts,
  resetPastedCount,
  handleInputFocus,
  handleInputBlur,
  pendingPermissions,
  showCompletion,
  onImageClick,
  inputRef: externalInputRef,
  textareaRef: externalTextareaRef,
  isSnapshotView = false,
  onClearHistory,
}: TerminalInputAreaProps) {
  // Use external refs if provided, otherwise create internal ones
  const internalInputRef = useRef<HTMLInputElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevUseTextareaRef = useRef(useTextarea);
  const cursorPositionRef = useRef<number>(0);

  // Get settings to check if TTS feature is enabled
  const settings = useSettings();

  // Speech-to-text hook - automatically send transcribed text to agent
  const { recording, transcribing, toggleRecording } = useSTT({
    language: 'Spanish',
    model: 'medium',
    onTranscription: (text) => {
      // Send transcribed text directly to the agent
      if (text.trim() && selectedAgentId) {
        store.sendCommand(selectedAgentId, text.trim());
      }
    },
  });

  // Track cursor position on every input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    cursorPositionRef.current = e.target.selectionStart || e.target.value.length;
    setCommand(e.target.value);
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !useTextarea) return;

    const isMobile = window.innerWidth <= 768;
    const maxHeight = isMobile ? 200 : 180;

    requestAnimationFrame(() => {
      textarea.style.height = '0px';
      textarea.style.overflow = 'hidden';

      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.max(46, Math.min(scrollHeight, maxHeight));

      textarea.style.height = `${newHeight}px`;
      textarea.style.overflow = newHeight >= maxHeight ? 'auto' : 'hidden';
    });
  }, [command, useTextarea]);

  // Restore focus and cursor position when switching between input and textarea
  useEffect(() => {
    if (prevUseTextareaRef.current !== useTextarea) {
      prevUseTextareaRef.current = useTextarea;
      // When switching input type, restore focus and cursor position to the new element
      requestAnimationFrame(() => {
        const pos = cursorPositionRef.current;
        if (useTextarea && textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(pos, pos);
        } else if (!useTextarea && inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(pos, pos);
        }
      });
    }
  }, [useTextarea]);

  // Track previous isOpen state for transition detection
  const prevIsOpenRef = useRef(false);

  // Autofocus input when terminal opens or agent changes while open
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    // Check if this selection was from a swipe gesture (consumes and clears the flag)
    // If so, don't autofocus to prevent keyboard from popping up on mobile
    const wasSwipe = store.consumeSwipeSelectionFlag();

    // Check if this selection was from a direct click on agent bar (consumes and clears the flag)
    // If so, don't autofocus to prevent keyboard from popping up on mobile
    const wasDirectClick = store.consumeDirectClickSelectionFlag();

    // Focus when terminal opens (transition from closed to open)
    // or when agent changes while terminal is already open (but not from swipe or direct click)
    if (isOpen && (!wasOpen || selectedAgentId) && !wasSwipe && !wasDirectClick) {
      // Small delay to ensure terminal animation has started
      const timeoutId = setTimeout(() => {
        if (useTextarea && textareaRef.current) {
          textareaRef.current.focus();
        } else if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, selectedAgentId, useTextarea]);

  // Remove a pasted text and its placeholder from the command
  const removePastedText = (id: number) => {
    // Remove placeholder from command
    const placeholder = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]\\s*`, 'g');
    setCommand(command.replace(placeholder, '').trim());
    // Remove from pastedTexts map
    setPastedTexts((prev) => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
  };

  // Extract pasted text info from command for display
  const getPastedTextInfo = (): Array<{ id: number; lineCount: number }> => {
    const pattern = /\[Pasted text #(\d+) \+(\d+) lines\]/g;
    const results: Array<{ id: number; lineCount: number }> = [];
    let match;
    while ((match = pattern.exec(command)) !== null) {
      results.push({ id: parseInt(match[1], 10), lineCount: parseInt(match[2], 10) });
    }
    return results;
  };

  const pastedTextInfos = getPastedTextInfo();

  const handleSendCommand = () => {
    if ((!command.trim() && attachedFiles.length === 0) || !selectedAgentId) return;

    if (command.trim() === '/clear' && attachedFiles.length === 0) {
      store.clearContext(selectedAgentId);
      onClearHistory();
      setCommand('');
      setForceTextarea(false);
      setPastedTexts(new Map());
      setAttachedFiles([]);
      resetPastedCount();
      return;
    }

    let fullCommand = expandPastedTexts(command.trim());

    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles
        .map((f) => {
          if (f.isImage) {
            return `[Image: ${f.path}]`;
          } else {
            return `[File: ${f.path}]`;
          }
        })
        .join('\n');

      if (fullCommand) {
        fullCommand = `${fullCommand}\n\n${fileRefs}`;
      } else {
        fullCommand = fileRefs;
      }
    }

    store.sendCommand(selectedAgentId, fullCommand);
    setCommand('');
    setForceTextarea(false);
    setPastedTexts(new Map());
    setAttachedFiles([]);
    resetPastedCount();

    // On mobile, blur input to hide keyboard
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      inputRef.current?.blur();
      textareaRef.current?.blur();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isMobile = window.innerWidth <= 768;

    if (e.key === 'Enter') {
      // On mobile: Enter adds newline
      // On desktop: Shift+Enter adds newline, Enter sends
      if (isMobile) {
        if (!useTextarea) {
          e.preventDefault();
          setForceTextarea(true);
          setTimeout(() => {
            setCommand(command + '\n');
          }, 0);
        }
        return;
      }

      // Desktop behavior
      if (e.shiftKey) {
        if (!useTextarea) {
          e.preventDefault();
          setForceTextarea(true);
        }
        return;
      }
      e.preventDefault();
      handleSendCommand();
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Allow normal mouse events on input/textarea
    // Middle-click paste is now only disabled on the container itself
  };

  const handleContainerAuxClick = (e: React.MouseEvent) => {
    // Disable middle-click (auxclick is the proper event for middle-click)
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const attached = await uploadFile(blob);
          if (attached) {
            setAttachedFiles((prev) => [...prev, attached]);
          }
        }
        return;
      }
    }

    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        const attached = await uploadFile(file);
        if (attached) {
          setAttachedFiles((prev) => [...prev, attached]);
        }
      }
      return;
    }

    const pastedText = e.clipboardData.getData('text');
    const lineCount = (pastedText.match(/\n/g) || []).length + 1;

    if (lineCount > 5) {
      e.preventDefault();
      const pasteId = incrementPastedCount();

      setPastedTexts((prev) => new Map(prev).set(pasteId, pastedText));

      const placeholder = `[Pasted text #${pasteId} +${lineCount} lines]`;
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newCommand = command.slice(0, start) + placeholder + command.slice(end);
      const newCursorPos = start + placeholder.length;
      cursorPositionRef.current = newCursorPos;
      setCommand(newCommand);

      if (!useTextarea) {
        setForceTextarea(true);
      } else {
        // Already in textarea mode - restore cursor after React re-render
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        });
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      const attached = await uploadFile(file);
      if (attached) {
        setAttachedFiles((prev) => [...prev, attached]);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      {/* Permission requests bar */}
      {pendingPermissions.length > 0 && (
        <div className="permission-bar">
          {pendingPermissions.map((request) => (
            <PermissionRequestInline
              key={request.id}
              request={request}
              onApprove={(remember) => store.respondToPermissionRequest(request.id, true, undefined, remember)}
              onDeny={() => store.respondToPermissionRequest(request.id, false)}
            />
          ))}
        </div>
      )}

      {/* Pasted text chips display */}
      {pastedTextInfos.length > 0 && (
        <div className="guake-pasted-texts">
          {pastedTextInfos.map(({ id, lineCount }) => {
            const fullText = pastedTexts.get(id) || '';
            return (
              <PastedTextChip
                key={id}
                id={id}
                lineCount={lineCount}
                fullText={fullText}
                onRemove={() => removePastedText(id)}
              />
            );
          })}
        </div>
      )}

      {/* Attached files display */}
      {attachedFiles.length > 0 && (
        <div className="guake-attachments">
          {attachedFiles.map((file) => (
            <div
              key={file.id}
              className={`guake-attachment ${file.isImage ? 'is-image clickable' : ''}`}
              onClick={() => {
                if (file.isImage) {
                  onImageClick(getImageWebUrl(file.path), file.name);
                }
              }}
            >
              <span className="guake-attachment-icon">{file.isImage ? '🖼️' : '📎'}</span>
              <span className="guake-attachment-name" title={file.path}>
                {file.name}
              </span>
              <span className="guake-attachment-size">({Math.round(file.size / 1024)}KB)</span>
              <button
                className="guake-attachment-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAttachedFile(file.id);
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`guake-input-wrapper ${selectedAgent.status === 'working' ? 'has-stop-btn is-working' : ''} ${showCompletion ? 'is-completed' : ''} ${isSnapshotView ? 'is-snapshot-view' : ''}`}>
        {/* Floating stop button - shown when agent is working */}
        {selectedAgent.status === 'working' && (
          <div className="guake-stop-bar">
            <button
              className="guake-stop-btn"
              onClick={() => store.stopAgent(selectedAgent.id)}
              title="Stop current operation (Esc)"
            >
              <span className="stop-icon">■</span>
              <span className="stop-label">Stop</span>
            </button>
          </div>
        )}

        <div className={`guake-input ${useTextarea ? 'guake-input-expanded' : ''}`}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.sh,.css,.scss,.html,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf"
          />
          <div className="guake-input-container" onAuxClick={handleContainerAuxClick}>
            <button
              className="guake-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file (or paste image)"
            >
              📎
            </button>
            {settings.experimentalTTS && (
              <button
                className={`guake-mic-btn ${recording ? 'recording' : ''} ${transcribing ? 'transcribing' : ''}`}
                onClick={toggleRecording}
                title={recording ? 'Stop recording' : transcribing ? 'Transcribing...' : 'Voice input (Whisper)'}
                disabled={transcribing}
              >
                {transcribing ? '⏳' : recording ? '🔴' : '🎤'}
              </button>
            )}
            {useTextarea ? (
              <textarea
                ref={textareaRef}
                placeholder={`Message ${selectedAgent.name}...`}
                value={command}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onMouseDown={handleMouseDown}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                placeholder={`Message ${selectedAgent.name}...`}
                value={command}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onMouseDown={handleMouseDown}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
              />
            )}
            <button onClick={handleSendCommand} disabled={!command.trim() && attachedFiles.length === 0} title="Send">
              ➤
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
