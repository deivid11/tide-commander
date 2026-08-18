/**
 * Archive (compressed container) extension tables — shared by the server's
 * listing service (`archive-listing.ts`) and the client viewers, so "what
 * counts as an archive" is decided in exactly one place.
 */

export type ArchiveCompression = 'gzip' | 'bzip2' | 'xz' | 'zstd' | 'lz4' | 'lzip' | 'lzma' | 'compress';

/** Zip containers (central-directory format), including the many renamed zips. */
export const ZIP_ARCHIVE_EXTENSIONS: readonly string[] = [
  '.zip', '.zipx', '.jar', '.war', '.ear', '.aar', '.apk', '.aab', '.ipa', '.xpi',
  '.whl', '.egg', '.nupkg', '.vsix', '.crx', '.epub', '.kmz', '.xap', '.cbz', '.oxt',
];

/** Containers listed through external tools (7z / unrar / bsdtar). */
export const OTHER_ARCHIVE_EXTENSIONS: readonly string[] = [
  '.7z', '.rar', '.cbr', '.cb7', '.cab', '.iso', '.deb', '.rpm', '.dmg', '.msi',
  '.cpio', '.ar', '.arj', '.lzh', '.lha', '.wim', '.xar', '.pkg', '.udf', '.vhd', '.squashfs',
];

/** Single-stream compression suffixes (a `.tar` before them makes a tarball). */
export const COMPRESSION_BY_EXTENSION: Readonly<Record<string, ArchiveCompression>> = {
  '.gz': 'gzip', '.bz2': 'bzip2', '.xz': 'xz', '.zst': 'zstd', '.lz4': 'lz4',
  '.lz': 'lzip', '.lzma': 'lzma', '.z': 'compress',
};

/** Tar shorthands (`.tgz` = `.tar.gz`, …); null compression = plain tar. */
export const TAR_SHORTHAND_EXTENSIONS: Readonly<Record<string, ArchiveCompression | null>> = {
  '.tar': null, '.tgz': 'gzip', '.taz': 'gzip', '.tbz': 'bzip2', '.tbz2': 'bzip2', '.tb2': 'bzip2',
  '.txz': 'xz', '.tzst': 'zstd', '.tlz': 'lzma', '.tz': 'compress',
};

/** Every extension the file viewers route to the archive viewer. */
export const ARCHIVE_EXTENSIONS: readonly string[] = [
  ...ZIP_ARCHIVE_EXTENSIONS,
  ...OTHER_ARCHIVE_EXTENSIONS,
  ...Object.keys(TAR_SHORTHAND_EXTENSIONS),
  ...Object.keys(COMPRESSION_BY_EXTENSION),
];

/** True when the filename's last extension is an archive we can list. */
export function isArchiveFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return false;
  return ARCHIVE_EXTENSIONS.includes(lower.slice(dot));
}
