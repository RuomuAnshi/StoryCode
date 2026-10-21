import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizableOptions {
  min: number;
  max: number;
  initial: number;
  /** Which side the panel sits on, so dragging feels natural. */
  edge: 'left' | 'right';
  storageKey?: string;
}

/**
 * Drag-to-resize for a side panel.
 *
 * The width is persisted so the author's layout survives a restart. Dragging
 * uses pointer capture, so the handle keeps tracking even when the pointer
 * passes over the editor or leaves the window.
 */
export function useResizable({ min, max, initial, edge, storageKey }: ResizableOptions) {
  const [width, setWidth] = useState<number>(() => {
    if (!storageKey || typeof localStorage === 'undefined') return initial;
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored >= min && stored <= max ? stored : initial;
  });
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, width: initial });

  const persist = useCallback(
    (value: number) => {
      if (storageKey && typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, String(Math.round(value)));
      }
    },
    [storageKey],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      startRef.current = { x: event.clientX, width };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const delta = event.clientX - startRef.current.x;
      const next =
        edge === 'left' ? startRef.current.width + delta : startRef.current.width - delta;
      setWidth(Math.min(max, Math.max(min, next)));
    };
    const onUp = () => {
      setDragging(false);
      setWidth((current) => {
        persist(current);
        return current;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    // Prevent text selection and cursor flicker while dragging.
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [dragging, edge, max, min, persist]);

  return { width, dragging, onPointerDown, setWidth };
}
