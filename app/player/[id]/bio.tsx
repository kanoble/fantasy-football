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

/**
 * The school he was drafted out of, from a field that may list several.
 *
 * nflverse returns transfers as a semicolon-separated list, most recent first
 * — "Alabama; Georgia Tech" for Jahmyr Gibbs, who spent two years at Georgia
 * Tech and one at Alabama. 1,027 of 10,145 players have one, so rendering the
 * raw column puts a delimiter on a tenth of all player pages, which reads as
 * the database leaking rather than as a fact about a career.
 *
 * The first entry is the one that matters: it is where he was playing when he
 * was drafted, and it is what every other source prints. The rest is kept in
 * the `title` rather than thrown away — a transfer is interesting, it is just
 * not what this line is for.
 */
function colleges(raw: string | null): { primary: string; full: string } | null {
  if (!raw) return null;
  const parts = raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return { primary: parts[0]!, full: parts.join(" · ") };
}

export function Bio({ card }: { card: PlayerCard }) {
  const age = ageFrom(card.birth_date);
  const school = colleges(card.college);

  const now = [
    card.position,
    card.team ?? "free agent",
    card.jersey_number != null ? `#${card.jersey_number}` : null,
    age != null ? `age ${age}` : null,
    tenure(card.years_exp),
  ].filter(Boolean);

  const then = [
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
      <span className="bio-then">
        {school ? (
          <>
            {/* The full list only when there is more than one, so the title is
                never just the text underneath it. */}
            <span title={school.full !== school.primary ? school.full : undefined}>
              {school.primary}
            </span>
            {then.length > 0 ? " · " : null}
          </>
        ) : null}
        {then.join(" · ")}
      </span>
    </>
  );
}
