import type { Metadata } from "next";

import { LEAGUE_FOUNDED, LEAGUE_NAME } from "@/lib/board";
import { Crest } from "../chrome";
import { SignInButton } from "./sign-in-button";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <main className="gate">
      <div className="gate-card">
        {/* The one screen every member sees before they see anything else, so
            it is the one place the crest is set large. */}
        <Crest size={46} />
        <p className="eyebrow">
          Est. {LEAGUE_FOUNDED} · League analytics
        </p>
        <h1>{LEAGUE_NAME}</h1>
        <p>
          Every NFL week since 2016, scored under this league&rsquo;s own rules.
          Sign in with the Google account on the league allowlist.
        </p>

        {error ? (
          <div className="gate-error" role="alert">
            {error === "missing_code"
              ? "Google returned without an authorisation code. Try again."
              : error}
          </div>
        ) : null}

        <SignInButton next={next} />

        <p className="gate-note">
          Access is limited to the twelve members of one family league. Accounts
          cannot be self-created — an address has to be added before its first
          sign-in.
        </p>
      </div>
    </main>
  );
}
