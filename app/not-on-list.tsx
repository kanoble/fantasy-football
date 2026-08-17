import { Crest } from "./chrome";

/**
 * What a signed-in address that is not on the league allowlist sees.
 *
 * RLS returns a non-member zero rows rather than an error, so every screen that
 * reads league data has the same failure to explain: without saying this, the
 * page is an empty one, indistinguishable from a broken query and the most
 * miserable kind of thing to debug. Shared so the three screens cannot drift
 * into explaining it three different ways.
 */
export function NotOnList({ email }: { email: string | undefined }) {
  return (
    <div className="gate-card">
      {/* No app bar on this screen — tabs to sections that would return this
          reader zero rows are an invitation to three more empty pages. The
          crest still says whose app they have reached. */}
      <Crest size={34} />
      <h1>Not on the league list</h1>
      <p>
        You are signed in as <code>{email}</code>, but that address is not in{" "}
        <code>league_members</code>, so the database returns nothing for it. Ask
        Kevin to add it.
      </p>
      <form action="/auth/signout" method="post">
        <button className="linkish" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}
