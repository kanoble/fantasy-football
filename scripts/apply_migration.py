"""Apply one migration to the live database, and say what it did.

There is no migration runner in this project and there does not need to be —
migrations are applied by hand, once, in order, the way ``0009`` and ``0010``
were. What there does need to be is one command that cannot be got wrong, since
the alternative is a psql invocation reconstructed from memory against a
production database.

    uv run python scripts/apply_migration.py supabase/migrations/0011_adp_spread.sql

It reads ``.env.local`` on its own. That is the whole reason this file exists
rather than a shell one-liner: ``ff.config`` calls ``load_dotenv()``, which reads
``.env`` and not ``.env.local``, so every hand-run task against the live database
has needed the connection string exported first — documented in the handover as
one of the three things that will otherwise cost you time.

The migration runs inside a single transaction and is rolled back on any error,
so a file that fails halfway leaves nothing behind. Postgres does DDL
transactionally, which is what makes that true rather than merely hoped for.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
ENV_LOCAL = ROOT / ".env.local"
VAR = "POSTGRES_URL_NON_POOLING"


def connection_string() -> str:
    """The direct (non-pooling) URL, from the environment or ``.env.local``.

    Non-pooling because this is DDL: the pooled endpoint multiplexes statements
    across backends, which is wrong for anything transactional and schema-level.
    """
    import os

    if value := os.environ.get(VAR):
        return value

    if not ENV_LOCAL.exists():
        sys.exit(
            f"No {VAR} in the environment and no {ENV_LOCAL.name} to read it from.\n"
            "Run `vercel env pull` after linking, or export it yourself."
        )

    for line in ENV_LOCAL.read_text().splitlines():
        if match := re.match(rf"^{VAR}=(.*)$", line.strip()):
            return match.group(1).strip().strip('"').strip("'")

    sys.exit(f"{ENV_LOCAL.name} exists but has no {VAR} line.")


def functions_in(sql: str) -> list[str]:
    """Every function the migration creates, so its grants can be checked.

    Parsed from the text rather than passed in, because the point is to check
    what the file actually did and not what the caller believed it would do.
    """
    return sorted(
        set(re.findall(r"create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)", sql, re.I))
    )


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(f"usage: {Path(sys.argv[0]).name} <path to .sql>")

    path = Path(sys.argv[1])
    if not path.exists():
        sys.exit(f"no such migration: {path}")

    sql = path.read_text()

    with psycopg.connect(connection_string()) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print(f"applied {path}")

        for name in functions_in(sql):
            with conn.cursor() as cur:
                # Every read in this schema is SECURITY INVOKER so that 0002's
                # allowlist keeps applying, and every one revokes from
                # public/anon before granting to authenticated. A migration that
                # silently skipped that pair would leave a function readable by
                # anyone with the anon key.
                cur.execute(
                    """
                    select p.prosecdef,
                           has_function_privilege('anon',          p.oid, 'EXECUTE'),
                           has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                    where p.proname = %s and n.nspname = 'public'
                    """,
                    (name,),
                )
                rows = cur.fetchall()

            if not rows:
                print(f"  {name}: NOT FOUND after apply")
                continue

            for secdef, anon, authed in rows:
                flags = [
                    "security definer" if secdef else "security invoker",
                    "anon CAN EXECUTE" if anon else "anon revoked",
                    "authenticated granted" if authed else "authenticated NOT granted",
                ]
                suspect = secdef or anon or not authed
                print(f"  {name}: {', '.join(flags)}{'   <-- check this' if suspect else ''}")


if __name__ == "__main__":
    main()
