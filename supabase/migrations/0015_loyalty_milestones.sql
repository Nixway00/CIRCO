-- $CIRCO — loyalty tickets for holders, milestone balloons on market-cap records.
create table loyalty_balances (
  wallet  text not null,
  day     date not null,
  tokens  numeric(30,0) not null,
  primary key (wallet, day)
);
alter table loyalty_balances enable row level security;      -- engine only

alter table rounds add column milestone_usd numeric(14,0);    -- set on a milestone balloon

alter table tickets drop constraint if exists tickets_kind_check;
alter table tickets add constraint tickets_kind_check check (kind in ('burn', 'late', 'mission', 'carried', 'credit', 'game', 'pick', 'team', 'lucky', 'loyalty'));

insert into config (key, value) values
  ('loyalty_min_tokens', '100000'),                          -- hold at least this for a full day…
  ('loyalty_tickets', '1'),                                  -- …and get this many free tickets
  ('milestones_usd', '[100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000]'),
  ('milestones_reached', '[]'),
  ('milestone_pending', '0')                                 -- a milestone waiting for its gold balloon (0 = none)
on conflict (key) do nothing;

-- loyalty tickets are free credits, like team rewards
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
  if is_burn or p_kind in ('team', 'lucky', 'loyalty') then
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
