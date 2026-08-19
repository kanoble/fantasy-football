import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ADP_SEASON,
  CEILING,
  FLOOR,
  STAT_SEASON,
  median,
  rowState,
  signedDelta,
} from "@/lib/board";
import { fetchPlayer, fetchViewer } from "@/lib/queries";
import { teamClass } from "@/lib/teams";
import { AppBar, PageHead } from "../../chrome";
import { NotOnList } from "../../not-on-list";
import { Tip } from "../../tip";
import { Bio } from "./bio";
import { Career } from "./career";
import { Portrait } from "./portrait";

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

  const [viewer, { cards, seasons, context, value, freshness, isMember }] = await Promise.all([
    fetchViewer(),
    fetchPlayer(id),
  ]);

  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={viewer.email} />
      </main>
    );
  }

  const card = cards[0];
  // A member asking for an id that is not in player_index is asking for a
  // player who does not exist, which is a 404 and not an empty page.
  if (!card) notFound();

  const state = rowState(card);
  // The stat season's row, for the rank beside the median. A player with no
  // week that season simply has none, which the tile renders as an em dash.
  const statSeason = context.find((row) => row.season === STAT_SEASON);
  // The page is about one player, so his team's hue runs down the left of his
  // name — the same hue his row carries on the board.
  const tone = teamClass(card.team);

  // The career's cost-versus-finish gaps, as one number.
  //
  // A season only has one when the market priced him *and* he played, so this
  // is drawn from the seasons that have both rather than from the length of
  // either list. A median rather than a mean for the reason the whole app
  // prefers one: McCaffrey's two injury years are -67 and -53, and an average
  // would let them describe a career that also contains two RB1 finishes.
  const ranked = new Map(context.map((row) => [row.season, row.rank]));
  const deltas = value
    .map((price) => {
      const finish = ranked.get(price.season);
      return finish == null ? null : price.rank - finish;
    })
    .filter((delta): delta is number => delta != null);
  const medianDelta = median(deltas);

  return (
    <main className="shell">
      <AppBar current="players" viewer={viewer} />
      <PageHead
        title={card.name}
        tone={tone}
        portrait={<Portrait src={card.headshot_url} name={card.name} />}
        context={<Bio card={card} />}
        action={
          <Link className="linkish" href={`/compare?ids=${card.player_id}`}>
            Compare
          </Link>
        }
        freshness={freshness}
      />

      {/* Every label here says what it means on hover, for the same reason the
          career table's headers do: "Middle 50%" and "Floor weeks" are this
          app's own vocabulary, not general knowledge, and eleven relatives are
          about to read them for the first time. */}
      <dl className="stats">
        <Stat
          label={`${ADP_SEASON} ADP`}
          hint={`Average draft position across public 12-team PPR drafts — roughly the pick he goes at this year. "undrafted" means no ${ADP_SEASON} price at all.`}
          value={card.adp == null ? "undrafted" : f1(card.adp)}
        />
        <Stat
          label="Projected"
          hint={`Projected ${ADP_SEASON} points, from Sleeper. Somebody else's forecast, carried through as-is — every other number on this page is scored from what actually happened.`}
          value={f1(card.projected_points)}
        />
        <Stat
          label={`${STAT_SEASON} median`}
          hint={`His middle week of ${STAT_SEASON} — half his games scored above it, half below. The number this whole page is built around, because an average lets one enormous week describe a season he mostly did not have.`}
          value={f1(card.median)}
          accent
        />
        {/* Directly after the median, because it is what makes the median
            readable. 14.2 is either an excellent back or a replaceable one and
            the number alone has never said which. */}
        <Stat
          label={`${STAT_SEASON} rank`}
          hint={`Where that median put him among the startable players at his position — the pool a 12-team league starts each week. RB3 of 24 is a season you won weeks with.`}
          value={
            statSeason
              ? `${statSeason.position}${statSeason.rank}`
              : "—"
          }
        />
        {/* Third in the cost-and-finish run, and a career figure among season
            ones — which is why the hint leads with how many seasons it spans
            rather than treating that as a footnote. */}
        <Stat
          label="Median delta"
          hint={
            deltas.length === 0
              ? "The middle of his cost-minus-rank gaps across every season with both a price and a finish. He has none yet — either he has not been drafted in a season he played, or those seasons predate the data."
              : `The middle of his cost-minus-rank gaps across the ${deltas.length} season${deltas.length === 1 ? "" : "s"} that have both a price and a finish. Positive means he has usually finished better than the market's guess. The two pools differ in size, so read it as a direction rather than a distance.`
          }
          value={medianDelta == null ? "—" : signedDelta(medianDelta)}
        />
        <Stat
          label="Middle 50%"
          hint={`The 25th to 75th percentile of his ${STAT_SEASON} weeks — what an ordinary Sunday from him looked like. A narrow range is a predictable player, not automatically a better one.`}
          value={
            card.q1 == null || card.q3 == null ? "—" : `${f1(card.q1)}–${f1(card.q3)}`
          }
        />
        <Stat
          label="Ceiling weeks"
          hint={`Weeks he scored ${CEILING} or more in ${STAT_SEASON} — the games that win a matchup on their own.`}
          value={card.games > 0 ? String(card.ceiling_weeks) : "—"}
        />
        <Stat
          label="Floor weeks"
          hint={`Weeks he scored ${FLOOR} or less in ${STAT_SEASON} — the games the rest of your team has to cover for.`}
          value={card.games > 0 ? String(card.floor_weeks) : "—"}
        />
        <Stat
          label="Best week"
          hint={`His single highest-scoring week of ${STAT_SEASON}.`}
          value={f1(card.best)}
        />
        <Stat
          label={`${STAT_SEASON} games`}
          hint={`Regular-season games he played in ${STAT_SEASON}, out of a possible 17. Postseason is excluded everywhere in this app.`}
          value={String(card.games)}
        />
      </dl>

      {state !== "ok" ? (
        <p className="note">
          {state === "rookie"
            ? `No NFL regular-season week in any season — a ${ADP_SEASON} price with no past to read.`
            : `A career of ${card.career_games} games, but none in ${STAT_SEASON}. The ${STAT_SEASON} figures above are empty for that reason, not because the data is missing.`}
        </p>
      ) : null}

      {/* Same hue again: it colours the career table's plots and its expanded
          panels, so the page reads as one player from top to bottom. */}
      <Career
        playerId={card.player_id}
        name={card.name}
        seasons={seasons}
        context={context}
        value={value}
        tone={tone}
      />
    </main>
  );
}

/**
 * One tile of the strip.
 *
 * `accent` used to be `big`, and it used to mean both things at once: the
 * median tile was set half again as large as its neighbours *and* in amber. The
 * size was doing no work the amber was not already doing — amber means "median"
 * on every screen in this app — while it did break the strip's own rhythm,
 * which is the one thing a row of figures has to keep. So the tile keeps the
 * colour and gives up the size.
 */
function Stat({
  label,
  hint,
  value,
  accent,
}: {
  label: string;
  hint: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat${accent ? " accent" : ""}`}>
      <dt>
        <Tip hint={hint}>{label}</Tip>
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
