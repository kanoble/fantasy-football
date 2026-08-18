/**
 * The `fetch` the server client uses, with one narrow retry.
 *
 * On 2026-08-18 the first sign-in against the production domain died on the
 * first page with `PGRST303: JWT issued at future`, and a reload fixed it. That
 * is two Supabase clocks disagreeing by about a second: the auth server minted
 * the token at 12:22:16, the callback redirected to `/` at once, and PostgREST
 * checked `iat` against its own clock 1.3s later and found it hadn't happened
 * yet. Nothing in this repo is wrong, and it cannot be fixed here either — the
 * skew is between two hosted components. It can only be waited out.
 *
 * So: a response carrying that code is retried once, after `RETRY_AFTER_MS`,
 * and the *second* answer is the one the caller sees. A second failure surfaces
 * exactly as it would have anyway, through `check()` and the error boundary,
 * because at that point it is not skew.
 *
 * Why here and not around `is_league_member()`: the skew is a property of the
 * token, so every RPC in the same `Promise.all` fails identically. Retrying one
 * of them saves nothing. `global.fetch` is the one seam every read on every
 * route passes through, so the wait happens once and the page simply loads a
 * second later than it otherwise would.
 *
 * Why the moment matters: this can only bite on the first request after
 * sign-in. Every later request carries a token minutes old, and skew of a
 * second is invisible against that. Which is also why the wait is short and
 * fixed rather than backoff — there is nothing to back off from.
 */

/** PostgREST's code for a JWT it will not accept yet: `iat` in the future. */
export const FRESH_TOKEN_CODE = "PGRST303";

/**
 * Longer than any skew seen so far (~1.3s) and shorter than a reader wonders
 * whether the page has hung. Paid once, on the first request after sign-in,
 * and only when the skew actually lands the wrong way.
 */
export const RETRY_AFTER_MS = 1500;

type Fetch = typeof globalThis.fetch;

/**
 * Whether this response is PostgREST refusing a token it considers not yet
 * issued. Reads a clone, so the body stays available to the caller.
 *
 * Matched on the code in the body rather than on the 401 alone, because a 401
 * is also what an expired token, a wrong key, and a revoked session all look
 * like — and none of those get better by waiting.
 */
async function isFreshTokenRefusal(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body?.code === FRESH_TOKEN_CODE;
  } catch {
    // Not JSON, or not PostgREST's shape. Not ours to retry.
    return false;
  }
}

/**
 * Wrap a `fetch` so that a `PGRST303` is retried once after a short wait.
 *
 * `sleep` is injectable so the test does not spend real time; production
 * passes nothing and gets a real timer.
 */
export function withFreshTokenRetry(
  fetchImpl: Fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Fetch {
  return async (input, init) => {
    const first = await fetchImpl(input, init);
    if (!(await isFreshTokenRefusal(first))) return first;

    // A streamed request body could not be replayed, but supabase-js sends
    // strings, so a retry with the same `init` is a faithful repeat.
    await sleep(RETRY_AFTER_MS);
    return fetchImpl(input, init);
  };
}
