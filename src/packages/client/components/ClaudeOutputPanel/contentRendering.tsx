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
/**
 * Get VSCode icon SVG path for file type based on extension
 */
function getFileTypeIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    // Documents
    pdf: 'file_type_pdf.svg',
    doc: 'file_type_word.svg',
    docx: 'file_type_word.svg',
    xls: 'file_type_excel.svg',
    xlsx: 'file_type_excel.svg',
    ppt: 'file_type_powerpoint.svg',
    pptx: 'file_type_powerpoint.svg',
    txt: 'file_type_text.svg',
    md: 'file_type_markdown.svg',
    // Code
    js: 'file_type_javascript_official.svg',
    jsx: 'file_type_javascript_official.svg',
    ts: 'file_type_typescript_official.svg',
    tsx: 'file_type_typescript_official.svg',
    py: 'file_type_python.svg',
    java: 'file_type_java.svg',
    cpp: 'file_type_cpp.svg',
    c: 'file_type_cpp.svg',
    h: 'file_type_cpp.svg',
    hpp: 'file_type_cpp.svg',
    cs: 'file_type_csharp.svg',
    go: 'file_type_go.svg',
    rs: 'file_type_rust.svg',
    php: 'file_type_php.svg',
    rb: 'file_type_ruby.svg',
    swift: 'file_type_swift.svg',
    kt: 'file_type_kotlin.svg',
    scala: 'file_type_scala.svg',
    r: 'file_type_r.svg',
    // Web
    html: 'file_type_html.svg',
    htm: 'file_type_html.svg',
    css: 'file_type_css.svg',
    scss: 'file_type_scss.svg',
    sass: 'file_type_sass.svg',
    less: 'file_type_less.svg',
    // Config/Data
    json: 'file_type_json_official.svg',
    yaml: 'file_type_yaml_official.svg',
    yml: 'file_type_yaml_official.svg',
    xml: 'file_type_xml.svg',
    toml: 'file_type_toml.svg',
    ini: 'file_type_ini.svg',
    env: 'file_type_dotenv.svg',
    sh: 'file_type_shell.svg',
    bash: 'file_type_shell.svg',
    zsh: 'file_type_shell.svg',
    fish: 'file_type_shell.svg',
    // Images (fallback, usually handled separately)
    png: 'file_type_image.svg',
    jpg: 'file_type_image.svg',
    jpeg: 'file_type_image.svg',
    gif: 'file_type_image.svg',
    svg: 'file_type_image.svg',
    webp: 'file_type_image.svg',
    // Archives
    zip: 'file_type_zip.svg',
    tar: 'file_type_tar.svg',
    gz: 'file_type_gzip.svg',
    rar: 'file_type_rar.svg',
    '7z': 'file_type_zip.svg',
    // Audio/Video
    mp3: 'file_type_audio.svg',
    mp4: 'file_type_video.svg',
    wav: 'file_type_audio.svg',
    mov: 'file_type_video.svg',
    mkv: 'file_type_video.svg',
    flv: 'file_type_video.svg',
    avi: 'file_type_video.svg',
    // Default
    default: 'default_file.svg',
  };
  return iconMap[ext] || iconMap.default;
}

export function renderContentWithImages(
  content: string,
  onImageClick?: (url: string, name: string) => void,
  onFileClick?: (path: string) => void
): React.ReactNode {
  // Pattern to match [Image: /path/to/image.png] or [File: /path/to/file.pdf]
  const combinedPattern = /\[(Image|File):\s*([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  const markdownComponents = createMarkdownComponents({ onFileClick });

  while ((match = combinedPattern.exec(content)) !== null) {
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

    const isImage = match[1] === 'Image';
    const resourcePath = match[2].trim();
    const resourceName = resourcePath.split('/').pop() || (isImage ? 'image' : 'file');

    if (isImage) {
      // Add clickable image placeholder
      const imageUrl = getImageWebUrl(resourcePath);
      parts.push(
        <span
          key={`img-${match.index}`}
          className="image-reference clickable"
          onClick={() => onImageClick?.(imageUrl, resourceName)}
          title="Click to view image"
        >
          <img src="/assets/vscode-icons/file_type_image.svg" alt="image" style={{ width: '12px', height: '12px', display: 'inline', marginRight: '4px' }} />
          {resourceName}
        </span>
      );
    } else {
      // Add clickable file reference with type icon
      const iconPath = getFileTypeIcon(resourceName);
      parts.push(
        <span
          key={`file-${match.index}`}
          className="file-reference clickable"
          onClick={() => onFileClick?.(resourcePath)}
          title={`Click to view file: ${resourcePath}`}
        >
          <img src={`/assets/vscode-icons/${iconPath}`} alt={resourceName} style={{ width: '12px', height: '12px', display: 'inline', marginRight: '4px' }} />
          {resourceName}
        </span>
      );
    }

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

  // If no images/files found, just return markdown wrapped in markdown-content
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
 * Still supports [Image: path] and [File: path] references.
 */
export function renderUserPromptContent(
  content: string,
  onImageClick?: (url: string, name: string) => void,
  onFileClick?: (path: string) => void
): React.ReactNode {
  // Pattern to match [Image: /path/to/image.png] or [File: /path/to/file.pdf]
  const combinedPattern = /\[(Image|File):\s*([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = combinedPattern.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      parts.push(
        <span key={`text-${lastIndex}`} className="user-prompt-text">
          {textBefore}
        </span>
      );
    }

    // Add clickable image or file placeholder
    const isImage = match[1] === 'Image';
    const resourcePath = match[2].trim();
    const resourceName = resourcePath.split('/').pop() || (isImage ? 'image' : 'file');

    if (isImage) {
      const imageUrl = getImageWebUrl(resourcePath);
      parts.push(
        <span
          key={`img-${match.index}`}
          className="image-reference clickable"
          onClick={() => onImageClick?.(imageUrl, resourceName)}
          title="Click to view image"
        >
          <img src="/assets/vscode-icons/file_type_image.svg" alt="image" style={{ width: '12px', height: '12px', display: 'inline', marginRight: '4px' }} />
          {resourceName}
        </span>
      );
    } else {
      const iconPath = getFileTypeIcon(resourceName);
      parts.push(
        <span
          key={`file-${match.index}`}
          className="file-reference clickable"
          onClick={() => onFileClick?.(resourcePath)}
          title={`Click to view file: ${resourcePath}`}
        >
          <img src={`/assets/vscode-icons/${iconPath}`} alt={resourceName} style={{ width: '12px', height: '12px', display: 'inline', marginRight: '4px' }} />
          {resourceName}
        </span>
      );
    }

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
