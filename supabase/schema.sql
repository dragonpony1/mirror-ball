-- Mirror Ball — Dancing with the Stars salary-cap fantasy.
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query).
--
-- Every table is prefixed dwts_ so this shares a Supabase project with the
-- football pick'em app without touching any of its tables.

create table if not exists dwts_leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  passcode text not null unique,
  icon text not null default '🪩',
  icon_url text,                          -- optional league photo ('league-pics' bucket)
  cap int not null default 50000,         -- salary cap for one week's lineup
  roster_size int not null default 5,     -- couples per lineup
  elim_bonus int not null default 10,     -- points for calling who goes home
  commish_code text,                      -- optional: required to type in judges' scores
  created_at timestamptz default now()
);

create table if not exists dwts_players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references dwts_leagues(id) on delete cascade,
  name text not null,
  last_seen timestamptz,
  last_via text,                          -- 'home screen' or 'browser'
  app_version text,
  created_at timestamptz default now(),
  unique (league_id, name)
);

-- One row per rostered couple; a player's week-N lineup is the set of rows.
-- The price PAID is frozen here, so repricing a later week can never make an
-- already-saved lineup go over the cap.
create table if not exists dwts_lineups (
  player_id uuid not null references dwts_players(id) on delete cascade,
  league_id uuid not null references dwts_leagues(id) on delete cascade,
  season int not null,
  week int not null,
  couple_id text not null,
  price int not null,
  updated_at timestamptz default now(),
  primary key (player_id, season, week, couple_id)
);

-- Who you think goes home. One per player per week.
create table if not exists dwts_elimpicks (
  player_id uuid not null references dwts_players(id) on delete cascade,
  league_id uuid not null references dwts_leagues(id) on delete cascade,
  season int not null,
  week int not null,
  couple_id text not null,
  updated_at timestamptz default now(),
  primary key (player_id, season, week)
);

-- The judges' scores. These are facts about the show, so they are SHARED by
-- every league — entered once, everybody's standings move. entered_by is
-- stamped on every row and shown in the app so corrections are traceable.
create table if not exists dwts_scores (
  season int not null,
  week int not null,
  couple_id text not null,
  score int,                              -- judges' total out of 30; null = hasn't danced
  eliminated boolean not null default false,
  entered_by text,
  updated_at timestamptz default now(),
  primary key (season, week, couple_id)
);

-- Weekly salaries. No row for a couple = use the opening price from cast.js.
create table if not exists dwts_prices (
  season int not null,
  week int not null,
  couple_id text not null,
  price int not null,
  primary key (season, week, couple_id)
);

-- Per-week settings the commissioner can adjust when ABC moves a show.
create table if not exists dwts_weeks (
  season int not null,
  week int not null,
  lock_at timestamptz,                    -- null = the default Tuesday 8pm ET
  no_elimination boolean not null default false,
  results_in boolean not null default false,
  primary key (season, week)
);

create table if not exists dwts_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references dwts_leagues(id) on delete cascade,
  player_id uuid not null references dwts_players(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

-- Family-style app: the anon key may read and write freely. Leagues are
-- "closed" only by their passcode. Don't put anything private here.
alter table dwts_leagues   enable row level security;
alter table dwts_players   enable row level security;
alter table dwts_lineups   enable row level security;
alter table dwts_elimpicks enable row level security;
alter table dwts_scores    enable row level security;
alter table dwts_prices    enable row level security;
alter table dwts_weeks     enable row level security;
alter table dwts_messages  enable row level security;

create policy "anyone can find a league"   on dwts_leagues for select using (true);
create policy "anyone can start a league"  on dwts_leagues for insert with check (true);
create policy "anyone can set up a league" on dwts_leagues for update using (true);

create policy "read players"   on dwts_players for select using (true);
create policy "add players"    on dwts_players for insert with check (true);
create policy "rename players" on dwts_players for update using (true);

create policy "read lineups"   on dwts_lineups for select using (true);
create policy "set lineups"    on dwts_lineups for insert with check (true);
create policy "change lineups" on dwts_lineups for update using (true);
create policy "drop lineups"   on dwts_lineups for delete using (true);

create policy "read elims"   on dwts_elimpicks for select using (true);
create policy "set elims"    on dwts_elimpicks for insert with check (true);
create policy "change elims" on dwts_elimpicks for update using (true);

create policy "read scores"   on dwts_scores for select using (true);
create policy "enter scores"  on dwts_scores for insert with check (true);
create policy "fix scores"    on dwts_scores for update using (true);

create policy "read prices"   on dwts_prices for select using (true);
create policy "set prices"    on dwts_prices for insert with check (true);
create policy "change prices" on dwts_prices for update using (true);

create policy "read weeks"   on dwts_weeks for select using (true);
create policy "set weeks"    on dwts_weeks for insert with check (true);
create policy "change weeks" on dwts_weeks for update using (true);

create policy "read chat"  on dwts_messages for select using (true);
create policy "write chat" on dwts_messages for insert with check (true);
