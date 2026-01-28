/**
 * Custom hook for managing terminal input state including:
 * - Per-agent input text (persisted to storage)
 * - Pasted text collapsing
 * - Attached files
 * - File uploads
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { STORAGE_KEYS, getStorageString, setStorageString, removeStorage, apiUrl, authFetch, getAuthHeaders } from '../../utils/storage';
import type { AttachedFile } from './types';

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
  setAttachedFiles: (value: AttachedFile[] | ((prev: AttachedFile[]) => AttachedFile[])) => void;
  removeAttachedFile: (id: number) => void;

  // Helpers
  uploadFile: (file: File | Blob, filename?: string) => Promise<AttachedFile | null>;
  expandPastedTexts: (text: string) => string;
  getTextareaRows: () => number;
}

export function useTerminalInput({ selectedAgentId }: UseTerminalInputOptions): TerminalInputState {
  // Per-agent input state
  const [agentCommands, setAgentCommands] = useState<Map<string, string>>(new Map());
  const [agentForceTextarea, setAgentForceTextarea] = useState<Map<string, boolean>>(new Map());
  const [agentPastedTexts, setAgentPastedTexts] = useState<Map<string, Map<number, string>>>(new Map());
  const [agentAttachedFiles, setAgentAttachedFiles] = useState<Map<string, AttachedFile[]>>(new Map());
  const agentPastedCountRef = useRef<Map<string, number>>(new Map());
  const fileCountRef = useRef(0);

  // Load persisted data from localStorage when agent changes
  useEffect(() => {
    if (!selectedAgentId) return;

    // Check if we already have data loaded for this agent (avoid overwriting in-memory state)
    if (agentCommands.has(selectedAgentId)) return;

    // Load input text from storage
    const savedInput = getStorageString(`${STORAGE_KEYS.INPUT_TEXT_PREFIX}${selectedAgentId}`);
    if (savedInput) {
      setAgentCommands((prev) => new Map(prev).set(selectedAgentId, savedInput));
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

  // Get current agent's values
  const command = selectedAgentId ? agentCommands.get(selectedAgentId) || '' : '';
  const forceTextarea = selectedAgentId ? agentForceTextarea.get(selectedAgentId) || false : false;
  const pastedTexts = selectedAgentId ? agentPastedTexts.get(selectedAgentId) || new Map() : new Map<number, string>();
  const attachedFiles = selectedAgentId ? agentAttachedFiles.get(selectedAgentId) || [] : [];

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
  const uploadFile = useCallback(async (file: File | Blob, filename?: string): Promise<AttachedFile | null> => {
    try {
      const response = await authFetch(apiUrl('/api/files/upload'), {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': filename || (file instanceof File ? file.name : ''),
        },
        body: file,
      });

      if (!response.ok) {
        console.error('Upload failed:', await response.text());
        return null;
      }

      const data = await response.json();
      fileCountRef.current += 1;

      return {
        id: fileCountRef.current,
        name: data.filename,
        path: data.absolutePath,
        isImage: data.isImage,
        size: data.size,
      };
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
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

  return {
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
    setAttachedFiles,
    removeAttachedFile,
    uploadFile,
    expandPastedTexts,
    getTextareaRows,
  };
}
