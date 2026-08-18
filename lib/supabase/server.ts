import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { withFreshTokenRetry } from "./fetch-retry";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Reads the session from cookies, so every query runs as the signed-in user and
 * the allowlist policies from migration 0002 apply. There is no elevated path
 * here by design: the app has exactly the reach of the person using it.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // One retry for a token PostgREST thinks is from the future — the first
    // request after sign-in, when two Supabase clocks disagree by a second.
    // See fetch-retry.ts for the incident and why the seam is here.
    global: { fetch: withFreshTokenRetry(fetch) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Refreshing the session is
          // the proxy's job (see proxy.ts), which runs first and does persist
          // them, so this is genuinely nothing to handle rather than a
          // swallowed error.
        }
      },
    },
  });
}
