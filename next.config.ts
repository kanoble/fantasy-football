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
      // The signed-in member's Google profile photo, in the app bar.
      //
      // It is rendered `unoptimized`, deliberately, and the paragraph above is
      // why: that arithmetic turns on WHERE an image appears, and unlike a
      // portrait this one is in the bar on every view of every screen. Google
      // already serves it as a small square from its own CDN at a size its own
      // URL asks for, so a transformation would spend the metered thing to make
      // a 28px circle no smaller.
      //
      // Listed here even so. `user_metadata` is provider-written but
      // user-editable through the Supabase auth API, so this is one half of a
      // pair that says which hosts a photo may come from — `lib/viewer.ts`
      // holds the other and checks the URL before it is ever rendered.
      { protocol: "https", hostname: "**.googleusercontent.com", pathname: "/**" },
    ],
    // One width and one quality, so each player costs exactly one cache key
    // rather than one per breakpoint. The portrait is a fixed 96px square in
    // the page head; 192 is that at 2x for retina and nothing renders larger.
    imageSizes: [96, 192],
    // Declared rather than left to default, because "one quality" is the whole
    // argument above and a default is not a constraint. A second entry here
    // doubles the cache keys per player, and therefore the transformations.
    // Next serves the closest allowed value when a component asks for something
    // else, so a mismatch is silent apart from a build-time warning.
    qualities: [75],
    // 31 days, and this is what makes the arithmetic above true rather than
    // optimistic. Transformations are billed per cache MISS *and STALE*, so the
    // TTL is what decides whether a second view of the same player costs
    // anything: at 31 days it cannot go stale inside a billing month, so the
    // ceiling really is "distinct players opened", not "page views". These are
    // studio portraits that change once a year at most.
    minimumCacheTTL: 2_678_400,
  },
};

export default nextConfig;
