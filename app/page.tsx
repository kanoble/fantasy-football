import type { Metadata } from "next";

import { Board } from "./board";
import { AppBar, PageHead } from "./chrome";
import { NotOnList } from "./not-on-list";
import { ADP_SEASON, STAT_SEASON } from "@/lib/board";
import { fetchBoard, fetchViewer } from "@/lib/queries";

export const metadata: Metadata = { title: "Draft board" };

// The published tables change once a day, on the 11:00 UTC cron. Revalidating
// hourly keeps the board close to the data without querying Postgres on every
// page load; the dateline tells the truth either way.
export const revalidate = 3600;

export default async function BoardPage() {
  const [viewer, { rows, freshness, isMember }] = await Promise.all([fetchViewer(), fetchBoard()]);

  // A non-member gets the explanation and nothing else — no app bar, no tabs to
  // sections that would return them zero rows. All four screens agree on this.
  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={viewer.email} />
      </main>
    );
  }

  return (
    <main className="shell">
      <AppBar current="board" viewer={viewer} />
      <PageHead
        title="Draft board"
        context={`${ADP_SEASON} ADP · ${STAT_SEASON} regular season · ${rows.length} priced players`}
        freshness={freshness}
      />
      <Board rows={rows} />
    </main>
  );
}
