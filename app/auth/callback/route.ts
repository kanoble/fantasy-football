import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Where Google sends the user back to. Exchanges the PKCE code for a session
 * and forwards to whatever they originally asked for.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Supabase reports a refused sign-in here rather than by failing the
  // redirect. `disable_signup` is the expected cause: a league member who has
  // not been pre-created gets bounced at this step, having already succeeded
  // with Google, so saying so plainly is the difference between a two-minute
  // fix and an afternoon.
  const error = searchParams.get("error_description") ?? searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error)}`,
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      // The one moment that is unambiguously a sign-in, so it is recorded here
      // and nowhere else. Awaited, because a function on Vercel is not promised
      // any time after the redirect is sent; and never fatal, because a failed
      // note in the log must not cost a member the sign-in they just made. The
      // client's fetch already retries the fresh-token skew this exact request
      // is known for (lib/supabase/fetch-retry.ts).
      const { error: logError } = await supabase.rpc("record_access", {
        p_kind: "sign_in",
        p_user_agent: request.headers.get("user-agent"),
      });
      if (logError) console.warn(`record_access(sign_in) failed [${logError.code}]: ${logError.message}`);

      // `next` is attacker-controllable via the query string, so only a
      // same-site path is ever honoured — never an absolute URL.
      const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      return NextResponse.redirect(`${origin}${target}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}/login?error=missing_code`);
}
