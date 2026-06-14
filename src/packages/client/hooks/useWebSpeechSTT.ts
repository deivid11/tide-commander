/**
 * Speech-to-Text hook backed by the browser Web Speech API.
 * Runs entirely client-side — no server roundtrip. Supported in Chrome/Edge/Safari.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface WebSpeechSTTOptions {
  // BCP-47 language tag (e.g. 'es-ES', 'en-US'). Defaults to 'es-ES' to match the Whisper hook's Spanish default.
  language?: string;
  onTranscription?: (text: string) => void;
}

const DEFAULT_OPTIONS: WebSpeechSTTOptions = {
  language: 'es-ES',
};

type SpeechRecognitionCtor = typeof window extends { SpeechRecognition: infer T }
  ? T
  : new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionResultEventLike {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }>;
  resultIndex: number;
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  // @ts-expect-error - vendor-prefixed and standard names live on window.
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return (Ctor as SpeechRecognitionCtor) || null;
}

/** Returns true when this browser exposes the Web Speech API SpeechRecognition (or its vendor-prefixed form). */
export function isWebSpeechSTTSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export function useWebSpeechSTT(options: WebSpeechSTTOptions = {}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef<string>('');
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Capture the latest onTranscription so re-creating recognizers isn't required when it changes.
  const onTranscriptionRef = useRef(opts.onTranscription);
  useEffect(() => {
    onTranscriptionRef.current = options.onTranscription;
  }, [options.onTranscription]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const recognition = recognitionRef.current;
    if (!recognition) return null;
    try {
      recognition.stop();
    } catch {
      // Ignore — already stopped or not started.
    }
    return finalTranscriptRef.current.trim() || null;
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);

    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      console.error('[WebSpeechSTT] window.SpeechRecognition / webkitSpeechRecognition not available in this browser');
      setError('Web Speech API not supported in this browser');
      return;
    }

    if (!window.isSecureContext) {
      console.error('[WebSpeechSTT] window.isSecureContext is false — Web Speech API requires HTTPS or localhost');
      setError('Microphone requires HTTPS');
      return;
    }

    try {
      const recognition = new (Ctor as unknown as new () => SpeechRecognitionLike)();
      recognition.lang = opts.language || 'es-ES';
      // continuous=true mirrors the Whisper UX: keep listening until the user clicks stop,
      // tolerating natural pauses without ending the session early.
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      finalTranscriptRef.current = '';

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscriptRef.current += result[0].transcript;
          }
        }
        console.log('[WebSpeechSTT] onresult, accumulated:', finalTranscriptRef.current);
      };

      recognition.onerror = (event) => {
        console.error('[WebSpeechSTT] onerror:', event.error, event.message);
        const errCode = event.error;
        if (errCode === 'no-speech') {
          setError('No speech detected');
        } else if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          setError('Microphone permission denied');
        } else if (errCode === 'audio-capture') {
          setError('No microphone found');
        } else if (errCode === 'network') {
          setError('Network error');
        } else if (errCode !== 'aborted') {
          setError(`Speech recognition error: ${errCode}`);
        }
      };

      recognition.onend = () => {
        console.log('[WebSpeechSTT] onend, final transcript:', finalTranscriptRef.current);
        setRecording(false);
        const text = finalTranscriptRef.current.trim();
        if (text) {
          onTranscriptionRef.current?.(text);
        }
      };

      recognitionRef.current = recognition;
      console.log('[WebSpeechSTT] starting recognition, lang=', recognition.lang);
      recognition.start();
      setRecording(true);
    } catch (err) {
      console.error('[WebSpeechSTT] start() threw:', err);
      setRecording(false);
      setError(err instanceof Error ? err.message : 'Failed to start speech recognition');
    }
  }, [opts.language]);

  const toggleRecording = useCallback(async (): Promise<string | null> => {
    if (recording) {
      return stopRecording();
    }
    await startRecording();
    return null;
  }, [recording, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // Ignore.
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    recording,
    transcribing: false, // Web Speech API has no separate transcribing phase.
    error,
    startRecording,
    stopRecording,
    toggleRecording,
    supported: getRecognitionCtor() !== null,
  };
}
