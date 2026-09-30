-- $CIRCO — the coin's pump.fun live chat flows into the site chat (and big moments flow back).
alter table chat_messages add column source text not null default 'site' check (source in ('site', 'pumpfun'));
alter table chat_messages add column ext_id text unique;     -- pump.fun message id, so nothing is shown twice
alter table chat_messages add column author text;            -- pump.fun username
insert into config (key, value) values ('pumpfun_chat_relay', 'true') on conflict (key) do nothing;
