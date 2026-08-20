import { useCallback, useState, type MouseEvent } from 'react';
import { Icon } from '../Icon';
import { copyTextToClipboard } from '../../utils/clipboard';
import './CopyAgentIdentityButton.scss';

export function formatAgentIdentity(name: string, id: string): string {
  return `${name} (${id})`;
}

interface CopyAgentIdentityButtonProps {
  name: string;
  id: string;
  className?: string;
}

/** Small copy control for an agent's display name plus id. */
export function CopyAgentIdentityButton({
  name,
  id,
  className,
}: CopyAgentIdentityButtonProps) {
  const [copied, setCopied] = useState(false);
  const value = formatAgentIdentity(name, id);
  const title = copied ? 'Copied name and id' : `Copy ${value}`;

  const handleClick = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void copyTextToClipboard(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard can be blocked by the browser */
      });
  }, [value]);

  return (
    <button
      type="button"
      className={`copy-agent-identity-btn${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      onMouseDown={(event) => event.stopPropagation()}
      title={title}
      aria-label={title}
    >
      <Icon name={copied ? 'check' : 'copy'} size={11} />
    </button>
  );
}
