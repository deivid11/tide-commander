/**
 * Copy-as-curl helpers shared by the HTTP-requests building modal and the
 * inline terminal run card.
 */

import { useState } from 'react';
import { Icon } from '../Icon';
import type { HttpResolvedRequest } from '../../../shared/types';

/** Build a shell-safe multi-line curl command for a request. */
export function buildCurlCommand(req: HttpResolvedRequest): string {
  const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const method = req.method.toUpperCase();
  let first = 'curl -sS';
  if (method === 'HEAD') first += ' --head';
  else if (method !== 'GET') first += ` -X ${method}`;
  first += ` ${sq(req.url)}`;
  const lines = [first];
  for (const h of req.headers) lines.push(`  -H ${sq(`${h.name}: ${h.value}`)}`);
  if (req.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    lines.push(`  --data-raw ${sq(req.body)}`);
  }
  return lines.join(' \\\n');
}

/** "curl" copy button with a short "Copied" confirmation. */
export function CopyCurlButton({
  request,
  title,
  className = 'hrm-btn small',
}: {
  request: HttpResolvedRequest;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      title={title ?? 'Copy this request as a curl command'}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(buildCurlCommand(request)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={11} /> {copied ? 'Copied' : 'curl'}
    </button>
  );
}
