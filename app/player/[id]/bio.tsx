import { ageFrom, type PlayerCard } from "@/lib/board";

/**
 * Who the player is, in two lines under his name.
 *
 * Split rather than run together because the two answer different questions.
 * The first is *what he is now* — the things that change between seasons and
 * that a drafter is pricing. The second is *where he came from*, which is
 * fixed for life and read once.
 *
 * Age is the reason this file exists. The page could already tell you a
 * running back's median was sliding and not whether he was 24 or 30, which is
 * the difference between a buy and a fade on identical numbers.
 *
 * Every field is nullable and each absence is handled where it falls rather
 * than by hiding the whole line: a player with no college still has a draft
 * slot worth showing.
 */

/** 1st, 2nd, 3rd, 4th… — including the 11th/12th/13th exceptions. */
function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th";
  return `${value}${suffix}`;
}

/**
 * "rookie" or "4th season".
 *
 * `years_exp` is 0 for a rookie, so the season number is one more than it.
 * Named rather than numbered at zero because "1st season" is a phrase nobody
 * uses and "rookie" carries the same fact plus its connotations.
 */
function tenure(yearsExp: number | null): string | null {
  if (yearsExp == null || yearsExp < 0) return null;
  return yearsExp === 0 ? "rookie" : `${ordinal(yearsExp + 1)} season`;
}

/**
 * Where he was drafted, or that he was not.
 *
 * A null `draft_number` is the fact itself — 1,281 of 3,137 players on a 2025
 * roster went undrafted — so it renders as "undrafted" rather than vanishing.
 * The club is included only when it differs from his current team, where it
 * says something ("drafted by BAL", now elsewhere); when it matches, repeating
 * the abbreviation two lines under itself is noise.
 */
function draftLine(card: PlayerCard): string | null {
  if (card.draft_number == null) {
    // Distinguish "we know he went undrafted" from "we know nothing about his
    // draft", which a rookie_year of null implies.
    return card.rookie_year == null ? null : "undrafted";
  }

  const where = `${ordinal(card.draft_number)} overall`;
  const when = card.rookie_year ? ` in ${card.rookie_year}` : "";
  const club =
    card.draft_club && card.draft_club !== card.team ? ` by ${card.draft_club}` : "";
  return `${where}${when}${club}`;
}

export function Bio({ card }: { card: PlayerCard }) {
  const age = ageFrom(card.birth_date);

  const now = [
    card.position,
    card.team ?? "free agent",
    card.jersey_number != null ? `#${card.jersey_number}` : null,
    age != null ? `age ${age}` : null,
    tenure(card.years_exp),
  ].filter(Boolean);

  const then = [
    card.college,
    draftLine(card),
    `${card.career_games} career game${card.career_games === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <>
      <span className="bio-now">
        {now.join(" · ")}
        {card.injury_status ? (
          <span className="flagpill q inline">{card.injury_status}</span>
        ) : null}
      </span>
      {then.length > 0 ? <span className="bio-then">{then.join(" · ")}</span> : null}
    </>
  );
}
