-- $CIRCO — initial schema
-- Only the game engine (service role) writes game state.
-- The site reads everything through the anon key and Realtime.

create extension if not exists pgcrypto;

-- Tunable settings the team can change without a deploy
create table config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into config (key, value) values
  ('ticket_price_tokens', '10000'),
  ('max_tickets_per_wallet', '10'),
  ('countdown_sec', '180'),
  ('extension_sec', '60'),
  ('max_extensions', '3'),
  ('inflate_max_sec', '1800'),
  ('first_blue_rounds', '3'),
  ('last_ticket_bonus', '0.05'),
  ('max_postpones_before_forced_draw', '3'),
  ('gala_check_utc_hour', '1'),
  ('mission_bonus_tickets', '3'),
  ('chat_min_tokens', '10000'),
  ('balloons', '{
     "green": {"capacity_sol": 0.5, "weight": 40, "min_tickets": 50,  "shape": "dog"},
     "blue":  {"capacity_sol": 1,   "weight": 35, "min_tickets": 100, "shape": "classic"},
     "red":   {"capacity_sol": 2,   "weight": 20, "min_tickets": 150, "shape": "rocket"},
     "gold":  {"capacity_sol": 5,   "weight": 5,  "min_tickets": 300, "shape": "trophy"}
   }');

create type round_phase as enum ('inflate', 'countdown', 'drawing', 'done', 'postponed');

create table rounds (
  id               bigserial primary key,
  balloon          text not null check (balloon in ('green','blue','red','gold')),
  capacity_sol     numeric(18,9) not null,       -- balloon capacity + carried prize
  carried_sol      numeric(18,9) not null default 0,
  collected_sol    numeric(18,9) not null default 0,
  phase            round_phase not null default 'inflate',
  started_at       timestamptz not null default now(),
  countdown_ends_at timestamptz,
  extensions       int not null default 0,
  postpone_streak  int not null default 0,       -- consecutive postponements before this round
  forced_gala      boolean not null default false,
  -- provably fair draw: commit at start, reveal after the draw
  seed_commit      text not null,                -- sha256(secret) published at round start
  seed_secret      text,                         -- revealed after the draw
  close_slot       bigint,                       -- slot at which sales closed
  close_blockhash  text,                         -- blockhash mixed into the seed
  winner_wallet    text,
  winner_tickets   int,
  last_buyer       text,
  prize_sol        numeric(18,9),
  winner_payout_tx text,
  bonus_payout_tx  text,
  ended_at         timestamptz
);
create index on rounds (phase);

-- Secrets stay here until the draw; RLS on and no read policy, so only the engine sees them
create table round_secrets (
  round_id    bigint primary key references rounds(id),
  secret      text not null
);

create table tickets (
  id          bigserial primary key,
  round_id    bigint not null references rounds(id),
  wallet      text not null,
  count       int not null check (count between 1 and 10),
  kind        text not null default 'burn' check (kind in ('burn','mission','carried')),
  burn_tx     text unique,                        -- null for mission and carried tickets
  tokens_burned numeric(30,0) not null default 0,
  created_at  timestamptz not null default now()
);
create index on tickets (round_id, wallet);

-- Per-round totals per wallet (used for the 10-ticket cap and the wheel)
create view round_wallet_tickets with (security_invoker = true) as
  select round_id, wallet, sum(count)::int as tickets, max(created_at) as last_at
  from tickets group by round_id, wallet;

create table fees (
  id          bigserial primary key,
  tx          text unique not null,
  wallet      text not null check (wallet in ('prize','buyback','team')),
  amount_sol  numeric(18,9) not null,
  round_id    bigint references rounds(id),
  created_at  timestamptz not null default now()
);

create table buybacks (
  id          bigserial primary key,
  swap_tx     text,
  burn_tx     text,
  sol_spent   numeric(18,9) not null,
  tokens_burned numeric(30,0) not null,
  created_at  timestamptz not null default now()
);

create table trades (                               -- live feed only, trimmed by the engine
  id          bigserial primary key,
  tx          text unique not null,
  wallet      text not null,
  side        text not null check (side in ('buy','sell')),
  amount_sol  numeric(18,9) not null,
  created_at  timestamptz not null default now()
);

create table x_links (                              -- one X account per wallet
  wallet      text primary key,
  handle      text unique not null,
  linked_at   timestamptz not null default now()
);

create table mission_claims (
  wallet      text not null,
  day_utc     date not null,
  post_url    text not null,
  round_id    bigint references rounds(id),
  tickets     int not null,
  created_at  timestamptz not null default now(),
  primary key (wallet, day_utc)
);

create table chat_messages (
  id          bigserial primary key,
  wallet      text not null,
  body        text not null check (char_length(body) between 1 and 120),
  is_ringmaster boolean not null default false,
  created_at  timestamptz not null default now()
);

create table team_wallets (                         -- labeled publicly
  wallet      text primary key,
  label       text not null
);

-- Leaderboards
create view leaderboard with (security_invoker = true) as
  select t.wallet,
         sum(t.count)::int                         as tickets_bought,
         sum(t.tokens_burned)                      as tokens_burned,
         count(distinct t.round_id)::int           as rounds_played,
         coalesce(w.wins, 0)                       as wins,
         coalesce(w.sol_won, 0) + coalesce(b.bonus_sol, 0) as sol_won,
         coalesce(b.bonus_sol, 0)                  as bonus_sol,
         (tw.wallet is not null)                   as is_team
  from tickets t
  left join (select winner_wallet as wallet, count(*)::int as wins, sum(prize_sol * (1 - 0.05)) as sol_won
             from rounds where phase = 'done' group by winner_wallet) w on w.wallet = t.wallet
  left join (select last_buyer as wallet, sum(prize_sol * 0.05) as bonus_sol
             from rounds where phase = 'done' group by last_buyer) b on b.wallet = t.wallet
  left join team_wallets tw on tw.wallet = t.wallet
  group by t.wallet, w.wins, w.sol_won, b.bonus_sol, tw.wallet;

-- Row level security: everyone can read, nobody but the service role can write
alter table config          enable row level security;
alter table rounds          enable row level security;
alter table tickets         enable row level security;
alter table fees            enable row level security;
alter table buybacks        enable row level security;
alter table trades          enable row level security;
alter table x_links         enable row level security;
alter table mission_claims  enable row level security;
alter table chat_messages   enable row level security;
alter table team_wallets    enable row level security;
alter table round_secrets   enable row level security;  -- no policy: invisible to the public

create policy "read all" on config         for select using (true);
create policy "read all" on rounds         for select using (true);
create policy "read all" on tickets        for select using (true);
create policy "read all" on fees           for select using (true);
create policy "read all" on buybacks       for select using (true);
create policy "read all" on trades         for select using (true);
create policy "read all" on x_links        for select using (true);
create policy "read all" on mission_claims for select using (true);
create policy "read all" on chat_messages  for select using (true);
create policy "read all" on team_wallets   for select using (true);

-- Realtime for the live stage
alter publication supabase_realtime add table rounds, tickets, trades, chat_messages;
