-- Private key/value store for the engine (X OAuth refresh token, …).
-- RLS on and no policy: only the service role can read or write it.
create table engine_secrets (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);
alter table engine_secrets enable row level security;

-- One row per finished round with its ticket totals, for History and the stage
create view round_summary with (security_invoker = true) as
  select r.id, r.balloon, r.phase, r.capacity_sol, r.prize_sol, r.winner_wallet, r.winner_tickets,
         r.last_buyer, r.winner_payout_tx, r.bonus_payout_tx, r.ended_at,
         coalesce(sum(t.count), 0)::int  as total_tickets,
         count(distinct t.wallet)::int   as wallets
  from rounds r
  left join tickets t on t.round_id = r.id
  where r.phase in ('done', 'postponed')
  group by r.id;
