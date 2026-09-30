-- $CIRCO — small engine state that must survive restarts (the buyback's dip episode and pacing clocks).
create table engine_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table engine_state enable row level security;   -- engine only

-- the 30-minute timer only pops a balloon that is at least this full (otherwise it keeps inflating)
insert into config (key, value) values ('timer_min_fill', '0.25') on conflict (key) do nothing;
