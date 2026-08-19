import type { Metadata } from "next";
import Link from "next/link";

import { fetchAdmin, fetchViewer } from "@/lib/queries";
import { AppBar, Crest, PageHead } from "../chrome";
import { FreeTiers, Members, NotMeasured, Refresh } from "./panels";

export const metadata: Metadata = { title: "Admin" };

/**
 * `/admin` — who has been in, and how close the ceilings are.
 *
 * Asked for on 2026-08-18, the day the allowlist grew past one address. Two
 * questions the app could not answer until then, because with one member they
 * had one answer: has a member actually signed in, and when were they last
 * here. And the panel P3 in the handover asked for before more people were
 * behind the login — the free-tier meters, as far as SQL can read them.
 *
 * Reached from the account menu, not a tab: it is about the app rather than
 * about players, and it exists for one reader. A member who types the URL is
 * told so, briefly, on the same card a non-member gets — not a 404, because the
 * page exists, and not three empty panels, because empty is the one thing this
 * app tries never to show without saying why.
 *
 * Rendered live: no `revalidate`, since "last seen 3 min ago" cached for an
 * hour is wrong for 57 of them.
 */
export default async function AdminPage() {
  const viewer = await fetchViewer();

  if (!viewer.admin) {
    // Not-on-the-list and not-the-admin are the same shape of answer — you are
    // signed in as X, and X does not get this — so they share the card. Which
    // of the two it is is said in the words, not the layout. `fetchViewer` does
    // not ask about membership, so the words claim nothing about it.
    return (
      <main className="shell">
        <NotAdmin email={viewer.email} />
      </main>
    );
  }

  const { activity, runs, storage, images } = await fetchAdmin();
  const now = Date.now();

  return (
    <main className="shell">
      <AppBar current="admin" viewer={viewer} />
      <PageHead
        title="Admin"
        context="who has been in, and how close the free tiers are · rendered live, not hourly"
      />
      <div className="admin">
        <Members rows={activity} now={now} />
        <Refresh runs={runs} now={now} />
        <FreeTiers rows={storage} images={images} />
        <NotMeasured />
      </div>
    </main>
  );
}

function NotAdmin({ email }: { email: string | undefined }) {
  return (
    <div className="gate-card">
      <Crest size={34} />
      <h1>Admin only</h1>
      <p>
        You are signed in as <code>{email}</code>, and that address is not the league
        admin’s. There is nothing here for anyone but the person running the league; the
        board and every other screen are unaffected.
      </p>
      <Link className="linkish" href="/">
        Back to the board
      </Link>
    </div>
  );
}
