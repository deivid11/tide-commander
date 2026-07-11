/**
 * Live stream rendering for assistant / thinking text.
 *
 * - With `renderComplete` (markdown pipeline): re-render the full buffer as
 *   rich content on every chunk. Incomplete fences briefly look odd; still
 *   far better than raw `**` / `#` showing mid-stream.
 * - Without `renderComplete`: word-by-word fade of plain text deltas.
 * - Complete (non-streaming) first paint: soft block fade when we never streamed.
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
        animationName: 'tide-stream-caret-blink',
        animationDuration: '0.85s',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
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
@keyframes tide-stream-caret-blink {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
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

/** Soft block enter for complete (final) content that never word-streamed. */
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
    const el = ref.current;
    if (!el) return;
    if (el.dataset.tideBlockFaded === '1') return;
    el.dataset.tideBlockFaded = '1';

    el.style.display = 'block';
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
    void el.offsetWidth;
    el.style.transition =
      'opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';

    const onEnd = (ev: TransitionEvent) => {
      if (ev.target !== el || ev.propertyName !== 'opacity') return;
      el.style.transition = '';
      el.style.transform = '';
      el.removeEventListener('transitionend', onEnd);
    };
    el.addEventListener('transitionend', onEnd);
    return () => el.removeEventListener('transitionend', onEnd);
  }, []);

  return (
    <span ref={ref} className={className} data-stream-complete-fade="1">
      {children}
    </span>
  );
}

export const StreamFadeText = memo(function StreamFadeText({
  text,
  isStreaming = false,
  className,
  renderComplete,
}: StreamFadeTextProps) {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  // True if this instance ever rendered live deltas — used so a later finalize
  // does not re-run the complete-block fade after the user already watched words.
  const didStreamRef = useRef(false);
  if (isStreaming) didStreamRef.current = true;

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
    if (!didStreamRef.current && text) {
      return <CompleteBlockFade className={className}>{body}</CompleteBlockFade>;
    }
    return <>{body}</>;
  }

  // Live markdown / rich path: re-parse the full buffer each chunk so **bold**,
  // lists, and code look right while tokens arrive (no raw markers).
  if (renderComplete) {
    return (
      <span
        className={className}
        data-stream-fade="1"
        data-stream-live-md="1"
        style={{ display: 'block', wordBreak: 'break-word' }}
      >
        {renderComplete(text)}
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
