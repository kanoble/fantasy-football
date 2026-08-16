import { Board } from "./board";
import { Nav } from "./nav";
import { NotOnList } from "./not-on-list";
import { ADP_SEASON, STAT_SEASON } from "@/lib/board";
import { fetchBoard } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

// The published tables change once a day, on the 11:00 UTC cron. Revalidating
// hourly keeps the board close to the data without querying Postgres on every
// page load; the "data as of" line below tells the truth either way.
export const revalidate = 3600;

export default async function BoardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { rows, freshness, isMember } = await fetchBoard();

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <Nav current="board" />
          <h1>Draft board</h1>
          <p className="sub">
            {ADP_SEASON} ADP · {STAT_SEASON} regular season
          </p>
        </div>
        <div className="who-am-i">
          <span>{freshnessLabel(freshness)}</span>
          <span>{user?.email}</span>
          <form action="/auth/signout" method="post">
            <button className="linkish" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {isMember ? <Board rows={rows} /> : <NotOnList email={user?.email} />}
    </main>
  );
}

function freshnessLabel(freshness: Awaited<ReturnType<typeof fetchBoard>>["freshness"]) {
  // last_success comes from pipeline_runs, not pipeline_meta.last_full_refresh:
  // an incremental run republishes ADP and the current season without touching
  // the latter, so reading it would report data days older than it is.
  const stamp = freshness?.last_success;
  if (!stamp) return "data as of —";

  const when = new Date(stamp);
  const hours = Math.floor((Date.now() - when.getTime()) / 3_600_000);
  const ago =
    hours < 1 ? "just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;

  return `data as of ${when.toISOString().slice(0, 16).replace("T", " ")}Z · ${ago}`;
}
