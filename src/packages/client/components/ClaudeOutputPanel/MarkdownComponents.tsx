/**
 * Custom markdown components with inline styles for guaranteed rendering
 * Using CSS variables directly for theme support
 */

import React from 'react';
import { Components } from 'react-markdown';
import { decodeTideFileHref } from '../../utils/outputRendering';

interface MarkdownComponentOptions {
  onFileClick?: (path: string) => void;
}

function getNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getNodeText(node.props.children);
  }
  return '';
}

function isLikelyFileHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('#')) return false;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href)) return false; // http:, https:, mailto:, etc
  return href.includes('.') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../');
}

function isLikelyFileText(value: string): boolean {
  if (!value) return false;
  if (value.includes('\n')) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return false;
  return trimmed.includes('.') && (trimmed.includes('/') || /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/.test(trimmed));
}

// Create markdown components that use CSS variables directly
// This allows themes to change without recreating components
export const createMarkdownComponents = ({ onFileClick }: MarkdownComponentOptions = {}): Components => ({
  h1: ({ children }) => (
    <h1 style={{ fontSize: '1.4em', color: 'var(--accent-pink)', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: '1.25em', color: 'var(--accent-purple)', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: '1.15em', color: 'var(--accent-cyan)', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 style={{ fontSize: '1.1em', color: 'var(--accent-green)', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 style={{ fontSize: '1.05em', color: 'var(--accent-yellow)', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 style={{ fontSize: '1em', color: 'var(--accent-orange)', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h6>
  ),
  p: ({ children }) => <p style={{ margin: '0.4em 0' }}>{children}</p>,
  strong: ({ children }) => <strong style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: 'var(--accent-yellow)', fontStyle: 'italic' }}>{children}</em>,
  del: ({ children }) => <del style={{ color: 'var(--accent-red)', textDecoration: 'line-through' }}>{children}</del>,
  code: ({ children, className }) => {
    // Check if it's a code block (has language class) or inline code
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <code style={{ background: 'none', padding: 0, color: 'var(--text-primary)', fontSize: '12px', lineHeight: 1.5 }}>
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          background: 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)',
          color: 'var(--accent-green)',
          padding: '0.15em 0.4em',
          borderRadius: '3px',
          fontSize: '0.9em',
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      style={{
        background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        padding: '12px',
        margin: '0.6em 0',
        overflowX: 'auto',
      }}
    >
      {children}
    </pre>
  ),
  ul: ({ children }) => <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em', lineHeight: 1.5 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em', lineHeight: 1.5 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '0.2em 0', paddingLeft: '0.3em' }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: '3px solid var(--accent-purple)',
        margin: '0.5em 0',
        padding: '0.5em 1em',
        background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)',
        borderRadius: '0 4px 4px 0',
      }}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => {
    const normalizedHref = typeof href === 'string' ? href.trim() : '';
    const tideFileRef = decodeTideFileHref(normalizedHref);
    const textRef = getNodeText(children).trim();
    const fileRef = tideFileRef
      || (normalizedHref && isLikelyFileHref(normalizedHref) ? normalizedHref : null)
      || ((!normalizedHref || normalizedHref === '#') && isLikelyFileText(textRef) ? textRef : null);
    if (fileRef && onFileClick) {
      return (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFileClick(fileRef);
          }}
          className="clickable-path"
          title={`Open ${fileRef}`}
        >
          {children}
        </a>
      );
    }
    if (!normalizedHref) {
      return <span>{children}</span>;
    }
    return (
      <a href={normalizedHref} style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}>
        {children}
      </a>
    );
  },
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '1em 0' }} />,
  table: ({ children }) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', margin: '0.6em 0', fontSize: '12px' }}>
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: '1px solid var(--border-color)',
        padding: '6px 10px',
        textAlign: 'left',
        background: 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)',
        fontWeight: 600,
        color: 'var(--accent-pink)',
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        border: '1px solid var(--border-color)',
        padding: '6px 10px',
        textAlign: 'left',
        background: 'color-mix(in srgb, var(--bg-secondary) 50%, transparent)',
      }}
    >
      {children}
    </td>
  ),
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <input type="checkbox" checked={checked} readOnly style={{ marginRight: '0.5em', accentColor: 'var(--accent-green)' }} />
    ) : null,
});

// Legacy export for backward compatibility (same as markdownComponents)
export const markdownComponents: Components = createMarkdownComponents();
