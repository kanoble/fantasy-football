import type { Metadata } from "next";

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
        <p className="eyebrow">League analytics</p>
        <h1>Draft board</h1>
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
