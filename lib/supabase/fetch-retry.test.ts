import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FRESH_TOKEN_CODE, RETRY_AFTER_MS, withFreshTokenRetry } from "./fetch-retry.ts";

/**
 * The retry, under test.
 *
 * The thing worth pinning is not that a retry happens but *when it does not*:
 * a 401 for any other reason must go straight through, or a wrong key waits
 * 1.5s to fail every time and a real outage gets a second hit it did not earn.
 */

/** A PostgREST-shaped response. */
const postgrest = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const freshTokenRefusal = () =>
  postgrest(401, { code: FRESH_TOKEN_CODE, message: "JWT issued at future" });

/** A fetch that answers from a script, and records how often it was asked. */
function scripted(...responses: Response[]) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    const next = responses.shift();
    if (!next) throw new Error("scripted fetch asked more times than scripted");
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** A sleep that records rather than waits. */
function fakeSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe("withFreshTokenRetry", () => {
  it("retries a PGRST303 once, after the wait, and returns the second answer", async () => {
    const ok = postgrest(200, [{ is_league_member: true }]);
    const { fetch, calls } = scripted(freshTokenRefusal(), ok);
    const { sleep, waits } = fakeSleep();

    const got = await withFreshTokenRetry(fetch, sleep)("https://x/rpc/is_league_member", {
      method: "POST",
      body: "{}",
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [RETRY_AFTER_MS]);
    assert.equal(got, ok);
    // Same request both times: what was refused is what gets asked again.
    assert.equal(calls[1].init?.body, "{}");
  });

  it("gives up after one retry and hands back the second failure untouched", async () => {
    const second = freshTokenRefusal();
    const { fetch, calls } = scripted(freshTokenRefusal(), second);
    const { sleep, waits } = fakeSleep();

    const got = await withFreshTokenRetry(fetch, sleep)("https://x/rpc/x");

    assert.equal(calls.length, 2);
    assert.equal(waits.length, 1);
    assert.equal(got, second);
  });

  it("does not retry a 401 for any other reason", async () => {
    const expired = postgrest(401, { code: "PGRST301", message: "JWT expired" });
    const { fetch, calls } = scripted(expired);
    const { sleep, waits } = fakeSleep();

    const got = await withFreshTokenRetry(fetch, sleep)("https://x/rpc/x");

    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
    assert.equal(got, expired);
  });

  it("does not retry a non-401, even one whose body happens to carry the code", async () => {
    // Belt and braces on the status check: nothing but a 401 is a token refusal.
    const odd = postgrest(500, { code: FRESH_TOKEN_CODE });
    const { fetch, calls } = scripted(odd);
    const { sleep } = fakeSleep();

    await withFreshTokenRetry(fetch, sleep)("https://x/rpc/x");

    assert.equal(calls.length, 1);
  });

  it("does not retry a 401 whose body is not JSON", async () => {
    const html = new Response("<html>nope</html>", { status: 401 });
    const { fetch, calls } = scripted(html);
    const { sleep } = fakeSleep();

    const got = await withFreshTokenRetry(fetch, sleep)("https://x/rpc/x");

    assert.equal(calls.length, 1);
    assert.equal(got, html);
  });

  it("leaves the body of a passed-through response readable", async () => {
    // The check reads a clone. If it ever read the original, every ordinary
    // 401 would reach the caller already consumed.
    const expired = postgrest(401, { code: "PGRST301", message: "JWT expired" });
    const { fetch } = scripted(expired);

    const got = await withFreshTokenRetry(fetch, fakeSleep().sleep)("https://x/rpc/x");
    const body = (await got.json()) as { code: string };

    assert.equal(body.code, "PGRST301");
  });
});
