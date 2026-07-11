/**
 * Word-by-word fade-in for live assistant / thinking streams.
 *
 * Self-contained: injects @keyframes once and applies animation via inline
 * styles so the effect works even if SCSS is stale, purged, or overridden.
 */

import React, { memo, useEffect, useRef, useState } from 'react';

export interface StreamFadeTextProps {
  text: string;
  isStreaming?: boolean;
  className?: string;
  renderComplete?: (text: string) => React.ReactNode;
}

const STYLE_ID = 'tide-stream-fade-keyframes-v2';

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

export const StreamFadeText = memo(function StreamFadeText({
  text,
  isStreaming = false,
  className,
  renderComplete,
}: StreamFadeTextProps) {
  // Inject keyframes on mount (once globally).
  useEffect(() => {
    ensureKeyframes();
  }, []);

  // Previous full text after the last committed render.
  const prevFullRef = useRef('');
  // Generation counter so React remounts FadeWords and restarts CSS animations.
  const genRef = useRef(0);
  const [paint, setPaint] = useState<{ solid: string; fade: string | null; gen: number }>({
    solid: '',
    fade: null,
    gen: 0,
  });

  // null = never synced (first paint). setState during render is the
  // React-recommended "adjust state when props change" pattern.
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
      // Commit full text as the base for the *next* delta.
      prevFullRef.current = text;
    }
  }

  if (!isStreaming) {
    if (renderComplete) {
      return <>{renderComplete(text)}</>;
    }
    return <span className={className}>{text}</span>;
  }

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
      <span
        aria-hidden
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
    </span>
  );
});
