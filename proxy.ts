import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Refreshes the Supabase session on every request and keeps unauthenticated
 * visitors off every route but `/login`.
 *
 * This is a convenience barrier, not the security one. The data is protected by
 * RLS in the database: a JWT whose email is not in `league_members` reads zero
 * rows from every table, whether or not it ever reaches a page. Deleting this
 * file would make the app ugly, not unsafe.
 *
 * Next 16 calls this `proxy.ts`; `middleware.ts` is the deprecated spelling of
 * the same hook.
 */
export async function proxy(request: NextRequest) {
  // Must start from the incoming request, and every cookie the client sets must
  // land on BOTH this request (so the handler below sees the refreshed session)
  // and the response (so the browser keeps it). Returning a fresh
  // NextResponse.next() later in the function would silently drop the refreshed
  // token and log the user out on a random page load.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() and not getSession(): getSession reads the cookie without
  // verifying it, so it will happily report a user from a forged or expired
  // token. getUser revalidates against the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/auth/");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Come back to whatever was asked for once signed in.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own assets, static files, and `api/`.
    //
    // Excluding `api/` is load-bearing, not tidiness. That directory is not a
    // Next.js route — it is the Vercel Python function `api/cron/refresh.py`,
    // and the daily cron calls it with no session at all. Without this the
    // proxy answers the cron with a 307 to /login, the refresh never runs, and
    // the failure is silent: Vercel sees a 2xx-ish redirect, `pipeline_runs`
    // gets no row, and the board quietly serves data that stops moving.
    // Verified against a preview deployment, where it did exactly that.
    //
    // The endpoint is not left unprotected by this. It authenticates itself
    // with CRON_SECRET and fails closed (`_authorized()`), which is the right
    // barrier for a machine caller — a cookie session is meaningless to it.
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
