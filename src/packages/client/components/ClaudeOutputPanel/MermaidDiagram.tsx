import React, { useEffect, useId, useRef, useState } from 'react';
import { ModalPortal } from '../shared/ModalPortal';

/**
 * Renders a ```mermaid fenced code block as a diagram in the chat.
 *
 * Inline it's a clean, STATIC preview (fits the message width). Clicking it opens a
 * modal with the interactive viewport — zoom (buttons + ctrl/⌘-wheel) and drag-to-pan
 * navigation — so the chat stays tidy while big diagrams are still explorable.
 *
 * Streaming-safe: agent output arrives token-by-token, so the source is incomplete
 * (and invalid) for most of its lifetime. Rendering is debounced until it settles and
 * falls back to the raw source while incomplete/invalid, so it never breaks the view.
 * Mermaid is loaded lazily (dynamic import) so it stays out of the main bundle.
 */

let mermaidLoader: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        // Agent-generated content — sanitize labels and disable click handlers/scripts.
        securityLevel: 'strict',
        fontFamily: 'inherit',
      });
      return mermaid;
    });
  }
  return mermaidLoader;
}

const RENDER_DEBOUNCE_MS = 250;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

/**
 * Force the <svg> to its NATURAL pixel size (from the viewBox) for the modal — mermaid
 * ships width=100% + max-width so a diagram shrinks to fit, which makes zoom/pan
 * pointless. Pinning width/height to the viewBox makes 100% mean "actual size".
 */
function sizeSvgToNatural(svg: string): string {
  const vb = svg.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/i);
  return svg.replace(/<svg\b([^>]*)>/i, (_full, attrs: string) => {
    let a = String(attrs)
      .replace(/\swidth="[^"]*"/i, '')
      .replace(/\sheight="[^"]*"/i, '')
      .replace(/max-width:\s*[\d.]+px;?/i, '');
    if (vb) a += ` width="${vb[1]}" height="${vb[2]}"`;
    return `<svg${a}>`;
  });
}

const boxStyle: React.CSSProperties = {
  margin: '0.6em 0',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)',
};

export function MermaidDiagram({ code }: { code: string }) {
  // useId() contains ':' which is invalid in a DOM id / mermaid render id.
  const baseId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const renderSeq = useRef(0);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const source = code.trim();
    if (!source) {
      setSvg(null);
      return;
    }
    const seq = ++renderSeq.current;
    // Debounce: don't try to render (and error on) every partial streamed fragment.
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        await mermaid.parse(source); // validates without leaving orphaned error nodes
        const { svg: out } = await mermaid.render(`mermaid-${baseId}-${seq}`, source);
        if (seq === renderSeq.current) setSvg(out);
      } catch {
        if (seq === renderSeq.current) setSvg(null);
      }
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, baseId]);

  // Pending or invalid (e.g. still streaming): show the source so nothing blanks out.
  if (!svg) {
    return (
      <pre
        className="mermaid-diagram mermaid-diagram--source"
        style={{ ...boxStyle, padding: '12px', overflowX: 'auto', fontSize: '12px', lineHeight: 1.5, color: 'var(--text-primary)' }}
      >
        {code}
      </pre>
    );
  }

  return (
    <>
      {/* Static inline preview — click to open the interactive modal. */}
      <div
        className="mermaid-diagram mermaid-diagram--preview"
        onClick={() => setModalOpen(true)}
        title="Click to zoom / pan"
        style={{ ...boxStyle, position: 'relative', padding: '12px', maxHeight: '340px', overflow: 'hidden', textAlign: 'center', cursor: 'zoom-in' }}
      >
        <div dangerouslySetInnerHTML={{ __html: svg }} />
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 6, right: 6, width: 22, height: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--bg-secondary) 88%, transparent)',
            border: '1px solid var(--border-color)', borderRadius: 4,
            color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1, pointerEvents: 'none',
          }}
        >
          ⤢
        </span>
      </div>
      {modalOpen && <MermaidModal svg={sizeSvgToNatural(svg)} onClose={() => setModalOpen(false)} />}
    </>
  );
}

function MermaidModal({ svg, onClose }: { svg: string; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0, left: 0, top: 0 });
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  scaleRef.current = scale;

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Ctrl/⌘ + wheel zooms toward the cursor (native non-passive listener so
  // preventDefault fires and the browser's own ctrl+wheel page-zoom is suppressed).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const cur = scaleRef.current;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cur * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      if (next === cur) return;
      const rect = el.getBoundingClientRect();
      const px = el.scrollLeft + (e.clientX - rect.left);
      const py = el.scrollTop + (e.clientY - rect.top);
      const ratio = next / cur;
      el.scrollLeft = px * ratio - (e.clientX - rect.left);
      el.scrollTop = py * ratio - (e.clientY - rect.top);
      setScale(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPanStart = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { active: true, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.style.cursor = 'grabbing';
  };
  const onPanMove = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    const d = dragRef.current;
    if (!el || !d.active) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const onPanEnd = () => {
    const el = scrollRef.current;
    dragRef.current.active = false;
    if (el) el.style.cursor = 'grab';
  };
  const zoom = (next: number) => setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
  const resetView = () => {
    setScale(1);
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
      scrollRef.current.scrollTop = 0;
    }
  };

  const btnStyle: React.CSSProperties = {
    minWidth: 26, height: 26, padding: '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in srgb, var(--bg-secondary) 90%, transparent)',
    border: '1px solid var(--border-color)', borderRadius: 4, color: 'var(--text-primary)',
    cursor: 'pointer', fontSize: 14, lineHeight: 1,
  };

  return (
    <ModalPortal>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 3000,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3vh 3vw',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative', width: '94vw', height: '94vh',
            display: 'flex', flexDirection: 'column',
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 8,
            boxShadow: '0 12px 48px rgba(0, 0, 0, 0.5)', overflow: 'hidden',
          }}
        >
          {/* Toolbar: zoom controls + close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, borderBottom: '1px solid var(--border-color)' }}>
            <button type="button" title="Zoom out" style={btnStyle} onClick={() => zoom(scale / 1.2)}>−</button>
            <button type="button" title="Reset zoom" style={{ ...btnStyle, fontVariantNumeric: 'tabular-nums' }} onClick={resetView}>{Math.round(scale * 100)}%</button>
            <button type="button" title="Zoom in" style={btnStyle} onClick={() => zoom(scale * 1.2)}>+</button>
            <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 12 }}>drag to pan · ctrl/⌘+scroll to zoom</span>
            <button type="button" title="Close (Esc)" style={{ ...btnStyle, marginLeft: 6 }} onClick={onClose}>✕</button>
          </div>
          {/* Zoom/pan viewport */}
          <div
            ref={scrollRef}
            onMouseDown={onPanStart}
            onMouseMove={onPanMove}
            onMouseUp={onPanEnd}
            onMouseLeave={onPanEnd}
            style={{ flex: 1, overflow: 'auto', cursor: 'grab', padding: 16, userSelect: 'none' }}
          >
            <div
              style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: 'fit-content' }}
              // mermaid-generated SVG, sanitized by mermaid's securityLevel:'strict'
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
