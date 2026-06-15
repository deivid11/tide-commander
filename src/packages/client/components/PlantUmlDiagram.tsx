/**
 * PlantUmlDiagram - renders a PlantUML source block as an SVG image.
 *
 * PlantUML cannot be rendered purely client-side (it needs a render server), so
 * the diagram source is POSTed to a PlantUML/Kroki server which returns an SVG.
 *
 * PRIVACY NOTE: the raw diagram source is sent to an EXTERNAL server
 * (kroki.io by default). The endpoint is configurable via PLANTUML_RENDER_ENDPOINT
 * (or the `endpoint` prop) so it can be pointed at a self-hosted Kroki / PlantUML
 * instance for sensitive diagrams. A brief note is shown under each diagram so the
 * user knows where their source was sent.
 *
 * Rendering uses SVG (scales cleanly) shown as an <img>, with a loading state and
 * an error fallback that shows the raw PlantUML source so nothing is lost.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Default public render server. Mirrors the .puml file viewer (FileExplorerPanel/FileViewer.tsx).
// Point this at a self-hosted Kroki instance (e.g. http://localhost:8000/plantuml/svg) to keep
// diagram sources private.
export const PLANTUML_RENDER_ENDPOINT = 'https://kroki.io/plantuml/svg';

/** Convert an SVG string into a base64 data URL safe for <img src>. */
function toSvgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/svg+xml;base64,${window.btoa(binary)}`;
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

interface PlantUmlDiagramProps {
  source: string;
  endpoint?: string;
}

export function PlantUmlDiagram({ source, endpoint = PLANTUML_RENDER_ENDPOINT }: PlantUmlDiagramProps) {
  const { t } = useTranslation(['terminal']);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    const trimmed = source.trim();
    if (!trimmed) {
      setError('Diagram is empty');
      setIsRendering(false);
      setDataUrl(null);
      return;
    }

    const controller = new AbortController();
    setIsRendering(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            Accept: 'image/svg+xml',
          },
          body: trimmed,
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Render failed (${res.status})`);
        }
        const svg = await res.text();
        if (!svg.includes('<svg')) {
          throw new Error('Invalid SVG output');
        }
        setDataUrl(toSvgDataUrl(svg));
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
        setDataUrl(null);
      } finally {
        if (!controller.signal.aborted) {
          setIsRendering(false);
        }
      }
    })();

    return () => controller.abort();
  }, [source, endpoint]);

  if (isRendering) {
    return (
      <div className="plantuml-diagram plantuml-diagram-loading">
        <span className="plantuml-diagram-spinner" aria-hidden="true"></span>
        <span>{t('terminal:fileExplorer.renderingDiagram')}</span>
      </div>
    );
  }

  if (error || !dataUrl) {
    return (
      <div className="plantuml-diagram plantuml-diagram-error">
        <div className="plantuml-diagram-error-msg">
          {t('terminal:fileExplorer.couldNotRender')}{error ? `: ${error}` : ''}
        </div>
        <pre className="plantuml-diagram-source">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  const host = hostOf(endpoint);
  return (
    <div className="plantuml-diagram">
      <img src={dataUrl} alt="PlantUML diagram" className="plantuml-diagram-image" />
      <div
        className="plantuml-diagram-note"
        title={t('terminal:fileExplorer.diagramExternalNote', { host })}
      >
        {t('terminal:fileExplorer.diagramRenderedVia', { host })}
      </div>
    </div>
  );
}
