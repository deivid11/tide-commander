import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const GENERATED_IMAGES_DIR = path.join(os.tmpdir(), 'tide-commander-uploads');
const MAX_GENERATED_IMAGE_BYTES = 50 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Materialize Codex's image_generation_end base64 result in the directory
 * already exposed by Tide Commander at /uploads.
 */
export function materializeCodexGeneratedImage(result: unknown): string | null {
  if (typeof result !== 'string') return null;

  const encoded = result.startsWith('data:image/png;base64,')
    ? result.slice('data:image/png;base64,'.length)
    : result;
  if (!encoded || encoded.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES * 4 / 3) + 4) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;

  const image = Buffer.from(encoded, 'base64');
  if (
    image.length === 0 ||
    image.length > MAX_GENERATED_IMAGE_BYTES ||
    image.length < PNG_SIGNATURE.length ||
    !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return null;
  }

  const digest = createHash('sha256').update(image).digest('hex').slice(0, 16);
  const imagePath = path.join(GENERATED_IMAGES_DIR, `codex-generated-${digest}.png`);
  fs.mkdirSync(GENERATED_IMAGES_DIR, { recursive: true });
  if (!fs.existsSync(imagePath)) fs.writeFileSync(imagePath, image, { mode: 0o600 });
  return imagePath;
}
