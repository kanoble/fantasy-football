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
};

export default nextConfig;
