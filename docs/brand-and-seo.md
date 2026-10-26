# Weave a World brand and search identity

| Item | English | 简体中文 |
| --- | --- | --- |
| Brand | Weave a World | 织个世界 |
| Slogan | Create a Life. Weave a World. | 创造生命，编织世界 |
| Category | Creative adventure & virtual civilization simulation | 创造型冒险与虚拟文明模拟游戏 |
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
  the URL and server-rendered metadata together.
- The root layout defaults to `noindex, nofollow` for account and workspace
  pages. Inherited marketing pages default to `noindex, follow`; the old sales,
  project-management and product-download pages are not advertised in the
  sitemap. Legal terms retain their existing license and operator identities.
- The sitemap contains the canonical language URLs for the two game pages,
  without invented modification timestamps. `robots.txt` advertises only this
  sitemap; the separate legacy documentation service is not claimed as part
  of the game sitemap.
- Homepage JSON-LD identifies a `WebSite` and `VideoGame` with both brand names.
  No price or review rating is asserted. Open Graph and Twitter cards use
  `apps/web/public/images/weave-a-world-social.png` (1200 × 630).
- Regenerate that image with
  `node apps/web/scripts/generate-brand-social.mjs`.

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
4. Verify domain ownership in Google Search Console and Bing Webmaster Tools,
   then submit `https://weavea.world/sitemap.xml`. Inspect the canonical
   language URLs after deployment. Configure redirects from an old domain
   only if this deployment owns it and the migration scope is confirmed.

References: [Google multilingual URLs](https://developers.google.com/search/docs/specialty/international/localized-versions),
[Google site names](https://developers.google.com/search/docs/appearance/site-names),
[Schema.org VideoGame](https://schema.org/VideoGame),
[Next.js metadata](https://nextjs.org/docs/app/getting-started/metadata-and-og-images).
