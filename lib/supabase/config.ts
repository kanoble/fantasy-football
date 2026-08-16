/**
 * The only two Supabase values the browser is ever allowed to see.
 *
 * The service-role key bypasses RLS entirely and is the single thing standing
 * between the whole database and the internet. It must never be imported into
 * anything that can end up in a client bundle, which is an easy accident in
 * Next.js — so it is not read here at all, and nothing in `lib/supabase/`
 * references it. The Python refresh job is the only consumer of that key.
 */

// The integration provisions both names: ANON_KEY is the long-standing one,
// PUBLISHABLE_KEY is its replacement. Accepting either means a key rotation
// that switches naming does not take the app down.
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!url || !key) {
  // Failing at import time is deliberate. A missing key otherwise surfaces as
  // "no rows", which is indistinguishable from "you are not on the allowlist"
  // and sends you debugging RLS instead of the environment.
  throw new Error(
    "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) must both be set. " +
      "Locally these come from `vercel env pull`.",
  );
}

export const SUPABASE_URL: string = url;
export const SUPABASE_ANON_KEY: string = key;
