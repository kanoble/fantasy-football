import type { PostgrestError } from "@supabase/supabase-js";

/**
 * One legible failure for every Supabase call in this app.
 *
 * Every read and every write used to `throw` the raw PostgREST error. That is a
 * class carrying a `toJSON()`, and Next serializes a thrown server error on its
 * way to the overlay — so what rendered was the *object*, `{code: …, details: …,
 * hint: Null, message: …}`, with every field truncated to a width that named
 * neither the function nor the problem. On 2026-08-17 a missing `adp_spread()`
 * produced two overlays and the word `adp_spread` appeared in neither, which
 * cost a round trip to diagnose something the database had described precisely.
 *
 * So the whole of the diagnosis goes in `message`, which is the one field an
 * overlay, a server log and a `console.error` all render the same way and none
 * of them restructures. The PostgREST error is deliberately *not* kept as
 * `cause`: re-attaching the object is how it gets serialized back into the shape
 * it was just flattened out of.
 *
 * Not `server-only`, unlike `lib/queries.ts`, because the write path in
 * `lib/drafted.ts` runs in the browser and has exactly the same problem there —
 * with the difference that a failed mark surfaces mid-draft, which is the worst
 * moment in this app's year to be handed an unreadable error.
 */
export class QueryError extends Error {
  /**
   * The PostgREST or Postgres code, kept as a field as well as in the message
   * so a caller can branch on it without parsing prose. `PGRST202` is the one
   * worth knowing: the function does not exist, i.e. a migration was never
   * applied.
   */
  readonly code: string;

  constructor(what: string, error: PostgrestError) {
    // `details` and `hint` are typed as `string` and are routinely null on the
    // wire, so this filters rather than trusting the type.
    const extra = [error.details, error.hint].filter(Boolean).join(" — ");

    super(`${what} failed [${error.code}]: ${error.message}${extra ? ` (${extra})` : ""}`);

    this.name = "QueryError";
    this.code = error.code;
  }
}

/**
 * Throw if a call failed, saying which call it was.
 *
 * The label is passed rather than derived because there is nothing to derive it
 * from: a PostgREST response carries no record of what was asked for, which is
 * the single most useful fact when six reads run in one `Promise.all` and one of
 * them fails.
 *
 * Write it the way it reads at the call site — `"draft_board()"` for an RPC,
 * `"drafted upsert"` for a table write — since it goes into the message verbatim.
 */
export function check(what: string, result: { error: PostgrestError | null }): void {
  if (result.error) throw new QueryError(what, result.error);
}
