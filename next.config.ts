import type { NextConfig } from "next";

// The Next.js app shares this repo root with the Python pipeline (`src/ff/`,
// `pyproject.toml`) and the Vercel Python cron function (`api/cron/refresh.py`).
// That combination was tested before committing to it: Vercel detects `nextjs`
// as the framework, serves the app, AND still builds the file-based Python
// function and registers its cron. The "framework preset takes precedence over
// file-based functions" rule applies only to Python presets.
//
// Nothing here may add a root `api/` route: that directory belongs to the
// Python function. Next.js routes live under `app/`.
const nextConfig: NextConfig = {
  typedRoutes: true,

  // Player headshots, served from the NFL's own CDN and stored in
  // player_index.headshot_url by the daily refresh.
  //
  // Vercel bills image optimization per cache MISS, not per image in the
  // project, and Hobby includes 5,000 transformations a month. A portrait
  // appears on /player/[id] only — one player per page view — so the ceiling
  // is "distinct players opened in a month", and twelve relatives are not
  // going to open five thousand of them.
  //
  // That arithmetic depends entirely on WHERE portraits appear. One on the
  // board would be 923 transformations in a single page view and would spend
  // the month in five refreshes. Headshots stay off the board and off the
  // pickers; if that ever changes, this comment is the thing to re-read first.
  //
  // Overrun fails soft rather than breaking the app: new images return 402 and
  // Next renders the `alt` text, already-cached ones keep working, and Hobby is
  // never charged for the excess.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "static.www.nfl.com", pathname: "/image/**" },
    ],
    // One width and one quality, so each player costs exactly one cache key
    // rather than one per breakpoint. The portrait is a fixed 96px square in
    // the page head; 192 is that at 2x for retina and nothing renders larger.
    imageSizes: [96, 192],
    // 31 days. These are studio portraits that change once a year at most.
    minimumCacheTTL: 2_678_400,
  },
};

export default nextConfig;
