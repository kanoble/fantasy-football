-- An admin, and a record of who has been in.
--
-- Until 2026-08-18 the allowlist held one address, so "who is using this" had
-- one answer and needed no screen. A second person is on it now, with eleven
-- more to follow, and the two things Kevin asked to see are the two things the
-- app could not say: whether a member has signed in, and when they were last
-- here. Alongside them, the ceilings — how far the database is from the free
-- tier's 500 MB, and whether the nightly refresh is still running — which
-- P3 in the handover asked for before more people were behind the login.
--
-- Three additions. A `role` on the allowlist, so there is such a thing as an
-- admin; a table the app appends to on sign-in and on a page load; and the
-- functions that read them back, which answer only an admin.
--
-- Nothing here changes what a member sees. Every existing policy and function
-- is untouched; a member's reach is exactly what it was.

-- ---------------------------------------------------------------------------
-- The admin notion.
--
-- A column on the allowlist rather than a second table, because the handover
-- named this as "the same column P2 wants": one place says what an address may
-- do, and a commissioner role for the draft toggle goes in the same column
-- when the shape of P2 is settled. Text with a check rather than a boolean, so
-- that day is an added value and not a second column.
-- ---------------------------------------------------------------------------
alter table league_members
    add column if not exists role text not null default 'member';

alter table league_members
    drop constraint if exists league_members_role_check;
alter table league_members
    add constraint league_members_role_check check (role in ('member', 'admin'));

update league_members set role = 'admin' where email = 'kanoble@gmail.com';

-- Same shape as is_league_member() in 0002, and security definer for the same
-- reason: league_members has no policy, on purpose, so an invoker-rights
-- function would see zero rows and every admin would be told they are not one.
create or replace function public.is_league_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from league_members
        where email = lower(auth.jwt() ->> 'email')
          and role = 'admin'
    );
$$;

revoke execute on function public.is_league_admin() from public, anon;
grant execute on function public.is_league_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- The record.
--
-- Append-only. Three kinds of row: a `sign_in`, written by the OAuth callback
-- the moment a code is exchanged for a session; a `visit`, written by the
-- request proxy no more than once every ten minutes per browser; and a `view`,
-- written by the proxy for every load of a player page, with the path. All are
-- written through record_access() below and never directly, so this table
-- carries no policy at all — the same posture as league_members. A member has
-- no business reading when the others were last here.
--
-- `view` rows exist for one meter. Vercel's Hobby tier allows 5,000 image
-- transformations a month and gives the app no way to read the count; but
-- next.config.ts pins one width, one quality and a 31-day cache, and portraits
-- appear on /player/[id] only, so the count is bounded above by *distinct
-- players opened in a month* — and that, the app can count for itself.
--
-- Keyed on the address rather than auth.users.id, deliberately. The allowlist
-- is keyed on the address, and the point of the admin screen is to lay one
-- against the other: who is on the list and has never come, and who has come
-- and is not on the list. A uuid would make that a join through a schema this
-- app otherwise never reads.
--
-- The user agent is kept because the mobile redesign (docs/mobile-redesign.md)
-- turns on a question this is the only evidence for: are the relatives opening
-- it on a phone. Truncated on the way in; it is a browser's self-description
-- and some of them run long.
-- ---------------------------------------------------------------------------
create table if not exists access_log (
    id         bigserial   primary key,
    email      text        not null,
    kind       text        not null check (kind in ('sign_in', 'visit', 'view')),
    at         timestamptz not null default now(),
    user_agent text,
    -- The page, for `view` rows only; null for the other two kinds.
    path       text
);

create index if not exists idx_access_log_email_at on access_log (email, at desc);

alter table access_log enable row level security;

-- No policy, and the default grants revoked. See 0005 for why the revoke has to
-- name `authenticated`: Supabase's default privileges hand every new table in
-- `public` to that role in full, and RLS is not consulted for TRUNCATE. This is
-- a table nothing but the two functions below should touch, and they run as
-- their owner.
revoke all on public.access_log from public, anon, authenticated;
revoke all on sequence public.access_log_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writing a row.
--
-- Called by the app as the signed-in user, so it has to be granted to
-- `authenticated`; and it writes to a table that role cannot see, so it has to
-- be security definer. The address is taken from the JWT and never from an
-- argument: a caller says what kind of event this is and nothing about who.
--
-- Three guards. A token with no email claim writes nothing, because a row with
-- no address is a row about nobody. A second row of the same kind and path for
-- the same address inside a minute is dropped, so a reload is one row. And no
-- address writes more than 600 rows an hour, so a member who finds the endpoint
-- and calls it in a loop with a fresh path each time fills an hour's worth and
-- no more — the cookie in proxy.ts is the throttle for the honest path; these
-- are the ones for the other.
--
-- Anyone signed in is recorded, member or not. Signups are closed, so "signed
-- in and not on the list" means an address Kevin pre-created and then did not
-- add — which is precisely the mismatch the admin screen exists to show.
--
-- Returns void, which is why scripts/verify_rls.py lists it under WRITES: there
-- is no row count for a member to read, and walking it as a read would write.
-- ---------------------------------------------------------------------------
create or replace function public.record_access(
    p_kind       text,
    p_user_agent text default null,
    p_path       text default null
)
returns void
language sql
security definer
set search_path = public
as $$
    insert into access_log (email, kind, user_agent, path)
    select lower(auth.jwt() ->> 'email'), p_kind, left(p_user_agent, 300), left(p_path, 200)
    where auth.jwt() ->> 'email' is not null
      and not exists (
          select 1
          from access_log a
          where a.email = lower(auth.jwt() ->> 'email')
            and a.kind = p_kind
            and a.path is not distinct from left(p_path, 200)
            and a.at > now() - interval '1 minute'
      )
      and (
          select count(*)
          from access_log a
          where a.email = lower(auth.jwt() ->> 'email')
            and a.at > now() - interval '1 hour'
      ) < 600;
$$;

revoke execute on function public.record_access(text, text, text) from public, anon;
grant execute on function public.record_access(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading it back: the allowlist laid against the record.
--
-- One row per address that is on the list OR has ever signed in. A member who
-- has never come has nulls on the right; an address that came and is not on
-- the list has nulls on the left (`added_at` null is the tell). Answers only an
-- admin — the `where` is the whole access control, and it has to be, because
-- security definer bypasses the RLS that would otherwise do it.
--
-- `sign_ins` counts sign-in rows only. `last_seen` is the newest row of either
-- kind, so it moves on a page load and not just on a fresh Google round trip —
-- which is what "last access" means to the person asking.
-- ---------------------------------------------------------------------------
create or replace function public.member_activity()
returns table (
    email           text,
    note            text,
    role            text,
    added_at        timestamptz,
    first_seen      timestamptz,
    last_seen       timestamptz,
    sign_ins        bigint,
    last_sign_in    timestamptz,
    last_user_agent text
)
language sql
stable
security definer
set search_path = public
as $$
    with seen as (
        select
            a.email,
            min(a.at)                                          as first_seen,
            max(a.at)                                          as last_seen,
            count(*) filter (where a.kind = 'sign_in')         as sign_ins,
            max(a.at) filter (where a.kind = 'sign_in')        as last_sign_in,
            -- The newest agent that was recorded, not the newest row's: a
            -- sign-in and a visit seconds apart may carry it on only one.
            (array_agg(a.user_agent order by a.at desc)
                filter (where a.user_agent is not null))[1]     as last_user_agent
        from access_log a
        group by a.email
    )
    select
        coalesce(m.email, s.email),
        m.note,
        m.role,
        m.added_at,
        s.first_seen,
        s.last_seen,
        coalesce(s.sign_ins, 0),
        s.last_sign_in,
        s.last_user_agent
    from league_members m
    full outer join seen s on s.email = m.email
    where public.is_league_admin()
    order by s.last_seen desc nulls last, m.added_at, coalesce(m.email, s.email);
$$;

revoke execute on function public.member_activity() from public, anon;
grant execute on function public.member_activity() to authenticated;

-- ---------------------------------------------------------------------------
-- The image meter.
--
-- One row, always, for an admin: how many distinct player pages have been
-- opened since the first of the month, and how many opens that took. The first
-- is the upper bound on Vercel image transformations for the reason given on
-- the table above; the ceiling (5,000) lives in lib/admin.ts beside the other
-- one, because it is Vercel's number and not the database's. Calendar month
-- rather than Vercel's billing cycle, whose start date the app does not know —
-- the screen says which.
-- ---------------------------------------------------------------------------
create or replace function public.image_usage()
returns table (
    distinct_players bigint,
    views            bigint,
    since            timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select
        count(distinct a.path),
        count(*),
        date_trunc('month', now())
    from access_log a
    where a.kind = 'view'
      and a.at >= date_trunc('month', now())
    -- HAVING, not WHERE: an aggregate with no GROUP BY returns one row however
    -- empty its input, so a WHERE would hand a non-admin a row of zeros.
    having public.is_league_admin();
$$;

revoke execute on function public.image_usage() from public, anon;
grant execute on function public.image_usage() to authenticated;

-- ---------------------------------------------------------------------------
-- The refresh log, at last on a screen.
--
-- 0001 created pipeline_runs with the comment "cron failures are invisible
-- without one" and then, correctly, gave nobody a policy on it — error strings
-- are operational. data_freshness() (0003) exposes one timestamp from it to
-- every member. This exposes the rest to the admin: the most recent runs, with
-- status, mode, the reason for a full rebuild, what was written and what went
-- wrong. It is the same fact the Vercel cron dashboard shows, read from the
-- database this app already talks to rather than from a platform that needs a
-- token.
-- ---------------------------------------------------------------------------
create or replace function public.pipeline_history(p_limit integer default 14)
returns table (
    id           bigint,
    started_at   timestamptz,
    finished_at  timestamptz,
    status       text,
    mode         text,
    reason       text,
    rows_written jsonb,
    error        text
)
language sql
stable
security definer
set search_path = public
as $$
    select r.id, r.started_at, r.finished_at, r.status, r.mode, r.reason,
           r.rows_written, r.error
    from pipeline_runs r
    where public.is_league_admin()
    order by r.started_at desc
    limit greatest(1, least(p_limit, 100));
$$;

revoke execute on function public.pipeline_history(integer) from public, anon;
grant execute on function public.pipeline_history(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage against the ceiling.
--
-- Supabase's free tier caps the database at 500 MB. This is the half of P3
-- that plain SQL can answer from inside the database: the size of the whole
-- thing, and of each table in `public`, so an admin can see both how close the
-- ceiling is and what is filling the room. Egress — the meter twelve readers
-- could actually move — is not answerable from here; it lives in the platform
-- API and needs a token this app does not hold. The screen says so.
--
-- One row per table plus one for the whole database, tagged `(database)`, so a
-- caller gets the total and the parts in one round trip and cannot compute a
-- total that disagrees with the one Supabase meters. Row counts are the
-- planner's estimate (n_live_tup), which is what makes this cheap enough to
-- run on every load of the screen; an exact count over 174k rows is not.
--
-- pg_database_size and pg_total_relation_size need no privilege beyond
-- connecting, but pg_stat_user_tables only lists what the caller may see, and
-- the caller is `authenticated`. Security definer runs it as the owner, who
-- sees everything in the schema.
-- ---------------------------------------------------------------------------
create or replace function public.storage_report()
returns table (
    relation       text,
    bytes          bigint,
    estimated_rows bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select '(database)'::text, pg_database_size(current_database()), null::bigint
    where public.is_league_admin()
    union all
    select t.relname::text,
           pg_total_relation_size(t.relid),
           t.n_live_tup
    from pg_stat_user_tables t
    where t.schemaname = 'public'
      and public.is_league_admin()
    order by 2 desc;
$$;

revoke execute on function public.storage_report() from public, anon;
grant execute on function public.storage_report() to authenticated;
