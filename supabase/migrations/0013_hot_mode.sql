-- $CIRCO — hot mode for very busy markets: express countdowns and supercharged balloons.
alter table rounds add column supercharged_sol numeric(18,9) not null default 0;   -- extra prize taken from the queue
alter table rounds add column express boolean not null default false;              -- short countdown, the next balloon is already paid for
insert into config (key, value) values
  ('hot_countdown_sec', '90'),        -- countdown when the queue already holds the next balloon
  ('supercharge_share', '0.5')        -- share of a big queue (above 2 balloons) added to the next balloon's prize
on conflict (key) do nothing;
