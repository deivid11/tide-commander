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

export function MermaidDiagram({ code }: { code: string }) {
  // useId() contains ':' which is invalid in a DOM id / mermaid render id.
  const baseId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const renderSeq = useRef(0);

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
        if (seq === renderSeq.current) setSvg(out);
      } catch {
        // Invalid / still-streaming syntax — keep the raw-source fallback.
        if (seq === renderSeq.current) setSvg(null);
      }
    }, RENDER_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [code, baseId]);

  if (svg) {
    return (
      <div
        className="mermaid-diagram"
        style={{
          margin: '0.6em 0',
          padding: '12px',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)',
          overflowX: 'auto',
          textAlign: 'center',
        }}
        // mermaid-generated SVG, sanitized by mermaid's securityLevel:'strict'
        dangerouslySetInnerHTML={{ __html: svg }}
      />
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
