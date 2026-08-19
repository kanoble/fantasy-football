import {
  DATABASE_ROW,
  FREE_TIER_DB_BYTES,
  IMAGE_TRANSFORMS_MONTH,
  ago,
  day,
  device,
  duration,
  formatBytes,
  formatCount,
  splitMembers,
  stamp,
  type ImageUsage,
  type MemberActivity,
  type PipelineRun,
  type StorageRow,
} from "@/lib/admin";

/**
 * The panels of `/admin`, over plain data.
 *
 * Nothing here fetches, for the reason `app/market/chart.tsx` gives: a screen
 * whose visual half takes rows and a clock can be rendered by a probe with
 * neither a session nor a database — and this one was, with sample rows and
 * the real stylesheet, before the migration behind it had been applied.
 *
 * `now` is a prop rather than `Date.now()` in the body so every "3 h ago" on
 * the page is measured from the same instant, and so a test can pin one.
 */

/* ---------------------------------------------------------------- members */

export function Members({ rows, now }: { rows: MemberActivity[]; now: number }) {
  const { members, strangers } = splitMembers(rows);
  const signedIn = members.filter((m) => m.sign_ins > 0).length;

  return (
    <section className="panel admin-panel">
      <div className="panel-top">
        <span className="panel-title">Members</span>
        <span className="panel-title">
          {members.length} on the list · {signedIn} {signedIn === 1 ? "has" : "have"} signed in
        </span>
      </div>

      <div className="admin-scroll">
        <table className="log admin-table">
          <thead>
            <tr>
              <th className="txt">Address</th>
              <th className="txt">Added</th>
              <th>Sign-ins</th>
              <th className="txt">Last sign-in</th>
              <th className="txt">Last seen</th>
              <th className="txt">Device</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.email} row={m} now={now} />
            ))}
          </tbody>
        </table>
      </div>

      {strangers.length > 0 ? (
        <>
          <div className="panel-top">
            <span className="panel-title">Signed in, not on the list</span>
          </div>
          <p className="note">
            These addresses got through Google and have an account, but are not in{" "}
            <code>league_members</code>, so every screen shows them nothing. Either
            add them or delete the account — an account with no row on the list is
            a person seeing the “not on the league list” card.
          </p>
          <div className="admin-scroll">
            <table className="log admin-table">
              <thead>
                <tr>
                  <th className="txt">Address</th>
                  <th className="txt">Added</th>
                  <th>Sign-ins</th>
                  <th className="txt">Last sign-in</th>
                  <th className="txt">Last seen</th>
                  <th className="txt">Device</th>
                </tr>
              </thead>
              <tbody>
                {strangers.map((m) => (
                  <MemberRow key={m.email} row={m} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function MemberRow({ row, now }: { row: MemberActivity; now: number }) {
  // A member who has never come is the row this table exists to show, so the
  // whole row is dimmed rather than one cell dashed — the eye should land on it.
  const never = row.sign_ins === 0 && row.last_seen == null;

  return (
    <tr className={never ? "quiet" : undefined}>
      <td className="txt">
        <span className="admin-who">{row.email}</span>
        {row.role === "admin" ? <span className="admin-tag">admin</span> : null}
        {row.note ? <span className="admin-note">{row.note}</span> : null}
      </td>
      <td className="txt" title={stamp(row.added_at)}>
        {day(row.added_at, now)}
      </td>
      <td>{row.sign_ins}</td>
      <td className="txt" title={stamp(row.last_sign_in)}>
        {ago(row.last_sign_in, now)}
      </td>
      <td className="txt" title={stamp(row.last_seen)}>
        {ago(row.last_seen, now)}
      </td>
      <td className="txt" title={row.last_user_agent ?? undefined}>
        {device(row.last_user_agent)}
      </td>
    </tr>
  );
}

/* ---------------------------------------------------------------- refresh */

/** Short labels for the tables the refresh reports on; the key otherwise. */
const WRITTEN_LABELS: Record<string, string> = {
  scored_weekly_stats: "stats",
  adp_projections: "adp",
  player_index: "index",
  injury_news: "injuries",
};

export function Refresh({ runs, now }: { runs: PipelineRun[]; now: number }) {
  const latest = runs[0];
  const lastOk = runs.find((run) => run.status === "ok");

  return (
    <section className="panel admin-panel">
      <div className="panel-top">
        <span className="panel-title">Daily refresh</span>
        <span className="panel-title">
          {lastOk ? `last success ${ago(lastOk.finished_at, now)}` : "no successful run on record"}
        </span>
      </div>

      {latest && latest.status === "error" ? (
        <p className="note admin-bad">
          The most recent run failed{latest.finished_at ? ` ${ago(latest.finished_at, now)}` : ""}.
          The board is serving whatever the last good run left, and the dateline says how old
          that is.
        </p>
      ) : null}

      {runs.length === 0 ? (
        <p className="note">
          No runs recorded. The cron writes a row to <code>pipeline_runs</code> every morning;
          none means it has never fired.
        </p>
      ) : (
        <div className="admin-scroll">
          <table className="log admin-table">
            <thead>
              <tr>
                <th className="txt">Started</th>
                <th className="txt">Status</th>
                <th className="txt">Mode</th>
                <th>Took</th>
                <th className="txt">Wrote</th>
                <th className="txt">Note</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="txt" title={stamp(run.started_at)}>
                    {ago(run.started_at, now)}
                  </td>
                  <td className={`txt status-${run.status}`}>{run.status}</td>
                  <td className="txt">{run.mode ?? "—"}</td>
                  <td>{duration(run.started_at, run.finished_at)}</td>
                  <td className="txt">
                    {run.rows_written
                      ? Object.entries(run.rows_written)
                          .map(([table, n]) => `${WRITTEN_LABELS[table] ?? table} ${formatCount(n)}`)
                          .join(" · ")
                      : "—"}
                  </td>
                  <td className="txt admin-wrap" title={run.error ?? run.reason ?? undefined}>
                    {run.error ?? run.reason ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- free tiers */

/**
 * One meter: a figure against its ceiling, and the same quiet mark /compare
 * draws under a figure. Amber past 80% and red past 95%, because at those
 * points it is no longer a fact but a thing to do.
 */
function Meter({
  label,
  used,
  ceiling,
  detail,
}: {
  label: string;
  used: number | null;
  ceiling: number;
  detail: string;
}) {
  const share = used == null ? null : Math.min(1, used / ceiling);
  const tone = share == null ? "" : share >= 0.95 ? " full" : share >= 0.8 ? " near" : "";

  return (
    <div className="meter">
      <div className="meter-row">
        <span className="meter-label">{label}</span>
        <span className="meter-figure">{detail}</span>
      </div>
      <span
        className={`gauge admin-gauge${tone}`}
        role="img"
        aria-label={share == null ? `${label}: unknown` : `${label}: ${Math.round(share * 100)}% of the allowance`}
      >
        {share != null ? (
          <span className="gauge-fill" style={{ left: 0, width: `${share * 100}%` }} />
        ) : null}
      </span>
    </div>
  );
}

export function FreeTiers({ rows, images }: { rows: StorageRow[]; images: ImageUsage | null }) {
  const total = rows.find((row) => row.relation === DATABASE_ROW)?.bytes ?? null;
  const tables = rows.filter((row) => row.relation !== DATABASE_ROW);
  const pct = (used: number, ceiling: number) => `${Math.round((used / ceiling) * 100)}%`;

  return (
    <section className="panel admin-panel">
      <div className="panel-top">
        <span className="panel-title">Free tiers</span>
        <span className="panel-title">what the app can measure for itself</span>
      </div>

      <div className="meters">
        <Meter
          label="Supabase database"
          used={total}
          ceiling={FREE_TIER_DB_BYTES}
          detail={
            total == null
              ? "size unknown"
              : `${formatBytes(total)} of ${formatBytes(FREE_TIER_DB_BYTES)} · ${pct(total, FREE_TIER_DB_BYTES)}`
          }
        />
        <Meter
          label="Vercel image transformations"
          used={images?.distinct_players ?? null}
          ceiling={IMAGE_TRANSFORMS_MONTH}
          detail={
            images == null
              ? "no count yet"
              : `${formatCount(images.distinct_players)} distinct players opened since ${day(images.since)} · at most ${pct(images.distinct_players, IMAGE_TRANSFORMS_MONTH)} of ${formatCount(IMAGE_TRANSFORMS_MONTH)}`
          }
        />
      </div>

      <p className="note">
        The image figure is the app’s own upper bound, not Vercel’s meter: one width, one quality
        and a 31-day cache mean a player costs at most one transformation a month, so distinct
        players opened is the ceiling on the count.{" "}
        {images ? `${formatCount(images.views)} player-page loads this calendar month in all.` : ""}{" "}
        Vercel’s cycle starts on the account’s date rather than the first, and its dashboard is the
        meter of record.
      </p>

      <div className="admin-scroll">
        <table className="log admin-table">
          <thead>
            <tr>
              <th className="txt">Table</th>
              <th>Size</th>
              <th>Rows (est.)</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((row) => (
              <tr key={row.relation}>
                <td className="txt">
                  <code>{row.relation}</code>
                </td>
                <td>{formatBytes(row.bytes)}</td>
                <td>{formatCount(row.estimated_rows)}</td>
                <td>{total ? pct(row.bytes, total) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        Table sizes include their indexes; the total is what Supabase meters. Row counts are the
        planner’s estimate, which is what keeps this cheap enough to read on every load.
      </p>
    </section>
  );
}

/* --------------------------------------------------------- not measured */

/**
 * The half of the ceilings this screen cannot see, said outright.
 *
 * A panel that quietly omitted egress would read as "everything is fine" — the
 * same failure as an empty page for a non-member. Kept to two sentences at
 * Kevin's request; the how — a Vercel and a Supabase token, and one pipeline
 * row per source per run — is in the roadmap, where the next session reads.
 */
export function NotMeasured() {
  return (
    <section className="panel admin-panel">
      <div className="panel-top">
        <span className="panel-title">Not measured here</span>
      </div>
      <p className="note">
        <strong>Supabase egress</strong> (5 GB/mo) and <strong>Vercel</strong>’s image cache,
        invocations and CPU meters live behind platform tokens the app does not carry; read them
        on the two dashboards, which also email at 75% and 100%. Per-source health for the refresh
        — Sleeper, nflverse, RotoWire, and Yahoo when it lands — waits on the pipeline recording
        one row per source per run.
      </p>
    </section>
  );
}
