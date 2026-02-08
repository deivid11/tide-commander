import React from 'react';

// Preset colors for building customization
export const BUILDING_COLORS = [
  { value: '', label: 'Default' },
  { value: '#2a2a3a', label: 'Dark Gray' },
  { value: '#3a2a2a', label: 'Dark Red' },
  { value: '#2a3a2a', label: 'Dark Green' },
  { value: '#2a2a4a', label: 'Dark Blue' },
  { value: '#3a3a2a', label: 'Dark Yellow' },
  { value: '#3a2a3a', label: 'Dark Purple' },
  { value: '#2a3a3a', label: 'Dark Cyan' },
  { value: '#4a3a3a', label: 'Warm Brown' },
  { value: '#3a4a4a', label: 'Cool Steel' },
];

// Format bytes to human readable
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format uptime to human readable
export function formatUptime(startTime: number): string {
  const now = Date.now();
  const diff = now - startTime;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ANSI color code to CSS color mapping
const ANSI_COLORS: Record<number, string> = {
  30: '#1a1a1a', 31: '#e74c3c', 32: '#2ecc71', 33: '#f39c12',
  34: '#3498db', 35: '#9b59b6', 36: '#00bcd4', 37: '#ecf0f1',
  90: '#7f8c8d', 91: '#ff6b6b', 92: '#4ade80', 93: '#fbbf24',
  94: '#60a5fa', 95: '#c084fc', 96: '#22d3ee', 97: '#ffffff',
};

// Convert ANSI escape codes to HTML spans with colors
export function ansiToHtml(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\x1B\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | null = null;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textPart = text.slice(lastIndex, match.index);
      if (currentColor) {
        parts.push(<span key={parts.length} style={{ color: currentColor }}>{textPart}</span>);
      } else {
        parts.push(textPart);
      }
    }
    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0 || code === 39) currentColor = null;
      else if (ANSI_COLORS[code]) currentColor = ANSI_COLORS[code];
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const textPart = text.slice(lastIndex);
    if (currentColor) {
      parts.push(<span key={parts.length} style={{ color: currentColor }}>{textPart}</span>);
    } else {
      parts.push(textPart);
    }
  }
  return parts.length > 0 ? parts : [text];
}

// Delete confirmation modal
interface DeleteConfirmModalProps {
  buildingName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmModal({ buildingName, onClose, onConfirm }: DeleteConfirmModalProps) {
  return (
    <div className="modal-overlay visible" onClick={onClose}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">Delete Building</div>
        <div className="modal-body confirm-modal-body">
          <p>
            Delete <strong>{buildingName}</strong>?
          </p>
          <p className="confirm-modal-note">
            This will permanently remove the building and its configuration.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} autoFocus>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
