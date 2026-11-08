# Gameplay recordings

Run `corepack pnpm exec node scripts/marketing/capture-gameplay.mjs` from the
repository root with Playwright Chromium, ffmpeg (H.264) and cwebp available. Pass
`tank`, `fish` or `resident` to recapture just that scene after the initial capture.

The capture harness imports the actual Tank rules/painter, Fish geometry,
swimming and reef renderer, and Town simulation/3D runtime. It records local,
seeded examples without accounts, APIs, model calls or persisted game state.
Town ticks advance at an explicitly accelerated pace, labeled on the homepage.
Tank movement/fire are scripted player inputs through the normal game engine.

Generated, silent H.264 clips and WebP posters are content-hashed under
`apps/web/public/media/gameplay/`; the script writes their manifest to
`apps/web/features/play/media.json`. Review all three clips after recapturing,
and remove superseded hashes only after updating the manifest.

Resident models, animation and grass textures retain the CC0 sources documented
in `packages/views/agent-life/scene/assets/README.md`. The homepage ships media,
not the renderers, source models, simulation fixtures or product providers.

Each recording has a 960×600 desktop clip and a 640×400 phone clip. The native
controller selects one version before playback, with the same duration,
framing and gameplay. Posters retain the full resolution.

## First-frame performance

After starting the managed Web environment in production mode, run:

```sh
corepack pnpm exec node scripts/marketing/measure-startup.mjs --url 'http://localhost:13440/?lang=zh-Hans' --runs 3 --output /tmp/gameplay-startup.json
```

This measures cold mobile loads with the same actual network/CPU throttling as
Lighthouse mobile, recording poster LCP, media load start and the first frame
sent to the compositor separately. It blocks diagnostic analytics collection.
The URL and 1–20 samples are configurable; it does not start services.

The native gameplay controller is in `apps/web/features/play/gameplay-runtime.js`.
Webpack embeds that canonical source inline through `?source`, allowing playback
and pause before React hydrates. The React bridge adopts the existing controller
and cleans it up on unmount. Keep reduced motion, data saving and offscreen pause
working in both phases. Browser regressions include deliberately delayed React
chunks to exercise this handoff.

While the initial clip buffers, public styles use next/font's metric-adjusted
local fallback faces. Playback (or a non-autoplay/error state) releases the
normal font stack through `data-gameplay-ready` on the document. Keep the locale
fallback order and avoid introducing a layout shift at this transition.
