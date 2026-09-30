-- $CIRCO — Mega Jackpot, paid stage effects, teams, next-balloon predictions.

insert into config (key, value) values
  ('jackpot_share', '0.05'),                 -- part of every prize-wallet fee that feeds the Mega Jackpot
  ('jackpot_chance', '0.02'),                -- chance that a draw is a Mega Pop
  ('fx_prices', '{"fireworks":2000,"confetti":2000,"horn":3000,"tomato":5000,"goldrain":10000}'),
  ('team_reward_tickets', '2'),              -- bonus tickets for each active member of the week's winning team
  ('pick_price_tokens', '10000'),            -- one guess costs one ticket
  ('pick_return', '0.9')                     -- expected value of a guess, as a share of the stake
on conflict (key) do nothing;

-- ---------- Mega Jackpot ----------
alter table fees   add column jackpot_sol numeric(18,9) not null default 0;
alter table rounds add column mega        boolean not null default false;
alter table rounds add column jackpot_won numeric(18,9) not null default 0;
alter table rounds add column next_seed   text;          -- seed revealed at close; draws the next balloon
alter table payouts drop constraint if exists payouts_kind_check;
alter table payouts add constraint payouts_kind_check check (kind in ('winner', 'bonus', 'jackpot'));

-- ---------- tickets from predictions and teams ----------
alter table tickets drop constraint if exists tickets_kind_check;
alter table tickets add constraint tickets_kind_check check (kind in ('burn', 'late', 'mission', 'carried', 'credit', 'game', 'pick', 'team'));

-- ---------- paid effects on the stage ----------
create table effects (
  id          bigserial primary key,
  wallet      text not null,
  effect      text not null check (effect in ('fireworks', 'confetti', 'horn', 'tomato', 'goldrain')),
  burn_tx     text not null unique,
  tokens      numeric(30,0) not null,
  created_at  timestamptz not null default now()
);

-- ---------- next-balloon predictions ----------
create table predictions (
  id             bigserial primary key,
  round_id       bigint not null references rounds(id),   -- the round during which the guess was made
  wallet         text not null,
  color          text not null check (color in ('green', 'blue', 'red', 'gold')),
  burn_tx        text not null unique,
  tokens         numeric(30,0) not null,
  tickets_if_win int not null,
  status         text not null default 'open' check (status in ('open', 'won', 'lost', 'refunded')),
  settled_round  bigint references rounds(id),
  created_at     timestamptz not null default now(),
  unique (round_id, wallet)
);

-- ---------- teams ----------
alter table profiles add column team        text check (team in ('clowns', 'acrobats'));
alter table profiles add column team_set_at timestamptz;
create table team_weeks (
  week_start  date primary key,
  clowns      numeric(30,0) not null,
  acrobats    numeric(30,0) not null,
  winner      text,
  rewarded    int not null default 0,
  created_at  timestamptz not null default now()
);

alter table effects     enable row level security;
alter table predictions enable row level security;
alter table team_weeks  enable row level security;
create policy "read all" on effects     for select using (true);
create policy "read all" on predictions for select using (true);
create policy "read all" on team_weeks  for select using (true);
alter publication supabase_realtime add table effects;

-- predictions and team rewards are paid (or earned) tickets: overflow above the cap becomes credit
create or replace function add_tickets(
  p_round bigint, p_wallet text, p_count int, p_kind text, p_burn_tx text, p_tokens numeric, p_cap int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  held  int := 0;
  give  int := 0;
  extra int := 0;
  is_burn boolean := p_kind in ('burn', 'late', 'game', 'pick');
begin
  if p_count < 1 then return jsonb_build_object('given', 0, 'credited', 0, 'duplicate', false); end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_round::text, 'none') || ':' || p_wallet, 0));
  if is_burn and exists (select 1 from processed_burns where burn_tx = p_burn_tx) then
    return jsonb_build_object('given', 0, 'credited', 0, 'duplicate', true);
  end if;
  if p_round is not null then
    select coalesce(sum(count), 0) into held from tickets where round_id = p_round and wallet = p_wallet;
    give := greatest(0, least(p_count, p_cap - held));
    if give > 0 then
      insert into tickets (round_id, wallet, count, kind, burn_tx, tokens_burned)
      values (p_round, p_wallet, give, p_kind, case when is_burn then p_burn_tx end, case when is_burn then p_tokens else 0 end);
    end if;
  end if;
  if is_burn or p_kind = 'team' then
    extra := p_count - give;
    if extra > 0 then
      insert into ticket_credits (wallet, tickets) values (p_wallet, extra)
      on conflict (wallet) do update set tickets = ticket_credits.tickets + excluded.tickets, updated_at = now();
    end if;
  end if;
  if is_burn then
    insert into processed_burns (burn_tx, wallet, tickets, tokens, round_id, given, credited)
    values (p_burn_tx, p_wallet, p_count, coalesce(p_tokens, 0), p_round, give, extra);
  end if;
  return jsonb_build_object('given', give, 'credited', extra, 'duplicate', false);
end $$;
revoke all on function add_tickets(bigint, text, int, text, text, numeric, int) from public, anon, authenticated;

-- every $CIRCO burned by each wallet in a time window, counted once whatever it bought
create or replace function burns_by_wallet(p_from timestamptz, p_to timestamptz)
returns table (wallet text, tokens numeric)
language sql stable security definer set search_path = public as $$
  select wallet, sum(tokens) from (
    select pb.wallet, pb.tokens from processed_burns pb
      where pb.created_at >= p_from and pb.created_at < p_to
        and not exists (select 1 from games g where g.burn_tx = pb.burn_tx)
        and not exists (select 1 from predictions p where p.burn_tx = pb.burn_tx)
    union all select g.wallet, g.tokens_burned from games g where g.status = 'played' and g.played_at >= p_from and g.played_at < p_to
    union all select e.wallet, e.tokens from effects e where e.created_at >= p_from and e.created_at < p_to
    union all select p.wallet, p.tokens from predictions p where p.created_at >= p_from and p.created_at < p_to
  ) b group by wallet;
$$;
revoke all on function burns_by_wallet(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function team_scores(p_from timestamptz, p_to timestamptz)
returns table (team text, tokens numeric, members int)
language sql stable security definer set search_path = public as $$
  select pr.team, coalesce(sum(b.tokens), 0), count(b.wallet)::int
  from profiles pr left join burns_by_wallet(p_from, p_to) b on b.wallet = pr.wallet
  where pr.team is not null group by pr.team;
$$;
revoke all on function team_scores(timestamptz, timestamptz) from public, anon, authenticated;

-- totals: all burns once, and the live Mega Jackpot
create or replace view public_stats with (security_invoker = true) as
  select (select coalesce(sum(tokens), 0) from burns_by_wallet('-infinity', 'infinity'))                 as tokens_burned,
         (select coalesce(sum(sol_spent), 0) from buybacks)                                               as sol_bought_back,
         (select coalesce(sum(prize_sol), 0) + coalesce(sum(jackpot_won), 0) from rounds where phase = 'done') as sol_paid,
         (select count(*) from rounds where phase = 'done')::int                                          as rounds_played,
         (select coalesce(sum(jackpot_sol), 0) from fees) - (select coalesce(sum(jackpot_won), 0) from rounds) as jackpot_sol;
