"""Command line entry point.

    ff compare "Bijan Robinson" "Jahmyr Gibbs"
    ff rules

Deliberately dependency-free (argparse, no click) and Yahoo-free — every command
here runs on public data with no credentials.
"""

from __future__ import annotations

import argparse
import sys

from ff.analysis.compare import compare_players
from ff.analysis.players import AmbiguousPlayerError, PlayerNotFoundError
from ff.scoring.rules import LEAGUE_SCORING


def _print_frame(frame) -> None:
    """Print a comparison frame without Polars truncating the metric labels."""
    import polars as pl

    with pl.Config(
        tbl_rows=100,
        tbl_cols=12,
        fmt_str_lengths=40,
        tbl_hide_dataframe_shape=True,
        tbl_hide_column_data_types=True,
    ):
        print(frame)


def cmd_compare(args: argparse.Namespace) -> int:
    try:
        result = compare_players(
            queries=args.players,
            seasons=args.seasons,
            adp_season=args.adp_season,
            season_type=args.season_type,
        )
    except (PlayerNotFoundError, AmbiguousPlayerError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    label = {"REG": "regular season", "POST": "postseason", "ALL": "reg + post"}
    print()
    print(f"Scoring: {result.rules.league_key} (full PPR)")
    if result.seasons:
        seasons = ", ".join(str(s) for s in sorted(result.seasons))
        print(f"Seasons scored: {seasons}  [{label[args.season_type]}]")
    if result.unavailable_seasons:
        seasons = ", ".join(str(s) for s in sorted(result.unavailable_seasons))
        print(f"No nflverse data yet for: {seasons}")
    print()

    _print_frame(result.to_frame())

    for report in result.players:
        if report.news:
            print(f"\nRecent news — {report.ref.name}:")
            for headline in report.news:
                print(f"  · {headline}")

    if result.rules.unmapped:
        names = ", ".join(r.name for r in result.rules.unmapped)
        print(f"\nNot scored (no clean data source): {names}")
    print(
        "\nADP/projections: Sleeper. Stats: nflverse (CC-BY-4.0). News: RotoWire."
        "\nInjury feed is a ~5-item window — absence is not a clean bill of health."
    )
    return 0


def cmd_rules(args: argparse.Namespace) -> int:
    print(LEAGUE_SCORING.describe())
    print(f"\n{len(LEAGUE_SCORING.required_columns())} nflverse columns read.")
    print(f"fingerprint: {LEAGUE_SCORING.fingerprint()}")
    print("(published data scored under a different fingerprint triggers a full rebuild)")
    return 0


def cmd_refresh(args: argparse.Namespace) -> int:
    """Run the publish pipeline by hand — same code path Vercel Cron uses."""
    from ff.config import DSN_ENV_VARS, resolve_dsn

    dsn = args.dsn or resolve_dsn()
    if not dsn:
        print(
            f"error: no database URL. Pass --dsn or set {' or '.join(DSN_ENV_VARS)}.",
            file=sys.stderr,
        )
        return 2

    from ff.pipeline import run_refresh

    result = run_refresh(dsn, full=args.full)
    print(f"mode: {result['mode']}" + (f"  ({result['reason']})" if result["reason"] else ""))
    for table, count in result["rows_written"].items():
        print(f"  {table:<22} {count:>8,} rows")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ff",
        description="Personal fantasy football analytics (read-only, no credentials needed).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    compare = sub.add_parser("compare", help="Compare players for draft prep.")
    compare.add_argument("players", nargs="+", help="Player names, e.g. 'Bijan Robinson'")
    compare.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=None,
        help="Seasons of history to score (default: last three with data).",
    )
    compare.add_argument(
        "--adp-season",
        type=int,
        default=None,
        help="Season to pull ADP for (default: current).",
    )
    compare.add_argument(
        "--season-type",
        choices=["REG", "POST", "ALL"],
        default="REG",
        help="Which games to score (default: REG — fantasy scores the regular season).",
    )
    compare.set_defaults(func=cmd_compare)

    rules = sub.add_parser("rules", help="Show the league scoring rules in use.")
    rules.set_defaults(func=cmd_rules)

    refresh = sub.add_parser("refresh", help="Run the publish pipeline into Postgres.")
    refresh.add_argument("--dsn", default=None, help="Postgres URL (default: $SUPABASE_DB_URL).")
    refresh.add_argument(
        "--full",
        action="store_true",
        help="Force a full rebuild. Normally unnecessary — a scoring-rule change "
        "is detected by fingerprint and rebuilds everything on its own.",
    )
    refresh.set_defaults(func=cmd_refresh)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
