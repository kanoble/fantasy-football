"use client";

import { useEffect, useState } from "react";

import { CEILING, FLOOR, STAT_SEASON, type WeekRow } from "@/lib/board";
import { LEAGUE_RULES, decompose, type StatRule } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/client";

const f1 = (value: number) => value.toFixed(1);

const asNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const unitsFor = (week: WeekRow, rule: StatRule) =>
  rule.columns.reduce((total, column) => total + asNumber(week[column] as number | null), 0);

/**
 * One player's season, fetched when the row opens rather than shipped with the
 * board: 923 players' game logs would be a payload nobody reads most of.
 */
export function GameLog({ playerId, name }: { playerId: string; name: string }) {
  const [weeks, setWeeks] = useState<WeekRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const supabase = createClient();

    supabase
      .rpc("player_week_log", { p_player_id: playerId, p_season: STAT_SEASON })
      .then(({ data, error: rpcError }) => {
        if (!live) return;
        if (rpcError) setError(rpcError.message);
        else setWeeks((data ?? []) as WeekRow[]);
      });

    return () => {
      // The row can be closed before the round trip lands.
      live = false;
    };
  }, [playerId]);

  if (error) {
    return (
      <div className="panel">
        <div className="panel-title">Could not load {name}&rsquo;s game log — {error}</div>
      </div>
    );
  }

  if (!weeks) {
    return (
      <div className="panel">
        <div className="panel-title">Loading {STAT_SEASON} game log…</div>
      </div>
    );
  }

  if (weeks.length === 0) {
    return (
      <div className="panel">
        <div className="panel-title">No {STAT_SEASON} regular-season weeks.</div>
      </div>
    );
  }

  // Show the categories this player actually accumulated, rather than a fixed
  // skill-position set: the same panel then explains a quarterback's week and a
  // kicker's week without a second implementation.
  const columns = LEAGUE_RULES.filter((rule) =>
    weeks.some((week) => unitsFor(week, rule) !== 0),
  );

  const best = weeks.reduce((a, b) => (b.fantasy_points > a.fantasy_points ? b : a));
  const sum = decompose(best);

  return (
    <div className="panel">
      <div className="panel-title">
        {STAT_SEASON} game log · {weeks.length} games
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="log">
          <thead>
            <tr>
              <th scope="col">Week</th>
              {columns.map((rule) => (
                <th key={rule.name} scope="col">
                  {rule.short}
                </th>
              ))}
              <th scope="col">Points</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              const cls =
                week.fantasy_points >= CEILING
                  ? "hi"
                  : week.fantasy_points <= FLOOR
                    ? "lo"
                    : "";
              return (
                <tr key={week.week}>
                  <td>wk {week.week}</td>
                  {columns.map((rule) => {
                    const units = unitsFor(week, rule);
                    return (
                      <td key={rule.name} className={units === 0 ? "z" : ""}>
                        {units === 0 ? "·" : units}
                      </td>
                    );
                  })}
                  <td className={`pts ${cls}`}>{f1(week.fantasy_points)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="panel-title" style={{ marginBottom: "0.35rem" }}>
          Best week · how week {best.week} scored {f1(best.fantasy_points)}
        </div>
        <div className="maths">
          {sum.terms.map((term, index) => (
            <span key={term.rule.name}>
              {index > 0 ? <span className="eq">+ </span> : null}
              <span className="term">
                {term.units} {term.rule.short} <span className="eq">×</span>{" "}
                {term.rule.pointsPerUnit} <span className="eq">=</span> {f1(term.points)}
              </span>
            </span>
          ))}
          <span className="eq">→</span>
          <span className="tot">{f1(sum.computed)}</span>
        </div>

        {/* The arithmetic is reconstructed in TypeScript from a copy of the
            Python rules. If the two ever disagree, say so rather than showing a
            confident wrong sum. */}
        {!sum.agrees ? (
          <div className="panel-title" style={{ color: "#C15F52", marginTop: "0.4rem" }}>
            ⚠ these rules reconstruct {f1(sum.computed)} but the pipeline stored{" "}
            {f1(sum.stored)} — lib/scoring.ts has drifted from ff.scoring.rules
          </div>
        ) : null}
      </div>
    </div>
  );
}
