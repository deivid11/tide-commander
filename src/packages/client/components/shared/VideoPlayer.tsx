/**
 * VideoPlayer — inline playback for video files in the viewers.
 *
 * Unlike AudioPlayer this does NOT buffer the file into a Blob: a recording can
 * be hundreds of MB, so the element streams straight from /api/files/binary and
 * relies on the endpoint's Range support to seek. That also means the URL has to
 * carry the auth token — a <video> tag cannot send headers.
 *
 * Native controls on purpose: they bring fullscreen, picture-in-picture, speed
 * and keyboard handling that a hand-rolled transport would only approximate.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadServerFile } from '../../utils/file-download';

interface VideoPlayerProps {
  /** Streaming URL, token included. */
  url: string;
  /** Same file with download=true, for the codec-unsupported fallback. */
  downloadUrl: string;
  filename: string;
}

interface VideoMeta {
  width: number;
  height: number;
}

export function VideoPlayer({ url, downloadUrl, filename }: VideoPlayerProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [failed, setFailed] = useState(false);

  const handleDownload = useCallback(() => {
    void downloadServerFile(downloadUrl, filename);
  }, [downloadUrl, filename]);

  if (failed) {
    return (
      <div className="video-player-error">
        <div>{t('terminal:videoPlayer.unsupported', { defaultValue: 'This browser cannot play this video format.' })}</div>
        <button type="button" className="file-viewer-copy-html-btn" onClick={handleDownload}>
          {t('common:buttons.download')}
        </button>
      </div>
    );
  }

  return (
    <div className="video-player">
      <video
        key={url}
        className="video-player-element"
        src={url}
        controls
        preload="metadata"
        playsInline
        onError={() => setFailed(true)}
        onLoadedMetadata={(e) => setMeta({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
      />
      {meta && meta.width > 0 && (
        <div className="video-player-meta">{meta.width}×{meta.height}</div>
      )}
    </div>
  );
}
