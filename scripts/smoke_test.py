#!/usr/bin/env python3
"""Smoke-test the free data layer. Requires NO credentials.

Hits only the no-auth sources and prints what came back:

1. Sleeper — current NFL state (season, week, season type)
2. Sleeper — trending adds over the last 24h
3. nflverse — one roster file, via nflreadpy (Polars)
4. RotoWire — the injury RSS feed

The point is to prove the free analytics layer works end-to-end while Yahoo API
access is still pending approval. Nothing here touches Yahoo, reads a token
file, or needs a .env.

Usage::

    uv run python scripts/smoke_test.py

Exits non-zero if any source fails.
"""

from __future__ import annotations

import sys
import traceback
from collections.abc import Callable
from typing import Any

from ff.sources import nflverse, rotowire, sleeper


def section(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def check_sleeper_state() -> str:
    section("1. Sleeper — current NFL state")
    state = sleeper.nfl_state()
    for key in ("season", "season_type", "week", "display_week", "leg"):
        if key in state:
            print(f"  {key:<15} {state[key]}")
    return f"season {state.get('season')} {state.get('season_type')}, week {state.get('week')}"


def check_sleeper_trending() -> str:
    section("2. Sleeper — trending adds (last 24h)")
    trending = sleeper.trending_players(kind="add", lookback_hours=24, limit=10)
    print(f"  {len(trending)} players returned\n")

    # Trending returns bare Sleeper IDs; join to the player universe for names.
    # This is exactly the identity problem ff.identity exists to solve, in
    # miniature — except Sleeper IDs are the easy case.
    players = sleeper.all_players()
    print(f"  (resolved against {len(players):,} Sleeper players)\n")
    print(f"  {'adds':>7}  player")
    print(f"  {'-' * 7}  {'-' * 40}")
    for entry in trending:
        meta = players.get(entry["player_id"], {})
        name = meta.get("full_name") or entry["player_id"]
        pos = meta.get("position") or "?"
        team = meta.get("team") or "FA"
        print(f"  {entry['count']:>7,}  {name} ({pos}, {team})")
    return f"{len(trending)} trending adds"


def check_nflverse_rosters() -> str:
    section("3. nflverse — roster file via nflreadpy")
    # nflreadpy returns POLARS, not pandas. nfl_data_py is deprecated/archived.
    df = nflverse.load_rosters(seasons=2025)
    print(f"  shape: {df.shape[0]:,} rows x {df.shape[1]} columns")
    print(f"  columns (first 15): {df.columns[:15]}\n")

    keep = [c for c in ("full_name", "position", "team", "gsis_id") if c in df.columns]
    if keep:
        skill = df
        if "position" in df.columns:
            skill = df.filter(df["position"].is_in(["QB", "RB", "WR", "TE"]))
        print(f"  {skill.height:,} QB/RB/WR/TE rows. Sample:\n")
        print(skill.select(keep).head(8))

    if "gsis_id" in df.columns:
        pct = 100.0 * (df.height - df["gsis_id"].null_count()) / max(df.height, 1)
        print(f"\n  gsis_id coverage: {pct:.1f}%  (the join key everything crosswalks to)")
    return f"{df.shape[0]:,} roster rows x {df.shape[1]} cols"


def check_rotowire_injuries() -> str:
    section("4. RotoWire — injury RSS feed")
    items = rotowire.fetch_injuries()
    print(f"  {len(items)} items (feed is a ~5-item sliding window — poll and dedupe)\n")
    for item in items:
        print(f"  - {item.title}")
        if item.published:
            print(f"    {item.published}")
        if item.summary:
            summary = " ".join(item.summary.split())
            print(f"    {summary[:160]}{'...' if len(summary) > 160 else ''}")
        print()
    return f"{len(items)} injury items"


def main() -> int:
    checks: list[tuple[str, Callable[[], str]]] = [
        ("Sleeper state", check_sleeper_state),
        ("Sleeper trending", check_sleeper_trending),
        ("nflverse rosters", check_nflverse_rosters),
        ("RotoWire injuries", check_rotowire_injuries),
    ]

    results: dict[str, Any] = {}
    failures: list[str] = []

    for name, fn in checks:
        try:
            results[name] = fn()
        except Exception as exc:  # noqa: BLE001 - a smoke test reports, never crashes
            failures.append(name)
            results[name] = f"FAILED: {type(exc).__name__}: {exc}"
            print(f"\n  !! {name} FAILED: {type(exc).__name__}: {exc}")
            traceback.print_exc(limit=3)

    section("SUMMARY")
    for name, _ in checks:
        mark = "FAIL" if name in failures else " OK "
        print(f"  [{mark}]  {name:<20} {results[name]}")

    if failures:
        print(f"\n{len(failures)} of {len(checks)} sources failed.")
        return 1
    print(f"\nAll {len(checks)} no-auth sources OK. Free data layer is working.")
    print("No credentials were used or required.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
