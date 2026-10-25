import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Keep the live Canvas mounted while the browser moves its owner into the top layer. */
export function useTankFullscreen(target: RefObject<HTMLElement | null>, onExit: () => void) {
  const [fullscreen, setFullscreen] = useState(false);
  const [supported, setSupported] = useState(false);
  const [failed, setFailed] = useState(false);
  const exiting = useRef(onExit);
  useEffect(() => { exiting.current = onExit; }, [onExit]);

  const toggle = useCallback(async () => {
    const element = target.current;
    if (!element) return;
    setFailed(false);
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch { setFailed(true); }
  }, [target]);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    setSupported(typeof element.requestFullscreen === "function" && document.fullscreenEnabled !== false);
    let wasFullscreen = document.fullscreenElement === element;
    const change = () => {
      const active = document.fullscreenElement === element;
      setFullscreen(active);
      if (wasFullscreen && !active) exiting.current();
      wasFullscreen = active;
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.code === "Escape" && document.fullscreenElement === element) {
        event.preventDefault(); event.stopImmediatePropagation(); void toggle(); return;
      }
      if (event.code !== "KeyF" || !element.contains(document.activeElement)) return;
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)) return;
      if (typeof element.requestFullscreen !== "function" || document.fullscreenEnabled === false) return;
      event.preventDefault(); event.stopImmediatePropagation(); void toggle();
    };
    document.addEventListener("fullscreenchange", change);
    window.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      window.removeEventListener("keydown", keydown, true);
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, [target, toggle]);

  return { fullscreen, supported, failed, toggle };
}
