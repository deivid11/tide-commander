/**
 * VoiceAssistant - Global voice interface component
 *
 * Provides a mic button that records user speech, sends it to the server
 * which transcribes, analyzes intent with Claude, forwards to appropriate agent,
 * and responds with TTS.
 */

import React, { useState, useCallback } from 'react';
import { useSTT } from '../hooks/useSTT';
import { useTTS } from '../hooks/useTTS';
import { apiUrl, authFetch } from '../utils/storage';

interface VoiceAssistantProps {
  className?: string;
}

export function VoiceAssistant({ className }: VoiceAssistantProps) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tts = useTTS();

  const handleTranscription = useCallback(async (text: string) => {
    if (!text.trim()) return;

    console.log('[VoiceAssistant] Transcribed:', text);
    setProcessing(true);
    setError(null);

    try {
      // Send to voice assistant API
      const res = await authFetch(apiUrl('/api/voice-assistant/process'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (data.success && data.response) {
        console.log('[VoiceAssistant] Response:', data.response);
        // Auto-play the response
        tts.speak(data.response);
      } else {
        const errorMsg = data.error || 'Failed to process voice command';
        console.error('[VoiceAssistant] Error:', errorMsg);
        setError(errorMsg);
        tts.speak(errorMsg);
      }
    } catch (err) {
      console.error('[VoiceAssistant] Request failed:', err);
      const errorMsg = 'Voice assistant unavailable';
      setError(errorMsg);
      tts.speak(errorMsg);
    } finally {
      setProcessing(false);
    }
  }, [tts]);

  const stt = useSTT({
    language: 'Spanish',
    model: 'medium',
    onTranscription: handleTranscription,
  });

  const isActive = stt.recording || stt.transcribing || processing || tts.speaking;

  const getButtonTitle = () => {
    if (stt.error) return `Error: ${stt.error}`;
    if (error) return `Error: ${error}`;
    if (stt.recording) return 'Recording... (click to stop)';
    if (stt.transcribing) return 'Transcribing...';
    if (processing) return 'Processing...';
    if (tts.speaking) return 'Speaking...';
    return 'Voice Assistant (click to speak)';
  };

  const getButtonClass = () => {
    const classes = ['voice-assistant-btn', className].filter(Boolean);
    if (stt.recording) classes.push('recording');
    if (stt.transcribing || processing) classes.push('processing');
    if (tts.speaking) classes.push('speaking');
    if (error || stt.error) classes.push('error');
    return classes.join(' ');
  };

  const handleClick = () => {
    // Clear any previous error on new attempt
    setError(null);

    if (tts.speaking) {
      tts.stop();
      return;
    }

    if (stt.transcribing || processing) {
      return; // Don't interrupt processing
    }

    stt.toggleRecording();
  };

  return (
    <button
      className={getButtonClass()}
      onClick={handleClick}
      title={!stt.supported ? 'Voice not supported in this browser' : getButtonTitle()}
      disabled={!stt.supported || stt.transcribing || processing}
    >
      {stt.recording ? (
        // Recording animation - pulsing mic
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      ) : tts.speaking ? (
        // Speaking animation - sound waves
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      ) : (
        // Default mic icon
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )}
      {isActive && <span className="voice-assistant-indicator" />}
    </button>
  );
}
