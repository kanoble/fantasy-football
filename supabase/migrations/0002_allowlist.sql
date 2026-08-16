-- Enforce the league email allowlist in the database, not just at the auth layer.
--
-- 0001_init.sql granted `for select to authenticated using (true)`, and its
-- comment described that as a second line of defence. It was not one. It stops
-- anonymous visitors, but grants every *confirmed* user the entire database —
-- and the anon key ships to the browser by design in any Supabase web app, so
-- "confirmed user" means anyone on the internet willing to click a link in
-- their own inbox. Closing signups fixes that, but leaves a single dashboard
-- toggle as the only thing between a stranger and the league's data.
--
-- After this migration there are two independent barriers: signups are closed
-- (dashboard), and a JWT whose email is not in league_members reads zero rows
-- (here). Either one alone is sufficient; neither depends on the other.
--
-- The refresh job is unaffected. It connects as the service role, which
-- bypasses RLS by design.

-- ---------------------------------------------------------------------------
-- The allowlist.
--
-- Deliberately its own table rather than a hardcoded list in a policy: adding a
-- league member should be an INSERT, not a migration and a redeploy.
-- ---------------------------------------------------------------------------
create table if not exists league_members (
    email    text primary key,
    note     text,
    added_at timestamptz not null default now()
);

alter table league_members enable row level security;

-- No policy is created on this table, on purpose. It is readable only by the
-- service role and by the security-definer function below. A league member has
-- no business enumerating the other members' email addresses, and the app never
-- needs to read this table directly.

-- ---------------------------------------------------------------------------
-- Membership test.
--
-- This MUST be security definer. A policy that inlines
-- `exists (select 1 from league_members where ...)` is itself evaluated as the
-- querying role, which has no policy on league_members — so the subquery sees
-- zero rows, the exists() is always false, and every table silently returns
-- nothing. The failure looks exactly like "the data didn't load", which is a
-- miserable thing to debug. security definer runs the lookup as the function
-- owner and bypasses RLS on the allowlist only.
--
-- Email is lowercased on both sides: addresses are case-insensitive in practice
-- and a member typing Kevin@ instead of kevin@ should not be locked out.
-- ---------------------------------------------------------------------------
create or replace function public.is_league_member()
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
    );
$$;

revoke execute on function public.is_league_member() from public, anon;
grant execute on function public.is_league_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Re-point the read policies at the allowlist.
--
-- The `(select ...)` wrapper around the call is load-bearing for performance,
-- not style. Called bare, Postgres re-evaluates the function once per candidate
-- row; wrapped in a scalar subquery it becomes an InitPlan evaluated once per
-- query. On scored_weekly_stats (174k rows) that is the whole difference.
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated read" on scored_weekly_stats;
create policy "allowlisted read" on scored_weekly_stats
    for select to authenticated using ((select public.is_league_member()));

drop policy if exists "authenticated read" on player_index;
create policy "allowlisted read" on player_index
    for select to authenticated using ((select public.is_league_member()));

drop policy if exists "authenticated read" on adp_projections;
create policy "allowlisted read" on adp_projections
    for select to authenticated using ((select public.is_league_member()));

drop policy if exists "authenticated read" on injury_news;
create policy "allowlisted read" on injury_news
    for select to authenticated using ((select public.is_league_member()));

-- pipeline_runs and pipeline_meta keep no policy at all: operational data,
-- service role only. Unchanged by this migration.

-- ---------------------------------------------------------------------------
-- Seed. One member for now — there is nothing worth showing the league yet.
-- Adding the other eleven is a plain INSERT; no migration required.
-- ---------------------------------------------------------------------------
insert into league_members (email, note)
values ('kanoble@gmail.com', 'owner')
on conflict (email) do nothing;
