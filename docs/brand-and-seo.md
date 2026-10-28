# Weave a World brand and search identity

| Item | English | 简体中文 |
| --- | --- | --- |
| Brand | Weave a World | 织个世界 |
| Slogan | Create a Life. Weave a World. | 创造生命，编织世界 |
| Category | A creative adventure and civilization simulator | 创造型冒险与虚拟文明模拟游戏 |
| Core value | Your creations change the world. | 你的创造，让世界发生改变 |

The canonical website origin is `https://weavea.world`. Brand copy lives in
`apps/web/lib/brand.ts`; public search metadata and structured data live in
`apps/web/lib/seo.ts`. Describe the game through creation, exploration and a
world changed by player creations. Distinguish the present simulation preview
from the longer-term virtual civilization direction. Do not invent player
counts, pricing, ratings, release dates or features.

## Search and sharing

- `/` and `/about` opt in to indexing. Each has explicit `?lang=en`,
  `?lang=zh-Hans`, `?lang=ko` and `?lang=ja` URLs with reciprocal `hreflang`
  links and a self-referencing canonical. French uses English landing copy.
- An explicit supported `lang` query takes precedence over the locale cookie
  and browser language. Language choices are real links; navigation updates
  the URL and server-rendered metadata together. French preferences resolve
  to English on the two game pages, including HTML language, canonical,
  sharing metadata and the selected language link. Application routes retain
  French support and the user's stored preference.
- Homepage search titles describe the game category; the Chinese title includes
  both brand names. About pages have their own descriptions and a single brand
  mention in the title. Canonicals omit tracking parameters; translated pages
  keep their own canonicals instead of canonicalizing to English.
- The root layout defaults to `noindex, nofollow` for account and workspace
  pages. Inherited marketing pages default to `noindex, follow`; the old sales,
  project-management and product-download pages are not advertised in the
  sitemap. Legal terms retain their existing license and operator identities.
- The sitemap contains the canonical language URLs for the two game pages,
  without invented modification timestamps. `robots.txt` advertises only this
  sitemap; the separate legacy documentation service is not claimed as part
  of the game sitemap.
- `robots.txt` blocks API, uploads and transport endpoints. Account, workspace
  and inherited product pages remain crawlable so search engines can read
  their `noindex` metadata; blocking a page in robots.txt cannot enforce
  removal from search results.
- JSON-LD connects each canonical `WebPage` or `AboutPage` to a `WebSite` and
  `VideoGame` with both brand names. The about page includes localized
  breadcrumbs. Page language, title and description agree with the HTML;
  the game schema does not infer supported gameplay languages from marketing
  translations. No price or review rating is asserted. Open Graph and Twitter
  titles, descriptions and image alternative text use the page locale. Cards use
  `apps/web/public/images/weave-a-world-social.png` (1200 × 630).
- Regenerate that image with
  `node apps/web/scripts/generate-brand-social.mjs`.

## Public page loading

`/` and `/about` render their copy, navigation and language links on the server.
Their layout does not mount the application shell. Application routes share
`apps/web/app/(application)/layout.tsx`; inherited product pages retain their
providers in `(landing)/(legacy)/layout.tsx`. Route groups do not change URLs.
The root 404 also reads its locale on the server without an application provider.

The small world dictionaries live in `apps/web/features/reach/i18n/`. The
homepage sends only the current locale's map labels to the interactive island.
The first map is server-rendered SVG from deterministic preview data and stays
visible until Canvas has drawn successfully. This keeps the hero visible when
JavaScript is delayed or Canvas is unavailable; the display labels distinguish
preview data, live data and a disconnected live snapshot.

The map loads its Canvas module on entering the viewport. Its isolated Query
cache requests snapshots every eight seconds and season information every
minute while visible, retaining the last valid snapshot on failure. Drawing
stops offscreen and in background tabs, runs at up to 24 fps normally, and uses
single redraws for reduced motion. Responses are schema-validated before use.
Live chronicles are displayed in an available source language; preview
chronicles and interface copy support all four marketing languages.

The world preview uses a hand-drawn cartographic vocabulary shared by its
server-rendered SVG poster, Canvas scene and creation portraits. Surface
contours are decorative and do not add terrain rules. The scene is cached
per snapshot and view; live animation composites that cache at up to 24 fps.
Reduced-motion and preview scenes redraw only when data, selection or size
changes. Observed movement trails retain at most eight positions for the
current creation; the renderer's path cache is bounded.

The explorer initially follows a living participant in the latest available
chronicle. Selecting a creation or event updates both the story and the map;
whole-world mode fits the complete world, including on narrow screens.
Chronicle navigation uses participant IDs or the supplied zero-based belt,
never names parsed from translated prose. A belt-only event highlights its
area without inventing a precise location. A new season resets selection.
Preview participants and translated names belong only to the labeled sample;
live names remain exactly as supplied by their creators. Mobile shows the
latest chronicle and offers an expansion for the next two entries. The create
link leads into the homepage's existing creation and agent-connection sections.

The inherited `/homepage` uses hashed build imports for its compressed WebP
hero artwork, avoiding a first-request image optimizer dependency. Agent
manifest discovery (`/.well-known/reach.json`) is forwarded to the configured
backend alongside the public world API.

## Production activation

Code changes do not configure DNS, certificates, reverse proxies or search
engine accounts. When activating the domain:

1. Serve the app over HTTPS at `weavea.world`; redirect `www.weavea.world` to
   the apex while preserving the path and query.
2. Set the deployment's `FRONTEND_ORIGIN`, `AURO_APP_URL`, `AURO_PUBLIC_URL`
   and allowed CORS origins to the new origin as appropriate. Update OAuth
   redirect registrations and any channel callbacks that use the public URL.
   Keep internal package names, auth cookies and API identifiers stable.
3. Check the English and Chinese homepage and about-page HTML as a crawler,
   including canonical, language links, title, description and share image.
   Check that `/login` and workspace routes still return `noindex`.
4. Verify domain ownership in Google Search Console, Bing Webmaster Tools and
   Baidu Search Resource Platform as applicable. Optional Web runtime variables
   `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` and
   `BAIDU_SITE_VERIFICATION` accept each provider's HTML meta **content value**,
   not the full tag. Empty values emit no verification tag. The root metadata
   reads them at request time, so a prebuilt image can receive its deployment's
   tokens without rebuilding. The self-host Compose frontend passes these
   variables through. Domain/DNS verification remains a provider-side option.
5. Submit `https://weavea.world/sitemap.xml` in the verified search-engine
   accounts. Inspect the canonical
   language URLs after deployment. Configure redirects from an old domain
   only if this deployment owns it and the migration scope is confirmed.

## Verification

Run `pnpm --filter @auro/web test` for metadata, language-routing and discovery
regressions, and Web typecheck, lint and production build for framework wiring.
Against the built Web app, run
`PLAYWRIGHT_BASE_URL=http://localhost:<port> pnpm exec playwright test e2e/seo.spec.ts`.
The SEO suite uses JavaScript-disabled Baidu crawler requests for English and
Chinese pages with conflicting cookies and browser language, checks clean
canonicals and reciprocal `hreflang`, validates JSON-LD and social metadata,
and verifies noindex pages, real 404s, the sitemap and the share image.

References: [Google multilingual URLs](https://developers.google.com/search/docs/specialty/international/localized-versions),
[Google site names](https://developers.google.com/search/docs/appearance/site-names),
[Google robots.txt limitations](https://developers.google.com/search/docs/crawling-indexing/robots/intro),
[Schema.org VideoGame](https://schema.org/VideoGame),
[Next.js metadata](https://nextjs.org/docs/app/getting-started/metadata-and-og-images).
