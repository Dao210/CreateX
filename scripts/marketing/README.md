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
