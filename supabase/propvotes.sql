-- Prop voting: everyone gets to say what happened, and the answer with the most
-- votes is the one that pays. One row per player per prop, so nobody can stuff
-- the ballot and changing your mind just overwrites your own row.
--
-- Paste the whole thing into the Supabase SQL editor and press Run. The app
-- already ships with voting built in; it stays hidden until this table exists,
-- and switches itself on the next time anyone opens it.

create table if not exists dwts_propvotes (
  prop_id   uuid not null references dwts_props(id) on delete cascade,
  player_id uuid not null,
  league_id uuid not null,
  answer    text not null,
  voted_at  timestamptz default now(),
  primary key (prop_id, player_id)
);

create index if not exists dwts_propvotes_league on dwts_propvotes (league_id);

alter table dwts_propvotes enable row level security;

drop policy if exists "read prop votes"   on dwts_propvotes;
drop policy if exists "cast prop votes"   on dwts_propvotes;
drop policy if exists "change prop votes" on dwts_propvotes;
drop policy if exists "drop prop votes"   on dwts_propvotes;

create policy "read prop votes"   on dwts_propvotes for select using (true);
create policy "cast prop votes"   on dwts_propvotes for insert with check (true);
create policy "change prop votes" on dwts_propvotes for update using (true);
create policy "drop prop votes"   on dwts_propvotes for delete using (true);

-- Without this the app gets PGRST205 "table not found" even though it exists.
notify pgrst, 'reload schema';
