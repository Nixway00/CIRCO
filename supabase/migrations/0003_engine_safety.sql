-- $CIRCO — engine safety: exact ticket caps, no lost burns, idempotent payouts,
-- fees that arrive after a balloon is full, and one cheap snapshot for every viewer.

-- ---------- rounds: overflow and draw bookkeeping ----------
alter table rounds add column overflow_sol     numeric(18,9) not null default 0;   -- fees above capacity, carried to the next round
alter table rounds add column overflow_pending boolean not null default false;
alter table rounds add column draw_total_tickets int;

-- ---------- tickets: new kinds ----------
alter table tickets drop constraint if exists tickets_kind_check;
alter table tickets add constraint tickets_kind_check check (kind in ('burn', 'late', 'mission', 'carried', 'credit'));
create index if not exists tickets_wallet_idx on tickets (wallet);

-- every burn processed exactly once, even when all its tickets go to credits
create table processed_burns (
  burn_tx     text primary key,
  wallet      text not null,
  tickets     int not null,
  tokens      numeric(30,0) not null default 0,
  round_id    bigint references rounds(id),
  given       int not null,
  credited    int not null,
  created_at  timestamptz not null default now()
);

-- tickets that could not fit (10-ticket cap, or no open round): granted at the start of the next rounds
create table ticket_credits (
  wallet      text primary key,
  tickets     int not null default 0 check (tickets >= 0),
  updated_at  timestamptz not null default now()
);

-- one row per payment, written BEFORE the transaction is sent, so a restart can never pay twice
create table payouts (
  id                    bigserial primary key,
  round_id              bigint not null references rounds(id),
  kind                  text not null check (kind in ('winner', 'bonus')),
  wallet                text not null,
  lamports              bigint not null check (lamports >= 0),
  status                text not null default 'pending' check (status in ('pending', 'sent', 'confirmed', 'skipped')),
  signature             text,
  last_valid_height     bigint,
  attempts              int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (round_id, kind)
);

-- precomputed public data (stats, leaderboard, history) refreshed by the engine a few times a minute
create table snapshots (
  key         text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table processed_burns enable row level security;
alter table ticket_credits  enable row level security;
alter table payouts         enable row level security;
alter table snapshots       enable row level security;
create policy "read all" on processed_burns for select using (true);
create policy "read all" on ticket_credits  for select using (true);
create policy "read all" on payouts         for select using (true);
create policy "read all" on snapshots       for select using (true);

alter publication supabase_realtime add table snapshots;

-- ---------- the only way tickets are added ----------
-- Serialises per (round, wallet), so two simultaneous purchases can never pass the cap.
-- Burns: deduplicated by signature; what does not fit becomes a credit for later rounds.
-- Free tickets (mission, credit, carried): what does not fit is simply not given.
create or replace function add_tickets(
  p_round   bigint,      -- null = no open round right now: everything becomes credit
  p_wallet  text,
  p_count   int,
  p_kind    text,
  p_burn_tx text,
  p_tokens  numeric,
  p_cap     int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  held  int := 0;
  give  int := 0;
  extra int := 0;
  is_burn boolean := p_kind in ('burn', 'late');
begin
  if p_count < 1 then return jsonb_build_object('given', 0, 'credited', 0, 'duplicate', false); end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_round::text, 'none') || ':' || p_wallet, 0));

  if is_burn then
    if exists (select 1 from processed_burns where burn_tx = p_burn_tx) then
      return jsonb_build_object('given', 0, 'credited', 0, 'duplicate', true);
    end if;
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

-- take granted credits off a wallet's balance atomically
create or replace function consume_credit(p_wallet text, p_n int) returns void
language sql security definer set search_path = public as $$
  update ticket_credits set tickets = greatest(0, tickets - p_n), updated_at = now() where wallet = p_wallet;
$$;
revoke all on function consume_credit(text, int) from public, anon, authenticated;

-- totals for the public snapshot (read by the engine only, a few times a minute)
create view public_stats with (security_invoker = true) as
  select (select coalesce(sum(tokens), 0) from processed_burns)                 as tokens_burned,
         (select coalesce(sum(sol_spent), 0) from buybacks)                     as sol_bought_back,
         (select coalesce(sum(prize_sol), 0) from rounds where phase = 'done')  as sol_paid,
         (select count(*) from rounds where phase = 'done')::int                as rounds_played;
