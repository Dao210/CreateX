import type { MetadataRoute } from "next";

/**
 * Web app manifest — what makes the mobile web app installable and lets it run
 * in its own window instead of a browser tab.
 *
 * `start_url` is deliberately NOT "/". The official marketing hosts keep the
 * root path on the public site even for a signed-in session (see
 * `isOfficialMarketingHost` in proxy.ts), so an installed app pointed at "/"
 * would open the landing page. "/inbox" is one of `LEGACY_ROUTE_SEGMENTS`,
 * which proxy.ts resolves per session: signed in with a known workspace it
 * lands on that workspace's inbox, signed in without one it lands on /login
 * (which resolves against the workspace list), and signed out it lands on
 * /login too. All three are pinned in manifest.test.ts, because a launcher
 * icon has no URL bar to recover from a wrong destination.
 *
 * The icons under /icons are rasterised from the two source SVGs, both of which
 * carry the same outline (the mark traced into
 * `features/landing/components/brand-mark.tsx`). `public/favicon.svg` is the
 * artwork at 66% inside a rounded tile; `public/icons/icon.svg` is the same
 * mark at 56% on a full-bleed square, because Android crops maskable icons to
 * the launcher's shape and only the middle ~80% is guaranteed to survive.
 *
 * To regenerate after a brand change, run from apps/web/public:
 *
 *   sips -s format png --resampleHeightWidth 192 192 favicon.svg --out icons/icon-192.png
 *   sips -s format png --resampleHeightWidth 512 512 favicon.svg --out icons/icon-512.png
 *   sips -s format png --resampleHeightWidth 512 512 icons/icon.svg --out icons/icon-maskable-512.png
 *   sips -s format png --resampleHeightWidth 180 180 icons/icon.svg --out icons/apple-touch-icon.png
 */

/** Launch path. Exported so manifest.test.ts can run it through the proxy. */
export const PWA_START_URL = "/inbox";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Auro",
    short_name: "Auro",
    description:
      "Assign tasks to coding agents, track progress, and keep your team's work in one place.",
    start_url: PWA_START_URL,
    scope: "/",
    display: "standalone",
    // Splash-screen colours. The runtime status bar is driven by the
    // per-scheme `<meta name="theme-color">` pair in app/layout.tsx, which the
    // manifest cannot express — these are the pre-launch fallback only.
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Long-press actions on the installed launcher icon. These are legacy
    // segments, so they resolve to the last workspace the same way start_url
    // does instead of needing a slug the manifest cannot know.
    shortcuts: [
      { name: "Inbox", url: "/inbox" },
    ],
  };
}
