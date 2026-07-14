/**
 * Content rendering utilities for images, markdown, and highlighting
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createMarkdownComponents } from './MarkdownComponents';
import { getApiBaseUrl, apiUrl, getAuthToken } from '../../utils/storage';
import { linkifyFilePathsForMarkdown } from '../../utils/outputRendering';
import { extractFileMentionBlocks } from '../../utils/fileMentions';
import i18n from '../../i18n';

/**
 * Helper to highlight search terms in text.
 *
 * Multi-word queries are tokenised so each word is highlighted independently
 * (matches the token-AND search behaviour). Single-word queries behave exactly
 * as before. The signature is unchanged so shared callers (OutputLine +
 * HistoryLine) need no updates.
 */
export function highlightText(text: string, query?: string): React.ReactNode {
  if (!query) return text;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const tokenSet = new Set(tokens.map((t) => t.toLowerCase()));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  return parts.map((part, i) =>
    part && tokenSet.has(part.toLowerCase()) ? (
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
  } else if (imagePath.includes('browser-errors/attachments/')) {
    // Browser-extension attachments / element shots are served at /attachments.
    const imageName = imagePath.split('/').pop() || 'image';
    return `${baseUrl}/attachments/${imageName}`;
  } else {
    // Default: assume it's a relative path
    return imagePath;
  }
}

/** Image file extensions we can render an inline thumbnail preview for. */
const THUMBNAIL_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

/** True when the path points to an image we can preview as a thumbnail. */
export function isThumbnailableImagePath(filePath: string): boolean {
  return THUMBNAIL_IMAGE_EXT_RE.test(filePath);
}

/**
 * True when an `[Image: X]` reference actually resolves to a renderable image
 * (a URL, data/blob URI, or a path ending in an image extension). The agent
 * sometimes emits `[Image: <text>]` where the text is a *caption/instruction*
 * rather than a path — e.g. "original 2474x1323, displayed at 2000x1070.
 * Multiply coordinates by 1.24 to map to original image." Those must be shown
 * as text, not fed into an <img src> (which produces a broken image).
 */
export function isRenderableImageRef(ref: string): boolean {
  return /^(https?:|data:|blob:)/i.test(ref) || isThumbnailableImagePath(ref);
}

/**
 * Build a web URL that streams a local image file's bytes via /api/files/binary,
 * so an arbitrary on-disk path (e.g. one the agent read) can be shown in the
 * browser. Unlike getImageWebUrl (uploads/attachments only), this works for any
 * absolute path the server can read.
 */
export function getLocalFileImageUrl(filePath: string): string {
  const token = getAuthToken();
  return apiUrl(`/api/files/binary?path=${encodeURIComponent(filePath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`);
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

const REMARK_PLUGINS = [remarkGfm];

/**
 * Memoized markdown block. Markdown parsing is the most expensive part of
 * rendering an output row; wrapping it in React.memo lets a re-render of the
 * row (selection, streaming flags, etc.) skip the re-parse whenever the text
 * itself is unchanged. linkifyFilePathsForMarkdown runs inside the memo for
 * the same reason.
 */
const MarkdownBlock = React.memo(function MarkdownBlock({
  text,
  onFileClick,
}: {
  text: string;
  onFileClick?: (path: string) => void;
}) {
  const components = React.useMemo(() => createMarkdownComponents({ onFileClick }), [onFileClick]);
  const linkified = React.useMemo(() => linkifyFilePathsForMarkdown(text), [text]);
  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {linkified}
      </ReactMarkdown>
    </div>
  );
});

export function renderContentWithImages(
  content: string,
  onImageClick?: (url: string, name: string) => void,
  onFileClick?: (path: string) => void
): React.ReactNode {
  // Generated images are emitted as a standalone image reference. Give them a
  // proper inline preview instead of the compact attachment chip used for
  // references embedded in prose.
  const generatedImageMatch = /^\s*\[Image:\s*([^\]]*\/codex-generated-[a-f0-9]+\.png)\]\s*$/i.exec(content);
  if (generatedImageMatch) {
    const imagePath = generatedImageMatch[1].trim();
    const imageName = imagePath.split('/').pop() || 'generated-image.png';
    const imageUrl = getLocalFileImageUrl(imagePath);
    return (
      <span className="generated-image-preview">
        <img
          src={imageUrl}
          alt={imageName}
          loading="lazy"
          title={i18n.t('terminal:content.clickToViewImage')}
          onClick={() => onImageClick?.(imageUrl, imageName)}
        />
      </span>
    );
  }

  // Pattern to match [Image: /path/to/image.png] or [File: /path/to/file.pdf]
  const combinedPattern = /\[(Image|File):\s*([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = combinedPattern.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(
        <MarkdownBlock key={`text-${lastIndex}`} text={content.slice(lastIndex, match.index)} onFileClick={onFileClick} />
      );
    }

    const isImage = match[1] === 'Image';
    const resourcePath = match[2].trim();
    const resourceName = resourcePath.split('/').pop() || (isImage ? 'image' : 'file');

    if (isImage && isRenderableImageRef(resourcePath)) {
      // Add clickable image with thumbnail preview
      const imageUrl = getImageWebUrl(resourcePath);
      parts.push(
        <span
          key={`img-${match.index}`}
          className="image-reference clickable"
          onClick={() => onImageClick?.(imageUrl, resourceName)}
          title={i18n.t('terminal:content.clickToViewImage')}
        >
          <img src={imageUrl} alt={resourceName} className="image-reference-thumb" />
          {resourceName}
        </span>
      );
    } else if (isImage) {
      // `[Image: <text>]` where the text is a caption/instruction, not a path.
      // Render the instruction itself instead of a broken thumbnail.
      parts.push(
        <span key={`imgnote-${match.index}`} className="image-annotation" title={resourcePath}>
          <img src={`${import.meta.env.BASE_URL}assets/vscode-icons/file_type_image.svg`} alt="" className="image-annotation-icon" />
          {resourcePath}
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
          title={i18n.t('terminal:content.clickToViewFile', { path: resourcePath })}
        >
          <img src={`${import.meta.env.BASE_URL}assets/vscode-icons/${iconPath}`} alt={resourceName} style={{ width: '12px', height: '12px', display: 'inline', marginRight: '4px' }} />
          {resourceName}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    parts.push(
      <MarkdownBlock key={`text-${lastIndex}`} text={content.slice(lastIndex)} onFileClick={onFileClick} />
    );
  }

  // If no images/files found, just return markdown wrapped in markdown-content
  if (parts.length === 0) {
    return <MarkdownBlock text={content} onFileClick={onFileClick} />;
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
  const { displayContent } = extractFileMentionBlocks(content);

  // Pattern to match [Image: /path/to/image.png] or [File: /path/to/file.pdf]
  const combinedPattern = /\[(Image|File):\s*([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = combinedPattern.exec(displayContent)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = displayContent.slice(lastIndex, match.index);
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

    if (isImage && isRenderableImageRef(resourcePath)) {
      const imageUrl = getImageWebUrl(resourcePath);
      parts.push(
        <span
          key={`img-${match.index}`}
          className="image-reference clickable"
          onClick={() => onImageClick?.(imageUrl, resourceName)}
          title={i18n.t('terminal:content.clickToViewImage')}
        >
          <img src={imageUrl} alt={resourceName} className="image-reference-thumb" />
          {resourceName}
        </span>
      );
    } else if (isImage) {
      // `[Image: <text>]` where the text is a caption/instruction, not a path.
      // Render the instruction itself instead of a broken thumbnail.
      parts.push(
        <span key={`imgnote-${match.index}`} className="image-annotation" title={resourcePath}>
          <img src={`${import.meta.env.BASE_URL}assets/vscode-icons/file_type_image.svg`} alt="" className="image-annotation-icon" />
          {resourcePath}
        </span>
      );
    } else {
      const iconPath = getFileTypeIcon(resourceName);
      parts.push(
        <span
          key={`file-${match.index}`}
          className="file-reference clickable"
          onClick={() => onFileClick?.(resourcePath)}
          title={i18n.t('terminal:content.clickToViewFile', { path: resourcePath })}
        >
          <img src={`${import.meta.env.BASE_URL}assets/vscode-icons/${iconPath}`} alt={resourceName} style={{ width: '12px', height: '12px', display: 'inline', marginRight: '4px' }} />
          {resourceName}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < displayContent.length) {
    const textAfter = displayContent.slice(lastIndex);
    parts.push(
      <span key={`text-${lastIndex}`} className="user-prompt-text">
        {textAfter}
      </span>
    );
  }

  // If no images/text found, just return the text
  if (parts.length === 0) {
    return <span className="user-prompt-text">{displayContent}</span>;
  }

  return <>{parts}</>;
}
