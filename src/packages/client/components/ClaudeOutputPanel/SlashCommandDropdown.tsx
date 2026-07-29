import { useEffect, useRef } from 'react';
import { Icon } from '../Icon';
import type { SlashCommand } from '../../utils/slashCommands';

interface SlashCommandDropdownProps {
  items: SlashCommand[];
  selectedIndex: number;
  onSelect: (item: SlashCommand) => void;
}

/**
 * Autocomplete for CLI slash commands. Shares the file-mention dropdown's
 * styling so `@` and `/` feel like one mechanism, with its own accent so you
 * can tell at a glance which one is open.
 */
export function SlashCommandDropdown({ items, selectedIndex, onSelect }: SlashCommandDropdownProps) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div className="file-mention-dropdown slash-command-dropdown" role="listbox">
      <ul ref={listRef} className="file-mention-dropdown__list">
        {items.map((item, i) => (
          <li
            key={item.name}
            role="option"
            aria-selected={i === selectedIndex}
            className={`file-mention-dropdown__item is-slash ${i === selectedIndex ? 'is-selected' : ''}`}
            onMouseDown={(e) => {
              // mousedown, not click: the input must not lose focus first.
              e.preventDefault();
              onSelect(item);
            }}
          >
            <span className="file-mention-dropdown__icon">
              <Icon name="terminal" size={12} />
            </span>
            <span className="file-mention-dropdown__name">{item.name}</span>
            <span className="file-mention-dropdown__path">{item.summary}</span>
          </li>
        ))}
      </ul>
      <div className="file-mention-dropdown__hint">
        ↑↓ navegar · Tab/Enter completar · Esc cerrar
      </div>
    </div>
  );
}
