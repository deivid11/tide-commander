import React, { useEffect, useId, useRef, useState } from 'react';

/**
 * Renders a ```mermaid fenced code block as an actual diagram in the chat.
 *
 * Streaming-safe: agent output arrives token-by-token, so the diagram source is
 * incomplete (and thus invalid) for most of its lifetime. We debounce rendering
 * until the source settles, and while it's pending/invalid we fall back to showing
 * the raw source — so a half-streamed or malformed diagram never breaks the UI.
 *
 * Mermaid is loaded lazily (dynamic import) so it stays out of the main bundle for
 * the (common) case where a conversation contains no diagrams.
 */

let mermaidLoader: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        // Diagrams live inside the dark chat surface; 'dark' keeps them legible.
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
 * Force the rendered <svg> to its NATURAL pixel size (from the viewBox).
 *
 * Mermaid's output carries `width="100%"` + `style="max-width:<N>px"`, which shrinks
 * a diagram to fit its container — so a big diagram renders tiny and even zooming in
 * barely helps. Stripping those AND pinning width/height to the viewBox makes 100%
 * mean "actual size", so the bounded viewport genuinely scrolls/pans/zooms.
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

export function MermaidDiagram({ code }: { code: string }) {
  // useId() contains ':' which is invalid in a DOM id / mermaid render id.
  const baseId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const renderSeq = useRef(0);
  // Scroll/pan viewport: diagrams can be large, so they live in a bounded box the
  // user can scroll and drag ("grab") to move around within, plus zoom in/out.
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0, left: 0, top: 0 });
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  scaleRef.current = scale;

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
        // parse() validates without leaving orphaned error nodes in the DOM.
        await mermaid.parse(source);
        const { svg: out } = await mermaid.render(`mermaid-${baseId}-${seq}`, source);
        // Render at natural size so the diagram doesn't shrink-to-fit (see helper).
        if (seq === renderSeq.current) setSvg(sizeSvgToNatural(out));
      } catch {
        // Invalid / still-streaming syntax — keep the raw-source fallback.
        if (seq === renderSeq.current) setSvg(null);
      }
    }, RENDER_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [code, baseId]);

  // Ctrl/⌘ + wheel zooms toward the cursor. Uses a NATIVE non-passive listener so
  // preventDefault() actually fires (React's onWheel is passive → can't stop the
  // browser's own ctrl+wheel page zoom). A plain wheel is left alone to scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !svg) return;
    const onWheelNative = (e: WheelEvent) => {
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
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [svg]);

  if (svg) {
    // Drag-to-pan: hold and move to scroll a large diagram within its box.
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

    // Zoom via the +/− buttons (keeps the top-left anchored; clamped to range).
    const applyZoom = (nextScale: number) => {
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale)));
    };

    const btnStyle: React.CSSProperties = {
      width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'color-mix(in srgb, var(--bg-secondary) 90%, transparent)',
      border: '1px solid var(--border-color)', borderRadius: 4, color: 'var(--text-primary)',
      cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, userSelect: 'none',
    };

    return (
      <div
        className="mermaid-diagram"
        style={{
          position: 'relative',
          margin: '0.6em 0',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)',
        }}
      >
        {/* Zoom controls — fixed to the box corner, don't scroll with the diagram. */}
        <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, display: 'flex', gap: 4, alignItems: 'center' }}>
          <button type="button" title="Zoom out" style={btnStyle} onClick={() => applyZoom(scale / 1.2)}>−</button>
          <button type="button" title="Reset zoom" style={{ ...btnStyle, width: 'auto', padding: '0 6px', fontVariantNumeric: 'tabular-nums' }} onClick={() => { setScale(1); if (scrollRef.current) { scrollRef.current.scrollLeft = 0; scrollRef.current.scrollTop = 0; } }}>{Math.round(scale * 100)}%</button>
          <button type="button" title="Zoom in" style={btnStyle} onClick={() => applyZoom(scale * 1.2)}>+</button>
        </div>
        <div
          ref={scrollRef}
          onMouseDown={onPanStart}
          onMouseMove={onPanMove}
          onMouseUp={onPanEnd}
          onMouseLeave={onPanEnd}
          style={{
            // Bounded, scrollable viewport: large diagrams stay contained; the user
            // scrolls (both axes), drags to pan, or zooms instead of the diagram
            // taking over the whole conversation.
            maxHeight: '440px',
            overflow: 'auto',
            cursor: 'grab',
            padding: '12px',
            textAlign: 'center',
            userSelect: 'none',
          }}
        >
          <div
            style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: 'fit-content' }}
            // mermaid-generated SVG, sanitized by mermaid's securityLevel:'strict'
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    );
  }

  // Pending or invalid: show the source so nothing ever blanks out.
  return (
    <pre
      className="mermaid-diagram mermaid-diagram--source"
      style={{
        margin: '0.6em 0',
        padding: '12px',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)',
        overflowX: 'auto',
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--text-primary)',
      }}
    >
      {code}
    </pre>
  );
}
