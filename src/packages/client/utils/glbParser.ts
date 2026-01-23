/**
 * GLB Animation Parser Utility
 *
 * Parses GLB files to extract animation clip names for the class editor UI.
 * Uses Three.js GLTFLoader to parse the binary file format.
 */

import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Parse a GLB file and extract animation names
 *
 * @param file - The File object from file input
 * @returns Promise resolving to array of animation names
 */
export async function parseGlbAnimations(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      const arrayBuffer = event.target?.result as ArrayBuffer;
      if (!arrayBuffer) {
        reject(new Error('Failed to read file'));
        return;
      }

      try {
        const animations = await parseGlbAnimationsFromBuffer(arrayBuffer);
        resolve(animations);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse GLB data from an ArrayBuffer and extract animation names
 *
 * @param buffer - ArrayBuffer containing GLB file data
 * @returns Promise resolving to array of animation names
 */
export async function parseGlbAnimationsFromBuffer(buffer: ArrayBuffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // Validate GLB magic number
    const view = new DataView(buffer);
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    if (magic !== 'glTF') {
      reject(new Error('Invalid GLB file: missing glTF magic number'));
      return;
    }

    const loader = new GLTFLoader();

    // Create a blob URL to load from
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    loader.load(
      url,
      (gltf: GLTF) => {
        URL.revokeObjectURL(url);

        // Extract animation names
        const animationNames = gltf.animations.map((clip) => clip.name);

        // Sort alphabetically for consistent UI display
        animationNames.sort((a, b) => a.localeCompare(b));

        resolve(animationNames);
      },
      undefined,
      (error: unknown) => {
        URL.revokeObjectURL(url);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        reject(new Error(`Failed to parse GLB: ${errorMessage}`));
      }
    );
  });
}

/**
 * Parse GLB data from a base64 string and extract animation names
 *
 * @param base64Data - Base64 encoded GLB file data
 * @returns Promise resolving to array of animation names
 */
export async function parseGlbAnimationsFromBase64(base64Data: string): Promise<string[]> {
  // Decode base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return parseGlbAnimationsFromBuffer(bytes.buffer);
}

/**
 * Validate that a file is a valid GLB file
 *
 * @param file - The File object to validate
 * @returns Promise resolving to true if valid, false otherwise
 */
export async function isValidGlbFile(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    // Check file extension first
    if (!file.name.toLowerCase().endsWith('.glb')) {
      resolve(false);
      return;
    }

    // Check magic number
    const reader = new FileReader();

    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer || buffer.byteLength < 4) {
        resolve(false);
        return;
      }

      const view = new DataView(buffer);
      const magic = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
      );

      resolve(magic === 'glTF');
    };

    reader.onerror = () => {
      resolve(false);
    };

    reader.readAsArrayBuffer(file.slice(0, 4));
  });
}

/**
 * Get file size in human-readable format
 *
 * @param bytes - File size in bytes
 * @returns Human-readable string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
