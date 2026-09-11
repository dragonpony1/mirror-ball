# 🪩 Mirror Ball

Fantasy **Dancing with the Stars** — DraftKings style, for a family league.

**Live:** https://dragonpony1.github.io/mirror-ball/

## How you play

- Every week you build a team of **5 couples** for **$50,000 or less**. The good dancers cost more.
- You score whatever the judges score them — each dance is marked out of 30 by the three judges.
  Add up your five couples, that's your week.
- **Call the elimination** for 10 bonus points. One free pick, costs nothing.
- Everything **locks when the show starts** (Tuesdays, 8pm Eastern).
- **A new team every week**, so nobody is stuck with a bad draft. Prices move as the season goes.
- Once a couple is eliminated they're off the board.
- Most points after the finale wins.

## After the show

Anyone in the league opens **Ballroom → Enter scores**, types each couple's total out of 30,
and ticks whoever went home. Standings update for everybody. Your name is stamped on the entry,
and anyone can fix a typo.

Optionally, the same screen suggests next week's salaries from this week's scores — good dancers
get more expensive, so the cap keeps biting.

## Running it locally

```bash
python -m http.server 8765 --directory .
```

Then open http://localhost:8765.

## Setup notes

Tables live in the same Supabase project as the football app, all prefixed `dwts_`.
`supabase/schema.sql` creates them from scratch. After creating them, run
`notify pgrst, 'reload schema';` or the API will report the tables as missing.

See `CLAUDE.md` for the full project guide.
