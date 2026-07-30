import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Shared pdf.js-based viewer (extracted from FileViewerModal so the git-panel
// diff modal can preview PDFs too). Rasterizes pages to canvases with a
// selectable text layer; works inside the Android WebView, where an <iframe>
// pointing at a PDF renders nothing.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export function PdfJsViewer({ url, authToken }: { url: string; authToken?: string }) {
  const [numPages, setNumPages] = useState<number>(0);
  const [renderedPages, setRenderedPages] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Bumped (debounced) when the container width or devicePixelRatio changes:
  // pages are rasterized bitmaps, so a size change needs a re-render — CSS
  // rescaling a stale bitmap is exactly what made the viewer blurry.
  const [renderTick, setRenderTick] = useState(0);
  const lastLayoutRef = useRef<{ width: number; dpr: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const maybeRerender = () => {
      const width = el.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      const last = lastLayoutRef.current;
      // First observation (and anything the render loop already accounted
      // for) just records the layout; only real changes schedule a re-render.
      if (!last) {
        lastLayoutRef.current = { width, dpr };
        return;
      }
      if (Math.abs(last.width - width) < 2 && last.dpr === dpr) return;
      lastLayoutRef.current = { width, dpr };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRenderTick((t) => t + 1), 250);
    };
    const observer = new ResizeObserver(maybeRerender);
    observer.observe(el);
    // ResizeObserver misses pure browser-zoom changes when the CSS size stays
    // equal; the window resize event catches those (DPR changes with zoom).
    window.addEventListener('resize', maybeRerender);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', maybeRerender);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadParams: Parameters<typeof pdfjsLib.getDocument>[0] = { url };
    if (authToken) {
      loadParams.httpHeaders = { 'X-Auth-Token': authToken };
    }
    const loadingTask = pdfjsLib.getDocument(loadParams);

    const render = async () => {
      try {
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        setError(null);
        setRenderedPages(0);
        setNumPages(pdf.numPages);

        const pagesEl = containerRef.current;
        if (!pagesEl) return;
        pagesEl.innerHTML = '';

        // Fit pages to the container width (minus its 16px side paddings) and
        // rasterize at devicePixelRatio so the bitmap is sharp on HiDPI
        // screens and under browser zoom (capped to keep huge PDFs cheap).
        const availableWidth = Math.max(240, pagesEl.clientWidth - 32);
        const outputScale = Math.min(window.devicePixelRatio || 1, 3);
        lastLayoutRef.current = { width: pagesEl.clientWidth, dpr: window.devicePixelRatio || 1 };

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) break;
          const page = await pdf.getPage(i);
          const baseViewport = page.getViewport({ scale: 1 });
          const displayScale = Math.min(availableWidth / baseViewport.width, 2.5);
          const viewport = page.getViewport({ scale: displayScale });
          const cssWidth = Math.floor(viewport.width);
          const cssHeight = Math.floor(viewport.height);

          const wrapper = document.createElement('div');
          wrapper.className = 'pdf-js-page-wrapper';
          wrapper.style.width = `${cssWidth}px`;
          wrapper.style.height = `${cssHeight}px`;
          // pdf.js TextLayer sizes itself and its glyphs through these vars.
          wrapper.style.setProperty('--scale-factor', String(viewport.scale));
          wrapper.style.setProperty('--total-scale-factor', String(viewport.scale));

          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-js-page-canvas';
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${cssHeight}px`;
          wrapper.appendChild(canvas);

          // Selectable/copyable text lives in a transparent layer above the
          // rasterized canvas, aligned by sharing the same viewport.
          const textLayerDiv = document.createElement('div');
          textLayerDiv.className = 'textLayer';
          wrapper.appendChild(textLayerDiv);

          pagesEl.appendChild(wrapper);

          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({
              canvas,
              canvasContext: ctx,
              viewport,
              transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
            }).promise;
          }
          if (cancelled) break;

          await new pdfjsLib.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textLayerDiv,
            viewport,
          }).render();

          if (!cancelled) setRenderedPages(i);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
        }
      }
    };

    render();
    return () => {
      cancelled = true;
      // Aborts the fetch/parse and any in-flight page render.
      loadingTask.destroy().catch(() => { /* already destroyed */ });
    };
  }, [url, authToken, renderTick]);

  const loading = renderedPages === 0 && !error;

  return (
    <div className="pdf-js-container">
      {loading && <div className="pdf-js-loading">Loading PDF…</div>}
      {error && <div className="pdf-js-error">{error}</div>}
      {numPages > 0 && (
        <div className="pdf-js-info">
          {renderedPages < numPages
            ? `Rendering page ${renderedPages + 1} of ${numPages}…`
            : `${numPages} page${numPages !== 1 ? 's' : ''}`}
        </div>
      )}
      <div ref={containerRef} className="pdf-js-pages" />
    </div>
  );
}
