import type { Metadata } from "next";
import Link from "next/link";

import { MAX_COMPARE, STAT_SEASON } from "@/lib/board";
import { fetchPlayerOptions, fetchPlayers } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { AppBar, PageHead } from "../chrome";
import { NotOnList } from "../not-on-list";
import { Picker } from "../picker";
import { CompareResult, toColumns } from "./result";

export const metadata: Metadata = { title: "Compare" };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;

  // The URL is hand-editable and arrives from a link, so treat it as input:
  // split, drop blanks, collapse duplicates, and cap the width the layout can
  // actually hold. Extra ids are dropped rather than rendered too narrow.
  const requested = [...new Set((ids ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  const dropped = Math.max(0, requested.length - MAX_COMPARE);
  const wanted = requested.slice(0, MAX_COMPARE);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ cards, seasons, context, value, isMember }, { options, freshness }] =
    await Promise.all([fetchPlayers(wanted), fetchPlayerOptions()]);

  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={user?.email} />
      </main>
    );
  }

  const columns = toColumns(cards, seasons, context, value);

  return (
    <main className="shell">
      <AppBar current="compare" email={user?.email} />
      <PageHead
        title="Compare"
        context={`${STAT_SEASON} regular season · full PPR · one axis, so the shapes are the comparison`}
        freshness={freshness}
      />

      {/* The picker sits above the result and is seeded with whatever the URL
          asked for, so changing the comparison is the same act as building one
          — rather than going back to the board to stage a different set. */}
      {/* Keyed on the ids so a navigation remounts it. Without that, `initial`
          is read once at mount and the picker keeps showing the selection from
          whichever comparison was loaded first. */}
      <Picker
        key={wanted.join(",")}
        options={options}
        mode="select"
        initial={cards.map((card) => card.player_id)}
        startOpen={cards.length === 0}
      />

      {columns.length === 0 ? null : (
        <>
          {dropped > 0 ? (
            <p className="note">
              {dropped} more {dropped === 1 ? "id was" : "ids were"} in the link
              and {dropped === 1 ? "was" : "were"} dropped — {MAX_COMPARE} columns
              is as many as one shared axis holds legibly.
            </p>
          ) : null}

          <CompareResult columns={columns} />

          {columns.length === 1 ? (
            <p className="note">
              One player is a profile, not a comparison. Add another from the{" "}
              <Link className="linkish" href="/">
                board
              </Link>
              .
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
