import React, { useEffect, useRef } from 'react';
import { Icon } from '../Icon';

export interface FileMentionItem {
  path: string;
  name: string;
  type: 'file' | 'dir';
}

interface FileMentionDropdownProps {
  items: FileMentionItem[];
  selectedIndex: number;
  onSelect: (item: FileMentionItem) => void;
  onClose: () => void;
}

function fileIcon(name: string): React.ReactElement {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cs', 'cpp', 'c', 'h', 'rb', 'php', 'swift', 'kt'].includes(ext)) {
    return <Icon name="file-code" size={12} />;
  }
  if (['md', 'txt', 'rst', 'log'].includes(ext)) {
    return <Icon name="file-text" size={12} />;
  }
  if (['json', 'yaml', 'yml', 'toml', 'xml', 'env', 'ini'].includes(ext)) {
    return <Icon name="list" size={12} />;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return <Icon name="eye" size={12} />;
  }
  if (['sh', 'bash', 'zsh', 'fish'].includes(ext)) {
    return <Icon name="terminal" size={12} />;
  }
  return <Icon name="file" size={12} />;
}

export function FileMentionDropdown({ items, selectedIndex, onSelect, onClose }: FileMentionDropdownProps) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div className="file-mention-dropdown" role="listbox">
      <ul ref={listRef} className="file-mention-dropdown__list">
        {items.map((item, i) => (
          <li
            key={item.path}
            role="option"
            aria-selected={i === selectedIndex}
            className={`file-mention-dropdown__item ${i === selectedIndex ? 'is-selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
          >
            <span className="file-mention-dropdown__icon">
              {item.type === 'dir'
                ? <Icon name="folder" size={12} />
                : fileIcon(item.name)
              }
            </span>
            <span className="file-mention-dropdown__name">{item.name}</span>
            <span className="file-mention-dropdown__path">{item.path}</span>
          </li>
        ))}
      </ul>
      <div className="file-mention-dropdown__hint">
        ↑↓ navegar · Enter seleccionar · Esc cerrar
      </div>
    </div>
  );
}
