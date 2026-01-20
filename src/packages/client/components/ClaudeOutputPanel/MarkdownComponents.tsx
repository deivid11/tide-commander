/**
 * Custom markdown components with inline styles for guaranteed rendering
 */

import React from 'react';
import { Components } from 'react-markdown';

export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 style={{ fontSize: '1.4em', color: '#ff79c6', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: '1.25em', color: '#bd93f9', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: '1.15em', color: '#8be9fd', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 style={{ fontSize: '1.1em', color: '#50fa7b', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 style={{ fontSize: '1.05em', color: '#f1fa8c', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 style={{ fontSize: '1em', color: '#ffb86c', fontWeight: 600, margin: '0.6em 0 0.3em' }}>
      {children}
    </h6>
  ),
  p: ({ children }) => <p style={{ margin: '0.4em 0' }}>{children}</p>,
  strong: ({ children }) => <strong style={{ color: '#ffb86c', fontWeight: 600 }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: '#f1fa8c', fontStyle: 'italic' }}>{children}</em>,
  del: ({ children }) => <del style={{ color: '#ff5555', textDecoration: 'line-through' }}>{children}</del>,
  code: ({ children, className }) => {
    // Check if it's a code block (has language class) or inline code
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <code style={{ background: 'none', padding: 0, color: '#f8f8f2', fontSize: '12px', lineHeight: 1.5 }}>
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          background: 'rgba(68, 71, 90, 0.6)',
          color: '#50fa7b',
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
        background: 'rgba(40, 42, 54, 0.9)',
        border: '1px solid rgba(98, 114, 164, 0.4)',
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
        borderLeft: '3px solid #bd93f9',
        margin: '0.5em 0',
        padding: '0.5em 1em',
        background: 'rgba(189, 147, 249, 0.1)',
        borderRadius: '0 4px 4px 0',
      }}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} style={{ color: '#8be9fd', textDecoration: 'underline' }}>
      {children}
    </a>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid rgba(98, 114, 164, 0.5)', margin: '1em 0' }} />,
  table: ({ children }) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', margin: '0.6em 0', fontSize: '12px' }}>
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: '1px solid rgba(98, 114, 164, 0.4)',
        padding: '6px 10px',
        textAlign: 'left',
        background: 'rgba(68, 71, 90, 0.8)',
        fontWeight: 600,
        color: '#ff79c6',
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        border: '1px solid rgba(98, 114, 164, 0.4)',
        padding: '6px 10px',
        textAlign: 'left',
        background: 'rgba(40, 42, 54, 0.5)',
      }}
    >
      {children}
    </td>
  ),
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <input type="checkbox" checked={checked} readOnly style={{ marginRight: '0.5em', accentColor: '#50fa7b' }} />
    ) : null,
};
