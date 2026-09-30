-- $CIRCO — lucky meter (every N losing tickets = 1 free ticket) and the graduation gala.
create table lucky_meter (
  wallet          text primary key,
  losing_tickets  int not null default 0,     -- purchased tickets in rounds the wallet did not win
  free_given      int not null default 0,     -- free tickets already granted from the meter
  updated_at      timestamptz not null default now()
);
alter table lucky_meter enable row level security;
create policy "read all" on lucky_meter for select using (true);
alter table rounds add column lucky_done boolean not null default false;   -- meter already updated for this round
alter table rounds add column grand_opening boolean not null default false;

alter table tickets drop constraint if exists tickets_kind_check;
alter table tickets add constraint tickets_kind_check check (kind in ('burn', 'late', 'mission', 'carried', 'credit', 'game', 'pick', 'team', 'lucky'));
alter table effects drop constraint if exists effects_effect_check;
alter table effects add constraint effects_effect_check check (effect in ('fireworks', 'confetti', 'horn', 'tomato', 'goldrain', 'gala'));

insert into config (key, value) values
  ('lucky_every', '20'),                      -- 20 losing tickets = 1 free ticket
  ('graduated_at', 'null')                    -- set by the engine when $CIRCO leaves the bonding curve
on conflict (key) do nothing;

-- free tickets from the lucky meter become credits like team rewards
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
  if is_burn or p_kind in ('team', 'lucky') then
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

-- the meter moves once per finished round: every purchased ticket that did not win counts
create or replace function lucky_settle(p_round bigint, p_every int) returns int
language plpgsql security definer set search_path = public as $$
declare
  w text;
  r record;
  granted int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('lucky:' || p_round, 0));
  if (select lucky_done from rounds where id = p_round) then return 0; end if;
  select winner_wallet into w from rounds where id = p_round;
  for r in select wallet, sum(count)::int as n from tickets where round_id = p_round and kind in ('burn', 'late') and wallet is distinct from w group by wallet loop
    insert into lucky_meter (wallet, losing_tickets) values (r.wallet, r.n)
    on conflict (wallet) do update set losing_tickets = lucky_meter.losing_tickets + excluded.losing_tickets, updated_at = now();
  end loop;
  update rounds set lucky_done = true where id = p_round;
  -- free tickets owed = meter / every - already given; they arrive as credits for the next rounds
  for r in select wallet, (losing_tickets / p_every) - free_given as owed from lucky_meter where p_every > 0 and (losing_tickets / p_every) > free_given loop
    insert into ticket_credits (wallet, tickets) values (r.wallet, r.owed)
    on conflict (wallet) do update set tickets = ticket_credits.tickets + excluded.tickets, updated_at = now();
    update lucky_meter set free_given = free_given + r.owed, updated_at = now() where wallet = r.wallet;
    granted := granted + r.owed;
  end loop;
  return granted;
end $$;
revoke all on function lucky_settle(bigint, int) from public, anon, authenticated;
