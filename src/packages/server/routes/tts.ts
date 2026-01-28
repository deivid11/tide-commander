/**
 * TTS (Text-to-Speech) Route
 * Uses Piper for high-quality speech synthesis, returns audio to browser
 * Auto-detects language (Spanish/English) based on text content
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

const router = Router();

// Piper voice model paths
const PIPER_VOICES_DIR = path.join(os.homedir(), '.local/share/piper-voices');

// Voice models by language
const VOICES = {
  es: 'es_MX-claude-high',   // Latin American Spanish (Mexican female - Claude voice)
  en: 'en_US-amy-medium',    // American English (female)
};

// Common Spanish words for language detection
const SPANISH_INDICATORS = [
  // Common words
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'en', 'con', 'por', 'para', 'sin', 'sobre',
  'que', 'qué', 'como', 'cómo', 'cuando', 'cuándo', 'donde', 'dónde',
  'es', 'está', 'son', 'están', 'ser', 'estar', 'hay',
  'yo', 'tú', 'él', 'ella', 'nosotros', 'ellos', 'ellas',
  'mi', 'tu', 'su', 'nuestro', 'vuestro',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'pero', 'porque', 'aunque', 'también', 'además', 'entonces',
  'puede', 'pueden', 'puedo', 'podemos', 'hacer', 'hecho',
  'muy', 'más', 'menos', 'bien', 'mal', 'sí', 'no',
  'ahora', 'aquí', 'allí', 'hoy', 'ayer', 'mañana',
  // Verbs
  'tiene', 'tienen', 'tengo', 'tenemos', 'quiero', 'quiere',
  'necesito', 'necesita', 'busco', 'busca', 'encuentro', 'encuentra',
  // Tech terms often used in Spanish
  'archivo', 'archivos', 'código', 'función', 'método', 'clase',
  'ejecutar', 'compilar', 'instalar', 'configurar',
];

// Common English words for language detection
const ENGLISH_INDICATORS = [
  // Common words
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'how', 'what', 'which',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'from',
  'not', 'no', 'yes', 'can', 'cannot', "can't", "don't", "doesn't", "won't",
  'here', 'there', 'now', 'today', 'tomorrow', 'yesterday',
  // Tech terms
  'file', 'files', 'code', 'function', 'method', 'class',
  'run', 'execute', 'compile', 'install', 'configure', 'build',
  'error', 'warning', 'success', 'failed', 'complete',
];

/**
 * Detect language based on word frequency
 * Returns 'es' for Spanish, 'en' for English
 */
function detectLanguage(text: string): 'es' | 'en' {
  const words = text.toLowerCase().split(/\s+/);

  let spanishScore = 0;
  let englishScore = 0;

  for (const word of words) {
    // Clean punctuation from word
    const cleanWord = word.replace(/[.,!?;:'"()[\]{}]/g, '');

    if (SPANISH_INDICATORS.includes(cleanWord)) {
      spanishScore++;
    }
    if (ENGLISH_INDICATORS.includes(cleanWord)) {
      englishScore++;
    }
  }

  // Check for Spanish-specific characters (accents, ñ, ¿, ¡)
  if (/[áéíóúüñ¿¡]/.test(text)) {
    spanishScore += 3;
  }

  const detected = spanishScore > englishScore ? 'es' : 'en';
  logger.server.log(`[TTS] Language detection: Spanish=${spanishScore}, English=${englishScore} -> ${detected}`);

  return detected;
}

/**
 * POST /api/tts/speak
 * Generates audio using Piper TTS and returns WAV audio data
 * Auto-detects language if not specified
 */
router.post('/speak', async (req: Request, res: Response) => {
  const { text, voice, lang } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }

  // Clean text for speech (remove markdown, etc.)
  const cleanedText = text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`[^`]+`/g, ' code ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^[-*_]{3,}$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanedText) {
    return res.status(400).json({ error: 'No text to speak after cleaning' });
  }

  // Determine voice: explicit voice > explicit lang > auto-detect
  let selectedVoice: string;
  if (voice) {
    selectedVoice = voice;
  } else {
    const detectedLang = lang || detectLanguage(cleanedText);
    selectedVoice = VOICES[detectedLang as keyof typeof VOICES] || VOICES.en;
  }

  logger.server.log(`[TTS] Generating audio with voice ${selectedVoice}: ${cleanedText.substring(0, 50)}...`);

  const modelPath = path.join(PIPER_VOICES_DIR, `${selectedVoice}.onnx`);

  try {
    // Generate WAV audio using piper
    const audioData = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];

      const piper = spawn('piper', [
        '--model', modelPath,
        '--output_file', '-'  // Output to stdout as WAV
      ]);

      piper.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      piper.stderr.on('data', (data: Buffer) => {
        // Piper outputs progress to stderr, ignore it
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('error')) {
          logger.server.error(`[TTS] Piper stderr: ${msg}`);
        }
      });

      piper.on('error', (err) => {
        reject(new Error(`Piper spawn error: ${err.message}`));
      });

      piper.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`Piper exited with code ${code}`));
        }
      });

      // Send text to piper
      if (piper.stdin) {
        piper.stdin.write(cleanedText);
        piper.stdin.end();
      }
    });

    // Send WAV audio back to browser
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', audioData.length);
    res.send(audioData);

  } catch (err) {
    logger.server.error(`[TTS] Error generating audio: ${err}`);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

export default router;
