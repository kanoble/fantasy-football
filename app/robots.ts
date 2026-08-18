import type { MetadataRoute } from "next";

/**
 * `Disallow: /` for every crawler, and no sitemap.
 *
 * This is the third of three layers, and the only one that acts *before* a
 * crawler fetches anything. The other two are already in place: `proxy.ts`
 * bounces every unauthenticated request to /login, and the root layout sends
 * `robots: { index: false, follow: false }` — but a meta tag only works on a
 * page the crawler has already decided to request, and only if that page is
 * HTML. This file is read first and covers the whole origin.
 *
 * No `sitemap` key, deliberately. A sitemap is an invitation, and there is
 * nothing to invite anyone to: the one page a signed-out visitor can reach is
 * /login, which is a button.
 *
 * None of this is access control. `robots.txt` is a request — honored by the
 * major engines, ignored by anything that means harm. The barrier is the proxy
 * and, under it, RLS. This only keeps the league out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
