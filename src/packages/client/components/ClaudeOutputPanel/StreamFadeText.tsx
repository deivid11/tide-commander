/**
 * Live stream rendering for assistant / thinking text.
 *
 * - With `renderComplete` (markdown pipeline): render rich content while tokens
 *   arrive. The buffer is split into a STABLE head (completed paragraphs —
 *   parsed once, then served from MarkdownBlock's memo) and a live tail (the
 *   current paragraph — the only part re-parsed per chunk). Without the split,
 *   remark re-parsed the whole buffer on every chunk: O(n²) per stream and the
 *   #1 CPU sink while agents type.
 * - Without `renderComplete`: word-by-word fade of plain text deltas.
 * - Complete (non-streaming) first paint: soft block fade when we never
 *   streamed — once per row per page session (virtualizer remounts stay static).
 *
 * Self-contained: injects @keyframes once and applies animation via inline
 * styles so the effect works even if SCSS is stale, purged, or overridden.
 */

import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface StreamFadeTextProps {
  text: string;
  isStreaming?: boolean;
  className?: string;
  /** When set, used for both live streaming and settled complete content (e.g. markdown). */
  renderComplete?: (text: string) => React.ReactNode;
  /**
   * Stable row id (e.g. `${agentId}:${uuid}`). Gates the complete-block fade to
   * once per page session so scrolling a virtualized list doesn't re-fade rows.
   */
  fadeId?: string;
}

/** Rows that already played the complete-block fade this page session. */
const seenFadeIds = new Set<string>();

/**
 * Split streamed markdown at the last paragraph boundary that is not inside a
 * code fence. `head` (incl. the trailing blank line) is stable across chunks,
 * so its parsed MarkdownBlock memo-hits; only `tail` re-parses per chunk.
 * Exported for unit tests.
 */
export function splitStableMarkdown(text: string): { head: string; tail: string } {
  let boundary = text.lastIndexOf('\n\n');
  while (boundary > 0) {
    const head = text.slice(0, boundary);
    const fenceCount = (head.match(/^[ \t]*(```|~~~)/gm) || []).length;
    if (fenceCount % 2 === 0) {
      return { head: text.slice(0, boundary + 2), tail: text.slice(boundary + 2) };
    }
    boundary = text.lastIndexOf('\n\n', boundary - 1);
  }
  return { head: '', tail: text };
}

function StreamCaret() {
  return (
    <span
      aria-hidden
      className="tide-stream-caret"
      style={{
        display: 'inline-block',
        width: '0.4em',
        height: '1em',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        borderRadius: 1,
        background: 'var(--accent-cyan, #22d3ee)',
        boxShadow: '0 0 8px color-mix(in srgb, var(--accent-cyan, #22d3ee) 60%, transparent)',
        opacity: 0.7,
      }}
    />
  );
}

const STYLE_ID = 'tide-stream-fade-keyframes-v3';

const KEYFRAMES_CSS = `
@keyframes tide-stream-word-in {
  0% {
    opacity: 0;
    transform: translateY(0.35em);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes tide-stream-block-in {
  0% {
    opacity: 0;
    transform: translateY(4px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
`.trim();

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = KEYFRAMES_CSS;
  document.head.appendChild(el);
}

/** Pure step used by unit tests. */
export function nextStreamFadeState(
  prevFull: string,
  text: string,
  isStreaming: boolean,
): { solid: string; fade: string | null } {
  if (!isStreaming) {
    return { solid: text, fade: null };
  }
  // "Hello".startsWith("") is true — first chunk fades entirely.
  if (text.startsWith(prevFull) && text.length > prevFull.length) {
    return { solid: prevFull, fade: text.slice(prevFull.length) };
  }
  if (prevFull === '' && text.length > 0) {
    return { solid: '', fade: text };
  }
  // Non-append reset (rare): show solid, no fade.
  return { solid: text, fade: null };
}

export function splitStreamWords(delta: string): string[] {
  if (!delta) return [];
  return delta.split(/(\s+)/).filter((p) => p.length > 0);
}

function FadeWords({ delta, gen }: { delta: string; gen: number }) {
  const parts = splitStreamWords(delta);
  let wordIndex = 0;
  return (
    <span data-stream-fade-gen={gen}>
      {parts.map((part, i) => {
        if (/^\s+$/.test(part)) {
          return <span key={`ws-${gen}-${i}`}>{part}</span>;
        }
        const delayMs = Math.min(wordIndex * 35, 350);
        wordIndex += 1;
        return (
          <span
            key={`w-${gen}-${i}-${part.slice(0, 8)}`}
            style={{
              display: 'inline-block',
              verticalAlign: 'baseline',
              opacity: 0,
              animationName: 'tide-stream-word-in',
              animationDuration: '0.55s',
              animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
              animationDelay: `${delayMs}ms`,
              animationFillMode: 'both',
            }}
          >
            {part}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Soft block enter for complete (final) content that never word-streamed.
 * CSS animation only — no forced reflow (`offsetWidth`) and no transition
 * bookkeeping, so a wave of rows mounting (agent switch, scroll) doesn't
 * layout-thrash. The lingering translateY(0) fill is cleared on animation end
 * so the row doesn't keep a transform-induced containing block.
 */
function CompleteBlockFade({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    ensureKeyframes();
  }, []);

  return (
    <span
      ref={ref}
      className={className}
      data-stream-complete-fade="1"
      style={{
        display: 'block',
        animation: 'tide-stream-block-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
      onAnimationEnd={(ev) => {
        const el = ref.current;
        if (el && ev.target === el) {
          el.style.animation = '';
        }
      }}
    >
      {children}
    </span>
  );
}

export const StreamFadeText = memo(function StreamFadeText({
  text,
  isStreaming = false,
  className,
  renderComplete,
  fadeId,
}: StreamFadeTextProps) {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  // True if this instance ever rendered live deltas — used so a later finalize
  // does not re-run the complete-block fade after the user already watched words.
  const didStreamRef = useRef(false);
  if (isStreaming) {
    didStreamRef.current = true;
    // A row that streams also counts as "entered" — after it settles, a
    // virtualizer remount must not replay the complete-block fade.
    if (fadeId) seenFadeIds.add(fadeId);
  }

  // Latch the fade decision once per mount: fade only rows that never streamed
  // AND haven't already faded this page session (scroll remounts stay static).
  const completeFadeRef = useRef<boolean | null>(null);

  const prevFullRef = useRef('');
  const genRef = useRef(0);
  const [paint, setPaint] = useState<{ solid: string; fade: string | null; gen: number }>({
    solid: '',
    fade: null,
    gen: 0,
  });

  const [seenText, setSeenText] = useState<string | null>(null);
  const [seenStreaming, setSeenStreaming] = useState(isStreaming);

  if (seenText === null || text !== seenText || isStreaming !== seenStreaming) {
    setSeenText(text);
    setSeenStreaming(isStreaming);

    if (!isStreaming) {
      prevFullRef.current = text;
      setPaint({ solid: text, fade: null, gen: genRef.current });
    } else {
      const prev = prevFullRef.current;
      const { solid, fade } = nextStreamFadeState(prev, text, true);
      if (fade) {
        genRef.current += 1;
        setPaint({ solid, fade, gen: genRef.current });
      } else {
        setPaint({ solid: text, fade: null, gen: genRef.current });
      }
      prevFullRef.current = text;
    }
  }

  if (!isStreaming) {
    const body = renderComplete ? renderComplete(text) : <span className={className}>{text}</span>;
    // Final-only (or streamTextLive off): soft block fade so the answer doesn't pop.
    // If we already streamed live, keep the settle instant — content already arrived.
    if (completeFadeRef.current === null) {
      completeFadeRef.current =
        !didStreamRef.current && !!text && (!fadeId || !seenFadeIds.has(fadeId));
      if (fadeId) seenFadeIds.add(fadeId);
    }
    if (completeFadeRef.current) {
      return <CompleteBlockFade className={className}>{body}</CompleteBlockFade>;
    }
    return <>{body}</>;
  }

  // Live markdown / rich path: completed paragraphs render from the memoized
  // head (parsed once); only the current paragraph (tail) re-parses per chunk.
  if (renderComplete) {
    const { head, tail } = splitStableMarkdown(text);
    return (
      <span
        className={className}
        data-stream-fade="1"
        data-stream-live-md="1"
        style={{ display: 'block', wordBreak: 'break-word' }}
      >
        {head ? renderComplete(head) : null}
        {tail ? renderComplete(tail) : null}
        <StreamCaret />
      </span>
    );
  }

  // Plain-text path: word-by-word fade for non-markdown streams.
  const { solid, fade, gen } = paint;
  const hasFade = typeof fade === 'string' && fade.length > 0;

  return (
    <span
      className={className}
      data-stream-fade="1"
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {hasFade ? solid : text}
      {hasFade && <FadeWords delta={fade} gen={gen} />}
      <StreamCaret />
    </span>
  );
});
