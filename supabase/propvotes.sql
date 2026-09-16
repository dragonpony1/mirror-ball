-- Two tables, both about keeping one person from deciding a prop on their own.
--
--   dwts_propoks    a prop somebody WROTE needs 5 of the league to tick it off
--                   as a fair bet before anyone can stake a Mirror Ball on it.
--   dwts_propvotes  once the show's over, everyone says what happened and the
--                   answer with the most votes is the one that pays.
--
-- One row per player per prop in both, so nobody can stuff either ballot and
-- changing your mind just overwrites your own row.
--
-- Paste the whole thing into the Supabase SQL editor and press Run. The app
-- already ships with both built in; they stay hidden until these tables exist
-- and switch themselves on the next time anyone opens it.

-- ---------- is this a fair bet? ----------

create table if not exists dwts_propoks (
  prop_id   uuid not null references dwts_props(id) on delete cascade,
  player_id uuid not null,
  league_id uuid not null,
  ok_at     timestamptz default now(),
  primary key (prop_id, player_id)
);

create index if not exists dwts_propoks_league on dwts_propoks (league_id);

alter table dwts_propoks enable row level security;

drop policy if exists "read prop oks"   on dwts_propoks;
drop policy if exists "back a prop"     on dwts_propoks;
drop policy if exists "change prop oks" on dwts_propoks;
drop policy if exists "drop prop oks"   on dwts_propoks;

create policy "read prop oks"   on dwts_propoks for select using (true);
create policy "back a prop"     on dwts_propoks for insert with check (true);
create policy "change prop oks" on dwts_propoks for update using (true);
create policy "drop prop oks"   on dwts_propoks for delete using (true);

-- ---------- what actually happened? ----------

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
