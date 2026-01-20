/**
 * Generate a random ID string (8 characters, alphanumeric)
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 * Handles null/undefined inputs.
 */
export function truncate(str: string | undefined | null, maxLen: number): string | null {
  if (!str) return null;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Truncate a string to a maximum length, returning empty string for null/undefined.
 * Use this variant when a non-null return is required.
 */
export function truncateOrEmpty(str: string | undefined | null, maxLen: number): string {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Generate a URL-safe slug from a name.
 * Converts to lowercase, replaces non-alphanumeric with dashes, trims dashes.
 */
export function generateSlug(name: string, maxLength: number = 64): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, maxLength);
}
