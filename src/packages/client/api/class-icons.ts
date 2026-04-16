/**
 * Class Icon API Client
 * Handles upload, delete, and URL generation for custom class icons
 */

import { apiUrl, authUrl, getAuthToken } from '../utils/storage';

/**
 * Upload a custom icon image for an agent class
 */
export async function uploadClassIcon(
  classId: string,
  file: File
): Promise<{ iconPath: string }> {
  const token = getAuthToken();
  const response = await fetch(apiUrl(`/api/custom-class-icons/${classId}`), {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'image/png',
      'X-Filename': encodeURIComponent(file.name),
      ...(token ? { 'X-Auth-Token': token } : {}),
    },
    body: file,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(data.error || `Upload failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete the custom icon for an agent class
 */
export async function deleteClassIcon(classId: string): Promise<void> {
  const token = getAuthToken();
  const response = await fetch(apiUrl(`/api/custom-class-icons/${classId}`), {
    method: 'DELETE',
    headers: {
      ...(token ? { 'X-Auth-Token': token } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete class icon: ${response.statusText}`);
  }
}

/**
 * Get the full URL for a class icon, with auth token if needed.
 * iconPath is the filename stored on the class (e.g., 'charma.png').
 */
export function getClassIconUrl(iconPath: string): string {
  if (iconPath.startsWith('/api/')) {
    return authUrl(apiUrl(iconPath));
  }
  return authUrl(apiUrl(`/api/custom-class-icons/${iconPath}`));
}
