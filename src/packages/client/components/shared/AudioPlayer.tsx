/**
 * AudioPlayer — waveform preview + transport for audio files in the viewers.
 *
 * The file is fetched ONCE through authFetch and kept as a Blob: the same bytes
 * feed the <audio> element (so playback/codec support is the browser's problem)
 * and a decodeAudioData copy used to draw the waveform. Re-fetching per use
 * would double the download of a multi-MB capture.
 *
 * Decoding is best effort — a codec the browser can play but not decode offline
 * (or one it cannot decode at all) simply loses the waveform, never the
 * transport.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFetch } from '../../utils/storage';
import { Icon } from '../Icon';
import { computePeaks, formatTimecode, mixToMono, WAVEFORM_BUCKETS, type WaveformPeaks } from './audioPeaks';

interface AudioPlayerProps {
  url: string;
  filename: string;
}

interface DecodedInfo {
  duration: number;
  sampleRate: number;
  channels: number;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const WAVEFORM_HEIGHT = 160;

export function AudioPlayer({ url, filename }: AudioPlayerProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<WaveformPeaks | null>(null);
  const frameRef = useRef<number>(0);

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [hasPeaks, setHasPeaks] = useState(false);
  const [info, setInfo] = useState<DecodedInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);

  // --- Load the bytes once, then decode a copy for the waveform ---------------
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | null = null;
    let audioContext: AudioContext | null = null;
    let disposed = false;

    setBlobUrl(null);
    setLoadError(null);
    setDecodeFailed(false);
    setHasPeaks(false);
    setInfo(null);
    peaksRef.current = null;

    void authFetch(url, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        const blob = await response.blob();
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        return blob.arrayBuffer();
      })
      .then(async (buffer) => {
        if (disposed || !buffer) return;
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          setDecodeFailed(true);
          return;
        }
        audioContext = new Ctor();
        const decoded = await audioContext.decodeAudioData(buffer);
        if (disposed) return;
        const channels: Float32Array[] = [];
        for (let i = 0; i < decoded.numberOfChannels; i++) channels.push(decoded.getChannelData(i));
        peaksRef.current = computePeaks(mixToMono(channels), WAVEFORM_BUCKETS);
        setHasPeaks(true);
        setInfo({ duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels });
        setDuration((prev) => (prev > 0 ? prev : decoded.duration));
      })
      .catch((err) => {
        if (abort.signal.aborted || disposed) return;
        // A failed fetch is fatal; a failed decode only costs the waveform.
        if (objectUrl) setDecodeFailed(true);
        else setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        void audioContext?.close().catch(() => { /* already closed */ });
      });

    return () => {
      disposed = true;
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  // --- Waveform drawing ------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    if (peaks) {
      const buckets = peaks.min.length;
      const progress = duration > 0 ? currentTime / duration : 0;
      const playedX = progress * width;
      for (let x = 0; x < width; x++) {
        const bucket = Math.min(buckets - 1, Math.floor((x / width) * buckets));
        const top = mid - peaks.max[bucket] * mid;
        const bottom = mid - peaks.min[bucket] * mid;
        // Literal colors: a canvas context cannot resolve CSS custom properties.
        ctx.strokeStyle = x <= playedX ? '#4ad9ff' : 'rgba(120, 200, 255, 0.32)';
        ctx.beginPath();
        ctx.moveTo(x + 0.5, Math.min(top, mid - 0.5));
        ctx.lineTo(x + 0.5, Math.max(bottom, mid + 0.5));
        ctx.stroke();
      }

      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(playedX, 0);
      ctx.lineTo(playedX, height);
      ctx.stroke();
    }

    ctx.restore();
  }, [currentTime, duration]);

  useEffect(() => { draw(); }, [draw, info]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  // The timeupdate event fires ~4x/s, too coarse for a playhead — follow the
  // element on rAF while it is actually playing.
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setCurrentTime(audio.currentTime);
      frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameRef.current);
  }, [playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
  }, [rate, blobUrl]);

  // --- Transport -------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, []);

  const seekToRatio = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
    setCurrentTime(audio.currentTime);
  }, []);

  const handleWaveformPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    seekToRatio((event.clientX - rect.left) / rect.width);
  }, [seekToRatio]);

  const handleWaveformDrag = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.buttons !== 1) return;
    handleWaveformPointer(event);
  }, [handleWaveformPointer]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (event.key === ' ') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
      setCurrentTime(audio.currentTime);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - 5);
      setCurrentTime(audio.currentTime);
    }
  }, [togglePlay]);

  const meta = useMemo(() => {
    const parts: string[] = [];
    if (info) {
      parts.push(`${(info.sampleRate / 1000).toFixed(1)} kHz`);
      parts.push(info.channels === 1 ? t('terminal:audioPlayer.mono', { defaultValue: 'mono' }) : info.channels === 2 ? t('terminal:audioPlayer.stereo', { defaultValue: 'stereo' }) : `${info.channels} ch`);
    }
    return parts.join(' · ');
  }, [info, t]);

  if (loadError) {
    return (
      <div className="audio-player-error">
        {t('terminal:audioPlayer.loadError', { defaultValue: 'Could not load audio' })} — {loadError}
      </div>
    );
  }

  return (
    <div
      className="audio-player"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label={filename}
    >
      <div className="audio-player-waveform" style={{ height: WAVEFORM_HEIGHT }}>
        <canvas
          ref={canvasRef}
          className="audio-player-canvas"
          onPointerDown={handleWaveformPointer}
          onPointerMove={handleWaveformDrag}
        />
        {!hasPeaks && !decodeFailed && (
          <div className="audio-player-waveform-status">{t('terminal:audioPlayer.decoding', { defaultValue: 'Reading waveform…' })}</div>
        )}
        {decodeFailed && (
          <div className="audio-player-waveform-status">{t('terminal:audioPlayer.noWaveform', { defaultValue: 'Waveform unavailable for this format' })}</div>
        )}
      </div>

      <div className="audio-player-controls">
        <button
          type="button"
          className="audio-player-play"
          onClick={togglePlay}
          disabled={!blobUrl}
          title={playing ? t('common:buttons.pause', { defaultValue: 'Pause' }) : t('common:buttons.play', { defaultValue: 'Play' })}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>

        <span className="audio-player-time">
          {formatTimecode(currentTime)} / {formatTimecode(duration)}
        </span>

        <input
          type="range"
          className="audio-player-seek"
          min={0}
          max={1}
          step={0.001}
          value={duration > 0 ? currentTime / duration : 0}
          onChange={(e) => seekToRatio(Number(e.target.value))}
          aria-label={t('terminal:audioPlayer.seek', { defaultValue: 'Seek' })}
        />

        <button
          type="button"
          className={`audio-player-toggle${loop ? ' active' : ''}`}
          onClick={() => setLoop((v) => !v)}
          title={t('terminal:audioPlayer.loop', { defaultValue: 'Loop' })}
        >
          <Icon name="refresh" size={13} />
        </button>

        <select
          className="audio-player-rate"
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          aria-label={t('terminal:audioPlayer.speed', { defaultValue: 'Playback speed' })}
        >
          {PLAYBACK_RATES.map((value) => (
            <option key={value} value={value}>{value}×</option>
          ))}
        </select>

        <div className="audio-player-volume">
          <Icon name={volume === 0 ? 'speaker-off' : 'speaker-on'} size={13} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const next = Number(e.target.value);
              setVolume(next);
              if (audioRef.current) audioRef.current.volume = next;
            }}
            aria-label={t('terminal:audioPlayer.volume', { defaultValue: 'Volume' })}
          />
        </div>

        {meta && <span className="audio-player-meta">{meta}</span>}
      </div>

      {blobUrl && (
        <audio
          ref={audioRef}
          src={blobUrl}
          loop={loop}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const value = e.currentTarget.duration;
            // A streamed WAV can report Infinity until it is fully buffered —
            // fall back to the decoded duration in that case.
            if (Number.isFinite(value) && value > 0) setDuration(value);
            else if (info) setDuration(info.duration);
          }}
        />
      )}
    </div>
  );
}
