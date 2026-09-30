-- $CIRCO — optional X account on top of the mandatory nickname. One X account per wallet.
alter table profiles add column x_id        text unique;
alter table profiles add column x_handle    text;
alter table profiles add column x_avatar    text;
alter table profiles add column x_linked_at timestamptz;

-- short-lived OAuth state (PKCE verifier) between "Link X" and the callback; server only
create table x_link_states (
  state       text primary key,
  wallet      text not null,
  verifier    text not null,
  created_at  timestamptz not null default now()
);
alter table x_link_states enable row level security;
