-- What the market asked, against what the season returned.
--
-- 0007 backfilled a decade of draft prices and nothing has ever read them. The
-- app could already say where a season finished among startable players at a
-- position (0008), and could never say where it *started* — so every rank on a
-- player page was a result with no price beside it, which is half of the only
-- question a drafter is asking.
--
-- ---------------------------------------------------------------------------
-- WHY A RANK AND NOT THE ADP ITSELF.
--
-- adp_history.adp is an overall pick number: 13.2 means mid-second round. The
-- rank it sits beside is positional — "WR3". Putting 13.2 next to WR3 asks the
-- reader to convert between two scales in their head, which is the mistake
-- 0008 was written to stop making. So this returns the price expressed the same
-- way the result is: the player's ordinal among everyone at his position who
-- carried a price that season. "Drafted WR8, finished WR3" needs no conversion.
--
-- The raw adp is returned as well, because it is the number every other source
-- prints and the UI wants it in a title. It is not the figure on the row.
--
-- ---------------------------------------------------------------------------
-- THE TWO POOLS ARE NOT THE SAME SIZE, AND THAT IS NOT A DEFECT.
--
-- The draft rank is out of the players who were drafted at that position — 64
-- running backs in 2025. The finish rank from position_context() is out of
-- everyone who played one — 151. Both are honest ordinals about the same
-- position in the same season, and neither is a percentage, so they compare
-- directly in the range that matters. It is also what makes a bust legible: a
-- back drafted 1st of 64 who finishes 68th could not produce a number past the
-- end of his own draft pool if the two were forced to share one.
--
-- Both pool sizes travel with their ranks so a reader can see the denominators.
--
-- ---------------------------------------------------------------------------
-- POSITION COMES FROM THE SOURCE THAT PRICED HIM, deliberately, and it is the
-- one place this function disagrees with position_context(). That function
-- takes position from the weeks via mode(), because it is describing what a
-- player *did*. This is describing what the market *bought*, and the market
-- bought him as whatever it listed him as. Measured: 8 of the 1,818 (player,
-- season) pairs that have both a price and a played position differ, 0.4%. When
-- they do the two cells carry different position letters, which is the truth
-- about that season rather than a glitch to reconcile away — 2025's only case
-- is Travis Hunter, drafted WR33 and playing corner, and "WR33 / CB1" is a
-- better description of that season than either label alone.
--
-- FFC spells kickers PK where nflverse spells them K. Folded here, the same way
-- ff.identity's alias table folds it on the ingest side. It is not cosmetic:
-- unfolded, every one of the 184 kickers reads as a position disagreement, and
-- that is where the rate above would otherwise have come from.
--
-- SECURITY INVOKER like every other read function here, so 0002's allowlist
-- applies unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.draft_value(
    p_player_ids text[],
    -- Named rather than assumed. adp_history's primary key includes `source`
    -- precisely because one player in one season can carry a price from more
    -- than one aggregator, and ranking across a mixture would produce an
    -- ordinal that is partly a change in the players and partly a change in
    -- who was asked. Today there is exactly one source; the parameter is what
    -- keeps that from becoming an accident when there is a second.
    p_source     text default 'ffc_ppr_12'
)
returns table (
    player_id     text,
    season        integer,
    "position"    text,
    adp           double precision,
    rank          integer,
    pool          integer,
    -- How much the number is worth. 303 drafts in 2012 against 8,470 in 2025 is
    -- not the same evidence, and the row should be able to say so.
    times_drafted integer,
    stdev         double precision
)
language sql
stable
set search_path = public
as $$
    -- No scoping CTE, unlike position_context(): the whole table is 2,936 rows
    -- across fifteen seasons, so ranking all of it costs less than the join
    -- that would narrow it. Revisit if this ever accumulates a decade more.
    with priced as (
        select
            h.player_id,
            h.season,
            case upper(h."position") when 'PK' then 'K' else upper(h."position") end
                as pos,
            h.adp,
            h.times_drafted,
            h.stdev
        from adp_history h
        where h.source = p_source
          and h.player_id is not null
    ),
    ranked as (
        select
            p.*,
            -- adp, then player_id: ties are real (two players at 110.8) and a
            -- rerun on unchanged input must not reorder them. Same discipline
            -- as attach_player_ids' tiebreak, for the same reason.
            row_number() over (partition by p.season, p.pos order by p.adp, p.player_id)
                as rnk,
            count(*)    over (partition by p.season, p.pos) as pool_size
        from priced p
    )
    select
        r.player_id,
        r.season,
        r.pos,
        r.adp,
        r.rnk::integer,
        r.pool_size::integer,
        r.times_drafted,
        r.stdev
    from ranked r
    where r.player_id = any (p_player_ids)
    order by r.player_id, r.season desc;
$$;

revoke execute on function public.draft_value(text[], text) from public, anon;
grant execute on function public.draft_value(text[], text) to authenticated;
