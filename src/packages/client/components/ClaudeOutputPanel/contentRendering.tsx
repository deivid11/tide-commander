/**
 * Content rendering utilities for images, markdown, and highlighting
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createMarkdownComponents } from './MarkdownComponents';
import { getApiBaseUrl } from '../../utils/storage';
import { linkifyFilePathsForMarkdown } from '../../utils/outputRendering';

/**
 * Helper to highlight search terms in text
 */
export function highlightText(text: string, query?: string): React.ReactNode {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="search-highlight">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/**
 * Helper to convert image path to web URL for display in browser
 * Handles: http URLs, /uploads/ paths, and absolute /tmp/ paths
 */
export function getImageWebUrl(imagePath: string): string {
  const baseUrl = getApiBaseUrl();
  if (imagePath.startsWith('http')) {
    return imagePath;
  } else if (imagePath.startsWith('/uploads/')) {
    return `${baseUrl}${imagePath}`;
  } else if (imagePath.includes('tide-commander-uploads')) {
    // Absolute path like /tmp/tide-commander-uploads/image.png - extract filename
    const imageName = imagePath.split('/').pop() || 'image';
    return `${baseUrl}/uploads/${imageName}`;
  } else {
    // Default: assume it's a relative path
    return imagePath;
  }
}

/**
 * Helper to render content with clickable image references
 */
export function renderContentWithImages(
  content: string,
  onImageClick?: (url: string, name: string) => void,
  onFileClick?: (path: string) => void
): React.ReactNode {
  // Pattern to match [Image: /path/to/image.png]
  const imagePattern = /\[Image:\s*([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  const markdownComponents = createMarkdownComponents({ onFileClick });

  while ((match = imagePattern.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = linkifyFilePathsForMarkdown(content.slice(lastIndex, match.index));
      parts.push(
        <div key={`text-${lastIndex}`} className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {textBefore}
          </ReactMarkdown>
        </div>
      );
    }

    // Add clickable image placeholder
    const imagePath = match[1].trim();
    const imageName = imagePath.split('/').pop() || 'image';
    const imageUrl = getImageWebUrl(imagePath);

    parts.push(
      <span
        key={`img-${match.index}`}
        className="image-reference clickable"
        onClick={() => onImageClick?.(imageUrl, imageName)}
        title="Click to view image"
      >
        🖼️ {imageName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    const textAfter = linkifyFilePathsForMarkdown(content.slice(lastIndex));
    parts.push(
      <div key={`text-${lastIndex}`} className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {textAfter}
        </ReactMarkdown>
      </div>
    );
  }

  // If no images found, just return markdown wrapped in markdown-content
  if (parts.length === 0) {
    return (
      <div className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {linkifyFilePathsForMarkdown(content)}
        </ReactMarkdown>
      </div>
    );
  }

  return <>{parts}</>;
}

/**
 * Render user prompt content preserving whitespace and newlines.
 * Unlike renderContentWithImages (which uses ReactMarkdown and collapses whitespace),
 * this renders text with pre-wrap so pasted content keeps its formatting.
 * Still supports [Image: path] references.
 */
export function renderUserPromptContent(
  content: string,
  onImageClick?: (url: string, name: string) => void
): React.ReactNode {
  // Pattern to match [Image: /path/to/image.png]
  const imagePattern = /\[Image:\s*([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = imagePattern.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      parts.push(
        <span key={`text-${lastIndex}`} className="user-prompt-text">
          {textBefore}
        </span>
      );
    }

    // Add clickable image placeholder
    const imagePath = match[1].trim();
    const imageName = imagePath.split('/').pop() || 'image';
    const imageUrl = getImageWebUrl(imagePath);

    parts.push(
      <span
        key={`img-${match.index}`}
        className="image-reference clickable"
        onClick={() => onImageClick?.(imageUrl, imageName)}
        title="Click to view image"
      >
        🖼️ {imageName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    const textAfter = content.slice(lastIndex);
    parts.push(
      <span key={`text-${lastIndex}`} className="user-prompt-text">
        {textAfter}
      </span>
    );
  }

  // If no images found, just return the text
  if (parts.length === 0) {
    return <span className="user-prompt-text">{content}</span>;
  }

  return <>{parts}</>;
}
