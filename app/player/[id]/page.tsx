import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ADP_SEASON, STAT_SEASON, rowState } from "@/lib/board";
import { fetchPlayer } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { teamClass } from "@/lib/teams";
import { Nav } from "../../nav";
import { NotOnList } from "../../not-on-list";
import { ThemeToggle } from "../../theme";
import { Career } from "./career";

const f1 = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "—" : value.toFixed(1);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { cards } = await fetchPlayer(id);
  // The allowlist gates this too, so a non-member gets the generic title rather
  // than a title that confirms the id belongs to somebody.
  return { title: cards[0]?.name ?? "Player" };
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { cards, seasons, isMember } = await fetchPlayer(id);

  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={user?.email} />
      </main>
    );
  }

  const card = cards[0];
  // A member asking for an id that is not in player_index is asking for a
  // player who does not exist, which is a 404 and not an empty page.
  if (!card) notFound();

  const state = rowState(card);

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <Nav current="players" />
          <h1>{card.name}</h1>
          <p className="sub">
            {card.position ?? "—"} · {card.team ?? "free agent"} ·{" "}
            {card.career_games} career games
            {card.injury_status ? (
              <span className="flagpill q inline">{card.injury_status}</span>
            ) : null}
          </p>
        </div>
        <div className="who-am-i">
          <Link className="linkish" href={`/compare?ids=${card.player_id}`}>
            Compare
          </Link>
          <span>{user?.email}</span>
          <ThemeToggle />
        </div>
      </header>

      <dl className="stats">
        <Stat label={`${ADP_SEASON} ADP`} value={card.adp == null ? "undrafted" : f1(card.adp)} />
        <Stat label="Projected" value={f1(card.projected_points)} />
        <Stat label={`${STAT_SEASON} median`} value={f1(card.median)} big />
        <Stat
          label="Middle 50%"
          value={
            card.q1 == null || card.q3 == null ? "—" : `${f1(card.q1)}–${f1(card.q3)}`
          }
        />
        <Stat label="Ceiling weeks" value={card.games > 0 ? String(card.ceiling_weeks) : "—"} />
        <Stat label="Floor weeks" value={card.games > 0 ? String(card.floor_weeks) : "—"} />
        <Stat label="Best week" value={f1(card.best)} />
        <Stat label={`${STAT_SEASON} games`} value={String(card.games)} />
      </dl>

      {state !== "ok" ? (
        <p className="note">
          {state === "rookie"
            ? `No NFL regular-season week in any season — a ${ADP_SEASON} price with no past to read.`
            : `A career of ${card.career_games} games, but none in ${STAT_SEASON}. The ${STAT_SEASON} figures above are empty for that reason, not because the data is missing.`}
        </p>
      ) : null}

      {/* The whole page is about one player, so his team colours the career
          table's plots and its expanded panels — the same hue his row carries
          on the board. */}
      <Career
        playerId={card.player_id}
        name={card.name}
        seasons={seasons}
        tone={teamClass(card.team)}
      />
    </main>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`stat${big ? " big" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
