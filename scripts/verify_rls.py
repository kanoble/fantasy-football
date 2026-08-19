"""Walk every allowlist-protected function, as five different readers.

    uv run python scripts/verify_rls.py                 # everything
    uv run python scripts/verify_rls.py adp_spread      # one function

Migrations ``0008`` through ``0011`` each got this walk by hand, written fresh
into a scratchpad every time and thrown away after. That is the same shape of
problem ``apply_migration.py`` was written for: a step done on every migration,
reconstructed from memory against the live database, where the failure mode is
believing a function is protected when it is not.

The five readers, and why each one exists:

* **a member** — reads rows. If this fails nothing else in the walk means
  anything, so it is checked first and a zero row count is a failure rather than
  a pass. A walk where nobody can read is a walk where everybody is refused, and
  that is indistinguishable from a working allowlist.
* **the same member, cased differently** — reads the *same* rows. ``0002``
  case-folds the allowlist, and Google is under no obligation to send the
  address in the case it was entered in.
* **a non-member** — reads zero. Not an error: RLS returns an empty set, which
  is why `lib/queries.ts` asks `is_league_member()` separately rather than
  inferring membership from emptiness.
* **a token carrying no `email` claim** — reads zero. The policies compare
  against a claim that a JWT is not required to have, and a null comparison in
  SQL is neither true nor false.
* **the `anon` role** — is refused outright, at the grant rather than the policy.
  Every function in this schema revokes from ``public, anon`` before granting to
  ``authenticated``, and dropping a function drops its grants, so a recreated
  function can lose this silently.

Nothing here is passed in. The functions are read from ``pg_proc`` by grant, the
arguments they need are read from their own signatures, and the values filling
those arguments are read from the tables — so a migration that adds a function
is covered by this the moment it is applied, without anybody remembering to add
it here.

Run bare. Naming a function walks only that one, which is quicker and worth
less: the whole-schema run is its own control, in that a harness broken in a way
that flatters one function would have to flatter all twelve identically.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import sys
import time
from pathlib import Path

import httpx
import psycopg

ROOT = Path(__file__).resolve().parent.parent
ENV_LOCAL = ROOT / ".env.local"

# Functions granted to `authenticated` that are deliberately not allowlisted,
# with the reason. Anything here still has to refuse `anon` — that half is a
# grant, and it applies to every function in the schema without exception.
NO_ALLOWLIST = {
    "position_starters": (
        "a pure lookup: a CASE over a position string that reads no table, so "
        "there is no allowlist to apply and nothing to leak"
    ),
}

# Functions (0012) that answer only an admin — `role = 'admin'` on the allowlist.
# Walked as the admin where the others are walked as a member, plus one extra
# reader: a member who is NOT the admin, who must read nothing. That reader is
# the whole point of the set, and is skipped with a note when the allowlist
# holds no such member to be.
ADMIN_ONLY = {
    "is_league_admin",
    "member_activity",
    "pipeline_history",
    "storage_report",
    "image_usage",
}

# Functions that write. Calling one as a member would put a row in the table
# it exists to append to, and there is no row count for a member to "read", so
# only the `anon` refusal is checked — the half that is a grant and applies to
# everything. The read side is exercised through the admin functions above.
WRITES = {
    "record_access": "appends to access_log; walked as a read it would write",
}


def env(name: str) -> str:
    """One variable from ``.env.local``.

    Read here rather than through ``ff.config``, which calls ``load_dotenv()``
    and therefore reads ``.env``. Same reasoning as ``apply_migration.py``: the
    thing you run by hand against production should not need an ``export`` in
    front of it that can be lost in a paste.
    """
    import os

    if value := os.environ.get(name):
        return value

    if not ENV_LOCAL.exists():
        sys.exit(f"No {name} in the environment and no {ENV_LOCAL.name} to read it from.")

    for line in ENV_LOCAL.read_text().splitlines():
        if match := re.match(rf"^{name}=(.*)$", line.strip()):
            return match.group(1).strip().strip('"').strip("'")

    sys.exit(f"{ENV_LOCAL.name} exists but has no {name} line.")


URL = env("NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
ANON_KEY = env("NEXT_PUBLIC_SUPABASE_ANON_KEY")
JWT_SECRET = env("SUPABASE_JWT_SECRET")


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def token(claims: dict) -> str:
    """An HS256 JWT, hand-rolled rather than adding a dependency for one script."""
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(json.dumps(claims, separators=(",", ":")).encode())
    signature = hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256)
    return f"{header}.{payload}.{b64(signature.digest())}"


def reader(email: str | None, role: str = "authenticated") -> str:
    claims = {
        "aud": "authenticated",
        "role": role,
        "sub": "00000000-0000-4000-8000-000000000001",
        "iat": int(time.time()),
        "exp": int(time.time()) + 600,
    }
    if email is not None:
        claims["email"] = email
    return token(claims)


def call(fn: str, jwt: str, body: dict) -> tuple[int, object]:
    """One RPC over REST, as PostgREST sees it — which is how the app reaches it.

    Deliberately not psycopg. A direct connection authenticates as the database
    owner and would sail through policies that the app has to satisfy; the whole
    question here is what happens to a browser holding a session token.
    """
    response = httpx.post(
        f"{URL}/rest/v1/rpc/{fn}",
        headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {jwt}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=30,
    )
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, response.text


def rows_in(payload: object) -> int | None:
    """How much a reader got back, or None if the answer was not data at all.

    Not every function in this schema returns a set. `is_league_member()`
    returns a bare boolean and `position_starters()` a bare integer, so a walk
    that only understood lists would report the interesting half of the schema
    as failing for a reason that was about the harness.

    `false` counts as nothing, which is not a general rule about booleans but the
    specific meaning of the one function that returns one: it answers the
    allowlist question directly. Any other scalar counts as something, and null
    as nothing — which is what a `SECURITY INVOKER` scalar reading a table it
    cannot see comes back as.
    """
    if isinstance(payload, bool):
        return 1 if payload else 0
    if isinstance(payload, list):
        return len(payload)
    if payload is None:
        return 0
    if isinstance(payload, (int, float, str)):
        return 1
    # A dict, i.e. PostgREST describing a refusal rather than answering.
    return None


def describe(status: int, payload: object) -> str:
    count = rows_in(payload)
    if count is not None:
        return f"{count} rows"
    if isinstance(payload, dict):
        return str(payload.get("message", payload))[:60]
    return str(payload)[:60]


def granted_functions(cur) -> dict[str, list[tuple[str, bool]]]:
    """Every function `authenticated` may execute, with its input arguments.

    Arguments come from ``proargnames`` filtered by ``proargmodes``, because a
    ``returns table`` function lists its output columns in ``proargnames`` too —
    reading them as inputs would invent a dozen arguments that do not exist.
    ``pronargdefaults`` then says how many of the trailing inputs are optional.
    """
    cur.execute(
        """
        select p.proname, p.proargnames, p.proargmodes, p.pronargs, p.pronargdefaults
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind = 'f'
          and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        order by p.proname
        """
    )

    functions: dict[str, list[tuple[str, bool]]] = {}
    for name, argnames, argmodes, nargs, ndefaults in cur.fetchall():
        argnames = argnames or []
        if argmodes is None:
            inputs = list(argnames)
        else:
            pairs = zip(argnames, argmodes, strict=True)
            inputs = [n for n, mode in pairs if mode in ("i", "b", "v")]

        required = (nargs or 0) - (ndefaults or 0)
        functions[name] = [(arg, index < required) for index, arg in enumerate(inputs)]

    return functions


def fixtures(cur) -> dict[str, object]:
    """A value for every argument name in the schema, read from the data.

    Read rather than declared so that this cannot drift the way a constant
    would: the seasons move every year, and a walk that asked about 2025 in 2027
    would report zero rows for a member and call the allowlist broken.
    """

    def scalar(sql: str, *args) -> object:
        cur.execute(sql, args)
        row = cur.fetchone()
        return row[0] if row else None

    adp_season = scalar("select max(season) from adp_projections")
    stat_season = scalar("select max(season) from scored_weekly_stats")

    # The busiest player of the most recent season, so "a member reads rows" is
    # a real assertion rather than a coincidence of which id came back first.
    player_id = scalar(
        """
        select player_id from scored_weekly_stats
        where season = %s and player_id is not null
        group by player_id order by count(*) desc, player_id limit 1
        """,
        stat_season,
    )

    return {
        "p_adp_season": adp_season,
        "p_stat_season": stat_season,
        "p_season": stat_season,
        "p_player_id": player_id,
        "p_player_ids": [player_id],
        "p_source": scalar(
            "select source from adp_history group by source order by count(*) desc limit 1"
        ),
        # The thresholds and the league size are all defaulted in SQL, so these
        # are only ever reached if a future function makes one of them required.
        # LEAGUE_TEAMS in lib/board.ts is the same 12.
        "p_ceiling": 20,
        "p_floor": 10,
        "p_teams": 12,
        "p_seasons": 3,
        "p_position": "RB",
        # record_access() is in WRITES and only its anon refusal is checked, but
        # the request still needs a body — and this one must be a value the
        # check constraint accepts, so that if the walk ever did reach the
        # table it would fail on the grant and not on the argument.
        "p_kind": "visit",
    }


def body_for(args: list[tuple[str, bool]], values: dict[str, object]) -> dict | None:
    """The request body, or None if an argument has no fixture.

    Only the required arguments are filled. The defaults are what the app itself
    leaves alone — `market_value()`, `draft_value()` and `adp_spread()` all keep
    their source in SQL on purpose — so exercising them here is exercising the
    real call.
    """
    body = {}
    for name, required in args:
        if not required:
            continue
        if name not in values or values[name] is None:
            return None
        body[name] = values[name]
    return body


def main() -> None:
    wanted = sys.argv[1:]

    with psycopg.connect(env("POSTGRES_URL_NON_POOLING")) as conn, conn.cursor() as cur:
        cur.execute("select email from league_members order by email limit 1")
        row = cur.fetchone()
        if not row:
            sys.exit("league_members is empty; there is no member to verify as.")
        member = row[0]

        # 0012 adds `role`; before it is applied there is no admin and no
        # column, and the admin functions are not there to walk either.
        cur.execute(
            "select exists (select 1 from information_schema.columns "
            "where table_name = 'league_members' and column_name = 'role')"
        )
        admin = plain_member = None
        if cur.fetchone()[0]:
            by_role = (
                "select email from league_members where role %s 'admin' order by email limit 1"
            )
            cur.execute(by_role % "=")
            admin = (cur.fetchone() or [None])[0]
            cur.execute(by_role % "<>")
            plain_member = (cur.fetchone() or [None])[0]

        functions = granted_functions(cur)
        values = fixtures(cur)

    if wanted:
        missing = [name for name in wanted if name not in functions]
        if missing:
            sys.exit(f"not granted to authenticated, or not in public: {', '.join(missing)}")
        functions = {name: functions[name] for name in wanted}
        print("Walking part of the schema, so this run is not its own control.\n")

    def masked(email: str | None) -> str:
        if not email:
            return "none"
        local, domain = email.split("@", 1)
        return f"{local[:3]}***@{domain}"

    print(f"member on the allowlist: {masked(member)}")
    print(f"admin: {masked(admin)} · member who is not the admin: {masked(plain_member)}")
    print(
        f"prices {values['p_adp_season']}, stats {values['p_stat_season']}, "
        f"source {values['p_source']}, player {values['p_player_id']}\n"
    )

    def readers_for(name: str) -> list[tuple[str, str, str]]:
        """Who calls the function, and what each should get back."""
        if name in ADMIN_ONLY:
            if not admin:
                return []
            return [
                ("admin", reader(admin), "rows"),
                ("admin, cased differently", reader(admin.upper()), "same"),
                (
                    "member, not the admin",
                    reader(plain_member) if plain_member else "",
                    "empty" if plain_member else "skip",
                ),
                ("non-member", reader("nobody@example.invalid"), "empty"),
                ("no email claim", reader(None), "empty"),
                ("anon role", reader(admin, role="anon"), "refused"),
            ]
        return [
            ("member", reader(member), "rows"),
            ("member, cased differently", reader(member.upper()), "same"),
            ("non-member", reader("nobody@example.invalid"), "empty"),
            ("no email claim", reader(None), "empty"),
            ("anon role", reader(member, role="anon"), "refused"),
        ]

    checks = 0
    failures: list[str] = []

    for name, args in functions.items():
        exempt = NO_ALLOWLIST.get(name)
        writes = WRITES.get(name)
        signature = ", ".join(arg for arg, _ in args)
        print(f"=== {name}({signature}) ===")
        if exempt:
            print(f"  not allowlisted by design — {exempt}")
        if writes:
            print(f"  a write — {writes}; only the anon refusal is checked")
        if name in ADMIN_ONLY:
            print("  admin only — walked as the admin, and as a member who is not")

        readers = readers_for(name)
        if not readers:
            print("  NO ADMIN on the allowlist — not walked")
            failures.append(f"{name}: admin-only, but league_members has no role = 'admin'")
            print()
            continue

        body = body_for(args, values)
        if body is None:
            unfilled = [arg for arg, required in args if required and arg not in values]
            print(f"  NO FIXTURE for {', '.join(unfilled)} — not walked")
            failures.append(f"{name}: no fixture for {', '.join(unfilled)}")
            print()
            continue

        member_rows: int | None = None

        for label, jwt, expect in readers:
            # The allowlist half is meaningless for a function that has none,
            # and a write is not read; the anon half applies to every function
            # in the schema regardless.
            if (exempt or writes) and expect != "refused":
                print(f"  {label:<26} —    skipped")
                continue
            if expect == "skip":
                print(f"  {label:<26} —    skipped (no such member on the list)")
                continue

            status, payload = call(name, jwt, body)
            count = rows_in(payload)
            checks += 1

            got = f"{status}, {describe(status, payload)}"

            if expect == "rows":
                member_rows = count
                ok = status == 200 and (count or 0) > 0
                why = f"the member got {got}, so nothing below this proves anything"
            elif expect == "same":
                ok = status == 200 and count == member_rows
                why = f"got {got} where the member got {member_rows} rows — case-folding"
            elif expect == "empty":
                ok = status == 200 and count == 0
                why = f"got {got} and should have read nothing"
            else:
                ok = status in (401, 403)
                why = f"got {got} rather than being refused at the grant"

            verdict = "ok" if ok else "FAIL"
            print(f"  {label:<26} {status}  {describe(status, payload):<46} {verdict}")
            if not ok:
                failures.append(f"{name}, as {label}: {why}")

        print()

    walked = f"{len(functions)} function{'' if len(functions) == 1 else 's'}"
    walked += f", {checks} check{'' if checks == 1 else 's'}"

    if failures:
        print(f"{walked}, {len(failures)} FAILED:\n")
        for failure in failures:
            print(f"  {failure}")
        sys.exit(1)

    print(f"{walked}, all passed.")


if __name__ == "__main__":
    main()
