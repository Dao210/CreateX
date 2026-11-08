// @ts-check
/* global window, document, navigator, matchMedia, performance, IntersectionObserver, HTMLElement, queueMicrotask */
// This dependency-free source also runs inline before React hydrates the Hero.
(() => {
  if (!globalThis.document) return;
  const host = /** @type {Window & { auroGameplay?: import('./gameplay-runtime-types').GameplayRuntime }} */ (window);
  if (!host.auroGameplay) {
    const players = new WeakMap();
    host.auroGameplay = { mount };

    /** @param {HTMLElement} frame */
    function mount(frame) {
      const existing = players.get(frame);
      if (existing) return existing;
      const video = /** @type {HTMLVideoElement} */ (frame.querySelector("video"));
      video.muted = true;
      const button = /** @type {HTMLButtonElement} */ (frame.querySelector("button"));
      const error = /** @type {HTMLElement} */ (frame.querySelector('[role="status"]'));
      const motion = matchMedia("(prefers-reduced-motion: reduce)");
      const connection = /** @type {Navigator & { connection?: EventTarget & { saveData?: boolean } }} */ (navigator).connection;
      let visible = false, failed = false, playing = false, destroyed = false;
      /** @type {boolean | null} */
      let manual = null;
      let requested = false;

      function render() {
        frame.dataset.playing = String(playing);
        button.setAttribute("aria-label", (playing ? button.dataset.pauseLabel : button.dataset.playLabel) || "");
        error.hidden = !failed;
      }
      function sync() {
        const wanted = manual ?? (!motion.matches && !connection?.saveData);
        if (destroyed || !visible || document.visibilityState === "hidden" || !wanted || failed) {
          if (!destroyed && (!visible || !wanted || failed)) document.documentElement.setAttribute("data-gameplay-ready", "");
          if (!video.paused) video.pause();
          return;
        }
        if (!video.paused) return;
        if (!requested) {
          requested = true;
          if (matchMedia("(max-width: 767px)").matches && video.dataset.mobileSrc) video.src = video.dataset.mobileSrc;
          performance.mark("auro-gameplay-request", { detail: { game: frame.dataset.gameplay } });
          video.requestVideoFrameCallback?.(() => {
            if (!destroyed) performance.mark("auro-gameplay-first-frame", { detail: { game: frame.dataset.gameplay } });
          });
        }
        void video.play().catch(() => {
          if (!destroyed && video.paused) { document.documentElement.setAttribute("data-gameplay-ready", ""); playing = false; render(); }
        });
      }
      function onPlaying() { document.documentElement.setAttribute("data-gameplay-ready", ""); playing = true; render(); }
      function onPause() { playing = false; render(); }
      function onError() { document.documentElement.setAttribute("data-gameplay-ready", ""); failed = true; playing = false; render(); }
      function toggle() {
        manual = !playing;
        if (manual && failed) { failed = false; video.load(); render(); }
        sync();
      }
      const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; sync(); }, { threshold: .1 });
      observer.observe(frame);
      video.addEventListener("playing", onPlaying);
      video.addEventListener("pause", onPause);
      video.addEventListener("error", onError);
      button.addEventListener("click", toggle);
      motion.addEventListener("change", sync);
      connection?.addEventListener?.("change", sync);
      document.addEventListener("visibilitychange", sync);
      button.disabled = false;
      render();
      const player = { destroy() {
        destroyed = true;
        observer.disconnect();
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("pause", onPause);
        video.removeEventListener("error", onError);
        button.removeEventListener("click", toggle);
        motion.removeEventListener("change", sync);
        connection?.removeEventListener?.("change", sync);
        document.removeEventListener("visibilitychange", sync);
        video.pause();
        players.delete(frame);
        // StrictMode may reconnect the same DOM node before the next microtask.
        queueMicrotask(() => {
          if (!frame.isConnected) {
            video.removeAttribute("src");
            video.load();
          }
        });
      } };
      players.set(frame, player);
      return player;
    }
  }
  document.querySelectorAll("[data-gameplay]").forEach(frame => {
    if (frame instanceof HTMLElement) host.auroGameplay?.mount(frame);
  });
})();
