-- $CIRCO — the last-ticket war and the ticket priced in dollars.
alter table rounds add column snipe_base timestamptz;      -- the countdown end the war started from (cap reference)
alter table rounds add column snipes int not null default 0;
insert into config (key, value) values
  ('close_grace_sec', '5'),          -- seconds after the end before sales really close (late on-chain burns still count)
  ('snipe_window_sec', '15'),        -- a ticket in the last 15 s pushes the end to 15 s after it…
  ('snipe_cap_sec', '120'),          -- …up to 2 minutes past the original end
  ('ticket_price_mode', '"usd"'),    -- usd: the engine keeps the ticket near the target below; manual: the team sets it
  ('ticket_usd_target', '0.25'),
  ('ticket_tokens_min', '1000'),
  ('ticket_tokens_max', '1000000'),
  ('ticket_price_pending', '0'),     -- a new price announced, applied from the next round (0 = none)
  ('ticket_price_prev', '0'),        -- the previous price, still accepted for a few minutes after a change
  ('ticket_price_changed_at', '0')
on conflict (key) do nothing;
