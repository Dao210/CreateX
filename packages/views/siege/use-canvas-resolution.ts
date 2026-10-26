import { useEffect, type RefObject } from "react";

/** Bound fill cost on narrow screens while keeping world coordinates unchanged. */
export function useCanvasResolution(canvas: RefObject<HTMLCanvasElement | null>, aspect: number, redraw: RefObject<(() => void) | null>) {
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const resize = () => {
      const width = Math.max(1, Math.round(Math.min(1200, element.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2))));
      const height = Math.round(width / aspect);
      if (element.width === width && element.height === height) return;
      element.width = width; element.height = height; redraw.current?.();
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, [canvas, aspect, redraw]);
}
