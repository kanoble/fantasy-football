import type { Metadata } from "next";

import { ADP_SEASON, STAT_SEASON } from "@/lib/board";
import { fetchPlayerOptions, fetchViewer } from "@/lib/queries";
import { AppBar, PageHead } from "../chrome";
import { NotOnList } from "../not-on-list";
import { Picker } from "../picker";

export const metadata: Metadata = { title: "Players" };

export default async function PlayersPage() {
  const [viewer, { options, freshness, isMember }] = await Promise.all([
    fetchViewer(),
    fetchPlayerOptions(),
  ]);

  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={viewer.email} />
      </main>
    );
  }

  return (
    <main className="shell">
      <AppBar current="players" viewer={viewer} />
      <PageHead
        title="Players"
        context={`${ADP_SEASON} ADP · ${STAT_SEASON} regular season · search a name, open a career`}
        freshness={freshness}
      />
      <Picker options={options} mode="link" />
    </main>
  );
}
