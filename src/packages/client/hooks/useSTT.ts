/**
 * Speech-to-Text hook
 * Records audio from microphone and sends to server for Whisper transcription
 */

import { useState, useCallback, useRef } from 'react';
import { apiUrl } from '../utils/storage';

interface STTOptions {
  language?: string;
  model?: string;
  onTranscription?: (text: string) => void;
}

const DEFAULT_OPTIONS: STTOptions = {
  language: 'Spanish',
  model: 'medium',
};

export function useSTT(options: STTOptions = {}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const opts = { ...DEFAULT_OPTIONS, ...options };

  const startRecording = useCallback(async () => {
    setError(null);

    try {
      // Check if we're in a secure context (required for microphone on mobile)
      if (!window.isSecureContext) {
        console.error('[STT] Not in secure context - microphone requires HTTPS');
        setError('Microphone requires HTTPS');
        return;
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];

      // Determine best supported MIME type (iOS Safari doesn't support webm)
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        '',  // Let browser choose default
      ];

      let selectedMimeType = '';
      for (const mimeType of mimeTypes) {
        if (!mimeType || MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      console.log('[STT] Using MIME type:', selectedMimeType || 'browser default');

      // Create MediaRecorder with best available MIME type
      const recorderOptions: MediaRecorderOptions = {};
      if (selectedMimeType) {
        recorderOptions.mimeType = selectedMimeType;
      }

      const mediaRecorder = new MediaRecorder(stream, recorderOptions);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // Collect data every 100ms
      setRecording(true);

      console.log('[STT] Recording started');

    } catch (err: unknown) {
      console.error('[STT] Failed to start recording:', err);
      // Provide more specific error messages
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Microphone permission denied');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('No microphone found');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setError('Microphone in use by another app');
        } else if (err.name === 'OverconstrainedError') {
          setError('Microphone constraints not supported');
        } else {
          setError(`Microphone error: ${err.message}`);
        }
      } else {
        setError('Failed to access microphone');
      }
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (!mediaRecorderRef.current || !recording) {
      return null;
    }

    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!;

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        // Create blob from chunks (use the type from the first chunk, or fallback)
        const chunkType = chunksRef.current[0]?.type || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type: chunkType });
        chunksRef.current = [];

        console.log('[STT] Recording stopped, audio size:', audioBlob.size);

        if (audioBlob.size < 1000) {
          setError('Recording too short');
          setRecording(false);
          resolve(null);
          return;
        }

        // Convert to base64
        setTranscribing(true);
        try {
          const base64 = await blobToBase64(audioBlob);

          console.log('[STT] Sending audio for transcription...');

          const res = await fetch(apiUrl('/api/stt/transcribe'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audio: base64,
              language: opts.language,
              model: opts.model,
            }),
          });

          const data = await res.json();

          if (data.success && data.text) {
            console.log('[STT] Transcription:', data.text);
            opts.onTranscription?.(data.text);
            resolve(data.text);
          } else {
            console.error('[STT] Transcription failed:', data.error);
            setError(data.error || 'Transcription failed');
            resolve(null);
          }
        } catch (err) {
          console.error('[STT] Failed to transcribe:', err);
          setError('Failed to transcribe audio');
          resolve(null);
        } finally {
          setTranscribing(false);
        }

        setRecording(false);
      };

      mediaRecorder.stop();
    });
  }, [recording, opts]);

  const toggleRecording = useCallback(async (): Promise<string | null> => {
    if (recording) {
      return stopRecording();
    } else {
      await startRecording();
      return null;
    }
  }, [recording, startRecording, stopRecording]);

  return {
    recording,
    transcribing,
    error,
    startRecording,
    stopRecording,
    toggleRecording,
    supported: typeof navigator !== 'undefined' &&
               !!navigator.mediaDevices?.getUserMedia &&
               typeof MediaRecorder !== 'undefined',
  };
}

// Helper to convert Blob to base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
