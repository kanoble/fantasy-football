import type { Metadata } from "next";

import { ADP_SEASON, STAT_SEASON } from "@/lib/board";
import { fetchPlayerOptions } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { AppBar, PageHead } from "../chrome";
import { NotOnList } from "../not-on-list";
import { Picker } from "../picker";

export const metadata: Metadata = { title: "Players" };

export default async function PlayersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { options, freshness, isMember } = await fetchPlayerOptions();

  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={user?.email} />
      </main>
    );
  }

  return (
    <main className="shell">
      <AppBar current="players" email={user?.email} />
      <PageHead
        title="Players"
        context={`${ADP_SEASON} ADP · ${STAT_SEASON} regular season · search a name, open a career`}
        freshness={freshness}
      />
      <Picker options={options} mode="link" />
    </main>
  );
}
