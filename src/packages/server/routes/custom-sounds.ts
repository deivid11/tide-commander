/**
 * Custom Notification Sound Routes
 * Upload, serve and remove user-supplied audio for each notification event.
 * Stored server-side (not in the browser) so the same sounds apply on every
 * device that connects to this commander.
 *
 * Storage: ~/.local/share/tide-commander/custom-sounds/
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CustomSounds');
const router = Router();

/** Events that can carry a custom sound — mirrors the client's SoundKind. */
const SOUND_EVENTS = ['question', 'notification', 'completion'] as const;
type SoundEvent = (typeof SOUND_EVENTS)[number];

const ALLOWED_AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/aac': '.aac',
  'audio/mp4': '.m4a',
};

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
};

/** Notification cues are short; 5MB is generous and keeps playback instant. */
const MAX_SOUND_SIZE = 5 * 1024 * 1024;

const SOUNDS_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander',
  'custom-sounds'
);

function ensureSoundsDir(): void {
  if (!fs.existsSync(SOUNDS_DIR)) {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
  }
}

function isSoundEvent(value: string): value is SoundEvent {
  return (SOUND_EVENTS as readonly string[]).includes(value);
}

/** The stored file for an event, if any (extension varies by upload). */
function findSoundFile(event: SoundEvent): string | null {
  ensureSoundsDir();
  for (const ext of Object.keys(MIME_BY_EXT)) {
    const filename = `${event}${ext}`;
    if (fs.existsSync(path.join(SOUNDS_DIR, filename))) return filename;
  }
  return null;
}

function removeSoundFiles(event: SoundEvent): void {
  for (const ext of Object.keys(MIME_BY_EXT)) {
    const filePath = path.join(SOUNDS_DIR, `${event}${ext}`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* best effort */ }
    }
  }
}

// GET /api/custom-sounds - which events have a custom sound
router.get('/', (_req: Request, res: Response) => {
  const sounds: Record<string, string | null> = {};
  for (const event of SOUND_EVENTS) {
    const filename = findSoundFile(event);
    // Cache-bust on change so a re-upload is picked up immediately.
    sounds[event] = filename
      ? `/api/custom-sounds/file/${filename}?v=${fs.statSync(path.join(SOUNDS_DIR, filename)).mtimeMs}`
      : null;
  }
  res.json({ sounds });
});

// GET /api/custom-sounds/file/:filename - serve an uploaded sound
router.get('/file/:filename', (req: Request, res: Response) => {
  try {
    ensureSoundsDir();
    const filename = path.basename(String(req.params.filename)); // sanitize
    const filePath = path.join(SOUNDS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Sound not found' });
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    log.error('Failed to serve custom sound:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/custom-sounds/:event - upload a sound (raw audio body)
router.post('/:event', (req: Request<{ event: string }>, res: Response) => {
  try {
    ensureSoundsDir();
    const event = String(req.params.event);
    if (!isSoundEvent(event)) {
      res.status(400).json({ error: `Unknown event: ${event}. Allowed: ${SOUND_EVENTS.join(', ')}` });
      return;
    }

    const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
    const ext = ALLOWED_AUDIO_TYPES[contentType];
    if (!ext) {
      res.status(400).json({
        error: `Invalid audio type: ${contentType || 'none'}. Allowed: ${Object.keys(ALLOWED_AUDIO_TYPES).join(', ')}`,
      });
      return;
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_SOUND_SIZE) {
        res.status(413).json({ error: `Sound too large. Max size: ${MAX_SOUND_SIZE / 1024 / 1024}MB` });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (res.headersSent) return; // already rejected as too large
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        res.status(400).json({ error: 'Empty upload' });
        return;
      }

      // One sound per event: drop any previous file (possibly a different ext).
      removeSoundFiles(event);
      const filename = `${event}${ext}`;
      fs.writeFileSync(path.join(SOUNDS_DIR, filename), buffer);
      log.log(`Uploaded custom sound for "${event}": ${filename} (${buffer.length} bytes)`);

      res.json({
        success: true,
        event,
        url: `/api/custom-sounds/file/${filename}?v=${Date.now()}`,
        size: buffer.length,
      });
    });

    req.on('error', (err) => {
      log.error('Custom sound upload error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Upload failed' });
    });
  } catch (err: any) {
    log.error('Failed to upload custom sound:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/custom-sounds/:event - revert to the built-in synthesized cue
router.delete('/:event', (req: Request<{ event: string }>, res: Response) => {
  const event = String(req.params.event);
  if (!isSoundEvent(event)) {
    res.status(400).json({ error: `Unknown event: ${event}` });
    return;
  }
  removeSoundFiles(event);
  res.json({ success: true, event });
});

export default router;
