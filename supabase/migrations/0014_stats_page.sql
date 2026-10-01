-- $CIRCO — daily numbers for the public stats page (computed by the engine into a snapshot).
create or replace function stats_daily(p_days int)
returns table (day date, player_burn numeric, buyback_burn numeric, sol_paid numeric, buyback_sol numeric, rounds int)
language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series((now() at time zone 'utc')::date - (p_days - 1), (now() at time zone 'utc')::date, interval '1 day')::date as day
  )
  select d.day,
    coalesce((select sum(tokens) from burns_by_wallet(d.day::timestamptz, (d.day + 1)::timestamptz)), 0),
    coalesce((select sum(tokens_burned) from buybacks b where b.created_at >= d.day and b.created_at < d.day + 1), 0),
    coalesce((select sum(prize_sol + jackpot_won) from rounds r where r.phase = 'done' and r.ended_at >= d.day and r.ended_at < d.day + 1), 0),
    coalesce((select sum(sol_spent) from buybacks b where b.created_at >= d.day and b.created_at < d.day + 1), 0),
    coalesce((select count(*) from rounds r where r.phase = 'done' and r.ended_at >= d.day and r.ended_at < d.day + 1), 0)::int
  from days d order by d.day;
$$;
revoke all on function stats_daily(int) from public, anon, authenticated;

-- burns by source, all time
create or replace function burn_breakdown()
returns table (source text, tokens numeric)
language sql stable security definer set search_path = public as $$
  select 'tickets', coalesce(sum(pb.tokens), 0) from processed_burns pb
    where not exists (select 1 from games g where g.burn_tx = pb.burn_tx) and not exists (select 1 from predictions p where p.burn_tx = pb.burn_tx)
  union all select 'shooting gallery', coalesce(sum(tokens_burned), 0) from games where status = 'played'
  union all select 'stage effects', coalesce(sum(tokens), 0) from effects
  union all select 'guesses', coalesce(sum(tokens), 0) from predictions
  union all select 'buyback', coalesce(sum(tokens_burned), 0) from buybacks;
$$;
revoke all on function burn_breakdown() from public, anon, authenticated;

insert into config (key, value) values ('jackpot_cap_sol', '25') on conflict (key) do nothing;
