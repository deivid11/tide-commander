import React, { useCallback, useEffect, useRef, useState } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 8;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Image viewport with wheel/trackpad zoom, touch pinch zoom, and drag panning. */
export function ZoomableImage({ src, alt, className = '' }: ZoomableImageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const dragStartRef = useRef<{ point: Point; transform: Transform } | null>(null);
  const pinchStartRef = useRef<{
    distance: number;
    midpoint: Point;
    transform: Transform;
  } | null>(null);
  const [transform, setTransformState] = useState<Transform>(transformRef.current);
  const [isDragging, setIsDragging] = useState(false);

  const setTransform = useCallback((next: Transform) => {
    const normalized = next.scale <= MIN_SCALE
      ? { scale: MIN_SCALE, x: 0, y: 0 }
      : { ...next, scale: clampScale(next.scale) };
    transformRef.current = normalized;
    setTransformState(normalized);
  }, []);

  const reset = useCallback(() => {
    pointersRef.current.clear();
    dragStartRef.current = null;
    pinchStartRef.current = null;
    setIsDragging(false);
    setTransform({ scale: 1, x: 0, y: 0 });
  }, [setTransform]);

  useEffect(() => reset(), [src, reset]);

  const zoomAt = useCallback((requestedScale: number, clientPoint?: Point) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const current = transformRef.current;
    const nextScale = clampScale(requestedScale);
    if (nextScale <= MIN_SCALE) {
      setTransform({ scale: MIN_SCALE, x: 0, y: 0 });
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const focal = clientPoint ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const focalX = focal.x - (rect.left + rect.width / 2);
    const focalY = focal.y - (rect.top + rect.height / 2);
    const ratio = nextScale / current.scale;
    setTransform({
      scale: nextScale,
      x: focalX - (focalX - current.x) * ratio,
      y: focalY - (focalY - current.y) * ratio,
    });
  }, [setTransform]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // A native non-passive listener guarantees that the surrounding modal does
    // not scroll at the same time as the image zooms.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      const factor = Math.exp(-delta * 0.002);
      zoomAt(transformRef.current.scale * factor, { x: event.clientX, y: event.clientY });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [zoomAt]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];

    if (points.length >= 2) {
      pinchStartRef.current = {
        distance: Math.max(1, distance(points[0], points[1])),
        midpoint: midpoint(points[0], points[1]),
        transform: transformRef.current,
      };
      dragStartRef.current = null;
    } else {
      dragStartRef.current = { point: points[0], transform: transformRef.current };
    }
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];

    if (points.length >= 2 && pinchStartRef.current && viewportRef.current) {
      const start = pinchStartRef.current;
      const currentMidpoint = midpoint(points[0], points[1]);
      const nextScale = clampScale(start.transform.scale * distance(points[0], points[1]) / start.distance);
      const ratio = nextScale / start.transform.scale;
      const rect = viewportRef.current.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      setTransform({
        scale: nextScale,
        x: currentMidpoint.x - center.x - (start.midpoint.x - center.x - start.transform.x) * ratio,
        y: currentMidpoint.y - center.y - (start.midpoint.y - center.y - start.transform.y) * ratio,
      });
      return;
    }

    const dragStart = dragStartRef.current;
    if (points.length === 1 && dragStart && dragStart.transform.scale > MIN_SCALE) {
      setTransform({
        ...dragStart.transform,
        x: dragStart.transform.x + points[0].x - dragStart.point.x,
        y: dragStart.transform.y + points[0].y - dragStart.point.y,
      });
    }
  }, [setTransform]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const points = [...pointersRef.current.values()];
    pinchStartRef.current = null;
    dragStartRef.current = points.length === 1
      ? { point: points[0], transform: transformRef.current }
      : null;
    setIsDragging(points.length > 0);
  }, []);

  return (
    <div
      ref={viewportRef}
      className={`zoomable-image-viewport${isDragging ? ' dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={reset}
      title="Pinch or scroll to zoom; drag to pan; double-click to reset"
    >
      <img
        src={src}
        alt={alt}
        className={`file-viewer-image ${className}`.trim()}
        draggable={false}
        style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }}
      />
      <div className="zoomable-image-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => zoomAt(transform.scale / 1.25)} aria-label="Zoom out">−</button>
        <button type="button" className="zoomable-image-level" onClick={reset} aria-label="Reset zoom">
          {Math.round(transform.scale * 100)}%
        </button>
        <button type="button" onClick={() => zoomAt(transform.scale * 1.25)} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
