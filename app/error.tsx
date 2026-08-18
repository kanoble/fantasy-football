"use client";

import { useEffect } from "react";

import { LEAGUE_NAME } from "@/lib/board";
import { Crest } from "./chrome";

/**
 * What a member sees when a page fails to render, instead of Next's bare
 * "This page couldn't load".
 *
 * That default is what the first production sign-in produced on 2026-08-18,
 * and it is the worst of both worlds: it names nothing, and it looks like the
 * app is down rather than one request having failed. A reload fixed it, but a
 * reader has no way to know that from the page, so the realistic next step for
 * a family member is a text message.
 *
 * This card says the truthful thing — the app is fine, this one page was not
 * — and offers the reload as a button. It is deliberately the same card as
 * `/login`, because that is the one screen every member has already seen, so
 * a failure reads as the app talking rather than the browser.
 *
 * What it does *not* do is say why. In production Next strips a server error's
 * message before it reaches this component and forwards only a `digest`, so
 * there is nothing to branch on here — a clock-skewed token and a missing
 * migration arrive looking identical. That is why the one failure this app
 * knows how to recover from is retried on the server (`lib/supabase/
 * fetch-retry.ts`), where the code is still visible, and never gets this far.
 * Anything that does get this far is not something a wait would have fixed.
 *
 * The digest goes to the console for the same reason `game-log.tsx` sends its
 * full diagnosis there: it is the key that matches the Vercel function log,
 * which is the only place the actual message lives.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="gate">
      <div className="gate-card" role="alert">
        <Crest size={46} />
        <p className="eyebrow">Something went wrong</p>
        <h1>{LEAGUE_NAME}</h1>
        <p>
          This page did not load. The app is up — the request behind this one
          page failed. Try again usually fixes it.
        </p>

        <button className="gbtn" type="button" onClick={() => retry()}>
          Try again
        </button>

        {error.digest ? (
          <p className="gate-note">
            If it keeps happening, tell Kevin and quote{" "}
            <code>{error.digest}</code>. That number finds the exact failure in
            the server log.
          </p>
        ) : null}
      </div>
    </main>
  );
}
