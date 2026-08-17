import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { QueryError, check } from "./query-error.ts";

/**
 * The error message, under test.
 *
 * Testing a string is normally not worth the keystrokes. It is here because the
 * whole point of this module is what the message *says* — the defect it was
 * written for was an error that named neither the function nor the problem, and
 * nothing but an assertion on the text can catch that coming back.
 *
 * The case that matters most is the real one: a `PGRST202` from a migration
 * nobody applied.
 */

/** A PostgREST error, in the shape the wire actually delivers it. */
const postgrest = (fields: {
  message: string;
  code: string;
  details?: string | null;
  hint?: string | null;
}) =>
  ({
    name: "PostgrestError",
    message: fields.message,
    code: fields.code,
    // Typed `string` by the client and routinely null in practice, which is
    // exactly the discrepancy this module has to survive.
    details: (fields.details ?? null) as unknown as string,
    hint: (fields.hint ?? null) as unknown as string,
  }) as never;

describe("QueryError", () => {
  it("names the call, the code and the problem", () => {
    const error = new QueryError(
      "adp_spread()",
      postgrest({
        message: "Could not find the function public.adp_spread(p_adp_season) in the schema cache",
        code: "PGRST202",
      }),
    );

    // The failure this replaced: two overlays, and the word `adp_spread` in
    // neither of them.
    assert.match(error.message, /adp_spread/);
    assert.match(error.message, /PGRST202/);
    assert.match(error.message, /schema cache/);
  });

  it("carries details and hint when the database sends them", () => {
    const error = new QueryError(
      "drafted upsert (bijan robinson)",
      postgrest({
        message: "new row violates row-level security policy",
        code: "42501",
        details: "Failing row contains (2026, bijan robinson)",
        hint: "Check the allowlist",
      }),
    );

    assert.match(error.message, /drafted upsert \(bijan robinson\)/);
    assert.match(error.message, /Failing row contains/);
    assert.match(error.message, /Check the allowlist/);
  });

  it("says nothing about details and hint when they are null", () => {
    const error = new QueryError(
      "draft_board()",
      postgrest({ message: "canceling statement due to statement timeout", code: "57014" }),
    );

    // A trailing empty parenthetical reads as a truncation, which is the
    // impression this whole change exists to remove. Matched with the leading
    // space, because the label itself ends in `()` and legitimately so.
    assert.equal(error.message.includes(" ()"), false);
    assert.equal(error.message.endsWith("timeout"), true);
  });

  it("is a plain Error, with no toJSON to restructure it", () => {
    const error = new QueryError("draft_board()", postgrest({ message: "boom", code: "XX000" }));

    assert.ok(error instanceof Error);
    assert.equal(error.name, "QueryError");
    assert.equal(error.code, "XX000");
    // The raw PostgREST error is a class with a `toJSON()`, and Next serializing
    // it is what produced the unreadable overlay. Inheriting one back — via
    // `cause` or otherwise — would undo the fix silently.
    assert.equal("toJSON" in error, false);
    assert.equal(error.cause, undefined);
  });
});

describe("check", () => {
  it("passes a successful result through without throwing", () => {
    assert.doesNotThrow(() => check("draft_board()", { error: null }));
  });

  it("throws a QueryError, not the raw one", () => {
    assert.throws(
      () => check("season_form()", { error: postgrest({ message: "boom", code: "XX000" }) }),
      (error: unknown) => error instanceof QueryError && /season_form\(\)/.test((error as Error).message),
    );
  });
});
