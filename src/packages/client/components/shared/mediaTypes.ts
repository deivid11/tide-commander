/**
 * Which extensions get a media player instead of a download stub.
 *
 * Shared by BOTH viewers — the modal (FileViewerModal) and the File Explorer's
 * tabs (FileExplorerPanel/FileViewer) — so a format can never be playable in one
 * and a "binary file" in the other.
 *
 * The lists cover what a browser <audio>/<video> element can realistically
 * decode. `.mid`/`.midi` are deliberately absent (no built-in synth), while the
 * long-tail containers below are included on purpose: the players fall back to a
 * clear "this format can't play here + download" panel, which still beats the
 * generic binary placeholder.
 */

export const AUDIO_EXTENSIONS = [
  '.wav', '.wave', '.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.weba', '.aif', '.aiff',
] as const;

export const VIDEO_EXTENSIONS = [
  '.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv', '.avi',
] as const;

function extensionOf(pathOrName: string): string {
  const clean = pathOrName.toLowerCase().split(/[?#]/, 1)[0];
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const name = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/** Match on the declared extension when there is one, else on the path itself. */
function matches(list: readonly string[], extension: string | undefined, pathOrName: string): boolean {
  const normalized = extension?.toLowerCase();
  if (normalized) return list.includes(normalized);
  return list.includes(extensionOf(pathOrName));
}

export function isAudioFile(extension: string | undefined, pathOrName = ''): boolean {
  return matches(AUDIO_EXTENSIONS, extension, pathOrName);
}

export function isVideoFile(extension: string | undefined, pathOrName = ''): boolean {
  return matches(VIDEO_EXTENSIONS, extension, pathOrName);
}
