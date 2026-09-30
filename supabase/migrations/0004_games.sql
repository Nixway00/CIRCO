-- $CIRCO — minigames: the shooting gallery. Burn $CIRCO, take 3 shots, each hit = 1 ticket.
insert into config (key, value) values
  ('game_price_tokens', '10000'),
  ('game_shots', '3'),
  ('game_hit_chance', '0.3'),
  ('game_daily_ticket_cap', '5')
on conflict (key) do nothing;

create table games (
  id            uuid primary key default gen_random_uuid(),
  wallet        text not null,
  kind          text not null default 'shooting_gallery',
  seed_commit   text not null,                 -- sha256(secret), shown before the player burns
  seed_secret   text,                          -- revealed after the game is played
  burn_tx       text unique,
  tokens_burned numeric(30,0) not null default 0,
  status        text not null default 'waiting' check (status in ('waiting', 'played', 'expired')),
  shots         int,
  outcomes      jsonb,                         -- [true, false, true]
  hits          int,
  tickets_given int,                           -- into the open round
  credited      int,                           -- saved for later rounds (10-per-round cap)
  capped        int,                           -- hits not paid because of the daily cap
  round_id      bigint references rounds(id),
  created_at    timestamptz not null default now(),
  played_at     timestamptz
);
create index games_wallet_day_idx on games (wallet, played_at);

create table game_secrets (                    -- private until the game is played
  game_id  uuid primary key references games(id),
  secret   text not null
);

alter table games        enable row level security;
alter table game_secrets enable row level security;   -- no policy: engine only
create policy "read all" on games for select using (true);

-- game tickets are paid (they burn tokens): counted like burns, overflow becomes credit
alter table tickets drop constraint if exists tickets_kind_check;
alter table tickets add constraint tickets_kind_check check (kind in ('burn', 'late', 'mission', 'carried', 'credit', 'game'));

create or replace function add_tickets(
  p_round bigint, p_wallet text, p_count int, p_kind text, p_burn_tx text, p_tokens numeric, p_cap int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  held  int := 0;
  give  int := 0;
  extra int := 0;
  is_burn boolean := p_kind in ('burn', 'late', 'game');
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
  if is_burn then
    extra := p_count - give;
    if extra > 0 then
      insert into ticket_credits (wallet, tickets) values (p_wallet, extra)
      on conflict (wallet) do update set tickets = ticket_credits.tickets + excluded.tickets, updated_at = now();
    end if;
    insert into processed_burns (burn_tx, wallet, tickets, tokens, round_id, given, credited)
    values (p_burn_tx, p_wallet, p_count, coalesce(p_tokens, 0), p_round, give, extra);
  end if;
  return jsonb_build_object('given', give, 'credited', extra, 'duplicate', false);
end $$;
revoke all on function add_tickets(bigint, text, int, text, text, numeric, int) from public, anon, authenticated;

-- every game burns tokens, whatever it wins: count them once (game burns may also sit in processed_burns)
create or replace view public_stats with (security_invoker = true) as
  select (select coalesce(sum(tokens), 0) from processed_burns pb where not exists (select 1 from games g where g.burn_tx = pb.burn_tx))
         + (select coalesce(sum(tokens_burned), 0) from games where status = 'played')   as tokens_burned,
         (select coalesce(sum(sol_spent), 0) from buybacks)                               as sol_bought_back,
         (select coalesce(sum(prize_sol), 0) from rounds where phase = 'done')            as sol_paid,
         (select count(*) from rounds where phase = 'done')::int                          as rounds_played;
