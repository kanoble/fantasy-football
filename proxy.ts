import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Refreshes the Supabase session on every request, keeps unauthenticated
 * visitors off every route but `/login`, and notes that a member was here.
 *
 * This is a convenience barrier, not the security one. The data is protected by
 * RLS in the database: a JWT whose email is not in `league_members` reads zero
 * rows from every table, whether or not it ever reaches a page. Deleting this
 * file would make the app ugly and the access log quiet, not unsafe.
 *
 * Next 16 calls this `proxy.ts`; `middleware.ts` is the deprecated spelling of
 * the same hook.
 */

/**
 * How often one browser is written to the access log: once per this window,
 * held in a cookie so the common case costs no round trip at all. Ten minutes
 * because "last seen" is read by a person and a person does not need it closer
 * than that; and because this runs on every navigation, prefetch included, of
 * every page — the one place in the app where an extra query is paid for by
 * everything.
 */
const SEEN_COOKIE = "ff_seen";
const SEEN_WINDOW_S = 600;

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
    // Capture the query before clearing it. `/compare?ids=a,b` is a shareable
    // link, so the ids have to survive the round trip through Google — and
    // cloning the request URL carries them onto /login itself, where they mean
    // nothing, unless the search is reset first.
    const target = pathname + url.search;
    url.pathname = "/login";
    url.search = "";
    // Come back to whatever was asked for once signed in.
    if (target !== "/") url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Note the visit, at most once per window per browser. The cookie is the
  // throttle for the honest path — a browser that loads twenty pages in ten
  // minutes writes one row; `record_access()` itself refuses a second row inside
  // a minute for anyone who calls it directly. Prefetches are skipped: hovering
  // a link is not being here. And nothing here may fail the request — a log
  // that cannot be written is a warning, not a page a member cannot open.
  const prefetch =
    request.headers.get("next-router-prefetch") != null ||
    request.headers.get("purpose") === "prefetch";
  const userAgent = request.headers.get("user-agent");

  // A player page is also noted by path, every time and with no cookie: this
  // is the app's own count of the one thing Vercel meters and will not tell it
  // — image transformations, bounded above by distinct players opened in a
  // month (see next.config.ts and migration 0012). A reload inside a minute is
  // one row; `record_access()` sees to that.
  const playerPage = /^\/player\/[^/]+$/.test(pathname);
  if (user && !prefetch && playerPage) {
    const { error } = await supabase.rpc("record_access", {
      p_kind: "view",
      p_user_agent: userAgent,
      p_path: pathname,
    });
    if (error) console.warn(`record_access(view) failed [${error.code}]: ${error.message}`);
  }

  if (user && !isPublic && !prefetch && !request.cookies.has(SEEN_COOKIE)) {
    const { error } = await supabase.rpc("record_access", {
      p_kind: "visit",
      p_user_agent: userAgent,
    });
    if (error) {
      // Left unset so the next request tries again — the first request after
      // sign-in can be refused for a token skew (see fetch-retry.ts), and the
      // second is normally fine.
      console.warn(`record_access(visit) failed [${error.code}]: ${error.message}`);
    } else {
      response.cookies.set(SEEN_COOKIE, "1", {
        maxAge: SEEN_WINDOW_S,
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
      });
    }
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
    // `robots.txt` is excluded for the same class of reason. It is generated by
    // `app/robots.ts`, which makes it a route like any other, so without this
    // the gate answers every crawler with a 307 to /login and the file is never
    // read. A `Disallow` nobody can fetch is not a `Disallow`. It exposes
    // nothing: the whole content is "stay out".
    //
    // The endpoint is not left unprotected by this. It authenticates itself
    // with CRON_SECRET and fails closed (`_authorized()`), which is the right
    // barrier for a machine caller — a cookie session is meaningless to it.
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
