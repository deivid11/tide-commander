/**
 * Custom hook for managing agent input state in CommanderView
 * Simpler than useTerminalInput since each AgentPanel manages its own state
 */

import { useState, useRef, useCallback } from 'react';
import type { AttachedFile } from './types';

interface UseAgentInputReturn {
  // Input text management
  command: string;
  setCommand: (value: string) => void;

  // Textarea mode
  forceTextarea: boolean;
  setForceTextarea: (value: boolean) => void;
  useTextarea: boolean;
  getTextareaRows: () => number;

  // Pasted texts
  pastedTexts: Map<number, string>;
  addPastedText: (text: string) => number;
  expandPastedTexts: (text: string) => string;

  // Attached files
  attachedFiles: AttachedFile[];
  addAttachedFile: (file: AttachedFile) => void;
  removeAttachedFile: (id: number) => void;

  // File upload helper
  uploadFile: (file: File | Blob, filename?: string) => Promise<AttachedFile | null>;

  // Reset all state (after send)
  resetInput: () => void;
}

export function useAgentInput(): UseAgentInputReturn {
  const [command, setCommand] = useState('');
  const [forceTextarea, setForceTextarea] = useState(false);
  const [pastedTexts, setPastedTexts] = useState<Map<number, string>>(new Map());
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const pastedCountRef = useRef(0);
  const fileCountRef = useRef(0);

  // Use textarea if: forced, has newlines, or text is long
  const hasNewlines = command.includes('\n');
  const useTextarea = forceTextarea || hasNewlines || command.length > 50;

  // Calculate textarea rows based on content
  const getTextareaRows = useCallback(() => {
    const lineCount = (command.match(/\n/g) || []).length + 1;
    const charRows = Math.ceil(command.length / 50); // ~50 chars per row (narrower panels)
    const rows = Math.max(lineCount, charRows, 2);
    return Math.min(rows, 8); // Max 8 rows
  }, [command]);

  // Add pasted text and return its ID
  const addPastedText = useCallback((text: string): number => {
    pastedCountRef.current += 1;
    const pasteId = pastedCountRef.current;
    setPastedTexts(prev => new Map(prev).set(pasteId, text));
    return pasteId;
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

  // Add attached file
  const addAttachedFile = useCallback((file: AttachedFile) => {
    setAttachedFiles(prev => [...prev, file]);
  }, []);

  // Remove attached file
  const removeAttachedFile = useCallback((id: number) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  // Upload file to server
  const uploadFile = useCallback(async (file: File | Blob, filename?: string): Promise<AttachedFile | null> => {
    try {
      const response = await fetch('/api/files/upload', {
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

  // Reset all input state after sending
  const resetInput = useCallback(() => {
    setCommand('');
    setForceTextarea(false);
    setPastedTexts(new Map());
    setAttachedFiles([]);
    pastedCountRef.current = 0;
  }, []);

  return {
    command,
    setCommand,
    forceTextarea,
    setForceTextarea,
    useTextarea,
    getTextareaRows,
    pastedTexts,
    addPastedText,
    expandPastedTexts,
    attachedFiles,
    addAttachedFile,
    removeAttachedFile,
    uploadFile,
    resetInput,
  };
}
