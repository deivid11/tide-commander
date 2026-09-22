/**
 * Image-viewer gallery shared by every view that shows a conversation (Guake
 * panel, Flat view, Commander view): clicking an image opens it WITH the rest
 * of the conversation's images, so the viewer can offer prev/next and a strip.
 *
 * Each view hosts its own modal, so this is the one place the gallery is built
 * and navigated — a view that only stored `{url, name}` silently lost the
 * browsing UI (that's how the Flat view shipped without it).
 */

import { useCallback, useState } from 'react';
import {
  collectConversationImages,
  findConversationImageIndex,
  type ConversationImage,
} from '../../utils/conversationImages';
import { getImageWebUrl, getLocalFileImageUrl } from './contentRendering';

export interface ImageGalleryPick {
  items: ConversationImage[];
  index: number;
}

type HistoryInput = Parameters<typeof collectConversationImages>[0];
type OutputsInput = Parameters<typeof collectConversationImages>[1];

/**
 * The conversation's images with the clicked one selected. An image from a
 * source the scan doesn't cover still opens, as the first item.
 */
export function buildImageGallery(
  history: HistoryInput,
  outputs: OutputsInput,
  url: string,
  name: string,
  /** Agent cwd — relative image paths (pi/Codex) resolve against it, like the rows do. */
  cwd?: string,
): ImageGalleryPick {
  const items = collectConversationImages(history, outputs, {
    localFile: (path) => getLocalFileImageUrl(path, cwd),
    attachment: getImageWebUrl,
  });
  const index = findConversationImageIndex(items, url, name);
  if (index !== -1) return { items, index };
  return { items: [{ url, name, ref: url }, ...items], index: 0 };
}

export interface ImageGalleryModalState extends ImageGalleryPick {
  url: string;
  name: string;
}

/** Modal state for a view's image viewer: open (optionally with a gallery), browse, close. */
export function useImageGalleryModal() {
  const [imageModal, setImageModal] = useState<ImageGalleryModalState | null>(null);

  const openImage = useCallback((url: string, name: string, gallery?: ImageGalleryPick) => {
    setImageModal({ url, name, items: gallery?.items ?? [{ url, name, ref: url }], index: gallery?.index ?? 0 });
  }, []);

  const navigateImage = useCallback((index: number) => {
    setImageModal((current) => {
      const item = current?.items[index];
      return current && item ? { ...current, url: item.url, name: item.name, index } : current;
    });
  }, []);

  const closeImage = useCallback(() => setImageModal(null), []);

  return { imageModal, openImage, navigateImage, closeImage };
}
