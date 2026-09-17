-- Ruby joined by accident and typed the league passcode ("mball") as her name,
-- then joined again properly as "Ruby doobey". This removes the stray account.
--
-- Her two half-picked couples and her elimination call go with it automatically;
-- the real "Ruby doobey" account keeps its own and is untouched.

delete from dwts_players
where name = 'mball'
  and league_id = 'eb31f6c6-2a07-4508-9138-4c3c674054a0';

-- The reason this needed you at all: dwts_players could be read, added to and
-- renamed, but never deleted — so a mistyped join was permanent. This lets a
-- stray account be cleared without a trip to the dashboard next time. Same
-- open-door setup as every other table in this app.
drop policy if exists "remove players" on dwts_players;
create policy "remove players" on dwts_players for delete using (true);

notify pgrst, 'reload schema';
