import type { Metadata } from "next";

import { ADP_SEASON, STAT_SEASON } from "@/lib/board";
import { fetchPlayerOptions } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "../nav";
import { NotOnList } from "../not-on-list";
import { Picker } from "../picker";
import { ThemeToggle } from "../theme";

export const metadata: Metadata = { title: "Players" };

export default async function PlayersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { options, isMember } = await fetchPlayerOptions();

  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={user?.email} />
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <Nav current="players" />
          <h1>Players</h1>
          <p className="sub">
            {ADP_SEASON} ADP · {STAT_SEASON} regular season · search a name, open a
            career
          </p>
        </div>
        <div className="who-am-i">
          <span>{user?.email}</span>
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button className="linkish" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <Picker options={options} mode="link" />
    </main>
  );
}
