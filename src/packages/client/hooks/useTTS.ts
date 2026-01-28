/**
 * Text-to-Speech hook
 * Uses server-side Piper TTS with auto language detection, plays audio in browser
 */

import { useState, useCallback, useRef } from 'react';
import { apiUrl } from '../utils/storage';

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) {
      console.warn('[TTS] No text to speak');
      return;
    }

    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    console.log('[TTS] Requesting audio from server (auto-detect language):', text.substring(0, 100) + '...');
    setSpeaking(true);

    try {
      const res = await fetch(apiUrl('/api/tts/speak'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),  // Let server auto-detect language
      });

      if (!res.ok) {
        const error = await res.json();
        console.error('[TTS] Server error:', error);
        setSpeaking(false);
        return;
      }

      // Get audio blob and create URL
      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // Create and play audio element
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      audio.onerror = (e) => {
        console.error('[TTS] Audio playback error:', e);
        setSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      await audio.play();
      console.log('[TTS] Playing audio in browser');

    } catch (err) {
      console.error('[TTS] Failed to get audio:', err);
      setSpeaking(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const toggle = useCallback((text: string) => {
    console.log('[TTS] Toggle called, currently speaking:', speaking);
    if (speaking) {
      stop();
    } else {
      speak(text);
    }
  }, [speaking, speak, stop]);

  return {
    speak,
    stop,
    toggle,
    speaking,
    supported: true,
  };
}

// Standalone function for components that don't want the hook
export async function speakText(text: string) {
  try {
    const res = await fetch(apiUrl('/api/tts/speak'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),  // Let server auto-detect language
    });

    if (!res.ok) {
      console.error('[TTS] Server error');
      return;
    }

    const audioBlob = await res.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audio.onended = () => URL.revokeObjectURL(audioUrl);
    await audio.play();
  } catch (err) {
    console.error('[TTS] Failed to speak:', err);
  }
}

export function stopSpeaking() {
  // For standalone function, we can't easily stop
  // Use the hook for stop functionality
}
