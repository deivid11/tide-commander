/**
 * Area Logo API Client
 * Handles upload, delete, and URL generation for zone logos
 */

import { apiUrl, authUrl, getAuthToken } from '../utils/storage';

/**
 * Upload a logo image for an area
 */
export async function uploadAreaLogo(
  areaId: string,
  file: File
): Promise<{ filename: string; url: string; size: number }> {
  const token = getAuthToken();
  const response = await fetch(apiUrl(`/api/areas/${areaId}/logo`), {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'image/png',
      'X-Filename': encodeURIComponent(file.name),
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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
 * Delete the logo for an area
 */
export async function deleteAreaLogoApi(areaId: string): Promise<void> {
  const token = getAuthToken();
  const response = await fetch(apiUrl(`/api/areas/${areaId}/logo`), {
    method: 'DELETE',
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete logo: ${response.statusText}`);
  }
}

/**
 * Get the full URL for an area logo, with auth token if needed
 */
export function getAreaLogoUrl(filename: string): string {
  return authUrl(apiUrl(`/api/areas/logos/${filename}`));
}
