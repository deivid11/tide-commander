import { useEffect, useState } from 'react';
import { getStorage, setStorage, STORAGE_KEYS } from '../../utils/storage';

export type ThreeFileKind = 'stl' | 'fcstd';

export interface RecentThreeFile {
  path: string;
  filename: string;
  kind: ThreeFileKind;
  viewedAt: number;
}

const RECENT_THREE_FILES_EVENT = 'tide-three-viewer-recents-changed';
const MAX_RECENT_THREE_FILES = 8;

function readRecentFiles(): RecentThreeFile[] {
  return getStorage<RecentThreeFile[]>(STORAGE_KEYS.THREE_VIEWER_RECENT_FILES, [])
    .filter((entry) => entry && typeof entry.path === 'string' && (entry.kind === 'stl' || entry.kind === 'fcstd'))
    .slice(0, MAX_RECENT_THREE_FILES);
}

function rememberRecentFile(file: RecentThreeFile): RecentThreeFile[] {
  const next = [file, ...readRecentFiles().filter((entry) => entry.path !== file.path)]
    .slice(0, MAX_RECENT_THREE_FILES);
  setStorage(STORAGE_KEYS.THREE_VIEWER_RECENT_FILES, next);
  window.dispatchEvent(new CustomEvent(RECENT_THREE_FILES_EVENT));
  return next;
}

export function viewerFilePathFromUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).searchParams.get('path') || '';
  } catch {
    return '';
  }
}

export function useRecentThreeFiles(path: string, filename: string, kind: ThreeFileKind): RecentThreeFile[] {
  const [recentFiles, setRecentFiles] = useState(readRecentFiles);

  useEffect(() => {
    if (path) setRecentFiles(rememberRecentFile({ path, filename, kind, viewedAt: Date.now() }));
  }, [path, filename, kind]);

  useEffect(() => {
    const refresh = () => setRecentFiles(readRecentFiles());
    window.addEventListener(RECENT_THREE_FILES_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(RECENT_THREE_FILES_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return recentFiles;
}
