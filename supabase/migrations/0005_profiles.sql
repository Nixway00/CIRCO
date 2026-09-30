-- $CIRCO — nicknames. One per wallet, unique (case-insensitive), set with a signed message.
create table profiles (
  wallet      text primary key,
  nickname    text not null check (nickname ~ '^[A-Za-z0-9_]{3,16}$'),
  updated_at  timestamptz not null default now()
);
create unique index profiles_nickname_lower_idx on profiles (lower(nickname));
alter table profiles enable row level security;
create policy "read all" on profiles for select using (true);
