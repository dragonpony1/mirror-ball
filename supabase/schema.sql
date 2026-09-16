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
  winner_bonus int not null default 50,   -- last episode: points for calling the winner
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

-- Who you think goes home. Usually one call a week, but the two-night premiere
-- sent a couple home each night and later rounds run double eliminations, so
-- `slot` says which call this is. Normal weeks only ever use slot 1.
create table if not exists dwts_elimpicks (
  player_id uuid not null references dwts_players(id) on delete cascade,
  league_id uuid not null references dwts_leagues(id) on delete cascade,
  season int not null,
  week int not null,
  slot int not null default 1,
  couple_id text not null,
  updated_at timestamptz default now(),
  primary key (player_id, season, week, slot)
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
-- is_finale has to be set by hand: the app can only work out which week was the
-- last episode afterwards, from who's left, and the winner call has to be
-- offered during it.
create table if not exists dwts_weeks (
  season int not null,
  week int not null,
  lock_at timestamptz,                    -- null = the default Tuesday 8pm ET
  no_elimination boolean not null default false,
  results_in boolean not null default false,
  is_finale boolean not null default false,
  primary key (season, week)
);

-- The last episode's "who takes the Mirrorball" call. One per player per season.
create table if not exists dwts_winnerpicks (
  player_id uuid not null references dwts_players(id) on delete cascade,
  league_id uuid not null references dwts_leagues(id) on delete cascade,
  season int not null,
  couple_id text not null,
  updated_at timestamptz default now(),
  primary key (player_id, season)
);

-- A picture for each couple, added by whoever fancies it. Shared by every
-- league like the scores are, and anyone can replace one.
create table if not exists dwts_faces (
  season int not null,
  couple_id text not null,
  url text not null,
  added_by text,
  updated_at timestamptz default now(),
  primary key (season, couple_id)
);

create table if not exists dwts_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references dwts_leagues(id) on delete cascade,
  -- null player_id = posted by the automatic score check, not by a person
  player_id uuid references dwts_players(id) on delete cascade,
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
alter table dwts_winnerpicks enable row level security;
alter table dwts_faces       enable row level security;

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

create policy "read winner picks"   on dwts_winnerpicks for select using (true);
create policy "set winner picks"    on dwts_winnerpicks for insert with check (true);
create policy "change winner picks" on dwts_winnerpicks for update using (true);

create policy "read faces"   on dwts_faces for select using (true);
create policy "add faces"    on dwts_faces for insert with check (true);
create policy "change faces" on dwts_faces for update using (true);
create policy "drop faces"   on dwts_faces for delete using (true);

create policy "read chat"  on dwts_messages for select using (true);
create policy "write chat" on dwts_messages for insert with check (true);

-- ---------- prop bets ----------
-- These three were created live during season 35 rather than from this file.
-- Reconstructed here so a fresh project comes up whole; `if not exists` makes
-- re-running it against the real project a no-op.

create table if not exists dwts_props (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references dwts_leagues(id) on delete cascade,
  season int not null,
  week int not null,
  text text not null,
  kind text not null,                     -- 'yesno' or 'couple'
  pays int not null,
  auto text,                              -- settles itself from the scores; see autoWinners()
  answer text,                            -- the old one-person call, kept for props settled before voting
  settled_by text,
  created_at timestamptz default now()
);

create table if not exists dwts_propbets (
  player_id uuid not null,
  prop_id uuid not null references dwts_props(id) on delete cascade,
  league_id uuid not null,
  answer text not null,
  balls int not null default 1,
  updated_at timestamptz default now(),
  primary key (player_id, prop_id)
);

-- A prop somebody WROTE needs 5 of the league to tick it off as a fair bet
-- before any Mirror Balls can move; otherwise you could write one you already
-- know the answer to and collect. Full script is in supabase/propvotes.sql.
create table if not exists dwts_propoks (
  prop_id uuid not null references dwts_props(id) on delete cascade,
  player_id uuid not null,
  league_id uuid not null,
  ok_at timestamptz default now(),
  primary key (prop_id, player_id)
);

-- Everyone gets a say on what happened; the most-voted answer pays and a tie
-- pays nobody. Full script with its policies is in supabase/propvotes.sql.
create table if not exists dwts_propvotes (
  prop_id uuid not null references dwts_props(id) on delete cascade,
  player_id uuid not null,
  league_id uuid not null,
  answer text not null,
  voted_at timestamptz default now(),
  primary key (prop_id, player_id)
);

alter table dwts_props     enable row level security;
alter table dwts_propbets  enable row level security;
alter table dwts_propvotes enable row level security;
alter table dwts_propoks   enable row level security;

create policy "read props"   on dwts_props for select using (true);
create policy "add props"    on dwts_props for insert with check (true);
create policy "change props" on dwts_props for update using (true);
create policy "drop props"   on dwts_props for delete using (true);

create policy "read prop bets"   on dwts_propbets for select using (true);
create policy "place prop bets"  on dwts_propbets for insert with check (true);
create policy "change prop bets" on dwts_propbets for update using (true);
create policy "pull prop bets"   on dwts_propbets for delete using (true);

create policy "read prop oks"   on dwts_propoks for select using (true);
create policy "back a prop"     on dwts_propoks for insert with check (true);
create policy "change prop oks" on dwts_propoks for update using (true);
create policy "drop prop oks"   on dwts_propoks for delete using (true);

create policy "read prop votes"   on dwts_propvotes for select using (true);
create policy "cast prop votes"   on dwts_propvotes for insert with check (true);
create policy "change prop votes" on dwts_propvotes for update using (true);
create policy "drop prop votes"   on dwts_propvotes for delete using (true);
