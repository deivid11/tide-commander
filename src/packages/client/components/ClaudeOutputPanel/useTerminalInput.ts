/**
 * Custom hook for managing terminal input state including:
 * - Per-agent input text (persisted to storage)
 * - Pasted text collapsing
 * - Attached files
 * - File uploads
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  STORAGE_KEYS,
  getStorageString,
  setStorageString,
  removeStorage,
  apiUrl,
  getAuthToken,
} from '../../utils/storage';
import { setAgentDraft } from '../../utils/agentDrafts';
import type { AttachedFile } from './types';

// Stable empty references to avoid defeating memo on consumers
const EMPTY_MAP = new Map<number, string>();
const EMPTY_FILES: AttachedFile[] = [];

interface UseTerminalInputOptions {
  selectedAgentId: string | null;
}

interface TerminalInputState {
  // Input text management
  command: string;
  setCommand: (value: string) => void;

  // Textarea mode
  forceTextarea: boolean;
  setForceTextarea: (value: boolean) => void;
  useTextarea: boolean;

  // Pasted texts
  pastedTexts: Map<number, string>;
  setPastedTexts: (value: Map<number, string> | ((prev: Map<number, string>) => Map<number, string>)) => void;
  incrementPastedCount: () => number;
  resetPastedCount: () => void;

  // Attached files
  attachedFiles: AttachedFile[];
  uploadingFiles: Array<{ id: string; name: string; progress: number }>;
  cancelUpload: (id: string) => void;
  setAttachedFiles: (value: AttachedFile[] | ((prev: AttachedFile[]) => AttachedFile[])) => void;
  removeAttachedFile: (id: number) => void;

  // Helpers
  uploadFile: (
    file: File | Blob,
    filename?: string,
    onProgress?: (percentage: number) => void,
  ) => Promise<AttachedFile | null>;
  expandPastedTexts: (text: string) => string;
  getTextareaRows: () => number;
}

export function useTerminalInput({ selectedAgentId }: UseTerminalInputOptions): TerminalInputState {
  // Per-agent input state
  const [agentCommands, setAgentCommands] = useState<Map<string, string>>(new Map());
  const [agentForceTextarea, setAgentForceTextarea] = useState<Map<string, boolean>>(new Map());
  const [agentPastedTexts, setAgentPastedTexts] = useState<Map<string, Map<number, string>>>(new Map());
  const [agentAttachedFiles, setAgentAttachedFiles] = useState<Map<string, AttachedFile[]>>(new Map());
  const [uploadingFiles, setUploadingFiles] = useState<Array<{
    id: string;
    name: string;
    progress: number;
  }>>([]);
  const agentPastedCountRef = useRef<Map<string, number>>(new Map());
  const fileCountRef = useRef(0);
  const uploadRequestsRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  // Load persisted data from localStorage when agent changes
  useEffect(() => {
    if (!selectedAgentId) return;

    // Check if we already have data loaded for this agent (avoid overwriting in-memory state)
    if (agentCommands.has(selectedAgentId)) return;

    // Load input text from storage
    const savedInput = getStorageString(`${STORAGE_KEYS.INPUT_TEXT_PREFIX}${selectedAgentId}`);
    if (savedInput) {
      setAgentCommands((prev) => new Map(prev).set(selectedAgentId, savedInput));
      setAgentDraft(selectedAgentId, savedInput.trim().length > 0);
    }

    // Load pasted texts from storage
    const savedPasted = getStorageString(`${STORAGE_KEYS.PASTED_TEXTS_PREFIX}${selectedAgentId}`);
    if (savedPasted) {
      try {
        const entries = JSON.parse(savedPasted) as [number, string][];
        const pastedMap = new Map(entries);
        setAgentPastedTexts((prev) => new Map(prev).set(selectedAgentId, pastedMap));
        // Restore the pasted count ref to the highest ID
        const maxId = Math.max(0, ...entries.map(([id]) => id));
        agentPastedCountRef.current.set(selectedAgentId, maxId);
      } catch {
        // Invalid JSON, ignore
      }
    }
  }, [selectedAgentId, agentCommands]);

  // Get current agent's values (use stable empty references to avoid defeating memo)
  const command = selectedAgentId ? agentCommands.get(selectedAgentId) || '' : '';
  const forceTextarea = selectedAgentId ? agentForceTextarea.get(selectedAgentId) || false : false;
  const pastedTexts = (selectedAgentId ? agentPastedTexts.get(selectedAgentId) : undefined) || EMPTY_MAP;
  const attachedFiles = (selectedAgentId ? agentAttachedFiles.get(selectedAgentId) : undefined) || EMPTY_FILES;

  // Use textarea if: forced, has newlines, or text is long
  // On mobile, always use textarea so Enter can add newlines
  const hasNewlines = command.includes('\n');
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const useTextarea = isMobile || forceTextarea || hasNewlines || command.length > 50;

  // Setters
  const setCommand = useCallback(
    (value: string) => {
      if (!selectedAgentId) return;
      setAgentCommands((prev) => new Map(prev).set(selectedAgentId, value));
      // Persist to storage
      if (value) {
        setStorageString(`${STORAGE_KEYS.INPUT_TEXT_PREFIX}${selectedAgentId}`, value);
      } else {
        removeStorage(`${STORAGE_KEYS.INPUT_TEXT_PREFIX}${selectedAgentId}`);
      }
      setAgentDraft(selectedAgentId, value.trim().length > 0);
    },
    [selectedAgentId]
  );

  const setForceTextarea = useCallback(
    (value: boolean) => {
      if (!selectedAgentId) return;
      setAgentForceTextarea((prev) => new Map(prev).set(selectedAgentId, value));
    },
    [selectedAgentId]
  );

  const setPastedTexts = useCallback(
    (value: Map<number, string> | ((prev: Map<number, string>) => Map<number, string>)) => {
      if (!selectedAgentId) return;
      setAgentPastedTexts((prev) => {
        const newMap = new Map(prev);
        const currentValue = prev.get(selectedAgentId) || new Map();
        const newValue = typeof value === 'function' ? value(currentValue) : value;
        newMap.set(selectedAgentId, newValue);
        // Persist pasted texts to storage
        if (newValue.size > 0) {
          const serialized = JSON.stringify(Array.from(newValue.entries()));
          setStorageString(`${STORAGE_KEYS.PASTED_TEXTS_PREFIX}${selectedAgentId}`, serialized);
        } else {
          removeStorage(`${STORAGE_KEYS.PASTED_TEXTS_PREFIX}${selectedAgentId}`);
        }
        return newMap;
      });
    },
    [selectedAgentId]
  );

  const setAttachedFiles = useCallback(
    (value: AttachedFile[] | ((prev: AttachedFile[]) => AttachedFile[])) => {
      if (!selectedAgentId) return;
      setAgentAttachedFiles((prev) => {
        const newMap = new Map(prev);
        const currentValue = prev.get(selectedAgentId) || [];
        const newValue = typeof value === 'function' ? value(currentValue) : value;
        newMap.set(selectedAgentId, newValue);
        return newMap;
      });
    },
    [selectedAgentId]
  );

  // Pasted text count helpers
  const incrementPastedCount = useCallback(() => {
    if (!selectedAgentId) return 0;
    const current = agentPastedCountRef.current.get(selectedAgentId) || 0;
    const next = current + 1;
    agentPastedCountRef.current.set(selectedAgentId, next);
    return next;
  }, [selectedAgentId]);

  const resetPastedCount = useCallback(() => {
    if (!selectedAgentId) return;
    agentPastedCountRef.current.set(selectedAgentId, 0);
  }, [selectedAgentId]);

  // File management
  const removeAttachedFile = useCallback(
    (id: number) => {
      setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
    },
    [setAttachedFiles]
  );

  // Upload file to server
  const uploadFile = useCallback(async (
    file: File | Blob,
    filename?: string,
    onProgress?: (percentage: number) => void,
  ): Promise<AttachedFile | null> => {
    const finalFilename = filename || (file instanceof File ? file.name : '');
    const encodedFilename = encodeURIComponent(finalFilename);
    const uploadId = `${Date.now()}-${Math.random()}`;
    const displayName = finalFilename || 'file';
    setUploadingFiles((current) => [...current, {
      id: uploadId,
      name: displayName,
      progress: 0,
    }]);

    const reportProgress = (percentage: number) => {
      setUploadingFiles((current) => current.map((entry) => entry.id === uploadId
        ? { ...entry, progress: percentage }
        : entry));
      onProgress?.(percentage);
    };

    try {

      // fetch does not expose upload progress. XHR is deliberately used for this
      // request so Guake can report actual bytes sent for large attachments.
      const data = await new Promise<{
        filename: string;
        absolutePath: string;
        isImage: boolean;
        size: number;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadRequestsRef.current.set(uploadId, xhr);
        xhr.open('POST', apiUrl('/api/files/upload'));
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.setRequestHeader('X-Filename', encodedFilename);
        const token = getAuthToken();
        if (token) xhr.setRequestHeader('X-Auth-Token', token);

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable || event.total <= 0) return;
          reportProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        };
        xhr.onerror = () => reject(new Error('Network error while uploading file'));
        xhr.onabort = () => reject(new DOMException('File upload was cancelled', 'AbortError'));
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
            return;
          }
          try {
            resolve(JSON.parse(xhr.responseText) as {
              filename: string;
              absolutePath: string;
              isImage: boolean;
              size: number;
            });
          } catch {
            reject(new Error('Upload returned an invalid response'));
          }
        };
        reportProgress(0);
        xhr.send(file);
      });

      reportProgress(100);
      fileCountRef.current += 1;
      return {
        id: fileCountRef.current,
        name: data.filename,
        path: data.absolutePath,
        isImage: data.isImage,
        size: data.size,
      };
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('Upload error:', err);
      }
      return null;
    } finally {
      uploadRequestsRef.current.delete(uploadId);
      setUploadingFiles((current) => current.filter((entry) => entry.id !== uploadId));
    }
  }, []);

  const cancelUpload = useCallback((id: string) => {
    uploadRequestsRef.current.get(id)?.abort();
  }, []);

  // Expand pasted text placeholders before sending
  const expandPastedTexts = useCallback(
    (text: string): string => {
      let expanded = text;
      for (const [id, pastedText] of pastedTexts) {
        const placeholder = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`, 'g');
        expanded = expanded.replace(placeholder, pastedText);
      }
      return expanded;
    },
    [pastedTexts]
  );

  // Calculate textarea rows based on content
  const getTextareaRows = useCallback(() => {
    const lineCount = (command.match(/\n/g) || []).length + 1;
    const charRows = Math.ceil(command.length / 60);
    const rows = Math.max(lineCount, charRows, 2);
    return Math.min(rows, 10);
  }, [command]);

  return useMemo(() => ({
    command,
    setCommand,
    forceTextarea,
    setForceTextarea,
    useTextarea,
    pastedTexts,
    setPastedTexts,
    incrementPastedCount,
    resetPastedCount,
    attachedFiles,
    uploadingFiles,
    cancelUpload,
    setAttachedFiles,
    removeAttachedFile,
    uploadFile,
    expandPastedTexts,
    getTextareaRows,
  }), [
    command, setCommand, forceTextarea, setForceTextarea, useTextarea,
    pastedTexts, setPastedTexts, incrementPastedCount, resetPastedCount,
    attachedFiles, uploadingFiles, cancelUpload, setAttachedFiles, removeAttachedFile, uploadFile,
    expandPastedTexts, getTextareaRows,
  ]);
}
