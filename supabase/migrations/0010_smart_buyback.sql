-- $CIRCO — buybacks that land on dips, the first rounds on the green 0.5 SOL balloon.
create table price_ticks (
  ts     timestamptz primary key default now(),
  price  numeric(30,18) not null          -- SOL per whole $CIRCO, sampled every minute
);
alter table price_ticks enable row level security;
create policy "read all" on price_ticks for select using (true);

alter table buybacks add column reason text;   -- dip, deep_dip, quiet_support, drip

insert into config (key, value) values
  ('buyback_mode', '"smart"'),               -- smart | off
  ('buyback_dip_pct', '0.12'),                -- a 12% drop from the 30-minute high is a dip
  ('buyback_quiet_volume_sol', '5'),          -- under 5 SOL traded in 30 minutes the chart is quiet
  ('buyback_max_hold_sol', '10'),             -- never wait on more than this
  ('buyback_max_hold_hours', '24'),           -- nor for longer than this
  ('buyback_max_impact', '0.02'),             -- each buy chunk moves the price by at most 2%
  ('first_rounds_balloon', '"green"')         -- the opening rounds use the green 0.5 SOL balloon
on conflict (key) do nothing;
