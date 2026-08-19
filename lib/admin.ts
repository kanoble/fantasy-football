/**
 * What `/admin` shows, and how it words a time and a size.
 *
 * Types are the wire shapes of the four admin-only functions in migration
 * 0012, in the column names SQL returns. The helpers are pure and take `now` as
 * an argument, for the reason `draftCountdown` in `lib/board.ts` does: a
 * relative time is only testable when the clock is an input.
 *
 * Kept out of `lib/queries.ts` so the formatting can be imported by a client
 * component — or a test — without dragging the server client along.
 */

/** One row of `member_activity()`: an address on the list, or one that came. */
export type MemberActivity = {
  email: string;
  note: string | null;
  /** `'admin'` or `'member'`; null when the address is not on the list at all. */
  role: string | null;
  /** Null is the tell for "signed in, not on the list". */
  added_at: string | null;
  first_seen: string | null;
  last_seen: string | null;
  sign_ins: number;
  last_sign_in: string | null;
  last_user_agent: string | null;
};

/** One row of `pipeline_history()`: a run of the daily refresh. */
export type PipelineRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  mode: string | null;
  reason: string | null;
  rows_written: Record<string, number> | null;
  error: string | null;
};

/** One row of `storage_report()`: a table, or the `(database)` total. */
export type StorageRow = {
  relation: string;
  bytes: number;
  estimated_rows: number | null;
};

/** The one row of `image_usage()`: player pages opened since the first of the month. */
export type ImageUsage = {
  distinct_players: number;
  views: number;
  since: string;
};

/** The relation name `storage_report()` gives the whole-database row. */
export const DATABASE_ROW = "(database)";

/**
 * Supabase's free-tier database cap, in the units `pg_database_size` counts.
 *
 * Supabase says "500 MB"; whether that is 500 × 10⁶ or 500 × 2²⁰ bytes is not
 * something their pricing page states, and the two differ by 5%. Binary is used
 * here because it is what `pg_size_pretty` — and therefore every size figure a
 * person has read from this database — already means. If the meter on the
 * dashboard ever disagrees with this screen by about that much, this constant is
 * why, and the dashboard is right.
 */
export const FREE_TIER_DB_BYTES = 500 * 1024 * 1024;

/**
 * Vercel's Hobby allowance of image transformations a month. The app cannot
 * read the meter, so `image_usage()` counts the thing that drives it: with one
 * width, one quality and a 31-day cache (next.config.ts), transformations are
 * at most distinct players opened in the month. Calendar month here; Vercel's
 * cycle starts on the account's own date, so the two can straddle by a few
 * days, and the dashboard is the meter of record.
 */
export const IMAGE_TRANSFORMS_MONTH = 5_000;

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * A size, the way `pg_size_pretty` would put it: one unit, one decimal at most.
 * Bytes stay whole; nobody needs "512.0 bytes".
 */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${trim(bytes / GB)} GB`;
  if (bytes >= MB) return `${trim(bytes / MB)} MB`;
  if (bytes >= KB) return `${trim(bytes / KB)} kB`;
  return `${bytes} bytes`;
}

/** One decimal below ten, whole numbers above — "1.2 GB", "78 MB", "412 kB". */
function trim(value: number): string {
  return value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value).toString();
}

/** A whole number with thousands separators, or an em dash for null. */
export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, in the coarsest unit that is still honest.
 *
 * "never" for null, because on this screen a null timestamp is a member who has
 * not come — the fact the screen exists to show — and an em dash would make it
 * look like missing data. Under a minute is "just now"; after that minutes,
 * hours, then days without limit — a member last here 40 days ago should read
 * as 40 days, not "1 month", because the draft is a date and a day count is what
 * you subtract from one.
 */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const elapsed = Math.max(0, now - new Date(iso).getTime());

  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  return days === 1 ? "yesterday" : `${days} d ago`;
}

/**
 * The unambiguous version, for a `title` — the same shape `datelineStamp` uses,
 * so a stamp reads the same wherever it appears in this app.
 */
export function stamp(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  return `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/**
 * A date, for a fact rather than a recency — when an address was added, which
 * day a month started. "Aug 16" ages better than "2 d ago" will by November.
 * Year appended only when it is not the current one, so the common case stays
 * short. UTC, like every stamp in this app.
 */
export function day(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/**
 * How long a run took. Seconds under two minutes, else minutes and seconds; a
 * run with no end yet is "running", which is also its status.
 */
export function duration(start: string, end: string | null): string {
  if (!end) return "running";
  const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  if (seconds < 120) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/**
 * The device, from a user agent, in one word.
 *
 * Deliberately coarse. The mobile redesign asks one question of this column —
 * phone or not — and a user agent is a self-description that lies about the
 * details anyway (every browser claims to be Mozilla; iPadOS claims to be a
 * Mac). Order matters: "iPhone" and "Android" appear before the desktop
 * strings they also contain.
 */
export function device(userAgent: string | null | undefined): string {
  if (!userAgent) return "—";
  const ua = userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux";
  return "other";
}

/**
 * The parts of a `member_activity()` result the screen shows separately: the
 * allowlist, and any address that signed in without being on it.
 */
export function splitMembers(rows: MemberActivity[]): {
  members: MemberActivity[];
  strangers: MemberActivity[];
} {
  return {
    members: rows.filter((row) => row.added_at != null),
    strangers: rows.filter((row) => row.added_at == null),
  };
}
