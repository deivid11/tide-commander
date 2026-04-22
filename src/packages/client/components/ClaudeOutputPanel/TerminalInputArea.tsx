/**
 * TerminalInputArea - Input area component for the terminal panel
 *
 * Handles text input, file attachments, paste handling, and send functionality.
 */

import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useSettings, useLastPrompt } from '../../store';
import { PermissionRequestInline } from './PermissionRequest';
import { getImageWebUrl } from './contentRendering';
import { PastedTextChip } from './PastedTextChip';
import { useSTT } from '../../hooks/useSTT';
import type { Agent, PermissionRequest } from '../../../shared/types';
import type { AttachedFile } from './types';
import { Icon } from '../Icon';

/**
 * Isolated elapsed timer component — owns its own 1-second setInterval so the
 * parent TerminalInputArea is NOT re-rendered every tick.
 */
const ElapsedTimer = memo(function ElapsedTimer({
  agentId,
  isWorking,
  timestamp,
}: {
  agentId: string;
  isWorking: boolean;
  timestamp: number | undefined;
}) {
  const { t } = useTranslation(['terminal']);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isWorking || !timestamp) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - timestamp);
    const interval = setInterval(() => {
      setElapsed(Date.now() - timestamp);
    }, 1000);
    return () => clearInterval(interval);
  }, [isWorking, timestamp]);

  if (!isWorking) return null;

  return (
    <div className="guake-stop-bar">
      <span className="guake-elapsed-timer">{formatElapsed(elapsed)}</span>
      <button
        className="guake-stop-btn"
        onClick={() => store.stopAgent(agentId)}
        title={t('terminal:input.stopOperation')}
      >
        <span className="stop-icon"><Icon name="stop" size={12} weight="fill" /></span>
        <span className="stop-label">{t('terminal:input.stop')}</span>
      </button>
    </div>
  );
});

/**
 * Get VSCode icon SVG path for file type based on extension
 */
function getFileIcon(ext: string): string {
  const iconMap: Record<string, string> = {
    // Documents
    pdf: 'file_type_pdf.svg',
    doc: 'file_type_word.svg',
    docx: 'file_type_word.svg',
    xls: 'file_type_excel.svg',
    xlsx: 'file_type_excel.svg',
    ppt: 'file_type_powerpoint.svg',
    pptx: 'file_type_powerpoint.svg',
    txt: 'file_type_text.svg',
    md: 'file_type_markdown.svg',
    // Code
    js: 'file_type_javascript_official.svg',
    jsx: 'file_type_javascript_official.svg',
    ts: 'file_type_typescript_official.svg',
    tsx: 'file_type_typescript_official.svg',
    py: 'file_type_python.svg',
    java: 'file_type_java.svg',
    cpp: 'file_type_cpp.svg',
    c: 'file_type_cpp.svg',
    h: 'file_type_cpp.svg',
    hpp: 'file_type_cpp.svg',
    cs: 'file_type_csharp.svg',
    go: 'file_type_go.svg',
    rs: 'file_type_rust.svg',
    php: 'file_type_php.svg',
    rb: 'file_type_ruby.svg',
    swift: 'file_type_swift.svg',
    kt: 'file_type_kotlin.svg',
    scala: 'file_type_scala.svg',
    r: 'file_type_r.svg',
    // Web
    html: 'file_type_html.svg',
    htm: 'file_type_html.svg',
    css: 'file_type_css.svg',
    scss: 'file_type_scss.svg',
    sass: 'file_type_sass.svg',
    less: 'file_type_less.svg',
    // Config/Data
    json: 'file_type_json_official.svg',
    yaml: 'file_type_yaml_official.svg',
    yml: 'file_type_yaml_official.svg',
    xml: 'file_type_xml.svg',
    toml: 'file_type_toml.svg',
    ini: 'file_type_ini.svg',
    env: 'file_type_dotenv.svg',
    sh: 'file_type_shell.svg',
    bash: 'file_type_shell.svg',
    zsh: 'file_type_shell.svg',
    fish: 'file_type_shell.svg',
    // Images (fallback, usually handled separately)
    png: 'file_type_image.svg',
    jpg: 'file_type_image.svg',
    jpeg: 'file_type_image.svg',
    gif: 'file_type_image.svg',
    svg: 'file_type_image.svg',
    webp: 'file_type_image.svg',
    // Archives
    zip: 'file_type_zip.svg',
    tar: 'file_type_tar.svg',
    gz: 'file_type_gzip.svg',
    rar: 'file_type_rar.svg',
    '7z': 'file_type_zip.svg',
    // Audio/Video
    mp3: 'file_type_audio.svg',
    mp4: 'file_type_video.svg',
    wav: 'file_type_audio.svg',
    mov: 'file_type_video.svg',
    mkv: 'file_type_video.svg',
    flv: 'file_type_video.svg',
    avi: 'file_type_video.svg',
    // Default
    default: 'default_file.svg',
  };

  return iconMap[ext.toLowerCase()] || iconMap.default;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const MOBILE_SWIPE_CLOSE_THRESHOLD_PX = 72;
const MOBILE_SWIPE_CLOSE_MAX_PULL_PX = 128;

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
  uploadFile: (file: File | Blob, filename?: string) => Promise<AttachedFile | null>;
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
  // Elapsed time at completion (ms)
  completionElapsed: number | null;
  // Image modal handler
  onImageClick: (url: string, name: string) => void;
  // External refs for input elements (for keyboard navigation focus)
  inputRef?: React.RefObject<HTMLInputElement | null>;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  // Clear loaded history in panel (used by /clear command parity with header action)
  onClearHistory: () => void;
  // Called after a message is sent (used to reset auto-scroll)
  onSendCommand?: () => void;
  // Mobile swipe-up close support (starts from input area)
  canSwipeClose?: boolean;
  onSwipeCloseOffsetChange?: (offset: number) => void;
  onSwipeClose?: () => void;
}

export const TerminalInputArea = memo(function TerminalInputArea({
  selectedAgent,
  selectedAgentId,
  isOpen: _isOpen,
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
  completionElapsed,
  onImageClick,
  inputRef: externalInputRef,
  textareaRef: externalTextareaRef,
  onClearHistory,
  onSendCommand,
  canSwipeClose = false,
  onSwipeCloseOffsetChange,
  onSwipeClose,
}: TerminalInputAreaProps) {
  const { t } = useTranslation(['terminal', 'common']);

  // Use external refs if provided, otherwise create internal ones
  const internalInputRef = useRef<HTMLInputElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevUseTextareaRef = useRef(useTextarea);
  const cursorPositionRef = useRef<number>(0);
  const swipeCloseResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeGestureRef = useRef({
    isTracking: false,
    startY: 0,
    startX: 0,
  });
  const [swipeCloseOffset, setSwipeCloseOffset] = useState(0);
  const [swipeClosePhase, setSwipeClosePhase] = useState<'idle' | 'dragging' | 'returning'>('idle');
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Array<{ id: string; name: string }>>([]);

  // Get settings to check if TTS feature is enabled
  const settings = useSettings();

  // Live elapsed timer — delegated to ElapsedTimer component to avoid
  // re-rendering the entire TerminalInputArea every second.
  const lastPrompt = useLastPrompt(selectedAgentId);
  const isWorking = selectedAgent.status === 'working';

  const focusGuakeInputContainer = useCallback(() => {
    const container = inputContainerRef.current;
    const activeInput = useTextarea ? textareaRef.current : inputRef.current;

    container?.focus({ preventScroll: true });
    activeInput?.focus({ preventScroll: true });
  }, [inputRef, textareaRef, useTextarea]);

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

  const clearSwipeCloseResetTimer = useCallback(() => {
    if (!swipeCloseResetTimerRef.current) return;
    clearTimeout(swipeCloseResetTimerRef.current);
    swipeCloseResetTimerRef.current = null;
  }, []);

  const resetSwipeCloseVisuals = useCallback((phase: 'idle' | 'returning' = 'idle') => {
    clearSwipeCloseResetTimer();
    setSwipeCloseOffset(0);
    setSwipeClosePhase(phase);
    onSwipeCloseOffsetChange?.(0);
    if (phase === 'returning') {
      swipeCloseResetTimerRef.current = setTimeout(() => {
        setSwipeClosePhase('idle');
        swipeCloseResetTimerRef.current = null;
      }, 160);
    }
  }, [clearSwipeCloseResetTimer, onSwipeCloseOffsetChange]);

  const handleSwipeCloseTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!canSwipeClose || !onSwipeClose) return;
    if (window.innerWidth > 768) return;
    if (e.touches.length !== 1) return;

    clearSwipeCloseResetTimer();
    const touch = e.touches[0];
    swipeGestureRef.current = {
      isTracking: true,
      startY: touch.clientY,
      startX: touch.clientX,
    };
    setSwipeClosePhase('idle');
    setSwipeCloseOffset(0);
    onSwipeCloseOffsetChange?.(0);
  }, [canSwipeClose, onSwipeClose, clearSwipeCloseResetTimer, onSwipeCloseOffsetChange]);

  const handleSwipeCloseTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeGestureRef.current.isTracking) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - swipeGestureRef.current.startY;
    const deltaX = Math.abs(touch.clientX - swipeGestureRef.current.startX);

    // Ignore mostly-horizontal gestures to avoid fighting agent swipe interactions.
    if (deltaX > 48 && deltaX > Math.abs(deltaY)) {
      swipeGestureRef.current.isTracking = false;
      resetSwipeCloseVisuals('returning');
      return;
    }

    if (deltaY >= 0) {
      setSwipeCloseOffset(0);
      setSwipeClosePhase('idle');
      return;
    }

    const upwardPull = Math.min(MOBILE_SWIPE_CLOSE_MAX_PULL_PX, Math.abs(deltaY));
    if (upwardPull > 8) {
      e.preventDefault();
    }
    setSwipeCloseOffset(upwardPull);
    setSwipeClosePhase('dragging');
    onSwipeCloseOffsetChange?.(upwardPull);
  }, [resetSwipeCloseVisuals, onSwipeCloseOffsetChange]);

  const handleSwipeCloseTouchEnd = useCallback(() => {
    if (!swipeGestureRef.current.isTracking) return;
    swipeGestureRef.current.isTracking = false;

    if (!canSwipeClose || !onSwipeClose) {
      resetSwipeCloseVisuals('returning');
      return;
    }

    if (swipeCloseOffset >= MOBILE_SWIPE_CLOSE_THRESHOLD_PX) {
      onSwipeClose();
      return;
    }

    resetSwipeCloseVisuals('returning');
  }, [canSwipeClose, onSwipeClose, swipeCloseOffset, resetSwipeCloseVisuals, onSwipeCloseOffsetChange]);

  const handleSwipeCloseTouchCancel = useCallback(() => {
    swipeGestureRef.current.isTracking = false;
    resetSwipeCloseVisuals('returning');
  }, [resetSwipeCloseVisuals]);

  useEffect(() => () => clearSwipeCloseResetTimer(), [clearSwipeCloseResetTimer]);

  useEffect(() => {
    if (canSwipeClose) return;
    swipeGestureRef.current.isTracking = false;
    resetSwipeCloseVisuals('idle');
  }, [canSwipeClose, resetSwipeCloseVisuals]);

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
    const minHeight = isInputExpanded ? 300 : 46;
    const maxHeight = isInputExpanded ? 500 : (isMobile ? 200 : 180);

    requestAnimationFrame(() => {
      textarea.style.height = '0px';
      textarea.style.overflow = 'hidden';

      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));

      textarea.style.height = `${newHeight}px`;
      textarea.style.overflow = newHeight >= maxHeight ? 'auto' : 'hidden';
    });
  }, [command, useTextarea, isInputExpanded]);

  // Restore focus and cursor position when switching between input and textarea
  useEffect(() => {
    if (prevUseTextareaRef.current !== useTextarea) {
      prevUseTextareaRef.current = useTextarea;
      // When switching input type, restore focus and cursor position to the new element
      requestAnimationFrame(() => {
        const pos = cursorPositionRef.current;
        if (useTextarea && textareaRef.current) {
          focusGuakeInputContainer();
          textareaRef.current.setSelectionRange(pos, pos);
        } else if (!useTextarea && inputRef.current) {
          focusGuakeInputContainer();
          inputRef.current.setSelectionRange(pos, pos);
        }
      });
    }
  }, [focusGuakeInputContainer, inputRef, textareaRef, useTextarea]);

  // Track previous open state so agent switches can keep the main guake input focused.
  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = _isOpen;

    const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    const wasSwipe = store.consumeSwipeSelectionFlag();
    const wasDirectClick = store.consumeDirectClickSelectionFlag();
    const shouldSuppressAutofocus = isTouchDevice && (wasSwipe || wasDirectClick);

    if (_isOpen && (!wasOpen || selectedAgentId) && !shouldSuppressAutofocus) {
      const timeoutId = setTimeout(() => {
        focusGuakeInputContainer();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [_isOpen, focusGuakeInputContainer, selectedAgentId]);

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

  // Wrap uploadFile with a loading indicator entry
  const uploadFileWithProgress = async (file: File | Blob, filename?: string): Promise<AttachedFile | null> => {
    const tempId = `${Date.now()}-${Math.random()}`;
    const displayName = filename || (file instanceof File ? file.name : t('terminal:input.uploadingFile'));
    setUploadingFiles((prev) => [...prev, { id: tempId, name: displayName }]);
    try {
      return await uploadFile(file, filename);
    } finally {
      setUploadingFiles((prev) => prev.filter((f) => f.id !== tempId));
    }
  };

  // Update pasted text content and refresh the line count in the command placeholder
  const updatePastedText = (id: number, newText: string) => {
    const newLineCount = (newText.match(/\n/g) || []).length + 1;
    const oldPattern = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`, 'g');
    setCommand(command.replace(oldPattern, `[Pasted text #${id} +${newLineCount} lines]`));
    setPastedTexts((prev) => new Map(prev).set(id, newText));
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

  const handleToggleExpand = () => {
    const next = !isInputExpanded;

    if (next) {
      // Expanding: inline each chip's full text so the user can view/edit the
      // pasted content directly in the textarea. pastedTexts is kept intact
      // so we can re-chip on collapse.
      let nextCommand = command;
      for (const [id, fullText] of pastedTexts) {
        const placeholder = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`, 'g');
        nextCommand = nextCommand.replace(placeholder, fullText);
      }
      if (nextCommand !== command) setCommand(nextCommand);
    } else {
      // Collapsing: re-chip each pasted text that still appears verbatim in
      // the command. Entries the user edited inline lose their chip identity
      // and stay inline.
      let nextCommand = command;
      const preserved = new Map<number, string>();
      for (const [id, fullText] of pastedTexts) {
        if (nextCommand.includes(fullText)) {
          const lineCount = (fullText.match(/\n/g) || []).length + 1;
          const placeholder = `[Pasted text #${id} +${lineCount} lines]`;
          nextCommand = nextCommand.replaceAll(fullText, placeholder);
          preserved.set(id, fullText);
        }
      }
      if (nextCommand !== command) setCommand(nextCommand);
      if (preserved.size !== pastedTexts.size) setPastedTexts(preserved);
    }

    setIsInputExpanded(next);
    if (next && !useTextarea) setForceTextarea(true);
  };

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
    onSendCommand?.();
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

  const handleMouseDown = (_e: React.MouseEvent) => {
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

    // Try to get files from clipboard items (works when copying files from file explorer)
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const attached = await uploadFileWithProgress(blob);
          if (attached) {
            setAttachedFiles((prev) => [...prev, attached]);
          }
        }
        return;
      }

      // Handle any file type (not just images)
      if (item.kind === 'file') {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const attached = await uploadFileWithProgress(file);
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
        const attached = await uploadFileWithProgress(file);
        if (attached) {
          setAttachedFiles((prev) => [...prev, attached]);
        }
      }
      return;
    }

    const pastedText = e.clipboardData.getData('text');

    // Check if pasted text is a file path (single line, looks like a file path, AND has a file extension)
    const isSingleLine = !pastedText.includes('\n');
    const looksLikeFilePath = /^[/~][^\s]*$|^[A-Za-z]:\\[^\s]*$/.test(pastedText.trim());
    const hasFileExtension = /\.[a-zA-Z0-9]{1,5}$/.test(pastedText.trim());

    if (isSingleLine && looksLikeFilePath && hasFileExtension) {
      e.preventDefault();
      try {
        // Request the file from the server
        const response = await fetch('/api/files/by-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: pastedText.trim() }),
        });

        if (response.ok) {
          const blob = await response.blob();
          const filename = pastedText.trim().split(/[/\\]/).pop() || 'file';
          const attached = await uploadFileWithProgress(blob, filename);
          if (attached) {
            setAttachedFiles((prev) => [...prev, attached]);
          }
          return;
        }
      } catch {
        /* File not found or fetch failed - fall through to insert as text */
      }
      // File not found or fetch failed - insert the path as plain text
      setCommand(command + pastedText);
      return;
    }

    const lineCount = (pastedText.match(/\n/g) || []).length + 1;

    // In expanded mode, let large pastes flow in inline so the user sees
    // everything they're editing without fabricating new chips to re-expand.
    if (lineCount > 5 && !isInputExpanded) {
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
      const attached = await uploadFileWithProgress(file);
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
                onUpdate={(newText) => updatePastedText(id, newText)}
              />
            );
          })}
        </div>
      )}

      {/* Attached files display */}
      {(attachedFiles.length > 0 || uploadingFiles.length > 0) && (
        <div className="guake-attachments">
          {uploadingFiles.map(({ id, name }) => (
            <div key={id} className="guake-attachment guake-attachment-uploading">
              <span className="guake-attachment-spinner" />
              <div className="guake-attachment-info">
                <div className="guake-attachment-name-row">
                  <span className="guake-attachment-name">{name}</span>
                </div>
                <span className="guake-attachment-size">{t('terminal:input.uploading')}</span>
              </div>
            </div>
          ))}
          {attachedFiles.map((file) => {
            const imageUrl = file.isImage ? getImageWebUrl(file.path) : null;
            const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
            const isDocument = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(fileExtension);

            return (
              <div
                key={file.id}
                className={`guake-attachment ${file.isImage ? 'is-image clickable' : ''} ${isDocument ? 'is-document' : ''}`}
                onClick={() => {
                  if (file.isImage) {
                    onImageClick(imageUrl!, file.name);
                  }
                }}
              >
                {file.isImage && imageUrl ? (
                  <img src={imageUrl} alt={file.name} className="guake-attachment-thumb" />
                ) : (
                  <img
                    src={`${import.meta.env.BASE_URL}assets/vscode-icons/${getFileIcon(fileExtension)}`}
                    alt={file.name}
                    className="guake-attachment-icon"
                    style={{ width: '24px', height: '24px' }}
                  />
                )}
                <div className="guake-attachment-info">
                  <div className="guake-attachment-name-row">
                    <img
                      src={`${import.meta.env.BASE_URL}assets/vscode-icons/${getFileIcon(fileExtension)}`}
                      alt={fileExtension}
                      className="guake-attachment-type-icon"
                      style={{ width: '11px', height: '11px' }}
                    />
                    <span className="guake-attachment-name" title={file.path}>
                      {file.name}
                    </span>
                  </div>
                  <span className="guake-attachment-size">({Math.round(file.size / 1024)}KB)</span>
                </div>
                <button
                  className="guake-attachment-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAttachedFile(file.id);
                  }}
                  title={t('terminal:input.removeAttachment')}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className={`guake-input-wrapper ${selectedAgent.status === 'working' ? 'has-stop-btn is-working' : ''} ${showCompletion ? 'is-completed' : ''}`}>
        <div
          className={`guake-input-swipe-shell ${swipeClosePhase !== 'idle' ? 'swipe-close-active' : ''} ${swipeCloseOffset >= MOBILE_SWIPE_CLOSE_THRESHOLD_PX ? 'swipe-close-ready' : ''}`}
          onTouchStart={handleSwipeCloseTouchStart}
          onTouchMove={handleSwipeCloseTouchMove}
          onTouchEnd={handleSwipeCloseTouchEnd}
          onTouchCancel={handleSwipeCloseTouchCancel}
        >
          {/* Mobile context bar - compact context stats above input */}
          {(() => {
            const stats = selectedAgent.contextStats;
            const totalTokens = stats ? stats.totalTokens : (selectedAgent.contextUsed || 0);
            const contextWindow = stats ? stats.contextWindow : (selectedAgent.contextLimit || 200000);
            const rawUsedPercent = stats ? stats.usedPercent : Math.round((totalTokens / contextWindow) * 100);
            const usedPercent = Math.max(0, Math.min(100, rawUsedPercent));
            const freePercent = Math.max(0, 100 - usedPercent);
            const percentColor = usedPercent >= 80 ? '#ff4a4a' : usedPercent >= 60 ? '#ff9e4a' : usedPercent >= 40 ? '#ffd700' : '#4aff9e';
            const usedK = (totalTokens / 1000).toFixed(1);
            const limitK = (contextWindow / 1000).toFixed(1);
            return (
              <div
                className="mobile-context-bar show-on-mobile"
                onClick={() => store.setContextModalAgentId(selectedAgentId)}
              >
                <span className="mobile-context-bar-fill" style={{ width: `${Math.min(100, usedPercent)}%`, backgroundColor: percentColor }} />
                <span className="mobile-context-bar-text">
                  <span style={{ color: percentColor }}>{usedK}k/{limitK}k</span>
                  <span className="mobile-context-bar-pct">({freePercent}% free)</span>
                </span>
              </div>
            );
          })()}
          {/* Floating stop button + elapsed timer - isolated component to avoid re-rendering input area */}
          <ElapsedTimer
            agentId={selectedAgentId}
            isWorking={isWorking}
            timestamp={lastPrompt?.timestamp}
          />
          {/* Completion elapsed time - shown briefly when agent finishes */}
          {showCompletion && completionElapsed !== null && (
            <div className="guake-completion-time">{formatElapsed(completionElapsed)}</div>
          )}

          <div className={`guake-input ${useTextarea ? 'guake-input-expanded' : ''}`}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              accept="*"
            />
            <div
              ref={inputContainerRef}
              className="guake-input-container"
              tabIndex={-1}
              onAuxClick={handleContainerAuxClick}
            >
              <button
                className="guake-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                title={t('terminal:input.attachOrPaste')}
              >
                <Icon name="paperclip" size={14} />
              </button>
              {settings.experimentalTTS && (
                <button
                  className={`guake-mic-btn ${recording ? 'recording' : ''} ${transcribing ? 'transcribing' : ''}`}
                  onClick={toggleRecording}
                  title={recording ? t('terminal:input.stopRecording') : transcribing ? t('terminal:input.transcribing') : t('terminal:input.voiceInput')}
                  disabled={transcribing}
                >
                  <Icon name={transcribing ? 'hourglass' : recording ? 'record' : 'microphone'} size={14} color={recording ? '#ef4444' : undefined} />
                </button>
              )}
              {useTextarea ? (
                <textarea
                  ref={textareaRef}
                  placeholder={t('terminal:input.placeholder', { agent: selectedAgent.name })}
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
                  placeholder={t('terminal:input.placeholder', { agent: selectedAgent.name })}
                  value={command}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onMouseDown={handleMouseDown}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                />
              )}
              <button
                className={`guake-expand-btn ${isInputExpanded ? 'active' : ''}`}
                onClick={handleToggleExpand}
                title={isInputExpanded ? t('terminal:input.collapseInput') : t('terminal:input.expandInput')}
                type="button"
              >
                <Icon name={isInputExpanded ? 'caret-down' : 'caret-up'} size={12} />
              </button>
              <button onClick={handleSendCommand} disabled={!command.trim() && attachedFiles.length === 0} title={t('terminal:input.send')}>
                <Icon name="send" size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});
