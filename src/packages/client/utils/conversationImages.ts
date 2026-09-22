/**
 * Every image a conversation shows, in display order — the gallery behind the
 * Guake image viewer's prev/next and thumbnail strip.
 *
 * Collected from DATA, not the DOM: the output list is virtualized, so only the
 * rows on screen are mounted and a DOM scan would miss most of a run of
 * screenshots. Each source mirrors the row renderer that shows the thumbnail
 * (Read on an image, Codex `view_image`, `[Image: …]` attachments) and builds
 * the URL with the same helper, so the clicked image is found by URL.
 *
 * Pure on purpose: the URL builders are injected, keeping this free of the
 * store/hooks barrels that break the node-environment unit tests.
 */

import { getCodexExecPresentation, getImageViewTarget, isCodexExecWrapper, isImageViewTool } from './outputRendering';

export interface ConversationImage {
  url: string;
  name: string;
  /** The path/reference the URL was built from — used to match a clicked image. */
  ref: string;
}

export interface ConversationImageUrlBuilders {
  /** `/api/files/binary` URL for an on-disk path (Read rows, `view_image`). */
  localFile: (path: string) => string;
  /** URL for an `[Image: X]` attachment reference (uploads, screenshots). */
  attachment: (ref: string) => string;
}

interface HistoryLike {
  type: string;
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

interface OutputLike {
  text: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
const REMOTE_REF_RE = /^(https?:|data:|blob:)/i;
const IMAGE_MARKER_RE = /\[Image:\s*([^\]]+)\]/g;

const basename = (ref: string): string => ref.split(/[\\/]/).pop() || ref;
const isRenderableRef = (ref: string): boolean => REMOTE_REF_RE.test(ref) || IMAGE_EXT_RE.test(ref);

export function collectConversationImages(
  history: readonly HistoryLike[],
  outputs: readonly OutputLike[],
  builders: ConversationImageUrlBuilders,
): ConversationImage[] {
  const images: ConversationImage[] = [];
  const seen = new Set<string>();
  const push = (url: string, ref: string): void => {
    // A tool row and its "Tool input:" echo describe the same image.
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({ url, name: basename(ref), ref });
  };

  const fromTool = (toolName: string, input: Record<string, unknown> | undefined): void => {
    if (!input) return;
    if (toolName === 'Read') {
      const path = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : '';
      if (path && IMAGE_EXT_RE.test(path)) push(builders.localFile(path), path);
      return;
    }
    if (isImageViewTool(toolName)) {
      const target = getImageViewTarget(input);
      if (target && isRenderableRef(target.path)) {
        push(REMOTE_REF_RE.test(target.path) ? target.path : builders.localFile(target.path), target.path);
      }
      return;
    }
    if (toolName === 'exec' || isCodexExecWrapper(input)) {
      const presentation = getCodexExecPresentation(input);
      if (presentation.detail !== 'image') return;
      for (const path of presentation.filePaths ?? []) {
        if (IMAGE_EXT_RE.test(path)) push(builders.localFile(path), path);
      }
    }
  };

  const fromText = (text: string): void => {
    if (!text || !text.includes('[Image:')) return;
    for (const match of text.matchAll(IMAGE_MARKER_RE)) {
      const ref = match[1].trim();
      if (isRenderableRef(ref)) push(builders.attachment(ref), ref);
    }
  };

  for (const message of history) {
    if (message.type === 'tool_use') fromTool(message.toolName ?? '', message.toolInput);
    else if (message.type === 'user' || message.type === 'assistant') fromText(message.content);
  }
  for (const output of outputs) {
    if (output.toolName && output.text.startsWith('Using tool:')) fromTool(output.toolName, output.toolInput);
    else if (!output.toolName) fromText(output.text);
  }
  return images;
}

/** The on-disk path a `/api/files/binary?path=…` URL streams, when it is one. */
function pathFromBinaryUrl(url: string): string | null {
  const query = url.split('?')[1];
  if (!query) return null;
  try {
    return new URLSearchParams(query).get('path');
  } catch {
    return null;
  }
}

/**
 * Index of the clicked image in the gallery: exact URL first (the common case),
 * then the underlying file path (URLs may differ by auth token or builder),
 * then the file name. -1 when the image isn't part of the conversation data.
 */
export function findConversationImageIndex(images: readonly ConversationImage[], url: string, name: string): number {
  const exact = images.findIndex((image) => image.url === url);
  if (exact !== -1) return exact;

  const clickedPath = pathFromBinaryUrl(url);
  if (clickedPath) {
    const byPath = images.findIndex((image) => image.ref === clickedPath || pathFromBinaryUrl(image.url) === clickedPath);
    if (byPath !== -1) return byPath;
  }
  return images.findIndex((image) => image.name === name);
}
